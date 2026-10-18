/**
 * B04 — provider-neutral, versioned tool registry.
 *
 * Metadata and discovery ONLY. This module deliberately distinguishes:
 *   registered   — a descriptor exists here;
 *   discoverable — eligible to be listed in some context (tool-discovery.ts);
 *   callable     — a real, named, reusable implementation binding exists;
 *   executable   — policy permits THIS actor/session to invoke it now
 *                  (never decided here — executor/adapter policy owns it);
 *   mutation-capable — it can change authoritative engineering state;
 *   agent-exposed    — a provider-facing agent is actually allowed to call it.
 *
 * A declared schema is NOT executable coverage. A B01 record is NOT a tool.
 * A B02 executor binding is NOT agent exposure. No descriptor may claim
 * agent-exposed mutation capability — validation fails closed.
 *
 * The registry references B01 command ids as its action authority and never
 * duplicates the B01 inventory. It imports no UI components, no API routes,
 * no executor, no provider SDKs, and no interactive-channel module.
 */

import { ACTION_COVERAGE_REGISTRY, type ApprovalTier } from "./action-registry";
import { annotationFieldIssues, firstPartyTextIssues } from "./descriptor-text"; // [B20 C3] OD-99, OD-100
import { GRANTED_EXECUTION_TOOLS, grantedExecutionViolations, type GrantedExecutionTool } from "./granted-execution-families"; // [B18-C]
import { canonicalJson, engineeringDigest } from "./stable";
import type { EngineeringCapability, ProjectRole } from "./types";

// ─── Enums (explicit; unknown values are rejected, never defaulted) ──────────

export const TOOL_LIFECYCLES = ["draft", "active", "deprecated", "retired"] as const;
export type ToolLifecycle = (typeof TOOL_LIFECYCLES)[number];

/** Forward-only lifecycle; anything else is an invalid transition. */
export const TOOL_LIFECYCLE_TRANSITIONS: Record<ToolLifecycle, readonly ToolLifecycle[]> = Object.freeze({
  draft: ["active", "retired"],
  active: ["deprecated"],
  deprecated: ["retired"],
  retired: [],
});

export const TOOL_OPERATION_CLASSES = ["read", "propose", "mutate", "destructive", "release", "view-session"] as const;
export type ToolOperationClass = (typeof TOOL_OPERATION_CLASSES)[number];

/** Risk rank per operation class — discovery's risk ceiling compares these. */
export const OPERATION_CLASS_RISK: Record<ToolOperationClass, number> = Object.freeze({
  read: 0,
  "view-session": 1,
  propose: 1,
  mutate: 2,
  destructive: 3,
  release: 4,
});

export const TOOL_SIDE_EFFECTS = ["none", "derived-cache", "proposal-artifact", "engineering-state", "release-artifact", "session-state", "external-transfer"] as const; // [B23-A2] external-transfer: data leaves Sirkit for a third party - Tier 3 whatever the id says (permission-tiers.ts, OD-173)
export type ToolSideEffect = (typeof TOOL_SIDE_EFFECTS)[number];

export const TOOL_BINDING_STATUSES = [
  "unbound",
  "bound-read",
  "bound-proposal",
  "bound-mutation-editor-session",
  "bound-view-session",
  "bound-external-read", // [B19-E E6] a bounded read of external sourcing observations through the server's injected port
  "bound-computation", "test-double", // [B22-B] bound-computation: a named computation read run in the bounded engine host through the server's injected port (OD-139)
] as const;
export type ToolBindingStatus = (typeof TOOL_BINDING_STATUSES)[number];

export const TOOL_DISCOVERY_STATUSES = ["discoverable", "internal-only"] as const;
export type ToolDiscoveryStatus = (typeof TOOL_DISCOVERY_STATUSES)[number];

export const TOOL_CALLABILITIES = ["callable", "not-callable"] as const;
export type ToolCallability = (typeof TOOL_CALLABILITIES)[number];

export const TOOL_CATEGORIES = [
  "project", "schematic", "pcb", "selection", "validation", "parts",
  "placement", "routing", "manufacturing", "view",
] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

export const TOOL_IDEMPOTENCY = ["required-key", "natural", "not-applicable"] as const;
export type ToolIdempotency = (typeof TOOL_IDEMPOTENCY)[number];

