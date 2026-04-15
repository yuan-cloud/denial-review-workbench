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

beforeEach(() => {
  mockFetch.mockReset();
});

describe("CaseListPage", () => {
  it("renders title", () => {
    mockFetch.mockResolvedValueOnce(okResponse([]));
    render(<CaseListPage onSelectCase={() => {}} />);
    expect(screen.getByText("Denial Review Workbench")).toBeInTheDocument();
  });

  it("fetches and displays cases", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse([{ case_id: "case-001" }, { case_id: "case-002" }])
    );
    render(<CaseListPage onSelectCase={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("case-001")).toBeInTheDocument();
      expect(screen.getByText("case-002")).toBeInTheDocument();
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
    mockFetch.mockResolvedValueOnce(
      okResponse([{ case_id: "case-001" }])
    );

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

    await userEvent.click(screen.getByText("Run Review"));

    await waitFor(() => {
      expect(onSelectCase).toHaveBeenCalledWith("case-001", "run-1");
    });
  });

  it("shows Analyzing state during run", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse([{ case_id: "case-001" }])
    );

    render(<CaseListPage onSelectCase={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("case-001")).toBeInTheDocument();
    });

    // Make postRun hang
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    await userEvent.click(screen.getByText("Run Review"));

    expect(screen.getByText("Analyzing...")).toBeInTheDocument();
    expect(screen.getByText(/Analyzing case/)).toBeInTheDocument();
  });

  it("shows error on run failure", async () => {
    mockFetch.mockResolvedValueOnce(
      okResponse([{ case_id: "case-001" }])
    );

    render(<CaseListPage onSelectCase={() => {}} />);

    await waitFor(() => {
      expect(screen.getByText("case-001")).toBeInTheDocument();
    });

    mockFetch.mockResolvedValueOnce(errorResponse(422));

    await userEvent.click(screen.getByText("Run Review"));

    await waitFor(() => {
      expect(screen.getByText(/POST \/runs failed/)).toBeInTheDocument();
    });
  });
});
