/**
 * [B24-A3] The public placement preview's work bound (D24-8, OD-197; closes B20 F1 as a work bound). `POST /api/pcb/placement/preview`
 * stays public; in the route only (never the engine or the shared options builder, which the editor worker and the agent tool use) the
 * caller's options are clamped, never refused, and a board above the public bound is refused 413 PLACEMENT_PREVIEW_TOO_LARGE, naming
 * the bound, before the engine runs. The engine checks its budget only between candidates, so this is a route-side work bound, not a
 * preemptive stop: a running candidate still blocks the event loop until the next check (measured once, on the page; never a
 * wall-clock assertion here, D24-28).
 * [B24-A3 review, 2026-10-08] security-1, security-3, coverage-preview-block-not-closed: the task's ceilings and bounds admitted one
 * anonymous request that blocked the server for more than 900 s (200 footprints), 10.8 s at 30 footprints (one local-refinement pass
 * is up to 64 more candidate evaluations), and the five counted lists missed the cost drivers the review and the measurement found -
 * a polygon outline (64 vertices: 35 s), overlapping copper (500 tracks: 5 s before the first candidate; 20,000 crash the problem
 * build), one footprint's pad count and polygon pads (540 polygon pads in one footprint: 24 s) and the body's size. The reviewed
 * ceilings: `timeoutMs` at most 5,000 (absent means 5,000), `candidateCount` at most 2, `maxIterations` at most 400,
 * `localRefinementPasses` at most 0, `gridNm` at least 100,000; the reviewed bounds: a body of at most 1,000,000 bytes, 30 footprints,
 * 600 pads, 128 pads in one footprint, 2,400 polygon-pad vertices, 300 nets, 100 tracks and vias, 8 zones, 512 zone vertices
 * (outlines and fills), 512 keepout vertices, and no polygon outline (a rect or roundrect outline only). Case 5 pins the work: at most
 * two candidate evaluations per request, whatever the caller asks.
 *
 * Failing first on b3b6b05: the engine receives the caller's `localRefinementPasses: 3`, `gridNm: 10_000` and `timeoutMs: 60_000`
 * unclamped, and an oversized board reaches it (page section 10). [B24-A3 review, 2026-10-08] Failing first on the reviewed tree: the
 * engine received `candidateCount: 4` and `localRefinementPasses: 1`, more than two evaluations ran, and every board of case 6 reached
 * the engine (page section 21). The engine is the real one behind a counting pass-through (the b20-b4-stop-evidence pattern), and the
 * candidate evaluations are counted at the routeability analysis each one runs once; the boards above the bound are bare arrays the
 * engine never needs to read. The clock is faked (Date only) per case so each case meets a fresh preview window. Nothing is written
 * to disk.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineeringPlacementOptions } from "@/app/lib/pcb/placement/types";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import { makeBoard, makeDef, makeInstance, makePad } from "@/app/lib/pcb/__tests__/autoplace-fixture";
import { mmToNm } from "@/app/lib/pcb/units";

const probe = vi.hoisted(() => ({ engineCalls: [] as EngineeringPlacementOptions[], evaluations: 0, stubEngine: false }));
const engineCalls = probe.engineCalls;
vi.mock("@/app/lib/pcb/placement/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/pcb/placement/engine")>();
  return {
    ...actual,
    runEngineeringPlacement: (input: Parameters<typeof actual.runEngineeringPlacement>[0]) => {
      probe.engineCalls.push({ ...(input.options ?? {}) });
      if (probe.stubEngine) throw new Error("stubbed engine: a board of case 6 reached it");
      return actual.runEngineeringPlacement(input);
    },
  };
});
// [B24-A3 review, 2026-10-08] each candidate evaluation runs the routeability analysis exactly once (engine.ts evaluateCandidate)
vi.mock("@/app/lib/pcb/autoplace/routeability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/pcb/autoplace/routeability")>();
  return {
    ...actual,
    analyzePlacementRouteability: (...args: Parameters<typeof actual.analyzePlacementRouteability>) => {
      probe.evaluations += 1;
      return actual.analyzePlacementRouteability(...args);
    },
  };
});
// the route's cold import runs at collection (no timeout there), never inside a case's budget (b20-b4-stop-evidence's pattern)
const { POST: previewPost } = await import("@/app/api/pcb/placement/preview/route");

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${CR}${NEWLINE}`, NEWLINE);
const PREVIEW = "app/api/pcb/placement/preview/route.ts";
const BASE = Date.UTC(2026, 9, 6, 14, 0, 0);
const startCase = (index: number): void => { vi.setSystemTime(BASE + index * 600_000); };

/** The reviewed ceilings and bounds (OD-197 as A3 applies it, [B24-A3 review, 2026-10-08] measured; the page states the same). */
const CEILINGS = { timeoutMs: 5_000, candidateCount: 2, maxIterations: 400, localRefinementPasses: 0, gridNm: 100_000 } as const;
const BOUNDS = { bytes: 1_000_000, footprints: 30, pads: 600, padsPerFootprint: 128, padPolygonVertices: 2_400, nets: 300, tracksAndVias: 100, zones: 8, zoneVertices: 512, keepoutVertices: 512, polygonOutlineVertices: 0 } as const;

