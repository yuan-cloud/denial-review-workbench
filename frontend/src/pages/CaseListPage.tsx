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
    <WorkbenchScreen maxWidth={1320}>
      <div style={{ display: "grid", gap: 16 }}>
        <WorkbenchPageHeader
          eyebrow="Clinical ops workbench"
          title="Denial Review Workbench"
          description="Triage queue — select a case to run denial review analysis."
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
            description={`${cases.length} cases available for review.`}
          />

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
                      {c.summary}
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
                        disabled={loading !== null}
                        size="sm"
                      >
                        {loading === c.case_id ? "Analyzing..." : "Run Review"}
                      </WorkbenchButton>
                    </td>
                  </tr>
                );
              })}
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
