import { useEffect, useState, useCallback, useRef } from "react";
import type { RunStatus } from "../types";
import { ApiError, getReplay, getRun, postApprove } from "../api";
import DocumentPanel from "../components/DocumentPanel";
import FactCards from "../components/FactCards";
import GapAnalysisTable from "../components/GapAnalysisTable";
import RecommendationEditor from "../components/RecommendationEditor";
import RunHistoryPanel from "../components/RunHistoryPanel";
import {
  BREAKPOINT_MOBILE,
  formatDocumentLabel,
  palette,
  useMediaQuery,
  WorkbenchActionBar,
  WorkbenchButton,
  WorkbenchNotice,
  WorkbenchPaneGrid,
  WorkbenchPageHeader,
  WorkbenchPanel,
  WorkbenchScreen,
  WorkbenchStatusPill,
  WorkbenchSummaryItem,
  WorkbenchSummaryStrip,
  workbenchStyles,
} from "../ui/workbench";

interface Props {
  caseId: string;
  runId: string;
  onBack: () => void;
}

type ApprovalAttempt = {
  runId: string;
  draftText: string;
  approvedBy: string;
  key: string;
};

const srOnlyStyle = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function formatTimestamp(timestamp: string | null | undefined): string {
  if (!timestamp) {
    return "—";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(timestamp));
  } catch {
    return timestamp;
  }
}

