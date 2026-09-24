/**
 * [B20 A4] The SERVER port behind the agent's one external tool read, `sirkit.mcp.observation-read` (OD-74..OD-77): the roster
 * of approved MCP servers, one server's pinned catalog, and one call of an accepted tool, observed.
 *
 * Server only: it reaches the MCP transport and the authorization client, so the chat route reaches it through exactly one file,
 * `app/api/chat/mcp-observation-runtime.ts` (the chat import-closure ratchet pins that), and the agent boundary
 * (`app/lib/agent/mcp-observation-reads.ts`) decides what may be asked and what a model may read. It composes what A0-A3 built:
 *  - the roster: approved, flag-admitted, not operator-disabled rows (`admittedMcpServer`) that carry a descriptor pin, are not
 *    `prohibited` for an agent, have an id the run trace can record and name at least one agent-callable tool; sorted by id, at
 *    most 16; no request is sent for it;
 *  - [B20 A4L] the row's per-tool allowlist (`agentTools`, the OD-74 amendment): only the tools its operator approved are
 *    offered or called — in `tools` after the roster row, in `call` after the screen below, always before anything is
 *    negotiated, listed, admitted or sent; it narrows what A2 accepted, never admits, and reads no annotation. A row that
 *    approves NOTHING never reaches this step: the roster drops it, so nothing is negotiated, listed or sent for it at all;
 *  - `call`, FIRST — after the roster row, before any negotiation, listing, admission or request — the argument screen (OD-75):
 *    arguments that carry a run identifier (the tenant, project, branch, run and principal ids, every context digest and each
 *    digest's bare hexadecimal part) or a credential Sirkit holds for the row, in any spelling (the case-folded skeleton), are
 *    refused and nothing is sent;
 *  - one negotiation per server for the port's life (one run), reused only within its `ttlMs` on the injected clock; the listing
 *    under the agent purpose and a principal-scoped cache key, refused unless pinned and complete; the exact accepted name;
 *  - the call under the agent purpose with ONE redaction collector: seeded with the tokens held for the row and grown by every
 *    token the call sends on A3's path, so a token that expires during the call is still compared with the result; for a row
 *    A3 does not collect for (every mode but client-credentials under its provider) the tokens held when the call ENDED join
 *    the subjects too, so a credential the environment rotated to between the seed and the send is compared as well;
 *  - the observation (`normalizeMcpToolResult`), or one closed port code per outcome (D18); an authorization-server request is
 *    never counted as sent.
 * Every answer names the server, the tool (or none), the registry version, the negotiated revision and the listing digest (when
 * known) and whether the MCP request its outcome is about was sent (`sent`; the trace's `not_sent` class reads it). It never
 * rejects: it composes its own deadline with the caller's signal, and whatever throws is `port_failed`. It writes nothing and
 * keeps no result.
 */
import { containsSecretShapedText } from "../agent/redaction";
import type {
  McpObservationCallAnswer, McpObservationCallRequest, McpObservationPort, McpObservationToolsAnswer, McpObservationToolsRequest, McpPortAttribution, McpPortCatalogTool, McpPortRefusalCode, McpPortRosterRow,
} from "../agent/mcp-observation-reads";
import { canonicalJson, sha256 } from "../atomic/stable";
import { fixtureRuntimeEnabled } from "../fixture-runtime/mode";
import { inertExternalText } from "../net/external-href";
import type { OutboundDeps } from "../net/outbound-fetch";
import { createMcpRedactionCollector, isMcpAuthorizationProvider, MCP_AUTHORIZATION_FAILURE_CODES, mcpAuthorizationTokenProvider } from "./authorization";
import { mcpTextReadsAsDirective, type McpAcceptedTool } from "./foreign-tools";
import { mcpRedactionSubjects, skeletonCarries, type McpTokenProvider, type McpTransportDeps } from "./http-transport";
import { discoverMcpServer, type McpNegotiatedServer } from "./negotiation";
import { mcpObservationArgumentsDigest, normalizeMcpToolResult } from "./observation";
import { admittedMcpServer, MCP_AGENT_TOOLS_MAX, MCP_SERVER_ID_PATTERN, MCP_SERVER_REGISTRY, MCP_SERVER_REGISTRY_VERSION, type McpServerRegistryEntry } from "./server-registry";
import { callMcpTool } from "./tool-call";
import { listMcpTools, type McpToolListing } from "./tool-discovery";

