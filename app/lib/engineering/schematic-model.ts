/**
 * B06 — versioned canonical schematic model.
 *
 * The smallest typed representation the canonical executor needs: it
 * preserves the EXACT identities and semantics the current product depends
 * on (see the B06 discovery inventory):
 *
 *  - component instance identity: `SchComponent.id` / `KicadComponentInstance.id`
 *    (downstream: netlist component id, pcb-sync componentInstanceId, and the
 *    physical-binding scope key — refDes is display-only everywhere);
 *  - component-authority identity: the optional Stage-5 fields on
 *    KicadComponentInstance (atomicPartRevisionId, symbolAssetVersionId,
 *    footprintAssetVersionId, mappingCertificateId, selectionRecordId);
 *  - symbol/library identity: `partId` (catalog FK; static data is looked up,
 *    never denormalized);
 *  - value + refDes as the editable properties; position/rotation (the
 *    schematic model has NO mirror state — verified against the code);
 *  - wires as coordinate-attached polylines and net labels as name-keyed
 *    annotations (net membership is DERIVED geometrically, never stored).
 *
 * The UI `SchematicState` and this model differ only in optionality — the
 *  adapters normalize, they do not rewrite the editor.
 */

import { refDesKey, schDisplayRef, type KicadComponentInstance, type NetLabel, type SchComponent, type SchematicSheetSet, type SchematicState, type Wire } from "@/lib/schematic-types";
import { validateSchematicPoint, validateSchematicRotation, validateSchematicWireVertices } from "./schematic-geometry";
import { engineeringDigest } from "./stable";
import { validateSheetHierarchy } from "@/app/lib/schematic/sheets";

export const CANONICAL_SCHEMATIC_SCHEMA = "sirkit.schematic.v1" as const;
/** [PR-J, 2026-10-22] The multi-sheet model (OD-255 item 1): written ONLY when the document has a sheet tree, so every single-sheet
 *  document stays "sirkit.schematic.v1" with its exact digest, and a reader without sheet support refuses a multi-sheet document
 *  (unsupported schemaVersion -> the explicit recovery path) instead of silently flattening it. */
export const CANONICAL_SCHEMATIC_SCHEMA_V2 = "sirkit.schematic.v2" as const;

export interface CanonicalSchematic {
  schemaVersion: typeof CANONICAL_SCHEMATIC_SCHEMA | typeof CANONICAL_SCHEMATIC_SCHEMA_V2;
  components: SchComponent[];
  kicadComponents: KicadComponentInstance[];
  wires: Wire[];
  netLabels: NetLabel[];
  /** Sheet size travels with the model but is not an undoable mutation. */
  pageSize?: string;
  /** [PR-J, 2026-10-22] The schematic sheet tree: present exactly when schemaVersion is v2. */
  sheets?: SchematicSheetSet;
}

/** Normalize the UI state into the canonical model (optionals → []). */
export function toCanonicalSchematic(state: SchematicState): CanonicalSchematic {
  return {
    schemaVersion: state.sheets === undefined ? CANONICAL_SCHEMATIC_SCHEMA : CANONICAL_SCHEMATIC_SCHEMA_V2,
    components: structuredClone(state.components),
    kicadComponents: structuredClone(state.kicadComponents ?? []),
    wires: structuredClone(state.wires),
    netLabels: structuredClone(state.netLabels ?? []),
    ...(state.pageSize ? { pageSize: state.pageSize } : {}),
    ...(state.sheets !== undefined ? { sheets: structuredClone(state.sheets) } : {}),
  };
}

/** Project the canonical model back into the UI state shape. */
export function fromCanonicalSchematic(canonical: CanonicalSchematic): SchematicState {
  return {
    components: structuredClone(canonical.components),
    wires: structuredClone(canonical.wires),
    kicadComponents: structuredClone(canonical.kicadComponents),
    netLabels: structuredClone(canonical.netLabels),
    ...(canonical.pageSize ? { pageSize: canonical.pageSize as SchematicState["pageSize"] } : {}),
    ...(canonical.sheets !== undefined ? { sheets: structuredClone(canonical.sheets) } : {}),
  };
}

