/**
 * B16.1C §H.2–§H.7, §H.11, §H.13, §H.15, §H.16 — recovery, refusal, retry,
 * double-submit, changed-authority invalidation, cross-scope isolation, and
 * the agent loop's inability to release. Same deterministic, credit-free
 * harness as the acceptance suite (real route handlers, isolated in-memory
 * repositories, fake provider adapter, recorded router). This suite carries
 * its own router recording because §H.13 re-qualifies a CHANGED board.
 *
 * Re-record locally: SIRKIT_B16_1C_RECORD_ROUTES=1 pnpm exec vitest run <this file>
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROUTE_FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "blinker-route-fixture-recovery.json");
const SECRET = "sentinel-router-secret-DO-NOT-LEAK-7f3a9c";

const seams = vi.hoisted(() => ({
  observedRoutes: [] as string[],
  recorded: null as null | import("./fixtures/route-fixture").RecordedRouteFixture,
  failNextRoute: false,
  buildLoopFailure: null as null | { status: number; code?: string; error: string },
}));
vi.mock("@/app/lib/durable-workflow/runtime", async () => {
  const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
  const repo = new InMemoryDurableWorkflowRepository();
  return { getDurableWorkflowRepository: () => repo };
});
vi.mock("@/app/lib/physical-binding/server-repository", async (orig) => {
  const actual = await orig() as object;
  const { InMemoryPhysicalBindingRepository } = await import("@/app/lib/physical-binding/repository");
  const shared = new InMemoryPhysicalBindingRepository();
  class SharedInMemoryPhysicalBindingRepository { constructor() { return shared; } }
  return { ...actual, PostgresPhysicalBindingRepository: SharedInMemoryPhysicalBindingRepository };
});
vi.mock("@/app/lib/atomic/server-catalog", async () => {
  const { blinkerCatalog } = await import("./fixtures/blinker-catalog");
  const load = async (revisionId: string) => structuredClone(blinkerCatalog().snapshots.get(revisionId) ?? null);
  // [B19-E E3] a new binding reads the selectable loader and a bind replay reads the status: the committed catalog is published and never withdrawn
  const loadAtomicRevisionStatus = async (ids: readonly string[]) => new Map(ids.flatMap((id) => { const snapshot = blinkerCatalog().snapshots.get(id); return snapshot ? [[id, { revisionId: id, logicalPartId: snapshot.atomicRevision.logicalPartId, state: "published", selectable: true, pinnable: true }] as const] : []; }));
  return { loadPublishedPortableSnapshot: load, loadSelectablePortableSnapshot: load, loadAtomicRevisionStatus };
});
vi.mock("@/app/lib/llm/router", async (orig) => ({ ...(await orig() as object), llmRouter: { generate: async () => ({ provider: "anthropic", model: "fake-provider", text: "", toolCalls: [] }), stream: () => { throw new Error("fake provider has no stream"); } } }));
vi.mock("@/app/lib/build-loop", async (orig) => {
  const actual = await orig() as object;
  const { BLINKER_NETLIST } = await import("./fixtures/blinker-catalog");
  return { ...actual, runBuildToolLoop: async () => {
    if (seams.buildLoopFailure) { const failure = seams.buildLoopFailure; seams.buildLoopFailure = null; return { ok: false, error: failure.error, status: failure.status, ...(failure.code ? { code: failure.code, provider: "anthropic" } : {}) }; }
    return { ok: true, netlist: structuredClone(BLINKER_NETLIST), explanation: BLINKER_NETLIST.explanation };
  } };
});
vi.mock("@/app/lib/parts-search", async (orig) => ({ ...(await orig() as object), getPartsByIds: async () => [] }));
vi.mock("@/app/lib/pcb/autonomous/production-router", async () => {
  const fixtures = await import("./fixtures/route-fixture");
  return {
    createAutonomousRouteExecutor: async (options: Record<string, unknown>) => {
      let executor: import("@/app/lib/pcb/autonomous/qualify-layout").AutonomousRouteExecutor;
      if (fixtures.recordingRequested()) {
        const actual = await vi.importActual<typeof import("@/app/lib/pcb/autonomous/production-router")>("@/app/lib/pcb/autonomous/production-router");
        seams.recorded ??= fixtures.emptyRouteFixture(new Date().toISOString());
        executor = fixtures.recordingRouteExecutor(await actual.createAutonomousRouteExecutor(options), seams.recorded);
      } else if (fixtures.liveRouterRequested()) {
        // [B16-A F21] opt-in LIVE router: the real production executor, unrecorded, unpinned.
        const actual = await vi.importActual<typeof import("@/app/lib/pcb/autonomous/production-router")>("@/app/lib/pcb/autonomous/production-router");
        const live = await actual.createAutonomousRouteExecutor(options);
        executor = async (input) => { seams.observedRoutes.push("live"); return live(input); };
      } else {
        const fixture = fixtures.loadRouteFixture(ROUTE_FIXTURE_PATH);
        if (!fixture) throw new Error(`ROUTE_FIXTURE_MISSING:${ROUTE_FIXTURE_PATH}`);
        executor = fixtures.replayRouteExecutor(fixture, seams.observedRoutes);
      }
      return async (input: Parameters<typeof executor>[0]) => {
        if (seams.failNextRoute) { seams.failNextRoute = false; throw new Error(`router process crashed: ${SECRET} C:\\routers\\java.exe exited 137`); }
        return executor(input);
      };
    },
  };
});

import { POST as buildMulti } from "@/app/api/schematic/build-multi/route";
import { POST as physicalBindings } from "@/app/api/physical-bindings/route";
import { GET as pcbSyncGet, POST as pcbSyncPost, stage3Repository } from "@/app/api/pcb-sync/route";
import { POST as qualify } from "@/app/api/pcb/qualify/route";
import { POST as release } from "@/app/api/pcb/release/route";
import { liveRouterRequested, recordingRequested, saveRouteFixture } from "./fixtures/route-fixture";
import { BLINKER_NETLIST, blinkerCatalog } from "./fixtures/blinker-catalog";
import { applyRequest, ASSEMBLY_VARIANT_ID, BOARD_ID, DESIGN_ID, deterministicUuids, freezeClock, getRequest, jsonRequest, layoutProposal, preflightRequest, publicationRequest, readJson, restoreIdentity, SCOPE, signInAs, type LaidOutSchematic } from "./fixtures/harness";
import { buildAutonomousGoldenBoard } from "@/app/lib/pcb/__tests__/fixtures/autonomous-golden-board";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { DurableManufacturingReleaseLedger } from "@/app/lib/pcb/fab/release-ledger";
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { sirkitToolRegistry } from "@/app/lib/engineering/tool-catalog";
import { ACTION_COVERAGE_REGISTRY } from "@/app/lib/engineering/action-registry";
import { buildNetlist } from "@/app/lib/pcb/netlist-bridge";
import { pcbBoardInstanceId, pcbDesignInstanceId } from "@/app/lib/pcb/board-identity";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";
import type { PcbSyncManufacturingSummary } from "@/app/api/pcb-sync/handler";
import type { PcbSyncBoardRecord } from "@/app/lib/pcb-sync/types";
import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, isAgentExposableDescriptor } from "@/app/lib/engineering/agent-exposure"; // [B17-F] the ONE reviewed exposure set — never a hard-coded count

const RECORDING = recordingRequested();
const QUALIFY_TIMEOUT_MS = RECORDING || liveRouterRequested() ? 900_000 : 60_000;
type BoardLoad = { ok: boolean; result: { status: string; record?: PcbSyncBoardRecord }; manufacturing?: PcbSyncManufacturingSummary };
const boardQuery = (boardId = BOARD_ID, scope: { tenantId: string; projectId: string; branchId: string } = SCOPE) => getRequest(`/api/pcb-sync?boardId=${encodeURIComponent(boardId)}&include=manufacturing`, { scope });
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const routerRuns = () => RECORDING ? seams.recorded?.order.length ?? 0 : seams.observedRoutes.length;

async function bindAll(schematic: LaidOutSchematic): Promise<void> {
  signInAs("admin");
  for (const instance of schematic.state.kicadComponents ?? []) {
    const response = await physicalBindings(jsonRequest("/api/physical-bindings", { operation: "bind_atomic_selection", componentInstanceId: instance.id, boardInstanceId: BOARD_ID, atomicPartRevisionId: instance.atomicPartRevisionId }));
    if (![200, 201].includes(response.status)) throw new Error(`bind ${instance.refDes}: ${response.status} ${JSON.stringify(await readJson(response))}`);
  }
}
async function hydrateSnapshotRevision(): Promise<{ snapshotRevision: number; current: { revision: string } | null }> {
  signInAs("editor");
  const body = await readJson<BoardLoad>(await pcbSyncGet(boardQuery()));
  return { snapshotRevision: body.manufacturing?.snapshot?.revision ?? 0, current: body.result.record ? { revision: body.result.record.revision } : null };
}
describe("B16.1C recovery, refusal, retry, isolation (deterministic, credit-free)", () => {
  const restore: Array<() => void> = [];
  let schematic: ReturnType<typeof layoutProposal>;
  let synced: { schematicRevision: string; boardRevision: string; planId: string };
  let qualified: Record<string, unknown> = {};
  let firstRelease: { releaseId: string; sha: string } | null = null;

  beforeAll(async () => {
    vi.stubEnv("SIRKIT_PCB_SYNC_STAGE3", "opt_in");
    restore.push(freezeClock(), deterministicUuids("b16-1c-rec"));
  });
  afterAll(() => {
    restoreIdentity(); vi.unstubAllEnvs();
    for (const fn of restore.reverse()) fn();
    if (RECORDING && seams.recorded) { saveRouteFixture(ROUTE_FIXTURE_PATH, seams.recorded); console.log(`[B16.1C] recorded ${seams.recorded.order.length} router executions → ${ROUTE_FIXTURE_PATH}`); }
  });

  it("H.2 schematic proposal refusal and retry: a provider failure is a bounded refusal that mutates nothing; the retry succeeds", async () => {
    signInAs("editor");
    seams.buildLoopFailure = { status: 503, code: "provider_unavailable", error: "provider unavailable" };
    const refused = await buildMulti(jsonRequest("/api/schematic/build-multi", { prompt: "555 blinker" }));
    const refusedBody = await readJson(refused);
    expect(refused.status).toBe(503);
    expect(refusedBody).toMatchObject({ ok: false, code: "provider_unavailable" });
    expect(JSON.stringify(refusedBody)).not.toMatch(/stack|node_modules/);
    seams.buildLoopFailure = { status: 502, error: "The model did not submit a netlist." };
    const refusedAgain = await buildMulti(jsonRequest("/api/schematic/build-multi", { prompt: "555 blinker" }));
    expect(refusedAgain.status).toBe(502);
    expect((await readJson(refusedAgain)).ok).toBe(false);
    const retried = await buildMulti(jsonRequest("/api/schematic/build-multi", { prompt: "555 blinker" }));
    const body = await readJson<{ ok: boolean; netlist: BuildLogicalNetlist }>(retried);
    expect(retried.status).toBe(200);
    expect(body.netlist.components).toEqual(BLINKER_NETLIST.components);
    schematic = layoutProposal(body.netlist, blinkerCatalog().cachedParts);
    expect(schematic.validationOk).toBe(true);
    // Nothing durable exists after proposals alone.
    const load = await readJson<BoardLoad>(await pcbSyncGet(boardQuery()));
    expect(load.result.status).toBe("not_found");
    // [B16-A F12/F14] every subject verified-absent; the signed-in editor may not authorize a release.
    expect(load.manufacturing).toEqual({ snapshot: null, authority: null, latestRelease: null, integrity: { authority: "absent", snapshot: "absent", latestRelease: "absent", codes: [] }, viewer: { role: "pcb_editor", actorKind: "human", canRelease: false } });
  });

  it("H.3 component-authority refusal: a board without server-owned binding authority cannot be qualified (fails closed, no router run)", async () => {
    // A durable board that was never synchronized through the binding path.
    const rawBoardId = `${BOARD_ID}-raw`;
    await stage3Repository.publishBoard(makeBoardRecord({ ...SCOPE, boardId: rawBoardId, board: buildAutonomousGoldenBoard(), updatedAt: new Date().toISOString() }), { expectedRevision: 0, idempotencyKey: "seed-raw" });
    signInAs("editor");
    const before = routerRuns();
    const response = await qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: rawBoardId }));
    const body = await readJson<{ code: string; blockers: Array<{ code: string }>; correlationId: string }>(response);
    expect(response.status).toBe(422);
    expect(body.code).toBe("MFG_COMPONENT_AUTHORITY_INCOMPLETE");
    // The golden fixture carries synthetic sync identities that no binding record backs; a board with none would be QA_SYNC_IDENTITY_MISSING.
    expect(body.blockers.every((blocker) => blocker.code === "QA_BINDING_NOT_FOUND" || blocker.code === "QA_SYNC_IDENTITY_MISSING")).toBe(true);
    expect(body.blockers.length).toBe(buildAutonomousGoldenBoard().footprints.length);
    expect(body.correlationId).toBeTruthy();
    expect(routerRuns()).toBe(before);
    const load = await readJson<BoardLoad>(await pcbSyncGet(boardQuery(rawBoardId)));
    expect(load.manufacturing!.authority).toBeNull();
  });

  it("H.4 PCB proposal refusal and retry: a fresh browser's stale snapshot revision is refused, hydration makes the retry idempotent; a stale schematic revision blocks preflight until retried with the current one", async () => {
    await bindAll(schematic);
    signInAs("editor");
    const publication = publicationRequest(schematic, { expectedSnapshotRevision: 0 });
    const first = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "publish_demo_snapshot", request: publication }));
    expect(first.status).toBe(201);
    // Second fresh browser (localStorage empty → 0) against the advanced server snapshot: refused, not silently overwritten.
    const stale = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "publish_demo_snapshot", request: { ...publication, requestId: "publish:fresh-browser", idempotencyKey: "publish:fresh-browser" } }));
    expect(stale.status).toBe(409);
    const staleBody = await readJson<{ code: string; conflict: { kind: string; expectedRevision: number; currentRevision: number } }>(stale);
    expect(staleBody.code).toBe("PS_SNAPSHOT_REVISION_CONFLICT");
    // [B16-C.3] the refusal names the newer revision so the browser can refresh or rebase deliberately.
    expect(staleBody.conflict).toMatchObject({ kind: "snapshot_revision", expectedRevision: 0, currentRevision: 1 });
    // Hydrate the revision from the server, retry with the SAME idempotency key → replay, no second snapshot.
    const hydrated = await hydrateSnapshotRevision();
    expect(hydrated.snapshotRevision).toBe(1);
    signInAs("editor");
    const retry = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "publish_demo_snapshot", request: { ...publication, expectedSnapshotRevision: hydrated.snapshotRevision } }));
    const retryBody = await readJson<{ result: { created: boolean; idempotent: boolean; snapshotRevision: number } }>(retry);
    expect(retry.status).toBe(200);
    expect(retryBody.result).toMatchObject({ created: false, idempotent: true, snapshotRevision: 1 });
    // Preflight with a stale schematic revision is a bounded blocker, not a crash; retry with the current one is ready.
    const blocked = await readJson<{ result: { status: string; blockers: Array<{ code: string }> } }>(await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "preflight", request: preflightRequest({ schematicRevision: "schematic:stale", requestId: "preflight:stale" }) })));
    expect(blocked.result.status).not.toBe("ready_to_apply");
    expect(blocked.result.blockers.map((item) => item.code)).toContain("PS_SCHEMATIC_REVISION_MISMATCH");
    const ready = await readJson<{ result: { status: string; plan?: { planId: string; planDigest: string } } }>(await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "preflight", request: preflightRequest({ schematicRevision: publication.schematicRevision }) })));
    expect(ready.result.status).toBe("ready_to_apply");
    // Applying a tampered plan digest is refused (409), the exact plan applies once, and a second apply replays idempotently.
    const tampered = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "apply", request: applyRequest({ planId: ready.result.plan!.planId, planDigest: "sha256:tampered" }) }, { headers: { "x-sirkit-pcb-sync-opt-in": "true" } }));
    expect([409, 422]).toContain(tampered.status);
    const applied = await readJson<{ result: { status: string; committedBoardRevision: string } }>(await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "apply", request: applyRequest(ready.result.plan!) }, { headers: { "x-sirkit-pcb-sync-opt-in": "true" } })));
    expect(applied.result.status).toBe("applied");
    const replay = await readJson<{ result: { status: string; committedBoardRevision: string } }>(await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "apply", request: applyRequest(ready.result.plan!) }, { headers: { "x-sirkit-pcb-sync-opt-in": "true" } })));
    expect(replay.result.status).toBe("idempotent_replay");
    expect(replay.result.committedBoardRevision).toBe(applied.result.committedBoardRevision);
    synced = { schematicRevision: publication.schematicRevision, boardRevision: applied.result.committedBoardRevision, planId: ready.result.plan!.planId };
  });

  it("H.6 qualification failure and recovery: a router crash is a bounded envelope (no internals), the board and authority are untouched, the explicit retry succeeds", async () => {
    signInAs("editor");
    seams.failNextRoute = true;
    const failed = await qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: BOARD_ID }));
    const failedBody = await readJson<{ code: string; correlationId: string }>(failed);
    expect(failed.status).toBe(500);
    expect(failedBody.code).toBe("MFG_QUALIFY_FAILED");
    expect(failedBody.correlationId).toBeTruthy();
    expect(failed.headers.get("X-Sirkit-Correlation-Id")).toBe(failedBody.correlationId);
    expect(JSON.stringify(failedBody)).not.toContain(SECRET);
    expect(JSON.stringify(failedBody)).not.toContain("java.exe");
    const untouched = await readJson<BoardLoad>(await pcbSyncGet(boardQuery()));
    expect(untouched.result.record!.revision).toBe(synced.boardRevision);
    expect(untouched.manufacturing!.authority).toBeNull();
    // Explicit retry (same request) succeeds and seals authority.
    const retried = await qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: BOARD_ID }));
    const body = await readJson(retried);
    expect(retried.status, JSON.stringify(body).slice(0, 800)).toBe(200);
    expect(body.idempotent).toBe(false);
    qualified = body;
    const load = await readJson<BoardLoad>(await pcbSyncGet(boardQuery()));
    expect(load.result.record!.revision).toBe(body.boardRevision);
    expect(load.manufacturing!.authority?.current).toBe(true);
  }, QUALIFY_TIMEOUT_MS);

  it("H.5 stale revision during approval: a PCB plan prepared against the pre-qualification board is refused after the board moved on", async () => {
    signInAs("editor");
    // A plan prepared while the human was reviewing (existing board = the pre-routing revision).
    const plan = await readJson<{ result: { status: string; plan?: { planId: string; planDigest: string }; blockers: Array<{ code: string }> } }>(await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "preflight", request: preflightRequest({ schematicRevision: synced.schematicRevision, current: { revision: synced.boardRevision }, requestId: "preflight:stale-approval" }) })));
    // The board already advanced (qualification routed it): preflight itself reports the mismatch and prepares nothing applicable.
    expect(plan.result.status).not.toBe("ready_to_apply");
    expect(plan.result.blockers.map((item) => item.code)).toContain("PS_BOARD_REVISION_MISMATCH");
    // And an apply naming the CURRENT board but a plan id that was never prepared is refused, not guessed.
    const bogus = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "apply", request: applyRequest({ planId: "plan:never-prepared", planDigest: "sha256:none" }) }, { headers: { "x-sirkit-pcb-sync-opt-in": "true" } }));
    expect([404, 409, 422]).toContain(bogus.status);
    const load = await readJson<BoardLoad>(await pcbSyncGet(boardQuery()));
    expect(load.result.record!.revision).toBe(qualified.boardRevision);
  });

  it("H.11 double-submit protection: concurrent qualifications → one runs, the other is refused 409; concurrent releases → one ledger entry, identical bytes", async () => {
    signInAs("editor");
    const [a, b] = await Promise.all([qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: BOARD_ID })), qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: BOARD_ID }))]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const refused = a.status === 409 ? a : b;
    expect((await readJson(refused)).code).toBe("MFG_QUALIFICATION_IN_PROGRESS");
    const ok = a.status === 200 ? a : b;
    expect((await readJson(ok)).idempotent).toBe(true); // the board is already qualified — no router run
    signInAs("admin");
    const confirmed = { designId: DESIGN_ID, boardId: BOARD_ID, expectedAuthorityRevision: qualified.authorityRevision, expectedAuthorityDigest: qualified.authorityDigest };
    const [r1, r2] = await Promise.all([release(jsonRequest("/api/pcb/release", confirmed)), release(jsonRequest("/api/pcb/release", confirmed))]);
    expect(r1.status).toBe(200); expect(r2.status).toBe(200);
    const bytes1 = new Uint8Array(await r1.arrayBuffer()), bytes2 = new Uint8Array(await r2.arrayBuffer());
    expect(Buffer.compare(Buffer.from(bytes1), Buffer.from(bytes2))).toBe(0);
    const ledger = new DurableManufacturingReleaseLedger(getDurableWorkflowRepository());
    const entries = await ledger.list({ ...SCOPE, designId: DESIGN_ID, boardId: BOARD_ID });
    expect(entries).toHaveLength(1);
    firstRelease = { releaseId: r1.headers.get("X-Sirkit-Release-Id")!, sha: sha256(bytes1) };
    expect(entries[0]!.releaseId).toBe(firstRelease.releaseId);
  });

  it("H.13 changed-authority release invalidation: a durable board change after release makes the sealed authority and its release stale; re-qualification seals a new authority and a different release", async () => {
    // A bound instance cannot be silently re-pointed at another atomic revision: the binding lifecycle refuses it (bounded PB_* code).
    const catalog = blinkerCatalog();
    const c3 = schematic.state.kicadComponents!.find((instance) => instance.refDes === "C3")!;
    const otherRevision = catalog.parts.get(c3.partId)!.revisions[Object.keys(catalog.parts.get(c3.partId)!.revisions).find((key) => key.startsWith("100n"))!]!;
    signInAs("admin");
    const rebind = await physicalBindings(jsonRequest("/api/physical-bindings", { operation: "bind_atomic_selection", componentInstanceId: c3.id, boardInstanceId: BOARD_ID, atomicPartRevisionId: otherRevision.revisionId }));
    expect(rebind.status).toBe(409);
    expect(String((await readJson(rebind)).code)).toMatch(/^PB_/);
    // A ROUTED board refuses structural re-synchronization before Stage 8 (a spare unconnected header added to the
    // approved schematic is refused with a bounded blocker, never coerced) — so a design change after qualification
    // cannot silently rewrite copper.
    const extended: BuildLogicalNetlist = { ...BLINKER_NETLIST, components: [...BLINKER_NETLIST.components, { refDes: "J2", partId: BLINKER_NETLIST.components[8]!.partId, value: "SPARE", role: "connector" }] };
    const relaid = layoutProposal(extended, catalog.cachedParts);
    expect(relaid.validationOk, relaid.violations.join(" | ")).toBe(true);
    const originalIds = new Map((schematic.state.kicadComponents ?? []).map((instance) => [instance.refDes, instance.id]));
    for (const instance of relaid.state.kicadComponents ?? []) { const original = originalIds.get(instance.refDes); if (original) instance.id = original; }
    const extendedSchematic = { ...relaid, netlist: buildNetlist(relaid.state, relaid.getPart) };
    await bindAll(extendedSchematic);
    const hydrated = await hydrateSnapshotRevision();
    signInAs("editor");
    const publication = publicationRequest(extendedSchematic, { expectedSnapshotRevision: hydrated.snapshotRevision });
    expect((await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "publish_demo_snapshot", request: publication }))).status).toBe(201);
    const refusedPlan = await readJson<{ result: { status: string; blockers: Array<{ code: string }> } }>(await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "preflight", request: preflightRequest({ schematicRevision: publication.schematicRevision, current: hydrated.current }) })));
    expect(refusedPlan.result.status).not.toBe("ready_to_apply");
    expect(refusedPlan.result.blockers.map((item) => item.code)).toContain("PS_STRUCTURAL_ADD_REQUIRES_UNROUTED_BOARD");
    // The durable board DOES change through the durable repository — the seam every durable board publication (sync
    // apply, qualification commit, a future durable copper edit) commits through: the routed copper is cleared, i.e. the
    // board returns to its synchronized, unrouted content at the current aggregate revision (compare-and-swap).
    const head = (await stage3Repository.getBoardHead({ ...SCOPE, boardId: BOARD_ID }))!;
    expect(head.record.revision).toBe(qualified.boardRevision);
    const unrouted = { ...head.record.board, tracks: [], vias: [] };
    const unroutedRecord = makeBoardRecord({ ...SCOPE, boardId: BOARD_ID, board: unrouted, updatedAt: new Date().toISOString() });
    await stage3Repository.publishBoard(unroutedRecord, { expectedRevision: head.aggregateRevision, idempotencyKey: `clear-routing:${unroutedRecord.revision}` });
    const resynced = { boardRevision: unroutedRecord.revision };
    expect(resynced.boardRevision).not.toBe(qualified.boardRevision);
    // Time moves on before the re-qualification (the frozen clock advances one hour), so the re-sealed authority is a
    // genuinely new record even where the deterministic placement/routing reproduces the same copper.
    vi.setSystemTime(new Date(new Date().getTime() + 3_600_000));
    signInAs("admin");
    // The administrator confirms the (still current) sealed authority; the release is refused because the BOARD moved on.
    const stale = await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: BOARD_ID, expectedAuthorityRevision: qualified.authorityRevision, expectedAuthorityDigest: qualified.authorityDigest }));
    const staleBody = await readJson<{ code: string; authorityBoardRevision: string; currentBoardRevision: string }>(stale);
    expect(stale.status).toBe(409);
    expect(staleBody.code).toBe("MFG_AUTHORITY_STALE");
    expect(staleBody).toMatchObject({ authorityBoardRevision: qualified.boardRevision, currentBoardRevision: resynced.boardRevision });
    const load = await readJson<BoardLoad>(await pcbSyncGet(boardQuery()));
    expect(load.manufacturing!.authority?.current).toBe(false);
    expect(load.manufacturing!.latestRelease?.current).toBe(false);
    // Re-qualify: new authority revision + digest; release yields a DIFFERENT release id and a second ledger entry.
    signInAs("editor");
    const requalified = await qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: BOARD_ID }));
    const requalifiedBody = await readJson(requalified);
    expect(requalified.status, JSON.stringify(requalifiedBody).slice(0, 800)).toBe(200);
    expect(requalifiedBody.idempotent).toBe(false);
    expect(requalifiedBody.authorityRevision).toBe((qualified.authorityRevision as number) + 1);
    expect(requalifiedBody.authorityDigest).not.toBe(qualified.authorityDigest);
    // The component/package authority did not change (same bindings, same footprints, same certificates) — and the
    // digest says so; only the sealed authority RECORD (board, evidence, time, revision) is new.
    expect(requalifiedBody.componentAuthorityDigest).toBe(qualified.componentAuthorityDigest);
    signInAs("admin");
    const second = await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: BOARD_ID, expectedAuthorityRevision: requalifiedBody.authorityRevision, expectedAuthorityDigest: requalifiedBody.authorityDigest }));
    expect(second.status).toBe(200);
    expect(second.headers.get("X-Sirkit-Release-Id")).not.toBe(firstRelease!.releaseId);
    expect(second.headers.get("X-Sirkit-Release-Recorded")).toBe("created");
    expect(second.headers.get("X-Sirkit-Authority-Revision")).toBe(String(requalifiedBody.authorityRevision));
    expect(sha256(new Uint8Array(await second.arrayBuffer()))).not.toBe(firstRelease!.sha);
    // An administrator who confirmed the OLD authority in the browser is refused when the authority moved on.
    const staleConfirmation = await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: BOARD_ID, expectedAuthorityRevision: qualified.authorityRevision, expectedAuthorityDigest: qualified.authorityDigest }));
    expect(staleConfirmation.status).toBe(409);
    expect((await readJson(staleConfirmation)).code).toBe("MFG_AUTHORITY_CONFIRMATION_MISMATCH");
    const ledger = new DurableManufacturingReleaseLedger(getDurableWorkflowRepository());
    const entries = await ledger.list({ ...SCOPE, designId: DESIGN_ID, boardId: BOARD_ID });
    expect(entries).toHaveLength(2);
    const after = await readJson<BoardLoad>(await pcbSyncGet(boardQuery()));
    expect(after.manufacturing!.authority).toMatchObject({ revision: requalifiedBody.authorityRevision, current: true });
    expect(after.manufacturing!.latestRelease).toMatchObject({ releaseId: second.headers.get("X-Sirkit-Release-Id"), current: true });
    qualified = requalifiedBody;
  }, QUALIFY_TIMEOUT_MS);

  it("H.14 routed-board revision: a structural change after release derives a NEW board revision (copper kept only by proof), the old board and its releases stay history and can never be released again, the new revision is re-qualified and released on its own", async () => {
    // The schematic change: a SECOND power header J2 wired to VCC and GND (a connected component — an unconnected spare is
    // refused by RC03's pin/pad parity rule, see the ledger). This changes the endpoint sets of VCC and GND, so their copper
    // must be stripped; every other net's copper is provably unchanged and stays.
    const catalog = blinkerCatalog();
    const extended2: BuildLogicalNetlist = { ...BLINKER_NETLIST, components: [...BLINKER_NETLIST.components, { refDes: "J2", partId: BLINKER_NETLIST.components[8]!.partId, value: "PWR_AUX", role: "connector" }], connections: [...BLINKER_NETLIST.connections, { kind: "label", pin: "J2.1", labelName: "VCC" }, { kind: "label", pin: "J2.2", labelName: "GND" }] };
    const relaid2 = layoutProposal(extended2, catalog.cachedParts);
    expect(relaid2.validationOk, relaid2.violations.join(" | ")).toBe(true);
    const originalIds2 = new Map((schematic.state.kicadComponents ?? []).map((instance) => [instance.refDes, instance.id]));
    for (const instance of relaid2.state.kicadComponents ?? []) { const original = originalIds2.get(instance.refDes); if (original) instance.id = original; }
    const connectedSchematic = { ...relaid2, netlist: buildNetlist(relaid2.state, relaid2.getPart) };
    await bindAll(connectedSchematic); // the reviewer-approved exact parts (J2 is new; the others replay idempotently)
    const hydrated2 = await hydrateSnapshotRevision();
    signInAs("editor");
    const publication2 = publicationRequest(connectedSchematic, { expectedSnapshotRevision: hydrated2.snapshotRevision });
    expect((await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "publish_demo_snapshot", request: publication2 }))).status).toBe(201);
    const head = (await stage3Repository.getBoardHead({ ...SCOPE, boardId: BOARD_ID }))!;
    const schematicRevision = publication2.schematicRevision;
    // The Stage 8 guard still refuses the structural change on the routed, released board.
    const refused = await readJson<{ result: { status: string; blockers: Array<{ code: string }> } }>(await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "preflight", request: preflightRequest({ requestId: `preflight:h14:${head.record.revision}`, schematicRevision, current: { revision: head.record.revision } }) })));
    expect(refused.result.blockers.map((item) => item.code)).toContain("PS_STRUCTURAL_ADD_REQUIRES_UNROUTED_BOARD");
    // Preview the rework plan (writes nothing).
    const revisionRequest = { requestSchemaVersion: "sirkit.pcb-board-revision-request.v1", requestId: `board-revision:${head.record.revision}`, designId: DESIGN_ID, schematicRevision, assemblyVariantId: ASSEMBLY_VARIANT_ID, parent: { boardId: BOARD_ID, expectedBoardRevision: head.record.revision }, carry: { copper: true, placement: true, constraints: true }, resolutionPolicyId: "sirkit.default-footprint-resolution", resolutionPolicyVersion: "1.0.0", syncPolicyId: "sirkit.safe-pcb-sync", syncPolicyVersion: "1.0.0", requestedAt: new Date().toISOString() };
    type Preview = { result: { status: string; revisionPlan: { planId: string; planDigest: string; derivedBoardId: string; generation: number; components: Array<{ referenceDesignator: string; outcome: string }>; nets: Array<{ displayName: string; outcome: string; proof: { equivalent: boolean; reason: string }; copper: { tracks: number } }>; summary: Record<string, number> }; parentPreflight: { stage8Blocked: boolean }; derivedPreflight: { status: string; planDigest: string | null; operations: Array<{ kind: string }> } } };
    const previewResponse = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "preview_board_revision", request: revisionRequest }));
    const preview = await readJson<Preview>(previewResponse);
    expect(previewResponse.status, JSON.stringify(preview).slice(0, 800)).toBe(200);
    expect(preview.result.status, JSON.stringify(preview.result.derivedPreflight).slice(0, 800)).toBe("ready_to_derive");
    expect(preview.result.parentPreflight.stage8Blocked).toBe(true);
    expect(preview.result.revisionPlan.derivedBoardId).toBe(`${BOARD_ID}@r1`);
    // J2 joins VCC and GND. A stable net id is derived from the endpoint set, so each of those nets appears as its old
    // identity REMOVED (copper stripped, the proof names the successor) plus a new identity ADDED; every other net keeps
    // its copper by proof; the nine original components are kept, J2 is added.
    expect(preview.result.revisionPlan.components.find((item) => item.referenceDesignator === "J2")?.outcome).toBe("added");
    expect(preview.result.revisionPlan.components.filter((item) => item.outcome === "kept")).toHaveLength(9);
    const removed = preview.result.revisionPlan.nets.filter((net) => net.outcome === "removed");
    expect(removed.map((net) => net.displayName.replace(/^.*\//, "")).sort()).toEqual(["GND", "VCC"]);
    expect(removed.every((net) => !net.proof.equivalent && net.copper.tracks > 0 && net.proof.reason.includes("net identity changed with its membership"))).toBe(true);
    expect(preview.result.revisionPlan.nets.filter((net) => net.outcome === "added").map((net) => net.displayName.replace(/^.*\//, "")).sort()).toEqual(["GND", "VCC"]);
    expect(preview.result.revisionPlan.summary).toMatchObject({ netsRemoved: 2, netsAdded: 2, netsStripped: 0 });
    expect(preview.result.revisionPlan.summary.netsRetained).toBeGreaterThan(0);
    expect(preview.result.revisionPlan.nets.every((net) => net.outcome === "copper_retained" ? net.proof.equivalent : true)).toBe(true);
    expect(preview.result.revisionPlan.summary.tracksStripped).toBeGreaterThan(0);
    expect(preview.result.revisionPlan.summary.tracksRetained).toBeGreaterThan(0);
    expect(preview.result.derivedPreflight.operations.map((item) => item.kind)).toContain("add_component_instance");
    // Derive (human editor, explicit confirmation, reviewed digests, opt-in header).
    const deriveRequest = { ...revisionRequest, requestId: `${revisionRequest.requestId}:derive`, planId: preview.result.revisionPlan.planId, planDigest: preview.result.revisionPlan.planDigest, syncPlanDigest: preview.result.derivedPreflight.planDigest, confirmation: "derive_board_revision", idempotencyKey: `derive:${preview.result.revisionPlan.planDigest}` };
    const derivedResponse = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "derive_board_revision", request: deriveRequest }, { headers: { "x-sirkit-pcb-sync-opt-in": "true" } }));
    const derived = await readJson<{ result: { status: string; derivedBoardId: string; boardRevision: string; generation: number; lineage: { state: string; currentBoardId: string } } }>(derivedResponse);
    expect(derivedResponse.status, JSON.stringify(derived).slice(0, 600)).toBe(201);
    const derivedBoardId = derived.result.derivedBoardId;
    expect(derivedBoardId).toBe(`${BOARD_ID}@r1`);
    expect(derived.result.lineage).toMatchObject({ state: "current", currentBoardId: derivedBoardId });
    // The OLD board: record untouched, lineage superseded, its two ledger entries kept — and no release or qualification can ever run on it again.
    const oldLoad = await readJson<BoardLoad & { result: { lineage?: { state: string; supersededBy: string | null; currentBoardId: string } } }>(await pcbSyncGet(boardQuery()));
    expect(oldLoad.result.record?.revision).toBe(head.record.revision);
    expect(oldLoad.result.lineage).toMatchObject({ state: "superseded", supersededBy: derivedBoardId, currentBoardId: derivedBoardId });
    expect(oldLoad.manufacturing!.latestRelease?.current).toBe(true); // history: the last release of the old board stays what it was
    signInAs("admin");
    const oldRelease = await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: BOARD_ID, expectedAuthorityRevision: qualified.authorityRevision, expectedAuthorityDigest: qualified.authorityDigest }));
    expect(oldRelease.status).toBe(409);
    expect(await readJson(oldRelease)).toMatchObject({ code: "MFG_BOARD_SUPERSEDED", supersededBy: derivedBoardId, currentBoardId: derivedBoardId });
    signInAs("editor");
    const oldQualify = await qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: BOARD_ID }));
    expect(oldQualify.status).toBe(409);
    expect((await readJson(oldQualify)).code).toBe("MFG_BOARD_SUPERSEDED");
    expect((await new DurableManufacturingReleaseLedger(getDurableWorkflowRepository()).list({ ...SCOPE, designId: DESIGN_ID, boardId: BOARD_ID })).length).toBe(2);
    // The NEW revision: carried copper, J2 added, NO authority yet; a fresh browser opening the root id is told where to go.
    const fresh = await readJson<BoardLoad>(await pcbSyncGet(boardQuery(derivedBoardId)));
    expect(fresh.result.status).toBe("found");
    expect(fresh.result.record!.board.footprints).toHaveLength(10);
    expect(fresh.result.record!.board.tracks.length).toBe(preview.result.revisionPlan.summary.tracksRetained); // carried copper only
    expect(fresh.manufacturing!.authority).toBeNull();
    expect(fresh.manufacturing!.latestRelease).toBeNull();
    // Re-qualification runs the whole pipeline on the new revision (recorded router) and seals a NEW authority; the administrator releases it separately.
    const requalified = await qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: derivedBoardId }));
    const requalifiedBody = await readJson<{ authorityRevision: number; authorityDigest: string; boardRevision: string }>(requalified);
    expect(requalified.status, JSON.stringify(requalifiedBody).slice(0, 800)).toBe(200);
    expect(requalifiedBody.authorityRevision).toBe(1); // the derived board's FIRST authority — nothing carried over from the parent
    signInAs("admin");
    const newRelease = await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: derivedBoardId, expectedAuthorityRevision: requalifiedBody.authorityRevision, expectedAuthorityDigest: requalifiedBody.authorityDigest }));
    expect(newRelease.status, newRelease.status === 200 ? "" : JSON.stringify(await readJson(newRelease)).slice(0, 600)).toBe(200);
    expect(newRelease.headers.get("X-Sirkit-Release-Recorded")).toBe("created");
    expect(newRelease.headers.get("X-Sirkit-Release-Id")).not.toBe(firstRelease!.releaseId);
    const after = await readJson<BoardLoad>(await pcbSyncGet(boardQuery(derivedBoardId)));
    expect(after.manufacturing!.authority).toMatchObject({ revision: 1, current: true });
    expect(after.manufacturing!.latestRelease).toMatchObject({ releaseId: newRelease.headers.get("X-Sirkit-Release-Id"), current: true });
  }, QUALIFY_TIMEOUT_MS);

  it("H.15 no stale state crosses projects or branches: another project and another branch see nothing and can act on nothing", async () => {
    const otherProject = { tenantId: SCOPE.tenantId, projectId: "b16-1c-other", branchId: "main" };
    const otherBranch = { ...SCOPE, branchId: "feature" };
    for (const scope of [otherProject, otherBranch]) {
      signInAs("admin", scope);
      const boardId = pcbBoardInstanceId(scope.projectId), designId = pcbDesignInstanceId(scope.projectId);
      const load = await readJson<BoardLoad>(await pcbSyncGet(boardQuery(boardId, scope)));
      expect(load.result.status, scope.branchId).toBe("not_found");
      // [B16-A F12/F14] nothing crosses scopes: every subject verified-absent; the administrator's capability is about the viewer, not the (empty) scope.
      expect(load.manufacturing).toEqual({ snapshot: null, authority: null, latestRelease: null, integrity: { authority: "absent", snapshot: "absent", latestRelease: "absent", codes: [] }, viewer: { role: "project_admin", actorKind: "human", canRelease: true } });
      // The main-branch board id is invisible from the other branch/project as well.
      const cross = await readJson<BoardLoad>(await pcbSyncGet(boardQuery(BOARD_ID, scope)));
      expect(cross.result.status).toBe("not_found");
      signInAs("editor", scope);
      const q = await qualify(jsonRequest("/api/pcb/qualify", { designId, boardId }, { scope }));
      expect(q.status).toBe(404);
      expect((await readJson(q)).code).toBe("MFG_AUTHORITATIVE_BOARD_NOT_FOUND");
      const qCross = await qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: BOARD_ID }, { scope }));
      expect(qCross.status).toBe(404);
      signInAs("admin", scope);
      const r = await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: BOARD_ID }, { scope }));
      expect(r.status).toBe(404);
      expect((await readJson(r)).code).toBe("MFG_AUTHORITY_NOT_FOUND");
    }
    // [B16-A F6] client-supplied scope in the body is REFUSED as an undeclared field (never honoured, never silently ignored): the trusted selector decides.
    signInAs("admin", otherProject);
    const spoof = await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: BOARD_ID, projectId: SCOPE.projectId, tenantId: SCOPE.tenantId }, { scope: otherProject }));
    expect(spoof.status).toBe(400);
    expect((await readJson(spoof)).code).toBe("MFG_API_UNKNOWN_FIELD");
    void ASSEMBLY_VARIANT_ID;
  });

  it("H.16 zero release execution through the agent loop: no qualification or release tool is agent-exposed or callable; the release action has no tool exposure and needs the administrator's release authorization", () => {
    const registry = sirkitToolRegistry();
    const exposed = registry.list().filter((descriptor) => descriptor.agentExposed);
    expect(exposed).toHaveLength(INTENTIONAL_AGENT_EXPOSED_TOOL_IDS.length);
    // (sirkit.manufacturing.readiness-inspect is a READ that "never authorizes a release" — it stays exposed.)
    expect(exposed.filter((descriptor) => /\.release$|qualif/i.test(descriptor.toolId)).map((descriptor) => descriptor.toolId)).toEqual([]);
    expect(exposed.every((descriptor) => isAgentExposableDescriptor(descriptor))).toBe(true);
    const releaseTool = registry.list().find((descriptor) => descriptor.toolId === "sirkit.manufacturing.release");
    expect(releaseTool).toBeDefined();
    expect(releaseTool!.agentExposed).toBe(false);
    expect(releaseTool!.callability).toBe("not-callable");
    expect(registry.list().some((descriptor) => /qualif/i.test(descriptor.toolId) && descriptor.callability === "callable")).toBe(false);
    const action = ACTION_COVERAGE_REGISTRY.find((row) => row.id === "manufacturing.release");
    // B16.1C recorded the release as api-only (no UI yet); B16-C added the administrator-authorized release UI and
    // B17-A re-baselined the record to implemented. The invariant is unchanged: destructive, release-tier, NO tool
    // exposure, and the UI path is the server-owned release route — never a tool, never a raw process.
    expect(action).toMatchObject({ kind: "destructive", status: "implemented", toolExposure: "none", approvalTier: "release" });
    expect(action!.sources).toContain("app/api/pcb/release/route.ts");
    expect(action!.handler).toMatch(/authorizeRelease/);
    const qualifyAction = ACTION_COVERAGE_REGISTRY.find((row) => row.id === "pcb.qualify-route");
    expect(qualifyAction).toMatchObject({ toolExposure: "none" });
  });
});
