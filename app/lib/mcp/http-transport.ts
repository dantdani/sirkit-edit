/**
 * [B20 A1] The Streamable HTTP transport of Sirkit's MCP client (B20-A): one POST per JSON-RPC message, over the ONE
 * egress path (`app/lib/net/outbound-fetch.ts`), against the current specification revision 2026-07-28
 * (`artifacts/ai-control-plane-b20/mcp-reference-notes.md` sections 3, 5 and 7; OD-41, OD-42 — no SDK).
 *
 * The transport is an ADAPTER: it moves one message and classifies one answer. It negotiates nothing (A2), obtains no
 * token by itself (A3: here a token comes only from an injected provider — `none`, or the pre-issued token read from the
 * environment by the NAME the registry row references), normalises no result (A4) and never retries, never fulfils an
 * `input_required` round trip, never follows a redirect. What it enforces, before anything is sent:
 *  - the message is ONE JSON-RPC 2.0 request or notification (id a string or an integer, never null; a plain method name;
 *    object params); the transport OWNS `_meta`: it sets the protocol version (the same value as the header), the client
 *    capabilities and the client info, and refuses a caller `_meta` carrying a reserved key (`io.modelcontextprotocol/…`,
 *    any prefix with an `mcp` or `modelcontextprotocol` label) or a trace key (`traceparent`, `tracestate`, `baggage` —
 *    A4 adds those deliberately);
 *  - the URL is built ONLY from the row's `canonicalUri`, and its origin (scheme, host AND port) and exact path must
 *    equal the row's endpoint — the wire half of D20-20; the egress policy then allows only that host, resolved to public
 *    addresses, with `maxRedirects` 0 (a 3xx is a closed failure and `Authorization` is never re-sent: D20-24), the row's
 *    deadline and body ceiling;
 *  - a token must be an RFC 6750 token (b64token characters); it travels as `Authorization: Bearer` on EVERY request and
 *    nowhere else — never in the URL, never in a sentence, never in a result;
 *  - admission (`requestMcpAdmission`: the server window, the tool window for tools/call, the breaker, the purpose share)
 *    and the row's `maxConcurrent` in-flight bound; a refusal sends nothing and reserves nothing.
 * Every answer becomes one typed outcome: `accepted` (202 to a notification), `complete`, `input_required` (handed back,
 * never acted on), `error` (a JSON-RPC error object: integer code, bounded inert message), `unauthorized` / `forbidden`
 * (401 / 403 with the parsed Bearer challenge; a `resource_metadata` URL is only RECORDED, and only when it is https,
 * credential-free and not a blocked name — A3 admits it before fetching it), or `closed` with one of the codes in
 * `McpTransportFailureCode`. Every outcome carries the server id, protocol version, method, elapsed time and byte counts
 * for A4's trace attribution. Server text the transport surfaces ITSELF — error messages, challenge descriptions, the
 * string leaves of request-scoped notifications — passes the inert/bounded/redacting helpers; a `result` is handed back
 * as DATA for A4's normaliser, with the one redaction only the transport can make: the token it sent is removed from
 * every string leaf AND every object key of every result and notification, so a server that echoes the credential never
 * gets it into an outcome. Lists a 400 may carry are validated as names; a challenge's tokens never equal the sent token.
 * The attribution names the method only as the validated plain name: a refused one (oversized, hostile, secret-shaped) is
 * never echoed. [B20 A1 review-2] The scrub's own work is bounded (it runs regexes over server text synchronously, where
 * no deadline can interrupt it): a notification with too many strings, or past the call's character budget, is replaced by
 * a stub and counted in `notificationsDropped`; a result is never dropped — its redaction is one linear pass.
 * [B20 A1 review-3] The token comparison is three passes, failing closed: the raw text, its NFC form, and a SKELETON (NFKD
 * without combining marks and format characters) — a text whose skeleton still holds the token is a disguised echo and is
 * replaced whole. A result is not normalised (data for A4): it gets the raw pass and the skeleton pass only. The scrub never
 * mints a structural JSON-RPC key on a notification, and `mcpPost` never rejects: whatever throws is a closed outcome.
 */
import { recordMcpOutcome, requestMcpAdmission, type AdmissionPause, type AdmissionPurpose, type McpRequestOutcome } from "../acquisition/admission-control";
import { containsSecretShapedText, containsTokenAnchoredSecretShapedText, sanitizeTraceText } from "../agent/redaction";
import { readBoundedStream, type BoundedStreamResult } from "../http/bounded-stream";
import { inertExternalText } from "../net/external-href";
import { blockedHostnameReason } from "../net/ip-policy";
import { outboundFetch, type OutboundDeps, type OutboundFailureCode, type OutboundHeaders, type OutboundPolicy } from "../net/outbound-fetch";
import { classifyJsonRpcMessage, discardStream, isJsonRpcId, readSseJsonRpc, sseUnreadable, type JsonRpcId, type JsonRpcMessage, type SseFailureCode, type SseJsonRpcResult } from "../net/sse-reader";
import { MCP_PROTOCOL_VERSION_CURRENT, type McpServerRegistryEntry } from "./server-registry";

/** `clientInfo` on every request (reference notes section 2: SHOULD). The version mirrors package.json; a test pins it. */
export const MCP_CLIENT_INFO: Readonly<{ name: string; version: string }> = Object.freeze({ name: "sirkit", version: "0.1.0" });
export const MCP_META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
export const MCP_META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
export const MCP_META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
/** The spec-reserved error codes the transport reads on a 400, and the JSON-RPC method-not-found it reads on a 404. */
export const MCP_ERROR_HEADER_MISMATCH = -32020;
export const MCP_ERROR_MISSING_CLIENT_CAPABILITY = -32021;
export const MCP_ERROR_UNSUPPORTED_PROTOCOL_VERSION = -32022;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
/** Bounds: the error body read on a 4xx/5xx; a request body; an `Mcp-Name` value; the lists a 400 may carry. */
export const MCP_ERROR_BODY_MAX_BYTES = 65_536;
export const MCP_REQUEST_MAX_BYTES = 1_000_000;
export const MCP_NAME_MAX_CHARS = 2_048;
/** [B20 A1 review] the bound on each string leaf of a request-scoped notification placed in an outcome */
export const MCP_NOTIFICATION_TEXT_MAX_CHARS = 1_000;
/** [B20 A1 review-2] the bound on each object KEY of such a notification; one that scrubs to nothing becomes `EMPTY_KEY` */
export const MCP_NOTIFICATION_KEY_MAX_CHARS = 128;
const EMPTY_KEY = "(key)";
/** what every redaction writes in place of what it removed */
export const REDACTED = "[redacted]";
/** [B20 A1 review-3] what a skeleton drops — combining marks and format (default-ignorable) characters — and how much text it normalises at once */
const SKELETON_DROPPED = /[\p{M}\p{Cf}]/gu;
const SKELETON_CHUNK_CHARS = 4_096;
const NON_ASCII = /\P{ASCII}/u;
/** [B20 A1 review-3] the names a key the scrub REWRITES may never take: at every depth, and at the top level of a notification */
const PROTOTYPE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);
const JSON_RPC_STRUCTURAL_KEYS: ReadonlySet<string> = new Set(["jsonrpc", "method", "id", "params", "result", "error"]);
const NO_KEYS: ReadonlySet<string> = new Set();
/** the method of a notification whose own is not nameable: not a plain method name, carrying the sent token, or scrubbed to nothing */
const UNKNOWN_NOTIFICATION_METHOD = "notifications/unknown";
/** [B20 A1 review-2] the scrub's own work: strings (leaves and keys) per notification, and characters scrubbed per `mcpPost` call */
export const MCP_NOTIFICATION_MAX_STRINGS = 256;
export const MCP_SCRUB_MAX_CHARS_PER_CALL = 262_144;
/** how far past its cut the scrub still redacts a secret SHAPE whole (the sent token extends the window by its own length) */
const SECRET_SHAPE_WINDOW_CHARS = 256;
/** the most of the remaining deadline the probe of a handed-off 202 stream may take */
const ACCEPTED_PROBE_MAX_MS = 1_000;
const LIST_MAX_ENTRIES = 32;
const LIST_ENTRY_MAX_CHARS = 128;
const VERSIONS_MAX_ENTRIES = 16;
const MESSAGE_MAX_CHARS = 300;
const DESCRIPTION_MAX_CHARS = 200;
const RETRY_AFTER_MAX_SECONDS = 86_400;

