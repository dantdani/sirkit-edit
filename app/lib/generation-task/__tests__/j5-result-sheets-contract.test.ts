/**
 * [PR-J, 2026-10-22] Runbook J.6.3 / J.8.1, increment J5-1 (OD-255 items 1 and 9): the generation result's OPTIONAL `sheets` field
 * (`sirkit.generation-task-result.v1`, app/lib/generation-task/contracts.ts). What it proves:
 *
 *  1. persisted-result compatibility: a result WITHOUT sheets digests exactly as before the field existed (two pinned pre-change vectors,
 *     a single design and a planned partial one) and is still judged valid - every stored result keeps its identity;
 *  2. a planned result WITH a derived sheet set is judged valid; the set is digested (tampering moves the digest) and judged with closed
 *     keys and cross-references; only a planned result may carry one, and its designed sheets must hold exactly the netlist's components;
 *  3. building never refuses a result because of its sheet set: a malformed set is recorded as one page with a finding, and a set that
 *     would push the result over its 1 MB bound is recorded as one page too ("did not fit"), the result kept.
 * Pure: no store, no provider, no database, no network.
 */
import { describe, expect, it } from "vitest";
import { buildGenerationTaskResult, generationResultDigest, generationTaskResultIssue, GENERATION_TASK_BOUNDS, type GenerationTaskResultPayload } from "../contracts";
import { canonicalBytes } from "../vocabulary";
import { mergeBuildNetlists } from "@/app/lib/merge-netlists";
import { deriveGeneratedSheets, GENERATION_SHEETS_SCHEMA, type GeneratedSheets } from "@/app/lib/schematic/generated-sheets";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";

const TASK = "generation-task:0123456789abcdef0123456789abcdef";
const AT = "2026-10-22T12:00:00.000Z";
const REF_A = { recordId: "durable-record:0123456789abcdef0123456789abcdef", recordDigest: `dw1-${"ab".repeat(32)}` };
const REF_B = { recordId: "durable-record:fedcba9876543210fedcba9876543210", recordDigest: `dw1-${"cd".repeat(32)}` };

/** The two vectors pinned BEFORE the optional field existed (computed at 5bf1e599 with the unchanged builder). */
const SINGLE_INPUT = {
  taskId: TASK, at: AT, status: "complete" as const, omittedBlocks: [],
  netlist: { components: [{ refDes: "U1", partId: "part-555", value: "NE555D", role: "processor" as const }, { refDes: "R1", partId: "part-r", value: "10k", role: "passive" as const }], connections: [{ kind: "label" as const, pin: "U1.VCC", labelName: "VCC", labelKind: "power" as const }, { kind: "label" as const, pin: "U1.GND", labelName: "GND", labelKind: "ground" as const }, { from: "R1.1", to: "U1.DISCH" }], explanation: "A 555 blinker." },
  explanation: "A 555 blinker.", electricalCheck: { state: "passed" as const, criticalCount: 0 as const, warningCount: 0 }, planner: { state: "single" as const, reason: "simple_request" as const },
  sharedNets: { checked: 0, findings: [] }, blocks: [{ blockId: "main" as const, ...REF_A }],
};
const SINGLE_DIGEST = "dw1-10fda1924801351f368303fe2dbd47dc4fa0473402ed6d0755d26975a9dd4e3f";
const PLANNED_INPUT = {
  taskId: TASK, at: AT, status: "partial" as const, omittedBlocks: ["Barometer"],
  netlist: { components: [{ refDes: "U1", partId: "part-ldo", value: "MIC5504", role: "regulator" as const }, { refDes: "U2", partId: "part-mcu", value: "ATmega328P-AU", role: "processor" as const }], connections: [{ kind: "label" as const, pin: "U1.VOUT", labelName: "+3V3", labelKind: "power" as const }, { kind: "label" as const, pin: "U2.VCC", labelName: "+3V3", labelKind: "power" as const }, { kind: "label" as const, pin: "U1.GND", labelName: "GND", labelKind: "ground" as const }, { kind: "label" as const, pin: "U2.GND", labelName: "GND", labelKind: "ground" as const }], explanation: "Designed as 2 subsystem block(s)." },
  explanation: "Designed as 2 subsystem block(s).", electricalCheck: { state: "findings" as const, criticalCount: 0, warningCount: 1, findings: ["U2.ADC6: input floating"] }, planner: { state: "planned" as const, blocks: 3 },
  sharedNets: { checked: 2, findings: [] }, blocks: [{ blockId: "b1" as const, ...REF_A }, { blockId: "b2" as const, ...REF_B }],
};
const PLANNED_DIGEST = "dw1-357cd101112cf3b036c13f162a76479af2aeb3c11ca345cb1964e2a03303893a";

