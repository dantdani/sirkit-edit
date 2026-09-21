/**
 * [B20 A2] Negotiation of Sirkit's MCP client on the CURRENT specification revision 2026-07-28: one `server/discover`
 * through the transport (`mcpPost`), one validated DiscoverResult, one negotiated version every later call carries
 * (`artifacts/ai-control-plane-b20/mcp-reference-notes.md` sections 2, 3 and 7; discovery D20-18; OD-41, OD-42).
 *
 * The client NEGOTIATES and nothing else. It sends exactly one method, never `initialize` (the 2025-11-25 handshake era
 * is A2b: a server that answers the modern probe as an older revision is the typed closed outcome `legacy_server` and
 * NOTHING else is sent), never fulfils an `input_required` round trip, never retries more than once, and never obtains a
 * credential by itself (A3: the transport's injected provider answers, and `unauthorized` / `forbidden` are handed back
 * with their challenge untouched).
 *
 * What the server says is DATA, never a decision and never an instruction:
 *  - `supportedVersions` must be a bounded list (at most 16) of revision dates; entries that are not are dropped and
 *    COUNTED, never echoed. The negotiated version is the NEWEST revision both the row and the server list, taken only
 *    from the row's current-era revisions — the compatibility revision is never negotiated here, and a server that has
 *    only that in common with a row which lists the compatibility era is `legacy_server` (A2b), else `no_common_version`.
 *  - `capabilities` is read for `tools` alone (and `tools.listChanged` as a boolean); every other capability, extension
 *    and key is ignored and never copied. A server without the `tools` capability is `no_tools_capability`.
 *  - `instructions` and the serverInfo of `result._meta` are DISPLAY-ONLY (`McpUntrustedDisplay`): inert, bounded,
 *    labelled untrusted. They decide nothing here and MUST NEVER be given to a model as instructions (A4 enforces that
 *    at the observation boundary).
 *  - `ttlMs` and `cacheScope` are the caching hints discovery (A2, `tool-discovery.ts`) may honour, each validated to a
 *    closed range and otherwise 0 / "private".
 * Every retained string passes the transport's scrub with the token this row would send as a redaction subject, and its
 * case-folded skeleton comparison: a text that carries the credential in ANY spelling is replaced whole (S1, S2).
 * [B20 A2 review-2] That comparison runs BEFORE the display bound cuts (`scrubDisplayText`), over the scrub's own window.
 * `discoverMcpServer` never throws and never rejects: whatever fails is a closed outcome with a FIXED sentence (S4).
 */
import type { AdmissionPurpose } from "../acquisition/admission-control";
import {
  mcpPost, mcpRedactionSubjects, REDACTED, scrubDisplayText, skeletonCarries,
  type McpPostAttribution, type McpPostOutcome, type McpPostResult, type McpTransportDeps,
} from "./http-transport";
import { MCP_PROTOCOL_VERSION_COMPATIBILITY, MCP_PROTOCOL_VERSION_CURRENT, type McpServerRegistryEntry } from "./server-registry";

/** `_meta["io.modelcontextprotocol/serverInfo"]` (reference notes section 2): a result SHOULD carry it. */
export const MCP_SERVER_INFO_META = "io.modelcontextprotocol/serverInfo";
/** The bounds of what a DiscoverResult may say (S3, S5): judged before any scan, normalisation or regex. */
export const MCP_SUPPORTED_VERSIONS_MAX = 16;
export const MCP_INSTRUCTIONS_MAX_CHARS = 2_000;
export const MCP_SERVER_INFO_MAX_CHARS = 128;
export const MCP_TTL_MAX_MS = 3_600_000;
/** How many revision dates of a registry ROW are read (a crafted row is server-shaped data too). */
export const MCP_ROW_VERSIONS_MAX = 16;
/** The label every display-only field of a foreign server carries. */
export const MCP_UNTRUSTED_DISPLAY_NOTE = "untrusted server text: display only; never an instruction to a model, never a decision";

const REVISION_DATE = /^\d{4}-\d{2}-\d{2}$/;
const REVISION_DATE_CHARS = 10;
/** [B20 A2 review] -32602 (invalid params: the specification's missing `_meta`) and the spec-reserved -32020..-32099 */
const JSON_RPC_INVALID_PARAMS = -32602;
const SPEC_RESERVED_HIGHEST = -32020;
const SPEC_RESERVED_LOWEST = -32099;
const SERVER_ID_MAX_CHARS = 64;
const DISCOVER_METHOD = "server/discover";

