/**
 * [B20 B1] The MCP tool definitions of Sirkit's own server side, generated from the canonical registry for the MCP exposure
 * subset (`app/lib/engineering/mcp-exposure.ts`), per the Tool contract of MCP revision 2026-07-28
 * (`artifacts/ai-control-plane-b20/mcp-reference-notes.md` sections 6 and 7):
 *
 *  - `name` is the raw registry id (MCP-legal, reversible, collision-free; first-party naming, OD-52 amendment);
 *  - `inputSchema` is the SAME strict schema the OpenAI and Anthropic adapters receive (`strictCompatibility`), so the
 *    three-way parity of C1 starts true; a no-argument tool renders `{type:"object", additionalProperties:false,
 *    properties:{}, required:[]}`;
 *  - `outputSchema` is declared only when the registry's output schema is inside the proven wire subset with an object root
 *    (OD-56) and [B20 C1] Sirkit's own deterministic output validator can EVALUATE it (OD-96, `structured-content.ts`);
 *    otherwise it is omitted and the manifest records why. A declared schema binds the served success: it carries a
 *    conforming `structuredContent` or the read is refused `invalid_output` (`read-call.ts` step 16);
 *  - `annotations` are DERIVED from Sirkit's classification alone and never read from anywhere (clients must treat any
 *    server's annotations as untrusted; Sirkit's permission tiers have no annotation input);
 *  - `_meta` carries Sirkit's identity under its own, unreserved prefix `dev.sirkit/` (OD-60).
 *
 * Pure functions: no I/O, no endpoint, no principal (B2 serves the listing; pagination, ttlMs and cacheScope are C2). The
 * only thing an exported function throws is the typed refusal `McpToolRenderError`: never a partial list, never a
 * definition it cannot stand behind. Every returned object is built fresh and frozen at every depth.
 */
import { strictCompatibility, validateSchemaStructure, validateWireSubset } from "../../agent/provider-tools";
import { mcpExclusionReason, mcpExposureReport, type McpExclusionReason } from "../../engineering/mcp-exposure";
import { permissionTierOfDescriptor, type PermissionTier } from "../../engineering/permission-tiers";
import { firstPartyIdIssues, firstPartyTextIssues } from "../../engineering/descriptor-text"; // [B20 C3] OD-99
import { engineeringDigest } from "../../engineering/stable";
import { renderRegistryJson, type JsonSchema, type ToolDescriptor, type ToolOperationClass, type ToolRegistry } from "../../engineering/tool-registry";
import { mcpOutputSchemaEvaluable } from "./structured-content"; // [B20 C1] OD-96

/** Reference notes section 6: 1-128 characters of A-Z a-z 0-9 _ . - (case-sensitive, unique per server). */
export const MCP_TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;
export const MCP_TOOL_LISTING_SCHEMA = "sirkit.mcp-tool-listing.v1" as const;
/** OD-60: Sirkit's own reverse-DNS `_meta` prefix; its second label is neither `modelcontextprotocol` nor `mcp` (reserved). */
export const MCP_META_PREFIX = "dev.sirkit/" as const;
export const MCP_META_KEYS = Object.freeze([
  "dev.sirkit/toolId",
  "dev.sirkit/toolVersion",
  "dev.sirkit/registryDigest",
  "dev.sirkit/operationClass",
  "dev.sirkit/permissionTier",
] as const);

export const MCP_TOOL_RENDER_REFUSALS = Object.freeze([
  "exposure_drift",
  "not_exposable",
  "descriptor_invalid",
  "name_invalid",
  "reserved_key",
  "input_schema_not_strict",
  "registry_digest_invalid",
] as const);
export type McpToolRenderRefusal = (typeof MCP_TOOL_RENDER_REFUSALS)[number];

/**
 * The one thing these functions throw. `toolId` is kept only when it passes the MCP name rule — the constructor itself drops
 * any other value, so no call site can echo a refused name; `detail` is a closed value.
 */
export class McpToolRenderError extends Error {
  readonly code: McpToolRenderRefusal;
  readonly toolId: string | null;
  readonly detail: string | null;

