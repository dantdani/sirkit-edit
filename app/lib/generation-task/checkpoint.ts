/**
 * [PR-L, 2026-10-17] Runbook L.2, increment 2: the block checkpoint `sirkit.build-loop-checkpoint.v1` (task-worker-contract.md
 * section 1.3) - what a later slice needs to RESUME a block's build loop (`build-loop.ts` keeps `messages`, the surfaced parts,
 * the ERC rejection count and the turn count only in memory) - its judge, its builder and its deterministic compaction.
 *
 *  - The conversation is the provider-neutral `LLMMessage` list exactly as the loop holds it: a user prompt, then complete turns
 *    (an assistant message, then the user message the loop appended after it - tool results or the nudge). Only `text`,
 *    `tool_call` and `tool_result` parts; no image, no provider continuation state, no reasoning. A checkpoint is taken ONLY at a
 *    complete turn boundary: it ends on a user message, except a SAVED block, whose last assistant turn is the accepted submission
 *    the loop never answers. Every `tool_result` names a call of the assistant message right before it; an interrupted turn is
 *    discarded, never synthesized; no provider response is ever fabricated.
 *  - Text is bounded and redacted as stored: assistant text at most 2 000 characters, every model-bound string already
 *    `sanitizeModelBoundText`'s output (the builder repairs; the judge only refuses).
 *  - Compaction (above 256 KB or 24 turns) removes the OLDEST complete turns whole - a call never loses its result, a result never
 *    outlives its call - and replaces them with ONE user-role note appended to the first user message, rebuilt deterministically
 *    from the removed calls and results (tool names, bounded queries, returned part ids, error flags). The note is never a
 *    `tool_result` and never quotes model text; `compaction.summaryDigest` binds it.
 */
import type { LLMContentPart, LLMMessage, LLMToolCallPart, LLMToolResultPart } from "../llm/types";
import { COMPONENT_ROLES, type BuildLogicalNetlist } from "@/lib/schematic-types";
import type { ElectricalCheckStatus } from "../schematic/build-result";
import { durableWorkflowDigest } from "../durable-workflow/stable";
import {
  GENERATION_STRATEGIES, GenerationTaskContractError, arrayOf, blockId, bool, canonicalBytes, cleanLine, cleanModelText, count, durableDigest, finiteNumber, identifier, isPlainRecord, isoInstant,
  line, modelText, nullable, oneOf, pattern, plainJsonIssue, recordOf, shape, sliceId, taskId,
  type GenerationBlockId, type GenerationStrategyId, type Issue, type Judge,
} from "./vocabulary";

export const BUILD_LOOP_CHECKPOINT_SCHEMA = "sirkit.build-loop-checkpoint.v1" as const;
export const CHECKPOINT_BOUNDS = Object.freeze({
  /** the block aggregate's hard bound (section 1.1) */
  maxBytes: 384 * 1024,
  /** compaction starts above either */
  compactBytes: 256 * 1024,
  compactTurns: 24,
  maxMessages: 401,
  assistantTextChars: 2_000,
  userTextChars: 16_000,
  noteChars: 16_000,
  toolOutputChars: 65_536,
  toolInputBytes: 131_072,
  surfacedParts: 256,
  submissions: 8,
  submissionCodes: 16,
  searches: 256,
  searchPartIds: 10,
  pins: 1_024,
  orderableValues: 64,
  netlistComponents: 512,
  netlistConnections: 4_096,
  explanationChars: 4_000,
  findings: 20,
});
/** The compaction note's first line: how a reader (and the judge) recognizes the one note the first user message may carry. */
export const CHECKPOINT_NOTE_HEADER = "[Compacted summary of earlier design turns, rebuilt from their recorded tool calls and results; the full turns were removed to bound the context.]";
const NOTE_LINE_CHARS = 300;

// ─── Part facts (the surfaced `AiPartResult`, closed) ─────────────────────────────────────────────────────────────────────

