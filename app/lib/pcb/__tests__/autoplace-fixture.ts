// Shared synthetic fixtures for the Stage 8 auto-place tests. Programmatic
// FootprintDefs (no kicad parsing) give exact control over courtyard sizes and
// pad positions; the 30/100-footprint boards emulate the "naive grid" initial
// state auto-place is measured against.

import type { FootprintDef, FootprintInstance, Pad, PcbBoard } from "../types";
import { mmToNm } from "../units";

export type LockableInstance = FootprintInstance & { locked?: boolean };

export function makePad(number: string, xMm: number, yMm: number): Pad {
  return {
    number,
    type: "smd",
    shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1) },
    at: { x: mmToNm(xMm), y: mmToNm(yMm) },
    rotationDeg: 0,
    layers: ["copperTop"],
  };
}

/** Minimal def with a wMm×hMm courtyard centered on the origin. */
export function makeDef(name: string, wMm: number, hMm: number, pads: Pad[]): FootprintDef {
  const hw = mmToNm(wMm / 2);
  const hh = mmToNm(hMm / 2);
  return {
    libName: "Test",
    name,
    attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false },
    pads,
    graphics: [],
    courtyardBBox: { minX: -hw, minY: -hh, maxX: hw, maxY: hh },
    bodyBBox: { minX: -hw, minY: -hh, maxX: hw, maxY: hh },
    models: [],
    rawSexpr: `(footprint "${name}")`,
  };
}

/** 2-pad chip: pads 1/2 at ∓0.9 mm, 3.4×2 mm courtyard (0805-ish). */
export function makeResistorDef(): FootprintDef {
  return makeDef("R_TEST", 3.4, 2, [makePad("1", -0.9, 0), makePad("2", 0.9, 0)]);
}

/** 8-pad IC, 10×10 mm courtyard, pads on the left/right edges. */
export function makeIcDef(): FootprintDef {
  const pads: Pad[] = [];
  for (let i = 0; i < 4; i++) {
    pads.push(makePad(String(i + 1), -4, -3 + i * 2));
    pads.push(makePad(String(i + 5), 4, -3 + i * 2));
  }
  return makeDef("IC_TEST", 10, 10, pads);
}

export function makeInstance(
  id: string,
  def: FootprintDef,
  atMm: { x: number; y: number },
  padNets: Record<string, number> = {},
  opts: { rotationDeg?: number; side?: "top" | "bottom"; locked?: boolean } = {},
): LockableInstance {
  return {
    id,
    ref: id.toUpperCase(),
    footprintId: `Test:${def.name}`,
    def,
    at: { x: mmToNm(atMm.x), y: mmToNm(atMm.y) },
    rotationDeg: opts.rotationDeg ?? 0,
    side: opts.side ?? "top",
    padNets,
    ...(opts.locked ? { locked: true } : {}),
  };
}

export function makeBoard(wMm: number, hMm: number, footprints: LockableInstance[], netCount: number): PcbBoard {
  return {
    formatVersion: 1,
    identityVersion: 1,
    stackup: 2,
    outline: { kind: "rect", width: mmToNm(wMm), height: mmToNm(hMm), origin: { x: 0, y: 0 } },
    nets: [
      { id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] },
      ...Array.from({ length: netCount }, (_, i) => ({ id: i + 1, name: `NET_${i + 1}`, stableId: `net:fixture-${i + 1}`, endpointKeys: [] })),
    ],
    footprints,
    tracks: [],
    vias: [],
    zones: [],
    texts: [],
  };
}

/**
 * The Stage 8 fixture: `count` footprints (first `icCount` are 10 mm ICs, the
 * rest 0805-ish chips) in a naive grid, `netCount` nets each connecting
 * `count / netCount` footprints that sit FAR apart in the grid — so a good
 * placement must shrink the rats-nest dramatically. The last `offBoard`
 * instances start in the staging strip left of the outline (x < 0), the way
 * real un-placed parts arrive from a sync.
 */
export function buildFixtureBoard(opts: {
  count: number;
  icCount: number;
  netCount: number;
  cols: number;
  pitchMm: number;
  boardMm: { w: number; h: number };
  offBoard?: number;
}): PcbBoard {
  const { count, icCount, netCount, cols, pitchMm, boardMm } = opts;
  const offBoard = opts.offBoard ?? 0;
  const icDef = makeIcDef();
  const resDef = makeResistorDef();

  // Net k (1-based) connects footprints k-1, k-1+netCount, k-1+2·netCount, …
  const netOf = (i: number): number => (i % netCount) + 1;
  const memberIndex = (i: number): number => Math.floor(i / netCount);

  const footprints: LockableInstance[] = [];
  for (let i = 0; i < count; i++) {
    const def = i < icCount ? icDef : resDef;
    const pad = def.pads[memberIndex(i) % def.pads.length].number;
    const onBoard = i < count - offBoard;
    const at = onBoard
      ? { x: 10 + (i % cols) * pitchMm, y: 10 + Math.floor(i / cols) * pitchMm }
      : { x: -20, y: 10 + (i - (count - offBoard)) * 12 };
    footprints.push(makeInstance(`fp-${String(i).padStart(3, "0")}`, def, at, { [pad]: netOf(i) }));
  }
  return makeBoard(boardMm.w, boardMm.h, footprints, netCount);
}

export function buildFixtureBoard30(): PcbBoard {
  return buildFixtureBoard({
    count: 30,
    icCount: 4,
    netCount: 10,
    cols: 6,
    pitchMm: 15,
    boardMm: { w: 100, h: 80 },
    offBoard: 2,
  });
}

export function buildFixtureBoard100(): PcbBoard {
  return buildFixtureBoard({
    count: 100,
    icCount: 10,
    netCount: 25,
    cols: 12,
    pitchMm: 12,
    boardMm: { w: 160, h: 120 },
    offBoard: 4,
  });
}