const THEORY_TYPES = new Set(["resistor", "capacitor", "inductor", "diode", "voltage-source", "current-source", "ground"]);

/**
 * B07.1 — THE shared canonical schematic validator, used by the parsing
 * reader (hydration, every operation's model access) and by the
 * post-transaction candidate check. It rejects, with named issues:
 *
 *  - wrong schema version or malformed collection shapes;
 *  - duplicate stable ids within Theory, within KiCad, and ACROSS the two
 *    families (an ambiguous operation target must be impossible);
 *  - duplicate wire ids and net-label ids;
 *  - invalid component types, rotations, and label orientations;
 *  - invalid or duplicate display references (case-normalized, across the
 *    whole exported namespace: Theory `refDes ?? id` + KiCad `refDes`);
 *  - off-contract geometry (finite, safe-integer, grid-aligned, in-bounds
 *    coordinates; well-formed wire vertex arrays; non-empty label names).
 */
export function validateCanonicalSchematic(value: unknown): string[] {
  if (typeof value !== "object" || value === null) return ["SCHEMA: not an object"];
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== CANONICAL_SCHEMATIC_SCHEMA && candidate.schemaVersion !== CANONICAL_SCHEMATIC_SCHEMA_V2) return [`SCHEMA: unsupported schemaVersion ${String(candidate.schemaVersion)}`];
  if (!Array.isArray(candidate.components) || !Array.isArray(candidate.kicadComponents) || !Array.isArray(candidate.wires) || !Array.isArray(candidate.netLabels)) {
    return ["SCHEMA: components/kicadComponents/wires/netLabels must all be arrays"];
  }
  const issues: string[] = [];
  const stableIds = new Set<string>();
  const displayKeys = new Set<string>();

  (candidate.components as unknown[]).forEach((raw, index) => {
    const at = `components[${index}]`;
    if (typeof raw !== "object" || raw === null) { issues.push(`SCHEMA: ${at} is not an object`); return; }
    const item = raw as Partial<SchComponent>;
    if (typeof item.id !== "string" || item.id.length === 0) { issues.push(`IDENTITY: ${at} has no stable id`); return; }
    if (stableIds.has(item.id)) issues.push(`IDENTITY: duplicate stable id ${item.id}`);
    stableIds.add(item.id);
    if (typeof item.type !== "string" || !THEORY_TYPES.has(item.type)) issues.push(`SCHEMA: ${at} has invalid type ${String(item.type)}`);
    if (typeof item.value !== "string") issues.push(`SCHEMA: ${at} has no value string`);
    if (item.refDes !== undefined && (typeof item.refDes !== "string" || item.refDes.trim().length === 0)) issues.push(`REFERENCE: ${at} has an invalid display reference`);
    const display = typeof item.refDes === "string" ? item.refDes : item.id;
    const key = refDesKey(display);
    if (displayKeys.has(key)) issues.push(`REFERENCE: duplicate display reference ${display}`);
    displayKeys.add(key);
    issues.push(...validateSchematicPoint({ x: item.x, y: item.y }, at));
    issues.push(...validateSchematicRotation(item.rotation, `${at}.rotation`));
  });

  (candidate.kicadComponents as unknown[]).forEach((raw, index) => {
    const at = `kicadComponents[${index}]`;
    if (typeof raw !== "object" || raw === null) { issues.push(`SCHEMA: ${at} is not an object`); return; }
    const item = raw as Partial<KicadComponentInstance>;
    if (typeof item.id !== "string" || item.id.length === 0) { issues.push(`IDENTITY: ${at} has no stable id`); return; }
    if (stableIds.has(item.id)) issues.push(`IDENTITY: duplicate stable id ${item.id} (cross-family collisions included)`);
    stableIds.add(item.id);
    if (typeof item.partId !== "string" || item.partId.length === 0) issues.push(`SCHEMA: ${at} has no partId`);
    if (typeof item.refDes !== "string" || item.refDes.trim().length === 0) { issues.push(`REFERENCE: ${at} has no display reference`); }
    else {
      const key = refDesKey(item.refDes);
      if (displayKeys.has(key)) issues.push(`REFERENCE: duplicate display reference ${item.refDes}`);
      displayKeys.add(key);
    }
    if (typeof item.value !== "string") issues.push(`SCHEMA: ${at} has no value string`);
    issues.push(...validateSchematicPoint({ x: item.x, y: item.y }, at));
    issues.push(...validateSchematicRotation(item.rotation, `${at}.rotation`));
  });

  const wireIds = new Set<string>();
  (candidate.wires as unknown[]).forEach((raw, index) => {
    const at = `wires[${index}]`;
    if (typeof raw !== "object" || raw === null) { issues.push(`SCHEMA: ${at} is not an object`); return; }
    const item = raw as Partial<Wire>;
    if (typeof item.id !== "string" || item.id.length === 0) { issues.push(`IDENTITY: ${at} has no id`); return; }
    if (wireIds.has(item.id)) issues.push(`IDENTITY: duplicate wire id ${item.id}`);
    wireIds.add(item.id);
    issues.push(...validateSchematicWireVertices(item.vertices, `${at}.vertices`));
  });

  const labelIds = new Set<string>();
  (candidate.netLabels as unknown[]).forEach((raw, index) => {
    const at = `netLabels[${index}]`;
    if (typeof raw !== "object" || raw === null) { issues.push(`SCHEMA: ${at} is not an object`); return; }
    const item = raw as Partial<NetLabel>;
    if (typeof item.id !== "string" || item.id.length === 0) { issues.push(`IDENTITY: ${at} has no id`); return; }
    if (labelIds.has(item.id)) issues.push(`IDENTITY: duplicate net-label id ${item.id}`);
    labelIds.add(item.id);
    if (typeof item.name !== "string" || item.name.trim().length === 0) issues.push(`SCHEMA: ${at} has an empty name`);
    issues.push(...validateSchematicPoint(item.position, `${at}.position`));
    issues.push(...validateSchematicRotation(item.orientation, `${at}.orientation`));
  });

  // [PR-J, 2026-10-22] the sheet contract (OD-255 item 1): v1 never carries a sheet tree (nor any sheet reference); v2 always carries
  // a valid, non-trivial one. Structural errors refuse the document with their named code; findings (unbound ports) do not.
  if (candidate.schemaVersion === CANONICAL_SCHEMATIC_SCHEMA && candidate.sheets !== undefined) issues.push("SHEETS: SHEET_SET_INVALID a sirkit.schematic.v1 document carries no sheet tree (sheets require sirkit.schematic.v2)");
  if (candidate.schemaVersion === CANONICAL_SCHEMATIC_SCHEMA_V2 && candidate.sheets === undefined) issues.push("SHEETS: SHEET_SET_INVALID a sirkit.schematic.v2 document must carry its sheet tree");
  if (issues.length === 0) {
    for (const item of validateSheetHierarchy(candidate as unknown as SchematicState)) if (item.severity === "error") issues.push(`SHEETS: ${item.code} ${item.message}`);
  }

  return issues;
}

/** UI-state validation via canonical normalization (adapter symmetry). */
export function validateSchematicStateIntegrity(state: SchematicState): string[] {
  return validateCanonicalSchematic(toCanonicalSchematic(state));
}

/**
 * Validating reader for the executor's opaque `project.schematic` slot.
 * Returns null (never guesses) when the value is not a VALID canonical
 * schematic — including identity-ambiguous or off-contract models (B07.1) —
 * schematic operations then fail closed with SCHEMATIC_MODEL_UNAVAILABLE and
 * hydration enters the explicit recovery path.
 */
export function parseCanonicalSchematic(value: unknown): CanonicalSchematic | null {
  return validateCanonicalSchematic(value).length === 0 ? (value as CanonicalSchematic) : null;
}

/** Re-export for consumer convenience (single display authority). */
export { refDesKey, schDisplayRef };

/** Deterministic content digest of the semantic schematic state. */
export function schematicSemanticDigest(canonical: CanonicalSchematic): string {
  return engineeringDigest({ schema: "sirkit.schematic-digest.v1", schematic: canonical });
}

/** Digest of a UI state via canonical normalization (adapter symmetry). */
export function schematicStateDigest(state: SchematicState): string {
  return schematicSemanticDigest(toCanonicalSchematic(state));
}
