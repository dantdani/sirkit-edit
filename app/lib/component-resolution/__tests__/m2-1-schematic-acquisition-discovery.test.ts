/**
 * [PR-M, 2026-10-18] Section M2 (design M2.1; runbook M.3 item 2, M.5 item 4's agent half): the schematic-scoped CAD acquisition
 * tools `sirkit.parts.acquisition-start` and `sirkit.parts.acquisition-status` over the PRODUCTION composition - the chat route's
 * real ports under the FIXTURE runtime (the container's in-memory durable repository and the committed fixture catalog; no database,
 * no provider, no embedding, no network: this suite never runs a worker slice, so no CAD source is asked anything), the real context
 * assembly, loop toolset and gateway:
 *
 *  1. a VALID schematic with NO PCB: both tools are declared and callable; the board tools and the board-gated external reads are not;
 *     the start creates (then attaches to) ONE durable task and mutates no design; the status reads it back and lists it.
 *  2. without the server's acquisition fact both tools are withheld SILENTLY (no warning line, so a run on such a server streams what
 *     it streamed before M2) and a call is authority_unavailable; a forged fact (non-boolean, or claimed beside no schematic) is refused
 *     by the context integrity check; the context assembly never derives the fact without a validated schematic.
 *  3. the closed input: authority-shaped keys (a source id, a URL, bytes, pins, a revision) are refused BY NAME, a board or any other
 *     key is refused, a non-catalog or already-resolved instance is not acquirable, a foreign or guessed task id is not_found.
 *  4. roles: a viewer may read the status but is never offered (or allowed) the start.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";

const seams = vi.hoisted(() => ({ embedded: [] as string[], fetched: [] as string[] }));
vi.mock("@/app/lib/embeddings", async (original) => ({ ...(await original() as object), embedQuery: vi.fn(async (text: string) => { seams.embedded.push(text); throw new Error("the acquisition tools must not embed"); }) }));

import { resolveCatalogInspectionPort } from "@/app/api/chat/catalog-inspection-runtime";
import { resetCadAcquisitionPortFactory, resolveCadAcquisitionPort } from "@/app/api/chat/cad-acquisition-runtime";
import { resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { DIMMER_INSTANCE_IDS, fixtureDimmerSheet } from "@/app/lib/fixture-runtime/__tests__/_resolution-sheet";
import { resetComponentResolutionRuntimeFactory } from "@/app/lib/component-resolution/task/runtime";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import { CAD_ACQUISITION_AUTHORITY_KEYS } from "@/app/lib/acquisition/cad-acquisition-contract";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { assembleAgentRunContext } from "@/app/lib/agent/context";
import { createAgentToolGateway } from "@/app/lib/agent/gateway";
import { buildRunToolset } from "@/app/lib/agent/loop";
import { schematicStateDigest } from "@/app/lib/engineering/schematic-model";
import type { AgentRunContext, GatewayInvocationOutcome } from "@/app/lib/agent/contracts";
import { CAD_ACQUISITION_START_TOOL_ID, CAD_ACQUISITION_STATUS_TOOL_ID, type CadAcquisitionPort } from "@/app/lib/agent/cad-acquisition-reads";

const START = CAD_ACQUISITION_START_TOOL_ID;
const STATUS = CAD_ACQUISITION_STATUS_TOOL_ID;
const BOARD_TOOLS = ["sirkit.pcb.board-inspect", "sirkit.pcb.board-page-inspect", "sirkit.pcb.via-inspect", "sirkit.pcb.propose-bounded-edit", "sirkit.parts.external-search", "sirkit.parts.evidence-read", "sirkit.mcp.observation-read"];
const registry = sirkitToolRegistry();
const SCOPE = { tenantId: "local", projectId: "m2-1-acquisition", branchId: "main" } as const;
/** the editor's canonical schematic head mark (the browser always sends one beside its sheet; the start, a propose-class tool, keeps the loop's B09.1 gate) */
const HEAD_MARK = { lineageId: "lin1-21a0000000000001", headSequence: 4, canonicalStateDigest: "eng1-0123456789abcdef" };