const METHOD_PATTERN = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const METHOD_MAX_CHARS = 128;
const PROTOCOL_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** RFC 6750 b64token */
const B64TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]+=*$/;
/** [B20 A1 lead] A token of digits only is refused: a server could echo it as a JSON NUMBER, and numbers are never redacted. */
const DIGITS_ONLY_TOKEN_PATTERN = /^[0-9]+=*$/;
const isBearerToken = (value: string): boolean => B64TOKEN_PATTERN.test(value) && !DIGITS_ONLY_TOKEN_PATTERN.test(value);
/** the Base64 sentinel of header Value Encoding (section 3): a value that already looks like one is encoded again */
const SENTINEL_PATTERN = /^=\?base64\?[\s\S]*\?=$/;
const TRACE_META_KEYS: ReadonlySet<string> = new Set(["traceparent", "tracestate", "baggage"]);
const RESERVED_META_LABELS: ReadonlySet<string> = new Set(["mcp", "modelcontextprotocol"]);
/** an OAuth scope token (RFC 6749 section 3.3) and an error code token (RFC 6749 section 5.2) */
const SCOPE_PATTERN = /^[!#-[\]-~]{1,128}$/;
const ERROR_CODE_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** a capability name (a `capabilities` key, dotted, or an extension's reverse-DNS name with its `/`): never free text */
const CAPABILITY_NAME_PATTERN = /^[A-Za-z0-9_./-]{1,128}$/;
/** [B20 A1 review-2] a media type a sentence may name: RFC 6838 restricted names, lowercase (the egress path lowercases), bounded */
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]{1,64}\/[a-z0-9!#$&^_.+-]{1,64}$/;
const CHALLENGE_PARAM = /([A-Za-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,"]+))/g;
const BEARER_CHALLENGE = /(?:^|,)\s*bearer(?![A-Za-z0-9_-])([\s\S]*)$/i;
const METHODS_WITH_NAME: Readonly<Record<string, "name" | "uri">> = Object.freeze({ "tools/call": "name", "prompts/get": "name", "resources/read": "uri" });
/**
 * [B20 A2] `x-mcp-header` mirroring (section 3): the ONE header family a caller may add, and only on the three methods
 * whose input schema may carry the annotation. The name is `Mcp-Param-` + an RFC 7230 tchar token of at most 64
 * characters; the value must already be a header field value (the `=?base64?…?=` sentinel included — A2 encodes it).
 */
export const MCP_PARAM_HEADER_PATTERN = /^Mcp-Param-[!#$%&'*+.^_`|~0-9A-Za-z-]{1,64}$/;
export const MCP_PARAM_HEADER_MAX = 16;
export const MCP_PARAM_HEADER_VALUE_MAX_CHARS = 2_048;

// ── Types ─────────────────────────────────────────────────────────────────────

export type { JsonRpcId, JsonRpcMessage };
export interface JsonRpcRequest { jsonrpc: "2.0"; id: JsonRpcId; method: string; params?: Record<string, unknown> }
export interface JsonRpcNotification { jsonrpc: "2.0"; method: string; params?: Record<string, unknown> }
/** OD-41: the current revision is the authority path; "legacy" only relaxes `resultType` for a row that lists the compatibility era. */
export type McpEra = "current" | "legacy";

export type McpTokenOutcome =
  | { ok: true; token: string | null }
  | { ok: false; code: "token_unavailable" | "token_malformed"; message: string };
/** Answers with the token to send (null for none). A3 wires the client-credentials flow; A1 ships `none` and the pre-issued token. */
export type McpTokenProvider = (server: McpServerRegistryEntry, environment: Readonly<Record<string, string | undefined>>) => McpTokenOutcome | Promise<McpTokenOutcome>;

export interface McpBearerChallenge {
  scheme: "Bearer";
  /** recorded only when https, credential-free, fragment-free and not a blocked name; A3 admits it before fetching it */
  resourceMetadata?: string;
  scope?: readonly string[];
  error?: string;
  errorDescription?: string;
}

export interface McpTransportDeps extends OutboundDeps {
  /** The clock the admission meters, the deadline remainder and `elapsedMs` read (tests). */
  clock?: () => number;
  /** The environment a token provider reads NAMES from; defaults to `process.env` at call time. */
  environment?: Readonly<Record<string, string | undefined>>;
  tokenProvider?: McpTokenProvider;
}

export interface McpPostOptions {
  purpose: AdmissionPurpose;
  era?: McpEra;
  /** Defaults to the current revision; must be one the row lists. */
  protocolVersion?: string;
  /** `_meta["io.modelcontextprotocol/clientCapabilities"]`; `{}` unless A2 declares more. */
  clientCapabilities?: Readonly<Record<string, unknown>>;
  /**
   * [B20 A2] `Mcp-Param-{Name}` headers mirroring the `x-mcp-header` properties of the call's arguments. Every name must
   * match `MCP_PARAM_HEADER_PATTERN` and every value must be a header field value of at most 2 048 characters, at most
   * 16 of them, on `tools/call`, `prompts/get` or `resources/read` only — otherwise the request is `invalid_request`
   * and NOTHING is sent. The transport adds no such header by itself and never derives one from the body.
   */
  paramHeaders?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
  deps?: McpTransportDeps;
}

export type McpTransportFailureCode =
  // before anything is sent
  | "invalid_request"
  | "reserved_meta"
  | "protocol_version_unsupported"
  | "endpoint_mismatch"
  | "token_unavailable"
  | "token_malformed"
  | "token_unexpected"
  | "concurrency_exhausted"
  | "admission_refused"
  // the exchange
  | "egress_refused"
  | "redirect_refused"
  | "timeout"
  | "aborted"
  | "network_error"
  | "response_too_large"
  | "unexpected_content_type"
  // the answer
  | "protocol_violation"
  | "header_mismatch"
  | "missing_client_capability"
  | "unsupported_protocol_version"
  | "legacy_or_unknown"
  | "method_not_found"
  | "rate_limited"
  | "server_error"
  | "unexpected_status"
  | "stream_failed";

/** What every outcome carries for trace attribution (A4). */
export interface McpPostAttribution {
  serverId: string;
  protocolVersion: string;
  /** [B20 A1 review] the VALIDATED method name, or "" when the message carried none the transport accepts: a refused method is never echoed */
  method: string;
  elapsedMs: number;
  requestBytes: number;
  responseBytes: number;
}

export type McpPostOutcome =
  | { ok: true; kind: "accepted" }
  /** [B20 A1 review-2] `notificationsDropped`: how many of `notifications` are the stub of one that carried too much text to scrub */
  | { ok: true; kind: "complete"; result: JsonRpcMessage; notifications: readonly JsonRpcMessage[]; notificationsDropped: number }
  /** MRTR: handed back as-is; the transport neither retries nor fulfils it, and A2/A4 refuse it */
  | { ok: false; kind: "input_required"; result: JsonRpcMessage; notifications: readonly JsonRpcMessage[]; notificationsDropped: number }
  | { ok: false; kind: "error"; code: number; message: string; httpStatus: number }
  /** 401 — or a 400 that carries a Bearer challenge and no JSON-RPC error (RFC 6750 `invalid_request`): the credential's problem, never an older revision */
  | { ok: false; kind: "unauthorized"; httpStatus: number; challenge: McpBearerChallenge | null }
  | { ok: false; kind: "forbidden"; httpStatus: number; challenge: McpBearerChallenge | null }
  | {
      ok: false;
      kind: "closed";
      code: McpTransportFailureCode;
      message: string;
      status?: number;
      retryAfterSeconds?: number;
      requiredCapabilities?: readonly string[];
      supported?: readonly string[];
      pause?: AdmissionPause;
      egressCode?: OutboundFailureCode;
      sseCode?: SseFailureCode;
    };

export type McpPostResult = McpPostAttribution & McpPostOutcome;

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * [B20 A1 review] A plain method name: bounded (the length is judged first, so a huge string never meets the pattern), the
 * method alphabet only — no control or format character can be in one — and never secret-shaped. The ONE rule `prepare`
 * refuses by and the attribution names a method by, so no field of an outcome is the caller's raw string.
 */
function isMethodName(value: unknown): value is string {
  return typeof value === "string" && value.length <= METHOD_MAX_CHARS && METHOD_PATTERN.test(value) && !containsTokenAnchoredSecretShapedText(value);
}

/** The characters of a text the scrub reads: 4 x its bound, extended by the longest redaction subject (the sent token; 256 for a secret shape). */
function scrubWindow(maxChars: number, redact: readonly string[]): number {
  return maxChars * 4 + redact.reduce((longest, secret) => Math.max(longest, secret.length), SECRET_SHAPE_WINDOW_CHARS);
}

/** The length of the longest PROPER prefix of `secret` that `text` ends with (0 when none). */
function properPrefixLengthAtEnd(text: string, secret: string): number {
  for (let length = Math.min(secret.length - 1, text.length); length >= 1; length -= 1) {
    const start = text.length - length;
    let matches = true;
    for (let i = 0; matches && i < length; i += 1) matches = text.charCodeAt(start + i) === secret.charCodeAt(i);
    if (matches) return length;
  }
  return 0;
}

/** `text` without a trailing PROPER prefix of a secret: what the end of a window leaves of a secret that began inside it. */
function withoutSecretPrefixAtEnd(text: string, redact: readonly string[]): string {
  let out = text;
  for (const secret of redact) out = out.slice(0, out.length - properPrefixLengthAtEnd(out, secret));
  return out;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * [B20 A1 review-3] The skeleton of a BOUNDED text: NFKD without combining marks and format characters — what a disguised token
 * (a compatibility spelling, a mark fused to its last character, a zero-width character inside it) folds back to. The marks go
 * FIRST: NFKD reorders a run of marks quadratically (100 000 of them take seconds), and without them nothing is left to reorder;
 * the skeleton is the same for every code point either way (checked exhaustively).
 */
export function skeletonOf(text: string): string {
  return text.replace(SKELETON_DROPPED, "").normalize("NFKD").replace(SKELETON_DROPPED, "");
}

/**
 * [B20 A1 review-3] THE token comparison of every channel that drops what carries the sent token: whether the skeleton of `text`
 * holds a secret. It answers for all three passes at once — a token is ASCII, so a raw occurrence survives the skeleton, and
 * the skeleton of a text is the skeleton of its NFC form. `foldCase`: for a channel that lowercases (the media type, a URL's
 * host). Linear in a text of ANY length, and NFKD (which expands up to 18 x) never sees it whole: chunks of 4 096 characters,
 * never ending inside a surrogate pair, with the tail of each skeleton carried into the next.
 */
export function skeletonCarries(text: string, redact: readonly string[], foldCase = false): boolean {
  const fold = (piece: string): string => (foldCase ? piece.toLowerCase() : piece);
  const secrets = redact.filter((secret) => secret !== "").map(fold);
  if (secrets.length === 0) return false;
  if (!NON_ASCII.test(text)) {
    const subject = fold(text);
    return secrets.some((secret) => subject.includes(secret));
  }
  const keep = secrets.reduce((longest, secret) => Math.max(longest, secret.length), 1) - 1;
  let carry = "";
  for (let start = 0; start < text.length;) {
    let end = Math.min(text.length, start + SKELETON_CHUNK_CHARS);
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end -= 1;
    const piece = carry + fold(skeletonOf(text.slice(start, end)));
    if (secrets.some((secret) => piece.includes(secret))) return true;
    carry = keep === 0 ? "" : piece.slice(-keep);
    start = end;
  }
  return false;
}

/**
 * [B20 A1 review-3] Pass 3 of the scrub, failing closed: whether the skeleton of a text the two literal passes have redacted
 * STILL holds a secret — a disguise they cannot see. At the end of a CUT window also a proper prefix of one, unless it is
 * literally the text's own end (a plain character, which `withoutSecretPrefixAtEnd` has judged): what the cut leaves of a
 * disguised token cannot be cut out by position. An ASCII text has no skeleton but itself.
 */
function disguisesSecret(text: string, redact: readonly string[], cut: boolean): boolean {
  if (redact.length === 0 || !NON_ASCII.test(text)) return false;
  const skeleton = skeletonOf(text);
  return redact.some((secret) => {
    if (secret === "") return false;
    if (skeleton.includes(secret)) return true;
    const left = cut ? properPrefixLengthAtEnd(skeleton, secret) : 0;
    return left > 0 && !text.endsWith(secret.slice(0, left));
  });
}

/**
 * Text from the server as data: the values in `redact` (the token this request carried — a server may echo it back) and
 * secret-shaped substrings redacted, control and format characters inert, bounded by code points.
 * [B20 A1 review-2] The transport's own cut must never turn a whole token into a surviving prefix: the redaction runs over
 * a window EXTENDED by the longest redaction subject and only then is the text cut to 4 x the bound, so a token that starts
 * inside the kept part is whole when it is redacted; what the window's own end leaves of a later token is removed, because
 * the redactions before it shorten the text and would pull it inside the cut.
 * [B20 A1 review-3] Three passes, failing closed. (1) The RAW window: round 2 compared only the NFC form, where a combining
 * mark after the token fuses with its last character (e + U+0301, '=' + U+0338) and all but that character came back. (2) Its
 * NFC form: the inert step applies NFC anyway, and NFC turns U+212A (KELVIN SIGN) into the letter K. (3) The skeleton
 * (`disguisesSecret`): a text that still holds the token there is replaced WHOLE by the marker. Each runs once per window.
 */
export function scrubVendorText(raw: unknown, maxChars: number, redact: readonly string[] = []): string {
  if (typeof raw !== "string") return "";
  const size = scrubWindow(maxChars, redact);
  const cut = raw.length > size;
  // a cut window never ends inside a surrogate pair: the half it kept would hide the disguised prefix before it from pass 3
  const window = raw.slice(0, cut && isHighSurrogate(raw.charCodeAt(size - 1)) ? size - 1 : size);
  let text = redactAll(redactAll(window, redact).normalize("NFC"), redact);
  if (cut) text = withoutSecretPrefixAtEnd(text, redact);
  if (disguisesSecret(text, redact, cut)) text = REDACTED;
  const redacted = sanitizeTraceText(text, Number.MAX_SAFE_INTEGER).slice(0, maxChars * 4);
  return inertExternalText(redacted, maxChars) ?? "";
}

/**
 * [B20 A1 review-2] The media type as a sentence may name it, or null: a plain bounded media type that neither carries the
 * sent token (compared case-folded: the egress path lowercases the header, and a lowercase b64token is a legal header
 * value) nor is secret-shaped. The header is server text like any other. [B20 A1 review-3] The one token comparison
 * (`skeletonCarries`); the pattern admits ASCII only, so a disguised spelling never reaches it.
 */
function nameableMediaType(contentType: string, redact: readonly string[]): string | null {
  if (!MEDIA_TYPE_PATTERN.test(contentType) || containsSecretShapedText(contentType)) return null;
  return skeletonCarries(contentType, redact, true) ? null : contentType;
}

type JsonContainer = Record<string, unknown> | unknown[];

/**
 * [B20 A1 review-2] The names an object's keys take under `mapKey`, in document order. A key `mapKey` leaves unchanged always
 * keeps its name; a REWRITTEN key that would equal another name gets a numeric suffix (`#2`, `#3`, … in document order), so
 * no entry ever overwrites another and the outcome is deterministic. Amortised linear: one counter per base name.
 * [B20 A1 review-3] A `reserved` name counts as taken for a rewritten key: the scrub trims and strips format characters, and
 * must not MINT `id` or `params` (a request, or a malformed message, out of a notification) or `__proto__`.
 */
function uniqueKeys(keys: readonly string[], mapKey: (name: string) => string, reserved: (name: string) => boolean): string[] {
  const names = keys.map(mapKey);
  if (names.every((name, index) => name === keys[index])) return names;
  const taken = new Set<string>(names.filter((name, index) => name === keys[index]));
  const next = new Map<string, number>();
  for (let index = 0; index < names.length; index += 1) {
    const base = names[index]!;
    if (base === keys[index]) continue;
    let name = base;
    if (taken.has(name) || reserved(name)) {
      let suffix = next.get(base) ?? 2;
      do { name = `${base}#${suffix}`; suffix += 1; } while (taken.has(name));
      next.set(base, suffix);
    }
    taken.add(name);
    names[index] = name;
  }
  return names;
}

/**
 * [B20 A1 review] A JSON value with every string leaf rewritten by `leaf` and [B20 A1 review-2] every object key by `mapKey`
 * (a key is server text exactly as a leaf is); the shape, numbers, booleans and nulls are kept. Iterative (a deeply nested
 * body cannot exhaust the stack) and defined per own key (a `__proto__` key is copied as a key, never as a prototype).
 * [B20 A1 review-3] A key `mapKey` REWRITES never becomes `__proto__`, `constructor` or `prototype`, nor, at the top level
 * only, one of `rootReserved`; an untouched key keeps its name whatever it is.
 */
function mapStrings(value: unknown, leaf: (text: string) => string, mapKey: (name: string) => string, rootReserved: ReadonlySet<string> = NO_KEYS): unknown {
  if (typeof value === "string") return leaf(value);
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  const root: JsonContainer = Array.isArray(value) ? [] : {};
  const stack: Array<{ source: JsonContainer; target: JsonContainer }> = [{ source: value, target: root }];
  while (stack.length > 0) {
    const { source, target } = stack.pop()!;
    const keys = Object.keys(source);
    const names = Array.isArray(source) ? keys : uniqueKeys(keys, mapKey, (name) => PROTOTYPE_KEYS.has(name) || (source === value && rootReserved.has(name)));
    for (let index = 0; index < keys.length; index += 1) {
      const child = (source as Record<string, unknown>)[keys[index]!];
      let mapped: unknown = child;
      if (typeof child === "string") mapped = leaf(child);
      else if (isPlainObject(child) || Array.isArray(child)) {
        mapped = Array.isArray(child) ? [] : {};
        stack.push({ source: child, target: mapped as JsonContainer });
      }
      Object.defineProperty(target, names[index]!, { value: mapped, enumerable: true, writable: true, configurable: true });
    }
  }
  return root;
}

/**
 * A result as data, with the sent token redacted from every string leaf and every key (nothing else is touched: A4
 * normalises it). [B20 A1 review-2] Never dropped, whatever its size — it is the answer — so the redaction stays linear in
 * the body the row's ceiling already bounds: one split/join pass per leaf and per key, no regex.
 * [B20 A1 review-3] A result is NOT normalised here (it is data for A4), so of the three passes it gets (1) the raw text and
 * (3) the skeleton: a leaf or key whose skeleton still holds the token, a disguised echo, is replaced WHOLE by the marker.
 * There is no NFC pass, since that would rewrite the data. An ASCII text is untouched by pass 3; any other is read in bounded
 * chunks (`skeletonCarries`), so the redaction stays linear.
 */
function redactResult(result: JsonRpcMessage, redact: readonly string[]): JsonRpcMessage {
  if (redact.length === 0) return result;
  const redactOne = (text: string): string => {
    const literal = redactAll(text, redact);
    return NON_ASCII.test(literal) && skeletonCarries(literal, redact) ? REDACTED : literal;
  };
  return mapStrings(result, redactOne, redactOne) as JsonRpcMessage;
}

/** [B20 A1 review-2] What one `mcpPost` call has spent of `MCP_SCRUB_MAX_CHARS_PER_CALL`. */
interface ScrubBudget { chars: number }

/**
 * [B20 A1 review-2] The characters the scrub of a notification would read (each leaf and key up to its window), or null as
 * soon as it has more than `MCP_NOTIFICATION_MAX_STRINGS` strings or would pass `ceiling` — counted before any regex runs.
 */
function scrubCost(notification: JsonRpcMessage, redact: readonly string[], ceiling: number): number | null {
  const leafWindow = scrubWindow(MCP_NOTIFICATION_TEXT_MAX_CHARS, redact);
  const keyWindow = scrubWindow(MCP_NOTIFICATION_KEY_MAX_CHARS, redact);
  let strings = 0;
  let chars = 0;
  const stack: unknown[] = [notification];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value === "string") {
      strings += 1;
      chars += Math.min(value.length, leafWindow);
    } else if (Array.isArray(value)) {
      for (const child of value) if (typeof child === "string" || (typeof child === "object" && child !== null)) stack.push(child);
    } else if (isPlainObject(value)) {
      for (const key of Object.keys(value)) {
        if (strings > MCP_NOTIFICATION_MAX_STRINGS) return null;
        strings += 1;
        chars += Math.min(key.length, keyWindow);
        const child = value[key];
        if (typeof child === "string" || (typeof child === "object" && child !== null)) stack.push(child);
      }
    }
    if (strings > MCP_NOTIFICATION_MAX_STRINGS || chars > ceiling) return null;
  }
  return chars;
}

/**
 * A request-scoped notification: every string leaf (the method included) and [B20 A1 review-2] every key inert, bounded and
 * with the sent token redacted. One whose scrub would exceed the bounds of the scrub's work is replaced by a stub that names
 * only its VALIDATED method — nothing of it is scrubbed, and it spends nothing of the call's budget.
 * [B20 A1 review-3] A bearer token IS a plain method name: the stub names the method only when it does not carry the sent
 * token either. The kept notification stays a notification: no rewritten key takes a structural name at its top level, and a
 * method that scrubs to nothing is `notifications/unknown`.
 */
function scrubNotification(notification: JsonRpcMessage, redact: readonly string[], budget: ScrubBudget): { message: JsonRpcMessage; dropped: boolean } {
  const cost = scrubCost(notification, redact, MCP_SCRUB_MAX_CHARS_PER_CALL - budget.chars);
  if (cost === null) {
    const method = isMethodName(notification.method) && !skeletonCarries(notification.method, redact) ? notification.method : UNKNOWN_NOTIFICATION_METHOD;
    return { message: { jsonrpc: "2.0", method, params: { dropped: "too much text" } }, dropped: true };
  }
  budget.chars += cost;
  const leaf = (text: string): string => scrubVendorText(text, MCP_NOTIFICATION_TEXT_MAX_CHARS, redact);
  const key = (name: string): string => scrubVendorText(name, MCP_NOTIFICATION_KEY_MAX_CHARS, redact) || EMPTY_KEY;
  const message = mapStrings(notification, leaf, key, JSON_RPC_STRUCTURAL_KEYS) as Record<string, unknown>;
  if (message.method === "") message.method = UNKNOWN_NOTIFICATION_METHOD;
  return { message, dropped: false };
}

function redactAll(text: string, redact: readonly string[]): string {
  let out = text;
  for (const secret of redact) if (secret !== "") out = out.split(secret).join(REDACTED);
  return out;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = i + 1 < bytes.length ? bytes[i + 1]! : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2]! : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += BASE64_ALPHABET[(triple >> 18) & 63]! + BASE64_ALPHABET[(triple >> 12) & 63]!;
    out += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 63]! : "=";
    out += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 63]! : "=";
  }
  return out;
}

