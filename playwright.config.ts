import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5274",
    headless: true,
    screenshot: "only-on-failure",
  },
  outputDir: "./test-results",
  webServer: [
    {
      command: "cd backend && uvicorn app.main:app --port 8000",
      port: 8000,
      timeout: 15_000,
      reuseExistingServer: true,
    },
    {
      command: "cd frontend && bun run dev",
      port: 5274,
      timeout: 15_000,
      reuseExistingServer: true,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { browserName: "chromium" },
    },
  ],
});
