/**
 * [B20 A2] `tools/call` as Sirkit's client prepares and sends it (reference notes sections 3 and 6).
 *
 * The client CALLS and nothing else: it validates the arguments against the ACCEPTED input schema with the
 * repository's own deterministic validator (`app/lib/engineering/tool-io-validation.ts`, unchanged — the gate accepts
 * only input schemas it evaluates), mirrors the `x-mcp-header` properties, each read at its own path, into
 * `Mcp-Param-{Name}` headers as the Value Encoding table defines for the types the gate admits (string, integer, boolean),
 * and hands the transport's typed outcome back UNCHANGED — normalising a result into an observation, attributing it to a
 * trace and letting a model see any of it is A4's, not this increment's.
 *
 * Only a descriptor THESE gates built (`foreign-tools.ts`) and a negotiation THIS client produced (`negotiation.ts`)
 * can reach the wire, so no caller can invent a tool name, a schema or a protocol version. `input_required` is refused:
 * Sirkit declares no elicitation, sampling or roots capability, so a server may not ask for one (MRTR, notes section 2).
 * A `header_mismatch` (-32020) means the server read the mirrored headers differently from the body: the cached listing
 * of that server is invalidated and the closed outcome is returned — there is no automatic retry loop in A2.
 * [B20 A3] The post goes through `mcpPostAuthorized` (a client-credentials row gets its token, one refresh and one step-up
 * there) with no collector: this layer keeps no server text after the post, and the transport redacts the result.
 */
import type { AdmissionPurpose } from "../acquisition/admission-control";
import { assertSafeJsonValue, DEFAULT_INPUT_LIMITS, validateAgainstSchema } from "../engineering/tool-io-validation";
import { mcpPostAuthorized, type McpAuthorizedPostResult } from "./authorization";
import { isAcceptedMcpTool, utf8Exceeds, type McpAcceptedTool, type McpHeaderParameter } from "./foreign-tools";
import {
  encodeMcpNameHeader, MCP_PARAM_HEADER_VALUE_MAX_CHARS, mcpRedactionSubjects,
  type McpPostAttribution, type McpTransportDeps,
} from "./http-transport";
import { displayText, isNegotiatedMcpServer, nextMcpRequestId, type McpNegotiatedServer } from "./negotiation";
import type { McpServerRegistryEntry } from "./server-registry";
import { invalidateMcpToolListing } from "./tool-discovery";

/**
 * The serialised bound on one call's arguments; the transport's own 1 MB request bound is the second one. [B20 A2 review-4]
 * In UTF-8 BYTES, as the schema bound counts them (`utf8Exceeds`): it compared UTF-16 units, so four strings of 9 000 e-acute
 * (about 72 030 bytes) were prepared and sent.
 */
export const MCP_TOOL_ARGUMENTS_MAX_BYTES = 65_536;
const ISSUES_MAX = 5;
const ISSUE_MAX_CHARS = 200;
const CALL_METHOD = "tools/call";

export type McpToolCallFailureCode =
  | "not_accepted"
  | "not_negotiated"
  | "arguments_invalid"
  | "arguments_too_large"
  | "input_required_unsupported"
  | "call_failed";

export type McpPreparedToolCall =
  | { readonly ok: true; readonly name: string; readonly arguments: Record<string, unknown>; readonly paramHeaders: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly code: McpToolCallFailureCode; readonly message: string; readonly issues: readonly string[] };

export interface McpToolCallClosed extends McpPostAttribution {
  readonly ok: false;
  readonly kind: "closed";
  readonly code: McpToolCallFailureCode;
  readonly message: string;
  readonly issues?: readonly string[];
}

export type McpToolCallOutcome = McpAuthorizedPostResult | McpToolCallClosed;

