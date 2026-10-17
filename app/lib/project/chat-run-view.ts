/**
 * [B18-D I3] The chat's view of one agent run — pure reducers over the run's events (artifacts/ai-control-plane-b18/
 * chat-execution-ux.md §1 and §2, R2-3 to R2-7). SAFE: display only; nothing here is sent back to the server.
 *
 *  - Tool lines say what really happened: only a finished READ is "done"; an issued grant is "executing in your editor",
 *    a preview is "awaiting your confirmation", a proposal or candidate is "awaiting your review".
 *  - The model's INTERIM text (written beside a tool call; a missing phase counts as interim — fail closed) never enters
 *    the answer: it is released as notes only when the run ends. The FINAL text is the answer; while a change the run
 *    started is unresolved, the answer opens with a label saying it was written before any change was made (or before
 *    anything was applied). The history the next run sees is the answer — never the notes.
 *  - One execution ENTRY per grant: its state follows the grant, the editor's outcome and the server's settlement; when
 *    the editor and the server disagree it falls back to "landed, unverified".
 */
import type { PublicExecutionGrant } from "../engineering/execution-grant";
import { EXECUTION_SETTLEMENT_TIMEOUT_MS } from "../engineering/execution-grant"; // [B18-D review] the wait for the editor, shown (§1 item 6)
import type { ReceivedExecutionSettlement } from "./execution-grant-events";
import { checksLine, confirmationReason, operationLines, refusalSentence, retirementSentence, recoverySentence, serverRefusalSentence, targetLines, tierLabel, type RefOf } from "./execution-display";
import type { ProjectOperation } from "./operation-timeline"; // [B18-D I8]

export const LABEL_BEFORE_CHANGE = "Written before the outcome of this change was confirmed — the entry above is authoritative."; // [B18-D review] true also when the change was made but not yet confirmed
export const LABEL_BEFORE_REVIEW = "Written before anything was applied — the proposal above awaits your review.";
/** [B18-D review 2] The run's only execution grants were dropped by this page: there is no entry to point at. */
export const LABEL_DROPPED = "Written without knowing that this page dropped the change — nothing was changed; the run log above says why.";
/** [B18-E E9] The run prepared no change at all (a refused tool, an invalid call) and yet its answer may say otherwise:
 *  there is no entry to point at, so the PAGE contradicts it in its own words.
 *  [B18-E validation] It applies whether the claim was written BESIDE the call or in the final answer — the first version
 *  keyed on interim text, and a model that simply answers "Done." after a refused tool got through unlabelled, into the
 *  answer bubble and into the next run's history. */
export const LABEL_NOTHING_CHANGED = "Nothing was changed: this run never prepared a change. Anything above that says otherwise is the assistant's own text, not the editor's — the run log says what really happened.";
export const NOTE_PREFIX = "Assistant note (written before the result): ";

// ── tool lines ────────────────────────────────────────────────────────────────

const TOOL_STATUS_LABELS: Readonly<Record<string, string>> = Object.freeze({
  execution_grant_issued: "grant issued — executing in your editor",
  execution_preview_issued: "change prepared — awaiting your confirmation",
  proposal_sealed: "proposal sealed — awaiting your review",
  layout_candidate_ready: "candidate ready — awaiting your review",
  view_command_dispatched: "view request sent",
  execution_grant_dropped: "dropped by this page — it failed the integrity checks; nothing was changed", // [B18-D review]
});

/** [B18-E E1] A refusal the model is told in plain words gets a plain line too, never a bare code. */
const REFUSED_TOOL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  nothing_to_replay: "nothing to undo or redo — the assistant acts only on its own latest change; nothing was changed",
  // [B18-E E12] a Tier 2 proposal the server refused: nothing was sealed, so there is no review and nothing to apply.
  // [B18-E E16] worded for every Tier 2 path, not just the PCB one — a component replacement is blocked the same way.
  proposal_blocked: "refused — the change could not be prepared; nothing was changed",
});

/** [B18-E E12] how much of a refusal's own reason a line carries — enough for the compiler's sentence, never a payload. */
const MAX_REASON_CHARS = 300;

/** One tool line: the tier tag, the title, what really happened and — when a refusal came with one — its reason. */
export function toolLineLabel(input: { title?: unknown; tier?: unknown; ok?: unknown; status?: unknown; reason?: unknown }): string {
  const tier = tierLabel(input.tier);
  const tag = tier ? `T${input.tier as number} · ` : "";
  const title = typeof input.title === "string" && input.title.length > 0 ? input.title.slice(0, 120) : "tool";
  const status = typeof input.status === "string" ? input.status.slice(0, 60) : "unknown";
  // [B18-E E12] the reason the MODEL is given is the reason the page shows: whether the human learns why a Tier 2 proposal
  // was refused must not depend on the model choosing to relay it. Refusals only — it can never dress a failure as a result.
  const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, MAX_REASON_CHARS) : "";
  if (input.ok !== true) return `${tag}${title} — ${REFUSED_TOOL_LABELS[status] ?? `refused (${status})`}${reason ? `. Why: ${reason}` : ""}`;
  if (status === "succeeded") return `${tag}${title} — done`;
  return `${tag}${title} — ${TOOL_STATUS_LABELS[status] ?? `finished (${status})`}`;
}

/** [B18-D I10] A call refused before it ran: the tier tag, the title (or "Unknown tool"), the code, and that nothing ran. */
export function refusedLineLabel(input: { title?: unknown; tier?: unknown; status?: unknown }): string {
  const tier = tierLabel(input.tier);
  const tag = tier ? `T${input.tier as number} · ` : "";
  const title = typeof input.title === "string" && input.title.length > 0 ? input.title.slice(0, 120) : "Unknown tool";
  const status = typeof input.status === "string" ? input.status.slice(0, 60) : "unknown";
  return `${tag}${title} — refused before running (${status}) — nothing ran`;
}

/** [B18-D review] Once this page drops a grant that the server reported as issued (its tool line arrives first), the run
 *  log's latest execution tool line is rewritten: it never keeps saying "executing in your editor" or "awaiting your
 *  confirmation". Every other line is returned unchanged; the input is not mutated. */
export function markGrantLineDropped(rows: readonly EntryLogRow[]): EntryLogRow[] {
  const issued = [TOOL_STATUS_LABELS.execution_grant_issued, TOOL_STATUS_LABELS.execution_preview_issued];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]!;
    const label = issued.find((candidate) => row.text.endsWith(` — ${candidate}`));
    if (!label) continue;
    const copy = [...rows];
    copy[index] = { ...row, text: `${row.text.slice(0, row.text.length - label.length)}${TOOL_STATUS_LABELS.execution_grant_dropped}`, status: "error" };
    return copy;
  }
  return [...rows];
}

// ── the run's answer, notes and history ──────────────────────────────────────

const EXECUTION_STATUSES = new Set(["execution_grant_issued", "execution_preview_issued"]);
const REVIEW_STATUSES = new Set(["proposal_sealed", "layout_candidate_ready"]);

export interface RunViewState {
  answer: string;
  interim: string[];
  pendingExecutions: number;
  /** [B18-D review 2] grants the DURABLE record resolved during the run (settled with any outcome, or retired): the model was
   *  told each outcome before it wrote its answer. */
  resolvedExecutions: number;
  pendingReviews: number;
  terminal: "completed" | "failed" | null;
  failure: string | null;
  /** [B18-D review 2] what this page decided about the grants the stream carried (received: an entry exists; dropped: none). */
  receivedExecutions: number;
  droppedExecutions: number;
  /** [B18-E validation] tool calls that ended without doing anything — refused before running, or finished not-ok. A run
   *  that tried and failed is a run whose answer may claim otherwise, whether or not the model wrote prose beside the call. */
  failedAttempts: number; /** [B21 E2] (OD-126, OD-127) pure counters over an orchestrated run's additive events (reduceOrchestrationEvent, appended) - display only, never authority */ orchestrated: boolean; specialistsScheduled: number; specialistsFinished: number; specialistsDegraded: number; partialResult: { usable: number; planned: number } | null; /** [PR-G, 2026-10-17] the run's OWN provider (run_started) and model (run_completed) for the answer's footer label, and its compatible-fallback notices (degraded events) - read from the run's events, never from configuration; display only */ provider: string | null; model: string | null; fallbackNotices: number;
}
export const initialRunView = (): RunViewState => ({ answer: "", interim: [], pendingExecutions: 0, resolvedExecutions: 0, pendingReviews: 0, terminal: null, failure: null, receivedExecutions: 0, droppedExecutions: 0, failedAttempts: 0, orchestrated: false, specialistsScheduled: 0, specialistsFinished: 0, specialistsDegraded: 0, partialResult: null, provider: null, model: null, fallbackNotices: 0 });

