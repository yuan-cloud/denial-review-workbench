import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import RunHistoryPanel from "./RunHistoryPanel";
import type { RunEvent } from "../types";

const sampleEvents: RunEvent[] = [
  { type: "run_started", timestamp: "2026-04-15T10:00:00Z", payload: { case_id: "case-001" } },
  { type: "documents_loaded", timestamp: "2026-04-15T10:00:01Z", payload: { documents: [{ doc_id: "d1" }] } },
  { type: "facts_extracted", timestamp: "2026-04-15T10:00:03Z", payload: { facts: { confidence: 0.85, payer: "Acme" } } },
  { type: "approved", timestamp: "2026-04-15T10:00:05Z", payload: {} },
];

describe("RunHistoryPanel", () => {
  it("shows empty message when no events", () => {
    render(
      <RunHistoryPanel events={[]} isReplayResponse={false} onReplay={async () => {}} />
    );
    expect(screen.getByText(/No events recorded/)).toBeInTheDocument();
  });

  it("disables Replay button when no events", () => {
    render(
      <RunHistoryPanel events={[]} isReplayResponse={false} onReplay={async () => {}} />
    );
    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
  });

  it("renders event labels", () => {
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={async () => {}} />
    );
    expect(screen.getByText("Run Started")).toBeInTheDocument();
    expect(screen.getByText("Documents Loaded")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("shows REPLAY badge when isReplayResponse is true", () => {
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={true} onReplay={async () => {}} />
    );
    expect(screen.getByText("REPLAY")).toBeInTheDocument();
  });

  it("hides REPLAY badge when isReplayResponse is false", () => {
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={async () => {}} />
    );
    expect(screen.queryByText("REPLAY")).not.toBeInTheDocument();
  });

  it("fires onReplay callback", async () => {
    const onReplay = vi.fn().mockResolvedValue(undefined);
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={onReplay} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalled();
  });

  it("renders event summaries with richer detail", () => {
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={async () => {}} />
    );
    expect(screen.getByText("Case: case-001")).toBeInTheDocument();
    expect(screen.getByText("1 document(s) loaded")).toBeInTheDocument();
    expect(screen.getByText(/Acme/)).toBeInTheDocument();
    expect(screen.getByText(/85% confidence/)).toBeInTheDocument();
  });

  it("shows elapsed time from run start", () => {
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={async () => {}} />
    );
    // documents_loaded at +1s, facts_extracted at +3s, approved at +5s
    expect(screen.getByText("+1.0s")).toBeInTheDocument();
    expect(screen.getByText("+3.0s")).toBeInTheDocument();
    expect(screen.getByText("+5.0s")).toBeInTheDocument();
  });

  it("shows full date-time for each event", () => {
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={async () => {}} />
    );
    // Should show date (Apr 15) somewhere, not just time
    expect(screen.getAllByText(/Apr 15/).length).toBeGreaterThan(0);
  });

  it("shows replay description when events are present", () => {
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={async () => {}} />
    );
    expect(screen.getByText(/Reconstruct run state/)).toBeInTheDocument();
  });

  it("formats unknown event types gracefully", () => {
    const unknownEvents: RunEvent[] = [
      { type: "custom_step", timestamp: "2026-04-15T10:00:00Z", payload: {} },
    ];
    render(
      <RunHistoryPanel events={unknownEvents} isReplayResponse={false} onReplay={async () => {}} />
    );
    expect(screen.getByText("Custom Step")).toBeInTheDocument();
  });

  it("renders escalation summary for analysis_completed with should_escalate", () => {
    const escalationEvents: RunEvent[] = [
      { type: "run_started", timestamp: "2026-04-15T10:00:00Z", payload: { case_id: "case-003" } },
      {
        type: "analysis_completed",
        timestamp: "2026-04-15T10:00:02Z",
        payload: { findings: { should_escalate: true, missing_items: [], conflicts: ["reason mismatch"] } },
      },
    ];
    render(
      <RunHistoryPanel events={escalationEvents} isReplayResponse={false} onReplay={async () => {}} />
    );
    expect(screen.getByText(/Escalated/)).toBeInTheDocument();
    expect(screen.getByText(/compliance review/)).toBeInTheDocument();
  });

  it("shows inline replay error with retry and dismiss actions", async () => {
    const onReplay = vi
      .fn()
      .mockRejectedValueOnce(new Error("Replay unavailable"))
      .mockResolvedValueOnce(undefined);

    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={onReplay} />
    );

    await userEvent.click(screen.getByRole("button", { name: "Replay" }));

    expect(screen.getByText("Replay did not complete")).toBeInTheDocument();
    expect(screen.getByText(/live run stays on screen/i)).toBeInTheDocument();
    expect(screen.getByText("Replay unavailable")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry replay" }));
    expect(onReplay).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Replay did not complete")).not.toBeInTheDocument();
  });
});
