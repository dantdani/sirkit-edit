/**
 * [B20 C1] P — the THREE-WAY parity of every MCP-exposed tool: the OpenAI rendering, the Anthropic rendering and B1's MCP
 * definition agree on the name (reversibly), the description (byte for byte) and the strict input schema (canonical-equal),
 * and everything only one side carries is recorded, not assumed. The report is a pure renderer (`tool-parity.ts`) with a
 * byte-gated artifact pair; the B09 parity artifact gets its first byte pin here (OD-95).
 *
 * Nothing here reaches a network, a clock, a database or a random source. Every negative control is an injected double or a
 * seam: the production renderers are never patched.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentProviderName,
  buildAgentToolDeclarations,
  renderAgentProviderParity,
  renderAnthropicAgentTool,
  renderOpenAiResponsesTool,
  validateSchemaStructure,
  validateWireSubset,
} from "@/app/lib/agent/provider-tools";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS } from "@/app/lib/engineering/agent-exposure";
import {
  DESCRIPTOR_TEXT_ALLOWED_EXTRA,
  DESCRIPTOR_TEXT_BOUNDS,
  DESCRIPTOR_TEXT_RULES,
  judgedSchemaStrings,
} from "@/app/lib/engineering/descriptor-text";
import { INTENTIONAL_MCP_EXPOSED_TOOL_IDS, mcpExclusionReason } from "@/app/lib/engineering/mcp-exposure";
import { canonicalJson, engineeringDigest } from "@/app/lib/engineering/stable";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { renderOpenAiTool, renderProviderParityReport } from "@/app/lib/engineering/tool-provider-adapters";
import { ToolRegistry, type ToolDescriptor } from "@/app/lib/engineering/tool-registry";
import { MCP_READ_META_KEYS } from "../read-arguments";
import { MCP_READ_RESULT_META_KEYS } from "../read-call";
import { mcpOutputSchemaEvaluable } from "../structured-content";
import {
  MCP_PARITY_REFUSALS,
  MCP_PARITY_REQUEST_META_KEYS,
  MCP_PARITY_RESULT_FIELDS,
  MCP_PARITY_RESULT_META_KEYS,
  MCP_PROVIDER_PARITY_SCHEMA,
  mcpOutputSchemaOpaquePaths,
  renderMcpParityJson,
  renderMcpParityMarkdown,
  renderMcpProviderParity,
} from "../tool-parity";
import { mcpOutputSchemaDecision, renderMcpToolListing } from "../tool-definitions";

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const ROOT = process.cwd();
const registry = sirkitToolRegistry();
const read = (path: string): string => readFileSync(resolve(ROOT, path), "utf8").replaceAll(CARRIAGE_RETURN + NEWLINE, NEWLINE);
const descriptor = (toolId: string): ToolDescriptor => {
  const found = registry.get(toolId);
  if (!found) throw new Error(`fixture: ${toolId} is not registered`);
  return found;
};
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
type ParityReport = Extract<ReturnType<typeof renderMcpProviderParity>, { ok: true }>["report"];
const okReport = (): ParityReport => {
  const result = renderMcpProviderParity(registry);
  if (!result.ok) throw new Error(`fixture: the production report refused ${result.code}`);
  return result.report;
};
/** A registry double over a descriptor list: only `list`, `digest` and `get` are read by the renderer and B1's listing. */
const doubleOf = (options: { list?: () => ToolDescriptor[]; digest?: () => string } = {}): ToolRegistry => {
  const source = registry;
  return {
    list: options.list ?? (() => source.list()),
    digest: options.digest ?? (() => source.digest()),
    get: (toolId: string, version?: string) => source.get(toolId, version),
  } as unknown as ToolRegistry;
};