export const TOOL_AUDIT_MODES = ["change-set", "event-log", "none-read-only"] as const;
export type ToolAuditMode = (typeof TOOL_AUDIT_MODES)[number];

export const TOOL_BUDGET_CLASSES = ["interactive", "batch", "long-running"] as const;
export type ToolBudgetClass = (typeof TOOL_BUDGET_CLASSES)[number];

/** [B17-F] `*-surface`: the editor surface exists in the user's browser session (captured view context). */
export const TOOL_PROJECT_STATES = ["board-present", "schematic-present", "authoritative-board", "catalog-available", "pcb-surface", "pcb3d-surface", "schematic-surface", "workspace-surface", "schematic-build-mode"] as const; // [PR-D] schematic-build-mode: the validated schematic holds no Theory component (an empty or Build sheet) - the server's fact for the editor's Build mode, which the chat body does not carry (context.ts derives it)
export type ToolProjectState = (typeof TOOL_PROJECT_STATES)[number];

export const TOOL_SELECTION_KINDS = ["footprint", "track", "via", "zone", "text", "pad"] as const;
export type ToolSelectionKind = (typeof TOOL_SELECTION_KINDS)[number];

/** [B19-E E6] `external-observation`: the server bound an external acquisition port to this chat run (never a body claim).
 *  [B20 A4] `external-mcp-observation`: the server bound the external tool port (approved MCP servers) to this chat run. */
export const TOOL_AUTHORITY_SOURCES = ["durable-server-board", "local-working-copy", "catalog", "external-observation", "external-mcp-observation", "computation-engine", "schematic-generation", "none"] as const; // [B22-B] computation-engine: the server bound the named computation port (the bounded engine host) to this chat run; [PR-D] schematic-generation: the server bound the Build-mode generation port (runBuildMultiGeneration behind a configured provider) to this chat run (OD-243)
export type ToolAuthoritySource = (typeof TOOL_AUTHORITY_SOURCES)[number];

export type JsonSchema = Record<string, unknown>;

// ─── Descriptor ──────────────────────────────────────────────────────────────

export interface ToolImplementationBinding {
  status: ToolBindingStatus;
  /** Repo-relative module of the PROVEN reusable implementation (bound-*). */
  module?: string;
  /** Exported symbol within that module. */
  symbol?: string;
  /** Mutation bindings name the B01 command whose executor contract applies.
   *  B04 never invokes it: execution stays with the editor session. */
  canonicalCommandId?: string;
  notes?: string;
}

export interface ToolDescriptor {
  toolId: string;
  version: string;
  lifecycle: ToolLifecycle;
  /** Owning B01 action-registry command id — the action authority. */
  owningCommandId: string;
  title: string;
  description: string;
  category: ToolCategory;
  operationClass: ToolOperationClass;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  sideEffects: ToolSideEffect;
  requiredCapability: EngineeringCapability;
  requiredRoles: readonly ProjectRole[];
  approvalTier: ApprovalTier;
  requiredProjectState: readonly ToolProjectState[];
  requiredSelectionKinds: readonly ToolSelectionKind[];
  requiredAuthority: readonly ToolAuthoritySource[];
  requiresExpectedRevision: boolean;
  idempotency: ToolIdempotency;
  requiresLineage: boolean;
  binding: ToolImplementationBinding;
  discovery: ToolDiscoveryStatus;
  callability: ToolCallability;
  /** True ONLY when a provider-facing agent is actually allowed to call the
   *  tool. B04 exposes NOTHING to agents; mutation-capable classes can never
   *  set this (validation fails closed). */
  agentExposed: boolean;
  timeoutMs: number;
  budgetClass: ToolBudgetClass;
  validationStrategy: string;
  verificationStrategy: string;
  audit: ToolAuditMode;
  deprecation?: { replacedBy?: string; reason: string };
  /** File paths / artifact references proving the classification. */
  sourceEvidence: readonly string[];
  owner: string;
  versionNotes: string;
  /** Optional feature-flag gate consumed by discovery. */
  featureFlag?: string;
  /** [B17-F] view-session tools: the EXACT bus command ids (`<editor>.<name>`) the tool may issue — never an
   *  `*.observe` (the editor's own mirror). Validated against the binding and used by the request preparer. */
  viewCommands?: readonly string[];
  /** [B18-C] a `mutate` tool the agent may invoke ONLY through a server-minted one-shot execution grant (B18-B) — legal
   *  solely on a reviewed granted-execution family (`granted-execution-families.ts`); the agent actor never holds the
   *  capability, the grant carries it. Absent everywhere else. */
  executionMode?: "granted";
  /** [B18-C] reachable ONLY under a grant on the agent channel (never interactive-ui / api / automation discovery). */
  grantOnly?: true;
}

