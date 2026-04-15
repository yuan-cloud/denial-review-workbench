import type { CaseFacts, CaseFindings } from "../types";
import {
  WorkbenchButton,
  WorkbenchNotice,
  WorkbenchSectionHeading,
  workbenchStyles,
} from "../ui/workbench";

interface Props {
  facts: CaseFacts | null;
  findings: CaseFindings | null;
  onEvidenceClick: (docId: string, quote: string) => void;
}

export default function GapAnalysisTable({ facts, findings, onEvidenceClick }: Props) {
  if (!facts || !findings) return null;

  const rows = facts.required_documents.map((req) => {
    const isMissing = findings.missing_items.some(
      (m) => m.toLowerCase() === req.toLowerCase()
    );
    return { requirement: req, present: !isMissing };
  });

  return (
    <div style={{ marginBottom: 20 }}>
      <WorkbenchSectionHeading
        title="Gap Analysis"
        description="Required-document coverage against the analyzed case packet."
      />

      <table style={workbenchStyles.denseTable}>
        <thead>
          <tr style={workbenchStyles.denseTableHead}>
            <th style={workbenchStyles.denseTableHeaderCell}>Requirement</th>
            <th
              style={{
                ...workbenchStyles.denseTableHeaderCell,
                textAlign: "center",
                width: 90,
              }}
            >
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.requirement}>
              <td style={workbenchStyles.denseTableCell}>{row.requirement}</td>
              <td
                style={{
                  ...workbenchStyles.denseTableCell,
                  textAlign: "center",
                }}
              >
                {row.present ? (
                  <span style={{ color: "#16a34a", fontWeight: 600 }}>Present</span>
                ) : (
                  <span style={{ color: "#dc2626", fontWeight: 600 }}>Missing</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {findings.conflicts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <WorkbenchNotice title="Conflicts:" tone="danger">
            <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
              {findings.conflicts.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </WorkbenchNotice>
        </div>
      )}

      {findings.evidence_refs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...workbenchStyles.label, marginBottom: 8 }}>Evidence</div>
          {findings.evidence_refs.map((ref, i) => (
            <WorkbenchButton
              key={i}
              onClick={() => onEvidenceClick(ref.doc_id, ref.quote)}
              variant="secondary"
              size="sm"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                marginBottom: 4,
                fontSize: 13,
                lineHeight: 1.45,
              }}
            >
              <span style={{ color: "#2563eb", fontWeight: 500 }}>[{ref.doc_id}]</span>{" "}
              <span style={{ color: "#374151" }}>"{ref.quote}"</span>
            </WorkbenchButton>
          ))}
        </div>
      )}
    </div>
  );
}
