/**
 * [PR-J1 integration, 2026-10-22] Review J1-CONS-7: /api/simulate's refusal of a project organised into sheets is STRUCTURED, like the
 * export's EXPORT_HIERARCHY_PENDING and Tidy's SHEETS_TIDY_PENDING: the answer carries `code: "SIM_MULTI_SHEET_PENDING"` (status 400
 * as before, the text unchanged). A document that carries sheet references without its tree is refused the same way instead of being
 * simulated as one flat circuit. The diagnostic runner is a fake that must never be reached: nothing is spawned, nothing is billed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const runner = vi.hoisted(() => ({ run: vi.fn(async () => { throw new Error("the runner must not be reached"); }) }));
vi.mock("@/app/lib/computation/diagnostic-runner", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/app/lib/computation/diagnostic-runner")>()), runDiagnosticNgspice: runner.run }));

import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { SPICE_SHEETS_PENDING } from "@/app/lib/netlist";
import { POST as simulatePost } from "../route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "local", "x-sirkit-branch-id": "local" };
const simulateReq = (body: unknown): Request => new Request("http://localhost/api/simulate", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
afterEach(() => { resetInjectedIdentity(); runner.run.mockClear(); });

const circuit = (withTree: boolean) => ({
  components: [
    { id: "V1", type: "voltage-source", x: 100, y: 200, rotation: 0, value: "5" },
    { id: "G1", type: "ground", x: 100, y: 260, rotation: 0, value: "" },
    { id: "R1", type: "resistor", x: 200, y: 170, rotation: 0, value: "1k" },
    { id: "R9", type: "resistor", x: 200, y: 170, rotation: 0, value: "2k", sheetId: "sa" },
  ],
  wires: [{ id: "w1", vertices: [{ x: 100, y: 170 }, { x: 170, y: 170 }] }, { id: "w2", vertices: [{ x: 100, y: 230 }, { x: 100, y: 240 }] }],
  netLabels: [],
  ...(withTree ? { sheets: { version: 1, sheets: [{ id: "root", name: "Overview", parentId: null }, { id: "sa", name: "A", parentId: "root" }] } } : {}),
});

describe("[PR-J1 integration, 2026-10-22] /api/simulate answers a project with sheets with a structured SIM_MULTI_SHEET_PENDING", () => {
  it.each([["organised into sheets", true], ["carrying sheet references without its tree", false]] as const)("a project %s: 400 with code SIM_MULTI_SHEET_PENDING; the runner is never reached", async (_label, withTree) => {
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "local", role: "editor" });
    const res = await simulatePost(simulateReq({ state: circuit(withTree) }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ code: "SIM_MULTI_SHEET_PENDING", error: `Netlist generation failed: ${SPICE_SHEETS_PENDING}` });
    expect(runner.run).not.toHaveBeenCalled();
  });
});
