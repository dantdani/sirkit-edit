/**
 * B11 — the EVALUATION/REPLAY CAPSULE (`sirkit.agent-replay-capsule.v1`)
 * and the provider-free deterministic replay engine.
 *
 * The capsule is a DISTINCT contract from the runtime audit trace:
 *
 *  - Runtime trace (`trace.ts`): redacted metadata and digests only. It
 *    deliberately CANNOT reconstruct model output.
 *  - Replay capsule (here): an explicit SANITIZED FIXTURE used only by
 *    tests/evaluation. It may carry bounded normalized adapter steps and
 *    context inputs required for deterministic replay, and it is NEVER
 *    automatically persisted from live runs — capsules are authored (or
 *    generated) fixtures, and nothing in the production route or loop
 *    writes one.
 *
 * Replay executes the REAL registry, discovery, context-integrity
 * boundary, gateway, and normalized loop against a SCRIPTED adapter and a
 * trace recorder. It never calls OpenAI, Anthropic, a database, or any
 * network route.
 */

import { assembleAgentRunContext, buildAgentResourceBundle } from "./context";
import { PCB_DECLARED_FIELD_NAMES, validateCapturedReplayContext, type ReplayContextFixture } from "./replay-context";
import { capturePlainJson, type DeepReadonly } from "./plain-capture";
import { createAgentToolGateway } from "./gateway";
import { buildRunToolset, runAgentLoop } from "./loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentRunResult, type AgentStep, type ProviderAgentAdapter } from "./contracts";
import { sirkitToolRegistry } from "../engineering/tool-catalog";
import { AGENT_SYSTEM_PROMPT, AGENT_SYSTEM_PROMPT_VERSION } from "../prompts";
import { engineeringDigest } from "../engineering/stable";
import { agentRunTraceDigest, containsSecretShapedText, findNonPlainJsonPath, findSecretShapedPath, isCredentialShapedName, validateAgentRunTrace, type AgentRunTrace } from "./trace";
import { redactPathSegment } from "./redaction";
import { AgentTraceRecorder, InMemoryTraceSink, type AgentTraceSink } from "./trace-recorder";

/**
 * [B11.2] v2 — the capsule's `context` became the VERSIONED, recursively
 * validated replay-context contract instead of an "opaque fixture".
 *
 * [B11.3 §D] v3 — DELIBERATE DECISION, recorded rather than assumed. The
 * capsule's OWN field set is unchanged; only the nested contract tightened
 * (`…replay-context.v1` → `.v2`, exact at every depth of the PCB type graph).
 * The capsule is nevertheless bumped, for one reason: a capsule is validated
 * and transported as a WHOLE document, and a consumer holding a v2 capsule
 * cannot tell from the outer tag whether its context is v1 or v2. The outer
 * version is therefore kept meaningful as "this entire document conforms to
 * the current contract".
 *
 * The counter-argument is real and is recorded too: the nested contract
 * carries its own explicit version and is enforced first, so a stale document
 * already refuses with a precise `context.schema: expected …v2` message —
 * strictly more informative than an outer-version mismatch. Bumping the outer
 * envelope whenever an inner contract moves risks turning it into a change
 * counter rather than a shape identifier. Consistency with the B11.2
 * precedent and whole-document validity decided it.
 *
 * Capsules are authored in-repo fixtures and are never persisted from live
 * runs, so no stored document is invalidated by either bump.
 *
 * [B21 F] v4 - the capsule's OWN field set grew, so the outer version moves
 * (the B11.3 rule above): an optional `tasks` list - one step list per task
 * of a task graph, each with its role label and provider - and an optional
 * `stall` on any step (a scripted turn that never answers until the run's
 * own signal ends it: a scripted timeout, beside the scripted `failure`). A
 * capsule with no tasks replays exactly as v3 did; one with tasks is replayed
 * ONLY through an injected task-graph runner (`ReplayOptions.taskGraph`),
 * never by the single-loop engine here, which reports it as a failure.
 */
export const AGENT_REPLAY_CAPSULE_SCHEMA = "sirkit.agent-replay-capsule.v4" as const;

/** A scripted normalized model turn — provider-neutral, bounded, no
 *  provider continuation state (the runner supplies an inert one). */
export interface CapsuleStep {
  text: string;
  toolCalls: Array<{ callId: string; providerName: string; argumentsText: string }>;
  stopReason: string | null;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  /** Optional scripted provider failure INSTEAD of a step (normalized
   *  classification only — never a raw upstream body). */
  failure?: { reason: string; message: string };
  /** [B21 F] Optional scripted STALL instead of a step: the turn never answers until the run's own
   *  signal ends it (a timeout). Exactly `true`, and only in a task's step list (never the run's own). */
  stall?: true;
}

/** [B21 F] One task of a task graph: its 1-based index IN THE GRAPH'S PLAN (the runner refuses a task its plan does not schedule
 *  at that index), its role label (one step list per role), the provider it runs on, and its own ordered step list. */
export interface CapsuleTask {
  index: number;
  role: string;
  provider: "openai" | "anthropic";
  steps: CapsuleStep[];
}

