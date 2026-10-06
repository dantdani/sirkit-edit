/**
 * [B24-A1] The deployment profile (D24-1 offline, OD-190), the production-smoke CI job's shape and the page.
 *
 * `SIRKIT_DEPLOYMENT_ENV` takes development, ci, staging or production, exactly. In a production runtime only staging and production
 * serve sensitive routes, and a missing or malformed expected origin refuses them too, a read included; a non-production runtime is
 * never blocked by the profile (local_dev stays as it is). The blocker checks in a fixed order - the unchanged
 * `sensitiveOperationsBlocker`, then the profile, then the origin - so the B16.1B and B20-B2 production cases keep their codes. Its
 * only two callers are the trusted request context and the MCP wrapper; the worker and public paths never call it.
 *
 * Failing first on 8664964: the module does not exist, and the three counterexamples (no profile, a `ci` profile, no origin on a
 * read) resolve there (page section 8). Nothing is written to disk and no process is started; every credential is an obvious fake
 * assembled at run time.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { authorizeRequest } from "@/app/lib/auth/authorize";
import {
  DEPLOYMENT_PROFILE_ENV,
  DEPLOYMENT_PROFILES,
  SERVING_DEPLOYMENT_PROFILES,
  productionExpectedOrigin,
  productionServingBlocker,
  resolveDeploymentProfile,
} from "@/app/lib/auth/deployment-profile";
import { resolveExpectedOrigin } from "@/app/lib/auth/expected-origin";
import type { IdentityProvider } from "@/app/lib/auth/identity-provider";
import { setIdentityProviderFactory } from "@/app/lib/auth/identity-runtime";
import { sensitiveOperationsBlocker } from "@/app/lib/auth/mode";
import { mcpBearerJsonRoute } from "@/app/lib/auth/route-handlers";
import { injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { resolveTrustedRequestContext } from "@/app/lib/auth/trusted-request-context";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const lines = (path: string): string[] => read(path).split(NEWLINE);
type Env = Record<string, string | undefined>;

const ORIGIN = "https://sirkit.example";
/** obvious fakes, assembled at run time */
const SUPABASE: Env = { NEXT_PUBLIC_SUPABASE_URL: ["https://", "b24-a1-fake", ".supabase.example"].join(""), NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: ["fake", "publishable", "b24", "a1"].join("-") };
const WORKER_SECRET = ["b24", "a1", "worker", "fixture", "0123456789abcdef"].join("-");
const SENTINEL = ["b24", "a1", "profile", "sentinel"].join("-");
const PRODUCTION: Env = { NODE_ENV: "production", ...SUPABASE, SIRKIT_EXPECTED_ORIGIN: ORIGIN, SIRKIT_DEPLOYMENT_ENV: "production" };
const USER = "user-b24-a1";
const PROJECT = "proj-b24";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" } as const;
const WORKFLOW = ".github/workflows/deterministic-manufacturing.yml";
const PAGE = "artifacts/ai-control-plane-b24/environments-and-deployment.md";
const DISCOVERY = "artifacts/ai-control-plane-b24/discovery.md";

/** A member whose identity provider counts its verifications (so a refusal BEFORE identity is observable). */
const verifications = { count: 0 };
function member(): void {
  const provider: IdentityProvider = {
    async verify() {
      verifications.count += 1;
      return { userId: USER, sessionId: "session-b24-a1", authMethod: "supabase_cookie", authStrength: "aal1" };
    },
  };
  setIdentityProviderFactory(() => provider);
  injectMembership([{ projectId: PROJECT, userId: USER, role: "admin" }]);
}
const get = (path: string, headers: Record<string, string> = {}): Request => new Request(`${ORIGIN}${path}`, { method: "GET", headers: { ...SEL, ...headers } });
const post = (path: string, headers: Record<string, string> = {}): Request => new Request(`${ORIGIN}${path}`, { method: "POST", headers: { ...SEL, "content-type": "application/json", ...headers } });
async function codeOf(response: Response): Promise<string> {
  return ((await response.clone().json()) as { code: string }).code;
}

afterEach(() => {
  resetInjectedIdentity();
  verifications.count = 0;
});

