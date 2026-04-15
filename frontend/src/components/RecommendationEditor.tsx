import { useState } from "react";
import type { Recommendation, CaseFindings } from "../types";

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
        <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Recommendation</h2>
        <div
          style={{
            padding: 16,
            background: "#fef2f2",
            border: "2px solid #fecaca",
            borderRadius: 8,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 700, color: "#b91c1c", marginBottom: 8 }}>
            Escalated to Compliance Review
          </div>
          <p style={{ color: "#991b1b", margin: 0, fontSize: 14 }}>
            Conflicting denial reasons detected. This case requires manual compliance review
            before any appeal action can be taken.
          </p>
        </div>
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
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Recommendation</h2>

      <div
        style={{
          padding: 10,
          marginBottom: 12,
          border: "1px solid #e5e7eb",
          borderRadius: 6,
          background: "#fff",
        }}
      >
        <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, marginBottom: 4 }}>
          Action Type
        </div>
        <div style={{ fontSize: 14 }}>{recommendation.action_type}</div>
      </div>

      <div
        style={{
          padding: 10,
          marginBottom: 12,
          border: "1px solid #e5e7eb",
          borderRadius: 6,
          background: "#fff",
        }}
      >
        <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, marginBottom: 4 }}>
          Rationale
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{recommendation.rationale}</div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, marginBottom: 4 }}>
          Draft Text {isApproved && <span style={{ color: "#16a34a" }}>(final)</span>}
        </div>
        <textarea
          value={isApproved ? recommendation.draft_text : draftText}
          onChange={(e) => setDraftText(e.target.value)}
          disabled={isApproved}
          rows={4}
          style={{
            width: "100%",
            padding: 10,
            border: "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: 14,
            lineHeight: 1.5,
            resize: "vertical",
            fontFamily: "inherit",
            background: isApproved ? "#f3f4f6" : "#fff",
            boxSizing: "border-box",
          }}
        />
      </div>

      {isApproved ? (
        <div
          style={{
            display: "inline-block",
            padding: "8px 20px",
            background: "#dcfce7",
            color: "#15803d",
            fontWeight: 600,
            borderRadius: 6,
            fontSize: 14,
          }}
        >
          Approved ✓
        </div>
      ) : (
        <button
          onClick={handleApprove}
          disabled={approving}
          style={{
            padding: "8px 20px",
            background: approving ? "#9ca3af" : "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: approving ? "not-allowed" : "pointer",
          }}
        >
          {approving ? "Approving..." : "Approve"}
        </button>
      )}
    </div>
  );
}
