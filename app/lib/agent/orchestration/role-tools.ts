/**
 * [B21 C] The reviewed per-role tool allowlist (OD-120): which of the one reviewed exposure list's ids each of the nine
 * roles may ever be offered, as DATA with a reason per id, and the report that judges any table against a registry the
 * caller hands in. A role row is a CEILING, never a set of tools a run is offered as such: a specialist is offered its row
 * intersected with the reads its derived context admits (buildRunToolset narrows after every existing gate, OD-121), so an
 * id can sit in a row and stay DORMANT for a run - [B21 D2] a long-running or pin-facts proposal, an external read while OD-109
 * keeps the ports from every specialist, the history read while a specialist holds no captured view (the live proposals: below).
 *
 * The coordinator's row IS the exposure list itself (the same frozen array, never a copy): the existing single-agent set,
 * unchanged. It is never handed to buildRunToolset as an allowlist (33 ids, over the A4L bound of 32): the coordinator's run
 * carries none. Every specialist row is sorted, duplicate-free, within the bound, and holds no mutation, no view-session
 * control, no never-exposed or Tier 3 id, and a proposal only in a proposing role's row; the cost/latency policy role holds
 * no tool at all. Nothing here reads a registry at load, names a module that changes project state, or holds authority.
 */
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS } from "../../engineering/agent-exposure";
import { TIER3_FAMILY_PATTERN } from "../../engineering/permission-tiers";
import type { ToolDescriptor } from "../../engineering/tool-registry";
import { ORCHESTRATION_BOUNDS, SPECIALIST_ROLES, type SpecialistRole } from "./contracts";

/** The A4L bound on a specialist row: the contracts' bound on a request's `allowedToolIds`. */
export const MAX_ROLE_TOOL_IDS = ORCHESTRATION_BOUNDS.maxAllowedToolIds;
/** The roles the discovery names as proposing (OD-120): the coordinator and the three roles whose rows hold a sealed proposal. */
export const PROPOSING_ROLES: readonly SpecialistRole[] = Object.freeze(["coordinator", "circuit-topology", "schematic", "pcb-placement-routing"]);
/** The runbook line of each role (B21-C, runbook :819-:827). */
export const ROLE_RUNBOOK_LINES: Readonly<Record<SpecialistRole, string>> = Object.freeze({
  coordinator: ":819",
  "requirements-analyst": ":820",
  "circuit-topology": ":821",
  "component-sourcing-evidence": ":822",
  schematic: ":823",
  "pcb-placement-routing": ":824",
  "verification-critic": ":825",
  "manufacturing-readiness-reviewer": ":826",
  "cost-latency-router": ":827",
});
/** The closed violation vocabulary of the report, in the order a violation list is written. */
export const ROLE_TOOL_VIOLATIONS = Object.freeze(["not_exposed", "granted_execution", "view_control", "never_exposed_pattern", "proposal_for_non_proposing_role", "unsorted_or_duplicate", "over_bound"] as const);
export type RoleToolViolation = (typeof ROLE_TOOL_VIOLATIONS)[number];

type ToolHoldingRole = Exclude<SpecialistRole, "coordinator" | "cost-latency-router">;
const LIVE_PROPOSAL = "Live since B21-D2: offered to this role's specialist when the coordinator's verified context holds its sealer's fact; the gateway seals it in the specialist's own run, which is its only way into the merge (provenance: sealed-in-run).", DORMANT_PROPOSAL = "Dormant for specialists (B21-D2): a long-running engine is never offered to a specialist - an owner option under OD-120.", DORMANT_PIN_FACTS = "Dormant for specialists (B21-D2): its sealer needs the server's published pin-facts reads, which only the coordinator's gateway holds - an owner option under OD-120.";
const DORMANT_PORT = "Dormant in B21-C: OD-109 keeps the ports from every specialist; the owner's OD-109 alternative would make it effective.";

