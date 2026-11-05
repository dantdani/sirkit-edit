/**
 * [PR-L6 spend, 2026-10-19] Runbook PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md line 28 ("reserve worst-case cost before every request")
 * and L.6; the spend-bound review's finding SPEND-3. The ONE upper bound on the input tokens a single `LLMRequest` can be billed for,
 * shared by the durable generation task (`generation-task/worker/accounting.ts` delegates its `generationRequestInputBound` here, with
 * exactly the numbers it used before the move) and the post-apply input admission of the Tidy and Review routes
 * (`post-apply-admission.ts`). Pure: no environment, no clock, no import beyond the instruction composer and the types.
 *
 * The bound, in tokens:
 *   UTF-8 bytes of the instructions the adapters compose (the system prompt and every context section, escaped, `context.ts`)
 *   + UTF-8 bytes of JSON(tools) + JSON(toolChoice ?? null) + JSON(messages, each image part's data URL emptied)
 *   + 1,024 per call + 16 per message + 8 per content part + 64 per tool        (the provider's framing; INFERRED, self-checked by the
 *                                                                                 generation slices: a reported input above its bound stops them)
 *   + one per-image allowance for every image part                              (by provider, model and detail, below).
 * Text: at most one token per UTF-8 byte - INFERRED, not documented for gpt-5.6 / gpt-6 or for the Claude tokenizer introduced with Opus
 * 4.7 (it holds for a byte-level BPE with no normalization that expands text, e.g. NFKC turning U+FDFA's 3 bytes into 18 characters).
 * Both INFERRED terms are self-checked against the provider's reported input: a generation slice stops on a violation (accounting.ts),
 * the post-apply Tidy / Review admission latches closed until restart (post-apply-admission.ts). An image is not billed by its base64
 * bytes but by its pixels, so its data URL is NOT counted: the allowance for its provider, model and detail is.
 */
import { composeInstructions } from "./context";
import type { LLMImagePart, LLMProviderId, LLMRequest } from "./types";

/** The framing a provider adds around what the request carries, in tokens (INFERRED; the numbers `generationRequestInputBound` used). */
export const REQUEST_INPUT_FRAMING = Object.freeze({ perCall: 1_024, perMessage: 16, perPart: 8, perTool: 64 });

// ─── Image allowances ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// OpenAI: "Images and vision", https://developers.openai.com/api/docs/guides/images-vision - read 2026-10-19 by the PR-L6 lead.
// The GPT-5.x and GPT-6 families are patch-based: tokens = ceil(patch_count x 1.2) for 32 px patches.
//  - detail "original" or "auto" (and an unset detail, which the OpenAI adapter sends as "auto"): up to 65,535 px per side is kept, and
//    an image above 30,000 patches is REJECTED (not billed) -> at most ceil(30,000 x 1.2) = 36,000 tokens per image, for the family;
//  - detail "high", ONLY for gpt-5.6-sol / gpt-5.6-terra / gpt-5.6-luna: the image is fit inside 2048 x 2048 AND held to a 2,500-patch
//    budget -> at most ceil(2,500 x 1.2) = 3,000 tokens per image;
//  - detail "low", for the same three ids: fit inside 512 x 512 -> at most (512 / 32)^2 = 256 patches -> ceil(256 x 1.2) = 308 tokens.
// [PR-L6 spend, 2026-10-19] SPEND-3-A1: the 3,000 / 308 allowances apply to those three documented ids EXACTLY - a family regex charged
// them to ids the guide gives no "high" / "low" budget for (gpt-6-astra, gpt-5.4-mini, ...); every other family id is charged the family's
// 36,000 at any detail. SPEND-3-A4: an OpenAI id OUTSIDE the family (gpt-5, gpt-5-mini, gpt-4.1, o4-mini, an unknown id) has no documented
// per-image cap here, so its image is UNBOUNDED (+Infinity): a request carrying one cannot be bounded and the post-apply admission refuses
// it (runbook line 28: "Use no paid request if the remaining budget cannot be proven").
// Anthropic: up to ~4,784 tokens per image at the 2,576 px long-edge maximum (Opus 4.7 and later; ~1,600 at 1,568 px before) - the Claude
// API reference's model-migration guide (claude-api skill reference shared/model-migration.md:701-705, "up to ~4784 tokens per image"),
// read 2026-10-19. Every Anthropic image is charged 36,000: INFERRED as a 7.5x over-count of that approximate, documented cap.

/** CONFIRMED-by-documentation (the guide above, read 2026-10-19): gpt-5.6-sol / terra / luna at detail "high". */
export const OPENAI_PATCH_IMAGE_HIGH_DETAIL_TOKENS = 3_000;
/** CONFIRMED-by-documentation (the guide above, read 2026-10-19): gpt-5.6-sol / terra / luna at detail "low". */
export const OPENAI_PATCH_IMAGE_LOW_DETAIL_TOKENS = 308;
/** The 30,000-patch rejection limit x 1.2: CONFIRMED-by-documentation (the guide above, read 2026-10-19) as the most one image can bill
 *  on a GPT-5.x / GPT-6 patch-family model at detail "original" or "auto" (and at any detail on a family id without a documented "high" /
 *  "low" budget); charged to every Anthropic image as an INFERRED over-count of ANTHROPIC_DOCUMENTED_MAX_IMAGE_TOKENS. */
