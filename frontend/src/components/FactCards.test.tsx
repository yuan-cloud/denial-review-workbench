import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import FactCards from "./FactCards";
import type { CaseFacts } from "../types";

const baseFacts: CaseFacts = {
  payer: "Acme Health",
  service_requested: "Physical Therapy",
  denial_reason: "Not medically necessary",
  required_documents: ["physician order", "progress notes"],
  confidence: 0.85,
  evidence_refs: [],
};

describe("FactCards", () => {
  it("shows pending state when facts is null", () => {
    render(<FactCards facts={null} onEvidenceClick={() => {}} />);
    expect(screen.getByText("Extracted Facts")).toBeInTheDocument();
    expect(screen.getByText(/facts have not been extracted yet/i)).toBeInTheDocument();
  });

  it("renders payer, service, and denial reason", () => {
    render(<FactCards facts={baseFacts} onEvidenceClick={() => {}} />);
    expect(screen.getByText("Acme Health")).toBeInTheDocument();
    expect(screen.getByText("Physical Therapy")).toBeInTheDocument();
    expect(screen.getByText("Not medically necessary")).toBeInTheDocument();
  });

  it("renders confidence percentage", () => {
    render(<FactCards facts={baseFacts} onEvidenceClick={() => {}} />);
    expect(screen.getByText("85%")).toBeInTheDocument();
  });

  it("shows contextual confidence label for high confidence", () => {
    render(<FactCards facts={baseFacts} onEvidenceClick={() => {}} />);
    expect(screen.getByText("High")).toBeInTheDocument();
  });

  it("shows Medium label for mid-range confidence", () => {
    const facts = { ...baseFacts, confidence: 0.75 };
    render(<FactCards facts={facts} onEvidenceClick={() => {}} />);
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
  });

  it("shows Low label for low confidence", () => {
    const facts = { ...baseFacts, confidence: 0.5 };
    render(<FactCards facts={facts} onEvidenceClick={() => {}} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("Low")).toBeInTheDocument();
  });

  it("renders evidence refs as clickable elements", async () => {
    const onClick = vi.fn();
    const facts: CaseFacts = {
      ...baseFacts,
      evidence_refs: [{ doc_id: "denial-letter", quote: "some quote" }],
    };
    render(<FactCards facts={facts} onEvidenceClick={onClick} />);

    const btn = screen.getByRole("button", { name: /some quote/i });
    expect(btn).toBeInTheDocument();

    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledWith("denial-letter", "some quote");
  });

  it("shows human-readable doc label in evidence ref", () => {
    const facts: CaseFacts = {
      ...baseFacts,
      evidence_refs: [{ doc_id: "denial-letter", quote: "relevant text" }],
    };
    render(<FactCards facts={facts} onEvidenceClick={() => {}} />);
    expect(screen.getByText("Denial Letter")).toBeInTheDocument();
  });

  it("applies green color for high confidence", () => {
    const facts = { ...baseFacts, confidence: 0.9 };
    render(<FactCards facts={facts} onEvidenceClick={() => {}} />);
    expect(screen.getByText("90%")).toBeInTheDocument();
  });

  it("applies red color for low confidence", () => {
    const facts = { ...baseFacts, confidence: 0.5 };
    render(<FactCards facts={facts} onEvidenceClick={() => {}} />);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });
});
