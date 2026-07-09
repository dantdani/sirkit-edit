/**
 * Hand-authored routed demo board (PCB Stage 6) — ephemeral, never persisted.
 * Reachable via `?pcbdemo=routed`. This board is Stage 6's visual check AND
 * the integration fixture Stage 7 starts interactive routing from.
 *
 * Contents (asserted by connectivity-board.test.ts so the fixture can't drift):
 * - 8 instances, local STUB nets (padNets assigned here — independent of
 *   Stage 4's schematic sync): net 1 GND, net 2 VCC, net 3 SIG.
 * - GND fully routed on copperTop; one unfilled GND zone polygon.
 * - VCC routed top → viaA → two copperBottom tracks → viaB → top, complete.
 * - SIG routed U1.25 → R3.1 with a two-segment 45° bend; R4.1 left unrouted
 *   → exactly ONE airwire.
 * - One deliberate cross-net touch: a VCC stub crosses a GND track on
 *   copperTop → exactly ONE short.
 * - One netId-0 track touching nothing → exactly ONE orphan.
 *
 * Track endpoints are computed from `padWorldPosition`, so routes land exactly
 * on pad centers whatever the fixture geometry says.
 */

import { parseKicadMod } from "../kicad-mod";
import type { FootprintDef, FootprintInstance, PcbBoard, Track, Via, Zone } from "../types";
import type { LayerId } from "../layers";
import type { Vec2 } from "../geometry";
import { mmToNm } from "../units";
import { padWorldPosition } from "../geometry-copper";
import { DEMO_FIXTURES } from "./fixtures";

const GND = 1;
const VCC = 2;
const SIG = 3;

const TRACK_W = mmToNm(0.3);
const VIA_SIZE = mmToNm(0.6);
const VIA_DRILL = mmToNm(0.3);

let defsCache: Map<string, FootprintDef> | null = null;

function defs(): Map<string, FootprintDef> {
  if (defsCache) return defsCache;
  defsCache = new Map();
  for (const f of DEMO_FIXTURES) defsCache.set(f.name, parseKicadMod(f.source, f.libName));
  return defsCache;
}

