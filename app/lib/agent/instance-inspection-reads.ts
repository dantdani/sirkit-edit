/**
 * [PR-M, 2026-10-17] The agent's SCHEMATIC-INSTANCE INSPECTION, `sirkit.schematic.instance-inspect` (section M.2.1): a Tier 0 read
 * over the run's VALIDATED schematic snapshot - the resource the gateway's integrity check digest-pins before every call - and the
 * SERVER catalog facts of the parts its instances were placed from, through the SAME catalog port the catalog inspection reads
 * (app/api/chat/catalog-inspection-runtime.ts). NO board is needed or read: the editor's own Prepare PCB is board-less, and the
 * instances this inspects are exactly the ones that block it, so the read travels its own service (modelled on the missing-facts
 * read, missing-facts-reads.ts) and never the B05 canonical-state binding, whose board requirement is genuine for board reads.
 *
 * Per instance (the one derivation, app/lib/component-resolution/instance-facts.ts `inspectSchematicInstances`): the stable
 * instance id (the only durable mutation target), the reference, value, catalog part and exact revision with its catalog status,
 * whether the Schematic -> PCB run would refuse it and why, the published revision its own part links for its value, the symbol's
 * pins with number / name / electrical type / function FROM THE CATALOG SYMBOL, each pin's net and members, the polarity of a polar
 * part; plus the captured scope, the schematic digest and the canonical head mark. Without the catalog port every pin is
 * unavailable with that reason (never a browser pin list). Nothing is placed, bound, published or applied.
 */
import { discoverTools } from "../engineering/tool-discovery";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS, DEFAULT_OUTPUT_LIMITS, validateAgainstSchema } from "../engineering/tool-io-validation";
import type { ToolDescriptor, ToolRegistry } from "../engineering/tool-registry";
import { inspectSchematicInstances, MAX_INSPECTED_INSTANCES } from "../component-resolution/instance-facts";
import { loadCatalogParts } from "../component-resolution/facts-loader";
import type { CatalogPartInspectionPort } from "./catalog-inspection-reads";
import type { AgentRunContext, GatewayInvocationOutcome } from "./contracts";
import { sanitizeTraceText } from "./redaction";

export const INSTANCE_INSPECT_TOOL_ID = "sirkit.schematic.instance-inspect" as const;
export const INSTANCE_INSPECTION_BINDING = Object.freeze({ module: "app/lib/component-resolution/instance-facts.ts", symbol: "inspectSchematicInstances" });
export const INSTANCE_INSPECTION_VERIFICATION = "schematic-snapshot-verified" as const;
export const INSTANCE_INSPECTION_VERIFICATION_WITH_CATALOG = "schematic-snapshot-verified+catalog-read" as const;
export const INSTANCE_INSPECTION_REPORT_SCHEMA = "sirkit.schematic-instance-inspection-report.v1" as const;
/** The catalog reads end this much before the call's own timer (a late catalog is "catalog unavailable" per part). */
export const INSTANCE_INSPECTION_CATALOG_MARGIN_MS = 500;
export const INSTANCE_INSPECT_INPUT_EXAMPLE = Object.freeze({ componentIds: ["D1", "D2"] });

const AUTHORITY_KEYS = new Set(["actor", "actorId", "role", "capability", "capabilities", "authority", "approval", "approvals", "apply", "commit", "bind", "publish", "place", "scope", "headMark", "revision", "expectedRevision", "revisionId", "lineageId", "schematic", "board", "boardId", "pins", "nets", "partId", "mpn", "live", "distributor", "source"]);
const TARGET_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,199}$/;

export type InstanceInspectionBindingResolution = { state: "resolved" } | { state: "not_callable"; reason: string };

export function resolveInstanceInspectionBinding(descriptor: ToolDescriptor): InstanceInspectionBindingResolution {
  if (descriptor.toolId !== INSTANCE_INSPECT_TOOL_ID) return { state: "not_callable", reason: "Only the schematic-instance inspection is invocable here." };
  if (descriptor.operationClass !== "read" || descriptor.approvalTier !== "none" || descriptor.sideEffects !== "none") return { state: "not_callable", reason: "The instance inspection is a Tier 0 read with no side effects." };
  if (descriptor.binding.status !== "bound-read" || descriptor.binding.module !== INSTANCE_INSPECTION_BINDING.module || descriptor.binding.symbol !== INSTANCE_INSPECTION_BINDING.symbol) return { state: "not_callable", reason: "The descriptor does not bind the one shared instance-inspection derivation." };
  return { state: "resolved" };
}

/** The loop's per-run rule: the binding resolves and the run holds a verified schematic snapshot (no board; the catalog is optional). */
export function instanceInspectionReadAvailable(descriptor: ToolDescriptor, context: AgentRunContext, warn: (message: string) => void): boolean {
  if (resolveInstanceInspectionBinding(descriptor).state !== "resolved") { warn(`Tool ${descriptor.toolId} unavailable: no resolved instance-inspection binding.`); return false; }
  if (!context.schematic || !context.schematicDigest) { warn(`Tool ${descriptor.toolId} unavailable: no verified schematic snapshot for this run.`); return false; }
  return true;
}

