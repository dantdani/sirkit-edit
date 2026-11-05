/**
 * [PR-L6 spend, 2026-10-19] SPEND-3 (the spend-bound review of increment 6; runbook PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md line 28
 * and L.6): the typed refusal of the post-apply input admission, shared by the two routes that answer it (POST /api/schematic/layout-critic
 * - Tidy - and POST /api/schematic/review - Review, through `post-apply-admission.ts`) and the page that runs them, after every approved
 * apply, automatically. Imports nothing, so the page can read it.
 *
 * The refusal: HTTP 413 with { ok: false, code: "POST_APPLY_INPUT_BOUND_EXCEEDED", pass, inputBound, ceiling, error }. `inputBound` is the
 * exact request's input-token upper bound (`request-input-bound.ts`), `ceiling` the per-request allowance it exceeded, `error` one honest
 * sentence naming both. Nothing was sent to the provider and nothing in the design was truncated or dropped to make it fit. The page shows
 * the sentence for a manual Tidy or Review and a short notice for the automatic pass, and never retries a refused request.
 *
 * [PR-L6 spend, 2026-10-19] SPEND-3-A2 / A4: the same status, and the same page path, for a request whose input CANNOT be bounded:
 * { ok: false, code: "POST_APPLY_INPUT_UNBOUNDED", pass, reason, ceiling, error }, `reason` one of
 *  - "image_allowance_undocumented": the request carries an image and the serving model has no documented per-image cap
 *    (`request-input-bound.ts`: an OpenAI id outside the GPT-5.x / GPT-6 patch family, or a serving model the router cannot name);
 *  - "bound_disproven": an earlier Tidy or Review call reported more input tokens than its admitted bound, so the bound's inferred terms are
 *    wrong; the server admits no further Tidy or Review request until it restarts (`post-apply-admission.ts`).
 */

export const POST_APPLY_INPUT_BOUND_EXCEEDED = "POST_APPLY_INPUT_BOUND_EXCEEDED" as const;
/** [PR-L6 spend, 2026-10-19] SPEND-3-A2 / A4: the request's input cannot be bounded (see the module comment). */
export const POST_APPLY_INPUT_UNBOUNDED = "POST_APPLY_INPUT_UNBOUNDED" as const;
export const POST_APPLY_UNBOUNDED_REASONS = Object.freeze(["image_allowance_undocumented", "bound_disproven"] as const);
export type PostApplyUnboundedReason = (typeof POST_APPLY_UNBOUNDED_REASONS)[number];
/** 413 Content Too Large: the design makes the request larger than the server will send for one Tidy or Review. */
export const POST_APPLY_REFUSAL_STATUS = 413;

/** The two post-apply passes, as the page runs them after an approved apply. */
export type PostApplyPass = "tidy" | "review";
export interface PostApplyInputRefusal {
  ok: false;
  code: typeof POST_APPLY_INPUT_BOUND_EXCEEDED;
  pass: PostApplyPass;
  /** the exact request's input-token upper bound */
  inputBound: number;
  /** the per-request allowance (default 200,000; an operator may only lower it) */
  ceiling: number;
  /** one honest sentence naming the bound and the ceiling */
  error: string;
}
/** [PR-L6 spend, 2026-10-19] SPEND-3-A2 / A4: the refusal of a request whose input cannot be bounded (nothing was sent). */
export interface PostApplyInputUnboundedRefusal {
  ok: false;
  code: typeof POST_APPLY_INPUT_UNBOUNDED;
  pass: PostApplyPass;
  reason: PostApplyUnboundedReason;
  /** the per-request allowance that could not be shown to hold */
  ceiling: number;
  /** one honest sentence naming why */
  error: string;
}
/** Either typed refusal of the post-apply admission. */
export type PostApplyRefusal = PostApplyInputRefusal | PostApplyInputUnboundedRefusal;

const count = (tokens: number): string => tokens.toLocaleString("en-US");
const PASS_NAME: Readonly<Record<PostApplyPass, { action: string; request: string }>> = Object.freeze({ tidy: { action: "Tidy", request: "layout (tidy)" }, review: { action: "Review", request: "review" } });

/** The route's sentence (and the manual pass's message). */
export function postApplyRefusalSentence(pass: PostApplyPass, inputBound: number, ceiling: number): string {
  return `${PASS_NAME[pass].action} was not sent: this design's ${PASS_NAME[pass].request} request could use up to ${count(inputBound)} input tokens, above the allowance of ${count(ceiling)} input tokens for one request. Nothing was sent to the AI provider and nothing in the design was cut to make it fit.`;
}

/** The body the routes answer with status `POST_APPLY_REFUSAL_STATUS`. */
export function postApplyRefusalBody(pass: PostApplyPass, inputBound: number, ceiling: number): PostApplyInputRefusal {
  return { ok: false, code: POST_APPLY_INPUT_BOUND_EXCEEDED, pass, inputBound, ceiling, error: postApplyRefusalSentence(pass, inputBound, ceiling) };
}

