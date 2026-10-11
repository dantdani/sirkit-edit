/**
 * [B24-D2] Memory sampling in the benchmark job (D24-29, runbook :1100; OD-212's memory half): the heapUsed and rss deltas of three
 * board workloads, by B24-D1's method - catalogued warm-ups, a fixed count of at least 20 samples per memory metric, `global.gc()`
 * before each sample, the result kept alive until it is measured - each sample correctness-checked, yielding between samples, under
 * an explicit per-case budget. The memory metrics are LATENCY_METRICS entries of the `memory` family with the unit MiB and a floor in
 * MiB (app/lib/qualification/latency-policy.ts); they go through B24-D1's ONE writer (latency-results-writer.ts, lead decision D15)
 * into SIRKIT_B24_BENCHMARK_DIR beside the latency results; this file names no write primitive. The gate is regression only, with
 * no absolute target (OD-212): a new metric has no baseline, and while the latest baseline is the declared-without-values v1 its
 * `baseline_missing` is the recorded, non-blocking BLOCKED state of lead decision D3.
 *
 * Gate: one line-start `describe.runIf` on SIRKIT_B24_BENCHMARK exactly "1" (a non-live gate, B24-B3's registry, lead decision D2),
 * set only by the benchmark-latency job's vitest step, which passes `--expose-gc` to its workers (benchmark.yml). Without the flag the
 * suite is `not exercised` and skips; prompt-to-gerber selects it through the B24 directory filter (OD-222) and runs nothing. With the
 * flag and no exposed `gc`, or the directory unset, relative or inside the repository, the block fails NOT MEASURED before any case
 * body, never skips, and writes nothing.
 *
 *  1. the positive control: `gc` reached this worker, a gc moves heapUsed, and the six memory metrics are catalogued (MiB, a floor,
 *     at least 20 samples);
 *  2. board-inspect's snapshot of each recorded ROUTED board (e2e/fixtures/blinker-route-fixture.json): one sample builds both;
 *  3. the full paged read (sirkit.pcb.board-page-inspect's builder) of each routed board, by every layer and every net, following
 *     nextCursor to the last page; one sample reads both boards whole;
 *  4. the placed golden board's snapshot, as a reference.
 *
 * Failing first on 3d5f225 with the flag set (performance-and-reliability.md part 2): the catalogue has no memory metric, so nothing
 * measures memory and the gate could only report the metrics `unmeasured` once they were catalogued. No browser heap figure is
 * claimed: the routed-board browser journey stays BLOCKED-LIVE-QUALIFICATION (LB-8). No network, provider, database or process.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PcbBoard } from "@/app/lib/pcb/types";
import { LATENCY_METRICS, latencyMetric, latencyResultsDocument } from "../latency-policy";
import { BENCHMARK_DIR_ENV, latencyEnvironment, resolveBenchmarkDirectory, writeLatencyResults } from "../latency-results-writer";

const SUITE = "b24-d2-memory";
const COMMIT = process.env.GITHUB_SHA ?? "local";
const MIB = 1024 * 1024;
const METRICS = {
  routedHeap: "memory.board-inspect-routed-heap",
  routedRss: "memory.board-inspect-routed-rss",
  pagesHeap: "memory.board-pages-routed-heap",
  pagesRss: "memory.board-pages-routed-rss",
  placedHeap: "memory.board-inspect-placed-heap",
  placedRss: "memory.board-inspect-placed-rss",
} as const;
const measured: Array<{ metricId: string; samples: number[] }> = [];
const clamped: Record<string, number> = {};
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const collect = (): void => (globalThis as { gc?: () => void }).gc!();
/** The results the last run returned, held until it is measured (and past it, until the next run replaces them). */
const held: unknown[] = [];

/** The catalogued warm-ups, then the samples: gc, read memoryUsage, run, read it again with the result still held; a negative delta (the
 *  collector ran during the run) is recorded as 0 and counted - a regression is a larger value, so the clamp hides none. */
