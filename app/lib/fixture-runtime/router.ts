/**
 * [B16-C §5] The fixture runtime's autonomous-router seam.
 *
 *   SIRKIT_FIXTURE_ROUTER = replay (default) | record | live
 *   SIRKIT_FIXTURE_ROUTER_FIXTURE = path of the recording (default e2e/fixtures/blinker-route-fixture.json)
 *
 *  - replay: the committed recording keyed by placed-board revision; an
 *    unknown board is refused (ROUTE_FIXTURE_MISS), never synthesized;
 *  - record: the REAL bundled FreeRouting runs and every execution is written
 *    to the fixture (a machine with vendor/freerouting; never CI);
 *  - live: the real runtime, nothing recorded.
 * All three are only reachable when the fixture runtime is enabled.
 */

import { join } from "node:path";
import { emptyRouteFixture, loadRouteFixture, recordingRouteExecutor, replayRouteExecutor, saveRouteFixture, type RecordedRouteFixture } from "../pcb/autonomous/router-fixture";
import type { AutonomousRouteExecutor } from "../pcb/autonomous/qualify-layout";
import { fixtureContainer } from "./container";
import { fixtureRuntimeEnabled } from "./mode";
import { mkdirSync, writeFileSync } from "node:fs";
import { pcbRevisionId, pcbRevisionPayload } from "../pcb/revision";

export const FIXTURE_ROUTER_ENV = "SIRKIT_FIXTURE_ROUTER";
export const FIXTURE_ROUTER_FIXTURE_ENV = "SIRKIT_FIXTURE_ROUTER_FIXTURE";
/** Diagnostics only: a directory that receives the canonical revision payload of EVERY board handed to
 *  the router (`<placed-board revision>.json`), so two runs can be diffed when a replay misses. */
export const FIXTURE_ROUTER_DUMP_ENV = "SIRKIT_FIXTURE_ROUTER_DUMP";

function dumpRouterInput(board: Parameters<typeof pcbRevisionId>[0]): void {
  const dir = process.env[FIXTURE_ROUTER_DUMP_ENV]?.trim();
  if (!dir) return;
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${pcbRevisionId(board)}.json`), JSON.stringify(pcbRevisionPayload(board), null, 2));
  } catch { /* diagnostics never fail the run */ }
}
export type FixtureRouterMode = "replay" | "record" | "live";

export function fixtureRouterMode(environment: Record<string, string | undefined> = process.env): FixtureRouterMode {
  const value = environment[FIXTURE_ROUTER_ENV]?.trim();
  return value === "record" || value === "live" ? value : "replay";
}

export function fixtureRouterPath(environment: Record<string, string | undefined> = process.env): string {
  return environment[FIXTURE_ROUTER_FIXTURE_ENV]?.trim() || join(process.cwd(), "e2e", "fixtures", "blinker-route-fixture.json");
}

/** Wrap (or replace) the production executor factory according to the fixture router mode. */
export async function fixtureRouteExecutor(createReal: () => Promise<AutonomousRouteExecutor>): Promise<AutonomousRouteExecutor> {
  if (!fixtureRuntimeEnabled()) throw new Error("FIXTURE_RUNTIME_DISABLED");
  const container = fixtureContainer();
  const mode = fixtureRouterMode();
  const path = fixtureRouterPath();
  if (mode === "live") {
    const live = await createReal();
    return async (input) => { dumpRouterInput(input.board); container.routerExecutions.push("live"); return live(input); };
  }
  if (mode === "record") {
    const sink: RecordedRouteFixture = loadRouteFixture(path) ?? emptyRouteFixture(new Date().toISOString());
    const recording = recordingRouteExecutor(await createReal(), sink);
    return async (input) => {
      dumpRouterInput(input.board);
      const result = await recording(input);
      container.routerExecutions.push(result.sourceRevision);
      saveRouteFixture(path, sink); // persist after every execution so an interrupted run keeps what it recorded
      return result;
    };
  }
  const fixture = loadRouteFixture(path);
  if (!fixture) throw new Error(`ROUTE_FIXTURE_MISSING:${path}`);
  const replay = replayRouteExecutor(fixture, container.routerExecutions, `${FIXTURE_ROUTER_ENV}=record`);
  return async (input) => { dumpRouterInput(input.board); return replay(input); };
}