export interface ReplayCapsule {
  schema: typeof AGENT_REPLAY_CAPSULE_SCHEMA;
  caseId: string;
  provider: "openai" | "anthropic";
  promptVersion: string;
  promptDigest: string;
  registryDigest: string;
  scope: { tenantId: string; projectId: string; branchId: string };
  /** [B11.2] the VERSIONED replay-context contract — validated recursively
   *  through the shared canonical authorities before any execution. */
  context: ReplayContextFixture;
  userMessage: string;
  steps: CapsuleStep[];
  /** [B21 F] v4: the per-task step lists of a task graph (absent or empty: one run, as v3) */
  tasks?: CapsuleTask[];
  expected: {
    discoveredTools: string[];
    toolOutcomes: Array<{ toolId: string; outcomeClass: string; status: string }>;
    terminal: { outcome: "completed" | "failed" | "cancelled"; failureReason: string | null };
    traceDigest: string;
  };
}

// ─── [B11.1] EXACT capsule validation (before ANY execution) ────────────────

export const REPLAY_CAPSULE_BOUNDS = Object.freeze({
  maxSteps: 32,
  maxToolCallsPerStep: 16,
  maxArgumentChars: 20_000,
  maxMessageChars: 20_000,
  maxArrayEntries: 256,
  maxIdChars: 128,
  maxTextChars: 20_000,
  maxSerializedBytes: 2_000_000,
  maxIssues: 12,
  /** [B21 F] v4: at most this many task step lists (each bounded by maxSteps) */
  maxTasks: 8,
  maxRoleChars: 64,
});

/**
 * Field names that may NEVER appear anywhere in a capsule — provider
 * continuation state, hidden reasoning, raw upstream bodies, SDK objects,
 * and credentials. Exact-key validation already refuses unknown fields;
 * this list refuses the dangerous ones BY NAME with a precise reason.
 */
/** [B11.1] names are compared FOLDED (lowercased, separators removed) so
 *  near-misses such as `apikey`, `API_KEY`, `Authorization`,
 *  `reasoningContent`, `continuationState`, `providerRawBody`, and
 *  `openaiClient` cannot slip past an exact-match denylist. */
function foldKeyName(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FORBIDDEN_CAPSULE_KEY_NAMES: readonly string[] = [
  "continuation", "opaqueProviderContinuation", "providerContinuation", "state",
  "reasoning", "reasoning_content", "encrypted_content", "thinking", "redacted_thinking",
  "rawProviderBody", "rawResponse", "rawRequest", "providerResponse", "providerRequest",
  "response", "request", "httpResponse", "body", "headers",
  "client", "sdk", "openai", "anthropic",
  "authorization", "apiKey", "api_key", "x-api-key", "credential", "credentials",
  "secret", "password", "token", "accessToken", "access_token", "bearer",
];

/** EXACT folded names (short/generic — substring matching them would
 *  false-positive on legitimate fields such as `canonicalStateDigest`). */
const FORBIDDEN_CAPSULE_FOLDED_EXACT: ReadonlySet<string> = new Set(FORBIDDEN_CAPSULE_KEY_NAMES.map(foldKeyName));

/** Unambiguous COMPOUND stems: a key whose folded form contains one of
 *  these is forbidden regardless of case, separators, or affixes. No PCB,
 *  schematic, netlist, or capsule field legitimately contains them. */
const FORBIDDEN_CAPSULE_STEMS: readonly string[] = [
  "apikey", "authorization", "bearer", "credential", "password",
  "accesstoken", "reasoning", "thinking", "continuation",
  "rawbody", "rawrequest", "rawresponse", "rawprovider",
  "providerraw", "providerbody", "providerrequest", "providerresponse",
  "encryptedcontent", "openaiclient", "anthropicclient", "sdkclient",
];

function isForbiddenCapsuleKey(key: string): boolean {
  const folded = foldKeyName(key);
  if (FORBIDDEN_CAPSULE_FOLDED_EXACT.has(folded)) return true;
  if (FORBIDDEN_CAPSULE_STEMS.some((stem) => folded.includes(stem))) return true;
  // [B11.2] R2: the capsule list predates the shared credential-name
  // authority and missed compound names (`clientSecret`, `refreshToken`,
  // `providerClient`, `rawSdkPayload`). Delegate to the ONE shared
  // classifier so both boundaries can never drift apart again.
  return isCredentialShapedName(key);
}

const CAPSULE_KEYS = ["schema", "caseId", "provider", "promptVersion", "promptDigest", "registryDigest", "scope", "context", "userMessage", "steps", "expected"] as const;
const CAPSULE_OPTIONAL_KEYS = ["tasks"] as const; // [B21 F] v4
const CAPSULE_TASK_KEYS = ["index", "role", "provider", "steps"] as const; // [B21 F] v4
const CAPSULE_ROLE = /^[a-z][a-z-]*$/; // [B21 F] a role label: lower-case words joined by hyphens
const CAPSULE_SCOPE_KEYS = ["tenantId", "projectId", "branchId"] as const;
const CAPSULE_STEP_KEYS = ["text", "toolCalls", "stopReason", "model", "usage"] as const;
const CAPSULE_STEP_OPTIONAL_KEYS = ["failure", "stall"] as const; // [B21 F] v4: + `stall`
const CAPSULE_TOOL_CALL_KEYS = ["callId", "providerName", "argumentsText"] as const;
const CAPSULE_USAGE_KEYS = ["inputTokens", "outputTokens"] as const;
const CAPSULE_FAILURE_KEYS = ["reason", "message"] as const;
const CAPSULE_EXPECTED_KEYS = ["discoveredTools", "toolOutcomes", "terminal", "traceDigest"] as const;
const CAPSULE_OUTCOME_KEYS = ["toolId", "outcomeClass", "status"] as const;
const CAPSULE_TERMINAL_KEYS = ["outcome", "failureReason"] as const;

/** A stable structured refusal that never echoes capsule VALUES. */
export class ReplayCapsuleInvalidError extends Error {
  readonly code = "REPLAY_CAPSULE_INVALID" as const;
  constructor(readonly issues: string[]) {
    super(`REPLAY_CAPSULE_INVALID: ${issues.slice(0, 3).join("; ")}`);
    this.name = "ReplayCapsuleInvalidError";
  }
}

class CapsuleIssues {
  private readonly list: string[] = [];
  push(issue: string): void { if (this.list.length < REPLAY_CAPSULE_BOUNDS.maxIssues) this.list.push(issue); }
  get length(): number { return this.list.length; }
  value(): string[] { return [...this.list]; }
}

/** [B11.1] key names are echoed into diagnostics, so they are sanitized and
 *  bounded — a secret embedded in a KEY NAME can never reach a report. */
function safeCapsuleKey(key: string): string {
  return redactPathSegment(key, 60);
}

function capsuleExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[], label: string, issues: CapsuleIssues): boolean {
  let ok = true;
  for (const key of Object.keys(value)) {
    if (required.includes(key) || optional.includes(key)) continue;
    issues.push(isForbiddenCapsuleKey(key)
      ? `${label}.${safeCapsuleKey(key)}: forbidden field (provider continuation, reasoning, raw bodies, SDK objects, and credentials are never permitted in a capsule)`
      : `${label}.${safeCapsuleKey(key)}: unknown key`);
    ok = false;
  }
  for (const key of required) {
    // [B11.1] OWN properties only. A prototype-supplied field is invisible
    // to Object.keys AND to JSON.stringify (escaping the secret denylist)
    // yet still readable by the replay engine — such a capsule is REFUSED.
    if (!Object.prototype.hasOwnProperty.call(value, key) || value[key] === undefined) {
      issues.push(`${label}.${key}: missing`);
      ok = false;
    }
  }
  return ok;
}

