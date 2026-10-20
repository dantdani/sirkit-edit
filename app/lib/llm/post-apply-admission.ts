/**
 * [PR-L6 spend, 2026-10-19] SPEND-3: the post-apply INPUT ADMISSION (runbook PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md line 28: "Use no
 * paid request if the remaining budget cannot be proven"; L.6: no silently minted permission for unbounded API bills).
 *
 * After Approve the page runs Tidy (POST /api/schematic/layout-critic: the whole SchematicState in the instructions, a screenshot and the
 * component manifest) and then Review (POST /api/schematic/review: the review input, twice) AUTOMATICALLY, outside the durable task's
 * allowance. Both already ask for one billed attempt (`maxProviderRetries: 0`); this bounds each attempt's INPUT: the route builds the exact
 * `LLMRequest` it would send, computes its bound (`request-input-bound.ts`, with the per-image allowance of the provider and the model the
 * router serves it with), and when the bound exceeds the ceiling it refuses with the typed 413 of `post-apply-refusal.ts` BEFORE the
 * provider is called. The design is never truncated to fit.
 *
 * The ceiling: DEFAULT_POST_APPLY_INPUT_TOKENS (200,000) input tokens per request. SIRKIT_POST_APPLY_INPUT_TOKENS may only LOWER it: an
 * integer 1..199,999 is the ceiling; a value at or above the default, zero, a sign, a fraction or any other text is ignored (the default
 * stands). Read per request from the server environment, never from a request body.
 */
import { postApplyRefusalBody, postApplyUnboundedBody, POST_APPLY_REFUSAL_STATUS, type PostApplyPass, type PostApplyRefusal, type PostApplyUnboundedReason } from "./post-apply-refusal";
import { imageAllowanceFor, requestInputBound } from "./request-input-bound";
import type { LLMProviderId, LLMRequest, LLMResponse } from "./types";
// [PR-L6 spend, 2026-10-19] SPEND-3-A3: the serving model is the ROUTER's (`PostApplyRouter.servingModel`), never re-read from the
// environment here: the provider adapters fix theirs when they are built, so a later environment change could have charged another model.

type Environment = Readonly<Record<string, string | undefined>>;

/** The most input tokens one post-apply Tidy or Review request may be bounded at. */
export const DEFAULT_POST_APPLY_INPUT_TOKENS = 200_000;
export const POST_APPLY_INPUT_TOKENS_ENV = "SIRKIT_POST_APPLY_INPUT_TOKENS";

/** The ceiling: the default, lowered (never raised) by the operator's integer. */
export function postApplyInputCeiling(environment: Environment = process.env): number {
  const raw = environment[POST_APPLY_INPUT_TOKENS_ENV];
  if (typeof raw !== "string" || !/^[1-9][0-9]{0,15}$/.test(raw.trim())) return DEFAULT_POST_APPLY_INPUT_TOKENS;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value < DEFAULT_POST_APPLY_INPUT_TOKENS ? value : DEFAULT_POST_APPLY_INPUT_TOKENS;
}

/** [PR-L6 spend, 2026-10-19] SPEND-3-A3: what the admission needs of the router - the call itself and the model each provider adapter sends
 *  every request to (`LLMRouter.servingModel`, read from the adapter the call goes through). A router that cannot name it (undefined, or no
 *  `servingModel` at all) leaves an OpenAI image unbounded: the request is refused, never charged a guessed model's allowance. */
export interface PostApplyRouter {
  generate(request: LLMRequest): Promise<LLMResponse>;
  servingModel?(provider: LLMProviderId): string | undefined;
}

/** The exact request's input-token upper bound, each image charged its provider's, `servingModel`'s and detail's documented allowance;
 *  +Infinity when an image has no documented cap at that model (`request-input-bound.ts`). */
export function postApplyInputBound(request: LLMRequest, servingModel: string | undefined): number {
  return requestInputBound(request, { imageAllowance: imageAllowanceFor({ provider: request.provider, model: servingModel }) });
}

