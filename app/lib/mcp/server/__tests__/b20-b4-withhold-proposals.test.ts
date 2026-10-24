/**
 * [B20 B4] The withholding move (OD-82, OD-87; the discovery default of OD-50 superseded): B20 serves NO proposal over MCP.
 * The five proposals move from the exposed list to `MCP_WITHHELD_TOOL_IDS` by one reviewed ratchet move, each with its reason,
 * so the MCP subset is the 9 served reads and MCP exposure in B20 is read-only. A tools/call naming a proposal is B2's
 * identical -32602 and reads nothing; every tool tools/list can return reaches a serving path (listed means served), with the
 * dispatch's closed `not_served` branch kept as defence; and `mcp-server-proposals.md` states the decision, the counts, the
 * probe evidence and its citations as the code and the logs have them. The registry and every descriptor stay byte-identical
 * to the base (4299067). The real dispatch and read pipeline over in-memory fakes: no database, no network, no engine run.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpBearerContext, McpRequestHeaders } from "@/app/lib/auth/mcp-bearer";
import type { MembershipRole } from "@/app/lib/auth/project-membership";
import type { McpBearerJsonInput } from "@/app/lib/auth/route-handlers";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure";
import { INTENTIONAL_MCP_EXPOSED_TOOL_IDS, MCP_WITHHELD_TOOL_IDS, mcpExclusionReason, mcpExposureReport } from "@/app/lib/engineering/mcp-exposure";
import { engineeringDigest } from "@/app/lib/engineering/stable";
import { SIRKIT_TOOL_CATALOG, sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { discoverTools, type DiscoveryContext } from "@/app/lib/engineering/tool-discovery";
import { TOOL_AUTHORITY_SOURCES, TOOL_PROJECT_STATES, TOOL_SELECTION_KINDS, ToolRegistry, type ToolDescriptor } from "@/app/lib/engineering/tool-registry";
import { FIXTURE_SCOPE } from "@/app/lib/engineering/__tests__/_durable-board-fixture";
import { MCP_NOT_SERVED_TEXT, handleMcpRequest } from "../dispatch";
import { resetMcpReadStateForTests } from "../read-call";
import { resetMcpServerTraceSinkFactory, setMcpServerTraceSinkFactory, type McpServerRequestTrace } from "../request-trace";
import { renderMcpToolListing, renderMcpToolManifestCsv } from "../tool-definitions";
import { ROLE_OF, SERVED_READS, harnessPrincipal, readHarness, type Harness } from "./_read-harness";
import { anchorOccurrences, pageCitations } from "./_citations";

const ROOT = process.cwd();
const NEWLINE = String.fromCharCode(10);
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);
const PAGE = "artifacts/ai-control-plane-b20/mcp-server-proposals.md";
const registry = sirkitToolRegistry();
const descriptor = (toolId: string): ToolDescriptor => registry.get(toolId)!;

const WITHHELD_READS = ["sirkit.project.history-inspect", "sirkit.schematic.inspect"];
const PROPOSALS = ["sirkit.pcb.propose-bounded-edit", "sirkit.placement.propose", "sirkit.routing.propose", "sirkit.schematic.propose-component-replacement", "sirkit.schematic.propose-tier1-edit"];
const PRD_ADDITION = "sirkit.schematic.generate-proposal"; // [PR-D, 2026-10-16] OD-243: the Build-mode generation proposal, withheld as B4's proposals are
const PRD2_ADDITIONS = ["sirkit.component.review-request", "sirkit.parts.catalog-inspect", "sirkit.pcb-sync.preflight"]; const PRD2_WITHHELD = PRD2_ADDITIONS.slice(1); const PRM_ADDITIONS = ["sirkit.parts.candidate-search", "sirkit.schematic.instance-inspect", "sirkit.schematic.propose-component-resolution"]; const PRL_ADDITIONS = ["sirkit.generation.task-control", "sirkit.generation.task-inspect"]; const PRM2_ADDITIONS = ["sirkit.parts.acquisition-start", "sirkit.parts.acquisition-status"]; const PRJ5_ADDITIONS = ["sirkit.schematic.propose-sheet-organization"]; /* [PR-J5, 2026-10-23] pin move: the organise proposal (runbook J.6, OD-259 item 4), withheld (a proposal, OD-82: it seals against browser-only SchematicState and head mark) */ /* [PR-M, 2026-10-18] pin move: section M2's two commands, both withheld (the start: a proposal-class start, OD-82; the status: browser-only SchematicState targets and no acquisition task store on the MCP server) */ /* [PR-L, 2026-10-18] pin move: runbook L.5's two commands, both withheld (the inspection: no generation-task port on the MCP server; the control request: a proposal, OD-82) */ /* [PR-M, 2026-10-17] pin move: the schematic-instance inspection (browser-only SchematicState), the resolution candidate search (withheld by choice: the MCP server binds no catalog, search or evidence port) and the component resolution proposal (a proposal, as B4's), 15 -> 18 withheld */ const PRF_ADDITIONS = ["sirkit.parts.draft-request", "sirkit.parts.missing-facts", "sirkit.module.propose-contracts", "sirkit.stackup.propose"] /* [PR-F fE, 2026-10-17] + the stackup / via-policy proposal (a proposal: withheld as B4's are; 14 -> 15) */ /* [PR-F fD, 2026-10-17] + the module contract proposal (a proposal: withheld as B4's are) */; /* [PR-F fB, 2026-10-17] the missing-facts read (browser-only SchematicState) and the part draft request (a proposal: withheld as B4's are), left out of the base the same way */ // [PR-D d2, 2026-10-16] two Tier 0 reads MCP withholds (the preflight read: browser-only SchematicState, as OD-69; the catalog inspection: by choice, as OD-235) and the not-callable component review request, left out of the base the same way
const WITHHELD = [...WITHHELD_READS, ...PROPOSALS, "sirkit.pcb.board-page-inspect", PRD_ADDITION, ...PRD2_WITHHELD, ...PRF_ADDITIONS, ...PRM_ADDITIONS, ...PRL_ADDITIONS, ...PRM2_ADDITIONS, ...PRJ5_ADDITIONS].sort(); // [PR-J5, 2026-10-23] pin move: + the organise proposal (22 -> 23); [PR-M, 2026-10-18] pin move: + the two M2 commands (20 -> 22); [PR-L, 2026-10-18] pin move: + the two PR-L commands (18 -> 20); [PR-M, 2026-10-17] pin move: + the three PR-M commands (15 -> 18); [PR-F fB, 2026-10-17] pin move: + the two PR-F commands (11 -> 13); // [PR-D d2, 2026-10-16] pin move: + the two reads (9 -> 11); // [B24-D2, 2026-10-09] pin move (OD-235): a third withheld category beside B3's two reads and B4's five proposals - B24-D2's paged board read, withheld by choice (7 -> 8); [PR-D, 2026-10-16] pin move (OD-243): + the generation proposal (8 -> 9)
/** Each proposal's decision and the fact its reason comment must state (the lead's decision text, OD-82 / OD-87). */
const REASONS: Record<string, { od: string; fact: RegExp }> = {
  "sirkit.pcb.propose-bounded-edit": { od: "OD-82", fact: /history head, lineage and DRC preset/ },
  "sirkit.placement.propose": { od: "OD-87", fact: /blocks the event loop/ },
  "sirkit.routing.propose": { od: "OD-82", fact: /FreeRouting child process/ },
  "sirkit.schematic.propose-component-replacement": { od: "OD-82", fact: /SchematicState and head mark/ },
  "sirkit.schematic.propose-tier1-edit": { od: "OD-82", fact: /SchematicState and head mark/ },
};
/** Pins taken on the base 4299067 (scratchpad probe base-digests.ts, log b4w-03), before any B4 change. */
const BASE = { registryDigest: "eng1-1c5886dfe02d6944", descriptors: "eng1-ad72be9044a78457", count: 41, agentSet: "eng1-32957c985a8e12a7" }; // [PR-J5, 2026-10-23] reviewed pin move: registryDigest d5914d82d2823ddd -> 1c5886dfe02d6944 and descriptors 516d7fd99768694e -> ad72be9044a78457 because TWO base descriptors changed - sirkit.schematic.inspect 1.1.0 -> 1.2.0 (sheetId / neighbours) and sirkit.view.canvas-navigation 1.1.0 -> 1.2.0 (action open-sheet); with their 5993dd68 descriptors substituted both digests equal the previous pins (scratchpad j5a/base-digests.ts); the base count 41 and the agent set digest are unchanged (the organise proposal is left out of the base like the other additions); [PR-F fE, 2026-10-17] reviewed pin move: registryDigest 4aacd63c7e0a6193 -> d5914d82d2823ddd and descriptors f1d7fe71f1056f52 -> 516d7fd99768694e because ONE base descriptor changed - sirkit.placement.propose 1.1.0 -> 1.2.0 (the optional structured intent block, directive section 8); the base count 41 and the agent set digest are unchanged (the stackup proposal is left out of the base like the other additions)
/**
 * [B20 merge] The A track added ONE descriptor after this move (`sirkit.mcp.observation-read`, A4's agent read of approved
 * external MCP servers; never MCP-exposed, and withheld from the agent unless a row names it, A4L). The base pins above
 * state B4's move, so case 2 compares them over the registry WITHOUT that one addition and pins the addition as the only [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): with B22-B's five named computations, left out the same way]
 * difference - the same reading `b20-b3-mcp-subset-move` takes.
 */
