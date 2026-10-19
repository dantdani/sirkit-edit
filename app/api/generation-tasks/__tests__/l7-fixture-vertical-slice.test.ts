/**
 * [PR-L6, 2026-10-19] Runbook L.7 items 9 and 10 (OD-253 (1)-(5)), the FIXTURE vertical slices through the REAL routes: the start and
 * inspect / control routes, the worker pump (POST /api/generation-worker) and the slice core, under the fixture runtime's default
 * composition (process-memory store) with the scripted fixture provider (`generation-policy.ts`) and the committed fixture catalog -
 * zero credits, no database, no network. What it proves, beyond a task record:
 *
 *  1. the owner's four-motor sentence, verbatim: a planned 4-block plan (power + 3.3 V regulator, the motor driver stages, the
 *     flight-controller MCU, the IMU), every block saved, the merge complete, every shared net joined (findings []), the post-merge
 *     electrical check passed with 0 criticals, the expected 41-instance multiset, 9 model calls with cache hits across blocks; every
 *     component has a published exact identity for its value, the page's layout validates, no instance is unresolved and the Prepare PCB
 *     preflight is ready for the server stages; the disclosed assumptions travel with the plan;
 *  2. the second ordinary circuit (a 555 PWM LED dimmer): a single design, complete, the PUBLISHED 1N4148W chosen over the unresolved
 *     1N4148, 3 calls - selection by request, not a fixed answer; the blinker request still yields the recorded blinker netlist;
 *  3. pause in the middle of a block, then resume: the same task completes with no extra model call (the provider is stateless over the
 *     stored conversation);
 *  4. a drone "with a barometer": four blocks saved, the barometer block ends blocked missing_part (its searches came back empty; no part
 *     is invented), and review-partial merges the saved blocks into a partial result that names the omitted block;
 *  5. a request with no recipe gets text replies only: the task allowance parks it first (allowance_exhausted), and after an explicit
 *     extension the strategy ladder ends at no_progress - zero searches, zero submissions, calls bounded by the allowances granted.
 * Fake-backed: a scripted provider over a committed catalog - not a live model, a live catalog or a live router.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { resetGenerationTaskRuntimeFactory } from "@/app/lib/generation-task/runtime";
import { resetGenerationSlicePortsFactory, setGenerationSlicePortsFactory } from "@/app/lib/generation-task/worker/runtime";
import { resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { BLINKER_ACCEPTANCE_PROMPT, BLINKER_NETLIST, BLINKER_PART_IDS, FIXTURE_RESOLUTION_PART_IDS, GENERATION_FIXTURE_PART_IDS, fixtureRuntimeCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import { FIXTURE_GENERATION_MODEL, fixtureGenerationCatalogPort, fixtureGenerationLlmPort } from "@/app/lib/fixture-runtime/generation-ports";
import { DRONE_BLOCK_NAMES, dronePlan } from "@/app/lib/fixture-runtime/generation-recipes";
import { autoLayoutBuildValidated, publishedAtomicIdentity } from "@/lib/build-auto-layout";
import { listUnresolvedInstances } from "@/app/lib/pcb-sync/unresolved-instances";
import { buildPcbSyncPreflightReport } from "@/app/lib/pcb-sync/preflight-read";
import type { LLMRequest, LLMResponse } from "@/app/lib/llm/types";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";
import { POST as start } from "../route";
import { GET as inspect } from "../[id]/route";
import { POST as control } from "../[id]/control/route";
import { POST as pump } from "../../generation-worker/route";

/** The owner's sentence (runbook section L.0), verbatim. */
const OWNER_FOUR_MOTOR_SENTENCE = "build me a simple drone controlling circuitly with 4 motors just a simple one";
const DIMMER_REQUEST = "Design a 5 V LED dimmer: a 555 timer PWM with a 10k potentiometer setting the brightness, switching the LED through an N-channel MOSFET.";

