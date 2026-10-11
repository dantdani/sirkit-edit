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
  testMatch: /.*\.spec\.ts/, testIgnore: (process.env.SIRKIT_E2E_SKIP ?? "").split(",").map((glob) => glob.trim()).filter(Boolean), // [B24-D4, 2026-10-10] OD-30's split: SIRKIT_E2E_SKIP, a comma-separated list of spec globs, leaves those specs out of a run (page-browser-e2e skips the four page-browser-e2e-b24 runs); unset or empty ignores nothing
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? [["list"], ["junit", { outputFile: "playwright-report/junit.xml" }], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  // Failure artifacts (screenshots, traces, error context) live OUTSIDE the HTML reporter's folder:
  // the HTML reporter clears its own output directory, so a shared folder loses the evidence.
  outputDir: "test-results",
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
      // The Stage 3 synchronization rollout is OFF unless declared (the first CI run answered
      // PS_STAGE3_DISABLED 503 where the local .env.local had set it): the fixture runtime declares
      // the same state the deterministic pipelines use.
      SIRKIT_PCB_SYNC_STAGE3: "opt_in",
      // [B18-C I10] the chat route answers with the SCRIPTED agent (never a model): honoured only under the fixture runtime.
      SIRKIT_FIXTURE_AGENT: "scripted",
      // [B20 D3] the MCP endpoint, for the wire-level proof (e2e/mcp-endpoint.spec.ts). The flag must be exactly "1".
      // SIRKIT_EXPECTED_ORIGIN moves CSRF resolution from request-url-local-dev to `configured`; the value is exactly the
      // origin `baseURL` produces, so every existing spec's Origin still matches (the four pre-existing specs staying
      // green in the same run is the proof, not the argument). The secret is assembled from parts at run time, exceeds
      // the minimum byte length, and is an obvious fake that no real deployment would use.
      SIRKIT_MCP_ENABLED: "1",
      SIRKIT_EXPECTED_ORIGIN: `http://localhost:${PORT}`,
      SIRKIT_MCP_TOKEN_SECRET: ["e2e", "mcp", "token", "secret", "0123456789abcdef0123456789abcdef"].join("-"),
      // Never let a developer's .env.local database leak into the proof.
      DATABASE_URL: "",
    },
  },
});