/** [B11.2] `scanOpaqueFixture` is RETIRED. Context fixtures are no longer
 *  opaque: `validateReplayContext` validates them recursively through the
 *  shared canonical authorities and proves completeness by projection
 *  round-trip. Forbidden/credential-shaped NAMES are still refused
 *  everywhere in the capsule by `findSecretShapedPath`. */

function boundedCapsuleString(value: unknown, label: string, issues: CapsuleIssues, max: number, allowEmpty = false): boolean {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > max) {
    issues.push(`${label}: must be a ${allowEmpty ? "" : "non-empty "}string of at most ${max} chars`);
    return false;
  }
  return true;
}

function nonNegativeCapsuleInteger(value: unknown, label: string, issues: CapsuleIssues): boolean {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    issues.push(`${label}: must be a nonnegative safe integer`);
    return false;
  }
  return true;
}

/**
 * [B11.1] Validate a replay capsule EXACTLY: recursive exact keys, hard
 * bounds, forbidden field names, and a whole-capsule secret denylist.
 * Returns every violation (bounded); empty ⇔ safe to execute.
 */
export type ReplayCapsuleParseResult =
  | { ok: true; value: DeepReadonly<ReplayCapsule> }
  | { ok: false; issues: string[] };

/**
 * [B11.4 §B] THE parse. Capture the untrusted document ONCE into an
 * independent, deep-frozen, hook-free snapshot, validate THAT, and hand the
 * snapshot back. Every consumer — schema checks, context assembly, discovery,
 * scripted steps, expected comparisons, trace identity, execution — reads the
 * returned value and never the caller's object again.
 */
export function parseReplayCapsule(untrusted: unknown): ReplayCapsuleParseResult {
  const captured = capturePlainJson(untrusted, "capsule", REPLAY_CAPSULE_BOUNDS.maxSerializedBytes);
  if (!captured.ok) return { ok: false, issues: captured.issues.slice(0, REPLAY_CAPSULE_BOUNDS.maxIssues) };
  const issues = validateCapturedCapsule(captured.value);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: captured.value as unknown as DeepReadonly<ReplayCapsule> };
}

/**
 * Compatibility wrapper: the issue list only. Prefer `parseReplayCapsule`,
 * which additionally yields the immutable snapshot that must be executed.
 */
export function validateReplayCapsule(raw: unknown): string[] {
  const parsed = parseReplayCapsule(raw);
  return parsed.ok ? [] : parsed.issues;
}

