/**
 * [PR-L6, 2026-10-19] OD-253 item 3 (l6-remaining.md item 9): the merge's shared-net obligations gain the plan's rail rule - "exactly ONE
 * block must SOURCE each power rail" (PLAN_SYSTEM_PROMPT). Two blocks sourcing one rail (two regulator outputs on +3V3) is a finding; a
 * power rail no block sources (VBAT labelled only on inputs) is a finding; a battery header, a supply or a regulator output is a source
 * (the electrical check's own reading, lib/erc.ts). The existing obligation - every shared net labelled in at least two blocks - is
 * unchanged, and a design without parts read (the check skipped) adds no rail finding.
 *
 * The real `mergeAndValidate` and the real electrical check over pin-valid offline parts; no provider, no database.
 */
import { describe, expect, it, vi } from "vitest";
import type { AiPartResult } from "@/app/lib/parts-search";
import { mergeAndValidate, type MergeBlockDesign } from "../build-multi-generation";
import { BUILD_BUDGET, type BuildBudgetReport } from "../build-result";

const part = (partId: string, name: string, pins: Array<[string, string]>): AiPartResult => ({ partId, name, mpn: null, description: "Offline pin-valid fixture, not a component recommendation.", mainCategory: "Other", pins: pins.map(([pinName, type], index) => ({ number: String(index + 1), name: pinName, type })), lifecycleStatus: "active", similarity: 1 });
const PARTS = new Map<string, AiPartResult>([
  ["p-ldo", part("p-ldo", "Offline LDO", [["VIN", "power_in"], ["VOUT", "power_out"], ["GND", "power_in"]])],
  ["p-mcu", part("p-mcu", "Offline MCU", [["VDD", "power_in"], ["GND", "power_in"], ["PA0", "bidirectional"]])],
  ["p-fet", part("p-fet", "Offline N-MOSFET", [["G", "input"], ["D", "passive"], ["S", "passive"]])],
  ["p-diode", part("p-diode", "Offline Schottky", [["A", "passive"], ["K", "passive"]])],
  ["p-bat", part("p-bat", "Offline 2-pin battery header", [["VBAT", "passive"], ["GND", "passive"]])],
  ["p-motor", part("p-motor", "Offline 2-pin motor header", [["M+", "passive"], ["M-", "passive"]])],
]);
const budget = (): BuildBudgetReport => ({ iterationCap: BUILD_BUDGET.iterationCap, iterationsUsed: 1, deadlineMs: BUILD_BUDGET.deadlineMs, elapsedMs: 1, concurrencyCap: BUILD_BUDGET.concurrencyCap });
const label = (pin: string, labelName: string, labelKind: "power" | "ground" | "label" = labelName === "GND" ? "ground" : /^(\+|V)/.test(labelName) ? "power" : "label") => ({ kind: "label" as const, pin, labelName, labelKind });
const partsByIds = vi.fn(async (ids: string[]) => ids.flatMap((id) => (PARTS.has(id) ? [structuredClone(PARTS.get(id)!)] : [])));
const merge = (designed: MergeBlockDesign[], options: { parts?: boolean } = {}) => mergeAndValidate({ designed, omittedBlocks: [], rationale: "", planner: { state: "planned", blocks: designed.length }, budget, emptyBlocks: "refuse", partsByIds: options.parts === false ? async () => { throw new Error("catalog unavailable"); } : partsByIds });

