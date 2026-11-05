/**
 * [PR-D] UI <-> AI COVERAGE MATRIX (assignment D.1 / D.2 / D.10) - GENERATED from
 * the registries as they are, never a hand-written table:
 *
 *   (a) every B01 action-registry record (`action-registry.ts`) with the routes
 *       API_ROUTE_COVERAGE assigns to it;
 *   (b) every classified UI control site of the B17 inventory (`control-surface.ts`
 *       scan classified by `control-registry.ts`): one row per (site, reached
 *       record), one row for a site that reaches no record;
 *   (c) every tool descriptor of the catalog (`tool-catalog.ts`),
 *
 * joined where the registries link them: `owningCommandId` / `binding.canonicalCommandId`
 * (tool -> record), a control rule's `recordIds` (control -> record), a route's
 * `recordId` (route -> record), the id convention `<x>-propose` / `<x>-apply`, a
 * record id named in another record's text fields, and an operation kind shared by two
 * records' `domainCommand`. Each row carries the assignment's columns (UI control/gesture
 * -> handler -> semantic command -> mutation authority -> validation -> revision/history
 * -> tool descriptor -> discovery requirements -> invocation path -> approval/grant ->
 * observable outcome -> tests) and exactly one DISPOSITION from the closed set
 * `PARITY_DISPOSITIONS`, DERIVED from
 *
 *   - permission-tiers.ts: `permissionTierOfAction` / `permissionTierOfDescriptor`, the
 *     Tier 3 floor, `decideAgentExecution` (proposal_only, pcb_editor, no explicit request)
 *     and `AUTONOMY_WRITE_ROLES`;
 *   - authorization.ts: the AI-delegation refusal, PROBED on `authorizeOperations` with the
 *     registry's own operation kinds (never copied into a table here);
 *   - agent-exposure.ts: `INTENTIONAL_AGENT_EXPOSED_TOOL_IDS`, `isAgentExposableDescriptor`,
 *     `AGENT_EXPOSABLE_OPERATION_CLASSES`;
 *   - granted-execution-families.ts: `GRANTED_EXECUTION_TOOLS`, `grantedExecutionViolations`,
 *     `NEVER_GRANTED_COMMAND_IDS`, `NEVER_EXPOSED_TOOL_PATTERNS`,
 *
 * never from a parallel permissive table. Every row's `reason` names the registry fact that
 * decided it; a `missing` row lists what is absent in `gaps` (no tool / no handler / no
 * validation / no test); `tests` is FILE PRESENCE (the directories of test files that
 * mention the id as a whole dotted token), never a declaration.
 *
 * Node-free and pure: the classified control sites and the test-evidence index are INPUTS;
 * `scripts/generate-pr-d-coverage-matrix.ts` assembles them from the filesystem, and the
 * gate `__tests__/pr-d-coverage-matrix.test.ts` regenerates in memory and byte-compares.
 */
import { ACTION_COVERAGE_REGISTRY, API_ROUTE_COVERAGE, type ActionCoverageRecord, type ApiRouteCoverageEntry } from "./action-registry";
import { AGENT_EXPOSABLE_OPERATION_CLASSES, INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, isAgentExposableDescriptor } from "./agent-exposure";
import { authorizeOperations } from "./authorization";
import type { ClassifiedControl } from "./control-registry";
import { EXECUTION_FAMILIES, TIER1_GRANTABLE_CAPABILITIES } from "./execution-grant";
import { GRANTED_EXECUTION_TOOLS, NEVER_EXPOSED_TOOL_PATTERNS, NEVER_GRANTED_COMMAND_IDS, grantedExecutionViolations } from "./granted-execution-families";
import { mcpExclusionReason } from "./mcp-exposure";
import { AUTONOMY_WRITE_ROLES, EXTERNAL_TRANSFER_SIDE_EFFECT, PERMISSION_TIER_TITLES, TIER3_FLOOR_PATTERN, decideAgentExecution, permissionTierOfAction, permissionTierOfDescriptor, type ExecutionDecision, type PermissionTier } from "./permission-tiers";
import { sirkitToolRegistry } from "./tool-catalog";
import type { ToolDescriptor, ToolRegistry } from "./tool-registry";
import type { EngineeringActor, EngineeringCapability, EngineeringOperation } from "./types";

// ─── The closed vocabulary ───────────────────────────────────────────────────

/** The nine dispositions of D.2, closed: the gate refuses any other value. */
export const PARITY_DISPOSITIONS = Object.freeze(["callable-now", "proposal-only", "grant-required", "human-admin-only", "view-session-only", "intentionally-ui-only", "unavailable", "legacy", "missing"] as const);
export type ParityDisposition = (typeof PARITY_DISPOSITIONS)[number];
export const PARITY_ROW_KINDS = Object.freeze(["action", "control", "tool"] as const);
export type ParityRowKind = (typeof PARITY_ROW_KINDS)[number];

export interface ParityRow {
  rowKind: ParityRowKind;
  /** action: the record id; control: `<site key>` or `<site key>-><record id>`; tool: `<toolId>@<version>`. */
  rowId: string;
  uiControl: string;
  uiGesture: string;
  uiSurface: string;
  uiClassification: string;
  uiRule: string;
  handler: string;
  semanticCommand: string;
  mutationAuthority: string;
  validation: string;
  revisionHistory: string;
  toolDescriptor: string;
  discoveryRequirements: string;
  invocationPath: string;
  approvalGrant: string;
  observableOutcome: string;
  /** Sorted repo-relative directories holding a test file that mentions the row's id ("" = none). */
  tests: string;
  disposition: ParityDisposition;
  reason: string;
  gaps: readonly string[];
}

/** The CSV column order (the assignment's arrow order, identity first, disposition last). */
export const PARITY_MATRIX_COLUMNS = Object.freeze([
  "row_kind", "row_id", "ui_control", "ui_gesture", "ui_surface", "ui_classification", "ui_rule", "handler", "semantic_command",
  "mutation_authority", "validation", "revision_history", "tool_descriptor", "discovery_requirements", "invocation_path",
  "approval_grant", "observable_outcome", "tests", "disposition", "reason", "gaps",
] as const);

// ─── Test evidence (file presence) ───────────────────────────────────────────