const post = (body: unknown): Promise<Response> =>
  previewPost(new Request("http://localhost/api/pcb/placement/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
/** An empty board with `count` bare entries in one list (the bound is counted before the engine reads anything; a net or a zone carries
 *  the fields the semantic revision reads, so a board at a bound reaches the engine). */
function boardWith(field: "footprints" | "nets" | "tracks" | "vias" | "zones", count: number): PcbBoard {
  const board = createEmptyBoard() as unknown as Record<string, unknown[]>;
  board[field] = Array.from({ length: count }, (_, index) => (field === "nets" ? { id: index, name: `N${index}`, stableId: `net:b24-a3-${index}`, endpointKeys: [] } : field === "zones" ? { id: `zone-${index}`, fill: [] } : { id: `${field}-${index}` }));
  return board as unknown as PcbBoard;
}
/** An empty board whose footprints carry `pads` pads in all (bare entries). */
function boardWithPads(footprints: number, padsEach: number): PcbBoard {
  const board = createEmptyBoard();
  board.footprints = Array.from({ length: footprints }, (_, index) => ({ id: `fp-${index}`, def: { pads: Array.from({ length: padsEach }, (__, pad) => ({ number: String(pad + 1) })) } })) as unknown as PcbBoard["footprints"];
  return board;
}
/** A rectangle as `vertices` points (at least 4). */
function rectangle(widthNm: number, heightNm: number, vertices: number): Array<{ x: number; y: number }> {
  const perSide = Math.max(1, Math.floor(vertices / 4));
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index < perSide; index += 1) points.push({ x: Math.round((widthNm * index) / perSide), y: 0 });
  for (let index = 0; index < perSide; index += 1) points.push({ x: widthNm, y: Math.round((heightNm * index) / perSide) });
  for (let index = 0; index < perSide; index += 1) points.push({ x: widthNm - Math.round((widthNm * index) / perSide), y: heightNm });
  for (let index = 0; index < perSide; index += 1) points.push({ x: 0, y: heightNm - Math.round((heightNm * index) / perSide) });
  return points;
}
/** [B24-A3 review, 2026-10-08] The measured worst admitted shape (page section 9): 30 footprints of 20 pads (600) stacked on one spot in
 *  a rect outline twice their courtyards' area, 300 nets, 50 tracks and 50 vias on top of one another, 8 zones of 32 outline and 32 fill
 *  vertices (512), 8 keepouts of 64 vertices (512) - every count at its bound except the per-footprint and polygon-pad ones. */
function worstAdmittedBoard(): PcbBoard {
  const pads = [];
  for (let index = 0; index < 10; index += 1) pads.push(makePad(String(index + 1), -5, -8 + index * 1.6), makePad(String(index + 11), 5, -8 + index * 1.6));
  const def = makeDef("B24_A3_IC20", 12, 18, pads);
  const nets = 299; // makeBoard adds net 0: 300 nets
  const footprints = Array.from({ length: 30 }, (_, footprint) => makeInstance(`fp-${String(footprint).padStart(3, "0")}`, def, { x: 20, y: 20 }, Object.fromEntries(Array.from({ length: 20 }, (__, pad) => [String(pad + 1), ((footprint * 20 + pad) % nets) + 1]))));
  const side = Math.sqrt(2 * 30 * 12 * 18);
  const board = makeBoard(side, side, footprints, nets);
  const W = mmToNm(side);
  board.tracks = Array.from({ length: 50 }, (_, index) => ({ id: `t-${index}`, layer: "copperTop" as const, width: mmToNm(0.2), start: { x: mmToNm(30 + (index % 50) * 0.01), y: mmToNm(30) }, end: { x: mmToNm(30 + (index % 50) * 0.01), y: mmToNm(40) }, netId: (index % nets) + 1 }));
  board.vias = Array.from({ length: 50 }, (_, index) => ({ id: `v-${index}`, at: { x: mmToNm(35), y: mmToNm(35 + (index % 50) * 0.01) }, size: mmToNm(0.6), drill: mmToNm(0.3), netId: (index % nets) + 1, layers: ["copperTop", "copperBottom"] as ["copperTop", "copperBottom"] }));
  board.zones = Array.from({ length: 8 }, (_, index) => ({ id: `z-${index}`, layer: index % 2 === 0 ? "copperTop" as const : "copperBottom" as const, netId: (index % nets) + 1, polygon: rectangle(W, W, 32), appearance: "solid" as const, connection: "thermal" as const, fill: [{ outer: rectangle(W, W, 32), holes: [], boundingBox: { minX: 0, minY: 0, maxX: W, maxY: W }, areaNm2: W * W }], dirty: false }));
  board.routingKeepouts = Array.from({ length: 8 }, (_, index) => ({ id: `k-${index}`, polygon: rectangle(W, W, 64), layers: ["copperTop", "copperBottom"] as ["copperTop", "copperBottom"], forbidTracks: true, forbidVias: true }));
  return board;
}
/** The options a caller asks above every ceiling (B20 F1's probe and more). */
const ABOVE_EVERY_CEILING = { candidateCount: 8, maxIterations: 2_000, localRefinementPasses: 3, gridNm: 10_000, timeoutMs: 120_000 } as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubEnv("SIRKIT_TRUSTED_CLIENT_IP_HEADER", undefined);
  engineCalls.length = 0;
  probe.evaluations = 0;
  probe.stubEngine = false;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  probe.stubEngine = false;
});

