/**
 * [PR-C] The Build request's structured result (`POST /api/schematic/build-multi`; the contract is
 * app/lib/schematic/build-result.ts) and the edit route's failure forwarding (`POST /api/schematic/edit-build`).
 *
 *  - a failed subsystem block is `status: "partial"` with the block in `omittedBlocks`; every block designed is "complete";
 *  - the electrical check is data: `passed`, `findings` (bounded list), `skipped` with the reason when the post-merge
 *    check throws, `not_run` when the single loop reported none — never silence;
 *  - a provider failure keeps the provider's `reason` and says `retryable` (credits out withholds Retry) at 503, on the
 *    planner, on the single loop and on a block alike; a planner failure that is not the provider's is a visible
 *    `failed_fallback`;
 *  - the budget: every loop is handed the request's one deadline and the iteration cap, at most
 *    BUILD_BUDGET.concurrencyCap blocks are in flight at once, and the report sums the turns used.
 *
 * The real route handlers run; the planner, the loop, the part lookup and the ERC are mocked (no provider, no database).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { LLMProviderError } from "@/app/lib/llm/errors";
import { BUILD_BUDGET } from "@/app/lib/schematic/build-result";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const generate = vi.fn();
const buildLoop = vi.fn();
const partsByIds = vi.fn();
const runErcMock = vi.fn();
vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: (...args: unknown[]) => generate(...args) } }));
vi.mock("@/app/lib/build-loop", () => ({ runBuildToolLoop: (...args: unknown[]) => buildLoop(...args) }));
vi.mock("@/app/lib/parts-search", () => ({ getPartsByIds: (...args: unknown[]) => partsByIds(...args) }));
vi.mock("@/lib/erc", () => ({ runErc: (...args: unknown[]) => runErcMock(...args), formatErcFeedback: () => "" }));

const CLEAN_ERC = { ok: true, errors: [], criticalCount: 0, warningCount: 0, reward: 1 };
const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
vi.spyOn(console, "error").mockImplementation(() => undefined);

type Json = Record<string, unknown>;
async function post(path: "build-multi" | "edit-build", body: unknown): Promise<{ status: number; body: Json }> {
  const { POST } = path === "build-multi" ? await import("@/app/api/schematic/build-multi/route") : await import("@/app/api/schematic/edit-build/route");
  const res = await POST(new Request(`http://localhost/api/schematic/${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) }));
  return { status: res.status, body: (await res.json()) as Json };
}
const build = (prompt = "build a blinker with its own supply") => post("build-multi", { prompt, provider: "openai" });

/** the planner's answer: a submitted plan with these blocks (an empty list is a judged-simple request) */
const planOf = (names: string[], rationale = "planned") => ({ provider: "openai", model: "fake", text: "", stopReason: "tool_use", toolCalls: [{ id: "plan-1", name: "submit_plan", input: { blocks: names.map((name) => ({ name, brief: `${name} block`, sharedNets: ["VCC"] })), rationale } }] });
const okLoop = (explanation: string, extra: Json = {}) => ({ ok: true, netlist: { components: [], connections: [], explanation }, explanation, iterationsUsed: 2, ...extra });
const exhausted = (extra: Json = {}) => ({ ok: false, error: "Max iterations reached (20) without a submitted schematic.", status: 503, code: "build_budget_exhausted", retryable: true, iterationsUsed: 20, ...extra });
const quotaFailure = { ok: false, error: "The OpenAI account is out of credits or over its billing quota.", status: 503, code: "provider_unavailable", provider: "openai", reason: "insufficient_quota", retryable: false, iterationsUsed: 1 };
/** answer per block name (the loop's user message starts with "Block: <name>"), else the default */
function loopByBlock(answers: Record<string, unknown>, fallback: unknown): void {
  buildLoop.mockImplementation(async (opts: { userMessage: string }) => {
    const name = /^Block: ([^\n]+)/.exec(opts.userMessage)?.[1];
    return name !== undefined && name in answers ? answers[name] : fallback;
  });
}

