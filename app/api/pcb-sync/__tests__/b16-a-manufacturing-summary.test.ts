/**
 * B16-A (review of PR #5) — the reload-time manufacturing summary reader and
 * the board-read handler around it.
 *
 *  - F12: every durable subject (authority head, snapshot head, release
 *    ledger) reads under ONE policy — a record that fails verification is
 *    `corrupt` with its bounded code (never silently null, never rethrown
 *    raw, never a message or stack in the response) and can never be `current`;
 *  - F14: the trusted viewer's role/kind pass through and `canRelease`
 *    mirrors the release route (human project administrator only);
 *  - F25: `include` is closed (`foo` → PS_API_UNKNOWN_FIELD; `manufacturing`
 *    without a configured reader → PS_API_UNKNOWN_FIELD), and with a reader
 *    the summary — integrity and viewer included — rides beside the board
 *    load (200 found / 404 not_found), and round-trips through the client.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryDurableWorkflowRepository } from "@/app/lib/durable-workflow/repository";
import type { DurableAggregateIdentity, DurableAggregateRecord, DurableWorkflowRepository } from "@/app/lib/durable-workflow/types";
import { DurableManufacturingAuthorityStore } from "@/app/lib/pcb/fab/authority-store";
import { DurableManufacturingReleaseLedger } from "@/app/lib/pcb/fab/release-ledger";
import { authoritativeBoardDigest, type ManufacturingReleaseAuthority } from "@/app/lib/pcb/fab/release-gate"; // [B23-B3, 2026-10-04] + authoritativeBoardDigest (D23-17): the authority's board digest is in its own domain
import { PCB_BOARD_ASSEMBLY_VARIANT_ID, pcbDesignInstanceId } from "@/app/lib/pcb/board-identity";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { snapshotBase } from "@/app/lib/pcb-sync/__tests__/fixtures";
import { makeBoardRecord } from "@/app/lib/pcb-sync/board";
import { PcbSyncClient } from "@/app/lib/pcb-sync/client";
import { DurablePcbSyncSnapshotStore } from "@/app/lib/pcb-sync/durable";
import type { PcbSyncRepository } from "@/app/lib/pcb-sync/repository";
import { authoritativeSnapshotDigest } from "@/app/lib/pcb-sync/stable";
import { createPcbSyncBoardGetCore, type PcbSyncManufacturingSummary } from "../handler";
import { createManufacturingSummaryReader, MANUFACTURING_SUMMARY_READ_FAILED } from "../manufacturing-summary";

const SCOPE = { tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1" };
const DESIGN_ID = pcbDesignInstanceId(SCOPE.projectId);
const AUTHORITY_SCOPE = { ...SCOPE, designId: DESIGN_ID };
const BOARD = makeBoardRecord({ ...SCOPE, board: JSON.parse(JSON.stringify(createEmptyBoard())), updatedAt: "2026-09-07T12:00:00.000Z" });
const CURRENT = { revision: BOARD.revision, digest: BOARD.digest, board: BOARD.board }; // [B23-B3, 2026-10-04] reviewed pin move (D23-17): the reader recomputes the authority's digest from the loaded board, so the board travels with its revision and digest, as the handler hands it over
const ADMIN = { role: "project_admin", actorKind: "human" };
const EDITOR = { role: "pcb_editor", actorKind: "human" };
const AI_ADMIN = { role: "project_admin", actorKind: "ai" };
const ABSENT = { authority: "absent", snapshot: "absent", latestRelease: "absent", codes: [] } as const;
const AUTHORITY_SCHEMA = "sirkit.manufacturing-release-authority.v1";
const SNAPSHOT_SCHEMA = "sirkit.pcb-sync-snapshot.v1";

/** The fields the summary reads from a sealed authority; the store digests whatever it is handed. */
function authority(): ManufacturingReleaseAuthority {
  return {
    schemaVersion: AUTHORITY_SCHEMA,
    ...AUTHORITY_SCOPE,
    boardRevision: BOARD.revision,
    boardDigest: authoritativeBoardDigest(BOARD.board), // [B23-B3, 2026-10-04] reviewed pin move (D23-17): an authority's boardDigest is `pcb-authority-<sha256>` (release-gate.ts authoritativeBoardDigest), never the board record's pcbSyncDigest; the fixture held the other domain, which the revision-only flag never read
    schematic: { revision: "schematic-r1", digest: "sha256:schematic-r1" },
    componentAuthority: { digest: "component-authority-r1" },
    manufacturingRuleProfile: { profileId: "jlcpcb-2l" },
    sourceDate: "2026-09-07T11:00:00.000Z",
    actor: "u-editor",
  } as unknown as ManufacturingReleaseAuthority;
}

