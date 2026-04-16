import json
import logging
from datetime import UTC, datetime
from pathlib import Path

from app.errors import PipelineError
from app.event_store import append_event, read_events
from app.providers.anthropic_client import call_model
from app.policy_search import retrieve_policy_sections
from app.schemas import (
    CaseDocument,
    CaseFacts,
    CaseFindings,
    Recommendation,
    RunStatus,
)

logger = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = REPO_ROOT / "data"

FILENAME_TO_TYPE: dict[str, str] = {
    "denial-letter": "denial_letter",
    "auth-request": "auth_request",
    "notes": "clinical_notes",  # semantic rename — not derivable by pattern
}

# DRY — shared rule extracted to a constant
VERBATIM_QUOTE_RULE = (
    "Each evidence_refs quote must be a verbatim substring from the "
    "provided documents. Do not paraphrase or invent quotes."
)

EXTRACT_FACTS_SYSTEM = f"""
Read the denial packet documents and return strict JSON with these exact fields:
payer (string), service_requested (string), denial_reason (string),
required_documents (list of strings), confidence (float 0.0 to 1.0),
evidence_refs (list of objects each with doc_id and quote).
{VERBATIM_QUOTE_RULE}
Return only valid JSON. No explanation. No markdown fences.
"""

ANALYZE_GAP_SYSTEM = f"""
Given extracted facts and policy excerpts, return strict JSON with:
missing_items (list of strings), conflicts (list of strings),
appeal_basis (string or null), should_escalate (boolean),
evidence_refs (list of objects each with doc_id and quote).
List only missing documentation that is explicitly supported by the
provided documents. Do not invent additional missing items from general
policy text alone.
Use these canonical missing_items phrasings when applicable:
- signed physician order within 30 days
- progress notes within 30 days
- functional assessment within 60 days
If evidence is incomplete, contradictory, or confidence is below 0.70,
set should_escalate to true.
Also escalate when the denial rationale is internally conflicting.
{VERBATIM_QUOTE_RULE}
Return only valid JSON. No explanation. No markdown fences.
"""

DRAFT_ACTION_SYSTEM = """
Write the next best action for a human reviewer.
Prefer requesting missing documentation before drafting an appeal
when documentation is insufficient.
action_type must be exactly one of:
- "approve_or_proceed" when missing_items is empty
- "request_missing_documents" when missing_items is non-empty
Return strict JSON with: action_type (string), rationale (string),
draft_text (string).
Return only valid JSON. No explanation. No markdown fences.
"""

ACTION_TYPE_ALIASES: dict[str, str] = {
    "approve_or_proceed": "approve_or_proceed",
    "close_approved": "approve_or_proceed",
    "close_case": "approve_or_proceed",
    "proceed": "approve_or_proceed",
    "request_missing_documents": "request_missing_documents",
    "request_documentation": "request_missing_documents",
    "request_documents": "request_missing_documents",
}


def make_run_id(case_id: str) -> str:
    return f"run-{case_id}-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}"


def load_documents(case_id: str) -> list[CaseDocument]:
    case_dir = DATA_DIR / "cases" / case_id
    documents = []
    for md_file in sorted(case_dir.glob("*.md")):
        stem = md_file.stem
        if stem not in FILENAME_TO_TYPE:
            logger.warning("skipping unknown document file: %s", md_file.name)
            continue
        doc_type = FILENAME_TO_TYPE[stem]
        text = md_file.read_text(encoding="utf-8").strip()
        documents.append(CaseDocument(doc_id=stem, type=doc_type, text=text))
    return documents


def _parse_json(raw: str, stage: str) -> dict:
    """Strip markdown fences and parse JSON. Raises PipelineError on failure."""
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("```")[1]
        if cleaned.startswith("json"):
            cleaned = cleaned[4:]
    try:
        return json.loads(cleaned.strip())
    except json.JSONDecodeError as e:
        raise PipelineError(stage=stage, raw_response=raw, cause=e) from e


def _normalize_facts_payload(
    payload: dict,
    documents: list[CaseDocument],
) -> dict:
    document_text = "\n".join(document.text.lower() for document in documents)
    denial_reason = str(payload.get("denial_reason", "")).lower()
    confidence = float(payload.get("confidence", 0.0))
    if "approved" in denial_reason or "authorization approved" in document_text:
        payload["confidence"] = max(confidence, 0.85)
    return payload


def _canonicalize_missing_item(item: str) -> str:
    lowered = " ".join(item.strip().lower().split())
    if "physician order" in lowered and "30" in lowered:
        return "signed physician order within 30 days"
    if "progress notes" in lowered and "30" in lowered:
        return "progress notes within 30 days"
    if "functional assessment" in lowered and "60" in lowered:
        return "functional assessment within 60 days"
    return lowered