/** Fold one raw run event (as the page receives it) into the run view. Unknown events change nothing. */
export function reduceRunView(state: RunViewState, event: Record<string, unknown>): RunViewState {
  switch (event.type) {
    case "text_delta": {
      const text = typeof event.text === "string" ? event.text : "";
      if (!text) return state;
      return event.phase === "final" ? { ...state, answer: state.answer + text } : { ...state, interim: [...state.interim, text] };
    }
    case "tool_refused":
      // [B18-E validation] a call that never ran: the run attempted something and nothing came of it.
      return { ...state, failedAttempts: state.failedAttempts + 1 };
    case "tool_finished": {
      if (event.ok !== true) return { ...state, failedAttempts: state.failedAttempts + 1 };
      if (typeof event.status !== "string") return state;
      if (EXECUTION_STATUSES.has(event.status)) return { ...state, pendingExecutions: state.pendingExecutions + 1 };
      if (REVIEW_STATUSES.has(event.status)) return { ...state, pendingReviews: state.pendingReviews + 1 };
      return state;
    }
    case "execution_settled":
      // [B18-D review 2] any durable outcome resolves it (committed, not committed, poisoned, retired); an unsettled or in-flight
      // answer does not — the model could not know the outcome.
      // [B18-E validation] clamped to what was actually issued: a stream carrying more settlements than grants cannot
      // resolve a grant that is still in flight and so cannot suppress the label that says the answer came first.
      return event.status === "settled" || event.status === "retired"
        ? { ...state, resolvedExecutions: Math.min(state.pendingExecutions, state.resolvedExecutions + 1) }
        : state;
    case "run_completed": // [PR-G, 2026-10-17] + the model the run's own terminal event names ("" on a replayed or refused run: not recorded); run_started's provider is folded in the default (reduceAnswerSource, appended) so the B21-cited lines keep their numbers
      return { ...state, terminal: state.terminal ?? "completed", model: typeof event.model === "string" ? event.model.slice(0, 120) : state.model };
    case "run_failed":
      return { ...state, terminal: "failed", failure: typeof event.message === "string" && event.message.length > 0 ? event.message.slice(0, 500) : "The assistant run failed." };
    default:
      return isOrchestrationRunEventType(event.type) ? reduceOrchestrationEvent(state, event) : reduceAnswerSource(state, event); // [B21 E2] the additive v1 orchestration events (OD-126): counters only (appended below); [PR-G, 2026-10-17] run_started's provider (appended too); any other unknown event changes nothing
  }
}


/** [B18-D review 2] What this page decided about a grant the stream carried — page decisions, never events: nothing in the
 *  run's stream can reach them. They change only the label's wording (a dropped grant never removes a label). */
export const runViewGrantReceived = (state: RunViewState): RunViewState => ({ ...state, receivedExecutions: state.receivedExecutions + 1 });
export const runViewGrantDropped = (state: RunViewState): RunViewState => ({ ...state, droppedExecutions: state.droppedExecutions + 1 });

export interface RunViewProjection { answer: string; notes: string[]; label: string | null; historyText: string; failure: string | null; /** [B21 E2] the orchestrated run's one status line (OD-127), or null */ status: string | null; /** [PR-G, 2026-10-17] the answer's footer label ("answered by <provider> · <model>", from the run's own events) with the fallback disclosure, or null; never part of the history */ footer: string | null }

/** What the page shows and what the next run's history carries. [PR-G, 2026-10-17] + `footer`, the run's own answer source (the page adds the configured-source disclosure through `answerFooter(state, configured)`, appended). */
export function projectRunView(state: RunViewState): RunViewProjection {
  const unresolvedExecution = state.pendingExecutions > state.resolvedExecutions;
  // [B18-D review 2] "the entry above" only when an entry exists: a run whose only grants this page dropped has none
  const noEntry = state.droppedExecutions > 0 && state.receivedExecutions === 0;
  // [B18-E E9] the run ENDED having prepared nothing at all: no execution, no review, nothing dropped — and it either
  // claimed something beside a call, or TRIED something that did not work. Counters only the page owns, so a stream
  // cannot talk the page out of saying it.
  // [B18-E validation] `interim` alone was not enough: the ordinary case is a model that puts its claim in the FINAL
  // text and writes nothing beside the call, and that answer reached the user unlabelled AND became the next run's
  // history. A refused or not-ok tool call is what makes the answer worth contradicting, whatever the model wrote where.
  const preparedNothing = state.pendingExecutions === 0 && state.receivedExecutions === 0 && state.droppedExecutions === 0 && state.pendingReviews === 0;
  // [B18-E validation] the trigger is a FAILED ATTEMPT, not the presence of prose. Keying on interim text both missed the
  // ordinary case (the claim written in the final answer) and fired on an innocent one (a preamble beside a successful
  // read, where "nothing was changed" is true but says nothing about a question the user only asked).
  const claimedNothing = state.terminal !== null && preparedNothing && state.failedAttempts > 0;
  const label = state.answer.length === 0 ? null : unresolvedExecution ? (noEntry ? LABEL_DROPPED : LABEL_BEFORE_CHANGE) : state.pendingReviews > 0 ? LABEL_BEFORE_REVIEW : claimedNothing ? LABEL_NOTHING_CHANGED : null;
  const answer = label ? `${label}\n\n${state.answer}` : state.answer;
  return {
    answer,
    notes: state.terminal ? state.interim.map((text) => `${NOTE_PREFIX}${text}`) : [],
    label,
    historyText: answer,
    failure: state.terminal === "failed" ? state.failure : null, status: orchestrationStatusLine(state), footer: answerFooter(state), // [B21 E2] the orchestrated run's one status line (OD-127), or null; [PR-G, 2026-10-17] the model label from the run's own events (appended below)
  };
}

// ── one execution entry per grant ────────────────────────────────────────────

export type ExecutionEntryState = "awaiting_confirmation" | "issued" | "executing" | "committed" | "not_made" | "landed_unverified" | "outcome_unknown" | "cancelled" | "superseded";
const TERMINAL: ReadonlySet<ExecutionEntryState> = new Set(["committed", "not_made", "landed_unverified", "cancelled", "superseded"]);

export interface ExecutionEntry {
  grantId: string;
  family: string;
  decision: "preview_then_confirm" | "execute_explicit";
  tier: string;
  state: ExecutionEntryState;
  asked: string;
  understood: string;
  targets: string[];
  nets: string;
  operations: string[];
  confirmation: string;
  transaction: { id: string; revisionBefore: string | null; revisionAfter: string | null; headSequenceAfter: number | null } | null;
  serverRecord: "settled" | "not yet recorded" | null;
  checks: string | null;
  failure: { headline: string; next: string; code: string | null } | null;
  recovery: string | null;
  undoEligible: boolean;
  /** [B18-D I8] the chat Undo's result for this entry: a success, or the timeline's refusal verbatim. */
  undoResult?: { ok: boolean; text: string; /** [B18-D review 2] the timeline seq of the operation it undid */ afterSeq?: number } | null;
  /** [B18-D review] the last confirmed attempt was refused for a transient reason (nothing changed; the card stays). */
  attempt?: string | null;
  /** [B18-D review] an AI undo or redo (a replay): its undo hint follows the direction. */
  replay?: "undo" | "redo" | null;
}

/** The entry for a received grant (preview: awaiting your confirmation; explicit: issued). */
export function entryFromGrant(received: { grant: PublicExecutionGrant; decision: "preview_then_confirm" | "execute_explicit"; note?: string | null }, refOf?: RefOf): ExecutionEntry {
  const { grant } = received;
  const binding = grant.binding;
  const targets = targetLines(grant, refOf);
  const preview = binding.proposal?.preview;
  return {
    grantId: grant.grantId,
    family: String(binding.operation?.family ?? "?"),
    decision: received.decision,
    tier: tierLabel(1)!.short,
    state: received.decision === "execute_explicit" ? "issued" : "awaiting_confirmation",
    asked: typeof binding.instruction?.excerpt === "string" ? binding.instruction.excerpt.slice(0, 240) : "",
    understood: `${String(binding.operation?.family ?? "?")} — ${typeof preview?.after === "string" ? preview.after.slice(0, 240) : "?"}`,
    targets: targets.objects,
    nets: targets.nets,
    operations: operationLines(grant, refOf),
    confirmation: confirmationReason(grant, received.note ?? null),
    transaction: null,
    serverRecord: null,
    checks: null,
    failure: null,
    recovery: null,
    undoEligible: false,
    replay: binding.proposal?.replay?.direction === "undo" || binding.proposal?.replay?.direction === "redo" ? binding.proposal.replay.direction : null,
  };
}

