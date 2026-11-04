/**
 * [PR-L, 2026-10-17] Runbook L.2, increment 2: the closed vocabularies and primitive judges every generation-task document shares
 * (task-worker-contract.md sections 1-3). A separate module so `contracts.ts`, `events.ts` and `checkpoint.ts` share ONE definition
 * without an import cycle. Pure: no repository, no provider, no clock.
 *
 * Text rules: a one-line display field (a block name, a rationale, an assumption, a milestone or blocker sentence) must already be
 * the run-event redactor's output (`boundedRunEventText`, `agent/orchestration/run-events.ts`): redacted, one line, bounded; a
 * multi-line model-bound field (the prompt, a tool result, an explanation) must already be `sanitizeModelBoundText`'s output. A
 * judge never repairs a value: it refuses one that is not already clean, so a stored document is exactly what was validated.
 */
import { boundedRunEventText } from "../agent/orchestration/run-events";
import { containsTokenAnchoredSecretShapedText, sanitizeModelBoundText } from "../agent/redaction";
import { durableWorkflowJson } from "../durable-workflow/stable";

// ─── Closed vocabularies ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Section 2: seven non-terminal and four terminal states. Generated (`awaiting-review`), reviewed (`succeeded`) and applied stay
 *  distinct: the apply itself is the page's exact-base apply, never the task's. */
export const GENERATION_TASK_STATES = Object.freeze(["queued", "running", "waiting-for-provider", "waiting-for-resource", "awaiting-review", "paused", "cancel-requested", "cancelled", "succeeded", "failed", "stale"] as const);
export type GenerationTaskState = (typeof GENERATION_TASK_STATES)[number];
export const GENERATION_TASK_TERMINAL_STATES = Object.freeze(["cancelled", "succeeded", "failed", "stale"] as const satisfies readonly GenerationTaskState[]);
export const isTerminalGenerationTaskState = (state: GenerationTaskState): boolean => (GENERATION_TASK_TERMINAL_STATES as readonly string[]).includes(state);

export const GENERATION_TASK_PHASES = Object.freeze(["planning", "designing", "merging", "validating", "review"] as const);
export type GenerationTaskPhase = (typeof GENERATION_TASK_PHASES)[number];
export const GENERATION_TASK_ORIGINS = Object.freeze(["build", "chat"] as const);
export type GenerationTaskOrigin = (typeof GENERATION_TASK_ORIGINS)[number];
export const GENERATION_BASE_RECIPES = Object.freeze(["build-pin", "chat-sheet"] as const);
export type GenerationBaseRecipe = (typeof GENERATION_BASE_RECIPES)[number];
export const GENERATION_CATALOG_PROFILES = Object.freeze(["postgres", "fixture-blinker", "fixture-scripted"] as const);
export type GenerationCatalogProfile = (typeof GENERATION_CATALOG_PROFILES)[number];
export const GENERATION_SLICE_KINDS = Object.freeze(["plan", "block", "merge"] as const);
export type GenerationSliceKind = (typeof GENERATION_SLICE_KINDS)[number];
export const GENERATION_BLOCK_STATUSES = Object.freeze(["queued", "designing", "saved", "blocked", "needs-revalidation", "omitted"] as const);
export type GenerationBlockStatus = (typeof GENERATION_BLOCK_STATUSES)[number];
/** Section 5's strategy ladder, each a genuinely different start (never a replay of the same prompt). */
export const GENERATION_STRATEGIES = Object.freeze(["S1-baseline", "S2-fresh-seeded", "S3-catalog-guided", "S4-alternates-guided", "S5-block-split", "S6-missing-part"] as const);
export type GenerationStrategyId = (typeof GENERATION_STRATEGIES)[number];
export const GENERATION_STRATEGY_OUTCOMES = Object.freeze(["progress", "stagnant", "exhausted", "succeeded"] as const);
export type GenerationStrategyOutcome = (typeof GENERATION_STRATEGY_OUTCOMES)[number];
/** Section 2's closed blocker codes. A transient provider failure is never a blocker (it is `waiting-for-provider`). */
export const GENERATION_BLOCKER_CODES = Object.freeze(["provider_credentials", "provider_quota", "provider_access", "allowance_exhausted", "no_progress", "missing_part", "missing_evidence", "platform_failure", "task_window_elapsed", "partial_available"] as const);
export type GenerationBlockerCode = (typeof GENERATION_BLOCKER_CODES)[number];
/** The ONLY reasons a task may fail (section 2): everything else is a resumable state. */
export const GENERATION_FAILURE_REASONS = Object.freeze(["authority_revoked", "invalid_persisted_state", "invalid_request"] as const);
export type GenerationFailureReason = (typeof GENERATION_FAILURE_REASONS)[number];
/** The provider's retryable reasons (`llm/errors.ts` `isRetryableReason`) plus an admission-meter pause. */
export const GENERATION_WAITING_REASONS = Object.freeze(["rate_limit", "overloaded", "timeout", "network", "admission"] as const);
export type GenerationWaitingReason = (typeof GENERATION_WAITING_REASONS)[number];
export const GENERATION_CONTROL_ACTIONS = Object.freeze(["cancel", "pause", "resume", "retry-block", "review-partial", "record-review", "report-base", "rebase", "start-from-saved"] as const);
export type GenerationControlAction = (typeof GENERATION_CONTROL_ACTIONS)[number];
export const GENERATION_REVIEW_OUTCOMES = Object.freeze(["applied", "discarded"] as const);
export type GenerationReviewOutcome = (typeof GENERATION_REVIEW_OUTCOMES)[number];
/** `b1`..`b8` for a planned block, `main` for the single-block design (section 1.2). */
export const GENERATION_BLOCK_IDS = Object.freeze(["main", "b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"] as const);
export type GenerationBlockId = (typeof GENERATION_BLOCK_IDS)[number];

