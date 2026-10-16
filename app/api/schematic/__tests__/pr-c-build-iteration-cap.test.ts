/**
 * [PR-C] The operator's iteration cap (`SIRKIT_BUILD_ITERATION_CAP`): a deployment or a bounded qualification run may LOWER the
 * per-loop iteration cap below `BUILD_BUDGET.iterationCap` (never raise it), so a live request's worst case is provable as
 * `cap × the per-turn output ceiling`. The route hands the effective cap to every loop and reports it in `budget.iterationCap`.
 * The real route runs; the planner, the loop, the part lookup and the ERC are mocked (no provider, no database).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { BUILD_BUDGET, BUILD_ITERATION_CAP_ENV, resolveBuildIterationCap } from "@/app/lib/schematic/build-result";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const generate = vi.fn();
const buildLoop = vi.fn();
vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: (...args: unknown[]) => generate(...args) } }));
vi.mock("@/app/lib/build-loop", () => ({ runBuildToolLoop: (...args: unknown[]) => buildLoop(...args) }));
vi.mock("@/app/lib/parts-search", () => ({ getPartsByIds: async () => [] }));
vi.mock("@/lib/erc", () => ({ runErc: () => ({ ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 }), formatErcFeedback: () => "" }));
vi.spyOn(console, "warn").mockImplementation(() => undefined);

async function build(): Promise<Record<string, unknown>> {
  const { POST } = await import("@/app/api/schematic/build-multi/route");
  const res = await POST(new Request("http://localhost/api/schematic/build-multi", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify({ prompt: "build a blinker", provider: "openai" }) }));
  return (await res.json()) as Record<string, unknown>;
}

beforeEach(() => {
  injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: "proj-1", role: "editor" });
  generate.mockResolvedValue({ provider: "openai", model: "fake", text: "", stopReason: "tool_use", toolCalls: [{ id: "plan-1", name: "submit_plan", input: { blocks: [], rationale: "simple" } }] });
  buildLoop.mockResolvedValue({ ok: true, netlist: { components: [], connections: [], explanation: "x" }, explanation: "x", iterationsUsed: 1 });
});
afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); generate.mockReset(); buildLoop.mockReset(); });

describe("the operator's iteration cap", () => {
  it("resolves: unset or malformed → the default; a lower integer → itself; 0 → 1; above the default → the default", () => {
    expect(resolveBuildIterationCap({})).toBe(BUILD_BUDGET.iterationCap);
    expect(resolveBuildIterationCap({ [BUILD_ITERATION_CAP_ENV]: "abc" })).toBe(BUILD_BUDGET.iterationCap);
    expect(resolveBuildIterationCap({ [BUILD_ITERATION_CAP_ENV]: "6" })).toBe(6);
    expect(resolveBuildIterationCap({ [BUILD_ITERATION_CAP_ENV]: "0" })).toBe(1);
    expect(resolveBuildIterationCap({ [BUILD_ITERATION_CAP_ENV]: "99" })).toBe(BUILD_BUDGET.iterationCap);
  });

  it("the route hands the lowered cap to the loop and reports it", async () => {
    vi.stubEnv(BUILD_ITERATION_CAP_ENV, "6");
    const body = await build();
    expect(body.ok).toBe(true);
    expect((body.budget as { iterationCap: number }).iterationCap).toBe(6);
    const options = buildLoop.mock.calls[0]?.[0] as { budget?: { maxIterations?: number } };
    expect(options.budget?.maxIterations).toBe(6);
  });

  it("without the variable the default cap applies", async () => {
    const body = await build();
    expect((body.budget as { iterationCap: number }).iterationCap).toBe(BUILD_BUDGET.iterationCap);
    const options = buildLoop.mock.calls[0]?.[0] as { budget?: { maxIterations?: number } };
    expect(options.budget?.maxIterations).toBe(BUILD_BUDGET.iterationCap);
  });
});