/** The editor started executing it. */
export const entryExecuting = (entry: ExecutionEntry): ExecutionEntry => (entry.state === "issued" || entry.state === "awaiting_confirmation" ? { ...entry, state: "executing" } : entry);

/** The editor's ritual outcome (structural: the page passes what the ritual returned). */
export type EditorOutcome =
  | { ok: true; status: "committed" | "already-applied"; receipt: { transactionId: string; pcbRevisionBefore: string; pcbRevisionAfter: string; headSequenceAfter: number }; settled: "settled" | "settle-failed"; validations?: { drc?: unknown } | null; undoEligible?: boolean; presetId?: string | null }
  | { ok: false; code: string; changed: boolean; message?: string; grantConsumed?: true; serverCode?: string | null; serverStatus?: number | null };

export function entryEditorOutcome(entry: ExecutionEntry, outcome: EditorOutcome): ExecutionEntry {
  if (outcome.ok) {
    return {
      ...entry, state: "committed", failure: null,
      transaction: { id: outcome.receipt.transactionId, revisionBefore: outcome.receipt.pcbRevisionBefore, revisionAfter: outcome.receipt.pcbRevisionAfter, headSequenceAfter: outcome.receipt.headSequenceAfter },
      serverRecord: outcome.settled === "settled" ? "settled" : "not yet recorded",
      checks: outcome.validations ? checksLine(outcome.validations.drc, outcome.presetId ?? null) : entry.checks,
      undoEligible: outcome.undoEligible === true,
    };
  }
  // [B18-D review] the editor's live pre-check names its own reason (never a generic "replaced")
  const sentence = outcome.code === "precheck-refused" && typeof outcome.message === "string" && outcome.message.trim() !== ""
    ? { headline: `Not made: ${outcome.message.trim().replace(/[.\s]+$/, "").slice(0, 300)}. Nothing was changed.`, next: "Ask again once that is resolved." }
    // [B18-D review 2] a grant already consumed and settled as not committed: nothing is left to recover or retry
    : outcome.grantConsumed === true && !outcome.changed
      ? { headline: "Not made — the grant was used and settled as not committed, so it cannot be retried. Nothing was changed.", next: "Ask again." }
      // [B18-E E2] the server's refusal of the tender names its cause
      : outcome.code === "consume-refused" && !outcome.changed
        ? serverRefusalSentence(outcome.serverCode, outcome.serverStatus)
        : refusalSentence(outcome.code, outcome.changed);
  return { ...entry, state: outcome.changed ? "landed_unverified" : outcome.code === "already-in-flight" ? entry.state : "not_made", failure: { ...sentence, code: outcome.code }, undoEligible: false };
}

/** What the run learned from the DURABLE record. A server "not made" after the editor reported committed fails safe. */
export function entrySettled(entry: ExecutionEntry, received: Pick<ReceivedExecutionSettlement, "status" | "outcome" | "reason" | "settlement">): ExecutionEntry {
  const summary = received.settlement;
  if (received.status === "settled" && received.outcome === "committed") {
    return {
      ...entry, state: entry.state === "landed_unverified" ? entry.state : "committed", serverRecord: "settled",
      transaction: summary?.transactionId ? { id: summary.transactionId, revisionBefore: summary.revisionBefore, revisionAfter: summary.revisionAfter, headSequenceAfter: summary.headSequenceAfter } : entry.transaction,
      checks: summary ? checksLine(summary.drc) : entry.checks,
      undoEligible: summary?.undoEligible === true,
    };
  }
  const disagrees = entry.state === "committed";
  if (received.status === "settled" && received.outcome === "poisoned") {
    return { ...entry, state: "landed_unverified", failure: { ...refusalSentence(null, true), code: "poisoned" }, undoEligible: false };
  }
  if (received.status === "settled" || received.status === "retired") {
    if (disagrees) return { ...entry, state: "landed_unverified", failure: { ...refusalSentence(null, true), code: "records-disagree" }, undoEligible: false };
    if (TERMINAL.has(entry.state)) return entry; // [B18-D review] the editor's own terminal report is more specific than a later server retirement
    const headline = received.status === "retired" ? retirementSentence(received.reason) : "Not made — nothing changed.";
    return { ...entry, state: "not_made", failure: { headline, next: "Ask again.", code: received.reason ?? received.outcome ?? null }, undoEligible: false };
  }
  // in_flight / unsettled: the run could not learn the outcome in time.
  if (TERMINAL.has(entry.state)) return entry;
  return { ...entry, state: "outcome_unknown", failure: { headline: "Outcome not yet known — the editor did not report in time.", next: "Check the board and the revision history.", code: received.status } };
}

export const entryCancelled = (entry: ExecutionEntry): ExecutionEntry => (TERMINAL.has(entry.state) ? entry : { ...entry, state: "cancelled", failure: { headline: "Cancelled — nothing was changed.", next: "Ask again if you still want it.", code: "cancelled_by_user" } });
export const entrySuperseded = (entry: ExecutionEntry): ExecutionEntry => (TERMINAL.has(entry.state) ? entry : { ...entry, state: "superseded", failure: { headline: "Replaced — a newer change or a board change superseded it. Nothing was changed.", next: "Ask again.", code: "superseded" } });
/** The recovery sweep's result for a live entry. [B18-D review] it also settles a non-terminal entry to what the sweep
 *  established (never "Executing …" beside "Recovered …"); a terminal entry keeps its state and gains the sentence. */
export const entryRecovery = (entry: ExecutionEntry, action: unknown): ExecutionEntry => {
  const recovery = recoverySentence(action);
  if (TERMINAL.has(entry.state)) return { ...entry, recovery };
  if (action === "adopted-and-settled" || action === "settled-from-receipt") return { ...entry, recovery, state: "committed", serverRecord: "settled", failure: null, undoEligible: false };
  if (action === "abandoned-not-committed") return { ...entry, recovery: null, state: "not_made", failure: { headline: recovery, next: "Ask again.", code: "abandoned-not-committed" }, undoEligible: false };
  if (action === "refused-poisoned") return { ...entry, recovery, state: "landed_unverified", failure: { ...refusalSentence(null, true), code: "refused-poisoned" }, undoEligible: false };
  return action === "interrupted-in-flight" ? { ...entry, recovery: null, state: "outcome_unknown", failure: { headline: recovery, next: INTERRUPTED_NEXT, code: "interrupted-in-flight" }, undoEligible: false } : { ...entry, recovery }; // [B24-D2B, 2026-10-10] OD-214: interrupted elsewhere, never "still in progress"
};
/** [B18-D review] A schematic edit proposal's chat text (Rule 2): the answer is the page's own sentence; the model's note, if
 *  any, is a labelled note for the run log — never the answer, and never the history the next run receives. */
export function editProposalMessages(note: unknown): { answer: string; note: string | null } {
  const text = typeof note === "string" ? note.trim().slice(0, 600) : "";
  return {
    answer: `Edit proposal prepared. Review the exact operations and choose "Apply exact proposal" — nothing has been changed yet.`,
    note: text ? `${NOTE_PREFIX}${text}` : null,
  };
}

/**
 * [B18-E E15] The chat's own sentences for a sealed COMPONENT REPLACEMENT (scenario 4), so what the human is told is a
 * tested string rather than a literal buried in the page. Each states what really happened and nothing more:
 *
 *  - `ready` names the target AND where it came from — the project's recorded component authority, which is the only
 *    thing that chose it. The model names the component to replace; it can never name the part (B14). No claim about the
 *    part beyond its identity is ever made here, because the authority record carries no such fact to make one from.
 *  - `applied` names the transaction, so the sentence points at something undoable.
 *  - `refused` exists at all: a refused apply used to be a transient toast and nothing else, so the run log kept saying a
 *    proposal was awaiting review and never said the attempt had failed and changed nothing.
 *  - `discarded` closes the same loop for a cancel.
 */
export const replacementChatLines = Object.freeze({
  ready(input: { partId: string; manufacturer?: string; preservedConnections: number; droppedConnections: number }): string {
    const maker = input.manufacturer ? ` (${input.manufacturer.slice(0, 80)})` : "";
    const kept = input.preservedConnections === 1 ? "1 connected pin keeps its connection" : `${input.preservedConnections} connected pins keep their connections`;
    const dropped = input.droppedConnections === 0 ? "none are dropped" : `${input.droppedConnections} would be dropped`;
    return `Replacement proposal ready — ${input.partId.slice(0, 120)}${maker}, the part this project's component authority records for this component. ${kept}, ${dropped}. Nothing has been changed; it awaits your explicit review.`;
  },
  applied(input: { alreadyApplied: boolean; sourcePartId: string; targetPartId: string; transactionId: string }): string {
    return `Replacement ${input.alreadyApplied ? "was already applied" : "applied"} — ${input.sourcePartId.slice(0, 120)} → ${input.targetPartId.slice(0, 120)}, canonical transaction ${input.transactionId.slice(0, 12)}… (verified, undoable).`;
  },
  refused(message: unknown): string {
    const text = typeof message === "string" && message.trim() !== "" ? message.trim().slice(0, 300) : "the editor refused it.";
    // [B18-E E16] several refusals already end with "Nothing was changed." — saying it twice reads as a stutter, and a
    // sentence a person distrusts is worse than one they do not read. Say it once, wherever it comes from.
    const alreadySaid = /nothing was changed\.?\s*$/i.test(text);
    return `Replacement NOT applied: ${text}${alreadySaid ? "" : " Nothing was changed."}`;
  },
  discarded(): string {
    return "Replacement proposal discarded — nothing was changed.";
  },
});