/** A planned three-block result (one omitted) with its derived sheet set, as the merge slice builds it. */
function plannedWithSheets(): { input: Omit<GenerationTaskResultPayload, "schema" | "resultDigest">; sheets: GeneratedSheets } {
  const power: BuildLogicalNetlist = { components: [{ refDes: "U1", partId: "part-ldo", value: "MIC5504", role: "regulator" }], connections: [{ kind: "label", pin: "U1.VOUT", labelName: "+3V3" }, { kind: "label", pin: "U1.GND", labelName: "GND" }, { kind: "label", pin: "U1.EN", labelName: "PG" }], explanation: "" };
  const mcu: BuildLogicalNetlist = { components: [{ refDes: "U1", partId: "part-mcu", value: "ATmega328P-AU", role: "processor" }], connections: [{ kind: "label", pin: "U1.VCC", labelName: "+3V3" }, { kind: "label", pin: "U1.GND", labelName: "GND" }, { kind: "label", pin: "U1.PD2", labelName: "PG" }], explanation: "" };
  const merged = mergeBuildNetlists([{ name: "Power", netlist: power }, { name: "MCU", netlist: mcu }]);
  const sheets = deriveGeneratedSheets({
    planned: [{ blockId: "b1", name: "Power", sharedNets: ["+3V3", "GND", "PG"], status: "designed" }, { blockId: "b2", name: "MCU", sharedNets: ["+3V3", "GND", "PG", "I2C_SDA"], status: "designed" }, { blockId: "b3", name: "Barometer", sharedNets: ["+3V3", "GND", "I2C_SDA"], status: "omitted" }],
    designed: merged.blocks.map((block, index) => ({ blockId: `b${index + 1}`, name: block.name, netlist: block.netlist })), flat: merged.netlist, parts: null,
  });
  return {
    sheets,
    input: {
      taskId: TASK, at: AT, status: "partial", omittedBlocks: ["Barometer"], netlist: { ...merged.netlist, explanation: "Designed as 2 subsystem block(s)." }, explanation: "Designed as 2 subsystem block(s).",
      electricalCheck: { state: "passed", criticalCount: 0, warningCount: 0 }, planner: { state: "planned", blocks: 3 }, sharedNets: { checked: 4, findings: [] }, blocks: [{ blockId: "b1", ...REF_A }, { blockId: "b2", ...REF_B }], sheets,
    },
  };
}

describe("[PR-J J5-1] persisted results keep their identity", () => {
  it("1. a result without sheets digests exactly as before the field existed (single and planned vectors) and is still judged valid", () => {
    const single = buildGenerationTaskResult(SINGLE_INPUT);
    expect(single.resultDigest).toBe(SINGLE_DIGEST);
    expect(single).not.toHaveProperty("sheets");
    expect(generationTaskResultIssue(single)).toBeNull();
    const planned = buildGenerationTaskResult(PLANNED_INPUT);
    expect(planned.resultDigest).toBe(PLANNED_DIGEST);
    expect(planned).not.toHaveProperty("sheets");
    expect(generationTaskResultIssue(planned)).toBeNull();
    // a stored document (plain JSON, read back from the record) is judged the same way
    expect(generationTaskResultIssue(JSON.parse(JSON.stringify(planned)))).toBeNull();
  });
});

