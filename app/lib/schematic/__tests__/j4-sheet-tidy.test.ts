/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4 (J.3 item 5 "a tidy operation affects the selected sheet by default"; OD-258 item 5):
 * the pure per-sheet tidy (app/lib/schematic/sheet-tidy.ts) on the frozen multi-sheet drone.
 *
 *  1. the refusals: no sheet named, an unknown sheet, a sheet with child blocks (the overview), a part whose catalog record is missing;
 *  2. the sheet's logical netlist holds exactly its parts, its port nets as labels named by the PORT, its rails by exact name and kind, and
 *     no sheet-path name;
 *  3. tidying the IMU sheet: every one of the 41 instances keeps its id and authority fields (only the IMU's x / y / rotation move); the
 *     other sheets' components, wires and labels are byte-identical; the IMU port anchors keep id, scope and port; the project connectivity's
 *     partition digest, the PCB netlist and its hash are unchanged; the result is a valid document; the base is not mutated (the page's undo
 *     is the previous state);
 *  4. a re-layout that would detach a port anchor (the port's labels renamed) or lose a part is refused SHEETS_TIDY_NOT_EQUIVALENT with
 *     nothing changed;
 *  5. the same input twice gives the same placements (the layout is deterministic; only wire / label ids are minted).
 * Pure / in-memory: no network, no database, no model.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validateSchematicStateIntegrity } from "@/app/lib/engineering/schematic-model";
import { buildNetlist, netlistHash } from "@/app/lib/pcb/netlist-bridge";
import { autoLayoutBuildValidated } from "@/lib/build-auto-layout";
import { resolveProjectConnectivity } from "../project-connectivity";
import { mergeTidiedSheet, sheetLogicalNetlist, tidySheet, tidySheetRefusal } from "../sheet-tidy";
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
});