async function seedAuthority(workflow: DurableWorkflowRepository): Promise<{ revision: number; recordDigest: string }> {
  return new DurableManufacturingAuthorityStore(workflow).save(authority(), { idempotencyKey: "qualify-1", savedAt: "2026-09-07T11:00:00.000Z" });
}

async function seedRelease(workflow: DurableWorkflowRepository, saved: { revision: number; recordDigest: string }): Promise<void> {
  await new DurableManufacturingReleaseLedger(workflow).record(AUTHORITY_SCOPE, { releaseId: "mfg-release-1", archiveSha256: "a".repeat(64), manifestContentDigest: "mfg-manifest-1", filename: "sirkit-board-1-release-1.zip", authorityRecordDigest: saved.recordDigest, authorityRevision: saved.revision, boardRevision: BOARD.revision, boardDigest: authoritativeBoardDigest(BOARD.board), schematicRevision: "schematic-r1", componentAuthorityDigest: "component-authority-r1", actor: "u-admin", releasedAt: "2026-09-07T12:30:00.000Z" }); // [B23-B3, 2026-10-04] the ledger records the authority's board digest (the release route writes stored.authority.boardDigest)
}

async function seedSnapshot(workflow: DurableWorkflowRepository): Promise<void> {
  const base = { ...snapshotBase(), tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId, designId: DESIGN_ID, assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID };
  await new DurablePcbSyncSnapshotStore(workflow).publish({ ...base, snapshotDigest: authoritativeSnapshotDigest(base) }, { expectedRevision: 0, idempotencyKey: "publish-1", publishedAt: "2026-09-07T10:00:00.000Z" });
}

type Tamper = (identity: DurableAggregateIdentity, record: DurableAggregateRecord | null) => DurableAggregateRecord | null;
/** The same in-memory store, with `loadHead` passed through `tamper` — a durable head that reads back differently from what was committed. */
function tamperedRepository(inner: InMemoryDurableWorkflowRepository, tamper: Tamper): { repository: DurableWorkflowRepository; intercepted(): number } {
  let intercepted = 0;
  const repository: DurableWorkflowRepository = {
    async loadHead<T extends object = object>(identity: DurableAggregateIdentity): Promise<DurableAggregateRecord<T> | null> {
      const record = await inner.loadHead<T>(identity);
      let next: DurableAggregateRecord | null;
      try { next = tamper(identity, record); } catch (error) { intercepted += 1; throw error; }
      if (next !== record) intercepted += 1;
      return next as DurableAggregateRecord<T> | null;
    },
    listHeads: inner.listHeads.bind(inner), loadRecord: inner.loadRecord.bind(inner), history: inner.history.bind(inner), getReplay: inner.getReplay.bind(inner), commit: inner.commit.bind(inner),
    claimOutbox: inner.claimOutbox.bind(inner), completeOutbox: inner.completeOutbox.bind(inner), failOutbox: inner.failOutbox.bind(inner), listOutbox: inner.listOutbox.bind(inner),
  };
  return { repository, intercepted: () => intercepted };
}
const payloadSchema = (record: DurableAggregateRecord | null): string | undefined => (record?.payload as { schemaVersion?: string } | undefined)?.schemaVersion;
const mutatePayload = (schema: string, patch: Record<string, unknown>): Tamper => (_identity, record) => payloadSchema(record) === schema ? { ...record!, payload: { ...record!.payload, ...patch } } : record;
const throwFor = (keyPrefix: string, error: Error): Tamper => (identity, record) => { if (identity.aggregateKey.startsWith(keyPrefix)) throw error; return record; };

function stubRepository(record: typeof BOARD | null): PcbSyncRepository {
  return { getBoard: async () => (record ? structuredClone(record) : null) } as unknown as PcbSyncRepository;
}