export interface ToolRegistryValidationOptions {
  /** Test seam: prove the granted-execution gates on a registry whose list is injected; production uses the reviewed list. */
  grantedExecutionTools?: readonly GrantedExecutionTool[];
}

// ─── Validation (deny by default) ────────────────────────────────────────────

const TOOL_ID_PATTERN = /^sirkit(\.[a-z0-9][a-z0-9-]*)+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
/** Mutation-CAPABLE classes: never agent-exposed, always canonical-executor bound. [B17-F] `view-session` is not one of
 *  them — it can never touch engineering state — but it is exposable ONLY as a bound bus-command tool (rules below). */
const MUTATION_CLASSES: readonly ToolOperationClass[] = ["mutate", "destructive", "release"];
const VIEW_COMMAND_PATTERN = /^(schematic|pcb|pcb3d|workspace)\.[a-z][a-z0-9-]*$/;

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

export function validateToolDescriptor(descriptor: ToolDescriptor, knownCommandIds: ReadonlySet<string>, options: ToolRegistryValidationOptions = {}): string[] {
  const errors: string[] = [];
  const id = descriptor.toolId ?? "(missing toolId)";
  const err = (message: string): void => { errors.push(`${id}@${descriptor.version ?? "?"}: ${message}`); };

  if (!TOOL_ID_PATTERN.test(descriptor.toolId ?? "")) err("invalid tool id");
  if (!VERSION_PATTERN.test(descriptor.version ?? "")) err("invalid version (expected MAJOR.MINOR.PATCH)");
  if (!oneOf(descriptor.lifecycle, TOOL_LIFECYCLES)) err("invalid or missing lifecycle");
  if (!descriptor.owningCommandId || !knownCommandIds.has(descriptor.owningCommandId)) err(`unknown B01 command reference ${descriptor.owningCommandId ?? "(missing)"}`);
  if (!descriptor.title?.trim() || !descriptor.description?.trim()) err("title and description are required");
  // [B20 C3] the first-party text gate (OD-99) and the annotation-field rule (OD-100): every registry and every adapter
  // inherits them here. The issues are fixed sentences that never echo the judged text.
  for (const issue of [...firstPartyTextIssues(descriptor), ...annotationFieldIssues(descriptor)]) err(issue);
  if (!oneOf(descriptor.category, TOOL_CATEGORIES)) err("invalid or missing category");
  if (!oneOf(descriptor.operationClass, TOOL_OPERATION_CLASSES)) err("invalid or missing operation class");
  if (!descriptor.inputSchema || typeof descriptor.inputSchema !== "object") err("input schema is required");
  if (!descriptor.outputSchema || typeof descriptor.outputSchema !== "object") err("output schema is required");
  // Security metadata: MISSING fields fail closed as errors — they never
  // default to permissive values.
  if (!oneOf(descriptor.sideEffects, TOOL_SIDE_EFFECTS)) err("side-effect classification is required");
  if (!descriptor.requiredCapability) err("required actor capability is required");
  if (!Array.isArray(descriptor.requiredRoles) || descriptor.requiredRoles.length === 0) err("required roles must be a non-empty list");
  if (!oneOf(descriptor.approvalTier, ["none", "reversible", "topology-or-geometry", "destructive", "release"] as const)) err("approval tier is required");
  if (!Array.isArray(descriptor.requiredProjectState)) err("required project state list is required");
  if (!Array.isArray(descriptor.requiredSelectionKinds) || descriptor.requiredSelectionKinds.some((kind) => !oneOf(kind, TOOL_SELECTION_KINDS))) err("selection-kind requirements are invalid");
  if (!Array.isArray(descriptor.requiredAuthority) || descriptor.requiredAuthority.length === 0) err("required authority sources are required");
  if (typeof descriptor.requiresExpectedRevision !== "boolean") err("expected-revision requirement must be explicit");
  if (!oneOf(descriptor.idempotency, TOOL_IDEMPOTENCY)) err("idempotency requirement is required");
  if (typeof descriptor.requiresLineage !== "boolean") err("lineage requirement must be explicit");
  if (!descriptor.binding || !oneOf(descriptor.binding.status, TOOL_BINDING_STATUSES)) err("implementation-binding status is required");
  if (!oneOf(descriptor.discovery, TOOL_DISCOVERY_STATUSES)) err("discovery status is required");
  if (!oneOf(descriptor.callability, TOOL_CALLABILITIES)) err("callability status is required");
  if (typeof descriptor.agentExposed !== "boolean") err("agent-exposure status must be explicit");
  if (!Number.isInteger(descriptor.timeoutMs) || descriptor.timeoutMs <= 0) err("timeout metadata is required");
  if (!oneOf(descriptor.budgetClass, TOOL_BUDGET_CLASSES)) err("budget class is required");
  if (!descriptor.validationStrategy?.trim()) err("validation strategy is required");
  if (!descriptor.verificationStrategy?.trim()) err("verification strategy is required");
  if (!oneOf(descriptor.audit, TOOL_AUDIT_MODES)) err("audit mode is required");
  if (!Array.isArray(descriptor.sourceEvidence) || descriptor.sourceEvidence.length === 0) err("source evidence is required");
  if (!descriptor.owner?.trim() || !descriptor.versionNotes?.trim()) err("owner and version notes are required");

  // Cross-field fail-closed invariants.
  const binding = descriptor.binding ?? { status: "unbound" as const };
  if (descriptor.callability === "callable" && binding.status === "unbound") {
    err("a tool without an implementation binding can never be callable (schema is not implementation)");
  }
  if (binding.status !== "unbound" && binding.status !== "test-double" && (!binding.module || !binding.symbol)) {
    err("bound implementations must name their proven module and symbol");
  }
  if (binding.status === "bound-mutation-editor-session") {
    if (!binding.canonicalCommandId) err("mutation bindings must name the canonical B01 command id");
    else if (binding.canonicalCommandId !== descriptor.owningCommandId) err("mutation binding command must equal the owning command");
    if (!MUTATION_CLASSES.includes(descriptor.operationClass)) err("mutation bindings require a mutation-capable operation class");
    if (!descriptor.requiresExpectedRevision || !descriptor.requiresLineage || descriptor.idempotency !== "required-key") {
      err("canonical mutations must require expected revision, lineage, and idempotency keys");
    }
  }
  if (descriptor.agentExposed) {
    if (MUTATION_CLASSES.includes(descriptor.operationClass) || descriptor.operationClass === "destructive") {
      // [B18-C] the ONE exception: a reviewed granted-execution family (Tier 1, canonical editor-session binding,
      // grantable capability, `executionMode: "granted"`) — derived from the list, never asserted by a descriptor alone.
      const violations = grantedExecutionViolations(descriptor, options.grantedExecutionTools);
      if (violations.length > 0) err(`agent-exposed mutation capability is forbidden (B04 invariant) unless it is a granted-execution family: ${violations.join("; ")}`);
    }
    if (descriptor.callability !== "callable") err("agent exposure requires callability");
    if (descriptor.discovery !== "discoverable") err("agent exposure requires discoverability");
  }
  if ((descriptor.executionMode !== undefined || descriptor.grantOnly !== undefined) && descriptor.operationClass !== "mutate") {
    err("executionMode / grantOnly are legal only on a mutate tool (a granted execution)");
  }
  if (descriptor.executionMode !== undefined && descriptor.executionMode !== "granted") err("executionMode must be \"granted\" when present");
  if (descriptor.grantOnly !== undefined && descriptor.grantOnly !== true) err("grantOnly must be true when present");
  if (descriptor.grantOnly && descriptor.executionMode !== "granted") err("a grant-only tool must be a granted execution");
  // [B17-F] a view-session tool is a bus-command tool or nothing: bound to the view-session command module, session-state
  // side effects only, no engineering authority, no approval tier, an explicit non-empty command list without `observe`.
  if (descriptor.operationClass === "view-session") {
    if (binding.status !== "unbound" && binding.status !== "bound-view-session") err("view-session tools bind only as bound-view-session");
    if (descriptor.sideEffects !== "session-state") err("view-session tools have session-state side effects only");
    if (!descriptor.requiredAuthority.includes("none")) err("view-session tools never require engineering authority");
    if (descriptor.approvalTier !== "none") err("view-session tools carry no approval tier (they are never engineering state)");
    if (descriptor.agentExposed || binding.status === "bound-view-session") {
      if (binding.status !== "bound-view-session") err("an exposed view-session tool must be bound-view-session");
      if (!Array.isArray(descriptor.viewCommands) || descriptor.viewCommands.length === 0) err("a bound view-session tool must list its bus command ids");
      for (const commandId of descriptor.viewCommands ?? []) {
        if (!VIEW_COMMAND_PATTERN.test(commandId)) err(`view command ${commandId} is not an <editor>.<name> bus command`);
        if (commandId.endsWith(".observe")) err(`view command ${commandId} is the editor's own mirror and can never be a tool`);
      }
    }
  } else if (descriptor.viewCommands !== undefined) {
    err("only view-session tools list view commands");
  }
  // [B19-E E6] a bound external read is a Tier 0 read over the injected server port and nothing else: read class, no side
  // effect beyond a derived cache, no approval tier, exactly the external-observation authority; that authority is its alone.
  // [B20 A4] ... or exactly the external-mcp-observation authority (the external tool read over approved MCP servers): ONE of
  // the two, never both, and each belongs to a bound external read alone.
  if (binding.status === "bound-external-read") {
    if (descriptor.operationClass !== "read") err("bound-external-read tools are read class only");
    if (descriptor.sideEffects !== "none" && descriptor.sideEffects !== "derived-cache") err("bound-external-read tools have no side effects beyond a derived cache");
    if (descriptor.approvalTier !== "none") err("bound-external-read tools carry no approval tier");
    if (!Array.isArray(descriptor.requiredAuthority) || descriptor.requiredAuthority.length !== 1 || (descriptor.requiredAuthority[0] !== "external-observation" && descriptor.requiredAuthority[0] !== "external-mcp-observation")) err("bound-external-read tools require exactly the external-observation authority");
    if (!binding.module || !binding.symbol) err("bound-external-read tools must name their port module and symbol");
  } else if (Array.isArray(descriptor.requiredAuthority) && descriptor.requiredAuthority.includes("external-observation")) {
    err("the external-observation authority belongs to bound-external-read tools only");
  } else if (Array.isArray(descriptor.requiredAuthority) && descriptor.requiredAuthority.includes("external-mcp-observation")) {
    err("the external-mcp-observation authority belongs to bound-external-read tools only"); // [B20 A4]
  } for (const issue of computationBindingIssues(descriptor, binding)) err(issue); for (const issue of generationAuthorityIssues(descriptor, binding)) err(issue); for (const issue of catalogAuthorityIssues(descriptor, binding)) err(issue); // [B22-B] the bound-computation rule (OD-139), at the end of this file; [PR-D] the schematic-generation authority rule (OD-243), beside it; [PR-D d2] the catalog authority rule, beside them
  if (descriptor.lifecycle === "deprecated" && !descriptor.deprecation?.reason) err("deprecated tools must carry deprecation metadata");
  if (descriptor.lifecycle === "retired" && descriptor.discovery !== "internal-only") err("retired tools cannot remain discoverable");
  if (descriptor.operationClass === "release" && descriptor.agentExposed) err("release tools can never be agent-exposed"); for (const issue of externalTransferIssues(descriptor)) err(issue); // [B23-A2] the external-transfer rule (OD-173), at the end of this file
  return errors;
}