describe("[B20 C1] P — registry, providers and MCP render one tool three ways", () => {
  it("P1. the report is ok, carries its schema and both digests, and covers exactly the MCP subset in listing order", () => {
    const report = okReport();
    expect(report.schema).toBe(MCP_PROVIDER_PARITY_SCHEMA);
    expect(MCP_PROVIDER_PARITY_SCHEMA).toBe("sirkit.mcp-provider-parity.v1");
    expect(report.registryDigest).toBe(registry.digest());
    expect(report.listingDigest).toBe(renderMcpToolListing(registry).listingDigest);
    const names = report.tools.map((tool) => tool.toolId);
    expect(names).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS].sort(byCodePoint));
    expect(names).toEqual(renderMcpToolListing(registry).tools.map((tool) => tool.name));
    // mutation: a report built over the agent set (32) instead of the MCP subset fails here
    expect(names).not.toEqual([...INTENTIONAL_AGENT_EXPOSED_TOOL_IDS].sort(byCodePoint));
    expect(names.length).toBeLessThan(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
  });

  it("P2. the name maps reversibly: MCP lists the raw id, the providers agentProviderName(id), and the declarations resolve that name back to one {toolId, version}", () => {
    const report = okReport();
    const built = buildAgentToolDeclarations(registry.list().filter((item) => item.agentExposed));
    for (const tool of report.tools) {
      expect(tool.mcpName, tool.toolId).toBe(tool.toolId);
      expect(tool.providerName, tool.toolId).toBe(agentProviderName(tool.toolId));
      expect(tool.providerName, tool.toolId).toBe(tool.toolId.replaceAll(".", "_"));
      expect(built.resolve(tool.providerName), tool.toolId).toEqual({ toolId: tool.toolId, version: tool.version });
      expect(tool.legs.nameReversible, tool.toolId).toBe(true);
      expect(tool.providerName.length, tool.toolId).toBeLessThanOrEqual(64);
    }
    // subset-derived literals (B4 withheld the five proposals: 9 exposed ids, the longest 41 characters)
    expect(report.tools).toHaveLength(9);
    expect(Math.max(...report.tools.map((tool) => tool.mcpName.length))).toBe(41);
  });

  it("P3. the description is byte-equal across the descriptor, the OpenAI rendering, the Anthropic rendering and MCP", () => {
    const report = okReport();
    const listing = renderMcpToolListing(registry);
    const declarations = buildAgentToolDeclarations(registry.list().filter((item) => item.agentExposed)).declarations;
    for (const tool of report.tools) {
      const source = descriptor(tool.toolId);
      const declaration = declarations.find((item) => item.toolId === tool.toolId)!;
      const listed = listing.tools.find((item) => item.name === tool.toolId)!;
      const texts = [source.description, listed.description, renderOpenAiResponsesTool(declaration).description, renderAnthropicAgentTool(declaration).description];
      expect(new Set(texts).size, tool.toolId).toBe(1);
      // mutation: a description taken from the title fails here
      expect(source.description, tool.toolId).not.toBe(source.title);
      expect(tool.legs.descriptionEqual, tool.toolId).toBe(true);
    }
  });

  it("P4. OpenAI parameters, Anthropic input_schema and MCP inputSchema are canonical-equal, and the recorded digest is independently recomputed", () => {
    const report = okReport();
    const listing = renderMcpToolListing(registry);
    const declarations = buildAgentToolDeclarations(registry.list().filter((item) => item.agentExposed)).declarations;
    for (const tool of report.tools) {
      const declaration = declarations.find((item) => item.toolId === tool.toolId)!;
      const listed = listing.tools.find((item) => item.name === tool.toolId)!;
      const canonical = canonicalJson(listed.inputSchema);
      expect(canonicalJson(renderOpenAiResponsesTool(declaration).parameters), tool.toolId).toBe(canonical);
      expect(canonicalJson(renderAnthropicAgentTool(declaration).input_schema), tool.toolId).toBe(canonical);
      expect(tool.inputSchemaDigest, tool.toolId).toBe(engineeringDigest(listed.inputSchema));
      expect(tool.legs.inputSchemaEqual, tool.toolId).toBe(true);
    }
  });

  it("P5. the exact key set of each rendering, and the MCP-only fields, are what the report records", () => {
    const listing = renderMcpToolListing(registry);
    const declarations = buildAgentToolDeclarations(registry.list().filter((item) => item.agentExposed)).declarations;
    // hard-coded per exposed id, never re-derived with the renderer's own formula (the B1 precedent)
    const ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
    const EXPECTED_ANNOTATIONS: Record<string, typeof ANNOTATIONS> = Object.fromEntries(INTENTIONAL_MCP_EXPOSED_TOOL_IDS.map((id) => [id, ANNOTATIONS]));
    expect(Object.keys(EXPECTED_ANNOTATIONS)).toHaveLength(9);
    for (const listed of listing.tools) {
      const declaration = declarations.find((item) => item.toolId === listed.name)!;
      const source = descriptor(listed.name);
      expect(Object.keys(renderOpenAiResponsesTool(declaration)).sort(), listed.name).toEqual(["description", "name", "parameters", "strict", "type"]);
      expect(Object.keys(renderAnthropicAgentTool(declaration)).sort(), listed.name).toEqual(["description", "input_schema", "name", "strict"]);
      const mcpKeys = ["_meta", "annotations", "description", "inputSchema", "name", "title"];
      expect(Object.keys(listed).sort(), listed.name).toEqual(mcpOutputSchemaDecision(source).declared ? [...mcpKeys, "outputSchema"].sort() : mcpKeys);
      expect(listed.title, listed.name).toBe(source.title);
      if (mcpOutputSchemaDecision(source).declared) expect(canonicalJson(listed.outputSchema), listed.name).toBe(canonicalJson(source.outputSchema));
      expect(listed.annotations, listed.name).toEqual(EXPECTED_ANNOTATIONS[listed.name]);
    }
  });

  it("P6. every exposed output schema passes the structure check, the wire subset and the output validator's evaluability, is declared, and its opaque members are the recorded ones", () => {
    const report = okReport();
    // CONFIRMED from app/lib/engineering/tool-catalog.ts: the object nodes of each declared output schema with no own
    // `properties` (an array's items node is listed at its `…items` path, not the array's)
    const OPAQUE: Record<string, readonly string[]> = {
      "sirkit.component-authority.inspect": ["$.properties.components.items", "$.properties.pinned"],
      "sirkit.manufacturing.readiness-inspect": ["$.properties.pinned", "$.properties.report"],
      "sirkit.pcb.board-inspect": ["$.properties.snapshot"],
      "sirkit.pcb.mechanical-inspect": ["$.properties.mechanical"],
      "sirkit.pcb.revision-inspect": [],
      "sirkit.pcb.via-inspect": ["$.properties.vias"],
      "sirkit.project.canonical-revision-inspect": ["$.properties.revision"],
      "sirkit.validation.connectivity-verify": ["$.properties.report"],
      "sirkit.validation.drc-run": ["$.properties.pinned", "$.properties.report"],
    };
    expect(Object.keys(OPAQUE).sort(byCodePoint)).toEqual([...INTENTIONAL_MCP_EXPOSED_TOOL_IDS].sort(byCodePoint));
    /** An independent walker: the paths of object nodes with no own `properties` key. */
    const opaqueOf = (node: unknown, path: string): string[] => {
      if (typeof node !== "object" || node === null || Array.isArray(node)) return [];
      const record = node as Record<string, unknown>;
      const here = record.type === "object" && !Object.hasOwn(record, "properties") ? [path] : [];
      const properties = record.properties;
      const nested = typeof properties === "object" && properties !== null
        ? Object.keys(properties).flatMap((name) => opaqueOf((properties as Record<string, unknown>)[name], `${path}.properties.${name}`))
        : [];
      const items = record.items === undefined ? [] : opaqueOf(record.items, `${path}.items`);
      return [...here, ...nested, ...items];
    };
    for (const tool of report.tools) {
      const schema = descriptor(tool.toolId).outputSchema;
      expect(validateSchemaStructure(schema), tool.toolId).toEqual([]);
      expect(validateWireSubset(schema), tool.toolId).toEqual([]);
      expect(mcpOutputSchemaEvaluable(schema), tool.toolId).toBe(true);
      expect(tool.outputSchema, tool.toolId).toBe("declared");
      expect(tool.outputSchemaOpaquePaths, tool.toolId).toEqual(OPAQUE[tool.toolId]);
      expect([...mcpOutputSchemaOpaquePaths(schema)], tool.toolId).toEqual([...opaqueOf(schema, "$")].sort(byCodePoint));
    }
  });

  it("P6b. mcpOutputSchemaOpaquePaths is bounded, cycle-safe and never throws, over the shapes only a double can hand it", () => {
    // P6 walks the nine production schemas; every hostile double in P8 refuses before a tool entry is ever built, so
    // nothing there reaches this walker. These are the shapes its doc block promises to survive (depth 64, 4 096 nodes,
    // cycles by ancestor path, never throws) — and the renderer's contract accepts a registry double.
    const cyclic: Record<string, unknown> = { type: "object", properties: {} };
    (cyclic.properties as Record<string, unknown>).self = cyclic;
    (cyclic.properties as Record<string, unknown>).opaque = { type: "object" };
    // the cycle is cut at its ancestor, so the one opaque member below it is reported exactly once (without the ancestor
    // check the same member is reported again at every level down to the depth bound)
    expect([...mcpOutputSchemaOpaquePaths(cyclic)]).toEqual(["$.properties.opaque"]);
    // a SHARED acyclic subschema is not a cycle: both occurrences are reported
    const shared = { type: "object" };
    expect([...mcpOutputSchemaOpaquePaths({ type: "object", properties: { a: shared, b: shared } })]).toEqual(["$.properties.a", "$.properties.b"]);
    const deep = (levels: number): Record<string, unknown> => {
      let node: Record<string, unknown> = { type: "object" };
      for (let level = 0; level < levels; level += 1) node = { type: "object", properties: { a: node } };
      return node;
    };
    expect([...mcpOutputSchemaOpaquePaths(deep(60))]).toEqual([`$${".properties.a".repeat(60)}`]);
    expect([...mcpOutputSchemaOpaquePaths(deep(200))]).toEqual([]); // past the depth bound: nothing, never a stack overflow
    const wide = { type: "object", properties: Object.fromEntries(Array.from({ length: 5_000 }, (_, index) => [`p${index}`, { type: "object" }])) };
    const bounded = mcpOutputSchemaOpaquePaths(wide);
    expect(bounded.length).toBeGreaterThan(0);
    expect(bounded.length).toBeLessThan(5_000); // the node budget stops the walk before the last property
    const hostile: ReadonlyArray<readonly [string, unknown]> = [
      ["a throwing properties getter", Object.defineProperty({ type: "object" }, "properties", { get() { throw new Error("hostile getter"); }, enumerable: true })],
      ["a throwing items getter", Object.defineProperty({ type: "array" }, "items", { get() { throw new Error("hostile getter"); }, enumerable: true })],
      ["a hostile Proxy", new Proxy({}, { get() { throw new Error("hostile trap"); } })],
      ["null", null], ["a string", "object"], ["undefined", undefined],
    ];
    for (const [label, schema] of hostile) {
      expect(() => mcpOutputSchemaOpaquePaths(schema), label).not.toThrow();
      expect([...mcpOutputSchemaOpaquePaths(schema)], label).toEqual([]);
      expect(JSON.stringify(mcpOutputSchemaOpaquePaths(schema)), label).not.toContain("hostile");
    }
  });

  it("P7. the counts and the agent-only tools, each with its closed MCP exclusion reason", () => {
    const report = okReport();
    // subset-derived literals. Expected moves: A4 adds one agent-exposed descriptor (+1 registry, +1 agentExposed, +1
    // agentOnly with reason external_read); a B4 subset move would change mcpExposed and agentOnly together.
    // [B20 merge] pin move: the A track's A4 adds one agent-exposed descriptor (sirkit.mcp.observation-read), so the
    // registry is 42 and the agent set 33; the MCP subset is unchanged at 9 (B4 withheld every proposal)
    expect(report.counts).toEqual({ registry: 47, agentExposed: 36, mcpExposed: 9, agentOnly: 27 }); // [B22-B, 2026-10-01] pin move (OD-139): + the five named computations, three of them agent-exposed reads MCP withholds (`computation`)
    expect(report.counts.registry).toBe(registry.list().length);
    expect(report.counts.agentExposed).toBe(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    const expected = [...INTENTIONAL_AGENT_EXPOSED_TOOL_IDS].filter((id) => !INTENTIONAL_MCP_EXPOSED_TOOL_IDS.includes(id)).sort(byCodePoint);
    expect(report.agentOnly.map((entry) => entry.toolId)).toEqual(expected);
    for (const entry of report.agentOnly) {
      expect(entry.reason, entry.toolId).toBe(mcpExclusionReason(descriptor(entry.toolId)));
      expect(entry.reason, entry.toolId).not.toBeNull();
      expect(entry.providerName, entry.toolId).toBe(agentProviderName(entry.toolId));
      expect(entry.version, entry.toolId).toBe(descriptor(entry.toolId).version);
    }
  });

  it("P8. negative controls: a broken leg is recorded per tool, an unreadable registry or listing is a closed code, and no refusal carries descriptor text", () => {
    const listing = renderMcpToolListing(registry);
    const first = listing.tools[0]!.name;
    const legCase = (label: string, seams: Parameters<typeof renderMcpProviderParity>[1], differences: string[]): void => {
      const result = renderMcpProviderParity(registry, seams);
      expect(result.ok, label).toBe(true);
      const entry = result.ok ? result.report.tools.find((tool) => tool.toolId === first)! : null;
      expect(entry!.differences, label).toEqual(differences);
      expect(entry!.threeWayEquivalent, label).toBe(false);
    };
    legCase("one OpenAI description character", {
      openAi: (declaration) => ({ ...renderOpenAiResponsesTool(declaration), description: `${declaration.description}.` }),
    }, ["description"]);
    legCase("an Anthropic schema without required", {
      anthropic: (declaration) => {
        const schema = { ...(renderAnthropicAgentTool(declaration).input_schema as Record<string, unknown>) };
        delete schema.required;
        return { ...renderAnthropicAgentTool(declaration), input_schema: schema as never };
      },
    }, ["inputSchema"]);
    legCase("a listing whose title differs", {
      listing: (target) => {
        const rendered = renderMcpToolListing(target);
        return { ...rendered, tools: rendered.tools.map((tool) => (tool.name === first ? { ...tool, title: `${tool.title} (drifted)` } : tool)) };
      },
    }, ["title"]);

    const boardRead = descriptor("sirkit.pcb.board-inspect");
    const collide = [
      { ...boardRead, toolId: "sirkit.a.b", title: "Inspect a" } as ToolDescriptor,
      { ...boardRead, toolId: "sirkit.a_b", title: "Inspect b" } as ToolDescriptor,
    ];
    const refusals: ReadonlyArray<readonly [string, ToolRegistry, string]> = [
      // unreachable with a real ToolRegistry (TOOL_ID_PATTERN admits no `_`): only a double can collide
      ["two ids mapping to one provider name", doubleOf({ list: () => [...registry.list(), ...collide] }), "name_collision"],
      ["a listing that drifts", doubleOf({ list: () => [...registry.list(), { ...boardRead, toolId: "sirkit.pcb.extra-inspect" } as ToolDescriptor] }), "listing_refused"],
      ["a registry whose list() throws", doubleOf({ list: () => { throw new Error("hostile list"); } }), "registry_unreadable"],
      ["a registry whose digest() throws", doubleOf({ digest: () => { throw new Error("hostile digest"); } }), "registry_unreadable"],
      ["a registry digest of another shape", doubleOf({ digest: () => "sha256-abc" }), "registry_unreadable"],
      ["a Proxy descriptor", doubleOf({ list: () => [new Proxy({}, { get() { throw new Error("hostile getter"); } }) as ToolDescriptor] }), "registry_unreadable"],
    ];
    for (const [label, double, code] of refusals) {
      const result = renderMcpProviderParity(double);
      expect(result.ok, label).toBe(false);
      expect(result, label).toEqual({ ok: false, code });
      expect(MCP_PARITY_REFUSALS, label).toContain(code);
      expect(JSON.stringify(result), label).not.toContain(boardRead.description.slice(0, 24));
      expect(JSON.stringify(result), label).not.toContain("hostile");
      expect(() => renderMcpProviderParity(double), label).not.toThrow();
    }
    expect(renderMcpParityJson(doubleOf({ list: () => { throw new Error("hostile list"); } }))).toEqual({ ok: false, code: "registry_unreadable" });
    expect(renderMcpParityMarkdown(doubleOf({ list: () => { throw new Error("hostile list"); } }))).toEqual({ ok: false, code: "registry_unreadable" });
  });

  it("P9. mcp-parity.json and mcp-parity.md byte-equal their renderers", () => {
    const GENERATOR = "scripts/generate-b20-mcp-parity.ts";
    for (const [path, render] of [
      ["artifacts/ai-control-plane-b20/mcp-parity.json", renderMcpParityJson],
      ["artifacts/ai-control-plane-b20/mcp-parity.md", renderMcpParityMarkdown],
    ] as const) {
      expect(existsSync(resolve(ROOT, path)), `${path} is missing: run ${GENERATOR}`).toBe(true);
      const rendered = render(registry);
      expect(rendered.ok, path).toBe(true);
      const text = rendered.ok ? rendered.text : "";
      expect(read(path), `${path} is stale: run ${GENERATOR}`).toBe(text);
      expect(text.endsWith(NEWLINE), path).toBe(true); // mutation: a renderer without the trailing newline fails here
    }
  });

  it("P10. the B09 provider-parity artifact byte-equals its renderer (its first byte pin)", () => {
    // the expression of scripts/generate-agent-artifacts.ts (the exposed filter, then canonicalJson + newline)
    const declarations = buildAgentToolDeclarations(registry.list().filter((item) => item.agentExposed)).declarations;
    expect(read("artifacts/ai-control-plane-b09/provider-schema-parity.json")).toBe(canonicalJson(renderAgentProviderParity(declarations)) + NEWLINE);
    expect(renderAgentProviderParity(declarations).schema).toBe("sirkit.agent-provider-parity.v2");
    expect(renderAgentProviderParity(declarations).tools.every((tool) => tool.semanticallyEquivalent)).toBe(true);
  });

  it("P10b. the B04 wrapper renders the same strict parameters as MCP, and its v2 entry is semanticallyEquivalent", () => {
    const listing = renderMcpToolListing(registry);
    const exposed = INTENTIONAL_MCP_EXPOSED_TOOL_IDS.map(descriptor);
    const b04 = renderProviderParityReport(exposed);
    expect(b04.schema).toBe("sirkit.provider-schema-parity.v2");
    for (const listed of listing.tools) {
      expect(canonicalJson(renderOpenAiTool(descriptor(listed.name)).parameters), listed.name).toBe(canonicalJson(listed.inputSchema));
      const entry = b04.tools.find((tool) => tool.toolId === listed.name)!;
      expect(entry.semanticallyEquivalent, listed.name).toBe(true);
      expect(entry.wireCompatible, listed.name).toBe(true);
      expect(entry.differences, listed.name).toContain("output schema is registry-only metadata (neither provider declares it)");
    }
  });

  it("P11. tool-parity.ts and structured-content.ts are pure: no read pipeline, no node builtin, no fetch, clock, randomness or environment", () => {
    const IMPORT_FORMS = [
      /^\s*(?:import|export)\s+(?:type\s+)?(?:[^;]*?\s+from\s+)?["']([^"']+)["']/gm,
      /\bimport\(\s*["']([^"']+)["']\s*\)/g,
      /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    ];
    const specifiersOf = (source: string): string[] => IMPORT_FORMS.flatMap((pattern) => [...source.matchAll(pattern)].map((match) => match[1]!));
    const parity = read("app/lib/mcp/server/tool-parity.ts");
    const gate = read("app/lib/mcp/server/structured-content.ts");
    const FORBIDDEN_SPECIFIER = /^node:|^(fs|net|http|https|child_process|os|path|crypto|worker_threads|dns|tls)$|http-transport|server-registry|rollout|outbound-fetch|openai|anthropic|@modelcontextprotocol/;
    for (const [label, source] of [["tool-parity.ts", parity], ["structured-content.ts", gate]] as const) {
      const specifiers = specifiersOf(source);
      expect(specifiers.length, label).toBeGreaterThan(0);
      expect(specifiers.filter((specifier) => FORBIDDEN_SPECIFIER.test(specifier)), label).toEqual([]);
      // ./read-call would pull node:crypto, the durable modules and the whole read pipeline into the renderer's closure
      expect(specifiers.filter((specifier) => specifier.includes("read-call")), label).toEqual([]);
      // and app/lib/agent/contracts is forbidden to every app/lib/mcp/server module (b20-b3-import-gates G4)
      expect(specifiers.filter((specifier) => /agent\/(contracts|context|gateway|loop)$/.test(specifier)), label).toEqual([]);
      expect(source, label).not.toMatch(/\bfetch\(|Date\.now\(|Math\.random\(|process\.env|new Date\(/);
    }
    expect(specifiersOf(gate).sort()).toEqual(["../../engineering/tool-io-validation", "../../engineering/tool-registry"]);
  });

  it("P12. the pages state C1's rules where they used to promise them", () => {
    const exposure = read("artifacts/ai-control-plane-b20/mcp-exposure.md");
    expect(exposure).not.toContain("Tightening them is C1's");
    expect(exposure).toMatch(/OD-96/);
    expect(exposure).not.toContain("no three-way parity report");
    expect(exposure).toMatch(/At B1 all 9 exposed tools declare it/); // the B1 pin stays true
    expect(exposure).toMatch(/evaluable/);
    expect(exposure).toMatch(/structuredContent/);
    const reads = read("artifacts/ai-control-plane-b20/mcp-server-reads.md");
    expect(reads).toMatch(/invalid_output/);
    expect(reads).toMatch(/gateStructuredContent|structured-content\.ts/);
  });

  it("P12b. every file:line reference on the three B20 server pages, wrapped or not, points at the line it quotes", () => {
    const PAGES = [
      "artifacts/ai-control-plane-b20/mcp-exposure.md",
      "artifacts/ai-control-plane-b20/mcp-server-reads.md",
      "artifacts/ai-control-plane-b20/mcp-server-endpoint.md",
    ];
    let wrapped = 0;
    const wrong: string[] = [];
    for (const page of PAGES) {
      const text = read(page);
      // the reference and its quote may be separated by a line break: the B1 and B3 page tests match only one line
      const references = [...text.matchAll(/`((?:app|scripts)\/[A-Za-z0-9_./-]+\.ts):(\d+)`\s+\(`([^`]+)`\)/g)];
      for (const [reference, file, line, quoted] of references) {
        if (!reference.includes("` (`")) wrapped += 1;
        if (!(read(file!).split(NEWLINE)[Number(line) - 1] ?? "").includes(quoted!)) wrong.push(`${page}: ${file}:${line}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(wrapped).toBeGreaterThanOrEqual(9); // non-vacuity: mcp-server-reads.md wraps at least nine of them
  });

  it("P12c. no file:line reference on the four B20 server pages is BARE: every one carries the quote P12b checks it against", () => {
    // [B20 C review] P12b can only check a reference that carries its quote — a bare `path:N` is invisible to it and goes
    // stale the next time anyone inserts a line in that file. These pages carry none, and this case keeps it that way.
    const PAGES = [
      "artifacts/ai-control-plane-b20/mcp-exposure.md",
      "artifacts/ai-control-plane-b20/mcp-server-reads.md",
      "artifacts/ai-control-plane-b20/mcp-server-endpoint.md",
      "artifacts/ai-control-plane-b20/mcp-parity.md",
    ];
    const ANY = /`((?:app|scripts)\/[A-Za-z0-9_./-]+\.ts):(\d+)`/g;
    /** Every reference on a page that is not followed — on its own line or the next one — by its quote. */
    const bareIn = (text: string): string[] => {
      const lines = text.split(NEWLINE);
      const bare: string[] = [];
      lines.forEach((line, index) => {
        for (const match of line.matchAll(ANY)) {
          const rest = line.slice(match.index + match[0].length);
          const next = lines[index + 1] ?? "";
          if (!(rest.trimStart().startsWith("(`") || (rest.trim().length === 0 && next.trimStart().startsWith("(`")))) bare.push(`${match[1]}:${match[2]}`);
        }
      });
      return bare;
    };
    let total = 0;
    for (const page of PAGES) {
      const text = read(page);
      total += [...text.matchAll(ANY)].length;
      expect(bareIn(text), page).toEqual([]);
    }
    expect(total).toBeGreaterThanOrEqual(30); // non-vacuity: the pages really do carry references
    // and the detector itself is not vacuous
    expect(bareIn("see `app/lib/mcp/server/tool-pages.ts:21` for the page size")).toEqual(["app/lib/mcp/server/tool-pages.ts:21"]);
    expect(bareIn("see `app/lib/mcp/server/tool-pages.ts:21` (`export const MCP_TOOLS_LIST_PAGE_SIZE = 32;`)")).toEqual([]);
  });

  it("P13. the parity report's copy of B3's result _meta key sets deep-equals the pipeline's own, and both equal the recorded table", () => {
    const TABLE = {
      always: ["io.modelcontextprotocol/serverInfo", "dev.sirkit/toolId", "dev.sirkit/toolVersion", "dev.sirkit/registryDigest", "dev.sirkit/listingDigest"],
      success: ["dev.sirkit/invocationId", "dev.sirkit/revision", "dev.sirkit/revisionBinding", "dev.sirkit/boardId", "dev.sirkit/boardRevision", "dev.sirkit/boardDigest", "dev.sirkit/verification", "dev.sirkit/idempotency"],
      refusal: ["dev.sirkit/refusal"],
      optionalRefusal: ["dev.sirkit/currentRevision"],
    };
    const plain = (value: typeof MCP_PARITY_RESULT_META_KEYS): Record<string, string[]> => Object.fromEntries(Object.entries(value).map(([key, list]) => [key, [...list]]));
    expect(plain(MCP_PARITY_RESULT_META_KEYS)).toEqual(TABLE);
    expect(plain(MCP_READ_RESULT_META_KEYS)).toEqual(TABLE);
    expect(plain(MCP_PARITY_RESULT_META_KEYS)).toEqual(plain(MCP_READ_RESULT_META_KEYS));
    expect(TABLE.always).toHaveLength(5);
    expect(TABLE.success).toHaveLength(8);
    const report = okReport();
    expect(report.resultMetaKeys).toEqual(MCP_PARITY_RESULT_META_KEYS);
    // the REQUEST bindings are a frozen copy too, and the comment beside them claims this pin: OD-70's own key list
    expect([...MCP_PARITY_REQUEST_META_KEYS]).toEqual(Object.values(MCP_READ_META_KEYS));
    expect([...MCP_PARITY_REQUEST_META_KEYS]).toEqual(["dev.sirkit/expectedRevision", "dev.sirkit/expectedRegistryDigest", "dev.sirkit/idempotencyKey"]);
    expect(report.requestMetaKeys).toEqual([...MCP_PARITY_REQUEST_META_KEYS]);
    // and the result's own fields are the shape read-call.ts renders (a lexical pin: this renderer may not import it)
    const SUCCESS = `const rendered = { resultType: "complete", content: [{ type: "text", text }], ...(structured.kind === "include" ? { structuredContent: structured.value } : {}), isError: false, _meta: meta };`;
    const REFUSAL = `const result = { resultType: "complete", content: [{ type: "text", text: JSON.stringify({ ok: false, status, note: MCP_READ_REFUSAL_NOTES[status] }) }], isError: true, _meta: meta };`;
    const readCall = read("app/lib/mcp/server/read-call.ts");
    expect(readCall).toContain(SUCCESS);
    expect(readCall).toContain(REFUSAL);
    expect([...MCP_PARITY_RESULT_FIELDS].sort()).toEqual(["content", "isError", "resultType", "structuredContent"]);
    for (const field of MCP_PARITY_RESULT_FIELDS) expect(SUCCESS + REFUSAL, field).toContain(`${field}:`);
    expect([...MCP_PARITY_RESULT_FIELDS]).not.toContain("_meta"); // `_meta` is recorded as its four key sets, not as a field
    expect(report.resultFields).toEqual([...MCP_PARITY_RESULT_FIELDS]);
  });

  it("P14. the report's descriptorText block is the GATE's own constants and the gate's own measurement, never a second copy", () => {
    const report = okReport();
    expect(report.descriptorText.bounds).toEqual(DESCRIPTOR_TEXT_BOUNDS);
    expect(report.descriptorText.rules).toEqual([...DESCRIPTOR_TEXT_RULES]);
    expect(report.descriptorText.allowedExtra).toEqual(DESCRIPTOR_TEXT_ALLOWED_EXTRA.map((code) => `U+${code.toString(16).toUpperCase().padStart(4, "0")}`));
    expect(report.descriptorText.allowedExtra).toContain("U+2013");
    // the MEASURED maxima the byte-gated page publishes as CONFIRMED, recomputed here from the gate's own collector — the
    // same four numbers b20-c3-descriptor-text-gate T1 measures with an independent walker
    // [B20 merge] pin move: A4's descriptor joined the registry (its description is the longest), so the measured maxima and
    // the registry digest move; the gate, its bounds and the MCP subset are unchanged
    expect(report.descriptorText.maxima).toEqual({ title: 56, description: 844, schemaText: 264, schemaStrings: 100 });
    const worst = { title: 0, description: 0, schemaText: 0, schemaStrings: 0 };
    for (const item of registry.list()) {
      const texts = [...judgedSchemaStrings(item.inputSchema), ...judgedSchemaStrings(item.outputSchema)];
      worst.title = Math.max(worst.title, item.title.length);
      worst.description = Math.max(worst.description, item.description.length);
      worst.schemaStrings = Math.max(worst.schemaStrings, texts.length);
      for (const text of texts) worst.schemaText = Math.max(worst.schemaText, text.length);
    }
    expect(report.descriptorText.maxima).toEqual(worst);
    expect(worst.title).toBeLessThanOrEqual(DESCRIPTOR_TEXT_BOUNDS.titleMaxChars);
    expect(worst.description).toBeLessThanOrEqual(DESCRIPTOR_TEXT_BOUNDS.descriptionMaxChars);
    expect(worst.schemaText).toBeLessThanOrEqual(DESCRIPTOR_TEXT_BOUNDS.schemaTextMaxChars);
    expect(worst.schemaStrings).toBeLessThanOrEqual(DESCRIPTOR_TEXT_BOUNDS.schemaMaxStrings);
    // the collector that MEASURES reaches exactly as deep as the bound that JUDGES: a schema 20 levels down (40 levels of
    // the walk's own counting) is still measured, and one past the bound is reported as nothing rather than as less
    const deepText = (levels: number): unknown => {
      let node: Record<string, unknown> = { type: "string", description: "the leaf" };
      for (let level = 0; level < levels; level += 1) node = { type: "object", additionalProperties: false, properties: { a: node }, required: ["a"] };
      return node;
    };
    expect(judgedSchemaStrings(deepText(20))).toContain("the leaf");
    expect(judgedSchemaStrings(deepText(20)).filter((text) => text === "the leaf")).toHaveLength(1);
    expect(judgedSchemaStrings(deepText(40))).toEqual([]); // past DESCRIPTOR_TEXT_BOUNDS.schemaMaxDepth: bounded, never partial
  });
});
