/**
 * [PR-L6 integration, 2026-10-19] BI-2 (the fixture-board review of increment 6): a REPLACED part on a bound board is not sent into a
 * dead end.
 *
 * A `changed` drift item is a part the board carries under another bound revision. Prepare PCB's bind step is refused while that earlier
 * binding is in effect (PB_ACTIVE_SELECTION_CONFLICT) and the page has no supersede control, yet the persistent notice, the gate
 * refusals and the journey named only Prepare PCB, and the bind failure toasted the bare code. They now name the real way out - Undo the
 * replacement, or a reviewer supersedes the binding - conditionally (a binding already superseded is bound anew, and Prepare PCB then
 * succeeds, so Prepare PCB stays the action).
 *
 *  1. the notice and both gate refusals for a replaced part add the rebind sentence naming it; an unresolved-only drift adds nothing;
 *  2. the journey's PCB-applied note says how many replaced parts re-bind only once the earlier binding no longer holds; with none it is
 *     exactly as before, and Prepare PCB stays the enabled next action.
 */
import { describe, expect, it } from "vitest";
import { createEmptyBoard, type PcbBoard } from "@/app/lib/pcb/types";
import type { SchematicState } from "@/lib/schematic-types";
import { BOARD_REBIND_REFUSAL, boardBehindSchematicNotice, boardSchematicDrift, manufacturingGateRefusal } from "@/app/lib/pcb-sync/schematic-drift";
import { deriveJourney, type JourneyPcbFacts } from "../journey";

const A = { footprintAssetVersionId: "fp-a", mappingCertificateId: "map-a", symbolAssetVersionId: "sym-a" };
function synced(ids: readonly string[]): PcbBoard {
  return {
    ...createEmptyBoard(),
    footprints: ids.map((id, index) => ({ id, ref: `D${index + 1}`, footprintId: A.footprintAssetVersionId, def: { libName: "L", name: "F", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [] }, at: { x: 0, y: 0 }, rotation: 0, side: "front", locked: false, syncIdentity: { componentInstanceId: id, ...A } })) as unknown as PcbBoard["footprints"],
  };
}
function sheet(entries: ReadonlyArray<{ id: string; identity: typeof A | null }>): SchematicState {
  return {
    components: [], wires: [], netLabels: [], pageSize: "A4",
    kicadComponents: entries.map((entry, index) => ({ id: entry.id, partId: "p", x: 0, y: 0, rotation: 0, refDes: `D${index + 1}`, value: "SS14", ...(entry.identity ? { atomicPartRevisionId: `apr-${entry.id}`, ...entry.identity } : {}) })),
  } as unknown as SchematicState;
}
const SENTENCE = /Prepare PCB re-binds (.+) only once the earlier binding no longer holds \(while it does, the bind is refused: PB_ACTIVE_SELECTION_CONFLICT\): Undo the replacement to restore the bound part, or have a reviewer supersede the binding in the Component review panel\.$/;

describe("[PR-L6 integration] BI-2: a replaced part on a bound board names the real way out", () => {
  it("1. the notice and the gate refusals add the rebind sentence for replaced parts only", () => {
    const replaced = boardSchematicDrift(sheet([{ id: "c-d1", identity: { ...A, footprintAssetVersionId: "fp-b" } }, { id: "c-d2", identity: null }]), synced(["c-d1", "c-d2"]));
    expect(replaced.counts).toMatchObject({ changed: 1, unresolved: 1 });
    for (const text of [boardBehindSchematicNotice(replaced)!, manufacturingGateRefusal("qualify", replaced)!, manufacturingGateRefusal("release", replaced)!]) {
      expect(text).toMatch(SENTENCE);
      expect(SENTENCE.exec(text)![1]).toBe("D1"); // the replaced part only, never the unresolved D2
    }
    const unresolvedOnly = boardSchematicDrift(sheet([{ id: "c-d1", identity: null }]), synced(["c-d1"]));
    for (const text of [boardBehindSchematicNotice(unresolvedOnly)!, manufacturingGateRefusal("qualify", unresolvedOnly)!]) expect(text).not.toMatch(/PB_ACTIVE_SELECTION_CONFLICT/);
    expect(BOARD_REBIND_REFUSAL).toMatch(/Undo the replacement to restore the bound part, or have a reviewer supersede the binding in the Component review panel$/);
  });

  it("2. the journey note counts the replaced parts and names Undo or a reviewer's supersede; Prepare PCB stays the enabled action", () => {
    const BOARD: JourneyPcbFacts = { boardExists: true, syncing: false, unresolvedCount: 0, bindingReviewPending: 0, preflight: "ready_no_changes", applying: false, workflowState: "awaiting_qualification", routingStale: false, drcCurrent: null, released: false };
    const withRebind = deriveJourney({ hasSchematic: true, pcb: { ...BOARD, boardBehindSchematic: 2, boardBehindRebind: 1 } });
    expect(withRebind.stages.find((stage) => stage.id === "pcb_applied")!.note).toBe("the board is behind the schematic: 2 parts differ - run Prepare PCB; 1 replaced part re-binds only once the earlier binding no longer holds - Undo restores the bound part, or a reviewer supersedes the binding in the Component review panel");
    expect(withRebind.nextAction).toEqual({ label: "Prepare PCB", actionId: "prepare_pcb", enabled: true });
    const without = deriveJourney({ hasSchematic: true, pcb: { ...BOARD, boardBehindSchematic: 2 } });
    expect(without.stages.find((stage) => stage.id === "pcb_applied")!.note).toBe("the board is behind the schematic: 2 parts differ - run Prepare PCB");
  });
});
