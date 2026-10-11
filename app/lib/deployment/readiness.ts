/**
 * [B24-A1] D24-9, OD-198 - readiness: a closed, ordered list of checks, each a name and a state from a closed set, behind
 * `GET /api/ready` (the worker class, through a read-only row). Ready requires every check except the two key checks, which are
 * reported only. Every auth check is derived through its owner function, never re-implemented:
 *  - `deployment_profile` through `resolveDeploymentProfile`;
 *  - `supabase_auth_configuration` is `configured` exactly when `sensitiveOperationsBlocker` passes with the auth mode forced to
 *    production (so the anon-key fallback and a set-but-empty publishable key behave as mode.ts:89-91);
 *  - `expected_origin` through `resolveExpectedOrigin`'s rules with production forced (`productionExpectedOrigin`: the request URL is
 *    never consulted).
 * The database probe is an injected port: the default runs `select 1` through `getSqlClient()`, bounded at 2,000 ms; an unset
 * DATABASE_URL answers `not_configured` without connecting, a throw `unreachable`, a stall `timeout` within the bound. No value of
 * any kind is reported: names and states only, and the deployment configuration's digest. The route binds no SDK client.
 */
import { ROLE_MODELS_ENV, parseRoleModelOverrides } from "@/app/lib/agent/orchestration/provider-policy";
import { productionExpectedOrigin, resolveDeploymentProfile } from "@/app/lib/auth/deployment-profile";
import { resolveAuthMode, sensitiveOperationsBlocker } from "@/app/lib/auth/mode";
import { getSqlClient } from "@/app/lib/db/client";
import { anthropicModelSetting } from "@/app/lib/llm/anthropic-config";
import { buildDeploymentConfiguration, deploymentConfiguration } from "./configuration";

type Environment = Readonly<Record<string, string | undefined>>;

export const READINESS_CHECK_NAMES = Object.freeze([
  "deployment_profile", "auth_mode", "supabase_auth_configuration", "expected_origin", "database", "openai_api_key", "anthropic_api_key", "anthropic_model_setting", "role_table",
] as const);
export type ReadinessCheckName = (typeof READINESS_CHECK_NAMES)[number];
/** Reported, never required: a deployment may serve with either provider's key absent. */
export const READINESS_REPORTED_ONLY: readonly ReadinessCheckName[] = Object.freeze(["openai_api_key", "anthropic_api_key"] as const);

/** Each check's closed states, in the order of `READINESS_CHECK_NAMES`. */
export const READINESS_STATES = Object.freeze({
  deployment_profile: Object.freeze(["serving", "not_serving", "unset", "invalid"] as const),
  auth_mode: Object.freeze(["production", "local_dev"] as const),
  supabase_auth_configuration: Object.freeze(["configured", "not_configured"] as const),
  expected_origin: Object.freeze(["configured", "not_configured", "malformed"] as const),
  database: Object.freeze(["reachable", "not_configured", "unreachable", "timeout"] as const),
  openai_api_key: Object.freeze(["present", "absent"] as const),
  anthropic_api_key: Object.freeze(["present", "absent"] as const),
  anthropic_model_setting: Object.freeze(["default", "configured", "empty", "padded"] as const),
  role_table: Object.freeze(["default", "overridden", "invalid"] as const),
});
/** The states that pass, for every required check. */
export const READINESS_PASSING = Object.freeze({
  deployment_profile: Object.freeze(["serving"] as const),
  auth_mode: Object.freeze(["production"] as const),
  supabase_auth_configuration: Object.freeze(["configured"] as const),
  expected_origin: Object.freeze(["configured"] as const),
  database: Object.freeze(["reachable"] as const),
  anthropic_model_setting: Object.freeze(["default", "configured"] as const),
  role_table: Object.freeze(["default", "overridden"] as const),
});

export interface ReadinessCheck {
  readonly name: ReadinessCheckName;
  readonly state: string;
}
export interface ReadinessReport {
  readonly ready: boolean;
  readonly checks: readonly ReadinessCheck[];
  readonly configurationDigest: string;
}

// ── the database probe ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const DATABASE_PROBE_BOUND_MS = 2_000;
export type DatabaseProbeState = (typeof READINESS_STATES.database)[number];
/** Resolves when the database answered, rejects when it did not; the signal is aborted when the bound expires. */
export type DatabaseProbePort = (signal: AbortSignal) => Promise<unknown>;

