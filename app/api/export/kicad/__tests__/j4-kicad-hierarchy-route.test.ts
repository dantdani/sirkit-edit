/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4, J4-B (J.8 item 5; OD-258 item 2): POST /api/export/kicad for a project with
 * sheets - the SAME route, no new method (the b16-1c census stays 177 / 174 / 0).
 *
 *  1. The frozen J3 drone (instances unpinned so the catalog mock serves the parts): 200 application/zip, `drone.zip`, four entries
 *     sorted by name with the fixed 1980-01-01 date, each byte-equal to the pure serializer's file; two requests give one byte sequence.
 *  2. A project WITHOUT sheets: the response bytes and headers are exactly the flat serializer's (`drone.kicad_sch`, octet-stream).
 *  3. Refusals answer BEFORE any catalog read, nothing zipped: a shadowed port (422 EXPORT_SHADOWED_PORT naming the labels), a local
 *     label equal to a rail name on its sheet (422 EXPORT_NAME_SHADOWS_GLOBAL), a connectivity error (422 SHEET_HIERARCHY_INVALID), a
 *     structural error (422 SCHEMATIC_STATE_INVALID naming the SHEETS diagnostic - the canonical pre-check that already stood).
 *  4. The route source carries no EXPORT_HIERARCHY_PENDING answer any more and exports no extra method.
 * No network, no database: the parts come from the committed fixture catalog through the mocked catalog read.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it, vi } from "vitest";
import { exportToKicadSch } from "@/app/lib/kicad-export";
import { KICAD_HIERARCHY_ZIP_DATE, exportToKicadHierarchy } from "@/app/lib/kicad-export-hierarchy";
import type { SchematicState } from "@/lib/schematic-types";
import { globalFixture, stageFixture, unpinnedInstances } from "../../../../lib/__tests__/_j4-fixtures";
import { droneFixtureState, fixtureParts } from "../../../../lib/schematic/__tests__/_j1-fixtures";
import { multiSheetDroneFixtureState } from "../../../../lib/schematic/__tests__/_j3-fixtures";

const reads = vi.hoisted(() => ({ parts: 0 }));
vi.mock("@/app/lib/parts-search", async (importOriginal) => {
  const { fixtureRuntimeCatalog } = await import("@/app/lib/fixture-runtime/blinker/catalog");
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    getFullPartsByIds: vi.fn(async (ids: string[]) => { reads.parts += 1; const parts = fixtureRuntimeCatalog().cachedParts; return ids.map((id) => parts.get(id)).filter((part) => part !== undefined); }),
  };
});
import { POST } from "../route";

const sha = (value: string | ArrayBuffer): string => createHash("sha256").update(typeof value === "string" ? value : new Uint8Array(value)).digest("hex");
const post = (state: SchematicState, title = "drone"): Promise<Response> => POST(new Request("http://localhost/api/export/kicad", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, title }) }));
const drone = (): SchematicState => unpinnedInstances(multiSheetDroneFixtureState());