// ─── Errors ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A refusal with a closed, upper-case code and a bounded issue (`<path>: <rule>`) that never quotes the refused value. */
export class GenerationTaskContractError extends Error {
  constructor(readonly code: string, readonly issue: string) {
    super(`${code}: ${issue}`);
    this.name = "GenerationTaskContractError";
  }
}

// ─── Primitive judges (each answers an issue string or null; never throws) ──────────────────────────────────────────────

export type Issue = string | null;
export type Judge = (value: unknown, path: string) => Issue;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}
/** Exactly the required keys, plus any of the optional ones; an unknown key is refused by name position, never by value. */
export function keysIssue(record: Record<string, unknown>, path: string, required: readonly string[], optional: readonly string[] = []): Issue {
  for (const key of required) if (!Object.prototype.hasOwnProperty.call(record, key)) return `${path}.${key}: required`;
  for (const key of Object.keys(record)) if (!required.includes(key) && !optional.includes(key)) return `${path}: an unknown key is refused`;
  return null;
}
export const oneOf = <T extends string>(list: readonly T[]): Judge => (value, path) => (typeof value === "string" && (list as readonly string[]).includes(value) ? null : `${path}: outside the closed list`);
export const nullable = (judge: Judge): Judge => (value, path) => (value === null ? null : judge(value, path));
export const count = (max = Number.MAX_SAFE_INTEGER, min = 0): Judge => (value, path) => (typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max ? null : `${path}: an integer in [${min}, ${max}] is required`);
export const bool: Judge = (value, path) => (typeof value === "boolean" ? null : `${path}: a boolean is required`);
export const finiteNumber = (min: number, max: number): Judge => (value, path) => (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? null : `${path}: a finite number in range is required`);

/** An ISO-8601 instant in `Date#toISOString` form exactly. */
export const isoInstant: Judge = (value, path) => {
  if (typeof value !== "string" || value.length !== 24) return `${path}: an ISO instant is required`;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? null : `${path}: an ISO instant is required`;
};
/** An opaque identifier: 1..max characters, no whitespace or control character. */
export const identifier = (max = 200): Judge => (value, path) => (typeof value === "string" && value.length >= 1 && value.length <= max && !/[\s\p{Cc}\p{Cf}]/u.test(value) && !containsTokenAnchoredSecretShapedText(value) ? null : `${path}: an identifier is required`);
export const pattern = (rule: RegExp, label: string): Judge => (value, path) => (typeof value === "string" && rule.test(value) ? null : `${path}: ${label} is required`);

export const DURABLE_DIGEST = /^dw1-[0-9a-f]{64}$/;
export const ENGINEERING_DIGEST = /^eng1-[0-9a-f]{8,128}$/;
export const TASK_ID = /^generation-task:[0-9a-f]{32}$/;
export const SLICE_ID = /^generation-task:[0-9a-f]{32}:s[1-9][0-9]{0,5}$/;
export const RECORD_ID = /^durable-record:[0-9a-f]{32}$/;
export const LEASE_TOKEN = /^durable-lease:[0-9a-f]{32}$/;
export const CLIENT_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const durableDigest = pattern(DURABLE_DIGEST, "a durable digest");
export const taskId = pattern(TASK_ID, "a generation task id");
export const sliceId = pattern(SLICE_ID, "a slice id");
export const recordId = pattern(RECORD_ID, "a durable record id");
export const blockId = oneOf(GENERATION_BLOCK_IDS);