  constructor(code: McpToolRenderRefusal, toolId: string | null = null, detail: string | null = null) {
    const named = typeof toolId === "string" && MCP_TOOL_NAME_PATTERN.test(toolId) ? toolId : null;
    super(`MCP_TOOL_RENDER_REFUSED:${code}${named ? `:${named}` : ""}`);
    this.name = "McpToolRenderError";
    this.code = code;
    this.toolId = named;
    this.detail = detail;
  }
}

export interface McpToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface McpToolMeta {
  readonly "dev.sirkit/toolId": string;
  readonly "dev.sirkit/toolVersion": string;
  readonly "dev.sirkit/registryDigest": string;
  readonly "dev.sirkit/operationClass": ToolOperationClass;
  readonly "dev.sirkit/permissionTier": PermissionTier;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema?: JsonSchema;
  readonly annotations: McpToolAnnotations;
  readonly _meta: McpToolMeta;
}

export interface McpToolListingExclusion {
  readonly toolId: string;
  readonly version: string;
  readonly reason: McpExclusionReason;
}

export interface McpToolListing {
  /** Sorted by name in code-point order (deterministic list order). */
  readonly tools: readonly McpToolDefinition[];
  /** engineeringDigest over {schema, registryDigest, tools}: the listing identity (D20-14, order and identity half). */
  readonly listingDigest: string;
  readonly registryDigest: string;
  readonly excluded: readonly McpToolListingExclusion[];
}

export type McpOutputSchemaDecision = { readonly declared: true } | { readonly declared: false; readonly reason: McpOutputSchemaOmission };

export const MCP_OUTPUT_SCHEMA_OMISSIONS = Object.freeze([
  "a reserved key (__proto__, constructor, prototype)",
  "outside the proven wire subset",
  "not a valid schema structure",
  "root is not an explicit object schema",
  "not evaluable by the output validator", // [B20 C1] OD-96: nothing weaker than a schema Sirkit can check is ever declared
] as const);
export type McpOutputSchemaOmission = (typeof MCP_OUTPUT_SCHEMA_OMISSIONS)[number];

const REGISTRY_DIGEST_PATTERN = /^eng1-[0-9a-f]{16}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const RESERVED_KEYS: readonly string[] = Object.freeze(["__proto__", "constructor", "prototype"]);
const MAX_SCHEMA_DEPTH = 64;
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Scan every own key at every depth: a reserved key, a cycle or an unbounded depth is reported, never recursed into. */
function schemaKeyScan(value: unknown, depth = 0, path: object[] = []): "ok" | "reserved" | "unbounded" {
  if (typeof value !== "object" || value === null) return "ok";
  if (depth > MAX_SCHEMA_DEPTH || path.includes(value)) return "unbounded";
  path.push(value);
  try {
    for (const key of Object.keys(value)) {
      if (RESERVED_KEYS.includes(key)) return "reserved";
      const verdict = schemaKeyScan((value as Record<string, unknown>)[key], depth + 1, path);
      if (verdict !== "ok") return verdict;
    }
    return "ok";
  } finally {
    path.pop();
  }
}

/** A fresh copy of a JSON-safe, scanned value, frozen at every depth (own data properties only). */
function frozenCopy<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((item) => frozenCopy(item))) as T;
  if (typeof value !== "object" || value === null) return value;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    Object.defineProperty(copy, key, { value: frozenCopy((value as Record<string, unknown>)[key]), enumerable: true, writable: true, configurable: true });
  }
  return Object.freeze(copy) as T;
}

