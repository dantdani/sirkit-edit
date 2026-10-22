/**
 * [PR-J, 2026-10-22] Runbook section J increment 2 (OD-255 item 6): Tidy (POST /api/schematic/layout-critic) re-lays the WHOLE
 * schematic out as one page from its logical netlist, so a project organised into sheets would come back flattened. Until per-sheet
 * tidy exists the route refuses such a project with 422 SHEETS_TIDY_PENDING BEFORE any part read or model call (nothing sent, nothing
 * billed, nothing changed); a project without sheets is tidied exactly as before. Fake router and parts search (vi.mock), no credits.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn() } }));
vi.mock("@/app/lib/parts-search", () => ({
  getPartsByIds: vi.fn(async () => []),
  getFullPartsByIds: vi.fn(async () => []),
  searchParts: vi.fn(async () => []),
}));
import { llmRouter } from "@/app/lib/llm/router";
import { getFullPartsByIds } from "@/app/lib/parts-search";
import { POST as layoutCriticPost } from "../layout-critic/route";

const generate = vi.mocked(llmRouter.generate);
const partsRead = vi.mocked(getFullPartsByIds);
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-j2", "x-sirkit-branch-id": "main" };
const jsonReq = (body: unknown): Request => new Request("http://localhost/api/schematic/layout-critic", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
afterEach(() => { resetInjectedIdentity(); generate.mockReset(); partsRead.mockClear(); });

const flat = { components: [], wires: [], kicadComponents: [{ id: "c1", partId: "p1", refDes: "R1", x: 0, y: 0, rotation: 0, value: "1k" }, { id: "c2", partId: "p1", refDes: "R2", x: 200, y: 0, rotation: 0, value: "1k", sheetId: "s1" }] };
const sheeted = { ...flat, sheets: { version: 1, sheets: [{ id: "root", name: "Overview", parentId: null }, { id: "s1", name: "Stage 2", parentId: "root" }] } };

describe("[PR-J J2] Tidy refuses a project organised into sheets instead of flattening it", () => {
  it("a project with sheets: 422 SHEETS_TIDY_PENDING, no part read, no model call", async () => {
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-j2", role: "editor" });
    const res = await layoutCriticPost(jsonReq({ state: sheeted, image: "data:image/png;base64,aGk=", provider: "anthropic" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, code: "SHEETS_TIDY_PENDING", error: "Tidy re-lays the whole schematic out as one page, so it is not available for a project organised into sheets yet. Nothing was sent and nothing changed." });
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