/** [PR-L6 spend, 2026-10-19] SPEND-3-A2 / A4: the route's sentence for a request whose input cannot be bounded. */
export function postApplyUnboundedSentence(pass: PostApplyPass, reason: PostApplyUnboundedReason, ceiling: number): string {
  const why = reason === "image_allowance_undocumented"
    ? `the configured AI model has no documented input-token cost for this ${PASS_NAME[pass].request} request's image, so the request cannot be shown to fit the allowance of ${count(ceiling)} input tokens for one request.`
    : `an earlier tidy or review request was billed for more input tokens than its computed bound, so this server sends no further tidy or review request until it is restarted.`;
  return `${PASS_NAME[pass].action} was not sent: ${why} Nothing was sent to the AI provider and nothing in the design was cut to make it fit.`;
}

/** [PR-L6 spend, 2026-10-19] SPEND-3-A2 / A4: the body the routes answer with status `POST_APPLY_REFUSAL_STATUS` for an unbounded request. */
export function postApplyUnboundedBody(pass: PostApplyPass, reason: PostApplyUnboundedReason, ceiling: number): PostApplyInputUnboundedRefusal {
  return { ok: false, code: POST_APPLY_INPUT_UNBOUNDED, pass, reason, ceiling, error: postApplyUnboundedSentence(pass, reason, ceiling) };
}

/** The automatic pass's notice: short, and it says the pass was skipped, not failed. */
export function postApplyAutoNotice(refusal: Pick<PostApplyInputRefusal, "pass" | "inputBound" | "ceiling"> | Pick<PostApplyInputUnboundedRefusal, "pass" | "reason" | "ceiling">): string {
  const name = refusal.pass === "tidy" ? "tidy" : "review";
  if ("reason" in refusal) {
    return refusal.reason === "image_allowance_undocumented"
      ? `Automatic ${name} skipped: the configured AI model has no documented token cost for the ${name} request's image, so its input could not be bounded. Nothing was sent to the AI provider.`
      : `Automatic ${name} skipped: an earlier request was billed above its computed input bound, so automatic tidy and review are paused until the server restarts. Nothing was sent to the AI provider.`;
  }
  return `Automatic ${name} skipped: the design's ${name} request (up to ${count(refusal.inputBound)} input tokens) exceeds the configured allowance (${count(refusal.ceiling)} per request). Nothing was sent to the AI provider.`;
}

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
/** A response body read back: the refusal, or null for anything else (another failure keeps its own path). */
export function parsePostApplyRefusal(value: unknown): PostApplyRefusal | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;
  if (body.code === POST_APPLY_INPUT_UNBOUNDED) { // [PR-L6 spend, 2026-10-19] SPEND-3-A2 / A4
    if ((body.pass !== "tidy" && body.pass !== "review") || !POST_APPLY_UNBOUNDED_REASONS.includes(body.reason as PostApplyUnboundedReason) || !isCount(body.ceiling)) return null;
    const reason = body.reason as PostApplyUnboundedReason;
    return { ok: false, code: POST_APPLY_INPUT_UNBOUNDED, pass: body.pass, reason, ceiling: body.ceiling, error: typeof body.error === "string" && body.error.length > 0 ? body.error : postApplyUnboundedSentence(body.pass, reason, body.ceiling) };
  }
  if (body.code !== POST_APPLY_INPUT_BOUND_EXCEEDED || (body.pass !== "tidy" && body.pass !== "review") || !isCount(body.inputBound) || !isCount(body.ceiling)) return null;
  return { ok: false, code: POST_APPLY_INPUT_BOUND_EXCEEDED, pass: body.pass, inputBound: body.inputBound, ceiling: body.ceiling, error: typeof body.error === "string" && body.error.length > 0 ? body.error : postApplyRefusalSentence(body.pass, body.inputBound, body.ceiling) };
}

/** What the page throws for the refusal: its message is the route's sentence; `autoNotice` is the automatic pass's notice. */
export class PostApplyInputRefusalError extends Error {
  constructor(readonly refusal: PostApplyRefusal) {
    super(refusal.error);
    this.name = "PostApplyInputRefusalError";
  }
  get autoNotice(): string { return postApplyAutoNotice(this.refusal); }
}

/** For a failed Tidy or Review response: throws `PostApplyInputRefusalError` when it is this refusal; otherwise returns with the response's
 *  body unread (it reads a clone), so the caller's own failure path (`throwAiResponseError`) still sees it whole. */
export async function throwPostApplyInputRefusal(response: Response): Promise<void> {
  if (response.ok || response.status !== POST_APPLY_REFUSAL_STATUS) return;
  const refusal = parsePostApplyRefusal(await response.clone().json().catch(() => null));
  if (refusal) throw new PostApplyInputRefusalError(refusal);
}
