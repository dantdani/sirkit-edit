/**
 * [PR-L, 2026-10-17] The stall map's deterministic reproduction, made permanent (runbook L.6; limit-and-stall-map.md section 6).
 *
 * The REAL `searchPartsForAI` runs over a real, migrated PostgreSQL (PGlite, pgvector) holding a small catalog seeded the way
 * scripts/ingest-kicad.ts seeds it: every library carries a real KiCad basename and its `main_category` is `categorizeLib(name)`,
 * never a typed-in name. That is how this suite avoids the trap the stall map names: the fixture runtime's blinker catalog uses
 * singular names of its own ("Timer", "Resistor", "Capacitor", "LED", "Connector", fixture-runtime/blinker/catalog.ts) that are not
 * the vocabulary, so a test over it can never see a model's guess miss the real names. Five parts carry selectable atomic links
 * (the blinker's published revisions), so the verified path runs. The seams: a counting, hashed bag-of-words embedding (no
 * provider), a reranker fake that refuses with Anthropic's credit error (classified insufficient_quota, llm/errors.ts), and for the
 * Build loop the REAL OpenAI adapter over a scripted Responses client. Nothing reaches a network; nothing is written outside the
 * in-process database.
 *
 * Asserted (the fixed behaviours; the stall map's section 6 assertions 2-5 and 7, flipped):
 *  1. the model's category guesses are not catalog names (an exact filter finds no row), and they are now normalized onto the real
 *     names - or, unrecognised, searched without a filter with a note - with exactly one embedding per search;
 *  2. the refused reranker is called ONCE, then remembered: later searches skip it and say the order is the fused fallback;
 *  3. relevant unverified parts are not buried: a MOSFET query returns MOSFETs first, every published passive below them, and a
 *     published part that fits as well (NE555D) still wins its tie;
 *  4. a submit_schematic cut at max_output_tokens is not accepted as a block: the loop refuses it and accepts the next whole one.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/app/lib/db/schema";
import { loadMigrationManifest } from "@/app/lib/db/migrations/manifest";
import { migrateDatabase } from "@/app/lib/db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "@/app/lib/db/disposable-postgres";
import { categorizeLib, MAIN_CATEGORIES } from "@/app/lib/kicad/categories";
import type { LLMRequest } from "@/app/lib/llm/types";

const harness = vi.hoisted(() => {
  /** A deterministic hashed bag-of-words vector (1,536 dimensions, unit length, never zero). */
  function hashed(text: string): number[] {
    const vector = new Array<number>(1_536).fill(0);
    vector[0] = 0.05;
    for (const token of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let hash = 2_166_136_261;
      for (let index = 0; index < token.length; index++) hash = Math.imul(hash ^ token.charCodeAt(index), 16_777_619) >>> 0;
      vector[1 + (hash % 1_535)]! += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return vector.map((value) => value / norm);
  }
  return { hashed, embedded: [] as string[], rerank: vi.fn(), openai: vi.fn(), openaiRequests: [] as Array<Record<string, unknown>> };
});

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/app/lib/db/client", () => ({ getDb: () => orm }));
vi.mock("@/app/lib/embeddings", async (original) => ({
  ...(await original() as object),
  embedQuery: vi.fn(async (text: string) => { harness.embedded.push(text); return harness.hashed(text); }),
}));
vi.mock("@anthropic-ai/sdk", () => ({ default: class OfflineReranker { messages = { create: (...args: unknown[]) => harness.rerank(...args) }; } }));
vi.mock("@/app/lib/llm/router", async () => {
  const { OpenAIProvider } = await import("@/app/lib/llm/openai-provider");
  const provider = new OpenAIProvider({ responses: { create: async (params: Record<string, unknown>) => { harness.openaiRequests.push(params); return harness.openai(params); } } } as never, "gpt-test");
  return { llmRouter: { generate: (request: LLMRequest) => provider.generate(request) } };
});

import { RerankRefusalMemo, searchPartsForAI, type AiPartResult, type PartsSearchOutcome } from "@/app/lib/parts-search";

