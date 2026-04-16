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
  it("shows pending state when recommendation is null and not escalated", () => {
    render(
      <RecommendationEditor
        recommendation={null}
        findings={baseFindings}
        status="approval_requested"
        onApprove={async () => {}}
      />
    );
    expect(screen.getByText("Recommendation")).toBeInTheDocument();
    expect(screen.getByText(/recommendation will appear here/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("renders action type and rationale", () => {
    render(
      <RecommendationEditor
        recommendation={baseRec}
        findings={baseFindings}
        status="approval_requested"
        onApprove={async () => {}}
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
        onApprove={async () => {}}
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
        onApprove={async () => {}}
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
        onApprove={async () => {}}
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
        onApprove={async () => {}}
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
        onApprove={async () => {}}
      />
    );
    expect(screen.getByText("Approval controls are disabled for escalated cases.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("uses status as the authoritative escalation signal when findings are null", () => {
    render(
      <RecommendationEditor
        recommendation={null}
        findings={null}
        status="escalated"
        onApprove={async () => {}}
      />
    );
    expect(screen.getByText("Approval controls are disabled for escalated cases.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("shows inline approval error with reload action", async () => {
    const onApprove = vi.fn().mockRejectedValue(new Error("Run already approved"));
    const onRefresh = vi.fn();
    render(
      <RecommendationEditor
        recommendation={baseRec}
        findings={baseFindings}
        status="approval_requested"
        onApprove={onApprove}
        onRefresh={onRefresh}
      />
    );

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    expect(screen.getByText("Approval did not complete")).toBeInTheDocument();
    expect(screen.getByText(/drafted text is still in place/i)).toBeInTheDocument();
    expect(screen.getByText("Run already approved")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Reload run" }));
    expect(onRefresh).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("Approval did not complete")).not.toBeInTheDocument();
  });
});
