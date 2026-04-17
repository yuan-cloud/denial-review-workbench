import type { CaseListItem, RunStatus } from "./types";

const DEFAULT_API_BASE = "http://localhost:8000";

type ApiErrorPayload = {
  detail?: unknown;
  error?: unknown;
  message?: unknown;
};

export class ApiError extends Error {
  status: number;
  method: string;
  path: string;
  detail: string | null;

  constructor({
    method,
    path,
    status,
    detail,
  }: {
    method: string;
    path: string;
    status: number;
    detail: string | null;
  }) {
    super(
      detail
        ? `${method} ${path} failed: ${status} (${detail})`
        : `${method} ${path} failed: ${status}`
    );
    this.name = "ApiError";
    this.status = status;
    this.method = method;
    this.path = path;
    this.detail = detail;
  }
}

function readApiBaseEnv(): string | undefined {
  const env = (
    import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }
  ).env;
  return env?.VITE_API_BASE;
}

export function getApiBase(): string {
  return resolveApiBase(readApiBaseEnv());
}

export function resolveApiBase(rawValue?: string): string {
  const raw = rawValue?.trim() || DEFAULT_API_BASE;
  return raw.replace(/\/+$/, "");
}

function getErrorDetail(payload: ApiErrorPayload | string | null): string | null {
  if (!payload) {
    return null;
  }

  if (typeof payload === "string") {
    return payload.trim() || null;
  }

  const candidates = [payload.detail, payload.error, payload.message];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

async function parseErrorDetail(response: Response): Promise<string | null> {
  try {
    const payload = (await response.json()) as ApiErrorPayload | string | null;
    return getErrorDetail(payload);
  } catch {
    return null;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const url = `${getApiBase()}${path}`;
  const response = init === undefined ? await fetch(url) : await fetch(url, init);

  if (!response.ok) {
    const detail = await parseErrorDetail(response);
    throw new ApiError({
      method,
      path,
      status: response.status,
      detail,
    });
  }

  return response.json() as Promise<T>;
}

export async function getCases(): Promise<CaseListItem[]> {
  return requestJson<CaseListItem[]>("/cases");
}

export async function getRun(runId: string): Promise<RunStatus> {
  return requestJson<RunStatus>(`/runs/${runId}`);
}

export async function postRun(caseId: string): Promise<RunStatus> {
  return requestJson<RunStatus>("/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ case_id: caseId }),
  });
}

export async function postApprove(
  runId: string,
  draftText?: string,
  approvedBy?: string
): Promise<RunStatus> {
  return requestJson<RunStatus>(`/runs/${runId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      draft_text: draftText ?? null,
      approved_by: approvedBy ?? null,
    }),
  });
}

export async function getReplay(runId: string): Promise<RunStatus> {
  return requestJson<RunStatus>(`/runs/${runId}/replay`);
}
