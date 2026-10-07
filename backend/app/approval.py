import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Sequence

from pydantic import ValidationError

from app.event_store import RunLogNotFoundError, locked_run_log
from app.replay import ReplayValidationError, replay_events
from app.schemas import (
    IDEMPOTENCY_VERSION,
    ApprovedIdempotencyMetadata,
    Recommendation,
    RunStatus,
)



class ApprovalRunNotFoundError(LookupError):
    """No persisted or bootstrappable run exists."""


class ApprovalAuditConflictError(RuntimeError):
    """The existing audit history is not safe to approve."""

    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class ApprovalAlreadyCommittedError(RuntimeError):
    """A different approval is already authoritative."""


class ApprovalEscalatedError(RuntimeError):
    """The authoritative run projection requires escalation, not approval."""


class IdempotencyConflictError(RuntimeError):
    """An idempotency key was reused for a different request."""


class InvalidIdempotencyKeyError(ValueError):
    """An approval request omitted or malformed its idempotency key."""


@dataclass(frozen=True)
class ApprovalCommitResult:
    run: RunStatus
    replayed: bool


def _utc_timestamp() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _validate_idempotency_key(key: str) -> None:
    if (
        not isinstance(key, str)
        or not 1 <= len(key) <= 128
        or any(ord(character) < 33 or ord(character) > 126 for character in key)
    ):
        raise InvalidIdempotencyKeyError


