/**
 * [B20 C1] SC — the output-schema conformance of Sirkit's MCP server (OD-96, amending OD-56): MCP 2026-07-28 server/tools,
 * "Output Schema" — "Servers MUST provide structured results that conform to this schema" (re-read 2026-09-22).
 *
 *  - a tool declares `outputSchema` only when B1's checks pass AND Sirkit's deterministic output validator can EVALUATE it;
 *  - a success of a tool that declares one ALWAYS carries a conforming `structuredContent`, judged after the model-safe walk
 *    and before the replay store and the trace; a value that does not conform is the closed `invalid_output`;
 *  - a tool that declares none never carries `structuredContent`.
 *
 * Every dispatch-level assertion goes through `handleMcpRequest`; the pipeline-level ones through the B3 read harness.
 * Nothing here reaches a network, a database or a real clock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpBearerJsonInput } from "@/app/lib/auth/route-handlers";
import type { McpRequestHeaders } from "@/app/lib/auth/mcp-bearer";
import { computeProjectRevision } from "@/app/lib/engineering/revision";
import { durableCanonicalState } from "@/app/lib/engineering/durable-read-bundle";
import { canonicalJson } from "@/app/lib/engineering/stable";
import { SIRKIT_TOOL_CATALOG, sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { ReadToolInvocationService, type ReadInvocationResult } from "@/app/lib/engineering/tool-invocation";
import { DEFAULT_OUTPUT_LIMITS, validateAgainstSchema } from "@/app/lib/engineering/tool-io-validation";
import { ToolRegistry, type JsonSchema, type ToolDescriptor, type ToolRegistry as Registry } from "@/app/lib/engineering/tool-registry";
import { durableAuthoritySource, durableBoardFixture, FIXTURE_SCOPE } from "@/app/lib/engineering/__tests__/_durable-board-fixture";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { handleMcpRequest } from "../dispatch";
import {
  MCP_READ_REFUSAL_NOTES,
  MCP_READ_RESULT_META_KEYS,
  mcpReadAdmissionState,
  resetMcpReadInvokerFactory,
  resetMcpReadStateForTests,
  setMcpReadInvokerFactory,
} from "../read-call";
import { mcpReadTraceRing, resetMcpReadTraceSinkFactory } from "../read-trace";
import { mcpServerTraceRing, resetMcpServerTraceSinkFactory } from "../request-trace";
import { MCP_STRUCTURED_CONTENT_VERDICTS, gateStructuredContent, mcpOutputSchemaEvaluable } from "../structured-content";
import { MCP_OUTPUT_SCHEMA_OMISSIONS, mcpOutputSchemaDecision } from "../tool-definitions";
import { EXEMPT_READS, SERVED_READS, pinOf, readHarness, refusalOf, resultOf, type Harness } from "./_read-harness";

vi.mock("@/app/lib/engineering/tool-io-validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/engineering/tool-io-validation")>();
  return { ...actual, assertSafeJsonValue: vi.fn(actual.assertSafeJsonValue), validateAgainstSchema: vi.fn(actual.validateAgainstSchema) };
});
const spied = await import("@/app/lib/engineering/tool-io-validation");

const V = "2026-07-28";
const META = { "io.modelcontextprotocol/protocolVersion": V, "io.modelcontextprotocol/clientCapabilities": {} };
const ARGS: Record<string, Record<string, unknown>> = {
  "sirkit.pcb.via-inspect": { netName: "/root/VCC" },
  "sirkit.pcb.board-inspect": { projectId: "proj-mcp" },
  "sirkit.component-authority.inspect": { componentIds: ["sync-u1"] },
};
const NOT_EVALUABLE = "not evaluable by the output validator";
const revisionOf = (board: PcbBoard): string => computeProjectRevision(durableCanonicalState(FIXTURE_SCOPE, board)).canonicalStateDigest;

const headersFor = (method: string, name?: string): McpRequestHeaders => ({
  protocolVersion: { state: "present", value: V },
  method: { state: "present", value: method },
  name: name === undefined ? { state: "absent" } : { state: "present", value: name },
  paramHeaderCount: 0,
});
/** One authenticated JSON-RPC message through the real dispatch (never the route: B2 owns the wrapper). */
async function dispatch(h: Harness, message: { method: string; params: Record<string, unknown>; id?: unknown }): Promise<Record<string, unknown>> {
  const name = message.method === "tools/call" ? String(message.params.name) : undefined;
  const input = {
    principal: h.principal,
    message: { jsonrpc: "2.0", id: message.id ?? 1, method: message.method, params: { ...message.params, _meta: { ...META, ...((message.params._meta as Record<string, unknown>) ?? {}) } } },
    bytes: 0,
    mcp: headersFor(message.method, name),
    meta: {},
    signal: new AbortController().signal,
  } as unknown as McpBearerJsonInput;
  const response = await handleMcpRequest(input, { registry: h.registry, reads: h.deps });
  return (await response.json()) as Record<string, unknown>;
}
const listOf = async (h: Harness): Promise<Array<Record<string, unknown>>> => {
  const body = await dispatch(h, { method: "tools/list", params: {} });
  return ((body.result as Record<string, unknown>).tools as Array<Record<string, unknown>>);
};
const callOf = async (h: Harness, toolId: string, meta: Record<string, unknown> = {}): Promise<Record<string, unknown>> => {
  const body = await dispatch(h, { method: "tools/call", params: { name: toolId, arguments: ARGS[toolId] ?? {}, _meta: meta } });
  return (body.result as Record<string, unknown>);
};
/** The production catalog with one descriptor's output schema replaced (the registry digest moves with it, by design). */
const withOutputSchema = (toolId: string, outputSchema: unknown): Registry =>
  new ToolRegistry(SIRKIT_TOOL_CATALOG.map((item) => (item.toolId === toolId ? ({ ...item, outputSchema } as ToolDescriptor) : item)));
