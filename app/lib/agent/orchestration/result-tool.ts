/**
 * [B21 E1] The specialist's STRICT result tool (OD-116, D21-20 as policy) and the specialist run's stop rule (D21-21).
 *
 * A `SpecialistResult` is answered through ONE strict function tool, `sirkit_specialist_result`: a per-run SYNTHETIC declaration,
 * never a registry tool (no descriptor, no exposure entry, no discovery, no gateway - the counts every registry, exposure and
 * declaration pin reads are untouched). Its schema is the result's content keys only - the server writes the schema id and attaches
 * the run's own sealed proposals (B21-D2) - rendered through `toStrictSchema` inside the common wire subset, so it is the SAME strict
 * schema on both providers (closed objects, every property required, optionality only as `null`, no bound keyword - the bounds are
 * the server's). It is advertised beside the role's tools with the adapters' own `tool_choice: auto` on both providers - never
 * `required` / `any`, which the dated Anthropic page records as a 400 on the newest models - and no `text.format` / `output_config`
 * request key is sent (both are reviewed OD-90 key-set moves E does not make).
 *
 * The specialist's adapter is wrapped (`specialistRunAdapter`): the declaration is appended to every call's tools, and the ONE result
 * call is captured and never reaches the loop - the wrapper hands the loop a step with no tool call, so the run completes. Its
 * arguments are then validated server-side by A's `validateSpecialistResult` (`specialistResultFromCapture`), so a malformed call is
 * refused in A's own vocabulary; a turn that ends WITHOUT the call is `result_tool_not_called` - the B-era "parse the final text as
 * JSON" path is removed (a result written as text is never parsed). A turn the provider did not complete as asked (any normalized stop
 * but `end_turn`: the output limit, the context window, a refusal, a paused or incomplete turn, an unmapped stop) is captured too and
 * its calls dropped: the scheduler escalates the task with that stop's reason and never parses it - a refusal is never retried. A
 * scripted double that reports no stop is read as before (only the real adapters set it). Nothing here holds authority, calls a
 * provider, imports an SDK or reads a registry.
 */
import type { AgentStep, AgentToolCall, ProviderAgentAdapter, ProviderToolDeclaration, StepStop } from "../contracts";
import { toStrictSchema, validateWireSubset } from "../provider-tools";
import type { JsonSchema } from "../../engineering/tool-registry";
import { CONFIDENCE_LEVELS, EVIDENCE_EXTRACTION_METHODS, EVIDENCE_KINDS, EVIDENCE_SOURCE_CLASSES, ORCHESTRATION_BOUNDS, RISK_SEVERITIES, SPECIALIST_RESULT_SCHEMA, VALIDATION_BINDING_TOOL_IDS, validateSpecialistResult, type SpecialistRole, type ValidatedSpecialistResult } from "./contracts";

/** The provider-facing name (both providers' tool-name grammar; no registry tool renders to it - the suite checks). */
export const SPECIALIST_RESULT_TOOL_NAME = "sirkit_specialist_result" as const;
/** The declaration's Sirkit-side id: deliberately NOT a registry id (no `sirkit.` tool of that name exists or may exist). */
export const SPECIALIST_RESULT_TOOL_ID = "orchestration.specialist-result" as const;
export const SPECIALIST_RESULT_TOOL_VERSION = "1.0.0" as const;
/** The closed refusal vocabulary of a result call, in the order it is judged (A's refusals ride inside `result_refused`). */
export const RESULT_TOOL_REFUSALS = Object.freeze(["result_tool_not_called", "result_tool_not_alone", "result_tool_arguments_invalid", "result_refused", "result_role_mismatch"] as const);

const text = (description: string): JsonSchema => ({ type: "string", description });
const list = (items: JsonSchema, description: string): JsonSchema => ({ type: "array", items, description });
const closed = (properties: Record<string, JsonSchema>, description: string): JsonSchema => ({ type: "object", description, properties, required: Object.keys(properties), additionalProperties: false });
const ENTRIES = `at most ${ORCHESTRATION_BOUNDS.maxArrayEntries} entries`;
const TEXT = `plain text, at most ${ORCHESTRATION_BOUNDS.maxTextChars} characters`;
const ID = "an id: letters, digits and . _ : - (at most 128 characters)";
const DIGEST = "an engineering digest: eng1- followed by 16 lowercase hex digits";