describe("[PR-J4 J4-B] 1. a project with sheets downloads as ONE zip of its native KiCad hierarchy from the same POST", () => {
  it("200 application/zip `drone.zip`: four sorted entries, the fixed date, each entry byte-equal to the pure serializer's file", async () => {
    const response = await post(drone());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="drone.zip"');
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const bytes = await response.arrayBuffer();
    expect(response.headers.get("Content-Length")).toBe(String(bytes.byteLength));
    const zip = await JSZip.loadAsync(bytes);
    const expected = exportToKicadHierarchy({ state: drone(), parts: fixtureParts(), title: "drone" });
    expect(Object.keys(zip.files)).toEqual([...expected.files.map((file) => file.path)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    for (const entry of Object.values(zip.files)) {
      expect(entry.dir).toBe(false);
      expect(entry.date.toISOString()).toBe(KICAD_HIERARCHY_ZIP_DATE.toISOString());
      expect(await entry.async("string")).toBe(expected.files.find((file) => file.path === entry.name)!.content);
    }
  });

  it("two requests give one byte sequence", async () => {
    const first = sha(await (await post(drone())).arrayBuffer());
    const second = sha(await (await post(drone())).arrayBuffer());
    expect(first).toBe(second);
  });
});

describe("[PR-J4 J4-B] 2. a project without sheets keeps its exact single-file response", () => {
  it("the flat drone: octet-stream `drone.kicad_sch`, bytes equal to exportToKicadSch", async () => {
    const state = unpinnedInstances(droneFixtureState());
    const response = await post(state);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="drone.kicad_sch"');
    expect(response.headers.get("Cache-Control")).toBeNull();
    expect(sha(await response.text())).toBe(sha(exportToKicadSch({ state, parts: fixtureParts(), title: "drone" })));
  });
});

describe("[PR-J4 J4-B] 3. refusals are structured 422s before any catalog read; nothing is zipped", () => {
  const withLabel = (state: SchematicState, label: NonNullable<SchematicState["netLabels"]>[number]): SchematicState => ({ ...state, netLabels: [...(state.netLabels ?? []), label] });

  it("a shadowed port: 422 EXPORT_SHADOWED_PORT naming the labels", async () => {
    const before = reads.parts;
    const response = await post(withLabel(stageFixture(), { id: "j4-local-sig", position: { x: 600, y: 400 }, name: "SIG", kind: "label", orientation: 0, sheetId: "stage" }), "stage");
    expect(response.status).toBe(422);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    const body = await response.json() as { ok: boolean; code: string; error: string; refs: string[] };
    expect(body.ok).toBe(false);
    expect(body.code).toBe("EXPORT_SHADOWED_PORT");
    expect(body.refs).toEqual(["j4-lbl-stage-sig", "j4-local-sig"]);
    expect(body.error).toContain("nothing was exported");
    expect(reads.parts).toBe(before);
  });

  it("a local label equal to a rail name on its sheet: 422 EXPORT_NAME_SHADOWS_GLOBAL", async () => {
    const before = reads.parts;
    const response = await post(withLabel(stageFixture(), { id: "j4-local-gnd", position: { x: 600, y: 400 }, name: "GND", kind: "label", orientation: 0, sheetId: "inner" }), "stage");
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, code: "EXPORT_NAME_SHADOWS_GLOBAL", refs: ["j4-local-gnd"] });
    expect(reads.parts).toBe(before);
  });

  it("two spellings of one local name on one sheet: 422 EXPORT_NAME_CASE_AMBIGUOUS naming both labels", async () => {
    // [PR-J4 integration, 2026-10-23] review J4R-OUT-4
    const before = reads.parts;
    const response = await post(withLabel(withLabel(stageFixture(), { id: "j4-out-1", position: { x: 600, y: 400 }, name: "OUT", kind: "label", orientation: 0, sheetId: "stage" }), { id: "j4-out-2", position: { x: 600, y: 500 }, name: "out", kind: "label", orientation: 0, sheetId: "stage" }), "stage");
    expect(response.status).toBe(422);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ ok: false, code: "EXPORT_NAME_CASE_AMBIGUOUS", refs: ["j4-out-1", "j4-out-2"] });
    expect(reads.parts).toBe(before);
  });

  it("a connectivity error: 422 SHEET_HIERARCHY_INVALID naming the diagnostic", async () => {
    const before = reads.parts;
    const state = withLabel(withLabel(stageFixture(), { id: "j4-x-root", position: { x: 600, y: 600 }, name: "X", kind: "label", orientation: 0 }), { id: "j4-x-global", position: { x: 600, y: 400 }, name: "X", kind: "label", orientation: 0, sheetId: "stage", scope: "global" });
    const response = await post(state, "stage");
    expect(response.status).toBe(422);
    const body = await response.json() as { code: string; error: string };
    expect(body.code).toBe("SHEET_HIERARCHY_INVALID");
    expect(body.error).toContain("SHEET_NET_NAME_COLLISION");
    expect(reads.parts).toBe(before);
  });

  it("a structural error (a dangling sheetId): the canonical pre-check's 422 SCHEMATIC_STATE_INVALID names the SHEETS diagnostic", async () => {
    const before = reads.parts;
    const state = stageFixture();
    state.kicadComponents![2] = { ...state.kicadComponents![2]!, sheetId: "nowhere" };
    const response = await post(state, "stage");
    expect(response.status).toBe(422);
    const body = await response.json() as { code: string; issues: string[] };
    expect(body.code).toBe("SCHEMATIC_STATE_INVALID");
    expect(body.issues.some((issue) => issue.startsWith("SHEETS: SHEET_REFERENCE_INVALID"))).toBe(true);
    expect(reads.parts).toBe(before);
  });

  it("a valid three-sheet project with global labels exports (the refusals are the exception, not the rule)", async () => {
    const response = await post(globalFixture(), "global");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(Object.keys((await JSZip.loadAsync(await response.arrayBuffer())).files)).toHaveLength(3);
  });
});

describe("[PR-J4 J4-B] 4. the route's source: no pending answer, no new method", () => {
  it("EXPORT_HIERARCHY_PENDING is no longer answered by the route; POST stays its only handler export", () => {
    const source = readFileSync("app/api/export/kicad/route.ts", "utf8");
    expect(source).not.toMatch(/code: "EXPORT_HIERARCHY_PENDING"/);
    expect(source).toContain("refuseKicadHierarchy(state)");
    expect(source).toContain("zipKicadHierarchy(exported.files)");
    expect(source.match(/^export const (GET|POST|PUT|PATCH|DELETE)\b/gm)).toEqual(["export const POST"]);
  });
});
