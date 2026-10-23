/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4 (J.3 item 5 "a tidy operation affects the selected sheet by default"; OD-258 item 5):
 * the pure per-sheet tidy (app/lib/schematic/sheet-tidy.ts) on the frozen multi-sheet drone.
 *
 *  1. the refusals: no sheet named, an unknown sheet, a sheet with child blocks (the overview), a part whose catalog record is missing -
 *     [PR-J4 integration, 2026-10-23] review C-TIDY-1: ANY project part's, not only the sheet's (the proof needs every pin: with only the
 *     sheet's parts loaded a lost cross-sheet link is invisible to the partition digest); review C-TIDY-4: a sheet holding a Theory symbol
 *     (SHEETS_TIDY_THEORY_PENDING naming it) - each before any layout;
 *  2. the sheet's logical netlist holds exactly its parts, its port nets as labels named by the PORT, its rails by exact name and kind, and
 *     no sheet-path name;
 *  3. tidying the IMU sheet: every one of the 41 instances keeps its id and authority fields (only the IMU's x / y / rotation move); the
 *     other sheets' components, wires and labels are byte-identical; the IMU port anchors keep id, scope and port; the project connectivity's
 *     partition digest, the PCB netlist and its hash are unchanged; the result is a valid document; the base is not mutated (the page's undo
 *     is the previous state);
 *  4. a re-layout that would detach a port anchor (the port's labels renamed) or lose a part is refused SHEETS_TIDY_NOT_EQUIVALENT with
 *     nothing changed; [PR-J4 integration, 2026-10-23] review C-TIDY-1: so is the realistic case - the overview's local label on a port's
 *     net renamed by the user, after which the IMU's laid-out labels no longer match the port and its anchor would be dropped - and a
 *     post-layout refusal never claims that nothing was sent (review C-TIDY-2);
 *  5. the same input twice gives the same placements (the layout is deterministic; only wire / label ids are minted).
 * Pure / in-memory: no network, no database, no model.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateSchematicStateIntegrity } from "@/app/lib/engineering/schematic-model";
import { buildNetlist, netlistHash } from "@/app/lib/pcb/netlist-bridge";
import { autoLayoutBuildValidated } from "@/lib/build-auto-layout";
import { resolveProjectConnectivity } from "../project-connectivity";
import { ROOT_SHEET_ID, type KicadComponentInstance, type SchematicState } from "@/lib/schematic-types";
import { J4_RESISTOR_PART_ID, resistorPin } from "../../__tests__/_j4-fixtures";
import { mergeTidiedSheet, sheetLogicalNetlist, sheetTidyContext, tidySheet, tidySheetRefusal } from "../sheet-tidy";
import { sheetOf } from "../sheets";
import { fixturePartLookup, fixtureParts } from "./_j1-fixtures";
import { J3_SHEETS, multiSheetDroneFixtureState } from "./_j3-fixtures";

const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const parts = fixtureParts();
const lookup = fixturePartLookup();
const IMU = "sheet-imu";
const IMU_REFS = [...J3_SHEETS[2].refs].sort();
const identity = (state: ReturnType<typeof multiSheetDroneFixtureState>) => state.kicadComponents!.map(({ x: _x, y: _y, rotation: _r, ...rest }) => { void _x; void _y; void _r; return rest; });
const offSheet = (state: ReturnType<typeof multiSheetDroneFixtureState>, sheetId: string) => ({
  components: state.components.filter((item) => item.sheetId !== sheetId),
  kicadComponents: state.kicadComponents!.filter((item) => item.sheetId !== sheetId),
  wires: state.wires.filter((item) => item.sheetId !== sheetId),
  netLabels: state.netLabels!.filter((item) => item.sheetId !== sheetId),
  sheets: state.sheets,
});

describe("[PR-J4] 1. the per-sheet tidy refuses what it cannot re-lay out, before anything is sent", () => {
  const fixture = multiSheetDroneFixtureState();
  it("a document without sheets needs no sheet; a sheeted one refuses no sheet, an unknown sheet and a sheet with child blocks", () => {
    expect(tidySheetRefusal({ ...fixture, sheets: undefined }, undefined)).toBeNull();
    expect(tidySheetRefusal(fixture, undefined)).toMatchObject({ ok: false, code: "SHEETS_TIDY_SHEET_REQUIRED" });
    expect(tidySheetRefusal(fixture, "")).toMatchObject({ ok: false, code: "SHEETS_TIDY_SHEET_REQUIRED" });
    expect(tidySheetRefusal(fixture, "sheet-nope")).toMatchObject({ ok: false, code: "SHEETS_TIDY_SHEET_UNKNOWN" });
    const overview = tidySheetRefusal(fixture, "root");
    expect(overview).toMatchObject({ ok: false, code: "SHEETS_TIDY_BLOCKS_PENDING" });
    expect(overview!.message).toContain("Power, Motor drivers, IMU");
    expect(overview!.message).toMatch(/Nothing was sent and nothing changed\.$/);
    expect(tidySheetRefusal(fixture, IMU)).toBeNull();
  });

  it("a part whose catalog record is not loaded refuses SHEETS_TIDY_PARTS_UNRESOLVED naming it", () => {
    const u3 = fixture.kicadComponents!.find((item) => item.refDes === "U3")!;
    const missing = new Map([...parts.entries()].filter(([id]) => id !== u3.partId));
    expect(tidySheet(fixture, IMU, missing)).toMatchObject({ ok: false, code: "SHEETS_TIDY_PARTS_UNRESOLVED", message: expect.stringContaining("U3") });
  });

  it("[PR-J4 integration, 2026-10-23] C-TIDY-1: a part OFF the tidied sheet whose record is not loaded refuses too - the proof needs every project pin (only the IMU's parts loaded, as the route once read them)", () => {
    const imuPartIds = new Set(fixture.kicadComponents!.filter((item) => item.sheetId === IMU).map((item) => item.partId));
    const imuOnly = new Map([...parts.entries()].filter(([id]) => imuPartIds.has(id)));
    expect(imuOnly.size).toBeLessThan(parts.size);
    const refused = tidySheet(fixture, IMU, imuOnly);
    expect(refused).toMatchObject({ ok: false, code: "SHEETS_TIDY_PARTS_UNRESOLVED" });
    expect((refused as { message: string }).message).toContain("U2"); // the MCU on the overview, the far side of the IMU's ports
    expect((refused as { message: string }).message).toMatch(/Nothing was sent and nothing changed\.$/);
    // the merge proves nothing without every pin: handed a laid-out page and the partial lookup, it refuses the same way
    const { state: laidOut, validation } = autoLayoutBuildValidated(sheetLogicalNetlist(fixture, IMU, parts), parts, 3, {});
    expect(mergeTidiedSheet(fixture, IMU, laidOut, (partId) => imuOnly.get(partId) ?? null, validation)).toMatchObject({ ok: false, code: "SHEETS_TIDY_PARTS_UNRESOLVED" });
    expect(mergeTidiedSheet(fixture, IMU, laidOut, lookup, validation).ok).toBe(true);
  });

  it("[PR-J4 integration, 2026-10-23] C-TIDY-4: a sheet holding a Theory symbol refuses SHEETS_TIDY_THEORY_PENDING naming it, before any layout", () => {
    const withGround = { ...fixture, components: [...fixture.components, { id: "j4-g-imu", type: "ground" as const, x: 1000, y: 1000, rotation: 0 as const, value: "", sheetId: IMU }] };
    const refusal = tidySheetRefusal(withGround, IMU);
    expect(refusal).toMatchObject({ ok: false, code: "SHEETS_TIDY_THEORY_PENDING" });
    expect(refusal!.message).toContain("holds 1 Theory symbol (ground)"); // named by reference designator when it has one, else by type
    expect(refusal!.message).toMatch(/Nothing was sent and nothing changed\.$/);
    expect(tidySheet(withGround, IMU, parts)).toMatchObject({ ok: false, code: "SHEETS_TIDY_THEORY_PENDING" });
    expect(tidySheetRefusal(withGround, "sheet-power")).toBeNull(); // the symbol is on the IMU only
  });
});

describe("[PR-J4 integration, 2026-10-23] 1b. the sheet's context for the critic (review C-TIDY-3)", () => {
  it("holds the sheet's four entity arrays with the project's sheet tree and page size, and no sheetId key", () => {
    const fixture = multiSheetDroneFixtureState();
    const context = sheetTidyContext(fixture, IMU);
    expect(context.kicadComponents!.map((item) => item.refDes).sort()).toEqual(IMU_REFS);
    expect(context.components).toEqual(fixture.components.filter((item) => sheetOf(item) === IMU));
    expect(context.wires).toEqual(fixture.wires.filter((item) => sheetOf(item) === IMU));
    expect(context.netLabels).toEqual(fixture.netLabels!.filter((item) => sheetOf(item) === IMU));
    expect(context.sheets).toEqual(fixture.sheets);
    expect(context.pageSize).toBe(fixture.pageSize);
    expect("sheetId" in context).toBe(false);
    expect(JSON.stringify(context).length).toBeLessThan(JSON.stringify(fixture).length / 3);
  });
});

describe("[PR-J4] 2. the sheet's logical netlist", () => {
  it("holds exactly the IMU's parts, its ports as labels named by the port, its rails by exact name and kind, and no sheet-path name", () => {
    const fixture = multiSheetDroneFixtureState();
    const netlist = sheetLogicalNetlist(fixture, IMU, parts);
    expect(netlist.components.map((item) => item.refDes).sort()).toEqual(IMU_REFS);
    const labels = netlist.connections.filter((item) => item.kind === "label");
    expect(labels.length).toBe(netlist.connections.length); // every IMU connection is a labelled net (the generated page draws labels)
    const names = new Map<string, Set<string>>();
    for (const item of labels) names.set(item.labelName, new Set([...(names.get(item.labelName) ?? []), item.labelKind ?? "?"]));
    expect([...names.keys()].sort()).toEqual(["+3V3", "GND", "I2C_SCL", "I2C_SDA", "IMU_INT1"]);
    expect([...names.get("GND")!]).toEqual(["ground"]);
    expect([...names.get("+3V3")!]).toEqual(["power"]);
    for (const port of J3_SHEETS[2].ports) expect([...names.get(port)!]).toEqual(["label"]);
    expect([...names.keys()].some((name) => name.includes("/"))).toBe(false);
    for (const item of labels) expect(IMU_REFS).toContain(item.pin.split(".")[0]);
  });
});

describe("[PR-J4] 3. tidying the IMU sheet merges only that sheet", () => {
  const fixture = multiSheetDroneFixtureState();
  const frozen = JSON.stringify(fixture);
  const tidied = tidySheet(fixture, IMU, parts, { spread: { U3: 44 } });

  it("succeeds; the base is not mutated", () => {
    expect(tidied.ok, (tidied as { message?: string }).message).toBe(true);
    expect(JSON.stringify(fixture)).toBe(frozen);
  });

  it("all 41 instances keep their ids and authority fields; only the IMU's placements change", () => {
    if (!tidied.ok) throw new Error(tidied.message);
    expect(tidied.state.kicadComponents).toHaveLength(41);
    expect(identity(tidied.state)).toEqual(identity(fixture));
    expect(tidied.state.kicadComponents!.map((item) => item.id)).toEqual(fixture.kicadComponents!.map((item) => item.id)); // document order kept
    for (const item of tidied.state.kicadComponents!) {
      const before = fixture.kicadComponents!.find((candidate) => candidate.id === item.id)!;
      if (item.sheetId !== IMU) expect(item).toEqual(before);
    }
    expect(tidied.instances.map((item) => item.refDes).sort()).toEqual(IMU_REFS);
    expect(tidied.instances.some((item) => { const before = fixture.kicadComponents!.find((candidate) => candidate.id === item.id)!; return before.x !== item.x || before.y !== item.y; })).toBe(true);
  });

  it("every other sheet's components, wires and labels are byte-identical; the sheet tree is unchanged", () => {
    if (!tidied.ok) throw new Error(tidied.message);
    expect(sha(offSheet(tidied.state, IMU))).toBe(sha(offSheet(fixture, IMU)));
    expect(tidied.state.sheets).toEqual(fixture.sheets);
  });

  it("the IMU port anchors keep id, scope and port and take laid-out positions; the sheet pins on the overview are untouched", () => {
    if (!tidied.ok) throw new Error(tidied.message);
    const anchorsBefore = fixture.netLabels!.filter((label) => label.sheetId === IMU && label.scope === "hierarchical");
    const anchorsAfter = tidied.state.netLabels!.filter((label) => label.sheetId === IMU && label.scope === "hierarchical");
    expect(anchorsBefore.length).toBe(3);
    for (const before of anchorsBefore) {
      const after = anchorsAfter.find((label) => label.id === before.id);
      expect(after, before.id).toBeDefined();
      expect([after!.scope, after!.portId, after!.name, after!.kind]).toEqual([before.scope, before.portId, before.name, before.kind]);
    }
    // every anchor's port is one of the IMU's ports; a port may gain further anchors (the layout labels every pin of its net)
    const ports = new Set(fixture.sheets!.sheets.find((sheet) => sheet.id === IMU)!.ports!.map((port) => port.id));
    for (const label of anchorsAfter) expect(ports.has(label.portId!)).toBe(true);
    expect(tidied.state.netLabels!.filter((label) => label.scope === "sheet-pin")).toEqual(fixture.netLabels!.filter((label) => label.scope === "sheet-pin"));
  });

  it("the project connectivity's partition, the PCB netlist and its hash are unchanged; the document is valid; the layout validation is clean", () => {
    if (!tidied.ok) throw new Error(tidied.message);
    const before = resolveProjectConnectivity(fixture, lookup);
    const after = resolveProjectConnectivity(tidied.state, lookup);
    expect(after.ok).toBe(true);
    expect(after.partitionDigest).toBe(before.partitionDigest);
    expect(after.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
    expect(netlistHash(buildNetlist(tidied.state, lookup))).toBe(netlistHash(buildNetlist(fixture, lookup)));
    expect(validateSchematicStateIntegrity(tidied.state)).toEqual([]);
    expect(tidied.validation).toEqual({ ok: true, violations: [] });
  });

  it("5. the same input twice gives the same placements", () => {
    const again = tidySheet(multiSheetDroneFixtureState(), IMU, parts, { spread: { U3: 44 } });
    if (!tidied.ok || !again.ok) throw new Error("unreachable");
    expect(again.instances.map((item) => [item.refDes, item.x, item.y, item.rotation])).toEqual(tidied.instances.map((item) => [item.refDes, item.x, item.y, item.rotation]));
  });
});

describe("[PR-J4] 4. a re-layout that would change a connection is refused with nothing changed", () => {
  const fixture = multiSheetDroneFixtureState();
  const laidOut = () => autoLayoutBuildValidated(sheetLogicalNetlist(fixture, IMU, parts), parts, 3, {});

  it("the port's labels renamed (its anchors would be lost; the pins would join a local net): SHEETS_TIDY_NOT_EQUIVALENT", () => {
    const { state, validation } = laidOut();
    const tampered = { ...state, netLabels: state.netLabels!.map((label) => (label.name === "I2C_SCL" ? { ...label, name: "I2C_SCLX" } : label)) };
    const frozen = JSON.stringify(fixture);
    const result = mergeTidiedSheet(fixture, IMU, tampered, lookup, validation);
    expect(result).toMatchObject({ ok: false, code: "SHEETS_TIDY_NOT_EQUIVALENT" });
    expect((result as { message: string }).message).toContain("would change which pins are connected");
    expect(JSON.stringify(fixture)).toBe(frozen);
  });

  it("a part missing from the re-layout: SHEETS_TIDY_NOT_EQUIVALENT naming it", () => {
    const { state, validation } = laidOut();
    const tampered = { ...state, kicadComponents: state.kicadComponents!.filter((item) => item.refDes !== "R11") };
    expect(mergeTidiedSheet(fixture, IMU, tampered, lookup, validation)).toMatchObject({ ok: false, code: "SHEETS_TIDY_NOT_EQUIVALENT", message: expect.stringContaining("R11 missing") });
  });

  it("[PR-J4 integration, 2026-10-23] C-TIDY-1: the overview's local label on the I2C_SCL port net renamed SCL by the user - the IMU's laid-out labels no longer name the port, its anchor would be dropped and U2.28 left alone: refused with every part loaded, nothing changed", () => {
    const state = multiSheetDroneFixtureState();
    const rootLabel = state.netLabels!.find((label) => sheetOf(label) === "root" && label.scope === undefined && label.name === "I2C_SCL");
    expect(rootLabel).toBeDefined();
    rootLabel!.name = "SCL";
    expect(resolveProjectConnectivity(state, lookup).ok).toBe(true); // a legal edit: the net is simply named SCL now
    const frozen = JSON.stringify(state);
    const result = tidySheet(state, IMU, parts, {});
    expect(result).toMatchObject({ ok: false, code: "SHEETS_TIDY_NOT_EQUIVALENT" });
    expect((result as { message: string }).message).toMatch(/would change which pins are connected|without a hierarchical label/);
    expect((result as { message: string }).message).not.toContain("Nothing was sent"); // a post-layout refusal never claims that (review C-TIDY-2)
    expect(JSON.stringify(state)).toBe(frozen);
  });

  it("[PR-J4 integration, 2026-10-23] C-TIDY-1: a laid-out page that drops a port's anchor is refused even when the digest cannot see it (the port's net has no pin beyond the sheet)", () => {
    // one resistor on a leaf sheet, its pin 1 the port IN whose sheet pin on the overview connects nothing: dropping the anchor leaves R1.1
    // alone before and after (the digest is blind), yet the sheet would lose its interface
    const r1: KicadComponentInstance = { id: "u-r1", partId: J4_RESISTOR_PART_ID, x: 200, y: 200, rotation: 0, refDes: "R1", value: "1k", sheetId: "leaf" };
    const unbound: SchematicState = {
      components: [], kicadComponents: [r1], wires: [], pageSize: "A4",
      netLabels: [
        { id: "u-pin", position: { x: 300, y: 50 }, name: "IN", kind: "label", orientation: 0, scope: "sheet-pin", portId: "u-port", childSheetId: "leaf" },
        { id: "u-lbl", position: resistorPin(r1, "1"), name: "IN", kind: "label", orientation: 0, sheetId: "leaf", scope: "hierarchical", portId: "u-port" },
        { id: "u-gnd", position: resistorPin(r1, "2"), name: "GND", kind: "ground", orientation: 0, sheetId: "leaf" },
      ],
      sheets: { version: 1, sheets: [{ id: ROOT_SHEET_ID, name: "Overview", parentId: null }, { id: "leaf", name: "Leaf", parentId: ROOT_SHEET_ID, block: { x: 400, y: 100, width: 300, height: 200 }, ports: [{ id: "u-port", name: "IN", direction: "input" }] }] },
    };
    expect(validateSchematicStateIntegrity(unbound)).toEqual([]);
    expect(tidySheet(unbound, "leaf", parts).ok).toBe(true); // the honest layout keeps the anchor
    const { state, validation } = autoLayoutBuildValidated(sheetLogicalNetlist(unbound, "leaf", parts), parts, 3, {});
    const tampered = { ...state, netLabels: state.netLabels!.map((label) => (label.name === "IN" ? { ...label, name: "INX" } : label)) };
    const merged = { ...unbound, netLabels: unbound.netLabels!.filter((label) => label.sheetId !== "leaf") }; // what the merge would publish for the leaf: no hierarchical label
    expect(resolveProjectConnectivity(merged, lookup).partitionDigest).toBe(resolveProjectConnectivity({ ...unbound, netLabels: unbound.netLabels!.filter((label) => label.id !== "u-lbl") }, lookup).partitionDigest); // the digest alone cannot tell
    const result = mergeTidiedSheet(unbound, "leaf", tampered, lookup, validation);
    expect(result).toMatchObject({ ok: false, code: "SHEETS_TIDY_NOT_EQUIVALENT" });
    expect((result as { message: string }).message).toContain("would leave port IN without a hierarchical label");
    expect((result as { message: string }).message).toMatch(/The original layout was kept; nothing changed\.$/);
  });
});
