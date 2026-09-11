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
import type { ReceivedExecutionSettlement } from "./execution-grant-events";
import { checksLine, confirmationReason, operationLines, refusalSentence, retirementSentence, recoverySentence, targetLines, tierLabel, type RefOf } from "./execution-display";
import type { ProjectOperation } from "./operation-timeline"; // [B18-D I8]

export const LABEL_BEFORE_CHANGE = "Written before any change was made — the status above is authoritative.";
export const LABEL_BEFORE_REVIEW = "Written before anything was applied — the proposal above awaits your review.";
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

/** One tool line: the tier tag, the title and what really happened. */
export function toolLineLabel(input: { title?: unknown; tier?: unknown; ok?: unknown; status?: unknown }): string {
  const tier = tierLabel(input.tier);
  const tag = tier ? `T${input.tier as number} · ` : "";
  const title = typeof input.title === "string" && input.title.length > 0 ? input.title.slice(0, 120) : "tool";
  const status = typeof input.status === "string" ? input.status.slice(0, 60) : "unknown";
  if (input.ok !== true) return `${tag}${title} — refused (${status})`;
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
  committedExecutions: number;
  pendingReviews: number;
  terminal: "completed" | "failed" | null;
  failure: string | null;
}
export const initialRunView = (): RunViewState => ({ answer: "", interim: [], pendingExecutions: 0, committedExecutions: 0, pendingReviews: 0, terminal: null, failure: null });

/** Fold one raw run event (as the page receives it) into the run view. Unknown events change nothing. */
export function reduceRunView(state: RunViewState, event: Record<string, unknown>): RunViewState {
  switch (event.type) {
    case "text_delta": {
      const text = typeof event.text === "string" ? event.text : "";
      if (!text) return state;
      return event.phase === "final" ? { ...state, answer: state.answer + text } : { ...state, interim: [...state.interim, text] };
    }
    case "tool_finished": {
      if (event.ok !== true || typeof event.status !== "string") return state;
      if (EXECUTION_STATUSES.has(event.status)) return { ...state, pendingExecutions: state.pendingExecutions + 1 };
      if (REVIEW_STATUSES.has(event.status)) return { ...state, pendingReviews: state.pendingReviews + 1 };
      return state;
    }
    case "execution_settled":
      return event.status === "settled" && event.outcome === "committed" ? { ...state, committedExecutions: state.committedExecutions + 1 } : state;
    case "run_completed":
      return { ...state, terminal: state.terminal ?? "completed" };
    case "run_failed":
      return { ...state, terminal: "failed", failure: typeof event.message === "string" && event.message.length > 0 ? event.message.slice(0, 500) : "The assistant run failed." };
    default:
      return state;
  }
}


export interface RunViewProjection { answer: string; notes: string[]; label: string | null; historyText: string; failure: string | null }

/** What the page shows and what the next run's history carries. */
export function projectRunView(state: RunViewState): RunViewProjection {
  const unresolvedExecution = state.pendingExecutions > state.committedExecutions;
  const label = state.answer.length === 0 ? null : unresolvedExecution ? LABEL_BEFORE_CHANGE : state.pendingReviews > 0 ? LABEL_BEFORE_REVIEW : null;
  const answer = label ? `${label}\n\n${state.answer}` : state.answer;
  return {
    answer,
    notes: state.terminal ? state.interim.map((text) => `${NOTE_PREFIX}${text}`) : [],
    label,
    historyText: answer,
    failure: state.terminal === "failed" ? state.failure : null,
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
  undoResult?: { ok: boolean; text: string } | null;
  /** [B18-D review] the last confirmed attempt was refused for a transient reason (nothing changed; the card stays). */
  attempt?: string | null;
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
  };
}

/** The editor started executing it. */
export const entryExecuting = (entry: ExecutionEntry): ExecutionEntry => (entry.state === "issued" || entry.state === "awaiting_confirmation" ? { ...entry, state: "executing" } : entry);

/** The editor's ritual outcome (structural: the page passes what the ritual returned). */
export type EditorOutcome =
  | { ok: true; status: "committed" | "already-applied"; receipt: { transactionId: string; pcbRevisionBefore: string; pcbRevisionAfter: string; headSequenceAfter: number }; settled: "settled" | "settle-failed"; validations?: { drc?: unknown } | null; undoEligible?: boolean; presetId?: string | null }
  | { ok: false; code: string; changed: boolean; message?: string };

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
  const sentence = refusalSentence(outcome.code, outcome.changed);
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
    const headline = received.status === "retired" ? retirementSentence(received.reason) : "Not made — nothing changed.";
    return { ...entry, state: "not_made", failure: { headline, next: "Ask again.", code: received.reason ?? received.outcome ?? null }, undoEligible: false };
  }
  // in_flight / unsettled: the run could not learn the outcome in time.
  if (TERMINAL.has(entry.state)) return entry;
  return { ...entry, state: "outcome_unknown", failure: { headline: "Outcome not yet known — the editor did not report in time.", next: "Check the board and the revision history.", code: received.status } };
}

