/**
 * [PR-D d2] The agent's Schematic → PCB preflight read, `sirkit.pcb-sync.preflight`: what the editor's Prepare PCB decides BEFORE its
 * first server call, through the SAME domain functions the editor calls, as bounded data.
 *
 *  - the descriptor: registered, valid, strict-compatible, Tier 0 (execute_direct by derivation), its example validates against its
 *    schema (an argument is refused), exposed in the reviewed list, withheld from MCP, bound to the one shared report function;
 *  - denied discovery, with the reason: no schematic (project_state_missing) at the registry AND at the run toolset; a viewer keeps
 *    it (a Tier 0 read); a run WITHOUT a board keeps it (the editor's own Prepare PCB is board-less);
 *  - UI/AI parity: the report's unresolved rows ARE `listUnresolvedInstances(sheet)` (the editor's call, byte for byte), its refusal
 *    sentence IS `unresolvedInstancesRefusal`, its labels the editor's row texts, its bind census the editor's `Boolean(...)` filter;
 *    the editor source still calls exactly those;
 *  - the happy path through the REAL gateway (and the real loop): a refused sheet and a ready sheet, the server stages as not-run
 *    data, the schematic untouched, the result's source revision the verified schematic digest;
 *  - failures returned as data: an argument, an authority-shaped argument, no schematic, a cancelled run, an over-long unresolved
 *    list (bounded, counted, never dropped silently).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { sirkitToolRegistry } from "../tool-catalog";
import { validateToolDescriptor, type ToolDescriptor } from "../tool-registry";
import { ACTION_COVERAGE_REGISTRY } from "../action-registry";
import { validateAgainstSchema } from "../tool-io-validation";
import { discoverTools } from "../tool-discovery";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, agentExposureReport } from "../agent-exposure";
import { MCP_WITHHELD_TOOL_IDS, mcpExposureReport } from "../mcp-exposure";
import { NEVER_EXPOSED_TOOL_PATTERNS } from "../granted-execution-families";
import { TIER3_FLOOR_PATTERN, decideAgentExecution, defaultAutonomySetting, permissionTierOfDescriptor } from "../permission-tiers";
import { schematicStateDigest } from "../schematic-model";
import type { ProjectRole } from "../types";
import { strictCompatibility } from "../../agent/provider-tools";
import { assembleAgentRunContext } from "../../agent/context";
import { createAgentToolGateway } from "../../agent/gateway";
import { buildRunToolset, runAgentLoop } from "../../agent/loop";
import { DEFAULT_AGENT_BUDGET, type AgentRunContext, type AgentRunEvent, type AgentStep, type ProviderAgentAdapter } from "../../agent/contracts";
import { PCB_SYNC_PREFLIGHT_BINDING, PCB_SYNC_PREFLIGHT_INPUT_EXAMPLE, PCB_SYNC_PREFLIGHT_TOOL_ID, PCB_SYNC_PREFLIGHT_VERIFICATION, resolvePcbSyncPreflightBinding } from "../../agent/pcb-sync-preflight-reads";
import { MAX_PREFLIGHT_REPORT_ROWS, PCB_SYNC_PREFLIGHT_REPORT_SCHEMA, buildPcbSyncPreflightReport, type PcbSyncPreflightReport } from "../../pcb-sync/preflight-read";
import { UNRESOLVED_MISSING_LABEL, UNRESOLVED_REVIEW_PATH, listUnresolvedInstances, unresolvedInstancesRefusal } from "../../pcb-sync/unresolved-instances";
import { createEmptyBoard } from "../../pcb/types";

const registry = sirkitToolRegistry();
const KNOWN = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
const TOOL = PCB_SYNC_PREFLIGHT_TOOL_ID;
const descriptor = (): ToolDescriptor => registry.get(TOOL)!;
const SCOPE = { tenantId: "local", projectId: "p-prd-preflight", branchId: "main" };
const HEAD_MARK = { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" };

/** The editor's own refusal cases, on one sheet: a resolved instance, one without a revision, one without its symbol asset, a Theory
 *  resistor (physical: refused) and a Theory ground (a stimulus: never on the board, never a blocker). */