export interface GenerationPartPin { number: string; name: string; type: string }
/** The catalog facts of one surfaced part: `parts-search.ts` `AiPartResult`, closed, every text field bounded and redacted. */
export interface GenerationPartFacts {
  partId: string; name: string; mpn: string | null; description: string | null; mainCategory: string; pins: GenerationPartPin[];
  lifecycleStatus: string; similarity: number; orderableValues?: string[]; physicalAuthority?: "verified"; verifiedFootprint?: string;
}
export const partFactsJudge: Judge = shape({
  partId: identifier(128), name: line(200), mpn: nullable(line(128)), description: nullable(line(1_000)), mainCategory: line(128), lifecycleStatus: line(32),
  similarity: finiteNumber(-1_000, 1_000), pins: arrayOf(shape({ number: line(32), name: line(128), type: line(32) }), CHECKPOINT_BOUNDS.pins),
}, { orderableValues: arrayOf(line(64), CHECKPOINT_BOUNDS.orderableValues), physicalAuthority: oneOf(["verified"]), verifiedFootprint: line(200, 1) });
/** Normalize catalog facts to the stored form (closed keys, bounded redacted text). The merge slice digests a fresh lookup the same way. */
export function normalizePartFacts(part: GenerationPartFacts): GenerationPartFacts {
  const text = (value: string, max: number) => cleanLine(String(value), max);
  return {
    partId: part.partId, name: text(part.name, 200), mpn: part.mpn === null ? null : text(part.mpn, 128), description: part.description === null ? null : text(part.description, 1_000),
    mainCategory: text(part.mainCategory, 128), lifecycleStatus: text(part.lifecycleStatus, 32), similarity: part.similarity,
    pins: part.pins.slice(0, CHECKPOINT_BOUNDS.pins).map((pin) => ({ number: text(pin.number, 32), name: text(pin.name, 128), type: text(pin.type, 32) })),
    ...(part.orderableValues ? { orderableValues: part.orderableValues.slice(0, CHECKPOINT_BOUNDS.orderableValues).map((value) => text(value, 64)) } : {}),
    ...(part.physicalAuthority === "verified" ? { physicalAuthority: "verified" as const } : {}),
    ...(part.verifiedFootprint ? { verifiedFootprint: text(part.verifiedFootprint, 200) } : {}),
  };
}
export function partFactsDigest(part: GenerationPartFacts): string { return durableWorkflowDigest({ schema: "sirkit.generation-part-facts.v1", part }); }

// ─── Netlist and electrical check (the saved block's result) ───────────────────────────────────────────────────────────────

const component = shape({ refDes: line(32, 1), partId: identifier(128), value: line(200), role: oneOf(COMPONENT_ROLES) }, { parentRefDes: line(32, 1), atomicPartRevisionId: identifier(200) });
const wire = shape({ from: line(128, 1), to: line(128, 1) }, { kind: oneOf(["wire"]) });
const label = shape({ kind: oneOf(["label"]), pin: line(128, 1), labelName: line(128, 1) }, { labelKind: oneOf(["label", "power", "ground"]) });
const connection: Judge = (value, path) => (isPlainRecord(value) && value.kind === "label" ? label(value, path) : wire(value, path));
/** A `BuildLogicalNetlist`, closed; `minComponents` 1 for a saved block or a merged result. */
export const netlistJudge = (minComponents = 1): Judge => shape({
  components: arrayOf(component, CHECKPOINT_BOUNDS.netlistComponents, minComponents), connections: arrayOf(connection, CHECKPOINT_BOUNDS.netlistConnections), explanation: modelText(CHECKPOINT_BOUNDS.explanationChars),
});
/** `build-result.ts` `ElectricalCheckStatus`, closed: `not_run` and `skipped` are never a pass. */
export const electricalCheckJudge: Judge = (value, path) => {
  if (!isPlainRecord(value)) return `${path}: an object is required`;
  switch (value.state) {
    case "passed": return shape({ state: oneOf(["passed"]), criticalCount: count(0, 0), warningCount: count() })(value, path);
    case "findings": return shape({ state: oneOf(["findings"]), criticalCount: count(), warningCount: count(), findings: arrayOf(line(200), CHECKPOINT_BOUNDS.findings) })(value, path);
    case "skipped": return shape({ state: oneOf(["skipped"]), reason: line(200, 1) })(value, path);
    case "not_run": return shape({ state: oneOf(["not_run"]), reason: line(200, 1) })(value, path);
    default: return `${path}.state: outside the closed list`;
  }
};

