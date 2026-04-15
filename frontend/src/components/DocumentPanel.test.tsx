import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import DocumentPanel from "./DocumentPanel";
import type { CaseDocument } from "../types";

const sampleDocs: CaseDocument[] = [
  { doc_id: "denial-letter", type: "denial_letter", text: "Your request for physical therapy has been denied." },
  { doc_id: "auth-request", type: "auth_request", text: "Authorization request for PT services." },
];

describe("DocumentPanel", () => {
  it("renders document titles", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="fac-1"
        activeQuote={null}
      />
    );
    expect(screen.getByText("denial letter")).toBeInTheDocument();
    expect(screen.getByText("auth request")).toBeInTheDocument();
  });

  it("renders document text", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="fac-1"
        activeQuote={null}
      />
    );
    expect(screen.getByText(/physical therapy has been denied/)).toBeInTheDocument();
  });

  it("highlights active quote in matching document", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="fac-1"
        activeQuote={{ doc_id: "denial-letter", quote: "physical therapy" }}
      />
    );
    const mark = document.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("physical therapy");
  });

  it("falls back to case-insensitive evidence matching", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="fac-1"
        activeQuote={{ doc_id: "denial-letter", quote: "PHYSICAL THERAPY" }}
      />
    );
    const mark = document.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("physical therapy");
  });

  it("shows warning when quote not found", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="fac-1"
        activeQuote={{ doc_id: "denial-letter", quote: "nonexistent text" }}
      />
    );
    expect(screen.getByText(/quote not found/)).toBeInTheDocument();
  });

  it("renders policy sections", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={["Section A: Coverage rules", "Section B: Appeals"]}
        facilityId="fac-1"
        activeQuote={null}
      />
    );
    expect(screen.getByText("Policy Sections")).toBeInTheDocument();
    expect(screen.getByText("Section A: Coverage rules")).toBeInTheDocument();
    expect(screen.getByText("Section B: Appeals")).toBeInTheDocument();
  });

  it("hides policy sections when empty", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="fac-1"
        activeQuote={null}
      />
    );
    expect(screen.queryByText("Policy Sections")).not.toBeInTheDocument();
  });

  it("renders facility id", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="fac-1"
        activeQuote={null}
      />
    );
    expect(screen.getByText(/Policy pack: fac-1/)).toBeInTheDocument();
  });
});
