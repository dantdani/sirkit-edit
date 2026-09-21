/**
 * [B20 A2] `tools/list` as Sirkit's client reads it: bounded paging, a listing digest compared against the registry's
 * `descriptorPin` (the pin half of D20-20), the foreign-descriptor gates of `foreign-tools.ts`, and a bounded
 * per-process cache that honours `ttlMs` / `cacheScope` (reference notes sections 2 and 6; OD-57 for the first-party
 * side, which this increment does not touch).
 *
 * The listing is an ADAPTER read: it grants nothing, executes nothing and admits nothing by itself. Every request goes
 * through the transport with the version a NEGOTIATION produced (`negotiation.ts` — a forged or copied negotiation is
 * refused, so a caller can never put a version of its own on the wire), the cursor rules are the client's and not the
 * server's (bounded, inert, never repeated, never carrying the credential), and the digest is computed over the
 * server's own definitions REDUCED to the six fields that describe a tool — so a server cannot change a tool without
 * changing the digest, while no server text is ever echoed. When the row carries a pin and the digest differs, NO tool
 * is returned; when the row has no pin, the listing is marked `pinned: false` (A4 refuses an unpinned listing for the
 * agent; an operator may list it to compute the pin).
 *
 * The cache is per process (OD-53's limit, stated on the boundary page), bounded to `MCP_TOOL_CACHE_MAX` entries with
 * the least recently used evicted, keyed by server id, negotiated version and — for a PRIVATE listing — the caller's
 * principal scope key, so a private listing is never served to another principal. `ttlMs: 0` is never cached, the clock
 * is injected, and what is stored is the accepted descriptors and the digest: never the token, never raw server text.
 * [B20 A2 review] The key names its scope EXPLICITLY (no principal spelling can name the shared slot) and carries what the
 * stored acceptance depended on — the row's pin and a digest of the caller's reserved provider names — so a hit is only
 * ever a listing judged under the same pin and the same reserved set. An entry records when it was stored: a clock that
 * steps back before that, or that answers no number, is a miss and stores nothing.
 */
import { canonicalJson, sha256 } from "../atomic/stable";
import type { AdmissionPurpose } from "../acquisition/admission-control";
import { acceptForeignTools, boundedJsonCopy, MCP_TOOLS_PER_SERVER_MAX, type McpAcceptedTool, type McpToolExclusion } from "./foreign-tools";
import { mcpPost, mcpRedactionSubjects, skeletonCarries, type McpPostAttribution, type McpTransportDeps } from "./http-transport";
import {
  isNegotiatedMcpServer, nextMcpRequestId, readCacheScope, readTtlMs,
  type McpCacheScope, type McpNegotiatedServer, type McpPassedThroughOutcome,
} from "./negotiation";
import type { McpServerRegistryEntry } from "./server-registry";

export const MCP_TOOL_PAGES_MAX = 20;
export const MCP_TOOL_CURSOR_MAX_CHARS = 1_024;
export const MCP_TOOL_CACHE_MAX = 64;
/** What a caller's principal scope key may be: a bounded, inert identifier, so a cache key is never free text. */
export const MCP_PRINCIPAL_SCOPE_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
/** The bounds the digest reduction works under (S5): a deep or enormous definition is bounded before it is hashed. */
const DIGEST_MAX_DEPTH = 32;
const DIGEST_MAX_NODES = 200_000;
const DIGEST_UNREADABLE = "(over the digest bounds)";
const LIST_METHOD = "tools/list";
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;
/** [B20 A2 review] a row pin a cache key may carry as it is; any other string can never equal a digest, so it keys one fixed slot nothing is stored in */
const PIN_KEY_MAX_CHARS = 128;

export interface McpListToolsOptions {
  purpose: AdmissionPurpose;
  signal?: AbortSignal;
  deps?: McpTransportDeps;
  /** the principal a PRIVATE listing belongs to; without a usable one a private listing is simply not cached */
  principalScopeKey?: string;
  /** provider names another source already holds; a foreign name that maps onto one is excluded */
  reservedProviderNames?: Iterable<string>;
}

export type McpToolListFailureCode =
  | "not_negotiated"
  | "list_invalid"
  | "cursor_invalid"
  | "cursor_loop"
  | "descriptor_pin_mismatch"
  | "unexpected_input_required"
  | "list_failed";