/** A one-line display field: already the run-event redactor's output, at most `max` characters (and not empty when `min` is 1). */
export const line = (max: number, min = 0): Judge => (value, path) => {
  if (typeof value !== "string" || value.length < min || value.length > max) return `${path}: a bounded line is required`;
  return boundedRunEventText(value, max) === value && !containsTokenAnchoredSecretShapedText(value) ? null : `${path}: a redacted single line is required`;
};
/** A multi-line model-bound field: already `sanitizeModelBoundText`'s output (line breaks and tabs kept), at most `max` characters. */
export const modelText = (max: number, min = 0): Judge => (value, path) => {
  if (typeof value !== "string" || value.length < min || value.length > max) return `${path}: a bounded text is required`;
  return sanitizeModelBoundText(value) === value && !containsTokenAnchoredSecretShapedText(value) ? null : `${path}: a redacted text is required`;
};
/** Repair a model-bound text to the fixed point `modelText` accepts (redact, strip format characters, cut), for builders only. */
export function cleanModelText(text: string, max: number): string {
  let value = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = sanitizeModelBoundText(value).slice(0, max);
    if (next === value) break;
    value = next;
  }
  return value;
}
/** Repair a one-line display text to the fixed point `line` accepts, for builders only. */
export function cleanLine(text: string, max: number): string {
  let value = text;
  for (let pass = 0; pass < 4; pass += 1) {
    const next = boundedRunEventText(value, max);
    if (next === value) break;
    value = next;
  }
  return value;
}

export const arrayOf = (judge: Judge, max: number, min = 0): Judge => (value, path) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) return `${path}: a list of ${min}..${max} entries is required`;
  for (let index = 0; index < value.length; index += 1) {
    const issue = judge(value[index], `${path}[${index}]`);
    if (issue) return issue;
  }
  return null;
};
/** A record keyed by `keyJudge`, each value judged; at most `max` entries. */
export const recordOf = (keyJudge: Judge, judge: Judge, max: number): Judge => (value, path) => {
  if (!isPlainRecord(value)) return `${path}: an object is required`;
  const keys = Object.keys(value);
  if (keys.length > max) return `${path}: at most ${max} entries`;
  for (const key of keys) {
    const keyIssue = keyJudge(key, `${path}{key}`);
    if (keyIssue) return keyIssue;
    const issue = judge(value[key], `${path}.${key}`);
    if (issue) return issue;
  }
  return null;
};
/** A closed-key object: every listed key judged, optional keys judged when present, nothing else. */
export function shape(fields: Readonly<Record<string, Judge>>, optional: Readonly<Record<string, Judge>> = {}): Judge {
  const required = Object.keys(fields), optionalKeys = Object.keys(optional);
  return (value, path) => {
    if (!isPlainRecord(value)) return `${path}: an object is required`;
    const issue = keysIssue(value, path, required, optionalKeys);
    if (issue) return issue;
    for (const key of required) {
      const fieldIssue = fields[key]!(value[key], `${path}.${key}`);
      if (fieldIssue) return fieldIssue;
    }
    for (const key of optionalKeys) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
      const fieldIssue = optional[key]!(value[key], `${path}.${key}`);
      if (fieldIssue) return fieldIssue;
    }
    return null;
  };
}

/** Plain JSON only (no undefined, no non-finite number, no class instance), at most `maxDepth` deep. */
export function plainJsonIssue(value: unknown, path: string, maxDepth = 24): Issue {
  if (maxDepth < 0) return `${path}: nested too deeply`;
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : `${path}: a finite number is required`;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const issue = plainJsonIssue(value[index], `${path}[${index}]`, maxDepth - 1);
      if (issue) return issue;
    }
    return null;
  }
  if (!isPlainRecord(value)) return `${path}: plain JSON is required`;
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) return `${path}: an undefined value is refused`;
    const issue = plainJsonIssue(child, `${path}.${key.length > 40 ? "[key]" : key}`, maxDepth - 1);
    if (issue) return issue;
  }
  return null;
}

/** The canonical serialized size the durable record stores (UTF-8 bytes of the canonical JSON). */
export function canonicalBytes(value: unknown): number {
  return new TextEncoder().encode(durableWorkflowJson(value)).length;
}
export const isoOf = (ms: number): string => new Date(ms).toISOString();

// [PR-J, 2026-11-04] Runbook J.7, increment J7-2 (allowance contention): appended after the last line, so no cited line moves.
/** Why a QUEUED slice waits that is not the provider's word (`GENERATION_WAITING_REASONS` stays the provider's and the meters'): `allowance`
 *  - the block fits the task's allowance on its own (spent + uncertain + its own need), but live sibling slices hold reservations that
 *  fill it; it is re-queued (bounded) until one of them ends, never parked as `allowance_exhausted`. */
export const GENERATION_QUEUE_WAIT_REASONS = Object.freeze(["allowance"] as const);
export type GenerationQueueWaitReason = (typeof GENERATION_QUEUE_WAIT_REASONS)[number];
