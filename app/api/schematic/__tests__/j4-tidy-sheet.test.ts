/**
 * [PR-J4, 2026-10-23] Runbook section J increment 4 (J.3 item 5; OD-258 item 5): POST /api/schematic/layout-critic tidies ONE leaf sheet of
 * a project organised into sheets (the j2 SHEETS_TIDY_PENDING refusal retired; j2-tidy-sheets-refusal keeps the no-sheet, single-sheet and
 * broken-structure cases).
 *
 *  1. the frozen drone with sheetId = IMU: ONE model call whose manifest lists only the IMU's five parts (U3, R11, R12, C9, C10) and whose
 *     `<schematic_state>` context holds the IMU's entities with the sheet tree ([PR-J4 integration, 2026-10-23] review C-TIDY-3), the part
 *     read covers EVERY project part (review C-TIDY-1: the proof needs every pin; was the IMU's parts only), the answer carries `sheetId`,
 *     and the returned WHOLE-project state keeps every one of the 41 instance ids and authority fields, every other sheet byte-identical,
 *     the IMU port anchors their id / scope / port, and the project connectivity's partition digest (applied or kept, the state the page
 *     adopts is proven);
 *  2. a sheeted body without a sheet: 422 SHEETS_TIDY_SHEET_REQUIRED; an unknown sheet: 422 SHEETS_TIDY_SHEET_UNKNOWN; the overview (child
 *     blocks): 422 SHEETS_TIDY_BLOCKS_PENDING; a sheet holding a Theory symbol: 422 SHEETS_TIDY_THEORY_PENDING (review C-TIDY-4) - each
 *     before any part read or model call; a part whose catalog record is missing: 422 SHEETS_TIDY_PARTS_UNRESOLVED after the one part read
 *     and BEFORE the model call (review C-TIDY-2: was answered after the billed call);
 *  2b. [PR-J4 integration, 2026-10-23] review C-TIDY-1: the overview's local label on the I2C_SCL port net renamed by the user, then Tidy
 *     IMU: the proof (over every part) refuses 422 SHEETS_TIDY_NOT_EQUIVALENT after the one model call, the message does not claim nothing
 *     was sent, and no state is returned (the page keeps its own);
 *  3. a single-sheet body is tidied exactly as before: the manifest lists all 41 parts and the answer carries no `sheetId` key.
 * Fake router and parts search (vi.mock): no credits, no database.
 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/parts-search", async () => {
  const { fixtureParts } = await import("@/app/lib/schematic/__tests__/_j1-fixtures");
  const parts = fixtureParts();
  return {
    getPartsByIds: vi.fn(async () => []),
    getFullPartsByIds: vi.fn(async (ids: string[]) => ids.map((id) => parts.get(id)).filter((part) => part !== undefined)),
    searchParts: vi.fn(async () => []),
  };
});
import { llmRouter } from "@/app/lib/llm/router";
import { getFullPartsByIds } from "@/app/lib/parts-search";
import { resolveProjectConnectivity } from "@/app/lib/schematic/project-connectivity";
import { droneFixtureState, fixturePartLookup, fixtureParts } from "@/app/lib/schematic/__tests__/_j1-fixtures";
import { J3_SHEETS, multiSheetDroneFixtureState } from "@/app/lib/schematic/__tests__/_j3-fixtures";
import type { SchematicState } from "@/lib/schematic-types";
import { POST as layoutCriticPost } from "../layout-critic/route";

const generate = vi.mocked(llmRouter.generate);
const partsRead = vi.mocked(getFullPartsByIds);
const lookup = fixturePartLookup();
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-j4", "x-sirkit-branch-id": "main" };
const jsonReq = (body: unknown): Request => new Request("http://localhost/api/schematic/layout-critic", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
const asEditor = (): void => { injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-j4", role: "editor" }); };
const critique = (groups: Array<{ refDes: string[]; reason: string; severity: string }>) => ({ provider: "anthropic" as const, model: "m", text: "", toolCalls: [{ id: "t", name: "report_layout_issues", input: { groups, summary: "s" } }] });
const sha = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const IMAGE = "data:image/png;base64,aGk=";
afterEach(() => { resetInjectedIdentity(); generate.mockReset(); partsRead.mockClear(); });

/** The manifest the route sent to the model (the JSON between its two sentences). */
function sentManifest(): Array<{ refDes: string }> {
  const request = generate.mock.calls[0]![0] as { messages: Array<{ content: Array<{ type: string; text?: string }> }> };
  const text = request.messages[0]!.content.find((part) => part.type === "text")!.text!;
  return JSON.parse(text.slice(text.indexOf("\n") + 1, text.indexOf("\n\nFlag"))) as Array<{ refDes: string }>;
}
const identity = (state: SchematicState) => state.kicadComponents!.map(({ x: _x, y: _y, rotation: _r, ...rest }) => { void _x; void _y; void _r; return rest; });
const offSheet = (state: SchematicState, sheetId: string) => ({ components: state.components.filter((item) => item.sheetId !== sheetId), kicadComponents: state.kicadComponents!.filter((item) => item.sheetId !== sheetId), wires: state.wires.filter((item) => item.sheetId !== sheetId), netLabels: state.netLabels!.filter((item) => item.sheetId !== sheetId), sheets: state.sheets });