beforeEach(() => { vi.spyOn(console, "warn").mockImplementation(() => undefined); vi.spyOn(console, "error").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe("B16-A F12 — manufacturing summary integrity", () => {
  it("absent everything → every subject absent with no codes; the administrator viewer passes through", async () => {
    const summary = await createManufacturingSummaryReader(new InMemoryDurableWorkflowRepository())(SCOPE, null, ADMIN);
    expect(summary).toEqual({ snapshot: null, authority: null, latestRelease: null, integrity: ABSENT, viewer: { role: "project_admin", actorKind: "human", canRelease: true } });
  });

  it("control: an intact authority head, ledgered release and snapshot head all verify — authority and release are current for the board", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const saved = await seedAuthority(workflow);
    await seedRelease(workflow, saved);
    await seedSnapshot(workflow);
    const summary = await createManufacturingSummaryReader(workflow)(SCOPE, CURRENT, ADMIN);
    expect(summary.integrity).toEqual({ authority: "ok", snapshot: "ok", latestRelease: "ok", codes: [] });
    expect(summary.authority).toMatchObject({ revision: saved.revision, recordDigest: saved.recordDigest, boardRevision: BOARD.revision, fabricationProfileId: "jlcpcb-2l", actor: "u-editor", current: true });
    expect(summary.latestRelease).toMatchObject({ releaseId: "mfg-release-1", authorityRecordDigest: saved.recordDigest, current: true });
    expect(summary.snapshot).toMatchObject({ revision: 1, schematicRevision: "schematic-r1" });
  });

  it("a tampered authority head → authority null, integrity.authority corrupt with MFG_AUTHORITY_RECORD_DIGEST_MISMATCH, and the ledgered release can no longer be current", async () => {
    const inner = new InMemoryDurableWorkflowRepository();
    const saved = await seedAuthority(inner);
    await seedRelease(inner, saved);
    const { repository, intercepted } = tamperedRepository(inner, mutatePayload(AUTHORITY_SCHEMA, { boardRevision: "tampered-after-qualification" }));
    const summary = await createManufacturingSummaryReader(repository)(SCOPE, CURRENT, ADMIN);
    expect(intercepted()).toBeGreaterThan(0);
    expect(summary.authority).toBeNull();
    expect(summary.integrity).toEqual({ authority: "corrupt", snapshot: "absent", latestRelease: "ok", codes: ["MFG_AUTHORITY_RECORD_DIGEST_MISMATCH"] });
    expect(summary.latestRelease).toMatchObject({ releaseId: "mfg-release-1", current: false });
    expect(summary.viewer.canRelease).toBe(true); // capability is about the viewer; the corrupt record is what blocks release, visibly
  });

  it("a tampered snapshot head → snapshot null with PS_SNAPSHOT_DIGEST_MISMATCH; the other subjects are unaffected", async () => {
    const inner = new InMemoryDurableWorkflowRepository();
    const saved = await seedAuthority(inner);
    await seedSnapshot(inner);
    const { repository, intercepted } = tamperedRepository(inner, mutatePayload(SNAPSHOT_SCHEMA, { schematicRevision: "schematic-tampered" }));
    const summary = await createManufacturingSummaryReader(repository)(SCOPE, CURRENT, ADMIN);
    expect(intercepted()).toBe(1);
    expect(summary.snapshot).toBeNull();
    expect(summary.integrity).toEqual({ authority: "ok", snapshot: "corrupt", latestRelease: "absent", codes: ["PS_SNAPSHOT_DIGEST_MISMATCH"] });
    expect(summary.authority).toMatchObject({ revision: saved.revision, current: true });
  });

  it("a throwing ledger read → latestRelease corrupt under the same policy: a bounded code passes through, an unclassified failure becomes PS_MANUFACTURING_SUMMARY_READ_FAILED and leaks nothing", async () => {
    const inner = new InMemoryDurableWorkflowRepository();
    const saved = await seedAuthority(inner);
    await seedRelease(inner, saved);
    const bounded = tamperedRepository(inner, throwFor("mfg-release-ledger:", new Error("DW_STORE_UNAVAILABLE")));
    const summary = await createManufacturingSummaryReader(bounded.repository)(SCOPE, CURRENT, ADMIN);
    expect(bounded.intercepted()).toBe(1);
    expect(summary.latestRelease).toBeNull();
    expect(summary.integrity).toEqual({ authority: "ok", snapshot: "absent", latestRelease: "corrupt", codes: ["DW_STORE_UNAVAILABLE"] });
    expect(summary.authority).toMatchObject({ revision: saved.revision, current: true });

    const raw = tamperedRepository(inner, throwFor("mfg-release-ledger:", new Error("connection reset by peer at /var/lib/postgres/socket (see stack)")));
    const unclassified = await createManufacturingSummaryReader(raw.repository)(SCOPE, CURRENT, ADMIN);
    expect(raw.intercepted()).toBe(1);
    expect(unclassified.integrity).toEqual({ authority: "ok", snapshot: "absent", latestRelease: "corrupt", codes: [MANUFACTURING_SUMMARY_READ_FAILED] });
    expect(JSON.stringify(unclassified)).not.toMatch(/connection reset|postgres|stack|\/var\//);
  });
});

describe("B16-A F14 — viewer passthrough", () => {
  it.each([
    [ADMIN, true],
    [EDITOR, false],
    [AI_ADMIN, false],
    [{ role: "reviewer", actorKind: "human" }, false],
  ])("viewer %o → canRelease %s (human project administrator only — the release route's exact refusal)", async (viewer, canRelease) => {
    const summary = await createManufacturingSummaryReader(new InMemoryDurableWorkflowRepository())(SCOPE, null, viewer);
    expect(summary.viewer).toEqual({ role: viewer.role, actorKind: viewer.actorKind, canRelease });
  });

  it("no viewer supplied → unknown role/kind and canRelease false (fails closed)", async () => {
    const summary = await createManufacturingSummaryReader(new InMemoryDurableWorkflowRepository())(SCOPE, null);
    expect(summary.viewer).toEqual({ role: "unknown", actorKind: "unknown", canRelease: false });
  });
});

describe("B16-A F25 — board read `include` surface and the summary beside the board", () => {
  const reader = (workflow: DurableWorkflowRepository = new InMemoryDurableWorkflowRepository()) => createManufacturingSummaryReader(workflow);
  const readJson = async (response: Response) => ({ status: response.status, body: await response.json() as { ok: boolean; code?: string; result: { status: string }; manufacturing?: PcbSyncManufacturingSummary } });

  it("include=foo → 422 PS_API_UNKNOWN_FIELD, with or without a reader", async () => {
    for (const core of [createPcbSyncBoardGetCore(stubRepository(BOARD), () => "opt_in"), createPcbSyncBoardGetCore(stubRepository(BOARD), () => "opt_in", reader())]) {
      const { status, body } = await readJson(await core(SCOPE, { boardId: SCOPE.boardId, include: "foo" }, ADMIN));
      expect(status).toBe(422);
      expect(body).toMatchObject({ ok: false, code: "PS_API_UNKNOWN_FIELD" });
    }
  });

  it("include=manufacturing without a configured reader → 422 PS_API_UNKNOWN_FIELD (the field does not exist on that surface)", async () => {
    const { status, body } = await readJson(await createPcbSyncBoardGetCore(stubRepository(BOARD), () => "opt_in")(SCOPE, { boardId: SCOPE.boardId, include: "manufacturing" }, ADMIN));
    expect(status).toBe(422);
    expect(body).toMatchObject({ ok: false, code: "PS_API_UNKNOWN_FIELD" });
  });

  it("without include the response carries no manufacturing block", async () => {
    const { status, body } = await readJson(await createPcbSyncBoardGetCore(stubRepository(BOARD), () => "opt_in", reader())(SCOPE, { boardId: SCOPE.boardId }, ADMIN));
    expect(status).toBe(200);
    expect(body.result.status).toBe("found");
    expect(body.manufacturing).toBeUndefined();
  });

  it("include=manufacturing with a reader → the summary (integrity + viewer) rides beside a found board (200) and a missing one (404)", async () => {
    const summaryReader = reader();
    const found = await readJson(await createPcbSyncBoardGetCore(stubRepository(BOARD), () => "opt_in", summaryReader)(SCOPE, { boardId: SCOPE.boardId, include: "manufacturing" }, ADMIN));
    expect(found.status).toBe(200);
    expect(found.body.result.status).toBe("found");
    expect(found.body.manufacturing).toEqual({ snapshot: null, authority: null, latestRelease: null, integrity: ABSENT, viewer: { role: "project_admin", actorKind: "human", canRelease: true } });
    const missing = await readJson(await createPcbSyncBoardGetCore(stubRepository(null), () => "opt_in", summaryReader)(SCOPE, { boardId: SCOPE.boardId, include: "manufacturing" }, EDITOR));
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ ok: true, result: { status: "not_found" } });
    expect(missing.body.manufacturing).toEqual({ snapshot: null, authority: null, latestRelease: null, integrity: ABSENT, viewer: { role: "pcb_editor", actorKind: "human", canRelease: false } });
  });

  it("the viewer the route hands to the core is what the summary reports (pcb_editor → canRelease false; no viewer → unknown)", async () => {
    const core = createPcbSyncBoardGetCore(stubRepository(BOARD), () => "opt_in", reader());
    const editor = await readJson(await core(SCOPE, { boardId: SCOPE.boardId, include: "manufacturing" }, EDITOR));
    expect(editor.body.manufacturing!.viewer).toEqual({ role: "pcb_editor", actorKind: "human", canRelease: false });
    const anonymous = await readJson(await core(SCOPE, { boardId: SCOPE.boardId, include: "manufacturing" }));
    expect(anonymous.body.manufacturing!.viewer).toEqual({ role: "unknown", actorKind: "unknown", canRelease: false });
  });

  it("a tampered authority head reaches the browser as HTTP 200 with integrity.authority corrupt — not an error envelope, not 'authority none'", async () => {
    const inner = new InMemoryDurableWorkflowRepository();
    const saved = await seedAuthority(inner);
    await seedRelease(inner, saved);
    const { repository } = tamperedRepository(inner, mutatePayload(AUTHORITY_SCHEMA, { actor: "someone-else" }));
    const { status, body } = await readJson(await createPcbSyncBoardGetCore(stubRepository(BOARD), () => "opt_in", reader(repository))(SCOPE, { boardId: SCOPE.boardId, include: "manufacturing" }, ADMIN));
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.manufacturing!.integrity).toEqual({ authority: "corrupt", snapshot: "absent", latestRelease: "ok", codes: ["MFG_AUTHORITY_RECORD_DIGEST_MISMATCH"] });
    expect(body.manufacturing!.authority).toBeNull();
    expect(body.manufacturing!.latestRelease!.current).toBe(false);
  });

  it("round trip through PcbSyncClient.loadBoardWithManufacturing: the truth arrives with integrity and viewer; a manufacturing block missing them is an invalid response, never 'no truth'", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    const saved = await seedAuthority(workflow);
    const core = createPcbSyncBoardGetCore(stubRepository(BOARD), () => "opt_in", reader(workflow));
    const transport = async (input: RequestInfo | URL) => core(SCOPE, Object.fromEntries(new URL(String(input), "http://localhost").searchParams), ADMIN);
    const client = new PcbSyncClient({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId }, transport);
    const loaded = await client.loadBoardWithManufacturing(SCOPE.boardId);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.load.status).toBe("found");
    expect(loaded.value.manufacturing).toMatchObject({ integrity: { authority: "ok", snapshot: "absent", latestRelease: "absent", codes: [] }, viewer: { role: "project_admin", actorKind: "human", canRelease: true }, authority: { revision: saved.revision, current: true } });

    const legacy = async (input: RequestInfo | URL) => {
      const response = await transport(input);
      const body = await response.json() as { manufacturing: Record<string, unknown> };
      const { integrity: _integrity, viewer: _viewer, ...withoutVerdicts } = body.manufacturing; void _integrity; void _viewer;
      return Response.json({ ...body, manufacturing: withoutVerdicts }, { status: response.status });
    };
    const degraded = await new PcbSyncClient({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, branchId: SCOPE.branchId }, legacy).loadBoardWithManufacturing(SCOPE.boardId);
    expect(degraded).toMatchObject({ ok: false, code: "PS_API_INVALID_RESPONSE" });
  });
});

