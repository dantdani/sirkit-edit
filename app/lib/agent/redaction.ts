/**
 * B11.5 §B — THE redaction authority, extracted so every diagnostic producer
 * shares one classifier.
 *
 * This module is deliberately DEPENDENCY-NEUTRAL: it imports nothing. That is
 * what lets `plain-capture.ts` — which sits below `trace.ts` in the import
 * graph — use the same classifier instead of growing a second, drifting one.
 * `trace.ts` re-exports these symbols, so every existing import site keeps
 * working and there is still exactly one definition.
 *
 * B11.5 R2 reproduced why this was needed: `plain-capture.ts` had its own
 * `safeKeyName` that only stripped non-ASCII characters and truncated to 60,
 * so a synthetic credential marker embedded in an untrusted KEY NAME reached
 * the capture issues, `validateReplayCapsule`'s issue list, and
 * `ReplayCapsuleInvalidError.message` verbatim.
 */

/** Secret-shaped substrings are DETERMINISTICALLY redacted, never stored. */
const SECRET_PATTERNS: readonly RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g, // OpenAI-style keys
  /sk-ant-[A-Za-z0-9_-]{8,}/g, // Anthropic-style keys
  /Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/g,
  /\b(?:api[_-]?key|authorization|x-api-key|secret|password|credential|access[_-]?token)\b\s*[:=]\s*\S+/gi,
  /\b[A-Z][A-Z0-9_]{3,}=(?:[A-Za-z0-9+/._-]{12,})/g, // ENV_VAR=value dumps
  // [B19-D I5e row 30] credentials inside a URL (a connection string in a driver error: scheme://user:password@host).
  // [B19-D I5e review] the whole userinfo up to the last '@' of the token: an empty user, a token alone, and a password with
  // an unencoded '/' or '@' are all credentials (a URL with '@' in its path loses the part before it — over-redaction)
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s@]*@(?:[^\s@]*@)*/gi,
  // [B11.1] JSON-QUOTED credential fields: a serialized document renders
  // `{"apiKey":"AKIA…"}`, which the unquoted `key: value` pattern above does
  // not match. Separators/case are folded so apiKey / api_key / API-KEY /
  // Authorization all match.
  /"[^"]{0,40}(?:api[_\-\s]?key|authorization|x[_\-\s]?api[_\-\s]?key|secret|password|credential|access[_\-\s]?token|bearer)[^"]{0,40}"\s*:\s*"[^"]{4,}"/gi,
];

/**
 * [B19-D I5e review] Model-bound text is design text as well (net labels, values, part names): a key prefix must start a token
 * there, so "desk-lamp-controller" is not read as an `sk-` key. Diagnostics keep the unanchored patterns.
 */
const MODEL_BOUND_SECRET_PATTERNS: readonly RegExp[] = SECRET_PATTERNS.map((pattern) => (pattern.source.startsWith("sk-") ? new RegExp(`(?<![A-Za-z0-9])${pattern.source}`, pattern.flags) : pattern));

/**
 * [B19-D I5e row 25] Text a tool result carries to a model: secret-shaped substrings redacted (without the diagnostic length
 * cap — a tool result has its own budget) and control and format characters (bidirectional overrides, zero-width
 * characters) removed. Line breaks and tabs are kept.
 */
export function sanitizeModelBoundText(text: string): string {
  let sanitized = text;
  for (const pattern of MODEL_BOUND_SECRET_PATTERNS) sanitized = sanitized.replace(pattern, "[redacted]");
  return sanitized.replace(/[^\S\n\t]*[\p{Cf}\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]+/gu, " ");
}

/** Default bound for a redacted diagnostic fragment. */
export const DEFAULT_REDACTION_CHARS = 300;

export function sanitizeTraceText(text: string, maxChars: number = DEFAULT_REDACTION_CHARS): string {
  let sanitized = text;
  for (const pattern of SECRET_PATTERNS) sanitized = sanitized.replace(pattern, "[redacted]");
  return sanitized.slice(0, maxChars);
}

/** Field-content denylist used by validators as defense in depth. */
export function containsSecretShapedText(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => { pattern.lastIndex = 0; return pattern.test(text); });
}

/** [B12.7] The fixed diagnostic for thrown values from which no safe
 *  detail can be extracted. */
export const UNRENDERABLE_THROWN_VALUE = "unrenderable thrown value";

