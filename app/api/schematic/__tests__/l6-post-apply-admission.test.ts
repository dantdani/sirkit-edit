/**
 * [PR-L6 spend, 2026-10-19] SPEND-3 (the spend-bound review of increment 6; runbook PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md line 28 and
 * L.6): the post-apply INPUT ADMISSION of the two calls the page makes automatically after every approved apply - Tidy
 * (POST /api/schematic/layout-critic) and Review (POST /api/schematic/review).
 *
 *  1. Under the ceiling each route calls the provider ONCE with `maxProviderRetries: 0`, and the request it sends is the one whose bound
 *     was admitted. Over it the provider is NEVER called and the route answers the typed 413 (POST_APPLY_INPUT_BOUND_EXCEEDED, the exact
 *     bound and the ceiling, one honest sentence); the design is not truncated to fit.
 *  2. SIRKIT_POST_APPLY_INPUT_TOKENS lowers the ceiling (to the request's own bound: admitted; one below: refused) and can never raise it
 *     (a larger value, zero, a sign, a fraction or text leaves the 200,000 default).
 *  3. The Tidy screenshot's base64 is not counted: a 3 MB image bounds the same as a 4-byte one (gpt-5.6-sol at detail "high": 3,000).
 *  4. The fixture drone (the owner's four-motor sentence through the real start route, worker pump and slice core, laid out the page's
 *     way: 41 instances): its Tidy and Review requests compute a bound under the default ceiling (numbers recorded below), and through
 *     the REAL router under the fixture runtime the admission passes and the fixture router answers missing_credentials (503).
 *  5. The page: the refusal is read before the shared failure path (the provider card and its Retry are never offered for it), the
 *     automatic pass posts a short notice instead of staying silent, and the refused request is never retried (source pin).
 *  6. [PR-L6 spend, 2026-10-19] the attack review of SPEND-3: A1 the 3,000 "high" allowance only for the documented gpt-5.6-sol / terra /
 *     luna (gpt-6-astra is charged the family's 36,000); A4 an image at an OpenAI model with no documented cap is refused, typed
 *     (POST_APPLY_INPUT_UNBOUNDED, image_allowance_undocumented), with no provider call; A3 the image is charged at the ROUTER's serving
 *     model (`LLMRouter.servingModel`, read from the adapter), not the environment re-read; A2 a reported input above the admitted bound is
 *     logged and latches every later Tidy and Review closed (bound_disproven) until restart.
 * Fake router (vi.mock; the real one only where named), the committed fixture catalog; no credits, no database, no network.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/llm/router", () => ({ llmRouter: { generate: vi.fn(), servingModel: vi.fn() } })); // [PR-L6 spend, 2026-10-19] SPEND-3-A3: + the router's serving model
import { llmRouter } from "@/app/lib/llm/router";
import { POST as layoutCriticPost } from "../layout-critic/route";
import { POST as reviewPost } from "../review/route";
import { DEFAULT_POST_APPLY_INPUT_TOKENS, POST_APPLY_INPUT_TOKENS_ENV, postApplyBoundViolation, postApplyInputBound, postApplyInputCeiling, resetPostApplyBoundViolation } from "@/app/lib/llm/post-apply-admission";
import { POST_APPLY_INPUT_BOUND_EXCEEDED, POST_APPLY_INPUT_UNBOUNDED, POST_APPLY_REFUSAL_STATUS, PostApplyInputRefusalError, parsePostApplyRefusal, postApplyAutoNotice, postApplyRefusalBody, postApplyUnboundedBody, throwPostApplyInputRefusal } from "@/app/lib/llm/post-apply-refusal";
import { MAX_IMAGE_INPUT_TOKENS, OPENAI_PATCH_IMAGE_HIGH_DETAIL_TOKENS } from "@/app/lib/llm/request-input-bound";
import { OpenAIProvider } from "@/app/lib/llm/openai-provider";
import { AnthropicProvider } from "@/app/lib/llm/anthropic-provider";
import { AiProviderUnavailableError, throwAiResponseError } from "@/app/lib/ai-preferences";
import type { LLMRequest } from "@/app/lib/llm/types";
import { LLMProviderError } from "@/app/lib/llm/errors";
import { resetGenerationTaskRuntimeFactory } from "@/app/lib/generation-task/runtime";
import { resetGenerationSlicePortsFactory, setGenerationSlicePortsFactory } from "@/app/lib/generation-task/worker/runtime";
import { resetFixtureContainer } from "@/app/lib/fixture-runtime/container";
import { BLINKER_PART_IDS, fixtureRuntimeCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import { fixtureGenerationCatalogPort, fixtureGenerationLlmPort } from "@/app/lib/fixture-runtime/generation-ports";
import { autoLayoutBuildValidated } from "@/lib/build-auto-layout";
import { buildReviewInput } from "@/lib/netlist-review";
import type { BuildLogicalNetlist, SchematicState } from "@/lib/schematic-types";
import { POST as startTask } from "../../generation-tasks/route";
import { GET as inspectTask } from "../../generation-tasks/[id]/route";
import { POST as pump } from "../../generation-worker/route";

const generate = vi.mocked(llmRouter.generate);
const servingModel = vi.mocked(llmRouter.servingModel); // [PR-L6 spend, 2026-10-19] SPEND-3-A3
/** The router's default serving models in this suite (the mock's): what the admission charges an image at. */
const SERVED = { openai: "gpt-5.6-sol", anthropic: "claude-opus-4-7" } as const;
/** A sent request's bound at the model the (mock) router serves its provider with. */
const boundOf = (request: LLMRequest): number => postApplyInputBound(request, SERVED[request.provider]);
/** The REAL router (case 4b), loaded at collection - a cold import inside a test body can outrun its timeout under load. */
const { llmRouter: realRouter, LLMRouter } = await vi.importActual<typeof import("@/app/lib/llm/router")>("@/app/lib/llm/router");
const PROJECT = "proj-l6-spend";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
const SECRET = ["l6", "spend", "worker", "secret", "for", "tests"].join("-");
const TINY_PNG = "data:image/png;base64,aGk=";
const jsonReq = (path: string, body: unknown): Request => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: JSON.stringify(body) });
const tidyAnswer = { provider: "openai" as const, model: "m", text: "", toolCalls: [{ id: "t", name: "report_layout_issues", input: { groups: [], summary: "s" } }] };
const reviewAnswer = { provider: "openai" as const, model: "m", text: "", toolCalls: [{ id: "t", name: "report_findings", input: { findings: [], summary: "s" } }] };
/** A Build-mode state on the committed fixture catalog (the route loads its geometry from it under the fixture runtime). */
const smallState = (): SchematicState => ({ components: [], wires: [], kicadComponents: [{ id: "c1", partId: BLINKER_PART_IDS.resistor, refDes: "R1", x: 0, y: 0, rotation: 0, value: "1k" }] } as unknown as SchematicState);
const smallReview = { components: [{ refDes: "R1", kind: "res", value: "1k" }], nets: [], floatingPins: [] };
/** A review whose request is bounded above 200,000 tokens (its input travels twice: the instructions and the message). */
const hugeReview = { components: Array.from({ length: 3_000 }, (_, index) => ({ refDes: `R${index + 1}`, kind: "res", value: `10k-${"x".repeat(40)}` })), nets: [], floatingPins: [] };
const sent = (index = 0): LLMRequest => generate.mock.calls[index]![0];

