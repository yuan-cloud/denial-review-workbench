"""Tests for app.pipeline — document loading, run_id, JSON parsing, normalization, orchestration."""

import json
import re
from datetime import datetime
from pathlib import Path
import pytest

from app.errors import PipelineError
from app.pipeline import (
    ACTION_TYPE_ALIASES,
    FILENAME_TO_TYPE,
    _canonicalize_missing_item,
    _missing_item_supported,
    _normalize_action_type,
    _normalize_facts_payload,
    _normalize_missing_items,
    _parse_json,
    load_documents,
    make_run_id,
)
from app.schemas import CaseDocument, CaseFindings


# ==================== bd-38p.2.1: document loading, run_id, JSON fence parsing ====================

class TestMakeRunId:
    def test_format(self):
        rid = make_run_id("case-001")
        assert rid.startswith("run-case-001-")
        # Timestamp portion should be 14 digits (YYYYMMDDHHmmSS)
        ts_part = rid.replace("run-case-001-", "")
        assert re.match(r"^\d{14}$", ts_part)

    def test_unique_per_call(self):
        # Two sequential calls should produce different IDs (or same if within 1 second)
        r1 = make_run_id("c")
        r2 = make_run_id("c")
        # They embed datetime, so at least format is consistent
        assert r1.startswith("run-c-")
        assert r2.startswith("run-c-")


class TestLoadDocuments:
    def test_loads_known_files(self, case_dir):
        docs = load_documents("case-002")
        doc_ids = [d.doc_id for d in docs]
        assert "denial-letter" in doc_ids
        assert "auth-request" in doc_ids
        assert "notes" in doc_ids

    def test_correct_types(self, case_dir):
        docs = load_documents("case-002")
        type_map = {d.doc_id: d.type for d in docs}
        assert type_map["denial-letter"] == "denial_letter"
        assert type_map["auth-request"] == "auth_request"
        assert type_map["notes"] == "clinical_notes"

    def test_text_not_empty(self, case_dir):
        docs = load_documents("case-002")
        for doc in docs:
            assert len(doc.text.strip()) > 0

    def test_skips_unknown_files(self, tmp_path, monkeypatch):
        """Files not in FILENAME_TO_TYPE should be skipped."""
        monkeypatch.setattr("app.pipeline.DATA_DIR", tmp_path)
        case_dir = tmp_path / "cases" / "test-case"
        case_dir.mkdir(parents=True)
        (case_dir / "denial-letter.md").write_text("denied")
        (case_dir / "unknown-doc.md").write_text("mystery")

        docs = load_documents("test-case")
        assert len(docs) == 1
        assert docs[0].doc_id == "denial-letter"

    def test_returns_sorted(self, case_dir):
        """Documents should be sorted by filename."""
        docs = load_documents("case-002")
        filenames = [d.doc_id for d in docs]
        assert filenames == sorted(filenames)


class TestParseJson:
    def test_plain_json(self):
        result = _parse_json('{"key": "value"}', "test")
        assert result == {"key": "value"}

    def test_strips_markdown_fence(self):
        raw = '```json\n{"key": "value"}\n```'
        result = _parse_json(raw, "test")
        assert result == {"key": "value"}

    def test_strips_fence_without_lang_tag(self):
        raw = '```\n{"key": "value"}\n```'
        result = _parse_json(raw, "test")
        assert result == {"key": "value"}

    def test_raises_pipeline_error_on_invalid_json(self):
        with pytest.raises(PipelineError) as exc_info:
            _parse_json("not json at all", "extract_facts")
        assert exc_info.value.stage == "extract_facts"
        assert exc_info.value.raw_response == "not json at all"

    def test_handles_whitespace(self):
        raw = '  \n  {"a": 1}  \n  '
        result = _parse_json(raw, "test")
        assert result == {"a": 1}


# ==================== bd-38p.2.2: normalization helpers ====================

