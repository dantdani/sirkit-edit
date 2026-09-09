/**
 * B16.1C §H — the deterministic router seam for the CI acceptance path.
 *
 * [B16-C] The recording/replay core moved to app/lib/pcb/autonomous/router-fixture.ts
 * (shared with the env-gated fixture runtime that backs the page-level browser
 * proof); this module re-exports it and keeps the suite's env switches:
 *
 *  - `SIRKIT_B16_1C_RECORD_ROUTES=1` records with the REAL bundled router;
 *  - `SIRKIT_B16_1C_LIVE_ROUTER=1` runs the real executor unrecorded and
 *    unpinned (exercises the TypeScript routing-integration code — F21).
 */

export { emptyRouteFixture, loadRouteFixture, pruneCompletion, recordingRouteExecutor, replayRouteExecutor, saveRouteFixture, ROUTE_FIXTURE_SCHEMA, type RecordedRouteFixture } from "@/app/lib/pcb/autonomous/router-fixture";

/** Env switch: record with the real bundled router instead of replaying. */
export const RECORD_ROUTES_ENV = "SIRKIT_B16_1C_RECORD_ROUTES";
export function recordingRequested(): boolean { return process.env[RECORD_ROUTES_ENV] === "1"; }

/**
 * [B16-A F21] Env switch: run the REAL production executor without recording
 * and without replaying. Under a live run the pinned release identities are
 * NOT asserted (a different router outcome is a legitimate, reported
 * possibility), every other gate is.
 */
export const LIVE_ROUTER_ENV = "SIRKIT_B16_1C_LIVE_ROUTER";
export function liveRouterRequested(): boolean { return process.env[LIVE_ROUTER_ENV] === "1" && !recordingRequested(); }
