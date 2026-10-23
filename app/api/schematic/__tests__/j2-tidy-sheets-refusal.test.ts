/**
 * [PR-J, 2026-10-22] Runbook section J increment 2 (OD-255 item 6): Tidy (POST /api/schematic/layout-critic) re-lays the WHOLE
 * schematic out as one page from its logical netlist, so a project organised into sheets would come back flattened. Until per-sheet
 * tidy exists the route refuses such a project with 422 SHEETS_TIDY_PENDING BEFORE any part read or model call (nothing sent, nothing
 * billed, nothing changed); a project without sheets is tidied exactly as before. Fake router and parts search (vi.mock), no credits.
 * [PR-J4, 2026-10-23] Pin move (OD-258 item 5): per-sheet tidy exists (app/lib/schematic/sheet-tidy.ts; j4-tidy-sheet.test.ts) - a
 * project with sheets is tidied one named leaf sheet at a time, so the refusal of a sheeted body WITHOUT a sheet is now
 * SHEETS_TIDY_SHEET_REQUIRED, still before any part read or model call; the single-sheet and broken-structure cases are unchanged.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/parts-search", () => ({
  getPartsByIds: vi.fn(async () => []),
  getFullPartsByIds: vi.fn(async () => []),
  searchParts: vi.fn(async () => []),
}));
// [PR-J1 integration, 2026-10-22] J1-CONS-7: a configured second-opinion endpoint (a fake: nothing is called) for cross-verify
const schgen = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("@/app/lib/schgen/endpoint-client", () => ({ schgenEndpointFromEnv: () => ({ url: "https://schgen.invalid/v1" }), callSchGenEndpoint: schgen.call, SCHGEN_FAILURE_SENTENCES: {} }));
import { llmRouter } from "@/app/lib/llm/router";
import { getFullPartsByIds } from "@/app/lib/parts-search";
import { POST as layoutCriticPost } from "../layout-critic/route";
import { POST as crossVerifyPost } from "../cross-verify/route";

const generate = vi.mocked(llmRouter.generate);
const partsRead = vi.mocked(getFullPartsByIds);
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-j2", "x-sirkit-branch-id": "main" };
const jsonReq = (body: unknown): Request => new Request("http://localhost/api/schematic/layout-critic", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
afterEach(() => { resetInjectedIdentity(); generate.mockReset(); partsRead.mockClear(); });

const flat = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", refDes: "R1", x: 0, y: 0, rotation: 0, value: "1k" }, { id: "c2", partId: "p1", refDes: "R2", x: 200, y: 0, rotation: 0, value: "1k", sheetId: "s1" }] };
const sheeted = { ...flat, sheets: { version: 1, sheets: [{ id: "root", name: "Overview", parentId: null }, { id: "s1", name: "Stage 2", parentId: "root" }] } };

describe("[PR-J J2] Tidy refuses a project organised into sheets instead of flattening it", () => {
  it("a project with sheets and no sheet named: 422 SHEETS_TIDY_SHEET_REQUIRED, no part read, no model call ([PR-J4, 2026-10-23] pin move: was SHEETS_TIDY_PENDING for every sheeted body)", async () => {
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-j2", role: "editor" });
    const res = await layoutCriticPost(jsonReq({ state: sheeted, image: "data:image/png;base64,aGk=", provider: "anthropic" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, code: "SHEETS_TIDY_SHEET_REQUIRED", error: "Tidy re-lays out ONE sheet of a project organised into sheets; the request names no sheet (open the sheet to tidy and try again). Nothing was sent and nothing changed." });
    expect(generate).not.toHaveBeenCalled();
    expect(partsRead).not.toHaveBeenCalled();
  });

  it("a project without sheets is tidied as before (one model call)", async () => {
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-j2", role: "editor" });
    generate.mockResolvedValue({ provider: "anthropic", model: "m", text: "", toolCalls: [{ id: "t", name: "report_layout_issues", input: { groups: [], summary: "s" } }] });
    const { sheetId: _dropped, ...secondOnRoot } = flat.kicadComponents[1]!;
    void _dropped;
    const res = await layoutCriticPost(jsonReq({ state: { ...flat, kicadComponents: [flat.kicadComponents[0], secondOnRoot] }, image: "data:image/png;base64,aGk=", provider: "anthropic" }));
    expect(res.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

// ── [PR-J1 integration, 2026-10-22] review J1-CONS-7: a broken sheet structure is a structured refusal, before any read or call ──

const routeReq = (route: string, body: unknown): Request => new Request(`http://localhost/api/schematic/${route}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
/** Sheet references without their tree: the canonical sheet contract refuses it (SHEET_REFERENCE_INVALID). */
const orphaned = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", refDes: "R1", x: 0, y: 0, rotation: 0, value: "1k" }, { id: "c2", partId: "p1", refDes: "R2", x: 200, y: 0, rotation: 0, value: "1k", sheetId: "s1" }] };
/** A hierarchical label that names a port that does not exist (SHEET_PIN_PORT_MISSING). */
const missingPort = { ...sheeted, netLabels: [{ id: "h1", position: { x: 0, y: 0 }, name: "X", kind: "label", orientation: 0, sheetId: "s1", scope: "hierarchical", portId: "nope" }] };
/** A valid tree whose overview has a global and a local net both named X (SHEET_NET_NAME_COLLISION). */
const collision = { ...sheeted, netLabels: [{ id: "g", position: { x: 0, y: 0 }, name: "X", kind: "label", orientation: 0, scope: "global" }, { id: "l", position: { x: 500, y: 500 }, name: "X", kind: "label", orientation: 0 }] };

describe("[PR-J1 integration, 2026-10-22] J1-CONS-7: Tidy and the second opinion refuse an invalid sheet structure with 422 SHEET_HIERARCHY_INVALID", () => {
  it("Tidy: a document carrying sheet references without its tree is refused before the part read and the model call", async () => {
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-j2", role: "editor" });
    const res = await layoutCriticPost(jsonReq({ state: orphaned, image: "data:image/png;base64,aGk=", provider: "anthropic" }));
    expect(res.status).toBe(422);
    const body = await res.json() as { ok: boolean; code: string; error: string };
    expect([body.ok, body.code]).toEqual([false, "SHEET_HIERARCHY_INVALID"]);
    expect(body.error).toContain("SHEET_REFERENCE_INVALID");
    expect(generate).not.toHaveBeenCalled();
    expect(partsRead).not.toHaveBeenCalled();
  });

  it.each([["a missing port", missingPort, "SHEET_PIN_PORT_MISSING"], ["a net-name collision", collision, "SHEET_NET_NAME_COLLISION"]] as const)("cross-verify: %s is refused before the part read and the second-opinion call (never a 500)", async (_label, state, code) => {
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-j2", role: "editor" });
    const res = await crossVerifyPost(routeReq("cross-verify", { prompt: "an LED blinker", state }));
    expect(res.status).toBe(422);
    const body = await res.json() as { ok: boolean; code: string; error: string };
    expect([body.ok, body.code]).toEqual([false, "SHEET_HIERARCHY_INVALID"]);
    expect(body.error).toContain(code);
    expect(partsRead).not.toHaveBeenCalled();
    expect(schgen.call).not.toHaveBeenCalled();
  });
});
