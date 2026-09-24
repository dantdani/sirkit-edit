/**
 * [B20 B3] The MCP read trace `sirkit.mcp-read-trace.v1` (D-11; OD-72): one closed record per served-read pipeline call — the
 * principal (its ids, mapped role, LIVE membership revision, `mcp_bearer` and the token id's digest), the call bindings, the
 * durable board identity, the durable and membership post-checks, admission, idempotency (the key's digest, never the key),
 * the B05 digests and consumed resources, and a closed outcome. No token, key, argument text, diagnostic or board content.
 *
 * An MCP call is not an agent run: `AgentTraceIdentity` (provider openai | anthropic), the B05 trace, `tool-invocation.ts` and
 * the nine B11 files are unchanged. A record outside the closed schema is dropped; a sink that fails never changes the
 * response; the default sink is a per-process ring of 1 000 records. Nothing here throws.
 */
import { ID_PATTERN } from "../../auth/trusted-request-context";
import type { ProjectRole } from "../../engineering/types";

export const MCP_READ_TRACE_SCHEMA = "sirkit.mcp-read-trace.v1" as const;
export const MCP_READ_TRACE_RING_MAX = 1_000;

/** The pipeline's own closed refusals (D-6), in the order the pipeline can reach them. */
export const MCP_READ_OWN_REFUSAL_STATUSES = Object.freeze([
  "internal_error",
  "invalid_arguments",
  "revision_required",
  "registry_changed",
  "idempotency_key_conflict",
  "idempotency_in_flight",
  "busy",
  "cancelled",
  "no_durable_board",
  "durable_board_unavailable",
  "durable_board_corrupt",
  "durable_board_invalid",
  "stale_revision",
  "not_servable",
  "membership_changed",
  "membership_unavailable",
  "timeout",
  "output_too_large_for_model",
] as const);
/**
 * The B05 read service's failure statuses, passed through verbatim — restated here (this module may not import the service,
 * b20-b3-import-gates G1) and pinned equal to `READ_FAILURE_STATUSES` by b20-b3-read-trace E1.
 */
export const MCP_READ_B05_STATUSES = Object.freeze([
  "not_registered", "not_discoverable", "not_callable", "unauthorized",
  "scope_mismatch", "stale_revision", "invalid_input", "invalid_output",
  "authority_unavailable", "timeout", "cancelled", "implementation_failed",
  "missing_resource", "corrupt_resource", "stale_resource", "foreign_resource",
  "incompatible_resource_revision", "manifest_mismatch", "dependency_mismatch",
  "duplicate_resource",
  "resource_unverified", "resource_unavailable",
] as const);
export const MCP_READ_REFUSAL_STATUSES = Object.freeze([...new Set([...MCP_READ_OWN_REFUSAL_STATUSES, ...MCP_READ_B05_STATUSES])]) as readonly McpReadRefusalStatus[];
export type McpReadRefusalStatus = (typeof MCP_READ_OWN_REFUSAL_STATUSES)[number] | (typeof MCP_READ_B05_STATUSES)[number];
export const MCP_READ_TRACE_OUTCOMES = Object.freeze(["succeeded", "replayed", ...MCP_READ_REFUSAL_STATUSES]) as readonly McpReadTraceOutcome[];
export type McpReadTraceOutcome = "succeeded" | "replayed" | McpReadRefusalStatus;

export const MCP_READ_TRACE_MEMBERSHIP_RECHECKS = Object.freeze(["current", "changed", "unavailable", "not_run"] as const);
export const MCP_READ_TRACE_POST_CHECKS = Object.freeze(["unchanged", "changed", "unavailable", "not_run"] as const);
export const MCP_READ_TRACE_ADMISSIONS = Object.freeze(["admitted", "busy", "not_run"] as const);
export const MCP_READ_TRACE_IDEMPOTENCY_STATES = Object.freeze(["none", "stored", "replayed", "not_stored", "conflict", "in_flight", "full", "not_run"] as const);

export interface McpReadTracePrincipal {
  readonly tenantId: string;
  readonly projectId: string;
  readonly branchId: string;
  readonly principalId: string;
  readonly role: ProjectRole;
  readonly membershipRevision: string;
  readonly authMethod: "mcp_bearer";
  readonly tokenIdDigest: string;
}
export interface McpReadTraceConsumedResource {
  readonly resourceId: string;
  readonly kind: string;
  readonly sourceVersion: string;
  readonly contentDigest: string;
}
export interface McpReadTraceRead {
  readonly bindingId: string;
  readonly bindingVersion: string;
  readonly inputDigest: string;
  readonly outputDigest: string;
  readonly resourceManifestDigest: string;
  readonly consumedResources: readonly McpReadTraceConsumedResource[];
  readonly verification: "canonical-revision-verified" | "composite-resources-verified";
}
export interface McpReadTrace {
  readonly schema: typeof MCP_READ_TRACE_SCHEMA;
  readonly requestId: string;
  readonly invocationId: string | null;
  readonly toolId: string;
  readonly toolVersion: string;
  readonly startedAtMs: number;
  readonly completedAtMs: number;
  readonly principal: McpReadTracePrincipal;
  readonly membershipRecheck: (typeof MCP_READ_TRACE_MEMBERSHIP_RECHECKS)[number];
  readonly revisionBinding: "expected" | "current" | null;
  readonly expectedRevision: string | null;
  readonly boundRevision: string | null;
  readonly durableBoard: { readonly boardId: string; readonly boardRevision: string; readonly boardDigest: string; readonly aggregateRevision: number } | null;
  readonly durablePostCheck: (typeof MCP_READ_TRACE_POST_CHECKS)[number];
  readonly admission: (typeof MCP_READ_TRACE_ADMISSIONS)[number];
  readonly idempotency: { readonly keyDigest: string | null; readonly state: (typeof MCP_READ_TRACE_IDEMPOTENCY_STATES)[number] };
  readonly registryDigest: string;
  readonly listingDigest: string;
  readonly read: McpReadTraceRead | null;
  readonly outcome: McpReadTraceOutcome;
}
export interface McpReadTraceSink {
  record(trace: McpReadTrace): void;
}

