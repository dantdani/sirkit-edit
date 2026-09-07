import { assessComponents, assessNets } from "./reconciliation";
import { buildSyncPlan } from "./plan";
import { pcbSyncId } from "./stable";
import type { PcbSyncGateResult, PcbSyncIssue, PcbSyncPreflightContext, PcbSyncPreflightResult, PcbSyncPreflightStatus, PcbSyncReadinessSummary, PcbSyncTraceStep } from "./types";
import { compareCodePoints } from "@/app/lib/stable-compare";

function gate(input: { code: string; pass: boolean; scope: PcbSyncGateResult["scope"]; message: string; stableIds?: string[]; remediation?: string; evidence?: string[]; notApplicable?: boolean }): PcbSyncGateResult {
  const status = input.notApplicable ? "not_applicable" : input.pass ? "pass" : "blocked";
  return { code: input.code, status, blocking: !input.pass && !input.notApplicable, severity: input.pass || input.notApplicable ? "info" : "blocking", scope: input.scope, stableIds: [...new Set(input.stableIds ?? [])].sort(), message: input.message, remediationCategory: input.remediation ?? input.scope, evidenceRefs: [...new Set(input.evidence ?? [])].sort(), causedBy: [] };
}

function deriveStatus(blockers: readonly PcbSyncIssue[]): PcbSyncPreflightStatus {
  const codes = blockers.map((item) => item.code);
  if (codes.some((code) => code.includes("AUTHORIZATION"))) return "blocked_authorization";
  if (codes.some((code) => code.includes("STALE") || code.includes("REVISION_MISMATCH") || code.includes("DIGEST_MISMATCH"))) return "blocked_stale_snapshot";
  if (codes.some((code) => code.includes("CONFLICT") || code.includes("DUPLICATE") || code.includes("COLLISION") || code.includes("MERGE") || code.includes("SPLIT"))) return "blocked_conflict";
  if (codes.some((code) => code === "PS_COMPONENT_UNRESOLVED" || code === "PS_COMPONENT_ASSET_MATERIALIZATION_MISSING")) return "blocked_component_resolution";
  if (codes.some((code) => code.includes("MAPPING") || code.includes("UNMAPPED") || code.includes("PAD_MISSING"))) return "blocked_mapping";
  if (codes.some((code) => code.includes("NET") || code.includes("CONNECTIVITY"))) return "blocked_net_integrity";
  if (codes.some((code) => code.includes("BOARD") || code.includes("STAGE8") || code.includes("FOOTPRINT_REPLACEMENT") || code.includes("STRUCTURAL_ADD"))) return "blocked_board_risk";
  if (codes.some((code) => code.includes("UNSUPPORTED") || code.includes("LIMIT"))) return "blocked_unsupported";
  return "blocked_component_resolution";
}

function summary(context: PcbSyncPreflightContext, components: ReturnType<typeof assessComponents>, nets: ReturnType<typeof assessNets>, plan: ReturnType<typeof buildSyncPlan>): PcbSyncReadinessSummary {
  const operations = plan.operations;
  return {
    totalSchematicComponents: context.snapshot.components.length,
    applicableComponents: context.snapshot.components.filter((item) => item.applicability === "applicable").length,
    notApplicableComponents: components.filter((item) => item.status === "not_applicable").length,
    nonphysicalComponents: components.filter((item) => item.status === "nonphysical").length,
    resolvedComponents: components.filter((item) => item.resolutionStatus === "resolved").length,
    layoutReadyComponents: components.filter((item) => item.resolutionStatus === "resolved" && item.blockers.length === 0).length,
    unresolvedComponents: components.filter((item) => item.applicability === "applicable" && item.resolutionStatus !== "resolved").length,
    mappingBlockedComponents: components.filter((item) => item.status === "blocked_mapping").length,
    staleComponents: components.filter((item) => item.status === "blocked_stale").length,
    conflictingComponents: components.filter((item) => item.status === "blocked_conflict" || item.status === "blocked_duplicate_identity").length,
    addOperations: operations.filter((item) => item.kind === "add_component_instance" || item.kind === "add_net").length,
    updateOperations: operations.filter((item) => item.kind.startsWith("update_") || item.kind === "rename_net_identity_preserving" || item.kind === "assign_pad_to_net").length,
    removeOperations: operations.filter((item) => item.kind === "remove_unrouted_component" || item.kind === "remove_unrouted_net").length,
    footprintReplacementOperations: operations.filter((item) => item.kind === "replace_unrouted_footprint").length,
    blockedOperations: plan.blockedOperations.length,
    totalNets: nets.length,
    blockedNets: nets.filter((item) => item.blockers.length > 0).length,
    boardChanged: false,
  };
}