export type {
  McpObservationCallAnswer, McpObservationCallRequest, McpObservationPort, McpObservationToolsAnswer, McpObservationToolsRequest, McpPortAttribution, McpPortCatalogTool, McpPortRefusalCode, McpPortRosterRow,
} from "../agent/mcp-observation-reads";

/** The roster's bound, the catalog's, and the deadline range a request may name. */
export const MCP_AGENT_ROSTER_MAX = 16;
export const MCP_AGENT_CATALOG_TOOLS_MAX = 32;
const DEADLINE_DEFAULT_MS = 15_000;
const DEADLINE_MAX_MS = 30_000;
const RUN_IDENTIFIERS_MAX = 32;
const RUN_IDENTIFIER_MAX_CHARS = 256;
const RUN_IDENTIFIER_MIN_CHARS = 8;
const PRINCIPAL_MAX_CHARS = 256;
const UNKNOWN_SERVER = "unknown";
const REVISION_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
/** a prefixed digest (`eng1-<hex>`, `sha256:<hex>`): its bare hexadecimal part is a run identifier too */
const PREFIXED_HEX = /^[A-Za-z0-9]+[-:_]([0-9a-fA-F]{8,})$/;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface McpAgentPrincipal { tenantId: string; projectId: string; principalId: string }
export interface McpAgentPortDeps { fetch?: OutboundDeps["fetch"]; resolve?: OutboundDeps["resolve"]; tokenProvider?: McpTokenProvider }
export interface McpAgentPortOptions {
  principal: McpAgentPrincipal;
  /** TEST SEAM: a registry revision; production reads the committed registry */
  entries?: readonly McpServerRegistryEntry[];
  /** the environment the flag, the operator list and the credential NAMES are read from; production: `process.env` */
  env?: Readonly<Record<string, string | undefined>>;
  clock?: () => number;
  deps?: McpAgentPortDeps;
}
/** The server's policy for one chat run (decided by the route from the trusted request context, never by the model). */
export interface McpAgentPortPolicy { humanPrincipal: boolean; tenantId: string; projectId: string; principalId: string }
export type McpAgentPortSeams = Omit<McpAgentPortOptions, "principal">;