/**
 * [B20 A2] A header field value the transport will put on the wire: non-empty, visible ASCII with space and tab inside
 * only, and no leading or trailing whitespace. A `=?base64?…?=` sentinel IS one (it is what an unsafe value becomes).
 */
export function isHeaderFieldValue(value: string): boolean {
  if (value === "") return false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (!((code >= 0x21 && code <= 0x7e) || code === 0x20 || code === 0x09)) return false;
  }
  const first = value.charCodeAt(0);
  const last = value.charCodeAt(value.length - 1);
  return first !== 0x20 && first !== 0x09 && last !== 0x20 && last !== 0x09;
}

function isHeaderSafe(value: string): boolean {
  return !SENTINEL_PATTERN.test(value) && isHeaderFieldValue(value);
}

/** `Mcp-Name` Value Encoding (section 3): the value itself when header-safe, else the `=?base64?…?=` sentinel over its UTF-8. */
export function encodeMcpNameHeader(value: string): string {
  return isHeaderSafe(value) ? value : `=?base64?${base64(new TextEncoder().encode(value))}?=`;
}

/** A `_meta` key the caller may not set: a reserved prefix (any label `mcp` or `modelcontextprotocol`) or a trace key. */
function isReservedMetaKey(key: string): boolean {
  if (TRACE_META_KEYS.has(key)) return true;
  const slash = key.indexOf("/");
  if (slash === -1) return false;
  return key.slice(0, slash).toLowerCase().split(".").some((label) => RESERVED_META_LABELS.has(label));
}

function safeResourceMetadataUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.hash !== "" || raw.includes("#")) return undefined;
  if (blockedHostnameReason(url.hostname) !== null) return undefined;
  return url.toString();
}

/** The Bearer challenge of a `WWW-Authenticate` header as a typed, bounded record; null when the header carries none. */
export function parseBearerChallenge(header: string | undefined, redact: readonly string[] = []): McpBearerChallenge | null {
  if (typeof header !== "string") return null;
  const match = BEARER_CHALLENGE.exec(header);
  if (!match) return null;
  const challenge: McpBearerChallenge = { scheme: "Bearer" };
  const params = new RegExp(CHALLENGE_PARAM.source, "g");
  for (let found = params.exec(match[1]!); found !== null; found = params.exec(match[1]!)) {
    const name = found[1]!.toLowerCase();
    const value = found[2] !== undefined ? found[2].replace(/\\(.)/g, "$1") : found[3]!;
    // [B20 A1 review] a scope, an error code or a metadata URL that carries the sent token is dropped: the grammars admit a b64token
    // [B20 A1 review-3] by the one token comparison; the URL as it was written AND as the parser made it, both case-folded: the
    // parser lowercases and compatibility-folds a host, and percent-encodes what a disguise is made of
    if (name === "resource_metadata" && challenge.resourceMetadata === undefined) {
      const safe = safeResourceMetadataUrl(value);
      if (safe !== undefined && !skeletonCarries(value, redact, true) && !skeletonCarries(safe, redact, true)) challenge.resourceMetadata = safe;
    } else if (name === "scope" && challenge.scope === undefined) {
      challenge.scope = value.split(/\s+/).filter((token) => SCOPE_PATTERN.test(token) && !skeletonCarries(token, redact)).slice(0, LIST_MAX_ENTRIES);
    } else if (name === "error" && challenge.error === undefined) {
      if (ERROR_CODE_PATTERN.test(value) && !skeletonCarries(value, redact)) challenge.error = value;
    } else if (name === "error_description" && challenge.errorDescription === undefined) {
      challenge.errorDescription = scrubVendorText(value, DESCRIPTION_MAX_CHARS, redact);
    }
  }
  return challenge;
}