// [B23-B3, 2026-10-04] D23-17: the digest-only case this suite never asserted (discovery 9.4, 9.5 item 30). The flag compared the
// authority by revision only, though the header said revision/digest; `current.digest` is a pcbSyncDigest of the revision payload,
// which sorts the board's arrays, so it cannot see what the release route compares (`authoritativeBoardDigest`, release/route.ts).
describe("[B23-B3] D23-17 — the current flag compares the authority's board revision AND its authoritative digest", () => {
  const net0 = createEmptyBoard().nets[0]!;
  const vcc = { id: 1, name: "VCC", stableId: "net:vcc", endpointKeys: [] as string[] };
  const gnd = { id: 2, name: "GND", stableId: "net:gnd", endpointKeys: [] as string[] };
  const QUALIFIED = makeBoardRecord({ ...SCOPE, board: { ...createEmptyBoard(), nets: [net0, vcc, gnd] }, updatedAt: "2026-10-04T10:00:00.000Z" });
  const REORDERED = makeBoardRecord({ ...SCOPE, board: { ...createEmptyBoard(), nets: [net0, gnd, vcc] }, updatedAt: "2026-10-04T10:05:00.000Z" });
  const seedQualified = async (workflow: DurableWorkflowRepository) => {
    const saved = await new DurableManufacturingAuthorityStore(workflow).save({ ...authority(), boardRevision: QUALIFIED.revision, boardDigest: authoritativeBoardDigest(QUALIFIED.board) } as ManufacturingReleaseAuthority, { idempotencyKey: "qualify-b3", savedAt: "2026-10-04T11:00:00.000Z" });
    await new DurableManufacturingReleaseLedger(workflow).record(AUTHORITY_SCOPE, { releaseId: "mfg-release-b3", archiveSha256: "b".repeat(64), manifestContentDigest: "mfg-manifest-b3", filename: "sirkit-board-1-b3.zip", authorityRecordDigest: saved.recordDigest, authorityRevision: saved.revision, boardRevision: QUALIFIED.revision, boardDigest: authoritativeBoardDigest(QUALIFIED.board), schematicRevision: "schematic-r1", componentAuthorityDigest: "component-authority-r1", actor: "u-admin", releasedAt: "2026-10-04T11:30:00.000Z" });
    return saved;
  };

  it("the same board revision with another authoritative digest (the nets in another order: one revision id, one pcbSyncDigest, two board JSONs) is not current, nor is its release; the qualified board is; a revision-only move is not current either", async () => {
    expect(REORDERED.revision).toBe(QUALIFIED.revision);
    expect(REORDERED.digest).toBe(QUALIFIED.digest);
    expect(authoritativeBoardDigest(REORDERED.board)).not.toBe(authoritativeBoardDigest(QUALIFIED.board));
    const workflow = new InMemoryDurableWorkflowRepository();
    await seedQualified(workflow);
    const read = (record: typeof QUALIFIED) => createManufacturingSummaryReader(workflow)(SCOPE, { revision: record.revision, digest: record.digest, board: record.board }, ADMIN);
    const qualified = await read(QUALIFIED);
    expect({ authority: qualified.authority?.current, release: qualified.latestRelease?.current }).toEqual({ authority: true, release: true });
    const reordered = await read(REORDERED);
    expect({ authority: reordered.authority?.current, release: reordered.latestRelease?.current }).toEqual({ authority: false, release: false });
    expect(reordered.integrity).toEqual({ authority: "ok", snapshot: "absent", latestRelease: "ok", codes: [] });
    const moved = await read(BOARD);
    expect({ authority: moved.authority?.current, release: moved.latestRelease?.current }).toEqual({ authority: false, release: false });
  });

  it("through the board read: the handler hands the loaded board to the reader, so a re-serialised head with the same revision reads not current", async () => {
    const workflow = new InMemoryDurableWorkflowRepository();
    await seedQualified(workflow);
    for (const [record, current] of [[QUALIFIED, true], [REORDERED, false]] as const) {
      const response = await createPcbSyncBoardGetCore(stubRepository(record), () => "opt_in", createManufacturingSummaryReader(workflow))(SCOPE, { boardId: SCOPE.boardId, include: "manufacturing" }, ADMIN);
      const body = await response.json() as { manufacturing: PcbSyncManufacturingSummary };
      expect(body.manufacturing.authority!.current, record.revision).toBe(current);
      expect(body.manufacturing.latestRelease!.current).toBe(current);
    }
  });
});
