export type SchComponentType =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "voltage-source"
  | "current-source"
  | "diode"
  | "ground";

export type Rotation = 0 | 90 | 180 | 270;

export type Point = { x: number; y: number };

export type SchComponent = {
  /**
   * B07 — IMMUTABLE stable instance identity (collection key, canonical
   * operation target, netlist/pcb-sync/binding scope). Never rewritten by a
   * rename. New components mint a UUID; AI-generated/imported schematics
   * keep their generator ids as stable ids.
   */
  id: string;
  type: SchComponentType;
  x: number;
  y: number;
  rotation: Rotation;
  value: string;
  /**
   * B07 — EDITABLE display reference (the user-visible designator). Display
   * everywhere is `refDes ?? id` — the deterministic legacy rule: records
   * predating this field display their stable id exactly as before, so no
   * data migration is required and reload never re-migrates. Renames write
   * ONLY this field. Normalization policy: trimmed, non-empty, unique among
   * theory components' display values.
   */
  refDes?: string;
  /** [PR-J, 2026-10-22] The schematic sheet this component is drawn on. Absent means the root sheet (`ROOT_SHEET_ID`); the value
   *  "root" is never written, so a single-sheet document keeps its exact bytes and digests. */
  sheetId?: string;
};

/** B07 — the user-visible designator of a theory component. */
export function schDisplayRef(component: Pick<SchComponent, "id" | "refDes">): string {
  return component.refDes ?? component.id;
}

/**
 * B07.1 — THE reference normalization authority. Display references are
 * stored trimmed; UNIQUENESS is decided over the case-normalized key across
 * every component sharing the exported schematic namespace (Theory display
 * values — refDes ?? id — AND KiCad refDes together): "R1" and "r1" are the
 * SAME exported reference and must never coexist.
 */
export function normalizeRefDes(value: string): string {
  return value.trim();
}

/** Case-insensitive uniqueness key for a display reference. */
export function refDesKey(value: string): string {
  return normalizeRefDes(value).toUpperCase();
}

export type Wire = {
  id: string;
  vertices: Point[];
  /** [PR-J, 2026-10-22] The schematic sheet the wire is drawn on; absent means the root sheet. */
  sheetId?: string;
};

// ─── Net labels ───────────────────────────────────────────────────────────────
// A net label is a text annotation that electrically connects every pin/wire
// sharing the same name — the standard EDA answer to wire spaghetti. Power and
// ground pins get labels instead of long wires to a global rail; high-fanout
// signals get one label per pin; the auto-router falls back to label pairs
// when a clean wire route doesn't exist.

export type NetLabelKind =
  | "label"     // generic text label, e.g. "MOSI", "CLK", "AUX1"
  | "power"     // power port — renders as upward flag with the name (e.g. "+3V3")
  | "ground";   // ground symbol — renders as the standard triangular glyph

export type NetLabel = {
  id: string;
  position: Point;                  // world coords, snapped to the 10px grid
  name: string;                     // e.g. "VCC", "+3V3", "GND", "MOSI"
  kind: NetLabelKind;
  orientation: Rotation;            // rotation of the glyph around its anchor
  /** [PR-J, 2026-10-22] The schematic sheet the label is drawn on; absent means the root sheet. */
  sheetId?: string;
  /** [PR-J, 2026-10-22] Connection scope (see `NetLabelScope`); absent means LOCAL: the label joins same-named labels on its own
   *  sheet only. Power and ground kinds are project rails by exact name whatever this says. */
  scope?: NetLabelScope;
  /** [PR-J, 2026-10-22] The `SheetPort` a "hierarchical" or "sheet-pin" label belongs to (by identity, never by name). */
  portId?: string;
  /** [PR-J, 2026-10-22] For a "sheet-pin" label: the child sheet whose block the pin sits on (the port's own sheet). */
  childSheetId?: string;
};

// Two labels with the same (case-insensitive) name belong to the same net.
export function netLabelNameKey(name: string): string {
  return name.trim().toUpperCase();
}

// Infer the label kind from a net name when the caller didn't specify one.
export function inferNetLabelKind(name: string): NetLabelKind {
  const n = netLabelNameKey(name);
  if (/^(GND\d*|0|VSS\d*|AGND|DGND|PGND|EGND)$/.test(n)) return "ground";
  if (/^(VCC\w*|VDD\w*|\+\d+V\d*|VBUS|VIN|V\+)$/.test(n)) return "power";
  return "label";
}

