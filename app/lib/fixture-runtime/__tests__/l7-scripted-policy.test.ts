/**
 * [PR-L6, 2026-10-19] Runbook L.7 items 9 and 10: the fixture runtime's scripted generation provider (`generation-policy.ts` over
 * `generation-recipes.ts`) against the REAL slice core (`runInMemoryBuildLoop`, the planner `planGeneration`) and the committed fixture
 * catalog's search port. It must behave as an honest model would, and never as a recording of one sentence:
 *
 *  1. the blinker request: the five recorded searches in ONE turn, then a submit_schematic input deep-equal to `BLINKER_NETLIST`
 *     (components, connections, explanation) - three model calls with the planner - so the recorded design and the prompt-to-Gerber
 *     replay are unchanged;
 *  2. the recipe is chosen by the request's FEATURES: the owner's exact four-motor sentence and three paraphrases plan the same four
 *     blocks; "2 motors" plans two driver stages; the dimmer sentence and a paraphrase select the dimmer; a request with no recipe gets
 *     no plan and no tool call; a block-split prompt gets no plan;
 *  3. property over every design it produces: each submitted partId was RETURNED by one of its searches, each endpoint is a pin number of
 *     that returned part, each value is one the part is orderable at, and the netlist has 0 ERC criticals on the fixture pins;
 *  4. a catalog without the AO3400A: the motor block searches, finds nothing that fits, replies in text naming the role, and never
 *     submits (no invented part);
 *  5. the search port attaches the published authority facts exactly as production's search does (parts-search.ts attachOrderableValues);
 *  6. stateless: the same conversation always gets the same answer.
 * Fake-backed: a scripted provider over a committed catalog.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { BLINKER_ACCEPTANCE_PROMPT, BLINKER_NETLIST, BLINKER_PART_IDS, FIXTURE_RESOLUTION_PART_IDS, GENERATION_FIXTURE_PART_IDS, fixtureRuntimeCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import { FIXTURE_GENERATION_SEARCHES, fixtureGenerationAnswer, fixtureGenerationCatalogPort, fixtureGenerationLlmPort, fixtureSearchAuthority } from "@/app/lib/fixture-runtime/generation-ports";
import { DECLINE_TEXT, designOf, planTurn, resolvePins, scriptedGenerationTurn } from "@/app/lib/fixture-runtime/generation-policy";
import { DRONE_BLOCK_NAMES, dronePlan, requestFeatures, selectRecipe } from "@/app/lib/fixture-runtime/generation-recipes";
import { runInMemoryBuildLoop, type BuildCatalogPort, type BuildLlmPort } from "@/app/lib/schematic/build-loop-slice";
import { blockDesignRequest, planGeneration, type PlannedBlock } from "@/app/lib/schematic/build-multi-generation";
import { runErc } from "@/lib/erc";
import { normalizeValueKey } from "@/app/lib/atomic/value-key";
import type { AiPartResult } from "@/app/lib/parts-search";
import type { LLMRequest, LLMResponse, LLMToolCall } from "@/app/lib/llm/types";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";

const OWNER_FOUR_MOTOR_SENTENCE = "build me a simple drone controlling circuitly with 4 motors just a simple one";
const DRONE_PARAPHRASES = [
  "Design a quadcopter flight controller board.",
  "I need a small quad-rotor control PCB with four motors.",
  "simple multirotor controller for 4 coreless motors please",
];
const DIMMER_SENTENCES = [
  "Design a 5 V LED dimmer: a 555 timer PWM with a 10k potentiometer setting the brightness, switching the LED through an N-channel MOSFET.",
  "make me an LED brightness controller using PWM",
];
const UNKNOWN_REQUESTS = ["Design a 48 V brushless motor ESC with field-oriented control and CAN bus.", "A USB-C PD sink that negotiates 20 V", "hello"];

beforeEach(() => {
  resetFixtureContainer();
  vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
});
afterEach(() => {
  resetFixtureContainer();
  vi.unstubAllEnvs();
});

interface Recorded { request: LLMRequest; answer: LLMResponse }
/** The scripted provider with every call recorded. */
function recordingLlm(): { llm: BuildLlmPort; calls: Recorded[] } {
  const base = fixtureGenerationLlmPort(0), calls: Recorded[] = [];
  return { calls, llm: { async generate(request) { const seen = { ...request, messages: structuredClone(request.messages) }; const answer = await base.generate(request); calls.push({ request: seen, answer }); return answer; } } }; // the conversation as sent (the loop appends to its own array afterwards)
}
/** A catalog port that records every search's results (what the provider was given). */
function recordingCatalog(inner: BuildCatalogPort = fixtureGenerationCatalogPort()): { catalog: BuildCatalogPort; returned: Map<string, AiPartResult>; searches: Array<{ query: string; category: string | undefined; count: number }> } {
  const returned = new Map<string, AiPartResult>(), searches: Array<{ query: string; category: string | undefined; count: number }> = [];
  return {
    returned, searches,
    catalog: { ...inner, identity: inner.identity, async searchParts(query, category, limit, options) { const results = await inner.searchParts(query, category, limit, options); for (const part of results) returned.set(part.partId, part); searches.push({ query, category, count: results.length }); return results; }, findAlternates: inner.findAlternates.bind(inner), partsByIds: inner.partsByIds.bind(inner) },
  };
}
async function designBlock(prompt: string, block: PlannedBlock | null, catalogPort?: BuildCatalogPort) {
  const { llm, calls } = recordingLlm();
  const { catalog, returned, searches } = recordingCatalog(catalogPort);
  const request = blockDesignRequest(prompt, block);
  const run = await runInMemoryBuildLoop({ block: { ...request, allowEmpty: false }, provider: "openai", llm, catalog, maxTurns: 6 });
  const submitted = calls.flatMap((call) => call.answer.toolCalls.filter((toolCall) => toolCall.name === "submit_schematic").map((toolCall) => toolCall.input as unknown as BuildLogicalNetlist));
  return { run, calls, returned, searches, submitted };
}
const ercParts = () => new Map([...fixtureRuntimeCatalog().cachedParts.values()].map((part) => [part.id, { name: part.name, pins: part.pins }] as const));

