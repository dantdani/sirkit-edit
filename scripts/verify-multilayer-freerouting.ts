import type { FootprintDef, FootprintInstance, PcbBoard } from "../app/lib/pcb/types";
import { createEmptyBoard } from "../app/lib/pcb/types";
import { mmToNm } from "../app/lib/pcb/units";
import { setBoardStackupProfile } from "../app/lib/pcb/stackup";
import { boardToDsn, writeDsn } from "../app/lib/pcb/dsn/write-dsn";
import { validateDsn } from "../app/lib/pcb/dsn/preflight";
import { parseSes } from "../app/lib/pcb/dsn/read-ses";
import { runFreerouting } from "../app/lib/pcb/autoroute/runner";
import { resolveFreeroutingRuntime } from "../app/lib/pcb/autoroute/runtime";
import { buildAutorouteCandidate, verifyAutorouteCandidate } from "../app/lib/pcb/autoroute/verification";
import { getPreset } from "../app/lib/pcb/drc/presets";

const throughHole: FootprintDef = {
  libName: "SirkitTest",
  name: "TH1",
  attributes: { smd: false, throughHole: true, excludeFromPos: false, excludeFromBom: false },
  pads: [{
    number: "1",
    type: "thru_hole",
    shape: { kind: "circle", radius: mmToNm(0.75) },
    at: { x: 0, y: 0 },
    rotationDeg: 0,
    layers: ["copperTop", "in1", "in2", "copperBottom"],
    drill: { diameter: mmToNm(0.8) },
  }],
  graphics: [],
  bodyBBox: { minX: mmToNm(-1), minY: mmToNm(-1), maxX: mmToNm(1), maxY: mmToNm(1) },
  courtyardBBox: { minX: mmToNm(-1.2), minY: mmToNm(-1.2), maxX: mmToNm(1.2), maxY: mmToNm(1.2) },
  models: [],
  rawSexpr: "",
};

function instance(id: string, ref: string, x: number, y: number, netId: number): FootprintInstance {
  return {
    id,
    ref,
    footprintId: "SirkitTest:TH1",
    def: throughHole,
    at: { x: mmToNm(x), y: mmToNm(y) },
    rotationDeg: 0,
    side: "top",
    padNets: { "1": netId },
  };
}

function forcedInnerLayerBoard(): PcbBoard {
  const board: PcbBoard = {
    ...createEmptyBoard(),
    outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(40), height: mmToNm(40) },
    nets: [{ id: 0, name: "" }, { id: 1, name: "HORIZONTAL" }, { id: 2, name: "VERTICAL" }],
    footprints: [
      instance("h1", "H1", 5, 20, 1),
      instance("h2", "H2", 35, 20, 1),
      instance("v1", "V1", 20, 5, 2),
      instance("v2", "V2", 20, 35, 2),
    ],
  };
  setBoardStackupProfile(board, "all-signal-4");
  for (const layer of board.stackupConfig!.copperLayers) {
    if (layer.id === "copperTop" || layer.id === "copperBottom") layer.autorouteEnabled = false;
  }
  return board;
}

async function main(): Promise<void> {
  const board = forcedInnerLayerBoard();
  const dsn = boardToDsn(board);
  const validation = validateDsn(board, dsn);
  if (!validation.ok) throw new Error(`DSN preflight failed: ${JSON.stringify(validation.issues)}`);
  const runtime = await resolveFreeroutingRuntime();
  if (!runtime.ok) throw new Error(runtime.stderr);
  const run = await runFreerouting({
    dsnText: writeDsn(dsn),
    freeroutingJarPath: runtime.jarPath,
    javaPath: runtime.javaPath,
    maxPasses: 50,
    timeoutMs: 120_000,
  });
  if (!run.ok) throw new Error(`Freerouting ${run.error}: ${run.stderr}`);
  const parsed = parseSes(run.sesText, board);
  const candidate = buildAutorouteCandidate(board, parsed);
  const verification = verifyAutorouteCandidate(candidate, getPreset("jlcpcb-4l").rules, parsed.layerUsage);
  const innerSegments = (parsed.layerUsage.in1?.segments ?? 0) + (parsed.layerUsage.in2?.segments ?? 0);
  if (innerSegments === 0) throw new Error("Freerouting returned no inner-layer copper for the forced multilayer fixture.");
  if (verification.status !== "complete") throw new Error(`Forced multilayer fixture remained partial: ${JSON.stringify(verification)}`);
  console.log(JSON.stringify({
    engine: runtime.version,
    elapsedMs: run.elapsedMs,
    tracks: parsed.tracks.length,
    vias: parsed.vias.length,
    layerUsage: parsed.layerUsage,
    status: verification.status,
    connections: `${verification.completedConnections}/${verification.requiredConnections}`,
  }, null, 2));
}

void main();
