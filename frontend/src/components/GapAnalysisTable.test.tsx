import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import GapAnalysisTable from "./GapAnalysisTable";
import type { CaseFacts, CaseFindings } from "../types";

const baseFacts: CaseFacts = {
  payer: "Acme",
  service_requested: "PT",
  denial_reason: "denied",
  required_documents: ["physician order", "progress notes"],
  confidence: 0.85,
  evidence_refs: [],
};

const baseFindings: CaseFindings = {
  missing_items: ["progress notes"],
  conflicts: [],
  appeal_basis: null,
  should_escalate: false,
  evidence_refs: [],
};

describe("GapAnalysisTable", () => {
  it("shows pending state when facts is null", () => {
    render(
      <GapAnalysisTable facts={null} findings={baseFindings} onEvidenceClick={() => {}} />
    );
    expect(screen.getByText("Gap Analysis")).toBeInTheDocument();
    expect(screen.getByText(/gap analysis has not been completed yet/i)).toBeInTheDocument();
  });

  it("shows pending state when findings is null", () => {
    render(
      <GapAnalysisTable facts={baseFacts} findings={null} onEvidenceClick={() => {}} />
    );
    expect(screen.getByText("Gap Analysis")).toBeInTheDocument();
    expect(screen.getByText(/gap analysis has not been completed yet/i)).toBeInTheDocument();
  });

  it("renders requirement rows", () => {
    render(
      <GapAnalysisTable facts={baseFacts} findings={baseFindings} onEvidenceClick={() => {}} />
    );
    expect(screen.getByText("physician order")).toBeInTheDocument();
    expect(screen.getByText("progress notes")).toBeInTheDocument();
  });

  it("marks present items green and missing items red", () => {
    render(
      <GapAnalysisTable facts={baseFacts} findings={baseFindings} onEvidenceClick={() => {}} />
    );
    expect(screen.getByText("Present")).toBeInTheDocument();
    expect(screen.getByText("Missing")).toBeInTheDocument();
  });

  it("shows conflicts when present", () => {
    const findings = { ...baseFindings, conflicts: ["Conflicting info about dates"] };
    render(
      <GapAnalysisTable facts={baseFacts} findings={findings} onEvidenceClick={() => {}} />
    );
    expect(screen.getByText("Conflicts")).toBeInTheDocument();
    expect(screen.getByText("Conflicting info about dates")).toBeInTheDocument();
  });

  it("hides conflicts section when empty", () => {
    render(
      <GapAnalysisTable facts={baseFacts} findings={baseFindings} onEvidenceClick={() => {}} />
    );
    expect(screen.queryByText("Conflicts")).not.toBeInTheDocument();
  });

  it("shows appeal basis when present", () => {
    const findings = { ...baseFindings, appeal_basis: "Medical necessity supported by clinical notes" };
    render(
      <GapAnalysisTable facts={baseFacts} findings={findings} onEvidenceClick={() => {}} />
    );
    expect(screen.getByText("Appeal Basis")).toBeInTheDocument();
    expect(screen.getByText("Medical necessity supported by clinical notes")).toBeInTheDocument();
  });

  it("hides appeal basis when null", () => {
    render(
      <GapAnalysisTable facts={baseFacts} findings={baseFindings} onEvidenceClick={() => {}} />
    );
    expect(screen.queryByText("Appeal Basis")).not.toBeInTheDocument();
  });

  it("shows empty state when no document requirements", () => {
    const facts = { ...baseFacts, required_documents: [] };
    render(
      <GapAnalysisTable facts={facts} findings={baseFindings} onEvidenceClick={() => {}} />
    );
    expect(screen.getByText("No document requirements identified.")).toBeInTheDocument();
  });

  it("renders evidence refs and fires callback", async () => {
    const onClick = vi.fn();
    const findings: CaseFindings = {
      ...baseFindings,
      evidence_refs: [{ doc_id: "notes", quote: "therapy quote" }],
    };
    render(
      <GapAnalysisTable facts={baseFacts} findings={findings} onEvidenceClick={onClick} />
    );

    const btn = screen.getByRole("button", { name: /therapy quote/i });
    await userEvent.click(btn);
    expect(onClick).toHaveBeenCalledWith("notes", "therapy quote");
  });
});
