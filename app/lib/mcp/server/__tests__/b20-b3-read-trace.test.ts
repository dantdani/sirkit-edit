/**
 * [B20 B3] E — the MCP read trace `sirkit.mcp-read-trace.v1` (D-11; OD-72): one closed record per pipeline call naming the
 * principal (ids, role, membership revision, mcp_bearer, the token id's digest), the bindings, the durable board identity,
 * the post-checks, admission, idempotency (the key's digest only) and the B05 digests, with a closed outcome. The agent's
 * trace identity, the B05 trace, tool-invocation.ts and the nine B11 files are untouched: an MCP call is not an agent run.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { READ_FAILURE_STATUSES } from "@/app/lib/engineering/tool-invocation";
import { durableBoardFixture } from "@/app/lib/engineering/__tests__/_durable-board-fixture";
import { resetMcpReadInvokerFactory, resetMcpReadStateForTests, setMcpReadInvokerFactory } from "../read-call";
import {
  MCP_READ_B05_STATUSES,
  MCP_READ_OWN_REFUSAL_STATUSES,
  MCP_READ_REFUSAL_STATUSES,
  MCP_READ_TRACE_OUTCOMES,
  MCP_READ_TRACE_RING_MAX,
  MCP_READ_TRACE_SCHEMA,
  mcpReadTraceRing,
  recordMcpReadTrace,
  resetMcpReadTraceSinkFactory,
  setMcpReadTraceSinkFactory,
  type McpReadTrace,
} from "../read-trace";
import { pinOf, readHarness, resultOf } from "./_read-harness";
import { durableCanonicalState } from "@/app/lib/engineering/durable-read-bundle";
import { computeProjectRevision } from "@/app/lib/engineering/revision";

const ROOT = process.cwd();
const TRACE_KEYS = ["admission", "completedAtMs", "durableBoard", "durablePostCheck", "expectedRevision", "boundRevision", "idempotency", "invocationId", "listingDigest", "membershipRecheck", "outcome", "principal", "read", "registryDigest", "requestId", "revisionBinding", "schema", "startedAtMs", "toolId", "toolVersion"].sort();
const B11_FILES = ["trace.ts", "trace-recorder.ts", "replay-capsule.ts", "replay-context.ts", "evaluation.ts", "evaluation-cases.ts", "pcb-shape-projection.ts", "pcb-shape-types.ts", "generated/pcb-shape-descriptor.ts"];

function capture(): McpReadTrace[] {
  const records: McpReadTrace[] = [];
  setMcpReadTraceSinkFactory(() => ({ record: (trace) => { records.push(trace); } }));
  return records;
}

beforeEach(() => { resetMcpReadStateForTests(); resetMcpReadInvokerFactory(); resetMcpReadTraceSinkFactory(); });
afterEach(() => { resetMcpReadStateForTests(); resetMcpReadInvokerFactory(); resetMcpReadTraceSinkFactory(); });

describe("[B20 B3] E — the MCP read trace", () => {
  it("1. the schema is closed and every outcome belongs to the closed list; the B05 statuses are exactly READ_FAILURE_STATUSES", async () => {
    expect(MCP_READ_TRACE_SCHEMA).toBe("sirkit.mcp-read-trace.v1");
    expect([...MCP_READ_B05_STATUSES]).toEqual([...READ_FAILURE_STATUSES]);
    expect([...MCP_READ_OWN_REFUSAL_STATUSES]).toEqual([
      "internal_error", "invalid_arguments", "revision_required", "registry_changed", "idempotency_key_conflict", "idempotency_in_flight", "busy", "cancelled",
      "no_durable_board", "durable_board_unavailable", "durable_board_corrupt", "durable_board_invalid", "stale_revision", "not_servable",
      "membership_changed", "membership_unavailable", "timeout", "output_too_large_for_model",
    ]);
    expect([...MCP_READ_REFUSAL_STATUSES]).toEqual([...new Set([...MCP_READ_OWN_REFUSAL_STATUSES, ...READ_FAILURE_STATUSES])]);
    expect([...MCP_READ_TRACE_OUTCOMES]).toEqual(["succeeded", "replayed", ...MCP_READ_REFUSAL_STATUSES]);
    const records = capture();
    const h = await readHarness();
    await h.call("sirkit.project.canonical-revision-inspect");
    expect(records).toHaveLength(1);
    expect(Object.keys(records[0]!).sort()).toEqual(TRACE_KEYS);
    expect(records[0]!.schema).toBe(MCP_READ_TRACE_SCHEMA);
    expect(MCP_READ_TRACE_OUTCOMES).toContain(records[0]!.outcome);
    // a record outside the schema is dropped
    recordMcpReadTrace({ ...records[0]!, outcome: "maybe" as never });
    recordMcpReadTrace({ ...records[0]!, extra: 1 } as never);
    recordMcpReadTrace({ ...records[0]!, principal: { ...records[0]!.principal, authMethod: "supabase_cookie" as never } });
    expect(records).toHaveLength(1);
  });

  it("2. one record per pipeline call — a success, each refusal class, busy and a replay — and none for a -32602 binding error", async () => {
    const records = capture();
    const board = durableBoardFixture();
    const h = await readHarness({ board });
    const revision = computeProjectRevision(durableCanonicalState(h.principal, board)).canonicalStateDigest;
    await h.call("sirkit.project.canonical-revision-inspect", { meta: { "dev.sirkit/idempotencyKey": "trace-key-0001" } });
    await h.call("sirkit.project.canonical-revision-inspect", { meta: { "dev.sirkit/idempotencyKey": "trace-key-0001" } });
    await h.call("sirkit.pcb.board-inspect");
    await h.call("sirkit.pcb.board-inspect", { meta: pinOf("eng1-0000000000000000") });
    await h.call("sirkit.pcb.via-inspect", { args: { netName: "a b" } });
    await h.call("sirkit.pcb.board-inspect", { meta: pinOf(revision) });
    setMcpReadInvokerFactory(() => ({ invoke: async (request) => ({ status: "unauthorized", toolId: request.toolId, invocationId: request.invocationId, traceId: request.traceId, diagnostics: [] }) }));
    await h.call("sirkit.project.canonical-revision-inspect");
    const binding = await h.call("sirkit.project.canonical-revision-inspect", { meta: { "dev.sirkit/expectedRevision": "garbage" } });
    expect(binding).toEqual({ kind: "invalid_params" });
    expect(records.map((record) => record.outcome)).toEqual(["succeeded", "replayed", "revision_required", "stale_revision", "invalid_arguments", "succeeded", "unauthorized"]);
    const success = records[5]!;
    expect(success).toMatchObject({ revisionBinding: "expected", expectedRevision: revision, boundRevision: revision, durablePostCheck: "unchanged", membershipRecheck: "current", admission: "admitted" });
    expect(success.durableBoard).toEqual({ boardId: "board:proj-mcp", boardRevision: h.record!.revision, boardDigest: h.record!.digest, aggregateRevision: 1 });
    expect(Object.keys(success.read!).sort()).toEqual(["bindingId", "bindingVersion", "consumedResources", "inputDigest", "outputDigest", "resourceManifestDigest", "verification"]);
    expect(records[2]).toMatchObject({ admission: "not_run", durablePostCheck: "not_run", membershipRecheck: "not_run", read: null, durableBoard: null, invocationId: null });
    expect(records[0]!.idempotency).toMatchObject({ state: "stored" });
    expect(records[0]!.idempotency.keyDigest).toMatch(/^[0-9a-f]{32}$/);
    expect(records[1]!.idempotency).toMatchObject({ state: "replayed", keyDigest: records[0]!.idempotency.keyDigest });
    expect(records[2]!.idempotency).toEqual({ keyDigest: null, state: "none" });
    // busy is recorded too
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered = 0;
    resetMcpReadInvokerFactory();
    const real = (await import("@/app/lib/engineering/tool-invocation")).ReadToolInvocationService;
    setMcpReadInvokerFactory((registry) => { const service = new real(registry); return { invoke: async (...args) => { entered += 1; await gate; return service.invoke(...args); } }; });
    const running = [h.call("sirkit.project.canonical-revision-inspect"), h.call("sirkit.project.canonical-revision-inspect")];
    while (entered < 2) await new Promise((resolve) => setTimeout(resolve, 1));
    await h.call("sirkit.project.canonical-revision-inspect");
    release();
    await Promise.all(running);
    expect(records.filter((record) => record.outcome === "busy")).toHaveLength(1);
    expect(records.find((record) => record.outcome === "busy")).toMatchObject({ admission: "busy" });
  });

  it("3. the principal block is the bearer principal's, with mcp_bearer", async () => {
    const records = capture();
    const h = await readHarness();
    await h.call("sirkit.project.canonical-revision-inspect");
    const { principal } = h;
    expect(records[0]!.principal).toEqual({ tenantId: principal.tenantId, projectId: principal.projectId, branchId: principal.branchId, principalId: principal.principalId, role: principal.role, membershipRevision: principal.membershipRevision, authMethod: "mcp_bearer", tokenIdDigest: principal.tokenIdDigest });
    expect(records[0]!.requestId).toBe(principal.requestId);
    expect(records[0]).toMatchObject({ toolId: "sirkit.project.canonical-revision-inspect", toolVersion: "1.0.0", registryDigest: h.registryDigest });
    expect(records[0]!.listingDigest).toMatch(/^eng1-[0-9a-f]{16}$/);
  });

  it("4. no token, raw key, raw argument text, diagnostic or board content", async () => {
    const records = capture();
    const board = durableBoardFixture({ netNames: ["BOARD-CONTENT-CANARY", "/root/VCC"] });
    const h = await readHarness({ board });
    const canary = ["sk", "trace", "0123456789abcdefghij"].join("-");
    await h.call("sirkit.pcb.via-inspect", { args: { netName: canary } });
    await h.call("sirkit.project.canonical-revision-inspect", { meta: { "dev.sirkit/idempotencyKey": "private-key-value-0001" } });
    await h.call("sirkit.pcb.via-inspect", { args: { netName: "BOARD-CONTENT-CANARY" }, meta: pinOf(String(resultOf(await h.call("sirkit.pcb.revision-inspect"))._meta["dev.sirkit/revision"])) });
    setMcpReadInvokerFactory(() => ({ invoke: async (request) => ({ status: "invalid_input", toolId: request.toolId, invocationId: request.invocationId, traceId: request.traceId, diagnostics: [canary] }) }));
    await h.call("sirkit.project.canonical-revision-inspect");
    const text = JSON.stringify(records);
    for (const raw of [canary, "private-key-value-0001", "BOARD-CONTENT-CANARY", "AbCdEfGhIjKlMnOpQrStUv"]) {
      expect(text.includes(raw), raw).toBe(false);
      expect(text.toLowerCase().includes(raw.toLowerCase()), raw).toBe(false);
    }
    // no header text (the principal's authMethod value, mcp_bearer, is the only place the word appears)
    for (const raw of ["Bearer ", "authorization", "Authorization"]) expect(text.includes(raw), raw).toBe(false);
    expect(records.length).toBeGreaterThanOrEqual(4);
  });

  it("5. the ring holds at most 1 000 records; a throwing sink leaves the response byte-identical", async () => {
    expect(MCP_READ_TRACE_RING_MAX).toBe(1_000);
    const h = await readHarness();
    const template = await (async () => { const records = capture(); await h.call("sirkit.project.canonical-revision-inspect"); resetMcpReadTraceSinkFactory(); return records[0]!; })();
    for (let index = 0; index < 1_005; index += 1) recordMcpReadTrace({ ...template, startedAtMs: index, completedAtMs: index });
    const ring = mcpReadTraceRing();
    expect(ring).toHaveLength(1_000);
    expect(ring[0]!.startedAtMs).toBe(5);
    resetMcpReadStateForTests();
    const withRing = JSON.stringify(await h.call("sirkit.project.canonical-revision-inspect"));
    setMcpReadTraceSinkFactory(() => ({ record: () => { throw new Error("sink down"); } }));
    resetMcpReadStateForTests();
    const withThrowingSink = JSON.stringify(await h.call("sirkit.project.canonical-revision-inspect"));
    setMcpReadTraceSinkFactory(() => { throw new Error("factory down"); });
    resetMcpReadStateForTests();
    const withThrowingFactory = JSON.stringify(await h.call("sirkit.project.canonical-revision-inspect"));
    const stripId = (text: string): string => text.replace(/mcp-read-[0-9a-f]{32}/g, "mcp-read-X");
    expect(stripId(withThrowingSink)).toBe(stripId(withRing));
    expect(stripId(withThrowingFactory)).toBe(stripId(withRing));
  });

  it("6. source scans: the agent trace provider is still openai | anthropic; tool-invocation.ts carries only its one MCP mention; the nine B11 files carry no MCP identifier", () => {
    expect(readFileSync(join(ROOT, "app", "lib", "agent", "trace-recorder.ts"), "utf8")).toContain('provider: "openai" | "anthropic";');
    const invocation = readFileSync(join(ROOT, "app", "lib", "engineering", "tool-invocation.ts"), "utf8");
    const mentions = invocation.split(String.fromCharCode(10)).map((line, index) => [index + 1, line] as const).filter(([, line]) => /\bmcp\b/i.test(line));
    expect(mentions).toEqual([[22, " * No mutation, proposal, release, provider, chat, MCP, or agent execution"]]);
    for (const file of B11_FILES) expect(readFileSync(join(ROOT, "app", "lib", "agent", file), "utf8"), file).not.toMatch(/modelcontextprotocol|mcpServer|spawnAgent|multiAgent/i);
  });
});
