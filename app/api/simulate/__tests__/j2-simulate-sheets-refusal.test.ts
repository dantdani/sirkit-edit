/**
 * [PR-J1 integration, 2026-10-22] Review J1-CONS-7: /api/simulate's refusal of a project organised into sheets is STRUCTURED, like the
 * export's EXPORT_HIERARCHY_PENDING and Tidy's SHEETS_TIDY_PENDING: the answer carries a `code` (status 400). A document that carries
 * sheet references without its tree is refused the same way instead of being simulated as one flat circuit.
 *
 * [PR-J4, 2026-10-23] Pin move (runbook J.5; OD-258 item 1): SIM_MULTI_SHEET_PENDING is RETIRED. A project organised into sheets is
 * simulated on the project connectivity: 200 with a deck whose nodes are named from the project's nets, a `warnings` array (separate
 * returns, a renamed ground, plain GND labels) and probe keys per sheet (bare "x,y" on the probe sheet - the root unless the body's
 * `probeSheetId` names another - "<sheetId>|x,y" elsewhere). A document carrying sheet references without its tree, or with a
 * structural error, is refused SIM_SHEET_HIERARCHY_INVALID (400, structured); several ground rails with none named GND refuse
 * SIM_GROUND_AMBIGUOUS. A single-sheet body's response is byte-identical to before (no `warnings` key; `probeSheetId` ignored).
 * The diagnostic runner is a fake: the refusals never reach it; the success cases hand back a completed run with a two-point ASCII raw
 * (nothing is spawned, nothing is billed).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const RAW = ["Plotname: Transient Analysis", "Flags: real", "No. Variables: 2", "Variables:", " 0 time time", " 1 v(n001) voltage", "Values:", "0 0 1.0", "1 1e-3 2.0", ""].join("\n");
const runner = vi.hoisted(() => ({ run: vi.fn(async (input: { deck: string }): Promise<unknown> => { throw new Error(`the runner must not be reached (it was handed a ${input.deck.length}-byte deck)`); }) }));
vi.mock("@/app/lib/computation/diagnostic-runner", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/app/lib/computation/diagnostic-runner")>()), runDiagnosticNgspice: runner.run }));

import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { DIAGNOSTIC_RESULT_LABELS, DIAGNOSTIC_RUNNER_PROFILE_ID, type DiagnosticRunRecord } from "@/app/lib/computation/diagnostic-runner";
import { SIM_GROUND_AMBIGUOUS, SIM_SHEET_HIERARCHY_INVALID } from "@/app/lib/netlist";
import { POST as simulatePost } from "../route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "local", "x-sirkit-branch-id": "local" };
const simulateReq = (body: unknown): Request => new Request("http://localhost/api/simulate", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
afterEach(() => { resetInjectedIdentity(); runner.run.mockClear(); });

/** A completed diagnostic run whose raw file holds two points (the fake never spawns). */
const completed = (): DiagnosticRunRecord => ({
  runId: "j4-fake", profileId: DIAGNOSTIC_RUNNER_PROFILE_ID, profileDigest: "fake", installDigest: null, labels: DIAGNOSTIC_RESULT_LABELS, operation: "run",
  outcome: "exited", spawned: true, killReason: null, exitCode: 0, stdout: "", stderr: "", raw: { state: "read", text: RAW }, wallClockMs: 10_000, hostAddedEnvironment: [],
});
const editor = (): void => { injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "local", role: "editor" }); };

/** V1 + ground symbol + R1 on the overview; R9 on sheet "sa" at R1's coordinates (unconnected). */
const circuit = (withTree: boolean) => ({
  components: [
    { id: "V1", type: "voltage-source", x: 100, y: 200, rotation: 0, value: "5" },
    { id: "G1", type: "ground", x: 100, y: 260, rotation: 0, value: "" },
    { id: "R1", type: "resistor", x: 200, y: 170, rotation: 0, value: "1k" },
    { id: "R9", type: "resistor", x: 200, y: 170, rotation: 0, value: "2k", sheetId: "sa" },
  ],
  wires: [{ id: "w1", vertices: [{ x: 100, y: 170 }, { x: 170, y: 170 }] }, { id: "w2", vertices: [{ x: 100, y: 230 }, { x: 100, y: 240 }] }],
  netLabels: [] as Array<Record<string, unknown>>,
  ...(withTree ? { sheets: { version: 1, sheets: [{ id: "root", name: "Overview", parentId: null }, { id: "sa", name: "A", parentId: "root" }] } } : {}),
});
/** The same circuit with every entity on the overview (no sheet reference anywhere). */
const flat = () => { const state = circuit(false); state.components = state.components.filter((item) => item.id !== "R9"); return state; };