beforeEach(() => {
  injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: "proj-1", role: "editor" });
  partsByIds.mockResolvedValue([]);
  runErcMock.mockReturnValue(CLEAN_ERC);
  warn.mockClear();
});
afterEach(() => { resetInjectedIdentity(); generate.mockReset(); buildLoop.mockReset(); partsByIds.mockReset(); runErcMock.mockReset(); });

describe("[PR-C] completeness is data", () => {
  it("a failed subsystem block → status 'partial', the block in omittedBlocks, the check and the budget present; the prose keeps its note", async () => {
    generate.mockResolvedValueOnce(planOf(["Power", "Blinker"], "two blocks"));
    loopByBlock({ Blinker: exhausted() }, okLoop("power"));
    const { status, body } = await build();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "partial", omittedBlocks: ["Blinker"], planner: { state: "planned", blocks: 2 }, electricalCheck: { state: "passed", criticalCount: 0, warningCount: 0 } });
    expect(body.budget).toMatchObject({ iterationCap: BUILD_BUDGET.iterationCap, iterationsUsed: 22, deadlineMs: BUILD_BUDGET.deadlineMs, concurrencyCap: BUILD_BUDGET.concurrencyCap });
    expect((body.budget as Json).elapsedMs).toBeGreaterThanOrEqual(0);
    expect(body.explanation).toContain("1 block(s) failed and were omitted: Blinker");
    expect((body.netlist as Json).explanation).toBe(body.explanation);
  });

  it("every block designed → status 'complete' with no omissions", async () => {
    generate.mockResolvedValueOnce(planOf(["Power", "Blinker"]));
    loopByBlock({}, okLoop("ok"));
    const { status, body } = await build();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "complete", omittedBlocks: [], electricalCheck: { state: "passed" } });
    expect(body.explanation).not.toContain("omitted");
  });

  it("every block failed → ok false with the first failure's class and status, never a 200", async () => {
    generate.mockResolvedValueOnce(planOf(["Power", "Blinker"]));
    loopByBlock({}, exhausted());
    const { status, body } = await build();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "build_budget_exhausted", retryable: true, error: "All 2 subsystem blocks failed to design." });
  });
});

describe("[PR-C] the electrical check is never silent", () => {
  it("a post-merge check that throws → state 'skipped' with a bounded, redacted reason (still a 200 with the merged netlist)", async () => {
    generate.mockResolvedValueOnce(planOf(["Power", "Blinker"]));
    loopByBlock({}, okLoop("ok"));
    partsByIds.mockRejectedValue(new Error(`connect failed postgres://u:SENTINELPW@db.internal:5432/x ${"x".repeat(1_000)}`));
    const { status, body } = await build();
    expect(status).toBe(200);
    const check = body.electricalCheck as { state: string; reason: string };
    expect(check.state).toBe("skipped");
    expect(check.reason.length).toBeGreaterThan(0);
    expect(check.reason.length).toBeLessThanOrEqual(200);
    expect(check.reason).not.toContain("SENTINELPW");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("SENTINELPW");
  });

  it("a single loop that reported no ERC → state 'not_run' with a reason; the planner is 'single' / 'simple_request'", async () => {
    generate.mockResolvedValueOnce(planOf([], "simple"));
    buildLoop.mockResolvedValueOnce(okLoop("one loop"));
    const { status, body } = await build("a 1k pull-up");
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "complete", omittedBlocks: [], planner: { state: "single", reason: "simple_request" } });
    expect(body.electricalCheck).toMatchObject({ state: "not_run" });
    expect(typeof (body.electricalCheck as Json).reason).toBe("string");
    expect(body.explanation).toBe("one loop");
  });

  it("a single loop with ERC findings → state 'findings' with a bounded list (≤ 20 entries × 200 chars, criticals first)", async () => {
    generate.mockResolvedValueOnce(planOf([]));
    const errors = [
      ...Array.from({ length: 10 }, (_, i) => ({ severity: "warning", category: "w", message: `warning ${i} ${"w".repeat(500)}` })),
      ...Array.from({ length: 15 }, (_, i) => ({ severity: "critical", category: "c", message: `critical ${i} ${"c".repeat(500)}` })),
    ];
    buildLoop.mockResolvedValueOnce(okLoop("findings", { erc: { ok: false, errors, criticalCount: 15, warningCount: 10, reward: 0.6 } }));
    const { status, body } = await build();
    expect(status).toBe(200);
    const check = body.electricalCheck as { state: string; criticalCount: number; warningCount: number; findings: string[] };
    expect(check).toMatchObject({ state: "findings", criticalCount: 15, warningCount: 10 });
    expect(check.findings.length).toBe(20);
    for (const finding of check.findings) expect(finding.length).toBeLessThanOrEqual(200);
    expect(check.findings.slice(0, 15).every((f) => f.startsWith("critical"))).toBe(true);
  });

  it("a single loop whose ERC passed with warnings → state 'passed' with the warning count", async () => {
    generate.mockResolvedValueOnce(planOf([]));
    buildLoop.mockResolvedValueOnce(okLoop("clean", { erc: { ...CLEAN_ERC, warningCount: 3 } }));
    const { body } = await build();
    expect(body.electricalCheck).toEqual({ state: "passed", criticalCount: 0, warningCount: 3 });
  });

  it("post-merge findings → state 'findings' and the prose keeps its electrical-check note", async () => {
    generate.mockResolvedValueOnce(planOf(["Power", "Blinker"]));
    loopByBlock({}, okLoop("ok"));
    runErcMock.mockReturnValue({ ok: false, errors: [{ severity: "critical", category: "rail", message: "VCC shorted to GND" }], criticalCount: 1, warningCount: 0, reward: 0.5 });
    const { body } = await build();
    expect(body.electricalCheck).toEqual({ state: "findings", criticalCount: 1, warningCount: 0, findings: ["VCC shorted to GND"] });
    expect(body.explanation).toContain("Electrical check found 1 issue(s) after merging blocks");
  });
});

