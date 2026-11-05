/**
 * [K2, 2026-11-04] Runbook K.2 (OD-260 items 5, 6 and 8): the Work log's CONTRACT - its closed phases, its bounds, its one text cleaner,
 * the only links it may carry and the defensive reader of a stored log. Browser-safe and dependency-light (the redaction authority and
 * the CAD source registry, both pure): the project persistence validator imports it without the reducers.
 *
 * A Work log is display data on the EXISTING activity entry of a chat turn (or of a followed design task): concise rows at real stage
 * transitions, each with a phase that keeps an intent, a dispatched request, a received result, a validation, a stored object, a
 * proposal, a committed change, a wait and a block apart. It never carries model text, provider reasoning, prompts, tool payloads,
 * credentials or URLs other than a CAD source's registry documentation link.
 */
import { sanitizeModelBoundText } from "../agent/redaction";
import { CAD_SOURCE_ENTRIES } from "../acquisition/cad-source-registry";

export const WORK_LOG_SCHEMA = "sirkit.work-log.v1" as const;

/**
 * The closed phases (K.2 bullet 4): "I will import" is not "imported"; a dispatched request is not a completed action; a model sentence is
 * not a receipt. `intent`: an approach recorded by the system (a plan, a strategy change) - never a model sentence; `dispatched`: a request
 * or task was sent and nothing has come back yet; `received`: a result came back (not yet checked); `validated`: a check ran on it;
 * `stored`: bytes or a record were saved; `proposed`: something awaits a person's review, nothing applied; `committed`: a change was
 * applied and its receipt recorded; `waiting`: nothing runs until a named person, resource or time; `blocked`: it cannot continue as is
 * (the next action says what would unblock it); `skipped` / `refused` / `discarded` / `cancelled` / `interrupted`: what did NOT happen.
 */
export const WORK_LOG_PHASES = Object.freeze(["intent", "dispatched", "received", "validated", "stored", "proposed", "committed", "waiting", "blocked", "skipped", "refused", "discarded", "cancelled", "interrupted"] as const);
export type WorkLogPhase = (typeof WORK_LOG_PHASES)[number];
export const WORK_LOG_PHASE_LABELS: Readonly<Record<WorkLogPhase, string>> = Object.freeze({
  intent: "Approach", dispatched: "Started", received: "Received", validated: "Validated", stored: "Saved", proposed: "For your review", committed: "Applied",
  waiting: "Waiting", blocked: "Blocked", skipped: "Skipped", refused: "Refused", discarded: "Discarded", cancelled: "Stopped", interrupted: "Interrupted",
});
/** Where a row came from: the chat run's own events, a followed durable task's stored events, or this page. */
export const WORK_LOG_ORIGINS = Object.freeze(["run", "acquisition", "generation", "page"] as const);
export type WorkLogOrigin = (typeof WORK_LOG_ORIGINS)[number];
export const WORK_LOG_RUN_STATES = Object.freeze(["running", "completed", "failed", "cancelled", "interrupted"] as const);
export type WorkLogRunState = (typeof WORK_LOG_RUN_STATES)[number];

export const WORK_LOG_BOUNDS = Object.freeze({ rows: 40, textChars: 240, subjectChars: 80, nextChars: 240, keyChars: 200, follows: 4, allowanceChars: 300, idChars: 200 });

export interface WorkLogSource { label: string; href: string }
export interface WorkLogRow {
  /** the row's stable identity (run, call and event; task and event seq) - the dedup key */
  key: string;
  /** this log's own order (monotonic) */
  seq: number;
  phase: WorkLogPhase;
  origin: WorkLogOrigin;
  text: string;
  /** the part, sheet or task it concerns (display only) */
  subject: string | null;
  /** the attempt the server numbered (a worker claim), when it said so */
  attempt: number | null;
  /** a CAD source's registry documentation, never a download, signed or record URL */
  source: WorkLogSource | null;
  /** what unblocks it, when it is blocked or waiting for a person */
  next: string | null;
}
export interface WorkLogFollow { kind: "acquisition" | "generation"; taskId: string; cursor: number; terminal: boolean; state: string | null }
export interface WorkLogState {
  schema: typeof WORK_LOG_SCHEMA;
  /** the project and branch the log belongs to, and the ONE chat run it reads (null until the run starts or for a task-only log) */
  owner: { projectId: string; branchId: string; runId: string | null };
  rows: WorkLogRow[];
  nextSeq: number;
  /** the newest route sequence of the run's stream folded (a replayed or out-of-order event is dropped) */
  runSeq: number;
  /** rows this log did not keep: the oldest past its bound, and the steps a followed task's history had already dropped */
  dropped: number;
  /** a followed task's stored history began after what this log had seen ("earlier steps not kept") */
  gap: boolean;
  follows: WorkLogFollow[];
  /** the remaining allowance of a followed design task, in task units (OD-260 item 5) */
  allowance: string | null;
  run: WorkLogRunState;
}

/** The registry documentation links a row may carry (exactly these strings, HTTPS, reviewed with the registry). */
const DOCUMENTATION: ReadonlyArray<{ id: string; displayName: string; href: string; label: string }> = CAD_SOURCE_ENTRIES.map((entry) => ({ id: entry.id, displayName: entry.displayName, href: entry.provider.documentation[0] ?? "", label: `${entry.displayName} - documentation` })).filter((entry) => entry.href.startsWith("https://"));
const ALLOWED_HREFS: ReadonlySet<string> = new Set(CAD_SOURCE_ENTRIES.flatMap((entry) => [...entry.provider.documentation]).filter((href) => href.startsWith("https://")));

