/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4 (J.3 item 4 "Organize into sheets"; J.6 acceptance; OD-258 item 4): the pure organise
 * planner (app/lib/schematic/sheet-organization.ts) on the flat fixture drone and the fixtures.
 *
 *  1. the proposal WITHOUT hints is deterministic: four groups around the hubs (the four identical motor channels merged, the LDO, the
 *     MCU with its headers folded in, the IMU with its pull-ups), every part placed, the tie-breaks LISTED under "check these" with the
 *     rule that decided; the same input twice is identical;
 *  2. WITH the generation plan's blocks as hints the proposal is the committed j3 fixture's grouping (Power / Motor drivers / IMU) plus the
 *     MCU block as its own sheet; the names are the blocks';
 *  3. the plan: a chain of planMoveToSheet steps as ONE batch - the exact ports (PWM1-4; I2C_SCL / I2C_SDA / IMU_INT1; the MCU's seven),
 *     sheet ids as content digests, the partition digest equal to the flat drone's AND to the committed multi-sheet fixture's, every
 *     component identity untouched, 41 published components; two plans of one input are identical, operation ids included;
 *  4. the executor runs the chain as ONE schematic.move-to-sheet transaction (one durable transaction, one undo step) and the inverse
 *     operations restore the flat drone's golden digest;
 *  5. refusals: one hub (the LED dimmer) -> ORGANIZE_NOTHING_TO_SPLIT; an unresolved part -> ORGANIZE_CONNECTIVITY_INVALID naming it; a
 *     part in two groups / a missing part / a sibling's name -> ORGANIZE_GROUPS_INVALID; the label-tool GND case -> the first step's
 *     SHEET_MOVE_NOT_EQUIVALENT names the group and nothing is changed.
 * Pure / in-memory: no network, no database, no randomness (crypto.randomUUID is never called).
 */
import { describe, expect, it, vi } from "vitest";
import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { buildPcbSyncPublicationGraph } from "@/app/lib/pcb/netlist-bridge";
import type { SchematicState } from "@/lib/schematic-types";
import { resolveProjectConnectivity } from "../project-connectivity";
import { compareRefDes, organizeGroupInputs, organizePlanPorts, organizeSheetId, planOrganizeIntoSheets, proposeSheetGroups, validateOrganizeGroups, type OrganizeGroupInput } from "../sheet-organization";
import { sheetOf } from "../sheets";
import { droneFixtureState, fixturePartLookup, fixtureParts } from "./_j1-fixtures";
import { dimmerFixtureState } from "./_j2-fixtures";
import { multiSheetDroneFixtureState } from "./_j3-fixtures";
import { J4_DRONE_HINTED_PROPOSAL, J4_DRONE_HINTS, J4_DRONE_PROPOSAL } from "./_j4-organize-fixtures";

const parts = fixtureParts();
const getPart = (partId: string) => parts.get(partId) ?? null;
const lookup = fixturePartLookup();
const DRONE_GOLDEN_DIGEST = "eng1-66f025a6dde8f8c3"; // j1-sheet-operations GOLDEN.drone.stateDigest
const identity = (state: SchematicState) => state.kicadComponents!.map(({ x: _x, y: _y, rotation: _r, sheetId: _s, ...rest }) => { void _x; void _y; void _r; void _s; return rest; });

describe("[PR-J4] 1. the proposal without hints", () => {
  const drone = droneFixtureState();
  const proposal = proposeSheetGroups(drone, getPart);

  it("groups the flat drone around its hubs deterministically: the four identical motor channels, the LDO, the MCU, the IMU; every part placed", () => {
    if (!proposal.ok) throw new Error(`${proposal.code}: ${proposal.message}`);
    expect(proposal.sourceSheetId).toBe("root");
    expect(proposal.groups.map((group) => ({ name: group.name, hubs: group.hubs, refs: group.refs }))).toEqual(J4_DRONE_PROPOSAL.map((group) => ({ name: group.name, hubs: [...group.hubs], refs: [...group.refs] })));
    expect(proposal.residue).toEqual([]);
    expect(proposal.groups.flatMap((group) => group.refs).sort(compareRefDes)).toEqual(drone.kicadComponents!.map((item) => item.refDes).sort(compareRefDes));
    for (const group of proposal.groups) expect(group.reason.length).toBeGreaterThan(10);
  });

  it("lists every tie-break under 'check these' with the rule that decided (the peripheral's specificity, the plan's block, the smaller reference)", () => {
    if (!proposal.ok) throw new Error(proposal.message);
    const byRefs = new Map(proposal.checkThese.map((check) => [check.refs.join(","), check] as const));
    expect([...byRefs.keys()].sort()).toEqual(["C1", "C10", "C2", "C3", "C4", "C5", "C6", "C8", "C9", "D1,Q1,R1,R2", "D2,Q2,R3,R4", "D3,Q3,R5,R6", "D4,Q4,R7,R8", "J1", "R11", "R12", "R9"]);
    expect(byRefs.get("D1,Q1,R1,R2")).toMatchObject({ group: "J2", alternatives: ["U2"] });
    expect(byRefs.get("D1,Q1,R1,R2")!.reason).toContain("fewer signals");
    expect(byRefs.get("R11")).toMatchObject({ group: "U3", alternatives: ["U2"] });
    expect(byRefs.get("C4")!.reason).toContain("rails only (+3V3, GND)");
    expect(byRefs.get("C4")!.reason).toContain("smaller reference designator");
    expect(byRefs.get("J1")!.reason).toContain("a connector with nothing attached");
  });

  it("the same input twice is identical, and no crypto.randomUUID is drawn", () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID");
    expect(proposeSheetGroups(droneFixtureState(), getPart)).toEqual(proposal);
    expect(randomUUID).not.toHaveBeenCalled();
    randomUUID.mockRestore();
  });
});