/** Power with its own LDO on +3V3; a second "power" block with ANOTHER LDO on +3V3; motors that use VBAT on diodes and FETs only. */
const DOUBLE_SOURCE_NO_VBAT: MergeBlockDesign[] = [
  { name: "Power", sharedNets: ["VBAT", "+3V3", "GND"], netlist: { components: [{ refDes: "U1", partId: "p-ldo", value: "3.3V", role: "regulator" }], connections: [label("U1.VIN", "VBAT"), label("U1.VOUT", "+3V3"), label("U1.GND", "GND")], explanation: "Power." } },
  { name: "Flight controller", sharedNets: ["+3V3", "GND", "PWM1"], netlist: { components: [{ refDes: "U1", partId: "p-ldo", value: "3.3V", role: "regulator" }, { refDes: "U2", partId: "p-mcu", value: "MCU", role: "processor" }], connections: [label("U1.VIN", "VBAT"), label("U1.VOUT", "+3V3"), label("U1.GND", "GND"), label("U2.VDD", "+3V3"), label("U2.GND", "GND"), label("U2.PA0", "PWM1")], explanation: "MCU with its own regulator." } },
  { name: "Motor drivers", sharedNets: ["VBAT", "GND", "PWM1"], netlist: { components: [{ refDes: "Q1", partId: "p-fet", value: "N-MOSFET", role: "output" }, { refDes: "D1", partId: "p-diode", value: "Schottky", role: "support", parentRefDes: "Q1" }], connections: [label("Q1.G", "PWM1"), label("Q1.S", "GND"), { kind: "wire", from: "Q1.D", to: "D1.A" }, label("D1.K", "VBAT")], explanation: "One channel." } },
];
/** The same plan, sourced right: a battery header sources VBAT, one LDO sources +3V3, a motor header on VBAT is no second source. */
const ONE_SOURCE_EACH: MergeBlockDesign[] = [
  { name: "Power", sharedNets: ["VBAT", "+3V3", "GND"], netlist: { components: [{ refDes: "J1", partId: "p-bat", value: "1S", role: "connector" }, { refDes: "U1", partId: "p-ldo", value: "3.3V", role: "regulator" }], connections: [label("J1.VBAT", "VBAT"), label("J1.GND", "GND"), label("U1.VIN", "VBAT"), label("U1.VOUT", "+3V3"), label("U1.GND", "GND")], explanation: "Power." } },
  { name: "Flight controller", sharedNets: ["+3V3", "GND", "PWM1"], netlist: { components: [{ refDes: "U2", partId: "p-mcu", value: "MCU", role: "processor" }], connections: [label("U2.VDD", "+3V3"), label("U2.GND", "GND"), label("U2.PA0", "PWM1")], explanation: "MCU." } },
  { name: "Motor drivers", sharedNets: ["VBAT", "GND", "PWM1"], netlist: { components: [{ refDes: "Q1", partId: "p-fet", value: "N-MOSFET", role: "output" }, { refDes: "J2", partId: "p-motor", value: "motor", role: "connector" }], connections: [label("Q1.G", "PWM1"), label("Q1.S", "GND"), { kind: "wire", from: "Q1.D", to: "J2.M-" }, label("J2.M+", "VBAT")], explanation: "One channel." } },
];

describe("[PR-L6] the shared-net obligations: exactly one block sources each power rail (OD-253 item 3)", () => {
  it("1. two blocks sourcing +3V3 and no block sourcing VBAT are both findings; the labelled-in-two-blocks obligation is unchanged", async () => {
    const outcome = await merge(DOUBLE_SOURCE_NO_VBAT);
    if (outcome.kind !== "merged") throw new Error("merged expected");
    expect(outcome.sharedNets.checked).toBe(4);
    expect(outcome.sharedNets.findings).toEqual([ // in the plan's shared-net order
      "Power rail VBAT has no source in any block (no regulator output, supply or power connector pin is on it).",
      "Power rail +3V3 is sourced in 2 blocks (Power, Flight controller); exactly one block should source each rail.",
    ]);
  });

  it("2. a battery header sources VBAT, one regulator output sources +3V3, and a motor header on VBAT is no second source: no finding", async () => {
    const outcome = await merge(ONE_SOURCE_EACH);
    if (outcome.kind !== "merged") throw new Error("merged expected");
    expect(outcome.sharedNets).toEqual({ checked: 4, findings: [] });
  });

  it("3. the existing obligation stands beside the rail rule; without the parts read (the check skipped) no rail finding is made up", async () => {
    const unlabelled: MergeBlockDesign[] = ONE_SOURCE_EACH.map((block) => (block.name === "Flight controller" ? { ...block, netlist: { ...block.netlist, connections: block.netlist.connections.filter((connection) => !("labelName" in connection) || connection.labelName !== "PWM1") } } : block));
    const outcome = await merge(unlabelled);
    if (outcome.kind !== "merged") throw new Error("merged expected");
    expect(outcome.sharedNets.findings).toEqual(["Shared net PWM1 is labelled in 1 block(s) (Motor drivers); a shared net must join at least two blocks."]);
    const skipped = await merge(DOUBLE_SOURCE_NO_VBAT, { parts: false });
    if (skipped.kind !== "merged") throw new Error("merged expected");
    expect(skipped.body.electricalCheck.state).toBe("skipped");
    expect(skipped.sharedNets.findings).toEqual([]); // the labels are there; with no pin facts the rail rule says nothing
  });
});