/** Where an id is mentioned by a test file, as the sorted repo-relative POSIX directories of those files ("" when none). */
export interface TestEvidenceIndex { directoriesMentioning(id: string): readonly string[] }

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const sortedUnique = (values: Iterable<string>): string[] => [...new Set(values)].sort(byCodePoint);
const DOTTED_TOKEN = /[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+/g;

/** Every >=2-segment dot-suffix of a dotted token, so `sirkit.pcb.move-footprint` also evidences `pcb.move-footprint`. */
function dottedSuffixes(token: string): string[] {
  const parts = token.split(".");
  const out: string[] = [];
  for (let i = 0; i + 1 < parts.length; i += 1) out.push(parts.slice(i).join("."));
  return out;
}

/** Index test files by the ids they mention as WHOLE dotted tokens (a mention inside a longer dotted id counts; `pcb.zone` inside
 *  `pcb.zone-edit` does not). Only `ids` are indexed, so the index stays small. */
export function buildTestEvidenceIndex(files: readonly { path: string; text: string }[], ids: Iterable<string>): TestEvidenceIndex {
  const wanted = new Set(ids);
  const dirs = new Map<string, Set<string>>();
  for (const file of files) {
    const dir = file.path.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
    for (const match of file.text.matchAll(DOTTED_TOKEN)) {
      for (const token of dottedSuffixes(match[0])) {
        if (!wanted.has(token)) continue;
        let set = dirs.get(token);
        if (!set) { set = new Set(); dirs.set(token, set); }
        set.add(dir);
      }
    }
  }
  return { directoriesMentioning: (id) => sortedUnique(dirs.get(id) ?? []) };
}

/** The ids the generator indexes: every record id and every tool id (the rows' identities). */
export function parityMatrixIds(registry: ToolRegistry = sirkitToolRegistry(), records: readonly ActionCoverageRecord[] = ACTION_COVERAGE_REGISTRY): string[] {
  return sortedUnique([...records.map((record) => record.id), ...registry.list().map((descriptor) => descriptor.toolId)]);
}

// ─── Derivations over the registries ─────────────────────────────────────────

export interface ParityMatrixInput {
  /** The B17 inventory: every scanned control site with its classification (control-registry.ts). */
  controls: readonly ClassifiedControl[];
  tests: TestEvidenceIndex;
  registry?: ToolRegistry;
  records?: readonly ActionCoverageRecord[];
  routes?: readonly ApiRouteCoverageEntry[];
}

/** The B01 exposure values that are a LIVE path for the chat assistant outside the tool registry (the chat router's structured
 *  routes, the AssistBox preview/apply route, the repair agent route, the chat run itself). `schema-only` is a declaration, not a
 *  path (D.2: no declaration-only "supported"); `none` is none. */
const CHAT_ROUTER_EXPOSURES: readonly ActionCoverageRecord["toolExposure"][] = Object.freeze(["chat", "structured-route", "preview-apply", "repair-agent"]);

/** An AI actor holding EVERY capability (project_admin): the only refusal `authorizeOperations` can answer it is the
 *  AI-delegation rule, so the probe isolates exactly that rule of authorization.ts. */
const PROBE_ACTOR: EngineeringActor = Object.freeze({ actorId: "pr-d-parity-probe", actorKind: "ai", sessionId: "pr-d-parity-probe", role: "project_admin" });
const OPERATION_KIND_TOKEN = /[a-z]+(?:_[a-z{},]+)+/g;

/** The operation kinds a record's `domainCommand` names (snake_case tokens; `schematic_{add,delete}_wire` keeps its braces so the
 *  probe sees the `schematic_` prefix the authorization rule keys on). */
function operationKindsOf(record: ActionCoverageRecord): string[] {
  return sortedUnique((record.domainCommand ?? "").match(OPERATION_KIND_TOKEN) ?? []);
}

/** authorization.ts, probed: the refusal an AI actor with every capability still receives for `kind`, or null. */
function aiRefusalFor(kind: string): { capability: EngineeringCapability; reason: string } | null {
  const verdict = authorizeOperations(PROBE_ACTOR, [{ kind } as unknown as EngineeringOperation]);
  return verdict.allowed || !verdict.capability ? null : { capability: verdict.capability, reason: verdict.reason };
}

interface ToolFacts {
  descriptor: ToolDescriptor;
  tier: PermissionTier;
  decision: ExecutionDecision;
  exposed: boolean;
  granted: boolean;
  grantViolations: string[];
  neverExposedPattern: string | null;
  bound: boolean;
  /** authorization.ts refuses the tool's required capability to AI actors (probed through the registry's operation kinds). */
  aiRefusal: string | null;
}

const recordText = (record: ActionCoverageRecord): string => [record.handler, record.domainCommand ?? "", record.mutationAuthority, record.validation, record.historyOrRevision, record.notes ?? ""].join(" ");

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const tierLabel = (tier: PermissionTier): string => `Tier ${tier} (${PERMISSION_TIER_TITLES[tier]})`;

/** The first top-level clause of a reason (cut at the first `;` outside parentheses): the deciding registry fact. */
function firstClause(reason: string): string {
  let depth = 0;
  for (let i = 0; i < reason.length; i += 1) {
    const ch = reason[i];
    if (ch === "(") depth += 1; else if (ch === ")") depth = Math.max(0, depth - 1); else if (ch === ";" && depth === 0) return reason.slice(0, i);
  }
  return reason;
}
const decide = (tier: PermissionTier): ExecutionDecision => decideAgentExecution({ tier, setting: null, actorRole: "pcb_editor", explicitUserRequest: false });

/** Which Tier 3 fact floors an id/record (the reason names the structure, never only the word). */
function tier3Fact(id: string, approvalTier: string, sideEffects: string | undefined, kindOrClass: string): string {
  const facts: string[] = [];
  if (TIER3_FLOOR_PATTERN.test(id)) facts.push(`id matches TIER3_FLOOR_PATTERN`);
  if (sideEffects === EXTERNAL_TRANSFER_SIDE_EFFECT) facts.push(`sideEffects external-transfer (OD-173)`);
  if (approvalTier === "release") facts.push(`approvalTier release`);
  if (kindOrClass === "release") facts.push(`class release`);
  return facts.join("; ");
}

/** The agent gateway's dispatch for a binding (gateway.ts `createAgentToolGateway`), named per binding status. */
function invocationPathOf(descriptor: ToolDescriptor, granted: boolean): string {
  const binding = descriptor.binding;
  const impl = binding.module ? `${binding.module}#${binding.symbol ?? "?"}` : "(no module)";
  switch (binding.status) {
    case "bound-read": return `assistant-agent: gateway -> ReadToolInvocationService over the run's sealed resource bundle (B05/B05.1; refuses authority_unavailable without a verified canonical state) -> ${impl}`;
    case "bound-proposal": return descriptor.category === "placement" || descriptor.category === "routing"
      ? `assistant-agent: gateway -> LayoutProposalService -> revision-bound layout candidate for the editor's own panel (human applies) -> ${impl}`
      : `assistant-agent: gateway -> ProposalInvocationService -> sealed proposal artifact -> the human review/apply boundary -> ${impl}`;
    case "bound-view-session": return `assistant-agent: gateway -> prepareViewCommandRequest -> view-command request the user's browser bus dispatches (${(descriptor.viewCommands ?? []).join(" ")}) -> ${impl}`;
    case "bound-mutation-editor-session": return granted
      ? `assistant-agent: gateway -> dispatchGrantedExecution -> server-minted one-shot grant (B18-B) -> the user's editor tenders it -> ${impl}`
      : `interactive-ui only: ${impl} inside the trusted editor session; the agent gateway refuses not_callable`;
    case "bound-external-read": return `assistant-agent: gateway -> ${descriptor.toolId.startsWith("sirkit.mcp.") ? "McpObservationReadService" : "ExternalReadInvocationService"} over the server-injected port -> ${impl}`;
    case "bound-computation": return `assistant-agent: gateway -> ComputationReadService over the injected computation port (bounded engine host) -> ${impl}`;
    case "test-double": return `test double: ${impl}`;
    case "unbound": return "none: no runtime implementation binding (a schema declaration is not an implementation)";
    default: return `unknown binding ${String(binding.status)}`;
  }
}

function observableOutcomeOf(descriptor: ToolDescriptor, granted: boolean): string {
  switch (descriptor.operationClass) {
    case "read": return `a read result pinned to the source revision; no state change (${descriptor.verificationStrategy})`;
    case "propose": return DURABLE_TASK_OUTCOME[descriptor.binding.module ?? ""] ? `${DURABLE_TASK_OUTCOME[descriptor.binding.module ?? ""]} (${descriptor.verificationStrategy})` : `an inert sealed proposal / revision-bound candidate; nothing changes until a human applies it (${descriptor.verificationStrategy})`; // [PR-L/M integration, 2026-10-18] L5-5: a propose tool that STARTS a durable task says so
    case "view-session": return `view-command dispatched; the browser bus settles it and reports the view revision; never engineering state (${descriptor.verificationStrategy})`;
    case "mutate": return granted
      ? `a one-shot grant: preview -> the human's Confirm (or the exact explicit request under execute_explicit_tier1) -> one canonical transaction, one history entry, a settled receipt (${descriptor.verificationStrategy})`
      : `one canonical transaction in the trusted editor session (UI only); never through the agent (${descriptor.verificationStrategy})`;
    default: return `never through the agent (${descriptor.operationClass}); ${descriptor.verificationStrategy}`;
  }
}

function discoveryRequirementsOf(facts: ToolFacts): string {
  const d = facts.descriptor;
  const parts = [
    `lifecycle=${d.lifecycle}`, `discovery=${d.discovery}`, `callability=${d.callability}`, `agentExposed=${d.agentExposed}`,
    `intentional=${INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.includes(d.toolId)}`, `roles=${[...d.requiredRoles].join("|")}`, `capability=${d.requiredCapability}${facts.granted ? " (grant-carried)" : ""}`,
    `projectState=${d.requiredProjectState.join("|") || "-"}`, `authority=${d.requiredAuthority.join("|")}`, `editor=${d.category}`,
    `selection=${d.requiredSelectionKinds.join("|") || "-"}`, `expectedRevision=${d.requiresExpectedRevision}`, `lineage=${d.requiresLineage}`,
    `flag=${d.featureFlag ?? "-"}`, `grantOnly=${d.grantOnly === true}`, `mcp=${mcpExclusionReason(d) ?? "exposed"}`, `budget=${d.budgetClass}/${d.timeoutMs}ms`,
  ];
  return parts.join("; ");
}

function toolFacts(descriptor: ToolDescriptor, refusedCapabilities: ReadonlyMap<EngineeringCapability, string>): ToolFacts {
  const tier = permissionTierOfDescriptor(descriptor);
  const grantViolations = grantedExecutionViolations(descriptor);
  const neverExposed = NEVER_EXPOSED_TOOL_PATTERNS.find((pattern) => pattern.test(descriptor.toolId)) ?? null;
  return {
    descriptor, tier, decision: decide(tier),
    exposed: descriptor.agentExposed,
    granted: descriptor.agentExposed && descriptor.executionMode === "granted" && grantViolations.length === 0,
    grantViolations,
    neverExposedPattern: neverExposed ? String(neverExposed) : null,
    bound: descriptor.binding.status !== "unbound" && descriptor.callability === "callable" && Boolean(descriptor.binding.module),
    aiRefusal: refusedCapabilities.get(descriptor.requiredCapability) ?? null,
  };
}

const toolTag = (facts: ToolFacts): string => `${facts.descriptor.toolId}@${facts.descriptor.version} [${facts.granted ? "granted" : facts.exposed ? `exposed ${facts.descriptor.operationClass}` : facts.bound ? `withheld ${facts.descriptor.operationClass}` : facts.descriptor.binding.status === "unbound" ? "unbound" : facts.descriptor.operationClass}]`;

/** The DISPOSITION of a tool descriptor row, first fact wins; every branch names the registry fact. */
function toolDisposition(facts: ToolFacts, tests: readonly string[]): Pick<ParityRow, "disposition" | "reason" | "gaps"> {
  const d = facts.descriptor;
  const gaps: string[] = [];
  const noTest = tests.length === 0;
  if (d.lifecycle === "deprecated" || d.lifecycle === "retired") return { disposition: "legacy", reason: `lifecycle ${d.lifecycle}${d.deprecation ? ` (${d.deprecation.reason})` : ""}: discovery excludes it (tool-discovery.ts "lifecycle")`, gaps };
  if (facts.tier === 3) return { disposition: "human-admin-only", reason: `permissionTierOfDescriptor = 3 (${tier3Fact(d.toolId, d.approvalTier, d.sideEffects, d.operationClass)}); decideAgentExecution: ${facts.decision.reason}`, gaps };
  if (d.operationClass === "destructive" || d.operationClass === "release") return { disposition: "human-admin-only", reason: `operation class ${d.operationClass} is outside AGENT_EXPOSABLE_OPERATION_CLASSES (${AGENT_EXPOSABLE_OPERATION_CLASSES.join(", ")}; mutate only as a reviewed granted execution): approval comes from the trusted interactive channel (${d.binding.notes ?? d.versionNotes})`, gaps };
  if (facts.aiRefusal) return { disposition: "human-admin-only", reason: `requiredCapability ${d.requiredCapability}: authorization.ts refuses it to AI actors ("${facts.aiRefusal}"); ${d.agentExposed ? "" : "agentExposed false; "}${d.binding.notes ?? d.versionNotes}`, gaps };
  if (facts.exposed) {
    if (noTest) gaps.push(`no test file mentions ${d.toolId}`);
    if (!INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.includes(d.toolId)) gaps.push(`agentExposed true but absent from INTENTIONAL_AGENT_EXPOSED_TOOL_IDS (agentExposureReport unexpected)`);
    if (!isAgentExposableDescriptor(d)) gaps.push(`agentExposed true but isAgentExposableDescriptor is false (${facts.grantViolations.join("; ")})`);
    if (facts.granted) return { disposition: "grant-required", reason: `reviewed granted execution (granted-execution-families.ts row ${GRANTED_EXECUTION_TOOLS.find((row) => row.toolId === d.toolId)?.family ?? "?"}: zero grantedExecutionViolations; ${tierLabel(facts.tier)}); decideAgentExecution: ${facts.decision.reason}`, gaps };
    if (d.operationClass === "propose") return { disposition: "proposal-only", reason: `agent-exposed propose class in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS; ${tierLabel(facts.tier)}; decideAgentExecution: ${facts.decision.reason}`, gaps };
    if (d.operationClass === "view-session") return { disposition: "view-session-only", reason: `agent-exposed view-session class in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS: a bus command the user's browser executes (sideEffects ${d.sideEffects}); ${tierLabel(facts.tier)}; decideAgentExecution: ${facts.decision.reason}`, gaps };
    if (d.operationClass === "read") return { disposition: "callable-now", reason: `agent-exposed read class in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, bound ${d.binding.status}; ${tierLabel(facts.tier)}; decideAgentExecution: ${facts.decision.reason}`, gaps };
    return { disposition: "unavailable", reason: `agent-exposed ${d.operationClass} that is not a granted execution: ${facts.grantViolations.join("; ")} (the gateway refuses not_callable)`, gaps };
  }
  // Not exposed.
  if (!facts.bound) {
    gaps.push(`no handler: binding ${d.binding.status}, callability ${d.callability}${d.binding.notes ? ` (${d.binding.notes})` : ""}`);
    if (!d.validationStrategy.trim() || /^n\/a/i.test(d.validationStrategy)) gaps.push("no validation strategy (n/a)");
    if (noTest) gaps.push(`no test file mentions ${d.toolId}`);
    return { disposition: "missing", reason: `registered without a callable implementation binding (inspectBinding -> not_callable); ${tierLabel(facts.tier)}; the record's own path is the human UI/route`, gaps };
  }
  const withheld: string[] = [];
  if (d.discovery === "internal-only") withheld.push("discovery internal-only (excluded from every channel)");
  if (facts.neverExposedPattern) withheld.push(`matches NEVER_EXPOSED_TOOL_PATTERNS ${facts.neverExposedPattern}`);
  if (d.binding.canonicalCommandId && NEVER_GRANTED_COMMAND_IDS.includes(d.binding.canonicalCommandId)) withheld.push(`canonical command ${d.binding.canonicalCommandId} is in NEVER_GRANTED_COMMAND_IDS`);
  if (!INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.includes(d.toolId)) withheld.push("not in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS");
  if (d.operationClass === "mutate") withheld.push(`not a granted execution: ${facts.grantViolations[0] ?? "no reviewed row"}`);
  return { disposition: "unavailable", reason: `bound and callable for the trusted editor session / server, withheld from the agent: ${withheld.join("; ")}; ${tierLabel(facts.tier)}${d.binding.notes ? `; ${d.binding.notes}` : ""}`, gaps };
}

interface RecordGraph {
  byId: ReadonlyMap<string, ActionCoverageRecord>;
  toolsOf: (id: string) => ToolFacts[];
  controlsOf: (id: string) => ClassifiedControl[];
  routesOf: (id: string) => ApiRouteCoverageEntry[];
  /** Undirected links: id convention, text mention, shared domainCommand operation kind. */
  linksOf: (id: string) => string[];
}

/** The AI's proposal paths for a mutation record: exposed propose tools owned by the record or by a record within two links of
 *  it, and linked propose records the chat router reaches (B01 toolExposure). */
function proposalPathsOf(record: ActionCoverageRecord, graph: RecordGraph): string[] {
  const paths = new Set<string>();
  const seen = new Set<string>([record.id]);
  let frontier = [record.id];
  for (let depth = 0; depth <= 2; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      const current = graph.byId.get(id);
      if (!current) continue;
      for (const tool of graph.toolsOf(id)) if (tool.exposed && tool.descriptor.operationClass === "propose") paths.add(`${tool.descriptor.toolId} (owned by ${id})`);
      if (id !== record.id && current.kind === "propose" && CHAT_ROUTER_EXPOSURES.includes(current.toolExposure)) paths.add(`chat router -> ${id} (toolExposure ${current.toolExposure})`);
      if (depth < 2) for (const linked of graph.linksOf(id)) if (!seen.has(linked)) { seen.add(linked); next.push(linked); }
    }
    frontier = next;
  }
  return sortedUnique(paths);
}