describe("[PR-J4] 2. the proposal with the generation plan's blocks as hints", () => {
  it("is the committed j3 fixture's grouping (Power / Motor drivers / IMU) plus the MCU block as its own sheet, named by the blocks", () => {
    const proposal = proposeSheetGroups(droneFixtureState(), getPart, { hints: J4_DRONE_HINTS });
    if (!proposal.ok) throw new Error(`${proposal.code}: ${proposal.message}`);
    expect(proposal.groups.map((group) => ({ name: group.name, hubs: group.hubs, refs: group.refs }))).toEqual(J4_DRONE_HINTED_PROPOSAL.map((group) => ({ name: group.name, hubs: [...group.hubs], refs: [...group.refs] })));
    expect(proposal.checkThese.every((check) => check.reason.includes("the plan's block names"))).toBe(true);
    // the j3 fixture's sheets hold exactly these parts
    const fixture = multiSheetDroneFixtureState();
    for (const sheet of fixture.sheets!.sheets.filter((item) => item.parentId !== null)) {
      const refs = fixture.kicadComponents!.filter((item) => sheetOf(item) === sheet.id).map((item) => item.refDes).sort(compareRefDes);
      expect(proposal.groups.find((group) => group.name === sheet.name)!.refs).toEqual(refs);
    }
  });
});

