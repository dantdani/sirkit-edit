/**
 * [PR-L6, 2026-10-19] Runbook M.4 / M.5 item 7 (OD-253 item 8): is the DURABLE board behind the schematic?
 *
 * One pure comparator of the schematic's exact component identities against the board's synchronization identity, keyed by the
 * stable component instance id (a reference designator is display only: a renamed R1, or a board `ref` that differs from the
 * schematic's, never misattributes). It is DERIVED FROM FACTS on every read - the schematic as it stands and the durable board record
 * as the server holds it - so Undo, Redo, a reload or a later Prepare PCB recompute it; nothing here is a sticky flag, and no receipt
 * or commit status is ever read (the B18-D lesson: read the board, not the commit status).
 *
 * The categories, per stable component instance id:
 *  - `changed`: on the board, and the schematic instance's footprint asset version, pin-pad mapping certificate or symbol asset
 *    version differs from the footprint's `syncIdentity` (a replaced or re-resolved part the board still carries in its old form);
 *  - `unresolved`: on the board, and the schematic instance lost its exact identity (no published exact revision or no symbol asset -
 *    e.g. the resolution that put it on the board was undone);
 *  - `missing-from-board`: a resolved schematic instance absent from a board that already carries at least one synchronized footprint
 *    (a part added after the board);
 *  - `removed-from-schematic`: a synchronized footprint whose component instance no longer exists in the schematic.
 * Board-only footprints (no `syncIdentity`) are never compared (they cannot be proven against the schematic), and a board with no
 * synchronized footprint at all has no drift (nothing was ever synchronized to it).
 *
 * The identity domains agree by construction: a KiCad instance's `footprintAssetVersionId` / `mappingCertificateId` /
 * `symbolAssetVersionId` come from its published revision's CAD bundle, and the board's `syncIdentity` from the physical binding of the
 * same revision (the footprint version and the mapping certificate of that bundle) plus the published symbol asset; the domain-guard
 * test (m4-schematic-drift) proves a freshly synchronized board has ZERO drift.
 *
 * Pure Stage 3 code: reads the schematic state and the board only - no part cache, no network, no DOM, no Stage 4 bridge.
 */
import type { SchematicState } from "@/lib/schematic-types";
import { normalizeRefDes, schDisplayRef } from "@/lib/schematic-types";
import type { FootprintInstance, PcbBoard } from "../pcb/types";
import { compareCodePoints } from "@/app/lib/stable-compare";

export type SchematicDriftKind = "changed" | "unresolved" | "missing-from-board" | "removed-from-schematic";
export type SchematicIdentityField = "footprintAssetVersionId" | "mappingCertificateId" | "symbolAssetVersionId";
export const SCHEMATIC_IDENTITY_FIELDS: readonly SchematicIdentityField[] = Object.freeze(["footprintAssetVersionId", "mappingCertificateId", "symbolAssetVersionId"]);

export interface SchematicDriftItem {
  /** The stable identity (the schematic instance id = the board footprint's `syncIdentity.componentInstanceId`). */
  componentInstanceId: string;
  kind: SchematicDriftKind;
  /** The board footprint's displayed reference, when the instance is on the board. */
  boardRef: string | null;
  /** The schematic's displayed reference, when the instance is in the schematic. */
  schematicRefDes: string | null;
  /** `changed` only: which exact identities differ (always non-empty for `changed`). */
  fields: SchematicIdentityField[];
}

export interface SchematicDrift {
  items: SchematicDriftItem[];
  counts: Record<SchematicDriftKind, number>;
  /** The board's synchronized footprints (0 = nothing was ever synchronized: no drift by definition). */
  syncedFootprints: number;
}

/** The exact identity a schematic instance carries (all optional: a legacy or unresolved instance lacks them). */
export interface SchematicExactIdentity { symbolAssetVersionId?: string | null; footprintAssetVersionId?: string | null; mappingCertificateId?: string | null }

/**
 * THE shared identity comparator: the fields in which a schematic instance's exact identity differs from a board footprint's
 * synchronization identity. Empty = the board carries exactly this identity.
 */
export function syncIdentityDifferences(instance: SchematicExactIdentity, sync: NonNullable<FootprintInstance["syncIdentity"]>): SchematicIdentityField[] {
  return SCHEMATIC_IDENTITY_FIELDS.filter((field) => (instance[field] ?? null) !== sync[field]);
}

/** A KiCad instance is resolved for the board when it carries a published exact revision and its installed symbol asset (the
 *  unresolved-instances.ts rule Prepare PCB refuses by). */
function kicadResolved(instance: { atomicPartRevisionId?: string; symbolAssetVersionId?: string }): boolean {
  return Boolean(instance.atomicPartRevisionId) && Boolean(instance.symbolAssetVersionId);
}

const EMPTY_COUNTS = (): Record<SchematicDriftKind, number> => ({ changed: 0, unresolved: 0, "missing-from-board": 0, "removed-from-schematic": 0 });