function outputDecisionOf(outputSchema: unknown): McpOutputSchemaDecision {
  const scan = schemaKeyScan(outputSchema);
  if (scan === "reserved") return Object.freeze({ declared: false, reason: "a reserved key (__proto__, constructor, prototype)" });
  if (scan === "unbounded") return Object.freeze({ declared: false, reason: "not a valid schema structure" });
  if (validateWireSubset(outputSchema).length > 0) return Object.freeze({ declared: false, reason: "outside the proven wire subset" });
  if (validateSchemaStructure(outputSchema).length > 0) return Object.freeze({ declared: false, reason: "not a valid schema structure" });
  if ((outputSchema as Record<string, unknown>).type !== "object") return Object.freeze({ declared: false, reason: "root is not an explicit object schema" });
  // [B20 C1] OD-96, last: a schema Sirkit's own deterministic output validator cannot EVALUATE would be a promise it cannot
  // keep (the specification's "servers MUST provide structured results that conform to this schema"), so it is omitted and
  // the tool stays listed with no structuredContent — never declared and then unchecked.
  if (!mcpOutputSchemaEvaluable(outputSchema)) return Object.freeze({ declared: false, reason: "not evaluable by the output validator" });
  return Object.freeze({ declared: true });
}

/** OD-56: whether the descriptor's output schema is declared to MCP (and the closed reason when it is not). Never throws. */
export function mcpOutputSchemaDecision(descriptor: Pick<ToolDescriptor, "outputSchema">): McpOutputSchemaDecision {
  try {
    return outputDecisionOf(descriptor.outputSchema);
  } catch {
    return Object.freeze({ declared: false, reason: "not a valid schema structure" });
  }
}

interface RenderFacts {
  toolId: string;
  version: string;
  title: string;
  description: string;
  operationClass: ToolOperationClass;
  approvalTier: ToolDescriptor["approvalTier"];
  idempotency: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  candidate: ToolDescriptor;
}

/** Each field read once into a plain snapshot, so what is checked is what is rendered; null when malformed or hostile. */
function renderFactsOf(descriptor: unknown): RenderFacts | null {
  try {
    if (typeof descriptor !== "object" || descriptor === null) return null;
    const source = descriptor as Record<string, unknown>;
    const binding = source.binding;
    const candidate = {
      toolId: source.toolId,
      version: source.version,
      title: source.title,
      description: source.description,
      operationClass: source.operationClass,
      approvalTier: source.approvalTier,
      idempotency: source.idempotency,
      sideEffects: source.sideEffects,
      inputSchema: source.inputSchema,
      outputSchema: source.outputSchema,
      agentExposed: source.agentExposed,
      binding: typeof binding === "object" && binding !== null ? { status: (binding as Record<string, unknown>).status } : binding,
      executionMode: source.executionMode,
      grantOnly: source.grantOnly,
      category: source.category,
      requiredAuthority: Array.isArray(source.requiredAuthority) ? [...source.requiredAuthority] : source.requiredAuthority,
      requiredProjectState: Array.isArray(source.requiredProjectState) ? [...source.requiredProjectState] : source.requiredProjectState,
      lifecycle: source.lifecycle,
      discovery: source.discovery,
      callability: source.callability,
    };
    const { toolId, version, title, description, operationClass, approvalTier, idempotency, inputSchema, outputSchema } = candidate;
    if (typeof toolId !== "string" || toolId.length === 0) return null;
    if (typeof version !== "string" || !VERSION_PATTERN.test(version)) return null;
    if (typeof title !== "string" || title.trim().length === 0 || typeof description !== "string" || description.trim().length === 0) return null;
    if (typeof operationClass !== "string" || typeof approvalTier !== "string" || typeof idempotency !== "string") return null;
    if (typeof inputSchema !== "object" || inputSchema === null || typeof outputSchema !== "object" || outputSchema === null) return null;
    return {
      toolId, version, title, description, idempotency,
      operationClass: operationClass as ToolOperationClass,
      approvalTier: approvalTier as ToolDescriptor["approvalTier"],
      inputSchema: inputSchema as JsonSchema,
      outputSchema: outputSchema as JsonSchema,
      candidate: candidate as unknown as ToolDescriptor,
    };
  } catch {
    return null;
  }
}

