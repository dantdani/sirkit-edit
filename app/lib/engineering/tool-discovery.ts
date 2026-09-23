/**
 * B04 — deterministic, contextual, fail-closed tool discovery.
 *
 * PURE: no provider calls, no database access, no browser or editor state —
 * callers assemble the DiscoveryContext explicitly. The engine filters the
 * registry through an ordered policy pipeline, returns a stable ordering,
 * explains every exclusion, and produces a deterministic discovery digest.
 *
 * Deny by default: a missing or restrictive context field EXCLUDES tools; it
 * never widens eligibility. Agent channels see only `agentExposed` tools —
 * and B04 exposes none, so agent discovery is truthfully empty.
 */

import { canonicalJson, engineeringDigest } from "./stable";
import {
  OPERATION_CLASS_RISK,
  type ToolCategory,
  type ToolDescriptor,
  type ToolOperationClass,
  type ToolProjectState,
  type ToolRegistry,
  type ToolSelectionKind,
} from "./tool-registry";
import type { ApprovalTier } from "./action-registry";
import type { EngineeringCapability, ProjectRole } from "./types";
// [B20 B1] (tag on its own line: the B04 import gate matches only an import line that ends at its semicolon)
import { mcpExclusionReason } from "./mcp-exposure";

// ─── Context ─────────────────────────────────────────────────────────────────

/** [B20 B1] `mcp`: the MCP server surface — deny-by-default, only the reviewed MCP subset (mcp-exposure.ts). */
export const DISCOVERY_CHANNELS = ["interactive-ui", "assistant-agent", "automation", "api", "mcp"] as const;
export type DiscoveryChannel = (typeof DISCOVERY_CHANNELS)[number];

export const RISK_CEILINGS = ["read", "propose", "mutate", "destructive", "release"] as const;
export type RiskCeiling = (typeof RISK_CEILINGS)[number];

const RISK_CEILING_RANK: Record<RiskCeiling, number> = Object.freeze({
  read: 0, propose: 1, mutate: 2, destructive: 3, release: 4,
});

/**
 * Everything discovery may consider. NO secrets, API keys, connection
 * strings, credentials, or raw authorization tokens belong here — the type
 * carries identities and states only, and the context digest is derived from
 * exactly these fields.
 */
export interface DiscoveryContext {
  tenantId: string;
  projectId: string;
  branchId: string;
  actorId: string;
  actorRole: ProjectRole;
  grantedCapabilities: readonly EngineeringCapability[];
  channel: DiscoveryChannel;
  /** Canonical head digest; empty string = no canonical revision available. */
  currentRevisionDigest: string;
  /** Durable lineage id; empty string = no canonical lineage open. */
  lineageId: string;
  /** Current editor surface, e.g. "pcb" | "schematic" | "project". */
  currentEditor: string;
  selectedKinds: readonly ToolSelectionKind[];
  projectState: readonly ToolProjectState[];
  availableAuthority: readonly string[];
  providerCapabilities: {
    supportsJsonSchema: boolean;
    toolNameMaxLength: number;
    maxToolCount: number;
  };
  riskCeiling: RiskCeiling;
  /** Approval tiers the session can actually satisfy right now. */
  approvalsAvailable: readonly ApprovalTier[];
  enabledFlags: readonly string[];
  /** Empty = all categories. */
  requestedCategories: readonly ToolCategory[];
  /** Optional deterministic schema-byte budget (canonical JSON bytes). */
  maxSchemaBytes?: number;
  /** [B18-C] capabilities a server-minted execution grant may carry for this run (SERVER-derived; never the actor's own —
   *  D18-8). Present only when the run can be granted; counted only on the assistant-agent channel for granted executions. */
  grantableCapabilities?: readonly EngineeringCapability[];
  /** [B18-C] the PCB proposal basis lineage a granted execution binds to (the canonical mutation's lineage requirement is
   *  satisfied by the grant's base, never by the schematic head mark). Present only when the run can be granted. */
  grantLineageId?: string;
}

// ─── Result ──────────────────────────────────────────────────────────────────