export function validateLifecycleTransition(from: ToolLifecycle, to: ToolLifecycle): string[] {
  if (!oneOf(from, TOOL_LIFECYCLES) || !oneOf(to, TOOL_LIFECYCLES)) return [`unknown lifecycle state ${String(from)} → ${String(to)}`];
  return TOOL_LIFECYCLE_TRANSITIONS[from].includes(to) ? [] : [`invalid lifecycle transition ${from} → ${to}`];
}

// ─── Registry ────────────────────────────────────────────────────────────────

/** Provider-neutral rendering of one tool (the discovery/render unit). */
export interface NeutralToolSchema {
  name: string;
  version: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  operationClass: ToolOperationClass;
}

export interface ToolCoverageReport {
  descriptorCount: number;
  byCallability: Record<ToolCallability, number>;
  byOperationClass: Record<string, number>;
  byBindingStatus: Record<string, number>;
  agentExposedCount: number;
  /** [B18-C] exposed granted executions (mutate tools callable only under a grant). */
  agentExecutedCount: number;
  referencedCommandIds: string[];
  unreferencedMutationCapableCommands: string[];
}

export class ToolRegistry {
  private readonly byKey = new Map<string, ToolDescriptor>();
  private readonly ordered: ToolDescriptor[];
  private readonly grantedTools: readonly GrantedExecutionTool[];

