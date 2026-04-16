import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import RunPage from "./RunPage";
import type { RunStatus } from "../types";

const mockFetch = vi.fn();
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
  events: [
    { type: "run_started", timestamp: "2026-04-15T10:00:00Z", payload: { case_id: "case-001" } },
  ],
  is_replay_response: false,
};

beforeEach(() => {
  mockFetch.mockReset();
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
        screen.getByText(/The current draft and run state are still on screen/)
      ).toBeInTheDocument();
      expect(screen.getByText(/Already approved/)).toBeInTheDocument();
      // Run data still visible — not wiped
      expect(screen.getByText("Acme")).toBeInTheDocument();
      // Dismiss button present
      expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    });
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

  it("shows inline mutation error on replay failure without losing run data", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Replay" })).toBeInTheDocument();
    });

    // Replay fails
    mockFetch.mockResolvedValueOnce(errorResponse(404, "Replay unavailable"));

    await userEvent.click(screen.getByRole("button", { name: "Replay" }));

    await waitFor(() => {
      expect(screen.getByText("Replay did not complete")).toBeInTheDocument();
      expect(
        screen.getByText(/The live run remains on screen/)
      ).toBeInTheDocument();
      expect(screen.getByText(/Replay unavailable/)).toBeInTheDocument();
      // Run data preserved
      expect(screen.getByText("Acme")).toBeInTheDocument();
    });
  });

  it("renders replay button", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(baseRun));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Replay" })).toBeInTheDocument();
    });
  });
});