export const EXCLUSION_REASONS = [
  "lifecycle",
  "internal_only",
  "not_agent_exposed",
  "grant_only",
  "role_not_permitted",
  "capability_missing",
  "revision_required",
  "lineage_required",
  "editor_mismatch",
  "selection_kind_missing",
  "project_state_missing",
  "authority_missing",
  "not_callable",
  "approval_unavailable",
  "risk_ceiling",
  "provider_schema_unsupported",
  "provider_name_length",
  "provider_tool_count",
  "feature_flag_disabled",
  "category_not_requested",
  "budget_exceeded",
  "not_mcp_exposed", // [B20 B1] agent-exposed, but outside the MCP subset (mcpExclusionReason names the closed reason)
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export interface DiscoveredTool {
  toolId: string;
  version: string;
  operationClass: ToolOperationClass;
  category: ToolCategory;
  schemaBytes: number;
}

export interface DiscoveryResult {
  included: DiscoveredTool[];
  excluded: Array<{ toolId: string; version: string; reason: ExclusionReason }>;
  /** Deterministic digest over included/excluded sets + context fingerprint. */
  digest: string;
  contextDigest: string;
}

// ─── Engine ──────────────────────────────────────────────────────────────────

function schemaBytes(descriptor: ToolDescriptor): number {
  return canonicalJson({ name: descriptor.toolId, description: descriptor.description, inputSchema: descriptor.inputSchema }).length;
}

/**
 * Diagnostics visibility rule: unauthorized actors must not learn about
 * internal-only capabilities or implementation details. Exclusion entries for
 * internal-only tools are reported ONLY to interactive-ui diagnostics; other
 * channels see nothing about them at all.
 */
function mayReportExclusion(descriptor: ToolDescriptor, context: DiscoveryContext): boolean {
  if (descriptor.discovery === "internal-only") return context.channel === "interactive-ui";
  return true;
}

export function discoverTools(registry: ToolRegistry, context: DiscoveryContext): DiscoveryResult {
  const excluded: DiscoveryResult["excluded"] = [];
  const exclude = (descriptor: ToolDescriptor, reason: ExclusionReason): null => {
    if (mayReportExclusion(descriptor, context)) excluded.push({ toolId: descriptor.toolId, version: descriptor.version, reason });
    return null;
  };

  const capabilities = new Set(context.grantedCapabilities ?? []);
  const grantable = new Set(context.grantableCapabilities ?? []);
  const projectState = new Set(context.projectState ?? []);
  // [B19-E E6] the external-observation authority is a per-run chat fact: it never counts on any other channel
  // [B20 A4] nor does the external-mcp-observation authority (the external tool read over approved MCP servers)
  const authority = new Set((context.availableAuthority ?? []).filter((source) => (source !== "external-observation" && source !== "external-mcp-observation") || context.channel === "assistant-agent"));
  const flags = new Set(context.enabledFlags ?? []);
  const requestedCategories = new Set(context.requestedCategories ?? []);
  const approvals = new Set(context.approvalsAvailable ?? []);
  const ceiling = RISK_CEILING_RANK[context.riskCeiling] ?? 0; // unknown ceiling → most restrictive

  const candidates = registry
    .list()
    .map((descriptor): ToolDescriptor | null => {
      // 1-2. Lifecycle + internal-only.
      if (descriptor.lifecycle !== "active") return exclude(descriptor, "lifecycle");
      if (descriptor.discovery === "internal-only") return exclude(descriptor, "internal_only");
      // [B20 B1] the mcp channel sees ONLY the MCP subset — structurally admissible AND reviewed (listed, not withheld): never
      // a granted execution, a grant-only tool, an external read, a view-session control, an open-editor read, a state-writing
      // read or proposal, or an unreviewed tool, whatever the context claims (grants, approvals, authority, ceiling).
      if (context.channel === "mcp" && mcpExclusionReason(descriptor) !== null) {
        return exclude(descriptor, descriptor.agentExposed ? "not_mcp_exposed" : "not_agent_exposed");
      }
      // Channel: agents see only agent-exposed tools (B04 exposes none of the mutation classes; B18-C exposes reviewed
      // granted executions to the assistant-agent channel only).
      if ((context.channel === "assistant-agent" || context.channel === "automation") && !descriptor.agentExposed) {
        return exclude(descriptor, "not_agent_exposed");
      }
      if (descriptor.grantOnly && context.channel !== "assistant-agent") return exclude(descriptor, "grant_only");
      // 3. Actor role + capability. [B18-C] a granted execution's capability is the GRANT's: it may be satisfied by the
      // server-derived grantable set on the assistant-agent channel only — the actor's own set never widens.
      const grantedExecution = descriptor.executionMode === "granted" && descriptor.agentExposed && context.channel === "assistant-agent";
      if (!descriptor.requiredRoles.includes(context.actorRole)) return exclude(descriptor, "role_not_permitted");
      // [B18-C I3] on the assistant-agent channel a granted execution is satisfied ONLY by the grantable set — the actor's
      // own capabilities never count there, even when a context claims them; every other tool keeps the actor rule.
      const capabilitySatisfied = grantedExecution ? grantable.has(descriptor.requiredCapability) : capabilities.has(descriptor.requiredCapability);
      if (!capabilitySatisfied) return exclude(descriptor, "capability_missing");
      // 4-5. Project scope is asserted by the caller-assembled context; the
      // revision/lineage REQUIREMENTS gate here. [B18-C] a granted execution's lineage is its grant base (the PCB proposal
      // basis), never the schematic head mark.
      if (descriptor.requiresExpectedRevision && !context.currentRevisionDigest) return exclude(descriptor, "revision_required");
      if (descriptor.requiresLineage && !(grantedExecution ? context.grantLineageId : context.lineageId)) return exclude(descriptor, "lineage_required");
      // 6. Editor + selection kinds.
      if (descriptor.category !== "project" && descriptor.category !== "parts" && context.currentEditor && descriptor.category !== context.currentEditor) {
        // view/validation/selection/placement/routing/manufacturing tools ride the pcb editor.
        const editorFamilies: Record<string, readonly ToolCategory[]> = {
          pcb: ["pcb", "selection", "validation", "placement", "routing", "manufacturing", "view"],
          schematic: ["schematic", "validation"],
        };
        const allowed = editorFamilies[context.currentEditor] ?? [];
        if (!allowed.includes(descriptor.category)) return exclude(descriptor, "editor_mismatch");
      }
      if (descriptor.requiredSelectionKinds.length > 0 && !descriptor.requiredSelectionKinds.some((kind) => context.selectedKinds.includes(kind))) {
        return exclude(descriptor, "selection_kind_missing");
      }
      if (descriptor.requiredProjectState.length > 0 && !descriptor.requiredProjectState.every((state) => projectState.has(state))) {
        return exclude(descriptor, "project_state_missing");
      }
      if (!descriptor.requiredAuthority.includes("none") && !descriptor.requiredAuthority.some((source) => authority.has(source))) {
        return exclude(descriptor, "authority_missing");
      }
      // 7. Implementation binding.
      if (descriptor.callability !== "callable") return exclude(descriptor, "not_callable");
      // 8. Approval + risk ceiling.
      if (descriptor.approvalTier !== "none" && !approvals.has(descriptor.approvalTier)) return exclude(descriptor, "approval_unavailable");
      if (OPERATION_CLASS_RISK[descriptor.operationClass] > ceiling) return exclude(descriptor, "risk_ceiling");
      // 9. Provider capabilities.
      if (!context.providerCapabilities.supportsJsonSchema) return exclude(descriptor, "provider_schema_unsupported");
      if (descriptor.toolId.length > context.providerCapabilities.toolNameMaxLength) return exclude(descriptor, "provider_name_length");
      // 10. Feature flags.
      if (descriptor.featureFlag && !flags.has(descriptor.featureFlag)) return exclude(descriptor, "feature_flag_disabled");
      // 11. Requested categories.
      if (requestedCategories.size > 0 && !requestedCategories.has(descriptor.category)) return exclude(descriptor, "category_not_requested");
      return descriptor;
    })
    .filter((descriptor): descriptor is ToolDescriptor => descriptor !== null)
    // 13. Stable ordering: category, then tool id, then version.
    .sort((a, b) => a.category.localeCompare(b.category) || a.toolId.localeCompare(b.toolId) || a.version.localeCompare(b.version));

  // 12. Deterministic budgets (provider tool count, then schema bytes).
  const included: DiscoveredTool[] = [];
  let bytesUsed = 0;
  for (const descriptor of candidates) {
    if (included.length >= context.providerCapabilities.maxToolCount) { exclude(descriptor, "provider_tool_count"); continue; }
    const bytes = schemaBytes(descriptor);
    if (context.maxSchemaBytes !== undefined && bytesUsed + bytes > context.maxSchemaBytes) { exclude(descriptor, "budget_exceeded"); continue; }
    bytesUsed += bytes;
    included.push({ toolId: descriptor.toolId, version: descriptor.version, operationClass: descriptor.operationClass, category: descriptor.category, schemaBytes: bytes });
  }

  excluded.sort((a, b) => a.toolId.localeCompare(b.toolId) || a.version.localeCompare(b.version) || a.reason.localeCompare(b.reason));

  const contextDigest = engineeringDigest({ schema: "sirkit.tool-discovery-context.v1", context });
  const digest = engineeringDigest({
    schema: "sirkit.tool-discovery.v1",
    registry: registry.digest(),
    context: contextDigest,
    included,
    excluded,
  });
  return { included, excluded, digest, contextDigest };
}
