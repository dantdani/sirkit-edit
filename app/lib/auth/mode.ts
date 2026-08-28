/**
 * B16.0.1 §G — the authentication mode resolver, HARDENED.
 *
 * R7 (B16.0 gap): production could enter local-development admin mode when
 * `NODE_ENV=production` + `SIRKIT_AUTH_MODE=local_dev` + a missing/loopback
 * deployment host. That is closed here: a production runtime ALWAYS resolves
 * to production authentication — `SIRKIT_AUTH_MODE` can never override it, and
 * a missing host never implies loopback. Local-development identity is
 * available ONLY in a non-production runtime, and preferably behind the
 * explicit `SIRKIT_AUTH_MODE=local_dev` opt-in.
 *
 * A pure function over an injectable `environment` (mirrors the established
 * `pcbSyncFeatureState(env = process.env)` idiom) so tests never mutate
 * global `process.env`.
 */

export type AuthMode = "production" | "local_dev";

export const SIRKIT_AUTH_MODE_ENV = "SIRKIT_AUTH_MODE";

/** True when the process is running as a production deployment. */
export function isProductionRuntime(environment: Record<string, string | undefined> = process.env): boolean {
  return environment.NODE_ENV === "production";
}

/**
 * Resolve the effective auth mode. Fail-safe rules (R7 closure):
 *
 * - `NODE_ENV=production` ⇒ production, ALWAYS. `SIRKIT_AUTH_MODE` and host
 *   headers cannot override it. Local-development identity is impossible in a
 *   production runtime.
 * - Non-production, `SIRKIT_AUTH_MODE=production` ⇒ production.
 * - Non-production, `SIRKIT_AUTH_MODE=local_dev` (or unset) ⇒ local_dev —
 *   truthful, because it is not a production deployment.
 */
export function resolveAuthMode(environment: Record<string, string | undefined> = process.env): AuthMode {
  if (isProductionRuntime(environment)) return "production";
  const declared = environment[SIRKIT_AUTH_MODE_ENV]?.trim().toLowerCase();
  if (declared === "production") return "production";
  return "local_dev";
}

/**
 * [B16.0.24.1 §2] the LEAST-PRIVILEGE auth-runtime projection — the ONLY
 * environment surface an auth-boundary route callback may receive. It carries
 * exactly the three values sign-out (and any future auth adapter) genuinely
 * requires: the resolved auth mode, the Supabase URL, and the selected
 * publishable/anonymous key. The projection is a FROZEN object of copied
 * string values — it holds no reference to the source environment, exposes no
 * unrelated entries, and never mutates the source. An unrelated environment
 * value (a secret, a token, an API key) is structurally unreachable through
 * it.
 */
export interface AuthRuntimeProjection {
  readonly mode: AuthMode;
  readonly supabaseUrl: string | null;
  readonly supabaseKey: string | null;
}

export function projectAuthRuntime(environment: Record<string, string | undefined> = process.env): AuthRuntimeProjection {
  const supabaseUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // The EXACT historical key selection (`??` fallback: an explicitly-empty
  // publishable key does NOT fall through to the anon key) — then normalized
  // to null so the projection carries values, never empty-string ambiguity.
  const supabaseKey = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return Object.freeze({
    mode: resolveAuthMode(environment),
    supabaseUrl: supabaseUrl || null,
    supabaseKey: supabaseKey || null,
  });
}

/**
 * Whether local-development identity is PERMITTED. It is permitted ONLY
 * outside a production runtime. A production runtime never permits it — there
 * is no host-based escape hatch (host headers are not trusted configuration).
 */
export function localDevAllowed(environment: Record<string, string | undefined> = process.env): boolean {
  return !isProductionRuntime(environment) && resolveAuthMode(environment) === "local_dev";
}

/**
 * Guard for sensitive operations: production must have real authentication
 * configured (a Supabase project). Returns null when OK, or a bounded blocker
 * string when a sensitive operation must fail closed.
 */
export function sensitiveOperationsBlocker(environment: Record<string, string | undefined> = process.env): string | null {
  if (resolveAuthMode(environment) !== "production") return null;
  const url = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    return "Production authentication is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required); sensitive operations are refused.";
  }
  return null;
}
