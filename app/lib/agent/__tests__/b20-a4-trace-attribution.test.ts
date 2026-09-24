/**
 * [B20 A4] 6.4 — trace attribution of external tool calls (D14, OD-80): the outcome class `external_observation`, the optional
 * `external` block on `tool_invocation` (identity and hashes, never content), its validator rules, the recorder's total
 * normalisation cascade, the loop's wiring through the gateway, and the neutral vocabulary of the nine B11-scanned files.
 * Fake ports only: no server, no network, no database.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SchematicState } from "@/lib/schematic-types";
import { assembleAgentRunContext } from "../context";
import { DEFAULT_AGENT_BUDGET, type AgentStep, type AgentToolResult, type ProviderAgentAdapter } from "../contracts";
import { buildEvaluationCases } from "../evaluation-cases";
import { createAgentToolGateway } from "../gateway";
import { runAgentLoop } from "../loop";
import { MCP_OBSERVATION_TOOL_ID, type McpObservationCallAnswer, type McpObservationCallRequest, type McpObservationPort } from "../mcp-observation-reads";
import { replayCapsule } from "../replay-capsule";
import { TRACE_EXTERNAL_RESULT_CLASSES, TRACE_OUTCOME_CLASSES, validateAgentRunTrace, type AgentRunTrace } from "../trace";
import { AgentTraceRecorder, InMemoryTraceSink } from "../trace-recorder";
import { sirkitToolRegistry } from "../../engineering/tool-catalog";
import type { McpObservationRecord } from "../../mcp/observation";
import { makeBoard, makeInstance, makeResistorDef } from "../../pcb/__tests__/autoplace-fixture";

const HEX = "c".repeat(64);
const EXTERNAL = Object.freeze({
  serverId: "docs-a", toolName: "search", registryVersion: "1.1.0", protocolVersion: "2026-07-28", listingDigest: `sha256:${HEX}`, resultClass: "complete",
  contentHash: `sha256:${"d".repeat(64)}`, observationId: `external_tool_observation_${"a".repeat(64)}`, retrievedAt: "2026-09-17T12:00:00.000Z",
});
const IDENTITY = {
  runId: "run-a4-trace-0001", traceId: "trace-a4-0001", provider: "openai" as const, promptVersion: "1.4.0", promptDigest: "eng1-0000000000000001", registryDigest: "eng1-0000000000000002",
  scope: { tenantId: "tenant-a4", projectId: "project-a4-0001", branchId: "main" },
  contextDigests: { canonicalRevisionDigest: null, schematicDigest: null, selectionDigest: null, netlistDigest: null, resourceManifestDigest: null },
};
const TOKEN = ["fake", "trace", "token", "0000000001"].join("-");
const SENTINEL = ["hostile", "text", "sentinel", "e41"].join("-");
const URL_TEXT = `https://${["leak", "host"].join("-")}.example.com/p?q=1`;

function recorded(outcomeClass: string, external?: unknown, status = "succeeded"): { trace: AgentRunTrace; diagnostics: readonly string[] } {
  let tick = 1_000;
  const recorder = new AgentTraceRecorder(IDENTITY, new InMemoryTraceSink(), () => (tick += 1));
  recorder.recordRunStarted();
  recorder.recordStep({ model: "scripted", usage: { inputTokens: 1, outputTokens: 1 }, toolCallCount: 1 });
  recorder.recordTool({ callId: "c-1", toolId: MCP_OBSERVATION_TOOL_ID, version: "1.0.0", operationClass: "read", args: { operation: "call" }, outcomeClass: outcomeClass as never, status, ...(external === undefined ? {} : { external }) });
  recorder.recordTerminal("completed", null);
  const trace = recorder.finalize({ outcome: "completed", failureReason: null });
  return { trace, diagnostics: trace.recorderDiagnostics };
}
const toolEvent = (trace: AgentRunTrace): Record<string, unknown> => trace.events.find((event) => event.kind === "tool_invocation") as unknown as Record<string, unknown>;

/** A document with the tool event's class and `external` replaced (bypassing the recorder): what the validator is handed. */
function forged(outcomeClass: string, external: unknown): unknown {
  const document = structuredClone(recorded("read").trace) as unknown as { events: Array<Record<string, unknown>> };
  const event = document.events.find((entry) => entry.kind === "tool_invocation")!;
  event.outcomeClass = outcomeClass;
  if (external === undefined) delete event.external;
  else event.external = external;
  return document;
}