function retryAfterSeconds(headers: OutboundHeaders | undefined): number | undefined {
  const value = headers?.["retry-after"];
  if (value === undefined || !/^\d{1,6}$/.test(value.trim())) return undefined;
  const seconds = Number(value.trim());
  return seconds <= RETRY_AFTER_MAX_SECONDS ? seconds : undefined;
}

function boundedStringList(value: unknown, maxEntries: number, keep: (entry: string) => boolean): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (out.length >= maxEntries) break;
    if (typeof entry !== "string" || entry.length > LIST_ENTRY_MAX_CHARS || !keep(entry)) continue;
    out.push(entry);
  }
  return out;
}

/** The JSON-RPC error object of a message, when it is one: an integer code and (optionally) a string message and data. */
function errorObjectOf(message: JsonRpcMessage, redact: readonly string[]): { code: number; message: string; data: unknown } | null {
  const error = message.error;
  if (!isPlainObject(error) || typeof error.code !== "number" || !Number.isInteger(error.code)) return null;
  return { code: error.code, message: scrubVendorText(error.message, MESSAGE_MAX_CHARS, redact), data: error.data };
}

/** Parse a body as one JSON-RPC object, when its media type is JSON and it parses to one; null otherwise. */
function jsonRpcObjectOf(bytes: Uint8Array | undefined, contentType: string): JsonRpcMessage | null {
  if (bytes === undefined || bytes.byteLength === 0 || !contentType.startsWith("application/json")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(bytes));
  } catch {
    return null;
  }
  return isPlainObject(parsed) && parsed.jsonrpc === "2.0" ? (parsed as JsonRpcMessage) : null;
}

