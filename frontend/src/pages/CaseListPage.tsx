import { useCallback, useEffect, useState } from "react";
import type { CaseListItem } from "../types";
import { ApiError, getCases, postRun } from "../api";
import {
  palette,
  WorkbenchActionBar,
  WorkbenchButton,
  WorkbenchNotice,
  WorkbenchPageHeader,
  WorkbenchPanel,
  WorkbenchScreen,
  WorkbenchSectionHeading,
  WorkbenchStatusPill,
  workbenchStyles,
} from "../ui/workbench";

const pathTypeLabel: Record<string, { text: string; tone: "success" | "warning" | "danger" }> = {
  approval: { text: "Approval", tone: "success" },
  missing_documents: { text: "Missing Docs", tone: "warning" },
  escalation: { text: "Escalation", tone: "danger" },
};

interface Props {
  onSelectCase: (caseId: string, runId: string) => void;
}

function describeQueueError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Case queue unavailable (${error.status}). Retry the queue load.`;
  }
  return error instanceof Error ? error.message : String(error);
}

function describeRunStartError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Review could not start (${error.status}). Retry Run Review.`;
  }
  return error instanceof Error ? error.message : String(error);
}

export default function CaseListPage({ onSelectCase }: Props) {
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [fetchingCases, setFetchingCases] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [runningCase, setRunningCase] = useState<string | null>(null);
  const [runError, setRunError] = useState<{ caseId: string; message: string } | null>(null);

  const loadCases = useCallback(() => {
    setFetchingCases(true);
    setFetchError(null);
    getCases()
      .then(setCases)
      .catch((e) => setFetchError(describeQueueError(e)))
      .finally(() => setFetchingCases(false));
  }, []);

  useEffect(() => {
    loadCases();
  }, [loadCases]);

  async function handleRun(caseId: string) {
    setRunningCase(caseId);
    setRunError(null);
    try {
      const run = await postRun(caseId);
      onSelectCase(caseId, run.run_id);
    } catch (e) {
      setRunError({ caseId, message: describeRunStartError(e) });
      setRunningCase(null);
    }
  }

  return (
    <WorkbenchScreen maxWidth={1320}>
      <div style={{ display: "grid", gap: 16 }}>
        <WorkbenchPageHeader
          eyebrow="Clinical ops workbench"
          title="Denial Review Workbench"
          description="Triage queue. Select a case to run denial review analysis."
          actions={
            runningCase ? (
              <WorkbenchStatusPill tone="primary">Run in progress</WorkbenchStatusPill>
            ) : null
          }
        />

        <WorkbenchPanel>
          <WorkbenchSectionHeading
            title="Case Queue"
            description={
              fetchingCases
                ? "Loading cases…"
                : `${cases.length} case${cases.length !== 1 ? "s" : ""} available for review.`
            }
          />

          {fetchingCases ? (
            <WorkbenchNotice>Loading case queue…</WorkbenchNotice>
          ) : fetchError ? (
            <div style={{ display: "grid", gap: 12 }}>
              <WorkbenchNotice title="Case queue unavailable" tone="danger">
                The queue could not be loaded. Retry the queue load before starting a review.
                <div style={{ marginTop: 6 }}>{fetchError}</div>
              </WorkbenchNotice>
              <WorkbenchActionBar>
                <WorkbenchButton onClick={loadCases} size="sm" variant="primary">
                  Retry case queue
                </WorkbenchButton>
              </WorkbenchActionBar>
            </div>
          ) : cases.length === 0 && !fetchError ? (
            <WorkbenchNotice tone="neutral">
              No cases available. Verify the data directory contains case packets.
            </WorkbenchNotice>
          ) : (
            <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ ...workbenchStyles.denseTable, minWidth: 700 }}>
              <thead>
                <tr style={workbenchStyles.denseTableHead}>
                  <th style={workbenchStyles.denseTableHeaderCell}>Case</th>
                  <th style={workbenchStyles.denseTableHeaderCell}>Facility</th>
                  <th style={workbenchStyles.denseTableHeaderCell}>Scenario</th>
                  <th style={workbenchStyles.denseTableHeaderCell}>Path</th>
                  <th style={workbenchStyles.denseTableHeaderCell}>Summary</th>
                  <th style={{ ...workbenchStyles.denseTableHeaderCell, textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {cases.map((c) => {
                  const pathInfo = pathTypeLabel[c.expected_path_type];
                  const isRunning = runningCase === c.case_id;
                  const rowError = runError?.caseId === c.case_id ? runError.message : null;
                  return (
                    <tr key={c.case_id}>
                      <td style={{ ...workbenchStyles.denseTableCell, ...workbenchStyles.mono, whiteSpace: "nowrap" }}>
                        {c.case_id}
                      </td>
                      <td style={{ ...workbenchStyles.denseTableCell, ...workbenchStyles.mono, whiteSpace: "nowrap" }}>
                        {c.facility_id}
                      </td>
                      <td style={{ ...workbenchStyles.denseTableCell, fontWeight: 600 }}>
                        {c.scenario_title}
                      </td>
                      <td style={{ ...workbenchStyles.denseTableCell, whiteSpace: "nowrap" }}>
                        {pathInfo ? (
                          <WorkbenchStatusPill tone={pathInfo.tone}>{pathInfo.text}</WorkbenchStatusPill>
                        ) : (
                          c.expected_path_type
                        )}
                      </td>
                      <td style={{ ...workbenchStyles.denseTableCell, maxWidth: 320 }}>
                        <div style={{ display: "grid", gap: rowError ? 6 : 0 }}>
                          <span style={workbenchStyles.subdued}>{c.summary}</span>
                          {rowError ? (
                            <span style={{ color: palette.danger, fontSize: 12 }}>{rowError}</span>
                          ) : null}
                        </div>
                      </td>
                      <td
                        style={{
                          ...workbenchStyles.denseTableCell,
                          textAlign: "right",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <WorkbenchButton
                          onClick={() => handleRun(c.case_id)}
                          disabled={isRunning}
                          size="sm"
                        >
                          {isRunning ? "Analyzing\u2026" : "Run Review"}
                        </WorkbenchButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}

          {runningCase ? (
            <div style={workbenchStyles.dividerTop}>
              <WorkbenchNotice tone="primary">
                Analyzing {runningCase}. Typically 10–20 seconds.
              </WorkbenchNotice>
            </div>
          ) : null}
        </WorkbenchPanel>
      </div>
    </WorkbenchScreen>
  );
}
