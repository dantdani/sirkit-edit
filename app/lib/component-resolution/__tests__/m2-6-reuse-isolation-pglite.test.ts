/**
 * [PR-M, 2026-10-18] Runbook M.5 item 5 over the production services and PostgreSQL: REUSE from durable storage does no network,
 * download or model work (counting transport, embedding and reranker all at 0); a second permitted project reuses the published part; a
 * foreign tenant reads nothing; a withdrawal is honoured (never newly selected, the existing pin still materializes); an upstream byte
 * change is a new object, candidate and revision while the old pin is unchanged; a discovery row makes an MPN-variant recallable.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/app/lib/db/schema";
import { loadMigrationManifest } from "@/app/lib/db/migrations/manifest";
import { migrateDatabase } from "@/app/lib/db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "@/app/lib/db/disposable-postgres";

const seams = vi.hoisted(() => ({ embedded: [] as string[], reranked: 0 }));
let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/app/lib/db/client", () => ({ getDb: () => orm }));
vi.mock("@/app/lib/embeddings", async (original) => ({ ...(await original() as object), embedQuery: vi.fn(async (text: string) => { seams.embedded.push(text); throw new Error("no embedding provider in this test"); }) }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class CountingReranker { messages = { create: () => { seams.reranked += 1; throw new Error("no reranker in this test"); } }; } }));

import { resetComponentResolutionRuntimeFactory } from "@/app/lib/component-resolution/task/runtime";
import { resetCadSourceInjection } from "@/app/lib/component-resolution/task/worker-runtime";
import { resetMembershipRepositoryFactory } from "@/app/lib/auth/identity-runtime";
import { loadAcquisitionHandoff } from "@/app/lib/component-resolution/acquisition/handoff";
import { DurableAcquisitionCandidateStore } from "@/app/lib/component-resolution/acquisition/candidate";
import { DurableAcquiredObjectStore } from "@/app/lib/acquisition/cad-object-store";
import { PostgresDurableWorkflowRepository } from "@/app/lib/durable-workflow/server-repository";
import { loadPublishedPortableSnapshot, loadSelectablePortableSnapshot } from "@/app/lib/atomic/server-catalog";
import { withdrawPublishedAtomicRevision } from "@/app/lib/atomic/server-repository";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import type { CadAcquisitionTaskView } from "@/app/lib/acquisition/cad-acquisition-contract";
import { chainMemberships, chainRuntime, chainSheet, human, publishBy, seedChainCatalog, submitAndApprove, USERS, type ChainCatalog, type ChainRuntime } from "./_m2-chain";
import { SYMBOL_1N4148 } from "./_m2-fixtures";

const P1 = { tenantId: "local", projectId: "p-m2-reuse-1", branchId: "main" } as const;
const P2 = { tenantId: "local", projectId: "p-m2-reuse-2", branchId: "main" } as const;
const FOREIGN = { tenantId: "tenant-elsewhere", projectId: "p-m2-reuse-1", branchId: "main" } as const;
let catalog: ChainCatalog;
const vector = (): string => `[${new Array(1_536).fill(0).map((_, index) => (index === 0 ? 1 : 0)).join(",")}]`;
const requester = { principalId: USERS.requester, role: "pcb_editor" as const, membershipRevision: null, actorKind: "human" as const };
const REQUEST = { componentIds: ["kc-d1", "kc-d2"], requirement: { mounting: "through_hole", packageCode: "DO-35" }, assetKinds: ["symbol", "footprint", "datasheet"] };
const view = (answer: { body: Record<string, unknown> }): CadAcquisitionTaskView => answer.body.task as CadAcquisitionTaskView;

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  catalog = await seedChainCatalog(pg, vector);
}, 240_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => { vi.stubEnv("DATABASE_URL", "postgres://catalog-configured-placeholder"); seams.embedded.length = 0; seams.reranked = 0; resetAdmissionControl(); vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetComponentResolutionRuntimeFactory(); resetCadSourceInjection(); resetMembershipRepositoryFactory(); });

/** Acquire, hand off, publish by two humans and offer: the published revision id. */
async function acquireAndPublish(chain: ChainRuntime, scope: typeof P1, memberships: ReturnType<typeof chainMemberships>, request: Record<string, unknown> = REQUEST, discovery = false): Promise<{ taskId: string; revisionId: string; handoffId: string }> {
  const started = await chain.service.start(scope, requester, { request, schematic: chainSheet(catalog), headMark: null, origin: "page" });
  expect(started.status, JSON.stringify(started.body)).toBe(202);
  const taskId = view(started).taskId;
  await chain.runWorker();
  const sent = await chain.service.handoff(scope, human(USERS.requester, "pcb_editor"), null, { taskId, clientActionId: `send:${taskId}` });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  const handoff = (await loadAcquisitionHandoff(chain.handoffDeps, sent.body.handoffId))!;
  const deps = chain.publicationDeps(memberships);
  const approved = await submitAndApprove(deps, handoff.package.spec, handoff.package.links, discovery);
  const published = await publishBy(deps, approved.requestId);
  return { taskId, revisionId: published.request.publication!.revisionId, handoffId: handoff.handoffId };
}