export const MAX_IMAGE_INPUT_TOKENS = 36_000;
/** CONFIRMED-by-documentation (the Anthropic reference above, read 2026-10-19): about 4,784 tokens per image at most, 2,576 px long edge. */
export const ANTHROPIC_DOCUMENTED_MAX_IMAGE_TOKENS = 4_784;
/** [PR-L6 spend, 2026-10-19] SPEND-3-A1: the OpenAI ids the guide gives the "high" 2,500-patch and "low" 512 x 512 budgets - exactly. */
export const OPENAI_PATCH_BUDGET_IMAGE_MODELS: ReadonlySet<string> = Object.freeze(new Set(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"]));
/** The OpenAI models the guide calls patch-based: the GPT-5.x family (a dotted minor version: gpt-5.6, gpt-5.6-sol, ...) and the GPT-6
 *  family (gpt-6-astra, gpt-6.1-sol, ...); the 36,000 rejection-limit cap is theirs. An undotted gpt-5 id (gpt-5, gpt-5-mini, gpt-5-nano)
 *  is outside it. */
export const OPENAI_PATCH_IMAGE_MODEL_FAMILY = /^gpt-5\.\d+(?:-|$)|^gpt-6(?:\.\d+)?(?:-|$)/;
/** [PR-L6 spend, 2026-10-19] SPEND-3-A4: an image with no documented cap at its model: the request's input cannot be bounded. */
export const UNBOUNDED_IMAGE_ALLOWANCE = Number.POSITIVE_INFINITY;

/** The model a request will be served by: the request itself carries none (the provider adapter is constructed with it). `undefined`: the
 *  serving model is not known (an OpenAI image is then unbounded; the Anthropic cap holds for every Claude model). */
export interface ImageAllowanceTarget { provider: LLMProviderId; model: string | undefined }

/** The most one image part can bill, in input tokens, for its provider, model and detail; UNBOUNDED_IMAGE_ALLOWANCE (+Infinity) when no
 *  cap is documented for that model. */
export function imageInputAllowance(target: ImageAllowanceTarget, detail: LLMImagePart["detail"] | string | undefined): number {
  if (target.provider !== "openai") return MAX_IMAGE_INPUT_TOKENS;
  const model = target.model ?? "";
  if (OPENAI_PATCH_BUDGET_IMAGE_MODELS.has(model)) {
    if (detail === "high") return OPENAI_PATCH_IMAGE_HIGH_DETAIL_TOKENS;
    if (detail === "low") return OPENAI_PATCH_IMAGE_LOW_DETAIL_TOKENS;
    return MAX_IMAGE_INPUT_TOKENS;
  }
  return OPENAI_PATCH_IMAGE_MODEL_FAMILY.test(model) ? MAX_IMAGE_INPUT_TOKENS : UNBOUNDED_IMAGE_ALLOWANCE;
}

/** Charges one image part; `requestInputBound` calls it once per image. */
export type ImageAllowance = (image: LLMImagePart) => number;
export interface RequestInputBoundOptions { imageAllowance: ImageAllowance }

/** The allowance of a request served by `target`'s provider and model. */
export function imageAllowanceFor(target: ImageAllowanceTarget): ImageAllowance {
  return (image) => imageInputAllowance(target, image.detail);
}
/** The provider- and model-free allowance of the generation task: every image at 36,000, whatever the model. Not a proven cap outside the
 *  documented sets above (SPEND-3-A4) - it stands only because no generation slice sends an image (their requests carry text, tool calls
 *  and tool results: l6-request-input-bound's identity case). */
export const worstCaseImageAllowance: ImageAllowance = () => MAX_IMAGE_INPUT_TOKENS;

const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/** The fields the bound reads (the transport-only `signal` and `maxProviderRetries`, and the output settings, carry no input). */
export type BoundedRequest = Pick<LLMRequest, "messages" | "system" | "tools" | "toolChoice" | "boardState" | "schematicState" | "retrievedContext" | "designConstraints" | "userRequest" | "provider">;

/** The messages as the bound serializes them: an image part keeps its shape and detail, its data URL (the base64) emptied. A request with no
 *  image is returned as is, so its JSON is byte-identical to the request's own. */
function withoutImageData(messages: BoundedRequest["messages"]): { messages: BoundedRequest["messages"]; images: LLMImagePart[] } {
  const images: LLMImagePart[] = [];
  const mapped = messages.map((message) => {
    if (typeof message.content === "string" || !message.content.some((part) => part.type === "image")) return message;
    return { ...message, content: message.content.map((part) => { if (part.type !== "image") return part; images.push(part); return { ...part, dataUrl: "" }; }) };
  });
  return { messages: images.length === 0 ? messages : mapped, images };
}

/** An upper bound on the input tokens one request can be billed for (the module comment's formula); +Infinity when an image's allowance is. */
export function requestInputBound(request: BoundedRequest, options: RequestInputBoundOptions): number {
  const tools = request.tools ?? [];
  const parts = request.messages.reduce((sum, message) => sum + (typeof message.content === "string" ? 1 : message.content.length), 0);
  const { messages, images } = withoutImageData(request.messages);
  const imageTokens = images.reduce((sum, image) => sum + options.imageAllowance(image), 0);
  return utf8Bytes(composeInstructions(request as LLMRequest) ?? "") + utf8Bytes(JSON.stringify(tools)) + utf8Bytes(JSON.stringify(request.toolChoice ?? null)) + utf8Bytes(JSON.stringify(messages))
    + REQUEST_INPUT_FRAMING.perCall + REQUEST_INPUT_FRAMING.perMessage * request.messages.length + REQUEST_INPUT_FRAMING.perPart * parts + REQUEST_INPUT_FRAMING.perTool * tools.length
    + imageTokens;
}