const MIXED_SHEET: SchematicState = {
  components: [
    { id: "r9", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k", refDes: "R9" },
    { id: "g1", type: "ground", x: 100, y: 200, rotation: 0, value: "" },
  ],
  wires: [], netLabels: [],
  kicadComponents: [
    { id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "NE555", atomicPartRevisionId: "rev-u1", symbolAssetVersionId: "sym-u1" },
    { id: "r10-id", partId: "lib:part-r", x: 300, y: 200, rotation: 0, refDes: "R10", value: "1k" },
    { id: "c1-id", partId: "lib:part-c", x: 300, y: 300, rotation: 0, refDes: "C1", value: "100n", atomicPartRevisionId: "rev-c1" },
  ],
} as unknown as SchematicState;
/** Every physical instance carries a published revision and its symbol asset: the editor would go on to the server stages. */
const READY_SHEET: SchematicState = {
  components: [{ id: "g1", type: "ground", x: 100, y: 200, rotation: 0, value: "" }],
  wires: [], netLabels: [],
  kicadComponents: [
    { id: "u1-id", partId: "lib:part-a", x: 300, y: 100, rotation: 0, refDes: "U1", value: "NE555", atomicPartRevisionId: "rev-u1", symbolAssetVersionId: "sym-u1" },
    { id: "r1-id", partId: "lib:part-r", x: 300, y: 200, rotation: 0, refDes: "R1", value: "1k", atomicPartRevisionId: "rev-r1", symbolAssetVersionId: "sym-r1" },
  ],
} as unknown as SchematicState;

interface ContextOptions { schematic?: SchematicState | null; headMark?: boolean; role?: ProjectRole; board?: boolean }
function contextFor(options: ContextOptions = {}): AgentRunContext {
  const assembly = assembleAgentRunContext({
    ...SCOPE,
    ...(options.schematic === null ? {} : { schematic: options.schematic ?? MIXED_SHEET }),
    ...(options.board === false ? {} : { board: createEmptyBoard() }),
    ...(options.headMark === false ? {} : { schematicHeadMark: HEAD_MARK }),
    verifiedActor: { principalId: "u-1", actorRole: options.role ?? "pcb_editor", membershipRevision: "mbr1-a", authMethod: "local_dev" },
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
const reasonFor = (context: AgentRunContext): string => {
  const result = discoverTools(registry, context.discovery);
  if (result.included.some((item) => item.toolId === TOOL)) return "included";
  return result.excluded.find((item) => item.toolId === TOOL)?.reason ?? "absent";
};
const offered = (context: AgentRunContext, warnings: string[] = []): string[] => buildRunToolset(registry, context, (message) => { warnings.push(message); }).declarations.map((declaration) => declaration.toolId);
const gateway = () => createAgentToolGateway(registry, { now: () => 1_760_000_000_000 });
const invoke = (context: AgentRunContext, args: Record<string, unknown>, timeoutMs = 5_000, signal?: AbortSignal) =>
  gateway().invoke({ runId: "run-prd-preflight", provider: "openai", callId: "call-pf-1", toolId: TOOL, version: "1.0.0", args, context, timeoutMs, ...(signal ? { signal } : {}) });
const reportOf = (outcome: Awaited<ReturnType<ReturnType<typeof gateway>["invoke"]>>): PcbSyncPreflightReport => {
  if (outcome.kind !== "read") throw new Error(`not a read: ${JSON.stringify(outcome)}`);
  return outcome.output.report as PcbSyncPreflightReport;
};

describe("PR-D d2 pcb-sync.preflight — the descriptor", () => {
  it("is registered, valid and strict-compatible: a Tier 0 read over the verified schematic (no board), bound to the one shared report function, exposed and MCP-withheld", () => {
    const d = descriptor();
    expect(validateToolDescriptor(d, KNOWN)).toEqual([]);
    expect(d).toMatchObject({
      version: "1.0.0", lifecycle: "active", owningCommandId: "pcb.sync-durable", category: "validation", operationClass: "read", sideEffects: "none", approvalTier: "none",
      requiredCapability: "read_project", requiredRoles: ["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"], requiredProjectState: ["schematic-present"], requiredAuthority: ["local-working-copy"],
      requiresExpectedRevision: false, requiresLineage: false, discovery: "discoverable", callability: "callable", agentExposed: true, budgetClass: "interactive",
      binding: { status: "bound-read", module: PCB_SYNC_PREFLIGHT_BINDING.module, symbol: PCB_SYNC_PREFLIGHT_BINDING.symbol },
    });
    expect(strictCompatibility(d).ok).toBe(true);
    expect(resolvePcbSyncPreflightBinding(d)).toEqual({ state: "resolved" });
    expect(resolvePcbSyncPreflightBinding({ ...d, binding: { status: "bound-read", module: "app/lib/engineering/schematic-read.ts", symbol: "inspectSchematicState" } }).state).toBe("not_callable");
    expect(resolvePcbSyncPreflightBinding(registry.get("sirkit.schematic.inspect")!).state).toBe("not_callable");
    expect(permissionTierOfDescriptor(d)).toBe(0);
    expect(decideAgentExecution({ tier: 0, setting: defaultAutonomySetting(SCOPE), actorRole: "viewer", explicitUserRequest: false })).toMatchObject({ decision: "execute_direct", requiresHumanApproval: false });
    expect(TIER3_FLOOR_PATTERN.test(TOOL)).toBe(false);
    for (const pattern of NEVER_EXPOSED_TOOL_PATTERNS) expect(pattern.test(TOOL), String(pattern)).toBe(false);
    expect(ACTION_COVERAGE_REGISTRY.find((record) => record.id === "pcb.sync-durable")).toMatchObject({ kind: "mutate", approvalTier: "topology-or-geometry" });
    // the example validates; an argument is refused by the schema
    expect(validateAgainstSchema(PCB_SYNC_PREFLIGHT_INPUT_EXAMPLE, d.inputSchema)).toEqual([]);
    expect(validateAgainstSchema({ apply: true }, d.inputSchema)).toEqual(["$.apply: unknown field"]);
    expect(d.description).toContain("Example input: {}");
    expect(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS).toContain(TOOL);
    expect(agentExposureReport(registry)).toMatchObject({ ok: true, missing: [], unexpected: [], classViolations: [], executionViolations: [] });
    expect(MCP_WITHHELD_TOOL_IDS).toContain(TOOL);
    const mcp = mcpExposureReport(registry);
    expect(mcp.ok).toBe(true);
    expect(mcp.excludedByReason.withheld).toContain(TOOL);
  });
});

describe("PR-D d2 pcb-sync.preflight — denied discovery, with the reason, at the registry and at the run", () => {
  it("a verified schematic: included and offered - WITHOUT a board too (the editor's Prepare PCB is board-less), and to a viewer (a Tier 0 read)", () => {
    expect(reasonFor(contextFor())).toBe("included");
    expect(offered(contextFor())).toContain(TOOL);
    const boardless = contextFor({ board: false });
    expect(boardless.canonicalState).toBeNull();
    expect(reasonFor(boardless)).toBe("included");
    expect(offered(boardless)).toContain(TOOL);
    expect(offered(boardless)).not.toContain("sirkit.schematic.inspect"); // the B05 canonical-state reads still need the board
    expect(reasonFor(contextFor({ role: "viewer" }))).toBe("included");
    expect(offered(contextFor({ role: "viewer" }))).toContain(TOOL);
    expect(reasonFor(contextFor({ headMark: false }))).toBe("included"); // no lineage requirement: the read seals nothing
  });

  it("no schematic for the run: project_state_missing at the registry; withheld at the run with the reason", () => {
    const context = contextFor({ schematic: null });
    expect(context.schematic).toBeNull();
    expect(reasonFor(context)).toBe("project_state_missing");
    const warnings: string[] = [];
    expect(offered(context, warnings)).not.toContain(TOOL);
  });
});

describe("PR-D d2 pcb-sync.preflight — UI/AI parity: the report is the editor's own decision", () => {
  it("the unresolved rows ARE listUnresolvedInstances(sheet) with the editor's labels and review paths; the refusal IS unresolvedInstancesRefusal; the census is the editor's bind filter", () => {
    const report = buildPcbSyncPreflightReport(MIXED_SHEET);
    const editorRows = listUnresolvedInstances(MIXED_SHEET);
    expect(editorRows.map((row) => row.refDes)).toEqual(["C1", "R9", "R10"]); // natural order, as the editor's list
    expect(report.unresolved.rows.map(({ missingLabel, ...row }) => { void missingLabel; return row; })).toEqual(editorRows);
    expect(report.unresolved.rows.map((row) => row.missingLabel)).toEqual(editorRows.map((row) => UNRESOLVED_MISSING_LABEL[row.missing]));
    for (const row of report.unresolved.rows) expect(row.reviewPath).toBe(UNRESOLVED_REVIEW_PATH[row.missing]);
    expect(report.unresolved).toMatchObject({ count: 3, truncated: 0 });
    expect(report.refusal).toBe(unresolvedInstancesRefusal(editorRows));
    expect(report.status).toBe("refused_unresolved_instances");
    expect(report.instances).toEqual({ kicad: 3, kicadWithPublishedRevision: 2, theoryPhysical: 1, theoryStimulus: 1 });
    expect(report.instances.kicadWithPublishedRevision).toBe((MIXED_SHEET.kicadComponents ?? []).filter((k) => Boolean(k.atomicPartRevisionId)).length);
    expect(report.serverPreparation.map((stage) => [stage.stage, stage.state])).toEqual([["bindings", "not_run"], ["publication", "not_run"], ["preflight", "not_run"]]);
    expect(report.sessionGate.state).toBe("not_evaluated");
    expect(report.schema).toBe(PCB_SYNC_PREFLIGHT_REPORT_SCHEMA);
  });

  it("the editor still calls exactly these functions before its first server call, and the report module imports them from the same module (no second checker)", () => {
    const editor = readFileSync(resolve(process.cwd(), "app/components/pcb/PcbEditor.tsx"), "utf8");
    expect(editor).toContain("const unresolved = listUnresolvedInstances(s);");
    expect(editor).toContain("setToast(unresolvedInstancesRefusal(unresolved));");
    expect(editor).toContain("Boolean(k.atomicPartRevisionId)");
    expect(editor).toMatch(/import \{ listUnresolvedInstances, unresolvedInstancesRefusal, type UnresolvedInstance \} from "@\/app\/lib\/pcb-sync\/unresolved-instances"/); // [PR-F, 2026-10-17] pin move: UNRESOLVED_MISSING_LABEL is rendered by app/components/pcb/MissingPartsList.tsx now (the checklist rows); the editor still decides with the same two functions
    const report = readFileSync(resolve(process.cwd(), "app/lib/pcb-sync/preflight-read.ts"), "utf8");
    expect(report).toContain('import { listUnresolvedInstances, unresolvedInstancesRefusal, UNRESOLVED_MISSING_LABEL, type UnresolvedInstance } from "./unresolved-instances";');
    expect(report).not.toMatch(/fetch\(|getDb|process\.env|window\./);
  });

  it("a ready sheet: no refusal, the server stages still not run (not checked is not a pass)", () => {
    const report = buildPcbSyncPreflightReport(READY_SHEET);
    expect(report.status).toBe("ready_for_server_preparation");
    expect(report.refusal).toBeNull();
    expect(report.unresolved).toEqual({ count: 0, rows: [], truncated: 0 });
    expect(report.instances).toEqual({ kicad: 2, kicadWithPublishedRevision: 2, theoryPhysical: 0, theoryStimulus: 1 });
    expect(report.serverPreparation.every((stage) => stage.state === "not_run")).toBe(true);
    expect(report.note).toContain("did not run");
  });

  it("an over-long unresolved list is bounded and counted, never dropped silently", () => {
    const many: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: Array.from({ length: MAX_PREFLIGHT_REPORT_ROWS + 50 }, (_, index) => ({ id: `k${index}`, partId: "lib:part-r", x: 0, y: 0, rotation: 0, refDes: `R${index + 1}`, value: "1k" })) } as unknown as SchematicState;
    const report = buildPcbSyncPreflightReport(many);
    expect(report.unresolved.rows).toHaveLength(MAX_PREFLIGHT_REPORT_ROWS);
    expect(report.unresolved).toMatchObject({ count: MAX_PREFLIGHT_REPORT_ROWS + 50, truncated: 50 });
    expect(report.refusal).toContain(`${MAX_PREFLIGHT_REPORT_ROWS + 50} part(s)`);
  });
});

describe("PR-D d2 pcb-sync.preflight — the happy path through the real gateway and the real loop", () => {
  it("the gateway answers the editor's decision as a read: the report equals the pure report over the run's schematic, the source revision is the verified schematic digest, the schematic is untouched", async () => {
    const context = contextFor({ board: false });
    const before = schematicStateDigest(MIXED_SHEET);
    const outcome = await invoke(context, {});
    expect(outcome).toMatchObject({ kind: "read", ok: true, toolId: TOOL, version: "1.0.0", verification: PCB_SYNC_PREFLIGHT_VERIFICATION, sourceRevisionDigest: before });
    expect(reportOf(outcome)).toEqual(buildPcbSyncPreflightReport(MIXED_SHEET));
    expect(schematicStateDigest(context.schematic!)).toBe(before);
    const ready = await invoke(contextFor({ schematic: READY_SHEET }), {});
    expect(reportOf(ready).status).toBe("ready_for_server_preparation");
  });

  it("through the loop: the model's call yields tool_finished succeeded and the result's data (the refusal, the rows, the not-run stages); nothing else is emitted", async () => {
    const context = contextFor({ board: false });
    const events: AgentRunEvent[] = [];
    const continuations: string[][] = [];
    const step = (toolCalls: AgentStep["toolCalls"], text = ""): AgentStep => ({ text, toolCalls, stopReason: toolCalls.length > 0 ? "tool_use" : "completed", usage: { inputTokens: 3, outputTokens: 5 }, model: "scripted", continuation: { provider: "openai", state: null } });
    const adapter: ProviderAgentAdapter = {
      provider: "openai",
      async start(input) {
        const tool = input.tools.find((declaration) => declaration.toolId === TOOL);
        expect(tool, "the preflight read is offered to the model").toBeDefined();
        return step([{ callId: "call-1", providerName: tool!.providerName, argumentsText: "{}" }]);
      },
      async continueWith(input) {
        continuations.push(input.results.map((result) => result.outputText));
        return step([], "Three parts block Prepare PCB.");
      },
    };
    const result = await runAgentLoop(
      { runId: "run-prd-preflight-loop", provider: "openai", history: [], userMessage: "What blocks Prepare PCB?", budget: DEFAULT_AGENT_BUDGET },
      { adapter, gateway: gateway(), registry, context, system: "test", emit: (event) => { events.push(event); } },
    );
    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(result.toolCalls).toBe(1);
    expect(events.filter((event) => event.type === "tool_finished").map((event) => (event as { status: string; ok: boolean }).status)).toEqual(["succeeded"]);
    expect(events.some((event) => event.type === "proposal_ready" || event.type === "pcb_proposal_ready" || event.type === "generation_task_ready" || event.type === "execution_grant_ready")).toBe(false); // [PR-L, 2026-10-18] pin move (runbook L.5): the generation's event is generation_task_ready since generate-proposal 2.0.0 (the v1 generation_proposal_ready was removed with the in-turn path); the same "no artifact" assertion
    const told = JSON.parse(continuations[0]![0]!) as { ok: boolean; output: { report: PcbSyncPreflightReport } };
    expect(told.ok).toBe(true);
    expect(told.output.report.status).toBe("refused_unresolved_instances");
    expect(told.output.report.unresolved.rows.map((row) => row.refDes)).toEqual(["C1", "R9", "R10"]);
    expect(told.output.report.serverPreparation.every((stage) => stage.state === "not_run")).toBe(true);
  });
});

describe("PR-D d2 pcb-sync.preflight — failures are returned as data; nothing is ever changed", () => {
  it("an argument (even a harmless one) and an authority-shaped argument refuse invalid_input; no schematic refuses authority_unavailable; a cancelled run refuses cancelled", async () => {
    const context = contextFor();
    const extra = await invoke(context, { verbose: true });
    expect(extra).toMatchObject({ kind: "refused", status: "invalid_input", diagnostics: [expect.stringContaining("takes no arguments")] });
    for (const key of ["apply", "bind", "publish", "preflight", "scope", "board"]) {
      const outcome = await invoke(context, { [key]: true });
      expect(outcome, key).toMatchObject({ kind: "refused", status: "invalid_input", diagnostics: [expect.stringContaining("authority-shaped")] });
    }
    expect(await invoke(contextFor({ schematic: null }), {})).toMatchObject({ kind: "refused", status: "authority_unavailable" });
    const aborted = new AbortController();
    aborted.abort();
    expect(await invoke(context, {}, 5_000, aborted.signal)).toMatchObject({ kind: "refused", status: "cancelled" });
    expect(schematicStateDigest(context.schematic!)).toBe(schematicStateDigest(MIXED_SHEET));
  });

  it("a tampered context (the schematic changed after assembly) is refused context_integrity before the report is built", async () => {
    const context = contextFor();
    (context.schematic as { kicadComponents: unknown[] }).kicadComponents.push({ id: "x", partId: "lib:x", x: 0, y: 0, rotation: 0, refDes: "X1", value: "" });
    expect(await invoke(context, {})).toMatchObject({ kind: "refused", status: "context_integrity" });
  });
});
