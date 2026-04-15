import type { RunEvent } from "../types";
import {
  WorkbenchActionBar,
  WorkbenchButton,
  WorkbenchNotice,
  WorkbenchSectionHeading,
  WorkbenchStatusPill,
  workbenchStyles,
} from "../ui/workbench";

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
      <WorkbenchSectionHeading
        title="Run History"
        description="Append-only event timeline and replay control."
        sticky
        badge={
          isReplayResponse ? (
            <WorkbenchStatusPill tone="warning">REPLAY</WorkbenchStatusPill>
          ) : null
        }
      />

      {events.length === 0 ? (
        <WorkbenchNotice>No runs yet. Click Run Review to start.</WorkbenchNotice>
      ) : (
        <div style={workbenchStyles.stack}>
          {events.map((event, i) => {
            const summary = eventSummary(event);
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "10px minmax(0, 1fr)",
                  gap: 12,
                  padding: "12px 0",
                  borderBottom:
                    i < events.length - 1 ? "1px solid #eef2f6" : "none",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: event.type === "approved" ? "#16a34a" : "#2563eb",
                    marginTop: 6,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>
                    {EVENT_LABELS[event.type] ?? event.type}
                  </div>
                  <div style={{ fontSize: 12, ...workbenchStyles.subtle }}>
                    {formatTimestamp(event.timestamp)}
                  </div>
                  {summary && (
                    <div style={{ fontSize: 13, ...workbenchStyles.subdued, marginTop: 4 }}>
                      {summary}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={workbenchStyles.dividerTop}>
        <WorkbenchActionBar>
          <WorkbenchButton
            onClick={onReplay}
            disabled={events.length === 0}
            size="sm"
          >
            Replay
          </WorkbenchButton>
        </WorkbenchActionBar>
      </div>
    </div>
  );
}