export const entryCancelled = (entry: ExecutionEntry): ExecutionEntry => (TERMINAL.has(entry.state) ? entry : { ...entry, state: "cancelled", failure: { headline: "Cancelled — nothing was changed.", next: "Ask again if you still want it.", code: "cancelled_by_user" } });
export const entrySuperseded = (entry: ExecutionEntry): ExecutionEntry => (TERMINAL.has(entry.state) ? entry : { ...entry, state: "superseded", failure: { headline: "Replaced — a newer change or a board change superseded it. Nothing was changed.", next: "Ask again.", code: "superseded" } });
export const entryRecovery = (entry: ExecutionEntry, action: unknown): ExecutionEntry => ({ ...entry, recovery: recoverySentence(action) });
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
export function entryUndoAvailability(entry: ExecutionEntry, newest: Pick<ProjectOperation, "kind" | "ref"> | undefined, aiChangeInFlight: boolean): EntryUndoAvailability | null {
  if (entry.state !== "committed" || !entry.transaction) return null;
  const latest = newest !== undefined && (newest.kind === "commit" || newest.kind === "redo") && newest.ref?.transactionId === entry.transaction.id;
  // The chat's Undo is one-shot (D-A8). [B18-D review] its reason stays true after the editor's Redo brings the change back.
  if (entry.undoResult?.ok) return { eligible: false, reason: latest ? "Undone once from here, and the editor's Redo brought it back — use the editor's Undo, or say “Undo that.”" : "Already undone — the editor's Redo brings it back." };
  if (!entry.undoEligible) return { eligible: false, reason: "No longer undoable from here — use the revision history." };
  if (aiChangeInFlight) return { eligible: false, reason: "Paused — an AI change is being made." };
  return latest ? { eligible: true, reason: null } : { eligible: false, reason: "No longer the latest operation — use the revision history." };
}

/** [B18-D I8] The chat Undo's result, written into the entry: a success names the one history step and ends the entry's
 *  Undo; a refusal carries the timeline's message verbatim and changes nothing else. */
export const entryUndoResult = (entry: ExecutionEntry, result: { ok: true } | { ok: false; message: string }): ExecutionEntry =>
  result.ok
    ? { ...entry, undoEligible: false, undoResult: { ok: true, text: "Undone by you — the editor's own Undo reversed this change (one history step)." } }
    : { ...entry, undoResult: { ok: false, text: `Not undone — ${result.message}` } };

// The execution entry as a chat log message. It persists through the EXISTING stored-chat log shape (no schema
// change): id `xlog-<grantId>`, a title, a status and rows of { id, text, status }. The entry's state rides in the
// first row's id (`xlog-<grantId>:state:<state>`) so a reloaded record still renders its state (a static record: no
// live Undo). The pinned phrases appear in the entry exactly once each:
//  - awaiting confirmation: "Change ready for your confirmation in the PCB editor — <after>; nothing has changed yet"
//  - executing:             "Executing in the PCB editor — <after> (one canonical transaction, undoable) — awaiting the editor's settlement"
//  - committed:             "AI change committed by your editor (one canonical transaction[, undoable])[ — DRC: N errors]"

export const EXECUTION_ENTRY_ID_PREFIX = "xlog-";
const STATE_MARK = ":state:";

export interface EntryLogRow { id: string; text: string; status: "running" | "done" | "error" }
export interface EntryLogMessage { id: string; role: "log"; title: string; status: "running" | "done" | "error"; entries: EntryLogRow[] }

const RUNNING_STATES: ReadonlySet<ExecutionEntryState> = new Set(["awaiting_confirmation", "issued", "executing", "outcome_unknown"]);
const ERROR_STATES: ReadonlySet<ExecutionEntryState> = new Set(["not_made", "landed_unverified", "cancelled", "superseded"]);

function stateSentence(entry: ExecutionEntry): string {
  const after = entry.understood.replace(/^[^—]*— /, "");
  switch (entry.state) {
    case "awaiting_confirmation": return `Change ready for your confirmation in the PCB editor — ${after}; nothing has changed yet`;
    case "issued": return `Issued — your editor executes it now (one canonical transaction, undoable)`;
    case "executing": return `Executing in the PCB editor — ${after} (one canonical transaction, undoable) — awaiting the editor's settlement`;
    case "committed": return `AI change committed by your editor (one canonical transaction${entry.undoEligible ? ", undoable" : ""})${entry.checks ? ` — ${entry.checks.replace(/^Checks: /, "")}` : ""}`;
    case "landed_unverified": return entry.failure?.headline ?? "The change LANDED but could not be verified — the board MAY have changed.";
    case "outcome_unknown": return entry.failure?.headline ?? "Outcome not yet known — the editor did not report in time.";
    default: return entry.failure?.headline ?? "Not made. Nothing was changed.";
  }
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
    const undo = entry.undoResult ?? { ok: true, text: entry.undoEligible ? "Undo: while it is the latest change — “Undo this change” here, the editor's Undo (one step), or say “Undo that.”" : "Undo: it was no longer the latest change when it settled — use the revision history." };
    rows.push(row("undo", undo.text, undo.ok ? "done" : "error"));
  }
  return { id, role: "log", title: `AI change — ${entry.understood}`.slice(0, 160), status, entries: rows };
}

/** The entry state of a (possibly reloaded) log message, or null when it is not an execution entry. */
export function entryStateOfLogMessage(message: { id: string; entries: ReadonlyArray<{ id: string }> }): ExecutionEntryState | null {
  if (!message.id.startsWith(EXECUTION_ENTRY_ID_PREFIX)) return null;
  const first = message.entries[0]?.id ?? "";
  const index = first.indexOf(STATE_MARK);
  const state = index >= 0 ? first.slice(index + STATE_MARK.length) : "";
  return (["awaiting_confirmation", "issued", "executing", "committed", "not_made", "landed_unverified", "outcome_unknown", "cancelled", "superseded"] as const).find((candidate) => candidate === state) ?? null;
}