/** A submitted netlist normalized to the stored form: every display string bounded and redacted, the explanation a clean model text. */
export function normalizeNetlist(netlist: BuildLogicalNetlist): BuildLogicalNetlist {
  const text = (value: unknown, max: number) => cleanLine(String(value ?? ""), max);
  return {
    components: netlist.components.map((entry) => ({ refDes: text(entry.refDes, 32), partId: entry.partId, value: text(entry.value, 200), role: entry.role, ...(entry.parentRefDes ? { parentRefDes: text(entry.parentRefDes, 32) } : {}), ...(entry.atomicPartRevisionId ? { atomicPartRevisionId: entry.atomicPartRevisionId } : {}) })),
    connections: netlist.connections.map((entry) => (entry.kind === "label"
      ? { kind: "label" as const, pin: text(entry.pin, 128), labelName: text(entry.labelName, 128), ...(entry.labelKind ? { labelKind: entry.labelKind } : {}) }
      : { ...(entry.kind === "wire" ? { kind: "wire" as const } : {}), from: text(entry.from, 128), to: text(entry.to, 128) })),
    explanation: cleanModelText(netlist.explanation ?? "", CHECKPOINT_BOUNDS.explanationChars),
  };
}
/** An electrical check normalized to the stored form (server text: one line each, bounded). */
export function normalizeElectricalCheck(check: ElectricalCheckStatus): ElectricalCheckStatus {
  switch (check.state) {
    case "passed": return { state: "passed", criticalCount: check.criticalCount, warningCount: check.warningCount }; // never repaired: a "passed" check with criticals is refused by the judge
    case "findings": return { state: "findings", criticalCount: check.criticalCount, warningCount: check.warningCount, findings: check.findings.slice(0, CHECKPOINT_BOUNDS.findings).map((finding) => cleanLine(finding, 200)) };
    case "skipped": return { state: "skipped", reason: cleanLine(check.reason, 200) || "not stated" };
    case "not_run": return { state: "not_run", reason: cleanLine(check.reason, 200) || "not stated" };
  }
}

// ─── The conversation ────────────────────────────────────────────────────────────────────────────────────────────────────

const TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
/** Every string inside a tool call's JSON input is already a clean model-bound text. */
function jsonStringsIssue(value: unknown, path: string): Issue {
  if (typeof value === "string") return modelText(CHECKPOINT_BOUNDS.toolOutputChars)(value, path);
  if (Array.isArray(value)) { for (let index = 0; index < value.length; index += 1) { const issue = jsonStringsIssue(value[index], `${path}[${index}]`); if (issue) return issue; } return null; }
  if (isPlainRecord(value)) { for (const [key, child] of Object.entries(value)) { const keyIssue = modelText(200, 1)(key, `${path}{key}`) ?? jsonStringsIssue(child, `${path}.${key.length > 40 ? "[key]" : key}`); if (keyIssue) return keyIssue; } return null; }
  return null;
}
const toolInput: Judge = (value, path) => {
  if (!isPlainRecord(value)) return `${path}: an object is required`;
  return plainJsonIssue(value, path) ?? jsonStringsIssue(value, path) ?? (canonicalBytes(value) <= CHECKPOINT_BOUNDS.toolInputBytes ? null : `${path}: too large`);
};
const toolCallPart = shape({ type: oneOf(["tool_call"]), id: identifier(128), name: pattern(TOOL_NAME, "a tool name"), input: toolInput });
const toolResultPart = shape({ type: oneOf(["tool_result"]), toolCallId: identifier(128), output: modelText(CHECKPOINT_BOUNDS.toolOutputChars) }, { isError: bool });
const textPart = (max: number): Judge => shape({ type: oneOf(["text"]), text: modelText(max) });
const partType = (value: unknown): string | null => (isPlainRecord(value) && typeof value.type === "string" ? value.type : null);

