import { useEffect, useState } from "react";
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

  // Sync draft text when the upstream recommendation changes (e.g. after replay).
  useEffect(() => {
    if (recommendation?.draft_text) {
      setDraftText(recommendation.draft_text);
    }
  }, [recommendation?.draft_text]);

  // Escalation — primary signal is the above-the-fold banner in RunPage;
  // here we just confirm the blocked state within the recommendation section.
  if (findings?.should_escalate) {
    return (
      <div style={{ marginBottom: 20 }}>
        <WorkbenchSectionHeading
          title="Recommendation"
          description="No action available — case is escalated."
        />
        <WorkbenchNotice tone="danger">
          Approval controls are disabled for escalated cases.
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
        description={
          isApproved
            ? "Approved — this is the signed final recommendation."
            : "Review, edit, and finalize the drafted next action."
        }
      />

      <WorkbenchField label="Action Type" style={{ marginBottom: 12 }}>
        {recommendation.action_type}
      </WorkbenchField>

      <WorkbenchField label="Rationale" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{recommendation.rationale}</div>
      </WorkbenchField>

      {isApproved ? (
        <WorkbenchField label="Final Text" tone="success" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 14, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {recommendation.draft_text}
          </div>
        </WorkbenchField>
      ) : (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...workbenchStyles.label, marginBottom: 6 }}>Draft Text</div>
          <textarea
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
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
              background: "#fff",
              boxSizing: "border-box",
            }}
          />
        </div>
      )}

      <WorkbenchActionBar>
        {isApproved ? (
          <WorkbenchStatusPill tone="success">Approved ✓</WorkbenchStatusPill>
        ) : (
          <WorkbenchButton
            onClick={handleApprove}
            disabled={approving}
            variant="primary"
          >
            {approving ? "Approving…" : "Approve"}
          </WorkbenchButton>
        )}
      </WorkbenchActionBar>
    </div>
  );
}