/**
 * [B12.7] TOTAL, bounded rendering of an arbitrary thrown value into a
 * safe diagnostic string. Never throws — for Error instances, Errors
 * with hostile `message` getters, strings, numbers, bigints, symbols,
 * null, undefined, objects with throwing `toString`/`Symbol.toPrimitive`,
 * proxies with hostile property/prototype traps, and cyclic or otherwise
 * unserializable values. Never serializes arbitrary objects: the only
 * detail ever extracted is a STRING `message` (or, failing that, a
 * string `name`) read behind its own guard; everything else renders as
 * the fixed generic diagnostic. Output is credential-redacted and
 * length-capped via `sanitizeTraceText`.
 *
 * Design notes: `typeof` is safe on every value including revoked
 * proxies; `String()` is safe on symbols and all primitives (template
 * literals are not); `instanceof` is deliberately NOT used (it walks the
 * prototype chain, so a proxy's hostile `getPrototypeOf` trap would
 * throw); property reads on objects can fire hostile getters or proxy
 * traps, so each read sits in its own catch.
 */
export function renderUnknownError(value: unknown, maxChars: number = DEFAULT_REDACTION_CHARS): string {
  try {
    switch (typeof value) {
      case "string":
        return value.length > 0 ? sanitizeTraceText(value, maxChars) : UNRENDERABLE_THROWN_VALUE;
      case "number":
      case "boolean":
      case "bigint":
      case "undefined":
        return String(value);
      case "symbol":
        return sanitizeTraceText(String(value), maxChars);
      case "function":
        return UNRENDERABLE_THROWN_VALUE; // never invoked, never serialized
      case "object": {
        if (value === null) return "null";
        let message: unknown;
        try { message = (value as { message?: unknown }).message; } catch { message = undefined; }
        if (typeof message === "string" && message.length > 0) return sanitizeTraceText(message, maxChars);
        let name: unknown;
        try { name = (value as { name?: unknown }).name; } catch { name = undefined; }
        if (typeof name === "string" && name.length > 0) return sanitizeTraceText(name, maxChars);
        return UNRENDERABLE_THROWN_VALUE;
      }
      default:
        return UNRENDERABLE_THROWN_VALUE;
    }
  } catch {
    return UNRENDERABLE_THROWN_VALUE;
  }
}

/**
 * [B11.2] Credential-shaped KEY NAMES, matched case- and separator-folded so
 * `clientSecret`, `refresh_token`, `providerClient`, `rawSdkPayload`,
 * `API-KEY`, and friends are all caught. Folded EXACT names cover the
 * short/generic ones; folded STEMS cover unambiguous compounds. Short generic
 * stems are deliberately NOT substring-matched — that would false-positive on
 * legitimate fields such as `canonicalStateDigest`.
 */
export function foldFieldName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const CREDENTIAL_FOLDED_EXACT: ReadonlySet<string> = new Set([
  "secret", "password", "token", "credential", "credentials", "authorization",
  "apikey", "xapikey", "accesstoken", "refreshtoken", "clientsecret",
  "clientid", "bearer", "sessionkey", "privatekey", "signingkey",
]);

const CREDENTIAL_FOLDED_STEMS: readonly string[] = [
  "apikey", "authorization", "bearer", "credential", "password",
  "accesstoken", "refreshtoken", "clientsecret", "privatekey", "signingkey",
  "sessiontoken", "authtoken", "secrettoken", "secretkey", "tokensecret",
  "reasoning", "thinking", "continuation",
  "rawbody", "rawrequest", "rawresponse", "rawprovider", "rawsdk", "rawpayload",
  "providerraw", "providerbody", "providerrequest", "providerresponse",
  "providerclient", "encryptedcontent", "openaiclient", "anthropicclient",
  "sdkclient", "sdkpayload", "sdkobject",
];

/** True when a FIELD NAME is credential-, SDK-, provider-body-, or
 *  reasoning-shaped under case/separator folding. */
export function isCredentialShapedName(name: string): boolean {
  const folded = foldFieldName(name);
  if (CREDENTIAL_FOLDED_EXACT.has(folded)) return true;
  return CREDENTIAL_FOLDED_STEMS.some((stem) => folded.includes(stem));
}

/** The stable classification a credential-shaped path segment collapses to. */
export const REDACTED_KEY_SEGMENT = "[redacted-key]";

/**
 * [B11.5 §B] Render an UNTRUSTED key name as a diagnostic path segment.
 *
 * Two independent reductions, in order:
 *  1. a credential-shaped NAME collapses to a stable classification — the name
 *     itself is the payload in that case, so no part of it may survive;
 *  2. anything else is passed through the content redactor and bounded, so an
 *     embedded secret pattern inside an otherwise innocent key is stripped.
 *
 * Deterministic, bounded, and still useful: an ordinary key comes through
 * unchanged, which is what makes the diagnostics worth reading.
 */
export function redactPathSegment(key: string, maxChars = 60): string {
  if (isCredentialShapedName(key) || containsSecretShapedText(key)) return REDACTED_KEY_SEGMENT;
  // Control characters and non-ASCII are normalized so a diagnostic can never
  // carry terminal escapes or bidirectional-override payloads.
  const printable = key.replace(/[^\x20-\x7e]/g, "?");
  return sanitizeTraceText(printable, maxChars);
}