/** OD-120's table: per role, every id with the reason it serves that role (sorted by id; the page renders these cells verbatim). */
export const ROLE_TOOL_REASONS: Readonly<Record<ToolHoldingRole | "cost-latency-router", Readonly<Record<string, string>>>> = Object.freeze({
  "requirements-analyst": Object.freeze({
    "sirkit.pcb.board-inspect": "The board as it stands (outline, footprints, nets): the physical facts a stated requirement must respect.",
    "sirkit.project.canonical-revision-inspect": "The verified revision the requirements are written against, so every requirement names the state it read.",
    "sirkit.project.history-inspect": "What the user already changed, so intent is read from the project's own timeline. Dormant in B21-C: the timeline rides the captured view, which a specialist context never holds.",
    "sirkit.schematic.inspect": "The current circuit, so a stated requirement is compared with what the schematic already does.",
  }),
  "circuit-topology": Object.freeze({
    "sirkit.schematic.inspect": "The topology under analysis: the components, pins and nets of the verified schematic.",
    "sirkit.schematic.propose-tier1-edit": `The sealed schematic edit proposal: the only way a topology change is ever expressed, an inert artifact a human applies (permission Tier 2, OD-15). ${LIVE_PROPOSAL}`,
    "sirkit.selection.inspect": "The user's current selection, when the question is about the selected parts.",
    "sirkit.validation.connectivity-verify": "The deterministic connectivity check a topology claim is tested against: deterministic validation outranks consensus.",
  }),
  "component-sourcing-evidence": Object.freeze({
    "sirkit.component-authority.inspect": "The server-owned exact component authority (B13): the only source that may name a replacement target; an inspection, never a binding.",
    "sirkit.mcp.observation-read": `An allowlisted, pinned external tool observation (B20-A4): evidence with labels, never authority. ${DORMANT_PORT}`,
    "sirkit.parts.evidence-read": `The offer cache's missing, conflicting or stale evidence for one exact MPN: evidence that proves nothing (B19). ${DORMANT_PORT}`,
    "sirkit.parts.external-search": `Registered distributor facts for one to five exact MPNs: sourcing evidence, never engineering proof (B19). ${DORMANT_PORT}`,
  }),
  schematic: Object.freeze({
    "sirkit.schematic.inspect": "The verified schematic the two sealed proposals compile against.",
    "sirkit.schematic.propose-component-replacement": `The sealed replacement proposal (B14): one exact-authority target, an inert artifact a human applies (permission Tier 2, OD-15, OD-123). ${DORMANT_PIN_FACTS}`,
    "sirkit.schematic.propose-tier1-edit": `The sealed schematic edit proposal (B09): an inert artifact a human applies exactly (permission Tier 2, OD-15, OD-123). ${LIVE_PROPOSAL}`,
  }),
  "pcb-placement-routing": Object.freeze({
    "sirkit.pcb.board-inspect": "The board the placement and routing question is about.",
    "sirkit.pcb.mechanical-inspect": "The board extents and mounting holes: the placement constraints, within the model's result budget.",
    "sirkit.pcb.propose-bounded-edit": `The sealed bounded PCB edit (B15.3): an inert artifact a human applies in the PCB editor. ${LIVE_PROPOSAL}`,
    "sirkit.pcb.via-inspect": "One net's vias and their padstack binding, for a routing question.",
    "sirkit.placement.propose": `The revision-bound placement candidate (B17-F) a human applies in the placement panel. ${DORMANT_PROPOSAL}`,
    "sirkit.routing.propose": `The revision-bound routing candidate (B17-F) a human applies in the routing panel. ${DORMANT_PROPOSAL}`,
  }),
  "verification-critic": Object.freeze({
    "sirkit.pcb.revision-inspect": "The board's semantic content revision: the state a claim was checked against.",
    "sirkit.pcb.via-inspect": "Via facts by net: a deterministic answer to a routing claim.",
    "sirkit.validation.connectivity-verify": "The deterministic connectivity verifier over the verified board.",
    "sirkit.validation.drc-run": "The deterministic design rule check over the verified board.",
  }),
  "manufacturing-readiness-reviewer": Object.freeze({
    "sirkit.manufacturing.readiness-inspect": "The fabrication readiness REPORT (Tier 0 inspection): the reviewer cites it by reference; it authorizes nothing (OD-129).",
    "sirkit.validation.connectivity-verify": "The deterministic connectivity check the readiness review starts from.",
    "sirkit.validation.drc-run": "The deterministic design rule check the readiness review starts from.",
  }),
  "cost-latency-router": Object.freeze({}),
});