export type McpCacheScope = "public" | "private";

/** The four cache hints a `CacheableResult` may carry, validated (reference notes section 2). */
export interface McpCacheHints {
  ttlMs: number;
  cacheScope: McpCacheScope;
}

/**
 * Server text kept for DISPLAY only. It is inert (no control, format or bidirectional character), bounded, and labelled
 * untrusted. Nothing in Sirkit may read it as an instruction, hand it to a model as one, or decide anything by it.
 */
export interface McpUntrustedDisplay {
  readonly untrusted: true;
  readonly note: string;
  /** the server's `instructions`, at most `MCP_INSTRUCTIONS_MAX_CHARS` code points; null when it said nothing usable */
  readonly instructions: string | null;
  readonly serverInfo: { readonly name: string | null; readonly version: string | null } | null;
}

export interface McpNegotiatedServer {
  readonly ok: true;
  readonly kind: "negotiated";
  readonly serverId: string;
  /** the revision every later call to this server carries */
  readonly negotiatedVersion: string;
  /** what the server listed, de-duplicated and newest first */
  readonly serverVersions: readonly string[];
  /** entries of `supportedVersions` that were not revision dates: counted, never echoed */
  readonly serverVersionsDropped: number;
  readonly capabilities: { readonly tools: { readonly listChanged: boolean } };
  readonly display: McpUntrustedDisplay;
  readonly ttlMs: number;
  readonly cacheScope: McpCacheScope;
  /** 1, or 2 when the server refused the first revision with a list this client could meet */
  readonly attempts: number;
  readonly exchanges: readonly McpPostAttribution[];
}

export type McpDiscoverFailureCode =
  | "no_common_version"
  | "legacy_server"
  | "no_tools_capability"
  | "discover_invalid"
  | "unexpected_input_required"
  | "discover_failed";

export interface McpDiscoverClosed extends McpPostAttribution {
  readonly ok: false;
  readonly kind: "closed";
  readonly code: McpDiscoverFailureCode;
  readonly message: string;
  /** `legacy_server` only: whether the ROW lists the compatibility era (A2b may speak the handshake with it) */
  readonly compatibilityEraListed?: boolean;
}

/** Every transport outcome that is not a `complete` answer is handed back exactly as the transport classified it. */
export type McpPassedThroughOutcome = McpPostAttribution & Exclude<Extract<McpPostOutcome, { ok: false }>, { kind: "input_required" }>;

export type McpDiscoverOutcome = McpNegotiatedServer | McpDiscoverClosed | McpPassedThroughOutcome;

