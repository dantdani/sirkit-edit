/**
 * B16.1C §H — the deterministic router seam for the CI acceptance path.
 *
 * The production qualification route routes with the bundled FreeRouting
 * runtime (`createAutonomousRouteExecutor`), a Java process that is neither
 * installed in CI nor deterministic in wall-clock. The deterministic CI path
 * therefore REPLAYS a recording of the real router: every `AutonomousRouteExecutor`
 * call is keyed by the exact placed-board revision it was asked to route
 * (`pcbRevisionId(board)`) and answered with the `AutorouteCompletionResult`
 * the real router produced for that board when the fixture was recorded.
 *
 * Truth boundary (recorded, not synthesized):
 *  - the fixture is written ONLY by `recordingRouteExecutor`, which wraps the
 *    REAL production executor locally (`SIRKIT_B16_1C_RECORD_ROUTES=1`);
 *  - replay refuses any board it has no recording for (`ROUTE_FIXTURE_MISS`)
 *    instead of inventing copper — an upstream change that alters placement,
 *    footprints, or rules fails loudly and the fixture must be re-recorded;
 *  - the qualification path re-verifies the replayed candidate exactly as it
 *    verifies a live one (`verifyAutorouteCandidate`, RC01 parity, capability
 *    re-evaluation, DRC), so a tampered recording cannot qualify.
 *
 * Bulky per-pass text (DSN/SES/stderr) is stripped from the recording; the
 * digests the qualification evidence binds (`dsnDigest`, `sesDigest`, router
 * version) are kept verbatim.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AutonomousRouteExecutor } from "@/app/lib/pcb/autonomous/qualify-layout";
import type { AutorouteCompletionResult } from "@/app/lib/pcb/autoroute/completion";
import { pcbRevisionId } from "@/app/lib/pcb/revision";

export const ROUTE_FIXTURE_SCHEMA = "sirkit.b16-1c.recorded-route-fixture.v1" as const;

export interface RecordedRouteFixture {
  schemaVersion: typeof ROUTE_FIXTURE_SCHEMA;
  recordedAt: string;
  /** Router identity as reported in the recorded evidence (engine/version/runtime). */
  router: { engine: string; versions: string[]; runtimes: string[] };
  /** Recording order (source revisions), for the evidence report. */
  order: string[];
  /** Keyed by `pcbRevisionId` of the placed board the router was asked to route. */
  entries: Record<string, AutorouteCompletionResult>;
}

/** Env switch: record with the real bundled router instead of replaying. */
export const RECORD_ROUTES_ENV = "SIRKIT_B16_1C_RECORD_ROUTES";
export function recordingRequested(): boolean { return process.env[RECORD_ROUTES_ENV] === "1"; }

export function emptyRouteFixture(recordedAt: string): RecordedRouteFixture {
  return { schemaVersion: ROUTE_FIXTURE_SCHEMA, recordedAt, router: { engine: "", versions: [], runtimes: [] }, order: [], entries: {} };
}

export function loadRouteFixture(path: string): RecordedRouteFixture | null {
  if (!existsSync(path)) return null;
  const parsed = JSON.parse(readFileSync(path, "utf8")) as RecordedRouteFixture;
  if (parsed.schemaVersion !== ROUTE_FIXTURE_SCHEMA) throw new Error(`ROUTE_FIXTURE_SCHEMA_MISMATCH:${String(parsed.schemaVersion)}`);
  return parsed;
}

export function saveRouteFixture(path: string, fixture: RecordedRouteFixture): void {
  mkdirSync(dirname(path), { recursive: true });
  // Sorted keys + fixed indentation so re-recording an unchanged run is byte-stable.
  writeFileSync(path, stable(fixture) + "\n", "utf8");
}

function stable(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalize(v)])) : item;
  return JSON.stringify(normalize(value), null, 1);
}

/** Strip bulky per-pass text while keeping every digest the evidence binds. */
export function pruneCompletion(completion: AutorouteCompletionResult): AutorouteCompletionResult {
  const clone = structuredClone(completion) as AutorouteCompletionResult & Record<string, unknown>;
  delete clone.lastSesText; delete clone.lastDsnText; delete clone.lastStderr; delete clone.lastParsed; delete clone.lastValidation;
  delete clone.lastAttempt; delete clone.bestAcceptedAttempt;
  clone.attempts = clone.attempts.map((attempt) => {
    const pruned = { ...attempt } as typeof attempt & Record<string, unknown>;
    delete pruned.dsnText; delete pruned.sesText; delete pruned.stderr; delete pruned.parsed; delete pruned.validation;
    return pruned;
  });
  return clone;
}

/** Wrap the REAL executor: every call is recorded under its exact source revision. */
export function recordingRouteExecutor(real: AutonomousRouteExecutor, sink: RecordedRouteFixture): AutonomousRouteExecutor {
  return async (input) => {
    const key = pcbRevisionId(input.board);
    const result = await real(input);
    if (result.sourceRevision !== key) throw new Error(`ROUTE_FIXTURE_RECORDING_SOURCE_MISMATCH:${result.sourceRevision}!=${key}`);
    const completion = pruneCompletion(result.completion);
    sink.entries[key] = completion;
    sink.order.push(key);
    for (const attempt of completion.attempts) {
      const router = attempt.evidence.router;
      if (!router) continue;
      sink.router.engine ||= router.engine;
      if (!sink.router.versions.includes(router.version)) sink.router.versions.push(router.version);
      if (!sink.router.runtimes.includes(router.runtime)) sink.router.runtimes.push(router.runtime);
    }
    return result;
  };
}

/** Answer only boards that were actually recorded; never synthesize copper. */
export function replayRouteExecutor(fixture: RecordedRouteFixture, observed?: string[]): AutonomousRouteExecutor {
  return async ({ board, signal }) => {
    if (signal?.aborted) throw new Error("ROUTE_FIXTURE_CANCELLED");
    const key = pcbRevisionId(board);
    observed?.push(key);
    const entry = fixture.entries[key];
    if (!entry) throw new Error(`ROUTE_FIXTURE_MISS:${key} (recorded: ${Object.keys(fixture.entries).length}; re-record with ${RECORD_ROUTES_ENV}=1)`);
    return { sourceRevision: key, completion: structuredClone(entry) };
  };
}
