/**
 * [B20 C1] The THREE-WAY parity of Sirkit's MCP-exposed tools (OD-95; D20-12 and the first-party half of D20-13). For every
 * tool of the MCP subset the OpenAI and Anthropic renderings of the agent declarations (`provider-tools.ts`, the one
 * provider-rendering truth) and B1's MCP definition (`tool-definitions.ts`) must agree on:
 *
 *  - the NAME: MCP lists the raw registry id (OD-52), the providers `agentProviderName(toolId)`, and the declarations'
 *    reverse map resolves that provider name to the listed `{toolId, version}`;
 *  - the DESCRIPTION, byte for byte;
 *  - the strict INPUT SCHEMA, canonical-equal (one conversion, `strictCompatibility`).
 *
 * What only one side carries is RECORDED, never assumed: MCP's title, outputSchema, annotations and tool `_meta`, the
 * request `_meta` bindings and the read result's fields with B3's closed `_meta` key sets; the providers' `strict: true`.
 * Agent-exposed tools outside the MCP subset are listed with their closed exclusion reason. The v2 reports
 * (`renderAgentProviderParity`, `renderProviderParityReport`) and their B04 and B09 artifacts are untouched.
 *
 * Pure: no I/O, clock or randomness. It never imports the read pipeline — `./read-call` would pull `node:crypto`, the
 * durable modules and the whole B05 path into this renderer and its generator — so B3's result `_meta` key sets are a
 * frozen copy, pinned deep-equal to `MCP_READ_RESULT_META_KEYS` (b20-c1-three-way-parity P13). The report is never partial
 * and nothing here throws: an unreadable registry, a listing that refuses, declarations that cannot be built, a provider
 * name collision or a missing leg is a closed code that carries no descriptor text.
 */
import {
  agentProviderName,
  buildAgentToolDeclarations,
  renderAnthropicAgentTool,
  renderOpenAiResponsesTool,
  type AnthropicAgentTool,
  type OpenAiResponsesFunctionTool,
} from "../../agent/provider-tools";
import { DESCRIPTOR_TEXT_ALLOWED_EXTRA, DESCRIPTOR_TEXT_BOUNDS, DESCRIPTOR_TEXT_RULES, judgedSchemaStrings } from "../../engineering/descriptor-text"; // [B20 C3]
import { mcpExclusionReason, type McpExclusionReason } from "../../engineering/mcp-exposure";
import type { PermissionTier } from "../../engineering/permission-tiers";
import { canonicalJson, engineeringDigest } from "../../engineering/stable";
import type { ToolDescriptor, ToolOperationClass, ToolRegistry } from "../../engineering/tool-registry";
import { MCP_META_KEYS, mcpOutputSchemaDecision, renderMcpToolListing, type McpToolAnnotations, type McpToolListing } from "./tool-definitions";
import { // [B20 C2] the page section is rendered from the pagination constants, never restated
  MCP_TOOLS_LIST_CURSOR_CHARS,
  MCP_TOOLS_LIST_CURSOR_PATTERN,
  MCP_TOOLS_LIST_CURSOR_SCHEMA,
  MCP_TOOLS_LIST_PAGE_SIZE,
  MCP_TOOLS_LIST_PAGE_SIZE_BOUNDS,
} from "./tool-pages";

export const MCP_PROVIDER_PARITY_SCHEMA = "sirkit.mcp-provider-parity.v1" as const;
export const MCP_PARITY_REFUSALS = Object.freeze(["registry_unreadable", "listing_refused", "declarations_refused", "name_collision", "leg_missing"] as const);
export type McpParityRefusal = (typeof MCP_PARITY_REFUSALS)[number];
/** The compared legs, and the closed difference each one names when it does not hold. */
export const MCP_PARITY_LEGS = Object.freeze(["nameReversible", "descriptionEqual", "inputSchemaEqual", "titleEqual", "outputSchemaEqual"] as const);
export type McpParityLeg = (typeof MCP_PARITY_LEGS)[number];
export const MCP_PARITY_DIFFERENCES = Object.freeze(["name", "description", "inputSchema", "title", "outputSchema"] as const);
export type McpParityDifference = (typeof MCP_PARITY_DIFFERENCES)[number];