/** [B18-D review 2] The note sealed into a schematic edit proposal is the page's own sentence (as the agent path's is): the
 *  model's note never reaches the review dialog — it is only a labelled note in the run log (Rule 2, OD-18). */
export function editRouteProvenanceNote(note: unknown): string {
  return typeof note === "string" && note.trim() !== ""
    ? "Prepared by the schematic edit route from your instruction. The assistant's own note is in the run log, labelled as written before the result."
    : "Prepared by the schematic edit route from your instruction.";
}

export const isTerminalEntry = (entry: ExecutionEntry): boolean => TERMINAL.has(entry.state);
/** [B18-D review] A confirmed preview refused for a transient reason changed nothing and keeps its card for a retry: the entry
 *  returns to awaiting confirmation and says the attempt was not made — never "executing" with no ritual running. */
export const entryAttemptRefused = (entry: ExecutionEntry, refusal: { code: string; message: string }): ExecutionEntry =>
  entry.state === "executing" || entry.state === "awaiting_confirmation"
    ? { ...entry, state: "awaiting_confirmation", attempt: `Last attempt not made: ${refusal.message.replace(/[.\s]+$/, "").slice(0, 300)}. Nothing changed — retry or cancel on the card.` }
    : entry;

/** [B18-D I8] What a committed entry's "Undo this change" shows (chat-execution-ux.md §1 item 10): available only for a
 *  change still undoable, still the timeline's newest operation (a commit or a redo of exactly this transaction) and with
 *  no AI change in flight; otherwise it says why. Null: no live Undo (not committed, or no transaction). A reloaded record
 *  is not among the page's live entries at all. The timeline re-checks everything when it is used (NOT_LATEST,
 *  STORE_BUSY, a moved head), so this only decides what the button shows. */
export interface EntryUndoAvailability { eligible: boolean; reason: string | null }
export type TimelineStep = Pick<ProjectOperation, "seq" | "kind" | "store" | "ref">;
export function entryUndoAvailability(entry: ExecutionEntry, newest: Pick<ProjectOperation, "kind" | "ref"> | undefined, aiChangeInFlight: boolean, operations?: readonly TimelineStep[]): EntryUndoAvailability | null {
  if (entry.state !== "committed" || !entry.transaction) return null;
  const latest = newest !== undefined && (newest.kind === "commit" || newest.kind === "redo") && newest.ref?.transactionId === entry.transaction.id;
  // The chat's Undo is one-shot (D-A8). [B18-D review 2] its reason follows where the change is now, judged from every PCB
  // operation recorded since the change it undid — never from the newest operation alone.
  if (entry.undoResult?.ok) return { eligible: false, reason: afterChatUndoReason(entry.undoResult.afterSeq, operations) };
  if (!entry.undoEligible) return { eligible: false, reason: "No longer undoable from here — use the revision history." };
  if (aiChangeInFlight) return { eligible: false, reason: "Paused — an AI change is being made." };
  if (latest) return { eligible: true, reason: null };
  // [B18-D review] after a LATER change was undone this change is on top again, but the project timeline only undoes its
  // newest commit or redo (and refuses after an undo): the editor's own Undo reverts it
  if (newest?.kind === "undo" && newest.ref?.transactionId === entry.transaction.id) return { eligible: false, reason: "Not available here after a later undo — it is on top again: the editor's Undo reverts it." };
  return { eligible: false, reason: "No longer the latest operation — use the revision history." };
}

/** [B18-D review 2] Where a change undone from the chat stands now. The PCB history is replayed from the steps the timeline
 *  recorded after the operation that Undo reversed (the chat's own undo first): an undo or a redo moves one step, a commit
 *  clears the editor's Redo, a restore or a hydrate replaces the history. Without that record it claims nothing. */
function afterChatUndoReason(afterSeq: number | undefined, operations: readonly TimelineStep[] | undefined): string {
  if (afterSeq === undefined || operations === undefined) return "Undone once from here — the revision history shows where it stands.";
  const since = operations.filter((op) => op.store === "pcb" && op.seq > afterSeq);
  type Place = { at: "applied"; above: number } | { at: "redo"; depth: number } | { at: "gone" } | { at: "unknown" };
  // until the chat's own undo is recorded, the change is already on top of the editor's redo stack
  let place: Place = since.length === 0 ? { at: "redo", depth: 0 } : { at: "applied", above: 0 };
  for (const op of since) {
    if (place.at === "gone" || place.at === "unknown") break;
    if (op.kind === "undo") place = place.at === "applied" ? (place.above > 0 ? { at: "applied", above: place.above - 1 } : { at: "redo", depth: 0 }) : { at: "redo", depth: place.depth + 1 };
    else if (op.kind === "redo") place = place.at === "redo" ? (place.depth > 0 ? { at: "redo", depth: place.depth - 1 } : { at: "applied", above: 0 }) : { at: "applied", above: place.above + 1 };
    else if (op.kind === "commit") place = place.at === "applied" ? { at: "applied", above: place.above + 1 } : { at: "gone" };
    else place = { at: "unknown" };
  }
  switch (place.at) {
    case "applied":
      if (place.above > 0) return "Undone once from here and redone since; later changes are above it — use the revision history.";
      return since[since.length - 1]?.kind === "redo"
        ? "Undone once from here, and the editor's Redo brought it back — use the editor's Undo, or say “Undo that.”"
        : "Undone once from here and redone since — it is on top again: the editor's Undo reverts it.";
    case "redo":
      return place.depth === 0 ? "Already undone — the editor's Redo brings it back." : `Already undone — the editor's Redo brings it back after re-applying ${place.depth} earlier step${place.depth === 1 ? "" : "s"}.`;
    case "gone":
      return "Already undone — a later change cleared the editor's Redo; ask again, or use the revision history.";
    default:
      return "Undone once from here — the history was replaced since; the revision history shows where it stands.";
  }
}

/** [B18-D I8] The chat Undo's result, written into the entry: a success names the one history step and ends the entry's
 *  Undo; a refusal carries the timeline's message verbatim and changes nothing else. [B18-D review 2] a success keeps the
 *  seq of the operation it undid, so the reason can follow the change afterwards. */
export const entryUndoResult = (entry: ExecutionEntry, result: { ok: true; afterSeq?: number } | { ok: false; message: string }): ExecutionEntry =>
  result.ok
    ? { ...entry, undoEligible: false, undoResult: { ok: true, text: "Undone by you — the editor's own Undo reversed this change (one history step).", afterSeq: result.afterSeq } }
    : { ...entry, undoResult: { ok: false, text: `Not undone — ${result.message}` } };

// The execution entry as a chat log message. It persists through the EXISTING stored-chat log shape (no schema
// change): id `xlog-<grantId>`, a title, a status and rows of { id, text, status }. The entry's state rides in the
// first row's id (`xlog-<grantId>:state:<state>`) so a reloaded record still renders its state (a static record: no
// live Undo). The pinned phrases appear in the entry exactly once each:
//  - awaiting confirmation: "Change ready for your confirmation in the PCB editor — <after>; nothing has changed yet"
//  - executing:             "Executing in the PCB editor — <after> (one canonical transaction) — awaiting the editor's settlement (the assistant waits up to N s)"
//  - committed:             "AI change committed by your editor (one canonical transaction)[ — DRC: N errors]"

export const EXECUTION_ENTRY_ID_PREFIX = "xlog-";
const STATE_MARK = ":state:";

export interface EntryLogRow { id: string; text: string; status: "running" | "done" | "error" }
export interface EntryLogMessage { id: string; role: "log"; title: string; status: "running" | "done" | "error"; entries: EntryLogRow[] }

const RUNNING_STATES: ReadonlySet<ExecutionEntryState> = new Set(["awaiting_confirmation", "issued", "executing", "outcome_unknown"]);
const ERROR_STATES: ReadonlySet<ExecutionEntryState> = new Set(["not_made", "landed_unverified", "cancelled", "superseded"]);