/** The two rows that are not a list of reasons: the coordinator's (the exposure list itself) and the cost/latency policy role's (none). */
export const ROLE_NOTES: Readonly<Record<"coordinator" | "cost-latency-router", string>> = Object.freeze({
  coordinator: "The existing single-agent set, unchanged: this row IS INTENTIONAL_AGENT_EXPOSED_TOOL_IDS (the same frozen array, its reasons in agent-exposure.ts), never passed as an allowlist (33 ids, over the A4L bound).",
  "cost-latency-router": "A policy role over the plan's caps and provider choice: it reads no project state, so it holds no tool, and a plan that names it does not run it (role_has_no_tools: its task records the dissent) until B21-E gives it a policy input.",
});

const rowOf = (reasons: Readonly<Record<string, string>>): readonly string[] => Object.freeze(Object.keys(reasons));
/** The reviewed per-role allowlist (OD-120): the specialist rows are the reasons' ids; the coordinator's row IS the exposure list. */
export const INTENTIONAL_ROLE_TOOL_IDS: Readonly<Record<SpecialistRole, readonly string[]>> = Object.freeze({
  coordinator: INTENTIONAL_AGENT_EXPOSED_TOOL_IDS,
  "requirements-analyst": rowOf(ROLE_TOOL_REASONS["requirements-analyst"]),
  "circuit-topology": rowOf(ROLE_TOOL_REASONS["circuit-topology"]),
  "component-sourcing-evidence": rowOf(ROLE_TOOL_REASONS["component-sourcing-evidence"]),
  schematic: rowOf(ROLE_TOOL_REASONS.schematic),
  "pcb-placement-routing": rowOf(ROLE_TOOL_REASONS["pcb-placement-routing"]),
  "verification-critic": rowOf(ROLE_TOOL_REASONS["verification-critic"]),
  "manufacturing-readiness-reviewer": rowOf(ROLE_TOOL_REASONS["manufacturing-readiness-reviewer"]),
  "cost-latency-router": rowOf(ROLE_TOOL_REASONS["cost-latency-router"]),
});

const NO_TOOLS: readonly string[] = Object.freeze([]);
/** A role's reviewed row; an unknown role (any string) has none. */
export function roleAllowedToolIds(role: string): readonly string[] {
  return Object.hasOwn(INTENTIONAL_ROLE_TOOL_IDS, role) ? INTENTIONAL_ROLE_TOOL_IDS[role as SpecialistRole] : NO_TOOLS;
}

export type RoleToolDescriptor = Pick<ToolDescriptor, "toolId" | "operationClass" | "agentExposed">;
const EXPOSED: ReadonlySet<string> = new Set(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS);
/** The classes the exposure rule can admit at all; `destructive` and a final-tier class never are. */
const EXPOSABLE_CLASSES: ReadonlySet<string> = new Set(["read", "propose", "view-session", "mutate"]);
const outsideReach = (toolId: string): boolean => NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(toolId)) || TIER3_FAMILY_PATTERN.test(toolId);

/** Why one descriptor may not sit in one role's row (empty: it may). The coordinator's row holds the whole single-agent set, so a
 *  mutation or a view-session control is its own there; every other role may hold neither. */
export function roleToolViolations(role: SpecialistRole, descriptor: RoleToolDescriptor): RoleToolViolation[] {
  const found = new Set<RoleToolViolation>();
  if (!EXPOSED.has(descriptor.toolId) || descriptor.agentExposed !== true) found.add("not_exposed");
  if (role !== "coordinator" && descriptor.operationClass === "mutate") found.add("granted_execution");
  if (role !== "coordinator" && descriptor.operationClass === "view-session") found.add("view_control");
  if (outsideReach(descriptor.toolId) || !EXPOSABLE_CLASSES.has(descriptor.operationClass)) found.add("never_exposed_pattern");
  if (descriptor.operationClass === "propose" && !PROPOSING_ROLES.includes(role)) found.add("proposal_for_non_proposing_role");
  return ROLE_TOOL_VIOLATIONS.filter((reason) => found.has(reason));
}

