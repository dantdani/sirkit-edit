/**
 * [PR-J5, 2026-10-23] Runbook J.6.7 (OD-259): the sheet-aware schematic read, `inspectSchematicState` 1.2.0
 * (app/lib/engineering/schematic-read.ts), pure over the frozen fixtures.
 *
 *  1. byte identity: a single-sheet document read without options is 1.1.0's output - the blinker's and the flat drone's JSON digests
 *     were computed at 5993dd68 BEFORE this change; the J3 multi-sheet fixture's 1.1.0 keys are unchanged beside the added tree;
 *  2. the tree: the J3 fixture's four sheets with their paths, component counts and ports (bound where the hierarchical label and the
 *     sheet pin both exist);
 *  3. one sheet: `sheetId: "sheet-imu"` answers exactly U3, R11, R12, C9, C10, the sheet's labels, ports and counts; the whole-project
 *     counts stay; an unknown sheet is a diagnostic over the tree, never a guess; `root` on a single-sheet document is the page;
 *  4. neighbours: over the fully organised drone the IMU sheet's I2C_SCL port joins the MCU sheet's I2C_SCL port through the
 *     connectivity authority (the overview's sheet pins), fetched only when asked; the overview itself reports its children's ports.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { inspectSchematicState, readSchematicInspectOptions } from "../schematic-read";
import { organizeSheetId, planOrganizeIntoSheets } from "@/app/lib/schematic/sheet-organization";
import { blinkerFixtureState, droneFixtureState, fixtureParts } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { J3_SHEETS, multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import { FIXTURE_DRONE_ORGANIZE_GROUPS } from "@/app/lib/agent/fixture-agent-adapter";

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
/** Computed at 5993dd68 from the 1.1.0 accessor over the frozen fixtures (scratchpad/j/inspect-digests.ts). */
const PINNED_1_1_0 = Object.freeze({
  blinker: "4202f2d91ad02d011ff395f7d71b2489a8d348e1f6787259ba5678d74f05e90a",
  drone: "7b1ea204e4d31c7f59d15d1357f7469782800907b678c0aac8c18de93b347d71",
  j3: "4fed3b8837afcce93b1a1e502dae2e6e47ee291d141dc401fd81576f11cde43c",
});

describe("[PR-J5] 1. byte identity of the whole-project read", () => {
  it("a single-sheet document read without options is 1.1.0's bytes, with no sheets or sheet key", () => {
    const blinker = inspectSchematicState(blinkerFixtureState());
    expect(sha(blinker)).toBe(PINNED_1_1_0.blinker);
    expect("sheets" in blinker || "sheet" in blinker).toBe(false);
    expect(sha(inspectSchematicState(droneFixtureState(), {}))).toBe(PINNED_1_1_0.drone);
    expect(sha(inspectSchematicState(droneFixtureState(), readSchematicInspectOptions({})))).toBe(PINNED_1_1_0.drone);
    expect(sha(inspectSchematicState(droneFixtureState(), readSchematicInspectOptions({ sheetId: "   ", neighbours: "yes" })))).toBe(PINNED_1_1_0.drone);
  });

  it("a multi-sheet document keeps every 1.1.0 key byte-identical and adds the bounded tree", () => {
    const report = inspectSchematicState(multiSheetDroneFixtureState());
    const { sheets, ...rest } = report;
    expect(sha(rest)).toBe(PINNED_1_1_0.j3);
    expect(report.components).toHaveLength(41);
    expect(sheets!.note).toContain("sheetId");
    expect(sheets!.tree.map((sheet) => [sheet.id, sheet.name, sheet.parentId, sheet.path, sheet.componentCount])).toEqual([
      ["root", "Overview", null, "", 11],
      ...J3_SHEETS.map((sheet) => [sheet.id, sheet.name, "root", sheet.name, sheet.refs.length]),
    ]);
    expect(sheets!.tree.find((sheet) => sheet.id === "sheet-motors")!.ports).toEqual(["PWM1", "PWM2", "PWM3", "PWM4"].map((name) => ({ name, direction: "passive", bound: true })));
    expect(sheets!.tree.find((sheet) => sheet.id === "sheet-power")!.ports).toEqual([]);
  });
});

