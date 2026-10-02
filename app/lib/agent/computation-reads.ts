/**
 * [B22-B] The agent's three named computation READS, at the agent boundary (OD-139): `sirkit.computation.analytical-equation`,
 * `sirkit.computation.artifact-compare` and `sirkit.computation.artifact-parse` - Tier 0 reads on the `bound-computation` binding
 * status, modelled on the external reads (acquisition-reads.ts). Nothing here computes: the server port
 * (`app/lib/computation/computation-port.ts`, which runs the bounded engine host) is INJECTED into the gateway by the chat route
 * through its one approved runtime boundary (`app/api/chat/computation-runtime.ts`), behind the server's own computation fact. This
 * module decides what the port may be asked and what the model may be told:
 *  - per invocation: the allowlisted binding, the context integrity check, the server's fact, a fresh discovery check, the role and
 *    capability recheck;
 *  - the catalog's closed input only (exact keys, closed enums, the artifact digest grammar, bounded finite numbers; a strict
 *    provider's null is absence) and the safe-JSON limits;
 *  - a deadline composed with the run's cancellation;
 *  - the kind's typed output validator over the port's answer: a result that fails it is refused whole, never trimmed.
 * The process-backed kinds are never resolved here (they are inert requests a human approves, requests.ts).
 */
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS, validateAgainstSchema } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { COMPUTATION_BINDING_STATUS, COMPUTATION_ENGINE_AUTHORITY, computationKind, validateComputationInput, validateComputationOutput } from "../computation/catalog";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";

/** The server port's request: a validated input, the run's identity and its server-held canonical board (by its revision digest). */
export interface ComputationPortRequest {
  readonly kindId: string;
  readonly kindVersion: string;
  readonly input: Readonly<Record<string, string | number>>;
  readonly scope: { readonly tenantId: string; readonly projectId: string; readonly branchId: string };
  readonly runId: string;
  readonly canonicalBoard: { readonly digest: string; readonly board: unknown } | null;
  readonly deadlineMs: number;
  readonly signal: AbortSignal;
}
export type ComputationPortAnswer =
  | { readonly state: "completed"; readonly result: Record<string, unknown> }
  | { readonly state: "refused"; readonly code: string }
  | { readonly state: "terminated"; readonly reason: "budget" | "cancelled" | "resource-limit" }
  | { readonly state: "failed"; readonly code: string };
/** The server port the chat route injects. Implemented by app/lib/computation/computation-port.ts; faked in tests. */
export interface ComputationPort {
  evaluate(request: ComputationPortRequest): Promise<ComputationPortAnswer>;
}

export interface ComputationReadBinding { readonly toolId: string; readonly module: string; readonly symbol: string }
/** The allowlisted bindings: a descriptor is callable here only when its module and symbol EXACTLY match an entry. */
export const COMPUTATION_READ_BINDINGS: readonly ComputationReadBinding[] = Object.freeze([
  Object.freeze({ toolId: "sirkit.computation.analytical-equation", module: "app/lib/computation/computation-port.ts", symbol: "evaluateAnalyticalEquation" }),
  Object.freeze({ toolId: "sirkit.computation.artifact-compare", module: "app/lib/computation/computation-port.ts", symbol: "compareHeldArtifacts" }),
  Object.freeze({ toolId: "sirkit.computation.artifact-parse", module: "app/lib/computation/computation-port.ts", symbol: "parseHeldArtifact" }),
]);

export type ComputationBindingResolution = { state: "resolved"; binding: ComputationReadBinding } | { state: "not_callable"; reason: string };

export function resolveComputationBinding(descriptor: ToolDescriptor): ComputationBindingResolution {
  if (descriptor.binding.status !== COMPUTATION_BINDING_STATUS) return { state: "not_callable", reason: `Binding status ${descriptor.binding.status} is not a bound computation.` };
  if (descriptor.operationClass !== "read" || descriptor.approvalTier !== "none") return { state: "not_callable", reason: "A bound computation is a Tier 0 read." };
  if (descriptor.requiredAuthority.length !== 1 || descriptor.requiredAuthority[0] !== COMPUTATION_ENGINE_AUTHORITY) return { state: "not_callable", reason: "A bound computation requires exactly the computation-engine authority." };
  if (descriptor.sideEffects !== "none" && descriptor.sideEffects !== "derived-cache") return { state: "not_callable", reason: `Side effects ${descriptor.sideEffects} are not permitted for a computation read.` };
  const kind = computationKind(descriptor.toolId);
  if (!kind || kind.backing !== "in-process" || kind.exposure.agent !== "exposed" || kind.version !== descriptor.version) return { state: "not_callable", reason: "No exposed in-process computation of the catalog has this id and version." };
  const entry = COMPUTATION_READ_BINDINGS.find((candidate) => candidate.toolId === descriptor.toolId);
  if (!entry || entry.module !== descriptor.binding.module || entry.symbol !== descriptor.binding.symbol) return { state: "not_callable", reason: "The descriptor does not match the allowlisted computation binding." };
  return { state: "resolved", binding: entry };
}

