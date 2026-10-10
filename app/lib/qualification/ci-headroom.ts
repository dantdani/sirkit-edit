/**
 * [B24-D1] D24-28, OD-30 - the CI headroom check, pure: `headroom` takes a job's `timeout-minutes`, the second the job recorded at its
 * first step (the start variable scripts/ci-job-headroom.ts reads; nothing is read here) and the current second, and answers the
 * elapsed and remaining seconds with one of three states - `ok`, `split_required` (under OD-30's five minutes of headroom,
 * `OWNER_DECISIONS.md:104-108`: "split it if a run comes within five minutes of the limit") or `unknown` (no start recorded, or a
 * start after now), which fails too: a job whose start is unknown cannot claim headroom. `readJobTimeoutMinutes` reads a job's
 * `timeout-minutes` off a workflow's text (the job key at two spaces, the limit at four, before the next job key). No I/O.
 */
export const OD30_HEADROOM_MINUTES = 5;
export const HEADROOM_STATES = Object.freeze(["ok", "split_required", "unknown"] as const);
export type HeadroomState = (typeof HEADROOM_STATES)[number];
/** The script's exit codes, named: a split required or an unknown start both fail the step. */
export const OD30_SPLIT_REQUIRED = "OD30_SPLIT_REQUIRED";
export const OD30_START_UNKNOWN = "OD30_START_UNKNOWN";

export interface HeadroomReport {
  readonly state: HeadroomState;
  readonly timeoutMinutes: number;
  readonly elapsedSec: number | null;
  readonly headroomSec: number | null;
  /** fails the step: split_required and unknown */
  readonly failing: boolean;
  readonly code: typeof OD30_SPLIT_REQUIRED | typeof OD30_START_UNKNOWN | null;
}

const whole = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function headroom(input: { timeoutMinutes: number; startedAtSec: number | null; nowSec: number }): HeadroomReport {
  if (!whole(input.timeoutMinutes) || input.timeoutMinutes <= 0) throw new Error("OD30_TIMEOUT_INVALID");
  if (!whole(input.nowSec)) throw new Error("OD30_NOW_INVALID");
  if (input.startedAtSec === null || !whole(input.startedAtSec) || input.startedAtSec > input.nowSec) {
    return { state: "unknown", timeoutMinutes: input.timeoutMinutes, elapsedSec: null, headroomSec: null, failing: true, code: OD30_START_UNKNOWN };
  }
  const elapsedSec = input.nowSec - input.startedAtSec;
  const headroomSec = input.timeoutMinutes * 60 - elapsedSec;
  const splitRequired = headroomSec < OD30_HEADROOM_MINUTES * 60;
  return { state: splitRequired ? "split_required" : "ok", timeoutMinutes: input.timeoutMinutes, elapsedSec, headroomSec, failing: splitRequired, code: splitRequired ? OD30_SPLIT_REQUIRED : null };
}

/** "m min ss s" of a whole number of seconds. */
export function minutesSeconds(seconds: number): string {
  const value = Math.max(0, Math.round(seconds));
  return `${Math.floor(value / 60)} min ${String(value % 60).padStart(2, "0")} s`;
}

/** The start variable's value as the start second, or null when unset or not a whole number of seconds. */
export function parseStartedAt(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^\d{1,12}$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** A job's `timeout-minutes` from a workflow's text, or null when the job or its limit is absent. */
export function readJobTimeoutMinutes(workflowText: string, job: string): number | null {
  const lines = workflowText.split(/\r?\n/);
  const start = lines.indexOf(`  ${job}:`);
  if (start < 0) return null;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(line)) break;
    const limit = /^ {4}timeout-minutes: (\d+)\s*$/.exec(line);
    if (limit) return Number(limit[1]);
  }
  return null;
}

/** The one-line summary a step writes (the step summary and the log). */
export function renderHeadroom(job: string, report: HeadroomReport): string {
  const elapsed = report.elapsedSec === null ? "unknown" : minutesSeconds(report.elapsedSec);
  const remaining = report.headroomSec === null ? "unknown" : minutesSeconds(report.headroomSec);
  return `OD-30 headroom: ${job} elapsed ${elapsed} of ${report.timeoutMinutes} min, headroom ${remaining}: ${report.state}${report.code ? ` (${report.code})` : ""}`;
}
