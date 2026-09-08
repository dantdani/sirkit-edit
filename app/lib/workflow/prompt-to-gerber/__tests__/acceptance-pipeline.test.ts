/**
 * B16.1C §G + §H.1/§H.12/§H.14 — the fresh-browser prompt-to-Gerber success
 * path, deterministic and credit-free.
 *
 * Real production route handlers end to end:
 *   POST /api/schematic/build-multi   (fake provider adapter → the 555 design)
 *   POST /api/physical-bindings       (human reviewer binds each instance to its
 *                                      published atomic revision)
 *   POST /api/pcb-sync                publish_demo_snapshot → preflight → apply
 *   GET  /api/pcb-sync?include=manufacturing   (fresh-browser hydration truth)
 *   POST /api/pcb/qualify             (server-owned authority; recorded router)
 *   POST /api/pcb/release             (human project admin only)
 *
 * Isolated repositories: in-memory durable workflow + physical bindings; the
 * published atomic catalog is the committed KiCad-backed fixture; the LLM
 * provider is a fake adapter; the router is a recording of the real bundled
 * FreeRouting run (replayed by exact placed-board revision).
 *
 * Re-record the router fixture locally (bundled JRE present) with
 *   SIRKIT_B16_1C_RECORD_ROUTES=1 pnpm exec vitest run <this file>
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { createHash } from "node:crypto";

const ROUTE_FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "blinker-route-fixture.json");

// ── isolated repositories, fake adapters, recorded router ───────────────────
const seams = vi.hoisted(() => ({ observedRoutes: [] as string[], recorded: null as null | import("./fixtures/route-fixture").RecordedRouteFixture }));
vi.mock("@/app/lib/durable-workflow/runtime", async () => {
  const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
  const repo = new InMemoryDurableWorkflowRepository();
  return { getDurableWorkflowRepository: () => repo };
});
vi.mock("@/app/lib/physical-binding/server-repository", async (orig) => {
  const actual = await orig() as object;
  const { InMemoryPhysicalBindingRepository } = await import("@/app/lib/physical-binding/repository");
  // ONE shared store: the physical-bindings route and the pcb-sync/qualify
  // routes each construct their own repository object in production over the
  // same Postgres; here both constructions resolve to the same in-memory store.
  const shared = new InMemoryPhysicalBindingRepository();
  class SharedInMemoryPhysicalBindingRepository { constructor() { return shared; } }
  return { ...actual, PostgresPhysicalBindingRepository: SharedInMemoryPhysicalBindingRepository };
});
vi.mock("@/app/lib/atomic/server-catalog", async () => {
  const { blinkerCatalog } = await import("./fixtures/blinker-catalog");
  return { loadPublishedPortableSnapshot: async (revisionId: string) => structuredClone(blinkerCatalog().snapshots.get(revisionId) ?? null) };
});
vi.mock("@/app/lib/llm/router", async (orig) => {
  const actual = await orig() as object;
  // Fake planner: no decomposition → the single build loop (also fake) runs.
  return { ...actual, llmRouter: { generate: async () => ({ provider: "anthropic", model: "fake-provider", text: "", toolCalls: [] }), stream: () => { throw new Error("fake provider has no stream"); } } };
});
vi.mock("@/app/lib/build-loop", async (orig) => {
  const actual = await orig() as object;
  const { BLINKER_NETLIST } = await import("./fixtures/blinker-catalog");
  return { ...actual, runBuildToolLoop: async () => ({ ok: true, netlist: structuredClone(BLINKER_NETLIST), explanation: BLINKER_NETLIST.explanation }) };
});
vi.mock("@/app/lib/parts-search", async (orig) => ({ ...(await orig() as object), getPartsByIds: async () => [] }));
vi.mock("@/app/lib/pcb/autonomous/production-router", async () => {
  const fixtures = await import("./fixtures/route-fixture");
  return {
    createAutonomousRouteExecutor: async (options: Record<string, unknown>) => {
      if (fixtures.recordingRequested()) {
        const actual = await vi.importActual<typeof import("@/app/lib/pcb/autonomous/production-router")>("@/app/lib/pcb/autonomous/production-router");
        seams.recorded ??= fixtures.emptyRouteFixture(new Date().toISOString());
        return fixtures.recordingRouteExecutor(await actual.createAutonomousRouteExecutor(options), seams.recorded);
      }
      if (fixtures.liveRouterRequested()) {
        // [B16-A F21] opt-in LIVE router: the real production executor, unrecorded, unpinned.
        const actual = await vi.importActual<typeof import("@/app/lib/pcb/autonomous/production-router")>("@/app/lib/pcb/autonomous/production-router");
        const live = await actual.createAutonomousRouteExecutor(options);
        return async (input: Parameters<typeof live>[0]) => { seams.observedRoutes.push("live"); return live(input); };
      }
      const fixture = fixtures.loadRouteFixture(ROUTE_FIXTURE_PATH);
      if (!fixture) throw new Error(`ROUTE_FIXTURE_MISSING:${ROUTE_FIXTURE_PATH}`);
      return fixtures.replayRouteExecutor(fixture, seams.observedRoutes);
    },
  };
});

import { POST as buildMulti } from "@/app/api/schematic/build-multi/route";
import { POST as physicalBindings } from "@/app/api/physical-bindings/route";
import { GET as pcbSyncGet, POST as pcbSyncPost } from "@/app/api/pcb-sync/route";
import { POST as qualify } from "@/app/api/pcb/qualify/route";
import { POST as release } from "@/app/api/pcb/release/route";
import { liveRouterRequested, recordingRequested, saveRouteFixture } from "./fixtures/route-fixture";
import { loadExpectedIdentities, saveExpectedIdentities, type ExpectedReleaseIdentities } from "./fixtures/expected-identities";
import { evidenceDirectory, writeEvidence } from "./fixtures/evidence";
import { verifyReleaseArchiveIndependently } from "@/app/lib/pcb/fab/independent-archive-verifier";
import { BLINKER_ACCEPTANCE_PROMPT, BLINKER_NETLIST, blinkerCatalog } from "./fixtures/blinker-catalog";
import { verifyBlinkerBoardParity, verifyBlinkerRouting, verifyBlinkerSchematic, type ElectricalReport } from "./fixtures/blinker-electrical";
import { applyRequest, BOARD_ID, DESIGN_ID, deterministicUuids, FIXED_NOW, freezeClock, getRequest, jsonRequest, layoutProposal, preflightRequest, publicationRequest, readJson, restoreIdentity, signInAs, signOut, USERS, type LaidOutSchematic } from "./fixtures/harness";
import type { BuildLogicalNetlist } from "@/lib/schematic-types";
import type { PcbBoard } from "@/app/lib/pcb/types";
import type { PcbSyncManufacturingSummary } from "@/app/api/pcb-sync/handler";
import type { PcbSyncBoardRecord } from "@/app/lib/pcb-sync/types";

const RECORDING = recordingRequested();
const LIVE = liveRouterRequested();
const QUALIFY_TIMEOUT_MS = RECORDING || LIVE ? 900_000 : 60_000;
// [B16-A F9] the committed identities every REPLAY must reproduce exactly (written when recording, skipped only under the live router).
const PINNED = RECORDING || LIVE ? null : loadExpectedIdentities();
if (!RECORDING && !LIVE && !PINNED) throw new Error("EXPECTED_IDENTITIES_MISSING: record the fixtures with SIRKIT_B16_1C_RECORD_ROUTES=1");

function table(report: ElectricalReport): string { return report.checks.map((row) => `  ${row.ok ? "PASS" : "FAIL"}  ${row.name}: ${row.detail}`).join("\n"); }
function sha256(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
const boardQuery = (include = true) => getRequest(`/api/pcb-sync?boardId=${encodeURIComponent(BOARD_ID)}${include ? "&include=manufacturing" : ""}`);
type BoardLoad = { ok: boolean; result: { status: string; record?: PcbSyncBoardRecord }; manufacturing?: PcbSyncManufacturingSummary };

describe("B16.1C fresh-browser prompt-to-Gerber (deterministic, credit-free)", () => {
  const restore: Array<() => void> = [];
  const evidence: Record<string, unknown> = { fixedNow: FIXED_NOW, recording: RECORDING };
  let proposal: BuildLogicalNetlist;
  let schematic: LaidOutSchematic;
  let schematicRevision = "";
  let appliedRevision = "";
  let qualified: Record<string, unknown> = {};
  let routedBoard: PcbBoard | null = null;
  let releasedBytes: Uint8Array | null = null;

  beforeAll(() => {
    vi.stubEnv("SIRKIT_PCB_SYNC_STAGE3", "opt_in");
    restore.push(freezeClock(), deterministicUuids());
  });
  afterAll(() => {
    restoreIdentity(); vi.unstubAllEnvs();
    for (const fn of restore.reverse()) fn();
    writeEvidence("b16-1c-acceptance-evidence.json", JSON.stringify(evidence, null, 2));
    if (RECORDING && seams.recorded) { saveRouteFixture(ROUTE_FIXTURE_PATH, seams.recorded); console.log(`[B16.1C] recorded ${seams.recorded.order.length} router executions → ${ROUTE_FIXTURE_PATH}`); }
    if (RECORDING && evidence.qualification && evidence.release) {
      const q = evidence.qualification as { boardRevision: string; authorityRevision: number; authorityDigest: string; componentAuthorityDigest: string; rc01: { digest: string }; rc02: { digest: string }; rc03: { digest: string }; routerExecutions: number };
      const r = evidence.release as { releaseId: string; filename: string; archiveSha256: string; manifestContentDigest: string; counts: Record<string, number>; files: Array<{ path: string; role: string; sha256: string }> };
      const pinned: ExpectedReleaseIdentities = { schemaVersion: "sirkit.b16-1c.expected-identities.v1", fixedNow: FIXED_NOW, qualification: { boardRevision: q.boardRevision, authorityRevision: q.authorityRevision, authorityDigest: q.authorityDigest, componentAuthorityDigest: q.componentAuthorityDigest, rc01Digest: q.rc01.digest, rc02Digest: q.rc02.digest, rc03Digest: q.rc03.digest, routerExecutions: q.routerExecutions }, release: { releaseId: r.releaseId, filename: r.filename, archiveSha256: r.archiveSha256, archiveByteLength: releasedBytes?.byteLength ?? 0, manifestContentDigest: r.manifestContentDigest, counts: r.counts, files: r.files } };
      saveExpectedIdentities(pinned); console.log("[B16.1C] pinned release identities re-recorded");
    }
  });

  it("1. prompt → schematic proposal through the canonical build route (fake provider, zero credits)", async () => {
    signInAs("editor");
    const response = await buildMulti(jsonRequest("/api/schematic/build-multi", { prompt: BLINKER_ACCEPTANCE_PROMPT }));
    const body = await readJson<{ ok: boolean; netlist: BuildLogicalNetlist; explanation: string }>(response);
    expect(response.status, JSON.stringify(body).slice(0, 300)).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.netlist.components).toEqual(BLINKER_NETLIST.components);
    expect(body.netlist.connections).toEqual(BLINKER_NETLIST.connections);
    proposal = body.netlist;
    evidence.proposal = { components: proposal.components.map((c) => `${c.refDes}=${c.value}`), connections: proposal.connections.length };
  });

  it("2. the approved proposal lays out, validates electrically, and satisfies every §G schematic check", () => {
    const laidOut = layoutProposal(proposal, blinkerCatalog().cachedParts);
    expect(laidOut.validationOk, laidOut.violations.join(" | ")).toBe(true);
    schematic = laidOut;
    const report = verifyBlinkerSchematic(laidOut.netlist);
    console.log(`[B16.1C §G schematic]\n${table(report)}\n  computed: ${JSON.stringify(report.computed)}`);
    evidence.schematicChecks = report;
    expect(report.checks.filter((row) => !row.ok).map((row) => `${row.name}: ${row.detail}`)).toEqual([]);
    expect(report.computed.fNominalHz).toBeGreaterThanOrEqual(1.0);
    expect(report.computed.fNominalHz).toBeLessThanOrEqual(1.5);
    // Every instance carries exact atomic identity from the published catalog — nothing guessed.
    for (const instance of laidOut.state.kicadComponents ?? []) {
      expect(instance.atomicPartRevisionId, instance.refDes).toBe(blinkerCatalog().revisionFor(instance.partId, instance.value));
      expect(instance.footprintAssetVersionId, instance.refDes).toBeTruthy();
      expect(instance.mappingCertificateId, instance.refDes).toBeTruthy();
    }
  });

  it("3. a fresh browser hydrates from the server: no board, no snapshot, no authority, no release", async () => {
    signInAs("editor");
    const response = await pcbSyncGet(boardQuery());
    const body = await readJson<BoardLoad>(response);
    expect(response.status).toBe(404);
    expect(body.result.status).toBe("not_found");
    // [B16-A F12/F14] every subject verified-absent; the signed-in editor may not authorize a release.
    expect(body.manufacturing).toEqual({ snapshot: null, authority: null, latestRelease: null, integrity: { authority: "absent", snapshot: "absent", latestRelease: "absent", codes: [] }, viewer: { role: "pcb_editor", actorKind: "human", canRelease: false } });
  });

  it("4. component authority: a human reviewer binds every instance to its published atomic revision (server-owned records)", async () => {
    signInAs("admin");
    const bound: Array<{ ref: string; bindingRevisionId: string; lifecycleState: string }> = [];
    for (const instance of schematic.state.kicadComponents ?? []) {
      const response = await physicalBindings(jsonRequest("/api/physical-bindings", { operation: "bind_atomic_selection", componentInstanceId: instance.id, boardInstanceId: BOARD_ID, atomicPartRevisionId: instance.atomicPartRevisionId }));
      const body = await readJson<{ ok: boolean; bindingRevisionId: string; lifecycleState: string; alreadyBound: boolean }>(response);
      expect(response.status, `${instance.refDes}: ${JSON.stringify(body)}`).toBe(201);
      expect(body.lifecycleState).toBe("selected");
      bound.push({ ref: instance.refDes, bindingRevisionId: body.bindingRevisionId, lifecycleState: body.lifecycleState });
    }
    expect(bound).toHaveLength(9);
    evidence.bindings = bound;
    // A pcb_editor is NOT a reviewer: binding authority is a human reviewer/admin act.
    signInAs("editor");
    const refused = await physicalBindings(jsonRequest("/api/physical-bindings", { operation: "bind_atomic_selection", componentInstanceId: schematic.state.kicadComponents![0]!.id, boardInstanceId: BOARD_ID, atomicPartRevisionId: schematic.state.kicadComponents![0]!.atomicPartRevisionId }));
    // (The physical-bindings route maps this refusal to 422 with the bounded code — existing behaviour, pinned as-is.)
    expect(refused.status).toBe(422);
    expect((await readJson(refused)).code).toBe("PB_ATOMIC_BIND_HUMAN_REVIEWER_REQUIRED");
  });

  it("5. schematic → PCB: publish (against the hydrated snapshot revision) → preflight → apply through the canonical route", async () => {
    signInAs("editor");
    const publication = publicationRequest(schematic, { expectedSnapshotRevision: 0 });
    schematicRevision = publication.schematicRevision;
    const published = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "publish_demo_snapshot", request: publication }));
    const publishedBody = await readJson<{ ok: boolean; result: { snapshotRevision: number; schematicDigest: string; created: boolean } }>(published);
    expect(published.status, JSON.stringify(publishedBody).slice(0, 400)).toBe(201);
    expect(publishedBody.result.snapshotRevision).toBe(1);

    const preflight = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "preflight", request: preflightRequest({ schematicRevision }) }));
    const preflightBody = await readJson<{ ok: boolean; result: { status: string; blockers: unknown[]; plan?: { planId: string; planDigest: string; lifecycle: string; materializations: unknown[]; operations: unknown[] }; components: Array<{ componentInstanceId: string; status?: string }> } }>(preflight);
    expect(preflight.status, JSON.stringify(preflightBody).slice(0, 600)).toBe(200);
    expect(preflightBody.result.status, JSON.stringify(preflightBody.result.blockers).slice(0, 600)).toBe("ready_to_apply");
    expect(preflightBody.result.plan?.lifecycle).toBe("applicable");
    expect(preflightBody.result.plan?.materializations).toHaveLength(9);

    const applied = await pcbSyncPost(jsonRequest("/api/pcb-sync", { operation: "apply", request: applyRequest(preflightBody.result.plan!) }, { headers: { "x-sirkit-pcb-sync-opt-in": "true" } }));
    const appliedBody = await readJson<{ ok: boolean; result: { status: string; committedBoardRevision: string; committedBoardDigest: string; boardChanged: boolean } }>(applied);
    expect(applied.status, JSON.stringify(appliedBody).slice(0, 600)).toBe(200);
    expect(appliedBody.result.status).toBe("applied");
    appliedRevision = appliedBody.result.committedBoardRevision;
    evidence.sync = { schematicRevision, planId: preflightBody.result.plan!.planId, appliedRevision };
  });

  it("6. after refresh the server reconstructs the synced board; the PCB reproduces the schematic exactly (parity)", async () => {
    signInAs("editor");
    const response = await pcbSyncGet(boardQuery());
    const body = await readJson<BoardLoad>(response);
    expect(response.status).toBe(200);
    expect(body.result.status).toBe("found");
    expect(body.result.record!.revision).toBe(appliedRevision);
    expect(body.manufacturing!.snapshot).toMatchObject({ revision: 1, schematicRevision });
    expect(body.manufacturing!.authority).toBeNull();
    expect(body.manufacturing!.latestRelease).toBeNull();
    const parity = verifyBlinkerBoardParity(schematic.netlist, body.result.record!.board);
    console.log(`[B16.1C §G parity]\n${table(parity)}`);
    evidence.parityChecks = parity;
    expect(parity.checks.filter((row) => !row.ok).map((row) => `${row.name}: ${row.detail}`)).toEqual([]);
    expect(body.result.record!.board.tracks).toHaveLength(0);
  });

  it("7. qualification: server-owned component authority + current durable revision + recorded router → sealed authority", async () => {
    signInAs("editor");
    const response = await qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: BOARD_ID }));
    const body = await readJson(response);
    expect(response.status, JSON.stringify(body).slice(0, 1200)).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.idempotent).toBe(false);
    expect(body.fabricationProfileId).toBe("jlcpcb-2l");
    expect(String(body.componentAuthorityDigest)).toMatch(/^qualification-authority-[0-9a-f]{64}$/);
    expect(body.schematicRevision).toBe(schematicRevision);
    expect((body.rc02 as { remainingConnections: number }).remainingConnections).toBe(0);
    expect(String((body.rc01 as { digest: string }).digest)).toMatch(/^parity-[0-9a-f]{64}$/);
    expect(String((body.rc02 as { digest: string }).digest)).toMatch(/^route-[0-9a-f]{64}$/);
    expect(String((body.rc03 as { digest: string }).digest)).toMatch(/^capability-[0-9a-f]{64}$/);
    expect(body.boardRevision).not.toBe(appliedRevision);
    // [B16-A F9] every replay reproduces the COMMITTED qualification identities exactly.
    if (PINNED) {
      expect({ boardRevision: body.boardRevision, authorityRevision: body.authorityRevision, authorityDigest: body.authorityDigest, componentAuthorityDigest: body.componentAuthorityDigest, rc01Digest: (body.rc01 as { digest: string }).digest, rc02Digest: (body.rc02 as { digest: string }).digest, rc03Digest: (body.rc03 as { digest: string }).digest, routerExecutions: seams.observedRoutes.length }).toEqual(PINNED.qualification);
    }
    qualified = body;
    evidence.qualification = { boardRevision: body.boardRevision, authorityRevision: body.authorityRevision, authorityDigest: body.authorityDigest, componentAuthorityDigest: body.componentAuthorityDigest, rc01: body.rc01, rc02: body.rc02, rc03: body.rc03, routerExecutions: RECORDING ? seams.recorded?.order.length : seams.observedRoutes.length };

    const load = await readJson<BoardLoad>(await pcbSyncGet(boardQuery()));
    expect(load.result.record!.revision).toBe(body.boardRevision);
    expect(load.manufacturing!.authority).toMatchObject({ revision: body.authorityRevision, recordDigest: body.authorityDigest, boardRevision: body.boardRevision, current: true, fabricationProfileId: "jlcpcb-2l", actor: USERS.editor });
    routedBoard = load.result.record!.board;
    const routing = verifyBlinkerRouting(routedBoard);
    const parity = verifyBlinkerBoardParity(schematic.netlist, routedBoard);
    console.log(`[B16.1C §G routing]\n${table(routing)}\n${table(parity)}`);
    evidence.routingChecks = routing;
    expect(routing.checks.filter((row) => !row.ok).map((row) => `${row.name}: ${row.detail}`)).toEqual([]);
    expect(parity.checks.filter((row) => !row.ok).map((row) => `${row.name}: ${row.detail}`)).toEqual([]);
  }, QUALIFY_TIMEOUT_MS);

  it("8. re-qualifying the already-qualified board is idempotent: same authority, no router run", async () => {
    signInAs("editor");
    const before = RECORDING ? seams.recorded?.order.length ?? 0 : seams.observedRoutes.length;
    const response = await qualify(jsonRequest("/api/pcb/qualify", { designId: DESIGN_ID, boardId: BOARD_ID }));
    const body = await readJson(response);
    expect(response.status, JSON.stringify(body).slice(0, 400)).toBe(200);
    expect(body.idempotent).toBe(true);
    expect(body.authorityRevision).toBe(qualified.authorityRevision);
    expect(body.authorityDigest).toBe(qualified.authorityDigest);
    expect(body.boardRevision).toBe(qualified.boardRevision);
    expect(RECORDING ? seams.recorded?.order.length ?? 0 : seams.observedRoutes.length).toBe(before);
  });

  it("9. release is a human administrator's act: the editor who qualified is refused before any durable work", async () => {
    signInAs("editor");
    const response = await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: BOARD_ID }));
    expect(response.status).toBe(403);
    signInAs("viewer");
    expect((await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: BOARD_ID }))).status).toBe(403);
    signOut();
    expect((await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: BOARD_ID }))).status).toBe(401);
  });

  it("10. the administrator releases: verified ZIP, ledgered, byte-identical on repeat, visible after refresh", async () => {
    signInAs("admin");
    // [B16-A F6] the administrator's confirmation of the EXACT authority is mandatory; a release without it is refused.
    const unconfirmed = await release(jsonRequest("/api/pcb/release", { designId: DESIGN_ID, boardId: BOARD_ID }));
    expect(unconfirmed.status).toBe(400);
    expect((await readJson(unconfirmed)).code).toBe("MFG_AUTHORITY_CONFIRMATION_REQUIRED");
    const confirmed = { designId: DESIGN_ID, boardId: BOARD_ID, expectedAuthorityRevision: qualified.authorityRevision, expectedAuthorityDigest: qualified.authorityDigest };
    const first = await release(jsonRequest("/api/pcb/release", confirmed));
    if (first.status !== 200) throw new Error(`release failed: ${first.status} ${JSON.stringify(await readJson(first)).slice(0, 800)}`);
    const bytes = new Uint8Array(await first.arrayBuffer());
    const archiveSha = sha256(bytes);
    writeEvidence("b16-1c-acceptance-release.zip", bytes);
    releasedBytes = bytes;
    expect(first.headers.get("X-Sirkit-Archive-Sha256")).toBe(archiveSha);
    expect(first.headers.get("X-Sirkit-Release-Recorded")).toBe("created");
    expect(first.headers.get("X-Sirkit-Board-Revision")).toBe(qualified.boardRevision);
    expect(first.headers.get("X-Sirkit-Authority-Revision")).toBe(String(qualified.authorityRevision));
    expect(first.headers.get("X-Sirkit-Authority-Digest")).toBe(qualified.authorityDigest);
    const filename = /filename="([^"]+)"/.exec(first.headers.get("Content-Disposition") ?? "")?.[1];
    expect(filename).toMatch(/^sirkit-board-b16-1c-blinker-[0-9a-f]{12}\.zip$/);

    const second = await release(jsonRequest("/api/pcb/release", confirmed));
    expect(second.status).toBe(200);
    const bytes2 = new Uint8Array(await second.arrayBuffer());
    expect(Buffer.compare(Buffer.from(bytes), Buffer.from(bytes2))).toBe(0);
    expect(second.headers.get("X-Sirkit-Release-Recorded")).toBe("existing");
    expect(second.headers.get("X-Sirkit-Release-Id")).toBe(first.headers.get("X-Sirkit-Release-Id"));

    const manifestResponse = await release(jsonRequest("/api/pcb/release", { ...confirmed, format: "manifest" }));
    const manifestBody = await readJson<{ ok: boolean; releaseId: string; filename: string; archiveSha256: string; manifest: Record<string, unknown>; record: Record<string, unknown> }>(manifestResponse);
    expect(manifestResponse.status).toBe(200);
    expect(manifestBody.archiveSha256).toBe(archiveSha);
    expect(manifestBody.filename).toBe(filename);
    const manifest = manifestBody.manifest as { counts: Record<string, number>; source: Record<string, string>; evidence: { componentAuthority: { digest: string } }; files: Array<{ path: string; role: string; sha256: string }>; manufacturingProfile: { profileId: string } };
    expect(manifest.counts.components).toBe(9);
    expect(manifest.counts.remainingConnections).toBe(0);
    expect(manifest.source.boardRevision).toBe(qualified.boardRevision);
    expect(manifest.source.schematicRevision).toBe(schematicRevision);
    // The manifest binds the component-authority FACETS (digests over the exact
    // binding/footprint/mapping tuples); the ledger binds the qualification-authority digest itself.
    const facets = manifest.evidence.componentAuthority as unknown as Record<string, string>;
    expect(facets.digest).toMatch(/^component-authority-[0-9a-f]{64}$/);
    expect(facets.bindingRevision).toMatch(/^bindings-[0-9a-f]{64}$/);
    expect(facets.footprintLibraryRevision).toMatch(/^footprints-[0-9a-f]{64}$/);
    expect(facets.mappingRevision).toMatch(/^mappings-[0-9a-f]{64}$/);
    expect(facets.policyRevision).toBe("sirkit.qualification-package-vocabulary.v1");
    expect((manifestBody.record as { componentAuthorityDigest: string }).componentAuthorityDigest).toBe(qualified.componentAuthorityDigest);
    expect(manifest.manufacturingProfile.profileId).toBe("jlcpcb-2l");
    for (const role of ["copper_top", "copper_bottom", "mask_top", "mask_bottom", "outline", "pth_drill", "gerber_job"]) expect(manifest.files.some((file) => file.role === role), role).toBe(true);

    // Archive structure: every member under gerber/, no traversal, member bytes hash to the manifest.
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name]!.dir).sort();
    expect(names.every((name) => name.startsWith("gerber/") && !name.includes("..") && !name.startsWith("/"))).toBe(true);
    for (const file of manifest.files) {
      const member = zip.file(file.path);
      expect(member, file.path).not.toBeNull();
      expect(sha256(await member!.async("uint8array"))).toBe(file.sha256);
    }
    expect(names).toEqual([...manifest.files.map((file) => file.path), "gerber/release-manifest.json"].sort());

    // Refresh truth: the ledgered release is current for the current authority/board.
    const load = await readJson<BoardLoad>(await pcbSyncGet(boardQuery()));
    expect(load.manufacturing!.latestRelease).toMatchObject({ releaseId: manifestBody.releaseId, archiveSha256: archiveSha, filename, authorityRevision: qualified.authorityRevision, boardRevision: qualified.boardRevision, actor: USERS.admin, current: true });
    expect(load.manufacturing!.authority!.current).toBe(true);

    writeEvidence("b16-1c-acceptance-manifest.json", JSON.stringify(manifestBody.manifest, null, 2));
    evidence.release = { releaseId: manifestBody.releaseId, filename, archiveSha256: archiveSha, manifestContentDigest: (manifestBody.manifest as { manifestContentDigest: string }).manifestContentDigest, counts: manifest.counts, files: manifest.files.map((file) => ({ path: file.path, role: file.role, sha256: file.sha256 })) };
    // [B16-A F9] the released bytes, the manifest, every member and the ledger id equal the COMMITTED identities.
    if (PINNED) {
      expect({ releaseId: manifestBody.releaseId, filename, archiveSha256: archiveSha, archiveByteLength: bytes.byteLength, manifestContentDigest: (manifestBody.manifest as { manifestContentDigest: string }).manifestContentDigest, counts: manifest.counts, files: manifest.files.map((file) => ({ path: file.path, role: file.role, sha256: file.sha256 })) }).toEqual(PINNED.release);
    }
    expect(existsSync(join(evidenceDirectory(), "b16-1c-acceptance-release.zip"))).toBe(true);
  });

  it("11. independent archive verification: a separate RS-274X/Excellon reader agrees with the manifest and the board", async () => {
    expect(releasedBytes).not.toBeNull();
    const report = await verifyReleaseArchiveIndependently(releasedBytes!, { boardRevision: String(qualified.boardRevision), expectedComponents: 9 });
    console.log(`[B16.1C §G archive]\n${report.checks.map((row) => `  ${row.ok ? "PASS" : "FAIL"}  ${row.name}: ${row.detail}`).join("\n")}`);
    evidence.archiveChecks = report;
    expect(report.checks.filter((row) => !row.ok).map((row) => `${row.name}: ${row.detail}`)).toEqual([]);
    expect(report.ok).toBe(true);
    void routedBoard;
  });
});