type Role = "pcb_editor" | "viewer";
function contextFor(options: { fact?: boolean; schematic?: SchematicState | null; role?: Role; projectId?: string; headMark?: boolean } = {}): AgentRunContext {
  const schematic = options.schematic === undefined ? fixtureDimmerSheet() : options.schematic;
  const assembly = assembleAgentRunContext({
    ...SCOPE, projectId: options.projectId ?? SCOPE.projectId,
    ...(schematic ? { schematic, ...(options.headMark === false ? {} : { schematicHeadMark: HEAD_MARK }) } : {}),
    verifiedActor: { principalId: "user:m2-1-editor", actorRole: options.role ?? "pcb_editor", membershipRevision: "mbr1-m2-1", authMethod: "local_dev" },
    catalogInspectionAvailable: true,
    ...(options.fact === false ? {} : { cadAcquisitionAvailable: true }),
  });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
}
function productionPort(): CadAcquisitionPort {
  const port = resolveCadAcquisitionPort(resolveCatalogInspectionPort());
  if (!port) throw new Error("the production acquisition port did not resolve under the fixture runtime");
  return port;
}
const gatewayOf = (port: CadAcquisitionPort | null) => createAgentToolGateway(registry, { catalogInspection: resolveCatalogInspectionPort()!, ...(port ? { cadAcquisition: port } : {}) });
let call = 0;
async function invoke(gateway: ReturnType<typeof gatewayOf>, context: AgentRunContext, toolId: string, args: Record<string, unknown>): Promise<GatewayInvocationOutcome> {
  call += 1;
  return gateway.invoke({ runId: "run-m2-1", provider: "openai", callId: `call-${call}`, toolId, version: registry.get(toolId)!.version, args, context, timeoutMs: 15_000 });
}
const declared = (context: AgentRunContext): { ids: string[]; warnings: string[] } => {
  const warnings: string[] = [];
  const { declarations } = buildRunToolset(registry, context, (message) => warnings.push(message));
  return { ids: declarations.map((declaration) => declaration.toolId), warnings };
};
type Report = { mode: string; attached?: boolean; tasks: Array<{ taskId: string; state: string; stage: string; targets: Array<{ componentId: string; refDes: string; symbol: string; footprint: string | null; exactMpn: string | null }>; attempts: unknown[]; candidate: unknown }>; note: string };
const reportOf = (outcome: GatewayInvocationOutcome): Report => {
  expect(outcome, JSON.stringify(outcome).slice(0, 400)).toMatchObject({ ok: true, kind: "read" });
  return (outcome as unknown as { output: { report: Report } }).output.report;
};
const refusedStatus = (outcome: GatewayInvocationOutcome): string => (outcome.ok ? "ok" : (outcome as unknown as { status: string }).status);

beforeEach(() => {
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
  vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
  vi.stubEnv("DATABASE_URL", "");
  resetFixtureContainer();
  resetComponentResolutionRuntimeFactory();
  resetCadAcquisitionPortFactory();
  resetAdmissionControl();
  seams.embedded.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => { seams.fetched.push(String(input)); throw new Error("the acquisition tools must not reach the network"); }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetFixtureContainer();
  resetComponentResolutionRuntimeFactory();
  resetCadAcquisitionPortFactory();
  resetAdmissionControl();
  expect(seams.embedded).toEqual([]);
  expect(seams.fetched).toEqual([]);
  seams.fetched.length = 0;
});