const SCHEMATIC: SchematicState = { components: [], wires: [], netLabels: [], kicadComponents: [{ id: "k1", partId: "lib:ne555", x: 100, y: 100, rotation: 0, refDes: "U1", value: "NE555" }] };
const BOARD = JSON.parse(JSON.stringify(makeBoard(40, 30, [makeInstance("r3", makeResistorDef(), { x: 5, y: 5 }, { "1": 1, "2": 2 })], 2)));
const context = () => {
  const assembly = assembleAgentRunContext({ tenantId: "tenant-a4", projectId: "project-a4-0001", branchId: "main", schematic: SCHEMATIC, board: BOARD, verifiedActor: { principalId: "principal-a4-0001", actorRole: "viewer", membershipRevision: "mbr1-a", authMethod: "local_dev" }, mcpObservationAvailable: true });
  if (!assembly.ok) throw new Error(assembly.reason);
  return assembly.context;
};

function observationRecord(request: McpObservationCallRequest, text: string, overrides: Partial<McpObservationRecord> = {}): McpObservationRecord {
  return {
    schema: "sirkit.mcp-observation.v1", id: EXTERNAL.observationId, normalizerVersion: "sirkit.mcp-observation-normalizer/1",
    source: { serverId: request.serverId, serverTitle: "Docs A", registryVersion: "1.1.0", protocolVersion: "2026-07-28", sourceClass: "external_mcp_tool" },
    policy: { agentDisclosure: "permitted", termsDocumentationUrl: null, termsCheckedOn: null, retentionNote: null, ownerDecision: null },
    tool: { name: request.toolName, toolId: `mcp.${request.serverId}.${request.toolName}`, providerName: `mcp_${request.serverId}__${request.toolName}`, listingDigest: EXTERNAL.listingDigest, pinned: true, outputSchemaDeclared: false },
    call: { argumentsDigest: `sha256:${"e".repeat(64)}` }, resultType: "complete", isError: false, retrievedAt: EXTERNAL.retrievedAt, freshUntil: "2026-09-17T12:15:00.000Z", contentHash: EXTERNAL.contentHash,
    rawRetained: false, untrusted: true, note: "external tool observation", redactionSubjectsUnavailable: false,
    content: { blocks: [{ index: 0, type: "text", disposition: "text", rawChars: text.length, rawHash: `sha256:${"f".repeat(64)}`, repeats: 1, mimeType: null, approxBytes: null, uriScheme: null, untrustedText: text }], blocksRead: 1, blocksNotRead: 0, contentMalformed: false },
    structured: { state: "absent" }, notificationsIgnored: 0,
    ...overrides,
  };
}

function port(answer: (request: McpObservationCallRequest) => McpObservationCallAnswer): McpObservationPort {
  return {
    servers: () => [{ serverId: "docs-a", title: "Docs A", registryVersion: "1.1.0" }],
    tools: async (request) => ({ ok: true, kind: "catalog", serverId: request.serverId, toolName: null, registryVersion: "1.1.0", protocolVersion: "2026-07-28", listingDigest: EXTERNAL.listingDigest, sent: true, tools: [], toolsTotal: 0 }),
    call: async (request) => answer(request),
  };
}

class ScriptedAdapter implements ProviderAgentAdapter {
  readonly provider = "openai" as const;
  readonly results: AgentToolResult[][] = [];
  private index = 0;
  constructor(private readonly script: Array<(tools: ReadonlyArray<{ toolId: string; providerName: string }>) => Partial<AgentStep>>) {}
  private step(partial: Partial<AgentStep>): AgentStep {
    return { text: "", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "scripted", continuation: { provider: "openai", state: null }, ...partial };
  }
  async start(input: { tools: ReadonlyArray<{ toolId: string; providerName: string }> }): Promise<AgentStep> { return this.step(this.script[this.index++]!(input.tools)); }
  async continueWith(input: { results: readonly AgentToolResult[]; tools: ReadonlyArray<{ toolId: string; providerName: string }> }): Promise<AgentStep> {
    this.results.push([...input.results]);
    return this.step(this.script[this.index++]!(input.tools));
  }
}