beforeEach(() => {
  resetFixtureContainer();
  vi.stubEnv("SIRKIT_AUTH_MODE", "local_dev");
  vi.stubEnv("SIRKIT_FIXTURE_RUNTIME", "blinker");
  vi.stubEnv("OPENAI_API_KEY", "");
  vi.stubEnv("SIRKIT_OPENAI_MODEL", "");
  vi.stubEnv(POST_APPLY_INPUT_TOKENS_ENV, "");
  vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", SECRET);
  servingModel.mockImplementation((provider) => SERVED[provider]);
  resetPostApplyBoundViolation();
  resetInjectedIdentity();
  injectAuthorizedPrincipal({ userId: "u-l6-spend", tenantId: "local", projectId: PROJECT, role: "editor" });
});
afterEach(() => {
  resetInjectedIdentity();
  generate.mockReset();
  servingModel.mockReset();
  resetPostApplyBoundViolation(); // [PR-L6 spend, 2026-10-19] SPEND-3-A2: the latch is per process; each case starts open
  resetGenerationTaskRuntimeFactory();
  resetGenerationSlicePortsFactory();
  resetFixtureContainer();
  vi.unstubAllEnvs();
});

/** Admit once at the default ceiling, read the bound of the request actually sent, then lower the ceiling to it and one below it. */
async function ceilingEdges(route: (request: Request) => Promise<Response>, path: string, body: unknown, answer: unknown): Promise<{ bound: number; at: Response; below: Response; sentAt: number }> {
  generate.mockResolvedValue(answer as never);
  const first = await route(jsonReq(path, body));
  expect(first.status).toBe(200);
  expect(generate).toHaveBeenCalledTimes(1);
  const bound = boundOf(sent());
  vi.stubEnv(POST_APPLY_INPUT_TOKENS_ENV, String(bound));
  const at = await route(jsonReq(path, body));
  const sentAt = generate.mock.calls.length;
  vi.stubEnv(POST_APPLY_INPUT_TOKENS_ENV, String(bound - 1));
  const below = await route(jsonReq(path, body));
  return { bound, at, below, sentAt };
}