/** Thrown by `admitPostApplyRequest` before the provider is called; `postApplyRefusalResponse` turns it into the typed 413. */
export class PostApplyInputBoundExceeded extends Error {
  constructor(readonly pass: PostApplyPass, readonly inputBound: number, readonly ceiling: number) {
    super(`post-apply ${pass} request bounded at ${inputBound} input tokens, above the ceiling of ${ceiling}`);
    this.name = "PostApplyInputBoundExceeded";
  }
}
/** [PR-L6 spend, 2026-10-19] SPEND-3-A2 / A4: thrown by `admitPostApplyRequest` when the request's input cannot be bounded at all. */
export class PostApplyInputUnbounded extends Error {
  constructor(readonly pass: PostApplyPass, readonly reason: PostApplyUnboundedReason, readonly ceiling: number) {
    super(`post-apply ${pass} request not admitted: its input cannot be bounded (${reason})`);
    this.name = "PostApplyInputUnbounded";
  }
}

/** [PR-L6 spend, 2026-10-19] SPEND-3-A2: a post-apply call whose REPORTED input exceeded its admitted bound - the bound's INFERRED terms
 *  (the framing, tokens <= UTF-8 bytes, the image allowance as the adapters send it) were wrong for that call. Like the generation slice's
 *  `SliceInputAllowance.violation` (accounting.ts), it closes the admission: no further Tidy or Review request is admitted by this server
 *  process until it restarts. */
export interface PostApplyBoundViolation { readonly pass: PostApplyPass; readonly provider: LLMProviderId; readonly model: string; readonly inputBound: number; readonly reportedInputTokens: number }
let boundViolation: PostApplyBoundViolation | null = null;
/** The latched violation, null while every reported input has fit its bound. */
export function postApplyBoundViolation(): PostApplyBoundViolation | null { return boundViolation; }
/** Tests only: a server restart is what clears the latch in a running deployment. */
export function resetPostApplyBoundViolation(): void { boundViolation = null; }

/** The admission: the request's bound when it fits the ceiling (nothing is sent here), else a throw. */
export function admitPostApplyRequest(pass: PostApplyPass, request: LLMRequest, router: Pick<PostApplyRouter, "servingModel">, environment: Environment = process.env): number {
  const ceiling = postApplyInputCeiling(environment);
  if (boundViolation) throw new PostApplyInputUnbounded(pass, "bound_disproven", ceiling);
  const inputBound = postApplyInputBound(request, router.servingModel?.(request.provider));
  if (!Number.isFinite(inputBound)) throw new PostApplyInputUnbounded(pass, "image_allowance_undocumented", ceiling);
  if (inputBound > ceiling) throw new PostApplyInputBoundExceeded(pass, inputBound, ceiling);
  return inputBound;
}

/** [PR-L6 spend, 2026-10-19] SPEND-3-A2 / A3: the one way the two routes call the provider - admit the exact request at the router's serving
 *  model (a throw: nothing is sent), make the ONE call, then check the reported input against the admitted bound. A reported input above
 *  it is logged as a structured violation (no content: the pass, provider, model and the two numbers) and latches the admission closed;
 *  this call's answer, already billed, is still returned. An unreported input cannot be checked and changes nothing. */
export async function generateWithinPostApplyBound(pass: PostApplyPass, router: PostApplyRouter, request: LLMRequest, environment: Environment = process.env): Promise<LLMResponse> {
  const inputBound = admitPostApplyRequest(pass, request, router, environment);
  const response = await router.generate(request);
  const reported = response.usage?.inputTokens;
  if (typeof reported === "number" && Number.isFinite(reported) && reported > inputBound) {
    const violation: PostApplyBoundViolation = { pass, provider: request.provider, model: response.model, inputBound, reportedInputTokens: reported };
    boundViolation ??= violation;
    console.error("[post-apply-admission] reported input above its admitted bound; post-apply admission closed until restart", JSON.stringify({ event: "post_apply_input_bound_violation", ...violation }));
  }
  return response;
}

/** The typed refusal for an admission throw; null for any other error (a provider failure keeps its own mapping). */
export function postApplyRefusalResponse(error: unknown): Response | null {
  let body: PostApplyRefusal;
  if (error instanceof PostApplyInputBoundExceeded) body = postApplyRefusalBody(error.pass, error.inputBound, error.ceiling);
  else if (error instanceof PostApplyInputUnbounded) body = postApplyUnboundedBody(error.pass, error.reason, error.ceiling);
  else return null;
  return Response.json(body, { status: POST_APPLY_REFUSAL_STATUS });
}
