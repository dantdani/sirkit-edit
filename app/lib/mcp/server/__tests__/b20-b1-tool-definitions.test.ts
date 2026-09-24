/**
 * [B20 B1] The MCP tool definitions Sirkit's server side renders from its own canonical registry: the raw registry id as the
 * name, the SAME strict input schema the OpenAI and Anthropic adapters receive, an output schema only when it is within the
 * proven wire subset, annotations derived only from Sirkit's classification, Sirkit's identity under its own `_meta` prefix,
 * a deterministic listing identity with the registry digest bound in, a typed refusal instead of a partial list, and the
 * byte-gated manifest. Pure functions: no endpoint, no principal, no I/O (B2 serves them).
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAgentToolDeclarations, renderAnthropicAgentTool, renderOpenAiResponsesTool, validateSchemaStructure, validateWireSubset } from "@/app/lib/agent/provider-tools";
import { INTENTIONAL_MCP_EXPOSED_TOOL_IDS, mcpExclusionReason } from "@/app/lib/engineering/mcp-exposure";
import { permissionTierOfDescriptor } from "@/app/lib/engineering/permission-tiers";
import { canonicalJson, engineeringDigest } from "@/app/lib/engineering/stable";
import { sirkitToolRegistry, SIRKIT_TOOL_CATALOG } from "@/app/lib/engineering/tool-catalog";
import { ToolRegistry, type JsonSchema, type ToolDescriptor } from "@/app/lib/engineering/tool-registry";
import {
  MCP_META_KEYS,
  MCP_TOOL_LISTING_SCHEMA,
  MCP_TOOL_MANIFEST_CSV_COLUMNS,
  MCP_TOOL_NAME_PATTERN,
  MCP_TOOL_RENDER_REFUSALS,
  McpToolRenderError,
  mcpOutputSchemaDecision,
  renderMcpToolDefinition,
  renderMcpToolListing,
  renderMcpToolManifestCsv,
  renderMcpToolManifestJson,
  type McpToolDefinition,
} from "../tool-definitions";

const NEWLINE = String.fromCharCode(10);
const registry = sirkitToolRegistry();
const DIGEST = registry.digest();
const descriptor = (toolId: string): ToolDescriptor => {
  const found = registry.get(toolId);
  if (!found) throw new Error(`fixture: ${toolId} is not registered`);
  return found;
};
const forged = (base: ToolDescriptor, patch: Record<string, unknown>): ToolDescriptor => ({ ...base, ...patch }) as ToolDescriptor;
const exposed = (): ToolDescriptor[] => INTENTIONAL_MCP_EXPOSED_TOOL_IDS.map(descriptor);
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A schema object that contains itself. */
function cyclicSchema(): JsonSchema {
  const schema: Record<string, unknown> = { type: "object", properties: {}, additionalProperties: false };
  (schema.properties as Record<string, unknown>).self = schema;
  return schema as JsonSchema;
}
/** An acyclic strict object schema nested `levels` deep (each level adds two to the scan depth). */
function deepSchema(levels: number): JsonSchema {
  let schema: Record<string, unknown> = { type: "string" };
  for (let level = 0; level < levels; level += 1) schema = { type: "object", properties: { a: schema }, required: ["a"], additionalProperties: false };
  return schema as JsonSchema;
}
/** A value whose own-key listing throws (a hostile Proxy). */
const throwingKeys = (target: Record<string, unknown>): JsonSchema => new Proxy(target, { ownKeys() { throw new Error("hostile keys"); } }) as JsonSchema;
/** A copy of a descriptor whose `field` getter throws. */
const throwingField = (base: ToolDescriptor, field: keyof ToolDescriptor): ToolDescriptor =>
  Object.defineProperty({ ...base }, field, { get() { throw new Error("hostile getter"); }, enumerable: true }) as ToolDescriptor;

/** Every object and array reachable from a value (cycle-safe). */
function objectsOf(value: unknown, out = new Set<object>()): Set<object> {
  if (typeof value !== "object" || value === null || out.has(value)) return out;
  out.add(value);
  for (const child of Object.values(value)) objectsOf(child, out);
  return out;
}

/** The refusal a call answers, or "rendered" — the test never lets another error type through as a pass. */
function refusalOf(render: () => unknown): string {
  try {
    render();
    return "rendered";
  } catch (error) {
    if (!(error instanceof McpToolRenderError)) return `untyped: ${error instanceof Error ? error.name : typeof error}`;
    return error.code;
  }
}

/** The MCP `_meta` key syntax (reference notes section 7): optional reverse-DNS prefix and a slash, then the name. */
const LABEL = "[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
const META_KEY = new RegExp(`^(?:(${LABEL}(?:\\.${LABEL})*)/)?[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$`);

