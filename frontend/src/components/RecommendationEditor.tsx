import { useState } from "react";
import type { Recommendation, CaseFindings } from "../types";
import {
  WorkbenchActionBar,
  WorkbenchButton,
  WorkbenchField,
  WorkbenchNotice,
  WorkbenchSectionHeading,
  WorkbenchStatusPill,
  workbenchStyles,
} from "../ui/workbench";

interface Props {
  recommendation: Recommendation | null;
  findings: CaseFindings | null;
  status: "approval_requested" | "approved" | "escalated";
  onApprove: (draftText: string) => void;
}

export default function RecommendationEditor({
  recommendation,
  findings,
  status,
  onApprove,
}: Props) {
  const [draftText, setDraftText] = useState(recommendation?.draft_text ?? "");
  const [approving, setApproving] = useState(false);

  // Sync draft text when recommendation changes (e.g. after replay)
  if (recommendation && draftText === "" && recommendation.draft_text) {
    setDraftText(recommendation.draft_text);
  }

  // Escalation notice — no draft, no approve
  if (findings?.should_escalate) {
    return (
      <div style={{ marginBottom: 20 }}>
        <WorkbenchSectionHeading
          title="Recommendation"
          description="Human review and final action state."
        />
        <WorkbenchNotice title="Escalated to Compliance Review" tone="danger">
          <p style={{ margin: 0, fontSize: 14 }}>
            Conflicting denial reasons detected. This case requires manual compliance review
            before any appeal action can be taken.
          </p>
        </WorkbenchNotice>
      </div>
    );
  }

  if (!recommendation) return null;

  async function handleApprove() {
    setApproving(true);
    try {
      await onApprove(draftText);
    } finally {
      setApproving(false);
    }
  }

  const isApproved = status === "approved";

  return (
    <div style={{ marginBottom: 20 }}>
      <WorkbenchSectionHeading
        title="Recommendation"
        description="Review, edit, and finalize the drafted next action."
      />

      <WorkbenchField label="Action Type" style={{ marginBottom: 12 }}>
        {recommendation.action_type}
      </WorkbenchField>

      <WorkbenchField label="Rationale" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{recommendation.rationale}</div>
      </WorkbenchField>

      <div style={{ marginBottom: 12 }}>
        <div style={{ ...workbenchStyles.label, marginBottom: 6 }}>
          Draft Text {isApproved ? <span style={{ color: "#16a34a" }}>(final)</span> : null}
        </div>
        <textarea
          value={isApproved ? recommendation.draft_text : draftText}
          onChange={(e) => setDraftText(e.target.value)}
          disabled={isApproved}
          rows={4}
          style={{
            width: "100%",
            padding: 10,
            border: "1px solid #d6dde6",
            borderRadius: 10,
            fontSize: 14,
            lineHeight: 1.5,
            resize: "vertical",
            fontFamily: "inherit",
            background: isApproved ? "#f8fafc" : "#fff",
            boxSizing: "border-box",
          }}
        />
      </div>

      <WorkbenchActionBar>
        {isApproved ? (
          <WorkbenchStatusPill tone="success">Approved ✓</WorkbenchStatusPill>
        ) : (
          <WorkbenchButton
            onClick={handleApprove}
            disabled={approving}
            variant="primary"
          >
            {approving ? "Approving..." : "Approve"}
          </WorkbenchButton>
        )}
      </WorkbenchActionBar>
    </div>
  );
}