const SETTLE_WAIT_S = Math.round(EXECUTION_SETTLEMENT_TIMEOUT_MS / 1000); // [B18-D review] how long the assistant waits for the editor

function stateSentence(entry: ExecutionEntry): string {
  const after = entry.understood.replace(/^[^—]*— /, "");
  switch (entry.state) {
    case "awaiting_confirmation": return `Change ready for your confirmation in the PCB editor — ${after}; nothing has changed yet`;
    case "issued": return `Issued — your editor executes it now (one canonical transaction; the assistant waits up to ${SETTLE_WAIT_S} s for the result)`;
    // [B18-D review 2] only an explicit grant's run waits for the editor; a confirmed preview's run has already ended
    case "executing": return entry.decision === "execute_explicit"
      ? `Executing in the PCB editor — ${after} (one canonical transaction) — awaiting the editor's settlement (the assistant waits up to ${SETTLE_WAIT_S} s)`
      : `Executing in the PCB editor — ${after} (one canonical transaction) — awaiting the editor's result`;
    case "committed": return `AI change committed by your editor (one canonical transaction)${entry.checks ? ` — ${entry.checks.replace(/^Checks: /, "")}` : ""}`;
    case "landed_unverified": return entry.failure?.headline ?? "The change LANDED but could not be verified — the board MAY have changed.";
    case "outcome_unknown": return entry.failure?.headline ?? "Outcome not yet known — the editor did not report in time.";
    default: return entry.failure?.headline ?? "Not made. Nothing was changed.";
  }
}

/** [B18-D review] The undo hint: conditional (never a present-tense claim), and following an AI undo/redo's direction.
 *  [B18-D review 2] It is stored with the entry, so it never names the chat's own button: a reloaded record has none (the
 *  live button, shown beside a live entry, speaks for itself). */
function undoHint(entry: ExecutionEntry): string {
  if (!entry.undoEligible) return "Undo: it was no longer the latest change when it settled — use the revision history.";
  if (entry.replay === "undo") return "Undo: while it is the latest change — the editor's Undo (one step) re-applies the change; or say “Redo.”";
  // [B18-E E1] no chat phrase: the minter refuses to undo an AI undo or redo ("nothing to undo or redo")
  if (entry.replay === "redo") return "Undo: while it is the latest change — the editor's Undo (one step) removes the change again.";
  return "Undo: while it is the latest change — the editor's Undo (one step), or say “Undo that.”";
}

/** The entry as a persistable chat log message (rebuilt on every transition). */
export function entryToLogMessage(entry: ExecutionEntry): EntryLogMessage {
  const id = `${EXECUTION_ENTRY_ID_PREFIX}${entry.grantId}`;
  const status = RUNNING_STATES.has(entry.state) ? "running" : ERROR_STATES.has(entry.state) ? "error" : "done";
  const row = (key: string, text: string, rowStatus: EntryLogRow["status"] = "done"): EntryLogRow => ({ id: `${id}:${key}`, text, status: rowStatus });
  const rows: EntryLogRow[] = [
    { id: `${id}${STATE_MARK}${entry.state}`, text: stateSentence(entry), status },
    row("tier", entry.tier),
    row("asked", `You asked (as recorded): “${entry.asked}”`),
    row("understood", `Sirkit understood: ${entry.understood}`),
    row("targets", `Targets: ${entry.targets.join(", ")} · ${entry.nets}`),
    ...entry.operations.map((line, index) => row(`op${index}`, `Operation ${index + 1}: ${line}`)),
    row("confirmation", `Confirmation: ${entry.confirmation}`),
  ];
  if (entry.transaction) {
    const t = entry.transaction;
    rows.push(row("transaction", `Transaction ${t.id} · revision ${(t.revisionBefore ?? "?").slice(0, 16)}… → ${(t.revisionAfter ?? "?").slice(0, 16)}… · history #${t.headSequenceAfter ?? "?"} · server record: ${entry.serverRecord ?? "not yet recorded"}`));
  }
  if (entry.attempt && entry.state === "awaiting_confirmation") rows.push(row("attempt", entry.attempt, "error")); // [B18-D review]
  if (entry.failure && entry.state !== "committed") rows.push(row("next", `Next: ${entry.failure.next}`, "error"));
  if (entry.recovery) rows.push(row("recovery", entry.recovery));
  if (entry.state === "committed") {
    // [B18-D I8] once the chat's Undo was used, its result replaces the hint
    const undo = entry.undoResult ?? { ok: true, text: undoHint(entry) };
    rows.push(row("undo", undo.text, undo.ok ? "done" : "error"));
  }
  return { id, role: "log", title: `AI change — ${entry.understood}`.slice(0, 160), status, entries: rows };
}

/** [B18-E E1] After a reload the editor starts a fresh history and the chat has no live Undo, so a committed entry's stored
 *  undo HINT would name affordances that no longer exist. The restored entry gets a hint that stays true; a recorded Undo
 *  result is kept (it happened), and every other message and row is returned unchanged. */
export const RESTORED_UNDO_HINTS = Object.freeze({
  change: "Undo: after a reload the editor's one-step Undo no longer applies — say “Undo that.” while it is the latest change, or use the revision history.",
  undo: "Undo: after a reload the editor's one-step Undo no longer applies — say “Redo.” while it is the latest change, or use the revision history.",
  redo: "Undo: after a reload the editor's one-step Undo no longer applies — use the revision history.",
});
export function restoredEntryLog<M extends { id: string; entries: ReadonlyArray<{ id: string; text: string }> }>(message: M): M {
  if (entryStateOfLogMessage(message) !== "committed") return entryStateOfLogMessage(message) === "landed_unverified" ? restoredLandedNext(message) : message; // [B24-D2B review 4, 2026-10-10] nor a landed-unverified record's next step
  const entries = message.entries.map((row) => {
    if (!row.id.endsWith(":undo") || !row.text.startsWith("Undo: while it is the latest change")) return row;
    const kind = row.text.includes("re-applies the change") ? "undo" : row.text.includes("removes the change again") ? "redo" : "change";
    return { ...row, text: RESTORED_UNDO_HINTS[kind] };
  });
  return { ...message, entries } as M;
}

/** The entry state of a (possibly reloaded) log message, or null when it is not an execution entry. */
export function entryStateOfLogMessage(message: { id: string; entries: ReadonlyArray<{ id: string }> }): ExecutionEntryState | null {
  if (!message.id.startsWith(EXECUTION_ENTRY_ID_PREFIX)) return null;
  const first = message.entries[0]?.id ?? "";
  const index = first.indexOf(STATE_MARK);
  const state = index >= 0 ? first.slice(index + STATE_MARK.length) : "";
  return (["awaiting_confirmation", "issued", "executing", "committed", "not_made", "landed_unverified", "outcome_unknown", "cancelled", "superseded"] as const).find((candidate) => candidate === state) ?? null;
}

// ─── [B21 E2] The additive v1 orchestration events in the run view (OD-126, OD-127) ─────────────────────────────────────────
// Appended on purpose: an import is hoisted and a function declaration too, so no line the discovery cites in this file moves.

import { isOrchestrationRunEventType } from "../agent/contracts";

/** a count the stream carries: a small nonnegative integer, or nothing */
const runCount = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 1_000 ? value : null);
/** [B21 E2] One additive orchestration event folded into the run view: counters only - the answer, the notes, the label and the history
 *  are untouched, exactly as a reducer that did not know them. `specialistsFinished` counts a task by its FINAL outcome ([B21 E2 fix:
 *  tests-2, coverage-6]): an outcome event with no re-run promised (`runsAgain` false) that is not `stale` - a retry closes on its
 *  retried outcome, a withheld retry on the scheduler's closing event, and a stale result that was never run again is not finished
 *  (the partial result counts it not started). `specialistsDegraded` counts the degraded NOTICES (run-wide or of one specialist). */
function reduceOrchestrationEvent(state: RunViewState, event: Record<string, unknown>): RunViewState {
  switch (event.type) {
    case "plan":
      return { ...state, orchestrated: true, specialistsScheduled: runCount(event.scheduled) ?? state.specialistsScheduled };
    case "specialist_finished":
      return event.runsAgain === false && event.status !== "stale" ? { ...state, orchestrated: true, specialistsFinished: state.specialistsFinished + 1 } : { ...state, orchestrated: true };
    case "degraded":
      return { ...state, orchestrated: true, specialistsDegraded: state.specialistsDegraded + 1, fallbackNotices: state.fallbackNotices + (event.reason === "compatible_fallback" ? 1 : 0) }; // [PR-G, 2026-10-17] a specialist served by a compatible fallback is disclosed in the footer too
    case "partial_result": {
      const usable = runCount(event.usable);
      const planned = runCount(event.planned);
      return { ...state, orchestrated: true, partialResult: usable !== null && planned !== null && usable < planned ? { usable, planned } : state.partialResult };
    }
    default:
      return { ...state, orchestrated: true };
  }
}