/** One port's state: its options and its per-server negotiations (one run). */
export interface McpAgentPortRuntime {
  readonly entries: readonly McpServerRegistryEntry[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clock: () => number;
  readonly deps: McpTransportDeps;
  readonly principalScopeKey: string;
  readonly negotiations: Map<string, { negotiated: McpNegotiatedServer; at: number }>;
}

type Stage = "negotiation" | "listing" | "call";
export interface McpPortRefusal { code: McpPortRefusalCode; sent: boolean; retryAtMs: number | null }

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const finiteOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function readClock(runtime: McpAgentPortRuntime): number {
  try {
    const value: unknown = runtime.clock();
    return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
  } catch {
    return Number.NaN;
  }
}

function attribution(serverId: string, toolName: string | null, negotiated: McpNegotiatedServer | null, listing: McpToolListing | null, sent: boolean): McpPortAttribution {
  const version: unknown = negotiated?.negotiatedVersion;
  const digest: unknown = listing?.digest;
  return {
    serverId: MCP_SERVER_ID_PATTERN.test(serverId) ? serverId : UNKNOWN_SERVER,
    toolName: toolName !== null && TOOL_NAME_PATTERN.test(toolName) ? toolName : null,
    registryVersion: MCP_SERVER_REGISTRY_VERSION,
    protocolVersion: typeof version === "string" && REVISION_DATE.test(version) ? version : null,
    listingDigest: typeof digest === "string" && DIGEST_PATTERN.test(digest) ? digest : null,
    sent,
  };
}

function refused(base: McpPortAttribution, refusal: McpPortRefusal): McpObservationCallAnswer & McpObservationToolsAnswer {
  return Object.freeze({ ok: false as const, kind: "refused" as const, ...base, sent: refusal.sent, code: refusal.code, retryAtMs: refusal.retryAtMs }) as McpObservationCallAnswer & McpObservationToolsAnswer;
}

const PRE_SEND_OURS: ReadonlySet<string> = new Set(["invalid_request", "reserved_meta", "protocol_version_unsupported", "endpoint_mismatch"]);
const TOKEN_CODES: ReadonlySet<string> = new Set(["token_unavailable", "token_malformed", "token_unexpected"]);
const PAUSE_CODES: ReadonlySet<string> = new Set(["concurrency_exhausted", "admission_refused"]);
const A3_CODES: ReadonlySet<string> = new Set(MCP_AUTHORIZATION_FAILURE_CODES);
const A3_PAUSED: ReadonlySet<string> = new Set(["authorization_paused", "authorization_backoff", "token_requests_exhausted"]);
const NEGOTIATION_CODES: ReadonlySet<string> = new Set(["no_common_version", "legacy_server", "no_tools_capability", "discover_invalid", "unexpected_input_required", "discover_failed"]);
const LISTING_CODES: ReadonlySet<string> = new Set(["not_negotiated", "list_invalid", "cursor_invalid", "cursor_loop", "unexpected_input_required", "list_failed"]);

/**
 * D18: the closed port code of an outcome that is not an observation, whether the operation's final MCP request was SENT, and a
 * retry time only from our own admission's or A3's own pause. A3's closures never count as sent (a request to the authorization
 * server is not an MCP request). `stage` names the step whose own closed codes are read. Never throws.
 */
export function mcpPortRefusalOf(outcome: unknown, stage: Stage = "call"): McpPortRefusal {
  const of = (code: McpPortRefusalCode, sent: boolean, retryAtMs: number | null = null): McpPortRefusal => ({ code, sent, retryAtMs });
  try {
    if (!isPlainObject(outcome)) return of("port_failed", false);
    const kind: unknown = outcome.kind;
    if (kind === "input_required") return of("input_required_unsupported", true);
    if (kind === "error") return of("upstream_error", true);
    if (kind === "unauthorized" || kind === "forbidden") return of("authorization_failed", true);
    const code: unknown = outcome.code;
    if (kind !== "closed" || typeof code !== "string") return of("port_failed", false);
    if (A3_CODES.has(code)) {
      if (A3_PAUSED.has(code)) return of("paused", false, finiteOrNull(outcome.retryAtMs));
      return code === "authorization_aborted" ? of("cancelled", false) : of("authorization_failed", false);
    }
    if (PAUSE_CODES.has(code)) return of("paused", false, finiteOrNull((outcome.pause as { retryAtMs?: unknown } | undefined)?.retryAtMs));
    if (TOKEN_CODES.has(code)) return of("authorization_failed", false);
    if (PRE_SEND_OURS.has(code)) return of("port_failed", false);
    if (code === "aborted") return of("cancelled", true);
    if (code === "egress_refused") return of("transport_failed", false);
    if (stage === "negotiation" && NEGOTIATION_CODES.has(code)) return of("negotiation_failed", true);
    if (stage === "listing") {
      if (code === "descriptor_pin_mismatch") return of("listing_pin_mismatch", true);
      if (LISTING_CODES.has(code)) return of("listing_failed", true);
    }
    if (stage === "call") {
      if (code === "input_required_unsupported") return of("input_required_unsupported", true);
      if (code === "arguments_invalid" || code === "arguments_too_large") return of(code, false);
      if (code === "not_accepted" || code === "not_negotiated" || code === "call_failed") return of("port_failed", false);
    }
    // every other closed code of the transport is an answer the server gave, or failed to give, to a request that was sent
    return of("transport_failed", true);
  } catch {
    return of("port_failed", false);
  }
}

/**
 * The run identifiers the argument screen compares with (OD-75): each identifier of at least 8 characters and the bare
 * hexadecimal part of every prefixed digest (`eng1-<hex>` gives `<hex>`), bounded (the length first), de-duplicated.
 */
export function mcpRunIdentifierSubjects(identifiers: unknown): string[] {
  const out = new Set<string>();
  try {
    if (!Array.isArray(identifiers)) return [];
    for (let index = 0; index < Math.min(identifiers.length, RUN_IDENTIFIERS_MAX); index += 1) {
      const identifier: unknown = identifiers[index];
      if (typeof identifier !== "string" || identifier.length > RUN_IDENTIFIER_MAX_CHARS) continue;
      if (identifier.length >= RUN_IDENTIFIER_MIN_CHARS) out.add(identifier);
      const hex = PREFIXED_HEX.exec(identifier)?.[1];
      if (hex !== undefined) out.add(hex);
    }
  } catch {
    return [...out];
  }
  return [...out];
}

// ── The roster ────────────────────────────────────────────────────────────────

/**
 * [B20 A4L] The tools the row's operator made agent-callable (`agentTools`, OD-74 amendment): the names of its allowlist,
 * bounded and pattern-checked HERE too, because a crafted revision reaches the port without passing the validator. Fail
 * closed — a row without a list allows nothing — and it only NARROWS: a name it holds that the pinned listing does not, or
 * that the descriptor gates (A2) did not accept, is still `unknown_tool`. Annotations are never read: the server's hints
 * grant nothing in either direction (OD-81), the operator's list is the rule. Pure; never throws.
 *
 * [B20 A4L review] The bound fails closed exactly as the VALIDATOR judges it (`agent-tools`: the count is judged before any
 * entry meets the pattern), so a crafted list longer than the bound approves NOTHING. Truncating it to its first names would
 * admit names no reviewer ever read — with a writing tool named first among them, the very hole A4L closes — while the
 * reviewed answer for that row is "it approves nothing". A read that throws part way leaves nothing approved either.
 */
export function mcpAgentToolAllowlist(row: McpServerRegistryEntry): ReadonlySet<string> {
  const names = new Set<string>();
  try {
    const list: unknown = row?.agentTools;
    if (!Array.isArray(list) || list.length > MCP_AGENT_TOOLS_MAX) return names;
    for (const name of list as readonly unknown[]) {
      if (typeof name === "string" && TOOL_NAME_PATTERN.test(name)) names.add(name);
    }
  } catch {
    names.clear();
    return names;
  }
  return names;
}

/**
 * The rows an agent may be offered: approved and flag-admitted (`admittedMcpServer`: an operator-disabled row is refused), with a
 * descriptor pin, not `prohibited`, with an id the run trace can record (the unanchored secret classifier: `task-manager-docs`
 * spells `sk-manager-docs`); sorted by id, at most 16. [B20 A4L review] And naming at least one agent-callable tool: a row whose
 * `agentTools` approves nothing can never answer a catalog or a call, so it is dropped HERE rather than offered — otherwise a
 * whole-catalog request for it would negotiate and list against the third party, carrying the row's credential, and spend one of
 * the run's four operations, for an answer that is empty by construction. Pure: nothing is sent. Never throws.
 */
export function mcpAgentRoster(entries: readonly McpServerRegistryEntry[], env: Readonly<Record<string, string | undefined>>): readonly McpServerRegistryEntry[] {
  try {
    const rows: McpServerRegistryEntry[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const id: unknown = entry?.id;
      if (typeof id !== "string" || seen.has(id)) continue;
      seen.add(id);
      const admission = admittedMcpServer(id, env, entries);
      if (!admission.admitted) continue;
      const row = admission.entry;
      if (row.descriptorPin?.toolsListDigest === null || row.descriptorPin?.toolsListDigest === undefined) continue;
      if (row.agentDisclosure === "prohibited" || containsSecretShapedText(row.id)) continue;
      if (mcpAgentToolAllowlist(row).size === 0) continue; // [B20 A4L review] a row that approves no tool is no roster row
      rows.push(row);
    }
    return Object.freeze(rows.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)).slice(0, MCP_AGENT_ROSTER_MAX));
  } catch {
    return Object.freeze([]);
  }
}