const A4_ADDITION = "sirkit.mcp.observation-read";
const B22B_ADDITIONS = ["sirkit.computation.analytical-equation", "sirkit.computation.artifact-compare", "sirkit.computation.artifact-parse", "sirkit.computation.circuit-analysis", "sirkit.computation.layout-experiment"]; const B24D2_ADDITION = "sirkit.pcb.board-page-inspect"; const baseRegistry = new ToolRegistry(SIRKIT_TOOL_CATALOG.filter((item) => item.toolId !== A4_ADDITION && !B22B_ADDITIONS.includes(item.toolId) && item.toolId !== B24D2_ADDITION && item.toolId !== PRD_ADDITION && !PRF_ADDITIONS.includes(item.toolId) && !PRM_ADDITIONS.includes(item.toolId) && !PRL_ADDITIONS.includes(item.toolId) && !PRM2_ADDITIONS.includes(item.toolId) && !PRD2_ADDITIONS.includes(item.toolId) && !PRJ5_ADDITIONS.includes(item.toolId))); // [PR-J5, 2026-10-23] and without the organise proposal too; // [PR-D d2, 2026-10-16] and without PR-D d2's three descriptors too; // [B22-B, 2026-10-01] reviewed pin move: the base is the registry without A4's and B22-B's additions, so its digests stay the base-4299067 pins; [B24-D2, 2026-10-09] and without B24-D2's paged board read (OD-213, OD-235) too; [PR-D, 2026-10-16] and without PR-D's generation proposal (OD-243) too
const STORED: MembershipRole[] = ["viewer", "commenter", "editor", "reviewer", "admin"];
const META = Object.freeze({ "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} });

function input(principal: McpBearerContext, method: "tools/list" | "tools/call", params: Record<string, unknown>, id = 7): McpBearerJsonInput {
  const name = typeof params.name === "string" ? params.name : null;
  const mcp: McpRequestHeaders = { protocolVersion: { state: "present", value: "2026-07-28" }, method: { state: "present", value: method }, name: name === null ? { state: "absent" } : { state: "present", value: name }, paramHeaderCount: 0 };
  return { principal, message: { jsonrpc: "2.0", id, method, params: { ...params, _meta: META } }, bytes: 100, mcp, meta: { method: "POST", pathname: "/api/mcp" }, signal: new AbortController().signal } as McpBearerJsonInput;
}
/** A verified principal of a member holding `stored` (one user per role, all in the harness's membership repository). */
async function principalFor(h: Harness, stored: MembershipRole): Promise<McpBearerContext> {
  const user = `user-${stored}`;
  h.repo.set({ tenantId: FIXTURE_SCOPE.tenantId, projectId: FIXTURE_SCOPE.projectId, userId: user, role: stored, state: "active", version: 1, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", auditActorId: "test" });
  return harnessPrincipal(h.repo, { user });
}
let records: McpServerRequestTrace[] = [];
/** tools/list, then tools/call on every listed name, for every stored role; the listed names and every call that answered
 *  the not_served refusal (`<mapped role>:<name>`) with the answers themselves. */
async function listedCalls(tools: ToolRegistry): Promise<{ listed: Record<string, string[]>; unserved: string[]; answers: Record<string, unknown> }> {
  const h = await readHarness({ registry: tools });
  const listed: Record<string, string[]> = {};
  const unserved: string[] = [];
  const answers: Record<string, unknown> = {};
  for (const stored of STORED) {
    const principal = await principalFor(h, stored);
    const list = await handleMcpRequest(input(principal, "tools/list", {}), { registry: tools, reads: h.deps });
    expect(list.status, stored).toBe(200);
    listed[stored] = ((await list.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name);
    for (const name of listed[stored]!) {
      records = [];
      const response = await handleMcpRequest(input(principal, "tools/call", { name, arguments: {} }), { registry: tools, reads: h.deps });
      expect(records, `${stored} ${name}`).toHaveLength(1);
      if (records[0]!.outcome === "not_served") {
        unserved.push(`${ROLE_OF[stored]}:${name}`);
        answers[`${ROLE_OF[stored]}:${name}`] = ((await response.json()) as { result: unknown }).result;
      } else {
        expect(["read_served", "read_refused", "invalid_params"], `${stored} ${name}`).toContain(records[0]!.outcome);
      }
    }
  }
  return { listed, unserved, answers };
}

beforeEach(() => {
  resetMcpReadStateForTests();
  records = [];
  setMcpServerTraceSinkFactory(() => ({ record: (trace) => { records.push(trace); } }));
});
afterEach(() => {
  resetMcpServerTraceSinkFactory();
  resetMcpReadStateForTests();
  vi.restoreAllMocks();
});

describe("[B20 B4] no proposal over MCP: the withholding move, listed means served, and the page", () => {
  it("1. the exposed list is exactly the 9 served reads and the withheld list the 2 B3 reads and the 5 proposals, sorted, frozen and disjoint; each proposal is withheld with its B4 reason and decision; the report is clean with count 9 and nothing exposed is a proposal", () => { // [B24-D2, 2026-10-09] and, since B24-D2, the paged board read: eight withheld (OD-235); assertions over WITHHELD
    expect([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]).toEqual([...SERVED_READS]);
    expect([...MCP_WITHHELD_TOOL_IDS]).toEqual(WITHHELD);
    for (const list of [INTENTIONAL_MCP_EXPOSED_TOOL_IDS, MCP_WITHHELD_TOOL_IDS]) {
      expect(Object.isFrozen(list)).toBe(true);
      expect([...list]).toEqual([...new Set(list)].sort());
    }
    for (const id of MCP_WITHHELD_TOOL_IDS) expect(INTENTIONAL_MCP_EXPOSED_TOOL_IDS, id).not.toContain(id);
    const source = read("app/lib/engineering/mcp-exposure-review.ts");
    const withheldBlock = source.slice(source.indexOf("export const MCP_WITHHELD_TOOL_IDS"));
    for (const id of PROPOSALS) {
      const comment = new RegExp(`"${id.replaceAll(".", "\\.")}",\\s+// B4 \\((OD-\\d+)\\): (.{40,})$`, "m").exec(withheldBlock);
      expect(comment, id).not.toBeNull();
      expect(comment![1], id).toBe(REASONS[id]!.od);
      expect(comment![2], id).toMatch(REASONS[id]!.fact);
    }
    const report = mcpExposureReport(registry);
    expect(report).toMatchObject({ ok: true, missing: [], unexpected: [], outsideAgentSet: [], duplicates: [], count: 9 });
    expect([...report.excludedByReason.withheld]).toEqual(WITHHELD);
    for (const id of INTENTIONAL_MCP_EXPOSED_TOOL_IDS) expect(descriptor(id).operationClass, id).toBe("read");
    for (const id of PROPOSALS) expect(mcpExclusionReason(descriptor(id)), id).toBe("withheld");
    const rows = renderMcpToolManifestCsv(registry).split(NEWLINE).slice(1, -1).map((row) => row.split(","));
    expect(rows.filter((row) => row[5] === "yes").map((row) => row[0])).toEqual([...SERVED_READS]);
    expect(rows.filter((row) => row[6] === "withheld").map((row) => row[0])).toEqual(WITHHELD);
  });

  it("2. nothing but the two lists moved: the registry digest, every descriptor and the agent set equal their base-4299067 pins, and each proposal is still an agent-exposed inert proposal the structural rule admits", () => {
    expect(baseRegistry.digest()).toBe(BASE.registryDigest);
    expect(engineeringDigest(baseRegistry.list().map((item) => [item.toolId, item.version, engineeringDigest(item)]))).toBe(BASE.descriptors);
    expect(baseRegistry.list()).toHaveLength(BASE.count);
    // the addition is the ONLY difference: one descriptor more, and it is A4's, which no MCP list names [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): with B22-B's five named computations too (OD-139), each excluded from MCP with the reason `computation`]
    expect(registry.list()).toHaveLength(BASE.count + 1 + B22B_ADDITIONS.length + 1 + 1 + PRD2_ADDITIONS.length + PRF_ADDITIONS.length + PRM_ADDITIONS.length + PRL_ADDITIONS.length + PRM2_ADDITIONS.length + PRJ5_ADDITIONS.length); // [PR-J5, 2026-10-23] + the organise proposal; [PR-M, 2026-10-18] + the two M2 commands; [PR-L, 2026-10-18] + the two PR-L commands; [PR-M, 2026-10-17] + the three PR-M commands; [PR-F fB, 2026-10-17] + the two PR-F commands; // [PR-D d2, 2026-10-16] + the two reads and the review request; // [B22-B] + the five named computations (OD-139); [B24-D2, 2026-10-09] + the paged board read; [PR-D, 2026-10-16] + the generation proposal (OD-243)
    expect(registry.list().map((item) => item.toolId).filter((id) => !baseRegistry.list().some((item) => item.toolId === id))).toEqual([...B22B_ADDITIONS, A4_ADDITION, B24D2_ADDITION, PRD_ADDITION, ...PRD2_ADDITIONS, ...PRF_ADDITIONS, ...PRM_ADDITIONS, ...PRL_ADDITIONS, ...PRM2_ADDITIONS, ...PRJ5_ADDITIONS].sort()); // [PR-J5, 2026-10-23] + the organise proposal, which MCP withholds; [PR-M, 2026-10-18] + the two M2 commands, which MCP withholds; [PR-L, 2026-10-18] + the two PR-L commands, which MCP withholds; [PR-M, 2026-10-17] + the three PR-M commands, which MCP withholds; [PR-F fB, 2026-10-17] + the two PR-F commands; // [PR-D d2, 2026-10-16] + the two reads MCP withholds and the review request no list names; // [B24-D2, 2026-10-09] + the paged board read, which MCP withholds (OD-235); [PR-D, 2026-10-16] + the generation proposal, which MCP withholds too (OD-243)
    expect([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS, ...WITHHELD]).not.toContain(A4_ADDITION);
    // [B20 merge] pin move: the A track's A4 adds one agent-exposed descriptor (sirkit.mcp.observation-read), so the
    // registry is 42 and the agent set 33; the MCP subset is unchanged at 9 (B4 withheld every proposal)
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toHaveLength(52); // [PR-J5, 2026-10-23] pin move: 51 -> 52, + the organise proposal (a sealed Tier 2 proposal, withheld from MCP: MCP stays read-only, OD-82); [PR-M, 2026-10-18] pin move: 49 -> 51, + the two M2 commands, both withheld from MCP; [PR-L, 2026-10-18] pin move: 47 -> 49, + the two PR-L commands, both withheld from MCP; [PR-M, 2026-10-17] pin move: 44 -> 47, + the three PR-M commands, all withheld from MCP; [PR-F fE, 2026-10-17] pin move: 43 -> 44, + the stackup / via-policy proposal, withheld from MCP; // [PR-F fD, 2026-10-17] pin move: 42 -> 43, + the module contract proposal, withheld from MCP; // [PR-F fB, 2026-10-17] pin move: 40 -> 42, + the two PR-F commands, both withheld from MCP; // [PR-D d2, 2026-10-16] pin move: 38 -> 40, + the Schematic to PCB preflight read and the catalog part inspection, both withheld from MCP; [B22-B, 2026-10-01] pin move: + the three named computation reads (OD-139), which no MCP list names; [B24-D2, 2026-10-09] pin move: + the paged board read (OD-213); [PR-D, 2026-10-16] pin move: + the generation proposal (OD-243), withheld from MCP
    expect(engineeringDigest([...INTENTIONAL_AGENT_EXPOSED_TOOL_IDS].filter((id) => id !== A4_ADDITION && !B22B_ADDITIONS.includes(id) && id !== B24D2_ADDITION && id !== PRD_ADDITION && !PRD2_ADDITIONS.includes(id) && !PRF_ADDITIONS.includes(id) && !PRM_ADDITIONS.includes(id) && !PRL_ADDITIONS.includes(id) && !PRM2_ADDITIONS.includes(id) && !PRJ5_ADDITIONS.includes(id)))).toBe(BASE.agentSet); // [PR-J5, 2026-10-23] and without the organise proposal
    const admitted = mcpExposureReport(registry).admitted;
    for (const id of PROPOSALS) {
      const item = descriptor(id);
      expect([item.operationClass, item.binding.status, item.sideEffects, item.agentExposed], id).toEqual(["propose", "bound-proposal", "proposal-artifact", true]);
      expect(admitted, id).toContain(id);
    }
  });

  it("3. tools/list serves reads only: for every stored role the listing holds no proposal and no withheld id, exactly the reads the role may use; the mcp channel under the most permissive context includes exactly the 9 reads", async () => {
    const h = await readHarness();
    for (const stored of STORED) {
      const principal = await principalFor(h, stored);
      const response = await handleMcpRequest(input(principal, "tools/list", {}), { reads: h.deps });
      const names = ((await response.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((tool) => tool.name);
      expect(names, stored).toEqual(SERVED_READS.filter((id) => descriptor(id).requiredRoles.includes(ROLE_OF[stored] as never)));
      for (const id of WITHHELD) expect(names, `${stored} ${id}`).not.toContain(id);
    }
    const context: DiscoveryContext = {
      tenantId: "local", projectId: "p", branchId: "main", actorId: "u1", actorRole: "project_admin",
      grantedCapabilities: ["read_project", "edit_placement", "edit_copper", "edit_zones", "edit_stackup_outline", "edit_constraints", "edit_components", "manage_protection", "run_automation", "approve_proposal", "restore_project", "migrate_project", "export_project"],
      channel: "mcp", currentRevisionDigest: "eng1-0000000000000000", lineageId: "lineage-1", currentEditor: "", selectedKinds: [...TOOL_SELECTION_KINDS],
      projectState: [...TOOL_PROJECT_STATES], availableAuthority: [...TOOL_AUTHORITY_SOURCES],
      providerCapabilities: { supportsJsonSchema: true, toolNameMaxLength: 128, maxToolCount: 64 },
      riskCeiling: "release", approvalsAvailable: ["reversible", "topology-or-geometry", "destructive", "release"], enabledFlags: [], requestedCategories: [],
      grantableCapabilities: ["edit_placement"], grantLineageId: "grant-lineage-1",
    };
    const channel = discoverTools(registry, context);
    expect(channel.included.map((item) => item.toolId).sort()).toEqual([...SERVED_READS]);
    for (const id of PROPOSALS) expect(channel.excluded.find((entry) => entry.toolId === id)?.reason, id).toBe("not_mcp_exposed");
  });

  it("4. a tools/call naming any of the five proposals, by a project_admin whose role would permit every one natively, is B2's identical -32602: the same bytes as a nonexistent id's, nothing echoed, traced unknown_tool, and no durable read", async () => {
    const h = await readHarness();
    const loadHead = vi.spyOn(h.workflow, "loadHead");
    const admin = await principalFor(h, "admin");
    const call = async (name: string): Promise<{ status: number; text: string }> => {
      const response = await handleMcpRequest(input(admin, "tools/call", { name, arguments: {} }, 9), { reads: h.deps });
      return { status: response.status, text: await response.text() };
    };
    const reference = await call("sirkit.no-such-tool");
    expect(reference.status).toBe(200);
    expect(JSON.parse(reference.text)).toMatchObject({ jsonrpc: "2.0", id: 9, error: { code: -32602 } });
    for (const name of PROPOSALS) {
      expect(descriptor(name).requiredRoles, name).toContain("project_admin");
      records = [];
      const answer = await call(name);
      expect(answer, name).toEqual(reference);
      expect(answer.text, name).not.toContain(name);
      expect(records.map((record) => [record.method, record.outcome, record.toolId]), name).toEqual([["tools/call", "unknown_tool", null]]);
    }
    expect(loadHead).not.toHaveBeenCalled();
  });

  it("5. listed means served (ratchet): every tool tools/list can return, for every role, reaches the read branch on tools/call, never not_served; a forged listing that names a proposal under a listed id passes the exposure report and the listing, is caught by this ratchet alone, and is answered by the dispatch's closed not_served branch, kept as defence", { timeout: 120_000 }, async () => {
    const served = await listedCalls(registry);
    expect(served.unserved).toEqual([]);
    expect([...new Set(Object.values(served.listed).flat())].sort()).toEqual([...SERVED_READS]);
    // the forgery: placement's proposal descriptor registered under the listed read id sirkit.pcb.via-inspect
    const placement = descriptor("sirkit.placement.propose");
    const forgedRegistry = new ToolRegistry(SIRKIT_TOOL_CATALOG.map((item) => (item.toolId === "sirkit.pcb.via-inspect" ? ({ ...placement, toolId: "sirkit.pcb.via-inspect" } as ToolDescriptor) : item)));
    expect(mcpExposureReport(forgedRegistry)).toMatchObject({ ok: true, count: 9 });
    const forgedDefinition = renderMcpToolListing(forgedRegistry).tools.find((tool) => tool.name === "sirkit.pcb.via-inspect");
    expect(forgedDefinition?._meta["dev.sirkit/operationClass"]).toBe("propose");
    // [B20 B4 review] tests-2: since no exposed tool is a proposal, this forged listing is the one place a propose-class
    // definition still renders; it must not advertise itself as read-only (placement's idempotency is `natural`, hard-coded)
    expect(forgedDefinition?.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    const forged = await listedCalls(forgedRegistry);
    expect(forged.unserved).toEqual(["pcb_editor:sirkit.pcb.via-inspect", "project_admin:sirkit.pcb.via-inspect"]);
    const refusal = { resultType: "complete", content: [{ type: "text", text: MCP_NOT_SERVED_TEXT }], isError: true, _meta: { "io.modelcontextprotocol/serverInfo": { name: "sirkit", version: "0.1.0" }, "dev.sirkit/refusal": "not_served" } };
    for (const answer of Object.values(forged.answers)) expect(answer).toEqual(refusal);
  });

  it("6. mcp-server-proposals.md states the decision's counts, the served and withheld table with each decision as the code has it, the probe table's counts, medians and extremes as its rows compute them, and each B4 suite's case count", () => {
    const page = read(PAGE);
    const counts = /The MCP subset is (\d+) tools: the (\d+) served reads; (\d+) tools are withheld: (\d+) reads and the (\d+) proposals, and B24-D2's (\d+) paged board read, and PR-D's (\d+) generation proposal and (\d+) d2 reads, and PR-F's (\d+) commands, and PR-M's (\d+) commands, and PR-L's (\d+) commands, and PR-M M2's (\d+) commands, and PR-J5's (\d+) command/.exec(page); /* [PR-J5, 2026-10-23] reviewed in-place move: and PR-J5's one (22 -> 23) */ /* [PR-M, 2026-10-18] reviewed in-place move: and section M2's two (20 -> 22) */ /* [PR-L, 2026-10-18] reviewed in-place move: and PR-L's two (18 -> 20) */ /* [PR-M, 2026-10-17] reviewed in-place move: and PR-M's three (15 -> 18) */ /* [PR-F fD, 2026-10-17] reviewed in-place move: PR-F's three (13 -> 14; the two missing-parts commands and the module contract proposal) */ /* [PR-F fB, 2026-10-17] reviewed in-place move: and PR-F's two (11 -> 13) */ // [B24-D2, 2026-10-09] reviewed in-place move (OD-235): the sentence names the third withheld category; [PR-D, 2026-10-16] reviewed in-place move (OD-243): and the fourth; [PR-D, 2026-10-17] reviewed in-place move: and PR-D d2's two withheld reads (9 -> 11)
    expect(counts?.slice(1).map(Number)).toEqual([INTENTIONAL_MCP_EXPOSED_TOOL_IDS.length, SERVED_READS.length, MCP_WITHHELD_TOOL_IDS.length, WITHHELD_READS.length, PROPOSALS.length, 1, 1, PRD2_WITHHELD.length, PRF_ADDITIONS.length, PRM_ADDITIONS.length, PRL_ADDITIONS.length, PRM2_ADDITIONS.length, PRJ5_ADDITIONS.length]);
    const table = [...page.matchAll(/^\| `(sirkit\.[a-z0-9.-]+)` \| (read|propose) \| (served|withheld) \| (B3|B4|B24-D2|PR-D|PR-D d2|PR-F|PR-M|PR-L|PR-J5) \| (—|OD-\d+) \| [^|]{10,} \|$/gm)].map((row) => ({ id: row[1]!, klass: row[2]!, mcp: row[3]!, by: row[4]!, od: row[5]! })); // [PR-D, 2026-10-16] the table admits PR-D's row (OD-243); [PR-D, 2026-10-17] and PR-D d2's two rows (no decision number: —)
    expect(table.filter((row) => row.mcp === "served").map((row) => row.id)).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS]);
    expect(table.filter((row) => row.mcp === "withheld").map((row) => row.id).sort()).toEqual([...MCP_WITHHELD_TOOL_IDS]);
    for (const row of table) {
      expect(row.klass, row.id).toBe(descriptor(row.id).operationClass);
      if (PROPOSALS.includes(row.id)) expect([row.by, row.od], row.id).toEqual(["B4", REASONS[row.id]!.od]);
      else if (WITHHELD_READS.includes(row.id)) expect([row.by, row.od], row.id).toEqual(["B3", "OD-69"]);
      else if (row.id === B24D2_ADDITION) expect([row.by, row.od], row.id).toEqual(["B24-D2", "OD-235"]); else if (row.id === PRD_ADDITION) expect([row.by, row.od], row.id).toEqual(["PR-D", "OD-243"]); else if (PRD2_WITHHELD.includes(row.id)) expect([row.by, row.od], row.id).toEqual(["PR-D d2", "—"]); else if (PRF_ADDITIONS.includes(row.id)) expect([row.by, row.od], row.id).toEqual(["PR-F", "—"]); else if (PRM_ADDITIONS.includes(row.id)) expect([row.by, row.od], row.id).toEqual(["PR-M", "—"]); else if (PRL_ADDITIONS.includes(row.id)) expect([row.by, row.od], row.id).toEqual(["PR-L", "—"]); /* [PR-L, 2026-10-18] and PR-L's two rows */ else if (PRM2_ADDITIONS.includes(row.id)) expect([row.by, row.od], row.id).toEqual(["PR-M", "—"]); /* [PR-M, 2026-10-18] and section M2's two rows */ else if (PRJ5_ADDITIONS.includes(row.id)) expect([row.by, row.od], row.id).toEqual(["PR-J5", "—"]); /* [PR-J5, 2026-10-23] and section J increment 5's row */ /* [PR-M, 2026-10-17] the table admits PR-M's three rows (no decision number: —) */ else expect([row.by, row.od], row.id).toEqual(["B3", "—"]); // [B24-D2, 2026-10-09] the table admits B24-D2's row (OD-235); [PR-D, 2026-10-16] and PR-D's (OD-243); [PR-D, 2026-10-17] and PR-D d2's two reads, by the increment with no decision number
    }
    // the probe table: each row's runs, median and maximum as its own values compute them, and the summary sentence
    const probe = [...page.matchAll(/^\| (P\d+) \| (\d+) \| (\d+) \| (unrouted|routed) \| (\d+) \| ([\d, ]+) \| (\d+) \| (\d+) \| `(b4[\w-]+)` \|$/gm)].map((row) => ({ id: row[1]!, footprints: Number(row[2]), iterations: Number(row[3]), variant: row[4]!, runs: Number(row[5]), values: row[6]!.split(",").map((value) => Number(value.trim())), median: Number(row[7]), max: Number(row[8]), log: row[9]! }));
    expect.soft(probe.length).toBeGreaterThanOrEqual(12);
    for (const row of probe) {
      const sorted = [...row.values].sort((a, b) => a - b);
      expect([row.values.length, row.median, row.max], row.id).toEqual([row.runs, sorted[Math.floor(sorted.length / 2)], sorted.at(-1)]);
    }
    // [B20 B4 review] coverage-1: the abort probe's two engine runs ran at the table's settings (candidateCount 8, 400
    // iterations, timeoutMs 15 000; log b4f-06), so they are rows and count in every tally: 16 556 ms at 25 footprints, and
    // 43 339 ms to the cancellation at 50 footprints (the first spec alone at least 42 990 ms of it)
    expect.soft(probe.filter((row) => row.log === "b4f-06").map((row) => [row.footprints, row.iterations, row.variant, row.runs, row.values])).toEqual([[25, 400, "unrouted", 1, [16556]], [50, 400, "unrouted", 1, [43339]]]);
    const values = (footprints: number, iterations: number): number[] => probe.filter((row) => row.footprints === footprints && row.iterations === iterations).flatMap((row) => row.values);
    const seconds = (ms: number): string => (ms / 1000).toFixed(1);
    const floor = values(250, 400);
    const one = values(250, 1);
    const small = values(25, 400);
    const fifty = values(50, 400);
    const summary = /At the floor \(400 iterations, 250 footprints\) (\d+) runs took ([\d.]+) to ([\d.]+) s; (\d+) run at 1 iteration took ([\d.]+) s; (\d+) runs at 25 footprints took at most ([\d.]+) s; (\d+) runs at 50 footprints took ([\d.]+) to ([\d.]+) s\./.exec(page);
    expect.soft(summary?.slice(1)).toEqual([String(floor.length), seconds(Math.min(...floor)), seconds(Math.max(...floor)), String(one.length), seconds(one[0]!), String(small.length), seconds(Math.max(...small)), String(fifty.length), seconds(Math.min(...fifty)), seconds(Math.max(...fifty))]);
    expect.soft([floor.length, one.length, small.length, fifty.length]).toEqual([12, 1, 12, 2]); // 12 at the floor, 1 at 1 iteration (the lead's record); 12 and 2 with the abort probe's runs
    // the footprint-cap statement uses the same tallies
    const cap = /25 footprints stayed at or under ([\d.]+) s over (\d+)\s+runs[^;]*; 50 footprints took ([\d.]+) and ([\d.]+) s/.exec(page);
    expect.soft(cap?.slice(1)).toEqual([seconds(Math.max(...small)), String(small.length), seconds(fifty[0]!), seconds(fifty[1]!)]);
    for (const suite of ["app/lib/mcp/server/__tests__/b20-b4-withhold-proposals.test.ts", "app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts", "app/lib/mcp/server/__tests__/b20-b4-stop-evidence.test.ts"]) {
      const cases = (read(suite).match(/^\s*it\(/gm) ?? []).length;
      expect(cases, suite).toBeGreaterThan(0);
      expect(page, suite).toContain(`| \`${suite}\` | ${cases} |`);
    }
  });

  it("7. every citation on the page resolves by content: its anchor occurs exactly once in its file, or in the body of the function it names; the lines beside them are labelled as of 4299067 and never checked", () => {
    const page = read(PAGE);
    expect(page).toMatch(/^## \d+\. Citations, as of base 4299067/m);
    const citations = pageCitations(page);
    expect(citations.length).toBeGreaterThanOrEqual(25);
    expect(citations.map((citation) => citation.id)).toEqual(citations.map((_, index) => `C${index + 1}`));
    const wrong = citations.filter((citation) => anchorOccurrences(ROOT, citation) !== 1).map((citation) => `${citation.id} ${citation.path}: ${anchorOccurrences(ROOT, citation)}`);
    expect(wrong).toEqual([]);
  });

  it("8. no stale claim that MCP lists or serves a proposal: each one outside the lead's files carries a [B20 B4] correction beside it, or is registry or route-policy text (and its generated artifact) named in the page's stale-text list with its follow-up increment; the reads page quotes B1's header as it now reads", () => {
    // [B20 B4 review] coverage-2 and regressions-4: the stale-text list named one of the four such texts
    const STALE = /B4 inert proposals|inert-proposal subset|B4 \(proposals\)/g;
    const LEAD_FILES = new Set(["artifacts/ai-control-plane-b20/README.md", "artifacts/ai-control-plane-b20/discovery.md", "artifacts/ai-control-plane-b20/mcp-client-boundary.md", "artifacts/ai-control-plane-b20/mcp-reference-notes.md"]);
    const walk = (dir: string): string[] => readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return entry.name === "__tests__" || entry.name === "node_modules" ? [] : walk(path);
      return /\.(tsx?|md|csv|json)$/.test(entry.name) ? [path] : [];
    });
    const texts = [...walk("app"), ...walk("artifacts")].filter((path) => path !== PAGE && !LEAD_FILES.has(path) && !path.startsWith("artifacts/remaining-builder-program/"));
    const corrected: string[] = [];
    const listed: string[] = [];
    for (const path of texts) {
      const text = read(path);
      for (const match of text.matchAll(STALE)) {
        if (text.slice(match.index, match.index + 240).includes("[B20 B4]")) corrected.push(path);
        else listed.push(path);
      }
    }
    const page = read(PAGE);
    const staleList = /^- \*\*Stale text left for the lead:\*\*([\s\S]*?)(?=^- \*\*|^## )/m.exec(page)?.[1] ?? "";
    // [B20 closeout, 2026-09-24] D20-30: the four listed texts (route-policy.ts, action-registry.ts and their two generated
    // CSV rows) were superseded and regenerated; nothing outside the lead's files names a proposal over MCP uncorrected
    expect.soft([...new Set(listed)].sort()).toEqual([]);
    expect.soft(staleList).toMatch(/superseded 2026-09-24 by the B20 closeout \(D20-30\)/);
    expect.soft(read("app/lib/engineering/action-registry.ts")).toContain("B4 withheld every proposal, OD-82 / OD-87, so tools/list holds reads only");
    expect.soft(read("app/lib/auth/route-policy.ts")).toContain("lists the nine-read subset only - every proposal withheld, OD-82 / OD-87");
    expect.soft([...new Set(corrected)].sort()).toEqual(["artifacts/ai-control-plane-b20/mcp-server-endpoint.md", "artifacts/ai-control-plane-b20/mcp-server-reads.md"]);
    // [B20 B4 review] regressions-5: D-13 quotes B1's header as it reads since B4, and the header says it
    const reads = read("artifacts/ai-control-plane-b20/mcp-server-reads.md").replace(/\s+/g, " ");
    expect.soft(reads).not.toContain("B1's header now says serving is B2 (endpoint), B3 (reads), B4 (proposals)");
    const quoted = /B1's header said serving is B2 \(endpoint\), B3 \(reads\), B4 \(proposals\); \[B20 B4\] it now says (serving is B2 \(endpoint\) and B3 \(reads\)), and that (B4 withheld every proposal)\./.exec(reads);
    expect.soft(quoted).not.toBeNull();
    const exposureHeader = read("app/lib/engineering/mcp-exposure.ts").split("*/")[0]!.replace(/\s*\n\s*\*\s*/g, " ");
    for (const clause of quoted?.slice(1) ?? []) expect.soft(exposureHeader).toContain(clause);
  });
});
