/**
 * [B24-D1] The complex verified workflow on recordings (D24-27, runbook :1096; OD-212): publish, preflight, apply and
 * POST /api/pcb/qualify on the committed recorded router, timed with performance.now() after the untimed acceptance steps 1-4
 * (build-multi, layout, every binding requested and approved), each sample on FRESH repositories, a restarted fixture clock and UUID
 * counter, and verified against the pinned release identities (fixtures/expected-identities.json; routerExecutions 2). The seams are
 * copies of app/lib/workflow/prompt-to-gerber/__tests__/acceptance-pipeline.test.ts:31-86 that expose a reset (vi.mock is
 * file-scoped, and the originals build one repository per file); the acceptance suite stays untouched. 1 warm-up, 10 samples.
 *
 * Gate: one line-start `describe.runIf` on SIRKIT_B24_BENCHMARK exactly "1" (a non-live gate, B24-B3's registry, lead decision D2),
 * set only by the benchmark-latency job's vitest step. Without the flag the suite is `not exercised` and skips; with the flag and the
 * directory unset, relative or inside the repository, the block fails NOT MEASURED before any case body and writes nothing. It refuses
 * to run when SIRKIT_B16_1C_RECORD_ROUTES or SIRKIT_B16_1C_LIVE_ROUTER is "1": replay only, no Java, no real router (LB-3). The route
 * handlers are imported inside the gated block. The results go through the one writer; this file names no write primitive.
 *
 * Failing first on 6acae24 with the flag and the directory set outside the repository: the policy and the writer are absent
 * (performance-and-reliability.md section 8).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";
import { latencyMetric, latencyResultsDocument } from "../latency-policy";
import { BENCHMARK_DIR_ENV, latencyEnvironment, resolveBenchmarkDirectory, writeLatencyResults } from "../latency-results-writer";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "workflow", "prompt-to-gerber", "__tests__", "fixtures");
const ROUTE_FIXTURE_PATH = join(FIXTURES, "blinker-route-fixture.json");

// ── the seams, copied from the acceptance suite with a reset: the two in-memory stores are ONE instance each for the file, as the
// originals are (app/api/pcb-sync/route.ts:20 and :27 and app/api/physical-bindings/route.ts:21 resolve them once at module load,
// so a replaced object would split publish/apply from qualify), and each sample empties them in place; the recorded router replayed
const seams = vi.hoisted(() => ({
  observedRoutes: [] as string[],
  durable: null as null | import("@/app/lib/durable-workflow/repository").InMemoryDurableWorkflowRepository,
  shared: null as null | import("@/app/lib/physical-binding/repository").InMemoryPhysicalBindingRepository,
}));
vi.mock("@/app/lib/durable-workflow/runtime", async () => {
  const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
  seams.durable ??= new InMemoryDurableWorkflowRepository();
  return { getDurableWorkflowRepository: () => seams.durable! };
});
vi.mock("@/app/lib/physical-binding/server-repository", async (orig) => {
  const actual = await orig() as object;
  const { InMemoryPhysicalBindingRepository } = await import("@/app/lib/physical-binding/repository");
  // ONE shared store: the physical-bindings route and the pcb-sync/qualify routes each construct their own repository object in
  // production over the same Postgres; here both constructions resolve to the same in-memory store.
  seams.shared ??= new InMemoryPhysicalBindingRepository();
  class SharedInMemoryPhysicalBindingRepository { constructor() { return seams.shared!; } }
  return { ...actual, PostgresPhysicalBindingRepository: SharedInMemoryPhysicalBindingRepository };
});
/** Empty both in-memory stores in place (their private maps, test-only): the next sample starts from no board, no binding, no replay. */
function resetStores(): void {
  const durable = seams.durable as unknown as Record<"records" | "byId" | "replays" | "events", Map<unknown, unknown>>;
  for (const field of ["records", "byId", "replays", "events"] as const) durable[field].clear();
  const shared = seams.shared as unknown as Record<"states" | "commits", Map<unknown, unknown>>;
  for (const field of ["states", "commits"] as const) shared[field].clear();
  seams.observedRoutes.length = 0;
}
vi.mock("@/app/lib/atomic/server-catalog", async () => {
  const { blinkerCatalog } = await import("@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-catalog");
  const load = async (revisionId: string) => structuredClone(blinkerCatalog().snapshots.get(revisionId) ?? null);
  const loadAtomicRevisionStatus = async (ids: readonly string[]) => new Map(ids.flatMap((id) => { const snapshot = blinkerCatalog().snapshots.get(id); return snapshot ? [[id, { revisionId: id, logicalPartId: snapshot.atomicRevision.logicalPartId, state: "published", selectable: true, pinnable: true }] as const] : []; }));
  return { loadPublishedPortableSnapshot: load, loadSelectablePortableSnapshot: load, loadAtomicRevisionStatus };
});
vi.mock("@/app/lib/llm/router", async (orig) => {
  const actual = await orig() as object;
  return { ...actual, llmRouter: { generate: async () => ({ provider: "anthropic", model: "fake-provider", text: "", toolCalls: [] }), stream: () => { throw new Error("fake provider has no stream"); } } };
});
vi.mock("@/app/lib/build-loop", async (orig) => {
  const actual = await orig() as object;
  const { BLINKER_NETLIST } = await import("@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-catalog");
  return { ...actual, runBuildToolLoop: async () => ({ ok: true, netlist: structuredClone(BLINKER_NETLIST), explanation: BLINKER_NETLIST.explanation }) };
});
vi.mock("@/app/lib/parts-search", async (orig) => ({ ...(await orig() as object), getPartsByIds: async () => [] }));
vi.mock("@/app/lib/pcb/autonomous/production-router", async () => {
  const fixtures = await import("@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/route-fixture");
  return {
    createAutonomousRouteExecutor: async () => {
      if (fixtures.recordingRequested() || fixtures.liveRouterRequested()) throw new Error("NOT MEASURED: b24-d1-latency-workflow replays the committed recording only (no recording, no live router)");
      const fixture = fixtures.loadRouteFixture(ROUTE_FIXTURE_PATH);
      if (!fixture) throw new Error(`ROUTE_FIXTURE_MISSING:${ROUTE_FIXTURE_PATH}`);
      return fixtures.replayRouteExecutor(fixture, seams.observedRoutes);
    },
  };
});