export interface McpToolCallOptions {
  purpose: AdmissionPurpose;
  signal?: AbortSignal;
  deps?: McpTransportDeps;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function refused(code: McpToolCallFailureCode, sentence: string, issues: readonly string[] = []): McpPreparedToolCall {
  return { ok: false, code, message: sentence, issues };
}

/**
 * Validator messages as an outcome may carry them: bounded, inert and never more than a handful.
 * [B20 A2 review] With the token this row sends as a redaction subject, and then its case-folded skeleton comparison (the
 * negotiation's `displayText`): a message quotes argument KEYS and schema values, and neither may carry the token (S2).
 */
function boundedIssues(issues: readonly string[], redact: readonly string[]): readonly string[] {
  const kept: string[] = [];
  for (const issue of issues.slice(0, ISSUES_MAX)) {
    const text = displayText(issue, ISSUE_MAX_CHARS, redact);
    if (text !== null) kept.push(text);
  }
  return Object.freeze(kept);
}

/**
 * One header value of the Value Encoding table (section 3): a string as it is, an integer in decimal within the safe
 * range, a boolean as `true` or `false`; an absent value carries no header at all. A value that is not header-safe ASCII,
 * that has leading or trailing whitespace, or that is itself a sentinel, is the `=?base64?…?=` sentinel over its UTF-8
 * (`encodeMcpNameHeader`, the transport's own encoder).
 * [B20 A2 review] An explicit null is refused like any value of another type: an annotated property is never nullable (the
 * gate refuses a nullable type — a stated limit), so the table's null row is unreachable, and the dead branch is gone. A
 * value whose header spelling (the sentinel included) exceeds the transport's 2 048 characters is refused HERE, before a
 * request is built that the transport would refuse.
 */
function headerValue(value: unknown, type: McpHeaderParameter["type"]): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined) return { ok: true, value: null };
  let encoded: string;
  if (type === "boolean") {
    if (typeof value !== "boolean") return { ok: false };
    encoded = value ? "true" : "false";
  } else if (type === "integer") {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return { ok: false };
    encoded = String(value);
  } else {
    if (typeof value !== "string") return { ok: false };
    encoded = encodeMcpNameHeader(value);
  }
  return encoded.length <= MCP_PARAM_HEADER_VALUE_MAX_CHARS ? { ok: true, value: encoded } : { ok: false };
}

/**
 * [B20 A2 review] The argument an `x-mcp-header` parameter mirrors: read along its PATH from the root, own properties only
 * (an inherited name is never a value). An absent step — or a step that is not an object — is an absent value. Reading the
 * leaf name at the top level mirrored a same-named top-level property instead of the annotated one.
 */
function argumentAt(args: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = args;
  for (const step of path) {
    if (!isPlainObject(value) || !Object.hasOwn(value, step)) return undefined;
    value = value[step];
  }
  return value;
}

/** [B20 A2 review] The redaction subjects a caller handed in: strings only, never a throw. */
function subjectsOf(redact: unknown): readonly string[] {
  try {
    return Array.isArray(redact) ? redact.filter((entry): entry is string => typeof entry === "string" && entry !== "") : [];
  } catch {
    return [];
  }
}

/**
 * Validate one call's arguments and build its mirrored headers. Pure and synchronous: nothing is sent here, and every
 * refusal names a closed code with bounded issues — never the raw arguments. [B20 A2 review] `redact`: the token this row
 * sends (`callMcpTool` passes `mcpRedactionSubjects`), compared with every issue string.
 */
export function prepareMcpToolCall(accepted: McpAcceptedTool, args: unknown, redact: readonly string[] = []): McpPreparedToolCall {
  try {
    const subjects = subjectsOf(redact);
    if (!isAcceptedMcpTool(accepted)) return refused("not_accepted", "MCP client: only a descriptor the foreign-tool gates built can be called.");
    if (!isPlainObject(args)) return refused("arguments_invalid", `MCP tool "${accepted.toolId}": the arguments must be an object.`);
    let serialized: string;
    try {
      serialized = JSON.stringify(args) ?? "";
    } catch {
      return refused("arguments_invalid", `MCP tool "${accepted.toolId}": the arguments cannot be serialised as JSON.`);
    }
    if (utf8Exceeds(serialized, MCP_TOOL_ARGUMENTS_MAX_BYTES)) {
      return refused("arguments_too_large", `MCP tool "${accepted.toolId}": the arguments exceed ${MCP_TOOL_ARGUMENTS_MAX_BYTES} bytes.`);
    }
    const unsafe = assertSafeJsonValue(args, DEFAULT_INPUT_LIMITS);
    if (unsafe.length > 0) return refused("arguments_invalid", `MCP tool "${accepted.toolId}": the arguments are not plain, bounded JSON.`, boundedIssues(unsafe, subjects));
    const issues = validateAgainstSchema(args, accepted.inputSchema as Record<string, unknown>);
    if (issues.length > 0) return refused("arguments_invalid", `MCP tool "${accepted.toolId}": the arguments do not match the accepted input schema.`, boundedIssues(issues, subjects));

    const paramHeaders: Record<string, string> = {};
    for (const parameter of accepted.headerParameters) {
      const encoded = headerValue(argumentAt(args, parameter.path), parameter.type);
      if (!encoded.ok) return refused("arguments_invalid", `MCP tool "${accepted.toolId}": an x-mcp-header argument cannot be represented as a header value.`);
      if (encoded.value !== null) paramHeaders[parameter.header] = encoded.value;
    }
    return { ok: true, name: accepted.name, arguments: args, paramHeaders: Object.freeze(paramHeaders) };
  } catch {
    return refused("call_failed", "MCP client: the call could not be prepared.");
  }
}

