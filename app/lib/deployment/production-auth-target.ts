/**
 * [B24-E] D24-34 offline, OD-191: the production-auth browser harness's target and shape (runbook B24-E item 2, `:1116`).
 *
 * Which isolated Supabase project `playwright.production-auth.config.ts` may run against, and what that config is, as plain data.
 * The staging list is EMPTY: no isolated project exists (OD-6, OD-191), so at this tree every answer is `not_requested` or `refused`
 * and the config throws `PRODUCTION_AUTH_NOT_EXERCISED` before anything starts. A reviewed change adds one entry for an isolated
 * project the owner names - never the main project, which B24 treats as production (OD-191). The run itself is
 * BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13) until then.
 *
 * The inputs are B16-1B's names (`b16-1b-live-qualification.test.ts:8-18`) and the Supabase pair `mode.ts` reads. A refusal carries
 * closed codes and variable NAMES, never a value; a ready answer holds its three server values as non-enumerable properties, so
 * neither JSON nor a console inspection prints them. The builder sets every name the production server must not inherit from a
 * developer's `.env.local` (`next start` loads a file only for a name the environment leaves undefined: `@next/env` `processEnv`).
 *
 * Pure: no I/O, no clock and no process environment of its own - the caller hands the environment in. It imports only the
 * environment-name census (data).
 */
import { ENVIRONMENT_NAMES } from "./environment-names";

/** The inputs, by name (B16-1B's names and the Supabase pair). */
export const PRODUCTION_AUTH_INPUT_NAMES = Object.freeze({
  flag: "SIRKIT_LIVE_AUTH_QUALIFICATION",
  marker: "SIRKIT_AUTH_QUALIFICATION_PROJECT",
  baseUrl: "SIRKIT_AUTH_QUALIFICATION_BASE_URL",
  email: "SIRKIT_AUTH_QUALIFICATION_EMAIL",
  password: "SIRKIT_AUTH_QUALIFICATION_PASSWORD",
  projectId: "SIRKIT_AUTH_QUALIFICATION_PROJECT_ID",
  tenantId: "SIRKIT_AUTH_QUALIFICATION_TENANT_ID",
  databaseUrl: "SIRKIT_AUTH_QUALIFICATION_DATABASE_URL",
  supabaseUrl: "NEXT_PUBLIC_SUPABASE_URL",
  publishableKey: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  anonKey: "NEXT_PUBLIC_SUPABASE_ANON_KEY",
} as const);

/** One isolated project the harness may run against: its Supabase project ref and the label its marker names. */
export interface ProductionAuthStagingTarget {
  readonly projectRef: string;
  readonly label: string;
}

/** The reviewed staging list: EMPTY. No isolated project exists (OD-6, OD-191). */
export const PRODUCTION_AUTH_STAGING_TARGETS: readonly ProductionAuthStagingTarget[] = Object.freeze([]);

/** The closed refusal codes, in the order an answer lists them. */
export const PRODUCTION_AUTH_REFUSAL_CODES = Object.freeze([
  "target_list_malformed",
  "marker_missing",
  "marker_malformed",
  "target_not_listed",
  "supabase_url_missing",
  "supabase_url_not_target",
  "publishable_key_missing",
  "publishable_key_secret",
  "email_missing",
  "password_missing",
  "project_id_missing",
  "selector_malformed",
  "database_url_missing",
  "database_url_not_target",
  "base_url_not_reviewed",
] as const);
export type ProductionAuthRefusalCode = (typeof PRODUCTION_AUTH_REFUSAL_CODES)[number];

/** The three values the production server needs, held non-enumerable (never printed by JSON or an inspection). */
export interface ProductionAuthServerInputs {
  readonly supabaseUrl: string;
  readonly publishableKey: string;
  readonly databaseUrl: string;
}