// A KiCad-sourced component placed on the canvas. Its static catalog data
// (name, pins, symbolRaw, datasheet, …) is NOT denormalized here — it is looked
// up by `partId` via the module-level parts cache (app/lib/parts-cache.ts), so
// the schematic state stays small and independent of the catalog version.
export type KicadComponentInstance = {
  id: string;          // unique on the canvas
  partId: string;      // FK to parts.id in the DB
  x: number;           // canvas coords, snapped to the 10px grid
  y: number;
  rotation: Rotation;
  refDes: string;      // user-facing reference designator, e.g. "U1", "R5"
  value: string;       // user-overridable display value
  /** Exact immutable Stage 5 identity. Absent means legacy/unresolved. */
  atomicPartRevisionId?: string;
  symbolAssetVersionId?: string;
  footprintAssetVersionId?: string;
  mappingCertificateId?: string;
  selectionRecordId?: string;
  /** [PR-J, 2026-10-22] The schematic sheet the WHOLE package is drawn on; absent means the root sheet. One package is one instance
   *  on one sheet: placing its units on different sheets is refused (SHEET_UNIT_SPLIT_UNSUPPORTED) until its own increment. */
  sheetId?: string;
};

// ─── Page size ─────────────────────────────────────────────────────────────────
// The sheet the canvas boundary draws and the KiCad export targets. The names
// match KiCad's own `(paper ...)` tokens 1:1 (A5/A4/A3/A2/A1/USLetter/USLegal),
// so the exporter emits the value verbatim. Dimensions are LANDSCAPE
// (width > height) in millimetres. The mm↔px conversion and fit logic live in
// app/lib/page-sizes.ts — kept out of this file so the type layer stays
// import-free (geometry.ts, which owns KICAD_SCALE_PX_PER_MM, imports from here).
export type PageSize = "A5" | "A4" | "A3" | "A2" | "A1" | "USLetter" | "USLegal";

export const PAGE_SIZES_MM: Record<PageSize, { widthMm: number; heightMm: number }> = {
  A5:       { widthMm: 210,   heightMm: 148   },
  A4:       { widthMm: 297,   heightMm: 210   },
  A3:       { widthMm: 420,   heightMm: 297   },
  A2:       { widthMm: 594,   heightMm: 420   },
  A1:       { widthMm: 841,   heightMm: 594   },
  USLetter: { widthMm: 279.4, heightMm: 215.9 },
  USLegal:  { widthMm: 355.6, heightMm: 215.9 },
};

// Title block — a fixed box KiCad draws in the bottom-right corner. We mirror it
// on the canvas so auto-layout keeps clear of it.
export const TITLE_BLOCK_MM = { widthMm: 130, heightMm: 30 };

// Default sheet for new projects and the migration fallback for older saves.
// KiCad's own default is A4 landscape, which matches the user's expectation.
export const DEFAULT_PAGE_SIZE: PageSize = "A4";

export function isPageSize(v: unknown): v is PageSize {
  return (
    v === "A5" || v === "A4" || v === "A3" || v === "A2" ||
    v === "A1" || v === "USLetter" || v === "USLegal"
  );
}

export type SchematicState = {
  components: SchComponent[];                    // existing Theory components
  wires: Wire[];
  // KiCad-sourced components (Build mode). Optional so older saved projects
  // and existing state constructors keep working; treat absence as [].
  kicadComponents?: KicadComponentInstance[];
  // Net labels. Optional for the same backward-compat reason; treat absence
  // as [].
  netLabels?: NetLabel[];
  // Sheet size for the canvas boundary + KiCad export. Optional for the same
  // backward-compat reason; treat absence as DEFAULT_PAGE_SIZE.
  pageSize?: PageSize;
  // [PR-J, 2026-10-22] The schematic sheet tree of a multi-sheet project (OD-255 item 1). ABSENT for a single-sheet project, whose
  // bytes, digests and exports stay exactly as before; present only while at least one child sheet exists.
  sheets?: SchematicSheetSet;
};

export type LogicalComponent = {
  id: string;
  type: SchComponentType;
  value: string;
};