describe("[PR-J4] 3. the plan: one batch of proven moves with the exact interfaces", () => {
  const drone = droneFixtureState();
  const proposal = proposeSheetGroups(drone, getPart);
  if (!proposal.ok) throw new Error(proposal.message);
  const groups = organizeGroupInputs(proposal);
  const plan = planOrganizeIntoSheets(drone, groups, getPart);

  it("creates one child sheet per group (ids as content digests) with the exact ports; the partition equals the flat drone's and the committed fixture's", () => {
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
    expect(organizePlanPorts(plan)).toEqual(J4_DRONE_PROPOSAL.map((group) => ({ sheetId: organizeSheetId([...group.refs]), sheetName: group.name, ports: [...group.ports] })));
    expect(plan.after.sheets!.sheets.map((sheet) => sheet.id)).toEqual(["root", ...J4_DRONE_PROPOSAL.map((group) => organizeSheetId([...group.refs]))]);
    expect(plan.after.sheets!.sheets[0]).toEqual({ id: "root", name: "Overview", parentId: null });
    for (const sheet of plan.after.sheets!.sheets.slice(1)) expect(sheet.block).toBeDefined();
    const before = resolveProjectConnectivity(drone, lookup);
    expect(plan.preview.partitionDigest).toBe(before.partitionDigest);
    expect(plan.preview.partitionDigest).toBe(resolveProjectConnectivity(multiSheetDroneFixtureState(), lookup).partitionDigest);
    expect(plan.preview.componentCount).toBe(41);
    expect(plan.preview.steps.map((step) => step.moved.components)).toEqual([23, 8, 7, 3]);
  });

  it("every component identity is untouched; the overview holds no catalog part; 41 components publish", () => {
    if (!plan.ok) throw new Error(plan.message);
    expect(identity(plan.after)).toEqual(identity(drone));
    expect(plan.after.kicadComponents!.filter((item) => sheetOf(item) === "root")).toEqual([]);
    expect(buildPcbSyncPublicationGraph(plan.after, lookup).components).toHaveLength(41);
    expect(buildPcbSyncPublicationGraph(drone, lookup).components).toHaveLength(41);
    expect(schematicStateDigest(drone)).toBe(DRONE_GOLDEN_DIGEST); // the input is not mutated
  });

  it("two plans of one input are identical, operation ids included; the sheet names stay sibling-unique", () => {
    const again = planOrganizeIntoSheets(droneFixtureState(), groups, getPart);
    if (!plan.ok || !again.ok) throw new Error("unreachable");
    expect(JSON.stringify(again.operations)).toBe(JSON.stringify(plan.operations));
    expect(schematicStateDigest(again.after)).toBe(schematicStateDigest(plan.after));
    expect(new Set(plan.after.sheets!.sheets.map((sheet) => sheet.name.toLowerCase())).size).toBe(plan.after.sheets!.sheets.length);
  });

  it("4. the executor runs the chain as ONE schematic.move-to-sheet transaction; the inverse operations restore the golden flat drone", async () => {
    if (!plan.ok) throw new Error(plan.message);
    const store = new InMemoryAtomicProjectStore();
    const editor = new SchematicEditorSession({ tenantId: "tenant-j4", projectId: "project-j4", branchId: "main" }, { store });
    await editor.openForProject(drone, null);
    const executed = await editor.execute(drone, { commandId: "schematic.move-to-sheet", label: "Organized 41 parts into 4 sheets", buildOperations: () => plan.operations });
    expect(executed).toMatchObject({ ok: true, status: "executed" });
    if (!executed.ok) throw new Error("unreachable");
    expect(schematicStateDigest(executed.state)).toBe(schematicStateDigest(plan.after));
    expect((await store.load("project-j4", "main"))?.transactionLog).toHaveLength(1);
    const restored = fromCanonicalSchematic(applySchematicOperationsToCanonical(toCanonicalSchematic(plan.after), plan.inverseOperations).schematic);
    expect(schematicStateDigest(restored)).toBe(DRONE_GOLDEN_DIGEST);
    expect(restored.sheets).toBeUndefined();
  });
});