describe("[PR-M M.5-5] reuse from durable storage, isolation, withdrawal, upstream change", { timeout: 240_000 }, () => {
  it("a reopen and a second permitted project reuse the published part with ZERO network, download or model calls; a foreign tenant reads nothing", async () => {
    const memberships = chainMemberships([P1, P2]);
    const chain = chainRuntime();
    const { taskId, revisionId } = await acquireAndPublish(chain, P1, memberships);
    const downloads = chain.transport.requests.length;
    expect(downloads).toBe(4);

    // the reopen: the same project reads its task from durable storage; nothing is called
    const reopened = await chain.service.read(P1, taskId);
    expect(view(reopened).taskId).toBe(taskId);
    expect((await chain.service.list(P1)).body.tasks).toHaveLength(1);

    // a second permitted project, the same sheet: the local search finds the published revision of the SAME part; nothing is downloaded
    const second = await chain.service.start(P2, requester, { request: REQUEST, schematic: chainSheet(catalog), headMark: null, origin: "page" });
    expect(second.status).toBe(202);
    expect(view(second).taskId).not.toBe(taskId);
    await chain.runWorker();
    const reused = view(await chain.service.read(P2, view(second).taskId));
    expect(reused).toMatchObject({ state: "awaiting-review", nextAction: "offer-replacement", candidate: null, handoff: null, proposal: { atomicPartRevisionId: revisionId, origin: "own-part", reused: true } });
    expect(reused.stages.filter((stage) => stage.status === "skipped").map((stage) => stage.stage)).toEqual(["source-selection", "retrieve", "validate", "handoff", "awaiting-publication"]);
    expect(chain.transport.requests.length).toBe(downloads); // ZERO network / download calls
    expect(seams.embedded).toEqual([]); // ZERO embedding (paid) calls
    expect(seams.reranked).toBe(0); // ZERO model calls

    // [PR-L/M integration, 2026-10-18] M2-SEC-2: a task cancelled while its replacement is offered never takes a receipt afterwards (a page
    // that applied the batch anyway, or a stale tab): the store refuses it, the task stays cancelled and records nothing
    const offeredTaskId = view(second).taskId;
    expect(await chain.service.control(P2, requester, { taskId: offeredTaskId, action: "cancel", clientActionId: "stop-offered" })).toMatchObject({ status: 200, body: { task: { state: "cancelled" } } });
    const late = await chain.store.control({ scope: P2, taskId: offeredTaskId, principalId: USERS.requester, action: "record-applied", clientActionId: "late-receipt", applied: { receiptId: "r-late", schematicDigestAfter: "eng1-late", at: new Date(chain.clock.now).toISOString() }, preflight: { unresolvedCount: 0, unresolvedRefDes: [], at: new Date(chain.clock.now).toISOString(), verifiedDigest: "eng1-late" } });
    expect(late).toMatchObject({ ok: false, code: "COMPONENT_RESOLUTION_STATE_CONFLICT" });
    expect(view(await chain.service.read(P2, offeredTaskId))).toMatchObject({ state: "cancelled", applied: null, preflight: null });

    // a foreign tenant (or a private project) reads nothing: tasks, candidates and objects are scoped; an unknown id is the same refusal
    expect((await chain.service.read(FOREIGN, taskId)).status).toBe(404);
    expect((await chain.service.read(P1, "cr-task:00000000000000000000000000000000")).status).toBe(404);
    expect((await chain.service.list(FOREIGN)).body.tasks).toEqual([]);
    const task = view(reopened);
    const repository = new PostgresDurableWorkflowRepository();
    await expect(new DurableAcquisitionCandidateStore(repository).get(FOREIGN, task.candidate!.candidateId)).rejects.toMatchObject({ code: "ACQUISITION_CANDIDATE_NOT_FOUND" });
    for (const object of task.candidate!.objects) expect(await new DurableAcquiredObjectStore(repository).has(FOREIGN, object.sha256)).toBe(false);
    // the governance inbox is readable only with the governance scope's ids
    expect(await loadAcquisitionHandoff({ ...chain.handoffDeps, governance: { tenantId: FOREIGN.tenantId, projectId: "m2-catalog-governance" } }, task.handoff!.handoffId)).toBeNull();
  });

  it("a withdrawn revision is never newly selected (a new task acquires instead of reusing) while an existing pin still materializes", async () => {
    const P3 = { tenantId: "local", projectId: "p-m2-withdrawn", branchId: "main" } as const;
    chainMemberships([P3]); // the memberships of the withdrawn-pin project (installed for the task revalidation)
    const chain = chainRuntime(Date.parse("2026-10-18T12:00:00.000Z"));
    const sheet = chainSheet(catalog);
    // the part's published revision from the first test: find it by its link
    const [link] = (await pg.db.query<{ atomic_part_revision_id: string }>("SELECT atomic_part_revision_id FROM parts_atomic_links WHERE part_id = $1 AND value_key = ''", [catalog.ids.get("1n4148")])).rows;
    expect(link).toBeDefined();
    await withdrawPublishedAtomicRevision({ revisionId: link!.atomic_part_revision_id, to: "deprecated", actorId: USERS.admin, actorRole: "admin", reason: "PR-M M2: deprecated to prove reuse honours withdrawal" });
    expect(await loadSelectablePortableSnapshot(link!.atomic_part_revision_id)).toBeNull(); // never newly selected
    expect(await loadPublishedPortableSnapshot(link!.atomic_part_revision_id)).not.toBeNull(); // an existing pin keeps materializing
    const started = await chain.service.start(P3, requester, { request: REQUEST, schematic: sheet, headMark: null, origin: "page" });
    await chain.runWorker();
    const task = view(await chain.service.read(P3, view(started).taskId));
    expect(task.proposal).toBeNull();
    expect(task.stages.find((stage) => stage.stage === "local-search")!.evidence).toContain("withdrawn");
    expect(task).toMatchObject({ state: "awaiting-review", candidate: { verdict: "validated" } }); // acquired again: the same bytes, deduplicated
    expect(chain.transport.requests).toHaveLength(4);
  });

  it("an upstream byte change is a NEW object and a NEW candidate; the stored object and candidate it replaces are unchanged", async () => {
    const P4 = { tenantId: "local", projectId: "p-m2-upstream", branchId: "main" } as const;
    chainMemberships([P4]);
    const chain = chainRuntime(Date.parse("2026-10-18T13:00:00.000Z"));
    const first = await chain.service.start(P4, requester, { request: REQUEST, schematic: chainSheet(catalog), headMark: null, origin: "page" });
    await chain.runWorker();
    const before = view(await chain.service.read(P4, view(first).taskId)).candidate!;
    // upstream edits the symbol's description: new bytes, a new hash
    chain.transport.overrides.set("/kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym", { status: 200, body: SYMBOL_1N4148.replace("100V 0.15A standard switching diode, DO-35", "100V 0.2A standard switching diode, DO-35 (upstream revision)"), headers: { "content-type": "application/x-kicad-symbol" } });
    const second = await chain.service.start(P4, requester, { request: { ...REQUEST, assetKinds: ["symbol", "footprint"] }, schematic: chainSheet(catalog), headMark: null, origin: "page" });
    await chain.runWorker();
    const after = view(await chain.service.read(P4, view(second).taskId)).candidate!;
    expect(after.candidateId).not.toBe(before.candidateId);
    expect(after.objects.find((object) => object.role === "symbol-file")!.sha256).not.toBe(before.objects.find((object) => object.role === "symbol-file")!.sha256);
    const store = new DurableAcquisitionCandidateStore(new PostgresDurableWorkflowRepository());
    expect((await store.get(P4, before.candidateId)).report.digest).toBe(before.reportDigest); // the earlier candidate is untouched
  });

  it("an MPN variant the own part cannot take is published with ONE discovery row, recalled by its exact MPN and offered", async () => {
    const P5 = { tenantId: "local", projectId: "p-m2-discovery", branchId: "main" } as const;
    const memberships = chainMemberships([P5]);
    const chain = chainRuntime(Date.parse("2026-10-18T14:00:00.000Z"));
    const request = { ...REQUEST, requirement: { ...REQUEST.requirement, exactMpn: "1N4148TR" } };
    const started = await chain.service.start(P5, requester, { request, schematic: chainSheet(catalog), headMark: null, origin: "page" });
    await chain.runWorker();
    const taskId = view(started).taskId;
    const sent = await chain.service.handoff(P5, human(USERS.requester, "pcb_editor"), null, { taskId, clientActionId: "send-discovery" });
    const handoff = (await loadAcquisitionHandoff(chain.handoffDeps, sent.body.handoffId))!;
    expect(handoff.package).toMatchObject({ links: [], discovery: true, terminalOrigin: "symbol-convention" }); // no fixture table names this MPN
    const deps = chain.publicationDeps(memberships);
    const approved = await submitAndApprove(deps, handoff.package.spec, [], true);
    expect(approved.discovery).toEqual({ valueKey: "" });
    const published = await publishBy(deps, approved.requestId);
    const revisionId = published.request.publication!.revisionId;
    const rows = (await pg.db.query<{ id: string; mpn: string; library: string }>("SELECT p.id, p.mpn, l.name AS library FROM parts p JOIN libraries l ON l.id = p.library_id WHERE p.mpn = '1N4148TR'")).rows;
    expect(rows).toEqual([{ id: expect.any(String), mpn: "1N4148TR", library: "Sirkit_Acquired_Diode" }]);
    expect((await pg.db.query("SELECT 1 FROM parts_atomic_links WHERE part_id = $1 AND atomic_part_revision_id = $2", [rows[0]!.id, revisionId])).rows).toHaveLength(1);
    const audit = (await pg.db.query<{ event: { detail: { discovery?: { partId: string } } } }>("SELECT event FROM atomic_audit_events WHERE object_id = $1 AND action = 'publish'", [revisionId])).rows[0]!;
    expect(audit.event.detail.discovery?.partId).toBe(rows[0]!.id);
    await chain.service.control(P5, requester, { taskId, action: "recheck", clientActionId: "check-discovery" });
    await chain.runWorker();
    expect(view(await chain.service.read(P5, taskId))).toMatchObject({ proposal: { candidatePartId: rows[0]!.id, atomicPartRevisionId: revisionId, origin: "search", exactMpn: "1N4148TR" } });
    expect(seams.embedded).toEqual([]);
  });
});
