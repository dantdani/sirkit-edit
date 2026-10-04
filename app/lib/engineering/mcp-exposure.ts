/**
 * [B20 B1] THE MCP exposure subset: which of Sirkit's own registry tools an MCP principal may ever be offered (runbook
 * B20-B). Exposure needs BOTH the structural rule here AND the reviewed decision (`mcp-exposure-review.ts`: listed as
 * exposed, not withheld), and the report checks the two against each other in both directions. B1 serves nothing:
 * serving is B2 (endpoint) and B3 (reads); [B20 B4] B4 withheld every proposal, so MCP is read-only in B20 (OD-82, OD-87).
 *
 * The MCP set is a SUBSET of the agent set (`agent-exposure.ts`). The agent set is the one reviewed list every model-reach
 * gate derives from; MCP is an adapter around the canonical registry and command bus, so it may narrow that reach and never
 * widen it, and it never becomes a second authority system (runbook B20). Inside the agent set it excludes, with one closed
 * reason each, every granted execution (a grant needs a cookie-session human and the browser's editor session: D20-2,
 * D20-33), the external reads (live vendor quota, labels only: OD-55), and the view-session controls and reads of an open
 * editor's view or selection (an MCP principal has no open editor: OD-49, D20-7). The rule admits only `read` descriptors
 * with no side effect beyond a derived cache and `propose` descriptors whose only side effect is a proposal artifact, bound
 * to a server-side read or an inert proposal, so nothing that qualifies or releases manufacturing, orders, runs a raw
 * process, replaces state wholesale, or mutates a database or file can be reached through it.
 *
 * Every function here is pure and never throws.
 */
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "./agent-exposure";
import { NEVER_EXPOSED_TOOL_PATTERNS } from "./granted-execution-families";
import { INTENTIONAL_MCP_EXPOSED_TOOL_IDS, MCP_WITHHELD_TOOL_IDS } from "./mcp-exposure-review";
import { permissionTierOfDescriptor } from "./permission-tiers";
import { TOOL_PROJECT_STATES, type ToolDescriptor, type ToolRegistry } from "./tool-registry";

export { INTENTIONAL_MCP_EXPOSED_TOOL_IDS, MCP_WITHHELD_TOOL_IDS };

/**
 * The closed exclusion reasons, in precedence order (the first that applies is THE reason): the never-lists first, then the
 * agent set, then the classes, side effects and bindings MCP cannot serve, then the reviewed decision. The first eleven are the
 * structural rule; `withheld` and `not_mcp_reviewed` apply only to a descriptor the structural rule admits. [B22-B] `computation` (OD-139) is a never-list of its own: every `sirkit.computation.*` descriptor and every `bound-computation` binding, exposed or not.
 * `not_read_or_propose`, `side_effects`, `not_servable` and `not_mcp_reviewed` carry no production id ([B20 B3] `withheld` two; [B20 B4] seven).
 */
export const MCP_EXCLUSION_REASONS = Object.freeze([
  "tier3",
  "never_exposed", "computation", // [B22-B] computation
  "not_agent_exposed",
  "granted_execution",
  "view_session",
  "not_read_or_propose",
  "side_effects",
  "external_read",
  "view_state_read",
  "not_servable",
  "withheld",
  "not_mcp_reviewed",
] as const);
export type McpExclusionReason = (typeof MCP_EXCLUSION_REASONS)[number];