export type LogicalConnection = {
  from: string;
  to: string;
};

export type LogicalNetlist = {
  components: LogicalComponent[];
  connections: LogicalConnection[];
  explanation: string;
};

// ─── Build-mode netlist (real KiCad parts) ─────────────────────────────────────
// Produced by /api/schematic/build. Unlike the Theory netlist (seven ideal
// types), every component here references a real catalog part by `partId`, and
// connections address pins by name OR number ("U1.GPIO0" / "U1.4"). The literal
// "GND" in a connection denotes the common ground rail; auto-layout materializes
// a ground symbol for it.

// Layout role of a Build-mode component. Drives zone-based auto-layout:
// inputs left, processors center, outputs right, power top-right, etc.
export type ComponentRole =
  | "input"          // joysticks, buttons, sensors, ADC sources
  | "processor"      // MCUs, microcontrollers, FPGAs, large ICs
  | "output"         // LEDs, displays, speakers, actuator drivers
  | "indicator"      // LEDs whose purpose is status (vs primary output)
  | "regulator"      // LDOs, switching regulators, power management
  | "source"         // batteries, power input connectors
  | "connector"      // pin headers, USB, JST
  | "passive"        // resistors, capacitors, inductors as standalone parts
  | "support";       // crystals, decoupling caps tied to a specific IC

export const COMPONENT_ROLES: readonly ComponentRole[] = [
  "input", "processor", "output", "indicator", "regulator",
  "source", "connector", "passive", "support",
];

// Coerce an untrusted role value (the AI occasionally free-texts it) into the
// union, inferring from the refDes prefix / pin count when it doesn't match.
export function normalizeComponentRole(
  role: unknown,
  refDes: string,
  pinCount: number,
): ComponentRole {
  if (typeof role === "string" && (COMPONENT_ROLES as readonly string[]).includes(role)) {
    return role as ComponentRole;
  }
  const prefix = (refDes.match(/^[A-Za-z]+/)?.[0] ?? "").toUpperCase();
  if (prefix === "J") return "connector";
  if (prefix === "SW") return "input";
  if (prefix === "Y") return "support"; // crystals; layout falls back to passive without a parent
  if (["R", "C", "L", "D", "FB"].includes(prefix)) return "passive";
  if (prefix === "U" || pinCount > 8) return "processor";
  return "passive";
}

export type BuildLogicalComponent = {
  refDes: string;          // e.g. "U1", "R1" — reference designator chosen by Claude
  partId: string;          // FK to parts.id, from a search_parts result
  value: string;           // display value, e.g. "10k" or "ESP32-WROOM-32"
  role: ComponentRole;     // layout zone assignment (see ComponentRole)
  parentRefDes?: string;   // for "support" components: the refDes of the owning IC
  /** Agent-selected exact revision; only persisted after user confirmation. */
  atomicPartRevisionId?: string;
};

// A Build-mode connection is either a literal wire between two pins, or a net
// label attached to one pin. Labels with the same name share an electrical net
// automatically — the AI uses them for power/ground distribution and
// high-fanout signals so the rendered schematic stays readable.
export type BuildLogicalWireConnection = {
  kind?: "wire";           // optional for backward compatibility — absent = wire
  from: string;            // "U1.GPIO0" or "U1.4" — refDes.pinNameOrNumber, or "GND"
  to: string;
};

export type BuildLogicalLabelConnection = {
  kind: "label";
  pin: string;             // "U1.GPIO0" / "U1.4" — the pin the label attaches to
  labelName: string;       // e.g. "GND", "+3V3", "MOSI"
  labelKind?: NetLabelKind; // defaults via inferNetLabelKind(labelName)
};

export type BuildLogicalConnection =
  | BuildLogicalWireConnection
  | BuildLogicalLabelConnection;

export function isLabelConnection(
  c: BuildLogicalConnection,
): c is BuildLogicalLabelConnection {
  return c.kind === "label";
}

export type BuildLogicalNetlist = {
  components: BuildLogicalComponent[];
  connections: BuildLogicalConnection[];
  explanation: string;
};

