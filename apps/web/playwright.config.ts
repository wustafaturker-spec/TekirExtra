import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  expect: {
    toHaveScreenshot: { maxDiffPixels: 100 },
  },
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3100",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3100/giris",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
