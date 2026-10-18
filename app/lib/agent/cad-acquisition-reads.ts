/**
 * [PR-M, 2026-10-18] Section M2 (design M2.1): the agent's SCHEMATIC-SCOPED CAD acquisition - two tools that work BEFORE any PCB exists:
 *
 *  - `sirkit.parts.acquisition-start` starts (or attaches to) the durable component-resolution task for catalog instances of ONE catalog
 *    part: a worker obtains the part's real KiCad assets from an ADMITTED CAD source, stores, parses and validates them and prepares the
 *    review package. It mutates NO design and publishes, approves or binds nothing; it is idempotent on (scope, principal, instance ids,
 *    requirement, schematic base). A person sends the package for review; two other humans publish it; the page offers the replacement.
 *  - `sirkit.parts.acquisition-status` is a Tier 0 read of that task's public view (stages and their evidence, attempts, the candidate's
 *    verdict and provenance, the handoff, the publication, the offered replacement, the blocker and its remedy, the progress events).
 *
 * Gate (the M1 Tier 0 pattern): the integrity check, a VERIFIED schematic snapshot with its digest (never `canonical-state`, never a
 * board), the server's `cadAcquisitionAvailable` fact (a bound port AND a verified schematic), fresh discovery, the role and capability,
 * a closed input and authority-shaped keys refused by name. The board-gated `sirkit.parts.external-search` / `sirkit.parts.evidence-read`
 * keep their contract. The port is the chat route's one boundary (app/api/chat/cad-acquisition-runtime.ts) over the SAME service the page
 * route answers from (app/lib/component-resolution/task/service.ts).
 */
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS, DEFAULT_OUTPUT_LIMITS, validateAgainstSchema } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import type { DurableWorkflowScope } from "../durable-workflow/types";
import { CAD_ACQUISITION_AUTHORITY_KEYS, CAD_ACQUISITION_START_TOOL_ID, CAD_ACQUISITION_STATUS_TOOL_ID, type CadAcquisitionTaskView } from "../acquisition/cad-acquisition-contract";
import type { ResolutionPrincipal, ResolutionServiceAnswer } from "../component-resolution/task/service";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction";

export { CAD_ACQUISITION_START_TOOL_ID, CAD_ACQUISITION_STATUS_TOOL_ID };
export const CAD_ACQUISITION_BINDING = Object.freeze({ module: "app/lib/component-resolution/task/service.ts", symbol: "ComponentResolutionService" });
export const CAD_ACQUISITION_VERIFICATION = "schematic-snapshot-verified+durable-task" as const;
export const CAD_ACQUISITION_START_INPUT_EXAMPLE = Object.freeze({ componentIds: ["kc-3a9f01", "kc-3a9f02"], requirement: { mounting: "through_hole", packageCode: "DO-35" }, assetKinds: ["symbol", "footprint", "datasheet"] });
export const CAD_ACQUISITION_STATUS_INPUT_EXAMPLE = Object.freeze({ taskId: "cr-task:0123456789abcdef0123456789abcdef" });
const TASK_ID = /^cr-task:[0-9a-f]{32}$/;

/** The server port the chat route binds (the page route's own service). */
export interface CadAcquisitionPort {
  start(scope: DurableWorkflowScope, principal: ResolutionPrincipal, input: { request: unknown; schematic: unknown; headMark?: unknown; origin: "chat" }): Promise<ResolutionServiceAnswer>;
  read(scope: DurableWorkflowScope, taskId: string): Promise<ResolutionServiceAnswer>;
  list(scope: DurableWorkflowScope): Promise<ResolutionServiceAnswer>;
}

export type CadAcquisitionBindingResolution = { state: "resolved"; mode: "start" | "status" } | { state: "not_callable"; reason: string };

