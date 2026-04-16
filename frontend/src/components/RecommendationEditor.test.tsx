import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import RecommendationEditor from "./RecommendationEditor";
import type { Recommendation, CaseFindings } from "../types";

const baseRec: Recommendation = {
  action_type: "approve_or_proceed",
  rationale: "All docs present",
  draft_text: "Approve this case.",
};

const baseFindings: CaseFindings = {
  missing_items: [],
  conflicts: [],
  appeal_basis: null,
  should_escalate: false,
  evidence_refs: [],
};

describe("RecommendationEditor", () => {
  it("returns null when recommendation is null and not escalated", () => {
    const { container } = render(
      <RecommendationEditor
        recommendation={null}
        findings={baseFindings}
        status="approval_requested"
        onApprove={() => {}}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders action type and rationale", () => {
    render(
      <RecommendationEditor
        recommendation={baseRec}
        findings={baseFindings}
        status="approval_requested"
        onApprove={() => {}}
      />
    );
    expect(screen.getByText("approve_or_proceed")).toBeInTheDocument();
    expect(screen.getByText("All docs present")).toBeInTheDocument();
  });

  it("renders draft text in textarea", () => {
    render(
      <RecommendationEditor
        recommendation={baseRec}
        findings={baseFindings}
        status="approval_requested"
        onApprove={() => {}}
      />
    );
    const textarea = screen.getByRole("textbox");
    expect(textarea).toHaveValue("Approve this case.");
  });

  it("shows Approve button when pending", () => {
    render(
      <RecommendationEditor
        recommendation={baseRec}
        findings={baseFindings}
        status="approval_requested"
        onApprove={() => {}}
      />
    );
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("fires onApprove with draft text", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    render(
      <RecommendationEditor
        recommendation={baseRec}
        findings={baseFindings}
        status="approval_requested"
        onApprove={onApprove}
      />
    );
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(onApprove).toHaveBeenCalledWith("Approve this case.");
  });

  it("shows Approved badge when status is approved", () => {
    render(
      <RecommendationEditor
        recommendation={baseRec}
        findings={baseFindings}
        status="approved"
        onApprove={() => {}}
      />
    );
    expect(screen.getByText("Approved ✓")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("shows final text as read-only field when approved", () => {
    render(
      <RecommendationEditor
        recommendation={baseRec}
        findings={baseFindings}
        status="approved"
        onApprove={() => {}}
      />
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("Final Text")).toBeInTheDocument();
    expect(screen.getByText("Approve this case.")).toBeInTheDocument();
  });

  it("renders escalation notice when should_escalate is true", () => {
    const escalatedFindings: CaseFindings = {
      ...baseFindings,
      should_escalate: true,
    };
    render(
      <RecommendationEditor
        recommendation={null}
        findings={escalatedFindings}
        status="escalated"
        onApprove={() => {}}
      />
    );
    expect(screen.getByText("Approval controls are disabled for escalated cases.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});
