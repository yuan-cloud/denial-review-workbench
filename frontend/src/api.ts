import type { RunStatus } from "./types";

const API_BASE = "http://localhost:8000";

export async function getCases(): Promise<{ case_id: string }[]> {
  const res = await fetch(`${API_BASE}/cases`);
  if (!res.ok) throw new Error(`GET /cases failed: ${res.status}`);
  return res.json();
}

export async function postRun(caseId: string): Promise<RunStatus> {
  const res = await fetch(`${API_BASE}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case_id: caseId }),
  });
  if (!res.ok) throw new Error(`POST /runs failed: ${res.status}`);
  return res.json();
}

export async function postApprove(
  runId: string,
  draftText?: string
): Promise<RunStatus> {
  const res = await fetch(`${API_BASE}/runs/${runId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ draft_text: draftText ?? null }),
  });
  if (!res.ok) throw new Error(`POST /approve failed: ${res.status}`);
  return res.json();
}

export async function getReplay(runId: string): Promise<RunStatus> {
  const res = await fetch(`${API_BASE}/runs/${runId}/replay`);
  if (!res.ok) throw new Error(`GET /replay failed: ${res.status}`);
  return res.json();
}
