/**
 * [B21 C] The reviewed per-role allowlist (OD-120) as data with a reason per id, and its derived report: every specialist
 * role's list is a sorted, duplicate-free subset of the one reviewed exposure list within the A4L bound; no role holds a
 * granted execution, a view-session control or a never-exposed / Tier 3 id; a proposal appears only in a proposing role's
 * row; the coordinator's row IS the exposure list itself (the same array, never a copy); the cost/latency router has no
 * tool; every violation reason of the closed vocabulary is produced by a crafted table (the table is DATA - the checker is
 * handed a hostile one and never throws); the table equals the page's, reason for reason; the module names no route,
 * executor, grant or approval as text.
 *
 * [B21 C adopted] Written test-first by an earlier implementer against a role-tools.ts that did not exist; reviewed and
 * kept: the export surface, the seven-reason vocabulary, OD-120's table and the text scan are unchanged. Changed: the
 * reason per id is DATA (`ROLE_TOOL_REASONS`, `ROLE_NOTES`) and the page's reason cell must equal it (case 2 and case 4,
 * where the adopted suite only measured the page text's length).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS } from "@/app/lib/engineering/agent-exposure";
import { GRANTED_EXECUTION_TOOL_IDS } from "@/app/lib/engineering/granted-execution-families";
import { TIER3_FAMILY_PATTERN, permissionTierOfDescriptor } from "@/app/lib/engineering/permission-tiers";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { ORCHESTRATION_BOUNDS, SPECIALIST_ROLES, isPermittedOrchestrationToolId, type SpecialistRole } from "../contracts";
import { INTENTIONAL_ROLE_TOOL_IDS, MAX_ROLE_TOOL_IDS, PROPOSING_ROLES, ROLE_NOTES, ROLE_RUNBOOK_LINES, ROLE_TOOL_REASONS, ROLE_TOOL_VIOLATIONS, roleAllowedToolIds, roleExposureReport, roleToolViolations } from "../role-tools";

const registry = sirkitToolRegistry();
const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const MODULE = "app/lib/agent/orchestration/role-tools.ts";
const PAGE = "artifacts/ai-control-plane-b21/specialist-roles.md";
const SPECIALISTS = SPECIALIST_ROLES.filter((role): role is Exclude<SpecialistRole, "coordinator"> => role !== "coordinator");
const byCodeUnit = (values: readonly string[]): string[] => [...values].sort();
const descriptorOf = (toolId: string) => registry.get(toolId);

/** OD-120's proposal (discovery.md section 6), spelled here so a drift of the table from the reviewed proposal is visible. */
const OD_120: Readonly<Record<Exclude<SpecialistRole, "coordinator">, readonly string[]>> = {
  "requirements-analyst": ["sirkit.pcb.board-inspect", "sirkit.project.canonical-revision-inspect", "sirkit.project.history-inspect", "sirkit.schematic.inspect"],
  "circuit-topology": ["sirkit.schematic.inspect", "sirkit.schematic.propose-tier1-edit", "sirkit.selection.inspect", "sirkit.validation.connectivity-verify"],
  "component-sourcing-evidence": ["sirkit.component-authority.inspect", "sirkit.mcp.observation-read", "sirkit.parts.evidence-read", "sirkit.parts.external-search"],
  schematic: ["sirkit.schematic.inspect", "sirkit.schematic.propose-component-replacement", "sirkit.schematic.propose-tier1-edit"],
  "pcb-placement-routing": ["sirkit.pcb.board-inspect", "sirkit.pcb.mechanical-inspect", "sirkit.pcb.propose-bounded-edit", "sirkit.pcb.via-inspect", "sirkit.placement.propose", "sirkit.routing.propose"],
  "verification-critic": ["sirkit.pcb.revision-inspect", "sirkit.pcb.via-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run"],
  "manufacturing-readiness-reviewer": ["sirkit.manufacturing.readiness-inspect", "sirkit.validation.connectivity-verify", "sirkit.validation.drc-run"],
  "cost-latency-router": [],
};