  constructor(descriptors: readonly ToolDescriptor[], knownCommandIds?: ReadonlySet<string>, options: ToolRegistryValidationOptions = {}) {
    const commandIds = knownCommandIds ?? new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
    this.grantedTools = Object.freeze([...(options.grantedExecutionTools ?? GRANTED_EXECUTION_TOOLS)]);
    const errors: string[] = [];
    for (const descriptor of descriptors) {
      errors.push(...validateToolDescriptor(descriptor, commandIds, options));
      const key = `${descriptor.toolId}@${descriptor.version}`;
      if (this.byKey.has(key)) errors.push(`${key}: duplicate tool id/version registration`);
      this.byKey.set(key, descriptor);
    }
    if (errors.length > 0) throw new Error(`TOOL_REGISTRY_INVALID:\n${[...new Set(errors)].sort().join("\n")}`);
    this.ordered = [...descriptors].sort((a, b) => a.toolId.localeCompare(b.toolId) || a.version.localeCompare(b.version));
    Object.freeze(this.ordered);
  }

  get(toolId: string, version?: string): ToolDescriptor | undefined {
    if (version) return this.byKey.get(`${toolId}@${version}`);
    return this.ordered.filter((item) => item.toolId === toolId).at(-1);
  }

  list(filter?: { lifecycle?: ToolLifecycle }): readonly ToolDescriptor[] {
    return filter?.lifecycle ? this.ordered.filter((item) => item.lifecycle === filter.lifecycle) : this.ordered;
  }

