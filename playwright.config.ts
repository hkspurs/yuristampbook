import { defineConfig } from "@playwright/test";
const base = process.env.TEST_BASE || "/";
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 2,
  timeout: 30000,
  use: { baseURL: `http://127.0.0.1:4173${base}`, trace: "retain-on-failure" },
  projects: [
    {
      name: "chromium-375",
      testMatch: "wallet.spec.ts",
      use: { browserName: "chromium", viewport: { width: 375, height: 812 } },
    },
    {
      name: "webkit-390",
      testMatch: "wallet.spec.ts",
      use: { browserName: "webkit", viewport: { width: 390, height: 844 } },
    },
    {
      name: "chromium-430",
      testMatch: "wallet.spec.ts",
      use: { browserName: "chromium", viewport: { width: 430, height: 932 } },
    },
    {
      name: "chromium-desktop",
      testMatch: "wallet.spec.ts",
      use: { browserName: "chromium", viewport: { width: 1280, height: 900 } },
    },
    {
      name: "chromium-update",
      testMatch: "update.spec.ts",
      dependencies: [
        "chromium-375",
        "webkit-390",
        "chromium-430",
        "chromium-desktop",
      ],
      use: { browserName: "chromium", viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: `npm run preview -- --port 4173 --strictPort --base ${base}`,
    url: `http://127.0.0.1:4173${base}`,
    reuseExistingServer: false,
  },
});