describe("[B20 B1] MCP tool definitions rendered from the canonical registry", () => {
  it("the listing renders exactly the 9 reviewed ids, sorted by name in code-point order, with the registry digest bound in", () => {
    const listing = renderMcpToolListing(registry);
    expect(Object.keys(listing).sort()).toEqual(["excluded", "listingDigest", "registryDigest", "tools"]);
    expect(listing.tools.map((tool) => tool.name)).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS].sort(byCodePoint));
    expect(listing.registryDigest).toBe(DIGEST);
    for (const tool of listing.tools) expect(tool._meta["dev.sirkit/registryDigest"], tool.name).toBe(DIGEST);
  });

  it("every name is the raw registry id and satisfies the MCP name rule (1-128 of A-Z a-z 0-9 _ . -)", () => {
    expect(String(MCP_TOOL_NAME_PATTERN)).toBe(String(/^[A-Za-z0-9_.-]{1,128}$/));
    for (const tool of renderMcpToolListing(registry).tools) {
      expect(tool.name).toMatch(/^[A-Za-z0-9_.-]{1,128}$/);
      expect(tool._meta["dev.sirkit/toolId"]).toBe(tool.name);
      expect(tool.title, tool.name).toBe(descriptor(tool.name).title);
      expect(tool.description, tool.name).toBe(descriptor(tool.name).description);
    }
  });

  it("every inputSchema equals the strict schema both provider adapters receive for the same descriptor (the three-way parity starts true)", () => {
    const declarations = buildAgentToolDeclarations(exposed()).declarations;
    const listing = renderMcpToolListing(registry);
    expect(declarations).toHaveLength(listing.tools.length);
    for (const tool of listing.tools) {
      const declaration = declarations.find((item) => item.toolId === tool.name)!;
      expect(tool.inputSchema, tool.name).toEqual(declaration.inputSchema);
      expect(canonicalJson(tool.inputSchema), tool.name).toBe(canonicalJson(declaration.inputSchema));
      expect(tool.inputSchema, tool.name).toEqual(renderOpenAiResponsesTool(declaration).parameters);
      expect(tool.inputSchema, tool.name).toEqual(renderAnthropicAgentTool(declaration).input_schema);
      expect(tool.inputSchema.type, tool.name).toBe("object");
      expect(tool.inputSchema.additionalProperties, tool.name).toBe(false);
    }
  });

  it("a no-argument tool renders {type: object, additionalProperties: false, properties: {}, required: []}", () => {
    const noArgument = exposed().filter((item) => Object.keys((item.inputSchema.properties ?? {}) as object).length === 0);
    expect(noArgument.map((item) => item.toolId).length).toBeGreaterThanOrEqual(3);
    const shape = { type: "object", additionalProperties: false, properties: {}, required: [] };
    for (const item of noArgument) expect(renderMcpToolDefinition(item, DIGEST).inputSchema, item.toolId).toEqual(shape);
    // the bare `{type: "object"}` form a descriptor may declare renders the same explicit shape
    expect(renderMcpToolDefinition(forged(descriptor("sirkit.pcb.board-inspect"), { inputSchema: { type: "object" } }), DIGEST).inputSchema).toEqual(shape);
  });

  it("outputSchema is declared exactly when the registry output schema passes the structure and wire-subset checks with an object root; otherwise it is omitted with a closed reason", () => {
    for (const tool of renderMcpToolListing(registry).tools) {
      const source = descriptor(tool.name).outputSchema;
      const passes = validateSchemaStructure(source).length === 0 && validateWireSubset(source).length === 0 && source.type === "object";
      expect(passes, tool.name).toBe(true);
      expect(tool.outputSchema, tool.name).toEqual(source);
      expect(mcpOutputSchemaDecision(descriptor(tool.name)), tool.name).toEqual({ declared: true });
    }
    const read = descriptor("sirkit.pcb.board-inspect");
    const omitted: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
      ["a keyword outside the wire subset", { type: "object", properties: { items: { type: "array", items: { type: "object" }, maxItems: 5 } }, required: ["items"], additionalProperties: false }, "outside the proven wire subset"],
      ["an unconstrained member", { type: "object", properties: { report: {} }, required: ["report"], additionalProperties: false }, "not a valid schema structure"],
      ["a string root", { type: "string" }, "root is not an explicit object schema"],
      ["a property named constructor", { type: "object", properties: { constructor: { type: "string" } }, required: ["constructor"], additionalProperties: false }, "a reserved key (__proto__, constructor, prototype)"],
      ["a property named __proto__ from parsed data", JSON.parse(`{"type":"object","properties":{"__proto__":{"type":"string"}},"additionalProperties":false}`) as Record<string, unknown>, "a reserved key (__proto__, constructor, prototype)"],
    ];
    for (const [label, outputSchema, reason] of omitted) {
      const item = forged(read, { outputSchema });
      expect(mcpOutputSchemaDecision(item), label).toEqual({ declared: false, reason });
      const definition = renderMcpToolDefinition(item, DIGEST);
      expect("outputSchema" in definition, label).toBe(false);
    }
    const cyclic: Record<string, unknown> = { type: "object", properties: {} };
    (cyclic.properties as Record<string, unknown>).self = cyclic;
    expect(mcpOutputSchemaDecision(forged(read, { outputSchema: cyclic }))).toEqual({ declared: false, reason: "not a valid schema structure" });
  });

  it("annotations are derived only from Sirkit's classification; annotation-like fields on the descriptor are ignored", () => {
    // hard-coded per exposed id (never re-derived with the implementation's own formula): 9 reads, all `natural`
    // ([B20 B3] pin move: 11 -> 9 reads, two withheld under OD-69; [B20 B4] pin move: the 5 proposals are withheld under
    // OD-82 / OD-87, so no exposed tool renders readOnlyHint false)
    const PROPOSALS = ["sirkit.pcb.propose-bounded-edit", "sirkit.placement.propose", "sirkit.routing.propose", "sirkit.schematic.propose-component-replacement", "sirkit.schematic.propose-tier1-edit"];
    const EXPECTED: Record<string, { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean }> = Object.fromEntries(
      INTENTIONAL_MCP_EXPOSED_TOOL_IDS.map((id) => [id, { readOnlyHint: !PROPOSALS.includes(id), destructiveHint: false, idempotentHint: true, openWorldHint: false }]),
    );
    expect(Object.keys(EXPECTED)).toHaveLength(9); // [B20 B3] pin move: 16 -> 14; [B20 B4] pin move: 14 -> 9
    for (const item of exposed()) {
      const expected = EXPECTED[item.toolId]!;
      expect(renderMcpToolDefinition(item, DIGEST).annotations, item.toolId).toEqual(expected);
      const hostile = forged(item, { readOnlyHint: !expected.readOnlyHint, destructiveHint: true, idempotentHint: !expected.idempotentHint, openWorldHint: true, annotations: { readOnlyHint: !expected.readOnlyHint, destructiveHint: true, openWorldHint: true } });
      expect(renderMcpToolDefinition(hostile, DIGEST).annotations, item.toolId).toEqual(expected);
    }
    const listing = renderMcpToolListing(registry).tools;
    expect(Object.fromEntries(listing.map((tool) => [tool.name, tool.annotations]))).toEqual(EXPECTED);
    // idempotentHint is true ONLY for `natural`: every other idempotency value (and a missing or unknown one) renders false
    // [B20 B4] pin move: the second base was placement.propose, withheld since B4 (it no longer renders); a second read instead
    for (const base of [descriptor("sirkit.pcb.board-inspect"), descriptor("sirkit.pcb.via-inspect")]) {
      for (const idempotency of ["required-key", "not-applicable", "sometimes", ""]) {
        expect(renderMcpToolDefinition(forged(base, { idempotency }), DIGEST).annotations.idempotentHint, `${base.toolId} ${idempotency}`).toBe(false);
      }
    }
  });

  it("_meta carries exactly the five dev.sirkit/ keys with the descriptor's identity; every key has the MCP key syntax and none sits under a reserved prefix", () => {
    expect([...MCP_META_KEYS]).toEqual(["dev.sirkit/toolId", "dev.sirkit/toolVersion", "dev.sirkit/registryDigest", "dev.sirkit/operationClass", "dev.sirkit/permissionTier"]);
    for (const tool of renderMcpToolListing(registry).tools) {
      const item = descriptor(tool.name);
      expect(tool._meta).toEqual({
        "dev.sirkit/toolId": item.toolId,
        "dev.sirkit/toolVersion": item.version,
        "dev.sirkit/registryDigest": DIGEST,
        "dev.sirkit/operationClass": item.operationClass,
        "dev.sirkit/permissionTier": permissionTierOfDescriptor(item),
      });
      for (const key of Object.keys(tool._meta)) {
        const match = META_KEY.exec(key);
        expect(match, key).not.toBeNull();
        const labels = (match![1] ?? "").split(".");
        expect(["modelcontextprotocol", "mcp"], key).not.toContain(labels[1]);
        expect(key.startsWith("dev.sirkit/"), key).toBe(true);
      }
    }
  });

  it("every rendered object is frozen at every depth and built fresh: nothing is shared with the registry descriptor or between two renders", () => {
    const first = renderMcpToolListing(registry);
    const second = renderMcpToolListing(registry);
    expect(first).not.toBe(second);
    expect(first).toEqual(second);
    const firstObjects = objectsOf(first);
    for (const value of firstObjects) expect(Object.isFrozen(value)).toBe(true);
    for (const value of objectsOf(second)) expect(firstObjects.has(value)).toBe(false);
    const registryObjects = objectsOf(registry.list());
    for (const value of firstObjects) expect(registryObjects.has(value)).toBe(false);
    // [B20 B4] pin move: the single definition was propose-tier1-edit, withheld since B4; via-inspect has an input property too
    const definition = renderMcpToolDefinition(descriptor("sirkit.pcb.via-inspect"), DIGEST);
    for (const value of objectsOf(definition)) expect(Object.isFrozen(value)).toBe(true);
    expect(objectsOf(definition).has(descriptor("sirkit.pcb.via-inspect").inputSchema)).toBe(false);
  });

  it("the listing digest is engineeringDigest over {schema, registryDigest, tools} and is stable under the registry's input order", () => {
    const listing = renderMcpToolListing(registry);
    expect(MCP_TOOL_LISTING_SCHEMA).toBe("sirkit.mcp-tool-listing.v1");
    expect(listing.listingDigest).toBe(engineeringDigest({ schema: MCP_TOOL_LISTING_SCHEMA, registryDigest: DIGEST, tools: listing.tools }));
    const reversed = renderMcpToolListing(new ToolRegistry([...SIRKIT_TOOL_CATALOG].reverse()));
    expect(reversed.registryDigest).toBe(DIGEST);
    expect(reversed.listingDigest).toBe(listing.listingDigest);
    expect(canonicalJson(reversed)).toBe(canonicalJson(listing));
  });

  it("the listing digest changes when any rendered definition changes and when only the registry digest changes", () => {
    const listing = renderMcpToolListing(registry);
    const digestOf = (registryDigest: string, tools: readonly McpToolDefinition[]): string => engineeringDigest({ schema: MCP_TOOL_LISTING_SCHEMA, registryDigest, tools });
    const changed = new Set<string>();
    for (let index = 0; index < listing.tools.length; index += 1) {
      const tools = listing.tools.map((tool, at) => (at === index ? { ...tool, description: `${tool.description} ` } : tool));
      changed.add(digestOf(DIGEST, tools));
    }
    expect(changed.size).toBe(listing.tools.length);
    expect(changed.has(listing.listingDigest)).toBe(false);
    expect(digestOf("eng1-0000000000000000", listing.tools)).not.toBe(listing.listingDigest);
    // a real registry change to one exposed descriptor moves both digests
    const edited = new ToolRegistry(SIRKIT_TOOL_CATALOG.map((item) => (item.toolId === "sirkit.pcb.via-inspect" ? { ...item, description: `${item.description} (edited)` } : item)));
    const moved = renderMcpToolListing(edited);
    expect(moved.registryDigest).not.toBe(DIGEST);
    expect(moved.listingDigest).not.toBe(listing.listingDigest);
    // a change to an EXCLUDED descriptor moves the registry digest, and with it the listing identity
    const excludedEdit = new ToolRegistry(SIRKIT_TOOL_CATALOG.map((item) => (item.toolId === "sirkit.pcb.move-footprint" ? { ...item, description: `${item.description} (edited)` } : item)));
    expect(renderMcpToolListing(excludedEdit).listingDigest).not.toBe(listing.listingDigest);
  });

  it("the excluded list names every other registry descriptor once with its closed reason, sorted by id", () => {
    const listing = renderMcpToolListing(registry);
    expect(listing.tools.length + listing.excluded.length).toBe(registry.list().length);
    expect(listing.excluded.map((entry) => entry.toolId)).toEqual(registry.list().map((item) => item.toolId).filter((id) => !INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(id)).sort(byCodePoint));
    for (const entry of listing.excluded) {
      expect(Object.keys(entry).sort()).toEqual(["reason", "toolId", "version"]);
      expect(entry.reason, entry.toolId).toBe(mcpExclusionReason(descriptor(entry.toolId)));
      expect(entry.version, entry.toolId).toBe(descriptor(entry.toolId).version);
    }
  });

  it("the render refuses with a typed error instead of returning a partial list or a definition it cannot stand behind", () => {
    expect([...MCP_TOOL_RENDER_REFUSALS]).toEqual(["exposure_drift", "not_exposable", "descriptor_invalid", "name_invalid", "reserved_key", "input_schema_not_strict", "registry_digest_invalid"]);
    const read = descriptor("sirkit.pcb.board-inspect");
    const board = (patch: Record<string, unknown>): ToolRegistry => new ToolRegistry(SIRKIT_TOOL_CATALOG.map((item) => (item.toolId === "sirkit.pcb.board-inspect" ? { ...item, ...patch } as ToolDescriptor : item)));
    const cases: ReadonlyArray<readonly [string, () => unknown, string]> = [
      ["a registry with a new agent-exposed read", () => renderMcpToolListing(new ToolRegistry([...SIRKIT_TOOL_CATALOG, { ...read, toolId: "sirkit.pcb.extra-inspect" } as ToolDescriptor])), "exposure_drift"],
      ["a registry that withdrew a reviewed id", () => renderMcpToolListing(board({ agentExposed: false })), "exposure_drift"],
      ["a registry exposing two versions of one id", () => renderMcpToolListing(new ToolRegistry([...SIRKIT_TOOL_CATALOG, { ...read, version: "9.0.0" } as ToolDescriptor])), "exposure_drift"],
      ["a registry whose exposed input schema leaves the wire subset", () => renderMcpToolListing(board({ inputSchema: { type: "object", properties: { net: { type: "string", pattern: "^N" } }, additionalProperties: false } })), "input_schema_not_strict"],
      ["the granted move", () => renderMcpToolDefinition(descriptor("sirkit.pcb.move-footprint"), DIGEST), "not_exposable"],
      ["the release", () => renderMcpToolDefinition(descriptor("sirkit.manufacturing.release"), DIGEST), "not_exposable"],
      ["a view-session control", () => renderMcpToolDefinition(descriptor("sirkit.view.layers"), DIGEST), "not_exposable"],
      ["an external read", () => renderMcpToolDefinition(descriptor("sirkit.parts.external-search"), DIGEST), "not_exposable"],
      ["a name over 128 characters", () => renderMcpToolDefinition(forged(read, { toolId: `sirkit.${"a".repeat(130)}` }), DIGEST), "name_invalid"],
      ["a name with a space", () => renderMcpToolDefinition(forged(read, { toolId: "sirkit.pcb.board inspect" }), DIGEST), "name_invalid"],
      ["a non-strict input schema", () => renderMcpToolDefinition(forged(read, { inputSchema: { type: "object", properties: { n: { type: "number", minimum: 0 } } } }), DIGEST), "input_schema_not_strict"],
      ["an array input root", () => renderMcpToolDefinition(forged(read, { inputSchema: { type: "array", items: { type: "string" } } }), DIGEST), "input_schema_not_strict"],
      ["a reserved input key", () => renderMcpToolDefinition(forged(read, { inputSchema: { type: "object", properties: { prototype: { type: "string" } } } }), DIGEST), "reserved_key"],
      ["a missing title", () => renderMcpToolDefinition(forged(read, { title: "" }), DIGEST), "descriptor_invalid"],
      ["a malformed version", () => renderMcpToolDefinition(forged(read, { version: "one" }), DIGEST), "descriptor_invalid"],
      ["a malformed descriptor", () => renderMcpToolDefinition(null as unknown as ToolDescriptor, DIGEST), "descriptor_invalid"],
      ["a getter that throws", () => renderMcpToolDefinition(new Proxy({}, { get() { throw new Error("hostile"); } }) as ToolDescriptor, DIGEST), "descriptor_invalid"],
      ["an empty registry digest", () => renderMcpToolDefinition(read, ""), "registry_digest_invalid"],
      ["a registry digest of another shape", () => renderMcpToolDefinition(read, "sha256-abc"), "registry_digest_invalid"],
      // [B20 B1 review] a read or proposal that writes state, and an admissible id outside the reviewed list, never render
      ["a read that writes engineering state", () => renderMcpToolDefinition(forged(read, { sideEffects: "engineering-state" }), DIGEST), "not_exposable"],
      ["a proposal that writes engineering state", () => renderMcpToolDefinition(forged(descriptor("sirkit.placement.propose"), { sideEffects: "engineering-state" }), DIGEST), "not_exposable"],
      ["an admissible read under an unreviewed id", () => renderMcpToolDefinition(forged(read, { toolId: "sirkit.pcb.extra-inspect" }), DIGEST), "not_exposable"],
      // [B20 B1 review] an input schema that cannot be scanned or is unbounded: typed refusals, never a raw error
      ["a cyclic input schema", () => renderMcpToolDefinition(forged(read, { inputSchema: cyclicSchema() }), DIGEST), "input_schema_not_strict"],
      ["an input schema nested past the depth bound (acyclic)", () => renderMcpToolDefinition(forged(read, { inputSchema: deepSchema(40) }), DIGEST), "input_schema_not_strict"],
      ["an input schema whose key listing throws", () => renderMcpToolDefinition(forged(read, { inputSchema: throwingKeys({ type: "object" }) }), DIGEST), "descriptor_invalid"],
      ["an output schema getter that throws", () => renderMcpToolDefinition(throwingField(read, "outputSchema"), DIGEST), "descriptor_invalid"],
    ];
    const wrong = cases.filter(([, render, code]) => refusalOf(render) !== code).map(([label, render]) => `${label}: ${refusalOf(render)}`);
    expect(wrong).toEqual([]);
    // the depth bound is what refuses the deep schema: the provider conversion alone accepts it
    expect(buildAgentToolDeclarations([forged(read, { inputSchema: deepSchema(40) })]).declarations).toHaveLength(1);
    expect(refusalOf(() => renderMcpToolDefinition(forged(read, { inputSchema: deepSchema(20) }), DIGEST))).toBe("rendered");
    const detail = (render: () => unknown): string | null => { try { render(); return null; } catch (error) { return (error as McpToolRenderError).detail; } };
    expect(detail(() => renderMcpToolDefinition(forged(read, { sideEffects: "engineering-state" }), DIGEST))).toBe("side_effects");
    expect(detail(() => renderMcpToolDefinition(forged(read, { toolId: "sirkit.pcb.extra-inspect" }), DIGEST))).toBe("not_mcp_reviewed");
  });

  it("the listing and the manifest never throw anything but the typed refusal, and never return a partial list", () => {
    const countingRegistry = (after: number, source: ToolRegistry = registry): { registry: ToolRegistry; calls: () => number } => {
      let calls = 0;
      const double = {
        list: () => { calls += 1; if (calls > after) throw new Error("hostile registry"); return source.list(); },
        digest: () => source.digest(),
        get: (toolId: string, version?: string) => source.get(toolId, version),
      } as unknown as ToolRegistry;
      return { registry: double, calls: () => calls };
    };
    const probe = countingRegistry(Number.MAX_SAFE_INTEGER);
    renderMcpToolListing(probe.registry);
    const listingReads = probe.calls();
    expect(listingReads).toBeGreaterThan(0);
    const withBoard = (patch: Record<string, unknown>): ToolRegistry => ({
      list: () => registry.list().map((item) => (item.toolId === "sirkit.pcb.board-inspect" ? { ...item, ...patch } as ToolDescriptor : item)),
      digest: () => DIGEST,
    }) as unknown as ToolRegistry;
    /** Answers the full registry on its first read and drops an exposed tool on every later one (fresh per call). */
    const shrinking = (): ToolRegistry => {
      let reads = 0;
      return { list: () => { reads += 1; return reads === 1 ? registry.list() : registry.list().filter((item) => item.toolId !== "sirkit.pcb.via-inspect"); }, digest: () => DIGEST } as unknown as ToolRegistry;
    };
    const cases: ReadonlyArray<readonly [string, () => unknown, string]> = [
      ["a registry whose list() throws", () => renderMcpToolListing(countingRegistry(0).registry), "exposure_drift"],
      ["a registry whose digest() throws", () => renderMcpToolListing({ list: () => registry.list(), digest: () => { throw new Error("hostile digest"); } } as unknown as ToolRegistry), "descriptor_invalid"],
      ["an exposed descriptor whose input schema key listing throws", () => renderMcpToolListing(withBoard({ inputSchema: throwingKeys({ type: "object" }) })), "descriptor_invalid"],
      ["a registry whose second read drops an exposed tool", () => renderMcpToolListing(shrinking()), "exposure_drift"],
      ["a manifest whose own registry read throws after the listing", () => renderMcpToolManifestCsv(countingRegistry(listingReads).registry), "descriptor_invalid"],
      ["a manifest over a registry whose list() throws", () => renderMcpToolManifestCsv(countingRegistry(0).registry), "exposure_drift"],
      ["a JSON manifest over a registry whose digest() throws", () => renderMcpToolManifestJson({ list: () => registry.list(), digest: () => { throw new Error("hostile digest"); } } as unknown as ToolRegistry), "descriptor_invalid"],
    ];
    const wrong = cases.filter(([, render, code]) => refusalOf(render) !== code).map(([label, render]) => `${label}: ${refusalOf(render)}`);
    expect(wrong).toEqual([]);
    // the manifest case above really reached the manifest's own read (not a refusal inside the listing)
    const manifestProbe = countingRegistry(listingReads);
    refusalOf(() => renderMcpToolManifestCsv(manifestProbe.registry));
    expect(manifestProbe.calls()).toBe(listingReads + 1);
  });

  it("mcpOutputSchemaDecision never throws: a throwing getter or an unscannable schema is omitted with a closed reason", () => {
    const read = descriptor("sirkit.pcb.board-inspect");
    const inputs: ReadonlyArray<readonly [string, Pick<ToolDescriptor, "outputSchema">]> = [
      ["an outputSchema getter that throws", throwingField(read, "outputSchema")],
      ["an output schema whose key listing throws", { outputSchema: throwingKeys({ type: "object" }) }],
      ["a descriptor that is a hostile proxy", new Proxy({}, { get() { throw new Error("hostile"); } }) as Pick<ToolDescriptor, "outputSchema">],
      ["a cyclic output schema", { outputSchema: cyclicSchema() }],
      ["an output schema nested past the depth bound", { outputSchema: deepSchema(40) }],
    ];
    for (const [label, input] of inputs) {
      const decide = (): unknown => mcpOutputSchemaDecision(input);
      expect(decide, label).not.toThrow();
      expect(decide(), label).toEqual({ declared: false, reason: "not a valid schema structure" });
    }
  });

  it("a refusal never echoes an invalid name or the descriptor's text: only the closed code and a name that passed the MCP rule", () => {
    const read = descriptor("sirkit.pcb.board-inspect");
    const hostileName = `sirkit.pcb.${"x".repeat(5000)}${String.fromCharCode(27)}[31m`;
    const error = (() => { try { renderMcpToolDefinition(forged(read, { toolId: hostileName }), DIGEST); } catch (caught) { return caught; } return null; })();
    expect(error).toBeInstanceOf(McpToolRenderError);
    const refusal = error as McpToolRenderError;
    expect(refusal.code).toBe("name_invalid");
    expect(refusal.toolId).toBeNull();
    expect(refusal.message.length).toBeLessThan(200);
    expect(refusal.message).not.toContain("xxxxxxxx");
    const excluded = (() => { try { renderMcpToolDefinition(descriptor("sirkit.pcb.move-footprint"), DIGEST); } catch (caught) { return caught as McpToolRenderError; } return null; })();
    expect(excluded).toMatchObject({ code: "not_exposable", toolId: "sirkit.pcb.move-footprint", detail: "granted_execution" });
    // [B20 B1 review] the excluded path too: a hostile id on a granted (and on an otherwise excluded) descriptor is refused as
    // a name, never echoed — the name is checked before anything else
    for (const base of ["sirkit.pcb.move-footprint", "sirkit.view.layers", "sirkit.parts.external-search"]) {
      const caught = (() => { try { renderMcpToolDefinition(forged(descriptor(base), { toolId: hostileName }), DIGEST); } catch (thrown) { return thrown; } return null; })();
      expect(caught, base).toBeInstanceOf(McpToolRenderError);
      expect(caught, base).toMatchObject({ code: "name_invalid", toolId: null, detail: null });
      expect((caught as McpToolRenderError).message.length, base).toBeLessThan(200);
      expect((caught as McpToolRenderError).message, base).not.toContain(String.fromCharCode(27));
    }
    // and the refusal type itself never carries a name that fails the MCP rule, whatever a call site hands it
    for (const code of MCP_TOOL_RENDER_REFUSALS) {
      const refused = new McpToolRenderError(code, hostileName, "granted_execution");
      expect(refused.toolId, code).toBeNull();
      expect(refused.message, code).toBe(`MCP_TOOL_RENDER_REFUSED:${code}`);
      expect(new McpToolRenderError(code, "sirkit.pcb.board-inspect").toolId, code).toBe("sirkit.pcb.board-inspect");
      expect(new McpToolRenderError(code, 7 as unknown as string).toolId, code).toBeNull();
    }
  });

  /** Every module specifier a source imports or re-exports: static (with or without a trailing comment), multi-line,
   *  side-effect-only, `export … from`, dynamic `import()` and `require()`. */
  const IMPORT_FORMS = [
    /^\s*(?:import|export)\s+(?:type\s+)?(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  ];
  const specifiersOf = (source: string): string[] => IMPORT_FORMS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]!));
  /** The anchored form the B04 gate (b04-tool-registry.test.ts, case 26+28) and the first B1 purity case used. */
  const ANCHORED_IMPORT = /^import[^;]+from\s+"([^"]+)";?$/gm;
  const FORBIDDEN_SPECIFIER = /^node:|^(fs|net|http|https|child_process|os|path|crypto|worker_threads|dns|tls)$|http-transport|server-registry|rollout|outbound-fetch|openai|anthropic|@modelcontextprotocol/;
  const PURE_MODULES = ["app/lib/mcp/server/tool-definitions.ts", "app/lib/engineering/mcp-exposure.ts", "app/lib/engineering/mcp-exposure-review.ts"];

  it("the import scanner sees every import form, including the tagged form this repository uses (a trailing comment)", () => {
    const sample = [
      `import { a } from "./a";`,
      `import { readFileSync } from "node:fs"; // [B20 B3]`,
      `import "node:net";`,
      `import {`,
      `  b,`,
      `  c,`,
      `} from "./b"; // [B20 B3]`,
      `import type { T } from "./t";`,
      `export { d } from "./d";`,
      `export * from "./e";`,
      `const f = await import("./f");`,
      `const g = require("./g");`,
    ].join(NEWLINE);
    expect(specifiersOf(sample).sort()).toEqual(["./a", "./b", "./d", "./e", "./f", "./g", "./t", "node:fs", "node:net"]);
    // the anchored form misses the tagged, side-effect, multi-line-tagged, re-export and dynamic forms
    expect([...sample.matchAll(ANCHORED_IMPORT)].map((match) => match[1])).toEqual(["./a", "./t"]);
  });

  it("the B04 import gate sees every import of tool-discovery.ts (B1's import is untagged on its own line)", () => {
    const source = readFileSync(resolve(process.cwd(), "app/lib/engineering/tool-discovery.ts"), "utf8");
    const seenByGate = [...source.matchAll(ANCHORED_IMPORT)].map((match) => match[1]!).sort();
    expect(seenByGate).toContain("./mcp-exposure");
    expect(seenByGate).toEqual(specifiersOf(source).sort());
  });

  it("the modules are pure: no I/O, network, process, environment, clock or randomness, and nothing from the MCP client track", () => {
    for (const file of PURE_MODULES) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8");
      const imports = specifiersOf(source);
      if (file.endsWith("mcp-exposure-review.ts")) expect(imports, file).toEqual([]); // data only
      else expect(imports.length, file).toBeGreaterThan(0);
      for (const specifier of imports) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(FORBIDDEN_SPECIFIER);
        expect(specifier.startsWith("./") || specifier.startsWith("../"), `${file} imports ${specifier}`).toBe(true);
      }
      expect(source, file).not.toMatch(/process\.|Date\.now|new Date|Math\.random|console\.|performance\.|setTimeout|setInterval/);
      expect(source, file).not.toMatch(/fetch\(|XMLHttpRequest|WebSocket|EventSource/i);
    }
  });
});

