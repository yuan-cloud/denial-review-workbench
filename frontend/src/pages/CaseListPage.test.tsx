import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import CaseListPage from "./CaseListPage";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function okResponse(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function errorResponse(status: number) {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

const fullCases = [
  {
    case_id: "case-001",
    facility_id: "facility-a",
    scenario_title: "Authorization already approved",
    expected_path_type: "approval",
    summary: "Happy-path packet with all documentation present.",
  },
  {
    case_id: "case-002",
    facility_id: "facility-a",
    scenario_title: "Missing physician order",
    expected_path_type: "missing_documents",
    summary: "Packet missing a physician order for PT authorization.",
  },
];

beforeEach(() => {
  mockFetch.mockReset();
});

describe("CaseListPage", () => {
  it("renders title", () => {
    mockFetch.mockResolvedValueOnce(okResponse([]));
    render(<CaseListPage onSelectCase={() => {}} />);
    expect(screen.getByText("Denial Review Workbench")).toBeInTheDocument();
  });

  it("fetches and displays cases with metadata", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(fullCases));
    render(<CaseListPage onSelectCase={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("case-001")).toBeInTheDocument();
      expect(screen.getByText("case-002")).toBeInTheDocument();
      // Metadata columns — both cases share facility-a
      expect(screen.getAllByText("facility-a")).toHaveLength(2);
      expect(screen.getByText("Authorization already approved")).toBeInTheDocument();
      expect(screen.getByText("Missing physician order")).toBeInTheDocument();
      expect(screen.getByText("Approval")).toBeInTheDocument();
      expect(screen.getByText("Missing Docs")).toBeInTheDocument();
    });
  });

  it("renders dense table header columns", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(fullCases));
    render(<CaseListPage onSelectCase={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("Case")).toBeInTheDocument();
      expect(screen.getByText("Facility")).toBeInTheDocument();
      expect(screen.getByText("Scenario")).toBeInTheDocument();
      expect(screen.getByText("Path")).toBeInTheDocument();
      expect(screen.getByText("Summary")).toBeInTheDocument();
      expect(screen.getByText("Action")).toBeInTheDocument();
    });
  });

  it("shows error on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));
    render(<CaseListPage onSelectCase={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText(/GET \/cases failed/)).toBeInTheDocument();
    });
  });

  it("calls onSelectCase after successful run", async () => {
    const onSelectCase = vi.fn();
    mockFetch.mockResolvedValueOnce(okResponse(fullCases));

    render(<CaseListPage onSelectCase={onSelectCase} />);

    await waitFor(() => {
      expect(screen.getByText("case-001")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(
      okResponse({
        run_id: "run-1",
        case_id: "case-001",
        status: "approval_requested",
      })
    );

    // Click the first Run Review button
    const buttons = screen.getAllByText("Run Review");
    await userEvent.click(buttons[0]);

    await waitFor(() => {
      expect(onSelectCase).toHaveBeenCalledWith("case-001", "run-1");
    });
  });

  it("shows Analyzing state during run", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(fullCases));

    render(<CaseListPage onSelectCase={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("case-001")).toBeInTheDocument();
    });

    // Make postRun hang
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    const buttons = screen.getAllByText("Run Review");
    await userEvent.click(buttons[0]);

    expect(screen.getByText("Analyzing...")).toBeInTheDocument();
    expect(screen.getByText(/Analyzing case/)).toBeInTheDocument();
  });

  it("shows error on run failure", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(fullCases));

    render(<CaseListPage onSelectCase={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("case-001")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(errorResponse(422));

    const buttons = screen.getAllByText("Run Review");
    await userEvent.click(buttons[0]);

    await waitFor(() => {
      expect(screen.getByText(/POST \/runs failed/)).toBeInTheDocument();
    });
  });

  it("shows case count in queue description", async () => {
    mockFetch.mockResolvedValueOnce(okResponse(fullCases));
    render(<CaseListPage onSelectCase={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("2 cases available for review.")).toBeInTheDocument();
    });
  });
});