/** The roster row for `serverId`, or why there is none (nothing is sent either way). */
function rosterRow(runtime: McpAgentPortRuntime, serverId: string): { ok: true; row: McpServerRegistryEntry } | { ok: false; refusal: McpPortRefusal } {
  const row = mcpAgentRoster(runtime.entries, runtime.env).find((entry) => entry.id === serverId);
  if (row !== undefined) return { ok: true, row };
  const admission = admittedMcpServer(serverId, runtime.env, runtime.entries);
  if (admission.admitted && admission.entry.agentDisclosure === "prohibited") return { ok: false, refusal: { code: "disclosure_prohibited", sent: false, retryAtMs: null } };
  if (admission.admitted && (admission.entry.descriptorPin?.toolsListDigest ?? null) === null) return { ok: false, refusal: { code: "listing_unpinned", sent: false, retryAtMs: null } };
  return { ok: false, refusal: { code: "server_unavailable", sent: false, retryAtMs: null } };
}

// ── The pipeline ──────────────────────────────────────────────────────────────

/** The caller's signal composed with this port's own deadline: which of the two ended the operation is told apart. */
function composeSignal(request: { signal?: unknown; deadlineMs?: unknown }): { signal: AbortSignal; expired: () => boolean; cancelled: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  const outer = request.signal instanceof AbortSignal ? request.signal : null;
  const raw = request.deadlineMs;
  const deadlineMs = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, DEADLINE_MAX_MS) : DEADLINE_DEFAULT_MS;
  let expired = false;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, deadlineMs);
  const onAbort = (): void => controller.abort();
  if (outer?.aborted) controller.abort();
  else outer?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    expired: () => expired,
    cancelled: () => outer?.aborted === true,
    dispose: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

