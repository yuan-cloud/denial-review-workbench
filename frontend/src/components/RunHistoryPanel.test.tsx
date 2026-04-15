import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import RunHistoryPanel from "./RunHistoryPanel";
import type { RunEvent } from "../types";

const sampleEvents: RunEvent[] = [
  { type: "run_started", timestamp: "2026-04-15T10:00:00Z", payload: { case_id: "case-001" } },
  { type: "documents_loaded", timestamp: "2026-04-15T10:00:01Z", payload: { documents: [{ doc_id: "d1" }] } },
  { type: "approved", timestamp: "2026-04-15T10:00:05Z", payload: {} },
];

describe("RunHistoryPanel", () => {
  it("shows empty message when no events", () => {
    render(
      <RunHistoryPanel events={[]} isReplayResponse={false} onReplay={() => {}} />
    );
    expect(screen.getByText(/No runs yet/)).toBeInTheDocument();
  });

  it("disables Replay button when no events", () => {
    render(
      <RunHistoryPanel events={[]} isReplayResponse={false} onReplay={() => {}} />
    );
    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
  });

  it("renders event labels", () => {
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={() => {}} />
    );
    expect(screen.getByText("Run Started")).toBeInTheDocument();
    expect(screen.getByText("Documents Loaded")).toBeInTheDocument();
    expect(screen.getByText("Approved")).toBeInTheDocument();
  });

  it("shows REPLAY badge when isReplayResponse is true", () => {
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={true} onReplay={() => {}} />
    );
    expect(screen.getByText("REPLAY")).toBeInTheDocument();
  });

  it("hides REPLAY badge when isReplayResponse is false", () => {
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={() => {}} />
    );
    expect(screen.queryByText("REPLAY")).not.toBeInTheDocument();
  });

  it("fires onReplay callback", async () => {
    const onReplay = vi.fn();
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={onReplay} />
    );
    await userEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalled();
  });

  it("renders event summaries", () => {
    render(
      <RunHistoryPanel events={sampleEvents} isReplayResponse={false} onReplay={() => {}} />
    );
    expect(screen.getByText("Case: case-001")).toBeInTheDocument();
    expect(screen.getByText("1 document(s)")).toBeInTheDocument();
  });
});