/** B3's result `_meta` key sets (`read-call.ts` MCP_READ_RESULT_META_KEYS): a frozen copy, pinned deep-equal to it (P13). */
export const MCP_PARITY_RESULT_META_KEYS = Object.freeze({
  always: Object.freeze(["io.modelcontextprotocol/serverInfo", "dev.sirkit/toolId", "dev.sirkit/toolVersion", "dev.sirkit/registryDigest", "dev.sirkit/listingDigest"] as const),
  success: Object.freeze(["dev.sirkit/invocationId", "dev.sirkit/revision", "dev.sirkit/revisionBinding", "dev.sirkit/boardId", "dev.sirkit/boardRevision", "dev.sirkit/boardDigest", "dev.sirkit/verification", "dev.sirkit/idempotency"] as const),
  refusal: Object.freeze(["dev.sirkit/refusal"] as const),
  optionalRefusal: Object.freeze(["dev.sirkit/currentRevision"] as const),
});
/** The request `_meta` bindings (OD-70; `read-arguments.ts` MCP_READ_META_KEYS): a frozen copy, pinned equal to it (P13). */
export const MCP_PARITY_REQUEST_META_KEYS = Object.freeze(["dev.sirkit/expectedRevision", "dev.sirkit/expectedRegistryDigest", "dev.sirkit/idempotencyKey"] as const);
/** The read result's own fields; every one MCP-only (the providers receive the agent loop's text). */
export const MCP_PARITY_RESULT_FIELDS = Object.freeze(["resultType", "content", "isError", "structuredContent"] as const);

type ProviderDeclaration = ReturnType<typeof buildAgentToolDeclarations>["declarations"][number];
/** Negative controls only: one rendering replaced. Production always renders through the real functions. */
export interface McpProviderParitySeams {
  readonly openAi?: (declaration: ProviderDeclaration) => OpenAiResponsesFunctionTool;
  readonly anthropic?: (declaration: ProviderDeclaration) => AnthropicAgentTool;
  readonly listing?: (registry: ToolRegistry) => McpToolListing;
}

export interface McpParityToolEntry {
  readonly toolId: string;
  readonly version: string;
  readonly mcpName: string;
  readonly providerName: string;
  readonly operationClass: ToolOperationClass;
  readonly permissionTier: PermissionTier;
  readonly title: string;
  readonly annotations: McpToolAnnotations;
  readonly inputSchemaDigest: string;
  /** "declared", or "omitted (<the closed reason>)" exactly as the MCP manifest writes it */
  readonly outputSchema: string;
  readonly outputSchemaOpaquePaths: readonly string[];
  readonly legs: Readonly<Record<McpParityLeg, boolean>>;
  readonly threeWayEquivalent: boolean;
  readonly differences: readonly McpParityDifference[];
}
export interface McpParityAgentOnlyEntry {
  readonly toolId: string;
  readonly version: string;
  readonly providerName: string;
  readonly reason: McpExclusionReason;
}
export interface McpProviderParityReport {
  readonly schema: typeof MCP_PROVIDER_PARITY_SCHEMA;
  readonly registryDigest: string;
  /** B1's role-independent listing digest (the manifest identity) */
  readonly listingDigest: string;
  readonly counts: Readonly<{ registry: number; agentExposed: number; mcpExposed: number; agentOnly: number }>;
  readonly documentedDifferences: readonly string[];
  readonly requestMetaKeys: readonly string[];
  readonly resultFields: readonly string[];
  readonly resultMetaKeys: typeof MCP_PARITY_RESULT_META_KEYS;
  readonly tools: readonly McpParityToolEntry[];
  readonly agentOnly: readonly McpParityAgentOnlyEntry[];
  /** [B20 C3] the first-party descriptor text gate: its bounds, its closed rule ids, and what the catalog measures today */
  readonly descriptorText: Readonly<{
    bounds: typeof DESCRIPTOR_TEXT_BOUNDS;
    allowedExtra: readonly string[];
    rules: readonly string[];
    maxima: Readonly<{ title: number; description: number; schemaText: number; schemaStrings: number }>;
  }>;
}
export type McpProviderParityResult = { readonly ok: true; readonly report: McpProviderParityReport } | { readonly ok: false; readonly code: McpParityRefusal };
export type McpParityRender = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly code: McpParityRefusal };