describe("[PR-J4, 2026-10-23] /api/simulate simulates a project organised into sheets on the project connectivity (pin move from SIM_MULTI_SHEET_PENDING)", () => {
  it("a project organised into sheets: 200 with a deck named from project nets, `warnings`, per-sheet probe keys; the runner ran that deck", async () => {
    editor();
    runner.run.mockImplementationOnce(async () => completed());
    const res = await simulatePost(simulateReq({ state: circuit(true) }));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.ok).toBe(true);
    expect(body.netlist).toMatch(/^V1 N\d{3} 0 DC 5 AC 1$/m);
    expect(body.netlist).toMatch(/^R1 N\d{3} N\d{3} 1k$/m);
    expect(body.netlist).toMatch(/^R9 N\d{3} N\d{3} 2k$/m);
    expect(body.netlist).toContain("* Project connectivity: 2 sheets; nodes named from project nets");
    expect(body.warnings).toEqual([]);
    const pinNodes = body.pinNodes as Record<string, string>;
    expect(pinNodes["170,170"]).toBeDefined(); // R1.left on the overview, bare
    expect(pinNodes["sa|170,170"]).toBeDefined(); // R9.left on sheet A, scoped: same coordinates, another node
    expect(pinNodes["sa|170,170"]).not.toBe(pinNodes["170,170"]);
    expect(pinNodes["100,240"]).toBe("0");
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run.mock.calls[0]![0].deck).toContain("R9 ");
    expect(Object.keys(body)).toEqual(["ok", "analysis", "analysisType", "variables", "points", "netlist", "nodeMap", "pinNodes", "warnings", "runner"]);
  });

  it("`probeSheetId` makes that sheet's points bare and the overview's scoped (the editor's active-sheet probes need no page change)", async () => {
    editor();
    runner.run.mockImplementationOnce(async () => completed());
    const res = await simulatePost(simulateReq({ state: circuit(true), probeSheetId: "sa" }));
    expect(res.status).toBe(200);
    const pinNodes = (await res.json() as { pinNodes: Record<string, string> }).pinNodes;
    expect(pinNodes["170,170"]).toBeDefined(); // now R9.left
    expect(pinNodes["root|170,170"]).toBeDefined(); // R1.left, scoped
    expect(pinNodes["root|100,240"]).toBe("0");
    expect(pinNodes["sa|170,170"]).toBeUndefined();
  });

  it.each([["carrying sheet references without its tree", circuit(false)], ["with a dangling sheet reference", { ...circuit(true), components: circuit(true).components.map((item) => (item.id === "R9" ? { ...item, sheetId: "ghost" } : item)) }]] as const)(
    "a project %s: 400 with code SIM_SHEET_HIERARCHY_INVALID; the runner is never reached", async (_label, state) => {
      editor();
      const res = await simulatePost(simulateReq({ state }));
      expect(res.status).toBe(400);
      const body = await res.json() as { code: string; error: string };
      expect(body.code).toBe(SIM_SHEET_HIERARCHY_INVALID);
      expect(body.error).toMatch(new RegExp(`^Netlist generation failed: ${SIM_SHEET_HIERARCHY_INVALID}: the sheet structure of this project has \\d+ error\\(s\\): `));
      expect(body.error).toMatch(/nothing was simulated$/);
      expect(Object.keys(body)).toEqual(["code", "error"]);
      expect(runner.run).not.toHaveBeenCalled();
    },
  );

  it("several ground rails with none named GND: 400 with code SIM_GROUND_AMBIGUOUS naming them; the runner is never reached", async () => {
    editor();
    const state = circuit(true);
    state.components = state.components.filter((item) => item.id !== "G1");
    state.netLabels = [
      { id: "l-agnd", position: { x: 100, y: 230 }, name: "AGND", kind: "ground", orientation: 0 },
      { id: "l-dgnd", position: { x: 170, y: 170 }, name: "DGND", kind: "ground", orientation: 0, sheetId: "sa" },
    ];
    const res = await simulatePost(simulateReq({ state }));
    expect(res.status).toBe(400);
    const body = await res.json() as { code: string; error: string };
    expect(body.code).toBe(SIM_GROUND_AMBIGUOUS);
    expect(body.error).toContain('AGND on the overview; DGND on sheet "A"');
    expect(runner.run).not.toHaveBeenCalled();
  });

  it("a single-sheet body's response is unchanged: no `warnings` key, bare keys, and a stray probeSheetId is ignored", async () => {
    editor();
    runner.run.mockImplementation(async () => completed());
    const plain = await simulatePost(simulateReq({ state: flat() }));
    expect(plain.status).toBe(200);
    const body = await plain.json() as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["ok", "analysis", "analysisType", "variables", "points", "netlist", "nodeMap", "pinNodes", "runner"]);
    expect("warnings" in body).toBe(false);
    expect(body.netlist).toContain("V1 N001 0 DC 5 AC 1");
    const stray = await simulatePost(simulateReq({ state: flat(), probeSheetId: "sa" }));
    const strayBody = await stray.json() as Record<string, unknown>;
    expect(strayBody.pinNodes).toEqual(body.pinNodes);
    expect("warnings" in strayBody).toBe(false);
    expect(runner.run).toHaveBeenCalledTimes(2);
  });
});
