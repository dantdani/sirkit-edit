/**
 * [B22-A1] OD-150, the approval half - every SPICE AI operation whose strings reach an ngspice deck (a test's name, overlay
 * elements, variables, analyses, sweeps, corners, model bindings, solver options) and the run request is "review": the
 * studio never pre-selects it, so a human selects each before Apply. An operation that never reaches a deck (a measurement,
 * a specification) stays "automatic"; a production design patch stays "explicit". One table decides the levels for the
 * route and the studio. The evidence half of OD-150 (D22-21) is not here.
 *
 * Test-first: run RED on the unmodified tree 0432fb8 (app/api/spice/ai/route.ts:68-72 labelled create-test and every
 * overlay "automatic", :206 a variable without a distribution, :228 the run request; SpiceStudio.tsx:461 pre-selected
 * every "automatic" entry, so one Apply ran a model-written overlay, variable and run request).
 *
 * No provider is called: the LLM router is a scripted in-process fake (zero credits); no run starts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const generate = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate } }));

import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST as aiPost } from "@/app/api/spice/ai/route";
import { importModelText } from "@/app/lib/spice/models";
import { createSimulationProject } from "@/app/lib/spice/project";
import { __resetJobStoreForTests, getRuns } from "@/app/lib/spice/server/job-store";
import type { AiStudioOperation, AiStudioProposal, ApprovalLevel } from "@/app/lib/spice/types";
import { dividerSchematic } from "@/app/lib/spice/__tests__/fixtures";

const SELECTOR = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-b22a1", "x-sirkit-branch-id": "main" };
const SCOPE = { tenantId: "local", projectId: "proj-b22a1", branchId: "main" };
function post(body: unknown): Request {
  injectAuthorizedPrincipal({ userId: "u-b22a1", tenantId: "local", projectId: "proj-b22a1", role: "editor" });
  return new Request("http://localhost/api/spice/ai", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SELECTOR }, body: JSON.stringify(body) });
}
function seedProject() {
  const project = createSimulationProject(dividerSchematic());
  project.tests[0]!.analyses = [{ id: "op", name: "Operating point", type: "op", enabled: true }];
  const model = importModelText("dtest.lib", ".model DTEST D(IS=1e-14)\n").candidate;
  model.id = "model-dtest";
  project.modelAssets.push(model);
  return project;
}
const llmResponse = (name: string, input: unknown) => ({ provider: "openai", model: "test-model", text: "", toolCalls: [{ id: `t-${name}`, name, input }] });
const SUBMIT = { summary: "s", rationale: "r", confidence: 0.5, assumptions: [] };

/** One AI exchange: the scripted tool calls, then submit_proposal; the proposal's [op, level] pairs. */
async function levels(project: ReturnType<typeof seedProject>, calls: Array<[string, Record<string, unknown>]>): Promise<Array<[AiStudioOperation["op"], ApprovalLevel]>> {
  for (const [name, input] of calls) generate.mockResolvedValueOnce(llmResponse(name, input));
  generate.mockResolvedValueOnce(llmResponse("submit_proposal", SUBMIT));
  const res = await aiPost(post({ instruction: "set it up", project, testId: project.tests[0]!.id }));
  const body = await res.json() as { ok?: boolean; proposal?: AiStudioProposal; error?: string };
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body.proposal!.operations.map((entry) => [entry.operation.op, entry.approval]);
}

/** Every operation kind (types.ts AiStudioOperation) with the level OD-150 gives it, and why. */
const EXPECTED: ReadonlyArray<readonly [AiStudioOperation["op"], ApprovalLevel]> = [
  ["create-test", "review"],
  ["duplicate-test", "review"],
  ["assign-model", "review"],
  ["add-overlay-element", "review"],
  ["set-variable", "review"],
  ["configure-analysis", "review"],
  ["configure-sweep", "review"],
  ["configure-corners", "review"],
  ["set-solver-profile", "review"],
  ["request-run", "review"],
  ["define-measurement", "automatic"],
  ["define-specification", "automatic"],
  ["propose-design-patch", "explicit"],
];

afterEach(() => {
  generate.mockReset();
  __resetJobStoreForTests();
  resetInjectedIdentity();
});