export type ProductionAuthTargetAnswer =
  | { readonly state: "not_requested"; readonly codes: readonly ["flag_unset"]; readonly names: readonly string[] }
  | { readonly state: "refused"; readonly codes: readonly ProductionAuthRefusalCode[]; readonly names: readonly string[] }
  | { readonly state: "ready"; readonly target: ProductionAuthStagingTarget; readonly server: ProductionAuthServerInputs };

/** B16-1B's isolated-project marker rule (`b16-1b-live-qualification.test.ts:28`). */
const MARKER_PREFIX = "sirkit-auth-qualification-";
const MARKER_PATTERN = /^sirkit-auth-qualification-[a-z0-9-]+$/i;
/** A Supabase project ref (INFERRED: twenty lower-case letters or digits) and a target label (the marker's suffix, lower case). */
const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;
const LABEL_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The selector-id rule, a copy of the trusted context's `ID_PATTERN` (`trusted-request-context.ts:43`; equality pinned by test). */
export const PRODUCTION_AUTH_SELECTOR_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const POOLER_HOST_PATTERN = /^[a-z0-9-]+\.pooler\.supabase\.com$/;

/** Whether a list is well formed: closed keys, a ref and a label of the rules above, each ref and label once. */
function stagingTargetsWellFormed(targets: readonly ProductionAuthStagingTarget[]): boolean {
  if (!Array.isArray(targets)) return false;
  const refs = new Set<string>();
  const labels = new Set<string>();
  for (const target of targets) {
    if (typeof target !== "object" || target === null || Object.keys(target).sort().join(",") !== "label,projectRef") return false;
    if (typeof target.projectRef !== "string" || !PROJECT_REF_PATTERN.test(target.projectRef)) return false;
    if (typeof target.label !== "string" || !LABEL_PATTERN.test(target.label)) return false;
    if (refs.has(target.projectRef) || labels.has(target.label)) return false;
    refs.add(target.projectRef);
    labels.add(target.label);
  }
  return true;
}

const parsed = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

/** The target's own Supabase URL: https, host exactly `<projectRef>.supabase.co`, nothing else. */
function isTargetSupabaseUrl(value: string, projectRef: string): boolean {
  const url = parsed(value);
  return url !== null && url.protocol === "https:" && url.hostname === `${projectRef}.supabase.co` && url.port === "" && url.username === "" && url.password === "" && url.pathname === "/" && url.search === "" && url.hash === "";
}

/** The target's own database: the direct host `db.<projectRef>.supabase.co`, or a Supabase pooler host with the user `postgres.<projectRef>`. */
function isTargetDatabaseUrl(value: string, projectRef: string): boolean {
  const url = parsed(value);
  if (url === null || (url.protocol !== "postgres:" && url.protocol !== "postgresql:") || !oneHostForBothParsers(value)) return false;
  const host = url.hostname.toLowerCase();
  if (host === `db.${projectRef}.supabase.co`) return true;
  let user: string;
  try {
    user = decodeURIComponent(url.username);
  } catch {
    return false;
  }
  return user === `postgres.${projectRef}` && POOLER_HOST_PATTERN.test(host);
}

/** A key that must never sit in a public variable (next build inlines it into the browser bundle): a Supabase secret key, or a JWT
 *  whose payload names the service role. */
function secretShapedKey(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(atob(parts[1]!.replaceAll("-", "+").replaceAll("_", "/"))) as { role?: unknown };
    return payload !== null && typeof payload === "object" && payload.role === "service_role";
  } catch {
    return false;
  }
}

const NOT_REQUESTED: ProductionAuthTargetAnswer = Object.freeze({ state: "not_requested", codes: Object.freeze(["flag_unset"] as const), names: Object.freeze([PRODUCTION_AUTH_INPUT_NAMES.flag]) });

/**
 * The answer for one environment over one staging list: `not_requested` unless the flag is exactly "1"; `refused` with every code that
 * applies (closed order) and the names it concerns; else `ready` with the listed target and the three server values.
 */
