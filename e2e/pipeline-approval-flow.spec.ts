import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test.describe("Full demo arc", () => {
  test("case list → run review → evidence → approve → replay", async ({
    page,
  }) => {
    // 1. Case list landing state
    await page.goto("/");
    await expect(page.getByText("Denial Review Workbench")).toBeVisible();
    await expect(page.getByText("case-001")).toBeVisible();
    await expect(page.getByText("case-002")).toBeVisible();
    await expect(page.getByText("case-003")).toBeVisible();
    await page.screenshot({ path: "docs/screenshots/01-case-list.png" });

    // 2. Run review on case-002 — loaded packet with policy pack label
    const case002Row = page.locator("tr", { hasText: "case-002" });
    await case002Row.getByRole("button", { name: "Run Review" }).click();
    await expect(page.getByText("Extracted Facts")).toBeVisible({
      timeout: 60_000,
    });

    // Verify three-panel layout
    await expect(
      page.getByRole("heading", { name: "Documents" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Gap Analysis" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Recommendation" })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Run History" })
    ).toBeVisible();

    // Verify facts rendered
    await expect(page.getByText("Payer", { exact: true })).toBeVisible();
    await expect(page.getByText("Confidence", { exact: true })).toBeVisible();
    await expect(
      page.getByText("request_missing_documents", { exact: true })
    ).toBeVisible();

    // Screenshot: three-panel run results with policy pack label visible
    await page.screenshot({ path: "docs/screenshots/02-run-results.png" });

    // 3. Evidence highlight — click first evidence ref to highlight in document
    const evidenceButton = page.locator("button").filter({ hasText: /".+"/ }).first();
    if (await evidenceButton.isVisible()) {
      await evidenceButton.click();
      // Wait for the highlight to render
      await page.waitForTimeout(500);
    }
    await page.screenshot({
      path: "docs/screenshots/03-evidence-highlight.png",
    });

    // 4. Edit draft text and approve
    const textarea = page.getByRole("textbox");
    await textarea.fill("E2E test: Approved with edits.");
    await page.getByRole("button", { name: "Approve" }).click();

    // Wait for approved state
    await expect(page.getByText("Approved ✓")).toBeVisible({ timeout: 15_000 });
    await expect(textarea).toBeDisabled();

    // Screenshot: approved badge with final recommendation
    await page.screenshot({ path: "docs/screenshots/04-after-approve.png" });

    // 5. Replay — REPLAY badge appears
    await page.getByRole("button", { name: "Replay" }).click();
    await expect(page.getByText("REPLAY", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await page.screenshot({ path: "docs/screenshots/05-replay.png" });

    // Navigate back
    await page.getByRole("button", { name: /Back/ }).first().click();
    await expect(page.getByText("Denial Review Workbench")).toBeVisible();
  });

  test("case-003 escalation shows escalation notice", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("case-003")).toBeVisible();

    const case003Row = page.locator("tr", { hasText: "case-003" });
    await case003Row.getByRole("button", { name: "Run Review" }).click();

    // Wait for escalation notice
    await expect(page.getByText("Escalated to Compliance Review")).toBeVisible({
      timeout: 60_000,
    });

    // No Approve button should be present
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);

    // Screenshot: escalation state
    await page.screenshot({ path: "docs/screenshots/06-escalation.png" });

    // Navigate back
    await page.getByRole("button", { name: /Back/ }).first().click();
    await expect(page.getByText("Denial Review Workbench")).toBeVisible();
  });
});
