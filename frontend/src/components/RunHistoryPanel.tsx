import { useState } from "react";
import type { RunEvent } from "../types";
import { ApiError } from "../api";
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
  onReplay: () => Promise<void>;
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

const EVENT_DOT_COLOR: Record<string, string> = {
  run_started: "#6b7280",
  documents_loaded: "#2563eb",
  facts_extracted: "#2563eb",
  policy_retrieved: "#2563eb",
  analysis_completed: "#7c3aed",
  draft_generated: "#2563eb",
  approval_requested: "#d97706",
  approved: "#16a34a",
};

function formatDateTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }) + ", " + d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function formatElapsed(startTs: string, eventTs: string): string | null {
  try {
    const start = new Date(startTs).getTime();
    const event = new Date(eventTs).getTime();
    const diffMs = event - start;
    if (diffMs <= 0) return null;
    if (diffMs < 1000) return `+${diffMs}ms`;
    const secs = diffMs / 1000;
    if (secs < 60) return `+${secs.toFixed(1)}s`;
    const mins = Math.floor(secs / 60);
    const remainSecs = Math.round(secs % 60);
    return `+${mins}m ${remainSecs}s`;
  } catch {
    return null;
  }
}

function eventSummary(event: RunEvent): string | null {
  const p = event.payload;
  switch (event.type) {
    case "run_started":
      return `Case: ${p.case_id ?? ""}`;
    case "documents_loaded": {
      const docs = p.documents as { doc_id: string }[] | undefined;
      return docs ? `${docs.length} document(s) loaded` : null;
    }
    case "facts_extracted": {
      const facts = p.facts as { confidence?: number; payer?: string } | undefined;
      if (!facts) return null;
      const parts: string[] = [];
      if (facts.payer) parts.push(facts.payer);
      if (typeof facts.confidence === "number") parts.push(`${(facts.confidence * 100).toFixed(0)}% confidence`);
      return parts.length > 0 ? parts.join(" — ") : null;
    }
    case "policy_retrieved": {
      const sections = p.retrieved_policy_sections as string[] | undefined;
      return sections ? `${sections.length} policy section(s) retrieved` : null;
    }
    case "analysis_completed": {
      const findings = p.findings as { should_escalate?: boolean; missing_items?: string[]; conflicts?: string[] } | undefined;
      if (!findings) return null;
      if (findings.should_escalate) return "Escalated — compliance review required";
      const parts: string[] = [];
      if (findings.missing_items?.length) parts.push(`${findings.missing_items.length} missing`);
      if (findings.conflicts?.length) parts.push(`${findings.conflicts.length} conflict(s)`);
      return parts.length > 0 ? parts.join(", ") : "No gaps found";
    }
    case "draft_generated": {
      const rec = p.recommendation as { action_type?: string } | undefined;
      return rec?.action_type ? `Action: ${rec.action_type.replace(/_/g, " ")}` : null;
    }
    case "approved": {
      const finalRec = p.final_recommendation as { draft_text?: string } | undefined;
      if (finalRec?.draft_text) {
        const preview = finalRec.draft_text.length > 60
          ? finalRec.draft_text.slice(0, 57) + "…"
          : finalRec.draft_text;
        return `Final: "${preview}"`;
      }
      return "Final recommendation recorded";
    }
    default:
      return null;
  }
}

function formatEventType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function describeReplayError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Replay failed (${error.status}). Retry the replay request.`;
  }
  return error instanceof Error ? error.message : String(error);
}

export default function RunHistoryPanel({ events, isReplayResponse, onReplay }: Props) {
  const runStartTs = events.length > 0 ? events[0].timestamp : null;
  const [replaying, setReplaying] = useState(false);
  const [replayError, setReplayError] = useState<string | null>(null);
  const replayButtonLabel = replaying
    ? "Replaying…"
    : isReplayResponse
      ? "Refresh replay"
      : "Replay from JSONL";

  async function handleReplay() {
    setReplaying(true);
    setReplayError(null);
    try {
      await onReplay();
    } catch (error) {
      setReplayError(describeReplayError(error));
    } finally {
      setReplaying(false);
    }
  }

  return (
    <div>
      <WorkbenchSectionHeading
        title="Run History"
        description="Append-only audit trail of pipeline events."
        sticky
        badge={
          isReplayResponse ? (
            <WorkbenchStatusPill tone="warning">REPLAY</WorkbenchStatusPill>
          ) : null
        }
      />

      {events.length === 0 ? (
        <WorkbenchNotice>No events recorded for this run.</WorkbenchNotice>
      ) : (
        <div style={workbenchStyles.stack}>
          {events.map((event, i) => {
            const summary = eventSummary(event);
            const dotColor = EVENT_DOT_COLOR[event.type] ?? "#9ca3af";
            const elapsed = runStartTs && i > 0 ? formatElapsed(runStartTs, event.timestamp) : null;
            return (
              <div
                key={i}
                style={{
                  display: "grid",
                  gridTemplateColumns: "10px minmax(0, 1fr)",
                  gap: 12,
                  padding: "10px 0",
                  borderBottom:
                    i < events.length - 1 ? "1px solid #eef2f6" : "none",
                }}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: dotColor,
                    marginTop: 6,
                  }}
                />
                <div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#111827" }}>
                      {EVENT_LABELS[event.type] ?? formatEventType(event.type)}
                    </span>
                    {elapsed ? (
                      <span style={{ fontSize: 11, ...workbenchStyles.subtle }}>{elapsed}</span>
                    ) : null}
                  </div>
                  <div style={{ fontSize: 11, ...workbenchStyles.subtle, marginTop: 2 }}>
                    {formatDateTime(event.timestamp)}
                  </div>
                  {summary && (
                    <div style={{ fontSize: 12, ...workbenchStyles.subdued, marginTop: 4 }}>
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
            onClick={handleReplay}
            disabled={events.length === 0 || replaying}
            size="sm"
          >
            {replayButtonLabel}
          </WorkbenchButton>
        </WorkbenchActionBar>
        {replayError ? (
          <div style={{ marginTop: 10 }}>
            <WorkbenchNotice title="Replay did not complete" tone="danger">
              <div style={{ display: "grid", gap: 10 }}>
                <div>
                  The live run stays on screen. Retry replay if you still need a
                  read-only reconstruction from JSONL.
                </div>
                <div>{replayError}</div>
                <WorkbenchActionBar>
                  <WorkbenchButton onClick={handleReplay} size="sm" variant="secondary">
                    Retry replay
                  </WorkbenchButton>
                  <WorkbenchButton
                    onClick={() => setReplayError(null)}
                    size="sm"
                    variant="ghost"
                  >
                    Dismiss
                  </WorkbenchButton>
                </WorkbenchActionBar>
              </div>
            </WorkbenchNotice>
          </div>
        ) : null}
        {events.length > 0 ? (
          <div style={{ fontSize: 11, ...workbenchStyles.subtle, marginTop: 8 }}>
            Reconstruct run state from the persisted JSONL event log.
          </div>
        ) : null}
      </div>
    </div>
  );
}