/** The board's drift behind the schematic, derived from the two facts alone. Deterministic: items ordered by stable id, then kind. */
export function boardSchematicDrift(state: SchematicState | null | undefined, board: PcbBoard | null | undefined): SchematicDrift {
  const counts = EMPTY_COUNTS();
  const synced = new Map<string, FootprintInstance>();
  for (const footprint of board?.footprints ?? []) {
    const id = footprint.syncIdentity?.componentInstanceId;
    if (id && !synced.has(id)) synced.set(id, footprint);
  }
  if (!state || synced.size === 0) return { items: [], counts, syncedFootprints: synced.size };
  const items: SchematicDriftItem[] = [];
  const present = new Set<string>();
  for (const instance of state.kicadComponents ?? []) {
    present.add(instance.id);
    const footprint = synced.get(instance.id);
    if (!footprint) {
      if (kicadResolved(instance)) items.push({ componentInstanceId: instance.id, kind: "missing-from-board", boardRef: null, schematicRefDes: instance.refDes, fields: [] });
      continue;
    }
    if (!kicadResolved(instance)) { items.push({ componentInstanceId: instance.id, kind: "unresolved", boardRef: footprint.ref, schematicRefDes: instance.refDes, fields: [] }); continue; }
    const fields = syncIdentityDifferences(instance, footprint.syncIdentity!);
    if (fields.length > 0) items.push({ componentInstanceId: instance.id, kind: "changed", boardRef: footprint.ref, schematicRefDes: instance.refDes, fields });
  }
  for (const component of state.components ?? []) {
    present.add(component.id);
    // A Theory symbol never carries an exact identity: on the board it can only be a part that lost its identity.
    const footprint = synced.get(component.id);
    if (footprint) items.push({ componentInstanceId: component.id, kind: "unresolved", boardRef: footprint.ref, schematicRefDes: normalizeRefDes(schDisplayRef(component)), fields: [] });
  }
  for (const [id, footprint] of synced) if (!present.has(id)) items.push({ componentInstanceId: id, kind: "removed-from-schematic", boardRef: footprint.ref, schematicRefDes: null, fields: [] });
  items.sort((a, b) => compareCodePoints(a.componentInstanceId, b.componentInstanceId) || compareCodePoints(a.kind, b.kind));
  for (const item of items) counts[item.kind] += 1;
  return { items, counts, syncedFootprints: synced.size };
}

/** How many references a drift sentence names before "…". */
export const DRIFT_SENTENCE_REFS = 5;

const KIND_WORDS: Readonly<Record<SchematicDriftKind, string>> = Object.freeze({
  changed: "replaced in the schematic",
  unresolved: "without an exact part in the schematic",
  "missing-from-board": "not on the board yet",
  "removed-from-schematic": "removed from the schematic",
});

function named(drift: SchematicDrift): string {
  const refs = drift.items.slice(0, DRIFT_SENTENCE_REFS).map((item) => `${item.schematicRefDes ?? item.boardRef ?? item.componentInstanceId.slice(0, 24)} (${KIND_WORDS[item.kind]})`);
  return `${refs.join(", ")}${drift.items.length > DRIFT_SENTENCE_REFS ? `, and ${drift.items.length - DRIFT_SENTENCE_REFS} more` : ""}`;
}

/** The persistent notice beside the route-stale notice, or null when the board is not behind the schematic. */
export function boardBehindSchematicNotice(drift: SchematicDrift | null): string | null {
  if (!drift || drift.items.length === 0) return null;
  return `The board is behind the schematic: ${drift.items.length} part(s) differ - ${named(drift)}. Placement, routing, DRC, qualification and any release evidence are stale for these parts; run Prepare PCB to bring the board up to date.${rebindClause(drift)}`; // [PR-L6 integration, 2026-10-19] BI-2: + what a replaced part on a bound board needs
}

/**
 * The in-page manufacturing gate (OD-253 item 8): qualification and release are refused while the board is behind the schematic.
 * Null = no refusal. A client-side gate only: the server-side schematic-currency guard on qualify / release is an open owner
 * decision, so this never claims the server refused.
 */
export function manufacturingGateRefusal(action: "qualify" | "release", drift: SchematicDrift | null): string | null {
  if (!drift || drift.items.length === 0) return null;
  const verb = action === "qualify" ? "Qualification" : "Release";
  return `${verb} refused: the board is behind the schematic (${named(drift)}). Run Prepare PCB first so the board carries the schematic's exact parts; nothing was sent.${rebindClause(drift)}`; // [PR-L6 integration, 2026-10-19] BI-2
}

// [PR-L6 integration, 2026-10-19] BI-2 (the fixture-board review of increment 6), appended after the last line (declarations are hoisted):
// a `changed` part is one the board carries under ANOTHER bound revision. Prepare PCB's bind step is refused while that earlier binding is
// in effect (PB_ACTIVE_SELECTION_CONFLICT; the page has no control that supersedes it - board-impact.ts says the same at Approve), so the
// persistent notice and the gate refusals must not send the user only to Prepare PCB. Conditional on purpose: a binding a reviewer has
// already superseded (the successor flow) can be bound anew, and then Prepare PCB succeeds.
/** What a part on a bound board needs when Prepare PCB's bind is refused because the earlier binding still holds (the PcbEditor bind failure). */
export const BOARD_REBIND_REFUSAL = "the board carries it under an earlier bound revision, so it is re-bound only once that binding no longer holds: Undo the replacement to restore the bound part, or have a reviewer supersede the binding in the Component review panel";
/** The sentence a notice or gate refusal adds when the drift has `changed` parts ("" when none). */
function rebindClause(drift: SchematicDrift): string {
  const changed = drift.items.filter((item) => item.kind === "changed");
  if (changed.length === 0) return "";
  const refs = `${changed.slice(0, DRIFT_SENTENCE_REFS).map((item) => item.schematicRefDes ?? item.boardRef ?? item.componentInstanceId.slice(0, 24)).join(", ")}${changed.length > DRIFT_SENTENCE_REFS ? `, and ${changed.length - DRIFT_SENTENCE_REFS} more` : ""}`;
  return ` Prepare PCB re-binds ${refs} only once the earlier binding no longer holds (while it does, the bind is refused: PB_ACTIVE_SELECTION_CONFLICT): Undo the replacement to restore the bound part, or have a reviewer supersede the binding in the Component review panel.`;
}
