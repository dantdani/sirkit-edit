// Specctra DSN subset (PCB Stage 9) — the EXACT shape we emit for Freerouting.
//
// DSN is a large spec; Freerouting only needs a small subset. These types mirror
// precisely what `write-dsn.ts` produces so the emitter is transparent about its
// output. All coordinates are integer nanometers (see units.ts), +y down — the
// same axis as PcbBoard, emitted directly (DSN's `(resolution nm 1)`).
//
// Layer names here are KiCad-style DSN names (F.Cu / B.Cu / In1.Cu / In2.Cu),
// NOT our internal LayerId values — write-dsn maps LayerId -> these. Class ids
// mirror Stage 10's NetClassId (Default / Power / HighCurrent).
//
// PLACEMENT NOTE: we emit ONE image per footprint instance and place every
// component at the origin, front, 0° — with each pin's position baked to its
// ABSOLUTE (world) coordinate. That makes Freerouting's place-composition the
// identity, so the routed tracks it returns land exactly on our pad centers
// regardless of how its rotation/side convention compares to ours. See
// write-dsn.ts for the rationale.

export interface Vec2Nm {
  x: number;
  y: number;
}

/** DSN copper-layer name (KiCad style). Freerouting ignores non-copper layers. */
export type DsnLayerName = "F.Cu" | "B.Cu" | "In1.Cu" | "In2.Cu";

/** DSN net-class identifier — mirrors Stage 10 `NetClassId`. */
export type DsnClassId = "Default" | "Power" | "HighCurrent";

/** Pad/via copper shape. roundrect/oval collapse to `rect`; arbitrary shapes to `polygon`. */
export type DsnPadShape =
  | { kind: "circle"; diameterNm: number }
  | { kind: "rect"; wNm: number; hNm: number }
  | { kind: "polygon"; pointsNm: Vec2Nm[] };

export interface DsnBoard {
  name: string; // sirkit-export-<hash8> (deterministic — see boardToDsn)
  resolution: "nm"; // MVP: 'nm' — Freerouting accepts arbitrary resolutions
  boundary: DsnBoundary; // board outline as a closed polygon
  layers: DsnLayer[]; // copper layers only — Freerouting ignores non-copper
  padstacks: DsnPadstack[]; // one per unique pad shape+drill+layer combo
  vias: DsnVia[]; // one per class (via_default / via_power / via_highcurrent)
  components: DsnComponent[]; // one per FootprintInstance (1:1 with an image)
  networks: DsnNetwork[]; // nets with class refs
  rules: DsnRule[]; // default + per-used-class
}

export interface DsnBoundary {
  polygon: Vec2Nm[];
  layer: "pcb";
}

export interface DsnLayer {
  name: DsnLayerName;
  type: "signal" | "power";
  index: number;
}

export interface DsnPadstack {
  name: string; // stable hash-derived id
  shape: DsnPadShape;
  drillNm?: number; // set for THT
  onLayers: DsnLayerName[]; // subset of layers
}

export interface DsnPin {
  padNumber: string;
  padstackName: string;
  atNm: Vec2Nm; // ABSOLUTE world position (components place at origin)
}

export interface DsnComponent {
  ref: string; // e.g. "R7"
  imageName: string; // library image (1:1 with this instance)
  pins: DsnPin[];
}

export interface DsnNetworkNode {
  componentRef: string;
  padNumber: string;
}

export interface DsnNetwork {
  name: string;
  nodes: DsnNetworkNode[];
  classRef: DsnClassId;
}

export interface DsnVia {
  name: string; // via_default / via_power / via_highcurrent
  diameterNm: number; // outer copper diameter (same on both outer layers)
  drillNm: number;
  onLayers: DsnLayerName[]; // through via: outer copper layers
}

export interface DsnRule {
  scope: { kind: "default" } | { kind: "class"; classId: DsnClassId };
  widthNm: number;
  clearanceNm: number;
  viaCandidateName: string; // via ref used for via generation in this scope
}
