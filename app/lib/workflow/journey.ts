/**
 * [PR-C] The shared prompt → schematic → PCB journey model (PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md §C "Artifact and state
 * progression", §E "the primary task line").
 *
 * Pure and browser-safe: no React, no clock, no network. The page (and any other surface) hands in FACTS it already holds -
 * plain booleans, counts and enums, never React objects - and gets back ONE view: ten stages with a status each, the current
 * stage, and the single next permitted action. The view is a description, never an authority: every action id names a thing
 * the page already does through its own authorized path (proposal review, binding review, sync preflight/apply, the
 * qualification authority, the ledgered release), and nothing here can make a change happen.
 *
 * Three rules hold throughout, each named at its line:
 *  - NO PASS FROM ABSENCE: a stage is `succeeded` only on a positive fact (a schematic exists, a board exists, the workflow
 *    machine says `qualified`). Missing PCB facts (`pcb: null` - the editor is not mounted) leave every PCB stage `pending`
 *    with the note "open the PCB tab"; a stale route or a non-current DRC is `partial`, never `succeeded`.
 *  - NO HIDDEN APPROVAL: a proposal, a verified plan and a release are `awaiting_approval` until the human acts; the release
 *    is authorized by an administrator, so its action is "Request release" - the label never says Finish.
 *  - ONE NEXT ACTION: the action belongs to the CURRENT stage (the first stage that is not `succeeded`); when the current
 *    stage is running there is nothing to do and `nextAction` is null; a disabled action always carries its reason.
 *
 * The stage statuses reuse the assignment's vocabulary verbatim (§C: pending, running, awaiting approval, blocked, partial,
 * succeeded, failed, canceled); the placement → export stages map from the existing `PromptToGerberState` names
 * (app/lib/workflow/prompt-to-gerber/types.ts) rather than a second machine. `canceled` is in the vocabulary for the strip;
 * no present fact derives it (a rejected proposal simply leaves no proposal pending).
 */
import type { PromptToGerberState } from "./prompt-to-gerber/types";

export const JOURNEY_STAGES = [
  "requirements",
  "schematic_proposal",
  "schematic_applied",
  "parts_footprints",
  "pcb_plan",
  "pcb_applied",
  "placement",
  "routing",
  "validation",
  "export",
] as const;
export type JourneyStageId = (typeof JOURNEY_STAGES)[number];

export const JOURNEY_STAGE_LABELS: Readonly<Record<JourneyStageId, string>> = Object.freeze({
  requirements: "Requirements",
  schematic_proposal: "Schematic proposal",
  schematic_applied: "Schematic applied",
  parts_footprints: "Parts & footprints",
  pcb_plan: "PCB plan",
  pcb_applied: "PCB applied",
  placement: "Placement",
  routing: "Routing",
  validation: "Validation",
  export: "Export",
});

export const JOURNEY_STAGE_STATUSES = ["pending", "running", "awaiting_approval", "blocked", "partial", "succeeded", "failed", "canceled"] as const;
export type JourneyStageStatus = (typeof JOURNEY_STAGE_STATUSES)[number];

/** The one next permitted action, by id: the page maps each id to the authorized path it already owns. */
export type JourneyActionId =
  | "describe_circuit"
  | "review_proposal"
  | "prepare_pcb"
  | "review_bindings"
  | "apply_pcb_plan"
  | "qualify_route"
  | "request_release"
  | "open_pcb"
  | "fix_blockers";

export interface JourneyGenerationFailure {
  code: string;
  message: string;
  retryable: boolean;
}

/** The sync preflight, folded to what the journey needs (PcbSyncPreflightStatus: every `blocked_*` value is "blocked"). */
export type JourneyPreflight = "none" | "ready_to_apply" | "ready_no_changes" | "blocked";

/** Facts the PCB editor holds; `null` on `JourneyFacts.pcb` means the editor is not mounted and nothing is known. */
export interface JourneyPcbFacts {
  /** A canonical board exists for this project (a durable board record, not a sync in flight). */
  boardExists: boolean;
  /** The schematic → PCB sync (preflight) is running. */
  syncing: boolean;
  /** Component instances without a resolved footprint / package / pin-map authority. */
  unresolvedCount: number;
  /** Bindings awaiting the human binding review. */
  bindingReviewPending: number;
  preflight: JourneyPreflight;
  /** A verified plan is being applied. */
  applying: boolean;
  /** The prompt-to-Gerber machine's state, when hydrated; `null` when the machine has not reported. */
  workflowState: PromptToGerberState | null;
  /** The board changed after the last qualified route (a release would ship a stale route). */
  routingStale: boolean;
  /** `true` = DRC ran against the current board; `false` = it ran against an earlier one; `null` = not run / unknown. */
  drcCurrent: boolean | null;
  /** A ledgered release exists for the current board. */
  released: boolean;
}

