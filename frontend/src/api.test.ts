import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCases, postRun, postApprove, getReplay } from "./api";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

function okResponse(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

function errorResponse(status: number) {
  return { ok: false, status, json: () => Promise.resolve({}) };
}

describe("getCases", () => {
  it("fetches /cases and returns list", async () => {
    const data = [{ case_id: "case-001" }, { case_id: "case-002" }];
    mockFetch.mockResolvedValueOnce(okResponse(data));

    const result = await getCases();
    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8000/cases");
  });

  it("throws on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500));
    await expect(getCases()).rejects.toThrow("GET /cases failed: 500");
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
    mockFetch.mockResolvedValueOnce(errorResponse(422));
    await expect(postRun("case-001")).rejects.toThrow("POST /runs failed: 422");
  });
});

describe("postApprove", () => {
  it("posts to /runs/{runId}/approve with draft_text", async () => {
    const data = { run_id: "r1", status: "approved" };
    mockFetch.mockResolvedValueOnce(okResponse(data));

    const result = await postApprove("r1", "edited text");
    expect(result).toEqual(data);
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8000/runs/r1/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draft_text: "edited text" }),
    });
  });

  it("sends null draft_text when omitted", async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ status: "approved" }));
    await postApprove("r1");
    const call = mockFetch.mock.calls[0];
    expect(JSON.parse(call[1].body)).toEqual({ draft_text: null });
  });

  it("throws on 409", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(409));
    await expect(postApprove("r1")).rejects.toThrow("POST /approve failed: 409");
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
    await expect(getReplay("missing")).rejects.toThrow("GET /replay failed: 404");
  });
});
