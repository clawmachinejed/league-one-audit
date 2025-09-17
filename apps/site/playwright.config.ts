import { defineConfig } from "@playwright/test";
export default defineConfig({
  webServer: {
    command: "pnpm dev",
    port: 3000,
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
  },
  testDir: "./tests",
  use: { baseURL: "http://localhost:3000" },
});