describe("[PR-C] provider failures keep the provider's reason and say whether a retry can help", () => {
  it("the single loop: insufficient_quota → 503 { code: provider_unavailable, reason, retryable: false }", async () => {
    generate.mockResolvedValueOnce(planOf([]));
    buildLoop.mockResolvedValueOnce(quotaFailure);
    const { status, body } = await build();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "provider_unavailable", provider: "openai", reason: "insufficient_quota", retryable: false });
    expect(typeof body.error).toBe("string");
  });

  it("a block: the request fails with that block's provider failure (reason and retryable kept)", async () => {
    generate.mockResolvedValueOnce(planOf(["Power", "Blinker"]));
    loopByBlock({ Blinker: quotaFailure }, okLoop("power"));
    const { status, body } = await build();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "provider_unavailable", reason: "insufficient_quota", retryable: false });
  });

  it("the planner: a provider failure is the request's failure, with reason and retryable, and no loop runs", async () => {
    generate.mockRejectedValueOnce(new LLMProviderError("openai", "insufficient_quota", 429, "insufficient_quota"));
    const { status, body } = await build();
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "provider_unavailable", provider: "openai", reason: "insufficient_quota", retryable: false });
    expect(buildLoop).not.toHaveBeenCalled();
  });

  it("the planner: a failure that is not the provider's falls back to the single loop and is reported as failed_fallback with its reason", async () => {
    generate.mockRejectedValueOnce(new Error("planner exploded"));
    buildLoop.mockResolvedValueOnce(okLoop("fallback"));
    const { status, body } = await build();
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, status: "complete", planner: { state: "failed_fallback", reason: "planner exploded" } });
    expect(buildLoop).toHaveBeenCalledTimes(1);
  });

  it("the planner: no plan submitted → the single loop, reported as 'single' / 'no_plan'", async () => {
    generate.mockResolvedValueOnce({ provider: "openai", model: "fake", text: "I cannot plan this.", stopReason: "end_turn", toolCalls: [] });
    buildLoop.mockResolvedValueOnce(okLoop("single"));
    const { body } = await build();
    expect(body).toMatchObject({ ok: true, planner: { state: "single", reason: "no_plan" } });
  });

  it("a local loop failure keeps its class and status (the historical pass-through)", async () => {
    generate.mockResolvedValueOnce(planOf([]));
    buildLoop.mockResolvedValueOnce({ ok: false, error: "The build loop failed: boom", status: 500, code: "build_loop_failed", retryable: true, iterationsUsed: 3 });
    const { status, body } = await build();
    expect(status).toBe(500);
    expect(body).toMatchObject({ ok: false, code: "build_loop_failed", retryable: true });
  });
});