describe("[B21 C] the per-role tool allowlist", () => {
  it("1. the report over the production registry is clean: every role of SPECIALIST_ROLES has a row and no other key exists, no violation anywhere, the coordinator's row is the exposure list, the count is the sum of the specialist rows", () => {
    const report = roleExposureReport(registry);
    expect(report.ok).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.missingRoles).toEqual([]);
    expect(report.unknownRoles).toEqual([]);
    expect(report.coordinatorIsExposureList).toBe(true);
    expect(Object.keys(report.roles).sort()).toEqual([...SPECIALIST_ROLES].sort());
    expect(Object.keys(INTENTIONAL_ROLE_TOOL_IDS).sort()).toEqual([...SPECIALIST_ROLES].sort());
    for (const role of SPECIALIST_ROLES) expect(report.roles[role].violations, role).toEqual([]);
    expect(report.count).toBe(SPECIALISTS.reduce((sum, role) => sum + INTENTIONAL_ROLE_TOOL_IDS[role].length, 0));
    expect(Object.isFrozen(INTENTIONAL_ROLE_TOOL_IDS)).toBe(true);
    for (const role of SPECIALIST_ROLES) expect(Object.isFrozen(INTENTIONAL_ROLE_TOOL_IDS[role]), role).toBe(true);
  });

  it("2. every specialist row is a sorted, duplicate-free subset of the 33 within the A4L bound (32 = the contracts' bound), every id an active exposed descriptor the structural gate permits; no row holds a granted execution, a view control or a never-exposed / Tier 3 id; a proposal only in a proposing role's row; the coordinator's row IS INTENTIONAL_AGENT_EXPOSED_TOOL_IDS (identity, 33 ids); the cost/latency router has none; the table equals OD-120's proposal; every id carries its reason as data; roleAllowedToolIds answers the row and nothing for an unknown role", () => {
    expect(MAX_ROLE_TOOL_IDS).toBe(32);
    expect(MAX_ROLE_TOOL_IDS).toBe(ORCHESTRATION_BOUNDS.maxAllowedToolIds);
    for (const role of SPECIALISTS) {
      const ids = INTENTIONAL_ROLE_TOOL_IDS[role];
      expect([...ids], role).toEqual(byCodeUnit(ids));
      expect(new Set(ids).size, role).toBe(ids.length);
      expect(ids.length, role).toBeLessThanOrEqual(MAX_ROLE_TOOL_IDS);
      for (const toolId of ids) {
        expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, `${role}: ${toolId}`).toContain(toolId);
        expect(isPermittedOrchestrationToolId(toolId), `${role}: ${toolId}`).toBe(true);
        const descriptor = descriptorOf(toolId);
        expect(descriptor, `${role}: ${toolId}`).toBeDefined();
        expect(descriptor!.agentExposed, `${role}: ${toolId}`).toBe(true);
        expect(descriptor!.lifecycle, `${role}: ${toolId}`).toBe("active");
        expect(GRANTED_EXECUTION_TOOL_IDS, `${role}: ${toolId}`).not.toContain(toolId);
        expect(descriptor!.operationClass, `${role}: ${toolId}`).not.toBe("mutate");
        expect(descriptor!.operationClass, `${role}: ${toolId}`).not.toBe("view-session");
        expect(permissionTierOfDescriptor(descriptor!), `${role}: ${toolId}`).not.toBe(3);
        expect(NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(toolId)), `${role}: ${toolId}`).toBe(false);
        expect(TIER3_FAMILY_PATTERN.test(toolId), `${role}: ${toolId}`).toBe(false);
        if (descriptor!.operationClass === "propose") expect(PROPOSING_ROLES, `${role}: ${toolId}`).toContain(role);
        expect(roleToolViolations(role, descriptor!), `${role}: ${toolId}`).toEqual([]);
      }
      expect([...ids], role).toEqual([...OD_120[role]]);
      expect(roleAllowedToolIds(role), role).toBe(INTENTIONAL_ROLE_TOOL_IDS[role]);
    }
    expect(PROPOSING_ROLES).toEqual(["coordinator", "circuit-topology", "schematic", "pcb-placement-routing"]);
    expect(INTENTIONAL_ROLE_TOOL_IDS["cost-latency-router"]).toEqual([]);
    expect(INTENTIONAL_ROLE_TOOL_IDS.coordinator).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS);
    expect(INTENTIONAL_ROLE_TOOL_IDS.coordinator).toHaveLength(33);
    expect(roleAllowedToolIds("coordinator")).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS);
    expect(roleAllowedToolIds("not-a-role")).toEqual([]);
    expect(Object.isFrozen(roleAllowedToolIds("not-a-role"))).toBe(true);
    expect(roleAllowedToolIds("__proto__")).toEqual([]);
    // the six view controls and the six granted executions are in NO specialist row, and every proposal a specialist row holds is one of the five
    const held = new Set(SPECIALISTS.flatMap((role) => [...INTENTIONAL_ROLE_TOOL_IDS[role]]));
    for (const descriptor of registry.list().filter((item) => item.agentExposed && (item.operationClass === "view-session" || item.operationClass === "mutate"))) expect(held.has(descriptor.toolId), descriptor.toolId).toBe(false);
    for (const role of ["schematic", "circuit-topology", "pcb-placement-routing"] as const) expect(INTENTIONAL_ROLE_TOOL_IDS[role].some((toolId) => descriptorOf(toolId)?.operationClass === "propose"), role).toBe(true);
    for (const role of ["requirements-analyst", "component-sourcing-evidence", "verification-critic", "manufacturing-readiness-reviewer"] as const) expect(INTENTIONAL_ROLE_TOOL_IDS[role].every((toolId) => descriptorOf(toolId)?.operationClass === "read"), role).toBe(true);
    // the runbook line per role (B21-C :815-829)
    expect(ROLE_RUNBOOK_LINES).toEqual({ coordinator: ":819", "requirements-analyst": ":820", "circuit-topology": ":821", "component-sourcing-evidence": ":822", schematic: ":823", "pcb-placement-routing": ":824", "verification-critic": ":825", "manufacturing-readiness-reviewer": ":826", "cost-latency-router": ":827" });
    // [B21 C] the reason per id is DATA: the table's ids ARE the reasons' keys, in order; every reason one plain line a page cell can hold
    expect(Object.keys(ROLE_TOOL_REASONS).sort()).toEqual([...SPECIALISTS].sort());
    for (const role of SPECIALISTS) {
      expect(Object.keys(ROLE_TOOL_REASONS[role]), role).toEqual([...INTENTIONAL_ROLE_TOOL_IDS[role]]);
      for (const [toolId, reason] of Object.entries(ROLE_TOOL_REASONS[role])) {
        expect(reason.length, `${role}: ${toolId}`).toBeGreaterThan(20);
        expect(reason.length, `${role}: ${toolId}`).toBeLessThanOrEqual(400);
        expect(reason, `${role}: ${toolId}`).not.toMatch(/[|`\n]/);
      }
    }
    expect(Object.keys(ROLE_NOTES).sort()).toEqual(["coordinator", "cost-latency-router"]);
    for (const note of Object.values(ROLE_NOTES)) { expect(note.length).toBeGreaterThan(20); expect(note).not.toMatch(/[|`\n]/); }
  });

  it("3. every violation reason of the closed vocabulary is produced by a crafted table or descriptor: not_exposed, granted_execution, view_control, never_exposed_pattern, proposal_for_non_proposing_role, unsorted_or_duplicate, over_bound; a hostile table (a missing role, an unknown role, a non-array row, a non-string entry, a throwing Proxy, a copied coordinator row) is reported and never thrown; the vocabulary is exactly the seven", () => {
    expect([...ROLE_TOOL_VIOLATIONS]).toEqual(["not_exposed", "granted_execution", "view_control", "never_exposed_pattern", "proposal_for_non_proposing_role", "unsorted_or_duplicate", "over_bound"]);
    const move = descriptorOf("sirkit.pcb.move-footprint")!;
    const layers = descriptorOf("sirkit.view.layers")!;
    const release = descriptorOf("sirkit.manufacturing.release")!;
    const replay = descriptorOf("sirkit.pcb.undo-redo-canonical")!;
    const track = descriptorOf("sirkit.pcb.edit-track")!;
    const propose = descriptorOf("sirkit.schematic.propose-tier1-edit")!;
    const inspect = descriptorOf("sirkit.pcb.board-inspect")!;
    expect(roleToolViolations("schematic", move)).toEqual(["granted_execution"]);
    expect(roleToolViolations("schematic", layers)).toEqual(["view_control"]);
    expect(roleToolViolations("schematic", release)).toEqual(["not_exposed", "never_exposed_pattern"]);
    expect(roleToolViolations("schematic", replay)).toEqual(["not_exposed", "granted_execution", "never_exposed_pattern"]);
    expect(roleToolViolations("schematic", track)).toEqual(["not_exposed", "granted_execution", "never_exposed_pattern"]);
    expect(roleToolViolations("verification-critic", propose)).toEqual(["proposal_for_non_proposing_role"]);
    expect(roleToolViolations("schematic", propose)).toEqual([]);
    expect(roleToolViolations("verification-critic", inspect)).toEqual([]);
    // the coordinator's row is the single-agent set: a granted execution and a view control are its own, never a violation
    expect(roleToolViolations("coordinator", move)).toEqual([]);
    expect(roleToolViolations("coordinator", layers)).toEqual([]);
    expect(roleToolViolations("coordinator", release)).toEqual(["not_exposed", "never_exposed_pattern"]);
    // a crafted descriptor: an exposed-looking id outside the 33, a Tier 3 family name dressed as a read, an unexposed copy of a real read
    expect(roleToolViolations("schematic", { toolId: "sirkit.pcb.helpful-read", operationClass: "read", agentExposed: true })).toEqual(["not_exposed"]);
    expect(roleToolViolations("schematic", { toolId: "sirkit.pcb.qualify-read", operationClass: "read", agentExposed: true })).toEqual(["not_exposed", "never_exposed_pattern"]);
    expect(roleToolViolations("schematic", { toolId: "sirkit.pcb.board-inspect", operationClass: "read", agentExposed: false })).toEqual(["not_exposed"]);
    expect(roleToolViolations("schematic", { toolId: "sirkit.pcb.board-inspect", operationClass: "destructive", agentExposed: true })).toEqual(["never_exposed_pattern"]);
    // the list-level reasons through the report over a crafted table
    const thirtyThree = [...INTENTIONAL_AGENT_EXPOSED_TOOL_IDS];
    const hostile = {
      ...INTENTIONAL_ROLE_TOOL_IDS,
      "verification-critic": ["sirkit.validation.drc-run", "sirkit.pcb.via-inspect"],
      "manufacturing-readiness-reviewer": ["sirkit.validation.drc-run", "sirkit.validation.drc-run"],
      schematic: thirtyThree,
      "requirements-analyst": ["sirkit.pcb.board-inspect", 42, "sirkit.pcb.move-footprint", "sirkit.view.layers", "sirkit.manufacturing.release", "sirkit.schematic.propose-tier1-edit"],
      "circuit-topology": "not-a-list",
      coordinator: [...INTENTIONAL_AGENT_EXPOSED_TOOL_IDS],
      "not-a-role": ["sirkit.pcb.board-inspect"],
    };
    const report = roleExposureReport(registry, hostile);
    expect(report.ok).toBe(false);
    expect(report.unknownRoles).toEqual(["not-a-role"]);
    expect(report.missingRoles).toEqual([]);
    expect(report.coordinatorIsExposureList).toBe(false); // a copy, not the list itself
    expect(report.roles["verification-critic"].violations).toEqual([{ toolId: null, reason: "unsorted_or_duplicate" }]);
    expect(report.roles["manufacturing-readiness-reviewer"].violations).toEqual([{ toolId: null, reason: "unsorted_or_duplicate" }]);
    expect(report.roles.schematic.violations).toEqual([{ toolId: null, reason: "over_bound" }]);
    // A4L: an over-long, unsorted or malformed row approves NOTHING
    expect(report.roles.schematic.toolIds).toEqual([]);
    expect(report.roles["verification-critic"].toolIds).toEqual([]);
    expect(report.roles["requirements-analyst"].violations).toEqual([
      { toolId: "42", reason: "not_exposed" },
      { toolId: "sirkit.pcb.move-footprint", reason: "granted_execution" },
      { toolId: "sirkit.view.layers", reason: "view_control" },
      { toolId: "sirkit.manufacturing.release", reason: "not_exposed" },
      { toolId: "sirkit.manufacturing.release", reason: "never_exposed_pattern" },
      { toolId: "sirkit.schematic.propose-tier1-edit", reason: "proposal_for_non_proposing_role" },
      { toolId: null, reason: "unsorted_or_duplicate" },
    ]);
    expect(report.roles["circuit-topology"].violations).toEqual([{ toolId: null, reason: "not_exposed" }]);
    expect(report.roles["circuit-topology"].toolIds).toEqual([]);
    const reasons = new Set(report.violations.map((line) => /\((\w+)\)$/.exec(line)![1]!));
    expect([...reasons].sort()).toEqual([...ROLE_TOOL_VIOLATIONS].sort());
    expect(report.violations).toContain("requirements-analyst: sirkit.pcb.move-footprint (granted_execution)");
    // a missing role and a throwing Proxy: reported, never a throw; a non-object table is refused whole
    const { "cost-latency-router": _dropped, ...withoutOne } = INTENTIONAL_ROLE_TOOL_IDS;
    void _dropped;
    expect(roleExposureReport(registry, withoutOne)).toMatchObject({ ok: false, missingRoles: ["cost-latency-router"] });
    const throwing = new Proxy({ ...INTENTIONAL_ROLE_TOOL_IDS }, { get: (target, key) => { if (key === "schematic") throw new Error("hostile"); return Reflect.get(target, key); } });
    const thrown = roleExposureReport(registry, throwing);
    expect(thrown.ok).toBe(false);
    expect(thrown.roles.schematic.violations).toEqual([{ toolId: null, reason: "not_exposed" }]);
    expect(roleExposureReport(registry, null)).toMatchObject({ ok: false, missingRoles: [...SPECIALIST_ROLES] });
    expect(roleExposureReport(registry, "x")).toMatchObject({ ok: false });
    // a registry that cannot be read reports every id of every specialist row not_exposed, never a throw
    const broken = { get: () => { throw new Error("unreadable"); } };
    const unreadable = roleExposureReport(broken);
    expect(unreadable.ok).toBe(false);
    expect(unreadable.roles["verification-critic"].violations.map((entry) => entry.reason)).toEqual(["not_exposed", "not_exposed", "not_exposed", "not_exposed"]);
  });

  it("4. the table equals the page's table (one row per role and tool with the runbook line, the class and the reason the module holds; the coordinator's row states the exposure list itself; the cost/latency router's row names no tool)", () => {
    const page = read(PAGE);
    const rows = [...page.matchAll(/^\| `([a-z-]+)` \| `(:\d+)` \| (?:`([a-z0-9.-]+)`|—|the exposure list itself) \| (read|propose|—) \| (.+?) \|$/gm)].map((row) => ({ role: row[1]!, line: row[2]!, toolId: row[3] ?? null, klass: row[4]!, reason: row[5]!, exposureList: row[0]!.includes("the exposure list itself") }));
    expect(rows.length).toBeGreaterThan(20);
    for (const role of SPECIALIST_ROLES) {
      const own = rows.filter((row) => row.role === role);
      expect(own.length, role).toBeGreaterThan(0);
      for (const row of own) { expect(row.line, role).toBe(ROLE_RUNBOOK_LINES[role]); expect(row.reason.length, role).toBeGreaterThan(20); }
      if (role === "coordinator") { expect(own).toHaveLength(1); expect(own[0]!.exposureList).toBe(true); expect(own[0]!.reason).toBe(ROLE_NOTES.coordinator); continue; }
      const ids = own.flatMap((row) => (row.toolId ? [row.toolId] : []));
      expect(ids, role).toEqual([...INTENTIONAL_ROLE_TOOL_IDS[role]]);
      for (const row of own) if (row.toolId) {
        expect(row.klass, `${role}: ${row.toolId}`).toBe(descriptorOf(row.toolId)!.operationClass);
        expect(row.reason, `${role}: ${row.toolId}`).toBe(ROLE_TOOL_REASONS[role][row.toolId]);
      }
    }
    expect(rows.filter((row) => row.role === "cost-latency-router")).toHaveLength(1);
    expect(rows.find((row) => row.role === "cost-latency-router")!.toolId).toBeNull();
    expect(rows.find((row) => row.role === "cost-latency-router")!.reason).toBe(ROLE_NOTES["cost-latency-router"]);
    for (const role of PROPOSING_ROLES) expect(page).toContain(`\`${role}\``);
  });

  it("5. the module as text: no provider SDK; nothing that names a route, an executor, a grant, an approval, a release, a qualification or a minter (the role ids and the violation vocabulary, spelled as quoted data, are scrubbed first); its imports are the exposure list, the tiers' family pattern and the contracts' roles; the table is data, never derived from a registry at load", () => {
    const source = read(MODULE);
    expect(source).not.toMatch(/from\s+["'](?:openai|@anthropic-ai\/sdk)/);
    expect(source).not.toMatch(/\bOpenAI\b|\bAnthropic\b/);
    const scrubbed = [...SPECIALIST_ROLES, ...ROLE_TOOL_VIOLATIONS].reduce((text, word) => text.replaceAll(JSON.stringify(word), ""), source).toLowerCase();
    for (const subject of [["rou", "te"].join(""), ["execu", "tor"].join(""), ["gra", "nt"].join(""), ["appro", "v"].join(""), ["relea", "se"].join(""), ["quali", "f"].join(""), ["min", "ter"].join(""), ["app/", "api"].join("")]) {
      expect(scrubbed.includes(subject), subject).toBe(false);
    }
    const imports = [...source.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1]!).sort();
    expect(imports).toEqual(["../../engineering/agent-exposure", "../../engineering/permission-tiers", "../../engineering/tool-registry", "./contracts"]);
    expect(source).toMatch(/^import type \{[^}]*\} from "\.\.\/\.\.\/engineering\/tool-registry";$/m);
    expect(source).not.toMatch(/sirkitToolRegistry|tool-catalog/);
    expect(source).toContain("[B21 C]");
  });
});