/**
 * The same, as a registry DOUBLE that skips `validateToolDescriptor`. [B20 C3] The first-party text gate refuses a schema
 * whose property or `required` name is an `Object.prototype` member, so a real `ToolRegistry` can no longer hold one: the
 * double is the only way left to ask what the listing and the read pipeline would do with such a schema.
 */
const withOutputSchemaUnchecked = (toolId: string, outputSchema: unknown): Registry => {
  const list = SIRKIT_TOOL_CATALOG.map((item) => (item.toolId === toolId ? ({ ...item, outputSchema } as ToolDescriptor) : item));
  const byId = new Map(list.map((item) => [item.toolId, item]));
  const base = sirkitToolRegistry();
  return {
    list: () => list,
    digest: () => base.digest(),
    get: (id: string, version?: string) => { const found = byId.get(id); return found && (version === undefined || found.version === version) ? found : undefined; },
  } as unknown as Registry;
};

const FORGE_TARGET = "sirkit.pcb.revision-inspect"; // exempt from the revision pin, and its output is one short string
const forgedSchema = (extra: Record<string, unknown>, required: string[] = ["revision"]): JsonSchema => ({
  type: "object",
  additionalProperties: false,
  properties: { revision: { type: "string" }, ...extra },
  required,
} as unknown as JsonSchema);

beforeEach(() => { resetMcpReadStateForTests(); resetMcpReadInvokerFactory(); resetMcpReadTraceSinkFactory(); resetMcpServerTraceSinkFactory(); vi.mocked(spied.validateAgainstSchema).mockClear(); vi.mocked(spied.assertSafeJsonValue).mockClear(); });
afterEach(() => { resetMcpReadStateForTests(); resetMcpReadInvokerFactory(); resetMcpReadTraceSinkFactory(); resetMcpServerTraceSinkFactory(); vi.restoreAllMocks(); });