const SECRET = ["l7", "pump", "worker", "secret", "for", "tests"].join("-");
const DIGEST = "eng1-0123456789abcdef0123456789abcdef";
const sel = (): Record<string, string> => ({ "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-l7", "x-sirkit-branch-id": "main" });
const postReq = (path: string, body: unknown): Request => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...sel() }, body: JSON.stringify(body) });
const getReq = (path: string): Request => new Request(`http://localhost${path}`, { method: "GET", headers: sel() });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async (response: Response): Promise<Record<string, any>> => (await response.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const pumpReq = (): Request => new Request("http://localhost/api/generation-worker", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } });
let counter = 0;
const requestId = (): string => `00000000-0000-4000-8000-${(counter += 1).toString(16).padStart(12, "0").slice(-12)}`;

/** Every scripted call the slices made (the request and the answer), and an optional hook run before an answer is returned. */
let calls: Array<{ request: LLMRequest; answer: LLMResponse }> = [];
let beforeAnswer: ((request: LLMRequest, index: number) => Promise<void>) | null = null;

beforeEach(() => {
  calls = [];
  beforeAnswer = null;
  resetFixtureContainer();
  resetGenerationTaskRuntimeFactory(); // the production composition root: the fixture branch (process-memory store)
  vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", SECRET);
  const llm = fixtureGenerationLlmPort(0);
  setGenerationSlicePortsFactory(() => ({
    llm: { generate: async (request) => { const answer = await llm.generate(request); const index = calls.length; calls.push({ request, answer }); if (beforeAnswer) await beforeAnswer(request, index); return answer; } },
    catalog: fixtureGenerationCatalogPort(),
  }));
  resetInjectedIdentity();
  injectAuthorizedPrincipal({ userId: "u-l7", tenantId: "local", projectId: "proj-l7", role: "editor" });
});
afterEach(() => {
  resetInjectedIdentity();
  resetGenerationTaskRuntimeFactory();
  resetGenerationSlicePortsFactory();
  resetFixtureContainer();
  vi.unstubAllEnvs();
});

async function startTask(prompt: string): Promise<string> {
  const response = await start(postReq("/api/generation-tasks", { clientRequestId: requestId(), prompt, provider: "openai", base: { schematicDigest: DIGEST, recipe: "build-pin" } }));
  const body = await json(response);
  expect(response.status, JSON.stringify(body).slice(0, 300)).toBe(202);
  expect(body).toMatchObject({ durability: "process-memory", task: { state: "queued" } });
  return body.task.taskId as string;
}
async function taskOf(taskId: string, withResult = false): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return json(await inspect(getReq(`/api/generation-tasks/${taskId}${withResult ? "?include=result" : ""}`), ctx(taskId)));
}
/** Pump (one slice per request) until `until` holds; the trail names every slice for a failure message. */
async function pumpUntil(taskId: string, until: (task: Record<string, any>) => boolean, max: number): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const trail: string[] = [];
  for (let index = 0; index < max; index += 1) {
    const ran = await json(await pump(pumpReq()));
    expect(ran.ok, JSON.stringify(ran).slice(0, 300)).toBe(true);
    const { task } = await taskOf(taskId);
    trail.push(`${ran.ran ? `${ran.ran.kind}:${ran.ran.outcome}` : "idle"} -> ${task.state}${task.blocker ? `/${task.blocker.code}` : ""}`);
    if (until(task)) return task;
  }
  throw new Error(`the task did not reach the expected state: ${trail.join(" | ")}`);
}
const controlTask = async (taskId: string, body: Record<string, unknown>): Promise<Record<string, any>> => json(await control(postReq(`/api/generation-tasks/${taskId}/control`, body), ctx(taskId))); // eslint-disable-line @typescript-eslint/no-explicit-any
const submissions = (): number => calls.reduce((sum, call) => sum + call.answer.toolCalls.filter((toolCall) => toolCall.name === "submit_schematic").length, 0);
const multiset = (netlist: BuildLogicalNetlist): string[] => netlist.components.map((component) => `${component.partId}=${component.value}`).sort();
const expand = (entries: Array<[string, string, number]>): string[] => entries.flatMap(([partId, value, count]) => Array.from({ length: count }, () => `${partId}=${value}`)).sort();