/** The first message: the block prompt, optionally followed by exactly one compaction note (a second text part). */
function firstMessageIssue(message: Record<string, unknown>, compaction: BuildLoopCheckpoint["compaction"], path: string): Issue {
  const content = message.content;
  if (typeof content === "string") return modelText(CHECKPOINT_BOUNDS.userTextChars, 1)(content, `${path}.content`) ?? (compaction === null ? null : `${path}: a compacted checkpoint carries its note`);
  if (!Array.isArray(content) || content.length < 1 || content.length > 2) return `${path}.content: the prompt and at most one note`;
  const promptIssue = textPart(CHECKPOINT_BOUNDS.userTextChars)(content[0], `${path}.content[0]`);
  if (promptIssue) return promptIssue;
  if (content.length === 1) return compaction === null ? null : `${path}: a compacted checkpoint carries its note`;
  const noteIssue = textPart(CHECKPOINT_BOUNDS.noteChars)(content[1], `${path}.content[1]`);
  if (noteIssue) return noteIssue;
  const note = (content[1] as { text: string }).text;
  if (!note.startsWith(CHECKPOINT_NOTE_HEADER)) return `${path}.content[1]: only the compaction note may follow the prompt`;
  if (compaction === null || compaction.summaryDigest !== durableWorkflowDigest(note)) return `${path}.content[1]: the note does not match compaction.summaryDigest`;
  return null;
}

/** The turn structure of a checkpoint's conversation (see the header). */
export function checkpointMessagesIssue(messages: unknown, options: { saved: boolean; compaction: BuildLoopCheckpoint["compaction"] }, path = "checkpoint.messages"): Issue {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > CHECKPOINT_BOUNDS.maxMessages) return `${path}: 1..${CHECKPOINT_BOUNDS.maxMessages} messages are required`;
  const seenCalls = new Set<string>();
  let previousCalls = new Set<string>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index], at = `${path}[${index}]`;
    if (!isPlainRecord(message) || Object.keys(message).length !== 2 || !("role" in message) || !("content" in message)) return `${at}: exactly a role and a content`;
    const expected = index % 2 === 0 ? "user" : "assistant";
    if (message.role !== expected) return `${at}.role: turns alternate, starting with the user prompt`;
    if (index === 0) { const issue = firstMessageIssue(message, options.compaction, at); if (issue) return issue; continue; }
    if (expected === "assistant") {
      if (!Array.isArray(message.content)) return `${at}.content: an assistant turn is a list of parts`;
      const calls = new Set<string>();
      let texts = 0;
      for (let part = 0; part < message.content.length; part += 1) {
        const value = message.content[part], partAt = `${at}.content[${part}]`, type = partType(value);
        if (type === "text") { texts += 1; const issue = textPart(CHECKPOINT_BOUNDS.assistantTextChars)(value, partAt); if (issue) return issue; continue; }
        if (type !== "tool_call") return `${partAt}: only text and tool_call parts in an assistant turn`;
        const issue = toolCallPart(value, partAt);
        if (issue) return issue;
        const id = (value as unknown as LLMToolCallPart).id;
        if (seenCalls.has(id)) return `${partAt}.id: a tool call id is used once`;
        seenCalls.add(id); calls.add(id);
      }
      if (texts > 1) return `${at}.content: at most one text part`;
      previousCalls = calls;
      continue;
    }
    // a user message after an assistant turn: the nudge (a string) or the tool results answering THAT turn's calls
    if (typeof message.content === "string") { const issue = modelText(CHECKPOINT_BOUNDS.userTextChars, 1)(message.content, `${at}.content`); if (issue) return issue; continue; }
    if (!Array.isArray(message.content)) return `${at}.content: a string or a list of tool results`;
    const answered = new Set<string>();
    for (let part = 0; part < message.content.length; part += 1) {
      const value = message.content[part], partAt = `${at}.content[${part}]`;
      if (partType(value) !== "tool_result") return `${partAt}: only tool_result parts answer a turn`;
      const issue = toolResultPart(value, partAt);
      if (issue) return issue;
      const id = (value as unknown as LLMToolResultPart).toolCallId;
      if (!previousCalls.has(id)) return `${partAt}.toolCallId: a tool result must answer a call of the turn right before it`;
      if (answered.has(id)) return `${partAt}.toolCallId: a call is answered once`;
      answered.add(id);
    }
  }
  const lastIsAssistant = messages.length % 2 === 0;
  if (lastIsAssistant && !options.saved) return `${path}: an unsaved checkpoint ends at a complete turn boundary (a user message)`;
  return null;
}