/** The DISPOSITION of an action record (first fact wins; see the module header for the sources). */
function actionDisposition(record: ActionCoverageRecord, graph: RecordGraph, tests: readonly string[]): Pick<ParityRow, "disposition" | "reason" | "gaps"> & { tier: PermissionTier; decision: ExecutionDecision; aiPaths: string[] } {
  const tier = permissionTierOfAction(record);
  const decision = decide(tier);
  const tools = graph.toolsOf(record.id);
  const controls = graph.controlsOf(record.id);
  const routes = graph.routesOf(record.id);
  const granted = tools.filter((tool) => tool.granted);
  const exposedReads = tools.filter((tool) => tool.exposed && tool.descriptor.operationClass === "read");
  const exposedViews = tools.filter((tool) => tool.exposed && tool.descriptor.operationClass === "view-session");
  const proposals = proposalPathsOf(record, graph);
  const router = CHAT_ROUTER_EXPOSURES.includes(record.toolExposure) ? `chat router (B01 toolExposure ${record.toolExposure})` : null;
  const refusals = sortedUnique(operationKindsOf(record).map((kind) => { const refusal = aiRefusalFor(kind); return refusal ? `${kind} -> ${refusal.capability}` : ""; }).filter(Boolean));
  const refusalReason = refusals.length > 0 ? aiRefusalFor(operationKindsOf(record).find((kind) => aiRefusalFor(kind))!)!.reason : "";
  const neverGranted = NEVER_GRANTED_COMMAND_IDS.includes(record.id);
  const gaps: string[] = [];
  const noTest = tests.length === 0;
  const aiPaths = sortedUnique([...granted.map((tool) => `${tool.descriptor.toolId} (granted execution)`), ...exposedReads.map((tool) => `${tool.descriptor.toolId} (read)`), ...exposedViews.map((tool) => `${tool.descriptor.toolId} (view-session)`), ...proposals, ...(router ? [router] : [])]);
  const withTestGap = (result: Pick<ParityRow, "disposition" | "reason">): ReturnType<typeof actionDisposition> => {
    if (noTest && result.disposition !== "intentionally-ui-only" && result.disposition !== "legacy") gaps.push(`no test file mentions ${record.id}`);
    return { ...result, gaps, tier, decision, aiPaths };
  };
  const decisionText = `${tierLabel(tier)}; decideAgentExecution: ${decision.reason}`;

  if (record.status === "legacy") return withTestGap({ disposition: "legacy", reason: `registry status legacy${record.notes ? ` (${record.notes})` : ""}` });
  if (tier === 3) {
    if (record.status === "missing") gaps.push(`status missing: ${record.handler}`);
    return withTestGap({ disposition: "human-admin-only", reason: `permissionTierOfAction = 3 (${tier3Fact(record.id, record.approvalTier, record.sideEffects, record.kind)}); decideAgentExecution: ${decision.reason}${record.notes ? `; ${record.notes}` : ""}` });
  }
  if (record.status === "missing" || record.status === "partial") {
    gaps.push(`status ${record.status}: ${record.status === "missing" ? record.handler : (record.notes ?? record.handler)}`);
    if (tools.length === 0) gaps.push("no tool descriptor"); else for (const tool of tools) if (!tool.bound) gaps.push(`${tool.descriptor.toolId}: no handler (binding ${tool.descriptor.binding.status})`);
    if (routes.length === 0 && controls.length === 0) gaps.push("no route and no control");
    return withTestGap({ disposition: "missing", reason: `registry status ${record.status}: the operation is not (fully) implemented; ${decisionText}` });
  }
  if (record.area === "view") return withTestGap({ disposition: "view-session-only", reason: `view record: permissionTierOfAction -> Tier 0 (view-session bus state, never engineering state); tools: ${sortedUnique(tools.map((tool) => toolTag(tool))).join(", ") || "none"}; ${decisionText}` });

  if (record.kind === "read") {
    if (exposedReads.length > 0) return withTestGap({ disposition: "callable-now", reason: `agent-exposed read tool(s) ${exposedReads.map((tool) => tool.descriptor.toolId).join(", ")} (INTENTIONAL_AGENT_EXPOSED_TOOL_IDS); ${decisionText}` });
    if (router) return withTestGap({ disposition: "callable-now", reason: `${router}: the assistant reaches the route(s) ${routes.map((route) => route.path).join(", ") || "(none)"} outside the tool registry; catalog descriptor(s): ${tools.map((tool) => toolTag(tool)).join(", ") || "none"}; ${decisionText}` });
    if (record.status === "api-only" || (controls.length === 0 && routes.length > 0)) return withTestGap({ disposition: "unavailable", reason: `route-only read (${routes.map((route) => `${route.methods.join("|")} ${route.path}`).join(", ")}): no UI control and no tool descriptor; status ${record.status}${record.notes ? `; ${record.notes}` : ""}` });
    if (record.domainCommand === null) return withTestGap({ disposition: "intentionally-ui-only", reason: `domainCommand null: no semantic command is registered for this read (${record.handler}); the UI's own artifact export / local read; ${tools.length > 0 ? `catalog descriptor(s) ${tools.map((tool) => toolTag(tool)).join(", ")}` : "no tool descriptor"}` });
    gaps.push("no agent-exposed read tool for a Tier 0 read with a domain command");
    if (tools.length === 0) gaps.push("no tool descriptor");
    return withTestGap({ disposition: "missing", reason: `read with a domain command (${record.domainCommand}) and no AI path: toolExposure ${record.toolExposure}, tools ${tools.map((tool) => toolTag(tool)).join(", ") || "none"}; ${decisionText}` });
  }

  if (record.kind === "propose") {
    if (proposals.length > 0 || router) return withTestGap({ disposition: "proposal-only", reason: `propose record reached through ${aiPaths.join(", ")}; ${decisionText}` });
    if (record.status === "api-only") return withTestGap({ disposition: "unavailable", reason: `api-only propose route (${routes.map((route) => route.path).join(", ")}) with no tool descriptor and no control: ${record.notes ?? record.handler}` });
    gaps.push("no agent-exposed propose tool and no chat-router exposure");
    if (tools.length === 0) gaps.push("no tool descriptor");
    return withTestGap({ disposition: "missing", reason: `propose record without an AI path (toolExposure ${record.toolExposure}); ${decisionText}` });
  }

  // mutate / destructive
  if (granted.length > 0) return withTestGap({ disposition: "grant-required", reason: `reviewed granted execution(s) ${granted.map((tool) => tool.descriptor.toolId).join(", ")} (GRANTED_EXECUTION_TOOLS; zero grantedExecutionViolations); ${decisionText}` });
  if (record.sources.some((source) => /^app\/lib\/execution-grant\//.test(source))) return withTestGap({ disposition: "grant-required", reason: `the B18-B grant mechanism itself (sources under app/lib/execution-grant/): every granted execution is minted by the chat route, tendered by the human's editor and settled through it; ${decisionText}` });
  if (refusals.length > 0 && proposals.length === 0 && !router) return withTestGap({ disposition: "human-admin-only", reason: `authorization.ts refuses the AI actor: ${refusals.join(", ")} ("${refusalReason}")${neverGranted ? "; NEVER_GRANTED_COMMAND_IDS names the command" : ""}${EXECUTION_FAMILIES.includes(record.id as (typeof EXECUTION_FAMILIES)[number]) ? `; EXECUTION_FAMILIES names it but no reviewed granted-execution row exists and TIER1_GRANTABLE_CAPABILITIES is [${TIER1_GRANTABLE_CAPABILITIES.join(", ")}]` : ""}; ${decisionText}` });
  if (record.kind === "destructive" && proposals.length === 0 && !router) return withTestGap({ disposition: "human-admin-only", reason: `destructive kind is outside AGENT_EXPOSABLE_OPERATION_CLASSES (${AGENT_EXPOSABLE_OPERATION_CLASSES.join(", ")}) and never a granted execution; approval comes from the trusted interactive channel (${record.handler}); ${decisionText}` });
  if (proposals.length > 0 || router) return withTestGap({ disposition: "proposal-only", reason: `${record.kind} record whose AI path is a sealed proposal (agent-exposure.ts INTENTIONAL_AGENT_EXPOSED_TOOL_IDS / B01 toolExposure): ${aiPaths.join(", ")}${neverGranted ? "; NEVER_GRANTED_COMMAND_IDS names the command (never a grant)" : ""}${tier === 1 ? "; Tier 1 without a reviewed granted-execution row: the proposal/route path is the only one" : ""}; ${decisionText}` });
  if (record.domainCommand === null) {
    if (record.sources.some((source) => /^app\/lib\/agent\/autonomy-/.test(source))) return withTestGap({ disposition: "human-admin-only", reason: `the agent autonomy setting: AUTONOMY_WRITE_ROLES = [${AUTONOMY_WRITE_ROLES.join(", ")}] (permission-tiers.ts canChangeAutonomy); ${record.notes ?? record.handler}` });
    if (record.sources.some((source) => /^app\/(api|lib)\/auth\//.test(source))) return withTestGap({ disposition: "human-admin-only", reason: `the authentication boundary (sources under app/api/auth/, app/lib/auth/): credential and session management is never exposed to the assistant (D.7); ${record.handler}` });
    if (record.status === "api-only" || (controls.length === 0 && routes.length > 0)) return withTestGap({ disposition: "unavailable", reason: `route-only (${routes.map((route) => route.path).join(", ")}): no UI control and no tool descriptor; status ${record.status}${record.notes ? `; ${record.notes}` : ""}` });
    return withTestGap({ disposition: "intentionally-ui-only", reason: `domainCommand null: no semantic command is registered; browser/session/working-copy plumbing (${record.handler}); mutationAuthority: ${record.mutationAuthority}` });
  }
  gaps.push(`no AI path for a ${tierLabel(tier)} ${record.kind}: toolExposure ${record.toolExposure}`);
  if (tools.length === 0) gaps.push("no tool descriptor");
  else for (const tool of tools) gaps.push(tool.bound ? `${tool.descriptor.toolId} is ${tool.exposed ? "exposed but not a path for this mutation" : "withheld from the agent"}` : `${tool.descriptor.toolId}: no handler (binding ${tool.descriptor.binding.status})`);
  if (neverGranted) gaps.push("NEVER_GRANTED_COMMAND_IDS forbids a grant; a Tier 2 path would be a sealed proposal, and none covers it");
  if (tier === 1) gaps.push(`Tier 1 reversible: ${EXECUTION_FAMILIES.includes(record.id as (typeof EXECUTION_FAMILIES)[number]) ? "EXECUTION_FAMILIES names it but no reviewed granted-execution row exists" : "not an EXECUTION_FAMILIES member; no reviewed granted-execution row"}`);
  const unavailableTools = tools.filter((tool) => tool.bound && !tool.exposed);
  if (unavailableTools.length > 0 && tools.every((tool) => tool.bound)) return withTestGap({ disposition: "unavailable", reason: `tool(s) ${unavailableTools.map((tool) => tool.descriptor.toolId).join(", ")} are bound and callable for the trusted editor session but withheld from the agent (${unavailableTools.map((tool) => tool.neverExposedPattern ? `NEVER_EXPOSED_TOOL_PATTERNS ${tool.neverExposedPattern}` : "not in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS").join("; ")})${neverGranted ? "; NEVER_GRANTED_COMMAND_IDS names the command" : ""}; ${decisionText}` });
  return withTestGap({ disposition: "missing", reason: `${record.kind} with a domain command (${record.domainCommand}) and no AI path (toolExposure ${record.toolExposure}, no agent-exposed tool in INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, no linked proposal); ${decisionText}` });
}

// ─── The matrix ──────────────────────────────────────────────────────────────

export function buildParityMatrix(input: ParityMatrixInput): ParityRow[] {
  const registry = input.registry ?? sirkitToolRegistry();
  const records = input.records ?? ACTION_COVERAGE_REGISTRY;
  const routes = input.routes ?? API_ROUTE_COVERAGE;
  const byId = new Map(records.map((record) => [record.id, record] as const));

  // authorization.ts, probed with the registry's own operation vocabulary: the capabilities an AI actor is refused.
  const refusedCapabilities = new Map<EngineeringCapability, string>();
  for (const record of records) for (const kind of operationKindsOf(record)) { const refusal = aiRefusalFor(kind); if (refusal && !refusedCapabilities.has(refusal.capability)) refusedCapabilities.set(refusal.capability, refusal.reason); }

  const facts = registry.list().map((descriptor) => toolFacts(descriptor, refusedCapabilities));
  const toolsByRecord = new Map<string, ToolFacts[]>();
  for (const fact of facts) {
    for (const id of sortedUnique([fact.descriptor.owningCommandId, fact.descriptor.binding.canonicalCommandId ?? fact.descriptor.owningCommandId])) {
      const list = toolsByRecord.get(id) ?? [];
      if (!list.includes(fact)) list.push(fact);
      toolsByRecord.set(id, list);
    }
  }
  const controlsByRecord = new Map<string, ClassifiedControl[]>();
  for (const control of input.controls) for (const id of control.recordIds) controlsByRecord.set(id, [...(controlsByRecord.get(id) ?? []), control]);
  const routesByRecord = new Map<string, ApiRouteCoverageEntry[]>();
  for (const route of routes) routesByRecord.set(route.recordId, [...(routesByRecord.get(route.recordId) ?? []), route]);

  // Undirected record links: id convention, text mention, shared domainCommand operation kind.
  const links = new Map<string, Set<string>>();
  const link = (a: string, b: string): void => { if (a === b || !byId.has(a) || !byId.has(b)) return; links.set(a, (links.get(a) ?? new Set()).add(b)); links.set(b, (links.get(b) ?? new Set()).add(a)); };
  const kindOwners = new Map<string, string[]>();
  for (const record of records) {
    const base = record.id.replace(/-(propose|apply)$/, "");
    for (const candidate of [base, `${base}-propose`, `${base}-apply`]) link(record.id, candidate);
    for (const match of recordText(record).matchAll(DOTTED_TOKEN)) for (const token of dottedSuffixes(match[0])) if (byId.has(token)) link(record.id, token);
    for (const kind of operationKindsOf(record)) kindOwners.set(kind, [...(kindOwners.get(kind) ?? []), record.id]);
  }
  for (const owners of kindOwners.values()) for (const a of owners) for (const b of owners) link(a, b);

  const graph: RecordGraph = {
    byId,
    toolsOf: (id) => [...(toolsByRecord.get(id) ?? [])].sort((a, b) => byCodePoint(a.descriptor.toolId, b.descriptor.toolId) || byCodePoint(a.descriptor.version, b.descriptor.version)),
    controlsOf: (id) => [...(controlsByRecord.get(id) ?? [])].sort((a, b) => byCodePoint(a.key, b.key)),
    routesOf: (id) => [...(routesByRecord.get(id) ?? [])].sort((a, b) => byCodePoint(a.path, b.path)),
    linksOf: (id) => sortedUnique(links.get(id) ?? []),
  };

  const rows: ParityRow[] = [];
  const actionRows = new Map<string, ParityRow>();

  // (a) action records
  for (const record of records) {
    const tests = input.tests.directoriesMentioning(record.id);
    const tools = graph.toolsOf(record.id);
    const controls = graph.controlsOf(record.id);
    const recordRoutes = graph.routesOf(record.id);
    const verdict = actionDisposition(record, graph, tests);
    const row: ParityRow = {
      rowKind: "action",
      rowId: record.id,
      uiControl: controls.length === 0 ? "(no control)" : `${controls.length} control(s): ${sortedUnique(controls.map((control) => control.ruleId)).join("; ")}`,
      uiGesture: sortedUnique(controls.map((control) => control.kind)).join(";"),
      uiSurface: sortedUnique(controls.map((control) => control.surface)).join(";"),
      uiClassification: sortedUnique(controls.map((control) => control.classification)).join(";"),
      uiRule: sortedUnique(controls.map((control) => control.ruleId)).join(";"),
      handler: record.handler,
      semanticCommand: `${record.id}: ${record.domainCommand ?? "(no domain command)"}`,
      mutationAuthority: record.mutationAuthority,
      validation: record.validation,
      revisionHistory: record.historyOrRevision,
      toolDescriptor: tools.map((tool) => toolTag(tool)).join("; ") || "(none)",
      discoveryRequirements: `${tierLabel(verdict.tier)}; decision=${verdict.decision.decision}; requiresGrant=${verdict.decision.requiresGrant}; requiresHumanApproval=${verdict.decision.requiresHumanApproval}; AI path: ${verdict.aiPaths.join(", ") || "none"}; status=${record.status}; kind=${record.kind}; toolExposure=${record.toolExposure}; approvalTier=${record.approvalTier}${record.sideEffects ? `; sideEffects=${record.sideEffects}` : ""}`,
      invocationPath: [recordRoutes.length > 0 ? `routes: ${recordRoutes.map((route) => `${[...route.methods].sort(byCodePoint).join("|")} ${route.path}`).join(", ")}` : "routes: none", `handler: ${record.handler}`].join("; "),
      approvalGrant: `approvalTier=${record.approvalTier}; ${tierLabel(verdict.tier)}; decision=${verdict.decision.decision}`,
      observableOutcome: `${record.action} - ${record.kind === "read" ? "a report or derived result, no state change" : record.kind === "propose" ? "an inert proposal awaiting explicit human approval" : record.kind === "destructive" ? "an irreversible or deleting change behind explicit approval" : "a committed change recorded in history"}`,
      tests: tests.join(";"),
      disposition: verdict.disposition,
      reason: verdict.reason,
      gaps: verdict.gaps,
    };
    rows.push(row);
    actionRows.set(record.id, row);
  }

  // (b) control sites: one row per (site, reached record); a recordless site is one row.
  for (const control of input.controls) {
    const base = {
      rowKind: "control" as const,
      uiControl: `${control.element} "${control.label}" (${control.handler})`,
      uiGesture: control.kind,
      uiSurface: control.surface,
      uiClassification: control.classification,
      uiRule: control.ruleId,
    };
    if (control.recordIds.length === 0) {
      const disposition: ParityDisposition = control.classification === "unavailable" ? "unavailable" : "intentionally-ui-only";
      const reason = control.classification === "unavailable"
        ? `B17 control classification unavailable with the visible reason: ${control.reason}`
        : control.classification === "internal"
          ? `B17 control classification internal (non-callable plumbing): ${control.note || control.ruleId}`
          : `B17 control classification ${control.classification} with no registry record: presentation-only chrome, tool mode, tab or form draft (D.2: a local widget needs no provider tool); ${control.note || control.ruleId}`;
      rows.push({
        ...base, rowId: control.key,
        handler: control.handler, semanticCommand: "(none)", mutationAuthority: "none (view/internal state)", validation: "none (no engineering state)", revisionHistory: "none",
        toolDescriptor: "(none)", discoveryRequirements: "not an agent operation", invocationPath: `browser only: ${control.surface}`, approvalGrant: "none", observableOutcome: "a presentation change in the user's browser",
        tests: "", disposition, reason, gaps: control.classification === "unavailable" && !control.reason ? ["unavailable control without a visible reason"] : [],
      });
      continue;
    }
    for (const recordId of sortedUnique(control.recordIds)) {
      const action = actionRows.get(recordId);
      const record = byId.get(recordId);
      if (!action || !record) {
        rows.push({ ...base, rowId: `${control.key}->${recordId}`, handler: control.handler, semanticCommand: `${recordId}: (unknown record)`, mutationAuthority: "", validation: "", revisionHistory: "", toolDescriptor: "", discoveryRequirements: "", invocationPath: `browser: ${control.surface}`, approvalGrant: "", observableOutcome: "", tests: "", disposition: "missing", reason: `control rule ${control.ruleId} names a record id that is not in the action registry`, gaps: [`unknown record ${recordId}`] });
        continue;
      }
      // The long descriptive columns point at the action row (one copy per record, not one per control); the join columns,
      // the disposition, the deciding fact (the action reason's first top-level clause) and the gaps are carried so a control
      // row stands on its own.
      const asAction = `as action row ${recordId}`;
      rows.push({
        ...base, rowId: `${control.key}->${recordId}`,
        handler: `${control.handler} -> ${record.handler}`,
        semanticCommand: action.semanticCommand, mutationAuthority: asAction, validation: asAction, revisionHistory: asAction,
        toolDescriptor: action.toolDescriptor, discoveryRequirements: asAction,
        invocationPath: `UI: ${control.kind} on ${control.surface} -> ${control.handler}; ${action.invocationPath}`,
        approvalGrant: action.approvalGrant, observableOutcome: asAction, tests: action.tests,
        disposition: action.disposition,
        reason: `${control.classification} control (rule ${control.ruleId}) reaches ${recordId}: ${firstClause(action.reason)} - ${asAction}${control.note ? `; ${control.note}` : ""}`, // [PR-L/M integration, 2026-10-18] L5-5: + the control rule's own note, so a row says what THIS control does (the chat's Stop answer vs the task card's Stop design, runbook L.5)
        gaps: action.gaps,
      });
    }
  }

  // (c) tool descriptors
  for (const fact of facts) {
    const d = fact.descriptor;
    const tests = input.tests.directoriesMentioning(d.toolId);
    const owner = byId.get(d.owningCommandId);
    const controls = graph.controlsOf(d.owningCommandId);
    const verdict = toolDisposition(fact, tests);
    const grantRow = GRANTED_EXECUTION_TOOLS.find((row) => row.toolId === d.toolId);
    rows.push({
      rowKind: "tool",
      rowId: `${d.toolId}@${d.version}`,
      uiControl: controls.length === 0 ? `(no control reaches ${d.owningCommandId})` : `${controls.length} control(s) reach ${d.owningCommandId}: ${sortedUnique(controls.map((control) => control.ruleId)).join("; ")}`,
      uiGesture: sortedUnique(controls.map((control) => control.kind)).join(";"),
      uiSurface: sortedUnique(controls.map((control) => control.surface)).join(";"),
      uiClassification: sortedUnique(controls.map((control) => control.classification)).join(";"),
      uiRule: sortedUnique(controls.map((control) => control.ruleId)).join(";"),
      handler: d.binding.module ? `${d.binding.module}#${d.binding.symbol ?? "?"} (${d.binding.status})` : `(none: ${d.binding.status})`,
      semanticCommand: `${d.owningCommandId}${d.binding.canonicalCommandId ? ` (canonical ${d.binding.canonicalCommandId})` : ""}: ${owner?.domainCommand ?? "(no domain command)"}`,
      mutationAuthority: d.operationClass === "mutate" || d.operationClass === "destructive" || d.operationClass === "release" ? `${d.sideEffects}: ${owner?.mutationAuthority ?? ""}` : `${d.sideEffects} (${d.operationClass})`,
      validation: d.validationStrategy,
      revisionHistory: `expectedRevision=${d.requiresExpectedRevision}; lineage=${d.requiresLineage}; idempotency=${d.idempotency}; audit=${d.audit}${owner ? `; record: ${owner.historyOrRevision}` : ""}`,
      toolDescriptor: `${toolTag(fact)} ${d.title}`,
      discoveryRequirements: discoveryRequirementsOf(fact),
      invocationPath: invocationPathOf(d, fact.granted),
      approvalGrant: `approvalTier=${d.approvalTier}; ${tierLabel(fact.tier)}; decision=${fact.decision.decision}; requiresGrant=${fact.decision.requiresGrant}; requiresHumanApproval=${fact.decision.requiresHumanApproval}${grantRow ? `; granted family ${grantRow.family}` : ""}${fact.grantViolations.length > 0 && d.operationClass === "mutate" ? `; not grantable: ${fact.grantViolations[0]}` : ""}`,
      observableOutcome: observableOutcomeOf(d, fact.granted),
      tests: tests.join(";"),
      disposition: verdict.disposition,
      reason: verdict.reason,
      gaps: verdict.gaps,
    });
  }

  const kindRank: Record<ParityRowKind, number> = { action: 0, control: 1, tool: 2 };
  return rows.sort((a, b) => kindRank[a.rowKind] - kindRank[b.rowKind] || byCodePoint(a.rowId, b.rowId));
}

// ─── Renderings (deterministic, LF, no timestamps) ───────────────────────────

export function renderParityMatrixCsv(rows: readonly ParityRow[]): string {
  const body = rows.map((row) => [
    row.rowKind, row.rowId, row.uiControl, row.uiGesture, row.uiSurface, row.uiClassification, row.uiRule, row.handler, row.semanticCommand,
    row.mutationAuthority, row.validation, row.revisionHistory, row.toolDescriptor, row.discoveryRequirements, row.invocationPath,
    row.approvalGrant, row.observableOutcome, row.tests, row.disposition, row.reason, row.gaps.join(" | "),
  ]);
  return [[...PARITY_MATRIX_COLUMNS], ...body].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export interface ParityMatrixSummary {
  schemaVersion: "sirkit.ui-agent-command-coverage-summary.v1";
  dispositions: readonly ParityDisposition[];
  rows: number;
  byKind: Record<ParityRowKind, number>;
  byDisposition: Record<ParityDisposition, number>;
  byKindAndDisposition: Record<ParityRowKind, Record<ParityDisposition, number>>;
  /** Rows without a disposition in the closed set or without a reason: the gate requires 0. */
  unexplained: number;
  missing: { rows: number; withoutGap: number; gaps: number };
  rowsWithoutTest: Record<ParityRowKind, number>;
  actions: { records: number; rows: number };
  controls: { sites: number; rows: number; surfaces: number; recordsReached: number };
  tools: { descriptors: number; rows: number; agentExposed: number; grantedExecutions: number };
}

export function summarizeParityMatrix(rows: readonly ParityRow[], input: Pick<ParityMatrixInput, "controls">): ParityMatrixSummary {
  const zero = (): Record<ParityDisposition, number> => Object.fromEntries(PARITY_DISPOSITIONS.map((disposition) => [disposition, 0])) as Record<ParityDisposition, number>;
  const byDisposition = zero();
  const byKind: Record<ParityRowKind, number> = { action: 0, control: 0, tool: 0 };
  const byKindAndDisposition: Record<ParityRowKind, Record<ParityDisposition, number>> = { action: zero(), control: zero(), tool: zero() };
  const rowsWithoutTest: Record<ParityRowKind, number> = { action: 0, control: 0, tool: 0 };
  let unexplained = 0, missingRows = 0, missingWithoutGap = 0, missingGaps = 0;
  const toolRows = rows.filter((row) => row.rowKind === "tool");
  for (const row of rows) {
    byKind[row.rowKind] += 1;
    if (!(PARITY_DISPOSITIONS as readonly string[]).includes(row.disposition) || !row.reason.trim()) { unexplained += 1; continue; }
    byDisposition[row.disposition] += 1;
    byKindAndDisposition[row.rowKind][row.disposition] += 1;
    if (!row.tests) rowsWithoutTest[row.rowKind] += 1;
    if (row.disposition === "missing") { missingRows += 1; missingGaps += row.gaps.length; if (row.gaps.length === 0) missingWithoutGap += 1; }
  }
  return {
    schemaVersion: "sirkit.ui-agent-command-coverage-summary.v1",
    dispositions: [...PARITY_DISPOSITIONS],
    rows: rows.length,
    byKind,
    byDisposition,
    byKindAndDisposition,
    unexplained,
    missing: { rows: missingRows, withoutGap: missingWithoutGap, gaps: missingGaps },
    rowsWithoutTest,
    actions: { records: ACTION_COVERAGE_REGISTRY.length, rows: byKind.action },
    controls: { sites: input.controls.length, rows: byKind.control, surfaces: new Set(input.controls.map((control) => control.surface)).size, recordsReached: new Set(input.controls.flatMap((control) => control.recordIds)).size },
    tools: { descriptors: toolRows.length, rows: byKind.tool, agentExposed: toolRows.filter((row) => /\[(exposed|granted)/.test(row.toolDescriptor)).length, grantedExecutions: toolRows.filter((row) => row.toolDescriptor.includes("[granted]")).length },
  };
}

export function renderParityMatrixSummary(summary: ParityMatrixSummary): string {
  return JSON.stringify(summary, null, 2) + "\n";
}

// [PR-L/M integration, 2026-10-18] L5-5 (runbook L.5 / L.7 item 8: the matrix matches executable behaviour): the propose tools whose call
// STARTS (or attaches) a durable task a worker then runs with no human step, keyed by their bound service; the generic propose sentence
// ("an inert sealed proposal") is untrue for them. Appended after the last line (read only when a matrix is built): no line here moves.
const DURABLE_TASK_OUTCOME: Readonly<Record<string, string>> = Object.freeze({
  "app/lib/generation-task/service.ts": "starts (or attaches) the project's DURABLE generation task: a generation worker runs it in saved steps and spends provider allowance with no human step; Stop answer ends only the chat turn, Stop design cancels the task; nothing is applied to the schematic until a human approves its result in the review dialog",
  "app/lib/component-resolution/task/service.ts": "starts (or attaches) the project's DURABLE CAD acquisition task: a worker retrieves, stores and validates the part's KiCad assets from an admitted source with no human step; nothing in the design changes - a person sends the package for review, two people publish it and a human applies the offered replacement",
});