export interface McpToolListing {
  readonly ok: true;
  readonly kind: "tools";
  readonly serverId: string;
  readonly negotiatedVersion: string;
  readonly tools: readonly McpAcceptedTool[];
  readonly excluded: readonly McpToolExclusion[];
  /** `sha256:<64 hex>` over the server's own definitions, reduced and sorted by name */
  readonly digest: string;
  /** the row's `descriptorPin.toolsListDigest` matched; false when the row carries no pin */
  readonly pinned: boolean;
  readonly ttlMs: number;
  readonly cacheScope: McpCacheScope;
  readonly pages: number;
  readonly considered: number;
  readonly notRead: number;
  /** the listing is incomplete: a cap stopped the walk, or definitions past the tool cap were counted, not read */
  readonly truncated: boolean;
  readonly cached: boolean;
  readonly exchanges: readonly McpPostAttribution[];
}

export interface McpToolListClosed extends McpPostAttribution {
  readonly ok: false;
  readonly kind: "closed";
  readonly code: McpToolListFailureCode;
  readonly message: string;
}

export type McpToolListOutcome = McpToolListing | McpToolListClosed | McpPassedThroughOutcome;

// ── The digest ────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One value as the digest reads it: a bounded iterative copy, or a fixed marker when it is past the bounds. */
function digestValue(value: unknown): unknown {
  const copied = boundedJsonCopy(value, DIGEST_MAX_DEPTH, DIGEST_MAX_NODES);
  return copied.ok ? copied.value : DIGEST_UNREADABLE;
}

/**
 * The listing digest: sha256 over the canonical JSON (the repository's helper: sorted keys, stable numbers) of the
 * server's definitions REDUCED to `{name, title, description, inputSchema, outputSchema, annotations}` and sorted by
 * name. It is computed over the RAW values (bounded), so a server cannot change a tool without changing the digest —
 * and it is a hash: no server text is ever echoed by it. `icons`, `_meta` and every unknown field are not covered.
 */
export function mcpToolsListDigest(definitions: readonly unknown[]): string {
  const reduced = definitions.slice(0, MCP_TOOLS_PER_SERVER_MAX).map((definition) => {
    if (!isPlainObject(definition)) return { name: null, definition: digestValue(definition) };
    return {
      name: typeof definition.name === "string" ? definition.name : null,
      title: digestValue(definition.title),
      description: digestValue(definition.description),
      inputSchema: digestValue(definition.inputSchema),
      outputSchema: digestValue(definition.outputSchema),
      annotations: digestValue(definition.annotations),
    };
  });
  const canonical = reduced.map((entry) => canonicalJson(entry));
  canonical.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return `sha256:${sha256(canonicalJson(canonical))}`;
}

// ── The cache ─────────────────────────────────────────────────────────────────

interface CacheEntry {
  serverId: string;
  /** [B20 A2 review] when it was stored and for how long: an entry is live only while `storedAt <= now < storedAt + ttlMs` */
  storedAt: number;
  ttlMs: number;
  listing: McpToolListing;
}

const cache = new Map<string, CacheEntry>();

/** [B20 A2 review] What a stored acceptance depended on besides the server: the row's pin and the caller's reserved names. */
interface CacheContext {
  pin: string | null;
  reservedDigest: string;
}

/**
 * [B20 A2 review] The key of one cache slot, serialised as JSON (so no part can run into another), with its scope EXPLICIT:
 * a private slot always carries a principal and a public one never does — the principal spelled "public" used to BE the
 * shared slot's key.
 */
function cacheKey(serverId: string, version: string, principal: string | null, context: CacheContext): string {
  const scope = principal === null ? ["public"] : ["private", principal];
  return JSON.stringify([...scope, serverId, version, context.pin, context.reservedDigest]);
}

/** [B20 A2 review] The row's pin as a cache key reads it: absent is null; a string past any digest's length is one fixed marker. */
function pinOf(server: McpServerRegistryEntry): { value: unknown; key: string | null } {
  const value: unknown = (server as { descriptorPin?: { toolsListDigest?: unknown } }).descriptorPin?.toolsListDigest;
  if (typeof value !== "string") return { value, key: null };
  return { value, key: value.length <= PIN_KEY_MAX_CHARS ? value : "(a pin that is no digest)" };
}

/** [B20 A2 review] The caller's reserved provider names: strings only, de-duplicated and sorted, so their digest is stable. */
function reservedOf(options: McpListToolsOptions): string[] {
  const given = options.reservedProviderNames;
  if (given === undefined || given === null) return [];
  return [...new Set(Array.from(given).filter((entry): entry is string => typeof entry === "string"))].sort();
}