export function resolveProductionAuthTarget(env: Readonly<Record<string, string | undefined>>, targets: readonly ProductionAuthStagingTarget[]): ProductionAuthTargetAnswer {
  if (env.SIRKIT_LIVE_AUTH_QUALIFICATION !== "1") return NOT_REQUESTED;
  const found = new Map<ProductionAuthRefusalCode, readonly string[]>();
  const refuse = (code: ProductionAuthRefusalCode, ...names: string[]): void => {
    found.set(code, names);
  };
  const listed = stagingTargetsWellFormed(targets);
  if (!listed) refuse("target_list_malformed");
  // the marker selects the target: sirkit-auth-qualification-<label> of a listed entry
  const marker = env.SIRKIT_AUTH_QUALIFICATION_PROJECT ?? "";
  let target: ProductionAuthStagingTarget | null = null;
  if (marker === "") refuse("marker_missing", "SIRKIT_AUTH_QUALIFICATION_PROJECT");
  else if (!MARKER_PATTERN.test(marker)) refuse("marker_malformed", "SIRKIT_AUTH_QUALIFICATION_PROJECT");
  else if (listed) {
    target = targets.find((entry) => `${MARKER_PREFIX}${entry.label}` === marker) ?? null;
    if (target === null) refuse("target_not_listed", "SIRKIT_AUTH_QUALIFICATION_PROJECT");
  }
  // the Supabase pair, read as mode.ts reads it (the URL trimmed; the publishable key, else the anon key, each trimmed)
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (supabaseUrl === "") refuse("supabase_url_missing", "NEXT_PUBLIC_SUPABASE_URL");
  else if (target !== null && !isTargetSupabaseUrl(supabaseUrl, target.projectRef)) refuse("supabase_url_not_target", "NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  if (publishableKey === "") refuse("publishable_key_missing", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  else if (secretShapedKey(publishableKey)) refuse("publishable_key_secret", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  // the account and the selector
  if ((env.SIRKIT_AUTH_QUALIFICATION_EMAIL ?? "").trim() === "") refuse("email_missing", "SIRKIT_AUTH_QUALIFICATION_EMAIL");
  if ((env.SIRKIT_AUTH_QUALIFICATION_PASSWORD ?? "").trim() === "") refuse("password_missing", "SIRKIT_AUTH_QUALIFICATION_PASSWORD");
  const projectId = env.SIRKIT_AUTH_QUALIFICATION_PROJECT_ID ?? "";
  const tenantId = env.SIRKIT_AUTH_QUALIFICATION_TENANT_ID ?? "local";
  const malformedSelector: string[] = [];
  if (projectId.trim() === "") refuse("project_id_missing", "SIRKIT_AUTH_QUALIFICATION_PROJECT_ID");
  else if (!PRODUCTION_AUTH_SELECTOR_ID.test(projectId)) malformedSelector.push("SIRKIT_AUTH_QUALIFICATION_PROJECT_ID");
  if (!PRODUCTION_AUTH_SELECTOR_ID.test(tenantId)) malformedSelector.push("SIRKIT_AUTH_QUALIFICATION_TENANT_ID");
  if (malformedSelector.length > 0) refuse("selector_malformed", ...malformedSelector);
  // the isolated project's database: required here, and it names the target's ref
  const databaseUrl = env.SIRKIT_AUTH_QUALIFICATION_DATABASE_URL?.trim() ?? "";
  if (databaseUrl === "") refuse("database_url_missing", "SIRKIT_AUTH_QUALIFICATION_DATABASE_URL");
  else if (target !== null && !isTargetDatabaseUrl(databaseUrl, target.projectRef)) refuse("database_url_not_target", "SIRKIT_AUTH_QUALIFICATION_DATABASE_URL");
  // no target carries a reviewed app origin: the config starts its own loopback server
  if ((env.SIRKIT_AUTH_QUALIFICATION_BASE_URL ?? "").trim() !== "") refuse("base_url_not_reviewed", "SIRKIT_AUTH_QUALIFICATION_BASE_URL");
  if (found.size > 0 || target === null) {
    const codes = PRODUCTION_AUTH_REFUSAL_CODES.filter((code) => found.has(code));
    const names = [...new Set([...found.values()].flat())].sort();
    return Object.freeze({ state: "refused", codes: Object.freeze(codes), names: Object.freeze(names) });
  }
  const server = Object.freeze(Object.defineProperties({} as ProductionAuthServerInputs, {
    supabaseUrl: { value: supabaseUrl, enumerable: false },
    publishableKey: { value: publishableKey, enumerable: false },
    databaseUrl: { value: databaseUrl, enumerable: false },
  }));
  return Object.freeze({ state: "ready", target: Object.freeze({ projectRef: target.projectRef, label: target.label }), server });
}

/** The config's refusal: closed codes, then the names they concern; never a value. */
export function productionAuthNotExercised(answer: Exclude<ProductionAuthTargetAnswer, { state: "ready" }>): string {
  const names = answer.names.length > 0 ? " (" + answer.names.join(", ") + ")" : "";
  return "PRODUCTION_AUTH_NOT_EXERCISED: " + answer.codes.join(", ") + names;
}

// ── the config, as plain data (playwright.production-auth.config.ts wraps it in defineConfig) ───────────────────────────────────

export const PRODUCTION_AUTH_PORT = 3102;
export const PRODUCTION_AUTH_ORIGIN = `http://127.0.0.1:${PRODUCTION_AUTH_PORT}`;
export const PRODUCTION_AUTH_TEST_DIR = "./e2e-production-auth";
export const PRODUCTION_AUTH_OUTPUT_DIR = "test-results-production-auth";
export const PRODUCTION_AUTH_COMMAND = `pnpm exec next build && pnpm exec next start --hostname 127.0.0.1 --port ${PRODUCTION_AUTH_PORT}`; // [B24-E review, 2026-10-10] security-4: `next start` listens on 0.0.0.0 unless told

export interface ProductionAuthPlaywrightConfig {
  testDir: string;
  testMatch: RegExp;
  fullyParallel: false;
  workers: 1;
  retries: 0;
  timeout: number;
  expect: { timeout: number };
  reporter: Array<["list"]>;
  outputDir: string;
  use: { baseURL: string; trace: "off"; screenshot: "off"; video: "off"; storageState: { cookies: never[]; origins: never[] }; actionTimeout: number; navigationTimeout: number };
  projects: Array<{ name: string; use: { browserName: "chromium"; viewport: { width: number; height: number } } }>;
  webServer: { command: string; url: string; reuseExistingServer: false; timeout: number; stdout: "ignore"; stderr: "ignore"; env: Record<string, string> };
}

/**
 * The production-auth config for a ready answer: its own test folder, one worker, no retry, a server of its own (never reused), the
 * list reporter alone (no HTML or JUnit report is written), its own output folder, no trace, screenshot or video (each can capture
 * typed input), fresh storage, and a production-mode server on the fixed loopback port whose environment is set here in full.
 */
export function productionAuthPlaywrightConfig(answer: Extract<ProductionAuthTargetAnswer, { state: "ready" }>): ProductionAuthPlaywrightConfig {
  const secrets = ENVIRONMENT_NAMES.filter((row) => (row.class === "secret" || row.class === "rotation-previous") && row.name !== "DATABASE_URL").map((row) => row.name);
  const env: Record<string, string> = {
    // every secret and previous value the census names, blank: a developer's .env.local (the main project, OD-191) never reaches it
    ...Object.fromEntries(secrets.map((name) => [name, ""])),
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    SIRKIT_FIXTURE_AGENT: "",
    SIRKIT_FIXTURE_CLOCK: "",
    SIRKIT_FIXTURE_ROUTER: "",
    SIRKIT_FIXTURE_ROUTER_DUMP: "",
    SIRKIT_FIXTURE_ROUTER_FIXTURE: "",
    SIRKIT_FIXTURE_RUNTIME: "",
    SIRKIT_MCP_ENABLED: "",
    // [B24-E review, 2026-10-10] security-4: no client-chosen proxy header keys A3's public windows on this loopback server (OD-197)
    SIRKIT_TRUSTED_CLIENT_IP_HEADER: "",
    // the account's credentials and the qualification database URL stay with the spec: the server gets the database as DATABASE_URL
    SIRKIT_AUTH_QUALIFICATION_EMAIL: "",
    SIRKIT_AUTH_QUALIFICATION_PASSWORD: "",
    SIRKIT_AUTH_QUALIFICATION_DATABASE_URL: "",
    // production auth on the staging profile, CSRF against the loopback origin, the isolated project's database and Supabase pair
    NODE_ENV: "production",
    SIRKIT_AUTH_MODE: "production",
    SIRKIT_DEPLOYMENT_ENV: "staging",
    SIRKIT_EXPECTED_ORIGIN: PRODUCTION_AUTH_ORIGIN,
    DATABASE_URL: answer.server.databaseUrl,
    NEXT_PUBLIC_SUPABASE_URL: answer.server.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: answer.server.publishableKey,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  };
  return {
    testDir: PRODUCTION_AUTH_TEST_DIR,
    testMatch: /.*\.spec\.ts/,
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 120_000,
    expect: { timeout: 20_000 },
    reporter: [["list"]],
    outputDir: PRODUCTION_AUTH_OUTPUT_DIR,
    // [B24-E review, 2026-10-10] correctness-1, security-1: every action and navigation bounded, a backstop to the spec's own bounds
    use: { baseURL: PRODUCTION_AUTH_ORIGIN, trace: "off", screenshot: "off", video: "off", storageState: { cookies: [], origins: [] }, actionTimeout: 15_000, navigationTimeout: 30_000 },
    projects: [{ name: "chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 720 } } }],
    webServer: { command: PRODUCTION_AUTH_COMMAND, url: `${PRODUCTION_AUTH_ORIGIN}/api/health`, reuseExistingServer: false, timeout: 600_000, stdout: "ignore", stderr: "ignore", env },
  };
}

// ── [B24-E review, 2026-10-10] declared at the end, so the lines cited above keep their numbers ─────────────────────────────────────

/** correctness-1, security-1: what a ready config sets in its own process - the runner's, and each worker's, since a worker loads the
 *  config too. Playwright 1.63's `_takePageSnapshot` returns at once under PLAYWRIGHT_NO_COPY_PROMPT (`playwright/lib/index.js`), so a
 *  failing or timed-out test writes no ARIA snapshot - which carries every textbox's value - into its error-context.md. */
export const PRODUCTION_AUTH_RUNNER_ENV: Readonly<Record<string, string>> = Object.freeze({ PLAYWRIGHT_NO_COPY_PROMPT: "1" });

/** security-3: postgres.js 3.4.9 (`parseUrl`) reads its host after the FIRST "@" of the part before the first "/" or "?", percent-decoded,
 *  and takes a comma there as a host list it tries in order; the WHATWG parser the rules above use ends the authority at a "#" too and
 *  reads the host after the LAST "@". So a second "@" there, or a comma in postgres.js's host (one after a "#" never reaches the WHATWG
 *  host), is refused, and both parsers name the one host `isTargetDatabaseUrl` checks. */
function oneHostForBothParsers(value: string): boolean {
  const authority = value.slice(value.indexOf("://") + 3).split(/[?/]/)[0] ?? "";
  if (authority.split("@").length > 2) return false;
  try {
    return !decodeURIComponent(authority.slice(authority.indexOf("@") + 1)).includes(",");
  } catch {
    return false;
  }
}
