import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RunPage from "./RunPage";
import type { RunStatus } from "../types";

const mockFetch = vi.fn();
const mockScrollIntoView = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function okResponse(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function errorResponse(status: number, detail?: string) {
  return {
    ok: false,
    status,
    json: () => Promise.resolve(detail ? { detail } : {}),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushAsyncCallbacks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const baseRun: RunStatus = {
  run_id: "run-1",
  case_id: "case-001",
  facility_id: "fac-1",
  status: "approval_requested",
  documents: [
    { doc_id: "denial-letter", type: "denial_letter", text: "Denied for PT." },
  ],
  retrieved_policy_sections: ["## Coverage\nPT requires auth."],
  facts: {
    payer: "Acme",
    service_requested: "PT",
    denial_reason: "not medically necessary",
    required_documents: ["physician order"],
    confidence: 0.85,
    evidence_refs: [],
  },
  findings: {
    missing_items: [],
    conflicts: [],
    appeal_basis: null,
    should_escalate: false,
    evidence_refs: [],
  },
  recommendation: {
    action_type: "approve_or_proceed",
    rationale: "All clear",
    draft_text: "Approve this.",
  },
  approved_by: null,
  events: [
    { type: "run_started", timestamp: "2026-04-15T10:00:00Z", payload: { case_id: "case-001" } },
  ],
  is_replay_response: false,
};

beforeEach(() => {
  mockFetch.mockReset();
  mockScrollIntoView.mockReset();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: mockScrollIntoView,
  });
});

describe("RunPage", () => {
  it("fetches and renders run data", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      // Header shows case and run info (use getAllByText since event summary also contains "Case: case-001")
      expect(screen.getAllByText(/Case:.*case-001/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Run:.*run-1/)).toBeInTheDocument();
      expect(screen.getByText("Acme")).toBeInTheDocument();
      expect(screen.getAllByText("85%").length).toBeGreaterThanOrEqual(1);
    });

    const summary = screen.getByRole("region", { name: "Run summary" });
    expect(summary).toHaveTextContent("Review state");
    expect(summary).toHaveTextContent("Facility pack");
    expect(summary).toHaveTextContent("fac-1");
    expect(summary).toHaveTextContent("1 document • 1 policy section");
    expect(summary).toHaveTextContent("High confidence");
    expect(summary).toHaveTextContent("0 missing items");
    expect(summary).toHaveTextContent("Started");
    expect(summary).toHaveTextContent("Last event");
  });

  it("shows loading state before fetch completes", async () => {
    // Never resolve — keeps component in loading state
    mockFetch.mockReturnValueOnce(new Promise(() => {}));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    expect(screen.getByText("Loading run")).toBeInTheDocument();
    expect(
      screen.getByText(/Fetching documents, analysis, and audit history/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Click Run Review to start.")).not.toBeInTheDocument();
  });

  it("shows fetch error with retry button on non-404 failure", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Unable to load run")).toBeInTheDocument();
      expect(screen.getByText(/The workspace could not load/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry fetch" })).toBeInTheDocument();
    });
  });

  it("shows not-found error on 404", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(404, "No persisted event log exists for this run")
    );
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Run not found")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry fetch" })).toBeInTheDocument();
      expect(screen.getByText(/No persisted event log exists/)).toBeInTheDocument();
    });
  });

  it("retry re-fetches and renders on success", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Retry fetch" })).toBeInTheDocument();
    });

    // Retry succeeds
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    await userEvent.click(screen.getByRole("button", { name: "Retry fetch" }));

    await waitFor(() => {
      expect(screen.getByText("Acme")).toBeInTheDocument();
    });
  });

  it("aborts and ignores a stale fetch when the run changes", async () => {
    const first = deferred<ReturnType<typeof okResponse>>();
    const second = deferred<ReturnType<typeof okResponse>>();
    mockFetch
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    const { rerender } = render(
      <RunPage caseId="case-001" runId="run-1" onBack={() => {}} />
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const firstSignal = mockFetch.mock.calls[0][1].signal as AbortSignal;

    rerender(<RunPage caseId="case-002" runId="run-2" onBack={() => {}} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
    expect(firstSignal.aborted).toBe(true);

    const newestRun = {
      ...baseRun,
      run_id: "run-2",
      case_id: "case-002",
      facts: { ...baseRun.facts!, payer: "Newest payer" },
    };
    second.resolve(okResponse(newestRun));
    await waitFor(() => {
      expect(screen.getByText("Newest payer")).toBeInTheDocument();
    });

    first.resolve(okResponse(baseRun));
    await waitFor(() => {
      expect(screen.getByText("Newest payer")).toBeInTheDocument();
      expect(screen.queryByText("Acme")).not.toBeInTheDocument();
    });
  });

  it("ignores stale fetch rejection and cleanup while the next run loads", async () => {
    const first = deferred<ReturnType<typeof errorResponse>>();
    const second = deferred<ReturnType<typeof okResponse>>();
    mockFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const { rerender } = render(
      <RunPage caseId="case-001" runId="run-1" onBack={() => {}} />
    );
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

    rerender(<RunPage caseId="case-002" runId="run-2" onBack={() => {}} />);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

    await act(async () => {
      first.resolve(errorResponse(500, "stale fetch failure"));
      await flushAsyncCallbacks();
    });
    expect(screen.getByText("Loading run")).toBeInTheDocument();
    expect(screen.queryByText(/stale fetch failure/)).not.toBeInTheDocument();

    second.resolve(
      okResponse({
        ...baseRun,
        run_id: "run-2",
        case_id: "case-002",
        facts: { ...baseRun.facts!, payer: "Newest payer" },
      })
    );
    await waitFor(() => expect(screen.getByText("Newest payer")).toBeInTheDocument());
  });

  it("calls onBack when Back button clicked", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    const onBack = vi.fn();
    render(<RunPage caseId="case-001" runId="run-1" onBack={onBack} />);

    await waitFor(() => {
      expect(screen.getByText("Case: case-001")).toBeInTheDocument();
    });

    // There are two back buttons, use the first one in the header
    const backButtons = screen.getAllByRole("button", { name: /back/i });
    await userEvent.click(backButtons[0]);
    expect(onBack).toHaveBeenCalled();
  });

  it("renders a skip link that moves focus into the review workspace", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Documents")).toBeInTheDocument();
    });

    await user.tab();
    const skipLink = screen.getByRole("link", { name: "Skip to review workspace" });
    expect(skipLink).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(document.getElementById("run-workspace-grid")).toHaveFocus();
  });

  it("renders three-column layout with all panels", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      // Left panel — documents
      expect(screen.getByText("Documents")).toBeInTheDocument();
      // Center panel — facts
      expect(screen.getByText("Extracted Facts")).toBeInTheDocument();
      // Right panel — history
      expect(screen.getByText("Run History")).toBeInTheDocument();
    });

    expect(screen.getByTestId("run-workspace-grid")).toHaveStyle({
      gridTemplateColumns:
        "minmax(360px, 1.35fr) minmax(320px, 1.05fr) minmax(280px, 0.9fr)",
    });
  });

  it("handles approve flow", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    });

    // Mock the approve response
    const approvedRun = { ...baseRun, status: "approved" as const };
    mockFetch.mockResolvedValueOnce(okResponse(approvedRun));

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByText("Approved ✓")).toBeInTheDocument();
    });
  });

  it("moves focus to the review state summary and announces approval", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    });

    const approvedRun = {
      ...baseRun,
      status: "approved" as const,
      recommendation: {
        ...baseRun.recommendation!,
        draft_text: "Approved after review.",
      },
    };
    mockFetch.mockResolvedValueOnce(okResponse(approvedRun));

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByText("Approved ✓")).toBeInTheDocument();
      expect(screen.getByTestId("review-state-summary")).toHaveFocus();
      expect(screen.getByTestId("run-live-region")).toHaveTextContent(
        /Run approved\. Final recommendation is now locked\./
      );
    });
  });

  it("shows inline mutation error on approve failure without losing run data", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    });

    // Approve fails with 409
    mockFetch.mockResolvedValueOnce(errorResponse(409, "Already approved"));

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      // Mutation error shown inline
      expect(screen.getByText("Approval did not complete")).toBeInTheDocument();
      expect(
        screen.getByText(/The drafted text is still in place/)
      ).toBeInTheDocument();
      expect(screen.getByText(/Already approved/)).toBeInTheDocument();
      // Run data still visible — not wiped
      expect(screen.getByText("Acme")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Reload run" })).toBeInTheDocument();
      // Dismiss button present
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    });
  });

  it("reuses the approval idempotency key after an unknown failure", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(
      errorResponse(503, "Approval durability is unknown")
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(screen.getByText("Approval did not complete")).toBeInTheDocument();
    });

    const approvedRun = { ...baseRun, status: "approved" as const };
    mockFetch.mockResolvedValueOnce(okResponse(approvedRun));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => {
      expect(screen.getByText("Approved ✓")).toBeInTheDocument();
    });

    const firstHeaders = mockFetch.mock.calls[1][1].headers;
    const retryHeaders = mockFetch.mock.calls[2][1].headers;
    expect(firstHeaders["Idempotency-Key"]).toBeTruthy();
    expect(retryHeaders["Idempotency-Key"]).toBe(
      firstHeaders["Idempotency-Key"]
    );
  });

  it("ignores a stale approval success without cancelling the submitted action", async () => {
    const staleApproval = deferred<ReturnType<typeof okResponse>>();
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    const renderResult = render(
      <RunPage caseId="case-001" runId="run-1" onBack={() => {}} />
    );
    await screen.findByRole("button", { name: "Approve" });

    mockFetch.mockReturnValueOnce(staleApproval.promise);
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(mockFetch.mock.calls[1][1].signal).toBeUndefined();

    const newestRun = {
      ...baseRun,
      run_id: "run-2",
      case_id: "case-002",
      facts: { ...baseRun.facts!, payer: "Newest payer" },
    };
    mockFetch.mockResolvedValueOnce(okResponse(newestRun));
    renderResult.rerender(
      <RunPage caseId="case-002" runId="run-2" onBack={() => {}} />
    );
    await screen.findByText("Newest payer");

    await act(async () => {
      staleApproval.resolve(
        okResponse({ ...baseRun, status: "approved" as const })
      );
      await flushAsyncCallbacks();
    });
    expect(screen.getByText("Newest payer")).toBeInTheDocument();
    expect(screen.queryByText("Approved ✓")).not.toBeInTheDocument();
  });

  it("isolates stale approval failure and cleanup from a newer retry", async () => {
    const staleApproval = deferred<ReturnType<typeof errorResponse>>();
    const currentApproval = deferred<ReturnType<typeof errorResponse>>();
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    const { rerender } = render(
      <RunPage caseId="case-001" runId="run-1" onBack={() => {}} />
    );
    await screen.findByRole("button", { name: "Approve" });

    mockFetch.mockReturnValueOnce(staleApproval.promise);
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    const staleKey = mockFetch.mock.calls[1][1].headers["Idempotency-Key"];

    const currentRun = { ...baseRun, run_id: "run-2", case_id: "case-002" };
    mockFetch.mockResolvedValueOnce(okResponse(currentRun));
    rerender(<RunPage caseId="case-002" runId="run-2" onBack={() => {}} />);
    await screen.findByRole("button", { name: "Approve" });

    mockFetch.mockReturnValueOnce(currentApproval.promise);
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    const currentKey = mockFetch.mock.calls[3][1].headers["Idempotency-Key"];
    expect(currentKey).not.toBe(staleKey);

    await act(async () => {
      staleApproval.resolve(errorResponse(503, "stale unknown outcome"));
      await flushAsyncCallbacks();
    });
    expect(screen.getByRole("button", { name: "Approving…" })).toBeDisabled();
    expect(screen.queryByText(/stale unknown outcome/)).not.toBeInTheDocument();

    currentApproval.resolve(errorResponse(503, "current unknown outcome"));
    await screen.findByText(/current unknown outcome/);
    mockFetch.mockResolvedValueOnce(
      okResponse({ ...currentRun, status: "approved" as const })
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText("Approved ✓");

    const retryKey = mockFetch.mock.calls[4][1].headers["Idempotency-Key"];
    expect(retryKey).toBe(currentKey);
  });

  it("isolates stale replay failure and cleanup from a newer replay", async () => {
    const staleReplay = deferred<ReturnType<typeof errorResponse>>();
    const currentReplay = deferred<ReturnType<typeof okResponse>>();
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    const { rerender } = render(
      <RunPage caseId="case-001" runId="run-1" onBack={() => {}} />
    );
    await screen.findByRole("button", { name: "Replay from JSONL" });

    mockFetch.mockReturnValueOnce(staleReplay.promise);
    await userEvent.click(screen.getByRole("button", { name: "Replay from JSONL" }));

    const currentRun = { ...baseRun, run_id: "run-2", case_id: "case-002" };
    mockFetch.mockResolvedValueOnce(okResponse(currentRun));
    rerender(<RunPage caseId="case-002" runId="run-2" onBack={() => {}} />);
    await screen.findByRole("button", { name: "Replay from JSONL" });

    mockFetch.mockReturnValueOnce(currentReplay.promise);
    await userEvent.click(screen.getByRole("button", { name: "Replay from JSONL" }));

    await act(async () => {
      staleReplay.resolve(errorResponse(500, "stale replay failure"));
      await flushAsyncCallbacks();
    });
    expect(screen.getByRole("button", { name: "Replaying…" })).toBeDisabled();
    expect(screen.queryByText(/stale replay failure/)).not.toBeInTheDocument();

    currentReplay.resolve(
      okResponse({ ...currentRun, is_replay_response: true })
    );
    await screen.findByText("REPLAY");
  });

  it("ignores a stale replay success while the current replay remains pending", async () => {
    const staleReplay = deferred<ReturnType<typeof okResponse>>();
    const currentReplay = deferred<ReturnType<typeof okResponse>>();
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    const { rerender } = render(
      <RunPage caseId="case-001" runId="run-1" onBack={() => {}} />
    );
    await screen.findByRole("button", { name: "Replay from JSONL" });

    mockFetch.mockReturnValueOnce(staleReplay.promise);
    await userEvent.click(screen.getByRole("button", { name: "Replay from JSONL" }));

    const currentRun = { ...baseRun, run_id: "run-2", case_id: "case-002" };
    mockFetch.mockResolvedValueOnce(okResponse(currentRun));
    rerender(<RunPage caseId="case-002" runId="run-2" onBack={() => {}} />);
    await screen.findByRole("button", { name: "Replay from JSONL" });

    mockFetch.mockReturnValueOnce(currentReplay.promise);
    await userEvent.click(screen.getByRole("button", { name: "Replay from JSONL" }));

    await act(async () => {
      staleReplay.resolve(
        okResponse({ ...baseRun, is_replay_response: true })
      );
      await flushAsyncCallbacks();
    });
    expect(screen.getByRole("button", { name: "Replaying…" })).toBeDisabled();
    expect(screen.queryByText("REPLAY")).not.toBeInTheDocument();

    currentReplay.resolve(
      okResponse({ ...currentRun, is_replay_response: true })
    );
    await screen.findByText("REPLAY");
  });

  it("keeps approval terminal across same-run replay response reordering", async () => {
    const approval = deferred<ReturnType<typeof okResponse>>();
    const replay = deferred<ReturnType<typeof okResponse>>();
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);
    await screen.findByRole("button", { name: "Approve" });

    mockFetch.mockReturnValueOnce(approval.promise);
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    mockFetch.mockReturnValueOnce(replay.promise);
    await userEvent.click(screen.getByRole("button", { name: "Replay from JSONL" }));

    await act(async () => {
      approval.resolve(
        okResponse({
          ...baseRun,
          status: "approved" as const,
          events: [
            ...baseRun.events,
            {
              type: "approved",
              timestamp: "2026-04-11T15:00:09Z",
              payload: {},
            },
          ],
        })
      );
      await flushAsyncCallbacks();
    });
    expect(screen.getByText("Approved ✓")).toBeInTheDocument();

    await act(async () => {
      replay.resolve(okResponse({ ...baseRun, is_replay_response: true }));
      await flushAsyncCallbacks();
    });
    expect(screen.getByText("Approved ✓")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByText("REPLAY")).not.toBeInTheDocument();
  });

  it("dismisses mutation error", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(errorResponse(409, "Already approved"));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByText("Approval did not complete")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(screen.queryByText("Approval did not complete")).not.toBeInTheDocument();
    });
  });

  it("keeps the current workspace visible while a manual reload is pending", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(errorResponse(409, "Already approved"));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reload run" })).toBeInTheDocument();
    });

    mockFetch.mockReturnValueOnce(new Promise(() => {}));
    await userEvent.click(screen.getByRole("button", { name: "Reload run" }));

    expect(screen.getByText("Refreshing run")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByText("Loading run")).not.toBeInTheDocument();
  });

  it("keeps the current workspace visible when a manual reload fails", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(errorResponse(409, "Already approved"));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reload run" })).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(errorResponse(500, "Backend unavailable"));
    await userEvent.click(screen.getByRole("button", { name: "Reload run" }));

    await waitFor(() => {
      expect(screen.getByText("Latest reload failed")).toBeInTheDocument();
      expect(screen.getByText("Backend unavailable")).toBeInTheDocument();
    });
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry fetch" })).toBeInTheDocument();
  });

  it("ignores a stale same-run reload failure after replay succeeds", async () => {
    const reload = deferred<ReturnType<typeof errorResponse>>();
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await screen.findByRole("button", { name: "Approve" });
    mockFetch.mockResolvedValueOnce(errorResponse(409, "Already approved"));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByRole("button", { name: "Reload run" });

    mockFetch.mockReturnValueOnce(reload.promise);
    await userEvent.click(screen.getByRole("button", { name: "Reload run" }));
    mockFetch.mockResolvedValueOnce(
      okResponse({ ...baseRun, is_replay_response: true })
    );
    await userEvent.click(screen.getByRole("button", { name: "Replay from JSONL" }));
    await screen.findByText("REPLAY");

    await act(async () => {
      reload.resolve(errorResponse(500, "stale reload failure"));
      await flushAsyncCallbacks();
    });

    expect(screen.getByText("REPLAY")).toBeInTheDocument();
    expect(screen.queryByText("Latest reload failed")).not.toBeInTheDocument();
    expect(screen.queryByText("stale reload failure")).not.toBeInTheDocument();
  });

  it("re-enables replay and ignores a stale replay failure after reload succeeds", async () => {
    const replay = deferred<ReturnType<typeof errorResponse>>();
    const refreshedRun = {
      ...baseRun,
      facts: { ...baseRun.facts!, payer: "Reloaded payer" },
    };
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await screen.findByRole("button", { name: "Replay from JSONL" });
    mockFetch.mockReturnValueOnce(replay.promise);
    await userEvent.click(screen.getByRole("button", { name: "Replay from JSONL" }));
    expect(screen.getByRole("button", { name: "Replaying…" })).toBeDisabled();

    mockFetch.mockResolvedValueOnce(errorResponse(409, "Already approved"));
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByRole("button", { name: "Reload run" });

    mockFetch.mockResolvedValueOnce(okResponse(refreshedRun));
    await userEvent.click(screen.getByRole("button", { name: "Reload run" }));
    await screen.findByText("Reloaded payer");
    expect(screen.getByRole("button", { name: "Replay from JSONL" })).toBeEnabled();

    await act(async () => {
      replay.resolve(errorResponse(500, "stale replay failure"));
      await flushAsyncCallbacks();
    });

    expect(screen.queryByText("Replay did not complete")).not.toBeInTheDocument();
    expect(screen.queryByText("stale replay failure")).not.toBeInTheDocument();
  });

  it("preserves a stale approval retry identity after replay wins", async () => {
    const approval = deferred<ReturnType<typeof errorResponse>>();
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await screen.findByRole("button", { name: "Approve" });
    mockFetch.mockReturnValueOnce(approval.promise);
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    const originalKey = mockFetch.mock.calls[1][1].headers["Idempotency-Key"];

    mockFetch.mockResolvedValueOnce(
      okResponse({ ...baseRun, is_replay_response: true })
    );
    await userEvent.click(screen.getByRole("button", { name: "Replay from JSONL" }));
    await screen.findByText("REPLAY");

    await act(async () => {
      approval.resolve(errorResponse(503, "stale approval outcome"));
      await flushAsyncCallbacks();
    });

    expect(screen.queryByText("Approval did not complete")).not.toBeInTheDocument();
    expect(screen.queryByText("stale approval outcome")).not.toBeInTheDocument();
    await screen.findByRole("button", { name: "Approve" });

    mockFetch.mockResolvedValueOnce(
      okResponse({ ...baseRun, status: "approved" as const })
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await screen.findByText("Approved ✓");

    const retryKey = mockFetch.mock.calls[3][1].headers["Idempotency-Key"];
    expect(retryKey).toBe(originalKey);
  });

  it("shows inline mutation error on replay failure without losing run data", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Replay from JSONL" })).toBeInTheDocument();
    });

    // Replay fails
    mockFetch.mockResolvedValueOnce(errorResponse(404, "Replay unavailable"));

    await userEvent.click(screen.getByRole("button", { name: "Replay from JSONL" }));

    await waitFor(() => {
      expect(screen.getByText("Replay did not complete")).toBeInTheDocument();
      expect(
        screen.getByText(/The live run stays on screen/)
      ).toBeInTheDocument();
      expect(screen.getByText(/Replay unavailable/)).toBeInTheDocument();
      // Run data preserved
      expect(screen.getByText("Acme")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Retry replay" })).toBeInTheDocument();
    });
  });

  it("announces replay mode when replay succeeds", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Replay from JSONL" })).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(
      okResponse({ ...baseRun, is_replay_response: true })
    );

    await user.click(screen.getByRole("button", { name: "Replay from JSONL" }));

    await waitFor(() => {
      expect(screen.getByText("REPLAY")).toBeInTheDocument();
      expect(screen.getByTestId("run-live-region")).toHaveTextContent(
        /Replay mode enabled\. Run state reconstructed from the audit log\./
      );
    });
  });

  it("moves focus to the matching document when an evidence button is activated from the keyboard", async () => {
    const user = userEvent.setup();
    const runWithEvidence: RunStatus = {
      ...baseRun,
      facts: {
        ...baseRun.facts!,
        evidence_refs: [
          {
            doc_id: "denial-letter",
            quote: "Denied for PT.",
          },
        ],
      },
    };

    mockFetch.mockResolvedValueOnce(okResponse(runWithEvidence));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    const evidenceButton = await screen.findByRole("button", {
      name: /denial letter/i,
    });
    evidenceButton.focus();
    expect(evidenceButton).toHaveFocus();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(document.getElementById("doc-denial-letter")).toHaveFocus();
      expect(mockScrollIntoView).toHaveBeenCalled();
      expect(screen.getByTestId("run-live-region")).toHaveTextContent(
        /Evidence focus moved to Denial Letter\./
      );
    });
  });

  it("renders replay button", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Replay from JSONL" })).toBeInTheDocument();
    });
  });
});