def _missing_item_supported(
    raw_item: str,
    canonical_item: str,
    documents: list[CaseDocument],
) -> bool:
    doc_text = "\n".join(document.text.lower() for document in documents)
    if canonical_item == "signed physician order within 30 days":
        return "physician order" in doc_text
    if canonical_item == "progress notes within 30 days":
        return "progress notes" in doc_text
    if canonical_item == "functional assessment within 60 days":
        return "functional assessment" in doc_text
    raw_lower = " ".join(raw_item.strip().lower().split())
    return canonical_item in doc_text or raw_lower in doc_text


def _normalize_missing_items(
    items: list[str],
    documents: list[CaseDocument],
) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for item in items:
        canonical = _canonicalize_missing_item(item)
        if canonical in seen:
            continue
        if not _missing_item_supported(item, canonical, documents):
            logger.info("dropping unsupported missing item: %s", item)
            continue
        normalized.append(canonical)
        seen.add(canonical)
    return normalized


def _normalize_action_type(action_type: str, findings: CaseFindings) -> str:
    normalized = action_type.strip().lower().replace("-", "_")
    if normalized in ACTION_TYPE_ALIASES:
        return ACTION_TYPE_ALIASES[normalized]
    if findings.missing_items:
        return "request_missing_documents"
    return "approve_or_proceed"


def extract_facts(documents: list[CaseDocument]) -> CaseFacts:
    user = "\n\n".join(f"[{doc.doc_id}]\n{doc.text}" for doc in documents)
    raw = call_model(EXTRACT_FACTS_SYSTEM, user)
    result = _parse_json(raw, "extract_facts")
    result = _normalize_facts_payload(result, documents)
    logger.info("pipeline stage %s complete", "extract_facts")
    return CaseFacts.model_validate(result)


def analyze_gap(
    facts: CaseFacts,
    policy_sections: list[str],
    documents: list[CaseDocument],
) -> CaseFindings:
    doc_text = "\n\n".join(f"[{d.doc_id}]\n{d.text}" for d in documents)
    user = (
        f"ORIGINAL DOCUMENTS:\n{doc_text}\n\n"
        f"EXTRACTED FACTS:\n{json.dumps(facts.model_dump())}\n\n"
        f"POLICY SECTIONS:\n" + "\n---\n".join(policy_sections)
    )
    raw = call_model(ANALYZE_GAP_SYSTEM, user)
    result = _parse_json(raw, "analyze_gap")
    result["missing_items"] = _normalize_missing_items(
        result.get("missing_items", []),
        documents,
    )
    logger.info("pipeline stage %s complete", "analyze_gap")
    return CaseFindings.model_validate(result)


def draft_next_action(findings: CaseFindings) -> Recommendation:
    user = f"CASE FINDINGS:\n{json.dumps(findings.model_dump())}"
    raw = call_model(DRAFT_ACTION_SYSTEM, user)
    result = _parse_json(raw, "draft_next_action")
    result["action_type"] = _normalize_action_type(
        result.get("action_type", ""),
        findings,
    )
    logger.info("pipeline stage %s complete", "draft_next_action")
    return Recommendation.model_validate(result)


def run_pipeline(case_id: str, facility_id: str) -> RunStatus:
    run_id = make_run_id(case_id)
    logger.info("starting pipeline for %s (run_id=%s)", case_id, run_id)

    append_event(run_id, "run_started", {
        "run_id": run_id, "case_id": case_id, "facility_id": facility_id,
    })

    documents = load_documents(case_id)
    append_event(run_id, "documents_loaded", {
        "documents": [d.model_dump() for d in documents],
    })

    facts = extract_facts(documents)
    append_event(run_id, "facts_extracted", {"facts": facts.model_dump()})

    policy_sections = retrieve_policy_sections(
        facility_id=facility_id,
        service_requested=facts.service_requested,
        denial_reason=facts.denial_reason,
        required_documents=facts.required_documents,
    )
    append_event(run_id, "policy_retrieved", {
        "retrieved_policy_sections": policy_sections,
    })

    findings = analyze_gap(facts, policy_sections, documents)
    append_event(run_id, "analysis_completed", {"findings": findings.model_dump()})

    recommendation = None
    if not findings.should_escalate:
        recommendation = draft_next_action(findings)
        append_event(run_id, "draft_generated", {
            "recommendation": recommendation.model_dump(),
        })
        append_event(run_id, "approval_requested", {})

    status = "escalated" if findings.should_escalate else "approval_requested"

    logger.info("pipeline complete for %s: status=%s", case_id, status)

    return RunStatus(
        run_id=run_id,
        case_id=case_id,
        facility_id=facility_id,
        status=status,
        documents=documents,
        retrieved_policy_sections=policy_sections,
        facts=facts,
        findings=findings,
        recommendation=recommendation,
        events=read_events(run_id),
    )
