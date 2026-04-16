import { useEffect, useState, useCallback } from "react";
import type { RunStatus } from "../types";
import { ApiError, getReplay, getRun, postApprove } from "../api";
import DocumentPanel from "../components/DocumentPanel";
import FactCards from "../components/FactCards";
import GapAnalysisTable from "../components/GapAnalysisTable";
import RecommendationEditor from "../components/RecommendationEditor";
import RunHistoryPanel from "../components/RunHistoryPanel";
import {
  WorkbenchActionBar,
  WorkbenchButton,
  WorkbenchNotice,
  WorkbenchPageHeader,
  WorkbenchPanel,
  WorkbenchScreen,
  WorkbenchStatusPill,
} from "../ui/workbench";

interface Props {
  caseId: string;
  runId: string;
  onBack: () => void;
}

type MutationError = {
  kind: "approve" | "replay";
  message: string;
};

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export default function RunPage({ caseId, runId, onBack }: Props) {
  const [run, setRun] = useState<RunStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchNotFound, setFetchNotFound] = useState(false);
  const [mutationError, setMutationError] = useState<MutationError | null>(null);
  const [activeQuote, setActiveQuote] = useState<{ doc_id: string; quote: string } | null>(null);

  const fetchRun = useCallback(() => {
    setLoading(true);
    setFetchError(null);
    setFetchNotFound(false);
    setMutationError(null);
    setRun(null);
    setActiveQuote(null);
    getRun(runId)
      .then((data) => {
        setRun(data);
        setLoading(false);
      })
      .catch((error) => {
        if (error instanceof ApiError && error.status === 404) {
          setFetchNotFound(true);
        }
        setFetchError(describeError(error));
        setLoading(false);
      });
  }, [runId]);

  useEffect(() => {
    fetchRun();
  }, [fetchRun]);

  const handleApprove = useCallback(
    async (draftText: string) => {
      setMutationError(null);
      try {
        const updated = await postApprove(runId, draftText);
        setRun(updated);
      } catch (e) {
        setMutationError({ kind: "approve", message: describeError(e) });
      }
    },
    [runId]
  );

  const handleReplay = useCallback(async () => {
    setMutationError(null);
    try {
      const replayed = await getReplay(runId);
      setRun(replayed);
    } catch (e) {
      setMutationError({ kind: "replay", message: describeError(e) });
    }
  }, [runId]);

  const handleEvidenceClick = useCallback((docId: string, quote: string) => {
    setActiveQuote({ doc_id: docId, quote });
    document.getElementById(`doc-${docId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  const pageHeader = (
    <WorkbenchPageHeader
      eyebrow="Run review"
      title={`Case: ${caseId}`}
      description={`Run: ${runId}`}
      actions={
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <WorkbenchStatusPill tone={statusTone}>{statusLabel}</WorkbenchStatusPill>
          <WorkbenchButton onClick={onBack} size="sm">
            &larr; Back
          </WorkbenchButton>
        </div>
      }
    />
  );

  // Loading or fetch error — show status screen with retry
  if (loading || (fetchError && !run)) {
    const title = loading
      ? "Loading run"
      : fetchNotFound
        ? "Run not found"
        : "Unable to load run";
    const tone = loading ? "primary" : fetchNotFound ? "warning" : "danger";

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
                    Run <strong>{runId}</strong> is not available right now. Retry fetch.
                    If it stays missing, go back to the case list and start the review again.
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

  return (
    <WorkbenchScreen fullHeight maxWidth={1400}>
      <div style={{ display: "grid", gap: 16, flex: 1, minHeight: 0 }}>
        {pageHeader}

        {isEscalated && (
          <WorkbenchNotice title="Case Escalated — Workflow Blocked" tone="danger">
            <p style={{ margin: "0 0 6px", fontSize: 13, lineHeight: 1.5 }}>
              Conflicting denial reasons were detected during gap analysis. This case
              requires <strong>manual compliance review</strong> before any appeal
              action can be taken.
            </p>
            <p style={{ margin: 0, fontSize: 12, color: "#667085" }}>
              Approval controls are disabled. The server will reject approve requests
              for escalated runs (409).
            </p>
          </WorkbenchNotice>
        )}

        {mutationError ? (
          <WorkbenchNotice
            title={
              mutationError.kind === "approve"
                ? "Approval did not complete"
                : "Replay did not complete"
            }
            tone="danger"
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <span>
                {mutationError.kind === "approve"
                  ? "The current draft and run state are still on screen. Review the text and try approving again if needed."
                  : "The live run remains on screen. Retry replay if you still need a reconstructed view."}
                <div style={{ marginTop: 6 }}>{mutationError.message}</div>
              </span>
              <WorkbenchButton
                onClick={() => setMutationError(null)}
                size="sm"
                variant="ghost"
              >
                Dismiss
              </WorkbenchButton>
            </div>
          </WorkbenchNotice>
        ) : null}

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 16,
          }}
        >
          <WorkbenchPanel style={{ minHeight: 0 }}>
            <DocumentPanel
              documents={run.documents}
              retrievedPolicySections={run.retrieved_policy_sections}
              facilityId={run.facility_id}
              activeQuote={activeQuote}
            />
          </WorkbenchPanel>

          <WorkbenchPanel style={{ minHeight: 0 }}>
            {run ? (
              <>
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
                />
              </>
            ) : null}
          </WorkbenchPanel>

          <WorkbenchPanel style={{ minHeight: 0 }}>
            <RunHistoryPanel
              events={run.events}
              isReplayResponse={run.is_replay_response}
              onReplay={handleReplay}
            />
          </WorkbenchPanel>
        </div>
      </div>
    </WorkbenchScreen>
  );
}