export class PcbSyncPreflightEngine {
  evaluate(context: PcbSyncPreflightContext): PcbSyncPreflightResult {
    const components = assessComponents(context);
    const nets = assessNets(context, components);
    const padOwners = new Map<string, string>();
    for (const net of nets) for (const member of net.members) for (const pad of member.padNumbers) {
      const key = `${member.componentInstanceId}\0${pad}`, prior = padOwners.get(key);
      if (prior && prior !== net.stableNetId) net.blockers.push({ code: "PS_PAD_NET_CONFLICT", severity: "blocking", blocking: true, scope: "mapping", stableIds: [member.componentInstanceId, pad, prior, net.stableNetId].sort(), displayRefs: [], message: "One physical pad is assigned to more than one stable schematic net.", remediationCategory: "verify_pin_pad_mapping", evidenceRefs: [], causedBy: [], retryability: "after_user_action", helpKey: "pcb-sync/ps_pad_net_conflict" });
      else padOwners.set(key, net.stableNetId);
    }
    const applicable = context.snapshot.components.filter((item) => item.applicability === "applicable");
    const uniqueComponents = new Set(context.snapshot.components.map((item) => item.componentInstanceId));
    const uniqueNets = new Set(context.snapshot.nets.map((item) => item.stableNetId));
    const componentBlockers = components.flatMap((item) => item.blockers);
    const netBlockers = nets.flatMap((item) => item.blockers);
    const allIssues = [...context.contextIssues, ...context.snapshot.prerequisiteIssues, ...context.boardAssessment.blockers, ...componentBlockers, ...netBlockers];
    const globalGates: PcbSyncGateResult[] = [
      gate({ code: "PS_SNAPSHOT_SCOPE_VALID", pass: context.snapshot.tenantId === context.request.tenantId && context.snapshot.projectId === context.request.projectId && context.snapshot.branchId === context.request.branchId && context.snapshot.designId === context.request.designId, scope: "snapshot", message: "Snapshot scope matches the authorized request." }),
      gate({ code: "PS_SCHEMATIC_REVISION_CURRENT", pass: context.snapshot.schematicRevision === context.request.schematicRevision, scope: "snapshot", message: "Schematic revision matches the requested frozen revision." }),
      gate({ code: "PS_ASSEMBLY_VARIANT_CURRENT", pass: context.snapshot.assemblyVariantId === context.request.assemblyVariantId, scope: "snapshot", message: "Assembly variant is explicit and current." }),
      gate({ code: "PS_COMPONENT_IDENTITIES_UNIQUE", pass: uniqueComponents.size === context.snapshot.components.length, scope: "component", message: "Every schematic component has one unique stable identity." }),
      gate({ code: "PS_NET_IDENTITIES_UNIQUE", pass: uniqueNets.size === context.snapshot.nets.length, scope: "net", message: "Every canonical schematic net has one unique stable identity." }),
      gate({ code: "PS_RESOLVER_BATCH_COMPLETE", pass: applicable.every((item) => Boolean(context.resolutionByComponent[item.componentInstanceId])) && Object.keys(context.resolutionByComponent).length === applicable.length, scope: "system", message: "The complete applicable component set was batch-resolved." }),
      gate({ code: "PS_ALL_COMPONENTS_TRANSFER_READY", pass: componentBlockers.length === 0, scope: "component", message: "All component transfer assessments pass." }),
      gate({ code: "PS_ALL_NETS_TRANSFER_READY", pass: netBlockers.length === 0, scope: "net", message: "All net transfer assessments pass." }),
      gate({ code: "PS_BOARD_PROFILE_SUPPORTED", pass: context.boardAssessment.blockers.length === 0 && context.boardAssessment.formatSupported, scope: "board", message: "Target board is within the proven lossless adapter profile." }),
      gate({ code: "PS_PREREQUISITES_PASS", pass: context.snapshot.prerequisiteIssues.every((item) => !item.blocking), scope: "snapshot", message: "Pinned prerequisite checks pass." }),
      gate({ code: "PS_PREFLIGHT_READ_ONLY", pass: true, scope: "system", message: "Preflight does not mutate the target board." }),
    ].sort((a, b) => compareCodePoints(a.code, b.code));
    for (const failed of globalGates.filter((item) => item.blocking && item.status !== "pass")) allIssues.push({ code: failed.code, severity: "blocking", blocking: true, scope: failed.scope, stableIds: failed.stableIds, displayRefs: [], message: failed.message, remediationCategory: failed.remediationCategory, evidenceRefs: failed.evidenceRefs, causedBy: failed.causedBy, retryability: "after_user_action", helpKey: `pcb-sync/${failed.code.toLowerCase()}` });
    const dedupedIssues = [...new Map(allIssues.map((item) => [`${item.code}\0${item.stableIds.join("|")}`, item])).values()].sort((a, b) => compareCodePoints(a.code, b.code) || compareCodePoints(a.stableIds.join("\0"), b.stableIds.join("\0")));
    const plan = buildSyncPlan(context, components, nets, globalGates);
    const planBlockers = plan.blockedOperations.map((item): PcbSyncIssue => ({ code: item.reasonCodes[0] ?? "PS_OPERATION_BLOCKED", severity: "blocking", blocking: true, scope: item.risk === "copper_affecting" || item.risk === "constraint_affecting" ? "board" : "plan", stableIds: [item.targetStableId], displayRefs: [], message: item.summary, remediationCategory: item.risk === "copper_affecting" ? "stage8_copper_protection" : "sync_plan", evidenceRefs: [], causedBy: item.reasonCodes, retryability: "after_user_action", helpKey: `pcb-sync/${(item.reasonCodes[0] ?? "operation_blocked").toLowerCase()}` }));
    const blockers = [...new Map([...dedupedIssues.filter((item) => item.blocking), ...planBlockers].map((item) => [`${item.code}\0${item.stableIds.join("|")}`, item])).values()].sort((a, b) => compareCodePoints(a.code, b.code) || compareCodePoints(a.stableIds.join("\0"), b.stableIds.join("\0")));
    const warnings = [...context.boardAssessment.warnings, ...components.flatMap((item) => item.warnings), ...nets.flatMap((item) => item.warnings), ...dedupedIssues.filter((item) => !item.blocking)].sort((a, b) => compareCodePoints(a.code, b.code));
    const readiness = summary(context, components, nets, plan);
    const materialOperations = plan.operations.filter((item) => !["preserve_component_instance", "preserve_net", "mark_dnp_or_excluded", "no_op"].includes(item.kind));
    const status: PcbSyncPreflightStatus = blockers.length ? deriveStatus(blockers) : materialOperations.length ? "ready_to_apply" : "ready_no_changes";
    const traceBase: Array<Omit<PcbSyncTraceStep, "ordinal">> = [
      { phase: "request" as const, code: "PS_REQUEST_ACCEPTED", message: "Versioned request and sync policy were accepted.", safeDetails: { mode: context.request.mode } },
      { phase: "snapshot" as const, code: "PS_SNAPSHOT_FROZEN", message: "One coherent schematic, variant, library and board snapshot was frozen.", safeDetails: { snapshotDigest: context.snapshot.snapshotDigest } },
      { phase: "resolver" as const, code: "PS_RESOLVER_BATCH_COMPLETE", message: "Stage 2 batch resolution completed without legacy fallback.", safeDetails: { requested: applicable.length, returned: context.resolverBatch.results.length } },
      { phase: "reconciliation" as const, code: "PS_RECONCILIATION_COMPLETE", message: "Stable components, verified mappings and stable nets were reconciled.", safeDetails: { components: components.length, nets: nets.length } },
      { phase: "inspection" as const, code: "PS_BOARD_INSPECTED", message: "Board copper, zones, locks and constraints were inspected.", safeDetails: { boardClass: context.boardAssessment.boardClass } },
      { phase: "plan" as const, code: `PS_PLAN_${plan.lifecycle.toUpperCase()}`, message: "Deterministic synchronization plan was built.", safeDetails: { operations: plan.operations.length, blockedOperations: plan.blockedOperations.length, status } },
    ];
    const trace = traceBase.slice(0, context.policy.maxTraceSteps).map((item, ordinal) => ({ ...item, ordinal }));
    return { resultSchemaVersion: "sirkit.pcb-sync-preflight-result.v1", preflightId: pcbSyncId("pcb-sync-preflight", { request: context.request.requestId, snapshot: context.snapshot.snapshotDigest, plan: plan.planDigest }), requestId: context.request.requestId, status, snapshot: plan.snapshot, summary: readiness, components, nets, board: context.boardAssessment, globalGates, blockers, warnings, plan, resolverBatchSummary: context.resolverBatch.summary, policyVersions: plan.policyVersions, trace, evaluatedAt: context.request.requestedAt };
  }
}