/** The decision that excludes each reason's descriptors (rendered into the exposure page and the manifest review). */
export const MCP_EXCLUSION_REASON_DECISIONS: Readonly<Record<McpExclusionReason, string>> = Object.freeze({
  tier3: "permission Tier 3 (publish, release, upload, purchase or order, qualification) is never agent-executable (permission-tiers.ts)",
  never_exposed: "matches NEVER_EXPOSED_TOOL_PATTERNS: manufacturing release, qualification, the canonical replay primitive, never-granted canonical mutations, catalog authority", computation: "a named computation (B22-B, OD-139) runs in the server's bounded engine host (a worker thread) or the diagnostic runner (a process), bound to a chat run by its composition root; an MCP call may start neither (b20-b4-process-gate)",
  not_agent_exposed: "outside the reviewed agent set; the MCP set is a subset of it (agent-exposure.ts)",
  granted_execution: "a granted execution needs a server-minted grant for a cookie-session human and the browser's editor session; an MCP principal has neither (D20-2, D20-33)",
  view_session: "a view-session control is executed by an open editor in the user's browser; an MCP principal has none (OD-49, D20-7)",
  not_read_or_propose: "only read and propose classes are MCP-exposable; no mutation or command execution over MCP (runbook B20-B)",
  side_effects: "a read may declare no side effect or a derived cache, a proposal a proposal artifact only: the rule the executors behind MCP apply (tool-invocation.ts, gateway.ts, layout-proposals.ts)",
  external_read: "an external read spends live vendor quota and discloses labels only (OD-55, OD-36, OD-40)",
  view_state_read: "reads an open editor's view or selection, which an MCP principal does not have (OD-49, D20-7)",
  not_servable: "not an active, discoverable, callable descriptor bound to a server-side read or an inert proposal with no approval tier of its own",
  withheld: "structurally admissible, but withheld from MCP by a reviewed decision recorded with its reason (MCP_WITHHELD_TOOL_IDS)",
  not_mcp_reviewed: "structurally admissible, but not reviewed for MCP (not in INTENTIONAL_MCP_EXPOSED_TOOL_IDS); never exposed, and drift until it is listed or withheld",
});

export const MCP_EXPOSABLE_OPERATION_CLASSES = Object.freeze(["read", "propose"] as const);
/** [B20 B1 review] The side effects each exposable class may declare (as tool-invocation.ts, gateway.ts, layout-proposals.ts). */
export const MCP_READ_SIDE_EFFECTS: readonly string[] = Object.freeze(["none", "derived-cache"]);
export const MCP_PROPOSAL_SIDE_EFFECTS: readonly string[] = Object.freeze(["proposal-artifact"]);
export const MCP_SERVED_BINDING_STATUSES = Object.freeze(["bound-read", "bound-proposal"] as const);
/** Categories whose reads describe an open editor rather than the project ([B17-F] view and selection tools). */
export const MCP_VIEW_STATE_CATEGORIES = Object.freeze(["view", "selection"] as const);
/** [B17-F] `*-surface` states: the editor surface exists in the user's browser session (captured view context). */
export const MCP_EDITOR_SURFACE_STATES: readonly string[] = Object.freeze(TOOL_PROJECT_STATES.filter((state) => state.endsWith("-surface")));

export type McpExposureCandidate = Pick<ToolDescriptor,
  "toolId" | "operationClass" | "approvalTier" | "agentExposed" | "binding" | "executionMode" | "grantOnly" | "category" |
  "requiredAuthority" | "requiredProjectState" | "lifecycle" | "discovery" | "callability" | "sideEffects">;