// ─── The checkpoint ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BuildLoopCheckpoint {
  schema: typeof BUILD_LOOP_CHECKPOINT_SCHEMA;
  taskId: string;
  blockId: GenerationBlockId;
  /** provenance: the slice attempt that wrote it (a fenced-out writer's revision is never referenced by the head) */
  sliceId: string;
  attempt: number;
  fence: number;
  at: string;
  strategy: GenerationStrategyId;
  messages: LLMMessage[];
  surfaced: Record<string, { part: GenerationPartFacts; factsDigest: string }>;
  ercRejections: number;
  turnsUsed: number;
  nudges: number;
  submissions: Array<{ fingerprint: string; codes: string[] }>;
  searches: Record<string, { resultDigest: string; partIds: string[]; count: number }>;
  compaction: { compactedTurns: number; summaryDigest: string } | null;
  result: { netlist: BuildLogicalNetlist; explanation: string; erc: ElectricalCheckStatus } | null;
}

const CODE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const checkpointFields = shape({
  schema: oneOf([BUILD_LOOP_CHECKPOINT_SCHEMA]), taskId, blockId, sliceId, attempt: count(1_000_000, 1), fence: count(Number.MAX_SAFE_INTEGER, 1), at: isoInstant,
  strategy: oneOf(GENERATION_STRATEGIES), messages: (value) => (Array.isArray(value) ? null : "checkpoint.messages: a list is required"),
  surfaced: recordOf(identifier(128), shape({ part: partFactsJudge, factsDigest: durableDigest }), CHECKPOINT_BOUNDS.surfacedParts),
  ercRejections: count(1_000), turnsUsed: count(1_000_000), nudges: count(1_000_000),
  submissions: arrayOf(shape({ fingerprint: durableDigest, codes: arrayOf(pattern(CODE, "a validation code"), CHECKPOINT_BOUNDS.submissionCodes) }), CHECKPOINT_BOUNDS.submissions),
  searches: recordOf(durableDigest, shape({ resultDigest: durableDigest, partIds: arrayOf(identifier(128), CHECKPOINT_BOUNDS.searchPartIds), count: count(1_000_000) }), CHECKPOINT_BOUNDS.searches),
  compaction: nullable(shape({ compactedTurns: count(1_000_000, 1), summaryDigest: durableDigest })),
  result: nullable(shape({ netlist: netlistJudge(1), explanation: modelText(CHECKPOINT_BOUNDS.explanationChars), erc: electricalCheckJudge })),
});