/** Property 3: every partId returned by a search of this conversation, every endpoint a pin number of THAT part, every value orderable. */
function expectGrounded(netlist: BuildLogicalNetlist, returned: Map<string, AiPartResult>, label: string): void {
  const partByRef = new Map(netlist.components.map((component) => [component.refDes, returned.get(component.partId)] as const));
  for (const component of netlist.components) {
    const part = returned.get(component.partId);
    expect(part, `${label}: ${component.refDes} uses a partId no search returned`).toBeDefined();
    if (part!.orderableValues) expect(part!.orderableValues, `${label}: ${component.refDes} value ${component.value}`).toContain(normalizeValueKey(component.value));
  }
  const endpoints = netlist.connections.flatMap((connection) => (connection.kind === "label" ? [connection.pin] : [connection.from, connection.to]));
  for (const endpoint of endpoints) {
    const [ref, pin] = endpoint.split(".");
    const part = partByRef.get(ref!);
    expect(part, `${label}: ${endpoint} names no component`).toBeDefined();
    expect(part!.pins.map((entry) => entry.number), `${label}: ${endpoint} is not a returned pin NUMBER`).toContain(pin);
  }
}

describe("[PR-L6 L.7] 1. the blinker stays the recorded design", () => {
  it("the five recorded searches in one turn, then a submission deep-equal to BLINKER_NETLIST; with the planner, three calls", async () => {
    const { llm, calls } = recordingLlm();
    const plan = await planGeneration({ prompt: BLINKER_ACCEPTANCE_PROMPT, provider: "openai", llm, maxBlocks: 8 });
    expect(plan).toMatchObject({ kind: "planned", plan: { planner: { state: "single" }, blocks: [] } });
    const { run, calls: turns, submitted } = await designBlock(BLINKER_ACCEPTANCE_PROMPT, null);
    expect(run.end.kind).toBe("submitted");
    expect(calls.length + turns.length).toBe(3);
    expect(turns[0]!.answer.toolCalls.map((call) => ({ name: call.name, ...call.input }))).toEqual(FIXTURE_GENERATION_SEARCHES.map((search) => ({ name: "search_parts", query: search.query, category: search.category })));
    expect(FIXTURE_GENERATION_SEARCHES).toEqual([
      { query: "NE555 timer SOIC-8", category: "Timer" }, { query: "0805 resistor", category: "Resistor" }, { query: "0805 capacitor", category: "Capacitor" },
      { query: "0805 LED", category: "LED" }, { query: "2-pin 2.54 mm header connector", category: "Connector" },
    ]);
    expect(submitted).toHaveLength(1);
    expect(isDeepStrictEqual(submitted[0], { components: BLINKER_NETLIST.components, connections: BLINKER_NETLIST.connections, explanation: BLINKER_NETLIST.explanation })).toBe(true);
  });
});

