/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4 (OD-258 item 3; the J1 review's open item "the label-tool GND case"): the first-sheet
 * refusal NAMES the offending labels, and "Normalise N rail-named labels" is a previewed, undoable transaction that makes the design
 * organisable without changing its PCB netlist.
 *
 *  1. the fixture drone with one GND label minted as a plain label (the editor's label tool): `singleSheetRuleChange` names it with its
 *     position (and the pin it sits on when there is one) beside the GND rail; the planner refuses the first move with that sentence;
 *  2. `planRailLabelNormalisation`: ONE sheet-structure batch (a delete + add pair at the label's own index) that re-kinds it to ground;
 *     the pin-to-net partition, the PCB netlist and its hash are unchanged (proven and asserted); afterwards the rule change is null and
 *     the IMU move is accepted; the inverse of the batch restores the golden digest; the executor's own guards accept the batch;
 *  3. a plain "AGND" alone: normalised with the net RENAMED on the board (AGND -> GND, the legacy rule's one name); a plain "VSS" beside a
 *     ground symbol: NORMALISE_REFUSED (the executor's rail-join guard: the legacy rule would then join two ground names); a design with
 *     no rail-named plain label: NORMALISE_NOTHING; a plain VCC beside a power VCC normalises and the partition is unchanged;
 *  4. the "connected differently" sentence names labels with their positions and pins too.
 * Pure / in-memory: no network, no database.
 */
import { describe, expect, it } from "vitest";
import { applySchematicOperationsToCanonical } from "@/app/lib/engineering/operations";
import { fromCanonicalSchematic, schematicStateDigest, toCanonicalSchematic } from "@/app/lib/engineering/schematic-model";
import { pinWorldPos } from "@/app/lib/geometry";
import { buildNetlist, netlistHash } from "@/app/lib/pcb/netlist-bridge";
import { ROOT_SHEET_ID, type NetLabel, type SchComponent, type SchematicState } from "@/lib/schematic-types";
import { resolveProjectConnectivity, singleSheetRuleChange } from "../project-connectivity";
import { createSheetOperation, planMoveToSheet, planRailLabelNormalisation, railNamedPlainLabels } from "../sheet-operations";
import { attachedSelection } from "../sheet-lens";
import { droneFixtureState, fixturePartLookup, theoryLegacyFixture } from "./_j1-fixtures";

const lookup = fixturePartLookup();
const DRONE_GOLDEN_DIGEST = "eng1-66f025a6dde8f8c3";
const resistorAt = (id: string, x: number, y: number): SchComponent => ({ id, type: "resistor", x, y, rotation: 0, value: "1k" });
const label = (id: string, name: string, at: { x: number; y: number }, extra: Partial<NetLabel> = {}): NetLabel => ({ id, position: at, name, kind: "label", orientation: 0, ...extra });

/** The drone with its first ground label minted the way the editor's label tool mints every label: kind "label". */
function labelToolDrone(): { state: SchematicState; plain: NetLabel } {
  const state = droneFixtureState();
  const plain = state.netLabels!.find((item) => item.kind === "ground")!;
  plain.kind = "label";
  return { state, plain };
}

describe("[PR-J4] 1. the first-sheet refusal names the offending labels", () => {
  it("a plain GND label beside the GND rail: the sentence names it with its position, as a plain label, beside the rail", () => {
    const { state, plain } = labelToolDrone();
    const change = singleSheetRuleChange(state, lookup);
    expect(change).not.toBeNull();
    expect(change).toContain("2 different nets are all named GND");
    expect(change).toContain(`The labels involved: "GND" at (${plain.position.x}, ${plain.position.y})`);
    expect(change).toContain("(plain label: give it the rail's kind or another name) beside the GND rail (27 ground labels)");
    const u3 = state.kicadComponents!.find((item) => item.refDes === "U3")!;
    const plan = planMoveToSheet(state, { entities: attachedSelection(state, { family: "kicad", id: u3.id }, lookup)!, target: { newSheet: { id: "sheet-imu", name: "IMU" } } }, lookup);
    expect(plan).toMatchObject({ ok: false, code: "SHEET_MOVE_NOT_EQUIVALENT" });
    expect((plan as { message: string }).message).toContain(`"GND" at (${plain.position.x}, ${plain.position.y})`);
  });

  it("a label on a pin is named with the pin (R2.1), in both sentences", () => {
    const r1 = resistorAt("R1", 100, 100);
    const r2 = resistorAt("R2", 300, 100);
    const g1: SchComponent = { id: "G1", type: "ground", x: 500, y: 120, rotation: 0, value: "" };
    const collision: SchematicState = { components: [r1, r2, g1], wires: [{ id: "w", vertices: [pinWorldPos(r2, "right"), pinWorldPos(g1, "pin")] }], netLabels: [label("plain", "GND", pinWorldPos(r1, "left"))] };
    const change = singleSheetRuleChange(collision);
    expect(change).toContain(`"GND" at (${pinWorldPos(r1, "left").x}, ${pinWorldPos(r1, "left").y}) on R1.1 (plain label: give it the rail's kind or another name) beside the GND rail (0 ground labels and a ground symbol)`);
    // the "connected differently" branch (the j1 case: a plain N, and a power N wired to a ground symbol - the strict rule names that net
    // GND, so no collision error, two nets instead of one)
    const g2: SchComponent = { id: "G2", type: "ground", x: 500, y: 320, rotation: 0, value: "" };
    const r3 = resistorAt("R3", 300, 300);
    const differently: SchematicState = { components: [r1, r3, g2], wires: [{ id: "w2", vertices: [pinWorldPos(r3, "right"), pinWorldPos(g2, "pin")] }], netLabels: [label("nl", "N", pinWorldPos(r1, "left")), label("np", "N", pinWorldPos(r3, "right"), { kind: "power" })] };
    expect(singleSheetRuleChange(differently)).toMatch(/connected differently \(labels "N" at \(-?\d+, -?\d+\) on R1\.1, "N" at \(-?\d+, -?\d+\) on R3\.2\)\. Rename or re-kind/);
  });
});

describe("[PR-J4] 2. the normalisation of the label-tool GND", () => {
  const { state, plain } = labelToolDrone();
  const frozen = JSON.stringify(state);
  const plan = planRailLabelNormalisation(state, lookup, "t");

  it("is one sheet-structure batch re-kinding the one plain label to ground at its own index; the base is not mutated", () => {
    expect(railNamedPlainLabels(state)).toEqual([{ id: plain.id, name: "GND", from: "label", to: "ground", sheetId: ROOT_SHEET_ID, position: plain.position }]);
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
    expect(plan.labels).toHaveLength(1);
    expect(plan.operations.map((operation) => operation.kind)).toEqual(["schematic_delete_net_label", "schematic_add_net_label"]);
    expect(plan.operations.map((operation) => operation.operationId)).toEqual([`t:0:del:${plain.id}`, `t:0:add:${plain.id}`]);
    const index = state.netLabels!.findIndex((item) => item.id === plain.id);
    expect(plan.operations[1]).toMatchObject({ kind: "schematic_add_net_label", atIndex: index, label: { id: plain.id, kind: "ground", name: "GND" } });
    expect(plan.after.netLabels!.map((item) => item.id)).toEqual(state.netLabels!.map((item) => item.id)); // document order kept
    expect(plan.after.netLabels![index]!.kind).toBe("ground");
    expect(JSON.stringify(state)).toBe(frozen);
  });

  it("keeps the pin-to-net partition, the PCB netlist and its hash; renames no net; the design then takes its first sheet", () => {
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.partitionDigest).toBe(resolveProjectConnectivity(state, lookup).partitionDigest);
    expect(plan.renamedNets).toEqual([]);
    const before = buildNetlist(state, lookup);
    const after = buildNetlist(plan.after, lookup);
    expect(netlistHash(after)).toBe(netlistHash(before));
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
    expect(plan.ruleChangeAfter).toBeNull();
    expect(singleSheetRuleChange(plan.after, lookup)).toBeNull();
    const u3 = plan.after.kicadComponents!.find((item) => item.refDes === "U3")!;
    expect(planMoveToSheet(plan.after, { entities: attachedSelection(plan.after, { family: "kicad", id: u3.id }, lookup)!, target: { newSheet: { id: "sheet-imu", name: "IMU" } } }, lookup).ok).toBe(true);
    expect(() => applySchematicOperationsToCanonical(toCanonicalSchematic(plan.after), [createSheetOperation(plan.after, { operationId: "c", sheet: { id: "aux", name: "Aux", parentId: ROOT_SHEET_ID } })])).not.toThrow();
  });

  it("the executor accepts the batch and its inverse restores the exact document (one undo step)", () => {
    if (!plan.ok) throw new Error(plan.message);
    const applied = applySchematicOperationsToCanonical(toCanonicalSchematic(state), plan.operations);
    expect(schematicStateDigest(fromCanonicalSchematic(applied.schematic))).toBe(schematicStateDigest(plan.after));
    const restored = fromCanonicalSchematic(applySchematicOperationsToCanonical(applied.schematic, applied.inverseOperations).schematic);
    expect(schematicStateDigest(restored)).toBe(schematicStateDigest(state));
    expect(schematicStateDigest(plan.after)).toBe(DRONE_GOLDEN_DIGEST); // the normalised drone IS the fixture drone (the label was minted ground there)
  });
});

describe("[PR-J4] 3. the other rail names", () => {
  it("a plain AGND alone is normalised and the board net is renamed AGND -> GND (the legacy rule's one ground name); connections unchanged", () => {
    const r1 = resistorAt("R1", 100, 100);
    const r2 = resistorAt("R2", 300, 100);
    const state: SchematicState = { components: [r1, r2], wires: [{ id: "w", vertices: [pinWorldPos(r1, "right"), pinWorldPos(r2, "left")] }], netLabels: [label("a", "AGND", pinWorldPos(r1, "right")), label("v", "VCC", pinWorldPos(r2, "right"), { kind: "power" })] };
    const plan = planRailLabelNormalisation(state);
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
    expect(plan.labels.map((entry) => [entry.name, entry.to])).toEqual([["AGND", "ground"]]);
    expect(plan.renamedNets.map((net) => [net.from, net.to])).toEqual([["AGND", "GND"]]);
    expect(plan.partitionDigest).toBe(resolveProjectConnectivity(state).partitionDigest);
    // [PR-J4 integration, 2026-10-23] review C-NORM-1 (OD-258 item 3 amended): the board connects the same pins, but the renamed net moves the PCB netlist's name and hash - previewed, never silent
    const partition = (nets: ReturnType<typeof buildNetlist>["nets"]): string[] => nets.map((net) => net.endpointKeys.join("|")).sort();
    expect(partition(buildNetlist(plan.after).nets)).toEqual(partition(buildNetlist(state).nets));
    expect(buildNetlist(plan.after).nets.map((net) => net.name).sort()).not.toEqual(buildNetlist(state).nets.map((net) => net.name).sort());
    expect(netlistHash(buildNetlist(plan.after))).not.toBe(netlistHash(buildNetlist(state)));
  });

  it("a plain VSS beside a ground symbol is refused: as a ground label the legacy rule would name it GND and JOIN it to the ground net (NORMALISE_NOT_EQUIVALENT naming the pins); nothing changes", () => {
    const r1 = resistorAt("R1", 100, 100);
    const r2 = resistorAt("R2", 300, 200);
    const g1: SchComponent = { id: "G1", type: "ground", x: 100, y: 180, rotation: 0, value: "" };
    const state: SchematicState = { components: [r1, r2, g1], wires: [{ id: "w", vertices: [pinWorldPos(r1, "right"), pinWorldPos(g1, "pin")] }], netLabels: [label("vss", "VSS", pinWorldPos(r2, "left"))] };
    const frozen = JSON.stringify(state);
    const plan = planRailLabelNormalisation(state);
    expect(plan).toMatchObject({ ok: false, code: "NORMALISE_NOT_EQUIVALENT", message: expect.stringContaining('Normalising "VSS" would change which pins are connected (R1::2, R2::1, G1::pin)') });
    expect((plan as { labels: unknown[] }).labels).toHaveLength(1);
    expect(JSON.stringify(state)).toBe(frozen);
  });

  it("a design whose rail-named labels already carry their kind: NORMALISE_NOTHING (the theory legacy fixture, the frozen drone)", () => {
    expect(planRailLabelNormalisation(theoryLegacyFixture())).toMatchObject({ ok: false, code: "NORMALISE_NOTHING", labels: [] });
    expect(planRailLabelNormalisation(droneFixtureState(), lookup)).toMatchObject({ ok: false, code: "NORMALISE_NOTHING" });
  });

  it("a plain VCC beside a power VCC (one net under the legacy rule, two under the strict one) normalises with the partition unchanged, and the first sheet is then accepted", () => {
    const r1 = resistorAt("R1", 100, 100);
    const r2 = resistorAt("R2", 300, 100);
    const state: SchematicState = { components: [r1, r2], wires: [], netLabels: [label("lp", "VCC", pinWorldPos(r1, "left"), { kind: "power" }), label("ll", "VCC", pinWorldPos(r2, "left"))] };
    expect(singleSheetRuleChange(state)).toContain('"VCC" at');
    const plan = planRailLabelNormalisation(state);
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
    expect(plan.labels.map((entry) => entry.id)).toEqual(["ll"]);
    expect(plan.partitionDigest).toBe(resolveProjectConnectivity(state).partitionDigest);
    expect(resolveProjectConnectivity(plan.after).netOfPin("R1::1")!.members).toEqual(["R1::1", "R2::1"]);
    expect(plan.ruleChangeAfter).toBeNull();
  });
});