  listByCategory(category: ToolCategory): readonly ToolDescriptor[] {
    return this.ordered.filter((item) => item.category === category);
  }

  byCommand(commandId: string): readonly ToolDescriptor[] {
    return this.ordered.filter((item) => item.owningCommandId === commandId);
  }

  deprecated(): readonly ToolDescriptor[] {
    return this.ordered.filter((item) => item.lifecycle === "deprecated" || item.lifecycle === "retired");
  }

  /** [B18-C] the reviewed granted-execution list this registry was VALIDATED against. The runtime gates (the run toolset,
   *  the gateway dispatch) derive from it, so they can never disagree with the validator: the production registry always
   *  carries the reviewed list; a test registry carries its injected rows. */
  grantedExecutionTools(): readonly GrantedExecutionTool[] {
    return this.grantedTools;
  }

  /**
   * Inspect a binding WITHOUT resolving or invoking anything. Missing or
   * unbound implementations report structured `not_callable` — never silent
   * success, never a thrown "works on my machine".
   */
  inspectBinding(toolId: string, version?: string):
    | { state: "not_registered" }
    | { state: "not_callable"; binding: ToolImplementationBinding; reason: string }
    | { state: "bound"; binding: ToolImplementationBinding } {
    const descriptor = this.get(toolId, version);
    if (!descriptor) return { state: "not_registered" };
    if (descriptor.callability !== "callable" || descriptor.binding.status === "unbound") {
      return {
        state: "not_callable",
        binding: descriptor.binding,
        reason: descriptor.binding.status === "unbound"
          ? "no trusted runtime implementation exists (schema declarations are not implementations)"
          : `binding status ${descriptor.binding.status} is not callable in this stage`,
      };
    }
    return { state: "bound", binding: descriptor.binding };
  }

  /** Deterministic digest over the canonical registry rendering. */
  digest(): string {
    return engineeringDigest({ schema: "sirkit.tool-registry.v1", tools: this.ordered });
  }

  renderNeutralTools(): NeutralToolSchema[] {
    return this.ordered.map((item) => ({
      name: item.toolId,
      version: item.version,
      description: item.description,
      inputSchema: item.inputSchema,
      outputSchema: item.outputSchema,
      operationClass: item.operationClass,
    }));
  }

