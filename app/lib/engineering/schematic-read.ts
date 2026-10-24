/**
 * B09 — reusable, pure schematic READ accessor.
 *
 * `sirkit.schematic.inspect` was registered unbound in B04 because
 * schematic state lived only in page-level React state. Since B07.3 the
 * canonical-state envelope carries the authoritative schematic snapshot as
 * opaque JSON — this module is the proven reusable projection over it:
 * deterministic, compact, digest-stable, no React, no browser state, no
 * providers, no mutation. Malformed input fails closed with a structured
 * shape instead of fabricating a schematic.
 *
 * [PR-J5, 2026-10-23] Runbook J.6.7 (OD-259): the read is SHEET-AWARE. A document without a sheet tree, read without options, yields
 * exactly the 1.1.0 bytes. A document with a sheet tree adds a bounded `sheets.tree` (each sheet's id, name, parent, path, component
 * count and ports with their bound state) beside the unchanged whole-project lists. With `sheetId` the component and label lists are
 * ONE sheet's and `sheet` summarises it (its ports, local label names, child blocks); with `neighbours` the ports of the other sheets
 * that the project connectivity authority (app/lib/schematic/project-connectivity.ts) joins to its ports are fetched explicitly -
 * never every component of every sheet in every call. An unknown sheet id is a diagnostic over the tree, never a guess.
 */

import { ROOT_SHEET_ID, schDisplayRef, type SchematicState } from "@/lib/schematic-types";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { sheetOf, sheetPathName, sheetsOf } from "@/app/lib/schematic/sheets";
import { schematicStateDigest } from "./schematic-model";

/** [B19-D I5e row 25] identity strings a model reads are bounded; the full values stay in the project */
const INSPECTION_TEXT_CHARS = 256;
const bounded = (value: unknown): string => {
  const text = typeof value === "string" ? value : "";
  const points = Array.from(text);
  return points.length <= INSPECTION_TEXT_CHARS ? text : `${points.slice(0, INSPECTION_TEXT_CHARS - 1).join("")}…`;
};

/** [PR-J5] the read's options (the bound invoke passes the validated arguments; `readSchematicInspectOptions` reads them defensively). */
export interface SchematicInspectOptions {
  /** One sheet's bounded summary (its id; `root` is the overview). */
  sheetId?: string;
  /** With `sheetId`: fetch the ports of the other sheets the authority joins to this sheet's ports (an explicit neighbour read). */
  neighbours?: boolean;
}

export interface SchematicInspectionSheetSummary {
  id: string;
  name: string;
  parentId: string | null;
  /** "Power/Regulator" for a grandchild; "" for the root. */
  path: string;
  componentCount: number;
  ports: Array<{ name: string; direction: string; bound: boolean }>;
}

export interface SchematicInspectionPort { id: string; name: string; direction: string; bound: boolean; hierarchicalLabels: number; sheetPin: boolean }

export interface SchematicInspection {
  valid: boolean;
  /** Present only when the snapshot was structurally usable. */
  schematicDigest?: string;
  /** Whole-project counts, whatever the options (the sheet's own are under `sheet.counts`). */
  counts: { components: number; kicadComponents: number; wires: number; netLabels: number };
  /** Every component (no `sheetId`), or the asked sheet's components only. */
  components: Array<{ family: "theory" | "kicad"; id: string; displayRef: string; type: string; value: string; x: number; y: number }>;
  netLabels: Array<{ id: string; name: string }>;
  diagnostics: string[];
  /** [PR-J5] the sheet tree (a document with a sheet tree, or any read asked with `sheetId`). */
  sheets?: { tree: SchematicInspectionSheetSummary[]; note: string };
  /** [PR-J5] the asked sheet's bounded summary. */
  sheet?: {
    id: string;
    name: string;
    path: string;
    parentId: string | null;
    counts: { components: number; kicadComponents: number; wires: number; netLabels: number };
    ports: SchematicInspectionPort[];
    /** The names of the sheet's LOCAL labels (sorted, unique; they connect on this sheet only). */
    localLabels: string[];
    /** The child sheets drawn as blocks on this sheet. */
    childBlocks: Array<{ sheetId: string; name: string }>;
    /** Only with `neighbours`: for each of this sheet's ports, the other sheets' ports the authority joins to it. */
    neighbours?: Array<{ port: string; net: string | null; joins: Array<{ sheetId: string; sheetName: string; port: string }> }>;
  };
}