export interface RoleRowReport {
  /** what the row admits: the row itself when it is sound, NOTHING otherwise (A4L: a malformed list admits nothing) */
  toolIds: readonly string[];
  violations: Array<{ toolId: string | null; reason: RoleToolViolation }>;
}
export interface RoleExposureReport {
  ok: boolean;
  roles: Record<SpecialistRole, RoleRowReport>;
  /** one line per violation: `<role>: <toolId> (<reason>)`, or `<role>: the list (<reason>)` for a list-level one */
  violations: string[];
  missingRoles: SpecialistRole[];
  unknownRoles: string[];
  /** the coordinator's row is the exposure list ITSELF (identity), never a copy that could drift */
  coordinatorIsExposureList: boolean;
  /** the ids the specialist rows admit, summed */
  count: number;
}

type DescriptorLookup = { get(toolId: string, version?: string): RoleToolDescriptor | undefined };
const lookup = (registry: DescriptorLookup, toolId: string): RoleToolDescriptor | undefined => {
  try {
    const descriptor = registry.get(toolId);
    return descriptor && typeof descriptor === "object" ? descriptor : undefined;
  } catch {
    return undefined;
  }
};

/** One row judged against the registry: a hostile row is reported, never thrown. */
function judgeRow(role: SpecialistRole, row: unknown, registry: DescriptorLookup): RoleRowReport {
  const refused = (reason: RoleToolViolation): RoleRowReport => ({ toolIds: NO_TOOLS, violations: [{ toolId: null, reason }] });
  let entries: unknown[];
  try {
    if (!Array.isArray(row)) return refused("not_exposed");
    entries = Array.from(row as unknown[]);
  } catch {
    return refused("not_exposed");
  }
  const violations: RoleRowReport["violations"] = [];
  if (role === "coordinator") {
    for (const entry of entries) {
      const toolId = String(entry);
      if (typeof entry !== "string" || !EXPOSED.has(entry)) violations.push({ toolId, reason: "not_exposed" });
      if (typeof entry === "string" && outsideReach(entry)) violations.push({ toolId, reason: "never_exposed_pattern" });
    }
    return { toolIds: violations.length === 0 && row === INTENTIONAL_AGENT_EXPOSED_TOOL_IDS ? INTENTIONAL_AGENT_EXPOSED_TOOL_IDS : NO_TOOLS, violations };
  }
  if (entries.length > MAX_ROLE_TOOL_IDS) return refused("over_bound");
  for (const entry of entries) {
    if (typeof entry !== "string") { violations.push({ toolId: String(entry), reason: "not_exposed" }); continue; }
    const descriptor = lookup(registry, entry);
    let reasons: RoleToolViolation[];
    try {
      reasons = descriptor ? roleToolViolations(role, { toolId: entry, operationClass: descriptor.operationClass, agentExposed: descriptor.agentExposed }) : roleToolViolations(role, { toolId: entry, operationClass: "read", agentExposed: false });
    } catch {
      reasons = ["not_exposed"];
    }
    for (const reason of reasons) violations.push({ toolId: entry, reason });
  }
  const sorted = entries.every((entry, index) => index === 0 || String(entries[index - 1]) < String(entry));
  if (!sorted) violations.push({ toolId: null, reason: "unsorted_or_duplicate" });
  return { toolIds: violations.length === 0 ? Object.freeze(entries as string[]) : NO_TOOLS, violations };
}

/** Every role's row judged against the registry the caller hands in (the table defaults to the reviewed one; a hostile table is
 *  reported, never thrown - the `mcpExposureReport` pattern: drift by role, id and reason). */
