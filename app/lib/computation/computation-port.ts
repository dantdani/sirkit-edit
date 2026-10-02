/**
 * [B22-B] The server port behind the agent's three named computation reads (agent/computation-reads.ts; OD-139, OD-140). The chat
 * route injects it through its one approved boundary (app/api/chat/computation-runtime.ts); no MCP route and no specialist reaches
 * it. Each call runs ONE closed engine in the bounded engine host (a worker thread stopped hard at the kind's budget) and turns the
 * engine's answer into a result envelope only after the kind's typed output validator accepts it:
 *  - `evaluateAnalyticalEquation`: an approved microcase of the analytical reference provider (unreviewed, never authoritative);
 *  - `compareHeldArtifacts`: the quantities of two results THIS run holds, named by digest;
 *  - `parseHeldArtifact`: a closed parser over one bounded server-held artifact named by digest - the run's canonical board (by its
 *    revision digest) or a result this run holds. Never a path, a URL or a caller's bytes.
 * Each result carries a SHA-256 input and result digest over an explicit encoding (OD-143: a non-finite number cannot be encoded) and
 * is held for its own run only, in this port's memory (bounded), so a later call of the same run can name it. Results are
 * evidence, never engineering authority.
 */
import { durableWorkflowDigest } from "../durable-workflow/stable";
import type { ComputationPort, ComputationPortAnswer, ComputationPortRequest } from "../agent/computation-reads";
import { COMPUTATION_AUTHORITY_TEXT, COMPUTATION_RESULT_LABELS, COMPUTATION_RESULT_SCHEMA, computationKind, validateComputationInput, validateComputationOutput, type ComputationKind } from "./catalog";
import { EngineHostError, defaultEngineHost, processHeapLimitOverrideFlags, type EngineHost } from "./engine-host";

/** The canonical board a parse may read, as canonical JSON characters (the chat request body is itself bounded at 8 MB). */
export const COMPUTATION_ARTIFACT_MAX_CHARS = 8 * 1024 * 1024;
/** Results held per run, and runs held per port (oldest first out). The chat route creates one port per request
 *  (computation-runtime.ts), so a run's results live only as long as the port that request bound. */
export const COMPUTATION_RESULTS_PER_RUN = 32;
export const COMPUTATION_RUNS_HELD = 128;

type Held = Readonly<Record<string, unknown>> & { readonly kindId: string; readonly resultDigest: string; readonly body: Readonly<Record<string, unknown>> };
interface PortState { readonly host: EngineHost; readonly runs: Map<string, Map<string, Held>> }
type EngineCall = { engineInput: unknown; artifacts: readonly string[] } | { refused: string };

const refused = (code: string): ComputationPortAnswer => ({ state: "refused", code });
const runKey = (request: ComputationPortRequest): string => JSON.stringify([request.scope.tenantId, request.scope.projectId, request.scope.branchId, request.runId]);
const quantitiesOf = (held: Held): unknown[] => (Array.isArray(held.body.quantities) ? held.body.quantities : []);
const subjectOf = (held: Held): string | null => (typeof held.body.equation === "string" ? held.body.equation : typeof held.body.circuit === "string" ? held.body.circuit : null);

/** [B22-B] Allowlisted binding symbol of `sirkit.computation.analytical-equation`: the engine input is the validated input itself. */
export function evaluateAnalyticalEquation(_state: PortState, request: ComputationPortRequest): EngineCall {
  return { engineInput: { ...request.input }, artifacts: [] };
}

/** [B22-B] Allowlisted binding symbol of `sirkit.computation.artifact-compare`: both sides must be results this run holds. */
export function compareHeldArtifacts(state: PortState, request: ComputationPortRequest): EngineCall {
  const held = state.runs.get(runKey(request));
  const left = held?.get(String(request.input.left));
  const right = held?.get(String(request.input.right));
  if (!left || !right) return { refused: "ARTIFACT_NOT_FOUND" };
  const side = (result: Held) => ({ digest: result.resultDigest, kindId: result.kindId, subject: subjectOf(result), quantities: quantitiesOf(result) });
  return { engineInput: { left: side(left), right: side(right) }, artifacts: [left.resultDigest, right.resultDigest] };
}

/** [B22-B] Allowlisted binding symbol of `sirkit.computation.artifact-parse`: the canonical board by its revision digest, or a held result. */
export function parseHeldArtifact(state: PortState, request: ComputationPortRequest): EngineCall {
  const digest = String(request.input.artifact);
  const parser = String(request.input.parser);
  const board = request.canonicalBoard;
  if (board !== null && digest === board.digest) {
    if (parser !== "board-statistics") return { refused: "PARSER_NOT_APPLICABLE" };
    let size: number;
    try {
      size = JSON.stringify(board.board)?.length ?? Number.POSITIVE_INFINITY;
    } catch {
      return { refused: "ARTIFACT_NOT_FOUND" };
    }
    if (size > COMPUTATION_ARTIFACT_MAX_CHARS) return { refused: "ARTIFACT_OVER_LIMIT" };
    return { engineInput: { parser, artifact: { digest, kind: "canonical-board" }, body: board.board }, artifacts: [digest] };
  }
  const held = state.runs.get(runKey(request))?.get(digest);
  if (!held) return { refused: "ARTIFACT_NOT_FOUND" };
  if (parser !== "result-fields") return { refused: "PARSER_NOT_APPLICABLE" };
  return { engineInput: { parser, artifact: { digest, kind: "computation-result" }, body: held }, artifacts: [digest] };
}