describe("[B24-A1] the deployment profile (D24-1 offline, OD-190)", () => {
  it("1. the vocabulary is closed and exact: development, ci, staging and production; anything else - a trimmed, re-cased or empty spelling included - is invalid, an absent variable is unset, and no value is echoed", () => {
    expect(DEPLOYMENT_PROFILE_ENV).toBe("SIRKIT_DEPLOYMENT_ENV");
    expect([...DEPLOYMENT_PROFILES]).toEqual(["development", "ci", "staging", "production"]);
    expect([...SERVING_DEPLOYMENT_PROFILES]).toEqual(["staging", "production"]);
    for (const name of DEPLOYMENT_PROFILES) expect(resolveDeploymentProfile({ SIRKIT_DEPLOYMENT_ENV: name }).declared, name).toBe(name);
    for (const value of ["", " ", " production", "production ", "Production", "PRODUCTION", "prod", "stage", `staging${NEWLINE}`, "dev", "test", SENTINEL]) {
      expect(resolveDeploymentProfile({ SIRKIT_DEPLOYMENT_ENV: value }).declared, JSON.stringify(value)).toBe("invalid");
    }
    expect(resolveDeploymentProfile({}).declared).toBe("unset");
    expect(Object.isFrozen(resolveDeploymentProfile({}))).toBe(true);
    expect(Object.keys(resolveDeploymentProfile({})).sort()).toEqual(["declared", "runtime", "servesSensitiveRoutes"]);
    expect(JSON.stringify(resolveDeploymentProfile({ NODE_ENV: "production", SIRKIT_DEPLOYMENT_ENV: SENTINEL }))).not.toContain(SENTINEL);
  });

  it("2. the resolver: in a production runtime only staging and production serve sensitive routes; in a non-production runtime the profile never blocks, whatever it says", () => {
    for (const value of [undefined, "", "development", "ci", "staging", "production", SENTINEL]) {
      const declared: Env = value === undefined ? {} : { SIRKIT_DEPLOYMENT_ENV: value };
      expect(resolveDeploymentProfile({ NODE_ENV: "production", ...declared }), String(value)).toMatchObject({ runtime: "production", servesSensitiveRoutes: value === "staging" || value === "production" });
      for (const runtime of [{}, { NODE_ENV: "development" }, { NODE_ENV: "test" }, { SIRKIT_AUTH_MODE: "production" }, { SIRKIT_AUTH_MODE: "local_dev" }] as Env[]) {
        expect(resolveDeploymentProfile({ ...runtime, ...declared }), `${JSON.stringify(runtime)} ${String(value)}`).toMatchObject({ runtime: "non-production", servesSensitiveRoutes: true });
      }
    }
  });

  it("3. the blocker checks in order - (a) sensitiveOperationsBlocker with its text unchanged, (b) a profile that does not serve, (c) a missing or malformed expected origin by expected-origin.ts's own rules - and its messages name variables, never a value", () => {
    // (a) first, whatever else is set: the B16.1B (b16-1b-auth-composition :209, :215-221) and B20-B2 (:657-667) production cases
    for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", SIRKIT_DEPLOYMENT_ENV: "ci" }, { NODE_ENV: "production", SIRKIT_DEPLOYMENT_ENV: "production" }, { SIRKIT_AUTH_MODE: "production" }, { NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: SUPABASE.NEXT_PUBLIC_SUPABASE_URL, SIRKIT_DEPLOYMENT_ENV: "staging" }] as Env[]) {
      expect(productionServingBlocker(env), JSON.stringify(env)).toEqual({ code: "AUTH_PRODUCTION_NOT_CONFIGURED", message: sensitiveOperationsBlocker(env) });
    }
    // (b) a production runtime with authentication configured but no serving profile
    for (const value of [undefined, "development", "ci", "", SENTINEL]) {
      const env: Env = { NODE_ENV: "production", ...SUPABASE, SIRKIT_EXPECTED_ORIGIN: ORIGIN, ...(value === undefined ? {} : { SIRKIT_DEPLOYMENT_ENV: value }) };
      const blocked = productionServingBlocker(env);
      expect(blocked?.code, String(value)).toBe("AUTH_PRODUCTION_NOT_CONFIGURED");
      expect(blocked?.message).toContain("SIRKIT_DEPLOYMENT_ENV");
      for (const leaked of [SENTINEL, ORIGIN, SUPABASE.NEXT_PUBLIC_SUPABASE_URL!, SUPABASE.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!]) expect(blocked?.message).not.toContain(leaked);
    }
    // [B24-A1 review] tests-2: (b) before (c) - with neither the profile nor the origin, the profile answers first
    for (const value of [undefined, "ci", SENTINEL]) {
      const neither = productionServingBlocker({ NODE_ENV: "production", ...SUPABASE, ...(value === undefined ? {} : { SIRKIT_DEPLOYMENT_ENV: value }) });
      expect(neither?.code, String(value)).toBe("AUTH_PRODUCTION_NOT_CONFIGURED");
      expect(neither?.message).toContain("SIRKIT_DEPLOYMENT_ENV");
      expect(neither?.message).not.toContain("SIRKIT_EXPECTED_ORIGIN");
    }
    // (c) then the expected origin, by the rules of expected-origin.ts:88-100 with production forced
    const served: Env = { NODE_ENV: "production", ...SUPABASE, SIRKIT_DEPLOYMENT_ENV: "staging" };
    for (const origin of [undefined, "", "   "]) expect(productionServingBlocker({ ...served, ...(origin === undefined ? {} : { SIRKIT_EXPECTED_ORIGIN: origin }) })?.code, String(origin)).toBe("AUTH_ORIGIN_NOT_CONFIGURED");
    for (const origin of ["not an origin", `${ORIGIN}/path`, "http://sirkit.example", "ftp://sirkit.example", "https://a@sirkit.example", SENTINEL]) {
      const blocked = productionServingBlocker({ ...served, SIRKIT_EXPECTED_ORIGIN: origin });
      expect(blocked?.code, origin).toBe("AUTH_ORIGIN_CONFIG_MALFORMED");
      expect(blocked?.message).toContain("SIRKIT_EXPECTED_ORIGIN");
      expect(blocked?.message).not.toContain(origin);
    }
    for (const origin of [ORIGIN, `${ORIGIN}/`, "http://localhost:3200", "http://127.0.0.1:3100"]) expect(productionServingBlocker({ ...served, SIRKIT_EXPECTED_ORIGIN: origin }), origin).toBeNull();
    // the owner's rules: in a production runtime the state is resolveExpectedOrigin's, whatever the request URL says
    for (const origin of [undefined, "", ORIGIN, `${ORIGIN}/x`, "http://sirkit.example", "http://localhost:3200", "https://sirkit.example:443"]) {
      for (const url of ["https://sirkit.example/api/x", "http://localhost:3200/api/x", "https://evil.example/api/x"]) {
        const env: Env = { ...served, ...(origin === undefined ? {} : { SIRKIT_EXPECTED_ORIGIN: origin }) };
        const owner = resolveExpectedOrigin(new Request(url), env);
        const expected = owner.ok ? "configured" : owner.code === "AUTH_ORIGIN_CONFIG_MALFORMED" ? "malformed" : "not_configured";
        expect(productionExpectedOrigin(env).state, `${String(origin)} ${url}`).toBe(expected);
        // forced production: a local, unconfigured environment is not_configured (the request URL is never consulted)
        expect(productionExpectedOrigin({ ...(origin === undefined ? {} : { SIRKIT_EXPECTED_ORIGIN: origin }) }).state, String(origin)).toBe(expected);
      }
    }
    // a non-production runtime is never blocked by the profile or the origin (local_dev stays as it is; CSRF still guards writes)
    for (const env of [{}, { SIRKIT_DEPLOYMENT_ENV: "ci" }, { SIRKIT_DEPLOYMENT_ENV: SENTINEL }, { SIRKIT_AUTH_MODE: "production", ...SUPABASE }, { NODE_ENV: "test", ...SUPABASE, SIRKIT_AUTH_MODE: "production", SIRKIT_DEPLOYMENT_ENV: "development" }] as Env[]) {
      expect(productionServingBlocker(env), JSON.stringify(env)).toBeNull();
    }
    expect(productionServingBlocker(PRODUCTION)).toBeNull();
  });

  it("4. counterexample (red on 8664964): a production runtime with Supabase and the origin configured but NO profile is refused 403 AUTH_PRODUCTION_NOT_CONFIGURED before any identity work; so is an invalid profile, and ([B24-A1 review] tests-2) so is neither profile nor origin - the profile's code, not the origin's", async () => {
    member();
    for (const [value, origin] of [[undefined, ORIGIN], [SENTINEL, ORIGIN], [undefined, undefined]] as const) {
      const environment: Env = { NODE_ENV: "production", ...SUPABASE, ...(origin === undefined ? {} : { SIRKIT_EXPECTED_ORIGIN: origin }), ...(value === undefined ? {} : { SIRKIT_DEPLOYMENT_ENV: value }) };
      const resolved = await resolveTrustedRequestContext(get("/api/pcb-sync"), { environment });
      expect(resolved.ok, String(value)).toBe(false);
      if (resolved.ok) continue;
      expect(resolved.refusal.response.status).toBe(403);
      expect(await codeOf(resolved.refusal.response)).toBe("AUTH_PRODUCTION_NOT_CONFIGURED");
      expect(JSON.stringify(await resolved.refusal.response.clone().json())).not.toContain(SENTINEL);
    }
    expect(verifications.count).toBe(0);
  });

  it("5. counterexample (red on 8664964): a `ci` or `development` profile in a production runtime is refused 403 AUTH_PRODUCTION_NOT_CONFIGURED, reads and writes alike", async () => {
    member();
    for (const profile of ["ci", "development"]) {
      const environment: Env = { ...PRODUCTION, SIRKIT_DEPLOYMENT_ENV: profile };
      for (const request of [get("/api/pcb-sync"), post("/api/pcb-sync", { origin: ORIGIN })]) {
        const outcome = await authorizeRequest(request, { environment });
        expect(outcome.ok, `${profile} ${request.method}`).toBe(false);
        if (!outcome.ok) expect(await codeOf(outcome.response)).toBe("AUTH_PRODUCTION_NOT_CONFIGURED");
      }
    }
    expect(verifications.count).toBe(0);
  });

  it("6. counterexample (red on 8664964): with profile `production` and no expected origin an authenticated GET is refused 403 AUTH_ORIGIN_NOT_CONFIGURED (it passed before); a malformed origin is refused AUTH_ORIGIN_CONFIG_MALFORMED", async () => {
    member();
    const unconfigured = await authorizeRequest(get("/api/pcb-sync"), { environment: { ...PRODUCTION, SIRKIT_EXPECTED_ORIGIN: undefined } });
    expect(unconfigured.ok).toBe(false);
    if (!unconfigured.ok) {
      expect(unconfigured.response.status).toBe(403);
      expect(await codeOf(unconfigured.response)).toBe("AUTH_ORIGIN_NOT_CONFIGURED");
    }
    const malformed = await authorizeRequest(get("/api/pcb-sync"), { environment: { ...PRODUCTION, SIRKIT_EXPECTED_ORIGIN: "http://sirkit.example" } });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(await codeOf(malformed.response)).toBe("AUTH_ORIGIN_CONFIG_MALFORMED");
    expect(verifications.count).toBe(0);
  });

  it("7. a fully configured production or staging deployment serves: the GET resolves the server-derived actor, a same-origin write is authorized, a cross-origin write is still refused by CSRF; local_dev resolves as before", async () => {
    member();
    for (const profile of ["production", "staging"]) {
      const environment: Env = { ...PRODUCTION, SIRKIT_DEPLOYMENT_ENV: profile };
      const read = await authorizeRequest(get("/api/pcb-sync"), { environment });
      expect(read.ok, profile).toBe(true);
      if (read.ok && read.kind === "authenticated") expect(read.context.actor).toMatchObject({ actorId: USER, actorKind: "human" });
      expect((await authorizeRequest(post("/api/pcb-sync", { origin: ORIGIN }), { environment })).ok).toBe(true);
      const cross = await authorizeRequest(post("/api/pcb-sync", { origin: "https://evil.example" }), { environment });
      expect(cross.ok).toBe(false);
      if (!cross.ok) expect(await codeOf(cross.response)).toBe("AUTH_CROSS_ORIGIN_DENIED");
    }
    const local = await resolveTrustedRequestContext(get("/api/pcb-sync"), { environment: { SIRKIT_DEPLOYMENT_ENV: "ci" } });
    expect(local.ok).toBe(true);
  });

  it("8. the MCP wrapper is the blocker's second caller: in a production runtime with MCP on and Supabase configured, no profile is 403 AUTH_PRODUCTION_NOT_CONFIGURED and no origin 403 AUTH_ORIGIN_NOT_CONFIGURED, before any token work; a serving profile with the origin passes the blocker (503 MCP_NOT_CONFIGURED without a signing key)", async () => {
    const handled: unknown[] = [];
    const route = (environment: Env) => mcpBearerJsonRoute({ maxBytes: 4_096, environment }, async (input) => { handled.push(input); return Response.json({ ok: true }); });
    const call = (environment: Env) => route(environment)(new Request(`${ORIGIN}/api/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer not-a-token" }, body: "{}" }));
    const base: Env = { NODE_ENV: "production", SIRKIT_MCP_ENABLED: "1", ...SUPABASE };
    const noProfile = await call({ ...base, SIRKIT_EXPECTED_ORIGIN: ORIGIN });
    expect([noProfile.status, await codeOf(noProfile)]).toEqual([403, "AUTH_PRODUCTION_NOT_CONFIGURED"]);
    expect(noProfile.headers.get("www-authenticate")).toBeNull();
    const noOrigin = await call({ ...base, SIRKIT_DEPLOYMENT_ENV: "production" });
    expect([noOrigin.status, await codeOf(noOrigin)]).toEqual([403, "AUTH_ORIGIN_NOT_CONFIGURED"]);
    const neither = await call(base); // [B24-A1 review] tests-2: the profile answers before the origin
    expect([neither.status, await codeOf(neither)]).toEqual([403, "AUTH_PRODUCTION_NOT_CONFIGURED"]);
    const served = await call({ ...base, SIRKIT_DEPLOYMENT_ENV: "production", SIRKIT_EXPECTED_ORIGIN: ORIGIN });
    expect([served.status, await codeOf(served)]).toEqual([503, "MCP_NOT_CONFIGURED"]);
    expect(handled).toEqual([]);
  });

  it("9. wired in place at the blocker's only two callers, no line moved; the worker and public paths never call it (by design): a worker secret and a public row are served in a production runtime with no profile and no Supabase", async () => {
    const context = lines("app/lib/auth/trusted-request-context.ts");
    expect(context).toHaveLength(166); // 165 lines and the final newline
    expect(context[23]).toMatch(/^import \{ resolveAuthMode \} from "\.\/mode"; import \{ productionServingBlocker \} from "\.\/deployment-profile";/);
    expect(context[62]).toMatch(/^ {2}const blocker = productionServingBlocker\(environment\);/);
    expect(context[64]).toContain("return refuse(forbidden(blocker.code, blocker.message));");
    const handlers = lines("app/lib/auth/route-handlers.ts");
    expect(handlers).toHaveLength(1093);
    expect(handlers[45]).toMatch(/^import \{ projectAuthRuntime, type AuthRuntimeProjection \} from "\.\/mode"; import \{ productionServingBlocker \} from "\.\/deployment-profile";/);
    expect(handlers[1009]).toMatch(/^ {6}const blocker = productionServingBlocker\(environment\);/);
    expect(handlers[1010]).toContain("if (blocker) return forbidden(blocker.code, blocker.message);");
    // the only callers, across every production source
    const callers: string[] = [];
    const legacy: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__" && entry.name !== "node_modules" && !entry.name.startsWith(".")) walk(path);
        } else if (/\.(?:tsx?|mjs)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          const text = read(path);
          if (/\bproductionServingBlocker\(/.test(text) && path !== "app/lib/auth/deployment-profile.ts") callers.push(path);
          if (/\bsensitiveOperationsBlocker\(/.test(text)) legacy.push(path);
        }
      }
    };
    for (const dir of ["app", "lib", "components"]) walk(dir);
    expect(callers.sort()).toEqual(["app/lib/auth/route-handlers.ts", "app/lib/auth/trusted-request-context.ts"]);
    expect(legacy.sort()).toEqual(["app/lib/auth/deployment-profile.ts", "app/lib/auth/mode.ts", "app/lib/deployment/readiness.ts"]);
    // what is not blocked: the worker and public paths (authorize.ts:62-83)
    const environment: Env = { NODE_ENV: "production", SIRKIT_WORKFLOW_WORKER_SECRET: WORKER_SECRET };
    const worker = await authorizeRequest(new Request(`${ORIGIN}/api/engineering-effects`, { method: "POST", headers: { authorization: `Bearer ${WORKER_SECRET}` } }), { environment });
    expect(worker.ok && worker.kind).toBe("worker");
    for (const path of ["/api/ai/runtime", "/api/health"]) {
      const open = await authorizeRequest(new Request(`${ORIGIN}${path}`), { environment });
      expect(open.ok && open.kind, path).toBe("public");
    }
    expect(read("app/lib/auth/authorize.ts")).not.toMatch(/productionServingBlocker|sensitiveOperationsBlocker/);
  });

  it("10. .env.example declares SIRKIT_DEPLOYMENT_ENV commented and empty, after the MCP block (:79), its four values named", () => {
    const example = lines(".env.example");
    const at = example.findIndex((line) => line === "# SIRKIT_DEPLOYMENT_ENV=");
    expect(at).toBeGreaterThan(78);
    expect(example.filter((line) => /^SIRKIT_DEPLOYMENT_ENV=/.test(line))).toEqual([]);
    const block = example.slice(Math.max(0, at - 6), at).join(NEWLINE);
    for (const name of DEPLOYMENT_PROFILES) expect(block, name).toContain(name);
    expect(example[78]).toBe("# SIRKIT_MCP_TOKEN_SECRET=");
  });
});

// ── the production-smoke job (A1b item 6) ─────────────────────────────────────────────────────────────────────────────────────────

/** A top-level job of a workflow text: its lines, from its header to the next job header. */
function jobIn(all: readonly string[], name: string): { start: number; lines: string[] } {
  const start = all.indexOf(`  ${name}:`);
  const end = all.findIndex((line, index) => index > start && /^ {2}[a-z][a-z0-9-]*:$/.test(line));
  return { start, lines: all.slice(start, end < 0 ? undefined : end) };
}
const job = (name: string): { start: number; lines: string[] } => jobIn(lines(WORKFLOW), name);

/** [B24-A1 review] regressions-2: where production-smoke stands, over any workflow text (case 11 on the tree, case 16 on the edits
 *  later tasks plan): appended after page-browser-e2e, the next job after it, so no line it cites moved. A job a later task appends
 *  after production-smoke (B24-A2's, task-A2.md:56) is allowed; "production-smoke is the last job" is not pinned. */
function jobOrderProblems(all: readonly string[]): string[] {
  const smoke = jobIn(all, "production-smoke");
  const browser = jobIn(all, "page-browser-e2e");
  const problems: string[] = [];
  if (smoke.start < 0 || browser.start < 0) problems.push("production-smoke or page-browser-e2e is missing");
  if (!(smoke.start > browser.start + browser.lines.length - 2)) problems.push("production-smoke does not follow page-browser-e2e");
  const next = all.findIndex((line, index) => index > browser.start && /^ {2}[a-z][a-z0-9-]*:$/.test(line));
  if (next !== smoke.start) problems.push("the job after page-browser-e2e is not production-smoke");
  return problems;
}

describe("[B24-A1] production mode in CI (D24-1 offline, OD-190)", () => {
  it("11. the production-smoke job: appended after page-browser-e2e (no cited line moves), 20 minutes, next build with a 4 GB heap then next start in the background, a ci profile with the expected origin and a worker secret generated per run and masked, no Supabase, database, provider or fixture variable, every probe pinned, an always() teardown, logs on failure; no secrets. reference and permissions unchanged", () => {
    const all = lines(WORKFLOW);
    const smoke = job("production-smoke");
    expect(jobOrderProblems(all)).toEqual([]);
    const text = smoke.lines.join(NEWLINE);
    expect(text).toMatch(/^ {4}runs-on: ubuntu-latest$/m);
    expect(text).toMatch(/^ {4}timeout-minutes: 20$/m);
    expect(text).toContain("pnpm exec next build");
    expect(text).toMatch(/NODE_OPTIONS: --max-old-space-size=4096/);
    expect(text).toMatch(/nohup pnpm exec next start --port "\$SMOKE_PORT" > next-start\.log 2>&1 &/);
    expect(text).toMatch(/^ {6}SMOKE_PORT: "3200"$/m);
    expect(text).toMatch(/^ {6}SMOKE_ORIGIN: http:\/\/localhost:3200$/m);
    expect(text).toMatch(/^ {10}SIRKIT_DEPLOYMENT_ENV: ci$/m);
    expect(text).toMatch(/^ {10}SIRKIT_EXPECTED_ORIGIN: http:\/\/localhost:3200$/m);
    expect(text).toContain("openssl rand -hex 32");
    expect(text).toContain("::add-mask::");
    expect(text).toContain('SIRKIT_WORKFLOW_WORKER_SECRET="${secret}"');
    expect(text.match(/set -euo pipefail/g)?.length).toBeGreaterThanOrEqual(3);
    for (const absent of ["NEXT_PUBLIC_SUPABASE", "DATABASE_URL", "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "SIRKIT_FIXTURE", "SIRKIT_DB_QUALIFICATION", "SIRKIT_NAMED_COMPUTATIONS", "SIRKIT_AUTH_MODE", "SIRKIT_MCP", "NODE_ENV"]) expect(text, absent).not.toContain(absent);
    // the probes
    for (const probe of [
      '"$SMOKE_ORIGIN/api/health")" = 200',
      "grep -qF '{\"ok\":true}' health.json",
      '-H "Authorization: Bearer ${SMOKE_WORKER_SECRET}" "$SMOKE_ORIGIN/api/ready")" = 503',
      `grep -qF '{"name":"deployment_profile","state":"not_serving"}' ready.json`,
      `grep -qF '{"name":"supabase_auth_configuration","state":"not_configured"}' ready.json`,
      `grep -qF '{"name":"database","state":"not_configured"}' ready.json`,
      'if grep -qF "${SMOKE_WORKER_SECRET}" ready.json; then',
      '"$SMOKE_ORIGIN/api/ready")" = 401',
      `-H 'x-sirkit-project-id: smoke-project' "$SMOKE_ORIGIN/api/agent/autonomy")" = 403`,
      `grep -qF '"code":"AUTH_PRODUCTION_NOT_CONFIGURED"' autonomy.json`,
      `-X POST -H 'Origin: http://evil.example' "$SMOKE_ORIGIN/api/auth/signout")" = 403`,
      `grep -qF '"code":"AUTH_CROSS_ORIGIN_DENIED"' signout-cross.json`,
      `-X POST -H "Origin: $SMOKE_ORIGIN" "$SMOKE_ORIGIN/api/auth/signout")" = 503`,
      `grep -qF '"code":"AUTH_SIGNOUT_UNAVAILABLE"' signout.json`,
      "grep -qi '^content-security-policy:' ai-runtime.headers",
      '"$SMOKE_ORIGIN/api/ai/runtime")" = 200',
    ]) expect(text, probe).toContain(probe);
    // the first build: whether engine-worker.mjs is emitted is recorded; the durations are printed
    expect(text).toContain("engine-worker");
    expect(text).toContain("next build took");
    expect(text).toContain("next start answered after");
    // teardown and logs
    const stop = smoke.lines.findIndex((line) => line.includes("- name: Stop the production server"));
    expect(stop).toBeGreaterThan(0);
    expect(smoke.lines[stop + 1]).toMatch(/^ {8}if: always\(\)$/);
    const upload = smoke.lines.findIndex((line) => line.includes("- name: Upload the production-smoke logs"));
    expect(upload).toBeGreaterThan(stop);
    expect(smoke.lines[upload + 1]).toMatch(/^ {8}if: failure\(\)$/);
    // guards over the whole workflow
    const workflow = read(WORKFLOW);
    expect(workflow).not.toMatch(SECRETS_REFERENCE); // [B24-A1 lead, 2026-10-06] a secrets. expression, not a file name (see SECRETS_REFERENCE)
    // [B24-A1 check, 2026-10-06] by content, not by its line (:20-21 at A1's tree): the top-level block before `jobs:` holds one key
    const permissions = all.indexOf("permissions:");
    expect(permissions).toBeGreaterThan(-1);
    expect(permissions).toBeLessThan(all.indexOf("jobs:"));
    expect(all[permissions + 1]).toBe("  contents: read");
    expect(all[permissions + 2] ?? "").not.toMatch(/^\s+\S/);
    expect(workflow.match(/^permissions:/gm)).toHaveLength(1);
    expect(workflow.match(/^ {4}permissions:/gm)).toBeNull();
  });

  it("12. the B24 suites are admitted to CI by one directory filter after B23's (OD-222): app/lib/qualification/__tests__ at :228, once; no explicit B24 file entry; the guard's CHAPTERS takes b24-", () => {
    expect(admissionProblems(lines(WORKFLOW))).toEqual([]);
    expect(read("app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts")).toContain('const CHAPTERS = ["b19-", "b20-", "b21-", "b22-", "b23-", "b24-"] as const;');
  });
});