async function sampledMemory(heapId: string, rssId: string, run: () => unknown): Promise<void> {
  const heap = latencyMetric(heapId);
  const rss = latencyMetric(rssId);
  expect([heap.warmups, heap.samples]).toEqual([rss.warmups, rss.samples]);
  for (let index = 0; index < heap.warmups; index += 1) { collect(); held[0] = run(); await yieldToLoop(); }
  const heapSamples: number[] = [];
  const rssSamples: number[] = [];
  for (let index = 0; index < heap.samples; index += 1) {
    collect();
    const before = process.memoryUsage();
    const result = run();
    const after = process.memoryUsage();
    held[0] = result;
    for (const [id, samples, delta] of [[heapId, heapSamples, after.heapUsed - before.heapUsed], [rssId, rssSamples, after.rss - before.rss]] as const) {
      if (delta < 0) clamped[id] = (clamped[id] ?? 0) + 1;
      samples.push(Math.max(0, delta) / MIB);
    }
    await yieldToLoop();
  }
  if (heapSamples.length === 0 || rssSamples.length === 0) throw new Error(`NOT MEASURED: ${SUITE}: ${heapId} took no sample`);
  measured.push({ metricId: heapId, samples: heapSamples }, { metricId: rssId, samples: rssSamples });
}

/** The recorded ROUTED boards of the browser fixture, loaded as b18-e-via-facts loads them (padstacks bound). */
async function routedBoards(): Promise<PcbBoard[]> {
  const { ensureBoardPadstacks } = await import("@/app/lib/pcb/padstack/migrate");
  const fixture = JSON.parse(readFileSync("e2e/fixtures/blinker-route-fixture.json", "utf8")) as { entries: Record<string, { candidate: PcbBoard }> };
  const boards = Object.values(fixture.entries).map((entry) => {
    const board = JSON.parse(JSON.stringify(entry.candidate)) as PcbBoard;
    ensureBoardPadstacks(board);
    return board;
  });
  if (boards.length === 0 || boards.some((board) => board.tracks.length === 0)) throw new Error(`NOT MEASURED: ${SUITE}: the route fixture holds no routed board`);
  return boards;
}

