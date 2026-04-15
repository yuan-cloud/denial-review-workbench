import type { CaseDocument } from "../types";

interface Props {
  documents: CaseDocument[];
  retrievedPolicySections: string[];
  facilityId: string;
  activeQuote: { doc_id: string; quote: string } | null;
}

function highlightText(text: string, quote: string): React.ReactNode {
  const idx = text.indexOf(quote);
  if (idx === -1) {
    console.warn("Evidence quote not found in document text:", quote);
    return (
      <>
        {text}
        <span title="Quote not found in document" style={{ fontSize: 11, color: "#b45309", marginLeft: 4 }}>
          ⚠ quote not found
        </span>
      </>
    );
  }
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ backgroundColor: "#fef08a" }}>{quote}</mark>
      {text.slice(idx + quote.length)}
    </>
  );
}

export default function DocumentPanel({
  documents,
  retrievedPolicySections,
  facilityId,
  activeQuote,
}: Props) {
  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Documents</h2>

      {documents.map((doc) => (
        <div key={doc.doc_id} id={`doc-${doc.doc_id}`} style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>
            {doc.doc_id.replace(/-/g, " ")}
          </h3>
          <div style={{ fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "#1f2937" }}>
            {activeQuote && activeQuote.doc_id === doc.doc_id
              ? highlightText(doc.text, activeQuote.quote)
              : doc.text}
          </div>
        </div>
      ))}

      {retrievedPolicySections.length > 0 && (
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid #e5e7eb" }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, color: "#374151", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 8 }}>
            Policy Sections
          </h3>
          {retrievedPolicySections.map((section, i) => (
            <div key={i} style={{ fontSize: 13, lineHeight: 1.5, color: "#4b5563", marginBottom: 8, paddingLeft: 8, borderLeft: "2px solid #d1d5db" }}>
              {section}
            </div>
          ))}
        </div>
      )}

      {facilityId && (
        <p style={{ marginTop: 16, fontSize: 12, color: "#9ca3af" }}>
          Policy pack: {facilityId}
        </p>
      )}
    </div>
  );
}