export function resolveCadAcquisitionBinding(descriptor: ToolDescriptor): CadAcquisitionBindingResolution {
  const start = descriptor.toolId === CAD_ACQUISITION_START_TOOL_ID, status = descriptor.toolId === CAD_ACQUISITION_STATUS_TOOL_ID;
  if (!start && !status) return { state: "not_callable", reason: "Only the CAD acquisition start and status are invocable here." };
  if (descriptor.binding.module !== CAD_ACQUISITION_BINDING.module || descriptor.binding.symbol !== CAD_ACQUISITION_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one component-resolution task service." };
  if (status && (descriptor.operationClass !== "read" || descriptor.sideEffects !== "none" || descriptor.binding.status !== "bound-read")) return { state: "not_callable", reason: "The acquisition status is a Tier 0 read with no side effects." };
  if (start && (descriptor.operationClass !== "propose" || descriptor.sideEffects !== "proposal-artifact" || descriptor.binding.status !== "bound-proposal")) return { state: "not_callable", reason: "The acquisition start creates a durable task artifact and mutates no design." };
  if (descriptor.approvalTier !== "none") return { state: "not_callable", reason: "The acquisition tools carry no approval tier of their own: a human sends for review, two humans publish, a human applies." };
  return { state: "resolved", mode: start ? "start" : "status" };
}

/** The loop's per-run rule: the binding resolves, the run holds a verified schematic snapshot and the server's acquisition fact (no board). */
export function cadAcquisitionToolAvailable(descriptor: ToolDescriptor, context: AgentRunContext, warn: (message: string) => void): boolean {
  if (resolveCadAcquisitionBinding(descriptor).state !== "resolved") { warn(`Tool ${descriptor.toolId} unavailable: no resolved CAD acquisition binding.`); return false; }
  if (!context.schematic || !context.schematicDigest) { warn(`Tool ${descriptor.toolId} unavailable: no verified schematic snapshot for this run.`); return false; }
  // the server binds no acquisition port in this deployment (no durable task store or catalog): withheld SILENTLY, as a tool whose
  // authority the run lacks is (discovery drops it without a line) - a run on such a server streams exactly what it streamed before M2
  if (context.cadAcquisitionAvailable !== true) return false;
  return true;
}

export interface CadAcquisitionToolServiceOptions { port?: CadAcquisitionPort; integrity: (context: AgentRunContext) => readonly string[] }
export interface CadAcquisitionToolInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; timeoutMs: number; signal?: AbortSignal }

/** A bounded projection of the task for the model: what happened and what needs a person - never the bytes. */
function taskSummary(task: CadAcquisitionTaskView): Record<string, unknown> {
  return {
    taskId: task.taskId, state: task.state, stage: task.stage, nextAction: task.nextAction,
    targets: task.targets.map((target) => ({ componentId: target.componentId, refDes: target.refDes, symbol: target.symbol, footprint: target.footprint, exactMpn: target.exactMpn })),
    stages: task.stages.map((stage) => ({ stage: stage.stage, status: stage.status, evidence: stage.evidence })),
    attempts: task.attempts.map((attempt) => ({ sourceId: attempt.sourceId, outcome: attempt.outcome, code: attempt.code })),
    candidate: task.candidate ? { verdict: task.candidate.verdict, sourceId: task.candidate.sourceId, fixtureEvidence: task.candidate.fixtureEvidence, identity: task.candidate.identity, objects: task.candidate.objects.map((object) => `${object.role} sha256:${object.sha256.slice(0, 16)} ${object.locator}`), unresolved: task.candidate.unresolved, conflicts: task.candidate.conflicts, licence: task.candidate.licence } : null,
    handoff: task.handoff, publication: task.publication, proposal: task.proposal, applied: task.applied, preflight: task.preflight, blocker: task.blocker,
    progress: task.events.slice(-12).map((event) => event.message),
  };
}

export class CadAcquisitionToolService {
  constructor(private readonly registry: ToolRegistry, private readonly options: CadAcquisitionToolServiceOptions) {}