describe.runIf(process.env.SIRKIT_B24_BENCHMARK === "1")("[B24-D2] memory sampling (benchmark-latency; SIRKIT_B24_BENCHMARK exactly \"1\", --expose-gc)", () => {
  beforeAll(() => {
    const resolved = resolveBenchmarkDirectory(process.env, process.cwd());
    if (!resolved.ok) throw new Error(`NOT MEASURED: ${SUITE}: ${BENCHMARK_DIR_ENV} ${resolved.refusal} while SIRKIT_B24_BENCHMARK is set`);
    if (typeof (globalThis as { gc?: unknown }).gc !== "function") throw new Error(`NOT MEASURED: ${SUITE}: gc is not exposed in this worker (the vitest step passes --expose-gc to its workers)`);
  });
  afterAll(() => {
    if (measured.length === 0) return;
    const written = writeLatencyResults(latencyResultsDocument({ suite: SUITE, commit: COMMIT, environment: latencyEnvironment(), metrics: measured }), process.env, process.cwd());
    console.info(`[B24-D2] ${SUITE}: ${measured.length} metrics written to ${written.path}; negative deltas recorded as 0: ${JSON.stringify(clamped)}`);
  });

  it("1. the positive control: gc reached this worker and moves heapUsed, and the six memory metrics are catalogued in MiB with a floor and at least 20 samples", { timeout: 60_000 }, async () => {
    collect();
    const before = process.memoryUsage().heapUsed;
    held[0] = Array.from({ length: 200_000 }, (_, index) => ({ index }));
    const holding = process.memoryUsage().heapUsed;
    held[0] = null;
    collect();
    const after = process.memoryUsage().heapUsed;
    expect(holding - before, "the allocation is visible").toBeGreaterThan(MIB);
    expect(holding - after, "and a gc returns it").toBeGreaterThan(MIB);
    const memory = LATENCY_METRICS.filter((entry) => entry.family === "memory");
    expect(memory.map((entry) => entry.metricId).sort()).toEqual(Object.values(METRICS).sort());
    for (const entry of memory) {
      expect(entry, entry.metricId).toMatchObject({ suite: SUITE, unit: "MiB", addedBy: "B24-D2" });
      expect(entry.samples, entry.metricId).toBeGreaterThanOrEqual(20);
      expect(entry.floor, entry.metricId).toBeGreaterThan(0);
    }
    await yieldToLoop();
  });

  it("2. board-inspect's snapshot of each recorded ROUTED board: heapUsed and rss deltas, each sample building both boards' snapshots, each over the model's result budget", { timeout: 300_000 }, async () => {
    const [{ buildAIPcbSnapshot }, { MAX_RESULT_CHARS }] = await Promise.all([import("@/app/lib/pcb/ai/snapshot"), import("@/app/lib/agent/loop")]);
    const boards = await routedBoards();
    await sampledMemory(METRICS.routedHeap, METRICS.routedRss, () => {
      const snapshots = boards.map((board) => buildAIPcbSnapshot(board));
      for (const snapshot of snapshots) expect(JSON.stringify({ ok: true, output: { snapshot } }).length).toBeGreaterThan(MAX_RESULT_CHARS);
      return snapshots;
    });
  });

  it("3. the full paged read of each routed board, by every enabled copper layer and every net, following nextCursor to the last page: each sample reads both boards whole, every page answered and the tracks of the layer pages the snapshot's", { timeout: 600_000 }, async () => {
    const [{ buildBoardPage }, { buildAIPcbSnapshot }, { getBoardStackup }] = await Promise.all([import("@/app/lib/pcb/ai/board-pages"), import("@/app/lib/pcb/ai/snapshot"), import("@/app/lib/pcb/stackup")]);
    const boards = await routedBoards();
    const plans = boards.map((board) => ({
      board,
      selectors: [
        ...getBoardStackup(board).copperLayers.filter((layer) => layer.enabled).map((layer) => ({ layer: layer.id as string })),
        ...board.nets.filter((net) => net.id !== 0).map((net) => ({ netName: net.name || `net${net.id}` })),
      ],
      tracks: buildAIPcbSnapshot(board).tracks.length,
    }));
    await sampledMemory(METRICS.pagesHeap, METRICS.pagesRss, () => {
      const pages: unknown[] = [];
      for (const plan of plans) {
        let layerTracks = 0;
        for (const selector of plan.selectors) {
          let cursor: string | null = null;
          do {
            const page = buildBoardPage(plan.board, { ...selector, ...(cursor ? { cursor } : {}) }) as { refused?: unknown; nextCursor: string | null; items: { tracks?: unknown[] } };
            expect(page.refused).toBeUndefined();
            if ("layer" in selector) layerTracks += page.items.tracks?.length ?? 0;
            pages.push(page);
            cursor = page.nextCursor;
          } while (cursor);
        }
        expect(layerTracks).toBe(plan.tracks);
      }
      return pages;
    });
  });

  it("4. the placed golden board's snapshot, as a reference: placed, not routed, and within the model's result budget", { timeout: 300_000 }, async () => {
    const [{ buildAIPcbSnapshot }, { MAX_RESULT_CHARS }, { buildAutonomousGoldenBoard }] = await Promise.all([import("@/app/lib/pcb/ai/snapshot"), import("@/app/lib/agent/loop"), import("@/app/lib/pcb/__tests__/fixtures/autonomous-golden-board")]);
    const placed = buildAutonomousGoldenBoard();
    expect(placed.tracks.length + placed.vias.length).toBe(0);
    await sampledMemory(METRICS.placedHeap, METRICS.placedRss, () => {
      const snapshot = buildAIPcbSnapshot(placed);
      expect(JSON.stringify({ ok: true, output: { snapshot } }).length).toBeLessThan(MAX_RESULT_CHARS);
      return snapshot;
    });
  });
});
