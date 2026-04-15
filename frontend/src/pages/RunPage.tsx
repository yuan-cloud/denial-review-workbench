import { useEffect, useState, useCallback } from "react";
import type { RunStatus } from "../types";
import { getReplay, getRun, postApprove } from "../api";
import DocumentPanel from "../components/DocumentPanel";
import FactCards from "../components/FactCards";
import GapAnalysisTable from "../components/GapAnalysisTable";
import RecommendationEditor from "../components/RecommendationEditor";
import RunHistoryPanel from "../components/RunHistoryPanel";
import {
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
  const [error, setError] = useState<string | null>(null);
  const [activeQuote, setActiveQuote] = useState<{ doc_id: string; quote: string } | null>(null);

  useEffect(() => {
    getRun(runId)
      .then(setRun)
      .catch((e) => setError(e.message));
  }, [runId]);

  const handleApprove = useCallback(
    async (draftText: string) => {
      try {
        const updated = await postApprove(runId, draftText);
        setRun(updated);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [runId]
  );

  const handleReplay = useCallback(async () => {
    try {
      const replayed = await getReplay(runId);
      setRun(replayed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [runId]);

  const handleEvidenceClick = useCallback((docId: string, quote: string) => {
    setActiveQuote({ doc_id: docId, quote });
    document.getElementById(`doc-${docId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const statusTone =
    run?.status === "approved"
      ? "success"
      : run?.status === "escalated"
        ? "warning"
        : run
          ? "primary"
          : "neutral";

  const statusLabel = run ? run.status.replace(/_/g, " ") : "loading";

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

  if (error) {
    return (
      <WorkbenchScreen>
        <div style={{ display: "grid", gap: 16 }}>
          {pageHeader}
          <WorkbenchNotice title="Run request failed" tone="danger">
            {error}
          </WorkbenchNotice>
        </div>
      </WorkbenchScreen>
    );
  }

  return (
    <WorkbenchScreen fullHeight maxWidth={1400}>
      <div style={{ display: "grid", gap: 16, flex: 1, minHeight: 0 }}>
        {pageHeader}

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
            ) : (
              <WorkbenchNotice>Click Run Review to start.</WorkbenchNotice>
            )}
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
