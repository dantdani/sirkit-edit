/**
 * [B24-D1] The latency benchmark (D24-27, runbook :1094-1097; OD-212): the four runbook measurement families and the moved
 * performance bounds, each a correctness-checked workload with fixed warm-ups and samples (app/lib/qualification/latency-policy.ts),
 * timed with performance.now() only, yielding between samples, under an explicit per-case budget. The results go through the ONE
 * writer (latency-results-writer.ts, lead decision D15) to SIRKIT_B24_BENCHMARK_DIR; this file names no write primitive.
 *
 * Gate: one line-start `describe.runIf` on SIRKIT_B24_BENCHMARK exactly "1" (a non-live gate, B24-B3's registry, lead decision D2),
 * set only by the benchmark-latency job's vitest step (benchmark.yml). Without the flag the suite is `not exercised` and skips;
 * prompt-to-gerber selects it through the B24 directory filter (OD-222) and runs nothing. With the flag and the directory unset,
 * relative or inside the repository, the block fails NOT MEASURED before any case body (the writer's refusal), never skips, and
 * writes nothing. Every import of a route, a bus or a harness sits inside the gated block, so a skipped run loads none.
 *
 *  1. view: pcb.fit-board and pcb.pan-to through the view-session bus (createViewCommand, pcbCommands) on a recorded ROUTED board
 *     (e2e/fixtures/blinker-route-fixture.json, read as b18-e-board-inspect-budget reads it); 20 warm-ups, 200 samples each;
 *  2. read: sirkit.selection.inspect and sirkit.pcb.via-inspect through the real gateway over the activated read bindings
 *     (resolveReadBinding resolves both) on the same board; 20 and 200;
 *  3. edit: one granted reversible edit ("Move R3 2 mm to the right." under execute_explicit_tier1 through the B18-C harness):
 *     exactly one committed transaction (headSequence +1), settled; 3 and 30; the composition is untimed set-up;
 *  4. stream: POST /api/chat with a fake provider delayed by STREAM_PROVIDER_DELAY_MS (B18-D's adapter seam, C1's in-memory trace
 *     store, A3's window reset through its seam): the first NDJSON line (run_started), the silent gap - the longest interval between
 *     two consecutive lines, about the delay: the warning lines follow run_started at once and nothing is sent during a provider
 *     wait, D24-27's second half - and the completion; exactly one terminal event; 5 and 50;
 *  5. the moved bounds of b20-a4-observation-normalizer case 6 (four workloads, their correctness assertions kept); 1 and 10 each;
 *  6. the moved bounds of pcb-sync performance-resilience (two workloads, their correctness assertions kept); 1 and 10 each;
 *  7. [B24-D1 review, 2026-10-09] the moved bound of b20-a1-redaction-linear (200 scrubs of a 4,000-character leaf; the scrubbed output
 *     kept), found once the census followed a helper-returned timing; 1 and 10.
 *
 * Failing first on 6acae24 with the flag and the directory set outside the repository: the policy and the writer are absent
 * (performance-and-reliability.md section 8). No real network, provider, model, database or process: every provider is the fake
 * adapter, the router a recording, the stores in memory.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { McpPostResult } from "@/app/lib/mcp/http-transport";
import type { McpAcceptedTool } from "@/app/lib/mcp/foreign-tools";
import type { McpObservationInput, McpObservationRecord } from "@/app/lib/mcp/observation";
import type { McpToolListing } from "@/app/lib/mcp/tool-discovery";
import { quantile } from "@/app/lib/benchmark/statistics";
import { STREAM_PROVIDER_DELAY_MS, latencyMetric, latencyResultsDocument } from "../latency-policy";
import { BENCHMARK_DIR_ENV, latencyEnvironment, resolveBenchmarkDirectory, writeLatencyResults } from "../latency-results-writer";

// ── the stream seam (B18-D's): the provider's first answer, delayed by a fixed D; nothing else is faked in the route ─────────
const stream = vi.hoisted(() => ({ delayMs: 250, starts: 0 }));
vi.mock("@/app/lib/agent/adapters", () => ({
  agentAdapterFor: () => ({
    provider: "openai",
    async start() {
      stream.starts += 1;
      await new Promise((resolve) => setTimeout(resolve, stream.delayMs));
      return { text: "ok", toolCalls: [], stopReason: "completed", usage: { inputTokens: 1, outputTokens: 1 }, model: "fake", continuation: { provider: "openai", state: null } };
    },
    async continueWith() { throw new Error("not used: the fake answers in one step"); },
  }),
}));

const SUITE = "b24-d1-latency";
const COMMIT = process.env.GITHUB_SHA ?? "local";
const T0 = "2026-09-09T12:00:00.000Z";
const IDENTITY = { sessionId: "vs-b24-d1", projectId: "p24d1", branchId: "main", editor: "pcb" as const };
const HUMAN = { actorId: "u-d1", role: "pcb_editor" as const, actorKind: "human" as const };
const OBSERVED = { centerNm: { x: 20_000_000, y: 15_000_000 }, pxPerMm: 10, viewportPx: { width: 800, height: 600 } };
const SCOPE = { tenantId: "local", projectId: "p24d1", branchId: "main" };
const SCHEMATIC = { components: [{ id: "r1", type: "resistor", x: 100, y: 100, rotation: 0, value: "10k" }], wires: [] };
const SELECTION = "sirkit.selection.inspect";
const VIAS = "sirkit.pcb.via-inspect";
const measured: Array<{ metricId: string; samples: number[] }> = [];
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** The catalogued warm-ups, then the samples, yielding between runs; each run returns its timed milliseconds and asserts its correctness. */
async function sampled(metricId: string, run: () => Promise<number>): Promise<number[]> {
  const metric = latencyMetric(metricId);
  for (let index = 0; index < metric.warmups; index += 1) { await run(); await yieldToLoop(); }
  const samples: number[] = [];
  for (let index = 0; index < metric.samples; index += 1) { samples.push(await run()); await yieldToLoop(); }
  measured.push({ metricId, samples });
  return samples;
}
/** The first recorded ROUTED board of the browser fixture, as b18-e-board-inspect-budget and b18-e-via-facts read it. */
async function routedBoard(): Promise<PcbBoard> {
  const { ensureBoardPadstacks } = await import("@/app/lib/pcb/padstack/migrate");
  const fixture = JSON.parse(readFileSync("e2e/fixtures/blinker-route-fixture.json", "utf8")) as { entries: Record<string, { candidate: PcbBoard }> };
  const [first] = Object.values(fixture.entries);
  if (!first) throw new Error("the route fixture holds no entry");
  const board = JSON.parse(JSON.stringify(first.candidate)) as PcbBoard;
  ensureBoardPadstacks(board);
  expect(board.tracks.length).toBeGreaterThan(0);
  return board;
}