describe("[PR-C] the budget", () => {
  it("every loop is handed the request's one deadline and the iteration cap", async () => {
    generate.mockResolvedValueOnce(planOf(["A", "B", "C"]));
    loopByBlock({}, okLoop("ok"));
    const before = Date.now();
    await build();
    const after = Date.now();
    expect(buildLoop).toHaveBeenCalledTimes(3);
    const budgets = buildLoop.mock.calls.map((call) => (call[0] as { budget: { maxIterations: number; deadlineAt: number } }).budget);
    for (const budget of budgets) {
      expect(budget.maxIterations).toBe(BUILD_BUDGET.iterationCap);
      expect(budget.deadlineAt).toBeGreaterThanOrEqual(before + BUILD_BUDGET.deadlineMs);
      expect(budget.deadlineAt).toBeLessThanOrEqual(after + BUILD_BUDGET.deadlineMs);
    }
    expect(new Set(budgets.map((b) => b.deadlineAt)).size).toBe(1);
  });

  it("the single loop gets the same budget", async () => {
    generate.mockResolvedValueOnce(planOf([]));
    buildLoop.mockResolvedValueOnce(okLoop("one"));
    await build();
    const budget = (buildLoop.mock.calls[0]![0] as { budget: { maxIterations: number; deadlineAt: number } }).budget;
    expect(budget.maxIterations).toBe(BUILD_BUDGET.iterationCap);
    expect(typeof budget.deadlineAt).toBe("number");
  });

  it("with 5 blocks, at most BUILD_BUDGET.concurrencyCap (3) loops are in flight at once; all 5 run; the budget sums their turns", async () => {
    generate.mockResolvedValueOnce(planOf(["A", "B", "C", "D", "E"]));
    let inFlight = 0;
    let maxInFlight = 0;
    buildLoop.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return okLoop("ok", { iterationsUsed: 4 });
    });
    const { status, body } = await build();
    expect(status).toBe(200);
    expect(buildLoop).toHaveBeenCalledTimes(5);
    expect(maxInFlight).toBe(BUILD_BUDGET.concurrencyCap);
    expect(maxInFlight).toBe(3);
    expect(body.budget).toMatchObject({ iterationsUsed: 20, concurrencyCap: 3 });
    expect(body).toMatchObject({ status: "complete", omittedBlocks: [] });
  });
});

describe("[PR-C] /api/schematic/edit-build forwards the loop's reason and retryable", () => {
  it("a provider failure with insufficient_quota → 503 with reason and retryable=false; the ok path is unchanged", async () => {
    buildLoop.mockResolvedValueOnce(quotaFailure);
    const body = { instruction: "swap R1", netlist: { components: [{ refDes: "R1", partId: "p1" }], connections: [] }, provider: "openai" };
    const refused = await post("edit-build", body);
    expect(refused.status).toBe(503);
    expect(refused.body).toMatchObject({ ok: false, code: "provider_unavailable", provider: "openai", reason: "insufficient_quota", retryable: false });
    buildLoop.mockResolvedValueOnce(okLoop("edited"));
    const edited = await post("edit-build", body);
    expect(edited.status).toBe(200);
    expect(edited.body).toEqual({ ok: true, netlist: { components: [], connections: [], explanation: "edited" }, explanation: "edited" });
  });

  it("a local failure forwards its class and retryable", async () => {
    buildLoop.mockResolvedValueOnce({ ok: false, error: "Max iterations reached (20) without a submitted schematic.", status: 503, code: "build_budget_exhausted", retryable: true, iterationsUsed: 20 });
    const { status, body } = await post("edit-build", { instruction: "swap R1", netlist: { components: [], connections: [] } });
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "build_budget_exhausted", retryable: true });
  });
});