function validateCapturedCapsule(raw: unknown): string[] {
  const issues = new CapsuleIssues();
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ["capsule is not an object"];
  const capsule = raw as Record<string, unknown>;

  // [B11.1] plain-JSON shape. Capture already guarantees it; kept as an
  // independent assertion so this function is sound when called directly.
  const nonPlain = findNonPlainJsonPath(capsule, "capsule");
  if (nonPlain !== null) return [nonPlain];

  // Serialization is now safe: `capsule` is our OWN captured snapshot, so
  // there is no `toJSON` hook left to invoke.
  let serialized: string;
  try { serialized = JSON.stringify(capsule); } catch { return ["capsule is not serializable"]; }
  if (serialized.length > REPLAY_CAPSULE_BOUNDS.maxSerializedBytes) return [`capsule exceeds the ${REPLAY_CAPSULE_BOUNDS.maxSerializedBytes}-byte size bound`];

  if (!capsuleExactKeys(capsule, CAPSULE_KEYS, CAPSULE_OPTIONAL_KEYS, "capsule", issues)) return issues.value();
  if (capsule.schema !== AGENT_REPLAY_CAPSULE_SCHEMA) return [`capsule.schema: expected ${AGENT_REPLAY_CAPSULE_SCHEMA}`];
  boundedCapsuleString(capsule.caseId, "capsule.caseId", issues, REPLAY_CAPSULE_BOUNDS.maxIdChars);
  if (capsule.provider !== "openai" && capsule.provider !== "anthropic") issues.push("capsule.provider: unknown provider");
  boundedCapsuleString(capsule.promptVersion, "capsule.promptVersion", issues, 64);
  boundedCapsuleString(capsule.promptDigest, "capsule.promptDigest", issues, 128);
  boundedCapsuleString(capsule.registryDigest, "capsule.registryDigest", issues, 128);
  boundedCapsuleString(capsule.userMessage, "capsule.userMessage", issues, REPLAY_CAPSULE_BOUNDS.maxMessageChars, true);

  // scope
  const scope = capsule.scope;
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) issues.push("capsule.scope: must be an object");
  else if (capsuleExactKeys(scope as Record<string, unknown>, CAPSULE_SCOPE_KEYS, [], "capsule.scope", issues)) {
    for (const key of CAPSULE_SCOPE_KEYS) boundedCapsuleString((scope as Record<string, unknown>)[key], `capsule.scope.${key}`, issues, REPLAY_CAPSULE_BOUNDS.maxIdChars);
  }

  // [B11.2] context: the VERSIONED `sirkit.agent-replay-context.v1` contract.
  // Every field is validated recursively through the shared canonical
  // authorities and proven by a projection round-trip, so nothing accepted
  // here can be silently discarded during normalization.
  const contextResult = validateCapturedReplayContext(capsule.context);
  if (!contextResult.ok) for (const issue of contextResult.issues) issues.push(`capsule.${issue}`);

  // steps
  validateCapsuleSteps(capsule.steps, "capsule.steps", issues);
  // [B21 F] v4: the per-task step lists of a task graph
  if (capsule.tasks !== undefined) validateCapsuleTasks(capsule.tasks, issues);

  // expected
  validateCapsuleExpected(capsule.expected, issues);

  // [B11.2] R3 — whole-capsule secret scan. The DIRECT recursive walk
  // inspects every key name and every ORIGINAL string value; the serialized
  // scan is kept as an independent second net. Serialization escapes nested
  // quotes, so credential-shaped JSON embedded in `argumentsText`,
  // `userMessage`, step text, or failure text is invisible to the serialized
  // form alone — it is not invisible to the direct walk.
  if (issues.length === 0) {
    const secretPath = findSecretShapedPath(capsule, "capsule", 0, { nodes: 0 }, PCB_DECLARED_FIELD_NAMES);
    if (secretPath !== null) issues.push(secretPath);
  }
  if (issues.length === 0 && containsSecretShapedText(serialized)) issues.push("capsule: contains secret-shaped content");
  return issues.value();
}

