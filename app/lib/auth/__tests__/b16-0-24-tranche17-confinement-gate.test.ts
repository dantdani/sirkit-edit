/**
 * B16.0.24 §I — structural security gates for the FINAL raw-handler tranche.
 * Reverting any of the five methods to a raw handler, giving a callback the raw
 * Request / cookies / headers / identity reconstruction, adding a new factory,
 * widening the sole-adopter wrapper capabilities, un-hardening the simulate
 * process boundary, or exposing a new agent tool fails CI here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm, APPROVED_ROUTE_WRAPPERS } from "./_boundary-analysis";
import { listRouteFiles } from "../route-tree"; // [B20 B2] app/api AND app/.well-known (OD-66); the sole-adopter paths below stay split on /app/api/
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const ROOT = process.cwd();
const METHODS: ReadonlyArray<[string, string]> = [
  ["GET", "app/api/auth/callback/route.ts"],
  ["POST", "app/api/auth/signin/route.ts"],
  ["POST", "app/api/auth/signout/route.ts"],
  ["POST", "app/api/chat/route.ts"],
  ["POST", "app/api/simulate/route.ts"],
];
const ROUTES = [...new Set(METHODS.map(([, rel]) => rel))];

function raw(rel: string): string { return readFileSync(join(ROOT, rel), "utf8"); }
function code(rel: string): string {
  return raw(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}

describe("B16.0.24 §I — canonical adoption (provenance-checked)", () => {
  it("all five tranche-17 methods classify canonical-wrapper", () => {
    for (const [method, rel] of METHODS) {
      const verdict = classifyRouteMethodForm(raw(rel), method, join(ROOT, rel), ROOT);
      expect(verdict.form, `${method} ${rel}`).toBe("canonical-wrapper");
    }
  });
  it("no tranche-17 route file consumes the raw Request or reconstructs URL / headers / identity / role / scope", () => {
    for (const rel of ROUTES) {
      const src = code(rel);
      // The callback never receives a `request`/`req` binding — no raw-Request
      // member access, no URL reconstruction, no in-route auth primitive.
      // (Cookie WRITES by the server-side @supabase/ssr client via next/headers
      // `cookies()` are the sanctioned session mechanism, not Request access.)
      expect(src, rel).not.toMatch(/\breq(?:uest)?\s*\.\s*(json|text|body|headers|url|signal|cookies)\b/);
      expect(src, rel).not.toMatch(/new URL\s*\(\s*req/);
      expect(src, rel).not.toMatch(/resolveTrustedRequestContext|authorizeRequest|authorizeActor|requireSameOrigin/);
    }
  });
});

describe("B16.0.24 §I — auth boundary confinement", () => {
  it("callback derives code/next from the bounded query projection and the redirect origin from the SERVER-OWNED meta.origin (never request.url / a header)", () => {
    const src = raw("app/api/auth/callback/route.ts");
    expect(src).toMatch(/publicRoute\s*\(\s*\{[^}]*requestOrigin:\s*true/);
    expect(src).toMatch(/meta\.query\?\.code/);
    expect(src).toMatch(/meta\.query\?\.next/);
    expect(src).toMatch(/safeRedirectPath/);
    expect(src).toMatch(/const origin = meta\.origin/);
    expect(code("app/api/auth/callback/route.ts")).not.toMatch(/requestUrl|new URL\s*\(\s*request/);
  });
  it("sign-in adopts publicJsonRoute with the closed auth-signin-v1 refusal profile; no in-route reader/CSRF primitives", () => {
    const src = raw("app/api/auth/signin/route.ts");
    expect(src).toMatch(/publicJsonRoute\s*(<|\()/);
    expect(src).toMatch(/legacyReaderRefusals:\s*"auth-signin-v1"/);
    expect(code("app/api/auth/signin/route.ts")).not.toMatch(/readBoundedJson|requireSameOrigin|requireJsonContentType/);
  });
  it("sign-out adopts publicRoute with the LEAST-PRIVILEGE exposeAuthRuntime projection and no raw second handler argument [B16.0.24.1]", () => {
    const src = raw("app/api/auth/signout/route.ts");
    expect(src).toMatch(/publicRoute\s*\(\s*\{\s*exposeAuthRuntime:\s*true\s*\}/);
    // The full-environment pass-through is GONE (superseded B16.0.24 §D):
    // neither the route nor the wrapper hands a callback the raw environment.
    expect(src).not.toMatch(/exposeEnvironment/);
    expect(code("app/api/auth/signout/route.ts")).not.toMatch(/process\.env/);
    expect(raw("app/lib/auth/route-handlers.ts")).not.toMatch(/exposeEnvironment/);
    expect(raw("app/lib/auth/route-handlers.ts")).toMatch(/extra\.authRuntime = projectAuthRuntime\(/);
    expect(code("app/api/auth/signout/route.ts")).not.toMatch(/options:\s*\{\s*environment/);
    expect(code("app/api/auth/signout/route.ts")).not.toMatch(/[Rr]edirect/); // sign-out issues no redirect / caller destination (code only, comments excluded)
  });
  it("the auth-signin-v1 refusal table is a frozen in-module map with the exact AUTH_SIGNIN_* codes; the option is a closed enum", () => {
    const src = raw("app/lib/auth/route-handlers.ts");
    for (const codeName of ["AUTH_SIGNIN_PAYLOAD_TOO_LARGE", "AUTH_SIGNIN_INVALID_JSON", "AUTH_SIGNIN_BODY_DEADLINE_EXCEEDED", "AUTH_SIGNIN_BODY_ABORTED", "AUTH_SIGNIN_BODY_UNREADABLE", "AUTH_SIGNIN_OBJECT_REQUIRED"]) {
      expect(src, codeName).toContain(codeName);
    }
    expect(src).toMatch(/legacyReaderRefusals\?:\s*"replacement-authority-v1"\s*\|\s*"auth-signin-v1"/);
  });
});

describe("B16.0.24 §I — chat registry/tool/policy confinement", () => {
  it("chat is the SOLE adopter of agentStreamRoute (repo-wide) and keeps its tool discovery registry-derived", () => {
    const adopters = listRouteFiles(ROOT)
      .filter((file) => readFileSync(file, "utf8").includes("agentStreamRoute"))
      .map((file) => file.replace(/\\/g, "/").split("/app/api/")[1]!);
    expect(adopters).toEqual(["chat/route.ts"]);
    const src = raw("app/api/chat/route.ts");
    expect(src).toMatch(/sirkitToolRegistry\(\)/); // tools remain registry-derived
    expect(src).not.toMatch(/manufacturing.?release|certif/i);
  });
  it("chat never trusts body-authored authority: the authority-claim refusal + editor-context provenance gates remain", () => {
    const src = raw("app/api/chat/route.ts");
    expect(src).toMatch(/AUTHORITY_CLAIM_KEYS/);
    expect(src).toMatch(/authoritySource may only be the local working copy/);
    expect(src).toMatch(/local-working-copy/);
  });
  it("requestOrigin is declared ONLY by the auth callback (sole adopter, repo-wide)", () => {
    const adopters = listRouteFiles(ROOT)
      .filter((file) => readFileSync(file, "utf8").includes("requestOrigin:"))
      .map((file) => file.replace(/\\/g, "/").split("/app/api/")[1]!);
    expect(adopters).toEqual(["auth/callback/route.ts"]);
  });
});

describe("B16.0.24 §I — simulate process security confinement", () => {
  it("authorization+validation dominate execution: authenticatedJsonRoute wraps it and the runner CALL is dominated by the schematic + netlist guards", () => {
    const src = raw("app/api/simulate/route.ts");
    expect(classifyRouteMethodForm(src, "POST", join(ROOT, "app/api/simulate/route.ts"), ROOT).form).toBe("canonical-wrapper");
    // Within the POST callback, both injection guards precede the runner CALL
    // ([B22-A3] reviewed pin move: the `spawn` itself lives in the diagnostic runner, OD-136).
    const guardCall = src.indexOf("assertSchematicFieldsSafe(state, analysis)");
    const netlistGuardCall = src.indexOf("assertNetlistSafe(netlist)");
    const runnerCall = src.indexOf("run = await runDiagnosticNgspice({ operation: \"run\", deck: netlist"); // [B22-A3] (was `await runNgspice(netlistPath`)
    expect(guardCall).toBeGreaterThan(0);
    expect(netlistGuardCall).toBeGreaterThan(guardCall);
    expect(runnerCall).toBeGreaterThan(netlistGuardCall);
  });
  it("the runner is server-owned, shell-less, isolated, env-allowlisted, and cleans up in every path", () => {
    const src = raw("app/api/simulate/route.ts"); const runner = raw("app/lib/computation/diagnostic-runner.ts"); // [B22-A3] reviewed pin move: the process moved to the ONE ngspice spawner (OD-136), re-pinned there
    expect(runner).toMatch(/spawn\(input\.executable, \[\.\.\.input\.argv\], /); expect(runner).toContain('argv: filled(profile.argvTemplates[request.operation]!, { "{deckFile}": DIAGNOSTIC_DECK_FILE })'); // fixed exe + argv: the pinned install, the profile's template
    expect(runner).toMatch(/shell:\s*false/);
    expect(runner).toMatch(/env:\s*\{ \.\.\.input\.env \}/); expect(runner).toContain("Object.entries(profile.environment)"); // [B22-A3] the profile's exact map (was the safeEnvironment() allowlist)
    expect(runner).toMatch(/runDir = await mkdtemp\(join\(runnerRoot, "run-"\)\)/); // per-run isolated dir under the runner's one root (was the route's "sirkit-simulate-" mkdtemp)
    expect(src).toMatch(/rawOutputPath:\s*"result\.raw"/); // server-owned relative filename
    expect(runner).toMatch(/finally\s*\{[\s\S]*rm\(runDir/); expect(src).not.toMatch(/\bspawn\(|child_process/); // deterministic cleanup (the runner's); the route spawns nothing
    expect(src).not.toMatch(/console\.(error|log)\s*\(\s*["'`]\[simulate\]/); // no design-data logging
  });
  it("caller input cannot reach process configuration through the route: it names no executable and reads no process.env, its timeout and raw bound are route constants, and no spawn or runner call takes anything from body", () => { // [B22 closeout, 2026-10-02] retitled (D22-16): the route's own checks only - the runner's executable and environment are B22-A3's suites' (OD-135, OD-136); assertions unchanged
    const src = code("app/api/simulate/route.ts");
    expect(src).not.toMatch(/NGSPICE_EXECUTABLE|process\.env/); // [B22-A3] reviewed pin move: no executable here - the runner takes the pinned install from server settings (was const NGSPICE_EXECUTABLE)
    expect(src).toMatch(/const PROCESS_TIMEOUT_MS =/);
    expect(src).toMatch(/const MAX_RAW_BYTES =/); // [B22-A3] reviewed pin move: stdout/stderr are bounded by the runner (A1's 64 KiB); the raw bound stays a route constant (was MAX_OUTPUT_BYTES)
    expect(src).not.toMatch(/spawn\([^)]*body/); expect(src).not.toMatch(/runDiagnosticNgspice\([^)]*body/); // spawn args never reference body; [B22-A3] nor the runner's
  });
});

describe("B16.0.24 §I — no new agent tool exposure; sole-adopter of the two closed profiles", () => {
  it("exactly the intentional agent-exposed set (12 agent-exposed tools when written; the set has since grown by reviewed moves, B22-B's three named computation reads among them, and the assertion counts the set itself); no auth/chat/simulate route is agent-exposed", () => { // [B22 closeout, 2026-10-02] retitled (D22-16): the derived count, 36 since B22-B (OD-139); assertions unchanged
    const exposed = sirkitToolRegistry().list().filter((d) => d.agentExposed);
    expect(exposed.length).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    expect(exposed.some((d) => /callback|signin|signout|simulate/i.test(d.toolId))).toBe(false);
  });
  it("agentStreamRoute is an approved canonical wrapper name and auth-signin-v1 is closed", () => {
    expect((APPROVED_ROUTE_WRAPPERS as readonly string[]).includes("agentStreamRoute")).toBe(true);
    // only the sign-in route declares the auth-signin-v1 profile (repo-wide)
    const adopters = listRouteFiles(ROOT)
      .filter((file) => readFileSync(file, "utf8").includes("auth-signin-v1"))
      .map((file) => file.replace(/\\/g, "/").split("/app/api/")[1]!);
    expect(adopters).toEqual(["auth/signin/route.ts"]);
  });
});
