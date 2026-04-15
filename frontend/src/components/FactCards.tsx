import type { CaseFacts } from "../types";
import {
  WorkbenchButton,
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
          <div
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: confidenceColor(facts.confidence),
            }}
          >
            {pct}
          </div>
        </WorkbenchField>
      </div>

      {facts.required_documents.length > 0 && (
        <WorkbenchField label="Required Documents" style={{ marginBottom: 12 }}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
            {facts.required_documents.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </WorkbenchField>
      )}

      {facts.evidence_refs.length > 0 && (
        <div>
          <div style={{ ...workbenchStyles.label, marginBottom: 8 }}>Evidence</div>
          {facts.evidence_refs.map((ref, i) => (
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
                lineHeight: 1.45,
                color: "#175cd3",
              }}
            >
              <strong>{ref.doc_id}:</strong> "{ref.quote}"
            </WorkbenchButton>
          ))}
        </div>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return <WorkbenchField label={label}>{value}</WorkbenchField>;
}