/** One ordered step list (the run's own, or [B21 F] one task's - the only list a stall may be scripted in): non-empty, bounded, each step exact. */
function validateCapsuleSteps(steps: unknown, at: string, issues: CapsuleIssues, stallAllowed = false): void {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > REPLAY_CAPSULE_BOUNDS.maxSteps) {
    issues.push(`${at}: must be a non-empty array of at most ${REPLAY_CAPSULE_BOUNDS.maxSteps}`);
  } else {
    for (const [index, item] of steps.entries()) {
      if (issues.length >= REPLAY_CAPSULE_BOUNDS.maxIssues) break;
      const label = `${at}[${index}]`;
      if (typeof item !== "object" || item === null || Array.isArray(item)) { issues.push(`${label}: not an object`); continue; }
      const step = item as Record<string, unknown>;
      if (!capsuleExactKeys(step, CAPSULE_STEP_KEYS, CAPSULE_STEP_OPTIONAL_KEYS, label, issues)) continue;
      boundedCapsuleString(step.text, `${label}.text`, issues, REPLAY_CAPSULE_BOUNDS.maxTextChars, true);
      boundedCapsuleString(step.model, `${label}.model`, issues, 100, true);
      if (step.stopReason !== null && !boundedCapsuleString(step.stopReason, `${label}.stopReason`, issues, 64)) continue;
      const usage = step.usage;
      if (typeof usage !== "object" || usage === null || Array.isArray(usage)) issues.push(`${label}.usage: must be an object`);
      else if (capsuleExactKeys(usage as Record<string, unknown>, CAPSULE_USAGE_KEYS, [], `${label}.usage`, issues)) {
        for (const key of CAPSULE_USAGE_KEYS) nonNegativeCapsuleInteger((usage as Record<string, unknown>)[key], `${label}.usage.${key}`, issues);
      }
      const toolCalls = step.toolCalls;
      if (!Array.isArray(toolCalls) || toolCalls.length > REPLAY_CAPSULE_BOUNDS.maxToolCallsPerStep) {
        issues.push(`${label}.toolCalls: must be an array of at most ${REPLAY_CAPSULE_BOUNDS.maxToolCallsPerStep}`);
      } else {
        for (const [callIndex, callItem] of toolCalls.entries()) {
          const callLabel = `${label}.toolCalls[${callIndex}]`;
          if (typeof callItem !== "object" || callItem === null || Array.isArray(callItem)) { issues.push(`${callLabel}: not an object`); break; }
          const call = callItem as Record<string, unknown>;
          if (!capsuleExactKeys(call, CAPSULE_TOOL_CALL_KEYS, [], callLabel, issues)) break;
          boundedCapsuleString(call.callId, `${callLabel}.callId`, issues, REPLAY_CAPSULE_BOUNDS.maxIdChars);
          boundedCapsuleString(call.providerName, `${callLabel}.providerName`, issues, REPLAY_CAPSULE_BOUNDS.maxIdChars);
          boundedCapsuleString(call.argumentsText, `${callLabel}.argumentsText`, issues, REPLAY_CAPSULE_BOUNDS.maxArgumentChars, true);
        }
      }
      if (step.failure !== undefined) {
        const failure = step.failure;
        if (typeof failure !== "object" || failure === null || Array.isArray(failure)) issues.push(`${label}.failure: must be an object`);
        else if (capsuleExactKeys(failure as Record<string, unknown>, CAPSULE_FAILURE_KEYS, [], `${label}.failure`, issues)) {
          boundedCapsuleString((failure as Record<string, unknown>).reason, `${label}.failure.reason`, issues, 64);
          boundedCapsuleString((failure as Record<string, unknown>).message, `${label}.failure.message`, issues, 300, true);
        }
      }
      if (step.stall !== undefined) { if (!stallAllowed) issues.push(`${label}.stall: a stall is scripted only in a task's step list`); else if (step.stall !== true) issues.push(`${label}.stall: must be exactly true`); } // [B21 F] v4; [B21 F fix: coverage-9] never on the run's own steps (the single-loop engine's production timer)
      if (step.stall === true && step.failure !== undefined) issues.push(`${label}: a stall and a failure are exclusive`); // [B21 F] v4
    }
  }
}

/** [B21 F] v4: the task step lists - bounded, each exact, plan indexes ascending from 1, one list per role label, a known provider, its own steps. */
function validateCapsuleTasks(tasks: unknown, issues: CapsuleIssues): void {
  if (!Array.isArray(tasks) || tasks.length > REPLAY_CAPSULE_BOUNDS.maxTasks) {
    issues.push(`capsule.tasks: must be an array of at most ${REPLAY_CAPSULE_BOUNDS.maxTasks}`);
    return;
  }
  const roles = new Set<string>(); let previous = 0; for (const [position, item] of tasks.entries()) { // [B21 F fix: tests-09] the plan's index (ascending) and one list per role
    if (issues.length >= REPLAY_CAPSULE_BOUNDS.maxIssues) break;
    const label = `capsule.tasks[${position}]`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) { issues.push(`${label}: not an object`); continue; }
    const task = item as Record<string, unknown>;
    if (!capsuleExactKeys(task, CAPSULE_TASK_KEYS, [], label, issues)) continue;
    if (!Number.isSafeInteger(task.index) || (task.index as number) <= previous) issues.push(`${label}.index: must be a positive integer above the previous task's (its index in the plan, listed in order)`); else previous = task.index as number;
    if (boundedCapsuleString(task.role, `${label}.role`, issues, REPLAY_CAPSULE_BOUNDS.maxRoleChars) && !CAPSULE_ROLE.test(task.role as string)) issues.push(`${label}.role: must be a role label (lower-case words joined by hyphens)`); else if (typeof task.role === "string" && roles.has(task.role)) issues.push(`${label}.role: duplicate (a role has one step list)`); if (typeof task.role === "string") roles.add(task.role);
    if (task.provider !== "openai" && task.provider !== "anthropic") issues.push(`${label}.provider: unknown provider`);
    validateCapsuleSteps(task.steps, `${label}.steps`, issues, true);
  }
}