describe("[PR-J4] 5. refusals change nothing", () => {
  it("one hub (the LED dimmer): ORGANIZE_NOTHING_TO_SPLIT", () => {
    const dimmer = dimmerFixtureState();
    expect(proposeSheetGroups(dimmer, getPart)).toMatchObject({ ok: false, code: "ORGANIZE_NOTHING_TO_SPLIT", message: expect.stringContaining("one subsystem around U1") });
  });

  it("an unresolved part: ORGANIZE_CONNECTIVITY_INVALID naming it, in the proposal and in the plan", () => {
    const drone = droneFixtureState();
    const u3 = drone.kicadComponents!.find((item) => item.refDes === "U3")!;
    const missing = (partId: string) => (partId === u3.partId ? null : getPart(partId));
    expect(proposeSheetGroups(drone, missing)).toMatchObject({ ok: false, code: "ORGANIZE_CONNECTIVITY_INVALID", refs: ["U3"], message: expect.stringContaining("U3") });
    const plan = planOrganizeIntoSheets(drone, [{ name: "A", refs: ["U3", "R11"] }, { name: "B", refs: ["U1", "C1"] }], missing);
    expect(plan).toMatchObject({ ok: false, code: "SHEET_MOVE_CONNECTIVITY_INVALID", step: { name: "A", refs: ["U3", "R11"] } });
  });

  it("invalid groups: a part in two groups, a part not on the sheet, an empty group, a sibling's name, a slash", () => {
    const drone = droneFixtureState();
    expect(validateOrganizeGroups(drone, [{ name: "A", refs: ["U1"] }, { name: "B", refs: ["U1"] }], "root")).toContain("U1 is in two groups");
    expect(validateOrganizeGroups(drone, [{ name: "A", refs: ["U9"] }], "root")).toContain("U9");
    expect(validateOrganizeGroups(drone, [{ name: "A", refs: [] }], "root")).toContain("holds no part");
    expect(validateOrganizeGroups(drone, [{ name: "A/B", refs: ["U1"] }], "root")).toContain('"/"');
    expect(validateOrganizeGroups(drone, [{ name: "A", refs: ["U1"] }, { name: "a", refs: ["U2"] }], "root")).toContain("both named");
    const fixture = multiSheetDroneFixtureState();
    expect(validateOrganizeGroups(fixture, [{ name: "IMU", refs: ["U2"] }], "root")).toContain('"IMU" already exists');
    expect(planOrganizeIntoSheets(drone, [{ name: "A", refs: ["U1"] }, { name: "B", refs: ["U1"] }], getPart)).toMatchObject({ ok: false, code: "ORGANIZE_GROUPS_INVALID" });
  });

  it("the label-tool GND case: the first step is refused by the connection-rule change, the group is named, nothing is changed", () => {
    const drone = droneFixtureState();
    const ground = drone.netLabels!.find((label) => label.kind === "ground")!;
    ground.kind = "label"; // the editor's label tool mints kind "label" whatever the name
    const frozen = JSON.stringify(drone);
    const proposal = proposeSheetGroups(drone, getPart);
    if (!proposal.ok) throw new Error(proposal.message);
    const plan = planOrganizeIntoSheets(drone, organizeGroupInputs(proposal), getPart);
    expect(plan).toMatchObject({ ok: false, code: "SHEET_MOVE_NOT_EQUIVALENT", step: { name: J4_DRONE_PROPOSAL[0].name } });
    expect((plan as { message: string }).message).toContain(`"GND" at (${ground.position.x}, ${ground.position.y})`);
    expect((plan as { message: string }).message).toMatch(/Nothing was changed\.$/);
    expect(JSON.stringify(drone)).toBe(frozen);
  });

  it("the sheet id of a group is a content digest of its sorted references (order-free, stable)", () => {
    expect(organizeSheetId(["U3", "R11", "R12"])).toBe(organizeSheetId(["R12", "U3", "R11"]));
    expect(organizeSheetId(["U3", "R11", "R12"])).toBe("sheet-org-b9bcf3f31b0a");
    expect(organizeSheetId(["U3", "R11"])).not.toBe(organizeSheetId(["U3", "R12"]));
    const groups: OrganizeGroupInput[] = [{ name: "x", refs: ["R12", "U3", "R11"] }];
    expect(groups[0]!.refs.length).toBe(3);
  });
});
