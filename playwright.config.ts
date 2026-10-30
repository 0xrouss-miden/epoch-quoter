import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  outputDir: "artifacts/ipd/browser-results",
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3108/epoch",
    viewport: { width: 1440, height: 1100 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "node --import tsx tests/fixtures/ipd-server.ts",
      url: "http://127.0.0.1:4419/health",
      reuseExistingServer: false,
    },
    {
      command:
        "IPD_MAINNET_URL=http://127.0.0.1:4419 NEXT_PUBLIC_BASE_PATH=/epoch npm run dev -- --port 3108",
      url: "http://127.0.0.1:3108/epoch/ipd",
      reuseExistingServer: false,
      timeout: 60000,
    },
  ],
});
