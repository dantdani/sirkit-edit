// @vitest-environment jsdom
/**
 * [PR-C] The Theory client's request contract (fault F-01): `lib/apply-netlist.ts::generateSchematic` prepares its request
 * through the shared `app/lib/project/ai-request.ts` — the project selector the canonical wrapper requires, the JSON
 * content type, and the lifecycle signal — and treats an answer that is not a netlist as invalid local output, never as a
 * circuit to lay out. The selector is never authority: the server still loads membership for that scope ([PR-A 1] pins
 * the server-side refusal of a selector-less request).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { aiRequestHeaders } from "../ai-request";
import { generateSchematic } from "@/lib/apply-netlist";

afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

const netlist = { components: [{ id: "R1", type: "resistor", value: "1k" }, { id: "GND1", type: "ground", value: "" }], connections: [{ from: "R1.2", to: "GND1.1" }], explanation: "one resistor to ground" };

describe("the shared AI request preparation", () => {
  it("names the active project as a selector beside the JSON content type, and nothing while no project exists", () => {
    expect(aiRequestHeaders({ projectId: "project-a", branchId: "main" })).toEqual({ "Content-Type": "application/json", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "project-a", "x-sirkit-branch-id": "main" });
    expect(aiRequestHeaders({ projectId: null, branchId: "main" })).toEqual({ "Content-Type": "application/json" });
  });
});

describe("the Theory client", () => {
  it("sends the selector headers and the lifecycle signal, and lays out a netlist answer", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify(netlist), { status: 200, headers: { "Content-Type": "application/json" } }); }));
    const controller = new AbortController();
    const result = await generateSchematic("make a schematic for a 555 LED blinker", { scope: { projectId: "project-a", branchId: "main" }, signal: controller.signal });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/schematic");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "Content-Type": "application/json", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "project-a", "x-sirkit-branch-id": "main" });
    expect(calls[0].init.signal).toBe(controller.signal);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ prompt: "make a schematic for a 555 LED blinker" });
    expect(result.state.components.length).toBeGreaterThan(0);
  });

  it("an answer that is not a netlist is invalid local output: nothing is laid out", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ _raw: "I cannot do that" }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(generateSchematic("x", { scope: { projectId: "project-a", branchId: "main" } })).rejects.toThrow(/not a schematic netlist/);
  });

  it("the server's selector refusal surfaces as the request error, with no layout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, code: "AUTH_PROJECT_SELECTOR_REQUIRED", error: "A project selector is required." }), { status: 400, headers: { "Content-Type": "application/json" } })));
    await expect(generateSchematic("x", { scope: { projectId: null, branchId: "main" } })).rejects.toThrow("A project selector is required.");
  });
});