function titleCaseStatus(status: RunStatus["status"]): string {
  return status
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function confidencePresentation(confidence: number | null): {
  tone: "neutral" | "success" | "warning" | "danger";
  label: string;
  value: string;
} {
  if (confidence === null) {
    return {
      tone: "neutral",
      label: "Pending",
      value: "Pending",
    };
  }

  if (confidence >= 0.8) {
    return {
      tone: "success",
      label: "High confidence",
      value: `${(confidence * 100).toFixed(0)}%`,
    };
  }

  if (confidence >= 0.7) {
    return {
      tone: "warning",
      label: "Medium confidence",
      value: `${(confidence * 100).toFixed(0)}%`,
    };
  }

  return {
    tone: "danger",
    label: "Low confidence",
    value: `${(confidence * 100).toFixed(0)}%`,
  };
}

function isTerminalStatus(status: RunStatus["status"]): boolean {
  return status === "approved" || status === "escalated";
}

function RunPageContent({ caseId, runId, onBack }: Props) {
  const [run, setRun] = useState<RunStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchNotFound, setFetchNotFound] = useState(false);
  const [replayInvalidation, setReplayInvalidation] = useState(0);
  const [activeQuote, setActiveQuote] = useState<{ doc_id: string; quote: string } | null>(null);
  const [skipLinkFocused, setSkipLinkFocused] = useState(false);
  const [liveMessage, setLiveMessage] = useState("");
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const isMobile = useMediaQuery(BREAKPOINT_MOBILE);
  const reviewStateRef = useRef<HTMLDivElement | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const previousStatusRef = useRef<RunStatus["status"] | null>(null);
  const previousReplayRef = useRef<boolean | null>(null);
  const approvalAttemptRef = useRef<ApprovalAttempt | null>(null);
  const fetchControllerRef = useRef<AbortController | null>(null);
  const fetchGenerationRef = useRef(0);
  const resultGenerationRef = useRef(0);

  const publishRunResult = useCallback((data: RunStatus, generation: number) => {
    setRun((current) => {
      const isLatest = generation === resultGenerationRef.current;
      if (!isLatest) {
        if (
          current !== null &&
          !isTerminalStatus(current.status) &&
          isTerminalStatus(data.status)
        ) {
          return data;
        }
        return current;
      }
      if (
        current !== null &&
        isTerminalStatus(current.status) &&
        data.status !== current.status
      ) {
        return current;
      }
      return data;
    });
  }, []);

  const fetchRun = useCallback(() => {
    fetchControllerRef.current?.abort();
    const controller = new AbortController();
    fetchControllerRef.current = controller;
    const generation = ++fetchGenerationRef.current;
    const resultGeneration = ++resultGenerationRef.current;
    setReplayInvalidation((current) => current + 1);
    setLoading(true);
    setFetchError(null);
    setFetchNotFound(false);
    getRun(runId, controller.signal)
      .then((data) => {
        if (
          controller.signal.aborted ||
          generation !== fetchGenerationRef.current ||
          resultGeneration !== resultGenerationRef.current
        ) {
          return;
        }
        publishRunResult(data, resultGeneration);
        setLoading(false);
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          generation !== fetchGenerationRef.current ||
          resultGeneration !== resultGenerationRef.current
        ) {
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setFetchNotFound(true);
        }
        setFetchError(describeError(error));
        setLoading(false);
      })
      .finally(() => {
        if (fetchControllerRef.current === controller) {
          fetchControllerRef.current = null;
        }
      });
  }, [publishRunResult, runId]);

  useEffect(() => {
    fetchRun();
    return () => {
      fetchGenerationRef.current += 1;
      resultGenerationRef.current += 1;
      fetchControllerRef.current?.abort();
      fetchControllerRef.current = null;
    };
  }, [fetchRun]);

  useEffect(() => {
    if (!run) {
      previousStatusRef.current = null;
      previousReplayRef.current = null;
      return;
    }

    const previousStatus = previousStatusRef.current;
    const previousReplay = previousReplayRef.current;

    if (previousStatus && previousStatus !== run.status) {
      if (run.status === "approved") {
        setLiveMessage("Run approved. Final recommendation is now locked.");
        reviewStateRef.current?.focus();
      } else if (run.status === "escalated") {
        setLiveMessage("Run escalated. Manual compliance review is required.");
        reviewStateRef.current?.focus();
      }
    } else if (
      previousReplay !== null &&
      previousReplay !== run.is_replay_response
    ) {
      if (run.is_replay_response) {
        setLiveMessage(
          "Replay mode enabled. Run state reconstructed from the audit log."
        );
      } else {
        setLiveMessage("Returned to the live run workspace.");
      }
    }

    previousStatusRef.current = run.status;
    previousReplayRef.current = run.is_replay_response;
  }, [run]);

  const handleApprove = useCallback(
    async (draftText: string) => {
      const resultGeneration = ++resultGenerationRef.current;
      const approvedBy = "local-reviewer";
      let attempt = approvalAttemptRef.current;
      if (
        attempt === null ||
        attempt.runId !== runId ||
        attempt.draftText !== draftText ||
        attempt.approvedBy !== approvedBy
      ) {
        attempt = {
          runId,
          draftText,
          approvedBy,
          key: crypto.randomUUID(),
        };
        approvalAttemptRef.current = attempt;
      }
      try {
        const updated = await postApprove(
          runId,
          draftText,
          approvedBy,
          attempt.key
        );
        if (approvalAttemptRef.current === attempt) {
          approvalAttemptRef.current = null;
        }
        publishRunResult(updated, resultGeneration);
      } catch (error) {
        if (resultGeneration !== resultGenerationRef.current) {
          return;
        }
        throw error;
      }
    },
    [publishRunResult, runId]
  );

  const handleReplay = useCallback(async () => {
    const activeFetch = fetchControllerRef.current;
    activeFetch?.abort();
    if (fetchControllerRef.current === activeFetch) {
      fetchControllerRef.current = null;
    }
    ++fetchGenerationRef.current;
    const resultGeneration = ++resultGenerationRef.current;
    setLoading(false);
    setFetchError(null);
    setFetchNotFound(false);
    try {
      const replayed = await getReplay(runId);
      if (resultGeneration !== resultGenerationRef.current) {
        return;
      }
      publishRunResult(replayed, resultGeneration);
    } catch (error) {
      if (resultGeneration !== resultGenerationRef.current) {
        return;
      }
      throw error;
    }
  }, [publishRunResult, runId]);

  const handleEvidenceClick = useCallback((docId: string, quote: string) => {
    setActiveQuote({ doc_id: docId, quote });
    const target = document.getElementById(`doc-${docId}`);
    if (target instanceof HTMLElement) {
      target.tabIndex = -1;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      setLiveMessage(`Evidence focus moved to ${formatDocumentLabel(docId)}.`);
    }
  }, []);

  const isEscalated = run?.status === "escalated";

  const statusTone =
    fetchError && !run
      ? fetchNotFound
        ? "warning"
        : "danger"
      : run?.status === "approved"
        ? "success"
        : isEscalated
          ? "danger"
          : run
            ? "primary"
            : "neutral";

  const statusLabel = run
    ? run.status.replace(/_/g, " ")
    : loading
      ? "loading"
      : fetchNotFound
        ? "not found"
        : "load failed";

  const modeTone = run?.is_replay_response ? "warning" : "neutral";
  const modeLabel = run?.is_replay_response ? "Replay" : "Live";

  const pageHeader = (
    <WorkbenchPageHeader
      eyebrow="Run review"
      title={`Case: ${caseId}`}
      description={`Run: ${runId}`}
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <WorkbenchStatusPill tone={statusTone}>{statusLabel}</WorkbenchStatusPill>
          {run ? <WorkbenchStatusPill tone={modeTone}>{modeLabel}</WorkbenchStatusPill> : null}
          <WorkbenchButton onClick={onBack} size="sm">
            &larr; Back
          </WorkbenchButton>
        </div>
      }
    />
  );

  // Initial loading or fetch error before any run data exists — show full status screen.
  if (!run && (loading || fetchError)) {
    const title = loading
      ? "Loading run"
      : fetchNotFound
        ? "Run not found"
        : "Unable to load run";
    let tone: "primary" | "warning" | "danger" = "danger";

    if (loading) {
      tone = "primary";
    } else if (fetchNotFound) {
      tone = "warning";
    }

    return (
      <WorkbenchScreen fullHeight maxWidth={1400}>
        <div style={{ display: "grid", gap: 16 }}>
          {pageHeader}
          <WorkbenchPanel>
            <div style={{ display: "grid", gap: 14, minHeight: 280, alignContent: "start" }}>
              <WorkbenchNotice title={title} tone={tone}>
                {loading ? (
                  <>
                    Fetching documents, analysis, and audit history for{" "}
                    <strong>{runId}</strong>. This does not start a new review.
                  </>
                ) : fetchNotFound ? (
                  <>
                    Run <strong>{runId}</strong> was not found. Retry fetch.
                    If still unavailable, return to the case list and start a new review.
                    {fetchError ? <div style={{ marginTop: 6 }}>{fetchError}</div> : null}
                  </>
                ) : (
                  <>
                    The workspace could not load <strong>{runId}</strong>. Check the
                    backend connection and retry.
                    {fetchError ? <div style={{ marginTop: 6 }}>{fetchError}</div> : null}
                  </>
                )}
              </WorkbenchNotice>

              {!loading ? (
                <WorkbenchActionBar>
                  <WorkbenchButton onClick={fetchRun} size="sm" variant="primary">
                    Retry fetch
                  </WorkbenchButton>
                  <WorkbenchButton onClick={onBack} size="sm" variant="ghost">
                    &larr; Back to case list
                  </WorkbenchButton>
                </WorkbenchActionBar>
              ) : null}
            </div>
          </WorkbenchPanel>
        </div>
      </WorkbenchScreen>
    );
  }

  if (!run) {
    return null;
  }

  const confidence = run.facts?.confidence ?? null;
  const confidenceView = confidencePresentation(confidence);
  const missingCount = run.findings?.missing_items.length ?? 0;
  const conflictCount = run.findings?.conflicts.length ?? 0;
  const workflowSummary = isEscalated
    ? "Blocked pending compliance review."
    : run.status === "approved"
      ? "Human approval recorded; final text is locked."
      : "Awaiting human review and approval.";
  const modeSummary = run.is_replay_response
    ? "Replay reconstruction from the persisted event log."
    : "Live workspace backed by the current run state.";
  const gapSummary = isEscalated
    ? `${formatCount(conflictCount || 1, "conflict")} triggered escalation.`
    : missingCount > 0
      ? `${formatCount(missingCount, "missing item")} identified before approval.`
      : "No missing items detected in the packet.";
  const startedAt = run.events[0]?.timestamp ?? null;
  const lastEventAt =
    run.events.length > 0 ? run.events[run.events.length - 1].timestamp : null;
  const panelHeight = isEscalated ? "min(64vh, 760px)" : "min(68vh, 820px)";
  const inlineFetchTone = loading ? "primary" : fetchNotFound ? "warning" : "danger";
  const inlineFetchTitle = loading
    ? "Refreshing run"
    : fetchNotFound
      ? "Run not found on reload"
      : "Latest reload failed";

  return (
    <WorkbenchScreen fullHeight maxWidth={1480}>
      <a
        href="#run-workspace-grid"
        onClick={(event) => {
          event.preventDefault();
          workspaceRef.current?.focus();
        }}
        onFocus={() => setSkipLinkFocused(true)}
        onBlur={() => setSkipLinkFocused(false)}
        style={{
          position: "absolute",
          left: 20,
          top: skipLinkFocused ? 16 : -48,
          zIndex: 20,
          padding: "8px 12px",
          borderRadius: 10,
          background: palette.text,
          color: palette.surface,
          textDecoration: "none",
          fontSize: 13,
          fontWeight: 600,
          boxShadow: skipLinkFocused ? "0 6px 16px rgba(16, 24, 40, 0.18)" : "none",
        }}
      >
        Skip to review workspace
      </a>
      <div
        aria-live="polite"
        aria-atomic="true"
        data-testid="run-live-region"
        style={srOnlyStyle}
      >
        {liveMessage}
      </div>
      <div style={{ display: "grid", gap: 16, flex: 1, minHeight: 0 }}>
        {pageHeader}

        <WorkbenchSummaryStrip>
          <div ref={reviewStateRef} tabIndex={-1} data-testid="review-state-summary">
            <WorkbenchSummaryItem
              label="Review state"
              value={titleCaseStatus(run.status)}
              tone={statusTone}
              meta={isMobile ? undefined : `${workflowSummary} ${modeSummary}`}
            />
          </div>
          {(!isMobile || summaryExpanded) && (
            <WorkbenchSummaryItem
              label="Facility pack"
              value={run.facility_id}
              valueStyle={workbenchStyles.mono}
              meta={`${formatCount(run.documents.length, "document")} • ${formatCount(run.retrieved_policy_sections.length, "policy section")}`}
            />
          )}
          <WorkbenchSummaryItem
            label="Confidence"
            value={confidenceView.value}
            tone={confidenceView.tone}
            meta={
              confidence === null
                ? "Facts have not been extracted yet."
                : isMobile && !summaryExpanded
                  ? confidenceView.label
                  : `${confidenceView.label} • ${run.facts?.payer ?? "payer unavailable"}`
            }
          />
          {(!isMobile || summaryExpanded) && (
            <>
              <WorkbenchSummaryItem
                label="Gap status"
                value={
                  isEscalated
                    ? formatCount(conflictCount || 1, "conflict")
                    : formatCount(missingCount, "missing item")
                }
                tone={isEscalated ? "danger" : missingCount > 0 ? "warning" : "success"}
                meta={gapSummary}
              />
              <WorkbenchSummaryItem
                label="Timeline"
                value={`Started ${formatTimestamp(startedAt)}`}
                meta={`Last event ${formatTimestamp(lastEventAt)}`}
              />
            </>
          )}
          {isMobile && (
            <button
              onClick={() => setSummaryExpanded((prev) => !prev)}
              aria-expanded={summaryExpanded}
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                padding: "6px 0",
                background: "none",
                border: "none",
                fontSize: 12,
                fontWeight: 600,
                color: palette.textMuted,
                cursor: "pointer",
              }}
            >
              {summaryExpanded ? "Hide details \u25B2" : "Show details \u25BC"}
            </button>
          )}
        </WorkbenchSummaryStrip>

        {loading || fetchError ? (
          <WorkbenchNotice title={inlineFetchTitle} tone={inlineFetchTone}>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                {loading ? (
                  <>
                    Keeping the current workspace visible while the latest state loads.
                  </>
                ) : fetchNotFound ? (
                  <>
                    <strong>{runId}</strong> was not found on reload. The loaded workspace
                    remains visible while you decide whether to retry or return to the
                    queue.
                  </>
                ) : (
                  <>
                    The latest reload failed. The last loaded workspace stays visible so you
                    do not lose your current review context.
                  </>
                )}
              </div>
              {fetchError ? <div>{fetchError}</div> : null}
              {!loading ? (
                <WorkbenchActionBar>
                  <WorkbenchButton onClick={fetchRun} size="sm" variant="secondary">
                    Retry fetch
                  </WorkbenchButton>
                  <WorkbenchButton onClick={onBack} size="sm" variant="ghost">
                    &larr; Back to case list
                  </WorkbenchButton>
                </WorkbenchActionBar>
              ) : null}
            </div>
          </WorkbenchNotice>
        ) : null}

        {isEscalated && (
          <WorkbenchNotice title="Case Escalated: Workflow Blocked" tone="danger">
            <p style={{ margin: "0 0 6px", fontSize: 13, lineHeight: 1.5 }}>
              Conflicting denial reasons were detected during gap analysis. This case
              requires <strong>manual compliance review</strong> before any appeal
              action can be taken.
            </p>
            <p style={{ margin: 0, fontSize: 12, color: palette.textMuted }}>
              Approval controls are disabled. The server will reject approve requests
              for escalated runs (409).
            </p>
          </WorkbenchNotice>
        )}

        <div id="run-workspace-grid" tabIndex={-1} ref={workspaceRef}>
          <WorkbenchPaneGrid testId="run-workspace-grid">
            <WorkbenchPanel style={{ minHeight: 0, height: panelHeight }}>
              <DocumentPanel
                documents={run.documents}
                retrievedPolicySections={run.retrieved_policy_sections}
                facilityId={run.facility_id}
                activeQuote={activeQuote}
              />
            </WorkbenchPanel>

            <WorkbenchPanel style={{ minHeight: 0, height: panelHeight }}>
              <FactCards facts={run.facts} onEvidenceClick={handleEvidenceClick} />
              <GapAnalysisTable
                facts={run.facts}
                findings={run.findings}
                onEvidenceClick={handleEvidenceClick}
              />
              <RecommendationEditor
                recommendation={run.recommendation}
                findings={run.findings}
                status={run.status}
                onApprove={handleApprove}
                onRefresh={fetchRun}
              />
            </WorkbenchPanel>

            <WorkbenchPanel style={{ minHeight: 0, height: panelHeight }}>
              <RunHistoryPanel
                events={run.events}
                isReplayResponse={run.is_replay_response}
                onReplay={handleReplay}
                replayInvalidation={replayInvalidation}
              />
            </WorkbenchPanel>
          </WorkbenchPaneGrid>
        </div>
      </div>
    </WorkbenchScreen>
  );
}

export default function RunPage(props: Props) {
  return <RunPageContent key={props.runId} {...props} />;
}
