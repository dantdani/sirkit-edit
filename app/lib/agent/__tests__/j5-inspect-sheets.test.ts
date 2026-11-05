/**
 * [PR-J, 2026-10-22] Runbook J.6.7, increment J5-1 (OD-255 item 9): the chat's task inspection exposes a planned result's sheet set as a
 * READ-ONLY bounded summary (app/lib/agent/generation-proposals.ts `resultSummaryOf`), shortened by the existing `fitInspectionBound`:
 *
 *  1. a result with sheets: the overview, each sheet's name, status and component COUNT (never its reference designators or the netlist),
 *     its ports and rails, the interfaces between sheets, the project rails and the findings;
 *  2. a one-page result shows why it stayed on one page; a result without sheets, or with a malformed set, adds no `sheets` key;
 *  3. the largest sheet set a result may hold (8 sheets, 16 ports each, 128-character nets, 20 findings) is shortened to fit the bound -
 *     findings, per-sheet rails and ports, then trailing interfaces (counted) - and marked `truncated`, every sheet still named.
 * The real gateway and inspection service over a fake task port (no store, no provider, no database, no network).
 *
 * [PR-J5, 2026-10-23] extended (runbook J.6.7, OD-259): 4. `sirkit.schematic.inspect` 1.2.0 through the SAME real gateway and its
 * registered B05 read binding - the validated arguments reach the read (tool-bindings-readonly.ts passes them to
 * inspectSchematicState): `{}` answers the 1.1.0 bytes over the multi-sheet J3 drone (no sheet key), `{ sheetId }` one sheet's bounded
 * summary with the tree, `{ sheetId, neighbours: true }` the joined ports; an unknown key, a non-string sheetId and a 1.1.0 call refuse.
 */
import { describe, expect, it } from "vitest";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import { createEmptyBoard } from "../../pcb/types";
import { assembleAgentRunContext } from "../context";
import { createAgentToolGateway } from "../gateway";
import type { AgentRunContext, GatewayInvocationOutcome } from "../contracts";
import type { SchematicGenerationPort } from "../generation-proposals";
import { GENERATION_TASK_INSPECT_MAX_CHARS, GENERATION_TASK_INSPECT_TOOL_ID } from "../generation-task-tools";
import { GENERATION_SHEETS_SCHEMA, readGeneratedSheets, type GeneratedSheets } from "../../schematic/generated-sheets";
import { inspectSchematicState } from "../../engineering/schematic-read"; // [PR-J5, 2026-10-23] case 4
import { multiSheetDroneFixtureState } from "../../schematic/__tests__/_j3-fixtures";

const registry = sirkitToolRegistry();
const T0 = Date.parse("2026-10-22T09:00:00.000Z");
const TASK_ID = `generation-task:${"cd".repeat(16)}`;
const RESULT_DIGEST = `dw1-${"f".repeat(64)}`;