/** A cancellation that was this port's own deadline is a transport failure, never the caller's cancellation. */
function ownDeadline(refusal: McpPortRefusal, composed: { expired: () => boolean; cancelled: () => boolean }): McpPortRefusal {
  return refusal.code === "cancelled" && composed.expired() && !composed.cancelled() ? { code: "transport_failed", sent: refusal.sent, retryAtMs: null } : refusal;
}

async function negotiate(runtime: McpAgentPortRuntime, row: McpServerRegistryEntry, signal: AbortSignal): Promise<{ ok: true; negotiated: McpNegotiatedServer } | { ok: false; refusal: McpPortRefusal }> {
  const now = readClock(runtime);
  const memo = runtime.negotiations.get(row.id);
  if (memo !== undefined && Number.isFinite(now) && now >= memo.at && now - memo.at < memo.negotiated.ttlMs) return { ok: true, negotiated: memo.negotiated };
  const outcome = await discoverMcpServer(row, { purpose: "agent", signal, deps: runtime.deps });
  if (outcome.kind === "negotiated") {
    if (Number.isFinite(now)) runtime.negotiations.set(row.id, { negotiated: outcome, at: now });
    return { ok: true, negotiated: outcome };
  }
  return { ok: false, refusal: mcpPortRefusalOf(outcome, "negotiation") };
}

