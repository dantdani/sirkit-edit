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