/** The first rule a checkpoint breaks, or null: closed keys at every level, consistent digests, the turn structure, the size bound. */
export function buildLoopCheckpointIssue(value: unknown): Issue {
  const issue = checkpointFields(value, "checkpoint");
  if (issue) return issue;
  const checkpoint = value as BuildLoopCheckpoint;
  for (const [partId, entry] of Object.entries(checkpoint.surfaced)) {
    if (entry.part.partId !== partId) return "checkpoint.surfaced: an entry is keyed by its part id";
    if (entry.factsDigest !== partFactsDigest(entry.part)) return "checkpoint.surfaced: a facts digest does not match its part";
  }
  const turnIssue = checkpointMessagesIssue(checkpoint.messages, { saved: checkpoint.result !== null, compaction: checkpoint.compaction });
  if (turnIssue) return turnIssue;
  return canonicalBytes(checkpoint) <= CHECKPOINT_BOUNDS.maxBytes ? null : "checkpoint: larger than the block bound";
}
export function assertBuildLoopCheckpoint(value: unknown): BuildLoopCheckpoint {
  const issue = buildLoopCheckpointIssue(value);
  if (issue) throw new GenerationTaskContractError(issue.endsWith("larger than the block bound") ? "GENERATION_TASK_TOO_LARGE" : "GENERATION_TASK_CHECKPOINT_INVALID", issue);
  return value as BuildLoopCheckpoint;
}

/** The number of complete (assistant, user) turns after the prompt. */
export function checkpointTurnCount(messages: readonly LLMMessage[]): number { return Math.floor((messages.length - 1) / 2); }

// ─── The builder (from the loop's in-memory state) ─────────────────────────────────────────────────────────────────────────

function cleanJsonStrings(value: unknown): unknown {
  if (typeof value === "string") return cleanModelText(value, CHECKPOINT_BOUNDS.toolOutputChars);
  if (Array.isArray(value)) return value.map(cleanJsonStrings);
  if (isPlainRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [cleanModelText(key, 200), cleanJsonStrings(child)]));
  return value;
}
/** The loop's messages normalized to the stored form: redacted and bounded text, the trailing incomplete turn removed (an
 *  unsaved checkpoint always ends on a user message). An image part, or a message of another role, is refused, never dropped. */
export function normalizeCheckpointMessages(messages: readonly LLMMessage[], options: { saved: boolean }): LLMMessage[] {
  const out: LLMMessage[] = messages.map((message, index) => {
    if (message.role !== "user" && message.role !== "assistant") throw new GenerationTaskContractError("GENERATION_TASK_CHECKPOINT_INVALID", `checkpoint.messages[${index}].role: user or assistant only`);
    const max = message.role === "assistant" ? CHECKPOINT_BOUNDS.assistantTextChars : CHECKPOINT_BOUNDS.userTextChars;
    if (typeof message.content === "string") return message.role === "assistant" ? { role: "assistant", content: message.content ? [{ type: "text", text: cleanModelText(message.content, max) }] : [] } : { role: "user", content: cleanModelText(message.content, max) };
    return {
      role: message.role,
      content: message.content.map((part: LLMContentPart, partIndex): LLMContentPart => {
        switch (part.type) {
          case "text": return { type: "text", text: cleanModelText(part.text, max) };
          case "tool_call": return { type: "tool_call", id: part.id, name: part.name, input: cleanJsonStrings(part.input) as Record<string, unknown> };
          case "tool_result": return { type: "tool_result", toolCallId: part.toolCallId, output: cleanModelText(part.output, CHECKPOINT_BOUNDS.toolOutputChars), ...(part.isError === undefined ? {} : { isError: part.isError }) };
          default: throw new GenerationTaskContractError("GENERATION_TASK_CHECKPOINT_INVALID", `checkpoint.messages[${index}].content[${partIndex}]: only text, tool_call and tool_result parts are stored`);
        }
      }),
    };
  });
  if (!options.saved && out.length % 2 === 0) out.pop(); // an assistant turn with no recorded answer is an interrupted turn: discarded, never synthesized
  return out;
}