describe.runIf(process.env.SIRKIT_B24_BENCHMARK === "1")("[B24-D1] the latency benchmark (benchmark-latency; SIRKIT_B24_BENCHMARK exactly \"1\")", () => {
  beforeAll(() => {
    const resolved = resolveBenchmarkDirectory(process.env, process.cwd());
    if (!resolved.ok) throw new Error(`NOT MEASURED: ${SUITE}: ${BENCHMARK_DIR_ENV} ${resolved.refusal} while SIRKIT_B24_BENCHMARK is set`);
  });
  afterAll(() => {
    const written = writeLatencyResults(latencyResultsDocument({ suite: SUITE, commit: COMMIT, environment: latencyEnvironment(), metrics: measured }), process.env, process.cwd());
    console.info(`[B24-D1] ${SUITE}: ${measured.length} metrics written to ${written.path}`);
  });

  it("1. view: pcb.fit-board and pcb.pan-to a component through the view-session bus on the recorded ROUTED board, each settled with the camera it asked for", { timeout: 120_000 }, async () => {
    const [{ ViewSessionBus, createViewCommand }, { pcbCommands, pcbInitialState, pcbViewProbe }] = await Promise.all([import("@/app/lib/view-session/bus"), import("@/app/lib/view-session/pcb")]);
    const board = await routedBoard();
    type State = ReturnType<typeof pcbInitialState>;
    const bus = new ViewSessionBus<State>({ identity: IDENTITY, initialState: pcbInitialState(), commands: pcbCommands(() => pcbViewProbe({ board, drc: null, routingFailures: null })), clock: () => T0 });
    let revision = 0;
    const dispatch = async (commandId: string, payload: unknown): Promise<{ state: State }> => {
      const result = await bus.dispatch(createViewCommand({ identity: IDENTITY, commandId, payload, actor: HUMAN, expectedViewRevision: revision, issuedAt: T0 }));
      if (result.status !== "settled") throw new Error(`${commandId}: ${JSON.stringify(result)}`);
      revision = result.viewRevision;
      return result as unknown as { state: State };
    };
    await dispatch("pcb.observe", { camera: OBSERVED });
    await sampled("view.pcb-fit-board", async () => {
      const started = performance.now();
      const result = await dispatch("pcb.fit-board", null);
      const elapsed = performance.now() - started;
      expect(result.state.camera.kind).toBe("board");
      return elapsed;
    });
    const refs = board.footprints.map((footprint) => footprint.ref);
    const probe = pcbViewProbe({ board, drc: null, routingFailures: null });
    let turn = 0;
    await sampled("view.pcb-pan-to-component", async () => {
      const ref = refs[turn % refs.length]!;
      turn += 1;
      const footprint = board.footprints.find((candidate) => candidate.ref === ref)!;
      const bounds = probe.boundsNm([{ kind: "footprint", id: footprint.id }])!;
      const started = performance.now();
      const result = await dispatch("pcb.pan-to", { target: { kind: "component", ref } });
      const elapsed = performance.now() - started;
      // the pan centres on the component's bounds (pcb.ts `center`), not on its anchor
      expect(result.state.camera.centerNm).toEqual({ x: Math.round((bounds.minX + bounds.maxX) / 2), y: Math.round((bounds.minY + bounds.maxY) / 2) });
      return elapsed;
    });
  });

  it("2. read: sirkit.selection.inspect and sirkit.pcb.via-inspect through the real gateway over the activated read bindings on the ROUTED board, each answering the item or the net it was asked for", { timeout: 120_000 }, async () => {
    const [{ sirkitToolRegistry }, { createAgentToolGateway }, { assembleAgentRunContext }, { buildViaSnapshot }, { resolveReadBinding }] = await Promise.all([import("@/app/lib/engineering/tool-catalog"), import("@/app/lib/agent/gateway"), import("@/app/lib/agent/context"), import("@/app/lib/pcb/ai/vias"), import("@/app/lib/engineering/tool-bindings-readonly")]);
    const board = await routedBoard();
    const registry = sirkitToolRegistry();
    const descriptor = (toolId: string) => registry.list().find((candidate) => candidate.toolId === toolId)!;
    for (const toolId of [SELECTION, VIAS]) expect(resolveReadBinding(descriptor(toolId)).state, toolId).toBe("resolved");
    const first = board.footprints[0]!;
    const assembly = assembleAgentRunContext({ ...SCOPE, board, selection: { refs: [{ kind: "footprint", id: first.id }], primary: { kind: "footprint", id: first.id } } });
    if (!assembly.ok) throw new Error(assembly.reason);
    const gateway = createAgentToolGateway(registry, { now: () => 4_000_000 });
    const netName = buildViaSnapshot(board).netsWithVias[0]!.name;
    let runs = 0;
    const invoke = async (toolId: string, args: Record<string, unknown>) => {
      runs += 1;
      return gateway.invoke({ runId: `run-d1-read-${runs}`, provider: "anthropic", toolId, version: descriptor(toolId).version, args, context: assembly.context, timeoutMs: 5_000 });
    };
    await sampled("read.selection-inspect", async () => {
      const started = performance.now();
      const outcome = await invoke(SELECTION, {});
      const elapsed = performance.now() - started;
      expect(outcome.ok, JSON.stringify(outcome).slice(0, 300)).toBe(true);
      expect((outcome as unknown as { output: { items: Array<{ kind: string; id: string }> } }).output.items).toEqual([{ kind: "footprint", id: first.id, ref: first.ref, x: first.at.x, y: first.at.y, side: first.side, units: "nm" }]);
      return elapsed;
    });
    await sampled("read.via-inspect", async () => {
      const started = performance.now();
      const outcome = await invoke(VIAS, { netName });
      const elapsed = performance.now() - started;
      expect(outcome.ok, JSON.stringify(outcome).slice(0, 300)).toBe(true);
      const answered = (outcome as unknown as { output: { vias: { net: { name: string } | null; vias: unknown[] } } }).output.vias;
      expect(answered.net).toMatchObject({ name: netName });
      expect(answered.vias.length).toBeGreaterThan(0);
      return elapsed;
    });
  });

  it("3. edit: one granted reversible edit through the B18-C harness under execute_explicit_tier1 - the chat run, the minted grant, the ritual and the settlement - exactly one committed transaction (headSequence +1) and R3 moved 2 mm", { timeout: 300_000 }, async () => {
    const [harness, { mmToNm }] = await Promise.all([import("@/app/lib/engineering/__tests__/b18c-harness"), import("@/app/lib/pcb/units")]);
    expect(harness.MESSAGE).toBe("Move R3 2 mm to the right.");
    await sampled("edit.granted-move-footprint", async () => {
      const c = await harness.composition("execute_explicit_tier1");
      const before = harness.headOf(c).headSequence;
      const x0 = harness.r3Of(c).at.x;
      const started = performance.now();
      const run = await harness.runScenario(c, (move) => [() => ({ toolCalls: [harness.call("c1", move, harness.movesBy(c, 2))] }), () => ({ text: "done" })]);
      const elapsed = performance.now() - started;
      expect(run.result.status).toBe("completed");
      expect(run.grants).toHaveLength(1);
      expect(run.rituals, JSON.stringify(run.rituals)).toHaveLength(1);
      expect(run.rituals[0]).toMatchObject({ ok: true, status: "committed" });
      expect(harness.headOf(c).headSequence).toBe(before + 1);
      expect(harness.r3Of(c).at.x).toBe(x0 + mmToNm(2));
      return elapsed;
    });
  });

  it("4. stream: POST /api/chat with the fake provider delayed by 250 ms - the first NDJSON line (run_started), the silent gap (the longest interval between two consecutive lines, about the delay: nothing is sent during a provider wait) and the completion; exactly one terminal event per sample", { timeout: 300_000 }, async () => {
    const [{ POST }, limits, traceRuntime, { InMemoryDurableWorkflowRepository }, { DurableRunTraceStore }] = await Promise.all([import("@/app/api/chat/route"), import("@/app/lib/auth/abuse-limits"), import("@/app/api/chat/trace-runtime"), import("@/app/lib/durable-workflow/repository"), import("@/app/lib/observability/run-trace-store")]);
    expect(stream.delayMs).toBe(STREAM_PROVIDER_DELAY_MS);
    traceRuntime.setRunTraceStoreFactory(() => new DurableRunTraceStore(new InMemoryDurableWorkflowRepository()));
    try {
      const run = async (): Promise<{ firstEvent: number; gap: number; completion: number }> => {
        limits.resetAbuseLimitsForTests();
        const started = performance.now();
        const response = await POST(new Request("http://localhost/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "openai", messages: [{ role: "user", content: "hello" }], scope: SCOPE, schematicState: SCHEMATIC }) }));
        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("application/x-ndjson");
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        const lineTimes: number[] = [];
        const events: Array<{ type: string }> = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          let at = buffered.indexOf(String.fromCharCode(10));
          while (at >= 0) {
            const line = buffered.slice(0, at);
            buffered = buffered.slice(at + 1);
            lineTimes.push(performance.now());
            events.push(JSON.parse(line) as { type: string });
            at = buffered.indexOf(String.fromCharCode(10));
          }
        }
        expect(events[0]).toMatchObject({ type: "run_started" });
        const terminal = events.filter((event) => event.type === "run_completed" || event.type === "run_failed");
        expect(terminal, JSON.stringify(events.map((event) => event.type))).toHaveLength(1);
        expect(terminal[0]!.type).toBe("run_completed");
        expect(events[events.length - 1]!.type).toBe("run_completed");
        await traceRuntime.drainRunTraceWrites();
        if (sequences.length === 0) sequences.push(events.map((event) => event.type));
        // the silent gap: the longest interval between two consecutive lines - the provider wait, during which nothing is sent
        const gap = Math.max(...lineTimes.slice(1).map((at, index) => at - lineTimes[index]!));
        return { firstEvent: lineTimes[0]! - started, gap, completion: lineTimes[lineTimes.length - 1]! - started };
      };
      const sequences: string[][] = [];
      const metric = latencyMetric("stream.first-event-ms");
      expect([latencyMetric("stream.silent-gap-ms"), latencyMetric("stream.completion-ms")].map((entry) => [entry.warmups, entry.samples])).toEqual([[metric.warmups, metric.samples], [metric.warmups, metric.samples]]);
      for (let index = 0; index < metric.warmups; index += 1) { await run(); await yieldToLoop(); }
      console.info(`[B24-D1] stream: the NDJSON line sequence of one run: ${JSON.stringify(sequences[0])}`);
      const firstEvents: number[] = [];
      const gaps: number[] = [];
      const completions: number[] = [];
      for (let index = 0; index < metric.samples; index += 1) {
        const sample = await run();
        firstEvents.push(sample.firstEvent);
        gaps.push(sample.gap);
        completions.push(sample.completion);
        await yieldToLoop();
      }
      measured.push({ metricId: "stream.first-event-ms", samples: firstEvents }, { metricId: "stream.silent-gap-ms", samples: gaps }, { metricId: "stream.completion-ms", samples: completions });
      expect(stream.starts).toBe(metric.warmups + metric.samples);
      // D24-27's second half, measured and stated: the gap after run_started is the provider wait itself - no keepalive fills it
      expect(quantile(gaps, 0.5)!).toBeGreaterThanOrEqual(STREAM_PROVIDER_DELAY_MS - 25);
      expect(quantile(firstEvents, 0.5)!).toBeLessThan(quantile(gaps, 0.5)!);
    } finally {
      traceRuntime.resetRunTraceStoreFactory();
      limits.resetAbuseLimitsForTests();
    }
  });

  it("5. the moved bounds of b20-a4-observation-normalizer case 6: a 5,000,000-character block, 100,000 blocks, 16 blocks of ill-ordered marks and 1,998 structured leaves past the budget, each observed with its correctness assertions kept", { timeout: 300_000 }, async () => {
    const [{ acceptForeignTools }, { discoverMcpServer }, { normalizeMcpToolResult, mcpObservationArgumentsDigest }, fake, { T0: MCP_T0 }, { resetAdmissionControl }, { resetMcpInFlight }, { resetMcpToolCache }] = await Promise.all([
      import("@/app/lib/mcp/foreign-tools"), import("@/app/lib/mcp/negotiation"), import("@/app/lib/mcp/observation"), import("@/app/lib/mcp/__tests__/_fake-mcp-server"), import("@/app/lib/mcp/__tests__/_fixtures"), import("@/app/lib/acquisition/admission-control"), import("@/app/lib/mcp/http-transport"), import("@/app/lib/mcp/tool-discovery"),
    ]);
    resetAdmissionControl();
    resetMcpInFlight();
    resetMcpToolCache();
    const negotiated = await discoverMcpServer(fake.server, { purpose: "interactive", deps: fake.depsOf(fake.fakeMcpServer(fake.byMethod({}))) });
    if (negotiated.kind !== "negotiated") throw new Error(`fixture negotiation failed: ${negotiated.kind}`);
    const set = acceptForeignTools(fake.server, [fake.tool("search"), fake.tool("bulk", { outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "string" } } }, required: ["items"], additionalProperties: false } })]);
    const byName = (name: string): McpAcceptedTool => {
      const found = set.accepted.find((entry) => entry.name === name);
      if (!found) throw new Error(`fixture tool ${name} was not accepted: ${JSON.stringify(set.excluded)}`);
      return found;
    };
    const plain = byName("search");
    const listTool = byName("bulk");
    const listing: McpToolListing = { ok: true, kind: "tools", serverId: fake.server.id, negotiatedVersion: negotiated.negotiatedVersion, tools: set.accepted, excluded: [], digest: `sha256:${"a".repeat(64)}`, pinned: true, ttlMs: 0, cacheScope: "private", pages: 1, considered: set.accepted.length, notRead: 0, truncated: false, cached: false, exchanges: [] };
    const complete = (result: Record<string, unknown>): McpPostResult => ({ serverId: fake.server.id, protocolVersion: "2026-07-28", method: "tools/call", elapsedMs: 3, requestBytes: 120, responseBytes: 480, ok: true, kind: "complete", result: { resultType: "complete", ...result } as never, notifications: [], notificationsDropped: 0 } as McpPostResult);
    const argumentsDigest = mcpObservationArgumentsDigest({ mpn: "LM358DR" })!;
    const observe = (result: Record<string, unknown>, overrides: Partial<McpObservationInput> = {}): McpObservationRecord => {
      const outcome = normalizeMcpToolResult({ server: fake.server, negotiated, listing, tool: plain, outcome: complete(result), argumentsDigest, clock: () => MCP_T0, subjects: [], ...overrides });
      if (!outcome.ok) throw new Error(`refused: ${outcome.code}`);
      return outcome.observation;
    };
    const text = (value: unknown): Record<string, unknown> => ({ type: "text", text: value });
    const BENIGN = "LM358DR: dual operational amplifier, SOIC-8, in stock.";
    const tail = ["tail", "sentinel", "d1"].join("-");
    const big = `${"a".repeat(5_000_000 - tail.length)}${tail}`;
    await sampled("moved.observation-normalizer-huge-text", async () => {
      const started = performance.now();
      const huge = observe({ content: [text(big)] });
      const elapsed = performance.now() - started;
      expect(huge.content.blocks[0]).toMatchObject({ rawChars: 5_000_000, disposition: "text" });
      expect(JSON.stringify(huge)).not.toContain(tail);
      return elapsed;
    });
    const many = Array.from({ length: 100_000 }, () => text(BENIGN));
    await sampled("moved.observation-normalizer-many-blocks", async () => {
      const started = performance.now();
      const counted = observe({ content: many });
      const elapsed = performance.now() - started;
      expect(counted.content).toMatchObject({ blocksRead: 16, blocksNotRead: 99_984 });
      expect(counted.content.blocks).toHaveLength(1);
      expect(counted.content.blocks[0]!.repeats).toBe(16);
      return elapsed;
    });
    const marks = `a${`${fake.COMBINING_ACUTE}${String.fromCharCode(0x316)}`.repeat(4_500)}`;
    const pathologicalBlocks = Array.from({ length: 16 }, (_unused, index) => text(`${index}${marks}`));
    await sampled("moved.observation-normalizer-pathological-marks", async () => {
      const started = performance.now();
      const pathological = observe({ content: pathologicalBlocks });
      const elapsed = performance.now() - started;
      expect(pathological.content.blocksRead).toBe(16);
      return elapsed;
    });
    const leaves = Array.from({ length: 1_998 }, (_unused, index) => `${index}${fake.COMBINING_ACUTE.repeat(3_000)}`);
    await sampled("moved.observation-normalizer-structured-budget", async () => {
      const started = performance.now();
      const budget = observe({ content: [], structuredContent: { items: leaves } }, { tool: listTool });
      const elapsed = performance.now() - started;
      expect(budget.structured.state).toBe("withheld_budget");
      return elapsed;
    });
  });

  it("6. the moved bounds of pcb-sync performance-resilience: the small exact new-board preflight over the ready harness (ready_to_apply) and the 500-component blocked aggregate (two batches, every component blocked, no board), their correctness assertions kept", { timeout: 300_000 }, async () => {
    const [{ FootprintResolutionService }, { InMemoryPhysicalBindingRepository }, { InMemoryPcbSyncSnapshotProvider }, { InMemoryPcbSyncRepository }, { PcbSynchronizationService }, { authoritativeSnapshotDigest }, fixtures] = await Promise.all([
      import("@/app/lib/footprint-resolver/service"), import("@/app/lib/physical-binding/repository"), import("@/app/lib/pcb-sync/providers"), import("@/app/lib/pcb-sync/repository"), import("@/app/lib/pcb-sync/service"), import("@/app/lib/pcb-sync/stable"), import("@/app/lib/pcb-sync/__tests__/fixtures"),
    ]);
    await sampled("moved.pcb-sync-preflight-small-fixture", async () => {
      const harness = await fixtures.readyHarness();
      const started = performance.now();
      const result = await harness.service.preflight(fixtures.preflightRequest());
      const elapsed = performance.now() - started;
      expect(result.status).toBe("ready_to_apply");
      return elapsed;
    });
    const ids = Array.from({ length: 500 }, (_, index) => `generic-component-${String(index).padStart(4, "0")}`);
    const large = fixtures.snapshot(ids);
    for (const [index, component] of large.components.entries()) {
      component.referenceDesignator = `C${index + 1}`;
      component.value = "100n";
    }
    const { snapshotDigest: _digest, ...base } = large;
    void _digest;
    large.snapshotDigest = authoritativeSnapshotDigest(base);
    await sampled("moved.pcb-sync-aggregate-500-components", async () => {
      const repository = new InMemoryPcbSyncRepository();
      const rawResolver = new FootprintResolutionService(new InMemoryPhysicalBindingRepository());
      const batchSizes: number[] = [];
      const service = new PcbSynchronizationService({ snapshotProvider: new InMemoryPcbSyncSnapshotProvider([large]), resolver: { async resolveBatch(batch, signal) { batchSizes.push(batch.requests.length); return rawResolver.resolveBatch(batch, signal); } }, resourceProvider: { async materialize() { return null; } }, repository });
      const started = performance.now();
      const result = await service.preflight(fixtures.preflightRequest({ requestId: "large-blocked" }));
      const elapsed = performance.now() - started;
      expect(result.status).toBe("blocked_component_resolution");
      expect(result.components).toHaveLength(500);
      expect(batchSizes.sort((a, b) => a - b)).toEqual([244, 256]);
      expect(result.components.every((item) => item.status === "blocked_unresolved_footprint")).toBe(true);
      expect(await repository.getBoard({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" })).toBeNull();
      return elapsed;
    });
  });

  it("7. the moved bound of b20-a1-redaction-linear (the URL-credential pattern: linear time, case 1): 200 scrubVendorText scrubs of a 4,000-character 'a.' leaf with a word boundary at every letter, the scrubbed output asserted", { timeout: 120_000 }, async () => { // [B24-D1 review, 2026-10-09] found by the census once it followed a helper-returned timing (OD-212)
    const { scrubVendorText } = await import("@/app/lib/mcp/http-transport");
    const leaf = "a.".repeat(2_000);
    const expected = leaf.slice(0, 1_000);
    expect(scrubVendorText(leaf, 1_000)).toBe(expected);
    await sampled("moved.redaction-linear-200-scrubs", async () => {
      let last = "";
      const started = performance.now();
      for (let index = 0; index < 200; index += 1) last = scrubVendorText(leaf, 1_000);
      const elapsed = performance.now() - started;
      expect(last).toBe(expected);
      return elapsed;
    });
  });
});
