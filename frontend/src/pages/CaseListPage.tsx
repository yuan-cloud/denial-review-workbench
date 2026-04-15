import { useEffect, useState } from "react";
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

interface Props {
  onSelectCase: (caseId: string, runId: string) => void;
}

export default function CaseListPage({ onSelectCase }: Props) {
  const [cases, setCases] = useState<{ case_id: string }[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCases().then(setCases).catch((e) => setError(e.message));
  }, []);

  async function handleRun(caseId: string) {
    setLoading(caseId);
    setError(null);
    try {
      const run = await postRun(caseId);
      onSelectCase(caseId, run.run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setLoading(null);
    }
  }

  return (
    <WorkbenchScreen maxWidth={1120}>
      <div style={{ display: "grid", gap: 16 }}>
        <WorkbenchPageHeader
          eyebrow="Clinical ops workbench"
          title="Denial Review Workbench"
          description="Select a case to review."
          actions={
            loading ? (
              <WorkbenchStatusPill tone="primary">Run in progress</WorkbenchStatusPill>
            ) : null
          }
        />

        {error ? (
          <WorkbenchNotice title="Request failed" tone="danger">
            {error}
          </WorkbenchNotice>
        ) : null}

        <WorkbenchPanel>
          <WorkbenchSectionHeading
            title="Case Queue"
            description="Launch a denial review run for a synthetic case packet."
          />

          <table style={workbenchStyles.denseTable}>
            <thead>
              <tr style={workbenchStyles.denseTableHead}>
                <th style={workbenchStyles.denseTableHeaderCell}>Case ID</th>
                <th style={workbenchStyles.denseTableHeaderCell}>Action</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((c) => (
                <tr key={c.case_id}>
                  <td style={{ ...workbenchStyles.denseTableCell, ...workbenchStyles.mono }}>
                    {c.case_id}
                  </td>
                  <td
                    style={{
                      ...workbenchStyles.denseTableCell,
                      textAlign: "right",
                      width: 140,
                    }}
                  >
                    <WorkbenchButton
                      onClick={() => handleRun(c.case_id)}
                      disabled={loading !== null}
                      variant="primary"
                      size="sm"
                    >
                      {loading === c.case_id ? "Analyzing..." : "Run Review"}
                    </WorkbenchButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {loading ? (
            <div style={workbenchStyles.dividerTop}>
              <WorkbenchNotice tone="primary">
                Analyzing case — this takes 10–20 seconds...
              </WorkbenchNotice>
            </div>
          ) : null}
        </WorkbenchPanel>
      </div>
    </WorkbenchScreen>
  );
}