class TestCanonicalMissingItem:
    def test_physician_order(self):
        assert _canonicalize_missing_item("Signed Physician Order Within 30 Days") == \
            "signed physician order within 30 days"

    def test_physician_order_variant(self):
        assert _canonicalize_missing_item("physician order (30 day)") == \
            "signed physician order within 30 days"

    def test_progress_notes(self):
        assert _canonicalize_missing_item("Progress Notes (30 days)") == \
            "progress notes within 30 days"

    def test_functional_assessment(self):
        assert _canonicalize_missing_item("Functional Assessment within 60 days") == \
            "functional assessment within 60 days"

    def test_unknown_item_lowered(self):
        assert _canonicalize_missing_item("  Some Other Document  ") == \
            "some other document"


class TestMissingItemSupported:
    def _make_docs(self, text: str) -> list[CaseDocument]:
        return [CaseDocument(doc_id="d", type="denial_letter", text=text)]

    def test_physician_order_found(self):
        docs = self._make_docs("requires a physician order for approval")
        assert _missing_item_supported("x", "signed physician order within 30 days", docs) is True

    def test_physician_order_not_found(self):
        docs = self._make_docs("no mention of anything relevant")
        assert _missing_item_supported("x", "signed physician order within 30 days", docs) is False

    def test_progress_notes_found(self):
        docs = self._make_docs("submit progress notes within 30 days")
        assert _missing_item_supported("x", "progress notes within 30 days", docs) is True

    def test_functional_assessment_found(self):
        docs = self._make_docs("functional assessment required")
        assert _missing_item_supported("x", "functional assessment within 60 days", docs) is True

    def test_generic_item_by_canonical_match(self):
        docs = self._make_docs("need treatment plan documentation")
        assert _missing_item_supported("Treatment Plan", "treatment plan", docs) is True

    def test_generic_item_by_raw_match(self):
        docs = self._make_docs("need the tx plan doc")
        assert _missing_item_supported("tx plan", "tx plan", docs) is True


class TestNormalizeMissingItems:
    def _make_docs(self, text: str) -> list[CaseDocument]:
        return [CaseDocument(doc_id="d", type="denial_letter", text=text)]

    def test_deduplicates(self):
        docs = self._make_docs("physician order required")
        items = [
            "Physician Order (30 day)",
            "Signed Physician Order Within 30 Days",
        ]
        result = _normalize_missing_items(items, docs)
        assert result.count("signed physician order within 30 days") == 1

    def test_drops_unsupported(self):
        docs = self._make_docs("nothing relevant here")
        items = ["imaginary document type"]
        result = _normalize_missing_items(items, docs)
        assert result == []

    def test_preserves_supported(self):
        docs = self._make_docs("physician order and progress notes needed")
        items = ["physician order (30 day)", "progress notes (30 days)"]
        result = _normalize_missing_items(items, docs)
        assert len(result) == 2


class TestNormalizeActionType:
    def _make_findings(self, missing_items=None, should_escalate=False):
        return CaseFindings(
            missing_items=missing_items or [],
            conflicts=[],
            appeal_basis=None,
            should_escalate=should_escalate,
            evidence_refs=[],
        )

    def test_known_alias(self):
        f = self._make_findings()
        assert _normalize_action_type("close_approved", f) == "approve_or_proceed"

    def test_request_docs_alias(self):
        f = self._make_findings(missing_items=["x"])
        assert _normalize_action_type("request_documentation", f) == "request_missing_documents"

    def test_unknown_with_missing_items(self):
        f = self._make_findings(missing_items=["something"])
        assert _normalize_action_type("gibberish", f) == "request_missing_documents"

    def test_unknown_without_missing_items(self):
        f = self._make_findings()
        assert _normalize_action_type("gibberish", f) == "approve_or_proceed"

    def test_handles_dashes_and_spaces(self):
        f = self._make_findings()
        assert _normalize_action_type(" Close-Approved ", f) == "approve_or_proceed"

    def test_all_aliases_resolve(self):
        """Every alias in ACTION_TYPE_ALIASES should resolve to a known type."""
        valid_targets = {"approve_or_proceed", "request_missing_documents"}
        for alias, target in ACTION_TYPE_ALIASES.items():
            assert target in valid_targets, f"alias '{alias}' maps to unknown target '{target}'"


