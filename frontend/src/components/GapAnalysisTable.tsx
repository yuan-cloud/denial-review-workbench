import type { CaseFacts, CaseFindings } from "../types";

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
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Gap Analysis</h2>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
            <th style={{ textAlign: "left", padding: "6px 8px" }}>Requirement</th>
            <th style={{ textAlign: "center", padding: "6px 8px", width: 90 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.requirement} style={{ borderBottom: "1px solid #e5e7eb" }}>
              <td style={{ padding: "8px 8px" }}>{row.requirement}</td>
              <td style={{ padding: "8px 8px", textAlign: "center" }}>
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
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          <strong style={{ color: "#b91c1c" }}>Conflicts:</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
            {findings.conflicts.map((c, i) => (
              <li key={i} style={{ color: "#991b1b" }}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      {findings.evidence_refs.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: "#6b7280", fontWeight: 600, marginBottom: 4 }}>
            Evidence
          </div>
          {findings.evidence_refs.map((ref, i) => (
            <button
              key={i}
              onClick={() => onEvidenceClick(ref.doc_id, ref.quote)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "6px 10px",
                marginBottom: 4,
                border: "1px solid #d1d5db",
                borderRadius: 4,
                background: "#fff",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              <span style={{ color: "#2563eb", fontWeight: 500 }}>[{ref.doc_id}]</span>{" "}
              <span style={{ color: "#374151" }}>"{ref.quote}"</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