/** The port's closed refusal codes and the status each one becomes (anything else is an implementation failure). */
const REFUSAL_STATUS: Readonly<Record<string, string>> = Object.freeze({
  ARTIFACT_NOT_FOUND: "artifact_not_found",
  ARTIFACT_OVER_LIMIT: "invalid_input",
  PARSER_NOT_APPLICABLE: "invalid_input",
  INPUT_REFUSED: "invalid_input",
  ENGINE_INPUT_REFUSED: "invalid_input",
  ENGINE_PARSER_NOT_APPLICABLE: "invalid_input",
  ENGINE_TOO_MANY_LAYERS: "invalid_input",
  ENGINE_NON_FINITE: "invalid_output",
  ENGINE_HOST_BUSY: "busy",
  // [B22-B review] regressions-1: the host cannot run here (a V8 heap-size flag on the server; an engine with no worker entry)
  ENGINE_HEAP_LIMIT_OVERRIDDEN: "engine_unavailable",
  ENGINE_UNAVAILABLE: "engine_unavailable",
});
const TERMINATED_STATUS = Object.freeze({ budget: "timeout", cancelled: "cancelled", "resource-limit": "resource_limit" });
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

export interface ComputationReadServiceOptions {
  /** The server port, injected by the composition root; absent: every computation read refuses authority_unavailable. */
  port?: ComputationPort;
  /** The gateway's context integrity check (injected so this module never imports the gateway). */
  integrity: (context: AgentRunContext) => readonly string[];
}
export interface ComputationReadInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; timeoutMs: number; signal?: AbortSignal }

class ComputationTimeoutError extends Error { constructor() { super("COMPUTATION_TIMEOUT"); this.name = "ComputationTimeoutError"; } }
class ComputationCancelledError extends Error { constructor() { super("COMPUTATION_CANCELLED"); this.name = "ComputationCancelledError"; } }

export class ComputationReadService {
  constructor(private readonly registry: ToolRegistry, private readonly options: ComputationReadServiceOptions) {}

  async invoke(input: ComputationReadInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveComputationBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const kind = computationKind(descriptor.toolId)!;
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    const port = this.options.port;
    if (!port || context.computationAvailable !== true) return refuse("authority_unavailable", ["No computation engine is bound to this run; the tool is unavailable."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole) || !context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return refuse("unauthorized", [`Role ${context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]);
    }
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    const checked = validateComputationInput(kind.id, input.args);
    if (!checked.ok) return refuse("invalid_input", checked.errors.slice(0, 5));
    if (input.signal?.aborted) return refuse("cancelled", ["The invocation was cancelled before it ran."]);

    const timeoutMs = Math.max(1, Math.min(input.timeoutMs, descriptor.timeoutMs));
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let answer: ComputationPortAnswer;
    try {
      const board = context.canonicalState && context.canonicalRevisionDigest ? { digest: context.canonicalRevisionDigest, board: context.canonicalState.pcb } : null;
      const work = Promise.resolve().then(() => port.evaluate({ kindId: kind.id, kindVersion: kind.version, input: checked.input, scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }, runId: input.runId, canonicalBoard: board, deadlineMs: Math.max(1, timeoutMs - Math.min(500, Math.floor(timeoutMs / 4))), signal: controller.signal }));
      work.catch(() => undefined); // a late rejection after the deadline is never unhandled
      answer = await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new ComputationTimeoutError()); }, timeoutMs);
          if (input.signal) {
            onAbort = () => { controller.abort(); reject(new ComputationCancelledError()); };
            input.signal.addEventListener("abort", onAbort, { once: true });
          }
        }),
      ]);
    } catch (error) {
      if (error instanceof ComputationTimeoutError) return refuse("timeout", [`The computation exceeded ${timeoutMs} ms.`]);
      if (error instanceof ComputationCancelledError) return refuse("cancelled", ["The computation was cancelled."]);
      return refuse("implementation_failed", ["IMPLEMENTATION_ERROR (details redacted)."]);
    } finally {
      if (timer) clearTimeout(timer);
      if (input.signal && onAbort) input.signal.removeEventListener("abort", onAbort);
    }

    if (answer.state === "refused") {
      const code = SAFE_CODE.test(answer.code) ? answer.code : "UNKNOWN";
      return refuse(Object.hasOwn(REFUSAL_STATUS, code) ? REFUSAL_STATUS[code]! : "implementation_failed", [`COMPUTATION_REFUSED:${code}`]);
    }
    if (answer.state === "terminated") return refuse(Object.hasOwn(TERMINATED_STATUS, answer.reason) ? TERMINATED_STATUS[answer.reason] : "implementation_failed", [`The computation was stopped (${answer.reason}); nothing it produced is a result.`]);
    if (answer.state !== "completed") return refuse("implementation_failed", [`COMPUTATION_FAILED:${SAFE_CODE.test(answer.code) ? answer.code : "UNKNOWN"}`]);
    const invalid = validateComputationOutput(kind.outputValidatorId, answer.result);
    if (invalid.length > 0) return refuse("invalid_output", invalid.slice(0, 5));
    const output = { result: answer.result };
    const outputErrors = [...assertSafeJsonValue(output, DEFAULT_INPUT_LIMITS, "output"), ...validateAgainstSchema(output, descriptor.outputSchema, "output")];
    if (outputErrors.length > 0) return refuse("invalid_output", outputErrors.slice(0, 5));
    return {
      kind: "read",
      ok: true,
      toolId: descriptor.toolId,
      version: descriptor.version,
      output,
      sourceRevisionDigest: context.canonicalRevisionDigest ?? context.discovery.currentRevisionDigest,
      verification: "computation-evidence",
    };
  }
}
