/**
 * Recorded-router fixtures: record the REAL production executor's outcome per
 * placed-board revision, and replay it later (never synthesizing copper).
 *
 * [B16-C] moved out of the test tree from
 * app/lib/workflow/prompt-to-gerber/__tests__/fixtures/route-fixture.ts (which
 * re-exports this module) so the env-gated fixture runtime can replay the same
 * recordings for a running dev server. The truth boundary is unchanged:
 *  - a fixture is written ONLY by `recordingRouteExecutor`, which wraps the
 *    real production executor;
 *  - replay refuses any board it has no recording for (`ROUTE_FIXTURE_MISS`);
 *  - the qualification path re-verifies a replayed candidate exactly as a
 *    live one, so a tampered recording cannot qualify.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { compareCodePoints } from "../../stable-compare";
import type { AutorouteCompletionResult } from "../autoroute/completion";
import { pcbRevisionId } from "../revision";
import type { AutonomousRouteExecutor } from "./qualify-layout";

export const ROUTE_FIXTURE_SCHEMA = "sirkit.b16-1c.recorded-route-fixture.v1" as const;

export interface RecordedRouteFixture {
  schemaVersion: typeof ROUTE_FIXTURE_SCHEMA;
  recordedAt: string;
  router: { engine: string; versions: string[]; runtimes: string[] };
  order: string[];
  entries: Record<string, AutorouteCompletionResult>;
}

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
  writeFileSync(path, stable(fixture) + "\n", "utf8");
}

function stable(value: unknown): string {
  const normalize = (item: unknown): unknown => Array.isArray(item) ? item.map(normalize) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => compareCodePoints(a, b)).map(([k, v]) => [k, normalize(v)])) : item;
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
export function replayRouteExecutor(fixture: RecordedRouteFixture, observed?: string[], recordEnv = "SIRKIT_B16_1C_RECORD_ROUTES"): AutonomousRouteExecutor {
  return async ({ board, signal }) => {
    if (signal?.aborted) throw new Error("ROUTE_FIXTURE_CANCELLED");
    const key = pcbRevisionId(board);
    observed?.push(key);
    const entry = fixture.entries[key];
    if (!entry) throw new Error(`ROUTE_FIXTURE_MISS:${key} (recorded: ${Object.keys(fixture.entries).length}; re-record with ${recordEnv}=1)`);
    return { sourceRevision: key, completion: structuredClone(entry) };
  };
}