const REGISTRY_DIGEST_PATTERN = /^eng1-[0-9a-f]{16}$/;
const OPAQUE_MAX_DEPTH = 64;
const OPAQUE_MAX_NODES = 4_096;
const NEWLINE = String.fromCharCode(10);
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const LEG_DIFFERENCE: Readonly<Record<McpParityLeg, McpParityDifference>> = Object.freeze({
  nameReversible: "name", descriptionEqual: "description", inputSchemaEqual: "inputSchema", titleEqual: "title", outputSchemaEqual: "outputSchema",
});

/** The fixed sentences the report records, in order (every key list rendered from the constants above). */
function documentedDifferences(): string[] {
  return [
    "name: MCP lists the raw registry id (OD-52, first-party); OpenAI and Anthropic receive agentProviderName(toolId) ('.' mapped to '_', at most 64 characters); both resolve to one {toolId, version}.",
    "title: MCP only; a provider function tool carries no title.",
    "outputSchema: MCP only (OD-96); declared exactly when it passes the reserved-key scan, the proven wire subset, the structure check, an explicit object root and the output validator's evaluability. A success of a tool that declares one always carries a structuredContent that conforms to it, else the read is refused invalid_output; a tool that declares none never carries structuredContent.",
    "annotations: MCP only, derived from Sirkit's classification (operation class and idempotency); never read from a descriptor, and never authority.",
    `tool _meta: MCP only, ${MCP_META_KEYS.join(", ")} (OD-60).`,
    "strict: true: provider only; MCP carries the same strict inputSchema.",
    `request and result fields: the request _meta bindings ${MCP_PARITY_REQUEST_META_KEYS.join(", ")} are MCP-only request fields (OD-70); a read result's ${MCP_PARITY_RESULT_FIELDS.join(", ")} and its four _meta key sets are MCP only (the providers receive the agent loop's text).`,
  ];
}

/**
 * What the whole registry measures against the gate's bounds today (never re-derived by hand on the page). The schema
 * strings come from the GATE's own collector (`judgedSchemaStrings`), not from a second walker of this module's own: one
 * walker defines both the bound and the measurement, so the page can never publish a shallower reach than the gate judges.
 */
function descriptorTextMaxima(list: readonly ToolDescriptor[]): { title: number; description: number; schemaText: number; schemaStrings: number } {
  let title = 0, description = 0, schemaText = 0, schemaStrings = 0;
  for (const item of list) {
    title = Math.max(title, typeof item.title === "string" ? item.title.length : 0);
    description = Math.max(description, typeof item.description === "string" ? item.description.length : 0);
    const texts = [...judgedSchemaStrings(item.inputSchema), ...judgedSchemaStrings(item.outputSchema)];
    schemaStrings = Math.max(schemaStrings, texts.length);
    for (const text of texts) schemaText = Math.max(schemaText, text.length);
  }
  return { title, description, schemaText, schemaStrings };
}

class ParityRefusal {
  constructor(readonly code: McpParityRefusal) {}
}
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The sorted JSON paths of the object nodes of `schema` that declare no `properties` of their own — the members that are
 * OPAQUE to a client validating `structuredContent`; for an array whose `items` is such a node, the items path. Bounded
 * (depth 64, 4 096 nodes), cycle-safe by ancestor path, and never throws (an unreadable schema lists nothing).
 */