// ─── Tier-1 text editing (attribute-only, no topology change) ───────────────────
// Edits applied DIRECTLY to schematic state from a chat instruction — no
// re-layout, no netlist round-trip. `target` is the component's current
// refDes (Build) or id (Theory). Topology edits (add/rewire/rotate) are a
// separate, layout- and validator-aware tier.
export type SchematicEditOp =
  | { op: "set-value"; target: string; value: string }
  | { op: "rename"; target: string; refDes: string }
  | { op: "delete"; target: string };

export const PIN_NAMES: Record<SchComponentType, string[]> = {
  resistor: ["left", "right"],
  capacitor: ["left", "right"],
  inductor: ["left", "right"],
  diode: ["anode", "cathode"],
  "voltage-source": ["+", "-"],
  "current-source": ["+", "-"],
  ground: ["pin"],
};

export const PIN_OFFSETS: Record<SchComponentType, Record<string, Point>> = {
  resistor: { left: { x: -30, y: 0 }, right: { x: 30, y: 0 } },
  capacitor: { left: { x: -30, y: 0 }, right: { x: 30, y: 0 } },
  inductor: { left: { x: -30, y: 0 }, right: { x: 30, y: 0 } },
  diode: { anode: { x: -30, y: 0 }, cathode: { x: 30, y: 0 } },
  "voltage-source": { "+": { x: 0, y: -30 }, "-": { x: 0, y: 30 } },
  "current-source": { "+": { x: 0, y: -30 }, "-": { x: 0, y: 30 } },
  ground: { pin: { x: 0, y: -20 } },
};

// ─── [PR-J, 2026-10-22] Schematic sheets (runbook section J; OD-255) ───────────
// One project, one circuit, one PCB: a multi-sheet project is the SAME document with an optional sheet tree and an optional
// `sheetId` on every component, wire and label (absent = the root sheet). "Sheet" here is a SCHEMATIC sheet of the hierarchy;
// the page size (`pageSize`, `changeSheetSize`) keeps its existing meaning. The connection policy (local / global / power and
// ground / hierarchical) is implemented once, in app/lib/schematic/project-connectivity.ts; the structural contract in
// app/lib/schematic/sheets.ts.

/** The root (overview) sheet's id: a constant, never a random draw. Entities on the root carry NO `sheetId`. */
export const ROOT_SHEET_ID = "root" as const;

/** A label's connection scope. Absent = local to its sheet. "global": joins every global, power or ground label of the same name in
 *  the project. "hierarchical": the child-side anchor of a sheet port (joins its port's sheet pin only). "sheet-pin": the parent-side
 *  pin of a child sheet's port (joins that port only). Names never connect hierarchical labels or sheet pins. */
export type NetLabelScope = "global" | "hierarchical" | "sheet-pin";

/** Port direction: the CD-8 hierarchy vocabulary (`HierarchicalPortDefinition["direction"]`, app/lib/schematic-compiler/types.ts),
 *  asserted equal at compile time in app/lib/schematic/sheets.ts (this file stays import-free). */
export type SheetPortDirection = "input" | "output" | "bidirectional" | "passive" | "power_in" | "power_out";

/** A scalar interface signal of a child sheet. Bus / bundle ports are refused (SHEET_BUNDLE_UNSUPPORTED). */
export type SheetPort = {
  id: string;
  name: string;              // unique per sheet (case-normalized like net labels); display only, never a connection key
  direction: SheetPortDirection;
};

/** One schematic sheet. The root has `parentId: null`; every other sheet has exactly one parent (repeated instances refused).
 *  Siblings are ordered by their position in `SchematicSheetSet.sheets`. */
export type SchematicSheet = {
  id: string;
  name: string;
  parentId: string | null;
  /** The sheet symbol on the parent sheet (grid-aligned, positive size). Presentation only. */
  block?: { x: number; y: number; width: number; height: number };
  ports?: SheetPort[];
};

export type SchematicSheetSet = {
  version: 1;
  sheets: SchematicSheet[];
};

/** A child-side port anchor: a net label with scope "hierarchical" on the port's own sheet. */
export type HierarchicalLabel = NetLabel & { scope: "hierarchical"; portId: string };

/** A parent-side sheet pin: a net label with scope "sheet-pin" on the child's parent sheet, bound to exactly one port. */
export type SheetPin = NetLabel & { scope: "sheet-pin"; portId: string; childSheetId: string };
