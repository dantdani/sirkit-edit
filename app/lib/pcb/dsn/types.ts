// Specctra DSN subset (PCB Stage 9) — the EXACT shape we emit for Freerouting.
//
// DSN is a large spec; Freerouting only needs a small subset. These types mirror
// precisely what `write-dsn.ts` produces so the emitter is transparent about its
// output. All coordinates are integer nanometers (see units.ts), +y down — the
// same axis as PcbBoard, emitted directly. Freerouting does not accept `nm` as
// a DSN unit token, so the file uses its supported `um` token. The emitter
// converts nanometers to micrometers and the SES reader converts them back.
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

export type DsnLayerRole = "signal" | "plane" | "mixed";
export type DsnPreferredDirection = "horizontal" | "vertical" | "any";

/** Pad/via copper shape. roundrect/oval collapse to `rect`; arbitrary shapes to `polygon`. */
export type DsnPadShape =
  | { kind: "circle"; diameterNm: number }
  | { kind: "rect"; wNm: number; hNm: number }
  | { kind: "polygon"; pointsNm: Vec2Nm[] };

export interface DsnBoard {
  name: string; // sirkit-export-<hash8> (deterministic — see boardToDsn)
  resolution: "um"; // supported Freerouting token; emitter scales nm to um
  boundary: DsnBoundary; // board outline as a closed polygon
  layers: DsnLayer[]; // copper layers only — Freerouting ignores non-copper
  padstacks: DsnPadstack[]; // one per unique pad shape+drill+layer combo
  vias: DsnVia[]; // one per class (via_default / via_power / via_highcurrent)
  components: DsnComponent[]; // one per FootprintInstance (1:1 with an image)
  networks: DsnNetwork[]; // nets with class refs
  rules: DsnRule[]; // default + per-used-class
  routingSettings: DsnRoutingSettings;
  wiring: DsnWiringItem[]; // existing copper exported as protected geometry
  /** Internal defense-in-depth manifest; not serialized into Specctra text. */
  integrity?: DsnIntegrityManifest;
}

export interface DsnBoundary {
  polygon: Vec2Nm[];
  layer: "pcb";
}

export interface DsnLayer {
  name: DsnLayerName;
  type: "signal" | "power";
  index: number;
  role: DsnLayerRole;
  autorouteEnabled: boolean;
  preferredDirection: DsnPreferredDirection;
  traceWidthNm: number;
  planeNetName?: string;
  /** Native plane certificate; polygon comes from the generated zone, never a synthetic board boundary. */
  plane?: {
    zoneId: string;
    stableNetId: string;
    netName: string;
    polygonNm: Vec2Nm[];
    sourceRevision: string;
    fillHash: string;
    algorithmVersion: string;
    fillStatus: "current";
    regionCount: number;
    holeCount: number;
    filledAreaNm2: number;
    exportedRepresentationId: string;
    unsupportedConstructs: string[];
  };
}

export interface DsnRoutingSettings {
  viasAllowed: boolean;
  fanout: boolean;
  postroute: boolean;
  viaCost: number;
  planeViaCost: number;
  startRipupCost: number;
}

export interface DsnPadstack {
  name: string; // stable hash-derived id
  shape: DsnPadShape;
  drillNm?: number; // set for THT
  onLayers: DsnLayerName[]; // subset of layers
}

export interface DsnPin {
  /** Unique image-local export identity; duplicate source pad numbers receive deterministic suffixes. */
  padNumber: string;
  /** Original footprint pad number used by the Sirkit mapping contract. */
  sourcePadNumber?: string;
  padInstanceId?: string;
  padstackName: string;
  atNm: Vec2Nm; // ABSOLUTE world position (components place at origin)
}

export interface DsnComponent {
  ref: string; // e.g. "R7"
  imageName: string; // library image (1:1 with this instance)
  pins: DsnPin[];
  componentId?: string;
}

export interface DsnNetworkNode {
  componentRef: string;
  padNumber: string;
  componentId?: string;
  endpointKey?: string;
  padInstanceId?: string;
}

export interface DsnIntegrityManifest {
  schemaVersion: "sirkit.dsn-integrity.v2";
  sourceRevision: string;
  electricalTruthSchema: "sirkit.electrical-truth.v1";
  nets: Array<{
    stableNetId: string;
    numericNetId: number;
    serializedName: string;
    endpointKeys: string[];
    terminalGroupIds: string[];
    physicalPadInstanceIds: string[];
  }>;
  layers: Array<{ layerId: string; dsnName: DsnLayerName }>;
  planes?: Array<{
    layerId: string;
    dsnName: DsnLayerName;
    zoneId: string;
    stableNetId: string;
    sourceRevision: string;
    fillHash: string;
    algorithmVersion: string;
    fillStatus: "current";
    regionCount: number;
    holeCount: number;
    filledAreaNm2: number;
    exportedRepresentationId: string;
    unsupportedConstructs: string[];
  }>;
  viaPadstacks: Array<{ name: string; diameterNm: number; drillNm: number; onLayers: DsnLayerName[] }>;
  expectedEndpoints: Array<{
    endpointKey: string;
    componentId: string;
    componentRef: string;
    symbolPinNumber: string;
    sourcePadNumbers: string[];
    padNumbers: string[];
    physicalPadInstanceIds: string[];
    netId: number;
    netStableId?: string;
    netName: string;
  }>;
  /** Stage 6 explicit semantic-loss ledger for the exact compiled program. */
  constraintProgramHash?: string;
  constraintLoss?: Array<{
    constraintIds: string[];
    disposition: "exact" | "conservative" | "post_route_check" | "unsupported";
    severity: "warning" | "error";
    message: string;
  }>;
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
  onLayers: DsnLayerName[]; // every layer crossed by the padstack
  startLayer: DsnLayerName;
  endLayer: DsnLayerName;
}

export interface DsnRule {
  scope: { kind: "default" } | { kind: "class"; classId: DsnClassId };
  widthNm: number;
  clearanceNm: number;
  viaCandidateName: string; // via ref used for via generation in this scope
  layerWidthsNm: Partial<Record<DsnLayerName, number>>;
}

export type DsnWiringItem =
  | {
      kind: "wire";
      layer: DsnLayerName;
      widthNm: number;
      startNm: Vec2Nm;
      endNm: Vec2Nm;
      netName: string;
    }
  | {
      kind: "via";
      viaName: string;
      atNm: Vec2Nm;
      netName: string;
    };
