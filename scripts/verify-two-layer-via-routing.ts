import { boardToDsn, writeDsn } from "../app/lib/pcb/dsn/write-dsn";
import { validateDsn } from "../app/lib/pcb/dsn/preflight";
import { parseSes } from "../app/lib/pcb/dsn/read-ses";
import { resolveFreeroutingRuntime } from "../app/lib/pcb/autoroute/runtime";
import { runFreerouting } from "../app/lib/pcb/autoroute/runner";
import { buildAutorouteCandidate, verifyAutorouteCandidate } from "../app/lib/pcb/autoroute/verification";
import { getPreset } from "../app/lib/pcb/drc/presets";
import { createEmptyBoard, type FootprintDef, type FootprintInstance, type PcbBoard } from "../app/lib/pcb/types";
import { mmToNm } from "../app/lib/pcb/units";
import { stackupProfile } from "../app/lib/pcb/stackup";

const PAD: FootprintDef = {
  libName: "Verify",
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
  return {
    id,
    ref,
    footprintId: "Verify:TopPad",
    def: PAD,
    at: { x: mmToNm(x), y: mmToNm(y) },
    rotationDeg: 0,
    side: "top",
    padNets: { "1": netId },
  };
}

function fixture(): PcbBoard {
  const stackup = stackupProfile("simple-2");
  stackup.routing = { ...stackup.routing, viasAllowed: true, fanout: true, postroute: true, viaCost: 1, startRipupCost: 25 };
  return {
    ...createEmptyBoard(),
    outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(20), height: mmToNm(20) },
    stackupConfig: stackup,
    nets: [{ id: 0, name: "" }, { id: 1, name: "BARRIER" }, { id: 2, name: "CROSSING" }],
    footprints: [
      part("left", "J1", 0.5, 10, 1),
      part("right", "J2", 19.5, 10, 1),
      part("top", "J3", 10, 3, 2),
      part("bottom", "J4", 10, 17, 2),
    ],
    tracks: [{
      id: "protected-barrier",
      layer: "copperTop",
      width: mmToNm(0.25),
      start: { x: mmToNm(0.6), y: mmToNm(10) },
      end: { x: mmToNm(19.4), y: mmToNm(10) },
      netId: 1,
      source: "human",
      locked: true,
    }],
  };
}

async function main(): Promise<void> {
  const board = fixture();
  const dsn = boardToDsn(board);
  const preflight = validateDsn(board, dsn);
  if (!preflight.ok) throw new Error(`DSN preflight failed: ${JSON.stringify(preflight.issues)}`);
  const runtime = await resolveFreeroutingRuntime();
  if (!runtime.ok) throw new Error(`${runtime.error}: ${runtime.stderr}`);
  const routed = await runFreerouting({
    dsnText: writeDsn(dsn),
    freeroutingJarPath: runtime.jarPath,
    javaPath: runtime.javaPath,
    maxPasses: 1,
    timeoutMs: 20_000,
  });
  if (!routed.ok) throw new Error(`${routed.error}: ${routed.stderr}`);
  const parsed = parseSes(routed.sesText, board);
  const candidate = buildAutorouteCandidate(board, parsed);
  const verification = verifyAutorouteCandidate(candidate, getPreset("jlcpcb-2l").rules, parsed.layerUsage);
  const usedLayers = Object.keys(parsed.layerUsage).sort();
  if (verification.status !== "complete") throw new Error(`Routing remained partial: ${JSON.stringify(verification)}`);
  if (parsed.vias.length < 1) throw new Error("Fixture routed without a via; the forced-crossing acceptance condition was not met.");
  if (!usedLayers.includes("copperTop") || !usedLayers.includes("copperBottom")) {
    throw new Error(`Expected both copper layers, got ${usedLayers.join(", ")}.`);
  }
  if (verification.drcErrors !== 0) throw new Error(`Expected zero DRC errors, got ${verification.drcErrors}.`);
  console.log(JSON.stringify({
    engine: runtime.version,
    elapsedMs: routed.elapsedMs,
    tracks: parsed.tracks.length,
    vias: parsed.vias.length,
    usedLayers,
    status: verification.status,
    connections: `${verification.completedConnections}/${verification.requiredConnections}`,
    drcErrors: verification.drcErrors,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
