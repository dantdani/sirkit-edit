/**
 * Hardcoded demo board (PCB Stage 3) — ephemeral, never persisted.
 *
 * Parses the bundled fixtures (fixtures.ts, generated from Stage 1's test
 * fixtures) and lays instances out in a grid inside a 160×120 mm outline.
 * `high` density exceeds 10,000 primitives (pads + graphics + texts) and is
 * the perf-gate build, reached via `?pcbdemo=high`.
 */

import { parseKicadMod } from "../kicad-mod";
import type { FootprintDef, FootprintInstance, PcbBoard } from "../types";
import { mmToNm, NM_PER_MM } from "../units";
import { DEMO_FIXTURES } from "./fixtures";

export type DemoDensity = "default" | "high";

const BOARD_W_MM = 160;
const BOARD_H_MM = 120;
const MARGIN_MM = 6;
const GAP_MM = 1.6;

let defsCache: Map<string, FootprintDef> | null = null;

function demoDefs(): Map<string, FootprintDef> {
  if (defsCache) return defsCache;
  defsCache = new Map();
  for (const f of DEMO_FIXTURES) {
    defsCache.set(f.name, parseKicadMod(f.source, f.libName));
  }
  return defsCache;
}

interface Batch {
  fixtureName: string;
  count: number;
  refPrefix: string;
}

const DENSITIES: Record<DemoDensity, Batch[]> = {
  // ~38 instances — the tab's default load.
  default: [
    { fixtureName: "LQFP-48_7x7mm_P0.5mm", count: 6, refPrefix: "U" },
    { fixtureName: "R_0805_2012Metric", count: 24, refPrefix: "R" },
    { fixtureName: "PinHeader_1x02_P2.54mm_Vertical", count: 8, refPrefix: "J" },
  ],
  // 600 instances, >10k primitives — the `?pcbdemo=high` perf build.
  high: [
    { fixtureName: "LQFP-48_7x7mm_P0.5mm", count: 150, refPrefix: "U" },
    { fixtureName: "R_0805_2012Metric", count: 400, refPrefix: "R" },
    { fixtureName: "PinHeader_1x02_P2.54mm_Vertical", count: 50, refPrefix: "J" },
  ],
};

// Stage 5: deterministic demo nets so the rats-nest has something to draw.
// Roughly half of all pads join a shared net; the net count is sized per
// density to keep average nets in the realistic 15–35 pad range (well under
// the k≈200 pad-MST comfort zone).
const DEMO_NET_COUNTS: Record<DemoDensity, number> = { default: 12, high: 100 };

function demoPadNets(
  def: FootprintDef,
  instanceIndex: number,
  netCount: number,
): Record<string, number> {
  const padNets: Record<string, number> = {};
  def.pads.forEach((pad, padIndex) => {
    if (!pad.number) return; // NPTH
    if ((instanceIndex + padIndex) % 2 !== 0) return; // ~half stay unconnected
    // instanceIndex + padIndex is even here, so 7n + 13p is too — halve it so
    // the modulo reaches ALL nets instead of only the even ids.
    padNets[pad.number] = (((instanceIndex * 7 + padIndex * 13) / 2) % netCount) + 1;
  });
  return padNets;
}

export function buildDemoBoard(density: DemoDensity): PcbBoard {
  const defs = demoDefs();
  const footprints: FootprintInstance[] = [];

  // Simple row-flow packer: each batch flows left→right, wrapping at the
  // right margin; row height is the tallest cell placed in that row.
  let cursorX = MARGIN_MM;
  let cursorY = MARGIN_MM;
  let rowH = 0;
  let n = 0;

  for (const batch of DENSITIES[density]) {
    const def = defs.get(batch.fixtureName);
    if (!def) throw new Error(`demo fixture missing: ${batch.fixtureName}`);
    const wMm = (def.bodyBBox.maxX - def.bodyBBox.minX) / NM_PER_MM + GAP_MM;
    const hMm = (def.bodyBBox.maxY - def.bodyBBox.minY) / NM_PER_MM + GAP_MM;
    const cell = Math.max(wMm, hMm); // rotation-safe square cell

    for (let i = 0; i < batch.count; i++) {
      if (cursorX + cell > BOARD_W_MM - MARGIN_MM) {
        cursorX = MARGIN_MM;
        cursorY += rowH;
        rowH = 0;
      }
      n++;
      footprints.push({
        id: `demo-fp-${n}`,
        ref: `${batch.refPrefix}${i + 1}`,
        footprintId: `${def.libName}:${def.name}`,
        def,
        at: {
          x: mmToNm(cursorX + cell / 2),
          y: mmToNm(cursorY + cell / 2),
        },
        rotationDeg: (i % 4) * 90, // exercise the rotation mapping visibly
        side: "top",
        padNets: demoPadNets(def, n, DEMO_NET_COUNTS[density]),
      });
      cursorX += cell;
      rowH = Math.max(rowH, cell);
    }
    // Start each part type on a fresh row — keeps the demo readable.
    cursorX = MARGIN_MM;
    cursorY += rowH;
    rowH = 0;
  }

  return {
    formatVersion: 1,
    stackup: 2,
    outline: {
      kind: "rect",
      width: mmToNm(BOARD_W_MM),
      height: mmToNm(BOARD_H_MM),
      origin: { x: 0, y: 0 },
    },
    nets: [
      { id: 0, name: "" },
      ...Array.from({ length: DEMO_NET_COUNTS[density] }, (_, i) => ({
        id: i + 1,
        name: `DEMO_NET_${i + 1}`,
      })),
    ],
    footprints,
    tracks: [],
    vias: [],
    zones: [],
    texts: [],
  };
}
