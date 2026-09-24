/**
 * [B20 A5] What the agent adapters REQUESTED, judged before anything of a provider response is used (OD-91).
 *
 * Sirkit asks a provider for text and for calls of the function tools it declared, nothing else. A response that carries
 * any other output item — a tool the provider ran on its own, or a type Sirkit does not handle — is refused WHOLE: the
 * adapter stops the run and nothing of that response reaches the continuation, a tool, the trace or the user. That is what
 * keeps "no provider-native connector is rendered" (OD-90) true on the RESPONSE side as well: an item that could only come
 * from a provider-run tool is never read, never answered and never forwarded.
 *
 * The module is pure, imports nothing and never throws. It reads no clock, no environment and no registry, and it returns
 * one of three frozen constants — never anything taken from its input (S1).
 */

/** OpenAI Responses output items the adapter handles: a function call, an assistant message, a reasoning item. */
export const OPENAI_HANDLED_OUTPUT_TYPES = Object.freeze(["function_call", "message", "reasoning"] as const);
/**
 * Anthropic content blocks the adapter handles. `text` and `tool_use` are read; `thinking` and `redacted_thinking` are
 * opaque continuation content the adapter preserves verbatim and never interprets (the code base already treats both as
 * opaque: neither may be a replay-capsule key). The adapter requests none of them, and none of them carries anything a
 * tool ran.
 */
export const ANTHROPIC_HANDLED_BLOCK_TYPES = Object.freeze(["redacted_thinking", "text", "thinking", "tool_use"] as const);

/**
 * An item `type` is at most this many characters. The length is judged BEFORE any comparison or pattern (S3, S5), so the
 * bound is what stops the pattern below from running on an unbounded string — it is never meant to decide WHETHER a type
 * is a provider-run one. [B20 A5 review] it was 32, which is shorter than two block types the installed Anthropic SDK
 * declares (`text_editor_code_execution_tool_result`, 38 characters, and its `_error` variant, 44): those are exactly the
 * provider-ran-a-tool-on-its-own items OD-91 exists to detect, and a too-tight bound classified them as a shape fault,
 * failing the run `provider_unknown` ("… is currently unavailable.") instead of `provider_unrequested_output`. 64 keeps
 * the bound hard and well clear of the longest type either SDK declares today.
 */
export const PROVIDER_OUTPUT_TYPE_MAX_CHARS = 64;
/** A response's output list holds at most this many items. The count is read ONCE, before any item (S3, S5). */
export const PROVIDER_OUTPUT_ITEMS_MAX = 1024;

/**
 * A WELL-FORMED item type: the shape both providers spell their item types in — a lower-case token of letters, digits and
 * underscores, starting with a letter. A type outside the handled set but of this shape is a provider-run or future item
 * (`unrequested`); anything else is a shape fault (`malformed`), which fails the run the way a malformed RESPONSE did
 * before A5. The bound above is applied first, so the pattern never runs on an unbounded string.
 */
const WELL_FORMED_TYPE = /^[a-z][a-z0-9_]*$/;

export type ProviderOutputJudgement =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: "unrequested" | "malformed" };

const OK: ProviderOutputJudgement = Object.freeze({ ok: true } as const);
const UNREQUESTED: ProviderOutputJudgement = Object.freeze({ ok: false, kind: "unrequested" } as const);
const MALFORMED: ProviderOutputJudgement = Object.freeze({ ok: false, kind: "malformed" } as const);

/**
 * Judge a provider response's output list. Items are judged IN ORDER and the FIRST item that is not handled decides:
 * `malformed` for a shape fault, `unrequested` for a well-formed type outside the provider's set. Never throws: anything
 * thrown by a hostile list, item or getter is `malformed`.
 */
export function judgeProviderOutput(provider: "openai" | "anthropic", items: unknown): ProviderOutputJudgement {
  try {
    const handled: readonly string[] | null = provider === "openai"
      ? OPENAI_HANDLED_OUTPUT_TYPES
      : provider === "anthropic" ? ANTHROPIC_HANDLED_BLOCK_TYPES : null;
    if (handled === null) return MALFORMED;
    if (!Array.isArray(items)) return MALFORMED;
    // the count is read ONCE, before any item is touched, and bounds the whole walk
    const count: unknown = items.length;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0 || count > PROVIDER_OUTPUT_ITEMS_MAX) return MALFORMED;
    for (let index = 0; index < count; index += 1) {
      const item: unknown = items[index];
      if (item === null || typeof item !== "object" || Array.isArray(item)) return MALFORMED;
      // an OWN `type`: a type inherited from a prototype is not what the provider sent
      if (!Object.hasOwn(item, "type")) return MALFORMED;
      const type: unknown = (item as { type?: unknown }).type;
      if (typeof type !== "string" || type.length > PROVIDER_OUTPUT_TYPE_MAX_CHARS) return MALFORMED;
      if (!WELL_FORMED_TYPE.test(type)) return MALFORMED;
      if (!handled.includes(type)) return UNREQUESTED;
    }
    return OK;
  } catch {
    return MALFORMED;
  }
}
