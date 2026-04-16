import type { CaseFacts } from "../types";
import {
  WorkbenchField,
  WorkbenchSectionHeading,
  workbenchStyles,
} from "../ui/workbench";

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

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.7) return "Medium";
  return "Low";
}

export default function FactCards({ facts, onEvidenceClick }: Props) {
  if (!facts) return null;

  const pct = (facts.confidence * 100).toFixed(0) + "%";

  return (
    <div style={{ marginBottom: 20 }}>
      <WorkbenchSectionHeading
        title="Extracted Facts"
        description="Structured outputs from the first model pass."
        sticky
      />

      <div style={{ ...workbenchStyles.cardGrid, marginBottom: 12 }}>
        <Card label="Payer" value={facts.payer} />
        <Card label="Service" value={facts.service_requested} />
        <Card label="Denial Reason" value={facts.denial_reason} />
        <WorkbenchField
          label="Confidence"
          style={{ background: confidenceBg(facts.confidence) }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span
              style={{
                fontSize: 18,
                fontWeight: 700,
                color: confidenceColor(facts.confidence),
              }}
            >
              {pct}
            </span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: confidenceColor(facts.confidence),
              }}
            >
              {confidenceLabel(facts.confidence)}
            </span>
          </div>
        </WorkbenchField>
      </div>

      {facts.evidence_refs.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ ...workbenchStyles.label, marginBottom: 4 }}>Evidence</div>
          <div style={{ display: "grid", gap: 2 }}>
            {facts.evidence_refs.map((ref, i) => (
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
                  {ref.doc_id}
                </span>
                {" — "}
                <span>&ldquo;{ref.quote}&rdquo;</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return <WorkbenchField label={label}>{value}</WorkbenchField>;
}