export interface BuildLoopCheckpointInput {
  taskId: string; blockId: GenerationBlockId; sliceId: string; attempt: number; fence: number; at: string; strategy: GenerationStrategyId;
  messages: readonly LLMMessage[];
  surfaced: readonly GenerationPartFacts[];
  ercRejections: number; turnsUsed: number; nudges: number;
  submissions?: ReadonlyArray<{ fingerprint: string; codes: readonly string[] }>;
  searches?: Readonly<Record<string, { resultDigest: string; partIds: readonly string[]; count: number }>>;
  /** carried over from the checkpoint this one continues (its note is already in `messages[0]`) */
  compaction?: BuildLoopCheckpoint["compaction"];
  result?: BuildLoopCheckpoint["result"];
}
/** Build, compact when above the thresholds, and validate a checkpoint; a refusal throws a contract error, nothing is cut silently. */
export function buildLoopCheckpoint(input: BuildLoopCheckpointInput): BuildLoopCheckpoint {
  const result = input.result ?? null;
  const surfaced: BuildLoopCheckpoint["surfaced"] = {};
  for (const raw of input.surfaced) { const part = normalizePartFacts(raw); surfaced[part.partId] = { part, factsDigest: partFactsDigest(part) }; }
  const checkpoint: BuildLoopCheckpoint = {
    schema: BUILD_LOOP_CHECKPOINT_SCHEMA, taskId: input.taskId, blockId: input.blockId, sliceId: input.sliceId, attempt: input.attempt, fence: input.fence, at: input.at, strategy: input.strategy,
    messages: normalizeCheckpointMessages(input.messages, { saved: result !== null }), surfaced,
    ercRejections: input.ercRejections, turnsUsed: input.turnsUsed, nudges: input.nudges,
    submissions: (input.submissions ?? []).slice(-CHECKPOINT_BOUNDS.submissions).map((entry) => ({ fingerprint: entry.fingerprint, codes: [...entry.codes] })),
    searches: Object.fromEntries(Object.entries(input.searches ?? {}).map(([key, entry]) => [key, { resultDigest: entry.resultDigest, partIds: [...entry.partIds], count: entry.count }])),
    compaction: input.compaction ?? null,
    result: result === null ? null : { netlist: normalizeNetlist(result.netlist), explanation: cleanModelText(result.explanation, CHECKPOINT_BOUNDS.explanationChars), erc: normalizeElectricalCheck(result.erc) },
  };
  return assertBuildLoopCheckpoint(compactBuildLoopCheckpoint(checkpoint));
}

// ─── Deterministic compaction ────────────────────────────────────────────────────────────────────────────────────────────

