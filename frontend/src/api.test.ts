import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ApiError,
  getCases,
  getReplay,
  getRun,
  postApprove,
  postRun,
  resolveApiBase,
} from "./api";
import type { CaseListItem } from "./types";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function okResponse(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function errorResponse(status: number, data: unknown = {}) {
  return { ok: false, status, json: () => Promise.resolve(data) };
}

describe("resolveApiBase", () => {
  it("uses localhost default when value is unset", () => {
    expect(resolveApiBase()).toBe("http://localhost:8000");
  });

  it("trims trailing slash from configured base", () => {
    expect(resolveApiBase("http://example.test/api/")).toBe(
      "http://example.test/api"
    );
  });
});

describe("getCases", () => {
  it("fetches /cases and returns list", async () => {
    const data = [
      {
        case_id: "case-001",
        facility_id: "facility-a",
        scenario_title: "Authorization already approved",
        expected_path_type: "approval",
        summary: "Happy-path packet with all required documentation present.",
      },
      {
        case_id: "case-002",
        facility_id: "facility-a",
        scenario_title: "Missing supporting documentation",
        expected_path_type: "missing_documents",
        summary: "Signed physician order missing and progress notes are stale.",
      },
    ] satisfies CaseListItem[];
    mockFetch.mockResolvedValueOnce(okResponse(data));

    const result = await getCases();
    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8000/cases");
  });

  it("throws ApiError with backend detail when present", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(500, { detail: "case list unavailable" })
    );

    let error: unknown;
    try {
      await getCases();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(500);
    expect(apiError.detail).toBe("case list unavailable");
    expect(apiError.path).toBe("/cases");
    expect(apiError.method).toBe("GET");
    expect(apiError.message).toBe(
      "GET /cases failed: 500 (case list unavailable)"
    );
  });
});

describe("getRun", () => {
  it("fetches /runs/{runId}", async () => {
    const data = { run_id: "r1", case_id: "case-001", status: "approval_requested" };
    mockFetch.mockResolvedValueOnce(okResponse(data));

    const result = await getRun("r1");
    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8000/runs/r1");
  });

  it("throws on missing run", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404));
    await expect(getRun("missing")).rejects.toThrow("GET /runs/missing failed: 404");
  });

  it("forwards an abort signal", async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValueOnce(okResponse({ run_id: "r1" }));

    await getRun("r1", controller.signal);

    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8000/runs/r1", {
      signal: controller.signal,
    });
  });
});

describe("postRun", () => {
  it("posts to /runs with case_id", async () => {
    const runData = { run_id: "run-1", case_id: "case-001", status: "approval_requested" };
    mockFetch.mockResolvedValueOnce(okResponse(runData));

    const result = await postRun("case-001");
    expect(result).toEqual(runData);
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8000/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ case_id: "case-001" }),
    });
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(422, { detail: "pipeline failed" }));
    await expect(postRun("case-001")).rejects.toThrow(
      "POST /runs failed: 422 (pipeline failed)"
    );
  });
});

describe("postApprove", () => {
  it("posts to /runs/{runId}/approve with draft_text and approved_by", async () => {
    const data = { run_id: "r1", status: "approved" };
    mockFetch.mockResolvedValueOnce(okResponse(data));

    const result = await postApprove(
      "r1",
      "edited text",
      "reviewer-1",
      "approval-key-1"
    );
    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8000/runs/r1/approve", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "approval-key-1",
      },
      body: JSON.stringify({ draft_text: "edited text", approved_by: "reviewer-1" }),
    });
  });

  it("sends null draft_text and approved_by when omitted", async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ status: "approved" }));
    await postApprove("r1", undefined, undefined, "approval-key-2");
    const call = mockFetch.mock.calls[0];
    expect(JSON.parse(call[1].body)).toEqual({ draft_text: null, approved_by: null });
  });

  it("throws on 409", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(409, { detail: "Run already approved" })
    );
    await expect(
      postApprove("r1", undefined, undefined, "approval-key-3")
    ).rejects.toThrow(
      "POST /runs/r1/approve failed: 409 (Run already approved)"
    );
  });

  it("rejects a call without an idempotency key before fetch", async () => {
    await expect(postApprove("r1", "text", "reviewer-1")).rejects.toThrow(
      "Approval requires an idempotency key"
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("getReplay", () => {
  it("fetches /runs/{runId}/replay", async () => {
    const data = { run_id: "r1", is_replay_response: true };
    mockFetch.mockResolvedValueOnce(okResponse(data));

    const result = await getReplay("r1");
    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8000/runs/r1/replay");
  });

  it("throws on 404", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404));
    await expect(getReplay("missing")).rejects.toThrow(
      "GET /runs/missing/replay failed: 404"
    );
  });
});

describe("error edge cases", () => {
  it("propagates network failure when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    let error: unknown;
    try {
      await getCases();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).message).toBe("Failed to fetch");
  });

  it("handles non-JSON error response gracefully", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    });

    let error: unknown;
    try {
      await getCases();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(502);
    expect(apiError.detail).toBeNull();
    expect(apiError.message).toBe("GET /cases failed: 502");
  });

  it("returns null detail when error body has no detail/error/message fields", async () => {
    mockFetch.mockResolvedValueOnce(
      errorResponse(500, { unexpected_field: "something" })
    );

    let error: unknown;
    try {
      await getRun("r1");
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.status).toBe(500);
    expect(apiError.detail).toBeNull();
  });
});