async function loopTrace(answer: (request: McpObservationCallRequest) => McpObservationCallAnswer, calls: Array<Record<string, unknown>>) {
  const registry = sirkitToolRegistry();
  const gateway = createAgentToolGateway(registry, { mcpObservation: port(answer) });
  const adapter = new ScriptedAdapter([
    ...calls.map((input, index) => (tools: ReadonlyArray<{ toolId: string; providerName: string }>) => ({ toolCalls: [{ callId: `c-${index + 1}`, providerName: tools.find((item) => item.toolId === MCP_OBSERVATION_TOOL_ID)!.providerName, argumentsText: JSON.stringify(input) }] })),
    () => ({ text: "done" }),
  ]);
  let tick = 1_000;
  const recorder = new AgentTraceRecorder(IDENTITY, new InMemoryTraceSink(), () => (tick += 1));
  await runAgentLoop({ runId: IDENTITY.runId, provider: "openai", history: [], userMessage: "Look up LM358DR.", budget: DEFAULT_AGENT_BUDGET }, { adapter, gateway, registry, context: context(), system: "sys", emit: () => undefined, trace: recorder });
  return { trace: recorder.finalize({ outcome: "completed", failureReason: null }), adapter };
}

const CALL = { operation: "call", serverId: "docs-a", toolName: "search", argumentsJson: JSON.stringify({ mpn: "LM358DR" }) };

