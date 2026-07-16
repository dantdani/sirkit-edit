// Footprint & board data model — the pinned cross-stage contract.
// All coordinates are integer nanometers, +y down (see units.ts).
// Everything here is JSON-serializable by construction (numbers, strings,
// booleans, arrays, plain objects) so a PcbBoard can live inside the
// localStorage project record.

import type { Nm } from "./units";
import { mmToNm } from "./units";
import type { Vec2, BBox, PadShape } from "./geometry";
import type { LayerId } from "./layers";
import type { BoardNetClassing } from "./netclass"; // Stage 10 (type-only; no runtime cycle)
import type { SilkItem } from "./silk/types"; // Stage 16 (type-only; no runtime cycle)
import type { Padstack } from "./padstack/types"; // Stage 17 (type-only; no runtime cycle)
import type { BoardStackup } from "./stackup";

export type PadType = "smd" | "thru_hole" | "np_thru_hole";

export interface Pad {
  number: string; // '1', 'A1', '' for NPTH
  type: PadType;
  shape: PadShape;
  at: Vec2;
  rotationDeg: number; // local to footprint (library files are unrotated)
  layers: LayerId[]; // wildcards expanded (see kicad-mod.ts)
  drill?: { diameter: Nm; width?: Nm; height?: Nm; offset?: Vec2 }; // width/height for oval drills
}

export type FpGraphic =
  | { kind: "line"; start: Vec2; end: Vec2; width: Nm; layer: LayerId }
  | { kind: "arc"; start: Vec2; mid: Vec2; end: Vec2; width: Nm; layer: LayerId }
  | { kind: "circle"; center: Vec2; end: Vec2; width: Nm; fill: boolean; layer: LayerId }
  | { kind: "rect"; start: Vec2; end: Vec2; width: Nm; fill: boolean; layer: LayerId }
  | { kind: "poly"; points: Vec2[]; width: Nm; fill: boolean; layer: LayerId }
  | {
      kind: "text";
      text: string;
      at: Vec2;
      rotationDeg: number;
      sizeX: Nm;
      sizeY: Nm;
      thickness: Nm;
      layer: LayerId;
      textKind: "reference" | "value" | "user";
    };

export interface FootprintModelRef {
  path: string;
  offset?: [number, number, number];
  scale?: [number, number, number];
  rotate?: [number, number, number];
}

export interface FootprintDef {
  libName: string;
  name: string; // 'Resistor_SMD', 'R_0805_2012Metric'
  description?: string;
  tags?: string;
  attributes: {
    smd: boolean;
    throughHole: boolean;
    excludeFromPos: boolean;
    excludeFromBom: boolean;
  };
  pads: Pad[];
  graphics: FpGraphic[];
  courtyardBBox?: BBox; // from courtyard-layer graphics
  bodyBBox: BBox; // union of pads + silk + fab graphics
  models: FootprintModelRef[];
  rawSexpr: string; // VERBATIM source text — Stage 13 re-emits this
}

export interface Track {
  id: string;
  layer: LayerId;
  width: Nm;
  start: Vec2;
  end: Vec2;
  netId: number;
  /** Provenance used by repair policy; absent legacy copper is treated as human/imported. */
  source?: "human" | "ai" | "autorouter" | "imported";
  locked?: boolean;
}

export interface Via {
  id: string;
  at: Vec2;
  size: Nm;
  drill: Nm;
  netId: number;
  layers: [LayerId, LayerId];
  /** Stage 17: padstack reference. Optional/additive — when absent, `size`/
   *  `drill` above are authoritative (resolveVia falls back to them). */
  padstackId?: string;
  source?: "human" | "ai" | "autorouter" | "imported";
  locked?: boolean;
}

/**
 * A board-authored area that interactive routing must not enter.  This is an
 * additive format-v1 field: old boards omit it and therefore have no routing
 * keepouts.  The polygon is expressed in the same integer-nanometer world
 * coordinates as every other board primitive.
 */
export interface RoutingKeepout {
  id: string;
  name?: string;
  polygon: Vec2[];
  layers: LayerId[];
  forbidTracks: boolean;
  forbidVias: boolean;
}

/** Replayable engineering record emitted by an accepted Smart Route preview. */
export interface RoutingHistoryEvent {
  schemaVersion: 1;
  id: string;
  tool: "smart-route";
  baseWorldRevision: string;
  netId: number;
  layer: LayerId;
  candidateId: string;
  mode: "direct" | "walk-around";
  direction?: "cw" | "ccw";
  points: Vec2[];
  segmentIds: string[];
  rules: {
    trackWidthNm: Nm;
    clearanceNm: Nm;
    edgeClearanceNm: Nm;
    gridNm: Nm;
  };
  score: number;
  explanation: string;
}

/** One filled copper region of a zone (Stage 11) — outer boundary + clearance-cutout holes. */
export interface FilledRegion {
  outer: Vec2[]; // outer boundary, integer nm, closed (first != last)
  holes: Vec2[][]; // inner holes (clearance cutouts)
  boundingBox: BBox;
  areaNm2: number; // for stats + island scoring
}