export interface InstanceInspectionReadServiceOptions {
  port?: CatalogPartInspectionPort;
  integrity: (context: AgentRunContext) => readonly string[];
  now?: () => number;
}
export interface InstanceInspectionReadInput { toolId: string; version: string; args: Record<string, unknown>; context: AgentRunContext; runId: string; timeoutMs: number; signal?: AbortSignal }

export class InstanceInspectionReadService {
  constructor(private readonly registry: ToolRegistry, private readonly options: InstanceInspectionReadServiceOptions) {}

  async invoke(input: InstanceInspectionReadInput): Promise<GatewayInvocationOutcome> {
    const refuse = (status: string, diagnostics: string[]): GatewayInvocationOutcome => ({ kind: "refused", ok: false, toolId: input.toolId, version: input.version, status, diagnostics });
    const descriptor = this.registry.get(input.toolId, input.version);
    if (!descriptor) return refuse("not_registered", ["Unknown tool."]);
    const resolution = resolveInstanceInspectionBinding(descriptor);
    if (resolution.state !== "resolved") return refuse("not_callable", [resolution.reason]);
    const integrity = this.options.integrity(input.context);
    if (integrity.length > 0) return refuse("context_integrity", integrity.slice(0, 5));
    const context = input.context;
    if (!context.schematic || !context.schematicDigest) return refuse("authority_unavailable", ["No verified schematic snapshot is available for this run; the instance inspection is unavailable."]);
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
    for (const key of Object.keys(input.args)) {
      if (key === "componentIds") continue;
      return refuse("invalid_input", [AUTHORITY_KEYS.has(key) ? `Argument "${key.slice(0, 40)}" is an authority-shaped claim - the instance inspection accepts only componentIds; pins and nets are read from the server catalog and the verified schematic.` : `Unexpected argument "${key.slice(0, 40)}" - the instance inspection accepts only componentIds.`]);
    }
    const raw = input.args.componentIds;
    if (raw !== undefined && (!Array.isArray(raw) || raw.length > MAX_INSPECTED_INSTANCES || raw.some((entry) => typeof entry !== "string" || !TARGET_PATTERN.test(entry.trim())))) {
      return refuse("invalid_input", [`componentIds, when given, is 1-${MAX_INSPECTED_INSTANCES} stable instance ids or reference designators (1-200 characters each); omit it for every unresolved instance.`]);
    }
    const targets: readonly string[] | "unresolved" = Array.isArray(raw) && raw.length > 0 ? (raw as string[]).map((entry) => entry.trim()) : "unresolved";
    if (input.signal?.aborted) return refuse("cancelled", ["The invocation was cancelled before it ran."]);
    const state = context.schematic;
    const catalogBound = this.options.port !== undefined && context.catalogInspectionAvailable === true;
    const timeoutMs = Math.max(1, Math.min(Math.floor(input.timeoutMs), descriptor.timeoutMs));
    let output: Record<string, unknown>;
    try {
      const partIds = [...new Set((state.kicadComponents ?? []).map((instance) => instance.partId))];
      const loaded = await loadCatalogParts(catalogBound ? this.options.port : undefined, partIds, { scope: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId }, runId: input.runId, budgetMs: timeoutMs - INSTANCE_INSPECTION_CATALOG_MARGIN_MS, ...(input.signal ? { signal: input.signal } : {}), ...(this.options.now ? { now: this.options.now } : {}) });
      const inspection = inspectSchematicInstances({ state, targets, parts: loaded.parts });
      output = {
        report: {
          schema: INSTANCE_INSPECTION_REPORT_SCHEMA,
          derivation: `${INSTANCE_INSPECTION_BINDING.module}#${INSTANCE_INSPECTION_BINDING.symbol}`,
          captured: { tenantId: context.tenantId, projectId: context.projectId, branchId: context.branchId, schematicDigest: context.schematicDigest, headMark: context.schematicHeadMark, board: "not read (not needed: schematic-only inspection)" },
          catalog: { state: catalogBound ? "bound" : "unavailable", partsAsked: loaded.asked, partsFailed: loaded.failed, reason: catalogBound ? "the symbol pins come from the server catalog part each instance was placed from" : "catalog unavailable: no catalog port is bound to this run, so every pin and net is unavailable (never taken from a browser pin list)" },
          inspection,
          note: "A reference designator is a display label; target the stable componentId. An instance with no published exact revision is resolved with the candidate search and the resolution proposal (a human reviews and applies it); an already-resolved part is replaced with the exact replacement proposal. Nothing here is placed, bound, published or applied.",
        } as unknown as Record<string, unknown>,
      };
    } catch (error) {
      return refuse("implementation_failed", [`The instance inspection failed internally: ${sanitizeTraceText(error instanceof Error ? error.message : String(error), 200) || "unknown error"}. Nothing was changed.`]);
    }
    const outputErrors = [...assertSafeJsonValue(output, DEFAULT_OUTPUT_LIMITS, "output"), ...validateAgainstSchema(output, descriptor.outputSchema, "output")];
    if (outputErrors.length > 0) return refuse("invalid_output", outputErrors.slice(0, 5));
    return { kind: "read", ok: true, toolId: descriptor.toolId, version: descriptor.version, output, sourceRevisionDigest: context.schematicDigest, verification: catalogBound ? INSTANCE_INSPECTION_VERIFICATION_WITH_CATALOG : INSTANCE_INSPECTION_VERIFICATION };
  }
}
