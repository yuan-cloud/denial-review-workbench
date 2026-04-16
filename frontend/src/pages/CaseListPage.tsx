import { useEffect, useState } from "react";
import type { CaseListItem } from "../types";
import { getCases, postRun } from "../api";
import {
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

export default function CaseListPage({ onSelectCase }: Props) {
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [fetchingCases, setFetchingCases] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [runningCase, setRunningCase] = useState<string | null>(null);
  const [runError, setRunError] = useState<{ caseId: string; message: string } | null>(null);

  useEffect(() => {
    getCases()
      .then(setCases)
      .catch((e) => setFetchError(e instanceof Error ? e.message : String(e)))
      .finally(() => setFetchingCases(false));
  }, []);

  async function handleRun(caseId: string) {
    setRunningCase(caseId);
    setRunError(null);
    try {
      const run = await postRun(caseId);
      onSelectCase(caseId, run.run_id);
    } catch (e) {
      setRunError({ caseId, message: e instanceof Error ? e.message : String(e) });
      setRunningCase(null);
    }
  }

  return (
    <WorkbenchScreen maxWidth={1320}>
      <div style={{ display: "grid", gap: 16 }}>
        <WorkbenchPageHeader
          eyebrow="Clinical ops workbench"
          title="Denial Review Workbench"
          description="Triage queue — select a case to run denial review analysis."
          actions={
            runningCase ? (
              <WorkbenchStatusPill tone="primary">Run in progress</WorkbenchStatusPill>
            ) : null
          }
        />

        {fetchError ? (
          <WorkbenchNotice title="Failed to load cases" tone="danger">
            {fetchError}
          </WorkbenchNotice>
        ) : null}

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
          ) : cases.length === 0 && !fetchError ? (
            <WorkbenchNotice tone="neutral">
              No cases available for review. Check back later or verify the data directory.
            </WorkbenchNotice>
          ) : (
            <table style={workbenchStyles.denseTable}>
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
                      <td style={{ ...workbenchStyles.denseTableCell, ...workbenchStyles.subdued, maxWidth: 320 }}>
                        {rowError ? (
                          <span style={{ color: "#b42318", fontSize: 12 }}>{rowError}</span>
                        ) : (
                          c.summary
                        )}
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
                          {isRunning ? "Analyzing..." : "Run Review"}
                        </WorkbenchButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {runningCase ? (
            <div style={workbenchStyles.dividerTop}>
              <WorkbenchNotice tone="primary">
                Analyzing {runningCase} — this takes 10–20 seconds...
              </WorkbenchNotice>
            </div>
          ) : null}
        </WorkbenchPanel>
      </div>
    </WorkbenchScreen>
  );
}