  coverageReport(): ToolCoverageReport {
    const byCallability = { callable: 0, "not-callable": 0 } as Record<ToolCallability, number>;
    const byOperationClass: Record<string, number> = {};
    const byBindingStatus: Record<string, number> = {};
    for (const item of this.ordered) {
      byCallability[item.callability] += 1;
      byOperationClass[item.operationClass] = (byOperationClass[item.operationClass] ?? 0) + 1;
      byBindingStatus[item.binding.status] = (byBindingStatus[item.binding.status] ?? 0) + 1;
    }
    const referenced = [...new Set(this.ordered.map((item) => item.owningCommandId))].sort();
    const referencedSet = new Set(referenced);
    const unreferencedMutationCapableCommands = ACTION_COVERAGE_REGISTRY
      .filter((record) => (record.kind === "mutate" || record.kind === "destructive") && !referencedSet.has(record.id))
      .map((record) => record.id)
      .sort();
    return {
      descriptorCount: this.ordered.length,
      byCallability,
      byOperationClass,
      byBindingStatus,
      agentExposedCount: this.ordered.filter((item) => item.agentExposed).length,
      agentExecutedCount: this.ordered.filter((item) => item.agentExposed && item.executionMode === "granted").length,
      referencedCommandIds: referenced,
      unreferencedMutationCapableCommands,
    };
  }
}

// ─── Deterministic artifact renderings ───────────────────────────────────────