  async invoke(input: CadAcquisitionToolInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveCadAcquisitionBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    const port = this.options.port;
    if (!port || context.cadAcquisitionAvailable !== true || !context.schematic || !context.schematicDigest) return refuse("authority_unavailable", ["No CAD acquisition port and verified schematic snapshot are bound to this run; the acquisition is unavailable (no board is needed)."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole) || !context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) return refuse("unauthorized", [`Role ${context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]);
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    const allowed = resolution.mode === "start" ? ["componentIds", "requirement", "assetKinds"] : ["taskId"];
    for (const key of Object.keys(input.args)) {
      if (allowed.includes(key)) continue;
      return refuse("invalid_input", [CAD_ACQUISITION_AUTHORITY_KEYS.includes(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim - the server derives every source, byte, fact and revision.` : `Unexpected argument "${key.slice(0, 40)}" - the tool accepts ${allowed.join(", ")}.`]);
    }
    if (input.signal?.aborted) return refuse("cancelled", ["The invocation was cancelled before it ran."]);
    const scope: DurableWorkflowScope = { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId };
    let answer: ResolutionServiceAnswer;
    try {
      if (resolution.mode === "start") {
        answer = await port.start(scope, { principalId: context.actor.actorId, role: context.actor.actorRole, membershipRevision: context.actor.membershipRevision ?? null, actorKind: "ai" }, { request: input.args, schematic: context.schematic, headMark: context.schematicHeadMark ?? null, origin: "chat" });
      } else {
        const taskId = input.args.taskId;
        if (taskId !== undefined && (typeof taskId !== "string" || !TASK_ID.test(taskId))) return refuse("invalid_input", ["taskId, when given, is an acquisition task id of this project (cr-task:<32 hex>)."]);
        answer = typeof taskId === "string" ? await port.read(scope, taskId) : await port.list(scope);
      }
    } catch (error) {
      return refuse("implementation_failed", [`The acquisition service failed: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was changed.`]);
    }
    if (answer.status >= 400) return refuse(answer.status === 404 ? "not_found" : answer.status === 403 ? "unauthorized" : answer.status === 503 ? "authority_unavailable" : "invalid_input", [String(answer.body.error ?? answer.body.code ?? "refused").slice(0, 300)]);
    const tasks = Array.isArray(answer.body.tasks) ? (answer.body.tasks as CadAcquisitionTaskView[]) : answer.body.task ? [answer.body.task as CadAcquisitionTaskView] : [];
    const output: Record<string, unknown> = {
      report: {
        schema: "sirkit.cad-acquisition-report.v1",
        mode: resolution.mode,
        ...(resolution.mode === "start" ? { attached: answer.body.attached === true } : {}),
        tasks: tasks.slice(0, 5).map(taskSummary),
        durability: answer.body.durability ?? null,
        note: resolution.mode === "start"
          ? "An acquisition task runs in a worker in saved steps - NOTHING in the design has changed. It retrieves the part's KiCad assets from an admitted source only, validates them, and waits for a PERSON to send the package for review; two humans publish; only then is the replacement offered for the user's review. Never claim the part was published, approved, bound or applied; use sirkit.parts.acquisition-status in a later turn for its real state."
          : "The task's public state as stored - nothing was changed by this read. A validated candidate is not a published part; a published part is not applied until the user approves the offered replacement.",
      },
    };
    const outputErrors = [...assertSafeJsonValue(output, DEFAULT_OUTPUT_LIMITS, "output"), ...validateAgainstSchema(output, descriptor.outputSchema, "output")];
    if (outputErrors.length > 0) return refuse("invalid_output", outputErrors.slice(0, 5));
    return { kind: "read", ok: true, toolId: descriptor.toolId, version: descriptor.version, output, sourceRevisionDigest: context.schematicDigest, verification: CAD_ACQUISITION_VERIFICATION };
  }
}
