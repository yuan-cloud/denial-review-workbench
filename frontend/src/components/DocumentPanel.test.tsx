import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import DocumentPanel from "./DocumentPanel";
import type { CaseDocument } from "../types";

const sampleDocs: CaseDocument[] = [
  { doc_id: "denial-letter", type: "denial_letter", text: "Your request for physical therapy has been denied." },
  { doc_id: "auth-request", type: "auth_request", text: "Authorization request for PT services." },
];

describe("DocumentPanel", () => {
  it("renders human-readable document titles", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="facility-a"
        activeQuote={null}
      />
    );
    expect(screen.getByRole("heading", { name: "Denial Letter" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Authorization Request" })).toBeInTheDocument();
  });

  it("renders document text", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="facility-a"
        activeQuote={null}
      />
    );
    expect(screen.getByText(/physical therapy has been denied/)).toBeInTheDocument();
  });

  it("surfaces policy metadata in the panel header", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={["Section A: Coverage rules"]}
        facilityId="facility-a"
        activeQuote={null}
      />
    );
    expect(screen.getByText("Facility A")).toBeInTheDocument();
    expect(screen.getByText("1 policy excerpt")).toBeInTheDocument();
  });

  it("highlights active quote in matching document", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="facility-a"
        activeQuote={{ doc_id: "denial-letter", quote: "physical therapy" }}
      />
    );
    expect(screen.getByText(/Evidence focus — Denial Letter/)).toBeInTheDocument();
    expect(screen.getByText(/referenced text is highlighted/i)).toBeInTheDocument();
    const mark = document.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("physical therapy");
  });

  it("falls back to case-insensitive evidence matching", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="facility-a"
        activeQuote={{ doc_id: "denial-letter", quote: "PHYSICAL THERAPY" }}
      />
    );
    const mark = document.querySelector("mark");
    expect(mark).not.toBeNull();
    expect(mark!.textContent).toBe("physical therapy");
  });

  it("shows a non-destructive warning when the quote is not found", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="facility-a"
        activeQuote={{ doc_id: "denial-letter", quote: "nonexistent text" }}
      />
    );
    expect(screen.getByText(/could not be matched exactly/i)).toBeInTheDocument();
    expect(
      screen.getByText("Your request for physical therapy has been denied.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/quote not found/i)).not.toBeInTheDocument();
  });

  it("renders policy sections", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={["Section A: Coverage rules", "Section B: Appeals"]}
        facilityId="facility-a"
        activeQuote={null}
      />
    );
    expect(screen.getByText("Policy Excerpts")).toBeInTheDocument();
    expect(screen.getByText("Policy excerpt 1")).toBeInTheDocument();
    expect(screen.getByText("Section A: Coverage rules")).toBeInTheDocument();
    expect(screen.getByText("Section B: Appeals")).toBeInTheDocument();
  });

  it("hides policy sections when empty", () => {
    render(
      <DocumentPanel
        documents={sampleDocs}
        retrievedPolicySections={[]}
        facilityId="facility-a"
        activeQuote={null}
      />
    );
    expect(screen.queryByText("Policy Excerpts")).not.toBeInTheDocument();
  });
});
