export interface EvidenceRef {
  doc_id: string;
  quote: string;
}

export interface CaseDocument {
  doc_id: string;
  type: "denial_letter" | "auth_request" | "clinical_notes";
  text: string;
}

export interface CaseFacts {
  payer: string;
  service_requested: string;
  denial_reason: string;
  required_documents: string[];
  confidence: number;
  evidence_refs: EvidenceRef[];
}

export interface CaseFindings {
  missing_items: string[];
  conflicts: string[];
  appeal_basis: string | null;
  should_escalate: boolean;
  evidence_refs: EvidenceRef[];
}

export interface Recommendation {
  action_type: string;
  rationale: string;
  draft_text: string;
}

export interface RunEvent {
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

export interface RunStatus {
  run_id: string;
  case_id: string;
  facility_id: string;
  status: "approval_requested" | "approved" | "escalated";
  documents: CaseDocument[];
  retrieved_policy_sections: string[];
  facts: CaseFacts | null;
  findings: CaseFindings | null;
  recommendation: Recommendation | null;
  approved_by: string | null;
  events: RunEvent[];
  is_replay_response: boolean;
}

export interface CaseListItem {
  case_id: string;
  facility_id: string;
  scenario_title: string;
  expected_path_type: "approval" | "missing_documents" | "escalation";
  summary: string;
}