/** [B21 E2] The prefix of the run's one additive status line (OD-127). */
export const ORCHESTRATION_STATUS_PREFIX = "Specialists: ";
/** [B21 E2] The ONE additive status line of an orchestrated run (OD-127), from the counters alone: what the plan scheduled, how many
 *  finished, whether the run was degraded (the log above says why) and its partial result - or null for a run that carried no
 *  orchestration event (every single-agent run: its run log is unchanged). Rendered in the run log as a line, never a control. */
export function orchestrationStatusLine(state: RunViewState): string | null {
  if (!state.orchestrated) return null;
  const parts = [`${state.specialistsScheduled} scheduled`, `${state.specialistsFinished} finished`];
  if (state.specialistsDegraded > 0) parts.push(`degraded mode (${state.specialistsDegraded} notice${state.specialistsDegraded === 1 ? "" : "s"} in the log above)`);
  if (state.partialResult) parts.push(`partial result: ${state.partialResult.usable} of ${state.partialResult.planned} usable`);
  return `${ORCHESTRATION_STATUS_PREFIX}${parts.join(" · ")}`;
}
/** [B21 E2] How long a run-log line from an orchestration event may be (the builders bound it at the same figure). */
export const MAX_ORCHESTRATION_LINE_CHARS = 1_500;
/** [B21 E2] The run-log line of one additive orchestration event (OD-127: run-log lines, no control): the server's own sentence it
 *  carries, "running" for a specialist that just started (the next line settles it), "done" otherwise - or null for any other event,
 *  which the page handles (or ignores) as before. */
export function orchestrationRunLogLine(event: Record<string, unknown>): { text: string; status: "running" | "done" } | null {
  if (!isOrchestrationRunEventType(event.type) || typeof event.message !== "string") return null;
  const text = event.message.trim().slice(0, MAX_ORCHESTRATION_LINE_CHARS);
  return text ? { text, status: event.type === "specialist_started" ? "running" : "done" } : null;
}

// ─── [B21 E3] The route-level resume, offered as a run-log line (OD-127: no control) ─────────────────────────────────────────────
// Appended on purpose: a function declaration is hoisted and the constants are read only when a run ends, so no line cited above moves.

/** [B21 E3] The degraded reasons with which an orchestrated run STANDS DOWN - the coordinator's answer stands and no follow-up turn
 *  answered (`runOrchestratedChat`'s `down(...)` calls): its record can be resumed. A notice that does not end the run is not one. */
export const CHAT_RESUME_STAND_DOWN_REASONS = Object.freeze(["follow_up_failed", "follow_up_paused", "merge_unrecorded", "no_specialist_ran", "no_usable_result", "provider_outage", "provider_paused"] as const);
/** The run ids the chat route issues in `X-Sirkit-Run-Id` (the route's own pattern): nothing else is ever offered or sent. */
const CHAT_RESUME_RUN_ID = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** What the page learns from a run's stream for the resume: a plan was recorded (the scheduler writes the plan before its event) and
 *  the run stood down. Display facts only - the route decides every resume against the record. */
export interface ChatResumeObservation { planned: boolean; stoodDown: boolean }
export const initialChatResumeObservation = (): ChatResumeObservation => ({ planned: false, stoodDown: false });
export function observeChatResume(state: ChatResumeObservation, event: Record<string, unknown>): ChatResumeObservation {
  if (event.type === "plan") return state.planned ? state : { ...state, planned: true };
  if (event.type === "degraded" && typeof event.reason === "string" && (CHAT_RESUME_STAND_DOWN_REASONS as readonly string[]).includes(event.reason)) return state.stoodDown ? state : { ...state, stoodDown: true };
  return state;
}
/** [B21 E3] The run a later send may resume: an orchestrated run (a plan was recorded) that ended WITHOUT its follow-up's answer - stood
 *  down, stopped, cut or cancelled - under a run id the route issued; bound to the message, provider, project and branch it was sent with. */
export interface ResumableChatRun { runId: string; text: string; provider: string; projectId: string; branchId: string }
export function resumableChatRun(observation: ChatResumeObservation, ending: { terminal: "completed" | "failed" | null; runId: string | null } & Omit<ResumableChatRun, "runId">): ResumableChatRun | null {
  if (!observation.planned || ending.runId === null || !CHAT_RESUME_RUN_ID.test(ending.runId)) return null;
  if (ending.terminal === "completed" && !observation.stoodDown) return null; // the follow-up turn answered: the run is finished
  return { runId: ending.runId, text: ending.text, provider: ending.provider, projectId: ending.projectId, branchId: ending.branchId };
}
/** [B21 E3] The next send resumes the offered run only when it is the SAME message on the SAME provider in the SAME project and branch
 *  (the composer's send or the recovery card's Retry - the same `send(text)`); anything else is a new run. */
export function chatResumeFor(resumable: ResumableChatRun | null, next: Omit<ResumableChatRun, "runId">): { runId: string; line: string } | null {
  if (!resumable || resumable.text !== next.text || resumable.provider !== next.provider || resumable.projectId !== next.projectId || resumable.branchId !== next.branchId) return null;
  return { runId: resumable.runId, line: chatResumingLine(resumable.runId) };
}
/** [B21 E3] The offer, a run-log line of the run that can be resumed (never a control). [B21 E3 fix: coverage-1] It names the provider the
 *  run is bound to, so a reloaded page reads the offer back from its saved log (`restoredChatResume`); [B21 E3 fix: coverage-4] it
 *  promises only what every resume keeps - a committed result is replayed while it is still current, else its specialist runs again. */
export function chatResumeOfferLine(runId: string, provider: string): string {
  return `Resume: send the same message again on ${provider} to resume run ${runId} - its first answer is replayed from the record unless the record withheld it, and so is each committed specialist result that is still current; one whose design, selection or seal lifetime moved runs again (paid), as does one that did not finish.`;
}
/** [B21 E3] The first run-log line of a send that resumes ([B21 E3 fix: coverage-4] as conditional as the offer). */
export function chatResumingLine(runId: string): string {
  return `Resuming run ${runId}: its first answer is replayed from the record unless the record withheld it, and so is each committed specialist result that is still current; one whose design, selection or seal lifetime moved runs again (paid), as does one that did not finish.`;
}
/** [B21 E3] The route's refusals of a resume that hold only for now: another request of the run still holds it, or its record could
 *  not be read. They KEEP the offer, so the next send of the same message tries the resume again; every other refusal (and a body that
 *  names no such code) spends it - the next send is a new run, as the refusal's own message says. */
export const CHAT_RESUME_TRANSIENT_REFUSALS = Object.freeze(["resume_in_progress", "resume_unavailable"] as const);
export function chatResumeKeptAfter(refusal: unknown, offered: ResumableChatRun | null): ResumableChatRun | null {
  const code = typeof refusal === "object" && refusal !== null && !Array.isArray(refusal) ? (refusal as { code?: unknown }).code : undefined;
  return offered !== null && typeof code === "string" && (CHAT_RESUME_TRANSIENT_REFUSALS as readonly string[]).includes(code) ? offered : null;
}

// ─── [B21 E3 fix: coverage-1] The offer read back from the saved run log (a reload, a project switched back to) ──────────────────────
// Appended on purpose: a function declaration is hoisted and the constants are read only when a send runs, so no line cited above moves.

/** The first step of a chat send's run log (`send` in the page): what marks a log as a chat send's. */
export const CHAT_SEND_FIRST_STEP = "Submitting message";
/** The offer line's own grammar (`chatResumeOfferLine`): the provider and a run id the route could have issued, nothing else. */
const CHAT_RESUME_OFFER_LINE = /^Resume: send the same message again on ([a-z][a-z0-9-]{0,31}) to resume run (run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) - /;
/** [B21 E3 fix: coverage-1] The offer a page that holds none in memory can still take: the run log is saved with the project and
 *  restored on a reload or when the project is opened again, so the LATEST chat send's log is read back - its offer line names the run
 *  id and provider, the user message before that log is the text, and the project and branch are the log's own. A later chat send
 *  (whatever its outcome) spends it, exactly as a send spends the offer held in memory; another kind of log does not. Display facts
 *  only: the route decides every resume against the record. */