async function listing(runtime: McpAgentPortRuntime, row: McpServerRegistryEntry, negotiated: McpNegotiatedServer, signal: AbortSignal): Promise<{ ok: true; listing: McpToolListing } | { ok: false; refusal: McpPortRefusal; listing: McpToolListing | null }> {
  const outcome = await listMcpTools(row, negotiated, { purpose: "agent", signal, deps: runtime.deps, principalScopeKey: runtime.principalScopeKey });
  if (outcome.kind !== "tools") return { ok: false, refusal: mcpPortRefusalOf(outcome, "listing"), listing: null };
  if (outcome.pinned !== true) return { ok: false, refusal: { code: "listing_unpinned", sent: true, retryAtMs: null }, listing: outcome };
  if (outcome.truncated !== false) return { ok: false, refusal: { code: "listing_truncated", sent: true, retryAtMs: null }, listing: outcome };
  return { ok: true, listing: outcome };
}

/** One catalog entry: the accepted input schema and the A2 display text re-read as one judged string (T9: withheld when it trips). */
function catalogEntry(tool: McpAcceptedTool): McpPortCatalogTool {
  const text = (value: string | null): string | null => (value !== null && mcpTextReadsAsDirective(value) === "clean" ? value : null);
  return Object.freeze({ name: tool.name, inputSchema: tool.inputSchema, title: text(tool.title), description: text(tool.description) });
}

/** `tools`: one server's pinned catalog (every accepted tool, at most 32), or one accepted tool of it by exact name. */
export async function listMcpToolsForAgent(runtime: McpAgentPortRuntime, request: McpObservationToolsRequest): Promise<McpObservationToolsAnswer> {
  const serverId = isPlainObject(request) && typeof request.serverId === "string" ? request.serverId : "";
  const toolName = isPlainObject(request) && typeof request.toolName === "string" && request.toolName !== "" ? request.toolName : null;
  let composed: ReturnType<typeof composeSignal> | null = null;
  try {
    const found = rosterRow(runtime, serverId);
    if (!found.ok) return refused(attribution(serverId, toolName, null, null, false), found.refusal);
    // [B20 A4L] the row's allowlist, BEFORE anything is negotiated, listed or sent: a name its operator did not approve is
    // `unknown_tool` exactly as a name no server holds is
    const allowed = mcpAgentToolAllowlist(found.row);
    if (toolName !== null && !allowed.has(toolName)) return refused(attribution(serverId, toolName, null, null, false), { code: "unknown_tool", sent: false, retryAtMs: null });
    composed = composeSignal(request);
    const negotiation = await negotiate(runtime, found.row, composed.signal);
    if (!negotiation.ok) return refused(attribution(serverId, toolName, null, null, false), ownDeadline(negotiation.refusal, composed));
    const listed = await listing(runtime, found.row, negotiation.negotiated, composed.signal);
    if (!listed.ok) return refused(attribution(serverId, toolName, negotiation.negotiated, listed.listing, false), ownDeadline(listed.refusal, composed));
    // the catalog offers only ACCEPTED tools the allowlist names (it narrows what A2 accepted; it never adds to it)
    const offered = listed.listing.tools.filter((tool) => allowed.has(tool.name));
    const tools = toolName === null ? offered : offered.filter((tool) => tool.name === toolName);
    const base = attribution(serverId, null, negotiation.negotiated, listed.listing, true);
    if (toolName !== null && tools.length === 0) return refused(base, { code: "unknown_tool", sent: true, retryAtMs: null });
    return Object.freeze({ ok: true as const, kind: "catalog" as const, ...base, tools: Object.freeze(tools.slice(0, MCP_AGENT_CATALOG_TOOLS_MAX).map(catalogEntry)), toolsTotal: tools.length });
  } catch {
    return refused(attribution(serverId, toolName, null, null, false), { code: "port_failed", sent: false, retryAtMs: null });
  } finally {
    composed?.dispose();
  }
}

/**
 * `call` — the binding symbol of `sirkit.mcp.observation-read`: the roster row; the argument screen (nothing sent); the
 * negotiation (memo); the pinned, complete listing; the exact accepted name; the call under the agent purpose with one redaction
 * collector; then the observation, normalised against every credential the call held, or one closed port code.
 */