describe("[B20 A4] 6.4 trace attribution", () => {
  it("1. the closed outcome vocabulary ends with external_observation, and the result classes are closed", () => {
    expect(TRACE_OUTCOME_CLASSES.at(-1)).toBe("external_observation");
    expect([...TRACE_EXTERNAL_RESULT_CLASSES]).toEqual(["catalog", "complete", "tool_error", "not_sent", "authorization_failed", "upstream_error", "transport_failed", "result_invalid", "cancelled"]);
  });

  it("2. the validator: the block is required, allowed and forbidden per class; the result-class rules; the hash, id and time rules; every pattern bites; exact keys", () => {
    const valid = recorded("external_observation", EXTERNAL);
    expect(validateAgentRunTrace(valid.trace)).toEqual([]);
    const notSent = { ...EXTERNAL, resultClass: "not_sent", contentHash: null, observationId: null, retrievedAt: null };
    const catalog = { ...EXTERNAL, toolName: null, resultClass: "catalog", contentHash: null, observationId: null, retrievedAt: null };
    const rows: Array<[string, string, unknown, boolean]> = [
      ["external_observation with the block", "external_observation", EXTERNAL, true],
      ["external_observation, tool_error", "external_observation", { ...EXTERNAL, resultClass: "tool_error" }, true],
      ["external_observation, catalog", "external_observation", catalog, true],
      ["external_observation without the block", "external_observation", undefined, false],
      ["refused with a block", "refused", notSent, true],
      ["refused without a block", "refused", undefined, true],
      ["read with a block", "read", notSent, false],
      ["proposal with a block", "proposal", notSent, false],
      ["external_observation, not_sent", "external_observation", notSent, false],
      ["refused, complete", "refused", EXTERNAL, false],
      ["complete without a content hash", "external_observation", { ...EXTERNAL, contentHash: null }, false],
      ["complete without an observation id", "external_observation", { ...EXTERNAL, observationId: null }, false],
      ["complete without a retrieval time", "external_observation", { ...EXTERNAL, retrievedAt: null }, false],
      ["not_sent with a content hash", "refused", { ...notSent, contentHash: EXTERNAL.contentHash }, false],
      ["catalog naming a tool", "external_observation", { ...catalog, toolName: "search" }, false],
      ["catalog without a listing digest", "external_observation", { ...catalog, listingDigest: null }, false],
      ["serverId", "external_observation", { ...EXTERNAL, serverId: "Docs A" }, false],
      ["serverId secret-shaped", "external_observation", { ...EXTERNAL, serverId: "task-manager-docs" }, false],
      ["toolName", "external_observation", { ...EXTERNAL, toolName: "a b" }, false],
      ["registryVersion", "external_observation", { ...EXTERNAL, registryVersion: "1.0" }, false],
      ["protocolVersion", "external_observation", { ...EXTERNAL, protocolVersion: "2026-7-28" }, false],
      ["listingDigest", "external_observation", { ...EXTERNAL, listingDigest: "sha256:xyz" }, false],
      ["resultClass", "external_observation", { ...EXTERNAL, resultClass: "fine" }, false],
      ["contentHash", "external_observation", { ...EXTERNAL, contentHash: `md5:${HEX}` }, false],
      ["observationId", "external_observation", { ...EXTERNAL, observationId: `observation_${HEX}` }, false],
      ["retrievedAt", "external_observation", { ...EXTERNAL, retrievedAt: "2026-09-17" }, false],
      ["an extra key", "external_observation", { ...EXTERNAL, url: "x" }, false],
      ["a missing key", "external_observation", Object.fromEntries(Object.entries(EXTERNAL).filter(([key]) => key !== "listingDigest")), false],
      ["not an object", "external_observation", "docs-a", false],
    ];
    for (const [label, outcomeClass, external, ok] of rows) {
      const issues = validateAgentRunTrace(forged(outcomeClass, external));
      expect(issues.length === 0, `${label}: ${issues.join(" | ")}`).toBe(ok);
    }
  });

  it("3. the recorder normalises each field (the cascade) and never records an invalid event", () => {
    const fields: Array<[string, Record<string, unknown>, Record<string, unknown>, string]> = [
      ["a secret-shaped tool name", { toolName: "desk-lookup-parts" }, { toolName: null }, "external_observation"],
      ["a tool name outside the pattern", { toolName: "a b" }, { toolName: null }, "external_observation"],
      ["a protocol version", { protocolVersion: "yesterday" }, { protocolVersion: null }, "external_observation"],
      ["a listing digest", { listingDigest: "sha256:xyz" }, { listingDigest: null }, "external_observation"],
      ["a registry version", { registryVersion: "v1" }, { registryVersion: "0.0.0" }, "external_observation"],
      ["a bad content hash", { contentHash: "sha256:xyz" }, { resultClass: "result_invalid", contentHash: null, observationId: null, retrievedAt: null }, "refused"],
      ["a bad retrieval time", { retrievedAt: 5 }, { resultClass: "result_invalid", contentHash: null, observationId: null, retrievedAt: null }, "refused"],
      ["an unknown result class", { resultClass: "fine" }, { resultClass: "result_invalid", contentHash: null, observationId: null, retrievedAt: null }, "refused"],
    ];
    for (const [label, change, expected, outcomeClass] of fields) {
      const { trace, diagnostics } = recorded("external_observation", { ...EXTERNAL, ...change });
      expect(validateAgentRunTrace(trace), label).toEqual([]);
      const event = toolEvent(trace);
      expect(event.outcomeClass, label).toBe(outcomeClass);
      expect(event.external, label).toMatchObject({ ...EXTERNAL, ...expected });
      expect(diagnostics, label).toContain("trace_input_normalized");
    }
    // a server id that cannot be recorded drops the block, and the event is refused
    for (const serverId of ["task-manager-docs", "Docs A", 5]) {
      const { trace } = recorded("external_observation", { ...EXTERNAL, serverId });
      expect(validateAgentRunTrace(trace), String(serverId)).toEqual([]);
      expect(toolEvent(trace).outcomeClass, String(serverId)).toBe("refused");
      expect(toolEvent(trace), String(serverId)).not.toHaveProperty("external");
    }
    // the block on a class that forbids it is dropped; the class stays
    const onRead = recorded("read", EXTERNAL);
    expect(toolEvent(onRead.trace)).not.toHaveProperty("external");
    expect(toolEvent(onRead.trace).outcomeClass).toBe("read");
    expect(onRead.diagnostics).toContain("trace_input_normalized");
    // external_observation without a block is refused
    const missing = recorded("external_observation");
    expect(toolEvent(missing.trace).outcomeClass).toBe("refused");
    expect(validateAgentRunTrace(missing.trace)).toEqual([]);
    // hostile input never throws and never records an invalid event
    const hostile = [new Proxy({}, { get() { throw new Error("trap"); } }), { get serverId(): string { throw new Error("getter"); } }, null, [EXTERNAL]];
    for (const external of hostile) {
      const { trace } = recorded("external_observation", external);
      expect(validateAgentRunTrace(trace)).toEqual([]);
    }
    // a run without an external call records no key at all
    expect(toolEvent(recorded("read").trace)).not.toHaveProperty("external");
  });

  it("4. the loop through the gateway: external_observation carries the attribution; a refusal after resolution carries it too; a service refusal carries none", async () => {
    const { trace } = await loopTrace((request) => ({ ok: true, kind: "observation", serverId: request.serverId, toolName: request.toolName, registryVersion: "1.1.0", protocolVersion: "2026-07-28", listingDigest: EXTERNAL.listingDigest, sent: true, observation: observationRecord(request, "LM358DR is in stock.") }), [CALL]);
    expect(validateAgentRunTrace(trace)).toEqual([]);
    expect(toolEvent(trace)).toMatchObject({ outcomeClass: "external_observation", external: EXTERNAL });
    const refused = await loopTrace((request) => ({ ok: false, kind: "refused", code: "upstream_error", retryAtMs: null, serverId: request.serverId, toolName: request.toolName, registryVersion: "1.1.0", protocolVersion: "2026-07-28", listingDigest: EXTERNAL.listingDigest, sent: true }), [CALL]);
    expect(toolEvent(refused.trace)).toMatchObject({ outcomeClass: "refused", status: "upstream_error", external: { serverId: "docs-a", toolName: "search", resultClass: "upstream_error", contentHash: null, observationId: null, retrievedAt: null } });
    const invalid = await loopTrace(() => { throw new Error("never asked"); }, [{ ...CALL, argumentsJson: "{nope" }]);
    expect(toolEvent(invalid.trace)).toMatchObject({ outcomeClass: "refused", status: "arguments_invalid" });
    expect(toolEvent(invalid.trace)).not.toHaveProperty("external");
    // [B20 A4 review] tests-3: a server-reported tool error is `tool_error` on an `external_observation` event — never
    // `complete` — and the model's result for that call is an error it may correct
    const failed = await loopTrace((request) => ({ ok: true, kind: "observation", serverId: request.serverId, toolName: request.toolName, registryVersion: "1.1.0", protocolVersion: "2026-07-28", listingDigest: EXTERNAL.listingDigest, sent: true, observation: observationRecord(request, "No such part.", { isError: true }) }), [CALL]);
    expect(validateAgentRunTrace(failed.trace)).toEqual([]);
    expect(toolEvent(failed.trace)).toMatchObject({ outcomeClass: "external_observation", status: "succeeded", external: { ...EXTERNAL, resultClass: "tool_error" } });
    expect(failed.adapter.results[0]![0]).toMatchObject({ callId: "c-1", isError: true });
    expect(failed.adapter.results[0]![0]!.outputText).toContain('"ok":false');
  });

  it("5. the trace of a hostile run holds no text, token, argument or URL — only identities and hashes, the observation id and the retrieval time", async () => {
    const hostile = `${SENTINEL} ${TOKEN} ${URL_TEXT}`;
    const { trace } = await loopTrace((request) => ({ ok: true, kind: "observation", serverId: request.serverId, toolName: request.toolName, registryVersion: "1.1.0", protocolVersion: "2026-07-28", listingDigest: EXTERNAL.listingDigest, sent: true, observation: observationRecord(request, hostile) }), [CALL]);
    const serialized = JSON.stringify(trace);
    for (const needle of [SENTINEL, TOKEN, URL_TEXT, "https://", "LM358DR", "argumentsJson"]) expect(serialized.includes(needle), needle).toBe(false);
    expect(serialized).toContain(EXTERNAL.observationId);
    expect(serialized).toContain(EXTERNAL.retrievedAt);
  });

  it("6. a run with no external call has no external key (evaluation case e03-valid-board)", async () => {
    const base = buildEvaluationCases({}).find((item) => item.caseId === "e03-valid-board")!;
    const outcome = await replayCapsule(base.capsule, base.options);
    const tools = outcome.trace.events.filter((event) => event.kind === "tool_invocation");
    expect(tools.length).toBeGreaterThan(0);
    for (const event of tools) expect(event).not.toHaveProperty("external");
  });

  it("7. the nine B11-scanned files carry no MCP identifier at all, and the provider vocabulary is unchanged", () => {
    const files = ["trace.ts", "trace-recorder.ts", "replay-capsule.ts", "replay-context.ts", "evaluation.ts", "evaluation-cases.ts", "pcb-shape-projection.ts", "pcb-shape-types.ts", "generated/pcb-shape-descriptor.ts"];
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), "app/lib/agent", file), "utf8");
      expect(source, file).not.toMatch(/modelcontextprotocol|mcpServer|spawnAgent|multiAgent/i);
      expect(source, file).not.toMatch(/mcp/i);
    }
    expect(readFileSync(join(process.cwd(), "app/lib/agent/trace-recorder.ts"), "utf8")).toContain('provider: "openai" | "anthropic";');
  });
});