export function restoredChatResume(messages: ReadonlyArray<{ role: string; content?: unknown; entries?: ReadonlyArray<{ text?: unknown }> }>, scope: { projectId: string; branchId: string }): ResumableChatRun | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const log = messages[index]!;
    if (log.role !== "log" || log.entries?.[0]?.text !== CHAT_SEND_FIRST_STEP) continue;
    let offer: RegExpExecArray | null = null;
    for (const entry of log.entries) if (typeof entry.text === "string") offer = CHAT_RESUME_OFFER_LINE.exec(entry.text) ?? offer;
    const user = messages[index - 1];
    if (!offer || user?.role !== "user" || typeof user.content !== "string") return null;
    return { runId: offer[2]!, text: user.content, provider: offer[1]!, projectId: scope.projectId, branchId: scope.branchId };
  }
  return null;
}

// ─── [B24-D2B, 2026-10-10] D24-30, OD-214: a recovery sweep's result reaches the entry it names, live or restored after a reload ────
// Appended on purpose: function declarations are hoisted, so no line cited above moves.

/** [B24-D2B, 2026-10-10] The next step an interrupted entry names (`entryRecovery`, `restoredEntryRecovery`). */
const INTERRUPTED_NEXT = "Check the board; ask again if you still want the change.";

/** [B24-D2B, 2026-10-10] A recovery sweep result as the action the person is shown (the page's rule, `page.tsx:6460`). An execution
 *  THIS page's own ritual holds (`heldHere`, B18-C I10b) is never shown: its ritual settles it. A grant left in flight that no ritual of
 *  this page holds - the server consumed it for a page that closed before the answer, or for another tab - is NOT "still in progress"
 *  here (B18's sentence for `left-in-flight`): it is `interrupted-in-flight`. Any other action is itself. */
export function recoveryDisplayAction(result: { action: unknown; heldHere?: unknown; cause?: unknown }): string | null {
  if (typeof result.action !== "string") return null;
  if (result.action !== "left-in-flight") return result.action === "unavailable" && result.cause === "lineage-reopened" ? "lineage-reopened" : result.action; // [B24-D2B review 4, 2026-10-10] a lasting `unavailable` is shown as its cause
  return result.heldHere === true ? null : "interrupted-in-flight";
}

/** [B24-D2B, 2026-10-10] The actions a restored entry takes: those the editor's recovery notice names (`executionRecoveryNotice`), a
 *  grant the server still holds issued (`left-issued`) and an unreadable one (`unavailable`). B18's own `left-in-flight` (this page's
 *  ritual finishes it) and an unknown action leave the record as it was. */
const RESTORED_RECOVERY_ACTIONS: ReadonlySet<string> = new Set(["adopted-and-settled", "settled-from-receipt", "abandoned-not-committed", "refused-poisoned", "interrupted-in-flight", "left-issued", "unavailable", /* [B24-D2B review 3] the journal's record of a grant outside the sweep's work list (`recordedEnds`) */ "recorded-committed", "recorded-not-committed", "recorded-unverified", "unrecorded", /* [B24-D2B review 4] a lasting unreadable outcome, and a grant another tab moved while the sweep read it */ "lineage-reopened", "in-flight-elsewhere"]);
/** [B24-D2B, 2026-10-10] A restored entry whose grant the server still holds issued: B18's live "confirm or cancel it" is false after a reload (the card is in-memory state).
 *  [B24-D2B review 2] Never a terminal "not made": the journal is the profile's and the claim registry the page's, so another open tab may still hold the live card (kept after an
 *  unanswered tender, `refusalKeepsPreviewCard`) and commit it. Not started, open; an expired grant is closed by a later sweep (`b24-d2-crash-recovery` 4). */
const RESTORED_NOT_STARTED = "Not started — when the editor loaded this project, the server still held this change's grant unused, so nothing had been changed by it. This page cannot start it: a reload keeps no confirmation card. Another open tab of this project may still start it."; /* [B24-D2B review 3] what held at that load, no prediction: every editor load re-derives it (restoredEntryGrants) */ const RESTORED_NOT_STARTED_NEXT = "Check your other open tabs of this project; ask again if you still want the change.";

/**
 * [B24-D2B, 2026-10-10] D24-30, OD-214: a recovery sweep's result for the execution entry of `grantId` when the page holds no live entry
 * for it - an entry restored after a reload is a static log record (`fromStoredChat`; `executionEntriesRef` starts empty), so before
 * this no sweep result ever reached it and the record kept its pre-crash sentence ("Executing … awaiting the editor's result
 * (interrupted by reload)") beside a transient notice. The record now takes what `entryRecovery` gives a live entry, written as
 * `entryToLogMessage` writes it: a non-terminal record moves to the state the sweep established (its state row's sentence, the next step
 * and the recovery sentence; an adopted change committed, with the hint a reloaded record keeps; a grant still issued - `left-issued` -
 * not started and of open outcome, never terminal; an unreadable one of unknown outcome); a terminal record keeps its state and gains the
 * sentence of an action the notice names. Its other rows are kept. A restored record is never shown as running (nothing runs for it
 * in this page). Returns the same array when nothing changed (no record of the grant, or an action a restored record does not take).
 */
export function restoredEntryRecovery<M extends { id: string }>(messages: M[], grantId: string, action: string): M[] {
  const id = `${EXECUTION_ENTRY_ID_PREFIX}${grantId}`;
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0 || !RESTORED_RECOVERY_ACTIONS.has(action)) return messages;
  const record = messages[index] as unknown as { id: string; status?: unknown; entries?: unknown };
  if (!Array.isArray(record.entries) || record.entries.length === 0) return messages;
  const rows = record.entries as EntryLogRow[];
  const state = entryStateOfLogMessage({ id, entries: rows });
  if (state === null || (action === "unrecorded" && !writtenAtALoad(rows[0]!.text))) return messages; // [B24-D2B review 3] no record names it: only a sentence an earlier load wrote from the records is withdrawn
  const row = (key: string, text: string, status: EntryLogRow["status"] = "done"): EntryLogRow => ({ id: `${id}:${key}`, text, status });
  const sentence = recoverySentence(action);
  // the record's own rows from the tier to the transaction, in entryToLogMessage's order; the rows after them are written anew
  const body = rows.slice(1).filter((existing) => !/:(attempt|next|recovery|undo)$/.test(existing.id));
  let entries: EntryLogRow[];
  let status: unknown;
  if (TERMINAL.has(state)) {
    if (action === "left-issued" || action === "unavailable" || action === "lineage-reopened" || action === "in-flight-elsewhere" || RECORDED_END_ACTIONS.has(action)) return messages; // its settled state already says the outcome; B18's live "confirm or cancel it" is false here; [B24-D2B review 3] a settled entry is never asked about
    entries = [rows[0]!, ...body, ...rows.filter((existing) => existing.id.endsWith(":next")), row("recovery", sentence), ...rows.filter((existing) => existing.id.endsWith(":undo"))];
    status = record.status;
  } else {
    let settled: { state: ExecutionEntryState; text: string; tail: EntryLogRow[] };
    if (action === "adopted-and-settled" || action === "settled-from-receipt") {
      settled = { state: "committed", text: "AI change committed by your editor (one canonical transaction)", tail: [row("recovery", sentence), row("undo", RESTORED_UNDO_HINTS.redo)] };
    } else if (action === "abandoned-not-committed") {
      settled = { state: "not_made", text: sentence, tail: [row("next", "Next: Ask again.", "error")] };
    } else if (action === "left-issued") {
      settled = { state: "outcome_unknown", text: RESTORED_NOT_STARTED, tail: [row("next", `Next: ${RESTORED_NOT_STARTED_NEXT}`, "error")] }; // [B24-D2B review 2] open: another tab may still start it
    } else if (action === "unavailable" || action === "lineage-reopened") { // [B24-D2B review 4] its sentence names the lasting cause
      settled = { state: "outcome_unknown", text: sentence, tail: [row("next", "Next: Check the board and the revision history.", "error")] };
    } else if (action === "refused-poisoned") {
      const refusal = refusalSentence(null, true);
      settled = { state: "landed_unverified", text: refusal.headline, tail: [row("next", CHECK_RECORDS_NEXT, "error"), row("recovery", sentence)] }; // [B24-D2B review 4, 2026-10-10] after a reload the editor's one-step Undo no longer applies (RESTORED_UNDO_HINTS): the restored next step
    } else if (RECORDED_END_ACTIONS.has(action)) { settled = recordedEnd(action, row); /* [B24-D2B review 3] the journal's record, or no record any more */ } else {
      settled = { state: "outcome_unknown", text: sentence, tail: [row("next", `Next: ${action === "in-flight-elsewhere" ? IN_FLIGHT_ELSEWHERE_NEXT : INTERRUPTED_NEXT}`, "error")] }; // [B24-D2B review 4] another tab carrying it: never "ask again"
    }
    const rowStatus: EntryLogRow["status"] = settled.state === "committed" ? "done" : "error";
    entries = [{ id: `${id}${STATE_MARK}${settled.state}`, text: settled.text, status: rowStatus }, ...body, ...settled.tail];
    status = rowStatus;
  }
  const updated = { ...(messages[index] as object), status, entries } as unknown as M;
  return [...messages.slice(0, index), updated, ...messages.slice(index + 1)];
}