function snapshot(): Record<string, unknown> {
  return {
    schema: "sirkit.generation-task-snapshot.v1", taskId: TASK_ID, scope: { tenantId: "local", projectId: "proj-1", branchId: "main" },
    state: "awaiting-review", terminal: false, phase: "review", origin: "chat", provider: "openai", createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(), serverNow: new Date(T0).toISOString(),
    liveness: "idle", plan: { planner: "planned", rationale: "Two blocks.", assumptions: [], blocks: [] }, blocker: null, failure: null, usage: { modelCalls: 9, catalogSearches: 12 }, allowance: { units: 1 }, base: null,
    result: { status: "complete", omittedBlocks: [], resultDigest: RESULT_DIGEST }, review: null, control: { cancelRequested: false }, actions: ["record-review"], retryBlocks: [], eventCursor: "e-1", activity: [],
  };
}
function result(sheets?: unknown): Record<string, unknown> {
  return {
    status: "complete", omittedBlocks: [], netlist: { components: [{ refDes: "U1" }, { refDes: "U2" }, { refDes: "R7" }], connections: [{}, {}] }, explanation: "x",
    electricalCheck: { state: "passed", criticalCount: 0, warningCount: 0 }, resultDigest: RESULT_DIGEST, ...(sheets !== undefined ? { sheets } : {}),
  };
}
function port(task: Record<string, unknown>, answer: Record<string, unknown>): SchematicGenerationPort {
  return { durability: "durable", start: async () => ({ status: 500, body: {} }), list: async () => ({ status: 200, body: { active: task, recent: [] } }), inspect: async () => ({ status: 200, body: { task, result: answer } }) };
}
function context(): AgentRunContext {
  const assembly = assembleAgentRunContext({
    tenantId: "local", projectId: "proj-1", branchId: "main", schematic: { components: [], wires: [], netLabels: [], kicadComponents: [], pageSize: "A4" }, board: createEmptyBoard(),
    schematicHeadMark: { lineageId: "lin1-a9e2470c11bd8833", headSequence: 3, canonicalStateDigest: "eng1-77aa66bb55cc44dd" },
    verifiedActor: { principalId: "u1", actorRole: "pcb_editor", membershipRevision: "mbr1-j5", authMethod: "local_dev" }, schematicGenerationAvailable: true,
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function inspect(answer: Record<string, unknown>): Promise<Record<string, any>> {
  const gateway = createAgentToolGateway(registry, { schematicGeneration: port(snapshot(), answer), now: () => T0 });
  const outcome: GatewayInvocationOutcome = await gateway.invoke({ runId: "run-j5-inspect", provider: "openai", callId: "call-1", toolId: GENERATION_TASK_INSPECT_TOOL_ID, version: registry.get(GENERATION_TASK_INSPECT_TOOL_ID)!.version, args: { taskId: TASK_ID }, context: context(), timeoutMs: 10_000 });
  if (outcome.kind !== "read") throw new Error(`read expected: ${JSON.stringify(outcome).slice(0, 300)}`);
  expect(JSON.stringify(outcome.output).length).toBeLessThanOrEqual(GENERATION_TASK_INSPECT_MAX_CHARS);
  return (outcome.output as { report: Record<string, unknown> }).report;
}

const SMALL: GeneratedSheets = {
  schema: GENERATION_SHEETS_SCHEMA,
  sheets: {
    root: { sheetKey: "overview", name: "System overview" },
    children: [
      { sheetKey: "b1", name: "Power", status: "designed", components: ["U1"], ports: [{ portKey: "b1:PG", net: "PG", direction: "output", state: "bound" }], rails: [{ net: "+3V3", kind: "power" }, { net: "GND", kind: "ground" }], localNets: [] },
      { sheetKey: "b2", name: "MCU", status: "designed", components: ["U2", "R7"], ports: [{ portKey: "b2:PG", net: "PG", direction: "input", state: "bound" }], rails: [{ net: "+3V3", kind: "power" }], localNets: ["RESET", "LED_A"] },
      { sheetKey: "b3", name: "Barometer", status: "omitted", components: [], ports: [], rails: [{ net: "+3V3", kind: "power" }], localNets: [] },
    ],
    interfaces: [{ net: "PG", ports: ["b1:PG", "b2:PG"], state: "bound" }],
    rails: [{ net: "+3V3", kind: "power", sheets: ["b1", "b2", "b3"] }, { net: "GND", kind: "ground", sheets: ["b1"] }],
  },
  findings: ["Barometer was not designed."],
};

describe("[PR-J J5-1] the task inspection's sheet summary", () => {
  it("1. a result with sheets: names, statuses, component counts, ports, rails, interfaces and findings - never the reference designators", async () => {
    const report = await inspect(result(SMALL));
    expect(report).not.toHaveProperty("truncated");
    expect(report.result.sheets).toEqual({
      layout: "sheets", overview: "System overview",
      sheets: [
        { sheetKey: "b1", name: "Power", status: "designed", components: 1, localNets: 0, ports: [{ net: "PG", direction: "output", state: "bound" }], rails: ["+3V3", "GND"] },
        { sheetKey: "b2", name: "MCU", status: "designed", components: 2, localNets: 2, ports: [{ net: "PG", direction: "input", state: "bound" }], rails: ["+3V3"] },
        { sheetKey: "b3", name: "Barometer", status: "omitted", components: 0, localNets: 0, ports: [], rails: ["+3V3"] },
      ],
      interfaces: [{ net: "PG", sheets: ["b1", "b2"], state: "bound" }],
      rails: [{ net: "+3V3", kind: "power", sheets: ["b1", "b2", "b3"] }, { net: "GND", kind: "ground", sheets: ["b1"] }],
      findings: ["Barometer was not designed."],
    });
    expect(JSON.stringify(report.result.sheets)).not.toMatch(/"(U1|U2|R7|RESET|LED_A)"/);
    expect(report.result.components).toBe(3); // the existing summary is unchanged beside it
  });

  it("2. a one-page result says why; a result without sheets or with a malformed set adds no sheets key", async () => {
    const onePage = { schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: ["Kept on one page: EN is labelled in Sensor, Logic but is not a planned shared net."] };
    expect((await inspect(result(onePage))).result.sheets).toEqual({ layout: "one-page", findings: onePage.findings });
    expect((await inspect(result())).result).not.toHaveProperty("sheets");
    expect((await inspect(result({ ...SMALL, extra: 1 }))).result).not.toHaveProperty("sheets");
  });

  it("3. the largest sheet set is shortened to fit the bound and marked truncated; every sheet is still named", async () => {
    const net = (sheet: number, index: number) => `N${sheet}_${index}_`.padEnd(128, "Q");
    const children = Array.from({ length: 8 }, (_, sheet) => {
      const nets = Array.from({ length: 16 }, (_, index) => (index < 8 ? net(sheet, index) : net((sheet + 7) % 8, index - 8))); // 8 nets shared with the next sheet, 8 with the previous
      return { sheetKey: `b${sheet + 1}` as "b1", name: `Subsystem ${sheet + 1} `.padEnd(120, "s"), status: "designed" as const, components: [`U${sheet + 1}`], ports: nets.map((name) => ({ portKey: `b${sheet + 1}:${name}`, net: name, direction: "bidirectional" as const, state: "bound" as const })), rails: Array.from({ length: 4 }, (_, index) => ({ net: `RAIL_${index}_`.padEnd(128, "R"), kind: "power" as const })), localNets: [] };
    });
    const interfaces = Array.from({ length: 8 }, (_, sheet) => Array.from({ length: 8 }, (_, index) => ({ net: net(sheet, index), ports: [`b${sheet + 1}:${net(sheet, index)}`, `b${((sheet + 1) % 8) + 1}:${net(sheet, index)}`], state: "bound" as const }))).flat();
    const large: GeneratedSheets = {
      schema: GENERATION_SHEETS_SCHEMA,
      sheets: { root: { sheetKey: "overview", name: "System overview" }, children, interfaces, rails: Array.from({ length: 4 }, (_, index) => ({ net: `RAIL_${index}_`.padEnd(128, "R"), kind: "power" as const, sheets: children.map((child) => child.sheetKey) })) },
      findings: Array.from({ length: 20 }, (_, index) => `Finding ${index} `.padEnd(200, "f")),
    };
    expect(readGeneratedSheets(large)).not.toBeNull(); // a set a result may legitimately hold
    const report = await inspect(result(large));
    expect(report.truncated).toBe(true);
    expect(report.truncation).toMatch(/sheet details/);
    const summary = report.result.sheets;
    expect(summary.sheets.map((sheet: { name: string; status: string }) => [sheet.name, sheet.status])).toEqual(children.map((child) => [child.name, "designed"]));
    expect(summary.findings.length).toBeLessThanOrEqual(3);
    expect(summary.sheets.every((sheet: Record<string, unknown>) => !("ports" in sheet) && !("rails" in sheet))).toBe(true);
    expect(summary.interfaces.length + (summary.interfacesOmitted ?? 0)).toBe(64); // what was left out is counted, never silently cut
  });
});

describe("[PR-J5] 4. sirkit.schematic.inspect 1.2.0 through the real gateway: the bound read receives the validated arguments", () => {
  const SHEETED = multiSheetDroneFixtureState();
  const MARK = { lineageId: "lin1-0123456789abcdef", headSequence: 2, canonicalStateDigest: "eng1-0123456789abcdef" };
  const read = async (args: Record<string, unknown>, version = "1.2.0"): Promise<GatewayInvocationOutcome> => {
    const assembly = assembleAgentRunContext({ tenantId: "local", projectId: "proj-j5-inspect", branchId: "main", schematic: SHEETED, board: createEmptyBoard(), schematicHeadMark: MARK });
    if (!assembly.ok) throw new Error(assembly.reason);
    return createAgentToolGateway(registry).invoke({ runId: "run-j5-inspect", provider: "openai", toolId: "sirkit.schematic.inspect", version, args, context: assembly.context, timeoutMs: 3_000 });
  };
  const report = (outcome: GatewayInvocationOutcome): Record<string, unknown> => {
    if (outcome.kind !== "read" || !outcome.ok) throw new Error(`expected read, got ${JSON.stringify(outcome).slice(0, 300)}`);
    return outcome.output.report as Record<string, unknown>;
  };

  it("{} is the 1.1.0 whole-project read; sheetId is one sheet's summary beside the tree; neighbours fetches the joined ports", async () => {
    const whole = report(await read({}));
    expect(whole).toEqual(JSON.parse(JSON.stringify(inspectSchematicState(SHEETED))));
    expect(whole).not.toHaveProperty("sheets");
    expect(whole).not.toHaveProperty("sheet");
    expect((whole.components as unknown[]).length).toBe(41);
    const imu = report(await read({ sheetId: "sheet-imu" }));
    expect((imu.components as Array<{ displayRef: string }>).map((item) => item.displayRef).sort()).toEqual(["C10", "C9", "R11", "R12", "U3"]);
    expect(imu.sheet).toMatchObject({ id: "sheet-imu", name: "IMU" });
    expect(imu.sheet).not.toHaveProperty("neighbours");
    expect((imu.sheets as { tree: unknown[] }).tree).toHaveLength(4);
    const withNeighbours = report(await read({ sheetId: "sheet-imu", neighbours: true }));
    expect(withNeighbours).toEqual(JSON.parse(JSON.stringify(inspectSchematicState(SHEETED, { sheetId: "sheet-imu", neighbours: true }))));
    expect(((withNeighbours.sheet as { neighbours: Array<{ port: string }> }).neighbours).map((entry) => entry.port)).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1"]);
  });

  it("the closed input refuses an unknown key and a non-string sheetId; the retired 1.1.0 version is not registered", async () => {
    expect(await read({ sheetId: "sheet-imu", sheet: "IMU" })).toMatchObject({ kind: "refused", ok: false });
    expect(await read({ sheetId: 7 })).toMatchObject({ kind: "refused", ok: false });
    expect(await read({}, "1.1.0")).toMatchObject({ kind: "refused", status: "not_registered" });
  });
});