/** The default port: `select 1` through the server's one connection (db/client.ts:20), cancelled when the bound expires. */
const DEFAULT_DATABASE_PROBE: DatabaseProbePort = async (signal) => {
  const query = getSqlClient()`select 1`;
  signal.addEventListener("abort", () => { void query.cancel(); }, { once: true });
  await query;
};
let databaseProbePort: DatabaseProbePort = DEFAULT_DATABASE_PROBE;

/** Tests only: replace the default port (null restores it). No test ever reaches a real database through readiness. */
export function setDatabaseProbePortForTests(port: DatabaseProbePort | null): void {
  databaseProbePort = port ?? DEFAULT_DATABASE_PROBE;
}

/** The bounded probe: never throws, never reports a value. */
export async function probeDatabase(environment: Environment = process.env, port: DatabaseProbePort = databaseProbePort, boundMs: number = DATABASE_PROBE_BOUND_MS): Promise<DatabaseProbeState> {
  const url = environment.DATABASE_URL;
  if (typeof url !== "string" || url.trim() === "") return "not_configured";
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, boundMs);
  });
  let answered: Promise<"reachable" | "unreachable">;
  try {
    answered = Promise.resolve(port(controller.signal)).then(() => "reachable" as const, () => "unreachable" as const);
  } catch {
    answered = Promise.resolve("unreachable" as const);
  }
  try {
    return await Promise.race([answered, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ── the report ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const presence = (value: string | undefined): "present" | "absent" => (typeof value === "string" && value.trim() !== "" ? "present" : "absent");

function profileState(environment: Environment): (typeof READINESS_STATES.deployment_profile)[number] {
  const profile = resolveDeploymentProfile(environment);
  if (profile.servesSensitiveRoutes) return "serving";
  return profile.declared === "unset" || profile.declared === "invalid" ? profile.declared : "not_serving";
}

function modelSettingState(environment: Environment): (typeof READINESS_STATES.anthropic_model_setting)[number] {
  const setting = anthropicModelSetting(environment);
  if (setting.ok) return setting.source;
  return setting.refusal === "SIRKIT_ANTHROPIC_MODEL_EMPTY" ? "empty" : "padded";
}

function roleTableState(environment: Environment): (typeof READINESS_STATES.role_table)[number] {
  const parsed = parseRoleModelOverrides(environment[ROLE_MODELS_ENV]);
  if (!parsed.ok) return "invalid";
  return Object.keys(parsed.overrides).length > 0 ? "overridden" : "default";
}

/** The checks for one environment; `environment` defaults to the process's, and the configuration digest is then the process's record. */
export async function readinessReport(options: { readonly environment?: Environment; readonly database?: DatabaseProbePort; readonly boundMs?: number } = {}): Promise<ReadinessReport> {
  const environment = options.environment ?? process.env;
  const states: Record<ReadinessCheckName, string> = {
    deployment_profile: profileState(environment),
    auth_mode: resolveAuthMode(environment),
    supabase_auth_configuration: sensitiveOperationsBlocker({ ...environment, SIRKIT_AUTH_MODE: "production" }) === null ? "configured" : "not_configured",
    expected_origin: productionExpectedOrigin(environment).state,
    database: await probeDatabase(environment, options.database ?? databaseProbePort, options.boundMs ?? DATABASE_PROBE_BOUND_MS),
    openai_api_key: presence(environment.OPENAI_API_KEY),
    anthropic_api_key: presence(environment.ANTHROPIC_API_KEY),
    anthropic_model_setting: modelSettingState(environment),
    role_table: roleTableState(environment),
  };
  const checks = READINESS_CHECK_NAMES.map((name) => Object.freeze({ name, state: states[name] }));
  const passing = READINESS_PASSING as Readonly<Partial<Record<ReadinessCheckName, readonly string[]>>>;
  const ready = checks.every((check) => READINESS_REPORTED_ONLY.includes(check.name) || (passing[check.name] ?? []).includes(check.state));
  const configurationDigest = options.environment === undefined ? deploymentConfiguration().digest : buildDeploymentConfiguration(environment).digest;
  return Object.freeze({ ready, checks: Object.freeze(checks), configurationDigest });
}
