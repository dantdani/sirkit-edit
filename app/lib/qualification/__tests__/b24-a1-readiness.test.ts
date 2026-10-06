/**
 * [B24-A1] Health and readiness (D24-9, OD-198; the census 166 -> 168 by review).
 *
 * `GET /api/health` is public liveness: `{ ok: true }`, no-store, reading nothing. `GET /api/ready` is on the worker class through a
 * reviewed read-only constructor (never `worker()`, which hard-codes an authoritative write): 401 without the worker credential, else
 * 200 or 503 with `{ ready, checks, configurationDigest }` - nine closed checks, each a name and a closed state, every auth check
 * derived through its owner function, the database probe an injected port bounded at 2,000 ms, the two key checks reported only.
 * No value of any kind appears. Both rows derive no model egress, no outbound egress and no process; one action record serves both.
 *
 * Failing first on 8664964: neither route file exists and `policyFor("/api/ready", "GET")` is null (page section 8). Every database
 * here is an in-process fake port: no connection is opened. [B24-A1 review] regressions-1 / tests-3: before every case a refusing
 * guard port replaces the default one, and `getSqlClient` is replaced by a fake that never builds a client, so no case can reach a
 * real database whatever the shell exports (`DATABASE_URL` included); a case that falls back to the default port unasked fails.
 * Nothing is written to disk; every credential is an obvious fake assembled at run time.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** [B24-A1 review] regressions-1 / tests-3: the database client is never built here. A request made while no fake query is installed
 *  is a stray (a case fell back to the default port) and is refused before any connection; case 11 installs a fake query to drive the
 *  default port itself. */
const db = vi.hoisted(() => ({ stray: 0, query: null as null | ((text: string) => unknown) }));
vi.mock("@/app/lib/db/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/lib/db/client")>()),
  getSqlClient: () => {
    const query = db.query;
    if (query === null) {
      db.stray += 1;
      throw new Error("b24-a1-readiness: the database client is never built in this suite");
    }
    return (strings: TemplateStringsArray) => query(strings.join("?"));
  },
}));

import { GET as health } from "@/app/api/health/route";
import { GET as ready } from "@/app/api/ready/route";
import { ROLE_MODELS_ENV } from "@/app/lib/agent/orchestration/provider-policy";
import { classifyRouteMethodForm, exportedHttpMethods } from "@/app/lib/auth/__tests__/_boundary-analysis";
import { productionExpectedOrigin, resolveDeploymentProfile } from "@/app/lib/auth/deployment-profile";
import { sensitiveOperationsBlocker } from "@/app/lib/auth/mode";
import { allRoutePolicies, policyFor } from "@/app/lib/auth/route-policy";
import { routeResourceClassification } from "@/app/lib/auth/route-resource-classification";
import { listRouteFiles } from "@/app/lib/auth/route-tree";
import { __resetDeploymentConfigurationForTests, buildDeploymentConfiguration, deploymentConfiguration } from "@/app/lib/deployment/configuration";
import {
  DATABASE_PROBE_BOUND_MS,
  READINESS_CHECK_NAMES,
  READINESS_PASSING,
  READINESS_REPORTED_ONLY,
  READINESS_STATES,
  probeDatabase,
  readinessReport,
  setDatabaseProbePortForTests,
  type DatabaseProbePort,
  type ReadinessReport,
} from "@/app/lib/deployment/readiness";
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE, renderActionToolabilityCsv, renderApiRouteCoverageCsv } from "@/app/lib/engineering/action-registry";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
type Env = Record<string, string | undefined>;
/** obvious fakes, assembled at run time */
const WORKER_SECRET = ["b24", "a1", "ready", "worker", "0123456789abcdef"].join("-");
const FAKE_DATABASE_URL = ["postgres:", "", "b24-a1-fake.invalid", "sirkit"].join("/");
const SUPABASE: Env = { NEXT_PUBLIC_SUPABASE_URL: ["https://", "b24-a1-fake", ".supabase.example"].join(""), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ["fake", "publishable", "b24", "a1"].join("-") };
const ORIGIN = "https://sirkit.example";
const READY_ENV: Env = { NODE_ENV: "production", ...SUPABASE, SIRKIT_EXPECTED_ORIGIN: ORIGIN, SIRKIT_DEPLOYMENT_ENV: "production", DATABASE_URL: FAKE_DATABASE_URL };
const SENTINELS: Env = {
  OPENAI_API_KEY: ["b24", "ready", "openai", "sentinel"].join("-"),
  ANTHROPIC_API_KEY: ["b24", "ready", "anthropic", "sentinel"].join("-"),
  SIRKIT_MCP_TOKEN_SECRET: ["b24", "ready", "mcp", "sentinel", "0123456789abcdef0123456789abcdef"].join("-"),
  KICAD_HTTP_LIBRARY_TOKEN: ["b24", "ready", "kicad", "sentinel"].join("-"),
  SIRKIT_DB_QUALIFICATION_URL: ["postgres:", "", "qual-sentinel.invalid", "q"].join("/"),
};
const reachable: DatabaseProbePort = async () => undefined;
/** [B24-A1 review] regressions-1 / tests-3: the port every case starts with - it refuses, so a probe no case asked for answers unreachable. */
const guard = { calls: 0 };
const GUARD: DatabaseProbePort = async () => {
  guard.calls += 1;
  throw new Error("b24-a1-readiness: no database in this suite");
};
const stubAll = (env: Env): void => { for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value); };
const stateOf = (report: ReadinessReport, name: string): string | undefined => report.checks.find((check) => check.name === name)?.state;
const call = (route: (request: Request) => Promise<Response>, path: string, headers: Record<string, string> = {}): Promise<Response> => route(new Request(`http://localhost:3200${path}`, { headers }));

