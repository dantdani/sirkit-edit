/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4, J4-B (J.5): the BOM's Sheet column. A project with sheets gets `sheets` on every
 * row (the sorted unique sheet names of the line's parts; the root by its own name) and a "Sheets" column at the end of the CSV; one
 * line per package whatever its sheet (a part family spread over sheets stays one row). A project WITHOUT sheets carries no `sheets`
 * key and its CSV header is unchanged, so the j2-consumers-golden digests hold (that suite is the byte gate; this one asserts the
 * absence directly). In-memory: the BOM's catalog reads see an empty mocked database; pricing "none" (no vendor call).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/db/client", () => {
  const chain: unknown = new Proxy(function query() {}, { get: (_target, key) => (key === "then" ? (resolve: (rows: unknown[]) => void) => resolve([]) : chain), apply: () => chain });
  return { getDb: () => chain };
});

import { bomToCsv, buildBom, sheetNamesOf } from "@/app/lib/bom/build";
import { sheetOf, sheetPathName } from "@/app/lib/schematic/sheets";
import { ROOT_SHEET_ID } from "@/lib/schematic-types";
import { droneFixtureState } from "../../schematic/__tests__/_j1-fixtures";
import { J3_ROOT_REFS, J3_SHEETS, multiSheetDroneFixtureState } from "../../schematic/__tests__/_j3-fixtures";

describe("[PR-J4 J4-B] the BOM names each line's sheets for a project with sheets, and nothing for a project without", () => {
  it("the organised drone: every row carries its sheets, computed from its references; one line per package whatever the sheet", async () => {
    const state = multiSheetDroneFixtureState();
    const flat = droneFixtureState();
    const [sheeted, plain] = await Promise.all([buildBom(state, "none"), buildBom(flat, "none")]);
    expect(sheeted.rows.length).toBe(plain.rows.length);
    expect(sheeted.rows.map((row) => row.refDes)).toEqual(plain.rows.map((row) => row.refDes)); // the same lines in the same order
    const nameOf = new Map(state.sheets!.sheets.map((sheet) => [sheet.id, sheet.parentId === null ? sheet.name : sheetPathName(state, sheet.id)]));
    for (const row of sheeted.rows) {
      const expected = [...new Set(row.refDesList.map((ref) => nameOf.get(sheetOf(state.kicadComponents!.find((instance) => instance.refDes === ref)!))!))].sort();
      expect(row.sheets, row.refDes).toEqual(expected);
    }
    const byRef = (ref: string) => sheeted.rows.find((row) => row.refDesList.includes(ref))!;
    expect(byRef("J1").sheets).toEqual(["Power"]);
    expect(byRef("U3").sheets).toEqual(["IMU"]);
    expect(byRef("U2").sheets).toEqual(["Overview"]);
    expect(byRef("Q1").sheets).toEqual(["Motor drivers"]);
    expect(sheeted.rows.some((row) => (row.sheets ?? []).length >= 2), "a part family spread over sheets stays one line").toBe(true);
    expect(new Set(sheeted.rows.flatMap((row) => row.sheets ?? []))).toEqual(new Set(["Overview", ...J3_SHEETS.map((sheet) => sheet.name)]));
    for (const ref of J3_ROOT_REFS) expect(byRef(ref).sheets).toContain("Overview");
  });

  it("a project without sheets: no `sheets` key on any row, the CSV header unchanged (byte identity; j2-consumers-golden is the digest gate)", async () => {
    const result = await buildBom(droneFixtureState(), "none");
    for (const row of result.rows) expect("sheets" in row).toBe(false);
    expect(JSON.stringify(result.rows)).not.toContain('"sheets"');
    const csv = bomToCsv(result);
    expect(csv.split("\r\n")[0]).toBe("refDes,Qty,Name,Sirkit Atomic Revision,MPN,Manufacturer,Package,Value,Best Unit Price,Currency,Extended Price,In Stock,Datasheet,Distributor URL,Risk Score,Risk Grade,Risk Notes");
  });

  it("the CSV of a project with sheets gains a last `Sheets` column with the names joined by `; `", async () => {
    const result = await buildBom(multiSheetDroneFixtureState(), "none");
    const lines = bomToCsv(result).split("\r\n");
    expect(lines[0]!.endsWith(",Risk Notes,Sheets")).toBe(true);
    const j1 = lines.find((line) => line.startsWith("J1,"));
    expect(j1?.endsWith(",Power")).toBe(true);
    const spread = result.rows.find((row) => (row.sheets ?? []).length >= 2)!;
    expect(lines.some((line) => line.endsWith(`,"${spread.sheets!.join("; ")}"`) || line.endsWith(`,${spread.sheets!.join("; ")}`))).toBe(true);
    expect(lines.length).toBe(result.rows.length + 1);
  });

  it("sheetNamesOf: the root by its own name, children by their path, sorted and unique", () => {
    const state = multiSheetDroneFixtureState();
    expect(sheetNamesOf(state, ["sheet-imu", ROOT_SHEET_ID, "sheet-imu", "sheet-power"])).toEqual(["IMU", "Overview", "Power"]);
    const nested = { sheets: { version: 1 as const, sheets: [{ id: ROOT_SHEET_ID, name: "Top", parentId: null }, { id: "p", name: "Power", parentId: ROOT_SHEET_ID }, { id: "r", name: "Regulator", parentId: "p" }] } };
    expect(sheetNamesOf(nested, ["r", ROOT_SHEET_ID])).toEqual(["Power/Regulator", "Top"]);
  });
});
