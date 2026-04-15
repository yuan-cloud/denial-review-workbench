import type { RunEvent } from "../types";

interface Props {
  events: RunEvent[];
  isReplayResponse: boolean;
  onReplay: () => void;
}

const EVENT_LABELS: Record<string, string> = {
  run_started: "Run Started",
  documents_loaded: "Documents Loaded",
  facts_extracted: "Facts Extracted",
  policy_retrieved: "Policy Retrieved",
  analysis_completed: "Analysis Completed",
  draft_generated: "Draft Generated",
  approval_requested: "Approval Requested",
  approved: "Approved",
};

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function eventSummary(event: RunEvent): string | null {
  const p = event.payload;
  switch (event.type) {
    case "run_started":
      return `Case: ${p.case_id ?? ""}`;
    case "documents_loaded": {
      const docs = p.documents as { doc_id: string }[] | undefined;
      return docs ? `${docs.length} document(s)` : null;
    }
    case "facts_extracted":
      return p.facts ? `Confidence: ${((p.facts as { confidence?: number }).confidence ?? 0) * 100}%` : null;
    case "analysis_completed": {
      const findings = p.findings as { should_escalate?: boolean; missing_items?: string[] } | undefined;
      if (!findings) return null;
      if (findings.should_escalate) return "Escalated";
      return `${findings.missing_items?.length ?? 0} missing item(s)`;
    }
    case "draft_generated":
      return p.recommendation ? `Action: ${(p.recommendation as { action_type?: string }).action_type ?? ""}` : null;
    case "approved":
      return "Final recommendation recorded";
    default:
      return null;
  }
}

export default function RunHistoryPanel({ events, isReplayResponse, onReplay }: Props) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Run History</h2>
        {isReplayResponse && (
          <span
            style={{
              display: "inline-block",
              padding: "2px 10px",
              background: "#fef3c7",
              color: "#92400e",
              fontSize: 11,
              fontWeight: 700,
              borderRadius: 9999,
              letterSpacing: "0.05em",
            }}
          >
            REPLAY
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <p style={{ color: "#6b7280", fontSize: 14 }}>
          No runs yet. Click Run Review to start.
        </p>
      ) : (
        <div>
          {events.map((event, i) => {
            const summary = eventSummary(event);
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: 12,
                  paddingBottom: 12,
                  borderBottom: i < events.length - 1 ? "1px solid #f3f4f6" : "none",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: event.type === "approved" ? "#16a34a" : "#2563eb",
                    marginTop: 6,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
                    {EVENT_LABELS[event.type] ?? event.type}
                  </div>
                  <div style={{ fontSize: 12, color: "#9ca3af" }}>
                    {formatTimestamp(event.timestamp)}
                  </div>
                  {summary && (
                    <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
                      {summary}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={onReplay}
        disabled={events.length === 0}
        style={{
          marginTop: 12,
          padding: "6px 16px",
          background: events.length === 0 ? "#e5e7eb" : "#f3f4f6",
          color: events.length === 0 ? "#9ca3af" : "#374151",
          border: "1px solid #d1d5db",
          borderRadius: 4,
          cursor: events.length === 0 ? "not-allowed" : "pointer",
          fontSize: 13,
          fontWeight: 500,
        }}
      >
        Replay
      </button>
    </div>
  );
}
