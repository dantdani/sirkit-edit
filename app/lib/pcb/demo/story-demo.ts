/**
 * "Story" demo fixture (PCB Stage 16) — ephemeral, never persisted. Reachable
 * via `?pcbdemo=story`. The canonical five-click demo starting point:
 *
 *   auto-place (Ctrl+P) → autoroute (Ctrl+E) → DRC (Ctrl+D) → zone + silk →
 *   3D (Ctrl+3) → fab bundle (Ctrl+B)
 *
 * A small "ESP32-style" breakout: 40 × 30 mm outline, 16 footprints staged
 * UNPLACED in rows left of the board (the Stage 4/5 staging-strip
 * convention), a complete stub netlist (power + SPI + I2C + GPIO — every net
 * has ≥ 2 nodes, nothing dangling), zero tracks/vias/zones/silk. The zone and
 * the silk labels are added live during the demo — that's the story.
 *
 * NOTE (file-plan deviation): the plan named `demo/fixtures/story.ts`, but a
 * `demo/fixtures/` directory would collide with the existing generated
 * `demo/fixtures.ts` module specifier — this file follows the sibling
 * `routed-demo.ts` naming instead.
 */

import { parseKicadMod } from "../kicad-mod";
import type { FootprintDef, FootprintInstance, PcbBoard } from "../types";
import { mmToNm } from "../units";
import { DEMO_FIXTURES } from "./fixtures";

// Net ids — deterministic, GND first (Stage 11's plane picker defaults to it).
export const STORY_NETS = [
  { id: 0, name: "" },
  { id: 1, name: "GND" },
  { id: 2, name: "3V3" },
  { id: 3, name: "VBUS" },
  { id: 4, name: "SDA" },
  { id: 5, name: "SCL" },
  { id: 6, name: "SCK" },
  { id: 7, name: "MOSI" },
  { id: 8, name: "MISO" },
  { id: 9, name: "CS" },
  { id: 10, name: "GPIO1" },
  { id: 11, name: "GPIO2" },
] as const;

let defsCache: Map<string, FootprintDef> | null = null;

function defs(): Map<string, FootprintDef> {
  if (defsCache) return defsCache;
  defsCache = new Map();
  for (const f of DEMO_FIXTURES) defsCache.set(f.name, parseKicadMod(f.source, f.libName));
  return defsCache;
}

const LQFP = "LQFP-48_7x7mm_P0.5mm";
const R0805 = "R_0805_2012Metric";
const HDR = "PinHeader_1x02_P2.54mm_Vertical";

export function buildStoryDemo(): PcbBoard {
  const byName = defs();
  const instance = (
    id: string,
    ref: string,
    fixtureName: string,
    xMm: number,
    yMm: number,
    padNets: Record<string, number>,
  ): FootprintInstance => {
    const def = byName.get(fixtureName);
    if (!def) throw new Error(`story fixture missing: ${fixtureName}`);
    return {
      id,
      ref,
      footprintId: `${def.libName}:${def.name}`,
      def,
      at: { x: mmToNm(xMm), y: mmToNm(yMm) },
      rotationDeg: 0,
      side: "top",
      padNets,
    };
  };

  // Staging strip: rows LEFT of the outline (x < 0) — visibly unplaced.
  // Row 1: the MCU. Rows 2-4: passives. Row 5: connectors.
  const footprints: FootprintInstance[] = [
    // "ESP32" — pins used: power in/out, SPI, I2C, GPIO. GND on two pins.
    instance("st-u1", "U1", LQFP, -20, 6, {
      "12": 2, "24": 1, "36": 1, // 3V3 + 2×GND
      "25": 6, "26": 7, "27": 8, "28": 9, // SPI: SCK/MOSI/MISO/CS
      "13": 4, "14": 5, // I2C: SDA/SCL
      "15": 10, "16": 11, // GPIOs
    }),
    // Decoupling / pullups (R_0805 bodies; C refs read naturally in the BOM).
    instance("st-c1", "C1", R0805, -32, 16, { "1": 2, "2": 1 }),
    instance("st-c2", "C2", R0805, -27, 16, { "1": 2, "2": 1 }),
    instance("st-c3", "C3", R0805, -22, 16, { "1": 3, "2": 1 }),
    instance("st-c4", "C4", R0805, -17, 16, { "1": 3, "2": 1 }),
    instance("st-r1", "R1", R0805, -32, 20, { "1": 4, "2": 2 }), // SDA pullup
    instance("st-r2", "R2", R0805, -27, 20, { "1": 5, "2": 2 }), // SCL pullup
    instance("st-r3", "R3", R0805, -22, 20, { "1": 9, "2": 2 }), // CS pullup
    instance("st-r4", "R4", R0805, -17, 20, { "1": 10, "2": 1 }), // GPIO1 load
    instance("st-r5", "R5", R0805, -32, 24, { "1": 11, "2": 1 }), // GPIO2 load
    instance("st-r6", "R6", R0805, -27, 24, { "1": 3, "2": 2 }), // VBUS→3V3 sense
    // Headers: power in, I2C out, SPI pair, GPIO pair.
    instance("st-j1", "J1", HDR, -10, 16, { "1": 3, "2": 1 }), // VBUS/GND in
    instance("st-j2", "J2", HDR, -10, 22, { "1": 4, "2": 5 }), // SDA/SCL
    instance("st-j3", "J3", HDR, -5, 16, { "1": 6, "2": 7 }), // SCK/MOSI
    instance("st-j4", "J4", HDR, -5, 22, { "1": 8, "2": 9 }), // MISO/CS
    instance("st-j5", "J5", HDR, -10, 28, { "1": 10, "2": 11 }), // GPIO1/GPIO2
  ];

  return {
    formatVersion: 1,
    stackup: 2,
    outline: { kind: "rect", width: mmToNm(40), height: mmToNm(30), origin: { x: 0, y: 0 } },
    placementPolicy: { outlineSource: "generated" },
    nets: STORY_NETS.map((n) => ({ ...n })),
    footprints,
    tracks: [],
    vias: [],
    zones: [], // the user adds the GND plane live — that's part of the story
    texts: [],
    silkItems: [], // likewise the silk labels
  };
}