describe("[B22-A1] POST /api/spice/ai labels every deck-reaching operation and the run request \"review\" (OD-150)", () => {
  const TEST = "test_id";
  const project = seedProject();
  const testId = project.tests[0]!.id;
  const planId = project.runPlans[0]!.id;
  const overlay = (kind: string, extra: Record<string, unknown>) => ["add_overlay_element", { [TEST]: testId, kind, name: `OV-${kind}`, rationale: "r", ...extra }] as [string, Record<string, unknown>];

  it.each<[string, Array<[string, Record<string, unknown>]>, Array<[AiStudioOperation["op"], ApprovalLevel]>]>([
    ["create_test (its name is the deck title)", [["create_test", { name: "Ripple" }]], [["create-test", "review"]]],
    ["add_overlay_element, a voltage source with a waveform", [overlay("voltage-source", { positive_net: "VIN", negative_net: "GND", value: "0", waveform: "PULSE(0 5 0 1n 1n 5u 10u)" })], [["add-overlay-element", "review"]]],
    ["add_overlay_element, a load", [overlay("resistive-load", { positive_net: "VIN", negative_net: "GND", value: "1k" })], [["add-overlay-element", "review"]]],
    ["add_overlay_element, a probe", [overlay("probe", { target_net: "VIN", quantity: "voltage" })], [["add-overlay-element", "review"]]],
    ["add_overlay_element, an initial condition", [overlay("initial-condition", { target_net: "VIN", value: "0" })], [["add-overlay-element", "review"]]],
    ["add_overlay_element, a fault", [overlay("fault", { target_net: "VIN", fault: "short", value: "1m" })], [["add-overlay-element", "review"]]],
    ["set_design_variable without a distribution", [["set_design_variable", { [TEST]: testId, name: "RLOAD", value: "1k", unit: "ohm" }]], [["set-variable", "review"]]],
    ["set_design_variable with a distribution", [["set_design_variable", { [TEST]: testId, name: "RLOAD", value: "1k", unit: "ohm", distribution: { kind: "uniform", tolerance: 0.1 } }]], [["set-variable", "review"]]],
    ["configure_analysis", [["configure_analysis", { [TEST]: testId, name: "Tran", type: "tran", output_step: "1u", stop_time: "1m", rationale: "r" }]], [["configure-analysis", "review"]]],
    ["configure_sweep", [["configure_sweep", { [TEST]: testId, name: "Load", variable: "RLOAD", kind: "list", values: ["1k", "2k"] }]], [["configure-sweep", "review"]]],
    ["configure_corner_set", [["configure_corner_set", { [TEST]: testId, name: "Temps", corners: [{ name: "Hot", values: {}, temperature_c: 85 }] }]], [["configure-corners", "review"]]],
    ["assign_model", [["assign_model", { component_id: "R1", model_id: "model-dtest", pin_map: { "1": "1" }, confidence: 0.9, rationale: "r" }]], [["assign-model", "review"]]],
    ["run_simulation (the run request)", [["run_simulation", { run_plan_id: planId, rationale: "verify" }]], [["request-run", "review"]]],
    ["define_measurement and define_specification (never written to a deck)", [["define_measurement", { [TEST]: testId, name: "vmax", operator: "max", expression: "v(VIN)" }], ["define_specification", { [TEST]: testId, name: "vmax limit", measurement_name: "vmax", comparison: "<", limit: 6, unit: "V", severity: "error" }]], [["define-measurement", "automatic"], ["define-specification", "automatic"]]],
    ["propose_design_patch (explicit confirmation)", [["propose_design_patch", { description: "lower R1", changes: [] }]], [["propose-design-patch", "explicit"]]],
  ])("%s", async (_label, calls, expected) => {
    expect(await levels(project, calls)).toEqual(expected);
    expect(getRuns(SCOPE), "proposal-only: nothing ran").toEqual([]);
  });
});

describe("[B22-A1] one table decides the levels, and the studio never pre-selects a deck-reaching operation", () => {
  it("the table lists every operation kind with its level", async () => {
    const approval = await import("@/app/lib/spice/ai-approval");
    expect(Object.entries(approval.SPICE_AI_APPROVAL).sort()).toEqual([...EXPECTED].map(([op, level]) => [op, level]).sort());
    expect(Object.isFrozen(approval.SPICE_AI_APPROVAL)).toBe(true);
  });

  it("only an entry whose recorded level AND kind are both automatic is pre-selected - a forged \"automatic\" on a deck-reaching operation or a run request is not", async () => {
    const approval = await import("@/app/lib/spice/ai-approval");
    const proposal = {
      operations: [
        { approval: "automatic", operation: { op: "define-measurement" } },
        { approval: "automatic", operation: { op: "request-run", runPlanId: "plan" } },
        { approval: "review", operation: { op: "add-overlay-element" } },
        { approval: "explicit", operation: { op: "propose-design-patch" } },
        { approval: "automatic", operation: { op: "add-overlay-element" } },
        { approval: "automatic", operation: { op: "not-an-operation" } },
        { approval: "automatic", operation: { op: "define-specification" } },
        // [B22-A1 review] tests-7: an automatic kind whose recorded level is not "automatic" is not pre-selected either (the AND)
        { approval: "review", operation: { op: "define-measurement" } },
        { approval: "explicit", operation: { op: "define-specification" } },
      ],
    } as unknown as Pick<AiStudioProposal, "operations">;
    expect(approval.preselectedOperationIndexes(proposal)).toEqual([0, 6]);
  });

  it("the studio pre-selects through that function (SpiceStudio.tsx), never by the recorded level alone", () => {
    const studio = readFileSync(join(process.cwd(), "app/components/spice/SpiceStudio.tsx"), "utf8");
    expect(studio).toContain("setApprovedOps(new Set(preselectedOperationIndexes(data.proposal)));");
    expect(studio).not.toMatch(/entry\.approval === "automatic" \? index/);
    // [B22-A1 review] tests-7: the studio's ONE pre-selection, the line right after it records the proposal - no second call
    // (a human's checkbox goes through the drawer's own `setApproved`)
    const calls = [...studio.matchAll(/setApprovedOps\(/g)].length;
    expect(calls, "setApprovedOps( calls in SpiceStudio.tsx").toBe(1);
    expect(studio).toMatch(/if \(data\.proposal\) \{\s*setProposal\(data\.proposal\);\s*setApprovedOps\(new Set\(preselectedOperationIndexes\(data\.proposal\)\)\);/);
  });
});