export async function callMcpToolForAgent(runtime: McpAgentPortRuntime, request: McpObservationCallRequest): Promise<McpObservationCallAnswer> {
  const serverId = isPlainObject(request) && typeof request.serverId === "string" ? request.serverId : "";
  const toolName = isPlainObject(request) && typeof request.toolName === "string" ? request.toolName : "";
  let composed: ReturnType<typeof composeSignal> | null = null;
  try {
    const found = rosterRow(runtime, serverId);
    if (!found.ok) return refused(attribution(serverId, toolName, null, null, false), found.refusal);
    const row = found.row;
    const args: unknown = request.arguments;
    if (!isPlainObject(args)) return refused(attribution(serverId, toolName, null, null, false), { code: "arguments_invalid", sent: false, retryAtMs: null });
    // OD-75: the screen, FIRST — nothing is negotiated, listed, admitted or sent for arguments that disclose the run or a credential
    const canonical = canonicalJson(args);
    if (skeletonCarries(canonical, mcpRunIdentifierSubjects(request.runIdentifiers), true)) {
      return refused(attribution(serverId, toolName, null, null, false), { code: "arguments_disclose_run_identity", sent: false, retryAtMs: null });
    }
    if (skeletonCarries(canonical, await mcpRedactionSubjects(row, runtime.deps), true)) {
      return refused(attribution(serverId, toolName, null, null, false), { code: "arguments_secret_shaped", sent: false, retryAtMs: null });
    }
    // [B20 A4L] the row's allowlist (OD-74 amendment), still before any negotiation, listing, admission or request: a tool its
    // operator did not approve answers the same `unknown_tool` and nothing is sent. The screen (OD-75) stays first.
    if (!mcpAgentToolAllowlist(row).has(toolName)) return refused(attribution(serverId, toolName, null, null, false), { code: "unknown_tool", sent: false, retryAtMs: null });
    composed = composeSignal(request);
    const negotiation = await negotiate(runtime, row, composed.signal);
    if (!negotiation.ok) return refused(attribution(serverId, toolName, null, null, false), ownDeadline(negotiation.refusal, composed));
    const negotiated = negotiation.negotiated;
    const listed = await listing(runtime, row, negotiated, composed.signal);
    if (!listed.ok) return refused(attribution(serverId, toolName, negotiated, listed.listing, false), ownDeadline(listed.refusal, composed));
    const tool = listed.listing.tools.find((candidate) => candidate.name === toolName);
    if (tool === undefined) return refused(attribution(serverId, toolName, negotiated, listed.listing, false), { code: "unknown_tool", sent: false, retryAtMs: null });
    const collector = createMcpRedactionCollector(await mcpRedactionSubjects(row, runtime.deps));
    const outcome = await callMcpTool(row, negotiated, tool, args, { purpose: "agent", signal: composed.signal, deps: runtime.deps, redaction: collector });
    // [B20 A4 review] coverage-05: the collector grows only on A3's path — `mcpPostAuthorized` hands `mcpPost` the options
    // WITHOUT it for every other row — so for those rows the tokens held when the call ENDED join the subjects too, and a
    // credential the environment rotated to between the seed and the send is compared with the result as well. A union of
    // readings only adds subjects; on the A3 path the collector alone is authoritative (it holds a token that expired mid-call).
    const collected = row.auth?.mode === "client-credentials-env" && isMcpAuthorizationProvider(runtime.deps.tokenProvider);
    const subjects = collected ? collector.subjects() : [...new Set([...collector.subjects(), ...(await mcpRedactionSubjects(row, runtime.deps))])];
    const base = attribution(serverId, toolName, negotiated, listed.listing, true);
    if (!(outcome.ok === true && outcome.kind === "complete")) return refused({ ...base, sent: false }, ownDeadline(mcpPortRefusalOf(outcome, "call"), composed));
    const argumentsDigest = mcpObservationArgumentsDigest(args);
    if (argumentsDigest === null) return refused(base, { code: "port_failed", sent: true, retryAtMs: null });
    const normalized = normalizeMcpToolResult({ server: row, negotiated, listing: listed.listing, tool, outcome, argumentsDigest, clock: runtime.clock, subjects });
    if (!normalized.ok) {
      const code: McpPortRefusalCode = normalized.code === "result_invalid" || normalized.code === "clock_invalid" ? normalized.code : "port_failed";
      return refused(base, { code, sent: true, retryAtMs: null });
    }
    return Object.freeze({ ok: true as const, kind: "observation" as const, ...base, observation: normalized.observation });
  } catch {
    return refused(attribution(serverId, toolName, null, null, false), { code: "port_failed", sent: false, retryAtMs: null });
  } finally {
    composed?.dispose();
  }
}