/** The documentation link of the CAD source a server sentence names (by its registry display name), or null. */
export function workLogSourceFor(text: string): WorkLogSource | null {
  const named = DOCUMENTATION.find((entry) => text.includes(entry.displayName));
  return named ? { label: named.label, href: named.href } : null;
}
/** Whether a link is one the registry documents (a restored log's links are re-checked; anything else is dropped). */
export function isWorkLogSource(value: unknown): value is WorkLogSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") === "href,label" && typeof record.href === "string" && ALLOWED_HREFS.has(record.href) && typeof record.label === "string" && record.label.length > 0 && record.label.length <= 160;
}

const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s)\]}>"']+/gi;
const WWW_LIKE = /\bwww\.[^\s)\]}>"']+/gi;
/** One row's text: secret-shaped substrings redacted (the shared authority), every URL removed, one line, bounded. */
export function workLogText(value: unknown, maxChars: number = WORK_LOG_BOUNDS.textChars): string {
  if (typeof value !== "string") return "";
  const cleaned = sanitizeModelBoundText(value.slice(0, 4_000).replace(URL_LIKE, "[link removed]").replace(WWW_LIKE, "[link removed]")).replace(/\s+/g, " ").trim(); // URLs first (a redaction inside one never leaves a tail of it)
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars - 1)}…` : cleaned;
}

export function emptyWorkLog(owner: { projectId: string; branchId: string; runId?: string | null }): WorkLogState {
  return { schema: WORK_LOG_SCHEMA, owner: { projectId: owner.projectId, branchId: owner.branchId, runId: owner.runId ?? null }, rows: [], nextSeq: 1, runSeq: 0, dropped: 0, gap: false, follows: [], allowance: null, run: "running" };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const boundedString = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max;
const count = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1_000_000_000;

function readRow(value: unknown): WorkLogRow | null {
  if (!isRecord(value)) return null;
  if (!boundedString(value.key, WORK_LOG_BOUNDS.keyChars) || value.key.length === 0 || !count(value.seq)) return null;
  if (!(WORK_LOG_PHASES as readonly unknown[]).includes(value.phase) || !(WORK_LOG_ORIGINS as readonly unknown[]).includes(value.origin)) return null;
  if (typeof value.text !== "string" || value.text.length === 0) return null;
  const text = workLogText(value.text);
  if (!text || text !== value.text) return null; // stored text is already clean: anything else was not written by this log
  if (value.source !== null && value.source !== undefined && !isWorkLogSource(value.source)) return null; // a link the registry does not document
  const subject = typeof value.subject === "string" ? workLogText(value.subject, WORK_LOG_BOUNDS.subjectChars) || null : null;
  const next = typeof value.next === "string" ? workLogText(value.next, WORK_LOG_BOUNDS.nextChars) || null : null;
  return { key: value.key, seq: value.seq, phase: value.phase as WorkLogPhase, origin: value.origin as WorkLogOrigin, text, subject, attempt: count(value.attempt) ? value.attempt : null, source: isWorkLogSource(value.source) ? { label: value.source.label, href: value.source.href } : null, next };
}
function readFollow(value: unknown): WorkLogFollow | null {
  if (!isRecord(value) || (value.kind !== "acquisition" && value.kind !== "generation") || !boundedString(value.taskId, WORK_LOG_BOUNDS.idChars) || value.taskId.length === 0 || !count(value.cursor)) return null;
  return { kind: value.kind, taskId: value.taskId, cursor: value.cursor, terminal: value.terminal === true, state: boundedString(value.state, 40) ? value.state : null };
}

/**
 * A stored (or imported) Work log read back defensively: the exact schema, its owner, bounded rows with closed phases, re-cleaned text and
 * re-checked links; anything else is null (the activity entry's plain rows stay; the log is dropped, never half-trusted).
 */
export function readStoredWorkLog(value: unknown): WorkLogState | null {
  if (!isRecord(value) || value.schema !== WORK_LOG_SCHEMA || !isRecord(value.owner)) return null;
  const owner = value.owner;
  if (!boundedString(owner.projectId, WORK_LOG_BOUNDS.idChars) || !boundedString(owner.branchId, WORK_LOG_BOUNDS.idChars) || (owner.runId !== null && !boundedString(owner.runId, WORK_LOG_BOUNDS.idChars))) return null;
  if (!Array.isArray(value.rows) || value.rows.length > WORK_LOG_BOUNDS.rows || !Array.isArray(value.follows) || value.follows.length > WORK_LOG_BOUNDS.follows) return null;
  if (!count(value.nextSeq) || !count(value.runSeq) || !count(value.dropped) || !(WORK_LOG_RUN_STATES as readonly unknown[]).includes(value.run)) return null;
  const rows = value.rows.map(readRow);
  const follows = value.follows.map(readFollow);
  if (rows.some((row) => row === null) || follows.some((follow) => follow === null)) return null;
  const allowance = typeof value.allowance === "string" ? workLogText(value.allowance, WORK_LOG_BOUNDS.allowanceChars) || null : null;
  return { schema: WORK_LOG_SCHEMA, owner: { projectId: owner.projectId, branchId: owner.branchId, runId: (owner.runId as string | null) ?? null }, rows: rows as WorkLogRow[], nextSeq: value.nextSeq, runSeq: value.runSeq, dropped: value.dropped, gap: value.gap === true, follows: follows as WorkLogFollow[], allowance, run: value.run as WorkLogRunState };
}

/** The persistence validator's test: a stored Work log reads back. */
export function isStoredWorkLog(value: unknown): boolean {
  return readStoredWorkLog(value) !== null;
}