/** The caller's principal scope key when it is one, else null: a private listing is then never cached. */
function principalOf(options: McpListToolsOptions): string | null {
  const key = options.principalScopeKey;
  return typeof key === "string" && MCP_PRINCIPAL_SCOPE_PATTERN.test(key) ? key : null;
}

/** Test and operator hook: forget every cached listing. */
export function resetMcpToolCache(): void {
  cache.clear();
}

export function mcpToolCacheSize(): number {
  return cache.size;
}

/** Forget every cached listing of one server (a `header_mismatch` on a call, an operator action). */
export function invalidateMcpToolListing(serverId: string): void {
  for (const [key, entry] of [...cache]) if (entry.serverId === serverId) cache.delete(key);
}

function readCache(serverId: string, version: string, principal: string | null, context: CacheContext, now: number): McpToolListing | null {
  const keys = principal === null ? [cacheKey(serverId, version, null, context)] : [cacheKey(serverId, version, principal, context), cacheKey(serverId, version, null, context)];
  for (const key of keys) {
    const entry = cache.get(key);
    if (entry === undefined) continue;
    // [B20 A2 review] live only inside [storedAt, storedAt + ttlMs): a clock that stepped back never lengthens a life
    if (now < entry.storedAt || now - entry.storedAt >= entry.ttlMs) {
      cache.delete(key);
      continue;
    }
    cache.delete(key); // least recently used goes out first: re-inserting moves this entry to the end
    cache.set(key, entry);
    return entry.listing;
  }
  return null;
}

function writeCache(listing: McpToolListing, principal: string | null, context: CacheContext, now: number): void {
  if (listing.ttlMs <= 0) return;
  if (listing.cacheScope === "private" && principal === null) return;
  const key = cacheKey(listing.serverId, listing.negotiatedVersion, listing.cacheScope === "private" ? principal : null, context);
  cache.delete(key);
  cache.set(key, { serverId: listing.serverId, storedAt: now, ttlMs: listing.ttlMs, listing });
  while (cache.size > MCP_TOOL_CACHE_MAX) {
    const oldest = cache.keys().next();
    if (oldest.done === true) break;
    cache.delete(oldest.value);
  }
}

// ── listMcpTools ──────────────────────────────────────────────────────────────

function attributionOf(serverId: string, post: { protocolVersion: string; method: string; elapsedMs: number; requestBytes: number; responseBytes: number }): McpPostAttribution {
  return { serverId, protocolVersion: post.protocolVersion, method: post.method, elapsedMs: post.elapsedMs, requestBytes: post.requestBytes, responseBytes: post.responseBytes };
}

function emptyAttribution(serverId: string): McpPostAttribution {
  return { serverId, protocolVersion: "", method: LIST_METHOD, elapsedMs: 0, requestBytes: 0, responseBytes: 0 };
}

function closed(attribution: McpPostAttribution, code: McpToolListFailureCode, sentence: string): McpToolListClosed {
  return Object.freeze({ ...attribution, ok: false, kind: "closed", code, message: sentence });
}

/** List one admitted server's tools under a negotiation this client produced. Never throws, never rejects (S4). */
export async function listMcpTools(server: McpServerRegistryEntry, negotiated: McpNegotiatedServer, options: McpListToolsOptions): Promise<McpToolListOutcome> {
  let serverId = "";
  try {
    const id: unknown = (server as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id.length <= 64) serverId = id;
  } catch {
    serverId = "";
  }
  try {
    return await listOnce(server, serverId, negotiated, options);
  } catch {
    return closed(emptyAttribution(serverId), "list_failed", "MCP client: the listing failed unexpectedly; nothing of it was classified.");
  }
}

