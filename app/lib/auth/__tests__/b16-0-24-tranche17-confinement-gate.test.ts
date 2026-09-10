/**
 * B16.0.24 §I — structural security gates for the FINAL raw-handler tranche.
 * Reverting any of the five methods to a raw handler, giving a callback the raw
 * Request / cookies / headers / identity reconstruction, adding a new factory,
 * widening the sole-adopter wrapper capabilities, un-hardening the simulate
 * process boundary, or exposing a new agent tool fails CI here.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { classifyRouteMethodForm, APPROVED_ROUTE_WRAPPERS } from "./_boundary-analysis";
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
function allRouteFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "__tests__" || entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) allRouteFiles(full, out);
    else if (entry === "route.ts") out.push(full);
  }
  return out;
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
    const adopters = allRouteFiles(join(ROOT, "app", "api"))
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
    const adopters = allRouteFiles(join(ROOT, "app", "api"))
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
    // (the `spawn` itself lives in the runNgspice helper defined earlier).
    const guardCall = src.indexOf("assertSchematicFieldsSafe(state, analysis)");
    const netlistGuardCall = src.indexOf("assertNetlistSafe(netlist)");
    const runnerCall = src.indexOf("await runNgspice(netlistPath");
    expect(guardCall).toBeGreaterThan(0);
    expect(netlistGuardCall).toBeGreaterThan(guardCall);
    expect(runnerCall).toBeGreaterThan(netlistGuardCall);
  });
  it("the runner is server-owned, shell-less, isolated, env-allowlisted, and cleans up in every path", () => {
    const src = raw("app/api/simulate/route.ts");
    expect(src).toMatch(/spawn\(NGSPICE_EXECUTABLE, \["-b", netlistPath\]/); // fixed exe + argv
    expect(src).toMatch(/shell:\s*false/);
    expect(src).toMatch(/env:\s*safeEnvironment\(\)/);
    expect(src).toMatch(/mkdtemp\(join\(tmpdir\(\), "sirkit-simulate-"\)\)/); // per-request isolated dir
    expect(src).toMatch(/rawOutputPath:\s*"result\.raw"/); // server-owned relative filename
    expect(src).toMatch(/finally\s*\{[\s\S]*rm\(directory/); // deterministic cleanup
    expect(src).not.toMatch(/console\.(error|log)\s*\(\s*["'`]\[simulate\]/); // no design-data logging
  });
  it("caller input cannot reach process configuration: the executable/env/limits are module constants, not body-derived", () => {
    const src = code("app/api/simulate/route.ts");
    expect(src).toMatch(/const NGSPICE_EXECUTABLE =/);
    expect(src).toMatch(/const PROCESS_TIMEOUT_MS =/);
    expect(src).toMatch(/const MAX_OUTPUT_BYTES =/);
    expect(src).not.toMatch(/spawn\([^)]*body/); // spawn args never reference body
  });
});

describe("B16.0.24 §I — no new agent tool exposure; sole-adopter of the two closed profiles", () => {
  it("exactly 12 agent-exposed tools; no auth/chat/simulate route is agent-exposed", () => {
    const exposed = sirkitToolRegistry().list().filter((d) => d.agentExposed);
    expect(exposed.length).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    expect(exposed.some((d) => /callback|signin|signout|simulate/i.test(d.toolId))).toBe(false);
  });
  it("agentStreamRoute is an approved canonical wrapper name and auth-signin-v1 is closed", () => {
    expect((APPROVED_ROUTE_WRAPPERS as readonly string[]).includes("agentStreamRoute")).toBe(true);
    // only the sign-in route declares the auth-signin-v1 profile (repo-wide)
    const adopters = allRouteFiles(join(ROOT, "app", "api"))
      .filter((file) => readFileSync(file, "utf8").includes("auth-signin-v1"))
      .map((file) => file.replace(/\\/g, "/").split("/app/api/")[1]!);
    expect(adopters).toEqual(["auth/signin/route.ts"]);
  });
});