describe("[PR-J5] 2. one sheet's bounded summary", () => {
  it("sheet-imu: exactly its five parts, its labels, ports and counts; the whole-project counts stay; no neighbours unless asked", () => {
    const state = multiSheetDroneFixtureState();
    const report = inspectSchematicState(state, { sheetId: "sheet-imu" });
    expect(report.components.map((item) => item.displayRef).sort()).toEqual(["C10", "C9", "R11", "R12", "U3"]);
    expect(report.counts.kicadComponents).toBe(41);
    expect(report.sheet).toMatchObject({ id: "sheet-imu", name: "IMU", path: "IMU", parentId: "root", childBlocks: [] });
    expect(report.sheet!.counts.kicadComponents).toBe(5);
    expect(report.sheet!.ports.map((port) => [port.name, port.bound, port.hierarchicalLabels >= 1, port.sheetPin])).toEqual([["I2C_SCL", true, true, true], ["I2C_SDA", true, true, true], ["IMU_INT1", true, true, true]]);
    expect(report.netLabels.every((label) => state.netLabels!.find((item) => item.id === label.id)!.sheetId === "sheet-imu")).toBe(true);
    expect(report.sheet!.localLabels).toEqual(expect.arrayContaining(["+3V3", "GND"]));
    expect(report.sheet).not.toHaveProperty("neighbours");
    expect(report.sheets!.tree).toHaveLength(4);
    expect(report.diagnostics).toEqual([]);
    expect(report.schematicDigest).toBe(inspectSchematicState(state).schematicDigest);
  });

  it("an unknown sheet is a diagnostic over the tree with no components; root on a single-sheet document is the page", () => {
    const unknown = inspectSchematicState(multiSheetDroneFixtureState(), { sheetId: "sheet-nope" });
    expect(unknown.valid).toBe(true);
    expect(unknown.components).toEqual([]);
    expect(unknown).not.toHaveProperty("sheet");
    expect(unknown.diagnostics[0]).toContain("sheet-nope does not exist");
    expect(unknown.diagnostics[0]).toContain("IMU (sheet-imu)");
    expect(unknown.sheets!.tree).toHaveLength(4);
    const root = inspectSchematicState(blinkerFixtureState(), { sheetId: "root" });
    expect(root.sheet).toMatchObject({ id: "root", name: "Overview", path: "", parentId: null, ports: [], childBlocks: [] });
    expect(root.components).toHaveLength(inspectSchematicState(blinkerFixtureState()).components.length);
    expect(root.sheets!.tree).toEqual([{ id: "root", name: "Overview", parentId: null, path: "", componentCount: 9, ports: [] }]);
  });
});

describe("[PR-J5] 3. neighbours through the connectivity authority", () => {
  it("over the fully organised drone the IMU's ports join the MCU sheet's ports; the overview reports its children's ports", () => {
    const parts = fixtureParts();
    const plan = planOrganizeIntoSheets(droneFixtureState(), FIXTURE_DRONE_ORGANIZE_GROUPS.map((group) => ({ name: group.name, refs: [...group.members] })), (partId) => parts.get(partId) ?? null);
    if (!plan.ok) throw new Error(plan.message);
    const imuId = organizeSheetId([...FIXTURE_DRONE_ORGANIZE_GROUPS[3]!.members]);
    const mcuId = organizeSheetId([...FIXTURE_DRONE_ORGANIZE_GROUPS[2]!.members]);
    const report = inspectSchematicState(plan.after, { sheetId: imuId, neighbours: true });
    expect(report.sheet!.ports.map((port) => port.name)).toEqual(["I2C_SCL", "I2C_SDA", "IMU_INT1"]);
    expect(report.sheet!.neighbours!.map((entry) => [entry.port, entry.joins.map((join) => `${join.sheetId}:${join.port}`)])).toEqual([
      ["I2C_SCL", [`${mcuId}:I2C_SCL`]],
      ["I2C_SDA", [`${mcuId}:I2C_SDA`]],
      ["IMU_INT1", [`${mcuId}:IMU_INT1`]],
    ]);
    expect(report.sheet!.neighbours!.every((entry) => entry.net !== null)).toBe(true);
    expect(report.components.map((item) => item.displayRef).sort()).toEqual(["R11", "R12", "U3"]);
    const overview = inspectSchematicState(plan.after, { sheetId: "root", neighbours: true });
    expect(overview.sheet!.neighbours).toEqual([]);
    expect(overview.diagnostics[0]).toContain("child sheet");
    expect(overview.sheet!.childBlocks.map((block) => block.name)).toEqual(FIXTURE_DRONE_ORGANIZE_GROUPS.map((group) => group.name));
    expect(overview.components).toEqual([]);
    const single = inspectSchematicState(blinkerFixtureState(), { sheetId: "root", neighbours: true });
    expect(single.sheet!.neighbours).toEqual([]);
    expect(single.diagnostics[0]).toContain("single-sheet");
  });
});