/** The result tool's SOURCE schema for one role (the content keys of `sirkit.specialist-result.v1`, `role` fixed to the run's). */
export function specialistResultToolSchema(role: SpecialistRole): JsonSchema {
  return closed({
    role: { type: "string", enum: [role], description: "your role, exactly" },
    summary: text(`what you found, plain text, at most ${ORCHESTRATION_BOUNDS.maxSummaryChars} characters; name a proposal your tool sealed by its id`),
    assumptions: list(closed({ id: text(ID), statement: text(TEXT), evidenceIds: list(text(ID), `the ids of the evidence entries it rests on, ${ENTRIES}`) }, "an assumption you made"), ENTRIES),
    evidence: list(closed({
      kind: { type: "string", enum: [...EVIDENCE_KINDS], description: "what the reference points at" },
      id: text(ID),
      digest: text(DIGEST),
      sourceClass: { type: "string", enum: [...EVIDENCE_SOURCE_CLASSES], description: "where it came from" },
      extractionMethod: { anyOf: [{ type: "string", enum: [...EVIDENCE_EXTRACTION_METHODS] }, { type: "null" }], description: "how it was extracted, or null" },
      reviewed: { type: "boolean", description: "whether a human reviewed it" },
    }, "a verifiable reference to evidence a read returned"), ENTRIES),
    requiredTools: list(closed({ toolId: text("the id of a reviewed, exposed Sirkit tool"), version: text(ID), reason: text(TEXT) }, "a tool the coordinator should run"), ENTRIES),
    risks: list(closed({ id: text(ID), severity: { type: "string", enum: [...RISK_SEVERITIES] }, statement: text(TEXT), mitigation: { type: ["string", "null"], description: `${TEXT}, or null` } }, "a risk you see"), ENTRIES),
    unresolvedQuestions: list(closed({ id: text(ID), question: text(TEXT), blocking: { type: "boolean", description: "whether it blocks the request" } }, "a question for the human"), ENTRIES),
    validationRequests: list(closed({ bindingToolId: { type: "string", enum: [...VALIDATION_BINDING_TOOL_IDS], description: "the deterministic verification to run" }, baseRevision: text(DIGEST) }, "a deterministic verification the merge should run"), ENTRIES),
    confidence: { type: "string", enum: [...CONFIDENCE_LEVELS], description: "how sure you are" },
  }, "Your specialist result: every key is required; use [] for an empty list and null where null is allowed.");
}

const DESCRIPTION = "Submit your specialist result - exactly once, alone, when your work is done. Its arguments ARE your result: evidence with zero authority that the coordinator and the human weigh against deterministic checks. A turn that ends without this call is refused.";

/** The strict declaration for one role's run: the source schema through `toStrictSchema` (which throws on anything outside the wire
 *  subset - the tool is then never offered, never weakened). */
export function specialistResultToolDeclaration(role: SpecialistRole): ProviderToolDeclaration {
  const inputSchema = toStrictSchema(specialistResultToolSchema(role));
  const issues = validateWireSubset(inputSchema);
  if (issues.length > 0) throw new Error(`SPECIALIST_RESULT_TOOL_NOT_STRICT:${issues.slice(0, 3).join("; ")}`);
  return { providerName: SPECIALIST_RESULT_TOOL_NAME, toolId: SPECIALIST_RESULT_TOOL_ID, version: SPECIALIST_RESULT_TOOL_VERSION, description: DESCRIPTION, inputSchema };
}

/** The frame's result rule (replaces B's "your FINAL message must be exactly ONE JSON document"). */
export function specialistResultToolRule(role: SpecialistRole): string {
  return `Your result: when your work is done, call the tool ${SPECIALIST_RESULT_TOOL_NAME} exactly ONCE and alone, with "role" "${role}" - its arguments ARE your result (${SPECIALIST_RESULT_SCHEMA}: the tool's strict schema is its shape; the scheduler writes the schema id). Never write the result as text: a turn that ends without that call, or with it beside another call, is refused as malformed.`;
}

// ─── The specialist run's wrapper and its capture ────────────────────────────────────────────────────────────────────────

/** What one specialist run's wrapper saw: the ONE result call (with whether it came alone), and the stop of a turn the provider did
 *  not complete as asked (then nothing of that turn is parsed). */
export interface SpecialistRunCapture {
  call: AgentToolCall | null;
  alone: boolean;
  stop: Exclude<StepStop, "end_turn"> | null;
}

/** The specialist's adapter: every call offered its tools plus the result declaration (last); a step with a non-`end_turn` stop is
 *  captured and handed on with no tool call and no text (never parsed, never run); a step carrying the result call is captured and
 *  handed on with no tool call - its text is the call's arguments when it came alone (the run's final text is then the document the
 *  specialist answered with; the scheduler reads the CAPTURE, never that text), nothing when it did not (nothing of that step runs). A
 *  run offered a registry tool of the same provider name is refused before any call (a collision is never resolved by guessing). */