export function roleExposureReport(registry: DescriptorLookup, table: unknown = INTENTIONAL_ROLE_TOOL_IDS): RoleExposureReport {
  const roles = {} as Record<SpecialistRole, RoleRowReport>;
  for (const role of SPECIALIST_ROLES) roles[role] = { toolIds: NO_TOOLS, violations: [] };
  const missingRoles: SpecialistRole[] = [];
  let unknownRoles: string[] = [];
  let coordinatorIsExposureList = false;
  const isTable = typeof table === "object" && table !== null && !Array.isArray(table);
  if (isTable) {
    try {
      unknownRoles = Object.keys(table).filter((key) => !(SPECIALIST_ROLES as readonly string[]).includes(key)).sort();
    } catch {
      unknownRoles = [];
    }
  }
  for (const role of SPECIALIST_ROLES) {
    let present = false;
    try {
      present = isTable && Object.hasOwn(table, role);
    } catch {
      present = false;
    }
    if (!present) { missingRoles.push(role); continue; }
    let row: unknown;
    try {
      row = (table as Record<string, unknown>)[role];
    } catch {
      roles[role] = { toolIds: NO_TOOLS, violations: [{ toolId: null, reason: "not_exposed" }] };
      continue;
    }
    if (role === "coordinator") coordinatorIsExposureList = row === INTENTIONAL_AGENT_EXPOSED_TOOL_IDS;
    roles[role] = judgeRow(role, row, registry);
  }
  const violations = SPECIALIST_ROLES.flatMap((role) => roles[role].violations.map((violation) => `${role}: ${violation.toolId ?? "the list"} (${violation.reason})`));
  const count = SPECIALIST_ROLES.filter((role) => role !== "coordinator").reduce((sum, role) => sum + roles[role].toolIds.length, 0);
  return { ok: violations.length === 0 && missingRoles.length === 0 && unknownRoles.length === 0 && coordinatorIsExposureList, roles, violations, missingRoles, unknownRoles, coordinatorIsExposureList, count };
}

// ─── [B21 D2] The proposals a specialist may be offered (OD-120 amended) ─────────────────────────────────────────────────
// Appended on purpose: nothing above moves (the B21 pages pin this file's lines).

/** [B21 D2] The Tier 2 proposals a PROPOSING role's specialist may be offered - its row intersected with this list, nothing more
 *  (sorted): each is interactive (never long-running), is sealed by the gateway in the specialist's own run from the verified
 *  context alone, and needs nothing but that context (no port, nothing the composition root alone holds). */
export const SPECIALIST_PROPOSAL_TOOL_IDS: readonly string[] = Object.freeze(["sirkit.pcb.propose-bounded-edit", "sirkit.schematic.propose-tier1-edit"]);
/** [B21 D2] The row proposals that stay DORMANT for specialists, each with its reason - recorded as owner options under OD-120,
 *  never silently: the two long-running engines, and the replacement, whose sealer needs a server source the bare specialist
 *  gateway never holds. */
export const DORMANT_SPECIALIST_PROPOSALS: Readonly<Record<string, string>> = Object.freeze({
  "sirkit.placement.propose": "long-running (budgetClass long-running): the placement engine blocks the event loop 44-104 s per run (B20's measurement), so it is never offered to a specialist",
  "sirkit.routing.propose": "long-running (budgetClass long-running): a FreeRouting child process of up to 180 s, so it is never offered to a specialist",
  "sirkit.schematic.propose-component-replacement": "its sealer needs the server's published pin-facts reads (replacementPinFacts), which only the coordinator's gateway holds; the specialist gateway is built with no option (OD-109), so through it the seal always blocks",
});
/** [B21 D2] A role's LIVE proposals: its reviewed row intersected with SPECIALIST_PROPOSAL_TOOL_IDS for a proposing role, none for a
 *  read-only role, and none for the coordinator (its own turn keeps the whole exposure list; it is never a specialist). */
export function roleProposalToolIds(role: string): readonly string[] {
  if (role === "coordinator" || !(PROPOSING_ROLES as readonly string[]).includes(role)) return NO_TOOLS;
  return Object.freeze(roleAllowedToolIds(role).filter((toolId) => SPECIALIST_PROPOSAL_TOOL_IDS.includes(toolId)));
}