describe("[PR-L6 L.7] 2. the recipe is chosen by the request's features, never the exact sentence", () => {
  it("the owner's sentence and three paraphrases plan the same four drone blocks with the disclosed assumptions and coverage", () => {
    for (const sentence of [OWNER_FOUR_MOTOR_SENTENCE, ...DRONE_PARAPHRASES]) {
      const turn = planTurn(sentence);
      expect(turn.toolCalls, sentence).toHaveLength(1);
      const input = turn.toolCalls[0]!.input as { blocks: Array<{ name: string; sharedNets: string[] }>; rationale: string; assumptions: string[]; coverage: string[] };
      expect(input.blocks.map((block) => block.name), sentence).toEqual([DRONE_BLOCK_NAMES.power, DRONE_BLOCK_NAMES.motors, DRONE_BLOCK_NAMES.mcu, DRONE_BLOCK_NAMES.imu]);
      expect(input.blocks[1]!.sharedNets).toEqual(["VBAT", "GND", "PWM1", "PWM2", "PWM3", "PWM4"]);
      expect(input.assumptions).toEqual(dronePlan(4, false).assumptions);
      expect(input.coverage).toEqual(dronePlan(4, false).coverage);
      expect(input.rationale.length).toBeLessThanOrEqual(600);
      expect(input.assumptions.every((line) => line.length <= 200)).toBe(true);
    }
    expect(requestFeatures(OWNER_FOUR_MOTOR_SENTENCE)).toMatchObject({ drone: true, motors: 4, barometer: false });
  });

  it("'2 motors' plans two driver stages; five or more motors and a hexacopter have no recipe (no plan, a text decline)", () => {
    const two = planTurn("a drone with 2 motors").toolCalls[0]!.input as { blocks: Array<{ sharedNets: string[] }> };
    expect(two.blocks[1]!.sharedNets).toEqual(["VBAT", "GND", "PWM1", "PWM2"]);
    expect(two.blocks[2]!.sharedNets).toEqual(["+3V3", "GND", "PWM1", "PWM2", "I2C_SDA", "I2C_SCL", "IMU_INT1"]);
    for (const sentence of ["a drone with 6 motors", "build a hexacopter controller"]) {
      expect(selectRecipe(sentence), sentence).toBeNull();
      expect(planTurn(sentence).toolCalls).toEqual([]);
    }
  });

  it("the dimmer sentence and a paraphrase select the dimmer; the blinker prompt the blinker; a request with no recipe gets no plan and no tool call", () => {
    for (const sentence of DIMMER_SENTENCES) {
      expect(selectRecipe(sentence), sentence).toMatchObject({ kind: "single", key: "led-dimmer" });
      expect(planTurn(sentence).toolCalls).toEqual([]);
    }
    expect(selectRecipe(BLINKER_ACCEPTANCE_PROMPT)).toMatchObject({ kind: "single", key: "blinker" });
    for (const request of UNKNOWN_REQUESTS) {
      expect(selectRecipe(request), request).toBeNull();
      expect(planTurn(request)).toEqual({ text: "", toolCalls: [], stopReason: "end_turn" });
      const turn = scriptedGenerationTurn({ provider: "openai", messages: [{ role: "user", content: request }] });
      expect(turn).toEqual({ text: DECLINE_TEXT, toolCalls: [], stopReason: "end_turn" });
    }
    // a block-split prompt (strategy S5) is designed as one circuit: no plan
    expect(planTurn(`Block: ${DRONE_BLOCK_NAMES.mcu}\n\nbrief\n\nSHARED BOARD NETS (connect to these by exact-name labels): +3V3, GND, PWM1`).toolCalls).toEqual([]);
    // a strategy seed after the request never changes the choice
    expect(designOf(`${DIMMER_SENTENCES[0]}\n\n[Design strategy S2-fresh-seeded: this is a NEW attempt. drone quadcopter 4 motors]`)).toMatchObject({ design: { key: "led-dimmer" } });
  });
});