function partIdsOf(output: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(output);
    if (!Array.isArray(parsed)) return null;
    return parsed.flatMap((entry) => (isPlainRecord(entry) && typeof entry.partId === "string" ? [entry.partId] : []));
  } catch { return null; }
}
function describeCall(call: LLMToolCallPart): string {
  const input = call.input ?? {}, text = (value: unknown, max: number) => (typeof value === "string" ? cleanLine(value, max) : "");
  if (call.name === "search_parts") { const category = text(input.category, 60); return `search_parts "${text(input.query, 120)}"${category ? ` in ${category}` : ""}`; }
  if (call.name === "find_alternates") return `find_alternates ${text(input.partId, 80)} (${text(input.kind, 16) || "all"})`;
  return cleanLine(call.name, 64);
}
function describeResult(call: LLMToolCallPart, result: LLMToolResultPart | undefined): string {
  if (!result) return call.name === "submit_schematic" ? "accepted" : "no result recorded";
  if (result.isError) return call.name === "submit_schematic" ? "rejected (validation or ERC feedback returned)" : "error";
  if (call.name === "search_parts" || call.name === "find_alternates") {
    const ids = partIdsOf(result.output);
    if (ids === null) return "result recorded";
    return `${ids.length} result(s)${ids.length ? `: ${ids.slice(0, 8).map((id) => cleanLine(id, 64)).join(", ")}${ids.length > 8 ? ", ..." : ""}` : ""}`;
  }
  return "result recorded";
}
/** The note lines one removed turn contributes: its calls and their outcomes, never the model's text. */
function summarizeTurn(turnNumber: number, assistant: LLMMessage, user: LLMMessage): string[] {
  const calls = Array.isArray(assistant.content) ? assistant.content.filter((part): part is LLMToolCallPart => part.type === "tool_call") : [];
  if (!calls.length) return [cleanLine(`turn ${turnNumber}: no tool call; the loop asked for a submission`, NOTE_LINE_CHARS)];
  const results = new Map<string, LLMToolResultPart>();
  if (Array.isArray(user.content)) for (const part of user.content) if (part.type === "tool_result") results.set(part.toolCallId, part);
  return calls.map((call) => cleanLine(`turn ${turnNumber}: ${describeCall(call)} -> ${describeResult(call, results.get(call.id))}`, NOTE_LINE_CHARS));
}
function noteLinesOf(first: LLMMessage): string[] {
  if (!Array.isArray(first.content) || first.content.length < 2) return [];
  const note = first.content[1];
  if (note?.type !== "text" || !note.text.startsWith(CHECKPOINT_NOTE_HEADER)) return [];
  return note.text.slice(CHECKPOINT_NOTE_HEADER.length).split("\n").filter((entry) => entry.length > 0);
}
function noteText(lines: readonly string[]): string {
  const kept = [...lines];
  const render = (omitted: number) => [CHECKPOINT_NOTE_HEADER, ...(omitted ? [`(${omitted} earlier entr${omitted === 1 ? "y" : "ies"} omitted)`] : []), ...kept].join("\n");
  let omitted = 0;
  while (kept.length > 1 && render(omitted).length > CHECKPOINT_BOUNDS.noteChars) { kept.shift(); omitted += 1; }
  return cleanModelText(render(omitted), CHECKPOINT_BOUNDS.noteChars);
}

/** Remove the oldest complete turns while the checkpoint is above `maxBytes` or `maxTurns` (keeping at least one turn), folding them
 *  into the one note. Deterministic: the same checkpoint always compacts to the same bytes. Returns the input when nothing is removed. */
export function compactBuildLoopCheckpoint(checkpoint: BuildLoopCheckpoint, options: { maxBytes?: number; maxTurns?: number } = {}): BuildLoopCheckpoint {
  const maxBytes = options.maxBytes ?? CHECKPOINT_BOUNDS.compactBytes, maxTurns = options.maxTurns ?? CHECKPOINT_BOUNDS.compactTurns;
  if (canonicalBytes(checkpoint) <= maxBytes && checkpointTurnCount(checkpoint.messages) <= maxTurns) return checkpoint;
  const first = checkpoint.messages[0]!;
  const prompt = typeof first.content === "string" ? first.content : (first.content[0] as { text: string }).text;
  const lines = noteLinesOf(first);
  let compacted = checkpoint.compaction?.compactedTurns ?? 0;
  let rest = checkpoint.messages.slice(1);
  const render = (): BuildLoopCheckpoint => {
    const note = noteText(lines);
    return { ...checkpoint, messages: [{ role: "user", content: [{ type: "text", text: prompt }, { type: "text", text: note }] }, ...rest], compaction: { compactedTurns: compacted, summaryDigest: durableWorkflowDigest(note) } };
  };
  let next = checkpoint;
  while (Math.floor(rest.length / 2) > 1 && (canonicalBytes(next) > maxBytes || Math.floor(rest.length / 2) > maxTurns)) {
    compacted += 1;
    lines.push(...summarizeTurn(compacted, rest[0]!, rest[1]!));
    rest = rest.slice(2);
    next = render();
  }
  return next;
}
