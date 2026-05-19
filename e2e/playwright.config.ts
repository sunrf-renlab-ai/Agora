import { defineConfig, devices } from "@playwright/test";

// Named project so tests can target the app via test.skip / project filter.
// Uses the chromium engine with the app's `baseURL` and `storageState`.
export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "report", open: "never" }],
  ],
  outputDir: "test-results",
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: "only-on-failure",
    trace: "on",
    video: "off",
  },
  projects: [
    {
      name: "agora",
      use: {
        ...devices["Desktop Chrome"],
        baseURL: "http://localhost:3002",
        storageState: "./e2e/fixtures/agora-state.json",
      },
    },
  ],
});