describe("[B20 B1] the byte-gated MCP tool manifest", () => {
  const read = (name: string): string => readFileSync(resolve(process.cwd(), "artifacts/ai-control-plane-b20", name), "utf8").replaceAll(`${String.fromCharCode(13)}${NEWLINE}`, NEWLINE);

  it("the manifest CSV has one row per registry descriptor with its exposure, closed reason, hints and output-schema decision", () => {
    expect([...MCP_TOOL_MANIFEST_CSV_COLUMNS]).toEqual(["tool_id", "version", "operation_class", "permission_tier", "binding", "exposed", "exclusion_reason", "read_only_hint", "idempotent_hint", "output_schema"]);
    const lines = renderMcpToolManifestCsv(registry).split(NEWLINE);
    expect(lines.at(-1)).toBe("");
    expect(lines[0]).toBe(MCP_TOOL_MANIFEST_CSV_COLUMNS.join(","));
    const rows = lines.slice(1, -1);
    expect(rows).toHaveLength(registry.list().length);
    expect(rows.map((row) => row.split(",")[0])).toEqual(registry.list().map((item) => item.toolId).sort(byCodePoint));
    expect(rows).toContain("sirkit.pcb.board-inspect,1.1.0,read,0,bound-read,yes,,true,true,declared");
    // [B20 B4] pin move (OD-87): placement is withheld, so its row carries the reason and no hints
    expect(rows).toContain("sirkit.placement.propose,1.1.0,propose,2,bound-proposal,no,withheld,,,");
    expect(rows).toContain("sirkit.pcb.move-footprint,1.1.1,mutate,1,bound-mutation-editor-session,no,granted_execution,,,");
    expect(rows).toContain("sirkit.manufacturing.release,1.0.0,release,3,unbound,no,tier3,,,");
    expect(rows.filter((row) => row.split(",")[5] === "yes")).toHaveLength(9); // [B20 B3] pin move: 16 -> 14 (OD-69); [B20 B4] pin move: 14 -> 9 (OD-82, OD-87)
  });

  it("mcp-tool-manifest.csv and mcp-tool-manifest.json byte-match the render", () => {
    for (const name of ["mcp-tool-manifest.csv", "mcp-tool-manifest.json"]) {
      expect(existsSync(resolve(process.cwd(), "artifacts/ai-control-plane-b20", name)), `run: npx tsx scripts/generate-b20-mcp-tool-manifest.ts (${name})`).toBe(true);
    }
    expect(read("mcp-tool-manifest.csv")).toBe(renderMcpToolManifestCsv(registry));
    expect(read("mcp-tool-manifest.json")).toBe(renderMcpToolManifestJson(registry));
    expect(renderMcpToolManifestJson(registry)).toBe(`${canonicalJson(renderMcpToolListing(registry))}${NEWLINE}`);
    expect(JSON.parse(read("mcp-tool-manifest.json"))).toMatchObject({ registryDigest: DIGEST, listingDigest: renderMcpToolListing(registry).listingDigest });
  });
});