describe("[B20 C1] SC — a declared output schema and the structuredContent that conforms to it", () => {
  it("SC0. tools/list declares outputSchema exactly where the decision says so, and it is the descriptor's own schema", async () => {
    const h = await readHarness({ board: durableBoardFixture() });
    const tools = await listOf(h);
    expect(tools.map((tool) => tool.name)).toEqual([...SERVED_READS]);
    for (const tool of tools) {
      const source = h.registry.get(String(tool.name))!;
      const decision = mcpOutputSchemaDecision(source);
      expect(Object.hasOwn(tool, "outputSchema"), String(tool.name)).toBe(decision.declared);
      if (decision.declared) expect(canonicalJson(tool.outputSchema), String(tool.name)).toBe(canonicalJson(source.outputSchema));
    }
  });

  it("SC1. every served read's success carries a structuredContent that validates against the schema its own listing declared, with B3's _meta key sets unchanged", async () => {
    const board = durableBoardFixture();
    const h = await readHarness({ board, authority: await durableAuthoritySource(["sync-u1", "sync-u2"]) });
    const tools = await listOf(h);
    const revision = revisionOf(board);
    for (const toolId of SERVED_READS) {
      const listed = tools.find((tool) => tool.name === toolId)!;
      const result = await callOf(h, toolId, pinOf(revision));
      expect(result.isError, toolId).toBe(false);
      expect(Object.hasOwn(result, "structuredContent"), toolId).toBe(true);
      expect(validateAgainstSchema(result.structuredContent, listed.outputSchema as Record<string, unknown>), toolId).toEqual([]);
      expect(Object.keys(result).sort(), toolId).toEqual(["_meta", "content", "isError", "resultType", "structuredContent"]);
      expect(Object.keys(result._meta as object).sort(), toolId).toEqual([...MCP_READ_RESULT_META_KEYS.always, ...MCP_READ_RESULT_META_KEYS.success].sort());
    }
  });

  it("SC2. a tool whose output schema leaves the wire subset is listed WITHOUT outputSchema, and its success carries no structuredContent; the text block and the _meta keys are unchanged", async () => {
    const board = durableBoardFixture();
    const forged = withOutputSchema(FORGE_TARGET, forgedSchema({ extras: { type: "array", items: { type: "object" }, maxItems: 5 } }));
    const h = await readHarness({ board, registry: forged });
    expect(mcpOutputSchemaDecision(forged.get(FORGE_TARGET)!)).toEqual({ declared: false, reason: "outside the proven wire subset" });
    const listed = (await listOf(h)).find((tool) => tool.name === FORGE_TARGET)!;
    expect(Object.hasOwn(listed, "outputSchema")).toBe(false);
    const result = await callOf(h, FORGE_TARGET);
    expect(result.isError).toBe(false);
    expect(Object.hasOwn(result, "structuredContent")).toBe(false);
    expect(Object.keys(result).sort()).toEqual(["_meta", "content", "isError", "resultType"]);
    expect(Object.keys(result._meta as object).sort()).toEqual([...MCP_READ_RESULT_META_KEYS.always, ...MCP_READ_RESULT_META_KEYS.success].sort());
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content).toHaveLength(1);
    const text = JSON.parse(content[0]!.text) as Record<string, unknown>;
    expect(Object.keys(text).sort()).toEqual(["note", "ok", "output", "revision", "tool", "verification"]);
    expect(text.tool).toBe(FORGE_TARGET);
  });

  it("SC3. a declared schema and an output that does not conform is the closed invalid_output, traced, with nothing stored", async () => {
    const board = durableBoardFixture();
    const h = await readHarness({ board });
    let poison = true;
    setMcpReadInvokerFactory((registry) => {
      const real = new ReadToolInvocationService(registry);
      return {
        invoke: async (request, context, bundle) => {
          const result = await real.invoke(request, context, bundle);
          if (!poison || result.status !== "succeeded") return result;
          return { ...result, output: { revision: 7 } } as ReadInvocationResult; // a number where the schema declares a string
        },
      };
    });
    const key = { "dev.sirkit/idempotencyKey": "c1-structured-content-0001" };
    const body = await dispatch(h, { method: "tools/call", params: { name: FORGE_TARGET, arguments: {}, _meta: key } });
    const result = body.result as Record<string, unknown>;
    expect(result.isError).toBe(true);
    expect((result._meta as Record<string, unknown>)["dev.sirkit/refusal"]).toBe("invalid_output");
    expect(Object.hasOwn(result, "structuredContent")).toBe(false);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0]!.text)).toEqual({ ok: false, status: "invalid_output", note: MCP_READ_REFUSAL_NOTES.invalid_output });
    expect(MCP_READ_REFUSAL_NOTES.invalid_output).toBe("The read produced an output outside its schema or bounds; nothing was returned.");
    expect(mcpReadTraceRing().at(-1)?.outcome).toBe("invalid_output");
    expect(mcpServerTraceRing().at(-1)?.outcome).toBe("read_refused");
    // nothing was stored: the same idempotency key runs again, and now succeeds
    poison = false;
    const retry = (await dispatch(h, { method: "tools/call", params: { name: FORGE_TARGET, arguments: {}, _meta: key } })).result as Record<string, unknown>;
    expect(retry.isError).toBe(false);
    expect((retry._meta as Record<string, unknown>)["dev.sirkit/idempotency"]).toBe("stored");
    expect(mcpReadTraceRing().at(-1)?.outcome).toBe("succeeded");
  });

  it("SC4. a replay under the same idempotency key returns the identical structuredContent", async () => {
    const h = await readHarness({ board: durableBoardFixture() });
    const key = { "dev.sirkit/idempotencyKey": "c1-replay-key-00000001" };
    const first = await callOf(h, FORGE_TARGET, key);
    const second = await callOf(h, FORGE_TARGET, key);
    expect((first._meta as Record<string, unknown>)["dev.sirkit/idempotency"]).toBe("stored");
    expect((second._meta as Record<string, unknown>)["dev.sirkit/idempotency"]).toBe("replayed");
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(canonicalJson(second.structuredContent)).toBe(canonicalJson(first.structuredContent));
  });

  it("SC5. no refusal ever carries structuredContent", async () => {
    const board = durableBoardFixture();
    const h = await readHarness({ board });
    const pinned = SERVED_READS.filter((id) => !EXEMPT_READS.includes(id as never));
    for (const toolId of pinned) {
      const answer = await h.call(toolId, { args: ARGS[toolId] ?? {} }); // no pin: revision_required
      expect(refusalOf(answer), toolId).toBe("revision_required");
      expect(Object.hasOwn(resultOf(answer), "structuredContent"), toolId).toBe(false);
      expect(Object.keys(resultOf(answer)).sort(), toolId).toEqual(["_meta", "content", "isError", "resultType"]);
    }
    const unknown = await dispatch(h, { method: "tools/call", params: { name: "sirkit.manufacturing.release", arguments: {} } });
    expect(unknown.error).toMatchObject({ code: -32602 });
    expect(JSON.stringify(unknown)).not.toContain("structuredContent");
  });

  it("SC6. the admission counters return to zero after an omitted-schema success and after an invalid_output refusal", async () => {
    const board = durableBoardFixture();
    const omitted = await readHarness({ board, registry: withOutputSchema(FORGE_TARGET, forgedSchema({ extras: { type: "array", items: { type: "object" }, maxItems: 5 } })) });
    await callOf(omitted, FORGE_TARGET);
    expect(mcpReadAdmissionState()).toEqual({ process: 0, principals: 0 });
    const refused = await readHarness({ board });
    setMcpReadInvokerFactory((registry) => {
      const real = new ReadToolInvocationService(registry);
      return { invoke: async (request, context, bundle) => { const result = await real.invoke(request, context, bundle); return result.status === "succeeded" ? ({ ...result, output: { revision: 7 } } as ReadInvocationResult) : result; } };
    });
    const result = await callOf(refused, FORGE_TARGET);
    expect((result._meta as Record<string, unknown>)["dev.sirkit/refusal"]).toBe("invalid_output");
    expect(mcpReadAdmissionState()).toEqual({ process: 0, principals: 0 });
  });

  it("SC7. gateStructuredContent: a hostile or oversized value refuses under a declared schema and is never read without one, and it never throws", () => {
    expect([...MCP_STRUCTURED_CONTENT_VERDICTS]).toEqual(["include", "omit", "refuse"]);
    const schema = { type: "object", additionalProperties: false, properties: { revision: { type: "string" } }, required: ["revision"] } as unknown as JsonSchema;
    const cyclic: Record<string, unknown> = { revision: "a" };
    cyclic.self = cyclic;
    let deep: Record<string, unknown> = { revision: "a" };
    for (let level = 0; level < 2_000; level += 1) deep = { nested: deep };
    const throwingGetter = Object.defineProperty({ revision: "a" }, "hostile", { get() { throw new Error("hostile getter"); }, enumerable: true });
    const hostileProxy = new Proxy({ revision: "a" }, { ownKeys() { throw new Error("hostile keys"); } });
    const oversized = { revision: "x".repeat(DEFAULT_OUTPUT_LIMITS.maxStringLength + 1) };
    const toStringSchema = { type: "object", additionalProperties: false, properties: { revision: { type: "string" }, toString: { type: "string" } }, required: ["revision"] } as unknown as JsonSchema;
    const cases: ReadonlyArray<readonly [string, unknown, JsonSchema]> = [
      ["a hostile Proxy", hostileProxy, schema],
      ["a cyclic value", cyclic, schema],
      ["a 2 000-level value", deep, schema],
      ["a throwing getter", throwingGetter, schema],
      ["a toString-keyed schema", { revision: "a", toString: "b" }, toStringSchema],
      ["a value past the output limits", oversized, schema],
    ];
    for (const [label, value, declared] of cases) {
      expect(() => gateStructuredContent(value, declared), label).not.toThrow();
      expect(gateStructuredContent(value, declared), label).toEqual({ kind: "refuse" });
      expect(gateStructuredContent(value, null), label).toEqual({ kind: "omit" });
    }
    expect(gateStructuredContent({ revision: "a" }, schema)).toEqual({ kind: "include", value: { revision: "a" } });
    // the bounded safety walk runs FIRST: the schema validator is never reached for a value it refuses
    vi.mocked(spied.validateAgainstSchema).mockClear();
    expect(gateStructuredContent(cyclic, schema)).toEqual({ kind: "refuse" });
    expect(vi.mocked(spied.validateAgainstSchema)).not.toHaveBeenCalled();
    vi.mocked(spied.validateAgainstSchema).mockClear();
    expect(gateStructuredContent({ revision: "a" }, schema)).toEqual({ kind: "include", value: { revision: "a" } });
    expect(vi.mocked(spied.validateAgainstSchema)).toHaveBeenCalled();
  });

  it("SC8. over every served read, a success carries structuredContent exactly when its listing declared an output schema", async () => {
    const board = durableBoardFixture();
    const h = await readHarness({ board, authority: await durableAuthoritySource(["sync-u1", "sync-u2"]) });
    const tools = await listOf(h);
    const revision = revisionOf(board);
    for (const toolId of SERVED_READS) {
      const listed = tools.find((tool) => tool.name === toolId)!;
      const result = await callOf(h, toolId, pinOf(revision));
      expect(result.isError, toolId).toBe(false);
      expect(Object.hasOwn(result, "structuredContent"), toolId).toBe(Object.hasOwn(listed, "outputSchema"));
    }
    // and the invariant holds the other way too: a value that does not conform is refused, never answered as a success
    // that quietly drops structuredContent (mutation: a gate that omits instead of refusing fails here)
    setMcpReadInvokerFactory((registry) => {
      const real = new ReadToolInvocationService(registry);
      return { invoke: async (request, context, bundle) => { const answer = await real.invoke(request, context, bundle); return answer.status === "succeeded" ? ({ ...answer, output: { revision: 7 } } as ReadInvocationResult) : answer; } };
    });
    const poisoned = await callOf(h, FORGE_TARGET);
    expect(Object.hasOwn((await listOf(h)).find((tool) => tool.name === FORGE_TARGET)!, "outputSchema")).toBe(true);
    expect(poisoned.isError).toBe(true);
    expect(Object.hasOwn(poisoned, "structuredContent")).toBe(false);
  });

  it("SC9. an output schema the deterministic validator cannot evaluate is omitted with its closed reason, and that tool's success carries no structuredContent", async () => {
    expect(MCP_OUTPUT_SCHEMA_OMISSIONS).toContain(NOT_EVALUABLE);
    const board = durableBoardFixture();
    // each forged schema still passes B1's reserved-key scan, the wire subset, the structure check and the object root, so
    // only evaluability omits it; the unevaluable member is never required, so B05's own output validation still succeeds
    const unevaluable: ReadonlyArray<readonly [string, JsonSchema, boolean]> = [
      ["an anyOf member", forgedSchema({ extras: { anyOf: [{ type: "string" }, { type: "null" }] } }), true],
      ["a typed const member", forgedSchema({ extras: { type: "string", const: "fixed" } }), true],
      ["a type array member", forgedSchema({ extras: { type: ["string", "null"] } }), true],
      // [B20 C3] these two no longer survive `new ToolRegistry`: the first-party gate refuses an Object.prototype name
      ["a property named toString", forgedSchema({ toString: { type: "string" } }), false],
      ["a required Object.prototype member", forgedSchema({ hasOwnProperty: { type: "string" } }, ["revision", "hasOwnProperty"]), false],
    ];
    for (const [label, outputSchema, registrable] of unevaluable) {
      expect(mcpOutputSchemaEvaluable(outputSchema), label).toBe(false);
      if (!registrable) expect(() => withOutputSchema(FORGE_TARGET, outputSchema), label).toThrow(/TOOL_REGISTRY_INVALID/);
      const forged = registrable ? withOutputSchema(FORGE_TARGET, outputSchema) : withOutputSchemaUnchecked(FORGE_TARGET, outputSchema);
      expect(mcpOutputSchemaDecision(forged.get(FORGE_TARGET)!), label).toEqual({ declared: false, reason: NOT_EVALUABLE });
      const h = await readHarness({ board, registry: forged });
      const listed = (await listOf(h)).find((tool) => tool.name === FORGE_TARGET)!;
      expect(Object.hasOwn(listed, "outputSchema"), label).toBe(false);
      const result = await callOf(h, FORGE_TARGET);
      expect(result.isError, label).toBe(false);
      expect(Object.hasOwn(result, "structuredContent"), label).toBe(false);
    }
    // an untyped, non-enum member is unevaluable too, but B1's structure check already refuses it: the closed reason is that
    // earlier one, and the outcome is the same (omitted, and no structuredContent)
    const untyped = withOutputSchema(FORGE_TARGET, forgedSchema({ extras: { description: "unconstrained" } }));
    expect(mcpOutputSchemaEvaluable(untyped.get(FORGE_TARGET)!.outputSchema)).toBe(false);
    expect(mcpOutputSchemaDecision(untyped.get(FORGE_TARGET)!)).toEqual({ declared: false, reason: "not a valid schema structure" });
    const listed = (await listOf(await readHarness({ board, registry: untyped }))).find((tool) => tool.name === FORGE_TARGET)!;
    expect(Object.hasOwn(listed, "outputSchema")).toBe(false);
    // and the production registry is untouched: every exposed tool still declares an evaluable schema
    const production = sirkitToolRegistry();
    for (const toolId of SERVED_READS) expect(mcpOutputSchemaDecision(production.get(toolId)!), toolId).toEqual({ declared: true });
  });
});