async function listOnce(server: McpServerRegistryEntry, serverId: string, negotiated: McpNegotiatedServer, options: McpListToolsOptions): Promise<McpToolListOutcome> {
  const subject = `MCP server "${serverId}"`;
  if (!isPlainObject(options) || (options.purpose !== "interactive" && options.purpose !== "agent")) {
    return closed(emptyAttribution(serverId), "list_failed", "MCP client: the listing options name no admission purpose; nothing was sent.");
  }
  if (!isNegotiatedMcpServer(negotiated) || negotiated.serverId !== serverId || serverId === "") {
    return closed(emptyAttribution(serverId), "not_negotiated", `${subject}: a listing needs a negotiation this client produced for this row; nothing was sent.`);
  }
  const version = negotiated.negotiatedVersion;
  const deps = options.deps;
  const clock = typeof deps?.clock === "function" ? deps.clock : Date.now;
  const principal = principalOf(options);
  // [B20 A2 review] what the acceptance depends on besides the server: the key carries both, so a hit never skips them
  const pin = pinOf(server);
  const reserved = reservedOf(options);
  const context: CacheContext = { pin: pin.key, reservedDigest: reserved.length === 0 ? "" : sha256(canonicalJson(reserved)) };

  // [B20 A2 review] a clock that answers no number neither reads nor writes the cache (it used to read as 0, forever)
  const read: unknown = clock();
  const now = typeof read === "number" && Number.isFinite(read) ? read : null;
  const cached = now === null ? null : readCache(serverId, version, principal, context, now);
  if (cached !== null) return Object.freeze({ ...cached, cached: true });

  const redact = await mcpRedactionSubjects(server, deps);
  const exchanges: McpPostAttribution[] = [];
  const definitions: unknown[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let ttlMs = Number.POSITIVE_INFINITY;
  let cacheScope: McpCacheScope = "public";
  let notRead = 0;
  let pages = 0;
  let truncated = false;

  for (; pages < MCP_TOOL_PAGES_MAX;) {
    pages += 1;
    const post = await mcpPost(
      server,
      { jsonrpc: "2.0", id: nextMcpRequestId(), method: LIST_METHOD, params: cursor === undefined ? {} : { cursor } },
      { purpose: options.purpose, era: "current", protocolVersion: version, signal: options.signal, deps },
    );
    const attribution = attributionOf(serverId, post);
    exchanges.push(attribution);
    if (post.kind === "input_required") {
      return closed(attribution, "unexpected_input_required", `${subject}: ${LIST_METHOD} answered an input_required result, which the specification allows only on prompts/get, resources/read and tools/call.`);
    }
    if (post.kind !== "complete") return post as McpPassedThroughOutcome;

    const result = post.result;
    const listed: unknown = isPlainObject(result) ? result.tools : undefined;
    if (!Array.isArray(listed)) return closed(attribution, "list_invalid", `${subject}: a ${LIST_METHOD} page carries no tools array.`);
    const room = Math.max(0, MCP_TOOLS_PER_SERVER_MAX - definitions.length);
    const taken = Math.min(room, listed.length);
    for (let index = 0; index < taken; index += 1) definitions.push(listed[index]);
    notRead += listed.length - taken;
    // [B20 A2 review] definitions past the tool cap were counted, not read: the listing is incomplete, cursor or not
    if (taken < listed.length) truncated = true;
    ttlMs = Math.min(ttlMs, readTtlMs(isPlainObject(result) ? result.ttlMs : undefined));
    if (readCacheScope(isPlainObject(result) ? result.cacheScope : undefined) === "private") cacheScope = "private";

    const next: unknown = isPlainObject(result) ? result.nextCursor : undefined;
    if (next === undefined || next === null) break;
    if (typeof next !== "string" || next.length === 0 || next.length > MCP_TOOL_CURSOR_MAX_CHARS || CONTROL_OR_FORMAT.test(next) || skeletonCarries(next, redact, true)) {
      return closed(attribution, "cursor_invalid", `${subject}: the page cursor is not a bounded, inert string of this client's own alphabet.`);
    }
    if (seenCursors.has(next)) return closed(attribution, "cursor_loop", `${subject}: ${LIST_METHOD} repeated a page cursor; the walk would not end.`);
    seenCursors.add(next);
    cursor = next;
    if (definitions.length >= MCP_TOOLS_PER_SERVER_MAX) {
      truncated = true;
      break;
    }
    if (pages >= MCP_TOOL_PAGES_MAX) truncated = true;
  }

  const digest = mcpToolsListDigest(definitions);
  if (typeof pin.value === "string" && pin.value !== digest) {
    return closed(exchanges.at(-1) ?? emptyAttribution(serverId), "descriptor_pin_mismatch", `${subject}: the listing does not match the reviewed descriptor pin; no tool of this server is offered.`);
  }
  const set = acceptForeignTools(server, definitions, { redact, reservedProviderNames: reserved });
  const listing: McpToolListing = Object.freeze({
    ok: true,
    kind: "tools",
    serverId,
    negotiatedVersion: version,
    tools: set.accepted,
    excluded: set.excluded,
    digest,
    pinned: typeof pin.value === "string",
    ttlMs: Number.isFinite(ttlMs) ? ttlMs : 0,
    cacheScope,
    pages,
    considered: set.considered,
    notRead: notRead + set.notRead,
    truncated,
    cached: false,
    exchanges: Object.freeze(exchanges),
  });
  if (now !== null) writeCache(listing, principal, context, now);
  return listing;
}
