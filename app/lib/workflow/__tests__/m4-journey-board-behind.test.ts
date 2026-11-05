/**
 * [PR-L6, 2026-10-19] Runbook M.4 / M.5 item 7 (OD-253 item 8): the journey's fact `boardBehindSchematic` (the PCB editor derives it
 * from the schematic and the DURABLE board: app/lib/pcb-sync/schematic-drift.ts). While the board is behind the schematic the applied
 * board is `partial`, NOTHING downstream of it succeeds (placement, routing, validation and export were for the old parts) and the one
 * next action is Prepare PCB; an absent or zero fact leaves every existing row exactly as it was.
 */
import { describe, expect, it } from "vitest";
import { deriveJourney, normalizeJourneyFacts, type JourneyFactsInput, type JourneyPcbFacts } from "../journey";

const PCB_IDLE: JourneyPcbFacts = { boardExists: false, syncing: false, unresolvedCount: 0, bindingReviewPending: 0, preflight: "none", applying: false, workflowState: null, routingStale: false, drcCurrent: null, released: false };
const BOARD: JourneyPcbFacts = { ...PCB_IDLE, boardExists: true, preflight: "ready_no_changes", workflowState: "awaiting_qualification" };
const QUALIFIED: JourneyPcbFacts = { ...BOARD, workflowState: "qualified", drcCurrent: true };
const RELEASED: JourneyPcbFacts = { ...QUALIFIED, workflowState: "released", released: true };
const statusOf = (facts: JourneyFactsInput) => Object.fromEntries(deriveJourney(facts).stages.map((stage) => [stage.id, stage.status]));
const DOWNSTREAM = ["placement", "routing", "validation", "export"] as const;

describe("[PR-L6 M.5-7] the journey with the board behind the schematic", () => {
  it("1. a board behind a replaced part: PCB applied is partial with the count, the next action is Prepare PCB, nothing downstream succeeds", () => {
    const view = deriveJourney({ hasSchematic: true, pcb: { ...BOARD, boardBehindSchematic: 2 } });
    expect(view.current).toBe("pcb_applied");
    expect(view.stages.find((stage) => stage.id === "pcb_applied")).toEqual({ id: "pcb_applied", label: "PCB applied", status: "partial", note: "the board is behind the schematic: 2 parts differ - run Prepare PCB" });
    expect(view.nextAction).toEqual({ label: "Prepare PCB", actionId: "prepare_pcb", enabled: true });
    for (const id of DOWNSTREAM) expect(view.stages.find((stage) => stage.id === id)!.status, id).not.toBe("succeeded");
  });

  it("2. a qualified or even released board behind the schematic: placement, routing, validation and export are stale (pending), never succeeded; no Request release", () => {
    for (const pcb of [QUALIFIED, RELEASED]) {
      const view = deriveJourney({ hasSchematic: true, pcb: { ...pcb, boardBehindSchematic: 1 } });
      const statuses = statusOf({ hasSchematic: true, pcb: { ...pcb, boardBehindSchematic: 1 } });
      for (const id of DOWNSTREAM) {
        expect(statuses[id], `${pcb.workflowState}: ${id}`).toBe("pending");
        expect(view.stages.find((stage) => stage.id === id)!.note).toBe("stale: the board is behind the schematic");
      }
      expect(view.current).toBe("pcb_applied");
      expect(view.nextAction).toEqual({ label: "Prepare PCB", actionId: "prepare_pcb", enabled: true });
      expect(statusOf({ hasSchematic: true, pcb })).toMatchObject({ placement: "succeeded", routing: "succeeded", validation: "succeeded" }); // without the fact: unchanged
    }
  });

  it("3. right after Undo of the resolution (D1 / D2 unresolved ON the board): the parts stage leads with Resolve parts; PCB applied is still partial", () => {
    const view = deriveJourney({ hasSchematic: true, pcb: { ...BOARD, unresolvedCount: 2, boardBehindSchematic: 2 } });
    expect(view.current).toBe("parts_footprints");
    expect(view.nextAction).toEqual({ label: "Resolve parts", actionId: "fix_blockers", enabled: true });
    expect(view.stages.find((stage) => stage.id === "pcb_applied")!.status).toBe("partial");
  });

  it("4. Prepare PCB in flight or a verified plan awaiting approval leads; Theory mode disables Prepare PCB with its reason; an apply in flight is running", () => {
    expect(deriveJourney({ hasSchematic: true, pcb: { ...BOARD, preflight: "ready_to_apply", boardBehindSchematic: 2 } }).nextAction).toEqual({ label: "Apply verified plan", actionId: "apply_pcb_plan", enabled: true });
    expect(deriveJourney({ hasSchematic: true, pcb: { ...BOARD, syncing: true, boardBehindSchematic: 2 } })).toMatchObject({ current: "pcb_plan", nextAction: null });
    expect(deriveJourney({ hasSchematic: true, mode: "theory", pcb: { ...BOARD, boardBehindSchematic: 2 } }).nextAction).toEqual({ label: "Prepare PCB", actionId: "prepare_pcb", enabled: false, reason: "Theory symbols are not buildable parts: switch to Build mode to prepare a PCB" });
    expect(statusOf({ hasSchematic: true, pcb: { ...BOARD, applying: true, boardBehindSchematic: 2 } }).pcb_applied).toBe("running");
  });

  it("5. an absent, zero, negative or fractional-below-one fact changes nothing: the existing rows stay exactly as they were", () => {
    const sets: JourneyFactsInput[] = [{}, { hasSchematic: true, pcb: PCB_IDLE }, { hasSchematic: true, pcb: BOARD }, { hasSchematic: true, pcb: QUALIFIED }, { hasSchematic: true, pcb: RELEASED }, { hasSchematic: true, pcb: { ...QUALIFIED, routingStale: true } }, { hasSchematic: true, pcb: { ...PCB_IDLE, unresolvedCount: 3, preflight: "blocked" } }];
    for (const facts of sets) {
      const base = deriveJourney(facts);
      for (const value of [0, -2, 0.4]) {
        const withFact: JourneyFactsInput = facts.pcb ? { ...facts, pcb: { ...facts.pcb, boardBehindSchematic: value } } : facts;
        expect(deriveJourney(withFact), JSON.stringify(withFact).slice(0, 80)).toEqual(base);
      }
    }
    expect(normalizeJourneyFacts({ pcb: { boardBehindSchematic: 0 } }).pcb).toEqual(PCB_IDLE); // normalized away when zero
    expect(normalizeJourneyFacts({ pcb: { boardBehindSchematic: 3.9 } }).pcb).toEqual({ ...PCB_IDLE, boardBehindSchematic: 3 });
    // no board, no fact: the drift needs a board (nothing to be behind)
    expect(deriveJourney({ hasSchematic: true, pcb: { ...PCB_IDLE, boardBehindSchematic: 2 } })).toEqual(deriveJourney({ hasSchematic: true, pcb: PCB_IDLE }));
  });
});