// ── the page ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  "0. What B24-A1 is",
  "1. The deployment profile (D24-1 offline, OD-190)",
  "2. The configuration record and the runtime report (D24-10, OD-199)",
  "3. The flag inventory and the sandbox switch (D24-11, OD-200)",
  "4. CI admission of b24- (OD-222)",
  "5. Health and readiness (D24-9, OD-198)",
  "6. Production mode in CI (D24-1 offline, OD-190)",
  "7. Live: BLOCKED-LIVE-QUALIFICATION (LB-13)",
  "8. Test-first record",
  "9. Every pin moved, and why",
  "10. The workflow shift (old -> new)",
  "11. Gates",
  "12. Statements A1 supersedes",
  "13. For the lead",
  "14. Citations",
  "15. What stays open", // [B24-A1 check, 2026-10-06]
] as const;
const section = (page: string, title: string): string => {
  const start = page.indexOf(`${NEWLINE}## ${title}${NEWLINE}`);
  const next = page.indexOf(`${NEWLINE}## `, start + 1);
  return start < 0 ? "" : page.slice(start, next < 0 ? undefined : next);
};
/** The discovery as committed at 8664964: the lead's later single-line closure clauses (`- [B24-<increment>, <date>] ...`) are skipped,
 *  so a line the page cites keeps its number (the b23-b-page case 5 rule). */