export interface JourneyFacts {
  hasSchematic: boolean;
  /** A schematic generation is in flight. */
  generating: boolean;
  /** A schematic proposal awaits the human review. */
  proposalPending: boolean;
  /** The pending proposal is a PARTIAL build result (a subsystem merge or a check was skipped) awaiting approval. */
  proposalPartial: boolean;
  /** The validation note attached to the pending proposal (what was skipped / partial), or null. */
  proposalValidationNote: string | null;
  lastGenerationFailure: JourneyGenerationFailure | null;
  /** The page's library mode: a Theory symbol is not a buildable PCB part (§F), so a PCB is prepared in Build mode. */
  mode: "build" | "theory";
  /** The user asked for the PCB in the same request as the circuit: the intent is carried across the approvals. */
  preparePcbRequested: boolean;
  pcb: JourneyPcbFacts | null;
}

/** What callers may hand in: every fact optional; a missing fact is read as its conservative value (never as a pass). */
export type JourneyFactsInput = Partial<Omit<JourneyFacts, "pcb">> & { pcb?: Partial<JourneyPcbFacts> | null };

export interface JourneyStageView {
  id: JourneyStageId;
  label: string;
  status: JourneyStageStatus;
  note?: string;
}

export interface JourneyNextAction {
  label: string;
  actionId: JourneyActionId;
  enabled: boolean;
  /** Why the action is disabled (always present when `enabled` is false). */
  reason?: string;
}

export interface JourneyView {
  stages: JourneyStageView[];
  current: JourneyStageId;
  nextAction: JourneyNextAction | null;
}

/** The note every PCB stage carries while the PCB editor is not mounted (`pcb: null`): nothing is known, nothing is passed. */
export const PCB_UNKNOWN_NOTE = "open the PCB tab";