describe("[PR-L6 L.7] 3. every design is grounded in what its searches returned, and electrically sane", () => {
  const cases: Array<{ label: string; prompt: string; block: PlannedBlock | null; refs: number }> = [
    { label: "blinker", prompt: BLINKER_ACCEPTANCE_PROMPT, block: null, refs: 9 },
    { label: "LED dimmer", prompt: DIMMER_SENTENCES[0]!, block: null, refs: 14 },
    ...[1, 2, 3, 4].flatMap((motors) => dronePlan(motors, false).blocks.map((block) => ({ label: `drone(${motors}) ${block.name}`, prompt: OWNER_FOUR_MOTOR_SENTENCE, block, refs: block.name === DRONE_BLOCK_NAMES.power ? 5 : block.name === DRONE_BLOCK_NAMES.motors ? 5 * motors : block.name === DRONE_BLOCK_NAMES.mcu ? 11 : 5 }))),
  ];
  it.each(cases)("$label: partIds and pin numbers from the returned results, orderable values, 0 ERC criticals, two calls", async ({ label, prompt, block, refs }) => {
    const { run, calls, returned, submitted } = await designBlock(prompt, block);
    expect(run.end.kind, label).toBe("submitted");
    expect(calls).toHaveLength(2);
    expect(submitted).toHaveLength(1);
    expect(submitted[0]!.components).toHaveLength(refs);
    expectGrounded(submitted[0]!, returned, label);
    const erc = runErc(submitted[0]!, ercParts());
    expect(erc.criticalCount, `${label}: ${erc.errors.map((error) => error.message).join(" | ")}`).toBe(0);
    if (run.end.kind === "submitted") expect(run.end.explanation).not.toContain("dropped");
  });

  it("the dimmer prefers the PUBLISHED 1N4148W over the unresolved 1N4148 the same search returned", async () => {
    const { submitted, returned } = await designBlock(DIMMER_SENTENCES[0]!, null);
    expect(returned.has(FIXTURE_RESOLUTION_PART_IDS.unresolvedDiode)).toBe(true); // the search did return the unresolved part
    const diodes = submitted[0]!.components.filter((component) => component.refDes === "D1" || component.refDes === "D2");
    expect(diodes.map((component) => component.partId)).toEqual([FIXTURE_RESOLUTION_PART_IDS.eligibleDiode, FIXTURE_RESOLUTION_PART_IDS.eligibleDiode]);
  });
});

describe("[PR-L6 L.7] 4. a role nothing fits: a text reply, never an invented part", () => {
  it("without the AO3400A in the catalog the motor block searches (empty), tries its alternative, replies in text naming the role and never submits", async () => {
    const inner = fixtureGenerationCatalogPort();
    const withoutNmos: BuildCatalogPort = { ...inner, identity: inner.identity, async searchParts(query, category, limit, options) { return (await inner.searchParts(query, category, limit, options)).filter((part) => part.partId !== GENERATION_FIXTURE_PART_IDS.nmos); }, findAlternates: inner.findAlternates.bind(inner), partsByIds: inner.partsByIds.bind(inner) };
    const block = dronePlan(4, false).blocks[1]!;
    const { run, calls, searches, submitted } = await designBlock(OWNER_FOUR_MOTOR_SENTENCE, block, withoutNmos);
    expect(run.end.kind).toBe("turn_allowance");
    expect(submitted).toEqual([]);
    expect(searches.find((search) => search.query.startsWith("AO3400A"))).toMatchObject({ count: 0 });
    expect(searches.filter((search) => /mosfet/i.test(search.query)).map((search) => search.query)).toEqual(["AO3400A N-channel MOSFET SOT-23", "N-channel MOSFET logic-level"]);
    const texts = calls.map((call) => call.answer.text).filter(Boolean);
    expect(texts.length).toBeGreaterThan(0);
    expect(texts.every((text) => text.includes("logic-level N-channel MOSFET") && text.includes("will not substitute or invent"))).toBe(true);
  });
});

