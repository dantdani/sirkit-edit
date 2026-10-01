/**
 * [B21 F2] The ORCHESTRATION browser proof's own Playwright config (D21-43, the lead's decision): the SAME fixture web server as
 * `playwright.config.ts` - its command and its whole environment, imported, never copied - PLUS `SIRKIT_ORCHESTRATION_ENABLED=1` and the circuit specialist routed to anthropic (F6's second source), on
 * its own port, with its own test dir (`./e2e-orchestration`, outside `./e2e`: the existing suite and B18-E's browser proofs never
 * see the flag), its own report and output folders, workers 1, retries 0 and the same per-test timeout.
 *
 * The flag is read from the server's environment at REQUEST time (`orchestrationEnabled(process.env)`), so this server needs no
 * second dist dir as long as it never runs BESIDE the flag-off one: the two configs run ONE AFTER THE OTHER (locally through the
 * lead's lock script, in CI as one extra step after `pnpm exec playwright test`) - one `next dev` at a time, no `next.config.ts`
 * change. `reuseExistingServer: false`: this config never attaches to a running (flag-off) server; a busy port fails the run.
 *
 *   pnpm exec playwright test -c playwright.orchestration.config.ts        (starts the base's `next dev` on port 3101)
 */
import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

const PORT = Number(process.env.SIRKIT_E2E_ORCHESTRATION_PORT ?? 3101);
const ORIGIN = `http://localhost:${PORT}`;
const baseServer = base.webServer;
if (!baseServer || Array.isArray(baseServer)) throw new Error("playwright.config.ts must define ONE web server: the orchestration config runs the same one with the flag on");
// [B21 F2 fix: tests-05] the base's command and readiness url with ONLY their port moved to this config's (a base change reaches this server)
const BASE_URL = new URL(String(baseServer.url)); const BASE_PORT = BASE_URL.port || (BASE_URL.protocol === "https:" ? "443" : "80"); const BASE_PORT_FLAG = new RegExp(`--port ${BASE_PORT}(?![0-9])`); // [B21 F2 lead] a default port (the URL omits it) is still the flag's, and never a prefix of a longer port
if (typeof baseServer.command !== "string" || !BASE_PORT_FLAG.test(baseServer.command)) throw new Error(`playwright.config.ts's web server command must carry "--port ${BASE_PORT}": the orchestration config runs that command on its own port`);

export default defineConfig({
  testDir: "./e2e-orchestration",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: base.timeout,
  expect: base.expect,
  reporter: process.env.CI ? [["list"], ["junit", { outputFile: "playwright-report-orchestration/junit.xml" }], ["html", { open: "never", outputFolder: "playwright-report-orchestration" }]] : [["list"], ["html", { open: "never", outputFolder: "playwright-report-orchestration" }]],
  // Failure artifacts live outside the HTML reporter's folder (it clears its own output directory), as in the base config.
  outputDir: "test-results-orchestration",
  use: { ...base.use, baseURL: ORIGIN },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    ...baseServer,
    command: baseServer.command.replace(BASE_PORT_FLAG, `--port ${PORT}`),
    url: `${ORIGIN}${BASE_URL.pathname}${BASE_URL.search}`,
    reuseExistingServer: false,
    env: {
      ...baseServer.env,
      // the base config's origin is its own port's: CSRF resolves against THIS server's origin
      SIRKIT_EXPECTED_ORIGIN: ORIGIN,
      // the flag: the chat route's DAG path (exactly "1")
      SIRKIT_ORCHESTRATION_ENABLED: "1",
      // [B21 F2 fix: security-1] F6's two parties on TWO providers, as b21-f-evaluation case 6 routes them: the circuit specialist on anthropic, every other role on the page's openai (the scripted agent serves both offline); set here, a developer's .env.local never re-routes a role
      SIRKIT_ORCHESTRATION_ROLE_MODELS: JSON.stringify({ "circuit-topology": { provider: "anthropic", model: "inherit" } }),
    },
  },
});
