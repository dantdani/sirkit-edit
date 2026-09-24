/**
 * [B20 B3] D — the replay cache of MCP reads (D-10; OD-71): a per-process, per-principal cache of SUCCESSFUL results keyed by
 * the caller's idempotency key. An entry binds the call (tool, version, arguments digest, pinned revision and registry) and
 * its context (membership revision, registry digest): another call under the same key is a conflict, a changed context
 * evicts. TTL, per-principal and global entry caps, an entry size cap, a total size cap and an in-flight cap bound it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { durableBoardFixture } from "@/app/lib/engineering/__tests__/_durable-board-fixture";
import {
  MCP_REPLAY_BOUNDS,
  MCP_REPLAY_MAX_ENTRIES,
  MCP_REPLAY_MAX_ENTRIES_PER_PRINCIPAL,
  MCP_REPLAY_MAX_ENTRY_CHARS,
  MCP_REPLAY_MAX_IN_FLIGHT_PER_PRINCIPAL,
  MCP_REPLAY_MAX_TOTAL_CHARS,
  MCP_REPLAY_TTL_MS,
  McpReadReplayCache,
  mcpReadReplayCache,
  validateMcpReplayBounds,
  type McpReplayCall,
  type McpReplayContext,
  type McpReplayIdentity,
} from "../replay-cache";
import { resetMcpReadStateForTests, setMcpReadInvokerFactory, resetMcpReadInvokerFactory } from "../read-call";
import { ReadToolInvocationService } from "@/app/lib/engineering/tool-invocation";
import { HARNESS_T0, pinOf, readHarness, refusalOf, resultOf } from "./_read-harness";

const T0 = 1_760_000_000_000;
const HOSTILE_NUMBERS = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0, 1.5, 2 ** 53];
const identity = (overrides: Partial<McpReplayIdentity> = {}): McpReplayIdentity => ({ tenantId: "local", projectId: "proj-mcp", branchId: "main", principalId: "user-1", key: "retry-key-0001", ...overrides });
const call = (overrides: Partial<McpReplayCall> = {}): McpReplayCall => ({ toolId: "sirkit.pcb.board-inspect", toolVersion: "1.1.0", argsDigest: "eng1-0000000000000001", expectedRevision: "eng1-00000000000000aa", expectedRegistryDigest: null, ...overrides });
const context = (overrides: Partial<McpReplayContext> = {}): McpReplayContext => ({ membershipRevision: "mbr1-0000000000000001", registryDigest: "eng1-00000000000000bb", ...overrides });
const result = (tag: string, size = 0) => ({ resultType: "complete", content: [{ type: "text", text: `${tag}${"x".repeat(size)}` }], isError: false, _meta: { "dev.sirkit/invocationId": `mcp-read-${tag}`, "dev.sirkit/revision": "eng1-00000000000000aa", "dev.sirkit/idempotency": "stored" } });

/** One cached computation: begin → (miss: compute, store, release) → the answer, and how many times it computed. */
function serve(cache: McpReadReplayCache, who: McpReplayIdentity, what: McpReplayCall, where: McpReplayContext, nowMs: number, compute: () => ReturnType<typeof result>): { kind: string; value: unknown } {
  const begun = cache.begin(who, what, where, nowMs);
  if (begun.kind === "hit") return { kind: "hit", value: begun.result };
  if (begun.kind !== "miss") return { kind: begun.kind, value: null };
  try {
    const value = compute();
    cache.store(who, what, where, value, nowMs);
    return { kind: "miss", value };
  } finally {
    cache.release(who);
  }
}
function consistent(cache: McpReadReplayCache): void {
  const stats = cache.stats();
  expect(stats.entries).toBeLessThanOrEqual(MCP_REPLAY_MAX_ENTRIES);
  expect(stats.totalChars).toBeLessThanOrEqual(MCP_REPLAY_MAX_TOTAL_CHARS);
  expect(stats.totalChars).toBe(stats.entryChars.reduce((sum, value) => sum + value, 0));
  expect(stats.entryChars).toHaveLength(stats.entries);
  for (const count of Object.values(stats.entriesPerPrincipal)) expect(count).toBeLessThanOrEqual(MCP_REPLAY_MAX_ENTRIES_PER_PRINCIPAL);
  expect(Object.values(stats.entriesPerPrincipal).reduce((sum, value) => sum + value, 0)).toBe(stats.entries);
}