interface ExposureFacts {
  toolId: string;
  operationClass: string;
  approvalTier: string;
  agentExposed: boolean;
  bindingStatus: string;
  granted: boolean;
  category: string;
  requiredAuthority: readonly string[];
  requiredProjectState: readonly string[];
  lifecycle: string;
  discovery: string;
  callability: string;
  sideEffects: string;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const strings = (value: unknown): readonly string[] | null => (Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : null);

/** Each field read once; a malformed or hostile descriptor answers null (never a throw). */
function factsOf(descriptor: unknown): ExposureFacts | null {
  try {
    if (typeof descriptor !== "object" || descriptor === null) return null;
    const source = descriptor as Record<string, unknown>;
    const toolId = source.toolId;
    const binding = source.binding;
    const requiredAuthority = strings(source.requiredAuthority);
    const requiredProjectState = strings(source.requiredProjectState);
    if (typeof toolId !== "string" || toolId.length === 0 || typeof binding !== "object" || binding === null || !requiredAuthority || !requiredProjectState) return null;
    return {
      toolId,
      operationClass: text(source.operationClass),
      approvalTier: text(source.approvalTier),
      agentExposed: source.agentExposed === true,
      bindingStatus: text((binding as Record<string, unknown>).status),
      granted: source.executionMode !== undefined || source.grantOnly !== undefined,
      category: text(source.category),
      requiredAuthority,
      requiredProjectState,
      lifecycle: text(source.lifecycle),
      discovery: text(source.discovery),
      callability: text(source.callability),
      sideEffects: text(source.sideEffects),
    };
  } catch {
    return null;
  }
}

/** The structural rule: the descriptor's own classification only (never a list of MCP ids, never an annotation). */
function structuralReasonOf(facts: ExposureFacts): McpExclusionReason | null {
  const tier = permissionTierOfDescriptor({ toolId: facts.toolId, operationClass: facts.operationClass as ToolDescriptor["operationClass"], approvalTier: facts.approvalTier as ToolDescriptor["approvalTier"], sideEffects: facts.sideEffects as ToolDescriptor["sideEffects"] }); // [B23-A2] an external transfer is tier3 first (OD-173)
  if (tier === 3) return "tier3";
  if (NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(facts.toolId))) return "never_exposed"; if (facts.toolId.startsWith("sirkit.computation.") || facts.bindingStatus === "bound-computation") return "computation"; // [B22-B] OD-139
  if (!facts.agentExposed) return "not_agent_exposed";
  if (facts.granted) return "granted_execution";
  if (facts.operationClass === "view-session") return "view_session";
  if (!(MCP_EXPOSABLE_OPERATION_CLASSES as readonly string[]).includes(facts.operationClass)) return "not_read_or_propose";
  if (!(facts.operationClass === "read" ? MCP_READ_SIDE_EFFECTS : MCP_PROPOSAL_SIDE_EFFECTS).includes(facts.sideEffects)) return "side_effects";
  if (facts.bindingStatus === "bound-external-read" || facts.requiredAuthority.includes("external-observation") || facts.requiredAuthority.includes("external-mcp-observation")) return "external_read"; // [B20 A4] + the external tool read's authority
  if ((MCP_VIEW_STATE_CATEGORIES as readonly string[]).includes(facts.category) || facts.requiredProjectState.some((state) => MCP_EDITOR_SURFACE_STATES.includes(state))) return "view_state_read";
  if (!(MCP_SERVED_BINDING_STATUSES as readonly string[]).includes(facts.bindingStatus) || facts.lifecycle !== "active" || facts.discovery !== "discoverable" || facts.callability !== "callable" || facts.approvalTier !== "none") return "not_servable";
  return null;
}

/** The reviewed decision over a structurally admitted id: withheld first, then listed (fail closed: in both lists = withheld). */
function reviewReasonOf(toolId: string): McpExclusionReason | null {
  if (MCP_WITHHELD_TOOL_IDS.includes(toolId)) return "withheld";
  if (!INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(toolId)) return "not_mcp_reviewed";
  return null;
}

/**
 * Why a descriptor is NOT MCP-exposable (null: it is): the structural rule over the descriptor's own classification first,
 * then the reviewed decision. Both are required, so a descriptor never becomes MCP-exposed merely by joining the agent set
 * (unreviewed: `not_mcp_reviewed`), and a listed id whose classification drifts is refused by the rule. Annotation-like
 * fields are never read.
 */
export function mcpExclusionReason(descriptor: McpExposureCandidate): McpExclusionReason | null {
  const facts = factsOf(descriptor);
  if (!facts) return "not_servable";
  return structuralReasonOf(facts) ?? reviewReasonOf(facts.toolId);
}