/** NO PASS FROM ABSENCE: a missing fact is false / zero / "none" / null, so nothing succeeds by omission. */
export function normalizeJourneyFacts(input: JourneyFactsInput): JourneyFacts {
  const pcb = input.pcb ?? null;
  return {
    hasSchematic: input.hasSchematic === true,
    generating: input.generating === true,
    proposalPending: input.proposalPending === true,
    proposalPartial: input.proposalPartial === true,
    proposalValidationNote: input.proposalValidationNote ?? null,
    lastGenerationFailure: input.lastGenerationFailure ?? null,
    mode: input.mode === "theory" ? "theory" : "build",
    preparePcbRequested: input.preparePcbRequested === true,
    pcb: pcb === null
      ? null
      : {
          boardExists: pcb.boardExists === true,
          syncing: pcb.syncing === true,
          unresolvedCount: Math.max(0, Math.trunc(pcb.unresolvedCount ?? 0)),
          bindingReviewPending: Math.max(0, Math.trunc(pcb.bindingReviewPending ?? 0)),
          preflight: pcb.preflight ?? "none",
          applying: pcb.applying === true,
          workflowState: pcb.workflowState ?? null,
          routingStale: pcb.routingStale === true,
          drcCurrent: typeof pcb.drcCurrent === "boolean" ? pcb.drcCurrent : null,
          released: pcb.released === true,
        },
  };
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

export function deriveJourney(input: JourneyFactsInput): JourneyView {
  const f = normalizeJourneyFacts(input);
  const p = f.pcb;
  const status: Record<JourneyStageId, JourneyStageStatus> = {
    requirements: "pending",
    schematic_proposal: "pending",
    schematic_applied: "pending",
    parts_footprints: "pending",
    pcb_plan: "pending",
    pcb_applied: "pending",
    placement: "pending",
    routing: "pending",
    validation: "pending",
    export: "pending",
  };
  const note: Partial<Record<JourneyStageId, string>> = {};
  /** each stage's candidate action; ONE NEXT ACTION picks the current stage's candidate at the end */
  const candidate: Partial<Record<JourneyStageId, JourneyNextAction>> = {};
  const action = (label: string, actionId: JourneyActionId, enabled = true, reason?: string): JourneyNextAction =>
    enabled ? { label, actionId, enabled: true } : { label, actionId, enabled: false, reason: reason ?? "not available yet" };
  const generationFailure = f.lastGenerationFailure;
  const schematicApplied = f.hasSchematic && !f.proposalPending;

  // ── requirements: the user's circuit description. It has been given once a generation has started, is pending review, has
  // failed (the description exists; the proposal did not) or produced a schematic; otherwise the empty sheet asks for it.
  if (f.hasSchematic || f.proposalPending || f.generating || generationFailure) {
    status.requirements = "succeeded";
  } else {
    candidate.requirements = action("Describe a circuit", "describe_circuit");
  }

  // ── schematic_proposal: running while generating; awaiting approval while a proposal is pending (a PARTIAL build result is
  // `partial` with its validation note - still a human decision, never auto-applied); failed on the last generation failure
  // (retry only when the failure says it is retryable); succeeded once a schematic exists. Order: an in-flight generation
  // outranks an older proposal or failure; a pending proposal outranks the schematic it would replace.
  if (f.generating) {
    status.schematic_proposal = "running";
    note.schematic_proposal = "generating a proposal";
  } else if (f.proposalPending) {
    status.schematic_proposal = f.proposalPartial ? "partial" : "awaiting_approval";
    if (f.proposalPartial) note.schematic_proposal = f.proposalValidationNote ?? "a partial result awaits approval";
    else if (f.proposalValidationNote) note.schematic_proposal = f.proposalValidationNote;
    candidate.schematic_proposal = action("Review proposal", "review_proposal");
  } else if (generationFailure) {
    status.schematic_proposal = "failed";
    note.schematic_proposal = generationFailure.message;
    candidate.schematic_proposal = generationFailure.retryable
      ? action("Retry generation", "describe_circuit")
      : action("Retry generation", "describe_circuit", false, `${generationFailure.code}: not retryable - change the description and send it again`);
  } else if (f.hasSchematic) {
    status.schematic_proposal = "succeeded";
  }

  // ── schematic_applied: a schematic exists and no proposal is pending over it (an applied schematic is a distinct artifact
  // from a proposal: §C). A pending proposal keeps this stage pending - the current stage is the proposal's review.
  if (schematicApplied) status.schematic_applied = "succeeded";

  // ── the PCB stages: nothing is known while the editor is not mounted (NO PASS FROM ABSENCE); the one action is to open it.
  if (p === null) {
    for (const id of ["parts_footprints", "pcb_plan", "pcb_applied", "placement", "routing", "validation", "export"] as const) note[id] = PCB_UNKNOWN_NOTE;
    if (schematicApplied) candidate.parts_footprints = action("Open PCB", "open_pcb");
  } else {
    const preflightReady = p.preflight === "ready_to_apply" || p.preflight === "ready_no_changes";

    // ── parts_footprints: blocked by unresolved instances (each shown individually elsewhere; the count is named here);
    // awaiting approval while bindings await the human review; succeeded on a real board or a passed preflight (the sync
    // verified every binding); running while the sync binds parts; otherwise pending with "Prepare PCB" once the schematic
    // is applied - in Build mode only (a Theory symbol is not a buildable part: §F).
    if (p.unresolvedCount > 0) {
      status.parts_footprints = "blocked";
      // [PR-F fA] the stage says "N missing part(s)" - the words of the sidebar's Missing parts line and of the PCB tab's list that
      // the one action opens (each row's checklist names what is missing: identity, evidence, stock and pricing kept apart)
      note.parts_footprints = `${plural(p.unresolvedCount, "missing part")}: no published exact revision, symbol, footprint or pin-map authority`;
      candidate.parts_footprints = action("Resolve parts", "fix_blockers");
    } else if (p.bindingReviewPending > 0) {
      status.parts_footprints = "awaiting_approval";
      note.parts_footprints = `${plural(p.bindingReviewPending, "binding")} awaiting review`;
      candidate.parts_footprints = action("Review bindings", "review_bindings");
    } else if (p.boardExists || preflightReady) {
      status.parts_footprints = "succeeded";
    } else if (p.preflight === "blocked") {
      // a blocked preflight with no board and no NAMED unresolved part blocks this stage too: `blocked_mapping` is a footprint
      // fact, and the page may not fold every blocker into a count - the parts are not verified, and the one action is the review
      status.parts_footprints = "blocked";
      note.parts_footprints = "the sync preflight is blocked";
      candidate.parts_footprints = action("Review blockers", "fix_blockers");
    } else if (p.syncing) {
      status.parts_footprints = "running";
      note.parts_footprints = "binding parts";
    } else if (schematicApplied) {
      if (f.preparePcbRequested) note.parts_footprints = "requested with the circuit";
      candidate.parts_footprints = f.mode === "build"
        ? action("Prepare PCB", "prepare_pcb")
        : action("Prepare PCB", "prepare_pcb", false, "Theory symbols are not buildable parts: switch to Build mode to prepare a PCB");
    }

    // ── pcb_plan: running while the sync prepares it or the plan is being applied; blocked by a blocked preflight; awaiting
    // approval on a verified plan (ready_to_apply - the human applies it, never the model); succeeded on a real board or a
    // preflight with nothing to change. A verified plan outranks an existing board: the board is behind the schematic.
    if (p.applying) {
      status.pcb_plan = "running";
      note.pcb_plan = "applying the verified plan";
    } else if (p.syncing) {
      status.pcb_plan = "running";
      note.pcb_plan = "preparing the plan";
    } else if (p.preflight === "blocked") {
      status.pcb_plan = "blocked";
      note.pcb_plan = "the sync preflight is blocked";
      candidate.pcb_plan = action("Review blockers", "fix_blockers");
    } else if (p.preflight === "ready_to_apply") {
      status.pcb_plan = "awaiting_approval";
      note.pcb_plan = "a verified plan awaits approval";
      candidate.pcb_plan = action("Apply verified plan", "apply_pcb_plan");
    } else if (p.boardExists || p.preflight === "ready_no_changes") {
      status.pcb_plan = "succeeded";
    }

    // ── pcb_applied: running while a plan is applied; succeeded only on a real board (a canonical board revision, not a
    // model saying "done").
    if (p.applying) status.pcb_applied = "running";
    else if (p.boardExists) status.pcb_applied = "succeeded";

    // ── placement / routing / validation / export: read from the prompt-to-Gerber machine's state (its names reused, no
    // second machine). Any state before `awaiting_qualification`, or no state at all, is "not started": pending, with
    // "Qualify & route" offered once a board exists (the server-owned qualification authority decides; nothing is assumed).
    const state = p.workflowState;
    const releaseDone = p.released || state === "released";
    if (releaseDone) {
      status.placement = "succeeded";
      status.routing = "succeeded";
      status.validation = "succeeded";
      status.export = "succeeded";
    } else if (state === "qualifying") {
      status.placement = "running";
      status.routing = "running";
      note.routing = "qualifying the route";
    } else if (state === "qualification_failed") {
      status.routing = "failed";
      note.routing = "qualification failed";
      candidate.placement = action("Retry qualify & route", "qualify_route");
    } else if (state === "qualified" || state === "awaiting_release_authorization" || state === "releasing" || state === "release_failed") {
      status.placement = "succeeded";
      status.routing = "succeeded";
      status.validation = "succeeded";
      if (state === "qualified") {
        status.export = "awaiting_approval";
        note.export = "a release is authorized by an administrator";
        candidate.export = action("Request release", "request_release");
      } else if (state === "awaiting_release_authorization") {
        status.export = "awaiting_approval";
        note.export = "release requested: an administrator authorizes it";
        candidate.export = action("Request release", "request_release", false, "release requested: waiting for an administrator to authorize it");
      } else if (state === "releasing") {
        status.export = "running";
        note.export = "releasing";
      } else {
        status.export = "failed";
        note.export = "the release failed";
        candidate.export = action("Retry release", "request_release");
      }
    } else if (p.boardExists) {
      // `awaiting_qualification`, any state before it, or no state yet: the board is not qualified (nothing is assumed)
      note.placement = "not qualified yet";
      candidate.placement = action("Qualify & route", "qualify_route");
    }

    // ── staleness never passes: a board that changed after the qualified route is `partial` on routing ("re-route before
    // releasing"), and a DRC that ran against an earlier board is `partial` on validation. Either makes that stage current, so
    // the one action becomes "Qualify & route" (the qualification re-runs the route and its checks) instead of the release.
    if (p.routingStale && status.routing === "succeeded") {
      status.routing = "partial";
      note.routing = "re-route before releasing";
      candidate.routing = action("Qualify & route", "qualify_route");
    }
    if (p.drcCurrent === false && status.validation === "succeeded") {
      status.validation = "partial";
      note.validation = "DRC is not current";
      candidate.validation = action("Qualify & route", "qualify_route");
    }
  }

  // ── the view: the current stage is the first that is not succeeded; the one next action is that stage's candidate.
  const stages: JourneyStageView[] = JOURNEY_STAGES.map((id) => {
    const stageNote = note[id];
    return stageNote === undefined ? { id, label: JOURNEY_STAGE_LABELS[id], status: status[id] } : { id, label: JOURNEY_STAGE_LABELS[id], status: status[id], note: stageNote };
  });
  const current = JOURNEY_STAGES.find((id) => status[id] !== "succeeded") ?? "export";
  const nextAction = status[current] === "succeeded" ? null : candidate[current] ?? null;
  return { stages, current, nextAction };
}
