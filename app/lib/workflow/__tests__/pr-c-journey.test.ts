/**
 * [PR-C] The shared journey model (PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md §C "Artifact and state progression"): a table of
 * fact sets, each with the ten statuses, the current stage and the one next action it must derive. The rules under test: no
 * pass from absence (nothing succeeds by omission; unknown PCB facts stay pending with "open the PCB tab"), no hidden approval
 * (a proposal, a verified plan and a release wait for the human; the release action is "Request release", never Finish), and
 * one next action that belongs to the current stage and carries its reason when disabled.
 */
import { describe, expect, it } from "vitest";
import {
  deriveJourney,
  JOURNEY_STAGE_LABELS,
  JOURNEY_STAGE_STATUSES,
  JOURNEY_STAGES,
  normalizeJourneyFacts,
  PCB_UNKNOWN_NOTE,
  type JourneyFactsInput,
  type JourneyNextAction,
  type JourneyPcbFacts,
  type JourneyStageId,
  type JourneyStageStatus,
} from "../journey";

const PCB_IDLE: JourneyPcbFacts = { boardExists: false, syncing: false, unresolvedCount: 0, bindingReviewPending: 0, preflight: "none", applying: false, workflowState: null, routingStale: false, drcCurrent: null, released: false };
const BOARD: JourneyPcbFacts = { ...PCB_IDLE, boardExists: true, preflight: "ready_no_changes", workflowState: "awaiting_qualification" };
const QUALIFIED: JourneyPcbFacts = { ...BOARD, workflowState: "qualified", drcCurrent: true };
const APPLIED: JourneyFactsInput = { hasSchematic: true, pcb: PCB_IDLE };

type Row = {
  name: string;
  facts: JourneyFactsInput;
  /** the statuses that differ from the row's default of "pending" */
  statuses: Partial<Record<JourneyStageId, JourneyStageStatus>>;
  current: JourneyStageId;
  nextAction: JourneyNextAction | null;
  notes?: Partial<Record<JourneyStageId, string | RegExp>>;
};

const SCHEMATIC_DONE = { requirements: "succeeded", schematic_proposal: "succeeded", schematic_applied: "succeeded" } as const;
const BOARD_DONE = { ...SCHEMATIC_DONE, parts_footprints: "succeeded", pcb_plan: "succeeded", pcb_applied: "succeeded" } as const;
const QUALIFIED_DONE = { ...BOARD_DONE, placement: "succeeded", routing: "succeeded", validation: "succeeded" } as const;
const PCB_UNKNOWN: Record<"parts_footprints" | "pcb_plan" | "pcb_applied" | "placement" | "routing" | "validation" | "export", string> = {
  parts_footprints: PCB_UNKNOWN_NOTE, pcb_plan: PCB_UNKNOWN_NOTE, pcb_applied: PCB_UNKNOWN_NOTE, placement: PCB_UNKNOWN_NOTE, routing: PCB_UNKNOWN_NOTE, validation: PCB_UNKNOWN_NOTE, export: PCB_UNKNOWN_NOTE,
};