/** The page's own path for a result (offerBuildResult): load the parts, lay out and validate; then the Prepare PCB preflight's reads. */
function pagePath(netlist: BuildLogicalNetlist) {
  const parts = fixtureRuntimeCatalog().cachedParts;
  const used = new Map([...new Set(netlist.components.map((component) => component.partId))].map((id) => [id, parts.get(id)!] as const));
  const built = autoLayoutBuildValidated(netlist, used);
  return { built, unresolved: listUnresolvedInstances(built.state), preflight: buildPcbSyncPreflightReport(built.state) };
}

const DRONE_4_MULTISET = expand([
  [BLINKER_PART_IDS.header, "BATT_1S", 1], [GENERATION_FIXTURE_PART_IDS.ldo, "MIC5504-3.3YM5", 1], [BLINKER_PART_IDS.capacitor, "10uF", 4], [BLINKER_PART_IDS.capacitor, "100nF", 6],
  [GENERATION_FIXTURE_PART_IDS.nmos, "AO3400A", 4], [BLINKER_PART_IDS.resistor, "330", 5], [BLINKER_PART_IDS.resistor, "10k", 7], [GENERATION_FIXTURE_PART_IDS.schottky, "SS14", 4],
  ...[1, 2, 3, 4].map((n): [string, string, number] => [BLINKER_PART_IDS.header, `MOTOR${n}`, 1]),
  [GENERATION_FIXTURE_PART_IDS.mcu, "ATmega328P-AU", 1], [GENERATION_FIXTURE_PART_IDS.header2x03, "ISP", 1], [GENERATION_FIXTURE_PART_IDS.header1x04, "UART_RX", 1], [BLINKER_PART_IDS.led, "LED", 1],
  [GENERATION_FIXTURE_PART_IDS.imu, "LSM6DS3TR-C", 1],
]);

describe("[PR-L6 L.7-9] the owner's four-motor request through the real routes, pump and slice core (fixture)", () => {
  it("plans four blocks, saves each, merges complete with every shared net joined and ERC 0 critical; the expected 41 catalog-resolved instances, each with a published identity; layout validates; nothing unresolved; the Prepare PCB preflight is ready", async () => {
    const taskId = await startTask(OWNER_FOUR_MOTOR_SENTENCE);
    const ready = await pumpUntil(taskId, (task) => task.state === "awaiting-review", 12);
    expect(ready.plan.planner).toBe("planned");
    expect(ready.plan.blocks.map((block: { name: string; status: string }) => [block.name, block.status])).toEqual([DRONE_BLOCK_NAMES.power, DRONE_BLOCK_NAMES.motors, DRONE_BLOCK_NAMES.mcu, DRONE_BLOCK_NAMES.imu].map((name) => [name, "saved"]));
    // the disclosed assumptions travel with the plan: in its rationale always, and as the plan's own list once the planner reads it
    const recipe = dronePlan(4, false);
    for (const words of ["brushed 1S coreless motors", "1S LiPo without charger or protection", "internal 8 MHz oscillator", "UART header for a receiver", "no firmware or flight qualification"]) expect(ready.plan.rationale).toContain(words);
    expect([[], recipe.assumptions]).toContainEqual(ready.plan.assumptions);
    expect(ready.result).toMatchObject({ status: "complete", omittedBlocks: [] });
    expect(ready.usage.modelCalls).toBe(9); // the planner, then one search turn and one submit turn per block
    expect(ready.usage.cacheHits).toBeGreaterThan(0); // identical passive searches across blocks answered from the task's facts
    expect(calls.every((call) => call.answer.model === FIXTURE_GENERATION_MODEL)).toBe(true);

    const { result } = await taskOf(taskId, true);
    expect(result.status).toBe("complete");
    expect(result.sharedNets.findings).toEqual([]);
    expect(result.sharedNets.checked).toBe(10); // VBAT, +3V3, GND, PWM1-4, I2C_SDA, I2C_SCL, IMU_INT1
    expect(result.electricalCheck).toMatchObject({ state: "passed", criticalCount: 0, warningCount: 2 }); // ADC6 / ADC7 unconnected inputs
    const netlist = result.netlist as BuildLogicalNetlist;
    expect(multiset(netlist)).toEqual(DRONE_4_MULTISET);
    const parts = fixtureRuntimeCatalog().cachedParts;
    for (const component of netlist.components) expect(publishedAtomicIdentity(parts.get(component.partId), component.value), `${component.refDes} ${component.partId}=${component.value}`).not.toBeNull();
    // every shared net is a real label on real pins in at least two blocks' instances (not prose): check the merged nets
    const labelled = (net: string): string[] => netlist.connections.flatMap((connection) => (connection.kind === "label" && connection.labelName === net ? [connection.pin] : []));
    for (const net of ["VBAT", "+3V3", "GND", "PWM1", "PWM2", "PWM3", "PWM4", "I2C_SDA", "I2C_SCL", "IMU_INT1"]) expect(labelled(net).length, net).toBeGreaterThanOrEqual(2);

    const page = pagePath(netlist);
    expect(page.built.validation.ok, JSON.stringify(page.built.validation.violations.slice(0, 3))).toBe(true);
    expect(page.built.state.kicadComponents).toHaveLength(41);
    expect(page.built.state.kicadComponents!.every((instance) => typeof instance.atomicPartRevisionId === "string")).toBe(true);
    expect(page.unresolved).toEqual([]);
    expect(page.preflight.status).toBe("ready_for_server_preparation");
  });

  it("selection is by features, not the sentence: a paraphrase with two motors plans two driver stages and two PWM nets", async () => {
    const taskId = await startTask("Please design a tiny drone controller board for 2 coreless motors.");
    const ready = await pumpUntil(taskId, (task) => task.state === "awaiting-review", 12);
    expect(ready.result.status).toBe("complete");
    const { result } = await taskOf(taskId, true);
    expect(result.sharedNets.findings).toEqual([]);
    expect(result.netlist.components.filter((component: { partId: string }) => component.partId === GENERATION_FIXTURE_PART_IDS.nmos)).toHaveLength(2);
    expect(result.netlist.connections.some((connection: { labelName?: string }) => connection.labelName === "PWM3")).toBe(false);
    expect(result.electricalCheck).toMatchObject({ state: "passed", criticalCount: 0 });
  });
});