export function mcpOutputSchemaOpaquePaths(schema: unknown): readonly string[] {
  try {
    const found: string[] = [];
    const budget = { nodes: 0 };
    const visit = (node: unknown, path: string, depth: number, ancestors: object[]): void => {
      budget.nodes += 1;
      if (budget.nodes > OPAQUE_MAX_NODES || depth > OPAQUE_MAX_DEPTH || !isRecord(node) || ancestors.includes(node)) return;
      ancestors.push(node);
      try {
        if (node.type === "object" && !Object.hasOwn(node, "properties")) found.push(path);
        const properties = node.properties;
        if (isRecord(properties)) for (const name of Object.keys(properties)) visit(properties[name], `${path}.properties.${name}`, depth + 1, ancestors);
        if (node.items !== undefined) visit(node.items, `${path}.items`, depth + 1, ancestors);
      } finally {
        ancestors.pop();
      }
    };
    visit(schema, "$", 0, []);
    return Object.freeze([...new Set(found)].sort(byCodePoint));
  } catch {
    return Object.freeze([]);
  }
}

/** The three-way parity report over `registry` (the seams are for negative controls only). Never throws; never partial. */
export function renderMcpProviderParity(registry: ToolRegistry, seams: McpProviderParitySeams = {}): McpProviderParityResult {
  try {
    return Object.freeze({ ok: true, report: reportOf(registry, seams) });
  } catch (error) {
    return Object.freeze({ ok: false, code: error instanceof ParityRefusal ? error.code : "declarations_refused" });
  }
}