export function buildRoutedDemo(): PcbBoard {
  const byName = defs();
  const instance = (
    id: string,
    ref: string,
    fixtureName: string,
    xMm: number,
    yMm: number,
    rotationDeg: number,
    padNets: Record<string, number>,
  ): FootprintInstance => {
    const def = byName.get(fixtureName);
    if (!def) throw new Error(`routed-demo fixture missing: ${fixtureName}`);
    return {
      id,
      ref,
      footprintId: `${def.libName}:${def.name}`,
      def,
      at: { x: mmToNm(xMm), y: mmToNm(yMm) },
      rotationDeg,
      side: "top",
      padNets,
    };
  };

  const LQFP = "LQFP-48_7x7mm_P0.5mm";
  const R0805 = "R_0805_2012Metric";
  const HDR = "PinHeader_1x02_P2.54mm_Vertical";

  const u1 = instance("rd-u1", "U1", LQFP, 45, 30, 0, { "25": SIG, "12": VCC, "24": GND });
  const r1 = instance("rd-r1", "R1", R0805, 25, 22, 90, { "1": VCC });
  const r2 = instance("rd-r2", "R2", R0805, 20, 38, 90, { "2": GND });
  const r3 = instance("rd-r3", "R3", R0805, 62, 44, -90, { "1": SIG });
  const r4 = instance("rd-r4", "R4", R0805, 66, 14, 90, { "1": SIG }); // unrouted → airwire
  const r5 = instance("rd-r5", "R5", R0805, 12, 50, 0, {});
  const j1 = instance("rd-j1", "J1", HDR, 8, 14, 0, { "1": VCC, "2": GND });
  const j2 = instance("rd-j2", "J2", HDR, 72, 52, 0, {});

  const pad = (inst: FootprintInstance, num: string): Vec2 => {
    const p = inst.def.pads.find((pd) => pd.number === num);
    if (!p) throw new Error(`routed-demo: ${inst.ref} has no pad ${num}`);
    return padWorldPosition(inst, p);
  };

  const tracks: Track[] = [];
  let n = 0;
  const track = (netId: number, layer: LayerId, start: Vec2, end: Vec2): Vec2 => {
    tracks.push({ id: `rd-t${++n}`, layer, width: TRACK_W, start, end, netId });
    return end; // chainable: each call returns its endpoint
  };

  const j1Gnd = pad(j1, "2");
  const j1Vcc = pad(j1, "1");
  const r1Vcc = pad(r1, "1");
  const r2Gnd = pad(r2, "2");
  const r3Sig = pad(r3, "1");
  const u1Sig = pad(u1, "25");
  const u1Vcc = pad(u1, "12");
  const u1Gnd = pad(u1, "24");

  // ── GND (net 1), all copperTop: J1.2 → R2.2 → U1.24 ───────────────────────
  let p = track(GND, "copperTop", j1Gnd, { x: j1Gnd.x, y: r2Gnd.y });
  track(GND, "copperTop", p, r2Gnd);
  p = track(GND, "copperTop", r2Gnd, { x: u1Gnd.x, y: r2Gnd.y });
  track(GND, "copperTop", p, u1Gnd);

  // ── VCC (net 2): J1.1 → viaA → bottom ×2 → viaB → R1.1 → U1.12 ────────────
  const viaA: Vec2 = { x: mmToNm(12), y: j1Vcc.y };
  const viaB: Vec2 = { x: mmToNm(18), y: r1Vcc.y };
  track(VCC, "copperTop", j1Vcc, viaA);
  p = track(VCC, "copperBottom", viaA, { x: viaA.x, y: viaB.y });
  track(VCC, "copperBottom", p, viaB);
  track(VCC, "copperTop", viaB, r1Vcc);
  p = track(VCC, "copperTop", r1Vcc, { x: r1Vcc.x, y: u1Vcc.y });
  track(VCC, "copperTop", p, u1Vcc);

  // ── SIG (net 3): U1.25 → 45° bend → R3.1; R4.1 deliberately unrouted ──────
  const bendStart: Vec2 = { x: r3Sig.x - mmToNm(7), y: u1Sig.y };
  p = track(SIG, "copperTop", u1Sig, bendStart);
  p = track(SIG, "copperTop", p, { x: r3Sig.x, y: u1Sig.y + mmToNm(7) }); // 45°
  track(SIG, "copperTop", p, r3Sig);

  // ── Deliberate cross-net touch: VCC stub from viaB crossing the GND run ───
  track(VCC, "copperTop", viaB, { x: viaB.x, y: mmToNm(40) });

  // ── Deliberate orphan: netId-0 track touching nothing ─────────────────────
  track(0, "copperTop", { x: mmToNm(10), y: mmToNm(52) }, { x: mmToNm(14), y: mmToNm(52) });

  const vias: Via[] = [
    { id: "rd-v1", at: viaA, size: VIA_SIZE, drill: VIA_DRILL, netId: VCC, layers: ["copperTop", "copperBottom"] },
    { id: "rd-v2", at: viaB, size: VIA_SIZE, drill: VIA_DRILL, netId: VCC, layers: ["copperTop", "copperBottom"] },
  ];

  // GND zone (Stage 11: starts dirty/unfilled; useZoneFills pours it on load).
  const zones: Zone[] = [
    {
      id: "rd-z1",
      layer: "copperTop",
      netId: GND,
      appearance: "solid",
      connection: "thermal",
      fill: [],
      dirty: true,
      polygon: [
        { x: mmToNm(6), y: mmToNm(44) },
        { x: mmToNm(28), y: mmToNm(44) },
        { x: mmToNm(28), y: mmToNm(57) },
        { x: mmToNm(6), y: mmToNm(57) },
      ],
    },
  ];

  return {
    formatVersion: 1,
    stackup: 2,
    outline: { kind: "rect", width: mmToNm(80), height: mmToNm(60), origin: { x: 0, y: 0 } },
    nets: [
      { id: 0, name: "" },
      { id: GND, name: "GND" },
      { id: VCC, name: "VCC" },
      { id: SIG, name: "SIG" },
    ],
    footprints: [u1, r1, r2, r3, r4, r5, j1, j2],
    tracks,
    vias,
    zones,
    texts: [],
  };
}