describe("[PR-L6 L.7] 5. the fixture search carries the published authority facts production's search attaches", () => {
  it("verified with the link's footprint and the sorted non-default value keys for linked parts; nothing for a part with no approved link; partsByIds unchanged", async () => {
    const parts = fixtureRuntimeCatalog().cachedParts;
    expect(fixtureSearchAuthority(parts.get(BLINKER_PART_IDS.resistor)!)).toEqual({ physicalAuthority: "verified", verifiedFootprint: "Resistor_SMD:R_0805_2012Metric", orderableValues: ["10k", "330", "56k"] });
    expect(fixtureSearchAuthority(parts.get(BLINKER_PART_IDS.timer)!)).toEqual({ physicalAuthority: "verified", verifiedFootprint: "Package_SO:SOIC-8_3.9x4.9mm_P1.27mm" });
    expect(fixtureSearchAuthority(parts.get(GENERATION_FIXTURE_PART_IDS.potentiometer)!)).toEqual({ physicalAuthority: "verified", verifiedFootprint: "Potentiometer_THT:Potentiometer_Bourns_3386P_Vertical", orderableValues: ["10k"] });
    expect(fixtureSearchAuthority(parts.get(FIXTURE_RESOLUTION_PART_IDS.unresolvedDiode)!)).toEqual({});
    // a withdrawn or unapproved link is no authority
    const resistor = parts.get(BLINKER_PART_IDS.resistor)!;
    expect(fixtureSearchAuthority({ ...resistor, withdrawnValueKeys: ["56k"] }).orderableValues).toEqual(["10k", "330"]);
    expect(fixtureSearchAuthority({ atomicAssignments: { "": { ...resistor.atomicAssignments!["10k"]!, approved: false as unknown as true } } })).toEqual({});
    const port = fixtureGenerationCatalogPort();
    const [hit] = await port.searchParts("0805 resistor", "Resistor", 5, {});
    expect(hit).toMatchObject({ partId: BLINKER_PART_IDS.resistor, physicalAuthority: "verified", orderableValues: ["10k", "330", "56k"] });
    const [byId] = await port.partsByIds([BLINKER_PART_IDS.resistor]);
    expect(byId).not.toHaveProperty("physicalAuthority");
    expect(byId).not.toHaveProperty("orderableValues");
  });
});

describe("[PR-L6 L.7] 6. stateless over the stored conversation", () => {
  it("the same conversation gets the same answer; a named pin is resolved by name, by a '/' token, or by number", async () => {
    const { calls } = await designBlock(OWNER_FOUR_MOTOR_SENTENCE, dronePlan(4, false).blocks[2]!);
    for (const call of calls) expect(fixtureGenerationAnswer({ ...call.request, messages: structuredClone(call.request.messages) })).toEqual(call.answer);
    const atmega = fixtureRuntimeCatalog().cachedParts.get(GENERATION_FIXTURE_PART_IDS.mcu)!.pins;
    expect(resolvePins(atmega, "GND")).toEqual(["3", "5", "21"]);
    expect(resolvePins(atmega, "~{RESET}")).toEqual(["29"]);
    expect(resolvePins(atmega, "#20")).toEqual(["20"]);
    expect(resolvePins(atmega, "PB9")).toEqual([]);
    const submit = calls.flatMap((call) => call.answer.toolCalls).find((call: LLMToolCall) => call.name === "submit_schematic")!;
    const labels = (submit.input.connections as Array<{ kind: string; pin?: string; labelName?: string }>).filter((connection) => connection.kind === "label" && connection.pin?.startsWith("U1."));
    expect(labels.filter((connection) => connection.labelName === "GND").map((connection) => connection.pin)).toEqual(["U1.3", "U1.5", "U1.21"]);
    expect(labels.filter((connection) => /^PWM/.test(connection.labelName ?? "")).map((connection) => `${connection.labelName}@${connection.pin}`)).toEqual(["PWM1@U1.10", "PWM2@U1.9", "PWM3@U1.13", "PWM4@U1.14"]);
  });
});