function reportOf(registry: ToolRegistry, seams: McpProviderParitySeams): McpProviderParityReport {
  // 1. the registry, read once (a throwing list() or digest(), a hostile descriptor, a digest of another shape)
  let list: ToolDescriptor[];
  let registryDigest: string;
  let agentSet: ToolDescriptor[];
  try {
    list = [...registry.list()];
    const digest: unknown = registry.digest();
    if (typeof digest !== "string" || !REGISTRY_DIGEST_PATTERN.test(digest)) throw new ParityRefusal("registry_unreadable");
    registryDigest = digest;
    agentSet = list.filter((item) => item.agentExposed === true);
  } catch {
    throw new ParityRefusal("registry_unreadable");
  }
  // 2. the agent declarations over the agent set, exactly as scripts/generate-agent-artifacts.ts builds them (no message forwarded)
  let built: ReturnType<typeof buildAgentToolDeclarations>;
  try {
    built = buildAgentToolDeclarations(agentSet);
  } catch (error) {
    throw new ParityRefusal(error instanceof Error && error.message.startsWith("AGENT_TOOL_NAME_COLLISION:") ? "name_collision" : "declarations_refused");
  }
  // 3. B1's listing (a typed refusal, or one bound to another registry digest, refuses the whole report)
  let listing: McpToolListing;
  try {
    listing = seams.listing ? seams.listing(registry) : renderMcpToolListing(registry);
    if (!Array.isArray(listing.tools) || listing.registryDigest !== registryDigest || typeof listing.listingDigest !== "string") throw new ParityRefusal("listing_refused");
  } catch {
    throw new ParityRefusal("listing_refused");
  }
  // 4. the legs, one entry per MCP-exposed tool, in listing order
  const tools = listing.tools.map((tool): McpParityToolEntry => {
    const version = tool._meta["dev.sirkit/toolVersion"];
    const source = list.find((item) => item.toolId === tool.name && item.version === version);
    const declaration = built.declarations.find((item) => item.toolId === tool.name && item.version === version);
    if (!source || !declaration) throw new ParityRefusal("leg_missing");
    const openAi = seams.openAi ? seams.openAi(declaration) : renderOpenAiResponsesTool(declaration);
    const anthropic = seams.anthropic ? seams.anthropic(declaration) : renderAnthropicAgentTool(declaration);
    if (!isRecord(openAi) || !isRecord(anthropic)) throw new ParityRefusal("leg_missing");
    const providerName = agentProviderName(tool.name);
    const resolved = built.resolve(providerName);
    const decision = mcpOutputSchemaDecision(source);
    const declaredOnTool = Object.hasOwn(tool, "outputSchema");
    const inputSchema = canonicalJson(tool.inputSchema);
    const legs: Record<McpParityLeg, boolean> = {
      nameReversible: tool.name === source.toolId && tool._meta["dev.sirkit/toolId"] === tool.name && declaration.providerName === providerName
        && openAi.name === providerName && anthropic.name === providerName && resolved?.toolId === tool.name && resolved?.version === version,
      descriptionEqual: tool.description === source.description && openAi.description === source.description && anthropic.description === source.description,
      inputSchemaEqual: canonicalJson(openAi.parameters) === inputSchema && canonicalJson(anthropic.input_schema) === inputSchema && canonicalJson(declaration.inputSchema) === inputSchema,
      titleEqual: tool.title === source.title,
      outputSchemaEqual: declaredOnTool === decision.declared && (!declaredOnTool || canonicalJson(tool.outputSchema) === canonicalJson(source.outputSchema)),
    };
    const differences = MCP_PARITY_LEGS.filter((leg) => !legs[leg]).map((leg) => LEG_DIFFERENCE[leg]);
    return {
      toolId: tool.name,
      version,
      mcpName: tool.name,
      providerName,
      operationClass: tool._meta["dev.sirkit/operationClass"],
      permissionTier: tool._meta["dev.sirkit/permissionTier"],
      title: tool.title,
      annotations: { ...tool.annotations },
      inputSchemaDigest: engineeringDigest(tool.inputSchema),
      outputSchema: decision.declared ? "declared" : `omitted (${decision.reason})`,
      outputSchemaOpaquePaths: [...mcpOutputSchemaOpaquePaths(source.outputSchema)],
      legs,
      threeWayEquivalent: differences.length === 0,
      differences,
    };
  });
  // 5. the agent-only tools: the agent set minus the MCP set, each with its closed reason (an exposable tool the listing
  //    left out has none — that is a missing leg, not a difference)
  const listed = new Set(tools.map((tool) => tool.toolId));
  const agentOnly = agentSet
    .filter((item) => !listed.has(item.toolId))
    .sort((a, b) => byCodePoint(a.toolId, b.toolId) || byCodePoint(a.version, b.version))
    .map((item): McpParityAgentOnlyEntry => {
      const reason = mcpExclusionReason(item);
      if (reason === null) throw new ParityRefusal("leg_missing");
      return { toolId: item.toolId, version: item.version, providerName: agentProviderName(item.toolId), reason };
    });
  return {
    schema: MCP_PROVIDER_PARITY_SCHEMA,
    registryDigest,
    listingDigest: listing.listingDigest,
    counts: { registry: list.length, agentExposed: agentSet.length, mcpExposed: tools.length, agentOnly: agentOnly.length },
    documentedDifferences: documentedDifferences(),
    requestMetaKeys: [...MCP_PARITY_REQUEST_META_KEYS],
    resultFields: [...MCP_PARITY_RESULT_FIELDS],
    resultMetaKeys: MCP_PARITY_RESULT_META_KEYS,
    tools,
    agentOnly,
    descriptorText: {
      bounds: DESCRIPTOR_TEXT_BOUNDS,
      allowedExtra: DESCRIPTOR_TEXT_ALLOWED_EXTRA.map((code) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`),
      rules: [...DESCRIPTOR_TEXT_RULES],
      maxima: descriptorTextMaxima(list),
    },
  };
}

/** The report as canonical JSON — the exact bytes of `mcp-parity.json` — or the closed refusal. */
export function renderMcpParityJson(registry: ToolRegistry): McpParityRender {
  const result = renderMcpProviderParity(registry);
  return result.ok ? Object.freeze({ ok: true, text: `${canonicalJson(result.report)}${NEWLINE}` }) : Object.freeze({ ok: false, code: result.code });
}

const code = (value: string): string => `\`${value}\``;
const verdict = (holds: boolean, when: string): string => (holds ? when : "DIFFERS");
const tableRow = (cells: readonly string[]): string => `| ${cells.join(" | ")} |`;

/** The generated page `mcp-parity.md` (every line rendered from the report), or the closed refusal. */
export function renderMcpParityMarkdown(registry: ToolRegistry): McpParityRender {
  const result = renderMcpProviderParity(registry);
  if (!result.ok) return Object.freeze({ ok: false, code: result.code });
  const report = result.report;
  const lines: string[] = [
    "# B20-C — the three-way parity of the MCP-exposed tools (generated)",
    "",
    "Generated by `scripts/generate-b20-mcp-parity.ts` from `renderMcpParityMarkdown` (`app/lib/mcp/server/tool-parity.ts`),",
    "with `mcp-parity.json` beside it; both are byte-gated by",
    "`app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts` (P9). Every statement below is CONFIRMED by the renderer",
    "that wrote it (OD-95): change the code and regenerate, never this page.",
    "",
    "## 1. Identity",
    "",
    `- Report schema: ${code(report.schema)}.`,
    `- Registry digest ${code(report.registryDigest)}; listing digest (B1's, role-independent: the manifest identity) ${code(report.listingDigest)}.`,
    `- ${report.counts.registry} registry descriptors, ${report.counts.agentExposed} agent-exposed, ${report.counts.mcpExposed} MCP-exposed, ${report.counts.agentOnly} agent-only.`,
    "",
    "## 2. The MCP-exposed tools, leg by leg",
    "",
    "Name: the raw id, the provider name and the declarations' reverse map agree. Description: byte-equal across the",
    "descriptor, OpenAI, Anthropic and MCP. inputSchema: canonical-equal across OpenAI `parameters`, Anthropic",
    "`input_schema` and MCP `inputSchema`. Title and outputSchema: MCP only, equal to the descriptor's. Opaque output",
    "members: object nodes of the declared output schema with no `properties` of their own — a client validating",
    "`structuredContent` learns only that they are objects.",
    "",
    tableRow(["tool", "version", "provider name", "class", "tier", "name", "description", "inputSchema", "title", "outputSchema", "opaque output members", "three-way"]),
    tableRow(Array.from({ length: 12 }, () => "---")),
    ...report.tools.map((tool) => tableRow([
      code(tool.toolId), tool.version, code(tool.providerName), tool.operationClass, String(tool.permissionTier),
      verdict(tool.legs.nameReversible, "reversible"), verdict(tool.legs.descriptionEqual, "equal"), verdict(tool.legs.inputSchemaEqual, "equal"),
      verdict(tool.legs.titleEqual, "MCP only"), verdict(tool.legs.outputSchemaEqual, tool.outputSchema),
      tool.outputSchemaOpaquePaths.length === 0 ? "none" : tool.outputSchemaOpaquePaths.map(code).join(", "),
      tool.threeWayEquivalent ? "equivalent" : `DIFFERS: ${tool.differences.join(", ")}`,
    ])),
    "",
    "## 3. Documented differences",
    "",
    ...report.documentedDifferences.map((sentence, index) => `${index + 1}. ${sentence}`),
    "",
    "## 4. Read results over MCP (MCP only)",
    "",
    `- Result fields: ${report.resultFields.map(code).join(", ")}.`,
    `- \`_meta\` on every result: ${report.resultMetaKeys.always.map(code).join(", ")}.`,
    `- \`_meta\` added on a success: ${report.resultMetaKeys.success.map(code).join(", ")}.`,
    `- \`_meta\` added on a refusal: ${report.resultMetaKeys.refusal.map(code).join(", ")}; when it is known, ${report.resultMetaKeys.optionalRefusal.map(code).join(", ")}.`,
    `- Request \`_meta\` bindings: ${report.requestMetaKeys.map(code).join(", ")}.`,
    "",
    "## 5. Agent-only tools (in the agent set, not MCP-exposed)",
    "",
    tableRow(["tool", "version", "provider name", "MCP exclusion reason"]),
    tableRow(["---", "---", "---", "---"]),
    ...report.agentOnly.map((entry) => tableRow([code(entry.toolId), entry.version, code(entry.providerName), code(entry.reason)])),
    "",
    "## 6. Pagination (C2)",
    "",
    `- \`tools/list\` serves pages of ${MCP_TOOLS_LIST_PAGE_SIZE} tools (reviewed bounds [${MCP_TOOLS_LIST_PAGE_SIZE_BOUNDS[0]}, ${MCP_TOOLS_LIST_PAGE_SIZE_BOUNDS[1]}]) cut from the caller's served listing in its own code-point name order (OD-97).`,
    `- The cursor is ${code(MCP_TOOLS_LIST_CURSOR_CHARS + " characters")} matching ${code(String(MCP_TOOLS_LIST_CURSOR_PATTERN))}: \`tl1-\` plus 16 hex of the repository digest over \`{schema: ${MCP_TOOLS_LIST_CURSOR_SCHEMA}, listingDigest, pageSize, offset}\`. It holds no secret and no server state.`,
    "- The server RECOMPUTES the cursors it would mint for the caller's current listing and page size and accepts a presented value only by exact equality with one of them; a cursor is never minted for offset 0, a non-multiple offset or the count.",
    "- A cursor this server would not mint — malformed or well-formed — is one identical 200 `-32602` that echoes nothing. A malformed one is decided on its SHAPE before the listing is computed, so it costs nothing and answers identically whatever the registry does.",
    `- Every page carries \`resultType: "complete"\`, \`ttlMs\` and \`cacheScope: "private"\`, and the registry digest plus the listing digest of the caller's WHOLE served listing (OD-98). The last page carries no \`nextCursor\` key.`,
    "- A registry, role or page-size change therefore invalidates every outstanding cursor, and the client restarts from no cursor.",
    "",
    "## 7. First-party descriptor text gate (C3)",
    "",
    "`validateToolDescriptor` refuses a descriptor whose tool id, title, description or schema texts (schema titles and",
    "descriptions, property names, `required` entries, string `enum` and `const` members) break any rule below; the MCP",
    "renderer re-applies the same gate after the strict conversion, over exactly what it emits, and judges an output schema",
    "only when it declares one (OD-99). Issues are fixed sentences naming the field kind and the rule id; they never echo",
    "the judged text.",
    "",
    "The tool id is judged because it is the one descriptor field a model reads verbatim: MCP lists it as the tool `name`",
    "and both provider adapters render `agentProviderName(toolId)` from it. The renderer judges it right after the",
    "structural name rule and BEFORE the exposure decision, and refuses it as `name_invalid` carrying no `toolId` and no",
    "detail, so a directive-shaped id is never echoed back.",
    "",
    `- Rules: ${report.descriptorText.rules.map(code).join(", ")}.`,
    `- Bounds: ${Object.entries(report.descriptorText.bounds).map(([name, value]) => `${code(name)} ${value}`).join(", ")}.`,
    `- Characters: U+0020 to U+007E, plus ${report.descriptorText.allowedExtra.map(code).join(", ")}. Everything else — line breaks, tabs, format and bidirectional characters, no-break space, other scripts, astral characters and lone surrogates — is refused.`,
    `- Measured today over the ${report.counts.registry} registry descriptors, with the gate's OWN collector: longest title ${report.descriptorText.maxima.title}, longest description ${report.descriptorText.maxima.description}, longest schema text ${report.descriptorText.maxima.schemaText}, most judged schema strings on one descriptor ${report.descriptorText.maxima.schemaStrings}.`,
    "- A descriptor carrying its own `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` or `annotations` key is invalid (OD-100): MCP annotations stay derived from Sirkit's classification alone.",
    "- Stated limit: `TOOL_REGISTRY_INVALID` still echoes the refused descriptor's `id@version` — the refused id included — its `owningCommandId` and its view command ids, as it did before C3. That message is a build-time refusal on the server, never model-bound text; the MCP renderer's own refusal carries neither the id nor the text.",
  ];
  return Object.freeze({ ok: true, text: `${lines.join(NEWLINE)}${NEWLINE}` });
}