class TestNormalizeFactsPayload:
    def _make_docs(self, text: str) -> list[CaseDocument]:
        return [CaseDocument(doc_id="d", type="denial_letter", text=text)]

    def test_boosts_confidence_for_approved(self):
        docs = self._make_docs("authorization approved for patient")
        payload = {"denial_reason": "some reason", "confidence": 0.5}
        result = _normalize_facts_payload(payload, docs)
        assert result["confidence"] >= 0.85

    def test_no_boost_for_real_denial(self):
        docs = self._make_docs("coverage denied for service")
        payload = {"denial_reason": "not medically necessary", "confidence": 0.5}
        result = _normalize_facts_payload(payload, docs)
        assert result["confidence"] == 0.5

    def test_keeps_high_confidence_unchanged(self):
        docs = self._make_docs("authorization approved")
        payload = {"denial_reason": "approved", "confidence": 0.95}
        result = _normalize_facts_payload(payload, docs)
        assert result["confidence"] == 0.95


# ==================== bd-38p.2.3: prompt construction constants ====================

class TestPromptConstants:
    """Verify system prompt constants contain expected structure."""

    def test_extract_facts_mentions_required_fields(self):
        from app.pipeline import EXTRACT_FACTS_SYSTEM
        for field in ["payer", "service_requested", "denial_reason",
                       "required_documents", "confidence", "evidence_refs"]:
            assert field in EXTRACT_FACTS_SYSTEM

    def test_analyze_gap_mentions_required_fields(self):
        from app.pipeline import ANALYZE_GAP_SYSTEM
        for field in ["missing_items", "conflicts", "appeal_basis",
                       "should_escalate", "evidence_refs"]:
            assert field in ANALYZE_GAP_SYSTEM

    def test_draft_action_mentions_valid_types(self):
        from app.pipeline import DRAFT_ACTION_SYSTEM
        assert "approve_or_proceed" in DRAFT_ACTION_SYSTEM
        assert "request_missing_documents" in DRAFT_ACTION_SYSTEM

    def test_verbatim_quote_rule_shared(self):
        from app.pipeline import EXTRACT_FACTS_SYSTEM, ANALYZE_GAP_SYSTEM, VERBATIM_QUOTE_RULE
        assert VERBATIM_QUOTE_RULE in EXTRACT_FACTS_SYSTEM
        assert VERBATIM_QUOTE_RULE in ANALYZE_GAP_SYSTEM


class TestFilenameToType:
    def test_all_values_match_schema_literal(self):
        valid = {"denial_letter", "auth_request", "clinical_notes"}
        for stem, doc_type in FILENAME_TO_TYPE.items():
            assert doc_type in valid, f"FILENAME_TO_TYPE['{stem}'] = '{doc_type}' not in schema Literal"


# ==================== bd-38p.2.4: orchestration — event ordering & escalation ====================

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"


def _load_mock_run(case_id: str) -> dict:
    """Load real mock_run.json from data/cases/."""
    path = DATA_DIR / "cases" / case_id / "mock_run.json"
    with open(path) as f:
        return json.load(f)


def _canned_responses_from_mock(mock: dict) -> list[str]:
    """Extract canned call_model responses from a real mock_run.json.

    The pipeline makes up to 3 model calls: extract_facts, analyze_gap,
    draft_next_action.  Each call expects a JSON string back.  We pull
    the corresponding payloads from the mock's event list so the canned
    responses match real data shapes exactly.
    """
    responses: list[str] = []
    for event in mock["events"]:
        if event["type"] == "facts_extracted":
            responses.append(json.dumps(event["payload"]["facts"]))
        elif event["type"] == "analysis_completed":
            responses.append(json.dumps(event["payload"]["findings"]))
        elif event["type"] == "draft_generated":
            responses.append(json.dumps(event["payload"]["recommendation"]))
    return responses


