/**
 * [PR-L6, 2026-10-19] The page's undo / redo target (runbook M.5 item 7: Undo / Redo / reload stay consistent).
 *
 * The page's schematic undo history holds only the model fields (`SchematicSnapshot`: components, wires, catalog instances, labels);
 * the sheet size is a separate setting and is NOT in that history. The sheet size IS part of the canonical schematic and of every
 * schematic digest, so a history step whose target dropped it never matched the canonical transaction it undoes: the session fell back
 * to its documented lineage rebase onto a sheet WITHOUT a size, the page's authoritative projection lost the size too, and every later
 * sealed proposal from the page (a component resolution, a B14 replacement) - which states the page's sheet size - was refused as "not
 * at the claimed canonical head" until a reload (measured in e2e/m4-existing-board-resolution.spec.ts: Undo of a resolution, then
 * "Find a replacement in the library").
 *
 * A history step changes the model, never the sheet size: the target is the snapshot's model fields plus the size the authoritative
 * state carries NOW (none when it carries none). With it the session replays the canonical undo / redo transaction (B07.3) instead of
 * rebasing, and the projection keeps the size. Pure; no clock, no randomness.
 *
 * [PR-J3, 2026-10-22] Runbook J.3 / J.8 (OD-255 item 7): the sheet tree (`sheets`) IS model state and IS in the page's undo history, so a
 * step target carries it from the SNAPSHOT (undoing the first sheet creation restores a document without `sheets`, byte-identical
 * to the single-sheet one); the sheet size still comes from `current`. A target that dropped the tree would be the PR-L6 failure
 * again (a lineage rebase onto a flattened sheet). Absent stays absent: a single-sheet target's digest is unchanged.
 */
import type { SchematicState } from "@/lib/schematic-types";

export interface HistoryStepSnapshot {
  components: SchematicState["components"];
  wires: SchematicState["wires"];
  kicadComponents: NonNullable<SchematicState["kicadComponents"]>;
  netLabels: NonNullable<SchematicState["netLabels"]>;
  /** [PR-J3, 2026-10-22] the sheet tree of the recorded step (model state; absent on a single-sheet document). */
  sheets?: SchematicState["sheets"];
}

export function historyStepState(snapshot: HistoryStepSnapshot, current: Pick<SchematicState, "pageSize"> | null | undefined): SchematicState {
  return { components: snapshot.components, wires: snapshot.wires, kicadComponents: snapshot.kicadComponents, netLabels: snapshot.netLabels, ...(snapshot.sheets !== undefined ? { sheets: snapshot.sheets } : {}), ...(current?.pageSize ? { pageSize: current.pageSize } : {}) }; // [PR-J3, 2026-10-22] the tree from the snapshot, the size from `current`
}