function validateCapsuleExpected(expected: unknown, issues: CapsuleIssues): void {
  if (typeof expected !== "object" || expected === null || Array.isArray(expected)) issues.push("capsule.expected: must be an object");
  else if (capsuleExactKeys(expected as Record<string, unknown>, CAPSULE_EXPECTED_KEYS, [], "capsule.expected", issues)) {
    const expectedRecord = expected as Record<string, unknown>;
    const tools = expectedRecord.discoveredTools;
    if (!Array.isArray(tools) || tools.length > REPLAY_CAPSULE_BOUNDS.maxArrayEntries) issues.push("capsule.expected.discoveredTools: must be a bounded array");
    else for (const [index, tool] of tools.entries()) { if (!boundedCapsuleString(tool, `capsule.expected.discoveredTools[${index}]`, issues, REPLAY_CAPSULE_BOUNDS.maxIdChars)) break; }
    const outcomes = expectedRecord.toolOutcomes;
    if (!Array.isArray(outcomes) || outcomes.length > REPLAY_CAPSULE_BOUNDS.maxArrayEntries) issues.push("capsule.expected.toolOutcomes: must be a bounded array");
    else {
      for (const [index, outcomeItem] of outcomes.entries()) {
        const label = `capsule.expected.toolOutcomes[${index}]`;
        if (typeof outcomeItem !== "object" || outcomeItem === null || Array.isArray(outcomeItem)) { issues.push(`${label}: not an object`); break; }
        const outcome = outcomeItem as Record<string, unknown>;
        if (!capsuleExactKeys(outcome, CAPSULE_OUTCOME_KEYS, [], label, issues)) break;
        boundedCapsuleString(outcome.toolId, `${label}.toolId`, issues, REPLAY_CAPSULE_BOUNDS.maxIdChars);
        boundedCapsuleString(outcome.outcomeClass, `${label}.outcomeClass`, issues, 64);
        boundedCapsuleString(outcome.status, `${label}.status`, issues, 64);
      }
    }
    const terminal = expectedRecord.terminal;
    if (typeof terminal !== "object" || terminal === null || Array.isArray(terminal)) issues.push("capsule.expected.terminal: must be an object");
    else if (capsuleExactKeys(terminal as Record<string, unknown>, CAPSULE_TERMINAL_KEYS, [], "capsule.expected.terminal", issues)) {
      const terminalRecord = terminal as Record<string, unknown>;
      if (!["completed", "failed", "cancelled"].includes(terminalRecord.outcome as string)) issues.push("capsule.expected.terminal.outcome: outside the closed vocabulary");
      if (terminalRecord.failureReason !== null && !boundedCapsuleString(terminalRecord.failureReason, "capsule.expected.terminal.failureReason", issues, 64)) {
        // bounded reporting only
      }
    }
    boundedCapsuleString(expectedRecord.traceDigest, "capsule.expected.traceDigest", issues, 128);
  }
}

// ─── Scripted adapter (no provider, no network) ─────────────────────────────

class ScriptedReplayAdapter implements ProviderAgentAdapter {
  readonly provider: "openai" | "anthropic";
  private index = 0;
  constructor(provider: "openai" | "anthropic", private readonly steps: readonly CapsuleStep[], private readonly failureFactory?: (failure: { reason: string; message: string }) => Error) {
    this.provider = provider;
  }
  private next(signal?: AbortSignal): AgentStep | Promise<AgentStep> {
    const scripted = this.steps[this.index];
    this.index += 1;
    if (!scripted) throw new Error("REPLAY_SCRIPT_EXHAUSTED: the capsule supplied fewer steps than the loop requested");
    if (scripted.stall) return stalled(signal); // [B21 F] v4: a scripted timeout - no answer until the run's own signal ends the turn
    if (scripted.failure) {
      throw this.failureFactory ? this.failureFactory(scripted.failure) : new Error(scripted.failure.message);
    }
    return {
      text: scripted.text,
      toolCalls: scripted.toolCalls.map((call) => ({ ...call })),
      stopReason: scripted.stopReason,
      usage: { ...scripted.usage },
      model: scripted.model,
      continuation: { provider: this.provider, state: null }, // inert by construction
    };
  }
  async start(input?: { signal?: AbortSignal }): Promise<AgentStep> { return this.next(input?.signal); }
  async continueWith(input?: { signal?: AbortSignal }): Promise<AgentStep> { return this.next(input?.signal); }
}

/** [B21 F] v4: a task graph with no runner: the run started and failed at once - no step, no tool invocation, one valid trace. */
function unrunTaskGraph(recorder: AgentTraceRecorder, runId: string): AgentRunResult {
  try { recorder.recordRunStarted(); } catch { /* tracing is passive */ }
  return { runId, status: "failed", finalText: "", steps: 0, toolCalls: 0, failureReason: "internal_error" };
}

/** [B21 F] v4: a stalled scripted turn - it never answers; it rejects only when the run's own signal ends it (its deadline or a
 *  cancellation), so the loop's own deadline decides the outcome. With no signal it never settles. */
function stalled(signal?: AbortSignal): Promise<AgentStep> {
  return new Promise<AgentStep>((_resolve, reject) => {
    const end = (): void => reject(new Error("REPLAY_SCRIPTED_STALL: the stalled turn was ended by the run's signal"));
    if (signal?.aborted) end(); else signal?.addEventListener("abort", end, { once: true });
  });
}