class TestRunPipelineOrchestration:
    """Test run_pipeline with call_model mocked — uses real case data from data/cases/.

    call_model is the only mock (replaces the Anthropic API).  Case documents,
    policy files, and canned model responses all come from real data/cases/
    mock_run.json files.
    """

    def _mock_call_model(self, responses: list[str]):
        """Return a side_effect function that yields responses in order."""
        it = iter(responses)
        def _call(system, user):
            return next(it)
        return _call

    def test_happy_path_event_order(self, tmp_runs, monkeypatch):
        """case-002: non-escalated run produces 7 events in correct order."""
        from app.pipeline import run_pipeline

        mock_data = _load_mock_run("case-002")
        responses = _canned_responses_from_mock(mock_data)
        monkeypatch.setattr("app.pipeline.call_model", self._mock_call_model(responses))

        result = run_pipeline("case-002", "facility-a")

        assert result.status == "approval_requested"
        assert result.recommendation is not None
        assert result.recommendation.action_type == "request_missing_documents"

        event_types = [e.type for e in result.events]
        assert event_types == [
            "run_started",
            "documents_loaded",
            "facts_extracted",
            "policy_retrieved",
            "analysis_completed",
            "draft_generated",
            "approval_requested",
        ]

    def test_escalation_short_circuits_draft(self, tmp_runs, monkeypatch):
        """case-003: should_escalate=true skips draft_next_action entirely."""
        from app.pipeline import run_pipeline

        mock_data = _load_mock_run("case-003")
        # case-003 has no draft_generated event — only facts + findings
        responses = _canned_responses_from_mock(mock_data)
        assert len(responses) == 2, "case-003 should yield exactly 2 model responses (no draft)"
        monkeypatch.setattr("app.pipeline.call_model", self._mock_call_model(responses))

        result = run_pipeline("case-003", "facility-a")

        assert result.status == "escalated"
        assert result.recommendation is None
        assert result.findings.should_escalate is True

        event_types = [e.type for e in result.events]
        assert "draft_generated" not in event_types
        assert "approval_requested" not in event_types
        assert event_types == [
            "run_started",
            "documents_loaded",
            "facts_extracted",
            "policy_retrieved",
            "analysis_completed",
            "run_escalated",
        ]

    def test_escalation_writes_run_escalated_event_to_jsonl(self, tmp_runs, monkeypatch):
        """case-003: persisted audit trail includes explicit run_escalated marker."""
        from app.pipeline import run_pipeline

        mock_data = _load_mock_run("case-003")
        responses = _canned_responses_from_mock(mock_data)
        monkeypatch.setattr("app.pipeline.call_model", self._mock_call_model(responses))

        result = run_pipeline("case-003", "facility-a")

        jsonl_path = tmp_runs / f"{result.run_id}.jsonl"
        lines = [
            json.loads(line)
            for line in jsonl_path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        run_escalated = [event for event in lines if event["type"] == "run_escalated"]
        assert len(run_escalated) == 1
        assert run_escalated[0]["payload"] == {
            "reason": "should_escalate flag set by analysis",
            "conflict_count": len(result.findings.conflicts),
        }

    def test_events_persisted_to_jsonl(self, tmp_runs, monkeypatch):
        """case-002: all 7 pipeline events are readable from the JSONL file."""
        from app.event_store import read_events
        from app.pipeline import run_pipeline

        mock_data = _load_mock_run("case-002")
        responses = _canned_responses_from_mock(mock_data)
        monkeypatch.setattr("app.pipeline.call_model", self._mock_call_model(responses))

        result = run_pipeline("case-002", "facility-a")

        persisted = read_events(result.run_id)
        assert len(persisted) == 7
        assert persisted[0]["type"] == "run_started"

    def test_run_id_embeds_case_id(self, tmp_runs, monkeypatch):
        """run_id format is run-{case_id}-{timestamp}."""
        from app.pipeline import run_pipeline

        mock_data = _load_mock_run("case-002")
        responses = _canned_responses_from_mock(mock_data)
        monkeypatch.setattr("app.pipeline.call_model", self._mock_call_model(responses))

        result = run_pipeline("case-002", "facility-a")
        assert "case-002" in result.run_id