export interface McpDiscoverOptions {
  purpose: AdmissionPurpose;
  signal?: AbortSignal;
  deps?: McpTransportDeps;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isAdmissionPurpose = (value: unknown): value is AdmissionPurpose => value === "interactive" || value === "agent";

/** The row's id as an outcome may name it: a bounded string, or nothing at all — a row that cannot be read names nothing. */
function safeServerId(server: McpServerRegistryEntry): string {
  try {
    const id: unknown = (server as { id?: unknown }).id;
    return typeof id === "string" && id.length <= SERVER_ID_MAX_CHARS ? id : "";
  } catch {
    return "";
  }
}

function attributionOf(serverId: string, post: McpPostResult): McpPostAttribution {
  return { serverId, protocolVersion: post.protocolVersion, method: post.method, elapsedMs: post.elapsedMs, requestBytes: post.requestBytes, responseBytes: post.responseBytes };
}

function emptyAttribution(serverId: string): McpPostAttribution {
  return { serverId, protocolVersion: "", method: DISCOVER_METHOD, elapsedMs: 0, requestBytes: 0, responseBytes: 0 };
}

function closed(attribution: McpPostAttribution, code: McpDiscoverFailureCode, sentence: string, extra: { compatibilityEraListed?: boolean } = {}): McpDiscoverClosed {
  return Object.freeze({ ...attribution, ok: false, kind: "closed", code, message: sentence, ...extra });
}

/**
 * The revision dates of a list, de-duplicated and newest first, with the entries that were not counted. The length is
 * judged by the CALLER and each entry by its length before the pattern runs: a megabyte-long entry meets no regex (S5).
 */
function readVersions(raw: readonly unknown[], max: number): { kept: string[]; dropped: number } {
  const kept: string[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (let index = 0; index < raw.length && index < max; index += 1) {
    const entry = raw[index];
    if (typeof entry !== "string" || entry.length !== REVISION_DATE_CHARS || !REVISION_DATE.test(entry)) {
      dropped += 1;
      continue;
    }
    if (seen.has(entry)) continue;
    seen.add(entry);
    kept.push(entry);
  }
  kept.sort((left, right) => (left < right ? 1 : left > right ? -1 : 0));
  return { kept, dropped };
}

interface RowVersions {
  /** the row's revisions of the CURRENT era (>= 2026-07-28), newest first */
  current: readonly string[];
  /** the row lists the compatibility revision AND declares the compatibility era (OD-41) */
  compatibilityEraListed: boolean;
}

function readRow(server: McpServerRegistryEntry): RowVersions {
  let listed: unknown;
  try {
    listed = (server as { supportedProtocolVersions?: unknown }).supportedProtocolVersions;
  } catch {
    listed = undefined;
  }
  if (!Array.isArray(listed)) return { current: [], compatibilityEraListed: false };
  const { kept } = readVersions(listed, MCP_ROW_VERSIONS_MAX);
  let era = false;
  try {
    era = (server as { compatibilityEra?: unknown }).compatibilityEra === true;
  } catch {
    era = false;
  }
  return {
    current: kept.filter((version) => version >= MCP_PROTOCOL_VERSION_CURRENT),
    compatibilityEraListed: era && kept.includes(MCP_PROTOCOL_VERSION_COMPATIBILITY),
  };
}

/**
 * [B20 A2 review] Whether a JSON-RPC error answering the probe is one a modern (2026-07-28) server sends: -32602 or a code of
 * the spec-reserved range. The legacy range -32000..-32019, -32601 on a 2xx (a modern server answers an unknown method
 * 404), the other standard codes and application codes are NOT recognised, and an unrecognised error means legacy.
 */
function isModernProbeError(code: number): boolean {
  return code === JSON_RPC_INVALID_PARAMS || (code <= SPEC_RESERVED_HIGHEST && code >= SPEC_RESERVED_LOWEST);
}

/** An integer 0..3 600 000, else 0 — NaN, an infinity, a negative, a fraction, a string and a huge value all fall back (S3). */
export function readTtlMs(raw: unknown): number {
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= MCP_TTL_MAX_MS ? raw : 0;
}

/** "public" or "private" exactly; anything else is the private (never shared across principals) scope. */
export function readCacheScope(raw: unknown): McpCacheScope {
  return raw === "public" ? "public" : "private";
}

/**
 * Server text as this client keeps it: scrubbed by the transport's own scrub (inert, bounded, secret shapes and the sent
 * token redacted) and compared CASE-FOLDED against the token by the transport's skeleton predicate — a text that carries the
 * credential in any spelling is replaced whole (S2). Null when it is not a string or says nothing.
 * [B20 A2 review-2] The comparison ran on what the display bound had KEPT, so a whole upper-cased token straddling the bound
 * survived as its prefix. `scrubDisplayText` compares over the scrub's own window before any cut; what it keeps is compared
 * once more (bounded, and cheap).
 */
export function displayText(raw: unknown, maxChars: number, redact: readonly string[]): string | null {
  if (typeof raw !== "string") return null;
  const text = scrubDisplayText(raw, maxChars, redact);
  if (text === "") return null;
  return skeletonCarries(text, redact, true) ? REDACTED : text;
}

function readDisplay(result: Record<string, unknown>, redact: readonly string[]): McpUntrustedDisplay {
  const instructions = displayText(result.instructions, MCP_INSTRUCTIONS_MAX_CHARS, redact);
  let serverInfo: { readonly name: string | null; readonly version: string | null } | null = null;
  const meta: unknown = result._meta;
  if (isPlainObject(meta) && Object.hasOwn(meta, MCP_SERVER_INFO_META)) {
    const info: unknown = meta[MCP_SERVER_INFO_META];
    if (isPlainObject(info)) {
      serverInfo = Object.freeze({
        name: displayText(info.name, MCP_SERVER_INFO_MAX_CHARS, redact),
        version: displayText(info.version, MCP_SERVER_INFO_MAX_CHARS, redact),
      });
    }
  }
  return Object.freeze({ untrusted: true, note: MCP_UNTRUSTED_DISPLAY_NOTE, instructions, serverInfo });
}

// ── The negotiation brand ─────────────────────────────────────────────────────

const negotiations = new WeakSet<object>();

/**
 * Whether this exact object is a negotiation THIS client produced. Every later call (`tools/list`, `tools/call`) takes
 * its protocol version from one, so a caller can never hand a forged or copied version to the wire.
 */
export function isNegotiatedMcpServer(value: unknown): value is McpNegotiatedServer {
  return typeof value === "object" && value !== null && negotiations.has(value);
}

// ── Request ids ───────────────────────────────────────────────────────────────

let requestCounter = 0;

/** A JSON-RPC id unique among this process's in-flight requests (base protocol, reference notes section 7). */
export function nextMcpRequestId(): number {
  requestCounter = requestCounter >= Number.MAX_SAFE_INTEGER - 1 ? 1 : requestCounter + 1;
  return requestCounter;
}

// ── discoverMcpServer ─────────────────────────────────────────────────────────

/**
 * Negotiate with one admitted registry row: one `server/discover` in the current era with the row's newest listed
 * revision, at most one retry when the server refuses with a list this client can meet, and one validated result.
 * Never throws, never rejects (S4).
 */
export async function discoverMcpServer(server: McpServerRegistryEntry, options: McpDiscoverOptions): Promise<McpDiscoverOutcome> {
  try {
    return await negotiate(server, options);
  } catch {
    return closed(emptyAttribution(safeServerId(server)), "discover_failed", "MCP client: the negotiation failed unexpectedly; nothing of it was classified.");
  }
}

async function negotiate(server: McpServerRegistryEntry, options: McpDiscoverOptions): Promise<McpDiscoverOutcome> {
  const serverId = safeServerId(server);
  const subject = `MCP server "${serverId}"`;
  if (!isPlainObject(options) || !isAdmissionPurpose(options.purpose)) {
    return closed(emptyAttribution(serverId), "discover_failed", "MCP client: the negotiation options name no admission purpose; nothing was sent.");
  }
  const deps = options.deps;
  const row = readRow(server);
  if (row.current.length === 0) {
    return row.compatibilityEraListed
      ? closed(emptyAttribution(serverId), "legacy_server", `${subject}: the row lists only the compatibility revision; the handshake era is not implemented in this increment.`, { compatibilityEraListed: true })
      : closed(emptyAttribution(serverId), "no_common_version", `${subject}: the row lists no protocol revision of the current era; nothing was sent.`);
  }
  // the token this row would send, as a redaction subject only: every string this client RETAINS is compared against it
  const redact = await mcpRedactionSubjects(server, deps);

  const exchanges: McpPostAttribution[] = [];
  const tried = new Set<string>();
  let version = row.current[0]!;
  for (let attempt = 1; ; attempt += 1) {
    tried.add(version);
    const post = await mcpPost(
      server,
      { jsonrpc: "2.0", id: nextMcpRequestId(), method: DISCOVER_METHOD, params: {} },
      { purpose: options.purpose, era: "current", protocolVersion: version, signal: options.signal, deps },
    );
    const attribution = attributionOf(serverId, post);
    exchanges.push(attribution);

    if (post.kind === "complete") return interpretDiscoverResult(subject, attribution, row, post.result, exchanges, attempt, redact);
    if (post.kind === "input_required") {
      return closed(attribution, "unexpected_input_required", `${subject}: ${DISCOVER_METHOD} answered an input_required result, which the specification allows only on prompts/get, resources/read and tools/call; nothing was fulfilled.`);
    }
    if (post.kind === "accepted") return closed(attribution, "discover_invalid", `${subject}: ${DISCOVER_METHOD} was answered as a notification would be.`);
    // [B20 A2 review] the probe rule of the notes (section 3): only a RECOGNISED modern JSON-RPC error means modern — the
    // 2025-11-25 SDK answers the probe 400 + -32000, a stateless handshake-era server 200 + -32601
    // [B20 A2 review-2] it reads the PROBE only: a retry follows a -32022, which only the current revision defines, so the
    // server has proved it modern — an unrecognised error, a `legacy_or_unknown` or a `method_not_found` answering the retry is
    // passed through as A1 classified it. [B20 A2 review-4] Exactly that: the retry's own -32022, result, input_required and
    // accepted answer are still interpreted (below and above), and its -32022 may be `legacy_server` by the rule below
    const probe = attempt === 1;
    if (probe && post.kind === "error" && !isModernProbeError(post.code)) {
      return closed(attribution, "legacy_server", `${subject}: the server answered ${DISCOVER_METHOD} with a JSON-RPC error no current-revision server sends; the handshake era is not implemented in this increment.`, { compatibilityEraListed: row.compatibilityEraListed });
    }
    if (post.kind !== "closed") return post as McpPassedThroughOutcome;
    if (probe && (post.code === "legacy_or_unknown" || post.code === "method_not_found")) {
      return closed(attribution, "legacy_server", `${subject}: the server did not answer ${DISCOVER_METHOD} as the current revision defines it; the handshake era is not implemented in this increment.`, { compatibilityEraListed: row.compatibilityEraListed });
    }
    if (post.code !== "unsupported_protocol_version") return post as McpPassedThroughOutcome;

    // -32022: exactly ONE retry, with the newest revision the row and the server's own list both name
    const offered = Array.isArray(post.supported) ? post.supported : [];
    const next = attempt === 1 ? row.current.find((candidate) => !tried.has(candidate) && offered.includes(candidate)) : undefined;
    if (next !== undefined) {
      version = next;
      continue;
    }
    // [B20 A2 review-4] no retry follows — on the probe the list names no current-era revision of the row not yet tried, and
    // the retry is never retried — so the list decides: it INCLUDES the compatibility revision (whatever else it lists) on a
    // row that declares that era, or the two sides have nothing this client can speak
    if (row.compatibilityEraListed && offered.includes(MCP_PROTOCOL_VERSION_COMPATIBILITY)) {
      return closed(attribution, "legacy_server", `${subject}: the server's refusal lists the compatibility revision and no current revision this client can still try; the handshake era is not implemented in this increment.`, { compatibilityEraListed: true });
    }
    return closed(attribution, "no_common_version", `${subject}: the server and the row list no protocol revision in common.`);
  }
}

/** The DiscoverResult, validated strictly: nothing of it is copied, and nothing of it decides anything but the version. */
function interpretDiscoverResult(
  subject: string,
  attribution: McpPostAttribution,
  row: RowVersions,
  result: unknown,
  exchanges: readonly McpPostAttribution[],
  attempts: number,
  redact: readonly string[],
): McpDiscoverOutcome {
  if (!isPlainObject(result)) return closed(attribution, "discover_invalid", `${subject}: the DiscoverResult is not an object.`);
  const listed: unknown = result.supportedVersions;
  if (!Array.isArray(listed) || listed.length === 0 || listed.length > MCP_SUPPORTED_VERSIONS_MAX) {
    return closed(attribution, "discover_invalid", `${subject}: supportedVersions is not a list of at most ${MCP_SUPPORTED_VERSIONS_MAX} revisions.`);
  }
  const capabilities: unknown = result.capabilities;
  if (!isPlainObject(capabilities)) return closed(attribution, "discover_invalid", `${subject}: capabilities is not an object.`);

  const { kept, dropped } = readVersions(listed, MCP_SUPPORTED_VERSIONS_MAX);
  const negotiatedVersion = row.current.find((candidate) => kept.includes(candidate));
  if (negotiatedVersion === undefined) {
    return row.compatibilityEraListed && kept.includes(MCP_PROTOCOL_VERSION_COMPATIBILITY)
      ? closed(attribution, "legacy_server", `${subject}: the newest revision both sides list is the compatibility revision; the handshake era is not implemented in this increment.`, { compatibilityEraListed: true })
      : closed(attribution, "no_common_version", `${subject}: the server and the row list no protocol revision in common.`);
  }

  const tools: unknown = Object.hasOwn(capabilities, "tools") ? capabilities.tools : undefined;
  if (!isPlainObject(tools)) return closed(attribution, "no_tools_capability", `${subject}: the server declares no tools capability.`);
  const listChanged = Object.hasOwn(tools, "listChanged") && tools.listChanged === true;

  const negotiated: McpNegotiatedServer = Object.freeze({
    ok: true,
    kind: "negotiated",
    serverId: attribution.serverId,
    negotiatedVersion,
    serverVersions: Object.freeze(kept),
    serverVersionsDropped: dropped,
    capabilities: Object.freeze({ tools: Object.freeze({ listChanged }) }),
    display: readDisplay(result, redact),
    ttlMs: readTtlMs(result.ttlMs),
    cacheScope: readCacheScope(result.cacheScope),
    attempts,
    exchanges: Object.freeze([...exchanges]),
  });
  negotiations.add(negotiated);
  return negotiated;
}
