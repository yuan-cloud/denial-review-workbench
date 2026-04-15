import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import App from "./App";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function okResponse(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("App", () => {
  it("renders CaseListPage by default", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse([{ case_id: "case-001" }, { case_id: "case-002" }])
    );

    render(<App />);
    expect(screen.getByText("Denial Review Workbench")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("case-001")).toBeInTheDocument();
    });
  });

  it("navigates to RunPage after Run Review click", async () => {
    // getCases response
    mockFetch.mockResolvedValueOnce(
      okResponse([{ case_id: "case-001" }])
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText("case-001")).toBeInTheDocument();
    });

    // postRun response
    mockFetch.mockResolvedValueOnce(
      okResponse({
        run_id: "run-1",
        case_id: "case-001",
        facility_id: "fac-1",
        status: "approval_requested",
        documents: [],
        retrieved_policy_sections: [],
        facts: null,
        findings: null,
        recommendation: null,
        events: [],
        is_replay_response: false,
      })
    );

    // GET /runs/run-1 response (RunPage useEffect)
    mockFetch.mockResolvedValueOnce(
      okResponse({
        run_id: "run-1",
        case_id: "case-001",
        facility_id: "fac-1",
        status: "approval_requested",
        documents: [],
        retrieved_policy_sections: [],
        facts: null,
        findings: null,
        recommendation: null,
        events: [],
        is_replay_response: false,
      })
    );

    await userEvent.click(screen.getByText("Run Review"));

    await waitFor(() => {
      expect(screen.getByText(/Case: case-001/)).toBeInTheDocument();
      expect(screen.getByText(/Run: run-1/)).toBeInTheDocument();
    });
  });
});
