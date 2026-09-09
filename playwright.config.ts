/**
 * [B16-C §5] Page-level browser proof of the prompt-to-Gerber flow against the
 * REAL Next.js application — not route handlers, not jsdom.
 *
 * The web server runs under the env-gated FIXTURE RUNTIME (see
 * app/lib/fixture-runtime/mode.ts): in-memory durable/binding stores, the
 * committed blinker catalog, the recorded provider design, the recorded
 * FreeRouting run replayed by placed-board revision, local-development
 * identity with a dev-only role cookie. No database, no credits, no live
 * router. Live provider/auth variations stay explicitly opt-in elsewhere.
 *
 *   pnpm exec playwright test            (starts `next dev` on port 3100)
 *   SIRKIT_FIXTURE_ROUTER=record …       (re-records e2e/fixtures/blinker-route-fixture.json with the bundled runtime)
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.SIRKIT_E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["list"], ["junit", { outputFile: "playwright-report/junit.xml" }], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  outputDir: "playwright-report/test-results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // A FRESH browser: no storage, no cookies (each test creates its own context).
    storageState: { cookies: [], origins: [] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/ai/runtime`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      NODE_ENV: "development",
      SIRKIT_AUTH_MODE: "local_dev",
      SIRKIT_FIXTURE_RUNTIME: "blinker",
      SIRKIT_FIXTURE_ROUTER: process.env.SIRKIT_FIXTURE_ROUTER ?? "replay",
      // Never let a developer's .env.local database leak into the proof.
      DATABASE_URL: "",
    },
  },
});
