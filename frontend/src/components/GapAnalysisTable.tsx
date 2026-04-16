import type { CaseFacts, CaseFindings } from "../types";
import {
  WorkbenchNotice,
  WorkbenchSectionHeading,
  workbenchStyles,
} from "../ui/workbench";

interface Props {
  facts: CaseFacts | null;
  findings: CaseFindings | null;
  onEvidenceClick: (docId: string, quote: string) => void;
}

function formatDocLabel(docId: string): string {
  return docId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function GapAnalysisTable({ facts, findings, onEvidenceClick }: Props) {
  if (!facts || !findings) {
    return (
      <div style={{ marginBottom: 20 }}>
        <WorkbenchSectionHeading
          title="Gap Analysis"
          description="Required-document coverage against the analyzed case packet."
        />
        <WorkbenchNotice tone="neutral">
          Gap analysis has not been completed yet. Results will appear here after the analysis step finishes.
        </WorkbenchNotice>
      </div>
    );
  }

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

      {rows.length === 0 ? (
        <div style={{ fontSize: 13, ...workbenchStyles.subdued, padding: "8px 0" }}>
          No document requirements identified.
        </div>
      ) : (
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
      )}

      {findings.conflicts.length > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderLeft: "3px solid #dc2626",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "#b42318",
              marginBottom: 4,
            }}
          >
            Conflicts
          </div>
          {findings.conflicts.map((c, i) => (
            <div
              key={i}
              style={{
                fontSize: 13,
                color: "#b42318",
                lineHeight: 1.45,
                marginTop: i > 0 ? 4 : 0,
              }}
            >
              {c}
            </div>
          ))}
        </div>
      )}

      {findings.appeal_basis && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            borderLeft: "3px solid #2563eb",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "#175cd3",
              marginBottom: 4,
            }}
          >
            Appeal Basis
          </div>
          <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.45 }}>
            {findings.appeal_basis}
          </div>
        </div>
      )}

      {findings.evidence_refs.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ ...workbenchStyles.label, marginBottom: 4 }}>Evidence</div>
          <div style={{ display: "grid", gap: 2 }}>
            {findings.evidence_refs.map((ref, i) => (
              <button
                key={i}
                onClick={() => onEvidenceClick(ref.doc_id, ref.quote)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  background: "none",
                  border: "none",
                  padding: "4px 0",
                  fontSize: 12,
                  lineHeight: 1.45,
                  color: "#667085",
                  cursor: "pointer",
                }}
              >
                <span style={{ color: "#2563eb", fontWeight: 500 }}>
                  [{formatDocLabel(ref.doc_id)}]
                </span>{" "}
                <span>&ldquo;{ref.quote}&rdquo;</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