export interface ReplayOutcome {
  ok: boolean;
  failures: string[];
  trace: AgentRunTrace;
  traceDigest: string;
  events: AgentRunEvent[];
  discoveredTools: string[];
}

/** [B21 F] v4: what a task-graph runner receives - the replay's own validated snapshot, context, registry, recorder and clock, the
 *  scripted adapter of the run's own turns (the capsule's `steps`, in order) and a scripted adapter per task (a FRESH one over that
 *  task's own step list on every call, so a re-run attempt replays its steps from the start). The runner lives outside this module. */
export interface TaskGraphRunInput {
  capsule: DeepReadonly<ReplayCapsule>;
  runId: string;
  context: AgentRunContext;
  contextWarnings: readonly string[];
  registry: ReturnType<typeof sirkitToolRegistry>;
  recorder: AgentTraceRecorder;
  clock: () => number;
  emit(event: AgentRunEvent): void;
  adapter: ProviderAgentAdapter;
  taskAdapter(role: string): ProviderAgentAdapter | null;
}
export type TaskGraphRunner = (input: TaskGraphRunInput) => Promise<AgentRunResult>;

export interface ReplayOptions {
  /** Deterministic clock — replay never reads wall time (the loop's deadline timer is real; [B21 F] only a task's scripted stall, run by a task-graph runner, may reach it). */
  clock?: () => number;
  sink?: AgentTraceSink;
  failureFactory?: (failure: { reason: string; message: string }) => Error;
  /** Assemble but do not compare against `expected` (generator mode). */
  computeOnly?: boolean;
  /** [B21 F] v4: the runner of a capsule WITH tasks (a task graph); without it such a capsule fails, never replayed as one loop. */
  taskGraph?: TaskGraphRunner;
}

/**
 * Run one capsule deterministically and verify every pinned expectation.
 * Fixture drift, foreign scope, stale resources, registry drift, altered
 * tool arguments, and altered expected outcomes all fail EXPLICITLY.
 */
