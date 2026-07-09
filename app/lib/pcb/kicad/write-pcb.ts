// .kicad_pcb writer — the pinned Stage 13 entry point.
// Format spec (source of truth): https://dev-docs.kicad.org/en/file-formats/sexpr-pcb/
//
// Deterministic emit order (pinned): nets by id; footprints by ref; tracks by
// (layer, netId, start.x, start.y); vias by (netId, at.x, at.y); zones by
// (layer, netId). UUIDs are fresh per export — stripping them must make two
// exports of the same board byte-identical (kicad-write-pcb.test.ts).

import type { PcbBoard, FootprintInstance, Track, Via, Zone } from "../types";
import type { PcbNetlist } from "../netlist-bridge";
import type { NetClassId } from "../netclass";
import { DEFAULT_CLASSES, getNetClass } from "../netclass";
import type { DrcRules } from "../drc/types";
import { getPreset } from "../drc/presets";
import type { WriteKicadPcbOptions, KicadNetRef } from "./types";
import { KICAD_PCB_VERSION, KICAD_GENERATOR } from "./types";
import { block, q, sexpr } from "./sexpr-emit";
import {
  netTable,
  emitNet,
  emitGeneral,
  emitPaper,
  emitLayersHeader,
  emitOutline,
  emitBoardText,
} from "./emit-board";
import { emitSetup } from "./emit-setup";
import { emitNetClass } from "./emit-net-class";
import { emitFootprint } from "./emit-footprint";
import { emitTrack } from "./emit-track";
import { emitVia } from "./emit-via";
import { emitZone } from "./emit-zone";
import { emitSilkItem } from "./emit-silk"; // Stage 16

export type { WriteKicadPcbOptions } from "./types";

/** Minimal netlist stand-in when only a board exists (demo boards, API calls
 * without a synced schematic): board.nets carries every name we need. */
export function netlistFromBoard(board: PcbBoard): PcbNetlist {
  return {
    components: [],
    nets: board.nets
      .filter((n) => n.id !== 0)
      .map((n) => ({ id: n.id, name: n.name, nodes: [] })),
  };
}

const byRef = (a: FootprintInstance, b: FootprintInstance): number =>
  a.ref.localeCompare(b.ref, undefined, { numeric: true, sensitivity: "base" }) ||
  a.id.localeCompare(b.id);

const byTrack = (a: Track, b: Track): number =>
  a.layer.localeCompare(b.layer) ||
  a.netId - b.netId ||
  a.start.x - b.start.x ||
  a.start.y - b.start.y;

const byVia = (a: Via, b: Via): number =>
  a.netId - b.netId || a.at.x - b.at.x || a.at.y - b.at.y;

const byZone = (a: Zone, b: Zone): number =>
  a.layer.localeCompare(b.layer) || a.netId - b.netId;

/** Net-class blocks: nets grouped by their Stage 10 assignment; class values
 * are the class defaults with any Stage 12 per-class clearance layered on.
 * "Default" always emits (KiCad expects it); others only when populated. */
function emitNetClasses(board: PcbBoard, nets: KicadNetRef[], rules: DrcRules): string[] {
  const grouped = new Map<NetClassId, KicadNetRef[]>([
    ["Default", []],
    ["Power", []],
    ["HighCurrent", []],
  ]);
  for (const net of nets) {
    if (net.id === 0) continue;
    grouped.get(getNetClass(board, net.id).id)?.push(net);
  }
  const out: string[] = [];
  for (const [classId, members] of grouped) {
    if (classId !== "Default" && members.length === 0) continue;
    const base = { ...DEFAULT_CLASSES[classId], explanation: "" };
    const override = rules.perClass[classId];
    if (override?.clearanceNm !== undefined) base.clearance = override.clearanceNm;
    if (override?.minTrackWidthNm !== undefined) {
      base.trackWidth = Math.max(base.trackWidth, override.minTrackWidthNm);
    }
    out.push(emitNetClass(base, members));
  }
  return out;
}

export function writeKicadPcb(
  board: PcbBoard,
  netlist: PcbNetlist,
  options?: WriteKicadPcbOptions,
): string {
  const rules = options?.drcRules ?? getPreset("jlcpcb-2l").rules;
  const includeZones = options?.includeZones ?? true;
  const nets = netTable(board, netlist);

  const footprints = [...board.footprints].sort(byRef).map((f) => emitFootprint(f, board, netlist));
  const tracks = [...board.tracks].sort(byTrack).map((t) => emitTrack(t, board, netlist));
  const vias = [...board.vias].sort(byVia).map((v) => emitVia(v, board, netlist));
  // Stage 11 landed: zones emit their outline + computed fills. A dirty zone
  // still emits (outline only, no filled_polygon) — callers that need fresh
  // copper (Stage 14's fab bundle) re-pour before writing.
  const zones = includeZones
    ? [...board.zones].sort(byZone).map((z) => emitZone(z, board, netlist))
    : [];

  return (
    block(`kicad_pcb ${sexpr("version", KICAD_PCB_VERSION)} ${sexpr("generator", q(KICAD_GENERATOR))}`, [
      emitGeneral(),
      emitPaper(),
      emitLayersHeader(board.stackup),
      emitSetup(rules),
      ...nets.map(emitNet),
      ...emitNetClasses(board, nets, rules),
      ...footprints,
      ...tracks,
      ...vias,
      ...zones,
      ...emitOutline(board.outline),
      ...board.texts.map(emitBoardText),
      // Stage 16: user silk items, sorted (layer, kind, id) for determinism.
      ...[...(board.silkItems ?? [])]
        .sort((a, b) => a.layer.localeCompare(b.layer) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
        .map(emitSilkItem),
    ]) + "\n"
  );
}
