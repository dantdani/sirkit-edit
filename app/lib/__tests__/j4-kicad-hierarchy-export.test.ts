/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4, J4-B (J.8 item 5; OD-258 item 2): the native hierarchical KiCad export.
 *
 *  1. The frozen J3 drone (4 sheets, 7 ports) exports as four files: the root with three `(sheet)` symbols (Power without pins; Motor
 *     drivers PWM1-4; IMU I2C_SCL / I2C_SDA / IMU_INT1), every sheet pin on its block's edge and wired from the Sirkit anchor, each
 *     child's hierarchical labels equal to its pins, M<n>_GATE / M<n>_DRAIN as `(label)`, the rails as power symbols, NO global label;
 *     symbol instance paths chain the sheet-symbol uuids; every file parses within the ingest bounds.
 *  2. Round trip through the Sirkit oracle (a reader over the pinned format, NOT a KiCad run): the files' connectivity equals the
 *     project connectivity authority's pin partition - the drone, the LED dimmer organised with the move planner, a depth-2 hierarchy
 *     (chained paths and pages) and a project with scope-"global" labels beside a same-named local one.
 *  3. Determinism: two exports are byte-identical, the zip (sorted entries, the fixed DOS date, stored) has a pinned digest with an
 *     injected date, file names move only with their own sheet, no `crypto.randomUUID` in the module.
 *  4. Refusals, nothing serialized: a shadowed port (EXPORT_SHADOWED_PORT naming the labels), a local label equal to a rail name on
 *     its sheet (EXPORT_NAME_SHADOWS_GLOBAL), a connectivity error (SHEET_HIERARCHY_INVALID), a structural error (the canonical
 *     validation), a document without sheets; the flat serializer still refuses a sheeted document (defence in depth).
 * Pure / in-memory: no network, no database, no randomness; the KiCad golden bytes of single-sheet documents are pinned in
 * app/lib/engineering/__tests__/j1-sheet-operations.test.ts and untouched here.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { assertBoundedSExpression } from "@/app/lib/atomic/security";
import { validateSchematicStateIntegrity } from "@/app/lib/engineering/schematic-model";
import { exportToKicadSch, SchematicExportHierarchyPendingError, SchematicExportValidationError, mmFromPx, uuidFor } from "@/app/lib/kicad-export";
import {
  KICAD_HIERARCHY_ZIP_DATE,
  SchematicExportHierarchyError,
  exportToKicadHierarchy,
  kicadSheetFileName,
  refuseKicadHierarchy,
  sheetPinShape,
  zipKicadHierarchy,
  type KicadHierarchyExport,
} from "@/app/lib/kicad-export-hierarchy";
import { parseSexpr } from "@/app/lib/pcb/sexpr";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { sheetBlockOf } from "@/app/lib/schematic/sheet-lens";
import { planMoveToSheet } from "@/app/lib/schematic/sheet-operations";
import { compareCodePoints } from "@/app/lib/stable-compare";
import { ROOT_SHEET_ID, schDisplayRef, type SchematicState } from "@/lib/schematic-types";
import { fixturePartLookup, fixtureParts } from "../schematic/__tests__/_j1-fixtures";
import { dimmerFixtureState } from "../schematic/__tests__/_j2-fixtures";
import { J3_SHEETS, attachedSelection, multiSheetDroneFixtureState } from "../schematic/__tests__/_j3-fixtures";
import { globalFixture, stageFixture, unpinnedInstances } from "./_j4-fixtures";
import { readKicadHierarchyPartition } from "./_kicad-hierarchy-oracle";

const sha = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
const TODAY = "2026-10-23";
/** The drone zip's digest with the injected date (title "drone"); moves only with the export's bytes. */
const DRONE_ZIP_SHA = "15828a82b236bc2bffb9652f5816b974b6aa98d8297f8c0d5fea530c643e022e";