export interface Zone {
  id: string;
  layer: LayerId;
  netId: number;
  polygon: Vec2[];
  // Stage 11 additions — appearance is render-only; DRC/export always see solid fills.
  appearance: "solid" | "hatched";
  connection: "solid" | "thermal"; // to same-net pads (thermal = default)
  clearanceOverrideNm?: number; // else getNetClass(zone.netId).clearance
  thermal?: { spokeWidthNm?: number; gapNm?: number; spokes?: 2 | 4; angleOffsetDeg?: number };
  fill: FilledRegion[]; // derived — recomputed when dirty, never an undo entry
  dirty: boolean; // true after any board mutation that could affect the fill
}

export interface BoardText {
  id: string;
  text: string;
  at: Vec2;
  rotationDeg: number;
  layer: LayerId;
  sizeX: Nm;
  sizeY: Nm;
  thickness: Nm;
}

export type BoardOutline =
  | { kind: "rect"; width: Nm; height: Nm; origin: Vec2 }
  | { kind: "roundrect"; width: Nm; height: Nm; cornerRadius: Nm; origin: Vec2 }
  | { kind: "polygon"; points: Vec2[] };

export interface FootprintInstance {
  id: string; // stable; will match schematic component id (Stage 4)
  ref: string; // 'R1'
  footprintId: string; // 'LibName:FootprintName' or Stage-2 DB uuid
  def: FootprintDef; // denormalized — persisted with the board
  at: Vec2;
  rotationDeg: number;
  side: "top" | "bottom";
  padNets: Record<string, number>; // pad number -> net id; absent/0 = unconnected
  /** Stage 17: locked instances refuse move/rotate edit commands. Optional/additive. */
  locked?: boolean;
  /** Explicitly suppress the default body-overhang warning (pads still must be inside). */
  bodyMayOverhang?: boolean;
  /** Hard placement constraints. Auto-placement never moves fixed, mechanical, or edge-bound parts. */
  placementConstraints?: {
    fixedPosition?: boolean;
    mechanical?: boolean;
    edgeConnector?: "top" | "right" | "bottom" | "left";
    allowedRotations?: Array<0 | 90 | 180 | 270>;
    allowSideChange?: boolean;
    criticalRole?: "connector" | "power" | "clock" | "analog" | "rf" | "thermal";
  };
}

export interface PcbBoard {
  formatVersion: 1;
  stackup: 2 | 4;
  /** Stable multilayer roles and autoroute policy. Legacy boards resolve from `stackup`. */
  stackupConfig?: BoardStackup;
  outline: BoardOutline;
  nets: { id: number; name: string }[]; // net 0 reserved = unconnected
  footprints: FootprintInstance[];
  tracks: Track[];
  vias: Via[];
  zones: Zone[];
  texts: BoardText[];
  /** Stage 10: per-net class assignments + AI rule deltas. Optional/additive —
   *  boards saved before Stage 10 load fine (getNetClass falls back to Default). */
  netClassing?: BoardNetClassing;
  /** Stage 16: user silkscreen items. Optional/additive — same posture. */
  silkItems?: SilkItem[];
  /** Stage 17: via padstack library. Optional/additive — seeded + migrated on load. */
  padstacks?: Padstack[];
  /** Additive board-local choices used when a new interactive route starts. */
  routingPreferences?: RoutingPreferences;
  /** Phase-1 Smart Route obstacles. Optional so legacy boards load unchanged. */
  routingKeepouts?: RoutingKeepout[];
  /** Structured/replayable accepted-route records; undo/redo owns their lifetime. */
  routingHistory?: RoutingHistoryEvent[];
  /** Controls whether auto-placement may resize a generated outline. */
  placementPolicy?: { outlineSource: "generated" | "user"; allowBoardResize?: boolean };
  /** Project-persisted virtual spacing used only by auto-placement analysis. */
  placementPreferences?: {
    spacingPreset: "compact" | "comfortable" | "spacious" | "custom";
    envelopeScale: number;
  };
}

/** Optional so legacy boards continue to resolve to net-class defaults. */
export interface RoutingPreferences {
  version: 1;
  trackWidthMode: "net-class" | "custom";
  customTrackWidthNm?: Nm;
  viaMode: "net-class" | "padstack";
  viaPadstackId?: string;
}

/** 100×80 mm rect at origin, 2-layer stackup, only the reserved net 0. */
export function createEmptyBoard(): PcbBoard {
  return {
    formatVersion: 1,
    stackup: 2,
    outline: {
      kind: "rect",
      width: mmToNm(100),
      height: mmToNm(80),
      origin: { x: 0, y: 0 },
    },
    nets: [{ id: 0, name: "" }],
    footprints: [],
    tracks: [],
    vias: [],
    zones: [],
    texts: [],
    silkItems: [],
  };
}