function isSchematicShape(value: unknown): value is SchematicState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return Array.isArray(state.components) && Array.isArray(state.wires);
}

/** [PR-J5] the validated tool arguments as options (anything else is ignored: a read never guesses). */
export function readSchematicInspectOptions(args: Record<string, unknown> | undefined): SchematicInspectOptions {
  const options: SchematicInspectOptions = {};
  if (args && typeof args.sheetId === "string" && args.sheetId.trim().length > 0) options.sheetId = args.sheetId.trim();
  if (args && args.neighbours === true) options.neighbours = true;
  return options;
}

type Projected = SchematicInspection["components"][number];

function projectComponents(schematic: SchematicState, sheetId: string | null): Projected[] {
  const theory = schematic.components.filter((component) => sheetId === null || sheetOf(component) === sheetId).map((component) => ({
    family: "theory" as const,
    id: bounded(component.id),
    displayRef: bounded(schDisplayRef(component)),
    type: component.type,
    value: bounded(component.value ?? ""),
    x: component.x,
    y: component.y,
  }));
  const kicad = (schematic.kicadComponents ?? []).filter((component) => sheetId === null || sheetOf(component) === sheetId).map((component) => ({
    family: "kicad" as const,
    id: bounded(component.id),
    displayRef: bounded(component.refDes),
    type: bounded(component.partId),
    value: bounded(component.value ?? ""),
    x: component.x,
    y: component.y,
  }));
  return [...theory, ...kicad].sort((a, b) => a.displayRef.localeCompare(b.displayRef) || a.id.localeCompare(b.id));
}