// ── Construction ──────────────────────────────────────────────────────────────

function principalScopeKeyOf(principal: McpAgentPrincipal): string {
  return `p:${sha256(canonicalJson([principal.tenantId, principal.projectId, principal.principalId])).slice(0, 40)}`;
}

/** A port over the given options (tests pass fakes; the runtime passes only the server's policy). One port serves one run. */
export function createMcpAgentPort(options: McpAgentPortOptions): McpObservationPort {
  const entries = options.entries ?? MCP_SERVER_REGISTRY;
  const env = options.env ?? process.env;
  const clock = options.clock ?? Date.now;
  const deps: McpTransportDeps = {
    ...(options.deps?.fetch ? { fetch: options.deps.fetch } : {}),
    ...(options.deps?.resolve ? { resolve: options.deps.resolve } : {}),
    clock,
    environment: env,
    tokenProvider: options.deps?.tokenProvider ?? mcpAuthorizationTokenProvider,
  };
  const runtime: McpAgentPortRuntime = { entries, env, clock, deps, principalScopeKey: principalScopeKeyOf(options.principal), negotiations: new Map() };
  return Object.freeze({
    servers: (): readonly McpPortRosterRow[] => {
      try {
        return Object.freeze(mcpAgentRoster(runtime.entries, runtime.env).map((row) => Object.freeze({ serverId: row.id, title: inertExternalText(row.title, 120) ?? "", registryVersion: MCP_SERVER_REGISTRY_VERSION })));
      } catch {
        return Object.freeze([]);
      }
    },
    tools: (request: McpObservationToolsRequest) => listMcpToolsForAgent(runtime, request),
    call: (request: McpObservationCallRequest) => callMcpToolForAgent(runtime, request),
  });
}

const boundedPrincipalString = (value: unknown): value is string => typeof value === "string" && value !== "" && value.length <= PRINCIPAL_MAX_CHARS;

/**
 * The production port for one chat run, or null to withhold the tool: a principal that is not a human, the fixture runtime, or an
 * empty roster (the committed registry is empty today, OD-48, and the flag is off unless exactly "1"). Only the flag, the
 * operator list and the fixture switch are read from the environment here; no value is read into anything. Never throws.
 */
export function resolveMcpAgentPort(policy: McpAgentPortPolicy, seams: McpAgentPortSeams = {}): McpObservationPort | null {
  try {
    if (!isPlainObject(policy) || policy.humanPrincipal !== true) return null;
    if (!boundedPrincipalString(policy.tenantId) || !boundedPrincipalString(policy.projectId) || !boundedPrincipalString(policy.principalId)) return null;
    const env = seams.env ?? process.env;
    if (fixtureRuntimeEnabled(env as Record<string, string | undefined>)) return null;
    const entries = seams.entries ?? MCP_SERVER_REGISTRY;
    if (mcpAgentRoster(entries, env).length === 0) return null;
    return createMcpAgentPort({ principal: { tenantId: policy.tenantId, projectId: policy.projectId, principalId: policy.principalId }, entries, env, ...(seams.clock ? { clock: seams.clock } : {}), ...(seams.deps ? { deps: seams.deps } : {}) });
  } catch {
    return null;
  }
}