describe("[PR-L6 L.7-10] a second ordinary circuit, and the blinker still yields its recorded design", () => {
  it("the LED dimmer: one circuit, complete, the PUBLISHED 1N4148W over the unresolved 1N4148, ERC 0 critical, 3 calls, ready for Prepare PCB", async () => {
    const taskId = await startTask(DIMMER_REQUEST);
    const ready = await pumpUntil(taskId, (task) => task.state === "awaiting-review", 8);
    expect(ready).toMatchObject({ plan: { planner: "single", blocks: [{ blockId: "main", status: "saved" }] }, result: { status: "complete" }, usage: { modelCalls: 3 } });
    const { result } = await taskOf(taskId, true);
    const netlist = result.netlist as BuildLogicalNetlist;
    expect(netlist.components).toHaveLength(14);
    const byRef = new Map(netlist.components.map((component) => [component.refDes, component] as const));
    expect(byRef.get("U1")!.partId).toBe(BLINKER_PART_IDS.timer);
    for (const ref of ["D1", "D2"]) expect(byRef.get(ref)).toMatchObject({ partId: FIXTURE_RESOLUTION_PART_IDS.eligibleDiode, value: "1N4148W" });
    expect(netlist.components.some((component) => component.partId === FIXTURE_RESOLUTION_PART_IDS.unresolvedDiode)).toBe(false);
    expect(byRef.get("RV1")).toMatchObject({ partId: GENERATION_FIXTURE_PART_IDS.potentiometer, value: "10k" });
    expect(byRef.get("Q1")).toMatchObject({ partId: GENERATION_FIXTURE_PART_IDS.nmos, value: "AO3400A" });
    expect(result.electricalCheck).toMatchObject({ state: "passed", criticalCount: 0 });
    const page = pagePath(netlist);
    expect(page.built.validation.ok, JSON.stringify(page.built.validation.violations.slice(0, 3))).toBe(true);
    expect(page.unresolved).toEqual([]);
    expect(page.preflight.status).toBe("ready_for_server_preparation");
  });

  it("the blinker request still gives the recorded 555 blinker netlist (same parts, values and connections) in 3 calls", async () => {
    const taskId = await startTask(BLINKER_ACCEPTANCE_PROMPT);
    const ready = await pumpUntil(taskId, (task) => task.state === "awaiting-review", 8);
    expect(ready).toMatchObject({ plan: { planner: "single" }, result: { status: "complete" }, usage: { modelCalls: 3 } });
    const submitted = calls.flatMap((call) => call.answer.toolCalls.filter((toolCall) => toolCall.name === "submit_schematic").map((toolCall) => toolCall.input));
    expect(submitted).toEqual([{ components: BLINKER_NETLIST.components, connections: BLINKER_NETLIST.connections, explanation: BLINKER_NETLIST.explanation }]);
    const { result } = await taskOf(taskId, true);
    expect(result.netlist.components).toEqual(BLINKER_NETLIST.components);
    expect(result.netlist.connections.map((connection: Record<string, unknown>) => Object.fromEntries(Object.entries(connection).filter(([key]) => key !== "labelKind")))).toEqual(BLINKER_NETLIST.connections); // the loop adds the inferred label kinds
  });
});