describe("[PR-J4] Tidy on a project with sheets re-lays out the named leaf sheet and merges it back onto the whole project", () => {
  it("1. the IMU sheet: one model call over the IMU's manifest, the IMU's parts read, sheetId answered, the whole project returned with every identity and connection kept", async () => {
    asEditor();
    const fixture = multiSheetDroneFixtureState();
    generate.mockResolvedValue(critique([{ refDes: ["U3", "R11"], reason: "crowded", severity: "medium" }]) as never);
    const res = await layoutCriticPost(jsonReq({ state: fixture, image: IMAGE, provider: "anthropic", sheetId: "sheet-imu" }));
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; applied: boolean; sheetId: string; state: SchematicState; spreadRefDes: string[] };
    expect([body.ok, body.sheetId, body.spreadRefDes]).toEqual([true, "sheet-imu", ["U3", "R11"]]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(sentManifest().map((item) => item.refDes).sort()).toEqual([...J3_SHEETS[2].refs].sort());
    // [PR-J4 integration, 2026-10-23] review C-TIDY-3: the context the critic sees is the IMU's (its entities, the sheet tree kept), not the project's
    const sentState = (generate.mock.calls[0]![0] as { schematicState: SchematicState }).schematicState;
    expect(sentState.kicadComponents!.map((item) => item.refDes).sort()).toEqual([...J3_SHEETS[2].refs].sort());
    expect(sentState.sheets).toEqual(fixture.sheets);
    expect("sheetId" in sentState).toBe(false);
    expect(sentState.netLabels!.every((label) => label.sheetId === "sheet-imu")).toBe(true);
    // [PR-J4 integration, 2026-10-23] pin move, review C-TIDY-1: the part read covers EVERY project part (the proof needs every pin; was the IMU's part ids only)
    const projectPartIds = new Set(fixture.kicadComponents!.map((item) => item.partId));
    expect(projectPartIds.size).toBe(11);
    expect(partsRead).toHaveBeenCalledTimes(1);
    expect(new Set(partsRead.mock.calls[0]![0] as string[])).toEqual(projectPartIds);
    // the state the page adopts (applied or not) is the whole project with every identity and connection kept
    expect(body.state.kicadComponents).toHaveLength(41);
    expect(identity(body.state)).toEqual(identity(fixture));
    expect(sha(offSheet(body.state, "sheet-imu"))).toBe(sha(offSheet(fixture, "sheet-imu")));
    expect(body.state.sheets).toEqual(fixture.sheets);
    for (const before of fixture.netLabels!.filter((label) => label.sheetId === "sheet-imu" && label.scope === "hierarchical")) {
      const after = body.state.netLabels!.find((label) => label.id === before.id)!;
      expect([after.scope, after.portId, after.name]).toEqual([before.scope, before.portId, before.name]);
    }
    expect(resolveProjectConnectivity(body.state, lookup).partitionDigest).toBe(resolveProjectConnectivity(fixture, lookup).partitionDigest);
    if (body.applied) expect(body.state.kicadComponents!.some((item, index) => item.sheetId === "sheet-imu" && (item.x !== fixture.kicadComponents![index]!.x || item.y !== fixture.kicadComponents![index]!.y))).toBe(true);
    else expect(body.state).toEqual(fixture);
  });

  it("2. refusals before any read or call: no sheet (SHEETS_TIDY_SHEET_REQUIRED), an unknown sheet (SHEETS_TIDY_SHEET_UNKNOWN), the overview with blocks (SHEETS_TIDY_BLOCKS_PENDING)", async () => {
    const fixture = multiSheetDroneFixtureState();
    for (const [sheetId, code] of [[undefined, "SHEETS_TIDY_SHEET_REQUIRED"], ["sheet-nope", "SHEETS_TIDY_SHEET_UNKNOWN"], ["root", "SHEETS_TIDY_BLOCKS_PENDING"]] as const) {
      asEditor();
      const res = await layoutCriticPost(jsonReq({ state: fixture, image: IMAGE, provider: "anthropic", ...(sheetId === undefined ? {} : { sheetId }) }));
      expect(res.status, code).toBe(422);
      expect(res.headers.get("Cache-Control")).toBe("no-store");
      const body = await res.json() as { ok: boolean; code: string; error: string };
      expect([body.ok, body.code]).toEqual([false, code]);
      expect(body.error).toMatch(/Nothing was sent and nothing changed\.$/);
      expect(generate).not.toHaveBeenCalled();
      expect(partsRead).not.toHaveBeenCalled();
    }
  });

  it("[PR-J4 integration, 2026-10-23] 2 (C-TIDY-4): a sheet holding a Theory ground symbol: 422 SHEETS_TIDY_THEORY_PENDING naming it, before any read or call", async () => {
    asEditor();
    const fixture = multiSheetDroneFixtureState();
    const withGround: SchematicState = { ...fixture, components: [...fixture.components, { id: "j4-g-imu", type: "ground", x: 1000, y: 1000, rotation: 0, value: "", sheetId: "sheet-imu" }] };
    const res = await layoutCriticPost(jsonReq({ state: withGround, image: IMAGE, provider: "anthropic", sheetId: "sheet-imu" }));
    expect(res.status).toBe(422);
    const body = await res.json() as { ok: boolean; code: string; error: string };
    expect([body.ok, body.code]).toEqual([false, "SHEETS_TIDY_THEORY_PENDING"]);
    expect(body.error).toContain("holds 1 Theory symbol (ground)");
    expect(body.error).toMatch(/Nothing was sent and nothing changed\.$/);
    expect(generate).not.toHaveBeenCalled();
    expect(partsRead).not.toHaveBeenCalled();
  });

  it("[PR-J4 integration, 2026-10-23] 2 (C-TIDY-2): a part whose catalog record is missing: 422 SHEETS_TIDY_PARTS_UNRESOLVED after the one part read and BEFORE the model call", async () => {
    asEditor();
    const fixture = multiSheetDroneFixtureState();
    const u3 = fixture.kicadComponents!.find((item) => item.refDes === "U3")!;
    partsRead.mockImplementationOnce(async (ids: string[]) => { const parts = fixtureParts(); return ids.filter((id) => id !== u3.partId).map((id) => parts.get(id)).filter((part) => part !== undefined); });
    const res = await layoutCriticPost(jsonReq({ state: fixture, image: IMAGE, provider: "anthropic", sheetId: "sheet-imu" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json() as { ok: boolean; code: string; error: string };
    expect([body.ok, body.code]).toEqual([false, "SHEETS_TIDY_PARTS_UNRESOLVED"]);
    expect(body.error).toContain("U3");
    expect(body.error).toMatch(/Nothing was sent and nothing changed\.$/);
    expect(partsRead).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it("[PR-J4 integration, 2026-10-23] 2b (C-TIDY-1): the overview's local I2C_SCL label renamed SCL, then Tidy IMU: 422 SHEETS_TIDY_NOT_EQUIVALENT after the one call; no state returned; the message does not claim nothing was sent", async () => {
    asEditor();
    const fixture = multiSheetDroneFixtureState();
    const rootLabel = fixture.netLabels!.find((label) => label.sheetId === undefined && label.scope === undefined && label.name === "I2C_SCL")!;
    rootLabel.name = "SCL";
    expect(resolveProjectConnectivity(fixture, lookup).ok).toBe(true);
    generate.mockResolvedValue(critique([{ refDes: ["U3", "R11"], reason: "crowded", severity: "medium" }]) as never);
    const res = await layoutCriticPost(jsonReq({ state: fixture, image: IMAGE, provider: "anthropic", sheetId: "sheet-imu" }));
    expect(res.status).toBe(422);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json() as { ok: boolean; code: string; error: string; state?: unknown };
    expect([body.ok, body.code]).toEqual([false, "SHEETS_TIDY_NOT_EQUIVALENT"]);
    expect(body.error).not.toContain("Nothing was sent");
    expect("state" in body).toBe(false);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(partsRead).toHaveBeenCalledTimes(1);
  });

  it("3. a single-sheet body is tidied as before: the manifest lists all 41 parts and the answer carries no sheetId", async () => {
    asEditor();
    const flat = droneFixtureState();
    generate.mockResolvedValue(critique([]) as never);
    const res = await layoutCriticPost(jsonReq({ state: flat, image: IMAGE, provider: "anthropic" }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["applied", "critique", "ok", "spreadRefDes", "state", "validation"]);
    expect("sheetId" in body).toBe(false);
    expect(sentManifest()).toHaveLength(41);
    expect(body.state).toEqual(flat);
  });
});
