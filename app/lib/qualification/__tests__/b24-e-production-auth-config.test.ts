/**
 * [B24-E] The production-auth browser harness, offline (D24-34 offline; OD-191; runbook B24-E item 2, `:1116`).
 *
 * `app/lib/deployment/production-auth-target.ts` answers which isolated Supabase project the production-auth Playwright config may run
 * against - `not_requested`, `refused` (closed codes plus variable NAMES) or `ready` - over a staging list that is EMPTY (OD-6, OD-191),
 * and builds that config as plain data. `playwright.production-auth.config.ts` throws `PRODUCTION_AUTH_NOT_EXERCISED` unless the answer
 * is `ready`; `e2e-production-auth/production-auth.spec.ts` is the browser journey (sign-in, cookie flags, liveness, revocation,
 * sign-out) that only an owner-resourced run executes: BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13).
 *
 *  1. every refusal code, by names only: planted secret-shaped values (assembled at run time) appear in no answer and no message;
 *  2. the counterexample: the committed list is empty, so with every input set the answer is refused `target_not_listed`;
 *  3. ready with an injected fixture target (the pooler and the direct database URL both name its ref; the key selected as mode.ts
 *     selects it; the selector rule is the trusted context's);
 *  4. the config, imported with `@playwright/test` stubbed (as b21-f-page does): it throws without the flag and with the committed list;
 *     with a fixture list injected it IS the builder's shape - every bullet of the task, the list-only reporter, the three Supabase
 *     names; and it is the one config that runs production auth (red on 6e4e1bb: every config is local_dev or extends it);
 *  5. the spec sits outside `./e2e` and `./e2e-orchestration`: no CI step (found by its command) selects it, and no workflow names the
 *     config or the spec's folder;
 *  6. the spec reads credentials only by name and logs nothing (AST), and test 1 clears both sign-in fields in a `finally` before its
 *     first assertion (a failure's error-context.md holds an ARIA snapshot that carries every textbox's value, the password's too);
 *  7. the resolver and the spec are in no route's runtime import closure (importClosure's edges), and only the config and the spec
 *     import the resolver;
 *  8. the spec's sign-in form steps (`e2e-production-auth/sign-in-form.ts`) on a recording page.
 * [B24-E review, 2026-10-10] correctness-1, security-1: a test that timed out left its `finally` pending while Playwright wrote the
 * failure's page snapshot, and `fill` titles its step and logs its call with the typed value. Now each credential goes in as the
 * argument of one bounded page evaluation (case 8), every form step is bounded and their worst case ends 20 s inside the test timeout
 * (8), the config bounds every action and navigation and turns the failure page snapshot off (4), and no harness call types a value
 * (6). correctness-4: case 1 breaks each URL and list rule of the resolver alone. security-3: a database URL with a second "@" is
 * refused (1). security-4: the server listens on 127.0.0.1 only, and no client-chosen header keys its windows (4).
 *
 * Failing first on 6e4e1bb: the module is absent, so the suite does not load (qualification-matrix.md part 1, the test-first record).
 * Files are read as text; nothing is written to disk, no server or browser is started and nothing is contacted.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAuthRuntime } from "@/app/lib/auth/mode";
import { listRouteFiles } from "@/app/lib/auth/route-tree";
import { ID_PATTERN } from "@/app/lib/auth/trusted-request-context";
import { ENVIRONMENT_NAMES } from "@/app/lib/deployment/environment-names";
import { FLAG_INVENTORY } from "@/app/lib/deployment/flag-inventory";
import {
  PRODUCTION_AUTH_COMMAND,
  PRODUCTION_AUTH_INPUT_NAMES,
  PRODUCTION_AUTH_ORIGIN,
  PRODUCTION_AUTH_OUTPUT_DIR,
  PRODUCTION_AUTH_PORT,
  PRODUCTION_AUTH_REFUSAL_CODES,
  PRODUCTION_AUTH_RUNNER_ENV,
  PRODUCTION_AUTH_SELECTOR_ID,
  PRODUCTION_AUTH_STAGING_TARGETS,
  PRODUCTION_AUTH_TEST_DIR,
  productionAuthNotExercised,
  productionAuthPlaywrightConfig,
  resolveProductionAuthTarget,
  type ProductionAuthStagingTarget,
  type ProductionAuthTargetAnswer,
} from "@/app/lib/deployment/production-auth-target";
import { fileOf, importClosure } from "@/app/lib/mcp/server/__tests__/_import-closure";
import { collectProductionFiles, moduleReferences, resolveSpecifier, type FileMap } from "@/app/lib/project/__tests__/_import-gate-helpers";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const MODULE = "app/lib/deployment/production-auth-target.ts";
const CONFIG = "playwright.production-auth.config.ts";
const SPEC = "e2e-production-auth/production-auth.spec.ts";
const FORM = "e2e-production-auth/sign-in-form.ts"; // [B24-E review, 2026-10-10] the spec's bounded sign-in form steps (case 8)
const FORM_MODULE = "@/e2e-production-auth/sign-in-form";
const CONFIG_MODULE = "../../../../playwright.production-auth.config";
const TARGET_MODULE = "@/app/lib/deployment/production-auth-target";
type Env = Record<string, string | undefined>;
const N = PRODUCTION_AUTH_INPUT_NAMES;

// ── fixtures, every secret-shaped one assembled at run time (the staged-content scan and A2's CI scan stay clean) ────────────────

const REF = ["abcd", "efgh", "ijkl", "mnop", "qrst"].join("");
const OTHER_REF = ["zyxw", "vuts", "rqpo", "nmlk", "jihg"].join("");
const TARGET: ProductionAuthStagingTarget = { projectRef: REF, label: "b24e-fixture" };
const MARKER = ["sirkit", "auth", "qualification", "b24e", "fixture"].join("-");
const SUPABASE_URL = ["https", "://", REF, ".supabase.co"].join("");
const PUBLISHABLE = ["sb", "publishable", "b24e", "fixture", "key", "0000"].join("_");
const ANON = ["b24e", "anon", "fixture", "key"].join("-");
const EMAIL = ["b24e-fixture", "example.invalid"].join("@");
const PASSWORD = ["b24e", "fixture", "pass", "word", "q9"].join("-");
const DB_SECRET = ["b24e", "fixture", "db", "secret"].join("-");
const POOLER_URL = ["postgres", "://", "postgres.", REF, ":", DB_SECRET, "@", "aws-0-eu-west-1.pooler.supabase.com", ":6543/postgres"].join("");
const DIRECT_URL = ["postgresql", "://", "postgres", ":", DB_SECRET, "@", "db.", REF, ".supabase.co", ":5432/postgres"].join("");
const SECRET_KEY = ["sb", "secret", "b24e", "fixture", "planted", "value", "0000"].join("_");
const base64Url = (text: string): string => btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const SERVICE_ROLE_JWT = [base64Url(JSON.stringify({ alg: "HS256", typ: "JWT" })), base64Url(JSON.stringify({ role: ["service", "role"].join("_"), ref: REF })), "b24e-fixture-signature"].join(".");
const PLANTED = [REF, MARKER, SUPABASE_URL, PUBLISHABLE, ANON, EMAIL, PASSWORD, DB_SECRET, POOLER_URL, DIRECT_URL, SECRET_KEY, SERVICE_ROLE_JWT];

/** Every input set, aimed at the fixture target. */
const FULL: Env = {
  [N.flag]: "1",
  [N.marker]: MARKER,
  [N.supabaseUrl]: SUPABASE_URL,
  [N.publishableKey]: PUBLISHABLE,
  [N.anonKey]: undefined,
  [N.email]: EMAIL,
  [N.password]: PASSWORD,
  [N.projectId]: "b24e-fixture-project",
  [N.tenantId]: undefined,
  [N.databaseUrl]: POOLER_URL,
  [N.baseUrl]: undefined,
};
const ALL_NAMES = Object.values(N);
const withEnv = (overrides: Env): Env => ({ ...FULL, ...overrides });
const noValue = (text: string): string[] => PLANTED.filter((value) => text.includes(value));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@playwright/test");
  vi.doUnmock(TARGET_MODULE);
  vi.resetModules();
});