describe("[PR-M M2.1] the schematic-scoped CAD acquisition tools", () => {
  it("1. a valid schematic with no PCB: both tools are declared and callable, the board tools are not; the start creates one durable task (then attaches), mutates nothing, and the status reads it back", async () => {
    const context = contextFor();
    expect(context.canonicalState).toBeNull(); // no board anywhere in this run
    expect(context.cadAcquisitionAvailable).toBe(true);
    const { ids, warnings } = declared(context);
    expect(ids).toEqual(expect.arrayContaining([START, STATUS]));
    for (const id of BOARD_TOOLS) expect(ids, id).not.toContain(id);
    expect(warnings.filter((line) => line.includes("acquisition"))).toEqual([]);

    const port = productionPort();
    const gateway = gatewayOf(port);
    const sheetBefore = JSON.stringify(context.schematic);
    const started = reportOf(await invoke(gateway, context, START, { componentIds: [DIMMER_INSTANCE_IDS.D1, DIMMER_INSTANCE_IDS.D2], requirement: { mounting: "through_hole", packageCode: "DO-35" } }));
    expect(started.mode).toBe("start");
    expect(started.attached).toBe(false);
    expect(started.tasks).toHaveLength(1);
    const task = started.tasks[0]!;
    expect(task.taskId).toMatch(/^cr-task:[0-9a-f]{32}$/);
    expect(task.targets.map((target) => target.refDes)).toEqual(["D1", "D2"]);
    expect(task.targets[0]).toMatchObject({ symbol: "Diode:1N4148", footprint: "Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal", exactMpn: "1N4148" });
    expect(task.attempts).toEqual([]); // the start retrieves nothing: the worker's slices do
    expect(task.candidate).toBeNull();
    expect(started.note).toMatch(/NOTHING in the design has changed/);
    expect(JSON.stringify(context.schematic)).toBe(sheetBefore);
    expect(schematicStateDigest(context.schematic!)).toBe(context.schematicDigest);

    // a retried call attaches to the same task (idempotent on scope, principal, instances, requirement and schematic base)
    const again = reportOf(await invoke(gateway, context, START, { componentIds: [DIMMER_INSTANCE_IDS.D1, DIMMER_INSTANCE_IDS.D2], requirement: { mounting: "through_hole", packageCode: "DO-35" } }));
    expect(again.attached).toBe(true);
    expect(again.tasks[0]!.taskId).toBe(task.taskId);

    const read = reportOf(await invoke(gateway, context, STATUS, { taskId: task.taskId }));
    expect(read.mode).toBe("status");
    expect(read.tasks.map((item) => item.taskId)).toEqual([task.taskId]);
    expect(read.tasks[0]!.state).toBe(task.state);
    const listed = reportOf(await invoke(gateway, context, STATUS, {}));
    expect(listed.tasks.map((item) => item.taskId)).toEqual([task.taskId]);
    // the page route's own service reads the same task
    const direct = await port.read(SCOPE, task.taskId);
    expect(direct.status).toBe(200);
    expect((direct.body.task as { taskId: string }).taskId).toBe(task.taskId);
  });

  it("2. without the server's fact both tools are withheld silently and refused; a forged fact is a context integrity failure; the assembly never derives the fact without a schematic", async () => {
    const without = contextFor({ fact: false });
    expect(without.cadAcquisitionAvailable).toBeUndefined();
    const { ids, warnings } = declared(without);
    expect(ids).not.toContain(START);
    expect(ids).not.toContain(STATUS);
    expect(warnings.filter((line) => line.includes("acquisition"))).toEqual([]);
    const gateway = gatewayOf(productionPort());
    expect(refusedStatus(await invoke(gateway, without, STATUS, {}))).toBe("authority_unavailable");
    expect(refusedStatus(await invoke(gateway, without, START, { componentIds: [DIMMER_INSTANCE_IDS.D1] }))).toBe("authority_unavailable");

    // no port bound at all (normal mode without DATABASE_URL): the route's resolver answers null and the gateway refuses
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "");
    resetComponentResolutionRuntimeFactory();
    expect(resolveCadAcquisitionPort(resolveCatalogInspectionPort())).toBeNull();
    vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
    resetComponentResolutionRuntimeFactory();
    expect(refusedStatus(await invoke(gatewayOf(null), contextFor(), STATUS, {}))).toBe("authority_unavailable");

    // the assembly derives the fact only beside a validated schematic (no board makes it true)
    const noSheet = contextFor({ schematic: null });
    expect(noSheet.cadAcquisitionAvailable).toBeUndefined();
    expect(declared(noSheet).ids).not.toContain(START);
    // forged facts on an assembled context are refused before any port is asked
    const valid = contextFor();
    const forgedNoSheet = { ...noSheet, cadAcquisitionAvailable: true } as AgentRunContext;
    const forgedShape = { ...valid, cadAcquisitionAvailable: "yes" as unknown as boolean } as AgentRunContext;
    for (const forged of [forgedNoSheet, forgedShape]) {
      const outcome = await invoke(gateway, forged, STATUS, {});
      expect(["context_integrity", "authority_unavailable"]).toContain(refusedStatus(outcome));
    }
    expect(refusedStatus(await invoke(gateway, forgedShape, STATUS, {}))).toBe("context_integrity");
  });

  it("3. the closed input: authority-shaped keys are refused by name, any other key is refused, a non-acquirable instance is refused, a foreign or guessed task id is not_found", async () => {
    const context = contextFor();
    const gateway = gatewayOf(productionPort());
    for (const key of ["sourceId", "url", "bytes", "pins", "revisionId"]) {
      expect(CAD_ACQUISITION_AUTHORITY_KEYS, key).toContain(key);
      const outcome = await invoke(gateway, context, START, { componentIds: [DIMMER_INSTANCE_IDS.D1], [key]: key === "pins" ? [{ number: "1" }] : "x" });
      expect(refusedStatus(outcome), key).toBe("invalid_input");
      expect(JSON.stringify(outcome), key).toContain("authority-shaped");
    }
    for (const args of [{ componentIds: [DIMMER_INSTANCE_IDS.D1], board: { footprints: [] } }, { componentIds: [DIMMER_INSTANCE_IDS.D1], schematic: {} }, { taskId: "cr-task:0123456789abcdef0123456789abcdef", projectId: "other" }]) {
      const toolId = "taskId" in args ? STATUS : START;
      expect(refusedStatus(await invoke(gateway, context, toolId, args)), JSON.stringify(args)).toBe("invalid_input");
    }
    // U1 already has a published exact revision; a reference designator is not an instance id; two different catalog parts are two acquisitions
    expect(refusedStatus(await invoke(gateway, context, START, { componentIds: [DIMMER_INSTANCE_IDS.U1] }))).toBe("invalid_input");
    expect(refusedStatus(await invoke(gateway, context, START, { componentIds: ["D1"] }))).toBe("invalid_input");
    expect(refusedStatus(await invoke(gateway, context, START, { componentIds: [DIMMER_INSTANCE_IDS.D1, DIMMER_INSTANCE_IDS.R1] }))).toBe("invalid_input");
    // a task of another project is the uniform not_found; a guessed id too; a malformed id is invalid
    const other = contextFor({ projectId: "m2-1-other-project" });
    const started = reportOf(await invoke(gateway, other, START, { componentIds: [DIMMER_INSTANCE_IDS.D1] }));
    const foreignId = started.tasks[0]!.taskId;
    expect(refusedStatus(await invoke(gateway, context, STATUS, { taskId: foreignId }))).toBe("not_found");
    expect(refusedStatus(await invoke(gateway, context, STATUS, { taskId: "cr-task:ffffffffffffffffffffffffffffffff" }))).toBe("not_found");
    expect(refusedStatus(await invoke(gateway, context, STATUS, { taskId: "../other" }))).toBe("invalid_input");
    expect(reportOf(await invoke(gateway, context, STATUS, {})).tasks).toEqual([]);
  });

  it("4. a viewer may read the status but is never offered or allowed the start", async () => {
    const viewer = contextFor({ role: "viewer" });
    const { ids } = declared(viewer);
    expect(ids).toContain(STATUS);
    expect(ids).not.toContain(START);
    const gateway = gatewayOf(productionPort());
    expect(["not_discoverable", "unauthorized"]).toContain(refusedStatus(await invoke(gateway, viewer, START, { componentIds: [DIMMER_INSTANCE_IDS.D1] })));
    expect(reportOf(await invoke(gateway, viewer, STATUS, {})).tasks).toEqual([]);
  });
});