/** Anthropic's 400 for an exhausted credit balance, as the SDK throws it. */
const creditRefusal = () => Object.assign(new Error("400 credit balance"), { status: 400, error: { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } } });

type Pin = { number: string; name: string; type: string };
const pins = (spec: string): Pin[] => spec.split(" ").map((entry, index) => { const [name, type] = entry.split(":"); return { number: String(index + 1), name: name!, type: type ?? "passive" }; });
const DRV8833_PINS = pins("nSLEEP:input AOUT1:output AISEN AOUT2:output BOUT2:output BISEN BOUT1:output nFAULT:open_collector BIN1:input BIN2:input VCP VM:power_in GND:power_in VINT:power_out AIN2:input AIN1:input");
const many = (count: number, prefix: string): Pin[] => Array.from({ length: count }, (_, index) => ({ number: String(index + 1), name: `${prefix}${index + 1}`, type: "bidirectional" }));

/** The catalog: [KiCad library, symbol name, description, keywords, pins, generic, published link (blinker part + value)]. */
const CATALOG: Array<[string, string, string, string, Pin[], boolean, [keyof typeof import("@/app/lib/fixture-runtime/blinker/catalog").BLINKER_PART_IDS, string] | null]> = [
  ["Device", "R", "Resistor", "R res resistor", pins("~ ~"), true, ["resistor", "10k"]],
  ["Device", "C", "Unpolarized capacitor", "cap capacitor", pins("~ ~"), true, ["capacitor", "100nF"]],
  ["Device", "LED", "Light emitting diode", "LED diode", pins("K A"), true, ["led", ""]],
  ["Device", "L", "Inductor", "inductor choke coil", pins("1 2"), true, null], // an unlinked generic: hidden from the AI search
  ["Connector_Generic", "Conn_01x02", "Generic connector, single row, 01x02", "connector", pins("Pin_1 Pin_2"), true, ["header", ""]],
  ["Timer", "NE555D", "Precision Timers, 555 compatible, SOIC-8", "single timer 555", pins("GND:power_in TR:input Q:output R:input CV:input THR:input DIS:open_collector VCC:power_in"), false, ["timer", ""]],
  ["Timer", "LM555xM", "Timer, 555 compatible, SOIC-8", "single timer 555", pins("GND:power_in TR:input Q:output R:input CV:input THR:input DIS:open_collector VCC:power_in"), false, null],
  ["Transistor_FET", "AO3400A", "30V Vds, 5.7A Id, N-Channel MOSFET, SOT-23", "N-Channel MOSFET", pins("G:input S D"), false, null],
  ["Transistor_FET", "IRLML6344", "5A Id, 30V Vds, logic-level N-Channel HEXFET MOSFET, SOT-23", "N-Channel MOSFET", pins("G:input S D"), false, null],
  ["Transistor_FET", "2N7002", "0.115A Id, 60V Vds, N-Channel MOSFET, SOT-23", "N-Channel MOSFET", pins("G:input S D"), false, null],
  ["Transistor_BJT", "MMBT3904", "0.2A Ic, 40V Vce, Small Signal NPN Transistor, SOT-23", "NPN transistor", pins("B:input E C"), false, null],
  ["Driver_Motor", "DRV8833PWP", "Dual H-Bridge Motor Driver, 1.5A, 2.7-10.8V, HTSSOP-16", "H-bridge motor driver", DRV8833_PINS, false, null],
  ["Driver_Motor", "DRV8871DDA", "Brushed DC Motor Driver, 3.6A, 6.5-45V, SO-8", "H-bridge motor driver brushed", pins("GND:power_in IN2:input IN1:input ILIM VM:power_in OUT1:output ISEN OUT2:output"), false, null],
  ["Driver_FET", "TC4427", "Dual MOSFET gate driver, 1.5A", "MOSFET driver", pins("NC IN_A:input GND:power_in IN_B:input OUT_B:output VDD:power_in OUT_A:output NC"), false, null],
  ["MCU_ST_STM32F4", "STM32F405RGTx", "ARM Cortex-M4 MCU, 1024KB flash, 192KB RAM, 168MHz, LQFP-64", "Arm Cortex-M4 STM32F4 STM32F405/415", many(64, "PA"), false, null],
  ["MCU_Microchip_ATmega", "ATmega328P-A", "20MHz, 32kB Flash, 2kB SRAM, 1kB EEPROM, TQFP-32", "AVR 8bit Microcontroller MegaAVR", many(32, "PB"), false, null],
  ["Sensor_Motion", "MPU-6050", "InvenSense 6-Axis Motion Sensor, Gyroscope, Accelerometer, I2C", "mems IMU gyroscope accelerometer", many(24, "IO"), false, null],
  ["Sensor_Motion", "BMI088", "6-axis IMU, accelerometer and gyroscope, SPI/I2C, LGA-16", "IMU gyroscope accelerometer", many(16, "IO"), false, null],
  ["Regulator_Linear", "AMS1117-3.3", "1A Low Dropout regulator, positive, 3.3V fixed output, SOT-223", "linear regulator ldo fixed positive", pins("GND:power_in VO:power_out VI:power_in"), false, null],
  ["Regulator_Linear", "AP2112K-3.3", "600mA low dropout linear regulator, 3.3V, SOT-23-5", "linear regulator ldo", pins("VIN:power_in GND:power_in EN:input NC VOUT:power_out"), false, null],
  ["Regulator_Switching", "MP1584EN", "3A step-down buck converter, 4.5-28V input, SOIC-8", "buck converter step-down", pins("SW:output EN:input COMP FB:input GND:power_in FREQ VIN:power_in BST"), false, null],
  ["Connector_JST", "JST_PH_B2B-PH-K_1x02", "JST PH series connector, 2 pins, through hole", "connector JST PH", pins("Pin_1 Pin_2"), false, null],
  ["Connector_USB", "USB_C_Receptacle_USB2.0", "USB 2.0-only Type-C Receptacle connector", "usb universal serial bus type-C USB2.0", many(16, "P"), false, null],
  ["Diode", "1N5819", "40V 1A Schottky Barrier Rectifier Diode, DO-41", "diode Schottky", pins("K A"), false, null],
];
const PUBLISHED = CATALOG.filter((entry) => entry[6] !== null).map((entry) => entry[1]);
const partIds = new Map<string, string>();

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const { blinkerCatalog, BLINKER_PART_IDS } = await import("@/app/lib/fixture-runtime/blinker/catalog");
  const { publishPortableAtomicSnapshot } = await import("@/app/lib/atomic/server-repository");
  const { normalizeValueKey } = await import("@/app/lib/atomic/value-key");
  const blinker = blinkerCatalog();
  const libraryIds = new Map<string, string>();
  for (const [library, name, description, keywords, partPins, generic, published] of CATALOG) {
    if (!libraryIds.has(library)) {
      // the ingest path: scripts/ingest-kicad.ts writes `mainCategory: categorizeLib(name)` - never a typed-in category
      const inserted = await pg.db.query<{ id: string }>("INSERT INTO libraries (name, main_category) VALUES ($1, $2) RETURNING id", [library, categorizeLib(library)]);
      libraryIds.set(library, inserted.rows[0]!.id);
    }
    const embedding = `[${harness.hashed(`${name} ${description} ${keywords}`).join(",")}]`;
    const part = await pg.db.query<{ id: string }>(
      "INSERT INTO parts (library_id, name, description, keywords, mpn, properties, pins, symbol_raw, is_generic, embedding, lifecycle_status) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, $6::jsonb, '', $7, $8::vector, 'active') RETURNING id",
      [libraryIds.get(library)!, name, description, keywords, generic ? null : name, JSON.stringify(partPins), generic, embedding],
    );
    partIds.set(name, part.rows[0]!.id);
    if (published) {
      const [blinkerPart, value] = published;
      const revisionId = blinker.revisionFor(BLINKER_PART_IDS[blinkerPart], value)!;
      await publishPortableAtomicSnapshot({ snapshot: structuredClone(blinker.snapshots.get(revisionId)!), actorId: "user:fixture-publisher", actorRole: "publisher", requiredProfile: "pcb_assignable", reason: "L6 stall reproduction seed" });
      await pg.db.query(
        "INSERT INTO parts_atomic_links (part_id, value_key, atomic_part_revision_id, symbol_asset_version_id, footprint_asset_version_id, mapping_certificate_id, footprint_full_name) VALUES ($1, $2, $3, 'sym', 'fp', 'map', $4)",
        [part.rows[0]!.id, normalizeValueKey(value), revisionId, `Fixture:${name}`],
      );
    }
  }
}, 240_000);
afterAll(async () => { await pg?.close(); });

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "offline-test-placeholder"); // the reranker client is the fake above
  vi.stubEnv("OPENAI_API_KEY", ""); // no embedding or model client can reach a provider
  harness.embedded.length = 0;
  harness.rerank.mockReset().mockRejectedValue(creditRefusal());
  harness.openai.mockReset();
  harness.openaiRequests.length = 0;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function search(query: string, category: string | undefined, memo: RerankRefusalMemo): Promise<{ parts: AiPartResult[]; outcome: PartsSearchOutcome }> {
  let outcome: PartsSearchOutcome | null = null;
  const parts = await searchPartsForAI(query, category, 5, { rerankMemo: memo, onOutcome: (seen) => { outcome = seen; } });
  return { parts, outcome: outcome! };
}