export interface McpExposureExclusion {
  readonly toolId: string;
  readonly version: string;
  readonly reason: McpExclusionReason;
}

export interface McpExposureReport {
  readonly ok: boolean;
  /** The reviewed exposed list. */
  readonly expected: readonly string[];
  /** Registry ids exposed: admitted by the structural rule, listed and not withheld (sorted, unique). */
  readonly actual: readonly string[];
  /** Registry ids the structural rule alone admits (sorted, unique): `actual` plus the withheld and the unreviewed ones. */
  readonly admitted: readonly string[];
  /** Listed ids that are not exposed (the rule refuses them, they are withheld too, or they are not registered). */
  readonly missing: readonly string[];
  /** Admitted ids that are neither listed nor withheld (`not_mcp_reviewed`): never exposed, and drift until reviewed. */
  readonly unexpected: readonly string[];
  /** Ids admitted or listed here that are not in the reviewed agent set (the MCP set must be a subset of it). */
  readonly outsideAgentSet: readonly string[];
  /** Admitted ids registered under more than one version (two tools under one MCP name). */
  readonly duplicates: readonly string[];
  readonly excluded: readonly McpExposureExclusion[];
  readonly excludedByReason: Readonly<Record<McpExclusionReason, readonly string[]>>;
  readonly count: number;
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort(byCodePoint);

/**
 * Compare the structural result with the reviewed decision in both directions (as agentExposureReport does for the agent
 * set). A registry that cannot be read reports every reviewed id missing (ok false), never a throw.
 */
export function mcpExposureReport(registry: Pick<ToolRegistry, "list">): McpExposureReport {
  let admitted: string[] = [];
  let exposed: string[] = [];
  let excluded: McpExposureExclusion[] = [];
  try {
    for (const descriptor of registry.list()) {
      const facts = factsOf(descriptor);
      const structural = facts ? structuralReasonOf(facts) : "not_servable";
      const toolId = facts ? facts.toolId : "";
      if (structural === null) admitted.push(toolId);
      const reason = structural ?? reviewReasonOf(toolId);
      if (reason === null) exposed.push(toolId);
      else excluded.push(Object.freeze({ toolId, version: text((descriptor as { version?: unknown }).version), reason }));
    }
  } catch {
    admitted = [];
    exposed = [];
    excluded = [];
  }
  excluded.sort((a, b) => byCodePoint(a.toolId, b.toolId) || byCodePoint(a.version, b.version));
  const admittedIds = sortedUnique(admitted);
  const actual = sortedUnique(exposed);
  const expected = [...INTENTIONAL_MCP_EXPOSED_TOOL_IDS];
  const missing = expected.filter((id) => !actual.includes(id));
  const unexpected = admittedIds.filter((id) => !expected.includes(id) && !MCP_WITHHELD_TOOL_IDS.includes(id));
  const outsideAgentSet = sortedUnique([...admittedIds, ...expected]).filter((id) => !INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.includes(id));
  const duplicates = sortedUnique(admitted.filter((id, index) => admitted.indexOf(id) !== index));
  const excludedByReason = Object.fromEntries(MCP_EXCLUSION_REASONS.map((reason) => [reason, Object.freeze(sortedUnique(excluded.filter((entry) => entry.reason === reason).map((entry) => entry.toolId)))])) as Record<McpExclusionReason, readonly string[]>;
  return Object.freeze({
    ok: missing.length === 0 && unexpected.length === 0 && outsideAgentSet.length === 0 && duplicates.length === 0,
    expected: Object.freeze(expected),
    actual: Object.freeze(actual),
    admitted: Object.freeze(admittedIds),
    missing: Object.freeze(missing),
    unexpected: Object.freeze(unexpected),
    outsideAgentSet: Object.freeze(outsideAgentSet),
    duplicates: Object.freeze(duplicates),
    excluded: Object.freeze(excluded),
    excludedByReason: Object.freeze(excludedByReason),
    count: actual.length,
  });
}
