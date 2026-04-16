import { useEffect, useState } from "react";
import type { Recommendation, CaseFindings } from "../types";
import { ApiError } from "../api";
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
  onApprove: (draftText: string) => Promise<void>;
  onRefresh?: () => void;
}

function describeApprovalError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Approval request failed (${error.status}). Reload the run and try again.`;
  }
  return error instanceof Error ? error.message : String(error);
}

export default function RecommendationEditor({
  recommendation,
  findings,
  status,
  onApprove,
  onRefresh,
}: Props) {
  const [draftText, setDraftText] = useState(recommendation?.draft_text ?? "");
  const [approving, setApproving] = useState(false);
  const [approvalError, setApprovalError] = useState<string | null>(null);

  // Sync draft text when the upstream recommendation changes (e.g. after replay).
  useEffect(() => {
    if (recommendation?.draft_text) {
      setDraftText(recommendation.draft_text);
    }
    setApprovalError(null);
  }, [recommendation?.draft_text, status]);

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

  if (!recommendation) {
    return (
      <div style={{ marginBottom: 20 }}>
        <WorkbenchSectionHeading
          title="Recommendation"
          description="No recommendation has been generated yet."
        />
        <WorkbenchNotice tone="neutral">
          The recommendation will appear here after draft generation completes.
        </WorkbenchNotice>
      </div>
    );
  }

  async function handleApprove() {
    setApproving(true);
    setApprovalError(null);
    try {
      await onApprove(draftText);
    } catch (error) {
      setApprovalError(describeApprovalError(error));
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
            onChange={(e) => {
              setDraftText(e.target.value);
              setApprovalError(null);
            }}
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

      {approvalError && !isApproved ? (
        <WorkbenchNotice title="Approval did not complete" tone="danger">
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              The drafted text is still in place. Reload the run if server state may
              have changed, or adjust the draft and approve again.
            </div>
            <div>{approvalError}</div>
            <WorkbenchActionBar>
              {onRefresh ? (
                <WorkbenchButton onClick={onRefresh} size="sm" variant="secondary">
                  Reload run
                </WorkbenchButton>
              ) : null}
              <WorkbenchButton
                onClick={() => setApprovalError(null)}
                size="sm"
                variant="ghost"
              >
                Dismiss
              </WorkbenchButton>
            </WorkbenchActionBar>
          </div>
        </WorkbenchNotice>
      ) : null}

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