describe("[PR-L L.6] the stall reproduction over a catalog seeded with the real category vocabulary", { timeout: 60_000 }, () => {
  it("0. the seed: every category is categorizeLib's, inside MAIN_CATEGORIES; the fixture catalog's singular names are not the vocabulary", async () => {
    const rows = (await pg.db.query<{ name: string; main_category: string }>("SELECT name, main_category FROM libraries ORDER BY name")).rows;
    for (const row of rows) {
      expect(row.main_category, row.name).toBe(categorizeLib(row.name));
      expect(MAIN_CATEGORIES, row.name).toContain(row.main_category);
    }
    for (const fixtureName of ["Timer", "Resistor", "Capacitor", "LED", "Connector"]) expect(MAIN_CATEGORIES, fixtureName).not.toContain(fixtureName);
    expect(PUBLISHED).toEqual(["R", "C", "LED", "Conn_01x02", "NE555D"]);
  });

  it("1. the model's guesses name no catalog category (an exact filter finds nothing); now each is normalized and finds its parts, one embedding per search", async () => {
    const exactCount = async (category: string) => Number((await pg.db.query<{ count: string }>("SELECT count(*)::text AS count FROM parts p JOIN libraries l ON l.id = p.library_id WHERE l.main_category = $1", [category])).rows[0]!.count);
    const memo = new RerankRefusalMemo();
    const cases = [
      ["Motor Drivers", "Drivers", "dual H-bridge motor driver"],
      ["MOSFETs", "Transistors", "N-channel MOSFET SOT-23"],
      ["Resistors", "Passive Components", "0805 resistor"],
      ["IMU", "Sensors", "6-axis IMU accelerometer gyroscope"],
      ["Regulators", "Voltage Regulators", "3.3V LDO regulator"],
      ["MCU", "Microcontrollers", "ARM Cortex-M4 microcontroller"],
    ] as const;
    for (const [guess, name, query] of cases) {
      expect(await exactCount(guess), `before: main_category = '${guess}'`).toBe(0);
      expect(await exactCount(name), name).toBeGreaterThan(0);
      const { parts, outcome } = await search(query, guess, memo);
      expect(outcome.category).toMatchObject({ status: "normalized", requested: guess, applied: name });
      expect(outcome.category.note).toBe(`Category "${guess}" is not a catalog category name; searched the "${name}" category.`);
      expect(parts.length, guess).toBeGreaterThan(0);
      expect(parts.every((part) => part.mainCategory === name), `${guess}: ${parts.map((part) => part.mainCategory).join(", ")}`).toBe(true);
    }
    // an exact catalog name stays exact; an unrecognised one is searched WITHOUT a filter and says so - never a bare []
    expect((await search("ARM Cortex-M4 microcontroller", "Microcontrollers", memo)).outcome.category).toMatchObject({ status: "exact", applied: "Microcontrollers", note: null });
    const unknown = await search("flight controller MCU with IMU", "Flight controller", memo);
    expect(unknown.outcome.category).toMatchObject({ status: "unrecognised", applied: null });
    expect(unknown.outcome.category.note).toMatch(/^Category "Flight controller" was not recognised; searched without a category filter\./);
    expect(unknown.parts.length).toBeGreaterThan(0);
    expect(new Set(unknown.parts.map((part) => part.mainCategory)).size, "unfiltered: several categories").toBeGreaterThan(1);
    // exactly one embedding per search, the unrecognised one included (no second, unfiltered pass)
    expect(harness.embedded).toHaveLength(cases.length + 2);
  });

  it("2. the reranker refuses with the credit error ONCE; it is remembered, so the next searches skip it and say the order is the fused fallback", async () => {
    const memo = new RerankRefusalMemo();
    const queries = ["dual H-bridge motor driver", "N-channel MOSFET SOT-23", "3.3V LDO regulator", "6-axis IMU", "555 timer", "USB-C connector", "Schottky diode", "ARM Cortex-M4 microcontroller"];
    const outcomes: PartsSearchOutcome[] = [];
    for (const query of queries) outcomes.push((await search(query, undefined, memo)).outcome);
    expect(harness.rerank, "before: one refused call per search with two or more candidates").toHaveBeenCalledTimes(1);
    expect(outcomes[0]!.rerank).toEqual({ state: "refused", reason: "insufficient_quota" });
    for (const outcome of outcomes.slice(1)) expect(outcome.rerank).toMatchObject({ state: "skipped", reason: "insufficient_quota" });
    expect(outcomes.every((outcome) => outcome.ranking === "fused")).toBe(true);
    expect(harness.embedded).toHaveLength(queries.length);
  });

  it("3. relevant unverified parts are not buried: a MOSFET query returns MOSFETs first and every published part below them; NE555D still wins its tie with LM555", async () => {
    const memo = new RerankRefusalMemo();
    // every visible part fits the vector pool (VECTOR_POOL is 30), so all five published parts are fused candidates: the old
    // verified-first partition put R, C, LED, Conn_01x02 and NE555D in the top five of this MOSFET query, above every MOSFET
    const visible = Number((await pg.db.query<{ count: string }>("SELECT count(*)::text AS count FROM parts p WHERE p.is_generic = false OR EXISTS (SELECT 1 FROM parts_atomic_links a WHERE a.part_id = p.id)")).rows[0]!.count);
    expect(visible).toBeLessThanOrEqual(30);
    const mosfets = await search("logic-level N-channel MOSFET SOT-23", undefined, memo);
    const names = mosfets.parts.map((part) => part.name);
    expect(names.slice(0, 3).sort()).toEqual(["2N7002", "AO3400A", "IRLML6344"]);
    const lastMosfet = Math.max(...["2N7002", "AO3400A", "IRLML6344"].map((name) => names.indexOf(name)));
    mosfets.parts.forEach((part, index) => { if (part.physicalAuthority === "verified") expect(index, part.name).toBeGreaterThan(lastMosfet); });
    const timers = await search("555 timer SOIC-8", undefined, memo);
    expect(timers.parts.slice(0, 2).map((part) => [part.name, part.physicalAuthority ?? "unverified"])).toEqual([["NE555D", "verified"], ["LM555xM", "unverified"]]);
    expect(timers.outcome.ranking).toBe("fused");
  });

  it("4. a submit_schematic cut at max_output_tokens is not accepted as a block: the real OpenAI adapter and Build loop refuse it, and the next whole netlist is the block", async () => {
    const drv = partIds.get("DRV8833PWP")!;
    const whole = {
      components: [{ refDes: "U1", partId: drv, value: "DRV8833", role: "output" }],
      connections: [
        { kind: "label", pin: "U1.VM", labelName: "VBAT", labelKind: "power" }, { kind: "label", pin: "U1.GND", labelName: "GND", labelKind: "ground" },
        { kind: "label", pin: "U1.AISEN", labelName: "GND", labelKind: "ground" }, { kind: "label", pin: "U1.BISEN", labelName: "GND", labelKind: "ground" },
        { kind: "label", pin: "U1.nSLEEP", labelName: "+3V3", labelKind: "power" },
        { kind: "label", pin: "U1.AIN1", labelName: "PWM1" }, { kind: "label", pin: "U1.AIN2", labelName: "PWM2" },
        { kind: "label", pin: "U1.BIN1", labelName: "PWM3" }, { kind: "label", pin: "U1.BIN2", labelName: "PWM4" },
        { kind: "label", pin: "U1.AOUT1", labelName: "M1_A" }, { kind: "label", pin: "U1.AOUT2", labelName: "M1_B" },
        { kind: "label", pin: "U1.BOUT1", labelName: "M2_A" }, { kind: "label", pin: "U1.BOUT2", labelName: "M2_B" },
      ],
      explanation: "One DRV8833 drives two brushed motors from VBAT.",
    };
    const cut = JSON.stringify(whole).slice(0, 180); // the arguments as a max_output_tokens stop leaves them: not JSON
    const call = (callId: string, name: string, args: string, status = "completed") => ({ type: "function_call", call_id: callId, name, arguments: args, status });
    const turns = [
      { status: "completed", output: [call("call-search", "search_parts", JSON.stringify({ query: "dual H-bridge motor driver", category: "Motor Drivers" }))] },
      { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [call("call-cut", "submit_schematic", cut, "incomplete")] },
      { status: "completed", output: [call("call-whole", "submit_schematic", JSON.stringify(whole))] },
    ];
    harness.openai.mockImplementation(async () => ({ id: "resp-l6", model: "gpt-test", output_text: "", usage: { input_tokens: 100, output_tokens: 8_192 }, ...turns.shift()! }));
    const { runBuildToolLoop } = await import("@/app/lib/build-loop");
    const { BUILD_SUBSYSTEM_SYSTEM_PROMPT } = await import("@/app/lib/prompts");
    const result = await runBuildToolLoop({ provider: "openai", systemPrompt: BUILD_SUBSYSTEM_SYSTEM_PROMPT, userMessage: "Block: Motor drivers\nTwo brushed motors from VBAT.\nShared board nets: VBAT, GND, +3V3, PWM1, PWM2, PWM3, PWM4" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.iterationsUsed).toBe(3);
    expect(result.netlist.components.map((component) => component.partId)).toEqual([drv]); // before: the cut turn ended the loop as an EMPTY block
    expect(result.erc?.criticalCount).toBe(0);
    const outputs = (index: number) => ((harness.openaiRequests[index]!.input as Array<{ type: string; call_id?: string; output?: string }>) ?? []).filter((item) => item.type === "function_call_output");
    // turn 2 saw the search's result with its category note, over the real catalog (Drivers only)
    const searched = JSON.parse(outputs(1).find((item) => item.call_id === "call-search")!.output!) as { categoryNote: string; results: Array<{ partId: string; mainCategory: string }> };
    expect(searched.categoryNote).toBe('Category "Motor Drivers" is not a catalog category name; searched the "Drivers" category.');
    expect(searched.results.map((part) => part.partId)).toContain(drv);
    expect(searched.results.every((part) => part.mainCategory === "Drivers")).toBe(true);
    // turn 3 saw the refusal of the cut submission, as an answered tool call
    expect(outputs(2).find((item) => item.call_id === "call-cut")!.output).toMatch(/^This submit_schematic was not accepted: the response stopped at the provider's output limit \(stop reason "max_tokens"\)/);
    expect(harness.openai).toHaveBeenCalledTimes(3);
  });
});
