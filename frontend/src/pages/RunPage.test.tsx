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

function errorResponse(status: number) {
  return { ok: false, status, json: () => Promise.resolve({}) };
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
      expect(screen.getByText("85%")).toBeInTheDocument();
    });
  });

  it("shows error on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404));
    render(<RunPage caseId="case-001" runId="run-1" onBack={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/failed: 404/)).toBeInTheDocument();
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
      expect(screen.getByText(/Approved/)).toBeInTheDocument();
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
