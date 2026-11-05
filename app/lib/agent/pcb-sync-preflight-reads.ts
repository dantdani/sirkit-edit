/**
 * [PR-D d2] The agent's Schematic → PCB PREFLIGHT read, `sirkit.pcb-sync.preflight`: the semantic equivalent of what the editor's
 * Prepare PCB (`PcbEditor.handleSync`, the journey strip's `prepare_pcb`) decides BEFORE its first server call, as bounded data.
 * The report is built by the ONE pure function `buildPcbSyncPreflightReport` (app/lib/pcb-sync/preflight-read.ts), which calls the
 * SAME `listUnresolvedInstances` / `unresolvedInstancesRefusal` / row texts the editor calls (no second checker), over the run's
 * VERIFIED schematic snapshot - the resource the gateway's integrity check digest-pins before every call. It needs no board: the
 * editor's own run is board-less too (Prepare PCB exists to make the first board), which is why this read does not travel the B05
 * canonical-state binding (a board is required there) but its own Tier 0 service, modelled on the named computation reads.
 *
 * Per invocation: the exact allowlisted binding, the context integrity check, a verified schematic snapshot with its digest, a fresh
 * discovery check, the role and capability recheck, the closed argument surface (NO arguments; an authority-shaped key is refused by
 * name), then the pure report, schema-checked and bounded. Nothing is bound, published, preflighted on the server or applied: the
 * server stages travel as `not_run` inside the report, and the user runs Prepare PCB in the PCB editor.
 */
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS, DEFAULT_OUTPUT_LIMITS, validateAgainstSchema } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { buildPcbSyncPreflightReport } from "../pcb-sync/preflight-read";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction";

export const PCB_SYNC_PREFLIGHT_TOOL_ID = "sirkit.pcb-sync.preflight" as const;
/** The ONE proven implementation the descriptor binds (`resolvePcbSyncPreflightBinding` matches it exactly). */
export const PCB_SYNC_PREFLIGHT_BINDING = Object.freeze({ module: "app/lib/pcb-sync/preflight-read.ts", symbol: "buildPcbSyncPreflightReport" });
/** The read's verification state: pure over the run's verified schematic snapshot (its digest is the result's source revision). */
export const PCB_SYNC_PREFLIGHT_VERIFICATION = "schematic-snapshot-verified" as const;
/** The descriptor's valid input example (the manual's example): the read takes no arguments. */
export const PCB_SYNC_PREFLIGHT_INPUT_EXAMPLE = Object.freeze({});

const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "apply", "commit", "bind", "publish", "preflight", "plan", "planId", "scope", "headMark", "revision", "expectedRevision", "lineageId", "schematic", "board", "boardId"]);

export type PcbSyncPreflightBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

/** Allowlist-only: the descriptor is callable here only as the one preflight read over the one shared report function. */
export function resolvePcbSyncPreflightBinding(descriptor: ToolDescriptor): PcbSyncPreflightBindingResolution {
  if (descriptor.toolId !== PCB_SYNC_PREFLIGHT_TOOL_ID) return { state: "not_callable", reason: "Only the Schematic to PCB preflight read is invocable here." };
  if (descriptor.operationClass !== "read" || descriptor.approvalTier !== "none" || descriptor.sideEffects !== "none") return { state: "not_callable", reason: "The preflight read is a Tier 0 read with no side effects." };
  if (descriptor.binding.status !== "bound-read" || descriptor.binding.module !== PCB_SYNC_PREFLIGHT_BINDING.module || descriptor.binding.symbol !== PCB_SYNC_PREFLIGHT_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one shared preflight report function." };
  return { state: "resolved" };
}

/** The loop's per-run advertisement rule: the binding resolves and the run holds a verified schematic snapshot (no board needed). */
export function pcbSyncPreflightReadAvailable(descriptor: ToolDescriptor, context: AgentRunContext, warn: (message: string) => void): boolean {
  if (resolvePcbSyncPreflightBinding(descriptor).state !== "resolved") {
    warn(`Tool ${descriptor.toolId} unavailable: no resolved preflight read binding.`);
    return false;
  }
  if (!context.schematic || !context.schematicDigest) {
    warn(`Tool ${descriptor.toolId} unavailable: no verified schematic snapshot for this run.`);
    return false;
  }
  return true;
}

export interface PcbSyncPreflightReadServiceOptions {
  /** The gateway's context integrity check (injected so this module never imports the gateway). */
  integrity: (context: AgentRunContext) => readonly string[];
}
export interface PcbSyncPreflightReadInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; timeoutMs: number; signal?: AbortSignal }

export class PcbSyncPreflightReadService {
  constructor(private readonly registry: ToolRegistry, private readonly options: PcbSyncPreflightReadServiceOptions) {}

  async invoke(input: PcbSyncPreflightReadInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolvePcbSyncPreflightBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    // The subject: the run's verified schematic snapshot (digest-pinned by the integrity check above); a board is not needed.
    if (!context.schematic || !context.schematicDigest) return refuse("authority_unavailable", ["No verified schematic snapshot is available for this run; the preflight read is unavailable."]);
    const discovery = discoverTools(this.registry, context.discovery);
    if (!discovery.included.some((item) => item.toolId === descriptor.toolId && item.version === descriptor.version)) {
      const reason = discovery.excluded.find((entry) => entry.toolId === descriptor.toolId)?.reason ?? "not discoverable";
      return refuse("not_discoverable", [`Tool is not discoverable in the current context (${reason}).`]);
    }
    if (!descriptor.requiredRoles.includes(context.actor.actorRole) || !context.actor.grantedCapabilities.includes(descriptor.requiredCapability)) {
      return refuse("unauthorized", [`Role ${context.actor.actorRole} / capability ${descriptor.requiredCapability} is not permitted for this tool.`]);
    }
    // The closed argument surface: no arguments; authority-shaped keys are refused by name.
    const safety = assertSafeJsonValue(input.args, DEFAULT_INPUT_LIMITS, "args");
    if (safety.length > 0) return refuse("invalid_input", safety.slice(0, 5));
    for (const key of Object.keys(input.args)) {
      return refuse("invalid_input", [AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim - the preflight read takes no arguments; it reads the run's verified schematic.` : `Unexpected argument "${key.slice(0, 40)}" - the preflight read takes no arguments.`]);
    }
    if (input.signal?.aborted) return refuse("cancelled", ["The invocation was cancelled before it ran."]);
    let output: Record<string, unknown>;
    try {
      output = { report: buildPcbSyncPreflightReport(context.schematic) as unknown as Record<string, unknown> };
    } catch (error) {
      return refuse("implementation_failed", [`The preflight read failed internally: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was changed.`]);
    }
    const outputErrors = [...assertSafeJsonValue(output, DEFAULT_OUTPUT_LIMITS, "output"), ...validateAgainstSchema(output, descriptor.outputSchema, "output")];
    if (outputErrors.length > 0) return refuse("invalid_output", outputErrors.slice(0, 5));
    return { kind: "read", ok: true, toolId: descriptor.toolId, version: descriptor.version, output, sourceRevisionDigest: context.schematicDigest, verification: PCB_SYNC_PREFLIGHT_VERIFICATION };
  }
}