def _request_identity(
    run_id: str,
    draft_text: str | None,
    approved_by: str | None,
    idempotency_key: str,
) -> ApprovedIdempotencyMetadata:
    _validate_idempotency_key(idempotency_key)
    canonical_request = json.dumps(
        {
            "approved_by": approved_by,
            "draft_text": draft_text,
            "run_id": run_id,
            "version": IDEMPOTENCY_VERSION,
        },
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return ApprovedIdempotencyMetadata(
        version=IDEMPOTENCY_VERSION,
        key_sha256=hashlib.sha256(idempotency_key.encode("ascii")).hexdigest(),
        request_sha256=hashlib.sha256(canonical_request).hexdigest(),
    )


def _strict_projection(run_id: str, events: Sequence[dict]) -> RunStatus:
    try:
        result = replay_events(run_id, events, strict=True)
    except ReplayValidationError as exc:
        raise ApprovalAuditConflictError(exc.reason) from exc
    if result is None:
        raise ApprovalAuditConflictError("empty_audit_log")
    return result


def _validated_pending_recommendation(
    run_id: str,
    events: Sequence[dict],
) -> tuple[RunStatus, Recommendation]:
    projection = _strict_projection(run_id, events)
    if projection.status == "escalated":
        raise ApprovalEscalatedError
    if projection.status != "approval_requested":
        raise ApprovalAuditConflictError("run_not_pending")
    if projection.findings is None or projection.findings.should_escalate:
        raise ApprovalAuditConflictError("run_not_approvable")
    if projection.recommendation is None:
        raise ApprovalAuditConflictError("missing_recommendation")
    return projection, projection.recommendation


def _validate_idempotency_metadata(
    payload: dict,
) -> ApprovedIdempotencyMetadata | None:
    if "idempotency" not in payload:
        return None
    metadata = payload["idempotency"]
    if not isinstance(metadata, dict):
        raise ApprovalAuditConflictError("invalid_approved_idempotency")
    try:
        return ApprovedIdempotencyMetadata.model_validate(metadata, strict=True)
    except ValidationError as exc:
        raise ApprovalAuditConflictError("invalid_approved_idempotency")


def _validate_committed_log(
    run_id: str,
    events: Sequence[dict],
) -> tuple[
    RunStatus,
    ApprovedIdempotencyMetadata | None,
    Recommendation,
    str | None,
]:
    projection = _strict_projection(run_id, events)
    if projection.status != "approved" or projection.recommendation is None:
        raise ApprovalAuditConflictError("invalid_approved_projection")

    _, pending_recommendation = _validated_pending_recommendation(
        run_id,
        events[:-1],
    )

    approved_payload = events[-1].get("payload")
    if not isinstance(approved_payload, dict):
        raise ApprovalAuditConflictError("invalid_approved_payload")
    final_recommendation = approved_payload.get("final_recommendation")
    if not isinstance(final_recommendation, dict):
        raise ApprovalAuditConflictError("invalid_approved_payload")
    try:
        authoritative = Recommendation.model_validate(final_recommendation)
    except ValidationError as exc:
        raise ApprovalAuditConflictError("invalid_approved_payload") from exc
    if authoritative != projection.recommendation:
        raise ApprovalAuditConflictError("invalid_approved_projection")

    if (
        authoritative.action_type != pending_recommendation.action_type
        or authoritative.rationale != pending_recommendation.rationale
    ):
        raise ApprovalAuditConflictError("invalid_approved_projection")

    stored_approved_by = approved_payload.get("approved_by")
    if "approved_by" in approved_payload and not isinstance(stored_approved_by, str):
        raise ApprovalAuditConflictError("invalid_approved_reviewer")

    return (
        projection,
        _validate_idempotency_metadata(approved_payload),
        pending_recommendation,
        stored_approved_by,
    )


def _normalized_bootstrap(
    run_id: str,
    events: Sequence[dict] | None,
) -> list[dict] | None:
    if events is None:
        return None
    projection, _ = _validated_pending_recommendation(run_id, events)
    return [event.model_dump(mode="json") for event in projection.events]


def commit_approval(
    run_id: str,
    *,
    draft_text: str | None,
    approved_by: str | None,
    idempotency_key: str,
    bootstrap_events: Sequence[dict] | None = None,
) -> ApprovalCommitResult:
    """Validate and durably commit one authoritative approval under one lock."""
    request_identity = _request_identity(
        run_id,
        draft_text,
        approved_by,
        idempotency_key,
    )
    bootstrap = _normalized_bootstrap(run_id, bootstrap_events)

    try:
        with locked_run_log(run_id, create=bootstrap is not None) as log:
            snapshot = log.snapshot()
            if snapshot.malformed_lines:
                raise ApprovalAuditConflictError("malformed_audit_record")
            if snapshot.byte_count > 0 and not snapshot.events:
                raise ApprovalAuditConflictError("bootstrap_interrupted")

            disk_events = snapshot.events
            if any(event.get("type") == "approved" for event in disk_events):
                (
                    projection,
                    stored_identity,
                    pending_recommendation,
                    stored_approved_by,
                ) = _validate_committed_log(run_id, disk_events)
                if (
                    stored_identity is not None
                    and stored_identity.key_sha256 == request_identity.key_sha256
                ):
                    if stored_identity.request_sha256 != request_identity.request_sha256:
                        raise IdempotencyConflictError
                    expected_recommendation = pending_recommendation.model_copy(
                        update={
                            "draft_text": (
                                draft_text
                                if draft_text is not None
                                else pending_recommendation.draft_text
                            )
                        }
                    )
                    if (
                        projection.recommendation != expected_recommendation
                        or stored_approved_by != approved_by
                    ):
                        raise ApprovalAuditConflictError(
                            "approved_result_does_not_match_request"
                        )
                    log.confirm_durable()
                    return ApprovalCommitResult(
                        run=projection.model_copy(
                            update={"is_replay_response": False}
                        ),
                        replayed=True,
                    )
                raise ApprovalAlreadyCommittedError

            if disk_events:
                pending_events = disk_events
            else:
                if snapshot.byte_count != 0:
                    raise ApprovalAuditConflictError("bootstrap_interrupted")
                if not log.created:
                    raise ApprovalAuditConflictError("bootstrap_interrupted")
                if bootstrap is None:
                    raise ApprovalRunNotFoundError
                pending_events = bootstrap

            _, recommendation = _validated_pending_recommendation(
                run_id,
                pending_events,
            )
            final_recommendation = recommendation.model_copy(
                update={
                    "draft_text": (
                        draft_text
                        if draft_text is not None
                        else recommendation.draft_text
                    )
                }
            )
            approved_payload: dict = {
                "final_recommendation": final_recommendation.model_dump(),
                "idempotency": request_identity.model_dump(),
            }
            if approved_by is not None:
                approved_payload["approved_by"] = approved_by

            approved_event = {
                "type": "approved",
                "timestamp": _utc_timestamp(),
                "payload": approved_payload,
            }
            candidate_events = [*pending_events, approved_event]
            candidate, _, _, _ = _validate_committed_log(run_id, candidate_events)

            events_to_append = (
                [*pending_events, approved_event]
                if not disk_events
                else [approved_event]
            )
            log.append_events(events_to_append)
            return ApprovalCommitResult(
                run=candidate.model_copy(update={"is_replay_response": False}),
                replayed=False,
            )
    except RunLogNotFoundError as exc:
        raise ApprovalRunNotFoundError from exc