const discoveryAtBase = (): string[] => lines(DISCOVERY).filter((line) => !/^- \[B24-[A-F]\d*[a-z]?(?:,| )/.test(line));

/** [B24-A1 review] regressions-2: section 10's old -> new table against a workflow text (case 14 on the tree, case 16 on the edits later
 *  tasks plan). The table is A1's own shift and never moves: each row's new line is exactly its old line +1 past A1's filter line
 *  (:228). A later task that inserts workflow lines appends rows to section 10's insertion table instead - [B24-A1 check, 2026-10-06]
 *  one per contiguous group, "| [B24-<id>, <date>] | <job> | `:<first>` | <count> |", in insertion order, <first> the group's first
 *  line in the tree right after it - and a row's line today is its new line carried through every row, where its anchor must stand.
 *  The old column is A1's, frozen; each row's lines must lie in its job, and the rows must account for every line since A1. */
function shiftTableProblems(page: string, workflow: readonly string[]): string[] {
  const ten = section(page, SECTIONS[10]);
  const shift = [...ten.matchAll(/^\| `:(\d+)(?:-(\d+))?` \| `:(\d+)(?:-(\d+))?` \| `([^`]+)` \| [^|]+ \|$/gm)];
  // [B24-A1 check, 2026-10-06] the insertion rows in the handover's form, every one composed; a row in another form is reported
  const { rows, problems } = insertionTable(page);
  const a1 = (line: number): number => (line >= 228 ? line + 1 : line);
  const olds = shift.map((row) => `:${row[1]}${row[2] ? `-${row[2]}` : ""}`);
  if (olds.join(" ") !== A1_SHIFT_OLD.join(" ")) problems.push(`the old column is not A1's frozen table: ${olds.join(" ")}`);
  for (const row of shift) {
    const [oldStart, oldEnd, newStart, newEnd, anchor] = [Number(row[1]), row[2] ? Number(row[2]) : null, Number(row[3]), row[4] ? Number(row[4]) : null, row[5]!];
    if (newStart !== a1(oldStart)) problems.push(`${row[0]}: the new start is not A1's shift`);
    if (newEnd !== (oldEnd === null ? null : a1(oldEnd))) problems.push(`${row[0]}: the new end is not A1's shift`);
    const today = carry(newEnd ?? newStart, rows);
    if (!(workflow[today - 1] ?? "").includes(anchor)) problems.push(`${row[0]}: the anchor is not on :${today}`);
  }
  // each row's lines, carried through the later rows, lie in the job it names; together the rows account for every line since A1
  const regions = jobRegions(workflow);
  rows.forEach((row, index) => {
    const later = rows.slice(index + 1);
    const [first, last] = [carry(row.first, later), carry(row.first + row.count - 1, later)];
    const region = regions.get(row.job);
    if (!region || first < region.start || last > region.end) problems.push(`[${row.task}] \`:${row.first}\` +${row.count}: not in ${row.job} (:${first}-${last} at this tree)`);
  });
  const [inserted, recorded] = [lineCount(workflow) - A1_WORKFLOW_LINES, rows.reduce((sum, row) => sum + row.count, 0)];
  if (inserted !== recorded) problems.push(`${inserted} lines inserted since A1, ${recorded} recorded`);
  return problems;
}

/** [B24-A1 check, 2026-10-06] A1's tree, frozen: later tasks never move these numbers; they append insertion rows (section 10), and
 *  A1's checks carry A1's lines through them. The workflow's line count at A1, B23's PGlite entry there, section 10's old column. */
const A1_WORKFLOW_LINES = 435;
const A1_PGLITE_LINE = 302;
const A1_SHIFT_OLD = [":50-259", ":260-270", ":272-302", ":272-309", ":276", ":285", ":285-302", ":286-302", ":301", ":317", ":317-336", ":319", ":323", ":333", ":336", ":345", ":348"] as const;
type Insertion = { task: string; job: string; first: number; count: number };
const INSERTION_HEADER = "| task | job | first line | count |";
const INSERTION_ROW = /^\| \[(B24-[A-F]\d*[a-z]?), \d{4}-\d{2}-\d{2}\] \| ([a-z][a-z0-9-]*) \| `:(\d+)` \| ([1-9]\d*) \|$/;
/** Section 10's insertion table: one row per contiguous group of lines a later task inserted, in insertion order. */
function insertionTable(page: string): { rows: Insertion[]; problems: string[] } {
  const all = section(page, SECTIONS[10]).split(NEWLINE);
  const header = all.indexOf(INSERTION_HEADER);
  if (header < 0 || all[header + 1] !== "|---|---|---|---|") return { rows: [], problems: ["no insertion table"] };
  const rows: Insertion[] = [];
  const problems: string[] = [];
  for (let at = header + 2; at < all.length && all[at]!.startsWith("|"); at += 1) {
    const row = INSERTION_ROW.exec(all[at]!);
    if (row) rows.push({ task: row[1]!, job: row[2]!, first: Number(row[3]), count: Number(row[4]) });
    else problems.push(`a malformed insertion row: ${all[at]}`);
  }
  return { rows, problems };
}
/** A line of A1's tree (or of an earlier row's tree), carried through the rows given: each moves the lines at or after its first line. */
const carry = (line: number, rows: readonly Insertion[]): number => rows.reduce((at, row) => (at >= row.first ? at + row.count : at), line);
/** The page with one row appended to section 10's insertion table: after the last table line of section 10 ([B24-A1 check,
 *  2026-10-06] the insertion table is section 10's last table). */
function withInsertionRow(page: string, row: string): string {
  const all = page.split(NEWLINE);
  const start = all.findIndex((line) => line === `## ${SECTIONS[10]}`);
  const end = all.findIndex((line, index) => index > start && line.startsWith("## "));
  let at = end - 1;
  while (at > start && !all[at]!.startsWith("|")) at -= 1;
  return [...all.slice(0, at + 1), row, ...all.slice(at + 1)].join(NEWLINE);
}

// ── [B24-A1 check, 2026-10-06] later workflow insertions: A1's checks resolve by content or carry A1's lines through recorded rows ──

const DFM = "artifacts/ai-control-plane-b23/dfm-quote-flow.md";
const PGLITE = "b23-b-exchange-ledger-pglite.test.ts";
/** B23's prose citation of its PGlite entry in dfm-quote-flow.md (B23-B; moved by A1, page section 9) */
const PROSE = /(an explicit database-delivery entry \(`\.github\/workflows\/deterministic-manufacturing\.yml:)(\d+)`/;
const lineCount = (workflow: readonly string[]): number => workflow.length - (workflow[workflow.length - 1] === "" ? 1 : 0);

/** Each top-level job's lines in a workflow text, 1-based: from the blank and comment lines just above its header to the line before
 *  the next job's. */
function jobRegions(workflow: readonly string[]): Map<string, { start: number; end: number }> {
  const jobsAt = workflow.indexOf("jobs:");
  const headers = workflow.map((line, index) => (index > jobsAt && /^ {2}[a-z][a-z0-9-]*:$/.test(line) ? index : -1)).filter((index) => index >= 0);
  const starts = headers.map((header, index) => {
    let start = header;
    const floor = index === 0 ? jobsAt : headers[index - 1]!;
    while (start - 1 > floor && /^(?:\s*| {2}#.*)$/.test(workflow[start - 1]!)) start -= 1;
    return start;
  });
  return new Map(headers.map((header, index) => [workflow[header]!.trim().slice(0, -1), { start: starts[index]! + 1, end: index + 1 < headers.length ? starts[index + 1]! : lineCount(workflow) }]));
}

/** A1's filter line, by its content (case 12): once, in prompt-to-gerber, after B23's filter in the same vitest list; no explicit
 *  b24-a1- entry. No line number: its line is C35's, carried by case 14. */
function admissionProblems(all: readonly string[]): string[] {
  const problems: string[] = [];
  const holding = (path: string): number[] => all.flatMap((line, index) => (line === `          ${path}` ? [index] : []));
  const [b23, a1] = [holding("app/lib/manufacturing-providers/__tests__"), holding("app/lib/qualification/__tests__")];
  if (b23.length !== 1 || a1.length !== 1 || all.filter((line) => line.trim() === "app/lib/qualification/__tests__").length !== 1) return [`B23's filter ${b23.length} times, A1's ${a1.length} times: once each`];
  const job = jobRegions(all).get("prompt-to-gerber");
  if (!job || a1[0]! + 1 < job.start || a1[0]! + 1 > job.end) problems.push("A1's filter is not in prompt-to-gerber");
  if (!(a1[0]! > b23[0]!) || all.slice(b23[0], a1[0]).some((line) => !/^ {10}\S+$/.test(line))) problems.push("A1's filter does not follow B23's in the same vitest list");
  if (all.some((line) => /b24-a1-/.test(line))) problems.push("an explicit b24-a1- entry");
  return problems;
}

/** Section 14's citations of the workflow (C35, C47): A1's lines, carried through the insertion rows like section 10's (case 14). */
function sectionFourteenWorkflowProblems(page: string, workflow: readonly string[]): string[] {
  const problems: string[] = [];
  const { rows } = insertionTable(page);
  for (const row of section(page, SECTIONS[14]).matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| `(.+)` \|$/gm)) {
    if (row[2] !== WORKFLOW) continue;
    const today = carry(Number(row[3]), rows);
    if (!(workflow[today - 1] ?? "").includes(row[4]!.replaceAll("\\|", "|"))) problems.push(`${row[1]}: the anchor is not on :${today}`);
  }
  return problems;
}

/** B23's prose citation of its PGlite entry (case 17), by its content: it names the line the entry stands on in this tree, and its
 *  line carries a dated note from A1 and from every task whose recorded insertion rows moved the entry. */
function proseCitationProblems(dfm: string, workflow: readonly string[], page: string): string[] {
  const holding = dfm.split(NEWLINE).filter((line) => PROSE.test(line));
  if (holding.length !== 1 || [...dfm.matchAll(new RegExp(PROSE.source, "g"))].length !== 1) return ["the prose citation is not there exactly once"];
  const line = holding[0]!;
  const cited = Number(PROSE.exec(line)![2]);
  const entries = workflow.flatMap((text, index) => (text.includes(PGLITE) ? [index + 1] : []));
  const problems: string[] = [];
  if (entries.length !== 1) problems.push(`the PGlite entry is in the workflow ${entries.length} times`);
  else if (cited !== entries[0]) problems.push(`the prose citation cites :${cited}; the PGlite entry is on :${entries[0]}`);
  const movers = ["B24-A1"];
  let at = A1_PGLITE_LINE;
  for (const row of insertionTable(page).rows) {
    if (at < row.first) continue;
    at += row.count;
    if (!movers.includes(row.task)) movers.push(row.task);
  }
  for (const task of movers) if (!new RegExp(`\\[${task}(?: [a-z]+)?, \\d{4}-\\d{2}-\\d{2}\\]`).test(line)) problems.push(`no dated ${task} note on the prose citation's line`);
  return problems;
}

/** The workflow edits the later B24 tasks plan, in launch order, as their task files state them (page section 13, For the lead): one
 *  step per contiguous group of lines, top to bottom within a task; the lines are stand-ins. */
type PlannedInsertion = { task: string; job: string; after: (workflow: readonly string[]) => number; lines: readonly string[] };
const SIM_DATE = "2026-10-07";
const lastDatabaseEntry = (workflow: readonly string[]): number => workflow.reduce((last, line, index) => (line.includes("/database/__tests__/") ? index : last), -1);
const beforeLineHolding = (text: string) => (workflow: readonly string[]): number => workflow.findIndex((line) => line.includes(text)) - 1;
const stepsLineOf = (job: string) => (workflow: readonly string[]): number => workflow.indexOf("    steps:", workflow.indexOf(`  ${job}:`));
const lastLineOf = (job: string) => (workflow: readonly string[]): number => jobRegions(workflow).get(job)!.end - 1;
const pgliteEntry = (task: string): string => `          app/lib/qualification/database/__tests__/${task.toLowerCase()}-simulated-pglite.test.ts`;
const PLANNED: readonly PlannedInsertion[] = [
  { task: "B24-A2", job: "production-smoke", after: beforeLineHolding("echo \"every probe answered as pinned\""), lines: ["          grep -qi '^x-content-type-options: nosniff' ai-runtime.headers", "          if grep -qi '^x-powered-by:' ai-runtime.headers; then exit 1; fi"] },
  { task: "B24-A2", job: "secret-scan", after: (workflow) => lineCount(workflow) - 1, lines: ["", "  secret-scan:", "    runs-on: ubuntu-latest", "    steps:", "      - uses: actions/checkout@v4", "      - run: pnpm exec tsx scripts/scan-secrets.ts"] },
  { task: "B24-A4", job: "database-delivery", after: lastDatabaseEntry, lines: ["one", "two", "three", "four"].map((name) => pgliteEntry(`B24-A4-${name}`)) },
  { task: "B24-B2", job: "prompt-to-gerber", after: beforeLineHolding("--outputFile=vitest-deterministic-manufacturing.xml"), lines: Array.from({ length: 36 }, (_, index) => `          app/lib/simulated/__tests__/b24-b2-admitted-${index + 1}.test.ts`) },
  { task: "B24-B3", job: "prompt-to-gerber", after: beforeLineHolding("--outputFile=vitest-deterministic-manufacturing.xml"), lines: ["          app/lib/simulated/__tests__/worker-integration.test.ts"] },
  { task: "B24-C1", job: "database-delivery", after: lastDatabaseEntry, lines: [pgliteEntry("B24-C1")] },
  { task: "B24-C2", job: "database-delivery", after: lastDatabaseEntry, lines: [pgliteEntry("B24-C2")] },
  { task: "B24-C3", job: "database-delivery", after: lastDatabaseEntry, lines: [pgliteEntry("B24-C3")] },
  { task: "B24-D1", job: "prompt-to-gerber", after: stepsLineOf("prompt-to-gerber"), lines: ["      - run: echo \"SIRKIT_JOB_STARTED_AT=$(date +%s)\" >> \"$GITHUB_ENV\" # [B24-D1] OD-30: prompt-to-gerber's start"] },
  { task: "B24-D1", job: "prompt-to-gerber", after: lastLineOf("prompt-to-gerber"), lines: ["      - if: always() # [B24-D1] OD-30: prompt-to-gerber's headroom", "        run: pnpm exec tsx scripts/ci-job-headroom.ts .github/workflows/deterministic-manufacturing.yml prompt-to-gerber"] },
  { task: "B24-D1", job: "page-browser-e2e", after: stepsLineOf("page-browser-e2e"), lines: ["      - run: echo \"SIRKIT_JOB_STARTED_AT=$(date +%s)\" >> \"$GITHUB_ENV\" # [B24-D1] OD-30: page-browser-e2e's start"] },
  { task: "B24-D1", job: "page-browser-e2e", after: lastLineOf("page-browser-e2e"), lines: ["      - if: always() # [B24-D1] OD-30: page-browser-e2e's headroom", "        run: pnpm exec tsx scripts/ci-job-headroom.ts .github/workflows/deterministic-manufacturing.yml page-browser-e2e"] },
  { task: "B24-D2", job: "database-delivery", after: lastDatabaseEntry, lines: [pgliteEntry("B24-D2")] },
];
const insertionRow = (task: string, job: string, first: number, count: number): string => `| [${task}, ${SIM_DATE}] | ${job} | \`:${first}\` | ${count} |`;
/** The tree and the pages as the planned tasks leave them when each follows the handover (page section 13): its rows appended to the
 *  insertion table, no number of this page moved, and B23's prose citation moved in place with the task's own dated note
 *  ("unmoved": as task-D1.md:553-554 says, it stays; "unnoted": moved without the note). */
function simulate(steps: readonly PlannedInsertion[], prose: "moved" | "unmoved" | "unnoted" = "moved"): { workflow: string[]; page: string; dfm: string; lineOf: (a1Line: number) => number } {
  let workflow = [...lines(WORKFLOW)];
  let origin = workflow.map((_, index) => index + 1); // each line's number at A1's tree; 0 for an inserted line
  let page = read(PAGE);
  let dfm = read(DFM);
  for (const step of steps) {
    const before = workflow.findIndex((line) => line.includes(PGLITE));
    const at = step.after(workflow);
    if (at < 0) throw new Error(`${step.task}: no insertion point`);
    workflow = [...workflow.slice(0, at + 1), ...step.lines, ...workflow.slice(at + 1)];
    origin = [...origin.slice(0, at + 1), ...step.lines.map(() => 0), ...origin.slice(at + 1)];
    page = withInsertionRow(page, insertionRow(step.task, step.job, at + 2, step.lines.length));
    const after = workflow.findIndex((line) => line.includes(PGLITE));
    if (after !== before && prose !== "unmoved") {
      dfm = dfm.replace(PROSE, (_, head: string, old: string) => `${head}${after + 1}\`${prose === "moved" ? `; [${step.task}, ${SIM_DATE}] was \`:${old}\`` : ""}`);
    }
  }
  const final = origin;
  return { workflow, page, dfm, lineOf: (a1Line) => final.indexOf(a1Line) + 1 };
}
const insertionRowsOf = (page: string): string[] => section(page, SECTIONS[10]).split(NEWLINE).filter((line) => line.startsWith("| [B24-"));

describe("[B24-A1] the page environments-and-deployment.md", () => {
  it("13. the page states what is proven offline and by which suite, what is BLOCKED under LB-13, the hosting platform UNKNOWN (OD-190), LB-10 still blocked, the INFERRED proxy pass-through, the build history and the durations; its sections are in order and every suite row carries its real it( count", () => {
    const page = read(PAGE);
    expect(page.startsWith("# B24-A1 - ")).toBe(true);
    const positions = SECTIONS.map((title) => page.indexOf(`${NEWLINE}## ${title}${NEWLINE}`));
    expect(positions.every((position) => position > 0), JSON.stringify(positions)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    for (const label of ["CONFIRMED", "INFERRED", "RECORDED", "UNKNOWN", "BLOCKED-LIVE-QUALIFICATION", "PROPOSED"]) expect(page, label).toContain(`**${label}**`);
    for (const fact of ["LB-13", "OD-190", "OD-198", "OD-199", "OD-200", "OD-222", "LB-10", "`proxy.ts`", "`updateSession`", "engine-worker.mjs", "B16.1B", "stage 05", "168 = 165 canonical + 3 factories + 0 raw", "47 / 36 / 9 / 27", "107"]) expect(page, fact).toContain(fact);
    expect(section(page, SECTIONS[7])).toMatch(/hosting platform[^\n]*\*\*UNKNOWN\*\*/i);
    expect(section(page, SECTIONS[7])).toMatch(/LB-10[^\n]*still blocked/i);
    expect(section(page, SECTIONS[6])).toMatch(/\*\*INFERRED\*\*[^\n]*`updateSession`/);
    for (const suite of ["b24-a1-environment-profile", "b24-a1-configuration", "b24-a1-flags", "b24-a1-readiness"]) expect(section(page, SECTIONS[11]), suite).toContain(suite);
    const rows = [...page.matchAll(/^\| `(app\/[^`]+\.test\.tsx?)` \| (\d+) \|/gm)];
    expect(rows.map((row) => row[1])).toEqual(expect.arrayContaining(["environment-profile", "configuration", "flags", "readiness"].map((name) => `app/lib/qualification/__tests__/b24-a1-${name}.test.ts`)));
    for (const row of rows) expect((read(row[1]!).match(/^\s*it\(/gm) ?? []).length, `${row[1]} it( blocks`).toBe(Number(row[2]));
  });

  it("14. the workflow table is the tree's: every old -> new row moved exactly +1 past A1's filter line and its anchor is on the new line ([B24-A1 review] regressions-2: carried through the later insertions section 10 records); every discovery line the page cites holds its anchor at 8664964's numbering; every citation of section 14 is on the line it names", () => {
    const page = read(PAGE);
    expect(shiftTableProblems(page, lines(WORKFLOW))).toEqual([]);
    const discovery = discoveryAtBase();
    const cited = [...page.matchAll(/^\| (D\d+) \| `discovery\.md:(\d+)` \| `([^`]+)` \|/gm)];
    expect(cited.length).toBeGreaterThanOrEqual(6);
    for (const row of cited) expect(discovery[Number(row[2]) - 1] ?? "", `${row[1]} discovery.md:${row[2]}`).toContain(row[3]!);
    const citations = [...section(page, SECTIONS[14]).matchAll(/^\| (C\d+) \| `([^`]+)` \| (\d+) \| `(.+)` \|$/gm)];
    expect(citations.length).toBeGreaterThanOrEqual(25);
    expect(citations.map((row) => row[1])).toEqual(citations.map((_, index) => `C${index + 1}`));
    const stale = citations.filter((row) => row[2] !== WORKFLOW && !(lines(row[2]!)[Number(row[3]) - 1] ?? "").includes(row[4]!.replaceAll("\\|", "|"))).map((row) => `${row[1]} ${row[2]}:${row[3]}`);
    expect(stale).toEqual([]);
    expect(citations.filter((row) => row[2] === WORKFLOW).map((row) => row[1])).toEqual(["C35", "C47"]);
    expect(sectionFourteenWorkflowProblems(page, lines(WORKFLOW))).toEqual([]);
  });

  it("15. the For the lead section holds every reserved text in full: the closure clauses, the OD headings (OD-190, OD-198, OD-199, OD-200, OD-222, OD-217 in part, and A1's own next free number), LB-13 in both registers, the README row, the ledger paragraph and the section-10 amendment", () => {
    const lead = section(read(PAGE), SECTIONS[13]);
    expect(lead.length).toBeGreaterThan(6_000);
    for (const defect of ["D24-1", "D24-9", "D24-10", "D24-11"]) expect(lead).toMatch(new RegExp(`^- \\[B24-A1, 2026-10-06\\] ${defect}: `, "m"));
    for (const od of ["OD-190", "OD-198", "OD-199", "OD-200", "OD-222", "OD-217"]) expect(lead).toMatch(new RegExp(`^### ${od} `, "m"));
    expect(lead).toMatch(/^### OD-223 (?:—|-) B24-A1/m);
    expect(lead).toContain("| LB-13 |");
    expect(lead).toContain(": BLOCKED-LIVE-QUALIFICATION (LB-13)");
    for (const heading of ["The README row", "The ledger paragraph", "Section 10 amendment", "The B16.1B recipe notes", "The workflow shift for the later increments", "The local production-mode run"]) expect(lead, heading).toContain(heading);
  });

  it("16. [B24-A1 review] regressions-2, [B24-A1 check, 2026-10-06]: the workflow edits every later inserting task plans (A2, A4, B2, B3, C1, C2, C3, D1, D2: 59 lines in 13 groups) keep cases 11, 12 and 14 green when each task only appends its rows to section 10's insertion table - no number of this page moved, no A1 test logic edited; the designed failures still bite: an insertion left unrecorded, the old -> new table's new column (or both columns) moved in place, an earlier row edited, a wrong count, a wrong job, a row in the old form, a section-14 number moved as well as recorded", () => {
    const planned = simulate(PLANNED);
    expect(lineCount(planned.workflow) - lineCount(lines(WORKFLOW))).toBe(59);
    expect(insertionRowsOf(planned.page)).toHaveLength(13);
    expect(jobOrderProblems(planned.workflow)).toEqual([]); // A2's appended job (task-A2.md:340) follows production-smoke
    expect(shiftTableProblems(planned.page, planned.workflow)).toEqual([]);
    expect(sectionFourteenWorkflowProblems(planned.page, planned.workflow)).toEqual([]);
    expect(admissionProblems(planned.workflow)).toEqual([]);
    expect(planned.workflow.join(NEWLINE), "[B24-A1 lead, 2026-10-06] A2's scan step names scripts/scan-secrets.ts, which is no secrets. expression").not.toMatch(SECRETS_REFERENCE);
    expect("      - run: echo ${{ secrets.PROVIDER_TOKEN }}", "a secrets. expression is still refused").toMatch(SECRETS_REFERENCE);
    // the designed failures
    const rows = insertionRowsOf(planned.page);
    const replaceRow = (row: string, by: string): string => planned.page.replace(`${row}${NEWLINE}`, by === "" ? "" : `${by}${NEWLINE}`);
    const c1 = rows.find((row) => row.startsWith("| [B24-C1, "))!;
    const [first, count] = [Number(/`:(\d+)`/.exec(c1)![1]), Number(/\| (\d+) \|$/.exec(c1)![1])];
    expect(shiftTableProblems(replaceRow(rows[1]!, ""), planned.workflow).join(" "), "A2's appended job unrecorded").toMatch(/53 recorded/);
    expect(shiftTableProblems(replaceRow(c1, ""), planned.workflow), "C1's line unrecorded").not.toEqual([]);
    expect(shiftTableProblems(replaceRow(c1, c1.replace(`\`:${first}\``, `\`:${first + 3}\``)), planned.workflow), "C1's row moved in place by D1's three lines above it").not.toEqual([]);
    expect(shiftTableProblems(replaceRow(c1, c1.replace(/\| \d+ \|$/, `| ${count + 1} |`)), planned.workflow), "a wrong count").not.toEqual([]);
    expect(shiftTableProblems(replaceRow(c1, c1.replace("| database-delivery |", "| prompt-to-gerber |")), planned.workflow).join(" "), "a wrong job").toMatch(/not in prompt-to-gerber/);
    expect(shiftTableProblems(withInsertionRow(planned.page, "| `:300` | 1 | [B24-C9, 2026-10-07] the review round's form |"), planned.workflow).join(" "), "the old form").toMatch(/malformed insertion row/);
    // a task that followed its own text instead: every number of this page moved in place, no row appended
    const unrecorded = rows.reduce((page, row) => page.replace(`${row}${NEWLINE}`, ""), planned.page);
    const cell = (start: number, end: number | undefined): string => `\`:${start}${end === undefined ? "" : `-${end}`}\``;
    const moveColumns = (page: string, both: boolean): string => page.replace(/^\| `:(\d+)(?:-(\d+))?` \| `:(\d+)(?:-(\d+))?` \|/gm, (_, oldStart: string, oldEnd: string | undefined, newStart: string, newEnd: string | undefined) => {
      const [start, end] = [planned.lineOf(Number(newStart)), newEnd === undefined ? undefined : planned.lineOf(Number(newEnd))];
      const old = both ? cell(start - 1, end === undefined ? undefined : end - 1) : cell(Number(oldStart), oldEnd === undefined ? undefined : Number(oldEnd));
      return `| ${old} | ${cell(start, end)} |`;
    });
    expect(moveColumns(unrecorded, false)).not.toBe(unrecorded);
    expect(shiftTableProblems(moveColumns(unrecorded, false), planned.workflow).join(" "), "the new column moved in place").toMatch(/the new start is not A1's shift/);
    expect(shiftTableProblems(moveColumns(unrecorded, true), planned.workflow).join(" "), "both columns moved in place").toMatch(/the old column is not A1's frozen table/);
    const c35 = /^\| C35 \| `[^`]+` \| (\d+) \|/m.exec(planned.page)!;
    const doubled = planned.page.replace(c35[0], c35[0].replace(`| ${c35[1]} |`, `| ${planned.lineOf(Number(c35[1]))} |`));
    expect(sectionFourteenWorkflowProblems(doubled, planned.workflow), "C35 moved in place as well as recorded").not.toEqual([]);
  });

  it("17. [B24-A1 review] regressions-3: every earlier page's citation of a workflow line A1's filter line moved stands on its line with a dated A1 note - B23's dfm-quote-flow.md prose citation of the PGlite entry and its C64, B21's C49, C93 and C94 - and section 10 names each citer; [B24-A1 check, 2026-10-06] the prose citation is resolved by its content at HEAD (the line holding the PGlite entry), and its line carries a dated note from A1 and from every task whose recorded insertion rows moved the entry - no fixed line number or note text", () => {
    const dfm = read(DFM);
    expect(proseCitationProblems(dfm, lines(WORKFLOW), read(PAGE))).toEqual([]);
    // [B24-A1 check, 2026-10-06] a later task that inserts lines above the PGlite entry moves the citation in place with its own dated
    // note and appends its rows - nothing else; one that leaves it unmoved (task-D1.md:553-554), or moves it without a note, fails
    const planned = simulate(PLANNED);
    expect(planned.dfm).not.toBe(dfm);
    expect(proseCitationProblems(planned.dfm, planned.workflow, planned.page)).toEqual([]);
    const unmoved = simulate(PLANNED, "unmoved");
    expect(proseCitationProblems(unmoved.dfm, unmoved.workflow, unmoved.page).join(" "), "unmoved").toMatch(/cites :302/);
    const unnoted = simulate(PLANNED, "unnoted");
    const missing = proseCitationProblems(unnoted.dfm, unnoted.workflow, unnoted.page).join(" ");
    for (const task of ["B24-B2", "B24-B3", "B24-D1"]) expect(missing, task).toContain(`no dated ${task} note`);
    for (const task of ["B24-A1", "B24-A2", "B24-A4", "B24-C1", "B24-D2"]) expect(missing, task).not.toContain(`no dated ${task} note`);
    expect(proseCitationProblems(dfm.replace("; [B24-A1, 2026-10-06] was `:301` before B24-A1's filter line after `:227`", ""), lines(WORKFLOW), read(PAGE)).join(" "), "A1's note stripped").toContain("no dated B24-A1 note");
    expect(dfm).toMatch(/\[B24-A1, 2026-10-06\] C64 re-pinned `:301` -> `:302`/);
    const matrix = read("artifacts/ai-control-plane-b21/evaluation-matrix.md").split(NEWLINE);
    for (const id of ["C49", "C93", "C94"]) expect(matrix.find((line) => line.startsWith(`| ${id} |`)), id).toMatch(/\[B24-A1, 2026-10-06\] re-pinned \+1/);
    const ten = section(read(PAGE), SECTIONS[10]);
    expect(ten).toMatch(/^\| `:301` \| `:302` \| [^\n]*B23 C64[^\n]*`dfm-quote-flow\.md:269`/m);
    for (const [row, citer] of [[":333", "B21 C49"], [":336", "B21 C93"], [":345", "B21 C94"]] as const) expect(ten, citer).toMatch(new RegExp(`^\\| \`${row}\` \\| [^\\n]*${citer}`, "m"));
  });

  it("18. [B24-A1 review] coverage-1: the production-smoke job has not run - every statement of the page that names it, the records for the lead included (the D24-1 clause, OD-190, the LB-13 row, the README row, the ledger, the section-10 amendment), says PROPOSED; the four records also say until when", () => {
    const page = read(PAGE);
    const units: string[] = [];
    for (const title of SECTIONS.filter((_, index) => index !== 10 && index !== 14)) {
      for (const line of section(page, title).split(NEWLINE)) {
        const continues = /^ {2}(?! *- )\S/.test(line) && units.length > 0;
        if (continues) units[units.length - 1] += ` ${line.trim()}`;
        else if (line.trim() !== "") units.push(line);
      }
    }
    const naming = units.filter((unit) => unit.includes("production-smoke"));
    expect(naming.length).toBeGreaterThanOrEqual(8);
    for (const unit of naming) expect(unit, unit.slice(0, 160)).toContain("PROPOSED");
    const lead = section(page, SECTIONS[13]).split(NEWLINE);
    const after = (heading: string, prefix: string): string => lead.slice(lead.findIndex((line) => line.startsWith(heading))).find((line) => line.startsWith(prefix)) ?? "";
    const records = {
      "D24-1": lead.find((line) => line.startsWith("- [B24-A1, 2026-10-06] D24-1: ")) ?? "",
      "OD-190": after("### OD-190 ", "- **Default applied"),
      "LB-13": lead.find((line) => line.startsWith("| LB-13 |")) ?? "",
      README: lead.find((line) => line.startsWith("| B24-A1 environment profile")) ?? "",
    };
    for (const [name, record] of Object.entries(records)) {
      expect(record, name).toContain("PROPOSED");
      expect(record, name).toContain("local production-mode run");
      expect(record, name).toContain("first CI run");
    }
    expect(records["D24-1"]).not.toMatch(/D24-1: offline closed by B24-A1 -/);
  });

  it("19. [B24-A1 review] coverage-2: the section-10 amendment lists the pins the plan did not name - the census lines, the action-record pin with C52, the eight CSVs, the four production fixtures, C20 with provider-policy :168, the B16.1B notes, the action record's place, C49, C93, C94, C64 and the dfm-quote-flow prose citation, and case 8 - and not C77 or C15, which the discovery names (OD-222 and 9.4)", () => {
    const lead = section(read(PAGE), SECTIONS[13]).split(NEWLINE);
    const amendment = lead.find((line) => line.startsWith("- [B24-A1, 2026-10-06] B24-A1 landed")) ?? "";
    const unplanned = amendment.slice(Math.max(0, amendment.indexOf("Pins the plan did not name")));
    expect(unplanned.startsWith("Pins the plan did not name")).toBe(true);
    for (const pin of [
      "b16-1c-invariant-tripwires.test.ts", "b16-1b-auth-composition.test.ts", "b22-a2-process-census.test.ts", "b23-a-no-order-structural.test.ts", "b23-a-route-vocabulary.test.ts", "b23-b-exchange-route.test.ts",
      "b23-a-tier3-vocabulary.test.ts:272", "C52",
      "api-route-coverage.csv", "ui-command-toolability-matrix.csv", "auth-route-coverage.csv", "exact-route-authorization-policy.csv", "route-data-and-resource-classification.csv", "method-authorization-matrix.csv", "request-body-boundary-matrix.csv", "route-wrapper-matrix.csv",
      "b16-1b-auth-composition.test.ts:29", "b16-1b-real-sdk-identity.test.ts:29", "b16-1b-session-liveness.test.ts:42", "b16-0-2-csrf-exact-origin.test.ts:19-23",
      "C20", "b21-e1-provider-policy.test.ts:168", "live-auth-qualification-matrix.md:64", "b16-1b-live-qualification.test.ts:12",
      "action-registry.ts:186", "C49", "C93", "C94", "C64", "dfm-quote-flow.md:269", "b23-a-provider-admission", "case 8",
    ]) expect(unplanned, pin).toContain(pin);
    const discovery = discoveryAtBase().join(NEWLINE);
    for (const named of ["C77", "C15"]) {
      expect(discovery, named).toMatch(new RegExp(`\\b${named}\\b`));
      expect(unplanned, named).not.toMatch(new RegExp(`\\b${named}\\b`));
    }
    for (const unnamed of ["C20", "C49", "C52", "C64", "C93", "C94"]) expect(discovery, unnamed).not.toMatch(new RegExp(`\\b${unnamed}\\b`));
  });

  it("20. [B24-A1 check, 2026-10-06] the insertion-table protocol is handed to every B24 task that inserts workflow lines - A2, A4, B2, B3, C1, C2, C3, D1 and D2 by their task files - in section 10 and in For the lead, by one paste paragraph holding its rules (append a row; never edit an earlier row or move a number of this page; re-derive the other citations by anchor; never edit A1's test logic) and one placement line per task file; the tasks that add none are named; the review round's note for A2, C1 and C2 alone is gone", () => {
    const page = read(PAGE);
    const ten = section(page, SECTIONS[10]);
    const lead = section(page, SECTIONS[13]);
    expect(ten).toContain("A2, A4, B2, B3, C1, C2, C3, D1 and D2");
    expect(ten).toContain("A3, B1, D3, E and F add none");
    expect(ten).not.toMatch(/B24-B3, C1\s+and C2 plan to/);
    expect(ten).toContain("| task | job | first line | count |");
    const paste = lead.split(NEWLINE).filter((line) => line.startsWith("> [B24-A1 handover, 2026-10-06] "));
    expect(paste).toHaveLength(1);
    for (const rule of ["append one row", "| [B24-<id>, <date>] | <job> | `:<first>` | <count> |", "Never edit an earlier row", "sections 10 and 14", "Re-derive by anchor", "`b24-a1-environment-profile` 17", "Never edit the test logic", "STOP"]) expect(paste[0], rule).toContain(rule);
    for (const id of ["A2", "A4", "B2", "B3", "C1", "C2", "C3", "D1", "D2"]) expect(lead, id).toMatch(new RegExp(`^- \`task-${id}\\.md\`, after \`:\\d+\`: `, "m"));
    for (const id of ["A3", "B1", "D3", "E", "F"]) expect(lead, id).toMatch(new RegExp(`\`task-${id}\\.md:\\d+`));
    expect(lead).not.toContain("what A2, C1 and C2 must do");
  });
});

// [B24-A1 lead, 2026-10-06] the "no secrets. reference" guard of case 11 (the check round's new issue): a GitHub `${{ ... secrets. ... }}`
// expression, never a file name - the old /\bsecrets\./ also matched B24-A2's planned `scripts/scan-secrets.ts` step (case 16, red first)
const SECRETS_REFERENCE = /\$\{\{[^}]*\bsecrets\./;
