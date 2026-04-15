import { useEffect, useState, useCallback } from "react";
import type { RunStatus } from "../types";
import { postApprove, getReplay } from "../api";
import DocumentPanel from "../components/DocumentPanel";
import FactCards from "../components/FactCards";
import GapAnalysisTable from "../components/GapAnalysisTable";
import RecommendationEditor from "../components/RecommendationEditor";
import RunHistoryPanel from "../components/RunHistoryPanel";

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
    fetch(`http://localhost:8000/runs/${runId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`GET /runs/${runId} failed: ${res.status}`);
        return res.json();
      })
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

  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
        <button onClick={onBack} style={{ marginBottom: 16, cursor: "pointer" }}>
          &larr; Back to cases
        </button>
        <div style={{ padding: 12, background: "#fef2f2", color: "#b91c1c", borderRadius: 6 }}>
          {error}
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #e5e7eb", display: "flex", alignItems: "center", gap: 16 }}>
        <button onClick={onBack} style={{ cursor: "pointer", background: "none", border: "1px solid #d1d5db", borderRadius: 4, padding: "4px 12px" }}>
          &larr; Back
        </button>
        <span style={{ fontWeight: 600 }}>Case: {caseId}</span>
        <span style={{ color: "#6b7280", fontSize: 13 }}>Run: {runId}</span>
      </div>

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, overflow: "hidden" }}>
        {/* Left panel — Documents */}
        <div style={{ borderRight: "1px solid #e5e7eb", overflow: "auto", padding: 16 }}>
          <DocumentPanel
            documents={run?.documents ?? []}
            retrievedPolicySections={run?.retrieved_policy_sections ?? []}
            facilityId={run?.facility_id ?? ""}
            activeQuote={activeQuote}
          />
        </div>

        {/* Center panel — Analysis & Recommendation */}
        <div style={{ borderRight: "1px solid #e5e7eb", overflow: "auto", padding: 16 }}>
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
            <p style={{ color: "#6b7280" }}>Click Run Review to start.</p>
          )}
        </div>

        {/* Right panel — Run History */}
        <div style={{ overflow: "auto", padding: 16 }}>
          <RunHistoryPanel
            events={run?.events ?? []}
            isReplayResponse={run?.is_replay_response ?? false}
            onReplay={handleReplay}
          />
        </div>
      </div>
    </div>
  );
}
