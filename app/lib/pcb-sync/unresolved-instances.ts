/**
 * [PR-C F-08] The instances a Schematic → PCB run cannot carry to the board, named BEFORE any server call.
 *
 * The durable sync publishes every physical component with a symbol asset (`buildPcbSyncPublicationGraph`, the Stage 4
 * bridge in app/lib/pcb/): a KiCad instance publishes its installed `symbolAssetVersionId`, a Theory part a synthetic
 * `sirkit.theory-symbol:<prefix>:v1`. Until this module the editor learned of an unresolved instance only afterwards — as a bare
 * `PS_SYMBOL_ASSET_REQUIRED` thrown inside the publish port (naming no instance), or as the preflight's `PS_COMPONENT_UNRESOLVED`
 * blockers — in both cases AFTER the physical bindings had already committed durable server state. This pure listing lets
 * `handleSync` refuse first and fail closed (nothing bound, nothing published), saying which part is missing what and where that
 * fact is reviewed.
 *
 * The rules mirror the production bridge exactly:
 *  - a KiCad instance without `atomicPartRevisionId` has no published exact revision (nothing to bind, nothing to publish; the
 *    editor's bind filter skips it with the same `Boolean(...)` test);
 *  - a KiCad instance with a revision but without `symbolAssetVersionId` throws `PS_SYMBOL_ASSET_REQUIRED` at publication;
 *  - a Theory component that is a physical part (`theoryPinContract` — THE shared physicality rule: R/C/L/D; ground symbols and
 *    voltage/current sources are sim stimuli with no footprint and never reach the board) publishes a synthetic symbol that no
 *    physical package backs, so the preflight resolves it as `PS_COMPONENT_UNRESOLVED`.
 *
 * Pure: reads the schematic state only — no part cache, no network, no DOM.
 */
import type { SchematicState } from "@/lib/schematic-types";
import { normalizeRefDes, schDisplayRef } from "@/lib/schematic-types";
import { theoryPinContract } from "@/app/lib/schematic/theory-physicality"; // [PR-G, 2026-10-17] the shared rule's own module, not the Stage 4 bridge (forbidden in Stage 3 code)
import { compareNatural } from "@/app/lib/stable-compare";

export type UnresolvedInstanceFamily = "kicad" | "theory";
export type UnresolvedInstanceMissing = "published_exact_revision" | "symbol_asset" | "theory_symbol_only";

export interface UnresolvedInstance {
  /** The displayed reference (KiCad `refDes`; Theory `refDes ?? id`, normalized as the netlist publishes it). */
  refDes: string;
  family: UnresolvedInstanceFamily;
  /** The one fact the board needs and the instance lacks. */
  missing: UnresolvedInstanceMissing;
  /** Where that fact is produced — the step the user (or a reviewer) can actually take. */
  reviewPath: string;
}

/** The review path per missing fact (one sentence each, shown verbatim in the list). */
export const UNRESOLVED_REVIEW_PATH: Readonly<Record<UnresolvedInstanceMissing, string>> = Object.freeze({
  published_exact_revision: "Build Library → the part → Use published exact revision, or request a reviewer to publish one",
  symbol_asset: "re-place the part from its published revision",
  theory_symbol_only: "a Theory symbol has no physical package: place the catalog part with a published revision instead",
});

/** The missing fact, worded for the list row. */
export const UNRESOLVED_MISSING_LABEL: Readonly<Record<UnresolvedInstanceMissing, string>> = Object.freeze({
  published_exact_revision: "no published exact revision",
  symbol_asset: "published revision without its installed symbol asset",
  theory_symbol_only: "Theory symbol only — no physical package",
});

/**
 * Every instance the sync would refuse, ordered by displayed reference (natural, case-insensitive: R2 before R10). Empty when
 * every physical instance carries a published exact revision and its installed symbol asset.
 */
export function listUnresolvedInstances(state: SchematicState): UnresolvedInstance[] {
  const items: UnresolvedInstance[] = [];
  for (const instance of state.kicadComponents ?? []) {
    const missing: UnresolvedInstanceMissing | null = !instance.atomicPartRevisionId
      ? "published_exact_revision"
      : !instance.symbolAssetVersionId
        ? "symbol_asset"
        : null;
    if (missing !== null) items.push({ refDes: instance.refDes, family: "kicad", missing, reviewPath: UNRESOLVED_REVIEW_PATH[missing] });
  }
  for (const component of state.components) {
    if (theoryPinContract(component.type) === null) continue; // ground symbols, voltage/current sources: no footprint, never on the board
    items.push({ refDes: normalizeRefDes(schDisplayRef(component)), family: "theory", missing: "theory_symbol_only", reviewPath: UNRESOLVED_REVIEW_PATH.theory_symbol_only });
  }
  // Stable sort: a KiCad and a Theory instance sharing a reference keep the KiCad row first.
  return items.sort((a, b) => compareNatural(a.refDes, b.refDes, { caseInsensitive: true }));
}

/** How many references the refusal toast names before "…" (the list below names them all). */
export const UNRESOLVED_TOAST_REFS = 5;

/** The refusal sentence: the count, up to five references, and the pointer to the list that outlives the toast. */
export function unresolvedInstancesRefusal(items: readonly UnresolvedInstance[]): string {
  const named = items.slice(0, UNRESOLVED_TOAST_REFS).map((item) => item.refDes).join(", ");
  const more = items.length > UNRESOLVED_TOAST_REFS ? ", …" : "";
  return `Schematic → PCB refused: ${items.length} part(s) have no published exact revision (${named}${more}). See the list below.`;
}