describe("[PR-J J5-1] a planned result carries its sheet set", () => {
  it("2a. the derived set is recorded whole, judged valid and digested (tampering moves the digest)", () => {
    const { input, sheets } = plannedWithSheets();
    expect(sheets.sheets!.children.map((child) => [child.sheetKey, child.status, child.components])).toEqual([["b1", "designed", ["U1"]], ["b2", "designed", ["U2"]], ["b3", "omitted", []]]);
    const result = buildGenerationTaskResult(input);
    expect(result.sheets).toEqual(sheets);
    expect(generationTaskResultIssue(result)).toBeNull();
    const { sheets: _dropped, ...withoutSheets } = result; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(result.resultDigest).not.toBe(generationResultDigest(withoutSheets));
    const tampered = structuredClone(result);
    tampered.sheets!.sheets!.interfaces[0]!.state = "unbound";
    expect(generationTaskResultIssue(tampered)).toMatch(/resultDigest/);
  });

  it("2b. the judge refuses an unknown key, a broken cross-reference, a single design's sheet set and sheets that are not the netlist's components", () => {
    const { input } = plannedWithSheets();
    const result = buildGenerationTaskResult(input);
    const redigest = (payload: GenerationTaskResultPayload): GenerationTaskResultPayload => ({ ...payload, resultDigest: generationResultDigest(payload) });
    const variant = (mutate: (payload: GenerationTaskResultPayload) => void): string | null => { const copy = structuredClone(result); mutate(copy); return generationTaskResultIssue(redigest(copy)); };
    expect(variant((payload) => { (payload.sheets as unknown as Record<string, unknown>).extra = 1; })).toMatch(/unknown key/);
    expect(variant((payload) => { (payload.sheets!.sheets!.children[0] as unknown as Record<string, unknown>).hidden = true; })).toMatch(/unknown key/);
    expect(variant((payload) => { payload.sheets!.sheets!.children[1]!.ports[0]!.portKey = "b1:PG"; })).toMatch(/port key/);
    expect(variant((payload) => { payload.sheets!.sheets!.interfaces[0]!.ports.push("b3:NOPE"); })).toMatch(/interface/);
    expect(variant((payload) => { payload.sheets!.schema = "sirkit.generation-sheets.v0" as typeof GENERATION_SHEETS_SCHEMA; })).toMatch(/outside the closed list/);
    expect(variant((payload) => { payload.sheets!.sheets!.children[1]!.components = ["U1"]; })).toMatch(/exactly the netlist's components/);
    expect(variant((payload) => { payload.planner = { state: "single", reason: "simple_request" }; })).toMatch(/only a planned result carries a sheet set/);
    expect(variant((payload) => { payload.sheets!.findings = ["line one\nline two"]; })).toMatch(/redacted single line/);
  });

  it("3a. a malformed sheet set never costs the result: it is recorded as one page with a finding", () => {
    const { input, sheets } = plannedWithSheets();
    const broken = structuredClone(sheets);
    broken.sheets!.children[0]!.sheetKey = "b2"; // two sheets with one key
    const result = buildGenerationTaskResult({ ...input, sheets: broken });
    expect(result.sheets).toEqual({ schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: [...sheets.findings, "Kept on one page: the sheet set could not be recorded in the result."] });
    expect(generationTaskResultIssue(result)).toBeNull();
    expect(result.netlist.components).toHaveLength(2);
  });

  it("3b. a sheet set that would push the result over its 1 MB bound is recorded as one page; the result is kept", () => {
    // 512 components on 8 sheets, each sheet with 256 long local nets: the result fits without the set and not with it
    const blocks = Array.from({ length: 8 }, (_, sheet) => {
      const components = Array.from({ length: 64 }, (_, index) => ({ refDes: `R${sheet * 64 + index + 1}`, partId: "part-r", value: "10k", role: "passive" as const }));
      const nets = Array.from({ length: 256 }, (_, index) => `S${sheet}_${index}_`.padEnd(128, "X"));
      const pin = (index: number, side: string) => `${components[index % 64]!.refDes}.${`${side}${index}`.padEnd(40, "p")}`; // long pin tokens (parts unknown): the netlist itself nears the bound
      const connections = nets.flatMap((net, index) => [{ kind: "label" as const, pin: pin(index, "a"), labelName: net }, { kind: "label" as const, pin: pin(index + 1, "b"), labelName: net }]);
      return { name: `Sheet ${sheet + 1}`, netlist: { components, connections, explanation: "" } };
    });
    const merged = mergeBuildNetlists(blocks);
    const sheets = deriveGeneratedSheets({ planned: blocks.map((block, index) => ({ blockId: `b${index + 1}`, name: block.name, sharedNets: [], status: "designed" })), designed: merged.blocks.map((block, index) => ({ blockId: `b${index + 1}`, name: block.name, netlist: block.netlist })), flat: merged.netlist, parts: null });
    expect(sheets.sheets?.children).toHaveLength(8);
    const base = { taskId: TASK, at: AT, status: "complete" as const, omittedBlocks: [], netlist: merged.netlist, explanation: "", electricalCheck: { state: "passed" as const, criticalCount: 0 as const, warningCount: 0 }, planner: { state: "planned" as const, blocks: 8 }, sharedNets: { checked: 0, findings: [] }, blocks: [{ blockId: "b1" as const, ...REF_A }] };
    expect(canonicalBytes(buildGenerationTaskResult(base))).toBeLessThanOrEqual(GENERATION_TASK_BOUNDS.resultBytes);
    expect(canonicalBytes({ ...buildGenerationTaskResult(base), sheets })).toBeGreaterThan(GENERATION_TASK_BOUNDS.resultBytes);
    const result = buildGenerationTaskResult({ ...base, sheets });
    expect(result.sheets).toEqual({ schema: GENERATION_SHEETS_SCHEMA, sheets: null, findings: ["Kept on one page: the sheet set did not fit the result bound."] });
    expect(generationTaskResultIssue(result)).toBeNull();
  });
});