const SUITE = "b24-d1-latency-workflow";
const METRIC = "workflow.publish-preflight-apply-qualify-ms";
const COMMIT = process.env.GITHUB_SHA ?? "local";
const measured: Array<{ metricId: string; samples: number[] }> = [];
const yieldToLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe.runIf(process.env.SIRKIT_B24_BENCHMARK === "1")("[B24-D1] the verified workflow on recordings (benchmark-latency; SIRKIT_B24_BENCHMARK exactly \"1\")", () => {
  beforeAll(() => {
    const resolved = resolveBenchmarkDirectory(process.env, process.cwd());
    if (!resolved.ok) throw new Error(`NOT MEASURED: ${SUITE}: ${BENCHMARK_DIR_ENV} ${resolved.refusal} while SIRKIT_B24_BENCHMARK is set`);
    if (process.env.SIRKIT_B16_1C_RECORD_ROUTES === "1" || process.env.SIRKIT_B16_1C_LIVE_ROUTER === "1") throw new Error(`NOT MEASURED: ${SUITE} replays the committed recording only; unset SIRKIT_B16_1C_RECORD_ROUTES and SIRKIT_B16_1C_LIVE_ROUTER`);
  });
  afterAll(() => {
    const written = writeLatencyResults(latencyResultsDocument({ suite: SUITE, commit: COMMIT, environment: latencyEnvironment(), metrics: measured }), process.env, process.cwd());
    console.info(`[B24-D1] ${SUITE}: ${measured.length} metrics written to ${written.path}`);
  });

  it("1. publish, preflight, apply and qualify on the recorded router, after the untimed steps 1-4 on fresh repositories: each sample answers 200, idempotent false, rc02.remainingConnections 0, and the pinned identities exactly (routerExecutions 2)", { timeout: 600_000 }, async () => {
    const [routes, harness, catalog, { loadExpectedIdentities }] = await Promise.all([
      (async () => ({
        buildMulti: (await import("@/app/api/schematic/build-multi/route")).POST,
        physicalBindings: (await import("@/app/api/physical-bindings/route")).POST,
        pcbSyncPost: (await import("@/app/api/pcb-sync/route")).POST,
        qualify: (await import("@/app/api/pcb/qualify/route")).POST,
      }))(),
      import("@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/harness"),
      import("@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-catalog"),
      import("@/app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities"),
    ]);
    const pinned = loadExpectedIdentities();
    if (!pinned) throw new Error("EXPECTED_IDENTITIES_MISSING: record the fixtures with the acceptance suite first");
    expect(pinned.qualification.routerExecutions).toBe(2);
    const metric = latencyMetric(METRIC);

    const sample = async (): Promise<number> => {
      // fresh seams: both stores emptied, the recorded-router observations, the fixture clock and the UUID counter (restarted at 0), stage 3 opt-in
      resetStores();
      const restore = [harness.freezeClock(), harness.deterministicUuids()];
      vi.stubEnv("SIRKIT_PCB_SYNC_STAGE3", "opt_in");
      try {
        // untimed: the acceptance steps 1-4
        harness.signInAs("editor");
        const built = await routes.buildMulti(harness.jsonRequest("/api/schematic/build-multi", { prompt: catalog.BLINKER_ACCEPTANCE_PROMPT }));
        const proposal = await harness.readJson<{ ok: boolean; netlist: BuildLogicalNetlist }>(built);
        expect(built.status).toBe(200);
        const schematic = harness.layoutProposal(proposal.netlist, catalog.blinkerCatalog().cachedParts);
        expect(schematic.validationOk, schematic.violations.join(" | ")).toBe(true);
        const instances = schematic.state.kicadComponents ?? [];
        expect(instances).toHaveLength(9);
        const requestIds = new Map<string, string>();
        for (const instance of instances) {
          const response = await routes.physicalBindings(harness.jsonRequest("/api/physical-bindings", { operation: "request_atomic_review", componentInstanceId: instance.id, boardInstanceId: harness.BOARD_ID, atomicPartRevisionId: instance.atomicPartRevisionId, reason: `B24-D1 blinker: ${instance.refDes}` }));
          const body = await harness.readJson<{ request: { requestId: string; status: string } }>(response);
          expect(response.status, `${instance.refDes}: ${JSON.stringify(body).slice(0, 300)}`).toBe(201);
          requestIds.set(instance.id, body.request.requestId);
        }
        harness.signInAs("reviewer");
        for (const instance of instances) {
          const response = await routes.physicalBindings(harness.jsonRequest("/api/physical-bindings", { operation: "resolve_review_request", requestId: requestIds.get(instance.id), decision: "approve", reason: `verified candidate, footprint and pin map for ${instance.refDes}` }));
          expect(response.status, `${instance.refDes}: ${(await response.clone().text()).slice(0, 300)}`).toBe(200);
        }
        harness.signInAs("editor");
        // timed: publish, preflight, apply, qualify
        const started = performance.now();
        const publication = harness.publicationRequest(schematic, { expectedSnapshotRevision: 0 });
        const published = await routes.pcbSyncPost(harness.jsonRequest("/api/pcb-sync", { operation: "publish_demo_snapshot", request: publication }));
        const preflight = await routes.pcbSyncPost(harness.jsonRequest("/api/pcb-sync", { operation: "preflight", request: harness.preflightRequest({ schematicRevision: publication.schematicRevision }) }));
        const preflightBody = await harness.readJson<{ result: { status: string; plan?: { planId: string; planDigest: string; lifecycle: string } } }>(preflight);
        const applied = await routes.pcbSyncPost(harness.jsonRequest("/api/pcb-sync", { operation: "apply", request: harness.applyRequest(preflightBody.result.plan!) }, { headers: { "x-sirkit-pcb-sync-opt-in": "true" } }));
        const qualified = await routes.qualify(harness.jsonRequest("/api/pcb/qualify", { designId: harness.DESIGN_ID, boardId: harness.BOARD_ID }));
        const body = await harness.readJson<Record<string, unknown>>(qualified);
        const elapsed = performance.now() - started;
        // verified: every step as the acceptance suite verifies it, and the pinned identities exactly (case 7's comparison)
        expect(published.status).toBe(201);
        expect(preflight.status).toBe(200);
        expect(preflightBody.result.status).toBe("ready_to_apply");
        expect(applied.status).toBe(200);
        expect((await harness.readJson<{ result: { status: string } }>(applied)).result.status).toBe("applied");
        expect(qualified.status, JSON.stringify(body).slice(0, 600)).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.idempotent).toBe(false);
        expect((body.rc02 as { remainingConnections: number }).remainingConnections).toBe(0);
        expect({ boardRevision: body.boardRevision, authorityRevision: body.authorityRevision, authorityDigest: body.authorityDigest, componentAuthorityDigest: body.componentAuthorityDigest, rc01Digest: (body.rc01 as { digest: string }).digest, rc02Digest: (body.rc02 as { digest: string }).digest, rc03Digest: (body.rc03 as { digest: string }).digest, routerExecutions: seams.observedRoutes.length }).toEqual(pinned.qualification);
        return elapsed;
      } finally {
        harness.restoreIdentity();
        vi.unstubAllEnvs();
        for (const fn of restore.reverse()) fn();
      }
    };
    for (let index = 0; index < metric.warmups; index += 1) { await sample(); await yieldToLoop(); }
    const samples: number[] = [];
    for (let index = 0; index < metric.samples; index += 1) { samples.push(await sample()); await yieldToLoop(); }
    measured.push({ metricId: METRIC, samples });
    expect(samples).toHaveLength(metric.samples);
  });
});
