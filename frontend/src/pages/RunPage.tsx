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

export default function RunPage({ caseId, runId, onBack }: Props) {
  const [run, setRun] = useState<RunStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchNotFound, setFetchNotFound] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [activeQuote, setActiveQuote] = useState<{ doc_id: string; quote: string } | null>(null);

  const fetchRun = useCallback(() => {
    setLoading(true);
    setFetchError(null);
    setFetchNotFound(false);
    getRun(runId)
      .then((data) => {
        setRun(data);
        setLoading(false);
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) {
          setFetchNotFound(true);
          setFetchError(e.detail ?? e.message);
        } else {
          setFetchError(e instanceof Error ? e.message : String(e));
        }
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
        setMutationError(e instanceof Error ? e.message : String(e));
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
      setMutationError(e instanceof Error ? e.message : String(e));
    }
  }, [runId]);

  const handleEvidenceClick = useCallback((docId: string, quote: string) => {
    setActiveQuote({ doc_id: docId, quote });
    document.getElementById(`doc-${docId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const isEscalated = run?.status === "escalated";

  const statusTone =
    run?.status === "approved"
      ? "success"
      : isEscalated
        ? "danger"
        : run
          ? "primary"
          : loading
            ? "neutral"
            : "neutral";

  const statusLabel = run
    ? run.status.replace(/_/g, " ")
    : loading
      ? "loading"
      : "error";

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

  // Fetch error — workspace not loaded, show error with retry
  if (fetchError && !run) {
    return (
      <WorkbenchScreen>
        <div style={{ display: "grid", gap: 16 }}>
          {pageHeader}
          <WorkbenchNotice
            title={fetchNotFound ? "Run not found" : "Failed to load run"}
            tone="danger"
          >
            <p style={{ margin: "0 0 10px" }}>{fetchError}</p>
            <WorkbenchActionBar>
              <WorkbenchButton onClick={fetchRun} size="sm">
                Retry
              </WorkbenchButton>
              <WorkbenchButton onClick={onBack} size="sm" variant="ghost">
                &larr; Back to cases
              </WorkbenchButton>
            </WorkbenchActionBar>
          </WorkbenchNotice>
        </div>
      </WorkbenchScreen>
    );
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
          <WorkbenchNotice title="Action failed" tone="warning">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <span>{mutationError}</span>
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
              documents={run?.documents ?? []}
              retrievedPolicySections={run?.retrieved_policy_sections ?? []}
              facilityId={run?.facility_id ?? ""}
              activeQuote={activeQuote}
            />
          </WorkbenchPanel>

          <WorkbenchPanel style={{ minHeight: 0 }}>
            {loading ? (
              <WorkbenchNotice>Loading run data…</WorkbenchNotice>
            ) : run ? (
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
              events={run?.events ?? []}
              isReplayResponse={run?.is_replay_response ?? false}
              onReplay={handleReplay}
            />
          </WorkbenchPanel>
        </div>
      </div>
    </WorkbenchScreen>
  );
}