export async function replayCapsule(untrustedCapsule: ReplayCapsule, options?: ReplayOptions): Promise<ReplayOutcome> {
  // [B11.1] EXACT capsule validation happens FIRST — before context
  // assembly, discovery, gateway construction, loop execution, or any tool
  // invocation. An invalid or secret-bearing capsule is refused with a
  // stable structured classification that never echoes capsule values.
  // [B11.1/B11.2] EXACT capsule + VERSIONED context validation happens
  // FIRST — before context assembly, discovery, gateway construction, loop
  // execution, sink creation, or any tool invocation. An invalid,
  // credential-bearing, or unknown-field-bearing capsule is refused with a
  // stable structured classification that never echoes capsule values.
  //
  // [B11.4 §B] PARSE ONCE, then execute the SNAPSHOT. `parseReplayCapsule`
  // returns an independent, deep-frozen, hook-free capture; from here on
  // `capsule` refers to that snapshot and the caller's object is never read
  // again. Mutating the argument after this call therefore cannot reach
  // events, tools, context, outcome, failures, or the trace digest (B11.4 R3).
  const parsed = parseReplayCapsule(untrustedCapsule);
  if (!parsed.ok) throw new ReplayCapsuleInvalidError(parsed.issues);
  const capsule = parsed.value as unknown as ReplayCapsule;

  const failures: string[] = [];
  const registry = sirkitToolRegistry();

  // 1. Schema/version + prompt/registry digest pins.
  if (capsule.schema !== AGENT_REPLAY_CAPSULE_SCHEMA) failures.push(`capsule.schema: expected ${AGENT_REPLAY_CAPSULE_SCHEMA}`);
  if (capsule.promptVersion !== AGENT_SYSTEM_PROMPT_VERSION) failures.push(`capsule.promptVersion: prompt drift (expected ${AGENT_SYSTEM_PROMPT_VERSION})`);
  const promptDigest = engineeringDigest({ schema: "sirkit.agent-prompt.v1", prompt: AGENT_SYSTEM_PROMPT });
  if (capsule.promptDigest !== promptDigest) failures.push("capsule.promptDigest: prompt drift");
  if (capsule.registryDigest !== registry.digest()) failures.push("capsule.registryDigest: tool-registry drift");

  // 2. Context assembly through the REAL assembler.
  const assembly = assembleAgentRunContext({
    ...capsule.scope,
    ...(capsule.context.schematic !== null ? { schematic: capsule.context.schematic } : {}),
    ...(capsule.context.board !== null && capsule.context.board !== undefined ? { board: capsule.context.board } : {}),
    ...(capsule.context.schematicHeadMark !== null && capsule.context.schematicHeadMark !== undefined ? { schematicHeadMark: capsule.context.schematicHeadMark } : {}),
    ...(capsule.context.selection !== null && capsule.context.selection !== undefined ? { selection: capsule.context.selection } : {}),
    ...(capsule.context.netlist !== null && capsule.context.netlist !== undefined ? { netlist: capsule.context.netlist } : {}),
    ...(capsule.context.editorSchematicDigest !== null ? { editorSchematicDigest: capsule.context.editorSchematicDigest } : {}),
  });
  if (!assembly.ok) {
    throw new Error(`REPLAY_CONTEXT_UNASSEMBLABLE: ${assembly.reason}`);
  }
  const context = assembly.context;

  // 3. Resource manifest digest (present only with canonical authority).
  let resourceManifestDigest: string | null = null;
  if (context.canonicalState && context.canonicalRevisionDigest) {
    resourceManifestDigest = buildAgentResourceBundle(context).manifestDigest;
  }

  // 4. Discovery expectation.
  const discoveredTools = buildRunToolset(registry, context, () => undefined).declarations.map((declaration) => declaration.toolId).sort();
  if (!options?.computeOnly) {
    const expectedTools = [...capsule.expected.discoveredTools].sort();
    if (discoveredTools.join(";") !== expectedTools.join(";")) {
      failures.push(`expected.discoveredTools: got [${discoveredTools.join(";")}] expected [${expectedTools.join(";")}]`);
    }
  }

  // 5. Deterministic run: real gateway + real loop + scripted adapter.
  let tick = 0;
  const clock = options?.clock ?? (() => { tick += 1; return tick; });
  const recorder = new AgentTraceRecorder({
    runId: `replay-${capsule.caseId}`,
    traceId: `trace-${capsule.caseId}`,
    provider: capsule.provider,
    promptVersion: AGENT_SYSTEM_PROMPT_VERSION,
    promptDigest,
    registryDigest: registry.digest(),
    scope: capsule.scope,
    contextDigests: {
      canonicalRevisionDigest: context.canonicalRevisionDigest,
      schematicDigest: context.schematicDigest,
      selectionDigest: context.selectionDigest,
      netlistDigest: context.netlistDigest,
      resourceManifestDigest,
    },
  }, options?.sink ?? new InMemoryTraceSink(), clock);

  const events: AgentRunEvent[] = [];
  const tasks = capsule.tasks ?? []; // [B21 F] v4: a task graph runs through its injected runner, never as the one loop below
  if (tasks.length > 0 && !options?.taskGraph) failures.push(`capsule.tasks: ${tasks.length} task step list(s) need a task-graph runner (ReplayOptions.taskGraph); nothing was run as one loop`);
  const result = tasks.length > 0 ? (options?.taskGraph ? await options.taskGraph({
    capsule: parsed.value, runId: `replay-${capsule.caseId}`, context, contextWarnings: assembly.warnings, registry, recorder, clock, emit: (event) => events.push(event),
    adapter: new ScriptedReplayAdapter(capsule.provider, capsule.steps, options.failureFactory),
    taskAdapter: (role) => { const task = tasks.find((entry) => entry.role === role); return task ? new ScriptedReplayAdapter(task.provider, task.steps, options.failureFactory) : null; },
  }) : unrunTaskGraph(recorder, `replay-${capsule.caseId}`)) : await runAgentLoop(
    {
      runId: `replay-${capsule.caseId}`,
      provider: capsule.provider,
      history: [],
      userMessage: capsule.userMessage,
      budget: DEFAULT_AGENT_BUDGET,
    },
    {
      adapter: new ScriptedReplayAdapter(capsule.provider, capsule.steps, options?.failureFactory),
      // Deterministic proposal sealing: the gateway's clock is the
      // replay clock, so sealed createdAt/expiresAt (and therefore the
      // proposal identity digest) are reproducible across runs.
      gateway: createAgentToolGateway(registry, { now: clock }),
      registry,
      context,
      system: AGENT_SYSTEM_PROMPT,
      emit: (event) => events.push(event),
      contextWarnings: assembly.warnings,
      trace: recorder,
      now: clock,
    },
  );

  const trace = recorder.finalize({
    outcome: result.status,
    failureReason: result.failureReason ?? null,
  });
  const traceIssues = validateAgentRunTrace(trace);
  if (traceIssues.length > 0) failures.push(`trace invalid: ${traceIssues[0]!}`);
  const traceDigest = agentRunTraceDigest(trace);

  if (!options?.computeOnly) {
    // 6. Tool calls and outcomes.
    const actualOutcomes = trace.events
      .filter((event): event is Extract<typeof event, { kind: "tool_invocation" }> => event.kind === "tool_invocation")
      .map((event) => ({ toolId: event.toolId, outcomeClass: event.outcomeClass as string, status: event.status }));
    if (JSON.stringify(actualOutcomes) !== JSON.stringify(capsule.expected.toolOutcomes)) {
      failures.push(`expected.toolOutcomes: got ${JSON.stringify(actualOutcomes)}`);
    }
    // 7. Terminal event.
    if (result.status !== capsule.expected.terminal.outcome) failures.push(`expected.terminal.outcome: got ${result.status}`);
    if ((result.failureReason ?? null) !== capsule.expected.terminal.failureReason) failures.push(`expected.terminal.failureReason: got ${result.failureReason ?? "null"}`);
    // 8. Trace digest.
    if (traceDigest !== capsule.expected.traceDigest) failures.push("expected.traceDigest: trace drift");
  }

  return { ok: failures.length === 0, failures, trace, traceDigest, events, discoveredTools };
}
