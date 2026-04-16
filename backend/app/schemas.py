from pydantic import BaseModel, Field
from typing import Any, Literal, Optional
from datetime import datetime


class EvidenceRef(BaseModel):
    doc_id: str
    quote: str


class CaseDocument(BaseModel):
    doc_id: str
    type: Literal["denial_letter", "auth_request", "clinical_notes"]
    text: str


class CaseFacts(BaseModel):
    payer: str
    service_requested: str
    denial_reason: str
    required_documents: list[str]
    confidence: float = Field(ge=0.0, le=1.0)
    evidence_refs: list[EvidenceRef]


class CaseFindings(BaseModel):
    missing_items: list[str]
    conflicts: list[str]
    appeal_basis: Optional[str] = None
    should_escalate: bool
    evidence_refs: list[EvidenceRef]


class Recommendation(BaseModel):
    action_type: str
    rationale: str
    draft_text: str


class CaseListItem(BaseModel):
    case_id: str
    facility_id: str
    scenario_title: str
    expected_path_type: Literal["approval", "missing_documents", "escalation"]
    summary: str


class RunCreateRequest(BaseModel):
    case_id: str


class ApproveRequest(BaseModel):
    draft_text: Optional[str] = None


class RunEvent(BaseModel):
    type: str
    timestamp: datetime
    payload: dict[str, Any]


class RunStatus(BaseModel):
    run_id: str
    case_id: str
    facility_id: str
    status: Literal["approval_requested", "approved", "escalated"]
    documents: list[CaseDocument] = Field(default_factory=list)
    retrieved_policy_sections: list[str] = Field(default_factory=list)
    facts: Optional[CaseFacts] = None
    findings: Optional[CaseFindings] = None
    recommendation: Optional[Recommendation] = None
    events: list[RunEvent] = Field(default_factory=list)
    is_replay_response: bool = False
