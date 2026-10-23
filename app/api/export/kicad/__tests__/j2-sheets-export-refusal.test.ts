/**
 * [PR-J, 2026-10-22] Runbook section J increment 2 (J.8 item 5; OD-255 item 2): POST /api/export/kicad writes ONE flat .kicad_sch whose
 * ordinary labels become global labels, so a project organised into sheets would be exported with every sheet's local labels joined
 * by name and its hierarchy lost. Until the native hierarchical export exists the route refuses such a project with a structured 422
 * EXPORT_HIERARCHY_PENDING before any catalog read; a project without sheets exports exactly as before.
 *
 * [PR-J4, 2026-10-23] Pin move (OD-258 item 2): the J2 refusal is lifted - the SAME route now answers a project with sheets with ONE
 * zip of its native KiCad hierarchy (the root file with a sheet symbol per child sheet, one file per sheet; application/zip,
 * `<title>.zip`). Case 1 was "422 EXPORT_HIERARCHY_PENDING, no catalog read, nothing exported" and is now the zip with its two files
 * and no flattening; case 2 is unchanged; case 3 keeps the defence in depth: the flat serializer itself still refuses a sheeted
 * document. The route's full hierarchy behaviour is in j4-kicad-hierarchy-route.test.ts.
 */
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { exportToKicadSch, SchematicExportHierarchyPendingError, uuidFor } from "@/app/lib/kicad-export";
import { parseSexpr } from "@/app/lib/pcb/sexpr";
import type { SchematicState } from "@/lib/schematic-types";

const reads = vi.hoisted(() => ({ parts: 0 }));
vi.mock("@/app/lib/parts-search", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getFullPartsByIds: vi.fn(async () => { reads.parts += 1; return []; }),
}));
import { POST } from "../route";

function flat(): SchematicState {
  return {
    components: [
      { id: "uuid-r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "1k", refDes: "R1" },
      { id: "uuid-r2", type: "resistor", x: 100, y: 300, rotation: 0, value: "2k", refDes: "R2" },
      { id: "uuid-g1", type: "ground", x: 100, y: 200, rotation: 0, value: "" },
    ],
    kicadComponents: [],
    wires: [{ id: "w1", vertices: [{ x: 130, y: 100 }, { x: 300, y: 100 }] }],
    netLabels: [{ id: "l1", position: { x: 300, y: 100 }, name: "VOUT", kind: "label", orientation: 0 }],
    pageSize: "A4",
  };
}
function sheeted(): SchematicState {
  const state = flat();
  state.components[1] = { ...state.components[1]!, sheetId: "stage-2" };
  state.sheets = { version: 1, sheets: [{ id: "root", name: "Overview", parentId: null }, { id: "stage-2", name: "Stage 2", parentId: "root" }] };
  return state;
}
const post = (state: SchematicState): Promise<Response> => POST(new Request("http://localhost/api/export/kicad", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, title: "j2" }) }));

describe("[PR-J J2] /api/export/kicad never flattens a project organised into sheets", () => {
  it("[PR-J4, 2026-10-23 pin move] a project with sheets: 200 application/zip `j2.zip` holding the root file and one file per sheet, nothing flattened", async () => {
    const response = await post(sheeted());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="j2.zip"');
    const zip = await JSZip.loadAsync(await response.arrayBuffer());
    const childPath = `Stage_2-${uuidFor("sheet-file", "stage-2").slice(0, 8)}.kicad_sch`;
    expect(Object.keys(zip.files)).toEqual([childPath, "j2.kicad_sch"]); // sorted entries
    const root = await zip.file("j2.kicad_sch")!.async("string");
    const child = await zip.file(childPath)!.async("string");
    for (const text of [root, child]) expect(parseSexpr(text).items[0]).toMatchObject({ kind: "symbol", value: "kicad_sch" });
    expect(root).toContain(`(property "Sheetname" "Stage 2"`);
    expect(root).toContain(`(property "Sheetfile" "${childPath}"`);
    expect(root).toContain(`(property "Reference" "R1"`);
    expect(root).not.toContain(`(property "Reference" "R2"`);
    expect(child).toContain(`(property "Reference" "R2"`);
    expect(child).not.toContain("(sheet_instances");
    expect(root).toContain(`(uuid "${uuidFor("schematic", "root")}")`);
    expect(JSON.stringify(Object.keys(zip.files))).not.toContain("EXPORT_HIERARCHY_PENDING");
  });

  it("the same project without sheets exports a .kicad_sch as before", async () => {
    const response = await post(flat());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="j2.kicad_sch"');
    expect(await response.text()).toContain("(kicad_sch");
  });

  it("[PR-J4, 2026-10-23] defence in depth: the flat serializer itself still refuses a document with sheets (EXPORT_HIERARCHY_PENDING)", () => {
    expect(() => exportToKicadSch({ state: sheeted(), parts: new Map() })).toThrow(SchematicExportHierarchyPendingError);
  });
});
