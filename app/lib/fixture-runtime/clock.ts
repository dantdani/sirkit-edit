/**
 * [B16-C.5] The fixture runtime's FROZEN CLOCK.
 *
 * Every durable identity of the prompt-to-Gerber path is time-bearing
 * somewhere below the surface: a physical binding's record digest carries its
 * `createdAt`, the footprint resolver's decision digest carries the request's
 * `requestedAt` and the binding-set digests, the sync plan digest carries the
 * resolver evidence, the materialized footprint carries the plan id in its
 * `syncIdentity`, and the placed-board revision — the key of every recorded
 * FreeRouting run — carries the footprints. With a live clock no two runs of
 * the same journey ever produce the same board revision, so a committed router
 * recording could never replay (the browser proof missed on every run until
 * the two dumped boards differed ONLY in `syncPlanId`).
 *
 * The deterministic pipelines freeze time at `FIXED_NOW` (their harness); the
 * fixture runtime does the same for the real server: `Date.now()` and the
 * argument-less `new Date()` answer the fixed instant, everything else about
 * `Date` (parsing, arithmetic, explicit construction) is untouched, and timers
 * keep running. Installed ONLY when the fixture runtime is enabled (never in
 * production), idempotently, process-wide.
 */
import { fixtureRuntimeEnabled } from "./mode";

export const FIXTURE_CLOCK_ENV = "SIRKIT_FIXTURE_CLOCK";
/** The deterministic pipelines' `FIXED_NOW` (at or after the rule-profile evidence retrieval date). */
export const FIXTURE_CLOCK_DEFAULT = "2026-09-09T12:00:00.000Z";

const MARKER = "__sirkitFixtureClock__" as const;
type Host = typeof globalThis & { [MARKER]?: { fixedAt: string; original: DateConstructor } };

export function fixtureClockInstant(environment: Record<string, string | undefined> = process.env): string {
  const requested = environment[FIXTURE_CLOCK_ENV]?.trim();
  if (requested && Number.isFinite(Date.parse(requested))) return new Date(requested).toISOString();
  return FIXTURE_CLOCK_DEFAULT;
}

/** Install the frozen clock (no-op unless the fixture runtime is enabled; idempotent). Returns the instant in force or null. */
export function installFixtureClock(environment: Record<string, string | undefined> = process.env): string | null {
  if (!fixtureRuntimeEnabled(environment)) return null;
  const host = globalThis as Host;
  if (host[MARKER]) return host[MARKER].fixedAt;
  const original = host.Date;
  const fixedAt = fixtureClockInstant(environment);
  const fixedMs = original.parse(fixedAt);
  const FixedDate = function (this: unknown, ...args: unknown[]): Date | string {
    if (!new.target) return new original(fixedMs).toString(); // `Date()` called as a function returns a string
    return args.length === 0 ? new original(fixedMs) : new (original as unknown as new (...a: unknown[]) => Date)(...args);
  } as unknown as DateConstructor;
  Object.setPrototypeOf(FixedDate, original); // statics (parse, UTC, …) resolve to the original
  Object.defineProperty(FixedDate, "prototype", { value: original.prototype, writable: true }); // instances ARE Dates
  Object.defineProperty(FixedDate, "now", { value: () => fixedMs, configurable: true, writable: true });
  host.Date = FixedDate;
  host[MARKER] = { fixedAt, original };
  return fixedAt;
}

/** Remove the frozen clock (tests). */
export function uninstallFixtureClock(): void {
  const host = globalThis as Host;
  if (!host[MARKER]) return;
  host.Date = host[MARKER].original;
  delete host[MARKER];
}

export function fixtureClockInstalled(): string | null {
  return (globalThis as Host)[MARKER]?.fixedAt ?? null;
}