const PROJECT_ROLES: readonly string[] = Object.freeze(["viewer", "commenter", "pcb_editor", "automation", "reviewer", "project_admin", "migration_admin"]);
const REQUEST_ID = /^mcpreq-[0-9a-f]{16}$/;
const INVOCATION_ID = /^mcp-read-[0-9a-f]{32}$/;
const TOOL_ID = /^[A-Za-z0-9_.-]{1,128}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const ENG_DIGEST = /^eng1-[0-9a-f]{16}$/;
const MEMBERSHIP_REVISION = /^mbr1-[0-9a-f]{16}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const BOARD_ID = /^board:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}(@r[0-9]{1,6})?$/;
const BOARD_REVISION = /^pcb2-[0-9a-f]{1,64}$/;
const BOARD_DIGEST = /^pb1-[0-9a-f]{1,128}$/;
const BINDING_TEXT = /^[A-Za-z0-9._:@-]{1,160}$/;
const TRACE_KEYS = Object.freeze(["schema", "requestId", "invocationId", "toolId", "toolVersion", "startedAtMs", "completedAtMs", "principal", "membershipRecheck", "revisionBinding", "expectedRevision", "boundRevision", "durableBoard", "durablePostCheck", "admission", "idempotency", "registryDigest", "listingDigest", "read", "outcome"]);
const nonNegativeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const id = (value: unknown): value is string => typeof value === "string" && ID_PATTERN.test(value);
const matches = (value: unknown, pattern: RegExp): value is string => typeof value === "string" && value.length <= 256 && pattern.test(value);
const nullOr = (value: unknown, pattern: RegExp): value is string | null => value === null || matches(value, pattern);
const oneOf = <T extends string>(value: unknown, values: readonly T[]): value is T => typeof value === "string" && (values as readonly string[]).includes(value);

