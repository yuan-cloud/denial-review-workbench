import type { ReactNode } from "react";
import type { CaseDocument } from "../types";
import {
  palette,
  WorkbenchNotice,
  WorkbenchSectionHeading,
  WorkbenchStatusPill,
  workbenchStyles,
} from "../ui/workbench";

interface Props {
  documents: CaseDocument[];
  retrievedPolicySections: string[];
  facilityId: string;
  activeQuote: { doc_id: string; quote: string } | null;
}

type QuoteMatch =
  | { status: "matched"; index: number; matchedQuote: string }
  | { status: "missing" };

const DOCUMENT_META: Record<
  CaseDocument["type"],
  { title: string; description: string }
> = {
  denial_letter: {
    title: "Denial Letter",
    description: "Payer determination and stated denial rationale.",
  },
  auth_request: {
    title: "Authorization Request",
    description: "Submitted service request and payer context.",
  },
  clinical_notes: {
    title: "Clinical Notes",
    description: "Supporting clinical documentation from the case packet.",
  },
};

function formatFacilityLabel(facilityId: string): string {
  return facilityId
    .split("-")
    .map((part) =>
      part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)
    )
    .join(" ");
}

function findQuoteMatch(text: string, quote: string): QuoteMatch {
  let idx = text.indexOf(quote);
  let matchedQuote = quote;

  if (idx === -1) {
    idx = text.toLowerCase().indexOf(quote.toLowerCase());
    if (idx !== -1) {
      matchedQuote = text.slice(idx, idx + quote.length);
    }
  }

  if (idx === -1) {
    return { status: "missing" };
  }

  return { status: "matched", index: idx, matchedQuote };
}

function highlightText(text: string, match: QuoteMatch): ReactNode {
  if (match.status === "missing") {
    return text;
  }

  return (
    <>
      {text.slice(0, match.index)}
      <mark style={{ backgroundColor: palette.highlight }}>{match.matchedQuote}</mark>
      {text.slice(match.index + match.matchedQuote.length)}
    </>
  );
}

export default function DocumentPanel({
  documents,
  retrievedPolicySections,
  facilityId,
  activeQuote,
}: Props) {
  const policyPackLabel = facilityId ? formatFacilityLabel(facilityId) : null;
  const activeDocument = activeQuote
    ? documents.find((doc) => doc.doc_id === activeQuote.doc_id) ?? null
    : null;
  const activeDocumentMeta = activeDocument
    ? DOCUMENT_META[activeDocument.type]
    : null;
  const activeMatch =
    activeDocument && activeQuote
      ? findQuoteMatch(activeDocument.text, activeQuote.quote)
      : null;
  const policySectionCount = retrievedPolicySections.length;

  return (
    <div>
      <WorkbenchSectionHeading
        title="Documents"
        description="Human-readable source packet with linked policy excerpts."
        sticky
        badge={
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {policyPackLabel ? (
              <WorkbenchStatusPill tone="neutral">{policyPackLabel}</WorkbenchStatusPill>
            ) : null}
            {policySectionCount > 0 ? (
              <WorkbenchStatusPill tone="neutral">
                {policySectionCount} policy excerpt{policySectionCount === 1 ? "" : "s"}
              </WorkbenchStatusPill>
            ) : null}
          </div>
        }
      />

      {activeQuote && activeDocumentMeta ? (
        <div style={{ marginBottom: 12 }}>
          <WorkbenchNotice
            title={`Evidence focus: ${activeDocumentMeta.title}`}
            tone={activeMatch?.status === "missing" ? "warning" : "primary"}
          >
            <div style={{ display: "grid", gap: 6 }}>
              <div>
                {activeMatch?.status === "missing"
                  ? "Jumped to the cited source, but the quoted text was not found verbatim. Review the source text manually below."
                  : "Jumped to the cited source. The referenced text is highlighted in the document below."}
              </div>
              <div style={{ ...workbenchStyles.mono, fontSize: 11 }}>
                Evidence quote: "{activeQuote.quote}"
              </div>
            </div>
          </WorkbenchNotice>
        </div>
      ) : null}

      <div style={workbenchStyles.stack}>
        {documents.map((doc) => {
          const docMeta = DOCUMENT_META[doc.type];
          const isActive = activeQuote?.doc_id === doc.doc_id;
          const quoteMatch =
            isActive && activeQuote ? findQuoteMatch(doc.text, activeQuote.quote) : null;
          const quoteMissing = quoteMatch?.status === "missing";

          return (
            <section
              key={doc.doc_id}
              id={`doc-${doc.doc_id}`}
              style={{
                border: `1px solid ${isActive ? palette.borderStrong : palette.border}`,
                borderRadius: 12,
                background: isActive ? palette.surfaceMuted : palette.surface,
                boxShadow: "0 1px 2px rgba(16, 24, 40, 0.04)",
                padding: 14,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={workbenchStyles.eyebrow}>Case document</div>
                  <h3 style={{ ...workbenchStyles.title, margin: "6px 0 0", fontSize: 16 }}>
                    {docMeta.title}
                  </h3>
                  <div style={{ ...workbenchStyles.description, marginTop: 4 }}>
                    {docMeta.description}
                  </div>
                </div>
                {isActive ? (
                  <WorkbenchStatusPill tone={quoteMissing ? "warning" : "primary"}>
                    {quoteMissing ? "Review quote" : "Evidence focus"}
                  </WorkbenchStatusPill>
                ) : null}
              </div>

              {quoteMissing ? (
                <div style={{ marginBottom: 12 }}>
                  <WorkbenchNotice tone="warning">
                    The cited quote could not be matched exactly in this source. The
                    document text is unchanged so you can review the original wording.
                  </WorkbenchNotice>
                </div>
              ) : null}

              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.65,
                  whiteSpace: "pre-wrap",
                }}
              >
                {isActive && quoteMatch ? highlightText(doc.text, quoteMatch) : doc.text}
              </div>
            </section>
          );
        })}
      </div>

      {retrievedPolicySections.length > 0 && (
        <div style={workbenchStyles.dividerTop}>
          <WorkbenchSectionHeading
            title="Policy Excerpts"
            description={
              policyPackLabel
                ? `Retrieved policy text from the ${policyPackLabel} pack.`
                : "Retrieved policy text from the active facility pack."
            }
          />
          <div style={workbenchStyles.stack}>
            {retrievedPolicySections.map((section, i) => (
              <div
                key={i}
                style={{ fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap" }}
              >
                <section
                  style={{
                    border: `1px solid ${palette.border}`,
                    borderRadius: 12,
                    background: palette.surfaceMuted,
                    padding: 14,
                  }}
                >
                  <div style={{ ...workbenchStyles.label, marginBottom: 8 }}>
                    Policy excerpt {i + 1}
                  </div>
                  {section}
                </section>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