function renderDefinition(descriptor: unknown, registryDigest: unknown): McpToolDefinition {
  if (typeof registryDigest !== "string" || !REGISTRY_DIGEST_PATTERN.test(registryDigest)) throw new McpToolRenderError("registry_digest_invalid");
  const facts = renderFactsOf(descriptor);
  if (!facts) throw new McpToolRenderError("descriptor_invalid");
  // the name first: a name that fails the MCP rule is refused as a name, whatever else the descriptor is — STRUCTURALLY
  // (the alphabet and the length) and then [B20 C3] LEXICALLY (OD-99), because the name is the one field this renderer
  // emits verbatim to a model and both provider adapters derive theirs from. It is refused as a NAME, carrying no toolId
  // and no detail: the refusal of a directive-shaped id must never echo the id.
  if (!MCP_TOOL_NAME_PATTERN.test(facts.toolId)) throw new McpToolRenderError("name_invalid");
  if (firstPartyIdIssues(facts.toolId).length > 0) throw new McpToolRenderError("name_invalid");
  const named = facts.toolId;
  // the structural rule AND the reviewed decision (listed, not withheld) over the same snapshot that is rendered
  const reason = mcpExclusionReason(facts.candidate);
  if (reason !== null) throw new McpToolRenderError("not_exposable", named, reason);
  const inputScan = schemaKeyScan(facts.inputSchema);
  if (inputScan === "reserved") throw new McpToolRenderError("reserved_key", named);
  if (inputScan === "unbounded") throw new McpToolRenderError("input_schema_not_strict", named);
  // the SAME conversion the provider adapters use (buildAgentToolDeclarations / declarationFor): never weakened, never guessed
  const strict = strictCompatibility({ inputSchema: facts.inputSchema } as ToolDescriptor);
  if (!strict.ok) throw new McpToolRenderError("input_schema_not_strict", named);
  const output = outputDecisionOf(facts.outputSchema);
  // [B20 C3] the first-party text gate re-applied AFTER the strict conversion, over exactly what this renderer emits
  // (OD-99): the title, the description, the rendered strict input schema, and the output schema only when it is declared.
  // The NAME is not repeated here — it was judged above, before the exposure decision, and is refused as a name.
  // The annotation-field rule is NOT applied here — the renderer reads no annotation field of a descriptor and B1 pins that
  // it ignores them. The whole listing refuses, as it does for every other render refusal.
  if (firstPartyTextIssues({
    title: facts.title,
    description: facts.description,
    inputSchema: strict.schema,
    ...(output.declared ? { outputSchema: facts.outputSchema } : {}),
  }).length > 0) throw new McpToolRenderError("descriptor_invalid", named);
  const annotations: McpToolAnnotations = {
    readOnlyHint: facts.operationClass === "read",
    destructiveHint: false, // nothing destructive is MCP-exposable (only read and propose pass the rule)
    idempotentHint: facts.idempotency === "natural",
    openWorldHint: false, // the external reads are excluded (OD-55); every exposed tool reads or proposes over Sirkit's own state
  };
  const meta: McpToolMeta = {
    "dev.sirkit/toolId": facts.toolId,
    "dev.sirkit/toolVersion": facts.version,
    "dev.sirkit/registryDigest": registryDigest,
    "dev.sirkit/operationClass": facts.operationClass,
    "dev.sirkit/permissionTier": permissionTierOfDescriptor({ toolId: facts.toolId, operationClass: facts.operationClass, approvalTier: facts.approvalTier, sideEffects: facts.candidate.sideEffects }), // [B23-A2] the side effect too (OD-173)
  };
  return frozenCopy({
    name: facts.toolId,
    title: facts.title,
    description: facts.description,
    inputSchema: strict.schema,
    ...(output.declared ? { outputSchema: facts.outputSchema } : {}),
    annotations,
    _meta: meta,
  });
}

/**
 * One MCP tool definition for an MCP-exposable descriptor (`mcpExclusionReason` null: structurally admissible, listed and
 * not withheld), bound to the registry digest it was rendered from. Throws only `McpToolRenderError`.
 */
export function renderMcpToolDefinition(descriptor: ToolDescriptor, registryDigest: string): McpToolDefinition {
  try {
    return renderDefinition(descriptor, registryDigest);
  } catch (error) {
    if (error instanceof McpToolRenderError) throw error;
    throw new McpToolRenderError("descriptor_invalid");
  }
}

const exposureSummary = (missing: readonly string[], unexpected: readonly string[], outside: readonly string[], duplicates: readonly string[]): string =>
  `missing ${missing.length}, unexpected ${unexpected.length}, outside the agent set ${outside.length}, duplicated ${duplicates.length}`;

