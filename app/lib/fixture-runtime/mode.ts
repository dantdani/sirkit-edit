/**
 * [B16-C §5] FIXTURE RUNTIME mode — the ONE switch that lets a running
 * Next.js dev server serve the deterministic prompt-to-Gerber path with no
 * database, no provider credits and no live router, so a REAL browser
 * (Playwright) can prove the page-level flow:
 *
 *  - durable workflow repository, physical-binding repository → in-memory
 *    (one container per process, anchored on globalThis so every route bundle
 *    shares it);
 *  - parts catalog / atomic published snapshots → the committed blinker
 *    catalog (app/lib/fixture-runtime/blinker);
 *  - LLM planner / build loop → the recorded blinker design (zero credits);
 *  - autonomous router → replay of a committed FreeRouting recording (or
 *    record / live, explicitly, on a machine with the bundled runtime);
 *  - identity → the local-development principal with a dev-only ROLE cookie
 *    so the browser can act as editor, reviewer or administrator.
 *
 * Truth boundary: the mode is honoured ONLY in a non-production runtime whose
 * auth mode is local_dev (`localDevAllowed`). In a production runtime the
 * request is ignored AND reported (`fixtureRuntimeRefusal`), never silently
 * honoured — fixture identity or fixture data can never reach production.
 * The page banner names the mode when it is on.
 */

import { localDevAllowed, resolveAuthMode } from "../auth/mode";

export const FIXTURE_RUNTIME_ENV = "SIRKIT_FIXTURE_RUNTIME";
export const FIXTURE_RUNTIME_PROFILE = "blinker" as const;
/** Dev-only role selection for the local principal (fixture runtime only). */
export const FIXTURE_ROLE_COOKIE = "sirkit-fixture-role";
export const FIXTURE_ROLES = ["viewer", "commenter", "editor", "reviewer", "admin"] as const;
export type FixtureRole = (typeof FIXTURE_ROLES)[number];

export function fixtureRuntimeRequested(environment: Record<string, string | undefined> = process.env): boolean {
  return environment[FIXTURE_RUNTIME_ENV]?.trim() === FIXTURE_RUNTIME_PROFILE;
}

/** True only when requested AND the runtime may run local-development identity. */
export function fixtureRuntimeEnabled(environment: Record<string, string | undefined> = process.env): boolean {
  return fixtureRuntimeRequested(environment) && localDevAllowed(environment);
}

/** A bounded, non-secret explanation when the mode was requested but cannot be honoured. */
export function fixtureRuntimeRefusal(environment: Record<string, string | undefined> = process.env): string | null {
  if (!fixtureRuntimeRequested(environment)) return null;
  if (fixtureRuntimeEnabled(environment)) return null;
  return `FIXTURE_RUNTIME_REFUSED: ${FIXTURE_RUNTIME_ENV}=${FIXTURE_RUNTIME_PROFILE} is honoured only in a non-production runtime with auth mode local_dev (runtime NODE_ENV=${environment.NODE_ENV ?? "unset"}, auth mode ${resolveAuthMode(environment)}).`;
}

export function isFixtureRole(value: unknown): value is FixtureRole {
  return typeof value === "string" && (FIXTURE_ROLES as readonly string[]).includes(value);
}

/** Parse the dev-only role cookie from a Cookie header; null when absent/invalid. */
export function fixtureRoleFromCookieHeader(cookieHeader: string | null | undefined): FixtureRole | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== FIXTURE_ROLE_COOKIE) continue;
    const value = decodeURIComponent(rest.join("=").trim());
    return isFixtureRole(value) ? value : null;
  }
  return null;
}

/** The fixture principal id for a role — a DISTINCT user per role so RLS-style "own row" semantics stay meaningful. */
export function fixturePrincipalId(role: FixtureRole): string {
  return `local-dev-principal:${role}`;
}

export function fixtureRoleOfPrincipal(userId: string): FixtureRole | null {
  const match = /^local-dev-principal:(viewer|commenter|editor|reviewer|admin)$/.exec(userId);
  return match ? (match[1] as FixtureRole) : null;
}
