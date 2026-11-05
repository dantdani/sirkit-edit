/**
 * [PR-J, 2026-10-22] Runbook J.6.3, increment J5-1 (OD-255 item 9): the BROWSER's result reader (app/lib/project/generation-task-client.ts
 * `fetchGenerationTask` -> `readResult`) carries a planned result's optional sheet set, read defensively with the shared pure reader:
 *
 *  1. a well-formed sheet set is read whole (and a one-page set with its findings);
 *  2. a malformed sheet set is DROPPED and the result kept (the page's intake never loses a reviewable design over its organisation);
 *  3. a result without sheets reads exactly as before (no `sheets` key).
 * The page does not apply sheets in this increment. A fake fetch (no route, no store, no network).
 */
import { describe, expect, it } from "vitest";
import { fetchGenerationTask } from "../generation-task-client";
import { GENERATION_SHEETS_SCHEMA, type GeneratedSheets } from "@/app/lib/schematic/generated-sheets";

const T0 = Date.parse("2026-10-22T10:00:00.000Z");
const SCOPE = { projectId: "proj-j5", branchId: "main" };
const TASK_ID = `generation-task:${"c".repeat(32)}`;
const SNAPSHOT = {
  schema: "sirkit.generation-task-snapshot.v1", taskId: TASK_ID, clientRequestId: "00000000-0000-4000-8000-000000000001", scope: { tenantId: "local", ...SCOPE }, state: "awaiting-review", terminal: false, phase: "review",
  provider: "openai", createdAt: new Date(T0).toISOString(), updatedAt: new Date(T0).toISOString(), serverNow: new Date(T0 + 1_000).toISOString(), liveness: { state: "idle", since: null, retryAt: null },
  plan: null, blocker: null, failure: null, usage: { slices: 0, attempts: 0, modelCalls: 0, uncertainModelCalls: 0, inputTokens: 0, outputTokens: 0, catalogSearches: 0, cacheHits: 0 },
  base: { schematicDigest: "eng1-0123456789abcdef0123456789abcdef", recipe: "build-pin", moved: false }, result: { status: "complete", omittedBlocks: [], resultDigest: `dw1-${"e".repeat(64)}` }, review: null,
  control: { cancelRequested: false, pauseRequested: false }, actions: ["record-review"], retryBlocks: [], eventCursor: 3, activity: [],
};
const SHEETS: GeneratedSheets = {
  schema: GENERATION_SHEETS_SCHEMA,
  sheets: {
    root: { sheetKey: "overview", name: "System overview" },
    children: [
      { sheetKey: "b1", name: "Power", status: "designed", components: ["U1"], ports: [{ portKey: "b1:PG", net: "PG", direction: "output", state: "bound" }], rails: [{ net: "+3V3", kind: "power" }], localNets: [] },
      { sheetKey: "b2", name: "MCU", status: "designed", components: ["U2"], ports: [{ portKey: "b2:PG", net: "PG", direction: "input", state: "bound" }], rails: [{ net: "+3V3", kind: "power" }], localNets: ["RESET"] },
    ],
    interfaces: [{ net: "PG", ports: ["b1:PG", "b2:PG"], state: "bound" }],
    rails: [{ net: "+3V3", kind: "power", sheets: ["b1", "b2"] }],
  },
  findings: [],
};
function resultBody(sheets?: unknown): Record<string, unknown> {
  return {
    status: "complete", omittedBlocks: [], netlist: { components: [{ refDes: "U1", partId: "p1", value: "LDO", role: "regulator" }, { refDes: "U2", partId: "p2", value: "MCU", role: "processor" }], connections: [], explanation: "" },
    explanation: "Designed as 2 subsystem block(s).", electricalCheck: { state: "passed", criticalCount: 0, warningCount: 0 }, planner: { state: "planned", blocks: 2 }, sharedNets: { checked: 2, findings: [] },
    resultDigest: `dw1-${"e".repeat(64)}`, at: new Date(T0).toISOString(), ...(sheets !== undefined ? { sheets } : {}),
  };
}
const fetchOf = (result: Record<string, unknown>) => async (): Promise<Response> => new Response(JSON.stringify({ ok: true, durability: "process-memory", task: SNAPSHOT, result }), { status: 200, headers: { "content-type": "application/json" } });
async function read(result: Record<string, unknown>) {
  const answer = await fetchGenerationTask(SCOPE, TASK_ID, { includeResult: true, fetchImpl: fetchOf(result) });
  if (!answer.ok || !answer.result) throw new Error(`a result was expected: ${JSON.stringify(answer).slice(0, 200)}`);
  return answer.result;
}

describe("[PR-J J5-1] the browser reads a result's sheet set defensively", () => {
  it("1. a well-formed sheet set is read whole; a one-page set keeps its findings", async () => {
    expect((await read(resultBody(SHEETS))).sheets).toEqual(SHEETS);
    const onePage = { schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: ["Kept on one page: EN is labelled in Sensor, Logic but is not a planned shared net."] };
    expect((await read(resultBody(onePage))).sheets).toEqual(onePage);
  });

  it("2. a malformed sheet set is dropped and the result kept", async () => {
    const malformed: unknown[] = [
      { ...SHEETS, extra: true },
      { ...SHEETS, schema: "sirkit.generation-sheets.v9" },
      { ...SHEETS, sheets: { ...SHEETS.sheets!, interfaces: [{ net: "PG", ports: ["b1:PG", "b3:PG"], state: "bound" }] } },
      { ...SHEETS, sheets: { ...SHEETS.sheets!, children: [SHEETS.sheets!.children[0]!, { ...SHEETS.sheets!.children[1]!, sheetKey: "b1" }] } },
      { ...SHEETS, findings: "not a list" },
      "sheets",
      null,
    ];
    for (const [index, sheets] of malformed.entries()) {
      const result = await read(resultBody(sheets));
      expect(result, `malformed ${index}`).not.toHaveProperty("sheets");
      expect(result.netlist.components).toHaveLength(2);
      expect(result.resultDigest).toBe(`dw1-${"e".repeat(64)}`);
    }
  });

  it("3. a result without sheets reads exactly as before", async () => {
    const result = await read(resultBody());
    expect(Object.keys(result).sort()).toEqual(["electricalCheck", "explanation", "netlist", "omittedBlocks", "resultDigest", "status"]);
  });
});