/** The config as Playwright would load it, under `env`, with `@playwright/test` stubbed and, when given, the staging list replaced. */
async function loadConfig(env: Env, targets?: readonly ProductionAuthStagingTarget[]): Promise<{ readonly config?: unknown; readonly error?: string }> {
  vi.resetModules();
  for (const name of ALL_NAMES) vi.stubEnv(name, env[name]);
  vi.stubEnv("PLAYWRIGHT_NO_COPY_PROMPT", undefined); // [B24-E review, 2026-10-10] a ready config sets it; restored after each case
  vi.doMock("@playwright/test", () => ({ defineConfig: (config: unknown) => config, devices: { "Desktop Chrome": {} } }));
  if (targets) vi.doMock(TARGET_MODULE, async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), PRODUCTION_AUTH_STAGING_TARGETS: targets }));
  try {
    return { config: ((await import(CONFIG_MODULE)) as { default: unknown }).default };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const ready = (answer: ProductionAuthTargetAnswer): Extract<ProductionAuthTargetAnswer, { state: "ready" }> => {
  if (answer.state !== "ready") throw new Error(`not ready: ${answer.codes.join(", ")}`);
  return answer;
};

describe("[B24-E] the production-auth target and its config (D24-34 offline; OD-191)", () => {
  it("1. every refusal code, by names only: each single fault refuses with exactly its code and the names it concerns; planted secret-shaped values appear in no answer and no message; a flag other than exactly \"1\" is not_requested", () => {
    const cases: ReadonlyArray<readonly [string, Env, readonly ProductionAuthStagingTarget[], readonly string[]]> = [
      ["marker_missing", withEnv({ [N.marker]: undefined }), [TARGET], [N.marker]],
      ["marker_malformed", withEnv({ [N.marker]: "staging-b24e-fixture" }), [TARGET], [N.marker]],
      ["target_not_listed", withEnv({ [N.marker]: ["sirkit", "auth", "qualification", "unlisted"].join("-") }), [TARGET], [N.marker]],
      ["target_list_malformed", FULL, [TARGET, { projectRef: "Not-A-Ref", label: "b24e-other" }], []],
      ["supabase_url_missing", withEnv({ [N.supabaseUrl]: undefined }), [TARGET], [N.supabaseUrl]],
      ["supabase_url_not_target", withEnv({ [N.supabaseUrl]: ["https", "://", OTHER_REF, ".supabase.co"].join("") }), [TARGET], [N.supabaseUrl]],
      ["publishable_key_missing", withEnv({ [N.publishableKey]: "", [N.anonKey]: ANON }), [TARGET], [N.anonKey, N.publishableKey]],
      ["publishable_key_secret", withEnv({ [N.publishableKey]: SECRET_KEY }), [TARGET], [N.anonKey, N.publishableKey]],
      ["email_missing", withEnv({ [N.email]: " " }), [TARGET], [N.email]],
      ["password_missing", withEnv({ [N.password]: undefined }), [TARGET], [N.password]],
      ["project_id_missing", withEnv({ [N.projectId]: undefined }), [TARGET], [N.projectId]],
      ["selector_malformed", withEnv({ [N.tenantId]: "a tenant" }), [TARGET], [N.tenantId]],
      ["database_url_missing", withEnv({ [N.databaseUrl]: undefined }), [TARGET], [N.databaseUrl]],
      ["database_url_not_target", withEnv({ [N.databaseUrl]: POOLER_URL.replace(REF, OTHER_REF) }), [TARGET], [N.databaseUrl]],
      ["base_url_not_reviewed", withEnv({ [N.baseUrl]: ["http", "://", "127.0.0.1:3999"].join("") }), [TARGET], [N.baseUrl]],
    ];
    expect(cases.map(([code]) => code).sort()).toEqual([...PRODUCTION_AUTH_REFUSAL_CODES].sort());
    for (const [code, env, targets, names] of cases) {
      const answer = resolveProductionAuthTarget(env, targets);
      expect(answer.state, code).toBe("refused");
      if (answer.state !== "refused") continue;
      expect([...answer.codes], code).toEqual([code]);
      expect([...answer.names], code).toEqual([...names].sort());
      for (const text of [JSON.stringify(answer), productionAuthNotExercised(answer)]) expect(noValue(text), code).toEqual([]);
    }
    // the other faults of each kind: no fall-through to the anon key, the service-role JWT, the selector, the database URL's forms
    const refusedWith = (env: Env, targets: readonly ProductionAuthStagingTarget[] = [TARGET]): readonly string[] => { const answer = resolveProductionAuthTarget(env, targets); return answer.state === "refused" ? answer.codes : [answer.state]; };
    // [B24-E review, 2026-10-10] correctness-4, security-3: each URL and list rule by an input that breaks it ALONE, so removing any one
    // rule lets exactly its input through (collected, so a breakage shows every input it frees); and the database URLs on which
    // postgres.js and the WHATWG parser can name different hosts: a second "@", and a host list (a comma after the first "@", which a
    // "#" hides from the WHATWG host)
    const SUPABASE_AT = (userinfo: string): string => ["https", "://", userinfo, "@", REF, ".supabase.co"].join("");
    const asTargets = (entries: readonly unknown[]): readonly ProductionAuthStagingTarget[] => entries as readonly ProductionAuthStagingTarget[];
    const single: ReadonlyArray<readonly [string, Env, readonly ProductionAuthStagingTarget[], string]> = [
      ["a port", withEnv({ [N.supabaseUrl]: `${SUPABASE_URL}:8443` }), [TARGET], "supabase_url_not_target"],
      ["a user name", withEnv({ [N.supabaseUrl]: SUPABASE_AT("b24e") }), [TARGET], "supabase_url_not_target"],
      ["a password", withEnv({ [N.supabaseUrl]: SUPABASE_AT([":", "b24e"].join("")) }), [TARGET], "supabase_url_not_target"],
      ["a query", withEnv({ [N.supabaseUrl]: `${SUPABASE_URL}/?b24e=1` }), [TARGET], "supabase_url_not_target"],
      ["a fragment", withEnv({ [N.supabaseUrl]: `${SUPABASE_URL}/#b24e` }), [TARGET], "supabase_url_not_target"],
      ["a duplicate ref", FULL, asTargets([TARGET, { projectRef: REF, label: "b24e-other" }]), "target_list_malformed"],
      ["a duplicate label", FULL, asTargets([TARGET, { projectRef: OTHER_REF, label: TARGET.label }]), "target_list_malformed"],
      ["an extra key", FULL, asTargets([TARGET, { projectRef: OTHER_REF, label: "b24e-other", note: "b24e" }]), "target_list_malformed"],
      ["a malformed label", FULL, asTargets([TARGET, { projectRef: OTHER_REF, label: "B24E Other" }]), "target_list_malformed"],
      ["a host list after the first @", withEnv({ [N.databaseUrl]: ["postgres", "://", "postgres", ":", DB_SECRET, "@", "db.", OTHER_REF, ".supabase.co", ",", "b24e", "@", "db.", REF, ".supabase.co", ":5432/postgres"].join("") }), [TARGET], "database_url_not_target"],
      ["a second @", withEnv({ [N.databaseUrl]: ["postgres", "://", "postgres", ":", DB_SECRET, "@", "b24e", "@", "db.", REF, ".supabase.co", ":5432/postgres"].join("") }), [TARGET], "database_url_not_target"],
      ["a host list after a fragment mark", withEnv({ [N.databaseUrl]: ["postgres", "://", "postgres", ":", DB_SECRET, "@", "db.", REF, ".supabase.co", "#", ",", "db.", OTHER_REF, ".supabase.co", "/postgres"].join("") }), [TARGET], "database_url_not_target"],
      ["a pooler host list", withEnv({ [N.databaseUrl]: ["postgres", "://", "postgres.", REF, ":", DB_SECRET, "@", "aws-0-eu-west-1.pooler.supabase.com", "%2C", "b24e", "@", "aws-0-eu-west-1.pooler.supabase.com", ":6543/postgres"].join("") }), [TARGET], "database_url_not_target"],
    ];
    const freed = single.flatMap(([what, env, targets, code]) => { const got = refusedWith(env, targets); return got.length === 1 && got[0] === code ? [] : [`${what}: ${got.join(", ")}`]; });
    expect(freed).toEqual([]);
    expect(refusedWith(withEnv({ [N.publishableKey]: undefined, [N.anonKey]: undefined }))).toEqual(["publishable_key_missing"]);
    expect(refusedWith(withEnv({ [N.publishableKey]: SERVICE_ROLE_JWT }))).toEqual(["publishable_key_secret"]);
    expect(refusedWith(withEnv({ [N.publishableKey]: undefined, [N.anonKey]: SERVICE_ROLE_JWT }))).toEqual(["publishable_key_secret"]);
    expect(refusedWith(withEnv({ [N.projectId]: "two words" }))).toEqual(["selector_malformed"]);
    expect(refusedWith(withEnv({ [N.tenantId]: "" }))).toEqual(["selector_malformed"]);
    expect(refusedWith(withEnv({ [N.supabaseUrl]: ["http", "://", REF, ".supabase.co"].join("") }))).toEqual(["supabase_url_not_target"]);
    expect(refusedWith(withEnv({ [N.supabaseUrl]: `${SUPABASE_URL}/rest/v1` }))).toEqual(["supabase_url_not_target"]);
    expect(refusedWith(withEnv({ [N.databaseUrl]: POOLER_URL.replace("pooler.supabase.com", "pooler.example.com") }))).toEqual(["database_url_not_target"]);
    expect(refusedWith(withEnv({ [N.databaseUrl]: DIRECT_URL.replace(`db.${REF}`, `db.${OTHER_REF}`) }))).toEqual(["database_url_not_target"]);
    expect(refusedWith(withEnv({ [N.databaseUrl]: ["mysql", "://", "postgres.", REF, ":", DB_SECRET, "@", "db.", REF, ".supabase.co/x"].join("") }))).toEqual(["database_url_not_target"]);
    // several faults at once: every code, in the closed order, each name once, no value
    const many = resolveProductionAuthTarget(withEnv({ [N.email]: undefined, [N.password]: undefined, [N.baseUrl]: "x" }), [TARGET]);
    expect(many).toEqual({ state: "refused", codes: ["email_missing", "password_missing", "base_url_not_reviewed"], names: [N.baseUrl, N.email, N.password].sort() });
    for (const flag of [undefined, "", "0", "true", " 1", "1 ", "yes"]) {
      const answer = resolveProductionAuthTarget(withEnv({ [N.flag]: flag }), [TARGET]);
      expect(answer, String(flag)).toEqual({ state: "not_requested", codes: ["flag_unset"], names: [N.flag] });
      if (answer.state !== "ready") expect(productionAuthNotExercised(answer)).toBe(`PRODUCTION_AUTH_NOT_EXERCISED: flag_unset (${N.flag})`);
    }
    expect(Object.isFrozen(PRODUCTION_AUTH_REFUSAL_CODES)).toBe(true);
  });

  it("2. counterexample: the committed staging list is EMPTY (no isolated project exists, OD-6, OD-191), so with every input set the answer is refused target_not_listed and nothing else", () => {
    expect(PRODUCTION_AUTH_STAGING_TARGETS).toEqual([]);
    expect(Object.isFrozen(PRODUCTION_AUTH_STAGING_TARGETS)).toBe(true);
    const answer = resolveProductionAuthTarget(FULL, PRODUCTION_AUTH_STAGING_TARGETS);
    expect(answer).toEqual({ state: "refused", codes: ["target_not_listed"], names: [N.marker] });
    expect(productionAuthNotExercised(answer as Exclude<ProductionAuthTargetAnswer, { state: "ready" }>)).toBe(`PRODUCTION_AUTH_NOT_EXERCISED: target_not_listed (${N.marker})`);
    // and the same inputs with the fixture target listed are ready: the list, not the inputs, is what refuses
    expect(resolveProductionAuthTarget(FULL, [TARGET]).state).toBe("ready");
    // the module reads the list by name and holds no entry (a reviewed change adds one, never the main project)
    expect(read(MODULE)).toMatch(/export const PRODUCTION_AUTH_STAGING_TARGETS: readonly ProductionAuthStagingTarget\[\] = Object\.freeze\(\[\]\);/);
  });

  it("3. ready with an injected fixture target: the pooler and the direct database URL each name its ref; the tenant defaults to local; the key is selected as mode.ts:65 selects it; the selector rule is the trusted context's ID_PATTERN; the ready answer prints no value", () => {
    for (const databaseUrl of [POOLER_URL, DIRECT_URL]) {
      const answer = ready(resolveProductionAuthTarget(withEnv({ [N.databaseUrl]: databaseUrl }), [TARGET]));
      expect(answer.target).toEqual(TARGET);
      expect(answer.server.databaseUrl).toBe(databaseUrl);
      expect(answer.server.supabaseUrl).toBe(SUPABASE_URL);
      expect(Object.keys(answer.server)).toEqual([]);
      expect(noValue(JSON.stringify(answer)).filter((value) => value !== REF)).toEqual([]);
    }
    // the key, selected as mode.ts selects it: the publishable key, else the anon key; never the anon key behind an empty publishable
    for (const env of [withEnv({}), withEnv({ [N.publishableKey]: undefined, [N.anonKey]: ANON }), withEnv({ [N.publishableKey]: ` ${PUBLISHABLE} `, [N.anonKey]: ANON })]) {
      const answer = ready(resolveProductionAuthTarget(env, [TARGET]));
      expect(answer.server.publishableKey).toBe(projectAuthRuntime(env).supabaseKey);
    }
    expect(ready(resolveProductionAuthTarget(withEnv({ [N.tenantId]: "local" }), [TARGET])).target).toEqual(TARGET);
    expect(PRODUCTION_AUTH_SELECTOR_ID.source).toBe(ID_PATTERN.source);
    expect(PRODUCTION_AUTH_SELECTOR_ID.flags).toBe(ID_PATTERN.flags);
  });

  it("4. the config: it throws PRODUCTION_AUTH_NOT_EXERCISED without the flag and with the committed list, naming no value; with a fixture list injected it is the builder's shape - its own folder, workers 1, retries 0, a fresh server, the list reporter alone, its own output folder, trace, screenshot and video off, fresh storage, port 3102, the build-then-start command, and the server environment (production auth, the staging profile, the loopback origin, the isolated database, the three Supabase names, every provider key, fixture name, MCP flag and other secret blank); it is the one config that runs production auth", { timeout: 60_000 }, async () => {
    const off = await loadConfig(withEnv({ [N.flag]: undefined }));
    expect(off).toEqual({ error: `PRODUCTION_AUTH_NOT_EXERCISED: flag_unset (${N.flag})` });
    const committed = await loadConfig(FULL);
    expect(committed).toEqual({ error: `PRODUCTION_AUTH_NOT_EXERCISED: target_not_listed (${N.marker})` });
    expect(noValue(committed.error ?? "")).toEqual([]);
    expect(process.env.PLAYWRIGHT_NO_COPY_PROMPT).toBeUndefined();
    const loaded = await loadConfig(FULL, [TARGET]);
    expect(loaded.error).toBeUndefined();
    const answer = ready(resolveProductionAuthTarget(FULL, [TARGET]));
    const built = productionAuthPlaywrightConfig(answer);
    expect(loaded.config).toEqual(built);
    // [B24-E review, 2026-10-10] correctness-1, security-1: a ready config turns Playwright's failure page snapshot off in the runner and
    // in every worker (each loads the config); Playwright 1.63's `_takePageSnapshot` returns at once under PLAYWRIGHT_NO_COPY_PROMPT
    // (playwright/lib/index.js), so no error-context.md holds an ARIA snapshot of a field's value, whenever the test fails or times out
    expect(PRODUCTION_AUTH_RUNNER_ENV).toEqual({ PLAYWRIGHT_NO_COPY_PROMPT: "1" });
    expect(process.env.PLAYWRIGHT_NO_COPY_PROMPT).toBe("1");
    // the shape, bullet by bullet
    expect(built).toMatchObject({ testDir: "./e2e-production-auth", fullyParallel: false, workers: 1, retries: 0, outputDir: "test-results-production-auth" });
    expect([PRODUCTION_AUTH_TEST_DIR, PRODUCTION_AUTH_OUTPUT_DIR, PRODUCTION_AUTH_PORT]).toEqual(["./e2e-production-auth", "test-results-production-auth", 3102]);
    expect(built.reporter).toEqual([["list"]]);
    // [B24-E review, 2026-10-10] correctness-1, security-1: every action and navigation bounded (a backstop to the spec's own bounds)
    expect(built.use).toEqual({ baseURL: PRODUCTION_AUTH_ORIGIN, trace: "off", screenshot: "off", video: "off", storageState: { cookies: [], origins: [] }, actionTimeout: 15_000, navigationTimeout: 30_000 });
    expect(PRODUCTION_AUTH_ORIGIN).toBe(["http", "://", "127.0.0.1:3102"].join(""));
    expect(built.projects).toEqual([{ name: "chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 720 } } }]);
    // [B24-E review, 2026-10-10] security-4: next start listens on 0.0.0.0 unless told (next's CLI, `-H, --hostname`): loopback only
    expect(PRODUCTION_AUTH_COMMAND).toBe("pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port 3102");
    expect(built.webServer).toMatchObject({ command: PRODUCTION_AUTH_COMMAND, url: `${PRODUCTION_AUTH_ORIGIN}/api/health`, reuseExistingServer: false, stdout: "ignore", stderr: "ignore" });
    const env = built.webServer.env;
    expect({ NODE_ENV: env.NODE_ENV, SIRKIT_AUTH_MODE: env.SIRKIT_AUTH_MODE, SIRKIT_DEPLOYMENT_ENV: env.SIRKIT_DEPLOYMENT_ENV, SIRKIT_EXPECTED_ORIGIN: env.SIRKIT_EXPECTED_ORIGIN }).toEqual({ NODE_ENV: "production", SIRKIT_AUTH_MODE: "production", SIRKIT_DEPLOYMENT_ENV: "staging", SIRKIT_EXPECTED_ORIGIN: PRODUCTION_AUTH_ORIGIN });
    expect(env.DATABASE_URL === POOLER_URL, "DATABASE_URL is the qualification database").toBe(true);
    expect(env.NEXT_PUBLIC_SUPABASE_URL === answer.server.supabaseUrl && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY === answer.server.publishableKey, "the URL and the key are the resolver's").toBe(true);
    expect(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.length).toBeGreaterThan(0);
    expect(env.NEXT_PUBLIC_SUPABASE_ANON_KEY).toBe("");
    const blank = [
      "OPENAI_API_KEY", "ANTHROPIC_API_KEY", "SIRKIT_MCP_ENABLED",
      "SIRKIT_TRUSTED_CLIENT_IP_HEADER", // [B24-E review, 2026-10-10] security-4: no client-chosen header keys A3's windows on this server
      ...FLAG_INVENTORY.filter((entry) => entry.kind === "fixture").map((entry) => entry.name),
      ...ENVIRONMENT_NAMES.filter((row) => (row.class === "secret" || row.class === "rotation-previous") && row.name !== "DATABASE_URL").map((row) => row.name),
      N.email, N.password, N.databaseUrl,
    ];
    expect(blank.filter((name) => env[name] !== "")).toEqual([]);
    expect(FLAG_INVENTORY.filter((entry) => entry.kind === "fixture")).toHaveLength(6);
    expect(Object.values(env)).not.toContain("local_dev");
    // the server's environment holds the qualification inputs only as the three server names: no account credential reaches it
    expect(Object.entries(env).filter(([, value]) => value === EMAIL || value === PASSWORD)).toEqual([]);
    // the config file wraps the builder and nothing else: two imports, the committed list, a throw before any export, no local_dev
    const text = read(CONFIG);
    expect([...text.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1])).toEqual(["@playwright/test", "./app/lib/deployment/production-auth-target"]);
    expect(text).toContain("resolveProductionAuthTarget(process.env, PRODUCTION_AUTH_STAGING_TARGETS)");
    expect(text).toContain("export default defineConfig(productionAuthPlaywrightConfig(answer));");
    expect(text.indexOf("throw new Error(productionAuthNotExercised(answer))")).toBeLessThan(text.indexOf("export default"));
    expect(text.indexOf("throw new Error(productionAuthNotExercised(answer))")).toBeLessThan(text.indexOf("Object.assign(process.env, PRODUCTION_AUTH_RUNNER_ENV);"));
    expect(text.indexOf("Object.assign(process.env, PRODUCTION_AUTH_RUNNER_ENV);")).toBeLessThan(text.indexOf("export default"));
    expect(text).not.toContain("local_dev");
    // [B24-E] red on 6e4e1bb: no root config ran production auth - each set local_dev or extended the one that does
    const configs = readdirSync(ROOT).filter((name) => /^playwright(?:\.[a-z-]+)?\.config\.ts$/.test(name)).sort();
    expect(configs).toEqual(["playwright.config.ts", "playwright.orchestration.config.ts", CONFIG]);
    const production = configs.filter((name) => { const own = read(name); return !own.includes('SIRKIT_AUTH_MODE: "local_dev"') && !own.includes('from "./playwright.config"'); });
    expect(production).toEqual([CONFIG]);
    expect(read(MODULE)).toContain('SIRKIT_AUTH_MODE: "production"');
  });

  it("5. the spec sits outside ./e2e and ./e2e-orchestration, so no CI step selects it - every `playwright test` command in every workflow, found by its command, runs a config whose testDir is one of the two, or names files under ./e2e - and no workflow names the config or its folder", () => {
    const testDirOf = (config: string): string => /^\s*testDir: "(\.\/[a-z0-9-]+)",/m.exec(read(config))?.[1] ?? "none";
    expect(testDirOf("playwright.config.ts")).toBe("./e2e");
    expect(testDirOf("playwright.orchestration.config.ts")).toBe("./e2e-orchestration");
    expect(testDirOf(CONFIG)).toBe("none");
    expect(productionAuthPlaywrightConfig(ready(resolveProductionAuthTarget(FULL, [TARGET]))).testDir).toBe(`./${SPEC.split("/")[0]}`);
    const workflows = readdirSync(join(ROOT, ".github/workflows")).filter((name) => /\.ya?ml$/.test(name)).map((name) => `.github/workflows/${name}`);
    expect(workflows.length).toBeGreaterThanOrEqual(2);
    const commands = workflows.flatMap((path) => read(path).split(NEWLINE).filter((line) => /\bplaywright test\b/.test(line)).map((line) => ({ path, line: line.trim() })));
    expect(commands.length).toBeGreaterThanOrEqual(3);
    for (const { path, line } of commands) {
      const config = /\s-c\s+(\S+)/.exec(line)?.[1] ?? "playwright.config.ts";
      expect(["playwright.config.ts", "playwright.orchestration.config.ts"], `${path}: ${line}`).toContain(config);
      const dir = testDirOf(config);
      expect(SPEC.startsWith(`${dir.slice(2)}/`), `${path}: ${line}`).toBe(false);
      for (const file of line.split(/\s+/).filter((word) => /\.spec\.ts$/.test(word))) expect(file.startsWith("e2e/"), `${path}: ${file}`).toBe(true);
    }
    expect(commands.some(({ line }) => line.endsWith("run: pnpm exec playwright test"))).toBe(true);
    expect(commands.some(({ line }) => line.endsWith("playwright test -c playwright.orchestration.config.ts"))).toBe(true);
    for (const path of workflows) for (const needle of ["production-auth", CONFIG, SPEC.split("/")[0]!]) expect(read(path).includes(needle), `${path} names ${needle}`).toBe(false);
  });

  it("6. the spec reads credentials only by name and logs nothing (AST): every process.env read is a dot read of an allowed name, the environment is otherwise handed whole to the resolver once, no console call, no literal holds an address or a URL; and test 1 clears both sign-in fields in a finally before its first assertion", () => {
    const text = read(SPEC);
    const source = ts.createSourceFile(SPEC, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const allowed = new Set<string>([N.email, N.password, N.projectId, N.tenantId, N.databaseUrl]);
    const problems: string[] = [];
    const reads = new Set<string>();
    let whole = 0;
    let consoles = 0;
    const isProcessEnv = (node: ts.Node): boolean => ts.isPropertyAccessExpression(node) && node.name.text === "env" && ts.isIdentifier(node.expression) && node.expression.text === "process";
    const visit = (node: ts.Node): void => {
      if (isProcessEnv(node)) {
        const parent = node.parent;
        if (ts.isPropertyAccessExpression(parent) && parent.expression === node) {
          if (allowed.has(parent.name.text)) reads.add(parent.name.text);
          else problems.push(`reads ${parent.name.text}`);
        } else if (ts.isCallExpression(parent) && parent.expression.getText(source) === "resolveProductionAuthTarget" && parent.arguments[0] === node) whole += 1;
        else problems.push(`process.env used as ${parent.getText(source).slice(0, 60)}`);
      }
      if (ts.isIdentifier(node) && node.text === "console") consoles += 1;
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !ts.isImportDeclaration(node.parent) && /@|:\/\/|postgres(?:ql)?:/.test(node.text)) problems.push(`literal ${node.text.slice(0, 40)}`);
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(problems).toEqual([]);
    expect([...reads].sort()).toEqual([...allowed].sort());
    expect(whole).toBe(1);
    expect(consoles).toBe(0);
    // [B24-E review, 2026-10-10] correctness-1, security-1: test 1 opens the form, then, in a try, enters both credentials through the
    // bounded form steps of `sign-in-form.ts` (case 8), and in its finally clears both fields - each block that one call, no expect
    // before the finally; no input call anywhere in the harness carries a typed value (Playwright 1.63 titles fill, type,
    // pressSequentially and keyboard steps with the text and logs `fill("<value>")` into a failed action's call log)
    const harness = [SPEC, FORM].map((path) => ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS));
    const typing: string[] = [];
    for (const file of harness) {
      const walk = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ["fill", "type", "pressSequentially", "insertText", "press"].includes(node.expression.name.text)) typing.push(`${file.fileName}: ${node.getText(file).slice(0, 60)}`);
        if (ts.isPropertyAccessExpression(node) && node.name.text === "keyboard") typing.push(`${file.fileName}: ${node.getText(file).slice(0, 60)}`);
        ts.forEachChild(node, walk);
      };
      walk(file);
    }
    expect(typing).toEqual([]);
    let testOne: ts.Block | null = null;
    const findTestOne = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === "test" && ts.isStringLiteral(node.arguments[0]!) && (node.arguments[0] as ts.StringLiteral).text.startsWith("1. ")) {
        const fn = node.arguments[1];
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isBlock(fn.body)) testOne = fn.body;
      }
      ts.forEachChild(node, findTestOne);
    };
    findTestOne(source);
    const statements = (testOne as ts.Block | null)?.statements.map((statement) => statement) ?? [];
    const tryAt = statements.findIndex((statement) => ts.isTryStatement(statement));
    expect(tryAt).toBeGreaterThan(0);
    const attempt = statements[tryAt] as ts.TryStatement;
    expect(statements.slice(0, tryAt).map((statement) => statement.getText(source))).toEqual(["await openSignIn(page);", "let status = 0;"]);
    expect(attempt.tryBlock.statements.map((statement) => statement.getText(source))).toEqual(["status = await submitSignIn(page, EMAIL, PASSWORD);"]);
    expect(attempt.finallyBlock?.statements.map((statement) => statement.getText(source))).toEqual(["await clearCredentialFields(page);"]);
    expect(statements.slice(0, tryAt + 1).some((statement) => statement.getText(source).includes("expect("))).toBe(false);
    // the password is read once and handed to the form step alone; the email to the form step and the canary's account lookup
    const uses = (name: string): number => [...text.matchAll(new RegExp(String.raw`\b${name}\b`, "g"))].length;
    expect([uses("PASSWORD"), uses("EMAIL")]).toEqual([2, 3]);
    expect(text).toContain('import { clearCredentialFields, openSignIn, submitSignIn } from "./sign-in-form";');
    // the spec signs out through the page's request context with the page's Origin, and never sets a header from a credential
    expect(text).toContain('page.request.post("/api/auth/signout", { headers: { origin: new URL(page.url()).origin } })');
  });

  it("7. the resolver and the spec are in no route's runtime import closure (importClosure's edges, over B14's production walk), and the only production importers of the resolver are the config and the spec; a planted route that imports it is caught", { timeout: 120_000 }, async () => {
    await new Promise<void>((resolve) => setImmediate(resolve));
    const files: FileMap = collectProductionFiles(ROOT);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const routes = listRouteFiles(ROOT).map((file) => relative(ROOT, file).split("\\").join("/"));
    expect(routes.length).toBeGreaterThan(100);
    const closure = importClosure(files, routes);
    expect(closure.has(MODULE)).toBe(false);
    expect(closure.has(SPEC)).toBe(false);
    expect(closure.has(FORM)).toBe(false);
    expect(files.has(MODULE) && files.has(SPEC) && files.has(CONFIG)).toBe(true);
    const importers = [...files].filter(([path, text]) => path !== MODULE && moduleReferences(path, text).some((reference) => { const resolution = resolveSpecifier(path, reference.specifier); return resolution.kind === "module" && fileOf(files, resolution.module) === MODULE; })).map(([path]) => path).sort();
    expect(importers).toEqual([CONFIG, SPEC].sort());
    // the check bites: a route that imports the resolver puts it in the closure
    const planted = new Map(files);
    planted.set("app/api/b24-e-probe/route.ts", 'import { resolveProductionAuthTarget } from "@/app/lib/deployment/production-auth-target";\nexport const GET = () => resolveProductionAuthTarget({}, []);\n');
    expect(importClosure(planted, ["app/api/b24-e-probe/route.ts"]).has(MODULE)).toBe(true);
  });

  it("8. the spec's sign-in form steps on a recording page (review correctness-1, security-1): each credential goes in as the argument of one bounded page evaluation, never a typing call; the answer's wait starts before the bounded click; the page function sets the value through the input's own setter and a bubbling input event; the clearing blanks both fields, is bounded and never throws; and the steps' worst case ends 20 s inside the test timeout, so test 1's finally always runs before Playwright tears the test down", async () => {
    const form = (await import(FORM_MODULE)) as typeof import("@/e2e-production-auth/sign-in-form");
    type Call = { readonly what: string; readonly arg?: unknown; readonly options?: unknown; readonly fn?: unknown };
    const recordingPage = (setup: { readonly fields: number; readonly status: number; readonly failClick?: boolean; readonly failWaits?: boolean }) => {
      const calls: Call[] = [];
      let clicked = false;
      let answer: (value: { status: () => number }) => void = () => undefined;
      let noAnswer: (error: Error) => void = () => undefined;
      const typed = (what: string) => async (...args: unknown[]): Promise<void> => { calls.push({ what: `TYPED ${what}`, arg: args[0] }); };
      const locator = (name: string) => ({
        count: async (): Promise<number> => { calls.push({ what: `${name} count` }); return setup.fields; },
        evaluate: async (fn: unknown, arg: unknown, options?: unknown): Promise<void> => { calls.push({ what: `${name} evaluate`, arg, options, fn }); if (setup.failWaits) throw new Error("b24e: the evaluation timed out"); },
        click: async (options?: unknown): Promise<void> => {
          calls.push({ what: `${name} click`, options });
          clicked = true;
          if (setup.failClick) { noAnswer(new Error("b24e: no answer")); throw new Error("b24e: the click timed out"); }
          answer({ status: () => setup.status });
        },
        fill: typed(`${name} fill`), type: typed(`${name} type`), pressSequentially: typed(`${name} pressSequentially`), press: typed(`${name} press`),
      });
      const page = {
        goto: async (url: string, options?: unknown): Promise<null> => { calls.push({ what: `goto ${url}`, options }); return null; },
        getByLabel: (label: string) => locator(`label ${label}`),
        getByRole: (role: string, options: { name: string }) => locator(`${role} ${options.name}`),
        waitForResponse: (predicate: (response: unknown) => boolean, options?: unknown): Promise<{ status: () => number }> => {
          calls.push({ what: "waitForResponse", options, arg: predicate });
          return clicked ? Promise.resolve({ status: () => setup.status }) : new Promise((resolve, reject) => { answer = resolve; noAnswer = reject; });
        },
        waitForFunction: async (fn: unknown, arg: unknown, options?: unknown): Promise<null> => { calls.push({ what: "waitForFunction", options }); if (setup.failWaits) throw new Error("b24e: the wait timed out"); return null; },
        keyboard: { type: typed("keyboard type"), insertText: typed("keyboard insertText"), press: typed("keyboard press") },
      };
      return { page: page as unknown as Parameters<typeof form.submitSignIn>[0], calls };
    };
    const T = form.SIGN_IN_STEP_TIMEOUTS;
    const timeoutOf = (call: Call): unknown => (call.options as { timeout?: unknown } | undefined)?.timeout;
    // open, enter, wait for the answer, click: in that order, each bounded, the values only as the evaluations' arguments
    const signIn = recordingPage({ fields: 1, status: 200 });
    await form.openSignIn(signIn.page);
    expect(await form.submitSignIn(signIn.page, EMAIL, PASSWORD)).toBe(200);
    expect(signIn.calls.map((call) => call.what)).toEqual(["goto /signin", "label Email evaluate", "label Password evaluate", "waitForResponse", "button Sign in click"]);
    expect(signIn.calls.map(timeoutOf)).toEqual([T.navigate, T.enter, T.enter, T.response, T.click]);
    expect(signIn.calls.filter((call) => call.what.endsWith(" evaluate")).map((call) => call.arg)).toEqual([EMAIL, PASSWORD]);
    expect(noValue(JSON.stringify(signIn.calls.map(({ what, options }) => ({ what, options }))))).toEqual([]);
    const predicate = signIn.calls.find((call) => call.what === "waitForResponse")?.arg as (response: unknown) => boolean;
    const response = (path: string, method: string) => ({ url: () => `${PRODUCTION_AUTH_ORIGIN}${path}`, request: () => ({ method: () => method }) });
    expect([predicate(response("/api/auth/signin", "POST")), predicate(response("/api/auth/signin", "GET")), predicate(response("/api/auth/signout", "POST"))]).toEqual([true, false, false]);
    // a failed click rejects the step, and the answer's wait it leaves behind is observed (an unobserved rejection would fail this run)
    const refused = recordingPage({ fields: 1, status: 200, failClick: true });
    await expect(form.submitSignIn(refused.page, EMAIL, PASSWORD)).rejects.toThrow("b24e: the click timed out");
    await new Promise<void>((resolve) => setTimeout(resolve, 0)); // a later turn: an unobserved rejection is reported by then
    // the clearing: settle, then blank each field the page still shows; nothing when the form is gone; never a throw
    const cleared = recordingPage({ fields: 1, status: 200 });
    await form.clearCredentialFields(cleared.page);
    expect(cleared.calls.map((call) => [call.what, call.arg ?? null, timeoutOf(call) ?? null])).toEqual([["waitForFunction", null, T.settle], ["label Email count", null, null], ["label Email evaluate", "", T.clear], ["label Password count", null, null], ["label Password evaluate", "", T.clear]]);
    const gone = recordingPage({ fields: 0, status: 200 });
    await form.clearCredentialFields(gone.page);
    expect(gone.calls.map((call) => call.what)).toEqual(["waitForFunction", "label Email count", "label Password count"]);
    const failing = recordingPage({ fields: 1, status: 200, failWaits: true });
    await expect(form.clearCredentialFields(failing.page)).resolves.toBeUndefined();
    expect(failing.calls.filter((call) => call.what.endsWith(" evaluate")).map((call) => call.what)).toEqual(["label Email evaluate", "label Password evaluate"]);
    const every = [...signIn.calls, ...refused.calls, ...cleared.calls, ...gone.calls, ...failing.calls];
    expect(every.filter((call) => call.what.startsWith("TYPED "))).toEqual([]);
    expect(every.filter((call) => call.what.endsWith(" evaluate") && call.fn !== form.setInputValue)).toEqual([]);
    // the page function: the prototype's value setter (React tracks an instance's own), then one bubbling input event
    let stored = "";
    let tracked = 0;
    const events: Array<readonly [string, boolean]> = [];
    class StandInInput {
      get value(): string { return stored; }
      set value(next: string) { stored = next; }
      dispatchEvent(event: Event): boolean { events.push([event.type, event.bubbles]); return true; }
    }
    vi.stubGlobal("HTMLInputElement", StandInInput);
    const input = new StandInInput();
    Object.defineProperty(input, "value", { configurable: true, get: () => stored, set: () => { tracked += 1; } });
    form.setInputValue(input as unknown as Element, PASSWORD);
    expect([stored === PASSWORD, tracked, events]).toEqual([true, 0, [["input", true]]]);
    // the worst case of test 1 up to the end of its finally, 20 s inside the config's test timeout
    expect(form.SIGN_IN_WORST_CASE_MS).toBe(T.navigate + 2 * T.enter + T.click + T.response + T.settle + 2 * T.clear);
    expect(form.SIGN_IN_WORST_CASE_MS + 20_000).toBeLessThanOrEqual(productionAuthPlaywrightConfig(ready(resolveProductionAuthTarget(FULL, [TARGET]))).timeout);
    expect(Object.values(T).every((ms) => Number.isInteger(ms) && ms > 0 && ms <= 30_000)).toBe(true);
  });
});