const ROWS: Row[] = [
  { name: "empty project", facts: {}, statuses: {}, current: "requirements", nextAction: { label: "Describe a circuit", actionId: "describe_circuit", enabled: true }, notes: PCB_UNKNOWN },
  { name: "generating", facts: { generating: true }, statuses: { requirements: "succeeded", schematic_proposal: "running" }, current: "schematic_proposal", nextAction: null, notes: { schematic_proposal: "generating a proposal" } },
  { name: "proposal pending", facts: { proposalPending: true }, statuses: { requirements: "succeeded", schematic_proposal: "awaiting_approval" }, current: "schematic_proposal", nextAction: { label: "Review proposal", actionId: "review_proposal", enabled: true } },
  { name: "proposal pending over an existing schematic keeps the applied stage pending", facts: { hasSchematic: true, proposalPending: true, pcb: PCB_IDLE }, statuses: { requirements: "succeeded", schematic_proposal: "awaiting_approval" }, current: "schematic_proposal", nextAction: { label: "Review proposal", actionId: "review_proposal", enabled: true } },
  { name: "partial proposal", facts: { proposalPending: true, proposalPartial: true, proposalValidationNote: "ERC skipped: pin data unavailable for U1" }, statuses: { requirements: "succeeded", schematic_proposal: "partial" }, current: "schematic_proposal", nextAction: { label: "Review proposal", actionId: "review_proposal", enabled: true }, notes: { schematic_proposal: "ERC skipped: pin data unavailable for U1" } },
  { name: "generation failed, retryable", facts: { lastGenerationFailure: { code: "PROVIDER_TIMEOUT", message: "the provider timed out", retryable: true } }, statuses: { requirements: "succeeded", schematic_proposal: "failed" }, current: "schematic_proposal", nextAction: { label: "Retry generation", actionId: "describe_circuit", enabled: true }, notes: { schematic_proposal: "the provider timed out" } },
  { name: "generation failed, not retryable", facts: { lastGenerationFailure: { code: "INVALID_OUTPUT", message: "the provider returned an invalid netlist", retryable: false } }, statuses: { requirements: "succeeded", schematic_proposal: "failed" }, current: "schematic_proposal", nextAction: { label: "Retry generation", actionId: "describe_circuit", enabled: false, reason: "INVALID_OUTPUT: not retryable - change the description and send it again" }, notes: { schematic_proposal: "the provider returned an invalid netlist" } },
  { name: "schematic applied (PCB editor mounted): next = Prepare PCB", facts: APPLIED, statuses: SCHEMATIC_DONE, current: "parts_footprints", nextAction: { label: "Prepare PCB", actionId: "prepare_pcb", enabled: true } },
  { name: "schematic applied, PCB requested with the circuit", facts: { ...APPLIED, preparePcbRequested: true }, statuses: SCHEMATIC_DONE, current: "parts_footprints", nextAction: { label: "Prepare PCB", actionId: "prepare_pcb", enabled: true }, notes: { parts_footprints: "requested with the circuit" } },
  { name: "schematic applied in Theory mode: Prepare PCB disabled with its reason", facts: { ...APPLIED, mode: "theory" }, statuses: SCHEMATIC_DONE, current: "parts_footprints", nextAction: { label: "Prepare PCB", actionId: "prepare_pcb", enabled: false, reason: "Theory symbols are not buildable parts: switch to Build mode to prepare a PCB" } },
  { name: "syncing", facts: { hasSchematic: true, pcb: { ...PCB_IDLE, syncing: true } }, statuses: { ...SCHEMATIC_DONE, parts_footprints: "running", pcb_plan: "running" }, current: "parts_footprints", nextAction: null, notes: { parts_footprints: "binding parts", pcb_plan: "preparing the plan" } },
  { name: "unresolved parts", facts: { hasSchematic: true, pcb: { ...PCB_IDLE, unresolvedCount: 3, preflight: "blocked" } }, statuses: { ...SCHEMATIC_DONE, parts_footprints: "blocked", pcb_plan: "blocked" }, current: "parts_footprints", nextAction: { label: "Resolve parts", actionId: "fix_blockers", enabled: true }, notes: { parts_footprints: /^3 unresolved parts/ } },
  { name: "one unresolved part (singular)", facts: { hasSchematic: true, pcb: { ...PCB_IDLE, unresolvedCount: 1 } }, statuses: { ...SCHEMATIC_DONE, parts_footprints: "blocked" }, current: "parts_footprints", nextAction: { label: "Resolve parts", actionId: "fix_blockers", enabled: true }, notes: { parts_footprints: /^1 unresolved part:/ } },
  { name: "binding review pending", facts: { hasSchematic: true, pcb: { ...PCB_IDLE, bindingReviewPending: 2 } }, statuses: { ...SCHEMATIC_DONE, parts_footprints: "awaiting_approval" }, current: "parts_footprints", nextAction: { label: "Review bindings", actionId: "review_bindings", enabled: true }, notes: { parts_footprints: "2 bindings awaiting review" } },
  { name: "preflight ready to apply", facts: { hasSchematic: true, pcb: { ...PCB_IDLE, preflight: "ready_to_apply" } }, statuses: { ...SCHEMATIC_DONE, parts_footprints: "succeeded", pcb_plan: "awaiting_approval" }, current: "pcb_plan", nextAction: { label: "Apply verified plan", actionId: "apply_pcb_plan", enabled: true }, notes: { pcb_plan: "a verified plan awaits approval" } },
  { name: "preflight ready to apply over an existing board (the board is behind the schematic)", facts: { hasSchematic: true, pcb: { ...BOARD, preflight: "ready_to_apply" } }, statuses: { ...SCHEMATIC_DONE, parts_footprints: "succeeded", pcb_plan: "awaiting_approval", pcb_applied: "succeeded" }, current: "pcb_plan", nextAction: { label: "Apply verified plan", actionId: "apply_pcb_plan", enabled: true } },
  { name: "preflight blocked, no board", facts: { hasSchematic: true, pcb: { ...PCB_IDLE, preflight: "blocked" } }, statuses: { ...SCHEMATIC_DONE, parts_footprints: "blocked", pcb_plan: "blocked" }, current: "parts_footprints", nextAction: { label: "Review blockers", actionId: "fix_blockers", enabled: true }, notes: { parts_footprints: "the sync preflight is blocked", pcb_plan: "the sync preflight is blocked" } },
  { name: "preflight blocked over an existing board", facts: { hasSchematic: true, pcb: { ...BOARD, preflight: "blocked" } }, statuses: { ...SCHEMATIC_DONE, parts_footprints: "succeeded", pcb_plan: "blocked", pcb_applied: "succeeded" }, current: "pcb_plan", nextAction: { label: "Review blockers", actionId: "fix_blockers", enabled: true } },
  { name: "applying the plan", facts: { hasSchematic: true, pcb: { ...PCB_IDLE, preflight: "ready_to_apply", applying: true } }, statuses: { ...SCHEMATIC_DONE, parts_footprints: "succeeded", pcb_plan: "running", pcb_applied: "running" }, current: "pcb_plan", nextAction: null, notes: { pcb_plan: "applying the verified plan" } },
  { name: "board applied, awaiting qualification", facts: { hasSchematic: true, pcb: BOARD }, statuses: BOARD_DONE, current: "placement", nextAction: { label: "Qualify & route", actionId: "qualify_route", enabled: true }, notes: { placement: "not qualified yet" } },
  { name: "board applied, machine not hydrated (no state): nothing assumed", facts: { hasSchematic: true, pcb: { ...BOARD, workflowState: null } }, statuses: BOARD_DONE, current: "placement", nextAction: { label: "Qualify & route", actionId: "qualify_route", enabled: true } },
  { name: "qualifying", facts: { hasSchematic: true, pcb: { ...BOARD, workflowState: "qualifying" } }, statuses: { ...BOARD_DONE, placement: "running", routing: "running" }, current: "placement", nextAction: null },
  { name: "qualification failed (retryable)", facts: { hasSchematic: true, pcb: { ...BOARD, workflowState: "qualification_failed" } }, statuses: { ...BOARD_DONE, routing: "failed" }, current: "placement", nextAction: { label: "Retry qualify & route", actionId: "qualify_route", enabled: true }, notes: { routing: "qualification failed" } },
  { name: "qualified: export awaits the administrator's release", facts: { hasSchematic: true, pcb: QUALIFIED }, statuses: { ...QUALIFIED_DONE, export: "awaiting_approval" }, current: "export", nextAction: { label: "Request release", actionId: "request_release", enabled: true }, notes: { export: "a release is authorized by an administrator" } },
  { name: "release requested, awaiting authorization", facts: { hasSchematic: true, pcb: { ...QUALIFIED, workflowState: "awaiting_release_authorization" } }, statuses: { ...QUALIFIED_DONE, export: "awaiting_approval" }, current: "export", nextAction: { label: "Request release", actionId: "request_release", enabled: false, reason: "release requested: waiting for an administrator to authorize it" } },
  { name: "releasing", facts: { hasSchematic: true, pcb: { ...QUALIFIED, workflowState: "releasing" } }, statuses: { ...QUALIFIED_DONE, export: "running" }, current: "export", nextAction: null },
  { name: "release failed", facts: { hasSchematic: true, pcb: { ...QUALIFIED, workflowState: "release_failed" } }, statuses: { ...QUALIFIED_DONE, export: "failed" }, current: "export", nextAction: { label: "Retry release", actionId: "request_release", enabled: true }, notes: { export: "the release failed" } },
  { name: "released", facts: { hasSchematic: true, pcb: { ...QUALIFIED, workflowState: "released", released: true } }, statuses: { ...QUALIFIED_DONE, export: "succeeded" }, current: "export", nextAction: null },
  { name: "routing stale after qualification: re-route before releasing", facts: { hasSchematic: true, pcb: { ...QUALIFIED, routingStale: true } }, statuses: { ...QUALIFIED_DONE, routing: "partial", export: "awaiting_approval" }, current: "routing", nextAction: { label: "Qualify & route", actionId: "qualify_route", enabled: true }, notes: { routing: "re-route before releasing" } },
  { name: "DRC not current after qualification", facts: { hasSchematic: true, pcb: { ...QUALIFIED, drcCurrent: false } }, statuses: { ...QUALIFIED_DONE, validation: "partial", export: "awaiting_approval" }, current: "validation", nextAction: { label: "Qualify & route", actionId: "qualify_route", enabled: true }, notes: { validation: "DRC is not current" } },
  { name: "schematic applied, PCB editor not mounted (pcb null): every PCB stage pending, open the PCB tab", facts: { hasSchematic: true, pcb: null }, statuses: SCHEMATIC_DONE, current: "parts_footprints", nextAction: { label: "Open PCB", actionId: "open_pcb", enabled: true }, notes: PCB_UNKNOWN },
];