/**
 * The whole MCP tool listing of a registry: every exposed descriptor (structurally admissible, listed, not withheld)
 * rendered and sorted by name, the rest listed with their closed reason, the listing digest over {schema, registryDigest,
 * tools}. Refuses (never a partial list) when the exposure report is not ok, when any exposed descriptor cannot be
 * rendered, or when what was rendered differs from what the report checked.
 */
export function renderMcpToolListing(registry: ToolRegistry): McpToolListing {
  try {
    const report = mcpExposureReport(registry);
    if (!report.ok) throw new McpToolRenderError("exposure_drift", null, exposureSummary(report.missing, report.unexpected, report.outsideAgentSet, report.duplicates));
    const registryDigest = registry.digest();
    const tools = registry.list().filter((descriptor) => mcpExclusionReason(descriptor) === null).map((descriptor) => renderDefinition(descriptor, registryDigest));
    tools.sort((a, b) => byCodePoint(a.name, b.name));
    // [B20 B1 review] what is rendered is exactly what the report checked (a registry read twice must answer the same)
    if (tools.length !== report.count || tools.some((tool, index) => tool.name !== report.actual[index])) {
      throw new McpToolRenderError("exposure_drift", null, "the rendered set differs from the checked set");
    }
    const excluded = report.excluded.map((entry) => ({ toolId: entry.toolId, version: entry.version, reason: entry.reason }));
    const listingDigest = engineeringDigest({ schema: MCP_TOOL_LISTING_SCHEMA, registryDigest, tools });
    return frozenCopy({ tools, listingDigest, registryDigest, excluded });
  } catch (error) {
    if (error instanceof McpToolRenderError) throw error;
    throw new McpToolRenderError("descriptor_invalid");
  }
}

// ─── The byte-gated manifest (artifacts/ai-control-plane-b20/mcp-tool-manifest.{csv,json}) ───────────────────────────────

export const MCP_TOOL_MANIFEST_CSV_COLUMNS = Object.freeze([
  "tool_id", "version", "operation_class", "permission_tier", "binding", "exposed", "exclusion_reason",
  "read_only_hint", "idempotent_hint", "output_schema",
] as const);

const csvCell = (value: string | number | boolean): string => {
  const cell = String(value);
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
};

/** One row per registry descriptor: its classification, exposure, closed reason, derived hints and output-schema decision. */
export function renderMcpToolManifestCsv(registry: ToolRegistry): string {
  const listing = renderMcpToolListing(registry);
  try {
    return manifestCsvOf(registry, listing);
  } catch {
    throw new McpToolRenderError("descriptor_invalid");
  }
}

function manifestCsvOf(registry: ToolRegistry, listing: McpToolListing): string {
  const rows = [...registry.list()]
    .sort((a, b) => byCodePoint(a.toolId, b.toolId) || byCodePoint(a.version, b.version))
    .map((descriptor) => {
      const tool = listing.tools.find((item) => item.name === descriptor.toolId && item._meta["dev.sirkit/toolVersion"] === descriptor.version);
      const reason = tool ? "" : (listing.excluded.find((entry) => entry.toolId === descriptor.toolId && entry.version === descriptor.version)?.reason ?? "");
      const output = tool ? mcpOutputSchemaDecision(descriptor) : null;
      return [
        descriptor.toolId, descriptor.version, descriptor.operationClass, permissionTierOfDescriptor(descriptor), descriptor.binding.status,
        tool ? "yes" : "no", reason,
        tool ? tool.annotations.readOnlyHint : "", tool ? tool.annotations.idempotentHint : "",
        output ? (output.declared ? "declared" : `omitted (${output.reason})`) : "",
      ];
    });
  return [[...MCP_TOOL_MANIFEST_CSV_COLUMNS], ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

/** The rendered listing as canonical JSON (the exact bytes a reviewer diffs). */
export function renderMcpToolManifestJson(registry: ToolRegistry): string {
  return renderRegistryJson(renderMcpToolListing(registry));
}