function emptyAttribution(serverId: string): McpPostAttribution {
  return { serverId, protocolVersion: "", method: CALL_METHOD, elapsedMs: 0, requestBytes: 0, responseBytes: 0 };
}

function closed(attribution: McpPostAttribution, code: McpToolCallFailureCode, sentence: string, issues?: readonly string[]): McpToolCallClosed {
  return Object.freeze({ ...attribution, ok: false, kind: "closed", code, message: sentence, ...(issues === undefined || issues.length === 0 ? {} : { issues }) });
}

/** Call one accepted foreign tool under a negotiation this client produced. Never throws, never rejects (S4). */
export async function callMcpTool(
  server: McpServerRegistryEntry,
  negotiated: McpNegotiatedServer,
  accepted: McpAcceptedTool,
  args: unknown,
  options: McpToolCallOptions,
): Promise<McpToolCallOutcome> {
  let serverId = "";
  try {
    const id: unknown = (server as { id?: unknown } | null)?.id;
    if (typeof id === "string" && id.length <= 64) serverId = id;
  } catch {
    serverId = "";
  }
  try {
    if (!isPlainObject(options) || (options.purpose !== "interactive" && options.purpose !== "agent")) {
      return closed(emptyAttribution(serverId), "call_failed", "MCP client: the call options name no admission purpose; nothing was sent.");
    }
    if (!isAcceptedMcpTool(accepted) || accepted.serverId !== serverId || serverId === "") {
      return closed(emptyAttribution(serverId), "not_accepted", `MCP server "${serverId}": only a descriptor the foreign-tool gates built for this row can be called; nothing was sent.`);
    }
    if (!isNegotiatedMcpServer(negotiated) || negotiated.serverId !== serverId) {
      return closed(emptyAttribution(serverId), "not_negotiated", `MCP server "${serverId}": a call needs a negotiation this client produced for this row; nothing was sent.`);
    }
    // [B20 A2 review] the token this row would send, as a redaction subject of the refusal issues only
    const redact = await mcpRedactionSubjects(server, options.deps);
    const prepared = prepareMcpToolCall(accepted, args, redact);
    if (!prepared.ok) return closed(emptyAttribution(serverId), prepared.code, prepared.message, prepared.issues);

    const post = await mcpPostAuthorized(
      server,
      { jsonrpc: "2.0", id: nextMcpRequestId(), method: CALL_METHOD, params: { name: prepared.name, arguments: prepared.arguments } },
      { purpose: options.purpose, era: "current", protocolVersion: negotiated.negotiatedVersion, paramHeaders: prepared.paramHeaders, signal: options.signal, deps: options.deps },
    );
    if (post.kind === "input_required") {
      return closed(
        { serverId, protocolVersion: post.protocolVersion, method: post.method, elapsedMs: post.elapsedMs, requestBytes: post.requestBytes, responseBytes: post.responseBytes },
        "input_required_unsupported",
        `MCP server "${serverId}": the call asked for input this client never declared a capability for; nothing was fulfilled.`,
      );
    }
    // -32020: the server read the mirrored headers differently from the body — the listing this call was built from is stale
    if (post.kind === "closed" && post.code === "header_mismatch") invalidateMcpToolListing(serverId);
    return post;
  } catch {
    return closed(emptyAttribution(serverId), "call_failed", "MCP client: the call failed unexpectedly; nothing of it was classified.");
  }
}