describe("[PR-L6 L.7-9] pause and resume, a missing part, and a request with no recipe", () => {
  it("pause in the middle of a block, then resume: the same task completes with no extra model call", async () => {
    const taskId = await startTask(OWNER_FOUR_MOTOR_SENTENCE);
    let paused = false;
    beforeAnswer = async (request) => {
      // the first design turn of the motor block: pause the task while this slice is in flight (it yields at the turn boundary)
      if (!paused && typeof request.messages[0]?.content === "string" && request.messages[0].content.startsWith(`Block: ${DRONE_BLOCK_NAMES.motors}`)) {
        paused = true;
        expect((await controlTask(taskId, { action: "pause", clientActionId: "pause-l7" })).ok).toBe(true);
      }
    };
    const stopped = await pumpUntil(taskId, (task) => task.state === "paused", 12);
    expect(paused).toBe(true);
    expect(stopped.plan.blocks.find((block: { name: string }) => block.name === DRONE_BLOCK_NAMES.motors).status).not.toBe("saved");
    expect(await json(await pump(pumpReq()))).toMatchObject({ ran: null }); // a paused task runs nothing
    const callsWhilePaused = calls.length;
    expect((await controlTask(taskId, { action: "resume", clientActionId: "resume-l7" })).task.state).toBe("queued");
    const ready = await pumpUntil(taskId, (task) => task.state === "awaiting-review", 12);
    expect(ready.result.status).toBe("complete");
    expect(calls.length).toBeGreaterThan(callsWhilePaused);
    expect(ready.usage.modelCalls).toBe(9); // the checkpointed search turn was not redone
    expect(calls.filter((call) => typeof call.request.toolChoice === "object")).toHaveLength(1); // one plan
    const { result } = await taskOf(taskId, true);
    expect(multiset(result.netlist)).toEqual(DRONE_4_MULTISET);
  });

  it("a drone with a barometer: four blocks saved, the barometer block blocked missing_part (empty searches, no invented part), review-partial gives a partial result naming it", { timeout: 60_000 }, async () => {
    const taskId = await startTask("build me a simple drone controller with 4 motors and a barometer");
    let extensions = 0;
    let blocked: Record<string, any> | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let round = 0; round < 6 && blocked === null; round += 1) {
      const waiting = await pumpUntil(taskId, (task) => task.state === "waiting-for-resource", 80);
      const barometer = waiting.plan.blocks.find((block: { name: string }) => block.name === DRONE_BLOCK_NAMES.barometer);
      if (barometer.status === "blocked" && barometer.blocker === "missing_part") { blocked = waiting; break; }
      // the task allowance (60 calls) runs out before the barometer block's strategy ladder ends: the saved blocks are offered as a
      // partial design, the barometer block waits for an allowance - and the user's explicit "continue with another allowance" goes on
      const evidence = JSON.stringify({ blocker: waiting.blocker, blocks: waiting.plan.blocks, usage: waiting.usage, actions: waiting.actions });
      expect(barometer.blocker, evidence).toBe("allowance_exhausted");
      expect(waiting.blocker, evidence).toMatchObject({ code: "partial_available", blockId: barometer.blockId });
      expect(waiting.actions, evidence).toEqual(expect.arrayContaining(["extend-allowance", "review-partial"]));
      expect(waiting.usage.modelCalls).toBeLessThanOrEqual(60 * (1 + extensions));
      extensions += 1;
      expect((await controlTask(taskId, { action: "extend-allowance", clientActionId: `extend-${extensions}` })).ok).toBe(true);
    }
    expect(blocked, "the barometer block reaches its missing-part blocker").not.toBeNull();
    expect(blocked!.plan.blocks.filter((block: { status: string }) => block.status === "saved").map((block: { name: string }) => block.name)).toEqual([DRONE_BLOCK_NAMES.power, DRONE_BLOCK_NAMES.motors, DRONE_BLOCK_NAMES.mcu, DRONE_BLOCK_NAMES.imu]);
    // the barometer conversations searched and found nothing; no submission was ever made for it
    const barometerCalls = calls.filter((call) => typeof call.request.messages[0]?.content === "string" ? call.request.messages[0].content.startsWith(`Block: ${DRONE_BLOCK_NAMES.barometer}`) : JSON.stringify(call.request.messages[0]?.content ?? "").includes(`Block: ${DRONE_BLOCK_NAMES.barometer}`));
    expect(barometerCalls.length).toBeGreaterThan(0);
    expect(barometerCalls.some((call) => call.answer.toolCalls.some((toolCall) => toolCall.name === "search_parts" && String(toolCall.input.query).startsWith("BMP280")))).toBe(true);
    expect(barometerCalls.some((call) => call.answer.toolCalls.some((toolCall) => toolCall.name === "submit_schematic"))).toBe(false);
    expect(submissions()).toBe(4);
    expect(blocked!.actions).toContain("review-partial");
    expect((await controlTask(taskId, { action: "review-partial", clientActionId: "partial-l7" })).ok).toBe(true);
    const ready = await pumpUntil(taskId, (task) => task.state === "awaiting-review", 6);
    expect(ready.result).toMatchObject({ status: "partial", omittedBlocks: [DRONE_BLOCK_NAMES.barometer] });
    const { result } = await taskOf(taskId, true);
    expect(multiset(result.netlist)).toEqual(DRONE_4_MULTISET);
    expect(result.electricalCheck).toMatchObject({ state: "passed", criticalCount: 0 });
  });

  it("a request with no recipe ends at a truthful stop: text replies only (no search, no submission, no part); the 60-call allowance parks it first, and an explicit extension lets the strategy ladder end at no_progress", { timeout: 60_000 }, async () => {
    const taskId = await startTask("Design a 48 V brushless motor ESC with field-oriented control and CAN bus.");
    const parked = await pumpUntil(taskId, (task) => task.state === "waiting-for-resource", 80);
    // the ladder (three stagnant six-turn slices per strategy) outlasts one allowance unit: an honest allowance stop, nothing saved
    expect(parked).toMatchObject({ plan: { planner: "single" }, blocker: { code: "allowance_exhausted" }, result: null });
    expect(parked.usage.modelCalls).toBeLessThanOrEqual(60);
    expect((await controlTask(taskId, { action: "extend-allowance", clientActionId: "extend-unknown" })).ok).toBe(true);
    const ended = await pumpUntil(taskId, (task) => task.state === "waiting-for-resource", 80);
    expect(ended).toMatchObject({ blocker: { code: "no_progress" }, result: null });
    expect(ended.plan.blocks).toEqual([expect.objectContaining({ blockId: "main", status: "blocked", blocker: "no_progress" })]);
    expect(ended.usage.modelCalls).toBeLessThanOrEqual(120);
    expect(submissions()).toBe(0);
    expect(calls.every((call) => call.answer.toolCalls.every((toolCall) => toolCall.name !== "search_parts"))).toBe(true);
  });
});