function mediaTypeOf(headers: OutboundHeaders | undefined): string {
  return (headers?.["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
}

// ── Token providers ───────────────────────────────────────────────────────────

/** Auth mode `none`: no token, ever. */
export const noneTokenProvider: McpTokenProvider = () => ({ ok: true, token: null });

/** Auth mode `pre-issued-token-env`: the access token read from the environment by the NAME the row references, at call time. */
export const preIssuedTokenEnvProvider: McpTokenProvider = (server, environment) => {
  const reference = server.auth.secrets.find((secret) => secret.role === "access-token");
  if (reference === undefined) return { ok: false, code: "token_unavailable", message: `MCP server "${server.id}": the row references no access token.` };
  const value = Object.hasOwn(environment, reference.env) ? environment[reference.env] : undefined;
  if (typeof value !== "string" || value === "") return { ok: false, code: "token_unavailable", message: `MCP server "${server.id}": ${reference.env} is not set.` };
  if (!isBearerToken(value)) return { ok: false, code: "token_malformed", message: `MCP server "${server.id}": ${reference.env} is not an RFC 6750 token.` };
  return { ok: true, token: value };
};

/** Dispatch on the row's auth mode; the client-credentials flow is A3 and answers unavailable here. */
export const defaultTokenProvider: McpTokenProvider = (server, environment) => {
  switch (server.auth.mode) {
    case "none": return noneTokenProvider(server, environment);
    case "pre-issued-token-env": return preIssuedTokenEnvProvider(server, environment);
    case "client-credentials-env": return { ok: false, code: "token_unavailable", message: `MCP server "${server.id}": the client-credentials flow is not wired in this increment (A3).` };
  }
};

/**
 * [B20 A2] The redaction subjects of a call to this row: the token `mcpPost` would send for it, or nothing. The client
 * layers (negotiation, discovery, tool calls) retain server text of their own — instructions, a title, a description, a
 * cursor — which `mcpPost` redacts only as it redacts a result (the raw text and its skeleton, case-sensitively, since a
 * result is data). They pass this list to `scrubVendorText` and to `skeletonCarries` so a text that carries the token in
 * ANY spelling, case-folded included, is replaced whole. It resolves the token through the same provider seam and never
 * throws: an unavailable, malformed or unexpected credential is simply no subject.
 */
export async function mcpRedactionSubjects(server: McpServerRegistryEntry, deps: McpTransportDeps = {}): Promise<readonly string[]> {
  try {
    const provider = deps.tokenProvider ?? defaultTokenProvider;
    const outcome = await provider(server, deps.environment ?? process.env);
    if (!isPlainObject(outcome) || outcome.ok !== true) return Object.freeze([]);
    const token = (outcome as { token?: unknown }).token;
    return typeof token === "string" && token !== "" && isBearerToken(token) ? Object.freeze([token]) : Object.freeze([]);
  } catch {
    return Object.freeze([]);
  }
}

// ── The in-flight bound ───────────────────────────────────────────────────────

const inFlight = new Map<string, number>();

/** How many requests to this server are in flight in this process. */
export function mcpInFlight(serverId: string): number {
  return inFlight.get(serverId) ?? 0;
}

/** Test hook: forget every in-flight count. */
export function resetMcpInFlight(): void {
  inFlight.clear();
}

// ── The request ───────────────────────────────────────────────────────────────

type Prepared =
  | { ok: true; body: string; requestBytes: number; id: JsonRpcId | null; name: string | null; tool: string | undefined; paramHeaders: Readonly<Record<string, string>> }
  | { ok: false; code: "invalid_request" | "reserved_meta" | "protocol_version_unsupported"; message: string };

/**
 * [B20 A2] The `Mcp-Param-*` headers of a request, or a sentence naming the rule that refused them — judged before
 * anything is sent and never echoing a name or a value. Own keys only, so no inherited name can reach the wire.
 */
function paramHeadersOf(method: string, raw: unknown): { ok: true; headers: Record<string, string> } | { ok: false; reason: string } {
  if (raw === undefined) return { ok: true, headers: {} };
  if (!isPlainObject(raw)) return { ok: false, reason: "paramHeaders must be an object." };
  const keys = Object.keys(raw);
  if (keys.length === 0) return { ok: true, headers: {} };
  if (METHODS_WITH_NAME[method] === undefined) return { ok: false, reason: `${method} carries no x-mcp-header parameters.` };
  if (keys.length > MCP_PARAM_HEADER_MAX) return { ok: false, reason: `at most ${MCP_PARAM_HEADER_MAX} Mcp-Param headers may be sent.` };
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  const seen = new Set<string>();
  for (const key of keys) {
    if (!MCP_PARAM_HEADER_PATTERN.test(key)) return { ok: false, reason: "an Mcp-Param header name is not Mcp-Param- followed by a token." };
    if (seen.has(key.toLowerCase())) return { ok: false, reason: "two Mcp-Param header names differ only in case." };
    seen.add(key.toLowerCase());
    const value = raw[key];
    if (typeof value !== "string" || value.length > MCP_PARAM_HEADER_VALUE_MAX_CHARS || !isHeaderFieldValue(value)) {
      return { ok: false, reason: "an Mcp-Param header value is not a bounded header field value." };
    }
    headers[key] = value;
  }
  return { ok: true, headers };
}

function prepare(server: McpServerRegistryEntry, message: JsonRpcRequest | JsonRpcNotification, options: McpPostOptions, protocolVersion: string): Prepared {
  const invalid = (sentence: string): Prepared => ({ ok: false, code: "invalid_request", message: `MCP server "${server.id}": ${sentence}` });
  if (!isPlainObject(message) || message.jsonrpc !== "2.0") return invalid("the message is not a JSON-RPC 2.0 object.");
  if ("result" in message || "error" in message) return invalid("a response is never sent; the transport sends requests and notifications only.");
  const method = message.method;
  if (!isMethodName(method)) return invalid("the method name is not a plain method name.");
  const isRequest = "id" in message;
  const id = isRequest ? (message as JsonRpcRequest).id : null;
  if (isRequest && (!isJsonRpcId(id) || id === "")) return invalid("a request id must be a non-empty string or an integer, never null.");
  const params = message.params === undefined ? {} : message.params;
  if (!isPlainObject(params)) return invalid("params must be an object.");
  const callerMeta = params._meta === undefined ? {} : params._meta;
  if (!isPlainObject(callerMeta)) return invalid("_meta must be an object.");
  for (const key of Object.keys(callerMeta)) {
    if (isReservedMetaKey(key)) return { ok: false, code: "reserved_meta", message: `MCP server "${server.id}": the caller may not set a reserved or trace _meta key; the transport owns those fields.` };
  }
  if (!PROTOCOL_VERSION_PATTERN.test(protocolVersion) || !server.supportedProtocolVersions.includes(protocolVersion)) {
    return { ok: false, code: "protocol_version_unsupported", message: `MCP server "${server.id}": the row does not list the requested protocol version.` };
  }
  if ((options.era ?? "current") === "legacy" && server.compatibilityEra !== true) {
    return { ok: false, code: "protocol_version_unsupported", message: `MCP server "${server.id}": the compatibility era is not listed for this row (OD-41).` };
  }
  const nameField = METHODS_WITH_NAME[method];
  let name: string | null = null;
  if (nameField !== undefined) {
    const value = params[nameField];
    if (typeof value !== "string" || value === "") return invalid(`${method} requires a string ${nameField}.`);
    if (value.length > MCP_NAME_MAX_CHARS) return invalid(`the ${nameField} is too long for the Mcp-Name header.`);
    name = value;
  }
  const meta = {
    ...callerMeta,
    [MCP_META_PROTOCOL_VERSION]: protocolVersion,
    [MCP_META_CLIENT_CAPABILITIES]: options.clientCapabilities ?? {},
    [MCP_META_CLIENT_INFO]: { name: MCP_CLIENT_INFO.name, version: MCP_CLIENT_INFO.version },
  };
  const wire = { jsonrpc: "2.0", ...(isRequest ? { id } : {}), method, params: { ...params, _meta: meta } };
  let body: string;
  try {
    body = JSON.stringify(wire);
  } catch {
    return invalid("the message cannot be serialised as JSON.");
  }
  const requestBytes = new TextEncoder().encode(body).byteLength;
  if (requestBytes > MCP_REQUEST_MAX_BYTES) return invalid(`the message exceeds ${MCP_REQUEST_MAX_BYTES} bytes.`);
  const mirrored = paramHeadersOf(method, options.paramHeaders);
  if (!mirrored.ok) return invalid(mirrored.reason);
  return { ok: true, body, requestBytes, id, name, tool: method === "tools/call" ? name ?? undefined : undefined, paramHeaders: mirrored.headers };
}

/** The wire half of D20-20: the request URL's origin and exact path must be the row's endpoint. */
function endpointMatches(server: McpServerRegistryEntry): boolean {
  let url: URL;
  try {
    url = new URL(server.canonicalUri);
  } catch {
    return false;
  }
  const { host, port, path } = server.endpoint;
  const origin = `https://${host}${port === null ? "" : `:${port}`}`;
  return url.protocol === "https:" && url.origin === origin && url.pathname === path && url.search === "" && url.hash === "" && url.username === "" && url.password === "";
}

// ── The answer ────────────────────────────────────────────────────────────────

type Interpreted = Exclude<McpPostOutcome, { kind: "accepted" | "unauthorized" | "forbidden" }>;

/** One JSON-RPC message that must be the response to `id`: a typed error, `complete`, or `input_required`. */
function interpretResponse(server: McpServerRegistryEntry, message: JsonRpcMessage, id: JsonRpcId, era: McpEra, httpStatus: number, seen: { notifications: readonly JsonRpcMessage[]; notificationsDropped: number }, redact: readonly string[]): Interpreted {
  const violation = (sentence: string): Interpreted => ({ ok: false, kind: "closed", code: "protocol_violation", message: `MCP server "${server.id}": ${sentence}` });
  const classified = classifyJsonRpcMessage(message);
  if (classified.kind !== "response") return violation("the answer is not one JSON-RPC 2.0 response.");
  if (classified.id !== id) return violation("the answer carries another request's id.");
  if ("error" in message) {
    const error = errorObjectOf(message, redact);
    if (error === null) return violation("the error object has no integer code.");
    return { ok: false, kind: "error", code: error.code, message: error.message, httpStatus };
  }
  const result = message.result;
  if (!isPlainObject(result)) return violation("the result is not an object.");
  const resultType = result.resultType;
  if (resultType === "complete" || (resultType === undefined && era === "legacy")) return { ok: true, kind: "complete", result: redactResult(result as JsonRpcMessage, redact), ...seen };
  if (resultType === "input_required") return { ok: false, kind: "input_required", result: redactResult(result as JsonRpcMessage, redact), ...seen };
  return violation(resultType === undefined ? "the result carries no resultType (required in 2026-07-28)." : "the result carries an unrecognised resultType.");
}

// ── mcpPost ───────────────────────────────────────────────────────────────────

/**
 * Send ONE JSON-RPC request or notification to an admitted registry row and classify the answer. Never throws; no header,
 * token, URL with credentials or server text reaches a sentence or a result unscrubbed.
 * [B20 A1 review-3] "Never throws" is enforced here, not assumed: whatever `postOnce` throws where nothing expects it — before
 * anything was admitted, or while building the outcome itself — is the closed `network_error` with a FIXED sentence (never the
 * thrown text). It records nothing: a throw inside the admitted exchange was already counted, once, by `postOnce`.
 */
export async function mcpPost(server: McpServerRegistryEntry, message: JsonRpcRequest | JsonRpcNotification, options: McpPostOptions): Promise<McpPostResult> {
  try {
    return await postOnce(server, message, options);
  } catch {
    let serverId = "";
    try {
      if (typeof server.id === "string") serverId = server.id;
    } catch {
      // a row that cannot be read names nothing
    }
    return { serverId, protocolVersion: "", method: "", elapsedMs: 0, requestBytes: 0, responseBytes: 0, ok: false, kind: "closed", code: "network_error", message: "MCP transport: the call failed unexpectedly; nothing of it was classified." };
  }
}

async function postOnce(server: McpServerRegistryEntry, message: JsonRpcRequest | JsonRpcNotification, options: McpPostOptions): Promise<McpPostResult> {
  const deps = options.deps ?? {};
  const rawClock = deps.clock ?? Date.now;
  const started = rawClock();
  // [B20 A1 lead] a clock that throws or answers no number AFTER the call was admitted may not skip the breaker record or
  // replace the call's own outcome: every later read falls back to the last good tick. The first read and the admission
  // read stay raw, so a clock that fails before anything is admitted is still the last-resort refusal below.
  let lastTick = Number.isFinite(started) ? started : 0;
  const clock = (): number => {
    try {
      const now = rawClock();
      if (Number.isFinite(now)) lastTick = now;
    } catch {
      // keep the last good tick
    }
    return lastTick;
  };
  // [B20 A1 lead] like the method below, the attribution names the protocol version only when it IS a revision date: a
  // refused option (oversized, control-carrying, secret-shaped, not a string) is never echoed; `prepare` refuses the empty one
  const requestedVersion: unknown = options.protocolVersion ?? MCP_PROTOCOL_VERSION_CURRENT;
  const protocolVersion = typeof requestedVersion === "string" && PROTOCOL_VERSION_PATTERN.test(requestedVersion) ? requestedVersion : "";
  const era: McpEra = options.era ?? "current";
  // [B20 A1 review] the attribution (A4's trace reads it) names the method only when it IS a plain method name: a refused one is never echoed
  const method = isPlainObject(message) && isMethodName(message.method) ? message.method : "";
  const subject = `MCP server "${server.id}"`;
  let requestBytes = 0;
  let responseBytes = 0;
  const attribution = (): McpPostAttribution => ({ serverId: server.id, protocolVersion, method, elapsedMs: Math.max(0, clock() - started), requestBytes, responseBytes });
  const finish = (outcome: McpPostOutcome): McpPostResult => ({ ...attribution(), ...outcome });
  const closed = (code: McpTransportFailureCode, sentence: string, extra: Partial<Extract<McpPostOutcome, { kind: "closed" }>> = {}): McpPostResult =>
    finish({ ok: false, kind: "closed", code, message: sentence, ...extra });
  /**
   * [B20 A1 review-2] What is left of the row's deadline for a read the egress deadline no longer covers, clamped to
   * [1, the row's deadline]: a wall clock that steps BACKWARDS (or answers no number) never lengthens a read.
   */
  const remainingMs = (): number => {
    const elapsed = clock() - started;
    return Number.isFinite(elapsed) ? Math.min(server.limits.deadlineMs, Math.max(1, server.limits.deadlineMs - elapsed)) : server.limits.deadlineMs;
  };

  const prepared = prepare(server, message, options, protocolVersion);
  if (!prepared.ok) return closed(prepared.code, prepared.message);
  const sent = prepared;
  requestBytes = sent.requestBytes;
  if (!endpointMatches(server)) return closed("endpoint_mismatch", `${subject}: the canonical URI does not name the row's endpoint (origin and exact path); nothing was sent.`);

  // The token: from the injected provider only; refused before any network call when malformed or unexpected.
  const provider = deps.tokenProvider ?? defaultTokenProvider;
  let tokenOutcome: McpTokenOutcome;
  try {
    tokenOutcome = await provider(server, deps.environment ?? process.env);
    if (!isPlainObject(tokenOutcome) || typeof tokenOutcome.ok !== "boolean") throw new Error("not a token outcome");
  } catch {
    tokenOutcome = { ok: false, code: "token_unavailable", message: `${subject}: the token provider failed.` };
  }
  if (!tokenOutcome.ok) return closed(tokenOutcome.code, sanitizeTraceText(tokenOutcome.message, MESSAGE_MAX_CHARS));
  const token = tokenOutcome.token;
  if (token !== null && server.auth.mode === "none") return closed("token_unexpected", `${subject}: the row declares no authentication, so no credential is sent.`);
  if (token === null && server.auth.mode !== "none") return closed("token_unavailable", `${subject}: no access token is available.`);
  if (token !== null && !isBearerToken(token)) return closed("token_malformed", `${subject}: the access token is not an RFC 6750 token; nothing was sent.`);
  /** the token this request carries: a server that echoes it back never gets it into a result */
  const redact: readonly string[] = token === null ? [] : [token];

  if (options.signal?.aborted) return closed("aborted", `${subject}: the request was aborted before it started.`);
  if (mcpInFlight(server.id) >= server.limits.maxConcurrent) {
    return closed("concurrency_exhausted", `${subject}: ${server.limits.maxConcurrent} request(s) are already in flight; nothing was sent.`);
  }
  const admission = requestMcpAdmission(server, sent.tool, 1, rawClock(), options.purpose);
  if (!admission.allowed) {
    return closed("admission_refused", admission.message, { pause: { reason: admission.reason, message: admission.message, retryAtMs: admission.retryAtMs } });
  }

  inFlight.set(server.id, mcpInFlight(server.id) + 1);
  let outcome: McpRequestOutcome = "failure";
  try {
    const headers: Record<string, string> = {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": protocolVersion,
      "Mcp-Method": method,
      ...(sent.name === null ? {} : { "Mcp-Name": encodeMcpNameHeader(sent.name) }),
      // [B20 A2] the validated `x-mcp-header` mirror; it can never overwrite a header above (the `Mcp-Param-` prefix)
      ...sent.paramHeaders,
      ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
    };
    const policy: OutboundPolicy = {
      source: `mcp:${server.id}`,
      allowedHosts: [server.endpoint.host],
      deadlineMs: server.limits.deadlineMs,
      maxResponseBytes: server.limits.maxResponseBytes,
      maxRedirects: server.maxRedirects,
      // a 202 carries no media type; the transport judges the media type of every 2xx itself (a 200 of a foreign type is
      // read under the row's ceiling and then refused — a stated limit); an error body is read only when it is JSON
      acceptContentTypes: [],
      errorBody: { maxBytes: MCP_ERROR_BODY_MAX_BYTES, contentTypes: ["application/json"] },
      streamBody: { contentTypes: ["text/event-stream"] },
    };
    const exchange = await outboundFetch({ url: server.canonicalUri, method: "POST", headers, body: sent.body, signal: options.signal }, policy, { fetch: deps.fetch, resolve: deps.resolve });
    const result = await interpretExchange(exchange);
    outcome = breakerOutcome(result);
    return result;
  } catch {
    // [B20 A1 review-3] an exchange that throws where nothing expects it (an injected transport whose response throws when it is
    // read): closed with a fixed sentence and the attribution; `outcome` is still "failure", recorded ONCE by the `finally`
    return closed("network_error", `${subject}: the exchange failed unexpectedly.`);
  } finally {
    inFlight.set(server.id, Math.max(0, mcpInFlight(server.id) - 1));
    recordMcpOutcome(server, outcome, clock());
  }

  async function interpretExchange(exchange: Awaited<ReturnType<typeof outboundFetch>>): Promise<McpPostResult> {
    if (!exchange.ok) {
      responseBytes = exchange.bytes?.byteLength ?? 0;
      switch (exchange.code) {
        case "http_error":
          return interpretStatus(exchange.status ?? 0, exchange.headers, exchange.bytes, exchange.errorBodyDropped === true);
        case "too_many_redirects":
        case "redirect_refused":
          return closed("redirect_refused", `${subject}: the server answered with a redirect (HTTP ${exchange.status}); redirects are never followed and nothing was re-sent.`, { status: exchange.status });
        case "timeout":
          return closed("timeout", `${subject}: no complete answer within ${server.limits.deadlineMs} ms.`);
        case "aborted":
          return closed("aborted", `${subject}: the request was aborted.`);
        case "network_error":
          return closed("network_error", `${subject}: the request failed.`, { status: exchange.status });
        case "response_too_large":
          return closed("response_too_large", `${subject}: the answer exceeded the row's body ceiling.`, { status: exchange.status });
        case "unexpected_content_type":
          return closed("unexpected_content_type", `${subject}: the answer's media type is not one the transport reads.`, { status: exchange.status });
        default:
          return closed("egress_refused", `${subject}: the egress boundary refused the request (${exchange.code}); nothing was sent.`, { egressCode: exchange.code });
      }
    }
    responseBytes = exchange.bytes.byteLength;
    const status = exchange.status;
    // [B20 A1 review] a stream handed back unread (`streamBody`) is consumed on exactly one path — a 200 to a request; on
    // every other path it is closed here, since the egress deadline no longer covers it and nothing else ever would
    const discard = (): void => discardStream(exchange.body, "mcp transport: answer refused");
    if (sent.id === null) {
      // a notification: 202 with no body (a null stream is no body), nothing else
      if (status === 202) {
        if (exchange.bytes.byteLength !== 0) return closed("protocol_violation", `${subject}: a 202 to a notification carried a body.`, { status });
        if (exchange.body === undefined || exchange.body === null) return finish({ ok: true, kind: "accepted" });
        // [B20 A1 review-2] on the wire a bodiless 202 is a NON-null stream that ends at once, and one typed text/event-stream is
        // handed off unread: it is probed — a budget of no byte at all, under the remaining deadline and at most 1 s — not refused
        let probe: BoundedStreamResult;
        try {
          probe = await readBoundedStream(exchange.body, 0, { signal: options.signal, deadlineMs: Math.min(ACCEPTED_PROBE_MAX_MS, remainingMs()) });
        } catch {
          // [B20 A1 review-3] the shared reader takes its reader outside any catch: a body that is already locked rejects here
          probe = { ok: false, reason: "unreadable" };
        }
        if (probe.ok) return finish({ ok: true, kind: "accepted" });
        discard(); // the probe cancelled its reader; a pre-aborted probe never took one, nor did one a locked body refused (best effort)
        if (probe.reason === "aborted") return closed("aborted", `${subject}: the request was aborted.`);
        if (probe.reason === "unreadable") return closed("network_error", `${subject}: the answer's body could not be read.`, { status });
        return closed("protocol_violation", probe.reason === "over-limit" ? `${subject}: a 202 to a notification carried a body.` : `${subject}: a 202 to a notification kept its body open.`, { status });
      }
      discard();
      return closed("unexpected_status", `${subject}: HTTP ${status} to a notification.`, { status });
    }
    if (status !== 200) {
      discard();
      return closed("unexpected_status", `${subject}: HTTP ${status} to a request.`, { status });
    }
    if (exchange.contentType.startsWith("application/json")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(exchange.bytes));
      } catch {
        return closed("protocol_violation", `${subject}: the answer is not JSON.`, { status });
      }
      return finish(interpretResponse(server, parsed as JsonRpcMessage, sent.id, era, status, { notifications: [], notificationsDropped: 0 }, redact));
    }
    if (exchange.contentType.startsWith("text/event-stream")) {
      // the response event may be as large as a JSON body would be: the row's ceiling bounds the event and the stream alike
      let stream: SseJsonRpcResult;
      try {
        stream = await readSseJsonRpc(exchange.body ?? null, { awaitId: sent.id, maxEventBytes: server.limits.maxResponseBytes, maxTotalBytes: server.limits.maxResponseBytes, deadlineMs: remainingMs(), signal: options.signal });
      } catch {
        // [B20 A1 review-3] the reader settles a stream it cannot take a reader on; whatever else throws in it is the same closed outcome
        discard();
        stream = sseUnreadable();
      }
      responseBytes = stream.bytes;
      if (!stream.ok) {
        if (stream.code === "sse_timeout") return closed("timeout", `${subject}: no response on the event stream within ${server.limits.deadlineMs} ms.`);
        if (stream.code === "sse_aborted") return closed("aborted", `${subject}: the request was aborted; the event stream was closed.`);
        return closed("stream_failed", `${subject}: ${stream.message}`, { sseCode: stream.code, status });
      }
      // [B20 A1 review-2] one budget for the call: the scrub's work is bounded whatever the row's ceiling let through
      const budget: ScrubBudget = { chars: 0 };
      const scrubbed = stream.notifications.map((notification) => scrubNotification(notification, redact, budget));
      const seen = { notifications: scrubbed.map((entry) => entry.message), notificationsDropped: scrubbed.filter((entry) => entry.dropped).length };
      return finish(interpretResponse(server, stream.response, sent.id, era, status, seen, redact));
    }
    // a foreign type was read (under the row's ceiling) by the egress path: there is no stream to close here
    return closed("unexpected_content_type", `${subject}: expected application/json or text/event-stream, received ${exchange.contentType === "" ? "no content type" : nameableMediaType(exchange.contentType, redact) ?? "an unrecognised media type"}.`, { status });
  }

  /** A 400..599 answer (the error-body rule of the egress path): the status, the header subset and the bounded body. */
  function interpretStatus(status: number, headers: OutboundHeaders | undefined, bytes: Uint8Array | undefined, bodyDropped: boolean): McpPostResult {
    // [B20 A1 review-2] an application/json error body the egress path dropped for its size (over 64 KiB) may have been a modern
    // server's -32020/-32021/-32022 or -32601: the answer is unusable, and it is NEVER read as an older revision for the era probe
    const tooLarge = (): McpPostResult => closed("response_too_large", `${subject}: HTTP ${status} with an error body over ${MCP_ERROR_BODY_MAX_BYTES} bytes, which was not read; the answer cannot be classified.`, { status });
    const contentType = mediaTypeOf(headers);
    const rpc = jsonRpcObjectOf(bytes, contentType);
    const error = rpc === null ? null : errorObjectOf(rpc, redact);
    const challenge = parseBearerChallenge(headers?.["www-authenticate"], redact);
    switch (status) {
      case 400: {
        if (error === null) {
          // [B20 A1 review] RFC 6750 invalid_request: a Bearer challenge on a 400 is the credential's problem, never an older revision
          if (challenge !== null) return finish({ ok: false, kind: "unauthorized", httpStatus: status, challenge });
          if (bodyDropped) return tooLarge();
          return closed("legacy_or_unknown", `${subject}: HTTP 400 without a recognisable JSON-RPC error (an older revision, or not an MCP endpoint).`, { status });
        }
        const data = isPlainObject(error.data) ? error.data : {};
        if (error.code === MCP_ERROR_HEADER_MISMATCH) return closed("header_mismatch", `${subject}: the server reports a header/body mismatch (-32020).`, { status });
        if (error.code === MCP_ERROR_MISSING_CLIENT_CAPABILITY) {
          // capability NAMES only: no free text, no secret shape, never the sent token
          const isCapabilityName = (entry: string): boolean => CAPABILITY_NAME_PATTERN.test(entry) && !containsTokenAnchoredSecretShapedText(entry) && !skeletonCarries(entry, redact);
          return closed("missing_client_capability", `${subject}: the server requires a client capability this client did not declare (-32021).`, { status, requiredCapabilities: boundedStringList(data.requiredCapabilities, LIST_MAX_ENTRIES, isCapabilityName) });
        }
        if (error.code === MCP_ERROR_UNSUPPORTED_PROTOCOL_VERSION) {
          return closed("unsupported_protocol_version", `${subject}: the server does not speak ${protocolVersion} (-32022).`, { status, supported: boundedStringList(data.supported, VERSIONS_MAX_ENTRIES, (entry) => PROTOCOL_VERSION_PATTERN.test(entry)) });
        }
        return finish({ ok: false, kind: "error", code: error.code, message: error.message, httpStatus: status });
      }
      case 401:
        return finish({ ok: false, kind: "unauthorized", httpStatus: status, challenge });
      case 403:
        return finish({ ok: false, kind: "forbidden", httpStatus: status, challenge });
      case 404:
        if (error !== null && error.code === JSON_RPC_METHOD_NOT_FOUND) return closed("method_not_found", `${subject}: the server does not implement ${method} (-32601).`, { status });
        if (bodyDropped) return tooLarge();
        return closed("legacy_or_unknown", `${subject}: HTTP 404 without a JSON-RPC method-not-found error (an older revision, or not an MCP endpoint).`, { status });
      case 405:
        if (bodyDropped) return tooLarge();
        return closed("legacy_or_unknown", `${subject}: HTTP 405 (an older revision, or not an MCP endpoint).`, { status });
      case 429:
        return closed("rate_limited", `${subject}: HTTP 429; requests are paused.`, { status, retryAfterSeconds: retryAfterSeconds(headers) });
      default:
        if (status >= 500 && status <= 599) return closed("server_error", `${subject}: HTTP ${status}.`, { status, retryAfterSeconds: retryAfterSeconds(headers) });
        return closed("unexpected_status", `${subject}: HTTP ${status}.`, { status });
    }
  }
}

/**
 * How an outcome counts for the row's breaker: the server's fault opens it, a coherent refusal does not.
 * [B20 A1 review] An egress refusal counts as a failure, as `distributorJson` counts it: after `endpointMatches` the only
 * codes that can reach it are the resolver's (`dns_failed`, `address_blocked`), and a half-open trial that never reaches
 * the server must not close an open breaker. [B20 A1 review-2] For the same reason our own abort is "inconclusive", not
 * "neutral" (which closes an open breaker): as the trial it re-opens the breaker, otherwise it counts nothing either way.
 */
function breakerOutcome(result: McpPostResult): McpRequestOutcome {
  switch (result.kind) {
    case "accepted":
    case "complete":
    case "input_required":
      return "success";
    case "error":
    case "unauthorized":
    case "forbidden":
      return "neutral";
    case "closed":
      switch (result.code) {
        case "rate_limited": return "rate_limited";
        // [B20 A1 review-2] our own abort judged no answer of the server's: as the half-open trial it must not close the breaker
        case "aborted": return "inconclusive";
        case "header_mismatch":
        case "missing_client_capability":
        case "unsupported_protocol_version":
        case "legacy_or_unknown":
        case "method_not_found":
          return "neutral";
        default:
          return "failure";
      }
  }
}