const HANDLERS: Readonly<Record<string, (state: PortState, request: ComputationPortRequest) => EngineCall>> = Object.freeze({
  "sirkit.computation.analytical-equation": evaluateAnalyticalEquation,
  "sirkit.computation.artifact-compare": compareHeldArtifacts,
  "sirkit.computation.artifact-parse": parseHeldArtifact,
});

function hold(state: PortState, request: ComputationPortRequest, result: Held): void {
  const key = runKey(request);
  let held = state.runs.get(key);
  if (held) state.runs.delete(key);
  else held = new Map();
  state.runs.set(key, held);
  held.set(result.resultDigest, result);
  while (held.size > COMPUTATION_RESULTS_PER_RUN) held.delete(held.keys().next().value!);
  while (state.runs.size > COMPUTATION_RUNS_HELD) state.runs.delete(state.runs.keys().next().value!);
}

async function evaluate(state: PortState, request: ComputationPortRequest): Promise<ComputationPortAnswer> {
  const kind: ComputationKind | undefined = computationKind(request.kindId);
  if (!kind || kind.backing !== "in-process" || kind.engineId === null || !Object.hasOwn(HANDLERS, kind.id)) return refused("KIND_NOT_SERVED");
  const checked = validateComputationInput(kind.id, request.input);
  if (!checked.ok) return refused("INPUT_REFUSED");
  const call = HANDLERS[kind.id]!(state, { ...request, input: checked.input });
  if ("refused" in call) return refused(call.refused);
  let outcome: Awaited<ReturnType<EngineHost["run"]>>;
  try {
    outcome = await state.host.run({ engineId: kind.engineId, input: call.engineInput, budget: { wallClockMs: Math.max(1, Math.min(kind.budget.wallClockMs, Math.floor(request.deadlineMs))), heapMiB: kind.budget.heapMiB, maxOutputBytes: kind.budget.maxOutputBytes }, signal: request.signal, holder: request.scope.tenantId }); // [B22-B review] security-2: the run's server-derived tenant holds its share of the host
  } catch (error) {
    return refused(error instanceof EngineHostError ? error.code : "ENGINE_FAILED");
  }
  if (outcome.state === "refused") return refused(outcome.code);
  if (outcome.state === "terminated") return { state: "terminated", reason: outcome.reason };
  if (outcome.state === "failed") return { state: "failed", code: outcome.code };
  try {
    const inputDigest = durableWorkflowDigest({ kindId: kind.id, kindVersion: kind.version, input: checked.input, artifacts: call.artifacts });
    const body = outcome.output as Record<string, unknown>;
    const resultDigest = durableWorkflowDigest({ kindId: kind.id, kindVersion: kind.version, engineId: kind.engineId, inputDigest, body });
    const result = { schema: COMPUTATION_RESULT_SCHEMA, kindId: kind.id, kindVersion: kind.version, engineId: kind.engineId, inputDigest, resultDigest, labels: [...COMPUTATION_RESULT_LABELS], authority: COMPUTATION_AUTHORITY_TEXT, elapsedMs: Math.round(outcome.elapsedMs), body };
    if (validateComputationOutput(kind.outputValidatorId, result).length > 0) return { state: "failed", code: "OUTPUT_INVALID" };
    hold(state, request, structuredClone(result) as Held);
    return { state: "completed", result };
  } catch {
    return { state: "failed", code: "OUTPUT_INVALID" };
  }
}

/** [B22-B review] regressions-1: whether the process's engine host can run at all - false while the server process carries a V8
 *  heap-size flag, under which every run is refused `ENGINE_HEAP_LIMIT_OVERRIDDEN` (e.g. `next dev`: Next 16.2.6 writes
 *  `--max-old-space-size` into its server's NODE_OPTIONS unless NEXT_DISABLE_MEM_OVERRIDE is set). The chat route binds no port then,
 *  so the fact is false and the three reads are withheld - never advertised and always refused. */
export function computationEngineServable(): boolean {
  return processHeapLimitOverrideFlags().length === 0;
}

/** A port over `host` (the process's one engine host by default) with its own per-run result store. */
export function createComputationPort(options: { host?: EngineHost } = {}): ComputationPort {
  const state: PortState = { host: options.host ?? defaultEngineHost(), runs: new Map() };
  return Object.freeze({ evaluate: (request: ComputationPortRequest) => evaluate(state, request) });
}
