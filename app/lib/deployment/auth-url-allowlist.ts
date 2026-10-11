/**
 * [B24-A2] D24-6, OD-196 - the Supabase auth URLs a deployment needs, recorded per environment.
 *
 * `supabaseAuthUrls(profile, configuredOrigin)` takes one of B24-A1's profile values (`SIRKIT_DEPLOYMENT_ENV`) and the deployment's one
 * configured origin (`SIRKIT_EXPECTED_ORIGIN`; one per deployment, expected-origin.ts:16-22) and returns the two values the Supabase
 * project must hold: the Site URL, which is that origin normalised (`normalizeOrigin`, expected-origin.ts:63-85), and the redirect
 * allowlist, exactly `<origin>/api/auth/callback` - the one callback (route-policy.ts:131; app/api/auth/callback/route.ts:35-63, which
 * limits `next` with `safeRedirectPath`). No wildcard: a `*` in the origin is a glob in Supabase's allowlist and is refused, and
 * there is no second host. Staging and production refuse an http origin on a non-loopback host (the production rule of
 * expected-origin.ts:96-98); development and ci take it; loopback http is accepted everywhere. A preview deployment declares its own
 * origin and gets its own pair: there is no multi-origin list (a stated choice, OD-196).
 *
 * Pure: it reads no environment and claims nothing beyond the two values - nothing here is verified against a Supabase project
 * (LB-1, LB-13).
 */
import { DEPLOYMENT_PROFILES, SERVING_DEPLOYMENT_PROFILES, type DeploymentProfileName } from "@/app/lib/auth/deployment-profile";
import { isLoopbackHostname, normalizeOrigin } from "@/app/lib/auth/expected-origin";

/** The one route a Supabase-initiated flow may land on (the PKCE code exchange). */
export const SUPABASE_AUTH_CALLBACK_PATH = "/api/auth/callback" as const;

export const SUPABASE_AUTH_URL_REFUSALS = Object.freeze(["AUTH_URL_PROFILE_INVALID", "AUTH_URL_ORIGIN_MALFORMED", "AUTH_URL_ORIGIN_NOT_HTTPS"] as const);
export type SupabaseAuthUrlRefusal = (typeof SUPABASE_AUTH_URL_REFUSALS)[number];

export type SupabaseAuthUrls =
  | { readonly ok: true; readonly siteUrl: string; readonly redirectAllowlist: readonly string[] }
  | { readonly ok: false; readonly code: SupabaseAuthUrlRefusal };

const refuse = (code: SupabaseAuthUrlRefusal): SupabaseAuthUrls => Object.freeze({ ok: false, code });

export function supabaseAuthUrls(profile: DeploymentProfileName, configuredOrigin: string): SupabaseAuthUrls {
  if (!(DEPLOYMENT_PROFILES as readonly string[]).includes(profile)) return refuse("AUTH_URL_PROFILE_INVALID");
  const origin = typeof configuredOrigin === "string" ? normalizeOrigin(configuredOrigin) : null;
  if (origin === null || origin.includes("*")) return refuse("AUTH_URL_ORIGIN_MALFORMED");
  const strict = (SERVING_DEPLOYMENT_PROFILES as readonly string[]).includes(profile);
  if (strict && origin.startsWith("http:") && !isLoopbackHostname(new URL(origin).hostname)) return refuse("AUTH_URL_ORIGIN_NOT_HTTPS");
  return Object.freeze({ ok: true, siteUrl: origin, redirectAllowlist: Object.freeze([`${origin}${SUPABASE_AUTH_CALLBACK_PATH}`]) });
}