const exportOf = (state: SchematicState, title = "drone"): KicadHierarchyExport => exportToKicadHierarchy({ state, parts: fixtureParts(), title, today: TODAY });

/** The authority's pin partition in the oracle's shape (sorted member lists; nets by their first member). */
function authorityPartition(state: SchematicState): { nets: string[][]; pins: string[] } {
  const conn = resolveProjectConnectivity(state, fixturePartLookup());
  expect(conn.ok, conn.diagnostics.map((item) => item.message).join(" ")).toBe(true);
  return {
    nets: conn.nets.filter((net) => net.members.length > 0).map((net) => [...net.members].sort(compareCodePoints)).sort((a, b) => compareCodePoints(a[0]!, b[0]!)),
    pins: conn.pins.map((pin) => pin.key).sort(compareCodePoints),
  };
}

function referenceMap(state: SchematicState): (reference: string) => string | null {
  const map = new Map<string, string>();
  for (const instance of state.kicadComponents ?? []) map.set(instance.refDes, instance.id);
  for (const component of state.components) map.set(schDisplayRef(component), component.id);
  return (reference) => map.get(reference) ?? null;
}

/** Export, parse every file within the ingest bounds, and prove the oracle's partition equals the authority's. */
function roundTrip(state: SchematicState, title = "drone"): KicadHierarchyExport {
  const out = exportOf(state, title);
  for (const file of out.files) { assertBoundedSExpression(file.content); expect(parseSexpr(file.content).items[0]).toMatchObject({ kind: "symbol", value: "kicad_sch" }); }
  const oracle = readKicadHierarchyPartition(out.files, referenceMap(state));
  const authority = authorityPartition(state);
  expect(oracle.pins).toEqual(authority.pins);
  expect(oracle.nets).toEqual(authority.nets);
  return out;
}

const count = (text: string, pattern: RegExp): number => (text.match(pattern) ?? []).length;
const fileOf = (out: KicadHierarchyExport, sheetId: string): string => out.files.find((file) => file.sheetId === sheetId)!.content;