function projectLabels(schematic: SchematicState, sheetId: string | null): SchematicInspection["netLabels"] {
  return (schematic.netLabels ?? [])
    .filter((label) => sheetId === null || sheetOf(label) === sheetId)
    .map((label) => ({ id: bounded(label.id), name: bounded(label.name) }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** A port is bound when its child-side hierarchical label and its parent-side sheet pin both exist (names never connect them). */
function portsOf(schematic: SchematicState, sheet: { id: string; ports?: ReadonlyArray<{ id: string; name: string; direction: string }> }): SchematicInspectionPort[] {
  const labels = schematic.netLabels ?? [];
  return (sheet.ports ?? []).map((port) => {
    const hierarchicalLabels = labels.filter((label) => label.scope === "hierarchical" && label.portId === port.id && sheetOf(label) === sheet.id).length;
    const sheetPin = labels.some((label) => label.scope === "sheet-pin" && label.portId === port.id && label.childSheetId === sheet.id);
    return { id: bounded(port.id), name: bounded(port.name), direction: port.direction, bound: hierarchicalLabels > 0 && sheetPin, hierarchicalLabels, sheetPin };
  });
}

function treeOf(schematic: SchematicState): SchematicInspectionSheetSummary[] {
  const sheets = sheetsOf(schematic);
  return sheets.map((sheet) => ({
    id: bounded(sheet.id),
    name: bounded(sheet.name),
    parentId: sheet.parentId === null ? null : bounded(sheet.parentId),
    path: bounded(sheetPathName(schematic, sheet.id)),
    componentCount: schematic.components.filter((item) => sheetOf(item) === sheet.id).length + (schematic.kicadComponents ?? []).filter((item) => sheetOf(item) === sheet.id).length,
    ports: portsOf(schematic, sheet).map(({ name, direction, bound }) => ({ name, direction, bound })),
  }));
}

/** Compact, deterministic, sorted projection of the schematic snapshot. */
export function inspectSchematicState(schematic: unknown, options: SchematicInspectOptions = {}): SchematicInspection {
  if (!isSchematicShape(schematic)) {
    return {
      valid: false,
      counts: { components: 0, kicadComponents: 0, wires: 0, netLabels: 0 },
      components: [],
      netLabels: [],
      diagnostics: ["The supplied snapshot is not a structurally valid schematic; no facts are available."],
    };
  }
  const counts = {
    components: schematic.components.length,
    kicadComponents: (schematic.kicadComponents ?? []).length,
    wires: schematic.wires.length,
    netLabels: (schematic.netLabels ?? []).length,
  };
  const sheeted = schematic.sheets !== undefined;
  const sheetId = options.sheetId;
  if (sheetId === undefined) {
    const base: SchematicInspection = { valid: true, schematicDigest: schematicStateDigest(schematic), counts, components: projectComponents(schematic, null), netLabels: projectLabels(schematic, null), diagnostics: [] };
    // a single-sheet document without options: the 1.1.0 bytes exactly (no new key)
    if (!sheeted) return base;
    return { ...base, sheets: { tree: treeOf(schematic), note: "The lists above cover the whole project; ask with sheetId for one sheet's parts, labels and ports (neighbours: true adds the other sheets' ports joined to them)." } };
  }
  const tree = treeOf(schematic);
  const sheet = sheetsOf(schematic).find((item) => item.id === sheetId);
  if (!sheet) {
    return {
      valid: true,
      schematicDigest: schematicStateDigest(schematic),
      counts,
      components: [],
      netLabels: [],
      diagnostics: [`Sheet ${bounded(sheetId)} does not exist; the sheets are ${tree.map((item) => `${item.name} (${item.id})`).join(", ")}. No sheet was guessed.`],
      sheets: { tree, note: "Ask again with one of the listed sheet ids." },
    };
  }
  const labels = (schematic.netLabels ?? []).filter((label) => sheetOf(label) === sheet.id);
  const summary: NonNullable<SchematicInspection["sheet"]> = {
    id: bounded(sheet.id),
    name: bounded(sheet.name),
    path: bounded(sheetPathName(schematic, sheet.id)),
    parentId: sheet.parentId === null ? null : bounded(sheet.parentId),
    counts: {
      components: schematic.components.filter((item) => sheetOf(item) === sheet.id).length,
      kicadComponents: (schematic.kicadComponents ?? []).filter((item) => sheetOf(item) === sheet.id).length,
      wires: schematic.wires.filter((item) => sheetOf(item) === sheet.id).length,
      netLabels: labels.length,
    },
    ports: portsOf(schematic, sheet),
    localLabels: [...new Set(labels.filter((label) => label.scope === undefined).map((label) => bounded(label.name)))].sort((a, b) => a.localeCompare(b)),
    childBlocks: sheetsOf(schematic).filter((item) => item.parentId === sheet.id).map((item) => ({ sheetId: bounded(item.id), name: bounded(item.name) })),
  };
  const diagnostics: string[] = [];
  if (options.neighbours === true) {
    if (!sheeted || sheet.id === ROOT_SHEET_ID && (sheet.ports ?? []).length === 0) {
      summary.neighbours = [];
      diagnostics.push(sheeted ? "The overview has no ports of its own; its connections to the child sheets are their ports (ask with a child sheet's id)." : "A single-sheet document has no neighbouring sheets.");
    } else {
      // the ONE connectivity authority (no catalog pins here: the labels, ports, sheet pins and wires decide which ports join)
      const connectivity = resolveProjectConnectivity(schematic);
      const byId = new Map(sheetsOf(schematic).map((item) => [item.id, item]));
      const portOwner = new Map(sheetsOf(schematic).flatMap((item) => (item.ports ?? []).map((port) => [port.id, { sheetId: item.id, sheetName: item.name, port: port.name }] as const)));
      summary.neighbours = (sheet.ports ?? []).map((port) => {
        const net = connectivity.nets.find((candidate) => candidate.portIds.includes(port.id)) ?? null;
        const joins = (net?.portIds ?? []).filter((portId) => portId !== port.id).map((portId) => portOwner.get(portId)).filter((owner): owner is NonNullable<typeof owner> => owner !== undefined && owner.sheetId !== sheet.id)
          .map((owner) => ({ sheetId: bounded(owner.sheetId), sheetName: bounded(byId.get(owner.sheetId)?.name ?? owner.sheetName), port: bounded(owner.port) }))
          .sort((a, b) => a.sheetId.localeCompare(b.sheetId) || a.port.localeCompare(b.port));
        return { port: bounded(port.name), net: net?.name === undefined || net.name === null ? null : bounded(net.name), joins };
      });
      if (!connectivity.ok) diagnostics.push(`The connectivity authority reports ${connectivity.diagnostics.filter((item) => item.severity === "error").map((item) => item.code).join(", ")}; the neighbour list is what its labels and ports still join.`);
    }
  }
  return {
    valid: true,
    schematicDigest: schematicStateDigest(schematic),
    counts,
    components: projectComponents(schematic, sheet.id),
    netLabels: projectLabels(schematic, sheet.id),
    diagnostics,
    sheets: { tree, note: `The component and label lists are sheet ${bounded(sheet.name)}'s only; the counts are the whole project's.` },
    sheet: summary,
  };
}
