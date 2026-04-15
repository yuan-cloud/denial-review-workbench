import type { ReactNode } from "react";
import type { CaseDocument } from "../types";
import {
  WorkbenchField,
  WorkbenchSectionHeading,
  workbenchStyles,
} from "../ui/workbench";

interface Props {
  documents: CaseDocument[];
  retrievedPolicySections: string[];
  facilityId: string;
  activeQuote: { doc_id: string; quote: string } | null;
}

function highlightText(text: string, quote: string): ReactNode {
  let idx = text.indexOf(quote);
  let matchedQuote = quote;

  if (idx === -1) {
    idx = text.toLowerCase().indexOf(quote.toLowerCase());
    if (idx !== -1) {
      matchedQuote = text.slice(idx, idx + quote.length);
    }
  }

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
      <mark style={{ backgroundColor: "#fef08a" }}>{matchedQuote}</mark>
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
      <WorkbenchSectionHeading
        title="Documents"
        description="Source documents and retrieved policy excerpts."
        sticky
      />

      <div style={workbenchStyles.stack}>
        {documents.map((doc) => (
          <div key={doc.doc_id} id={`doc-${doc.doc_id}`}>
            <WorkbenchField
              label={doc.doc_id.replace(/-/g, " ")}
              style={
                activeQuote?.doc_id === doc.doc_id
                  ? { borderColor: "#b8c3d3", background: "#f8fafc" }
                  : undefined
              }
            >
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.65,
                  whiteSpace: "pre-wrap",
                }}
              >
                {activeQuote && activeQuote.doc_id === doc.doc_id
                  ? highlightText(doc.text, activeQuote.quote)
                  : doc.text}
              </div>
            </WorkbenchField>
          </div>
        ))}
      </div>

      {retrievedPolicySections.length > 0 && (
        <div style={workbenchStyles.dividerTop}>
          <WorkbenchSectionHeading
            title="Policy Sections"
            description="Retrieved policy text from the active facility pack."
          />
          {retrievedPolicySections.map((section, i) => (
            <WorkbenchField key={i} label={`Section ${i + 1}`} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>
                {section}
              </div>
            </WorkbenchField>
          ))}
        </div>
      )}

      {facilityId && (
        <p style={{ marginTop: 16, fontSize: 12, ...workbenchStyles.subtle }}>
          Policy pack: {facilityId}
        </p>
      )}
    </div>
  );
}