beforeEach(() => {
  setDatabaseProbePortForTests(GUARD);
});

afterEach(() => {
  vi.unstubAllEnvs();
  setDatabaseProbePortForTests(null);
  __resetDeploymentConfigurationForTests();
  const stray = db.stray;
  db.stray = 0;
  db.query = null;
  guard.calls = 0;
  expect(stray, "a case fell back to the default database port").toBe(0);
});

describe("[B24-A1] health and readiness (D24-9, OD-198)", () => {
  it("1. counterexample (red on 8664964): both route files exist with exactly one GET each, and both have policy rows", () => {
    for (const path of ["app/api/health/route.ts", "app/api/ready/route.ts"]) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
      expect(exportedHttpMethods(read(path), join(ROOT, path)), path).toEqual(["GET"]);
    }
    expect(policyFor("/api/health", "GET")).not.toBeNull();
    expect(policyFor("/api/ready", "GET")).not.toBeNull();
    expect(policyFor("/api/ready", "POST")).toBeNull();
    expect(policyFor("/api/health", "POST")).toBeNull();
  });

  it("2. GET /api/health is public liveness: 200 { ok: true }, no-store, in any environment; it reads nothing - no environment, no store, no configuration - so no value can appear", async () => {
    for (const env of [{}, { NODE_ENV: "production" }, { ...READY_ENV, ...SENTINELS }] as Env[]) {
      stubAll(env);
      const response = await call(health, "/api/health");
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ ok: true });
      vi.unstubAllEnvs();
    }
    const source = read("app/api/health/route.ts");
    expect(source).not.toMatch(/process\.env|readiness|configuration|getSqlClient|getDb/);
    expect(source.match(/^import .*$/gm)).toEqual(['import { publicRoute } from "@/app/lib/auth/route-handlers";']);
    expect(policyFor("/api/health", "GET")).toMatchObject({ authClass: "public", identitySource: "none", requiresAuth: false, providerCredit: false, requiresCsrf: false, authoritativeWrite: false, releaseOrQualification: false, externalTransfer: false, spend: false });
  });

  it("3. /api/ready's row comes from the reviewed read-only worker constructor: the worker secret, no write, no transfer, no spend, no credit, no CSRF; the three worker write routes keep worker()'s row, and the same secret authorizes them (the least-privilege limit the page records)", () => {
    expect(policyFor("/api/ready", "GET")).toMatchObject({ path: "/api/ready", method: "GET", authClass: "internal-worker", identitySource: "worker-secret", requiresAuth: true, permittedRoles: [], providerCredit: false, requiresCsrf: false, authoritativeWrite: false, releaseOrQualification: false, externalTransfer: false, spend: false });
    const workers = allRoutePolicies().filter((policy) => policy.identitySource === "worker-secret").map((policy) => `${policy.method} ${policy.path}:${String(policy.authoritativeWrite)}`).sort();
    expect(workers).toEqual(["GET /api/ready:false", "POST /api/assignment-queue/materialize:true", "POST /api/assignment-queue/revalidate:true", "POST /api/engineering-effects:true"]);
    const policy = read("app/lib/auth/route-policy.ts").split(NEWLINE);
    expect(policy[303]).toMatch(/^ {2}\.\.\.mutate\("\/api\/pcb\/provider-exchange", \["POST"\],/);
    expect(policy[303]).toMatch(/\.\.\.pub\("\/api\/health", \["GET"\], [^)]*\), \.\.\.readOnlyWorker\("\/api\/ready", \["GET"\], [^)]*\),/);
    for (const [line, anchor] of [[257, 'pub("/api/pcb/placement/preview", ["POST"], "stateless compute")'], [360, "export interface RoutePolicy {"], [377, "export function routeVocabularyViolations("]] as const) expect(policy[line - 1], `route-policy.ts:${line}`).toContain(anchor);
    expect(policy.slice(396).join(NEWLINE)).toMatch(/function readOnlyWorker\(path: string, methods: readonly string\[\], evidence: string\): RoutePolicy\[\]/);
  });

  it("4. GET /api/ready: 401 without the credential or with a wrong one, before any check; with it, 503 naming the failing checks in an unconfigured production runtime and 200 when every required check passes; never a value", async () => {
    stubAll({ NODE_ENV: "production", SIRKIT_WORKFLOW_WORKER_SECRET: WORKER_SECRET, SIRKIT_DEPLOYMENT_ENV: "ci", SIRKIT_EXPECTED_ORIGIN: "http://localhost:3200", ...SENTINELS, DATABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined, SIRKIT_ANTHROPIC_MODEL: undefined, [ROLE_MODELS_ENV]: undefined, SIRKIT_AUTH_MODE: undefined });
    let probes = 0;
    setDatabaseProbePortForTests(async () => { probes += 1; });
    for (const headers of [{}, { authorization: "Bearer wrong-b24-secret" }, { authorization: WORKER_SECRET }] as Array<Record<string, string>>) {
      const response = await call(ready, "/api/ready", headers);
      expect(response.status, JSON.stringify(headers)).toBe(401);
      expect(((await response.json()) as { code: string }).code).toBe("AUTH_WORKER_UNAUTHENTICATED");
    }
    expect(probes).toBe(0);
    const refused = await call(ready, "/api/ready", { authorization: `Bearer ${WORKER_SECRET}` });
    expect(refused.status).toBe(503);
    expect(refused.headers.get("cache-control")).toBe("no-store");
    const text = await refused.text();
    const body = JSON.parse(text) as ReadinessReport;
    expect(Object.keys(body).sort()).toEqual(["checks", "configurationDigest", "ready"]);
    expect(body.ready).toBe(false);
    expect(body.checks.filter((check) => !READINESS_PASSING[check.name as keyof typeof READINESS_PASSING]?.includes(check.state as never) && !(READINESS_REPORTED_ONLY as readonly string[]).includes(check.name)).map((check) => check.name)).toEqual(["deployment_profile", "supabase_auth_configuration", "database"]);
    for (const fragment of ['{"name":"deployment_profile","state":"not_serving"}', '{"name":"supabase_auth_configuration","state":"not_configured"}', '{"name":"database","state":"not_configured"}']) expect(text, fragment).toContain(fragment);
    expect(probes).toBe(0);
    for (const value of [WORKER_SECRET, "http://localhost:3200", ...Object.values(SENTINELS) as string[]]) expect(text).not.toContain(value);
    expect(text).not.toMatch(/sentinel/i);
    expect(body.configurationDigest).toBe(deploymentConfiguration().digest);
    // fully configured, the database port answering: ready
    __resetDeploymentConfigurationForTests();
    stubAll({ ...READY_ENV, SIRKIT_WORKFLOW_WORKER_SECRET: WORKER_SECRET });
    const served = await call(ready, "/api/ready", { authorization: `Bearer ${WORKER_SECRET}` });
    expect(served.status).toBe(200);
    const servedText = await served.text();
    expect((JSON.parse(servedText) as ReadinessReport).ready).toBe(true);
    expect(probes).toBe(1);
    for (const value of [WORKER_SECRET, FAKE_DATABASE_URL, ORIGIN, SUPABASE.NEXT_PUBLIC_SUPABASE_URL!, SUPABASE.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, ...Object.values(SENTINELS) as string[]]) expect(servedText).not.toContain(value);
  });

  it("5. nine closed checks in a fixed order, each state from a closed set; ready requires every check but the two key checks, which are reported only", async () => {
    expect([...READINESS_CHECK_NAMES]).toEqual(["deployment_profile", "auth_mode", "supabase_auth_configuration", "expected_origin", "database", "openai_api_key", "anthropic_api_key", "anthropic_model_setting", "role_table"]);
    expect([...READINESS_REPORTED_ONLY]).toEqual(["openai_api_key", "anthropic_api_key"]);
    expect(Object.keys(READINESS_STATES)).toEqual([...READINESS_CHECK_NAMES]);
    expect(Object.keys(READINESS_PASSING).sort()).toEqual(READINESS_CHECK_NAMES.filter((name) => !(READINESS_REPORTED_ONLY as readonly string[]).includes(name)).sort());
    const base = await readinessReport({ environment: READY_ENV, database: reachable });
    expect(base.ready).toBe(true);
    expect(base.checks.map((check) => check.name)).toEqual([...READINESS_CHECK_NAMES]);
    expect(base.checks.map((check) => check.state)).toEqual(["serving", "production", "configured", "configured", "reachable", "absent", "absent", "default", "default"]);
    expect(Object.isFrozen(base) && Object.isFrozen(base.checks) && base.checks.every((check) => Object.isFrozen(check))).toBe(true);
    const cases: Array<[Env, string, string, boolean]> = [
      [{ OPENAI_API_KEY: SENTINELS.OPENAI_API_KEY, ANTHROPIC_API_KEY: SENTINELS.ANTHROPIC_API_KEY }, "openai_api_key", "present", true],
      [{ ANTHROPIC_API_KEY: "  " }, "anthropic_api_key", "absent", true],
      [{ SIRKIT_DEPLOYMENT_ENV: "ci" }, "deployment_profile", "not_serving", false],
      [{ SIRKIT_DEPLOYMENT_ENV: undefined }, "deployment_profile", "unset", false],
      [{ SIRKIT_DEPLOYMENT_ENV: "Production" }, "deployment_profile", "invalid", false],
      [{ SIRKIT_DEPLOYMENT_ENV: "staging" }, "deployment_profile", "serving", true],
      [{ NODE_ENV: "development", SIRKIT_AUTH_MODE: undefined }, "auth_mode", "local_dev", false],
      [{ NODE_ENV: "development", SIRKIT_AUTH_MODE: "production" }, "auth_mode", "production", true],
      [{ NEXT_PUBLIC_SUPABASE_URL: undefined }, "supabase_auth_configuration", "not_configured", false],
      [{ SIRKIT_EXPECTED_ORIGIN: undefined }, "expected_origin", "not_configured", false],
      [{ SIRKIT_EXPECTED_ORIGIN: "http://sirkit.example" }, "expected_origin", "malformed", false],
      [{ SIRKIT_EXPECTED_ORIGIN: "http://localhost:3200" }, "expected_origin", "configured", true],
      [{ DATABASE_URL: undefined }, "database", "not_configured", false],
      [{ DATABASE_URL: "   " }, "database", "not_configured", false],
      [{ SIRKIT_ANTHROPIC_MODEL: "claude-sonnet-4-5" }, "anthropic_model_setting", "configured", true],
      [{ SIRKIT_ANTHROPIC_MODEL: "" }, "anthropic_model_setting", "empty", false],
      [{ SIRKIT_ANTHROPIC_MODEL: " claude-sonnet-4-5" }, "anthropic_model_setting", "padded", false],
      [{ [ROLE_MODELS_ENV]: JSON.stringify({ "circuit-topology": { provider: "anthropic", model: "inherit" } }) }, "role_table", "overridden", true],
      [{ [ROLE_MODELS_ENV]: "{" }, "role_table", "invalid", false],
    ];
    for (const [change, name, state, isReady] of cases) {
      const report = await readinessReport({ environment: { ...READY_ENV, ...change }, database: reachable });
      expect(stateOf(report, name), `${name} ${JSON.stringify(change)}`).toBe(state);
      expect(report.ready, `${name} ${JSON.stringify(change)}`).toBe(isReady);
      for (const check of report.checks) expect(READINESS_STATES[check.name as keyof typeof READINESS_STATES], check.name).toContain(check.state);
      expect(JSON.stringify(report)).not.toMatch(/sentinel|claude-sonnet|circuit-topology|localhost|sirkit\.example|b24-a1-fake|fake-publishable|postgres:/i);
    }
  });

  it("6. every auth check is derived through its owner function: supabase_auth_configuration is sensitiveOperationsBlocker with production forced (the anon-key fallback and the set-but-empty publishable key behave as mode.ts:89-91), expected_origin is resolveExpectedOrigin's rules with production forced (the request URL never consulted), deployment_profile is resolveDeploymentProfile", async () => {
    const fixtures: Env[] = [
      { NEXT_PUBLIC_SUPABASE_URL: SUPABASE.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: ["fake", "anon", "b24"].join("-") },
      { NEXT_PUBLIC_SUPABASE_URL: SUPABASE.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: ["fake", "anon", "b24"].join("-") },
      { NEXT_PUBLIC_SUPABASE_URL: SUPABASE.NEXT_PUBLIC_SUPABASE_URL },
      { NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SUPABASE.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      { NEXT_PUBLIC_SUPABASE_URL: "  ", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SUPABASE.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      SUPABASE,
      {},
    ];
    const states: string[] = [];
    for (const fixture of fixtures) {
      for (const runtime of [{ NODE_ENV: "production" }, {}, { SIRKIT_AUTH_MODE: "local_dev" }] as Env[]) {
        const environment = { ...runtime, ...fixture };
        const report = await readinessReport({ environment, database: reachable });
        const expected = sensitiveOperationsBlocker({ ...environment, SIRKIT_AUTH_MODE: "production" }) === null ? "configured" : "not_configured";
        expect(stateOf(report, "supabase_auth_configuration"), JSON.stringify(environment)).toBe(expected);
        states.push(expected);
        expect(stateOf(report, "expected_origin")).toBe(productionExpectedOrigin(environment).state);
        const profile = resolveDeploymentProfile(environment);
        expect(stateOf(report, "deployment_profile")).toBe(profile.servesSensitiveRoutes ? "serving" : profile.declared === "unset" || profile.declared === "invalid" ? profile.declared : "not_serving");
      }
    }
    // the anon-key fallback configures; an explicitly empty publishable key does NOT fall through to the anon key
    expect(states.slice(0, 3)).toEqual(["configured", "configured", "configured"]);
    expect(states.slice(3, 6)).toEqual(["not_configured", "not_configured", "not_configured"]);
    // a local environment with no origin: not_configured although the request URL would serve local development
    expect(stateOf(await readinessReport({ environment: {}, database: reachable }), "expected_origin")).toBe("not_configured");
    const source = read("app/lib/deployment/readiness.ts");
    expect(source).toContain('sensitiveOperationsBlocker({ ...environment, SIRKIT_AUTH_MODE: "production" })');
    expect(source).toContain("productionExpectedOrigin(environment)");
    expect(source).toContain("resolveDeploymentProfile(environment)");
  });

  it("7. the database probe is an injected port: an unset or blank DATABASE_URL answers not_configured without calling it; a throw answers unreachable; a stall answers timeout within the bound, its signal aborted; the default runs select 1 through getSqlClient(), bounded at 2,000 ms", async () => {
    let calls = 0;
    const counting: DatabaseProbePort = async () => { calls += 1; };
    for (const url of [undefined, "", "  "]) expect(await probeDatabase(url === undefined ? {} : { DATABASE_URL: url }, counting), String(url)).toBe("not_configured");
    expect(calls).toBe(0);
    expect(await probeDatabase({ DATABASE_URL: FAKE_DATABASE_URL }, counting)).toBe("reachable");
    expect(calls).toBe(1);
    expect(await probeDatabase({ DATABASE_URL: FAKE_DATABASE_URL }, async () => { throw new Error(`connect ECONNREFUSED ${FAKE_DATABASE_URL}`); })).toBe("unreachable");
    let aborted = false;
    const started = Date.now();
    const stalled = await probeDatabase({ DATABASE_URL: FAKE_DATABASE_URL }, (signal) => new Promise(() => { signal.addEventListener("abort", () => { aborted = true; }); }), 60);
    expect(stalled).toBe("timeout");
    expect(aborted).toBe(true);
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(DATABASE_PROBE_BOUND_MS).toBe(2_000);
    const report = await readinessReport({ environment: { ...READY_ENV }, database: async () => { throw new Error("down"); } });
    expect(stateOf(report, "database")).toBe("unreachable");
    expect(report.ready).toBe(false);
    const source = read("app/lib/deployment/readiness.ts");
    expect(source).toMatch(/getSqlClient\(\)`select 1`/);
    expect(source).toMatch(/export const DATABASE_PROBE_BOUND_MS = 2_000;/);
  });

  it("8. both rows derive no model egress, no outbound egress and no process; ready is annotated durable none and sensitivity none, health is static; neither route binds an SDK client; one api-only read record owns both, and the B01 matrices are the registry's", () => {
    const rows = routeResourceClassification().filter((row) => row.path === "/api/health" || row.path === "/api/ready");
    expect(rows.map((row) => ({ path: row.path, method: row.method, modelEgress: row.modelEgress, outboundEgress: row.outboundEgress, externalProcess: row.externalProcess, durableAccess: row.durableAccess, sensitivity: row.projectDataSensitivity, providerCredit: row.providerCredit, isPublic: row.isPublic, staticOrCatalog: row.staticOrCatalog }))).toEqual([
      { path: "/api/health", method: "GET", modelEgress: false, outboundEgress: "none", externalProcess: "", durableAccess: "none", sensitivity: "none", providerCredit: false, isPublic: true, staticOrCatalog: true },
      { path: "/api/ready", method: "GET", modelEgress: false, outboundEgress: "none", externalProcess: "", durableAccess: "none", sensitivity: "none", providerCredit: false, isPublic: false, staticOrCatalog: false },
    ]);
    const classification = read("app/lib/auth/route-resource-classification.ts").split(NEWLINE);
    expect(classification[98]).toMatch(/^ {2}"\/api\/pcb\/provider-exchange": \{ durable: "read", sensitivity: "project-durable", expensive: true \}, "\/api\/ready": \{ durable: "none", sensitivity: "none" \},/);
    for (const path of ["app/api/health/route.ts", "app/api/ready/route.ts", "app/lib/deployment/readiness.ts", "app/lib/deployment/configuration.ts"]) expect(read(path), path).not.toMatch(/from "(?:openai|@anthropic-ai\/sdk)"|new (?:OpenAI|Anthropic)\(|\/embeddings"|\/parts-search"|\/net\/outbound-fetch"/);
    const record = ACTION_COVERAGE_REGISTRY.find((candidate) => candidate.id === "project.service-health");
    expect(record).toMatchObject({ id: "project.service-health", version: 1, area: "project", kind: "read", status: "api-only", toolExposure: "none", approvalTier: "none", mutationAuthority: "none" });
    expect(record?.sideEffects).toBeUndefined();
    expect(API_ROUTE_COVERAGE.filter((entry) => entry.recordId === "project.service-health")).toEqual([{ path: "/api/health", methods: ["GET"], recordId: "project.service-health", class: "read" }, { path: "/api/ready", methods: ["GET"], recordId: "project.service-health", class: "read" }]);
    expect(ACTION_COVERAGE_REGISTRY).toHaveLength(107);
    expect(ACTION_COVERAGE_REGISTRY.at(-1)?.id).toBe("project.service-health");
    expect(ACTION_COVERAGE_REGISTRY.at(-2)?.id).toBe("manufacturing.provider-order");
    expect(read("artifacts/ai-control-plane-b01/api-route-coverage.csv")).toBe(renderApiRouteCoverageCsv());
    expect(read("artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv")).toBe(renderActionToolabilityCsv());
    expect(read("artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv").split(NEWLINE)[106]).toMatch(/^manufacturing\.provider-order,1,manufacturing,/);
  });

  it("9. the census moves once, by these two route files: 168 route methods = 165 canonical + 3 factories + 0 raw; the agent-tool counts stay 47 / 36", { timeout: 120_000 }, () => {
    let total = 0, canonical = 0, factories = 0, raw = 0;
    for (const file of listRouteFiles(ROOT)) {
      const src = readFileSync(file, "utf8");
      for (const method of exportedHttpMethods(src, file)) {
        total += 1;
        const form = classifyRouteMethodForm(src, method, file, ROOT).form;
        if (form === "canonical-wrapper") canonical += 1; else if (form === "factory") factories += 1; else raw += 1;
      }
    }
    expect({ total, canonical, factories, raw }).toEqual({ total: 168, canonical: 165, factories: 3, raw: 0 });
    for (const path of ["app/api/health/route.ts", "app/api/ready/route.ts"]) expect(classifyRouteMethodForm(read(path), "GET", join(ROOT, path), ROOT).form, path).toBe("canonical-wrapper");
    expect(sirkitToolRegistry().list()).toHaveLength(47);
    expect(sirkitToolRegistry().list().filter((descriptor) => descriptor.agentExposed)).toHaveLength(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toHaveLength(36);
  });

  it("10. /api/ready reports the deployment configuration's digest, built once per process: the same digest on every call, the record's; [B24-A1 review] regressions-1 / tests-3: with DATABASE_URL in the process (as a shell export puts it) the route's probe is the suite's guard port, never the database client", async () => {
    stubAll({ SIRKIT_WORKFLOW_WORKER_SECRET: WORKER_SECRET, DATABASE_URL: FAKE_DATABASE_URL });
    const first = (await (await call(ready, "/api/ready", { authorization: `Bearer ${WORKER_SECRET}` })).json()) as ReadinessReport;
    const second = (await (await call(ready, "/api/ready", { authorization: `Bearer ${WORKER_SECRET}` })).json()) as ReadinessReport;
    expect(first.configurationDigest).toBe(second.configurationDigest);
    expect(first.configurationDigest).toBe(deploymentConfiguration().digest);
    expect((await readinessReport({ environment: READY_ENV, database: reachable })).configurationDigest).toBe(buildDeploymentConfiguration(READY_ENV).digest);
    expect(first.configurationDigest).toMatch(/^eng1-[0-9a-f]+$/);
    expect([stateOf(first, "database"), stateOf(second, "database")]).toEqual(["unreachable", "unreachable"]);
    expect(guard.calls).toBeGreaterThanOrEqual(2);
    expect(db.stray).toBe(0);
  });

  it("11. [B24-A1 review] tests-6: the route's own bound and the default port, exercised - with no bound handed in, a stalled database answers timeout at DATABASE_PROBE_BOUND_MS and not a moment before, the default port sends select 1 through getSqlClient() and cancels it when the bound expires; a port that throws at once answers unreachable", async () => {
    let cancelled = 0;
    const sent: string[] = [];
    db.query = (text) => {
      sent.push(text);
      const stalled = new Promise<never>(() => undefined) as Promise<never> & { cancel: () => Promise<void> };
      stalled.cancel = async () => { cancelled += 1; };
      return stalled;
    };
    setDatabaseProbePortForTests(null);
    stubAll({ ...READY_ENV, SIRKIT_WORKFLOW_WORKER_SECRET: WORKER_SECRET });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let settled = false;
      const answer = call(ready, "/api/ready", { authorization: `Bearer ${WORKER_SECRET}` }).then((response) => { settled = true; return response; });
      // the probe's timer is armed before the port is called: wait (real turns, the clock still) until the fake query was sent
      for (let turn = 0; turn < 200 && sent.length === 0; turn += 1) await new Promise((resolve) => setImmediate(resolve));
      expect(sent).toEqual(["select 1"]);
      await vi.advanceTimersByTimeAsync(DATABASE_PROBE_BOUND_MS - 1);
      expect(settled).toBe(false);
      expect(cancelled).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      for (let turn = 0; turn < 200 && !settled; turn += 1) await new Promise((resolve) => setImmediate(resolve));
      expect(settled).toBe(true);
      const response = await answer;
      expect(response.status).toBe(503);
      const body = (await response.json()) as ReadinessReport;
      expect(stateOf(body, "database")).toBe("timeout");
      expect(body.ready).toBe(false);
      expect(cancelled).toBe(1);
    } finally {
      vi.useRealTimers();
    }
    const throwsAtOnce: DatabaseProbePort = () => { throw new Error("refused before any promise"); };
    expect(await probeDatabase({ DATABASE_URL: FAKE_DATABASE_URL }, throwsAtOnce)).toBe("unreachable");
    expect(stateOf(await readinessReport({ environment: READY_ENV, database: throwsAtOnce }), "database")).toBe("unreachable");
  });
});