describe("[B24-A3] the placement preview's work bound (D24-8, OD-197; B20 F1)", () => {
  it("1. counterexample (red on b3b6b05): caller options above the ceilings are clamped, never refused - the engine receives localRefinementPasses 0, gridNm 100,000, timeoutMs 5,000, candidateCount 2 and maxIterations 400 for a caller's 3, 10,000, 60,000, 8 and 2,000 ([B24-A3 review, 2026-10-08] reviewed: passes 1 -> 0 and candidates 4 -> 2, measured)", { timeout: 30_000 }, async () => {
    startCase(1);
    const response = await post({ board: createEmptyBoard(), options: { localRefinementPasses: 3, gridNm: 10_000, timeoutMs: 60_000, candidateCount: 8, maxIterations: 2_000 } });
    expect([200, 422]).toContain(response.status);
    expect(engineCalls).toHaveLength(1);
    expect(engineCalls[0]).toMatchObject({ localRefinementPasses: 0, gridNm: 100_000, timeoutMs: 5_000, candidateCount: 2, maxIterations: 400 });
  });

  it("2. an absent timeoutMs means 5,000; values inside the ceilings pass unchanged; an absent option other than the timeout stays absent, except the candidate count and the refinement passes, which the engine would otherwise default above their ceilings (4 and 1)", { timeout: 30_000 }, async () => {
    startCase(2);
    await post({ board: createEmptyBoard(), options: { candidateCount: 2, localRefinementPasses: 0 } });
    await post({ board: createEmptyBoard(), options: { candidateCount: 2, maxIterations: 1, localRefinementPasses: 0, gridNm: 250_000, timeoutMs: 1 } });
    await post({ board: createEmptyBoard() });
    expect(engineCalls).toHaveLength(3);
    expect(engineCalls[0]).toMatchObject({ candidateCount: 2, localRefinementPasses: 0, timeoutMs: CEILINGS.timeoutMs });
    expect(engineCalls[0]).not.toHaveProperty("gridNm");
    expect(engineCalls[0]).not.toHaveProperty("maxIterations");
    expect(engineCalls[1]).toMatchObject({ candidateCount: 2, maxIterations: 1, localRefinementPasses: 0, gridNm: 250_000, timeoutMs: 1 });
    expect(engineCalls[2]).toMatchObject({ timeoutMs: CEILINGS.timeoutMs, candidateCount: CEILINGS.candidateCount, localRefinementPasses: CEILINGS.localRefinementPasses });
    expect(engineCalls[2]).not.toHaveProperty("gridNm");
    expect(engineCalls[2]).not.toHaveProperty("maxIterations");
    for (const call of engineCalls) {
      expect(call.timeoutMs!).toBeLessThanOrEqual(CEILINGS.timeoutMs);
      expect(call.candidateCount!).toBeLessThanOrEqual(CEILINGS.candidateCount);
      expect(call.localRefinementPasses!).toBeLessThanOrEqual(CEILINGS.localRefinementPasses);
    }
  });

  it("3. a board above each counted public bound is refused 413 PLACEMENT_PREVIEW_TOO_LARGE naming the bound, before the engine; a board at a bound reaches it", { timeout: 60_000 }, async () => {
    startCase(3);
    const over: ReadonlyArray<readonly [string, number, PcbBoard]> = [
      ["footprints", BOUNDS.footprints, boardWith("footprints", BOUNDS.footprints + 1)],
      ["pads", BOUNDS.pads, boardWithPads(6, BOUNDS.pads / 6 + 1)],
      ["nets", BOUNDS.nets, boardWith("nets", BOUNDS.nets + 1)],
      ["tracksAndVias", BOUNDS.tracksAndVias, { ...boardWith("tracks", BOUNDS.tracksAndVias / 2), vias: Array.from({ length: BOUNDS.tracksAndVias / 2 + 1 }, (_, index) => ({ id: `via-${index}` })) } as unknown as PcbBoard],
      ["zones", BOUNDS.zones, boardWith("zones", BOUNDS.zones + 1)],
    ];
    for (const [bound, limit, board] of over) {
      const response = await post({ board, options: { candidateCount: 2 } });
      expect(response.status, bound).toBe(413);
      const body = await response.json() as Record<string, unknown>;
      expect(body, bound).toMatchObject({ ok: false, code: "PLACEMENT_PREVIEW_TOO_LARGE", bound, limit });
      expect(String(body.error), bound).toContain(String(limit));
    }
    expect(engineCalls).toEqual([]);
    for (const board of [boardWith("nets", BOUNDS.nets), boardWith("zones", BOUNDS.zones), boardWith("tracks", BOUNDS.tracksAndVias)]) {
      const response = await post({ board, options: { candidateCount: 2, localRefinementPasses: 0 } });
      expect(response.status).not.toBe(413);
    }
    expect(engineCalls).toHaveLength(3);
  });

  it("4. in place, in the route only: B20's stop-evidence anchors (the five forwarded keys, the 16 MB / 45 s wrapper, the one engine call) and the preview's policy row each stand exactly once; the engine's clamps and the shared options builder are unchanged", () => {
    const route = read(PREVIEW).split(NEWLINE);
    for (const anchor of ['["candidateCount", "maxIterations", "localRefinementPasses", "gridNm", "timeoutMs"]', "publicJsonRoute({ maxBytes: 16_000_000, deadlineMs: 45_000 }", "runPlacementCandidate({ board: input.board, request: request(input.options) })"]) {
      expect(route.filter((line) => line.includes(anchor)), anchor).toHaveLength(1);
    }
    const policy = read("app/lib/auth/route-policy.ts").split(NEWLINE);
    expect(policy.filter((line) => line === '  ...pub("/api/pcb/placement/preview", ["POST"], "stateless compute"),')).toHaveLength(1);
    const engine = read("app/lib/pcb/placement/engine.ts");
    for (const clamp of ["Math.max(50, Math.min(120_000, Math.round(options.timeoutMs ?? 15_000)))", "Math.max(10_000, Math.round(options.gridNm ?? 100_000))", "Math.max(2, Math.min(8, Math.round(options.candidateCount ?? 4)))", "Math.max(1, Math.min(2_000, Math.round(options.maxIterations ?? 400)))", "Math.max(0, Math.min(3, Math.round(options.localRefinementPasses ?? 1)))"]) {
      expect(engine.split(clamp).length - 1, clamp).toBe(1);
    }
    expect(read("app/lib/pcb/candidates/layout-candidate.ts")).toContain("...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),");
    expect(read(PREVIEW)).not.toMatch(/^export (?!const (?:POST|runtime)\b)/m);
  });

  it("5. [B24-A3 review, 2026-10-08] security-1, coverage-preview-block-not-closed (red on the reviewed tree): the preview stops at its compute bound - the measured worst admitted board, with a caller asking above every ceiling, is admitted and runs at most two candidate evaluations (the clamped candidate count, no local refinement), one engine call at the ceilings; no wall clock is asserted (D24-28)", { timeout: 120_000 }, async () => {
    startCase(5);
    const board = worstAdmittedBoard();
    const body = JSON.stringify({ board, options: ABOVE_EVERY_CEILING });
    expect(body.length).toBeLessThanOrEqual(BOUNDS.bytes);
    expect(board.footprints).toHaveLength(BOUNDS.footprints);
    expect(board.footprints.reduce((sum, footprint) => sum + footprint.def.pads.length, 0)).toBe(BOUNDS.pads);
    expect(board.nets).toHaveLength(BOUNDS.nets);
    expect(board.tracks.length + board.vias.length).toBe(BOUNDS.tracksAndVias);
    const response = await previewPost(new Request("http://localhost/api/pcb/placement/preview", { method: "POST", headers: { "content-type": "application/json" }, body }));
    expect(response.status).toBe(200);
    expect(engineCalls).toHaveLength(1);
    expect(engineCalls[0]).toMatchObject(CEILINGS);
    expect(probe.evaluations).toBeGreaterThanOrEqual(1);
    expect(probe.evaluations).toBeLessThanOrEqual(CEILINGS.candidateCount);
  });

  it("6. [B24-A3 review, 2026-10-08] security-3 (red on the reviewed tree): the cost drivers the five counted lists missed are bounded too, each refused 413 naming its bound before the engine - a body over 1,000,000 bytes, a polygon outline (a rect or roundrect only), one footprint over 128 pads, polygon pads over 2,400 vertices, zone vertices (outlines and fills) over 512, keepout vertices over 512", { timeout: 60_000 }, async () => {
    startCase(6);
    probe.stubEngine = true;
    const empty = (): PcbBoard => createEmptyBoard();
    const ring = (vertices: number): Array<{ x: number; y: number }> => Array.from({ length: vertices }, (_, index) => ({ x: Math.round(400_000 * Math.cos((2 * Math.PI * index) / vertices)), y: Math.round(400_000 * Math.sin((2 * Math.PI * index) / vertices)) }));
    const cases: ReadonlyArray<readonly [string, number, PcbBoard]> = [
      ["bytes", BOUNDS.bytes, { ...empty(), texts: [{ id: "padding", text: "x".repeat(BOUNDS.bytes) }] } as unknown as PcbBoard],
      ["polygonOutlineVertices", BOUNDS.polygonOutlineVertices, { ...empty(), outline: { kind: "polygon", points: rectangle(50_000_000, 50_000_000, 4) } } as PcbBoard],
      ["padsPerFootprint", BOUNDS.padsPerFootprint, boardWithPads(1, BOUNDS.padsPerFootprint + 1)],
      ["padPolygonVertices", BOUNDS.padPolygonVertices, (() => { const board = boardWithPads(2, 1); for (const footprint of board.footprints) (footprint.def.pads[0] as unknown as { shape: unknown }).shape = { kind: "polygon", points: ring(BOUNDS.padPolygonVertices / 2 + 1) }; return board; })()],
      ["zoneVertices", BOUNDS.zoneVertices, { ...empty(), zones: [{ id: "zone-0", polygon: rectangle(50_000_000, 50_000_000, 256), fill: [{ outer: rectangle(50_000_000, 50_000_000, 256), holes: [ring(4)] }] }] } as unknown as PcbBoard],
      ["keepoutVertices", BOUNDS.keepoutVertices, { ...empty(), routingKeepouts: [{ id: "keepout-0", polygon: rectangle(50_000_000, 50_000_000, 516), layers: ["copperTop"], forbidTracks: true, forbidVias: true }] } as unknown as PcbBoard],
    ];
    for (const [bound, limit, board] of cases) {
      const response = await post({ board, options: { candidateCount: 2 } });
      expect(response.status, bound).toBe(413);
      expect(await response.json(), bound).toMatchObject({ ok: false, code: "PLACEMENT_PREVIEW_TOO_LARGE", bound, limit });
    }
    expect(engineCalls).toEqual([]);
    // a roundrect outline and one footprint at the per-footprint bound are admitted (they reach the stubbed engine: 422 here)
    const roundrect = { ...empty(), outline: { kind: "roundrect", width: 50_000_000, height: 50_000_000, cornerRadius: 2_000_000, origin: { x: 0, y: 0 } } } as PcbBoard;
    const wide = makeBoard(60, 60, [makeInstance("fp-000", makeDef("B24_A3_WIDE", 42, 42, Array.from({ length: BOUNDS.padsPerFootprint }, (_, pad) => makePad(String(pad + 1), -19 + (pad % 25) * 1.6, -19 + Math.floor(pad / 25) * 1.6))), { x: 30, y: 30 })], 1);
    for (const board of [roundrect, wide]) expect((await post({ board, options: { candidateCount: 2 } })).status).toBe(422);
    expect(engineCalls).toHaveLength(2);
  });

  it("7. [B24-A3 lead, 2026-10-08] the check's multipliers (red on the fixed tree): a footprint's allowedRotations (the engine refines every distinct value, problem.ts:106-107, engine.ts:174) and its pinPadMappings (each a terminal) are bounded too - at most 4 rotations, each 0, 90, 180 or 270, and at most 128 mappings in one footprint and 600 in all - each refused 413 naming its bound before the engine; a footprint with exactly the four rotations and 128 mappings is admitted", async () => {
    startCase(7);
    probe.stubEngine = true;
    const withFootprints = (count: number, edit: (footprint: Record<string, unknown>, index: number) => void): PcbBoard => {
      const instances = Array.from({ length: count }, (_, index) => makeInstance(`fp-${String(index).padStart(3, "0")}`, makeDef(`B24_A3_M${index}`, 4, 4, [makePad("1", -1, 0), makePad("2", 1, 0)]), { x: 6 + index * 8, y: 20 }));
      const board = makeBoard(60, 60, instances, 1);
      board.footprints.forEach((footprint, index) => edit(footprint as unknown as Record<string, unknown>, index));
      return board;
    };
    const mappings = (count: number): unknown[] => Array.from({ length: count }, (_, index) => ({ componentInstanceId: "component-x", endpointKey: `endpoint-${index}`, symbolPinNumber: String(index + 1), padNumbers: ["1"], mappingKind: "electrical", provenance: "exact-number" }));
    const cases: ReadonlyArray<readonly [string, number, PcbBoard]> = [
      ["rotationsPerFootprint", 4, withFootprints(1, (footprint) => { footprint.placementConstraints = { allowedRotations: Array.from({ length: 1_000 }, (_, index) => index) }; })],
      ["rotationValues", 0, withFootprints(1, (footprint) => { footprint.placementConstraints = { allowedRotations: [0, 45] }; })],
      ["pinPadMappingsPerFootprint", 128, withFootprints(1, (footprint) => { footprint.pinPadMappings = mappings(129); })],
      ["pinPadMappings", 600, withFootprints(5, (footprint) => { footprint.pinPadMappings = mappings(121); })],
    ];
    for (const [bound, limit, board] of cases) {
      const response = await post({ board, options: { candidateCount: 2 } });
      expect(response.status, bound).toBe(413);
      expect(await response.json(), bound).toMatchObject({ ok: false, code: "PLACEMENT_PREVIEW_TOO_LARGE", bound, limit });
    }
    expect(engineCalls).toEqual([]);
    const admitted = withFootprints(1, (footprint) => { footprint.placementConstraints = { allowedRotations: [0, 90, 180, 270] }; footprint.pinPadMappings = mappings(128); });
    expect((await post({ board: admitted, options: { candidateCount: 2 } })).status).toBe(422);
    expect(engineCalls).toHaveLength(1);
  });
});