// ─── [B24-D2B review 3, 2026-10-10] D24-30, OD-214: every editor load re-derives a restored, unsettled entry from durable truth ────
// Appended on purpose: function declarations are hoisted and the constants are read only when an entry is re-derived, so no line cited above moves.

/**
 * [B24-D2B review 3, 2026-10-10] The grants the page asks the editor's sweep about at each editor load (`restoredGrants`): those of its restored
 * execution entries that are not settled (`awaiting_confirmation`, `issued`, `executing`, `outcome_unknown`) and that the page holds no
 * live entry for, each once, in chat order. A settled entry is never asked about: its grant was settled, retired or refused in the one
 * page that held its card, so no page can start it later (INFERRED: a card lives only in the page whose chat run received the grant).
 * An unsettled one is re-derived at every editor load from what the sweep reads - the journal and the server for an unfinished journal entry,
 * the journal's record of its end for a finished one (`recordedEnds`) - never kept from a sentence an earlier load wrote.
 */
export function restoredEntryGrants(messages: ReadonlyArray<{ id: string; entries?: ReadonlyArray<{ id: string }> }>, isLive: (grantId: string) => boolean): string[] {
  const grants: string[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.entries)) continue;
    const state = entryStateOfLogMessage({ id: message.id, entries: message.entries });
    if (state === null || TERMINAL.has(state)) continue;
    const grantId = message.id.slice(EXECUTION_ENTRY_ID_PREFIX.length);
    if (!isLive(grantId) && !grants.includes(grantId)) grants.push(grantId);
  }
  return grants;
}

/** [B24-D2B review 3, 2026-10-10] The sweep's results for a grant outside its work list (`recordedEnds` in `granted-executions.ts`). */
const RECORDED_END_ACTIONS: ReadonlySet<string> = new Set(["recorded-committed", "recorded-not-committed", "recorded-unverified", "unrecorded"]);
const RECORDED_COMMITTED = "Recorded: this browser's execution journal for this project records this change as committed and reported to the server.";
const RECORDED_NOT_COMMITTED = "Not made — this browser's execution journal for this project records this change as closed without a commit. Nothing was changed by it.";
const RECORDED_UNVERIFIED = "Recorded: this browser's execution journal for this project records this change's commit as one that could not be verified.";
const UNRECORDED = "Outcome not known — when the editor loaded this project, no record this page can read named this change any more, so this entry cannot say whether it was made.";
const CHECK_RECORDS_NEXT = "Next: Check the board and the revision history.";

/** [B24-D2B review 3, 2026-10-10] What a restored, unsettled entry becomes from the journal's record of its grant's end - committed as the
 *  adopted path writes it, not made, or landed unverified - or, once no record names its grant any more, of unknown outcome. */
function recordedEnd(action: string, row: (key: string, text: string, status?: EntryLogRow["status"]) => EntryLogRow): { state: ExecutionEntryState; text: string; tail: EntryLogRow[] } {
  if (action === "recorded-committed") return { state: "committed", text: "AI change committed by your editor (one canonical transaction)", tail: [row("recovery", RECORDED_COMMITTED), row("undo", RESTORED_UNDO_HINTS.redo)] };
  if (action === "recorded-not-committed") return { state: "not_made", text: RECORDED_NOT_COMMITTED, tail: [row("next", "Next: Ask again.", "error")] };
  if (action === "recorded-unverified") return { state: "landed_unverified", text: refusalSentence(null, true).headline, tail: [row("next", CHECK_RECORDS_NEXT, "error"), row("recovery", RECORDED_UNVERIFIED)] };
  return { state: "outcome_unknown", text: UNRECORDED, tail: [row("next", CHECK_RECORDS_NEXT, "error")] };
}

/** [B24-D2B review 3, 2026-10-10] A state sentence a load wrote from what it read then (`restoredEntryRecovery`): withdrawn at a load
 *  where no record names the grant any more. B18's own sentences (a pre-crash state "(interrupted by reload)") are kept. */
function writtenAtALoad(text: string): boolean {
  return text === RESTORED_NOT_STARTED || text === recoverySentence("interrupted-in-flight") || text === recoverySentence("unavailable") || text === UNRECORDED || text === recoverySentence("lineage-reopened") || text === recoverySentence("in-flight-elsewhere"); // [B24-D2B review 4] and the two sentences that round added
}

// ─── [B24-D2B review 4, 2026-10-10] D24-30, OD-214: a restored entry never offers the editor's one-step Undo ─────────────────────────
// Appended on purpose: a function declaration is hoisted and the constant is read only when an entry is restored or re-derived.

/** [B24-D2B review 4, 2026-10-10] The next step of a restored entry whose grant another tab is carrying forward (`in-flight-elsewhere`). */
const IN_FLIGHT_ELSEWHERE_NEXT = "Check your other open tabs of this project, or the board and the revision history.";

/**
 * [B24-D2B review 4, 2026-10-10] A landed-unverified record restored after a reload (`restoredEntryLog`): its live next step names the
 * editor's one-step Undo ("...; the editor's Undo restores the previous board.", `refusalSentence(_, true)`), which a reload no longer
 * offers (`RESTORED_UNDO_HINTS`). It reads the restored next step the page already uses ("Check the board and the revision history.");
 * every other row is kept, and a record without that step is returned as it was.
 */
function restoredLandedNext<M extends { id: string; entries: ReadonlyArray<{ id: string; text: string }> }>(message: M): M {
  const live = `Next: ${refusalSentence(null, true).next}`;
  if (!message.entries.some((row) => row.id.endsWith(":next") && row.text === live)) return message;
  return { ...message, entries: message.entries.map((row) => (row.id.endsWith(":next") && row.text === live ? { ...row, text: CHECK_RECORDS_NEXT } : row)) } as M;
}

// ─── [PR-G, 2026-10-17] The answer's model label (directive 4: never describe a fallback as Astra-generated) ──────────────────────
// Appended on purpose: a function declaration is hoisted and the constants are read only when a run ends, so no line cited above moves.

/** The page's configured answer source: the provider the send pinned (`aiBrainRef`) and the runtime's model for it (`/api/ai/runtime`,
 *  null while it loads). Compared with the run's OWN events; it never supplies the label. */
export interface ConfiguredAnswerSource { provider: string; model: string | null }
export const ANSWER_FOOTER_PREFIX = "answered by ";
/** What the footer says when the run's terminal event recorded no model (a replayed resume, a refused run). */
export const ANSWER_FOOTER_MODEL_UNRECORDED = "model not recorded by the run";

/**
 * The footer line under an ended run's answer: `answered by <provider> · <model>` from `run_started.provider` and `run_completed.model`
 * (the run's own events, never the page's configuration), then the disclosures - the run's provider or model differs from the
 * configured one (a fallback answered, named as such), and each specialist a `degraded compatible_fallback` notice reported. Null
 * while the run is open or when it produced no answer (nothing is claimed about text that does not exist). The label never enters
 * the history (`historyText`), so the model is never told what served it.
 */
export function answerFooter(state: RunViewState, configured?: ConfiguredAnswerSource | null): string | null {
  if (state.terminal === null || state.answer.length === 0) return null;
  const model = state.model !== null && state.model.length > 0 ? state.model : null;
  const base = `${ANSWER_FOOTER_PREFIX}${state.provider ?? "an unrecorded provider"} · ${model ?? ANSWER_FOOTER_MODEL_UNRECORDED}`;
  const disclosures: string[] = [];
  if (configured && ((state.provider !== null && state.provider !== configured.provider) || (model !== null && configured.model !== null && model !== configured.model))) {
    disclosures.push(`a fallback answered, not the configured ${configured.provider}${configured.model ? ` · ${configured.model}` : ""}`);
  }
  if (state.fallbackNotices > 0) disclosures.push(`${state.fallbackNotices} specialist result${state.fallbackNotices === 1 ? "" : "s"} came from a compatible fallback, not the configured model (the run log above names each)`);
  return disclosures.length > 0 ? `${base} — ${disclosures.join("; ")}` : base;
}

/** [PR-G, 2026-10-17] `run_started` (the route's first event) names the provider that serves the run; folded from the reducer's default so
 *  the lines B21 cites keep their numbers. Any other unknown event changes nothing, exactly as before. */
function reduceAnswerSource(state: RunViewState, event: Record<string, unknown>): RunViewState {
  if (event.type !== "run_started") return state;
  return { ...state, provider: typeof event.provider === "string" && event.provider.length > 0 ? event.provider.slice(0, 40) : state.provider };
}