// ── 1. the drone's four files ───────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4 J4-B] 1. the frozen J3 drone exports as a root file with three sheet symbols and one file per sheet", () => {
  const state = multiSheetDroneFixtureState();
  const out = exportOf(state);
  const rootUuid = uuidFor("schematic", "root");

  it("four files in page order, named by the title and by sheet path + digest; instance paths chain the sheet-symbol uuids", () => {
    expect(out.rootUuid).toBe(rootUuid);
    expect(out.rootPath).toBe("drone.kicad_sch");
    expect(out.files.map((file) => [file.path, file.page, file.instancePath])).toEqual([
      ["drone.kicad_sch", 1, `/${rootUuid}`],
      [`Power-${uuidFor("sheet-file", "sheet-power").slice(0, 8)}.kicad_sch`, 2, `/${rootUuid}/${uuidFor("sheet", "sheet-power")}`],
      [`Motor_drivers-${uuidFor("sheet-file", "sheet-motors").slice(0, 8)}.kicad_sch`, 3, `/${rootUuid}/${uuidFor("sheet", "sheet-motors")}`],
      [`IMU-${uuidFor("sheet-file", "sheet-imu").slice(0, 8)}.kicad_sch`, 4, `/${rootUuid}/${uuidFor("sheet", "sheet-imu")}`],
    ]);
    for (const sheet of J3_SHEETS) expect(kicadSheetFileName(state, state.sheets!.sheets.find((item) => item.id === sheet.id)!)).toBe(out.files.find((file) => file.sheetId === sheet.id)!.path);
    const root = fileOf(out, ROOT_SHEET_ID);
    expect(root).toContain(`\t(uuid "${rootUuid}")`);
    expect(root).toContain(`\t(sheet_instances\n\t\t(path "/" (page "1"))\n\t)`);
    expect(count(root, /\(path "\/[0-9a-f-]+"\n/g)).toBe(count(root, /\n\t\(symbol\n/g)); // every root symbol instance: /<root uuid>
    for (const sheet of J3_SHEETS) {
      const child = fileOf(out, sheet.id);
      expect(child).toContain(`\t(uuid "${uuidFor("schematic", sheet.id)}")`);
      expect(child).not.toContain("(sheet_instances");
      expect(count(child, new RegExp(`\\(path "/${rootUuid}/${uuidFor("sheet", sheet.id)}"\\n`, "g"))).toBe(count(child, /\n\t\(symbol\n/g));
    }
  });

  it("the root holds the three sheet symbols with Sheetname / Sheetfile and the ports' pins; Power has none", () => {
    const root = fileOf(out, ROOT_SHEET_ID);
    const blocks = root.split("\n\t(sheet\n").slice(1).map((block) => `\t(sheet\n${block.split("\n\t)\n")[0]}\n\t)`);
    expect(blocks).toHaveLength(3);
    const pinsOf = (block: string): string[] => [...block.matchAll(/\(pin "([^"]+)" (\w+) \(at ([-\d.]+) ([-\d.]+) (\d+)\)/g)].map((match) => `${match[1]}:${match[2]}`);
    expect(blocks.map((block) => block.match(/\(property "Sheetname" "([^"]+)"/)![1])).toEqual(["Power", "Motor drivers", "IMU"]);
    expect(blocks.map((block) => block.match(/\(property "Sheetfile" "([^"]+)"/)![1])).toEqual(out.files.slice(1).map((file) => file.path));
    expect(blocks.map(pinsOf)).toEqual([[], ["PWM1:passive", "PWM2:passive", "PWM3:passive", "PWM4:passive"], ["I2C_SCL:passive", "I2C_SDA:passive", "IMU_INT1:passive"]]);
    expect(blocks.map((block) => block.match(/\(path "([^"]+)" \(page "(\d+)"\)/)!.slice(1))).toEqual([[`/${rootUuid}`, "2"], [`/${rootUuid}`, "3"], [`/${rootUuid}`, "4"]]);
    expect(blocks.map((block) => block.match(/\(uuid "([^"]+)"\)\n\t\t\(property "Sheetname"/)![1])).toEqual(J3_SHEETS.map((sheet) => uuidFor("sheet", sheet.id)));
  });

  it("every sheet pin sits on its block's edge in millimetres and a two-point wire joins it to the Sirkit anchor; pins never coincide", () => {
    const root = fileOf(out, ROOT_SHEET_ID);
    const pins = state.netLabels!.filter((label) => label.scope === "sheet-pin");
    expect(pins).toHaveLength(7);
    const seen = new Set<string>();
    for (const pin of pins) {
      const child = state.sheets!.sheets.find((sheet) => sheet.id === pin.childSheetId)!;
      const block = sheetBlockOf(state, child);
      const written = root.match(new RegExp(`\\(pin "${pin.name}" passive \\(at ([-\\d.]+) ([-\\d.]+) (\\d+)\\)[^\\n]*\\(uuid "${uuidFor("sheet-pin", pin.id)}"\\)`));
      expect(written, pin.name).not.toBeNull();
      const x = Number(written![1]), y = Number(written![2]);
      const left = mmFromPx(block.x), right = mmFromPx(block.x + block.width), top = mmFromPx(block.y), bottom = mmFromPx(block.y + block.height);
      expect(x === left || x === right || y === top || y === bottom, `${pin.name} at ${x},${y} is on the ${child.name} block edge`).toBe(true);
      expect(x >= left && x <= right && y >= top && y <= bottom).toBe(true);
      expect(seen.has(`${x},${y}`), `${pin.name} shares no point with another pin`).toBe(false);
      seen.add(`${x},${y}`);
      // the anchor is not on the edge in this fixture (the planner anchored it at the cut point): the connecting wire exists
      const ax = mmFromPx(pin.position.x), ay = mmFromPx(pin.position.y);
      expect(root).toContain(`\t(wire\n\t\t(pts (xy ${ax} ${ay}) (xy ${x} ${y}))\n\t\t(stroke (width 0) (type default))\n\t\t(uuid "${uuidFor("wire", `sheet-pin:${pin.id}`)}")\n\t)`);
    }
  });

  it("each child's hierarchical labels equal its sheet's pins; M<n>_GATE / M<n>_DRAIN are local labels; rails are power symbols; no global label anywhere", () => {
    for (const sheet of J3_SHEETS) {
      const child = fileOf(out, sheet.id);
      const hierarchical = [...child.matchAll(/\(hierarchical_label "([^"]+)"\n\t\t\(shape (\w+)\)/g)].map((match) => match[1]).sort();
      expect(hierarchical).toEqual([...sheet.ports].sort());
    }
    const motors = fileOf(out, "sheet-motors");
    for (const name of ["M1_GATE", "M1_DRAIN", "M2_GATE", "M2_DRAIN", "M3_GATE", "M3_DRAIN", "M4_GATE", "M4_DRAIN"]) expect(motors).toContain(`\t(label "${name}"\n`);
    expect(motors).toContain(`(lib_id "power:VBAT")`);
    expect(motors).toContain(`(lib_id "power:GND")`);
    expect(fileOf(out, "sheet-power")).toContain(`(lib_id "power:+3V3")`);
    expect(fileOf(out, "sheet-imu")).toContain(`(lib_id "power:+3V3")`);
    for (const file of out.files) {
      expect(file.content).not.toContain("(global_label");
      expect(file.content).toContain(`(version 20250610)`);
      expect(file.content).toContain(`(date "${TODAY}")`);
    }
    // every power symbol's lib_symbols entry exists in the file that uses it (the file is self-contained)
    for (const file of out.files) for (const name of new Set([...file.content.matchAll(/\(lib_id "power:([^"]+)"\)/g)].map((match) => match[1]))) expect(file.content).toContain(`(symbol "power:${name}"`);
  });

  it("round trip: the oracle's partition over the four files equals the authority's (41 instances, every pin)", () => {
    const checked = roundTrip(state);
    const oracle = readKicadHierarchyPartition(checked.files, referenceMap(state));
    expect(oracle.files[checked.rootPath]).toMatchObject({ symbols: 11, sheets: 3, sheetPins: 7, globalLabels: 0, wires: 6 + 7 });
    expect(oracle.files[fileOf(out, "sheet-motors") && checked.files[2]!.path]).toMatchObject({ symbols: 20, hierarchicalLabels: 4, sheets: 0, globalLabels: 0 });
    expect(oracle.pins.length).toBe(resolveProjectConnectivity(state, fixturePartLookup()).pins.length);
  });
});

// ── 2. round trips: the dimmer organised by the planner, a depth-2 hierarchy, global labels ────────────────────────────────

describe("[PR-J4 J4-B] 2. the oracle round trip holds for the LED dimmer organised by the move planner, a depth-2 hierarchy and global labels", () => {
  it("the dimmer's timing network moved to a child sheet by planMoveToSheet exports two files whose connectivity equals the authority's", () => {
    const lookup = fixturePartLookup();
    const flat = dimmerFixtureState();
    const plan = planMoveToSheet(flat, { entities: attachedSelection(flat, ["R1", "C1"], lookup), target: { newSheet: { id: "sheet-timing", name: "Timing", block: { x: 900, y: 100, width: 300, height: 200 } } }, rootName: "Overview", operationIdPrefix: "j4-dimmer" }, lookup);
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.message}`);
    expect(plan.preview.crossings.length).toBeGreaterThan(0); // the timing network reaches U1 through ports
    const out = roundTrip(plan.after, "dimmer");
    expect(out.files.map((file) => file.path)).toEqual(["dimmer.kicad_sch", `Timing-${uuidFor("sheet-file", "sheet-timing").slice(0, 8)}.kicad_sch`]);
    const root = out.files[0]!.content;
    expect(count(root, /\n\t\(sheet\n/g)).toBe(1);
    expect(count(root, /\(pin "[^"]+" \w+ \(at/g)).toBe(plan.preview.crossings.length);
    expect(out.files[1]!.content).toContain(`(property "Reference" "R1"`);
    expect(root).not.toContain(`(property "Reference" "R1"`);
  });

  it("a depth-2 hierarchy: the grandchild's sheet symbol lives in its parent's file, paths chain two sheet uuids, pages run depth-first", () => {
    const state = stageFixture();
    expect(validateSchematicStateIntegrity(state)).toEqual([]);
    const out = roundTrip(state, "stage");
    const rootUuid = uuidFor("schematic", "root");
    expect(out.files.map((file) => [file.sheetId, file.page, file.instancePath])).toEqual([
      [ROOT_SHEET_ID, 1, `/${rootUuid}`],
      ["stage", 2, `/${rootUuid}/${uuidFor("sheet", "stage")}`],
      ["inner", 3, `/${rootUuid}/${uuidFor("sheet", "stage")}/${uuidFor("sheet", "inner")}`],
    ]);
    const stage = fileOf(out, "stage");
    expect(stage).toContain(`(property "Sheetname" "Inner"`);
    expect(stage).toContain(`(property "Sheetfile" "${out.files[2]!.path}"`);
    expect(stage).toContain(`(pin "IN" input (at`);
    expect(stage).toContain(`(path "/${rootUuid}/${uuidFor("sheet", "stage")}" (page "3"))`);
    expect(stage).toContain(`(hierarchical_label "SIG"\n\t\t(shape passive)`);
    const inner = fileOf(out, "inner");
    expect(inner).toContain(`(hierarchical_label "IN"\n\t\t(shape input)`);
    expect(inner).toContain(`(path "/${rootUuid}/${uuidFor("sheet", "stage")}/${uuidFor("sheet", "inner")}"\n`);
    expect(inner).not.toContain("(sheet\n");
    // the anchor (200,300) is not on the Stage block {400,100,300,200}: the pin lands on the left edge at the same height, wired across
    expect(fileOf(out, ROOT_SHEET_ID)).toContain(`(pin "SIG" passive (at ${mmFromPx(400)} ${mmFromPx(300)} 180)`);
    expect(fileOf(out, ROOT_SHEET_ID)).toContain(`(pts (xy ${mmFromPx(200)} ${mmFromPx(300)}) (xy ${mmFromPx(400)} ${mmFromPx(300)}))`);
    expect(authorityPartition(state).nets).toEqual([["j4-r1::1"], ["j4-r1::2", "j4-r2::1"], ["j4-r2::2", "j4-r3::1"], ["j4-r3::2"]]);
  });

  it("a scope-global label becomes a global_label on every sheet that carries it; a same-named LOCAL label on another sheet stays a (label) and its own net", () => {
    const state = globalFixture();
    expect(validateSchematicStateIntegrity(state)).toEqual([]);
    const out = roundTrip(state, "global");
    expect(fileOf(out, ROOT_SHEET_ID)).toContain(`\t(global_label "CLK"\n`);
    expect(fileOf(out, "clock")).toContain(`\t(global_label "CLK"\n`);
    expect(fileOf(out, "sensors")).toContain(`\t(label "CLK"\n`);
    expect(fileOf(out, "sensors")).not.toContain("(global_label");
    expect(authorityPartition(state).nets).toEqual([["j4-g-r1::1", "j4-g-r2::1"], ["j4-g-r1::2", "j4-g-r2::2", "j4-g-r3::2"], ["j4-g-r3::1"]]);
  });

  it("the oracle refuses a symbol the file does not embed (a stock-library Theory part): it never guesses a pin", () => {
    // a Theory capacitor: Device:C is referenced by lib_id only (the fixture's KiCad resistor embeds Device:R, which a Theory resistor would share)
    const theory: SchematicState = { ...stageFixture(), components: [{ id: "t-c9", type: "capacitor", x: 600, y: 600, rotation: 0, value: "100n", refDes: "C9" }] };
    const out = exportOf(theory, "theory");
    expect(fileOf(out, ROOT_SHEET_ID)).toContain(`(lib_id "Device:C")`);
    expect(() => readKicadHierarchyPartition(out.files, referenceMap(theory))).toThrow(/Device:C is not embedded/);
  });
});

// ── 3. determinism ──────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4 J4-B] 3. determinism: byte-identical exports, a pinned zip, stable file names, no random draw", () => {
  it("two exports of the drone are byte-identical; the zip has sorted stored entries with the fixed date and the pinned digest", async () => {
    const state = multiSheetDroneFixtureState();
    const first = exportOf(state), second = exportOf(state);
    expect(JSON.stringify(first.files)).toBe(JSON.stringify(second.files));
    const bytes = await zipKicadHierarchy(first.files);
    expect(sha(bytes)).toBe(DRONE_ZIP_SHA);
    expect(sha(await zipKicadHierarchy([...second.files].reverse()))).toBe(DRONE_ZIP_SHA); // entry order is the sorted path order whatever the input order
    const zip = await JSZip.loadAsync(bytes);
    const entries = Object.values(zip.files);
    expect(entries.map((entry) => entry.name)).toEqual([...first.files.map((file) => file.path)].sort(compareCodePoints));
    expect(entries.every((entry) => !entry.dir)).toBe(true);
    for (const entry of entries) {
      expect(entry.date.toISOString()).toBe(KICAD_HIERARCHY_ZIP_DATE.toISOString());
      expect(await entry.async("string")).toBe(first.files.find((file) => file.path === entry.name)!.content);
    }
    expect(KICAD_HIERARCHY_ZIP_DATE.toISOString()).toBe("1980-01-01T00:00:00.000Z");
  });

  it("renaming an unrelated sheet moves only that sheet's file name; the root's uuid is the flat exporter's", () => {
    const state = multiSheetDroneFixtureState();
    const renamed: SchematicState = { ...state, sheets: { version: 1, sheets: state.sheets!.sheets.map((sheet) => (sheet.id === "sheet-imu" ? { ...sheet, name: "Sensors" } : sheet)) } };
    const before = exportOf(state), after = exportOf(renamed);
    expect(after.files.map((file) => file.path).slice(0, 3)).toEqual(before.files.map((file) => file.path).slice(0, 3));
    expect(after.files[3]!.path).toBe(`Sensors-${uuidFor("sheet-file", "sheet-imu").slice(0, 8)}.kicad_sch`);
    expect(after.files[1]!.content).toBe(before.files[1]!.content); // the Power file's bytes do not move
    expect(before.rootUuid).toBe(uuidFor("schematic", "root"));
  });

  it("the module draws no random uuid (ids are digests of stable identities)", () => {
    const source = readFileSync("app/lib/kicad-export-hierarchy.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, ""); // the header comment names what is NOT used
    expect(code).not.toMatch(/randomUUID|Math\.random|randomGenerationUuid|getRandomValues/);
    expect(source).toContain("uuidFor(\"sheet\", sheet.id)");
    expect(source).toContain("uuidFor(\"sheet-pin\", label.id)");
    expect(sheetPinShape("power_in")).toBe("input");
    expect(sheetPinShape("power_out")).toBe("output");
    expect(sheetPinShape("bidirectional")).toBe("bidirectional");
  });
});

// ── 4. refusals ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-J4 J4-B] 4. refusals serialize nothing and name what is wrong", () => {
  const withLabel = (state: SchematicState, label: NonNullable<SchematicState["netLabels"]>[number]): SchematicState => ({ ...state, netLabels: [...(state.netLabels ?? []), label] });

  it("a local label named like a port anchor on its sheet, on another net: EXPORT_SHADOWED_PORT naming both labels", () => {
    const state = withLabel(stageFixture(), { id: "j4-local-sig", position: { x: 600, y: 400 }, name: "SIG", kind: "label", orientation: 0, sheetId: "stage" });
    const refusal = refuseKicadHierarchy(state);
    expect(refusal).toBeInstanceOf(SchematicExportHierarchyError);
    expect(refusal!.code).toBe("EXPORT_SHADOWED_PORT");
    expect(refusal!.refs).toEqual(["j4-lbl-stage-sig", "j4-local-sig"]);
    expect(refusal!.message).toContain('the local label SIG and the port label SIG are different nets');
    expect(() => exportOf(state)).toThrow(SchematicExportHierarchyError);
    expect(refuseKicadHierarchy(state, fixturePartLookup())!.code).toBe("EXPORT_SHADOWED_PORT"); // with or without the parts: the same answer
  });

  it("a local label equal to a rail name on its own sheet: EXPORT_NAME_SHADOWS_GLOBAL (a plain GND beside the GND rail)", () => {
    const state = withLabel(stageFixture(), { id: "j4-local-gnd", position: { x: 600, y: 400 }, name: "GND", kind: "label", orientation: 0, sheetId: "inner" });
    const refusal = refuseKicadHierarchy(state);
    expect(refusal?.code).toBe("EXPORT_NAME_SHADOWS_GLOBAL");
    expect(refusal?.refs).toEqual(["j4-local-gnd"]);
    expect(refusal?.message).toContain('"GND" (j4-local-gnd, on sheet "Stage/Inner", 600,400) beside the project-wide net GND');
    // the same plain GND on a sheet WITHOUT the rail is its own local net under both readings: exported as a (label)
    const elsewhere = withLabel(stageFixture(), { id: "j4-local-gnd", position: { x: 600, y: 400 }, name: "GND", kind: "label", orientation: 0, sheetId: "stage" });
    expect(refuseKicadHierarchy(elsewhere)).toBeNull();
    expect(fileOf(exportOf(elsewhere, "stage"), "stage")).toContain(`\t(label "GND"\n`);
  });

  it("a connectivity error (two different nets named X): SHEET_HIERARCHY_INVALID naming the diagnostic", () => {
    const state = withLabel(withLabel(stageFixture(), { id: "j4-x-root", position: { x: 600, y: 600 }, name: "X", kind: "label", orientation: 0 }), { id: "j4-x-global", position: { x: 600, y: 400 }, name: "X", kind: "label", orientation: 0, sheetId: "stage", scope: "global" });
    const refusal = refuseKicadHierarchy(state);
    expect(refusal?.code).toBe("SHEET_HIERARCHY_INVALID");
    expect(refusal?.message).toContain("SHEET_NET_NAME_COLLISION");
    expect(() => exportOf(state)).toThrow(SchematicExportHierarchyError);
  });

  it("a structural error is the canonical validation's refusal; a document without sheets is refused; the flat serializer still refuses a sheeted one", () => {
    const dangling: SchematicState = { ...stageFixture(), kicadComponents: stageFixture().kicadComponents!.map((instance) => (instance.refDes === "R3" ? { ...instance, sheetId: "nowhere" } : instance)) };
    expect(() => exportOf(dangling)).toThrow(SchematicExportValidationError);
    expect(() => exportOf(unpinnedInstances({ ...stageFixture(), sheets: undefined, kicadComponents: [stageFixture().kicadComponents![0]!], wires: [], netLabels: [] }))).toThrow(SchematicExportValidationError);
    expect(() => exportToKicadSch({ state: stageFixture(), parts: fixtureParts() })).toThrow(SchematicExportHierarchyPendingError);
  });
});
