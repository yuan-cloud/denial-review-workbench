import { test, expect } from "@playwright/test";

test("app loads and shows case list", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Denial Review Workbench")).toBeVisible();
});
