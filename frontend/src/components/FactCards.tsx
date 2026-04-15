import type { CaseFacts } from "../types";

interface Props {
  facts: CaseFacts | null;
  onEvidenceClick: (docId: string, quote: string) => void;
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.8) return "#16a34a";
  if (confidence >= 0.7) return "#ca8a04";
  return "#dc2626";
}

function confidenceBg(confidence: number): string {
  if (confidence >= 0.8) return "#f0fdf4";
  if (confidence >= 0.7) return "#fefce8";
  return "#fef2f2";
}

export default function FactCards({ facts, onEvidenceClick }: Props) {
  if (!facts) return null;

  const pct = (facts.confidence * 100).toFixed(0) + "%";

  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Extracted Facts</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <Card label="Payer" value={facts.payer} />
        <Card label="Service" value={facts.service_requested} />
        <Card label="Denial Reason" value={facts.denial_reason} />
        <div style={{
          padding: "8px 12px",
          border: "1px solid #e5e7eb",
          borderRadius: 6,
          background: confidenceBg(facts.confidence),
        }}>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>Confidence</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: confidenceColor(facts.confidence) }}>{pct}</div>
        </div>
      </div>

      {facts.required_documents.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Required Documents</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {facts.required_documents.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {facts.evidence_refs.length > 0 && (
        <div>
          <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>Evidence</div>
          {facts.evidence_refs.map((ref, i) => (
            <button
              key={i}
              onClick={() => onEvidenceClick(ref.doc_id, ref.quote)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "4px 8px",
                marginBottom: 4,
                fontSize: 12,
                color: "#2563eb",
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 4,
                cursor: "pointer",
              }}
            >
              <strong>{ref.doc_id}:</strong> "{ref.quote}"
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: "8px 12px", border: "1px solid #e5e7eb", borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14 }}>{value}</div>
    </div>
  );
}