function closedPrincipal(value: unknown): McpReadTracePrincipal | null {
  if (typeof value !== "object" || value === null) return null;
  const p = value as Record<string, unknown>;
  if (!id(p.tenantId) || !id(p.projectId) || !id(p.branchId) || !id(p.principalId)) return null;
  if (!oneOf(p.role, PROJECT_ROLES) || !matches(p.membershipRevision, MEMBERSHIP_REVISION) || p.authMethod !== "mcp_bearer" || !matches(p.tokenIdDigest, HEX32)) return null;
  return Object.freeze({ tenantId: p.tenantId, projectId: p.projectId, branchId: p.branchId, principalId: p.principalId, role: p.role as ProjectRole, membershipRevision: p.membershipRevision, authMethod: "mcp_bearer", tokenIdDigest: p.tokenIdDigest });
}
function closedBoard(value: unknown): McpReadTrace["durableBoard"] | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const b = value as Record<string, unknown>;
  if (!matches(b.boardId, BOARD_ID) || !matches(b.boardRevision, BOARD_REVISION) || !matches(b.boardDigest, BOARD_DIGEST) || !nonNegativeInteger(b.aggregateRevision)) return undefined;
  return Object.freeze({ boardId: b.boardId, boardRevision: b.boardRevision, boardDigest: b.boardDigest, aggregateRevision: b.aggregateRevision });
}
function closedRead(value: unknown): McpReadTraceRead | null | undefined {
  if (value === null) return null;
  if (typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  if (!matches(r.bindingId, BINDING_TEXT) || !matches(r.bindingVersion, VERSION) || !matches(r.inputDigest, ENG_DIGEST) || !matches(r.outputDigest, ENG_DIGEST) || !matches(r.resourceManifestDigest, ENG_DIGEST)) return undefined;
  if (r.verification !== "canonical-revision-verified" && r.verification !== "composite-resources-verified") return undefined;
  if (!Array.isArray(r.consumedResources) || r.consumedResources.length > 32) return undefined;
  const consumed: McpReadTraceConsumedResource[] = [];
  for (const item of r.consumedResources as unknown[]) {
    if (typeof item !== "object" || item === null) return undefined;
    const c = item as Record<string, unknown>;
    if (!matches(c.resourceId, BINDING_TEXT) || !matches(c.kind, BINDING_TEXT) || !matches(c.sourceVersion, BINDING_TEXT) || !matches(c.contentDigest, ENG_DIGEST)) return undefined;
    consumed.push(Object.freeze({ resourceId: c.resourceId, kind: c.kind, sourceVersion: c.sourceVersion, contentDigest: c.contentDigest }));
  }
  return Object.freeze({ bindingId: r.bindingId, bindingVersion: r.bindingVersion, inputDigest: r.inputDigest, outputDigest: r.outputDigest, resourceManifestDigest: r.resourceManifestDigest, consumedResources: Object.freeze(consumed), verification: r.verification });
}

/** A closed, frozen copy of exactly the schema's fields, or null when any field is outside it (an extra key included). */
function closedCopy(input: unknown): McpReadTrace | null {
  if (typeof input !== "object" || input === null) return null;
  const t = input as Record<string, unknown>;
  const keys = Object.keys(t);
  if (keys.length !== TRACE_KEYS.length || keys.some((key) => !TRACE_KEYS.includes(key))) return null;
  if (t.schema !== MCP_READ_TRACE_SCHEMA || !matches(t.requestId, REQUEST_ID) || !nullOr(t.invocationId, INVOCATION_ID)) return null;
  if (!matches(t.toolId, TOOL_ID) || !matches(t.toolVersion, VERSION) || !nonNegativeInteger(t.startedAtMs) || !nonNegativeInteger(t.completedAtMs)) return null;
  const principal = closedPrincipal(t.principal);
  if (principal === null) return null;
  if (!oneOf(t.membershipRecheck, MCP_READ_TRACE_MEMBERSHIP_RECHECKS) || !oneOf(t.durablePostCheck, MCP_READ_TRACE_POST_CHECKS) || !oneOf(t.admission, MCP_READ_TRACE_ADMISSIONS)) return null;
  if (t.revisionBinding !== null && t.revisionBinding !== "expected" && t.revisionBinding !== "current") return null;
  if (!nullOr(t.expectedRevision, ENG_DIGEST) || !nullOr(t.boundRevision, ENG_DIGEST)) return null;
  const durableBoard = closedBoard(t.durableBoard);
  if (durableBoard === undefined) return null;
  if (typeof t.idempotency !== "object" || t.idempotency === null) return null;
  const idempotency = t.idempotency as Record<string, unknown>;
  if (!nullOr(idempotency.keyDigest, HEX32) || !oneOf(idempotency.state, MCP_READ_TRACE_IDEMPOTENCY_STATES)) return null;
  if (!(t.registryDigest === "" || matches(t.registryDigest, ENG_DIGEST)) || !(t.listingDigest === "" || matches(t.listingDigest, ENG_DIGEST))) return null;
  const read = closedRead(t.read);
  if (read === undefined) return null;
  if (!oneOf(t.outcome, MCP_READ_TRACE_OUTCOMES)) return null;
  return Object.freeze({
    schema: MCP_READ_TRACE_SCHEMA,
    requestId: t.requestId,
    invocationId: t.invocationId,
    toolId: t.toolId,
    toolVersion: t.toolVersion,
    startedAtMs: t.startedAtMs,
    completedAtMs: t.completedAtMs,
    principal,
    membershipRecheck: t.membershipRecheck,
    revisionBinding: t.revisionBinding as McpReadTrace["revisionBinding"],
    expectedRevision: t.expectedRevision,
    boundRevision: t.boundRevision,
    durableBoard,
    durablePostCheck: t.durablePostCheck,
    admission: t.admission,
    idempotency: Object.freeze({ keyDigest: idempotency.keyDigest as string | null, state: idempotency.state }),
    registryDigest: t.registryDigest as string,
    listingDigest: t.listingDigest as string,
    read,
    outcome: t.outcome,
  });
}

const ring: McpReadTrace[] = [];
const RING_SINK: McpReadTraceSink = {
  record(trace) {
    ring.push(trace);
    while (ring.length > MCP_READ_TRACE_RING_MAX) ring.shift();
  },
};
const DEFAULT_SINK_FACTORY = (): McpReadTraceSink | null => RING_SINK;
let sinkFactory: () => McpReadTraceSink | null = DEFAULT_SINK_FACTORY;

/** Seam (the request-trace pattern): a durable sink can replace the per-process ring. */
export function setMcpReadTraceSinkFactory(factory: () => McpReadTraceSink | null): void {
  sinkFactory = factory;
}
/** Restores the ring sink and empties the ring. */
export function resetMcpReadTraceSinkFactory(): void {
  sinkFactory = DEFAULT_SINK_FACTORY;
  ring.length = 0;
}
/** Record one closed trace. Never throws: an invalid record is dropped, a failing factory or sink is contained. */
export function recordMcpReadTrace(trace: McpReadTrace): void {
  try {
    const copy = closedCopy(trace);
    if (copy === null) return;
    sinkFactory()?.record(copy);
  } catch {
    // a trace sink never alters the response
  }
}
/** The ring's records, oldest first (a frozen copy). */
export function mcpReadTraceRing(): readonly McpReadTrace[] {
  return Object.freeze([...ring]);
}
