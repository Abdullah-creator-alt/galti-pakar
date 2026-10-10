import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests. The dev server runs with the AI key blanked and every /api/analyze call is intercepted in the tests,
 * so nothing here can reach Gemini or spend quota. Screenshots go to tests/screenshots (git-ignored).
 */
const PORT = 3200;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, ...devices["Desktop Chrome"], trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/new`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { GEMINI_API_KEY: "", ALLOW_DEBUG: "" },
  },
});