describe("[PR-C] deriveJourney: the ten stages, the current stage and the one next action, from facts", () => {
  it("the stage list, labels and status vocabulary are the assignment's (§C), in order", () => {
    expect(JOURNEY_STAGES).toEqual(["requirements", "schematic_proposal", "schematic_applied", "parts_footprints", "pcb_plan", "pcb_applied", "placement", "routing", "validation", "export"]);
    expect(JOURNEY_STAGES.map((id) => JOURNEY_STAGE_LABELS[id])).toEqual(["Requirements", "Schematic proposal", "Schematic applied", "Parts & footprints", "PCB plan", "PCB applied", "Placement", "Routing", "Validation", "Export"]);
    expect(JOURNEY_STAGE_STATUSES).toEqual(["pending", "running", "awaiting_approval", "blocked", "partial", "succeeded", "failed", "canceled"]);
  });

  for (const row of ROWS) {
    it(row.name, () => {
      const view = deriveJourney(row.facts);
      expect(view.stages.map((stage) => stage.id)).toEqual([...JOURNEY_STAGES]);
      const expected = Object.fromEntries(JOURNEY_STAGES.map((id) => [id, row.statuses[id] ?? "pending"]));
      expect(Object.fromEntries(view.stages.map((stage) => [stage.id, stage.status]))).toEqual(expected);
      expect(view.current).toBe(row.current);
      expect(view.nextAction).toEqual(row.nextAction);
      for (const stage of view.stages) expect(stage.label, stage.id).toBe(JOURNEY_STAGE_LABELS[stage.id]);
      for (const [id, note] of Object.entries(row.notes ?? {}) as Array<[JourneyStageId, string | RegExp]>) {
        const stage = view.stages.find((entry) => entry.id === id)!;
        if (typeof note === "string") expect(stage.note, id).toBe(note);
        else expect(stage.note, id).toMatch(note);
      }
    });
  }

  it("invariants over every row: the current stage is the first not succeeded; a next action belongs to the current stage (none while it runs); a disabled action always carries a reason; no label says Finish; no stage succeeds from an absent fact", () => {
    for (const row of ROWS) {
      const view = deriveJourney(row.facts);
      const firstOpen = view.stages.find((stage) => stage.status !== "succeeded");
      expect(view.current, row.name).toBe(firstOpen?.id ?? "export");
      const current = view.stages.find((stage) => stage.id === view.current)!;
      if (current.status === "running" || current.status === "succeeded") expect(view.nextAction, row.name).toBeNull();
      if (view.nextAction && !view.nextAction.enabled) expect(view.nextAction.reason, row.name).toEqual(expect.any(String));
      if (view.nextAction) expect(view.nextAction.label, row.name).not.toMatch(/finish/i);
      for (const stage of view.stages) expect(JOURNEY_STAGE_STATUSES, `${row.name}: ${stage.id}`).toContain(stage.status);
    }
    // absence: with no facts at all nothing succeeds; with a schematic alone nothing past "schematic applied" succeeds
    expect(deriveJourney({}).stages.filter((stage) => stage.status === "succeeded")).toEqual([]);
    expect(deriveJourney({ hasSchematic: true }).stages.filter((stage) => stage.status === "succeeded").map((stage) => stage.id)).toEqual(["requirements", "schematic_proposal", "schematic_applied"]);
    // an unknown DRC (null) is not a non-current DRC: validation stays as the machine says
    expect(deriveJourney({ hasSchematic: true, pcb: { ...QUALIFIED, drcCurrent: null } }).stages.find((stage) => stage.id === "validation")!.status).toBe("succeeded");
  });

  it("normalizeJourneyFacts reads a missing fact as its conservative value and never as a pass; a negative or fractional count is clamped", () => {
    expect(normalizeJourneyFacts({})).toEqual({ hasSchematic: false, generating: false, proposalPending: false, proposalPartial: false, proposalValidationNote: null, lastGenerationFailure: null, mode: "build", preparePcbRequested: false, pcb: null });
    expect(normalizeJourneyFacts({ pcb: {} }).pcb).toEqual(PCB_IDLE);
    expect(normalizeJourneyFacts({ pcb: { unresolvedCount: -2, bindingReviewPending: 1.7 } }).pcb).toMatchObject({ unresolvedCount: 0, bindingReviewPending: 1 });
    expect(normalizeJourneyFacts({ mode: "theory" }).mode).toBe("theory");
    // the derivation is pure: the same facts give an equal view every time and never mutate the input
    const facts: JourneyFactsInput = { hasSchematic: true, pcb: { ...QUALIFIED } };
    const snapshot = JSON.stringify(facts);
    expect(deriveJourney(facts)).toEqual(deriveJourney(facts));
    expect(JSON.stringify(facts)).toBe(snapshot);
  });
});
