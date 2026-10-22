/**
 * [PR-J, 2026-10-22] Runbook section J increment 2 (J.8 item 5; OD-255 item 2): POST /api/export/kicad writes ONE flat .kicad_sch whose
 * ordinary labels become global labels, so a project organised into sheets would be exported with every sheet's local labels joined
 * by name and its hierarchy lost. Until the native hierarchical export exists the route refuses such a project with a structured 422
 * EXPORT_HIERARCHY_PENDING before any catalog read; a project without sheets exports exactly as before.
 */
import { describe, expect, it, vi } from "vitest";
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
const post = (state: SchematicState): Promise<Response> => POST(new Request("http://localhost/api/export/kicad", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, title: "j2" }) }));

describe("[PR-J J2] /api/export/kicad refuses a project organised into sheets instead of flattening it", () => {
  it("a project with sheets: 422 EXPORT_HIERARCHY_PENDING, no catalog read, nothing exported", async () => {
    const state = flat();
    state.components[1] = { ...state.components[1]!, sheetId: "stage-2" };
    state.sheets = { version: 1, sheets: [{ id: "root", name: "Overview", parentId: null }, { id: "stage-2", name: "Stage 2", parentId: "root" }] };
    const before = reads.parts;
    const response = await post(state);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ ok: false, code: "EXPORT_HIERARCHY_PENDING", error: "KiCad export writes one flat schematic page; a project organised into sheets needs the hierarchical export, which is not available yet. Nothing was exported and nothing changed." });
    expect(reads.parts).toBe(before);
  });

  it("the same project without sheets exports a .kicad_sch as before", async () => {
    const response = await post(flat());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("(kicad_sch");
  });
});
