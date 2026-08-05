import { describe, expect, it } from "vitest";
import { boardToDsn, writeDsn } from "../dsn/write-dsn";
import { validateDsn } from "../dsn/preflight";
import { parseSes } from "../dsn/read-ses";
import { resolveFreeroutingRuntime } from "../autoroute/runtime";
import { runFreerouting } from "../autoroute/runner";
import { buildAutorouteCandidate, verifyAutorouteCandidate } from "../autoroute/verification";
import { getPreset } from "../drc/presets";
import { createEmptyBoard, type FootprintDef, type FootprintInstance, type PcbBoard, type Track } from "../types";
import { mmToNm } from "../units";

const PAD: FootprintDef = {
  libName: "RC02",
  name: "TopPad",
  attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
  pads: [{ number: "1", type: "smd", shape: { kind: "circle", radius: mmToNm(0.3) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop"] }],
  graphics: [],
  courtyardBBox: { minX: mmToNm(-0.5), minY: mmToNm(-0.5), maxX: mmToNm(0.5), maxY: mmToNm(0.5) },
  bodyBBox: { minX: mmToNm(-0.4), minY: mmToNm(-0.4), maxX: mmToNm(0.4), maxY: mmToNm(0.4) },
  models: [],
  rawSexpr: "",
};

function part(id: string, ref: string, x: number, y: number, netId: number): FootprintInstance {
  return { id, ref, footprintId: "RC02:TopPad", def: PAD, at: { x: mmToNm(x), y: mmToNm(y) }, rotationDeg: 0, side: "top", padNets: { "1": netId } };
}

function baseBoard(nets: PcbBoard["nets"], footprints: FootprintInstance[], tracks: Track[] = []): PcbBoard {
  return {
    ...createEmptyBoard(),
    outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(30), height: mmToNm(20) },
    nets: [{ id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] }, ...nets],
    footprints,
    tracks,
  };
}

async function route(board: PcbBoard, routeAttemptId: string, maxPasses = 25) {
  const runtime = await resolveFreeroutingRuntime();
  if (!runtime.ok) throw new Error(`${runtime.error}: ${runtime.stderr}`);
  const dsn = boardToDsn(board);
  expect(validateDsn(board, dsn).ok).toBe(true);
  const result = await runFreerouting({
    dsnText: writeDsn(dsn),
    freeroutingJarPath: runtime.jarPath,
    javaPath: runtime.javaPath,
    maxPasses,
    timeoutMs: 120_000,
  });
  if (!result.ok) throw new Error(`${result.error}: ${result.stderr}`);
  expect(result).toMatchObject({ processStatus: "exit-success", outputFileStatus: "nonempty", exitCode: 0 });
  const parsed = parseSes(result.sesText, board, { manifest: dsn.integrity, sourceRevision: dsn.integrity?.sourceRevision, routeAttemptId });
  const candidate = buildAutorouteCandidate(board, parsed);
  return { runtime, result, parsed, candidate, verification: verifyAutorouteCandidate(candidate, getPreset("jlcpcb-2l").rules, parsed.layerUsage) };
}

describe("RC02 real bundled FreeRouting boundary", () => {
  it("completes a simple authoritative two-layer fixture", async () => {
    const board = baseBoard(
      [{ id: 1, name: "SIGNAL", stableId: "net:signal", endpointKeys: [] }],
      [part("left", "J1", 5, 10, 1), part("right", "J2", 25, 10, 1)],
    );
    const routed = await route(board, "rc02-simple-2l");
    console.log("RC02_REAL_SIMPLE", JSON.stringify({ engine: routed.runtime.version, elapsedMs: routed.result.elapsedMs, tracks: routed.parsed.tracks.length, vias: routed.parsed.vias.length, layers: Object.keys(routed.parsed.layerUsage).sort(), remainingConnections: routed.verification.remainingConnections, routeBlockingDrcErrors: routed.verification.routeBlockingDrcErrors }));
    expect(routed.runtime.version).toBe("2.2.4");
    expect(routed.verification).toMatchObject({ status: "complete", remainingConnections: 0, shorts: 0, routeBlockingDrcErrors: 0 });
    expect(routed.parsed.tracks.length).toBeGreaterThan(0);
  }, 150_000);

  it("completes a forced crossing on both layers with vias and preserves locked copper byte-for-byte", async () => {
    const protectedTrack: Track = {
      id: "protected-barrier",
      layer: "copperTop",
      width: mmToNm(0.25),
      start: { x: mmToNm(0.6), y: mmToNm(10) },
      end: { x: mmToNm(19.4), y: mmToNm(10) },
      netId: 1,
      source: "human",
      locked: true,
    };
    const board = baseBoard(
      [
        { id: 1, name: "BARRIER", stableId: "net:barrier", endpointKeys: [] },
        { id: 2, name: "CROSSING", stableId: "net:crossing", endpointKeys: [] },
      ],
      [part("left", "J1", 0.5, 10, 1), part("right", "J2", 19.5, 10, 1), part("top", "J3", 10, 3, 2), part("bottom", "J4", 10, 17, 2)],
      [protectedTrack],
    );
    board.outline = { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(20), height: mmToNm(20) };
    const before = JSON.stringify(protectedTrack);
    const routed = await route(board, "rc02-forced-crossing-2l", 1);
    console.log("RC02_REAL_CROSSING", JSON.stringify({ engine: routed.runtime.version, elapsedMs: routed.result.elapsedMs, tracks: routed.parsed.tracks.length, vias: routed.parsed.vias.length, layers: Object.keys(routed.parsed.layerUsage).sort(), remainingConnections: routed.verification.remainingConnections, routeBlockingDrcErrors: routed.verification.routeBlockingDrcErrors }));
    expect(routed.verification).toMatchObject({ status: "complete", remainingConnections: 0, shorts: 0, routeBlockingDrcErrors: 0 });
    expect(routed.parsed.vias.length).toBeGreaterThan(0);
    expect(Object.keys(routed.parsed.layerUsage)).toEqual(expect.arrayContaining(["copperTop", "copperBottom"]));
    expect(JSON.stringify(routed.candidate.tracks.find((track) => track.id === protectedTrack.id))).toBe(before);
  }, 150_000);
});