describe("[PR-L6 spend] 1. the admission in both routes: under the ceiling one call with no SDK retry; over it no call and the typed refusal", () => {
  it("Tidy: one provider call (maxProviderRetries 0) for the admitted request; at a ceiling one below its bound, no call and the 413", async () => {
    const { bound, at, below, sentAt } = await ceilingEdges(layoutCriticPost, "/api/schematic/layout-critic", { state: smallState(), image: TINY_PNG, provider: "openai" }, tidyAnswer);
    expect(sent().maxProviderRetries).toBe(0);
    expect(at.status).toBe(200); // a bound equal to the ceiling fits
    expect(sentAt).toBe(2);
    expect(generate).toHaveBeenCalledTimes(2); // the refused request never reached the provider
    expect(below.status).toBe(POST_APPLY_REFUSAL_STATUS);
    const refusal = await below.json();
    expect(refusal).toEqual(postApplyRefusalBody("tidy", bound, bound - 1));
    expect(refusal).toMatchObject({ ok: false, code: POST_APPLY_INPUT_BOUND_EXCEEDED, pass: "tidy", inputBound: bound, ceiling: bound - 1 });
    expect(refusal.error).toContain(bound.toLocaleString("en-US"));
    expect(refusal.error).toContain((bound - 1).toLocaleString("en-US"));
    expect(refusal.error).toMatch(/^Tidy was not sent: .*Nothing was sent to the AI provider and nothing in the design was cut to make it fit\.$/);
  });

  it("Review: one provider call (maxProviderRetries 0) for the admitted request; at a ceiling one below its bound, no call and the 413", async () => {
    const { bound, at, below } = await ceilingEdges(reviewPost, "/api/schematic/review", { ...smallReview, provider: "openai" }, reviewAnswer);
    expect(sent().maxProviderRetries).toBe(0);
    expect(at.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(below.status).toBe(413);
    expect(await below.json()).toEqual(postApplyRefusalBody("review", bound, bound - 1));
  });

  it("a review bounded above 200,000 is refused at the default ceiling with no provider call; the design is not cut to fit", async () => {
    generate.mockResolvedValue(reviewAnswer as never);
    const response = await reviewPost(jsonReq("/api/schematic/review", { ...hugeReview, provider: "openai" }));
    expect(response.status).toBe(413);
    expect(generate).not.toHaveBeenCalled();
    const refusal = parsePostApplyRefusal(await response.json());
    expect(refusal?.ceiling).toBe(DEFAULT_POST_APPLY_INPUT_TOKENS);
    expect(refusal?.code).toBe(POST_APPLY_INPUT_BOUND_EXCEEDED); // [PR-L6 spend, 2026-10-19] SPEND-3-A2 / A4: the parse now answers either refusal; this one is the bound's
    expect(refusal && "inputBound" in refusal ? refusal.inputBound : -1).toBeGreaterThan(DEFAULT_POST_APPLY_INPUT_TOKENS);
  });

  it("a provider failure after an admitted request keeps its own 503 mapping (the refusal mapping answers only the admission)", async () => {
    generate.mockRejectedValue(new LLMProviderError("openai", "rate_limit"));
    const response = await reviewPost(jsonReq("/api/schematic/review", { ...smallReview, provider: "openai" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, code: "provider_unavailable", reason: "rate_limit" });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("[PR-L6 spend] 2. SIRKIT_POST_APPLY_INPUT_TOKENS only lowers the ceiling", () => {
  it("the parse: an integer 1..199,999 lowers it; unset, the default or above, zero, a sign, a fraction, an exponent or text leave 200,000", () => {
    expect(DEFAULT_POST_APPLY_INPUT_TOKENS).toBe(200_000);
    expect(POST_APPLY_INPUT_TOKENS_ENV).toBe("SIRKIT_POST_APPLY_INPUT_TOKENS");
    const at = (value: string | undefined): number => postApplyInputCeiling(value === undefined ? {} : { [POST_APPLY_INPUT_TOKENS_ENV]: value });
    for (const [value, ceiling] of [["1", 1], ["150000", 150_000], [" 150000 ", 150_000], ["199999", 199_999]] as const) expect(at(value), value).toBe(ceiling);
    for (const value of [undefined, "", " ", "200000", "200001", "999999999", "99999999999999999999", "0", "-5", "+5", "1.5", "1e5", "abc", "150k", "0150000"]) expect(at(value), String(value)).toBe(200_000);
  });

  it("through the route: a value above the default cannot admit a request bounded above 200,000; garbage leaves the default", async () => {
    generate.mockResolvedValue(reviewAnswer as never);
    for (const value of ["999999999", "200001", "abc", "-1"]) {
      vi.stubEnv(POST_APPLY_INPUT_TOKENS_ENV, value);
      const response = await reviewPost(jsonReq("/api/schematic/review", { ...hugeReview, provider: "openai" }));
      expect(response.status, value).toBe(413);
      expect(parsePostApplyRefusal(await response.json())?.ceiling, value).toBe(200_000);
    }
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("[PR-L6 spend] 3. the Tidy image: detail high at the served model, its base64 not counted", () => {
  it("the route sends detail \"high\"; served by gpt-5.6-sol (SIRKIT_OPENAI_MODEL unset) the image is charged 3,000, by Anthropic 36,000; a 3 MB payload bounds as a 4-byte one", async () => {
    generate.mockResolvedValue(tidyAnswer as never);
    const big = `data:image/png;base64,${"A".repeat(3_000_000)}`;
    await layoutCriticPost(jsonReq("/api/schematic/layout-critic", { state: smallState(), image: TINY_PNG, provider: "openai" }));
    await layoutCriticPost(jsonReq("/api/schematic/layout-critic", { state: smallState(), image: big, provider: "openai" }));
    await layoutCriticPost(jsonReq("/api/schematic/layout-critic", { state: smallState(), image: TINY_PNG, provider: "anthropic" }));
    expect(generate).toHaveBeenCalledTimes(3);
    const image = (sent().messages[0]!.content as Array<{ type: string; detail?: string }>).find((part) => part.type === "image");
    expect(image?.detail).toBe("high");
    expect(servingModel).toHaveBeenCalledWith("openai"); // [PR-L6 spend, 2026-10-19] SPEND-3-A3: the router names the model (was: the environment re-read)
    const [small, large, anthropic] = [boundOf(sent(0)), boundOf(sent(1)), boundOf(sent(2))];
    expect(large).toBe(small);
    expect(anthropic - small).toBe(MAX_IMAGE_INPUT_TOKENS - OPENAI_PATCH_IMAGE_HIGH_DETAIL_TOKENS);
    // [PR-L6 spend, 2026-10-19] SPEND-3-A1 / A4, pin moved: gpt-5 was charged the 36,000 worst case; it has no documented cap (unbounded),
    // and a family id without a documented "high" budget (gpt-6-astra) is charged the family's 36,000
    expect(postApplyInputBound(sent(0), "gpt-5")).toBe(Number.POSITIVE_INFINITY);
    expect(postApplyInputBound(sent(0), "gpt-6-astra") - small).toBe(MAX_IMAGE_INPUT_TOKENS - OPENAI_PATCH_IMAGE_HIGH_DETAIL_TOKENS);
  });
});

// ── 4. the fixture drone ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The owner's sentence (runbook section L.0), verbatim. */
const OWNER_FOUR_MOTOR_SENTENCE = "build me a simple drone controlling circuitly with 4 motors just a simple one";
const body = async (response: Response): Promise<Record<string, any>> => (await response.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
/** The drone through the real start route, worker pump and slice core (the l7 vertical slice's path), laid out the page's way. */
async function fixtureDroneState(): Promise<SchematicState> {
  resetGenerationTaskRuntimeFactory();
  const llm = fixtureGenerationLlmPort(0);
  setGenerationSlicePortsFactory(() => ({ llm: { generate: (request) => llm.generate(request) }, catalog: fixtureGenerationCatalogPort() }));
  const started = await startTask(jsonReq("/api/generation-tasks", { clientRequestId: "00000000-0000-4000-8000-00000000d201", prompt: OWNER_FOUR_MOTOR_SENTENCE, provider: "openai", base: { schematicDigest: "eng1-0123456789abcdef0123456789abcdef", recipe: "build-pin" } }));
  const startBody = await body(started);
  expect(started.status, JSON.stringify(startBody).slice(0, 300)).toBe(202);
  const taskId = startBody.task.taskId as string;
  const inspect = async (withResult: boolean) => body(await inspectTask(new Request(`http://localhost/api/generation-tasks/${taskId}${withResult ? "?include=result" : ""}`, { method: "GET", headers: SEL }), { params: Promise.resolve({ id: taskId }) }));
  for (let slice = 0; slice < 12 && (await inspect(false)).task.state !== "awaiting-review"; slice += 1) {
    const ran = await body(await pump(new Request("http://localhost/api/generation-worker", { method: "POST", headers: { authorization: `Bearer ${SECRET}` } })));
    expect(ran.ok, JSON.stringify(ran).slice(0, 300)).toBe(true);
  }
  const { task, result } = await inspect(true);
  expect(task.state).toBe("awaiting-review");
  const netlist = result.netlist as BuildLogicalNetlist;
  const parts = fixtureRuntimeCatalog().cachedParts;
  const used = new Map([...new Set(netlist.components.map((component) => component.partId))].map((id) => [id, parts.get(id)!] as const));
  const built = autoLayoutBuildValidated(netlist, used);
  expect(built.validation.ok).toBe(true);
  return built.state;
}
/** The page's two bodies for a state (handleTidyLayout and handleReview): the snapshot with its sheet size, and buildReviewInput over the cached parts. */
function pageBodies(state: SchematicState): { tidy: Record<string, unknown>; review: Record<string, unknown> } {
  const parts = fixtureRuntimeCatalog().cachedParts;
  const partsMap = new Map([...new Set((state.kicadComponents ?? []).map((instance) => instance.partId))].flatMap((id) => (parts.has(id) ? [[id, parts.get(id)!] as const] : [])));
  return { tidy: { provider: "openai", state: { ...state, pageSize: state.pageSize ?? "A4" }, image: TINY_PNG }, review: { ...buildReviewInput(state, partsMap), provider: "openai" } };
}

describe("[PR-L6 spend] 4. the fixture drone's Tidy and Review requests", () => {
  it("the 41-instance drone: each request computes a bound under the default ceiling (recorded), and the provider is called once each", { timeout: 120_000 }, async () => {
    const state = await fixtureDroneState();
    expect(state.kicadComponents).toHaveLength(41);
    const { tidy, review } = pageBodies(state);
    generate.mockResolvedValueOnce(tidyAnswer as never).mockResolvedValueOnce(reviewAnswer as never);
    expect((await layoutCriticPost(jsonReq("/api/schematic/layout-critic", tidy))).status).toBe(200);
    expect((await reviewPost(jsonReq("/api/schematic/review", review))).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
    const tidyBound = boundOf(sent(0));
    const reviewBound = boundOf(sent(1));
    console.info(`[PR-L6 spend] fixture drone (41 instances, gpt-5.6-sol): Tidy request bound ${tidyBound}, Review request bound ${reviewBound}, ceiling ${DEFAULT_POST_APPLY_INPUT_TOKENS}`);
    // Recorded 2026-10-19 on 0f1c446b + this change (SIRKIT_OPENAI_MODEL unset: gpt-5.6-sol, the image at detail "high" = 3,000): Tidy 64,090
    // and Review 26,367 input tokens - upper bounds, not usage (served by Anthropic the Tidy one is 97,090: the image at 36,000). Held loosely
    // so an unrelated prompt or layout change does not fail here; what must hold is that both fit the default ceiling.
    for (const bound of [tidyBound, reviewBound]) {
      expect(bound).toBeGreaterThan(10_000);
      expect(bound).toBeLessThan(DEFAULT_POST_APPLY_INPUT_TOKENS);
    }
    const tidyImage = (sent(0).messages[0]!.content as Array<{ type: string; detail?: string }>).find((part) => part.type === "image");
    expect(tidyImage?.detail).toBe("high");
  });

  it("under the fixture runtime the REAL router answers missing_credentials (503) once the admission has passed - the auto pipeline still runs", { timeout: 120_000 }, async () => {
    const state = await fixtureDroneState();
    const { tidy, review } = pageBodies(state);
    generate.mockImplementation((request) => realRouter.generate(request));
    for (const [route, path, payload] of [[layoutCriticPost, "/api/schematic/layout-critic", tidy], [reviewPost, "/api/schematic/review", review]] as const) {
      const response = await route(jsonReq(path, payload));
      expect(response.status, path).toBe(503);
      expect(await response.json(), path).toMatchObject({ ok: false, code: "provider_unavailable", reason: "missing_credentials" });
    }
    expect(generate).toHaveBeenCalledTimes(2); // both admitted, both reached the (fixture) router
  });
});

// ── 5. the page ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe("[PR-L6 spend] 5. the page reads the refusal, says so, and never retries it", () => {
  it("the refusal is thrown as its own error (route sentence as message, the automatic notice beside it); another failure keeps the shared path with its body unread", async () => {
    const refused = new Response(JSON.stringify(postApplyRefusalBody("review", 251_234, 200_000)), { status: 413, headers: { "content-type": "application/json" } });
    const error = await throwPostApplyInputRefusal(refused).then(() => null, (thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(PostApplyInputRefusalError);
    expect((error as Error).message).toBe(postApplyRefusalBody("review", 251_234, 200_000).error);
    expect((error as PostApplyInputRefusalError).autoNotice).toBe("Automatic review skipped: the design's review request (up to 251,234 input tokens) exceeds the configured allowance (200,000 per request). Nothing was sent to the AI provider.");
    expect(postApplyAutoNotice({ pass: "tidy", inputBound: 210_000, ceiling: 150_000 })).toBe("Automatic tidy skipped: the design's tidy request (up to 210,000 input tokens) exceeds the configured allowance (150,000 per request). Nothing was sent to the AI provider.");
    // a provider failure (503) and an unrelated 413 pass through untouched: the shared path still reads the whole body
    const unavailable = new Response(JSON.stringify({ ok: false, code: "provider_unavailable", provider: "openai", reason: "missing_credentials", error: "OpenAI is not configured." }), { status: 503 });
    await expect(throwPostApplyInputRefusal(unavailable)).resolves.toBeUndefined();
    await expect(throwAiResponseError(unavailable, undefined, { isCurrent: () => false })).rejects.toBeInstanceOf(AiProviderUnavailableError);
    const tooLarge = new Response(JSON.stringify({ ok: false, code: "REQUEST_BODY_TOO_LARGE", error: "too large" }), { status: 413 });
    await expect(throwPostApplyInputRefusal(tooLarge)).resolves.toBeUndefined();
    await expect(throwAiResponseError(tooLarge, undefined, { isCurrent: () => true })).rejects.toThrow("too large");
    expect(parsePostApplyRefusal({ code: POST_APPLY_INPUT_BOUND_EXCEEDED, pass: "review", inputBound: -1, ceiling: 1 })).toBeNull();
    expect(parsePostApplyRefusal({ code: POST_APPLY_INPUT_BOUND_EXCEEDED, pass: "edit", inputBound: 1, ceiling: 1 })).toBeNull();
    // [PR-L6 spend, 2026-10-19] SPEND-3-A2 / A4: the unbounded refusal takes the same page path (same status, same error class, its own notice)
    for (const [pass, reason, notice] of [["tidy", "image_allowance_undocumented", "Automatic tidy skipped: the configured AI model has no documented token cost for the tidy request's image, so its input could not be bounded. Nothing was sent to the AI provider."], ["review", "bound_disproven", "Automatic review skipped: an earlier request was billed above its computed input bound, so automatic tidy and review are paused until the server restarts. Nothing was sent to the AI provider."]] as const) {
      const body = postApplyUnboundedBody(pass, reason, 200_000);
      const thrown = await throwPostApplyInputRefusal(new Response(JSON.stringify(body), { status: 413 })).then(() => null, (caught: unknown) => caught);
      expect(thrown, reason).toBeInstanceOf(PostApplyInputRefusalError);
      expect((thrown as Error).message, reason).toBe(body.error);
      expect((thrown as PostApplyInputRefusalError).autoNotice, reason).toBe(notice);
      expect(body.error, reason).toMatch(/Nothing was sent to the AI provider and nothing in the design was cut to make it fit\.$/);
    }
    expect(parsePostApplyRefusal({ code: POST_APPLY_INPUT_UNBOUNDED, pass: "tidy", reason: "guessed", ceiling: 1 })).toBeNull();
  });

  it("source pin (app/page.tsx, in place): both handlers read the refusal first, clear the Retry, post the automatic notice, and the auto pipeline runs each pass once", () => {
    const page = readFileSync(join(process.cwd(), "app/page.tsx"), "utf8").replaceAll("\r\n", "\n");
    const lines = page.split("\n");
    expect(lines.length - 1).toBe(9156); // b24-d3's PAGE_LINES: every edit was in place
    expect(lines[52]).toContain('import { PostApplyInputRefusalError, throwPostApplyInputRefusal } from "@/app/lib/llm/post-apply-refusal";');
    const body = (name: string): string => { const start = page.indexOf(`async function ${name}(auto = false) {`); expect(start, name).toBeGreaterThan(0); return page.slice(start, page.indexOf("\n  }\n", start)); };
    for (const [name, scope, pin] of [["handleReview", "reviewScope", "reviewPin"], ["handleTidyLayout", "tidyScope", "tidyPin"]] as const) {
      const handler = body(name);
      expect(handler, name).toContain(`if (!res.ok) { await throwPostApplyInputRefusal(res); await throwAiResponseError(res, lastAiRetryRef.current ?? undefined, { isCurrent: () => ${scope}.isCurrent() }); }`);
      const refusal = handler.split("\n").find((line) => line.includes("err instanceof PostApplyInputRefusalError"));
      expect(refusal, name).toContain("lastAiRetryRef.current = null;"); // no Retry is left to replay the refused request
      expect(refusal, name).toContain(`if (auto) appendChatFor(${pin}.projectId, (prev) => [...prev, { id: \`post-apply-notice:\${${scope}.requestId}:\${Date.now()}\`, role: "assistant", content: notice, advisory: true }]);`);
      expect(refusal, name).not.toContain("randomUUID"); // [PR-L6 spend] no uuid draw on the generate -> approve -> placement path
      expect(refusal, name).toContain("if (!auto) {"); // a manual pass still shows the route's sentence through setScopedGenError
    }
    const effect = page.slice(page.indexOf("if (autoRunToken === 0) return;"), page.indexOf("}, [autoRunToken]);"));
    expect(effect.match(/handleTidyLayout\(true\)/g)).toHaveLength(1);
    expect(effect.match(/handleReview\(true\)/g)).toHaveLength(1);
  });
});

// ── 6. [PR-L6 spend, 2026-10-19] the attack review of SPEND-3 (A1-A4) ─────────────────────────────────────────────────────────────

const tidyBody = (provider: "openai" | "anthropic" = "openai"): Record<string, unknown> => ({ state: smallState(), image: TINY_PNG, provider });
const tidyPath = "/api/schematic/layout-critic";
const reviewPath = "/api/schematic/review";

describe("[PR-L6 spend] 6. the attack review: documented allowances only, the router's model, and the reported-usage self-check", () => {
  it("A1: served by gpt-6-astra (no documented \"high\" budget) the Tidy image is charged the family's 36,000, so a ceiling the gpt-5.6-sol bound fits refuses it", async () => {
    generate.mockResolvedValue(tidyAnswer as never);
    expect((await layoutCriticPost(jsonReq(tidyPath, tidyBody()))).status).toBe(200);
    const solBound = boundOf(sent());
    expect(postApplyInputBound(sent(), "gpt-6-astra")).toBe(solBound - OPENAI_PATCH_IMAGE_HIGH_DETAIL_TOKENS + MAX_IMAGE_INPUT_TOKENS);
    vi.stubEnv(POST_APPLY_INPUT_TOKENS_ENV, String(solBound));
    servingModel.mockImplementation((provider) => (provider === "openai" ? "gpt-6-astra" : SERVED.anthropic));
    const refused = await layoutCriticPost(jsonReq(tidyPath, tidyBody()));
    expect(refused.status).toBe(413);
    expect(await refused.json()).toEqual(postApplyRefusalBody("tidy", solBound - OPENAI_PATCH_IMAGE_HIGH_DETAIL_TOKENS + MAX_IMAGE_INPUT_TOKENS, solBound));
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("A4: an image at an OpenAI model with no documented cap (or a router that cannot name its model) is refused, typed, with no provider call; Review (no image) and an Anthropic Tidy still run", async () => {
    generate.mockImplementation(async (request) => (request.toolChoice && typeof request.toolChoice === "object" && request.toolChoice.name === "report_findings" ? reviewAnswer : tidyAnswer) as never);
    for (const named of ["gpt-4.1", "gpt-5", "o4-mini", undefined]) {
      servingModel.mockImplementation((provider) => (provider === "openai" ? named : SERVED.anthropic));
      const refused = await layoutCriticPost(jsonReq(tidyPath, tidyBody()));
      expect(refused.status, String(named)).toBe(413);
      expect(await refused.json(), String(named)).toEqual(postApplyUnboundedBody("tidy", "image_allowance_undocumented", DEFAULT_POST_APPLY_INPUT_TOKENS));
    }
    expect(generate).not.toHaveBeenCalled();
    expect((await reviewPost(jsonReq(reviewPath, { ...smallReview, provider: "openai" }))).status).toBe(200);
    expect((await layoutCriticPost(jsonReq(tidyPath, tidyBody("anthropic")))).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it("A3: the image is charged at the model the ROUTER's adapter serves, not the environment re-read; LLMRouter.servingModel reads the adapter, fixed when it was built", async () => {
    // the environment names gpt-5.6-sol (3,000), the router serves gpt-6-astra (36,000): the ceiling the sol bound fits refuses the request
    generate.mockResolvedValue(tidyAnswer as never);
    expect((await layoutCriticPost(jsonReq(tidyPath, tidyBody()))).status).toBe(200);
    const solBound = boundOf(sent());
    vi.stubEnv("SIRKIT_OPENAI_MODEL", "gpt-5.6-sol");
    vi.stubEnv(POST_APPLY_INPUT_TOKENS_ENV, String(solBound));
    servingModel.mockImplementation((provider) => (provider === "openai" ? "gpt-6-astra" : SERVED.anthropic));
    expect((await layoutCriticPost(jsonReq(tidyPath, tidyBody()))).status).toBe(413);
    // ... and the environment naming a model with no cap does not refuse what the router serves at a documented one
    vi.stubEnv("SIRKIT_OPENAI_MODEL", "gpt-4.1");
    servingModel.mockImplementation((provider) => SERVED[provider]);
    expect((await layoutCriticPost(jsonReq(tidyPath, tidyBody()))).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
    // the real router: the adapter's own model, undefined when no adapter is registered, unchanged by a later environment change
    const router = new LLMRouter([new OpenAIProvider({} as never, "gpt-6-astra"), new AnthropicProvider({} as never, "claude-opus-4-7")]);
    expect([router.servingModel("openai"), router.servingModel("anthropic"), new LLMRouter([]).servingModel("openai")]).toEqual(["gpt-6-astra", "claude-opus-4-7", undefined]);
    const before = realRouter.servingModel("openai");
    expect(typeof before).toBe("string");
    vi.stubEnv("SIRKIT_OPENAI_MODEL", before === "gpt-6-astra" ? "gpt-5.6-sol" : "gpt-6-astra");
    expect(realRouter.servingModel("openai")).toBe(before);
  });

  it("A2: a reported input above the admitted bound is logged (structured, no content) and latches every later Tidy and Review closed until restart; a reported input at the bound, or none, changes nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      // at the bound, and unreported: admitted, no latch
      generate.mockImplementation(async (request) => ({ ...reviewAnswer, usage: { inputTokens: boundOf(request), outputTokens: 5 } }) as never);
      expect((await reviewPost(jsonReq(reviewPath, { ...smallReview, provider: "openai" }))).status).toBe(200);
      generate.mockImplementation(async () => reviewAnswer as never);
      expect((await reviewPost(jsonReq(reviewPath, { ...smallReview, provider: "openai" }))).status).toBe(200);
      expect(postApplyBoundViolation()).toBeNull();
      expect(error).not.toHaveBeenCalled();
      // one above it: this (already billed) answer is still returned, the violation is logged, and the admission is closed
      generate.mockImplementation(async (request) => ({ ...reviewAnswer, model: "gpt-5.6-sol", usage: { inputTokens: boundOf(request) + 1, outputTokens: 5 } }) as never);
      expect((await reviewPost(jsonReq(reviewPath, { ...smallReview, provider: "openai" }))).status).toBe(200);
      const bound = boundOf(sent(2));
      expect(postApplyBoundViolation()).toEqual({ pass: "review", provider: "openai", model: "gpt-5.6-sol", inputBound: bound, reportedInputTokens: bound + 1 });
      expect(error).toHaveBeenCalledTimes(1);
      const logged = JSON.parse(String(error.mock.calls[0]![1]));
      expect(logged).toEqual({ event: "post_apply_input_bound_violation", pass: "review", provider: "openai", model: "gpt-5.6-sol", inputBound: bound, reportedInputTokens: bound + 1 });
      for (const [route, path, payload, pass] of [[reviewPost, reviewPath, { ...smallReview, provider: "anthropic" }, "review"], [layoutCriticPost, tidyPath, tidyBody("anthropic"), "tidy"]] as const) {
        const refused = await route(jsonReq(path, payload));
        expect(refused.status, pass).toBe(413);
        expect(await refused.json(), pass).toEqual(postApplyUnboundedBody(pass, "bound_disproven", DEFAULT_POST_APPLY_INPUT_TOKENS));
      }
      expect(generate).toHaveBeenCalledTimes(3); // nothing after the violation reached the provider
    } finally {
      error.mockRestore();
    }
  });
});
