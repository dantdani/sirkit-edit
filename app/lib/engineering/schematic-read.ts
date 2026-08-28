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
 */

import { schDisplayRef, type SchematicState } from "@/lib/schematic-types";
import { schematicStateDigest } from "./schematic-model";

export interface SchematicInspection {
  valid: boolean;
  /** Present only when the snapshot was structurally usable. */
  schematicDigest?: string;
  counts: { components: number; kicadComponents: number; wires: number; netLabels: number };
  components: Array<{ family: "theory" | "kicad"; id: string; displayRef: string; type: string; value: string; x: number; y: number }>;
  netLabels: Array<{ id: string; name: string }>;
  diagnostics: string[];
}

function isSchematicShape(value: unknown): value is SchematicState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return Array.isArray(state.components) && Array.isArray(state.wires);
}

/** Compact, deterministic, sorted projection of the schematic snapshot. */
export function inspectSchematicState(schematic: unknown): SchematicInspection {
  if (!isSchematicShape(schematic)) {
    return {
      valid: false,
      counts: { components: 0, kicadComponents: 0, wires: 0, netLabels: 0 },
      components: [],
      netLabels: [],
      diagnostics: ["The supplied snapshot is not a structurally valid schematic; no facts are available."],
    };
  }
  const theory = schematic.components.map((component) => ({
    family: "theory" as const,
    id: component.id,
    displayRef: schDisplayRef(component),
    type: component.type,
    value: component.value ?? "",
    x: component.x,
    y: component.y,
  }));
  const kicad = (schematic.kicadComponents ?? []).map((component) => ({
    family: "kicad" as const,
    id: component.id,
    displayRef: component.refDes,
    type: component.partId,
    value: component.value ?? "",
    x: component.x,
    y: component.y,
  }));
  const components = [...theory, ...kicad].sort((a, b) => a.displayRef.localeCompare(b.displayRef) || a.id.localeCompare(b.id));
  const netLabels = (schematic.netLabels ?? [])
    .map((label) => ({ id: label.id, name: label.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    valid: true,
    schematicDigest: schematicStateDigest(schematic),
    counts: {
      components: schematic.components.length,
      kicadComponents: (schematic.kicadComponents ?? []).length,
      wires: schematic.wires.length,
      netLabels: (schematic.netLabels ?? []).length,
    },
    components,
    netLabels,
    diagnostics: [],
  };
}