export function specialistRunAdapter(adapter: ProviderAgentAdapter, declaration: ProviderToolDeclaration): { adapter: ProviderAgentAdapter; capture: SpecialistRunCapture } {
  const capture: SpecialistRunCapture = { call: null, alone: false, stop: null };
  const offered = (tools: readonly ProviderToolDeclaration[]): ProviderToolDeclaration[] => {
    if (tools.some((tool) => tool.providerName === declaration.providerName)) throw new Error(`SPECIALIST_RESULT_TOOL_NAME_COLLISION:${declaration.providerName}`);
    return [...tools, declaration];
  };
  const judge = (step: AgentStep): AgentStep => {
    if (step.stop !== undefined && step.stop !== "end_turn") {
      capture.stop = step.stop;
      return { ...step, text: "", toolCalls: [] };
    }
    const calls = step.toolCalls.filter((call) => call.providerName === declaration.providerName);
    if (calls.length === 0) return step;
    capture.call = calls[0]!;
    capture.alone = step.toolCalls.length === 1;
    return { ...step, text: capture.alone ? calls[0]!.argumentsText : "", toolCalls: [] };
  };
  return {
    capture,
    adapter: {
      provider: adapter.provider,
      start: async (input) => judge(await adapter.start({ ...input, tools: offered(input.tools) })),
      continueWith: async (input) => judge(await adapter.continueWith({ ...input, tools: offered(input.tools) })),
    },
  };
}

export type SpecialistResultParse = { ok: true; value: ValidatedSpecialistResult; digest: string } | { ok: false; reason: string };

/** The run's result, from its capture: the one result call, alone, whose arguments A's validator accepts for this role. */
export function specialistResultFromCapture(capture: SpecialistRunCapture, role: SpecialistRole): SpecialistResultParse {
  if (capture.call === null) return { ok: false, reason: `result_tool_not_called: the specialist ended its turn without calling ${SPECIALIST_RESULT_TOOL_NAME}; a result written as text is never parsed` };
  if (!capture.alone) return { ok: false, reason: `result_tool_not_alone: ${SPECIALIST_RESULT_TOOL_NAME} was called beside another tool call in one step; nothing of that step ran` };
  return parseSpecialistResultArguments(capture.call.argumentsText, role);
}

/** A result call's arguments as ONE JSON object, composed with the schema id and an empty `proposedActions` (the run's own seals are
 *  attached after, B21-D2), a strict `null` for the one optional field (`evidence[].extractionMethod`) dropped, then validated by A's
 *  contracts and bound to the task's role. An argument the declaration does not name (a non-strict provider or a double) is judged
 *  exactly as A judges it: `schema` must be the id, `proposedActions` must be what the run sealed (D2's `proposal_not_sealed_in_run`),
 *  anything else is `unknown_key`. */
export function parseSpecialistResultArguments(argumentsText: string, role: SpecialistRole): SpecialistResultParse {
  if (argumentsText.length > ORCHESTRATION_BOUNDS.maxSerializedChars) return { ok: false, reason: `result_tool_arguments_invalid: the arguments exceed the ${ORCHESTRATION_BOUNDS.maxSerializedChars}-character bound` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsText);
  } catch {
    return { ok: false, reason: "result_tool_arguments_invalid: the arguments are not one JSON object" };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, reason: "result_tool_arguments_invalid: the arguments are not one JSON object" };
  const args = parsed as Record<string, unknown>;
  const evidence = Array.isArray(args.evidence)
    ? args.evidence.map((entry: unknown) => {
        if (typeof entry !== "object" || entry === null || Array.isArray(entry) || (entry as Record<string, unknown>).extractionMethod !== null) return entry;
        const { extractionMethod: _null, ...rest } = entry as Record<string, unknown>;
        void _null;
        return rest;
      })
    : args.evidence;
  const validated = validateSpecialistResult({ schema: SPECIALIST_RESULT_SCHEMA, proposedActions: [], ...args, ...(Object.hasOwn(args, "evidence") ? { evidence } : {}) });
  if (!validated.ok) return { ok: false, reason: `result_refused: ${validated.refusal} at ${validated.path}` };
  if (validated.value.role !== role) return { ok: false, reason: `result_role_mismatch: ${validated.value.role} is not ${role}` };
  return { ok: true, value: validated.value, digest: validated.digest };
}

// ─── The stop rule (D21-21) ───────────────────────────────────────────────────────────────────────────────────────────────

/** A specialist turn's normalized stop, as the dissent reason its task is escalated with: never parsed, never retried by the
 *  scheduler (a stop is not a provider failure), never run on another provider. */
export const SPECIALIST_STOP_REASONS: Readonly<Record<Exclude<StepStop, "end_turn">, string>> = Object.freeze({
  max_tokens: "stop_max_tokens: the provider stopped the specialist's turn at its output limit; nothing of that turn was parsed",
  refusal: "stop_refusal: the model refused the specialist's turn; a refusal is never retried, on this model or another (the dated notes: not retryable on another model)",
  pause_turn: "stop_pause_turn: the provider paused the specialist's turn (a server-side tool, which Sirkit never offers); nothing of that turn was parsed",
  context_exceeded: "stop_context_exceeded: the specialist's turn exceeded the model's context window; nothing of that turn was parsed",
  incomplete: "stop_incomplete: the provider left the specialist's turn incomplete; nothing of that turn was parsed",
  unknown: "stop_unknown: the provider ended the specialist's turn with a stop Sirkit does not map; nothing of that turn was parsed",
});
