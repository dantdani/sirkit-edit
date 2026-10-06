/**
 * [B24-A1] D24-1 (offline), OD-190 - the deployment profile, over `mode.ts` (unchanged).
 *
 * `mode.ts` knows two runtime states: a production runtime (`NODE_ENV=production`) and everything else. A deployment now also
 * DECLARES what it is, in `SIRKIT_DEPLOYMENT_ENV`: development, ci, staging or production, exactly (no trim, no case folding);
 * anything else is `invalid` and an absent variable `unset`, and the value is never echoed. In a production runtime only staging
 * and production serve sensitive routes. In a non-production runtime the profile never blocks: local_dev stays as it is.
 *
 * `productionServingBlocker` is the one sensitive-route blocker, checking in this order: (a) `sensitiveOperationsBlocker` (its text
 * unchanged) -> AUTH_PRODUCTION_NOT_CONFIGURED; (b) in a production runtime, a profile that does not serve -> the same code, the
 * message naming only the variable; (c) in a production runtime, a missing or malformed `SIRKIT_EXPECTED_ORIGIN` ->
 * AUTH_ORIGIN_NOT_CONFIGURED or AUTH_ORIGIN_CONFIG_MALFORMED, by expected-origin.ts's own rules with production forced (the request
 * URL is never consulted). Its only callers are the trusted request context and the MCP wrapper; the worker and public paths never
 * call it, by design (authorize.ts). A pure function over an injected environment, like `mode.ts`.
 */
import { SIRKIT_EXPECTED_ORIGIN_ENV, resolveExpectedOrigin } from "./expected-origin";
import { isProductionRuntime, sensitiveOperationsBlocker } from "./mode";

type Environment = Readonly<Record<string, string | undefined>>;

export const DEPLOYMENT_PROFILE_ENV = "SIRKIT_DEPLOYMENT_ENV";

/** The closed vocabulary, matched exactly. */
export const DEPLOYMENT_PROFILES = Object.freeze(["development", "ci", "staging", "production"] as const);
export type DeploymentProfileName = (typeof DEPLOYMENT_PROFILES)[number];
/** The profiles that serve sensitive routes in a production runtime. */
export const SERVING_DEPLOYMENT_PROFILES: readonly DeploymentProfileName[] = Object.freeze(["staging", "production"] as const);

export interface DeploymentProfile {
  readonly runtime: "production" | "non-production";
  /** the declared profile, `unset` when the variable is absent, `invalid` for any other value (never echoed) */
  readonly declared: DeploymentProfileName | "unset" | "invalid";
  /** a production runtime serves sensitive routes only under staging or production; a non-production runtime is never blocked */
  readonly servesSensitiveRoutes: boolean;
}

export function resolveDeploymentProfile(environment: Environment = process.env): DeploymentProfile {
  const raw = environment[DEPLOYMENT_PROFILE_ENV];
  const declared: DeploymentProfile["declared"] = raw === undefined ? "unset" : (DEPLOYMENT_PROFILES as readonly string[]).includes(raw) ? (raw as DeploymentProfileName) : "invalid";
  const production = isProductionRuntime(environment);
  const serves = !production || (SERVING_DEPLOYMENT_PROFILES as readonly string[]).includes(declared);
  return Object.freeze({ runtime: production ? "production" : "non-production", declared, servesSensitiveRoutes: serves });
}

/** The state of the configured expected origin under the PRODUCTION rules of `resolveExpectedOrigin` (expected-origin.ts:88-100):
 *  the auth mode is forced to production, so the request URL is never consulted; the value is never echoed. */
export type ProductionExpectedOrigin =
  | { readonly state: "configured" }
  | { readonly state: "not_configured"; readonly code: "AUTH_ORIGIN_NOT_CONFIGURED" }
  | { readonly state: "malformed"; readonly code: "AUTH_ORIGIN_CONFIG_MALFORMED" };

export function productionExpectedOrigin(environment: Environment = process.env): ProductionExpectedOrigin {
  // the placeholder request is never read: under a production auth mode the owner resolves the configured value alone
  const resolved = resolveExpectedOrigin(new Request("http://expected-origin.invalid/"), { ...environment, SIRKIT_AUTH_MODE: "production" });
  if (resolved.ok) return Object.freeze({ state: "configured" });
  if (resolved.code === "AUTH_ORIGIN_CONFIG_MALFORMED") return Object.freeze({ state: "malformed", code: "AUTH_ORIGIN_CONFIG_MALFORMED" });
  return Object.freeze({ state: "not_configured", code: "AUTH_ORIGIN_NOT_CONFIGURED" });
}

export const PRODUCTION_SERVING_BLOCKER_CODES = Object.freeze(["AUTH_PRODUCTION_NOT_CONFIGURED", "AUTH_ORIGIN_NOT_CONFIGURED", "AUTH_ORIGIN_CONFIG_MALFORMED"] as const);
export interface ProductionServingBlocker {
  readonly code: (typeof PRODUCTION_SERVING_BLOCKER_CODES)[number];
  readonly message: string;
}

/** The sensitive-route blocker: null when the deployment may serve sensitive routes, else a closed code and a fixed message. */
export function productionServingBlocker(environment: Environment = process.env): ProductionServingBlocker | null {
  const authentication = sensitiveOperationsBlocker(environment);
  if (authentication) return Object.freeze({ code: "AUTH_PRODUCTION_NOT_CONFIGURED", message: authentication });
  if (!isProductionRuntime(environment)) return null;
  if (!resolveDeploymentProfile(environment).servesSensitiveRoutes) {
    return Object.freeze({ code: "AUTH_PRODUCTION_NOT_CONFIGURED", message: `${DEPLOYMENT_PROFILE_ENV} does not declare staging or production; a production runtime refuses sensitive operations until the deployment declares a serving profile.` });
  }
  const origin = productionExpectedOrigin(environment);
  if (origin.state === "not_configured") {
    return Object.freeze({ code: origin.code, message: `${SIRKIT_EXPECTED_ORIGIN_ENV} is not configured; a production runtime refuses sensitive operations until the deployment declares its public origin.` });
  }
  if (origin.state === "malformed") {
    return Object.freeze({ code: origin.code, message: `${SIRKIT_EXPECTED_ORIGIN_ENV} is not one valid https origin (http only for a loopback host); sensitive operations are refused.` });
  }
  return null;
}