const csvCell = (value: string | number | boolean | null | undefined): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function renderToolRegistryCsv(registry: ToolRegistry): string {
  const header = [
    "tool_id", "version", "lifecycle", "owning_command", "category", "operation_class",
    "side_effects", "required_capability", "required_roles", "approval_tier",
    "requires_expected_revision", "idempotency", "requires_lineage",
    "binding_status", "binding_module", "binding_symbol", "canonical_command",
    "discovery", "callability", "agent_exposed", "timeout_ms", "budget_class",
    "audit", "owner", "source_evidence",
  ];
  const rows = registry.list().map((item) => [
    item.toolId, item.version, item.lifecycle, item.owningCommandId, item.category, item.operationClass,
    item.sideEffects, item.requiredCapability, [...item.requiredRoles].join(";"), item.approvalTier,
    item.requiresExpectedRevision, item.idempotency, item.requiresLineage,
    item.binding.status, item.binding.module ?? "", item.binding.symbol ?? "", item.binding.canonicalCommandId ?? "",
    item.discovery, item.callability, item.agentExposed, item.timeoutMs, item.budgetClass,
    item.audit, item.owner, [...item.sourceEvidence].join(";"),
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function renderNonCallableCoverageCsv(registry: ToolRegistry): string {
  const header = ["tool_id", "version", "owning_command", "operation_class", "binding_status", "why_not_callable"];
  const rows = registry
    .list()
    .filter((item) => item.callability === "not-callable")
    .map((item) => [
      item.toolId, item.version, item.owningCommandId, item.operationClass, item.binding.status,
      item.binding.notes ?? "no proven reusable implementation",
    ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function renderRegistryJson(value: unknown): string {
  return canonicalJson(value) + "\n";
}

/** [B22-B] A bound computation is a Tier 0 read over the injected engine port and nothing else (OD-139): read class, no side effect
 *  beyond the run's derived cache, no approval tier, exactly the computation-engine authority - which is its alone. */
function computationBindingIssues(descriptor: ToolDescriptor, binding: ToolImplementationBinding): string[] {
  const issues: string[] = [];
  const authority = Array.isArray(descriptor.requiredAuthority) ? descriptor.requiredAuthority : [];
  if (binding.status === "bound-computation") {
    if (descriptor.operationClass !== "read") issues.push("bound-computation tools are read class only");
    if (descriptor.sideEffects !== "none" && descriptor.sideEffects !== "derived-cache") issues.push("bound-computation tools have no side effects beyond a derived cache");
    if (descriptor.approvalTier !== "none") issues.push("bound-computation tools carry no approval tier");
    if (authority.length !== 1 || authority[0] !== "computation-engine") issues.push("bound-computation tools require exactly the computation-engine authority");
  } else if (authority.includes("computation-engine")) {
    issues.push("the computation-engine authority belongs to bound-computation tools only");
  }
  return issues;
}

/** [B23-A2] A tool whose side effect is `external-transfer` sends data out of Sirkit: it is Tier 3 (permission-tiers.ts) and can
 *  never be agent-exposed, whatever its class says (OD-173). Both port-bound read bindings already refuse the side effect (above). */
function externalTransferIssues(descriptor: ToolDescriptor): string[] {
  return descriptor.sideEffects === "external-transfer" && descriptor.agentExposed ? ["an external-transfer tool can never be agent-exposed (Tier 3: data leaves Sirkit, OD-173)"] : [];
}

/** [PR-D] The `schematic-generation` authority (the chat route's injected generation port, OD-243) belongs to the tools bound to the shared
 *  generation and nothing else. [PR-L, 2026-10-18] Runbook L.5: that is the DURABLE generation-task service (`app/lib/generation-task/service.ts`):
 *  the start and the control request are sealed artifacts (propose class, proposal-artifact side effects, no approval tier of its own - Tier 2
 *  by derivation), the inspection a Tier 0 read; each requires exactly that authority, no other tool may claim it, and no tool binds the in-turn generation. */
function generationAuthorityIssues(descriptor: ToolDescriptor, binding: ToolImplementationBinding): string[] {
  const issues: string[] = [];
  const authority = Array.isArray(descriptor.requiredAuthority) ? descriptor.requiredAuthority : [];
  const generationBound = (binding.status === "bound-proposal" || binding.status === "bound-read") && binding.module === "app/lib/generation-task/service.ts"; if (binding.module === "app/lib/schematic/build-multi-generation.ts" && binding.status !== "unbound") issues.push("no tool binds the in-turn Build-mode generation: the durable generation-task service replaced it (runbook L.5)");
  if (generationBound) {
    if (descriptor.operationClass !== (binding.status === "bound-read" ? "read" : "propose")) issues.push(binding.status === "bound-read" ? "a read bound to the durable generation-task service is read class only" : "a tool bound to the Build-mode generation is propose class only");
    if (descriptor.sideEffects !== (binding.status === "bound-read" ? "none" : "proposal-artifact")) issues.push(binding.status === "bound-read" ? "a read bound to the durable generation-task service has no side effects" : "a tool bound to the Build-mode generation has proposal-artifact side effects only");
    if (descriptor.approvalTier !== "none") issues.push("a tool bound to the Build-mode generation carries no approval tier of its own (Tier 2 by derivation)");
    if (authority.length !== 1 || authority[0] !== "schematic-generation") issues.push("a tool bound to the Build-mode generation requires exactly the schematic-generation authority");
  } else if (authority.includes("schematic-generation")) {
    issues.push("the schematic-generation authority belongs to the tool bound to the Build-mode generation only");
  }
  return issues;
}

/** [PR-D d2] The `catalog` authority (B04's own source for the parts tools; since PR-D d2 the chat route's injected catalog inspection
 *  port, app/api/chat/catalog-inspection-runtime.ts) belongs to Tier 0 reads only: read class, no side effect beyond a derived cache, no
 *  approval tier. An AGENT-EXPOSED tool that requires it must bind exactly the ONE shared catalog part detail loader
 *  (`app/lib/atomic/catalog-part-detail.ts#loadCatalogPartDetail`, the parts route's own read), so no other exposed tool rides the port. */
function catalogAuthorityIssues(descriptor: ToolDescriptor, binding: ToolImplementationBinding): string[] {
  const authority = Array.isArray(descriptor.requiredAuthority) ? descriptor.requiredAuthority : [];
  if (!authority.includes("catalog")) return [];
  const issues: string[] = [];
  if (descriptor.operationClass !== "read") issues.push("a tool requiring the catalog authority is read class only");
  if (descriptor.sideEffects !== "none" && descriptor.sideEffects !== "derived-cache") issues.push("a tool requiring the catalog authority has no side effects beyond a derived cache");
  if (descriptor.approvalTier !== "none") issues.push("a tool requiring the catalog authority carries no approval tier");
  if (descriptor.agentExposed && !(binding.status === "bound-read" && ((binding.module === "app/lib/atomic/catalog-part-detail.ts" && binding.symbol === "loadCatalogPartDetail") || (binding.module === "app/lib/component-resolution/candidate-search.ts" && binding.symbol === "searchResolutionCandidates")))) { // [PR-M, 2026-10-17] reviewed amendment: exactly ONE more admitted binding - the resolution candidate search, whose every result is re-read through the SAME shared catalog part detail loader (its port) before it is classified; every other exposed catalog-authority binding is still refused
    issues.push("an agent-exposed tool requiring the catalog authority must bind the shared catalog part detail loader (app/lib/atomic/catalog-part-detail.ts#loadCatalogPartDetail)");
  }
  return issues;
}