beforeEach(() => { resetMcpReadStateForTests(); resetMcpReadInvokerFactory(); });
afterEach(() => { resetMcpReadStateForTests(); resetMcpReadInvokerFactory(); });

describe("[B20 B3] D — the replay cache", () => {
  it("1. the constants and their validator (NaN, ±Infinity, -1, 0, 1.5 and 2^53 refused)", () => {
    expect(MCP_REPLAY_BOUNDS).toEqual({ MCP_REPLAY_TTL_MS: 600_000, MCP_REPLAY_MAX_ENTRIES_PER_PRINCIPAL: 32, MCP_REPLAY_MAX_ENTRIES: 1_024, MCP_REPLAY_MAX_ENTRY_CHARS: 131_072, MCP_REPLAY_MAX_TOTAL_CHARS: 8_388_608, MCP_REPLAY_MAX_IN_FLIGHT_PER_PRINCIPAL: 8 });
    expect([MCP_REPLAY_TTL_MS, MCP_REPLAY_MAX_ENTRIES_PER_PRINCIPAL, MCP_REPLAY_MAX_ENTRIES, MCP_REPLAY_MAX_ENTRY_CHARS, MCP_REPLAY_MAX_TOTAL_CHARS, MCP_REPLAY_MAX_IN_FLIGHT_PER_PRINCIPAL]).toEqual([600_000, 32, 1_024, 131_072, 8_388_608, 8]);
    expect(Object.isFrozen(MCP_REPLAY_BOUNDS)).toBe(true);
    expect(validateMcpReplayBounds(MCP_REPLAY_BOUNDS)).toEqual([]);
    for (const name of Object.keys(MCP_REPLAY_BOUNDS)) for (const value of HOSTILE_NUMBERS) expect(validateMcpReplayBounds({ ...MCP_REPLAY_BOUNDS, [name]: value }).length, `${name}=${value}`).toBeGreaterThan(0);
    for (const value of [null, 5, "x", [], { extra: 1 }]) expect(validateMcpReplayBounds(value).length).toBeGreaterThan(0);
    expect(mcpReadReplayCache).toBeInstanceOf(McpReadReplayCache);
  });

  it("2. miss, store, hit: an equal result through the pipeline, replayed, with the original invocation id and revision; the binding ran once", async () => {
    const cache = new McpReadReplayCache();
    let computed = 0;
    const first = serve(cache, identity(), call(), context(), T0, () => { computed += 1; return result("a"); });
    const second = serve(cache, identity(), call(), context(), T0 + 1, () => { computed += 1; return result("b"); });
    expect([first.kind, second.kind, computed]).toEqual(["miss", "hit", 1]);
    expect(second.value).toEqual(first.value);
    expect(second.value).not.toBe(first.value);
    // end to end: the same key in a new call replays the stored result, relabelled replayed
    const h = await readHarness();
    let invocations = 0;
    setMcpReadInvokerFactory((registry) => { const real = new ReadToolInvocationService(registry); return { invoke: (...args) => { invocations += 1; return real.invoke(...args); } }; });
    const key = { "dev.sirkit/idempotencyKey": "retry-key-0001" };
    const stored = resultOf(await h.call("sirkit.project.canonical-revision-inspect", { meta: key }));
    const replayed = resultOf(await h.call("sirkit.project.canonical-revision-inspect", { meta: key }));
    expect(invocations).toBe(1);
    expect(stored._meta["dev.sirkit/idempotency"]).toBe("stored");
    expect(replayed._meta["dev.sirkit/idempotency"]).toBe("replayed");
    expect(replayed._meta["dev.sirkit/invocationId"]).toBe(stored._meta["dev.sirkit/invocationId"]);
    expect(replayed._meta["dev.sirkit/revision"]).toBe(stored._meta["dev.sirkit/revision"]);
    expect({ ...replayed, _meta: { ...replayed._meta, "dev.sirkit/idempotency": "stored" } }).toEqual(stored);
  });

  it("3. another tool, arguments, pinned revision or pinned registry under the same key is a conflict, and the entry is kept", async () => {
    const cache = new McpReadReplayCache();
    serve(cache, identity(), call(), context(), T0, () => result("a"));
    for (const other of [call({ toolId: "sirkit.pcb.via-inspect" }), call({ toolVersion: "9.9.9" }), call({ argsDigest: "eng1-0000000000000002" }), call({ expectedRevision: null }), call({ expectedRevision: "eng1-00000000000000ab" }), call({ expectedRegistryDigest: "eng1-00000000000000bb" })]) {
      expect(cache.begin(identity(), other, context(), T0 + 1).kind, JSON.stringify(other)).toBe("conflict");
    }
    expect(cache.begin(identity(), call(), context(), T0 + 2)).toMatchObject({ kind: "hit" });
    // end to end: idempotency_key_conflict, with nothing computed
    const h = await readHarness();
    const key = { "dev.sirkit/idempotencyKey": "retry-key-0002" };
    resultOf(await h.call("sirkit.project.canonical-revision-inspect", { meta: key }));
    expect(refusalOf(await h.call("sirkit.pcb.revision-inspect", { meta: key }))).toBe("idempotency_key_conflict");
    expect(resultOf(await h.call("sirkit.project.canonical-revision-inspect", { meta: key }))._meta["dev.sirkit/idempotency"]).toBe("replayed");
  });

  it("4. a changed membership revision or registry digest evicts the entry and the call is recomputed", () => {
    const cache = new McpReadReplayCache();
    for (const changed of [context({ membershipRevision: "mbr1-0000000000000002" }), context({ registryDigest: "eng1-00000000000000cc" })]) {
      cache.clear();
      let computed = 0;
      serve(cache, identity(), call(), context(), T0, () => { computed += 1; return result("a"); });
      const again = serve(cache, identity(), call(), changed, T0 + 1, () => { computed += 1; return result("b"); });
      expect([again.kind, computed]).toEqual(["miss", 2]);
      expect(cache.begin(identity(), call(), context(), T0 + 2).kind).toBe("miss"); // the old context's entry is gone
      cache.release(identity());
    }
  });

  it("5. another principal, project, tenant or branch misses", () => {
    const cache = new McpReadReplayCache();
    serve(cache, identity(), call(), context(), T0, () => result("a"));
    for (const other of [identity({ principalId: "user-2" }), identity({ projectId: "proj-other" }), identity({ tenantId: "tenant-other" }), identity({ branchId: "branch-other" })]) {
      expect(cache.begin(other, call(), context(), T0 + 1).kind, JSON.stringify(other)).toBe("miss");
      cache.release(other);
    }
  });

  it("6. TTL: a hit at 599 999 ms and a miss at 600 000 ms; an invalid clock neither stores nor replays", () => {
    const cache = new McpReadReplayCache();
    serve(cache, identity(), call(), context(), T0, () => result("a"));
    expect(cache.begin(identity(), call(), context(), T0 + 599_999).kind).toBe("hit");
    expect(cache.begin(identity(), call(), context(), T0 + 600_000).kind).toBe("miss");
    cache.release(identity());
    expect(cache.stats().entries).toBe(0);
    for (const clock of [Number.NaN, -1, 1.5, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(cache.begin(identity(), call(), context(), clock).kind, String(clock)).toBe("invalid");
      expect(cache.store(identity(), call(), context(), result("a"), clock), String(clock)).toBe("not_stored");
    }
    expect(cache.stats().entries).toBe(0);
  });

  it("7. eviction: the 33rd entry of one principal evicts its oldest; the 1 025th evicts the global oldest; an entry over 131 072 characters is not_stored; the total stays within 8 388 608; the counters stay consistent", () => {
    const cache = new McpReadReplayCache();
    for (let index = 0; index < 33; index += 1) {
      serve(cache, identity({ key: `key-${String(index).padStart(5, "0")}` }), call(), context(), T0 + index, () => result(`p${index}`));
      consistent(cache);
    }
    expect(cache.stats().entriesPerPrincipal[["local", "proj-mcp", "user-1"].join(String.fromCharCode(0))]).toBe(32);
    expect(cache.begin(identity({ key: "key-00000" }), call(), context(), T0 + 40).kind).toBe("miss");
    cache.release(identity({ key: "key-00000" }));
    expect(cache.begin(identity({ key: "key-00001" }), call(), context(), T0 + 40).kind).toBe("hit");
    // 1 025 entries across 33 principals: the global oldest goes
    cache.clear();
    let written = 0;
    for (let principal = 0; principal < 33 && written < 1_025; principal += 1) {
      for (let index = 0; index < 32 && written < 1_025; index += 1) {
        serve(cache, identity({ principalId: `user-${principal}`, key: `key-${String(index).padStart(5, "0")}` }), call(), context(), T0 + written, () => result(`g${written}`));
        written += 1;
      }
    }
    consistent(cache);
    expect(cache.stats().entries).toBe(1_024);
    expect(cache.begin(identity({ principalId: "user-0", key: "key-00000" }), call(), context(), T0 + 2_000).kind).toBe("miss");
    cache.release(identity({ principalId: "user-0", key: "key-00000" }));
    expect(cache.begin(identity({ principalId: "user-0", key: "key-00001" }), call(), context(), T0 + 2_000).kind).toBe("hit");
    // size: an entry over the cap is not stored; the total stays within its cap, oldest evicted first
    cache.clear();
    expect(cache.store(identity(), call(), context(), result("big", MCP_REPLAY_MAX_ENTRY_CHARS), T0)).toBe("not_stored");
    expect(cache.stats().entries).toBe(0);
    for (let index = 0; index < 70; index += 1) {
      expect(cache.store(identity({ principalId: `user-${index % 40}`, key: `key-${String(index).padStart(5, "0")}` }), call(), context(), result(`s${index}`, 125_000), T0 + index)).toBe("stored");
      consistent(cache);
    }
    expect(cache.stats().totalChars).toBeLessThanOrEqual(MCP_REPLAY_MAX_TOTAL_CHARS);
    expect(cache.stats().entries).toBeLessThan(70);
  });

  it("8. a concurrent same-key call is idempotency_in_flight; the ninth in-flight key of one principal is refused; every marker is released on every path", async () => {
    const cache = new McpReadReplayCache();
    expect(cache.begin(identity(), call(), context(), T0).kind).toBe("miss");
    expect(cache.begin(identity(), call(), context(), T0).kind).toBe("in_flight");
    cache.release(identity());
    expect(cache.begin(identity(), call(), context(), T0).kind).toBe("miss");
    cache.release(identity());
    for (let index = 0; index < MCP_REPLAY_MAX_IN_FLIGHT_PER_PRINCIPAL; index += 1) expect(cache.begin(identity({ key: `flight-${String(index).padStart(4, "0")}` }), call(), context(), T0).kind).toBe("miss");
    expect(cache.begin(identity({ key: "flight-0008" }), call(), context(), T0).kind).toBe("full");
    expect(cache.begin(identity({ principalId: "user-2", key: "flight-0008" }), call(), context(), T0).kind).toBe("miss");
    for (let index = 0; index < MCP_REPLAY_MAX_IN_FLIGHT_PER_PRINCIPAL; index += 1) cache.release(identity({ key: `flight-${String(index).padStart(4, "0")}` }));
    cache.release(identity({ principalId: "user-2", key: "flight-0008" }));
    expect(cache.stats().inFlight).toBe(0);
    // end to end: the concurrent same-key call is refused while the first is in flight, and markers are released after it
    const h = await readHarness();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let entered = 0;
    setMcpReadInvokerFactory((registry) => { const real = new ReadToolInvocationService(registry); return { invoke: async (...args) => { entered += 1; await gate; return real.invoke(...args); } }; });
    const key = { "dev.sirkit/idempotencyKey": "flight-key-0001" };
    const first = h.call("sirkit.project.canonical-revision-inspect", { meta: key });
    await new Promise((resolve) => setTimeout(resolve, 0));
    while (entered === 0) await new Promise((resolve) => setTimeout(resolve, 1));
    expect(refusalOf(await h.call("sirkit.project.canonical-revision-inspect", { meta: key }))).toBe("idempotency_in_flight");
    release();
    expect(resultOf(await first)._meta["dev.sirkit/idempotency"]).toBe("stored");
    expect(mcpReadReplayCache.stats().inFlight).toBe(0);
  });

  it("9. no refusal stores an entry", async () => {
    const board = durableBoardFixture();
    const h = await readHarness({ board });
    const key = (index: number) => ({ "dev.sirkit/idempotencyKey": `refusal-key-${String(index).padStart(4, "0")}` });
    const refusals = [
      await h.call("sirkit.pcb.board-inspect", { meta: key(1) }),
      await h.call("sirkit.pcb.board-inspect", { meta: { ...key(2), ...pinOf("eng1-0000000000000000") } }),
      await h.call("sirkit.pcb.via-inspect", { meta: key(3), args: { netName: "a b" } }),
      await h.call("sirkit.project.canonical-revision-inspect", { meta: { ...key(4), "dev.sirkit/expectedRegistryDigest": "eng1-0000000000000000" } }),
    ];
    setMcpReadInvokerFactory(() => ({ invoke: async (request) => ({ status: "timeout", toolId: request.toolId, invocationId: request.invocationId, traceId: request.traceId, diagnostics: [] }) }));
    refusals.push(await h.call("sirkit.project.canonical-revision-inspect", { meta: key(5) }));
    for (const answer of refusals) expect(resultOf(answer).isError).toBe(true);
    expect(mcpReadReplayCache.stats()).toMatchObject({ entries: 0, totalChars: 0, inFlight: 0 });
    void HARNESS_T0;
  });

  it("10. S4: hostile keys and values never throw and leave the counters consistent", () => {
    const cache = new McpReadReplayCache();
    const throwing = new Proxy({}, { get() { throw new Error("getter"); } });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const identities: unknown[] = [null, undefined, 5, "x", [], {}, throwing, identity({ key: "" }), identity({ key: "k".repeat(129) }), identity({ key: "bad key!" }), identity({ tenantId: "" }), identity({ principalId: "a b" }), identity({ key: `k${String.fromCharCode(0)}xxxxxxx` })];
    for (const who of identities) {
      expect(() => cache.begin(who as McpReplayIdentity, call(), context(), T0)).not.toThrow();
      expect(cache.begin(who as McpReplayIdentity, call(), context(), T0).kind).toBe("invalid");
      expect(() => cache.store(who as McpReplayIdentity, call(), context(), result("a"), T0)).not.toThrow();
      expect(() => cache.release(who as McpReplayIdentity)).not.toThrow();
    }
    for (const what of [null, throwing, 5]) expect(() => cache.begin(identity(), what as McpReplayCall, context(), T0)).not.toThrow();
    cache.release(identity());
    for (const value of [cyclic, throwing, undefined, () => 1, BigInt(10)]) {
      expect(() => cache.store(identity(), call(), context(), value, T0)).not.toThrow();
      expect(cache.store(identity(), call(), context(), value, T0)).toBe("not_stored");
    }
    expect(cache.stats()).toMatchObject({ entries: 0, totalChars: 0, inFlight: 0 });
    consistent(cache);
  });
});
