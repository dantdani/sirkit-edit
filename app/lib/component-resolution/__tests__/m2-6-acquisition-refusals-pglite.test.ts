/**
 * [PR-M, 2026-10-18] Runbook M.5 item 6 over the production services and PostgreSQL: approval refusal, an unavailable (blocked) source,
 * a rate limit, a hostile asset, cancellation mid-retrieve (the late result is fenced), a candidate withdrawn before apply, a revoked
 * requester, duplicate clicks, an AI actor and unconfigured governance - none forges authority, corrupts the library, duplicates a
 * replacement or writes into another project. (Missing credentials: no CAD source admitted in M2 takes a credential - the optional GitLab
 * token is OD-M2-6 and is never read - so `source_credentials` has no reachable producer yet; the publish-outcome-unknown hold and the
 * ambiguous apply's reconciliation are the existing suites' (b19-e-atomic-publication-durable, m1-led-dimmer-resolution case 7).)
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/app/lib/db/schema";
import { loadMigrationManifest } from "@/app/lib/db/migrations/manifest";
import { migrateDatabase } from "@/app/lib/db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "@/app/lib/db/disposable-postgres";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
vi.mock("@/app/lib/db/client", () => ({ getDb: () => orm }));
vi.mock("@/app/lib/embeddings", async (original) => ({ ...(await original() as object), embedQuery: vi.fn(async () => { throw new Error("no embedding provider in this test"); }) }));

import { resetComponentResolutionRuntimeFactory, setComponentResolutionRuntimeFactory } from "@/app/lib/component-resolution/task/runtime";
import { resetCadSourceInjection } from "@/app/lib/component-resolution/task/worker-runtime";
import { resetMembershipRepositoryFactory } from "@/app/lib/auth/identity-runtime";
import { loadAcquisitionHandoff } from "@/app/lib/component-resolution/acquisition/handoff";
import { resolveAtomicPublicationRequest, submitAtomicPublicationRequest } from "@/app/lib/atomic/publication-review";
import { resetAdmissionControl } from "@/app/lib/acquisition/admission-control";
import type { CadAcquisitionTaskView } from "@/app/lib/acquisition/cad-acquisition-contract";
import { agentActor, chainMemberships, chainRuntime, chainSheet, GOVERNANCE, human, seedChainCatalog, USERS, type ChainCatalog } from "./_m2-chain";
import { HOSTILE_SYMBOLS } from "./_m2-fixtures";

let catalog: ChainCatalog;
const vector = (): string => `[${new Array(1_536).fill(0).map((_, index) => (index === 0 ? 1 : 0)).join(",")}]`;
const requester = { principalId: USERS.requester, role: "pcb_editor" as const, membershipRevision: null, actorKind: "human" as const };
const REQUEST = { componentIds: ["kc-d1", "kc-d2"], requirement: { mounting: "through_hole", packageCode: "DO-35" }, assetKinds: ["symbol", "footprint", "datasheet"] };
const view = (answer: { body: Record<string, unknown> }): CadAcquisitionTaskView => answer.body.task as CadAcquisitionTaskView;
const scope = (projectId: string) => ({ tenantId: "local", projectId, branchId: "main" } as const);

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  catalog = await seedChainCatalog(pg, vector);
}, 240_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => { vi.stubEnv("DATABASE_URL", "postgres://catalog-configured-placeholder"); resetAdmissionControl(); vi.spyOn(console, "warn").mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); resetComponentResolutionRuntimeFactory(); resetCadSourceInjection(); resetMembershipRepositoryFactory(); });

async function startAndRun(chain: ReturnType<typeof chainRuntime>, projectId: string, request: Record<string, unknown> = REQUEST): Promise<string> {
  const started = await chain.service.start(scope(projectId), requester, { request, schematic: chainSheet(catalog), headMark: null, origin: "page" });
  expect(started.status, JSON.stringify(started.body)).toBe(202);
  await chain.runWorker();
  return view(started).taskId;
}

describe("[PR-M M.5-6] refusals forge nothing, corrupt nothing, duplicate nothing", { timeout: 240_000 }, () => {
  it("a rejected publication request is review_rejected on the task; nothing is published or bound; a duplicate handoff is the same handoff", async () => {
    const memberships = chainMemberships([scope("p-m2-rejected")]);
    const chain = chainRuntime();
    const taskId = await startAndRun(chain, "p-m2-rejected");
    const sent = await chain.service.handoff(scope("p-m2-rejected"), human(USERS.requester, "pcb_editor"), null, { taskId, clientActionId: "send-1" });
    const again = await chain.service.handoff(scope("p-m2-rejected"), human(USERS.requester, "pcb_editor"), null, { taskId, clientActionId: "send-2" });
    expect(again.body.handoffId).toBe(sent.body.handoffId); // a duplicate click
    const handoff = (await loadAcquisitionHandoff(chain.handoffDeps, sent.body.handoffId))!;
    const deps = chain.publicationDeps(memberships);
    const { stored } = await submitAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.govEditor, "pcb_editor"), membershipRevision: null, spec: { ...handoff.package.spec, manufacturer: { canonicalName: "Nexperia", officialDomains: [] } }, links: handoff.package.links, reason: "review" });
    await resolveAtomicPublicationRequest(deps, { scope: GOVERNANCE, actor: human(USERS.reviewer, "reviewer"), requestId: stored.request.requestId, decision: "reject", reason: "the pin table does not cite a datasheet revision" });
    await chain.service.control(scope("p-m2-rejected"), requester, { taskId, action: "recheck", clientActionId: "check-1" });
    await chain.runWorker();
    const task = view(await chain.service.read(scope("p-m2-rejected"), taskId));
    expect(task).toMatchObject({ proposal: null, publication: { status: "rejected" }, blocker: { code: "review_rejected", detail: "the pin table does not cite a datasheet revision", draftOffered: true } });
    expect((await pg.db.query("SELECT 1 FROM parts_atomic_links WHERE part_id = $1", [catalog.ids.get("1n4148")])).rows).toHaveLength(0);
  });

  it("the AI actor cannot send for review, and an unconfigured governance scope is a stated blocker (the candidate is kept)", async () => {
    chainMemberships([scope("p-m2-ai")]);
    const chain = chainRuntime();
    const taskId = await startAndRun(chain, "p-m2-ai");
    expect(await chain.service.handoff(scope("p-m2-ai"), agentActor(), null, { taskId, clientActionId: "agent-send" })).toMatchObject({ status: 403, body: { code: "ACQUISITION_HANDOFF_HUMAN_REQUIRED" } });
    expect(await chain.service.handoff(scope("p-m2-ai"), human("u-viewer", "viewer"), null, { taskId, clientActionId: "viewer-send" })).toMatchObject({ status: 403, body: { code: "ACQUISITION_HANDOFF_FORBIDDEN" } });
    const unconfigured = chainRuntime(Date.parse("2026-10-18T11:00:00.000Z"), { governance: { tenantId: null, projectId: null } });
    expect(await unconfigured.service.handoff(scope("p-m2-ai"), human(USERS.requester, "pcb_editor"), null, { taskId, clientActionId: "send-unconfigured" })).toMatchObject({ status: 503, body: { code: "ACQUISITION_HANDOFF_GOVERNANCE_UNCONFIGURED" } });
    expect(view(await unconfigured.service.read(scope("p-m2-ai"), taskId))).toMatchObject({ candidate: { verdict: "validated" }, handoff: null });
    // a member of another tenant cannot hand to this governance inbox (OD-M2-8)
    const foreign = { tenantId: "tenant-other", projectId: "p-m2-foreign", branchId: "main" } as const;
    chainMemberships([foreign]);
    const foreignChain = chainRuntime(Date.parse("2026-10-18T11:30:00.000Z"));
    const foreignTask = view(await foreignChain.service.start(foreign, requester, { request: REQUEST, schematic: chainSheet(catalog), headMark: null, origin: "page" })).taskId;
    await foreignChain.runWorker();
    expect(await foreignChain.service.handoff(foreign, human(USERS.requester, "pcb_editor"), null, { taskId: foreignTask, clientActionId: "x" })).toMatchObject({ status: 403, body: { code: "ACQUISITION_HANDOFF_CROSS_TENANT" } });
  });

  it("no admitted source: source_terms (only the blocked GitLab row could serve it) - nothing is called", async () => {
    chainMemberships([scope("p-m2-terms")]);
    const chain = chainRuntime();
    setComponentResolutionRuntimeFactory(() => ({ ...chain.runtime, environment: { SIRKIT_ACQUISITION_DISABLED_SOURCES: "kicad-bundled,fixture-kicad" } }));
    const runtime = { ...chain.runtime, environment: { SIRKIT_ACQUISITION_DISABLED_SOURCES: "kicad-bundled,fixture-kicad" } };
    Object.assign(chain.runtime, runtime);
    const taskId = await startAndRun(chain, "p-m2-terms");
    const task = view(await chain.service.read(scope("p-m2-terms"), taskId));
    expect(task).toMatchObject({ state: "waiting-for-resource", blocker: { code: "source_terms" }, candidate: null });
    expect(task.attempts.map((attempt) => [attempt.sourceId, attempt.code])).toEqual([["kicad-bundled", "operator_disabled"], ["kicad-gitlab", "blocked"], ["fixture-kicad", "operator_disabled"]]);
    expect(chain.transport.requests).toEqual([]);
  });

  it("a 429 is a scheduled wait at the real Retry-After; Resume does not bring it forward; after the time it continues", async () => {
    chainMemberships([scope("p-m2-429")]);
    const chain = chainRuntime();
    chain.transport.overrides.set("/kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym", { status: 429, headers: { "retry-after": "90" } });
    const taskId = await startAndRun(chain, "p-m2-429");
    let task = view(await chain.service.read(scope("p-m2-429"), taskId));
    expect(task).toMatchObject({ state: "waiting-for-resource" });
    expect(task.events.some((event) => event.kind === "waiting_resource" && event.message.includes(new Date(chain.clock.now + 90_000).toISOString()))).toBe(true);
    expect(await chain.service.control(scope("p-m2-429"), requester, { taskId, action: "resume", clientActionId: "impatient" })).toMatchObject({ status: 200 });
    expect((await chain.runWorker()).slices).toEqual([]); // nothing is due: no hot retry
    expect(chain.transport.requests).toHaveLength(1);
    chain.transport.overrides.clear();
    chain.clock.advance(91_000);
    resetAdmissionControl(); // the breaker's open window (60 s) has passed too
    expect((await chain.runWorker()).slices.map((slice) => slice.outcome)).toEqual(["ended"]);
    task = view(await chain.service.read(scope("p-m2-429"), taskId));
    expect(task).toMatchObject({ state: "awaiting-review", candidate: { verdict: "validated" } });
  });

  it("a hostile symbol is refused: parser_refused or an unsupported candidate - nothing valid, nothing handed off", async () => {
    chainMemberships([scope("p-m2-hostile")]);
    const chain = chainRuntime();
    chain.transport.overrides.set("/kicad-symbols/Diode.kicad_symdir/1N4148.kicad_sym", { status: 200, body: HOSTILE_SYMBOLS[0]![1], headers: { "content-type": "application/x-kicad-symbol" } });
    const taskId = await startAndRun(chain, "p-m2-hostile");
    const task = view(await chain.service.read(scope("p-m2-hostile"), taskId));
    expect(task.blocker?.code).toBe("parser_refused");
    expect(task.candidate?.verdict ?? "none").not.toBe("validated");
    expect((await chain.service.handoff(scope("p-m2-hostile"), human(USERS.requester, "pcb_editor"), null, { taskId, clientActionId: "send" })).status).toBe(409);
  });

  it("a cancel during the retrieval fences the late result: no candidate is consumed and the task is cancelled", async () => {
    chainMemberships([scope("p-m2-cancel")]);
    const chain = chainRuntime();
    chain.transport.overrides.set("/kicad-footprints/Diode_THT.pretty/D_DO-35_SOD27_P7.62mm_Horizontal.kicad_mod", { status: 200, body: "(footprint \"x\" (version 20241229))", headers: { "content-type": "application/x-kicad-footprint" }, delayMs: 400 });
    const started = await chain.service.start(scope("p-m2-cancel"), requester, { request: REQUEST, schematic: chainSheet(catalog), headMark: null, origin: "page" });
    const taskId = view(started).taskId;
    const running = chain.runWorker();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await chain.service.control(scope("p-m2-cancel"), requester, { taskId, action: "cancel", clientActionId: "stop" })).toMatchObject({ status: 200 });
    const { slices } = await running;
    expect(slices.map((slice) => slice.outcome)).toEqual(["cancelled"]);
    expect(view(await chain.service.read(scope("p-m2-cancel"), taskId))).toMatchObject({ state: "cancelled", candidate: null, proposal: null });
  });

  it("a revoked requester's task fails authority_revoked at the claim; a viewer cannot start one", async () => {
    const memberships = chainMemberships([scope("p-m2-revoked")]);
    const chain = chainRuntime();
    const started = await chain.service.start(scope("p-m2-revoked"), requester, { request: REQUEST, schematic: chainSheet(catalog), headMark: null, origin: "page" });
    const record = await memberships.loadActiveMembership({ tenantId: "local", projectId: "p-m2-revoked", userId: USERS.requester });
    memberships.set({ ...record!, state: "revoked", version: 2 });
    await chain.runWorker();
    expect(view(await chain.service.read(scope("p-m2-revoked"), view(started).taskId))).toMatchObject({ state: "failed", blocker: { code: "authority_revoked" }, candidate: null });
    expect(chain.transport.requests).toEqual([]);
    expect(await chain.service.start(scope("p-m2-revoked"), { ...requester, role: "viewer" }, { request: REQUEST, schematic: chainSheet(catalog), headMark: null, origin: "page" })).toMatchObject({ status: 403 });
  });

  it("the closed input: authority keys, a board, a forged sheet, reference designators and a resolved instance are refused", async () => {
    chainMemberships([scope("p-m2-input")]);
    const chain = chainRuntime();
    const sheet = chainSheet(catalog);
    const start = (request: Record<string, unknown>, schematic: unknown = sheet) => chain.service.start(scope("p-m2-input"), requester, { request, schematic, headMark: null, origin: "page" });
    expect(await start({ ...REQUEST, sourceId: "kicad-gitlab" })).toMatchObject({ status: 400, body: { field: "sourceId" } });
    expect(await start({ ...REQUEST, requirement: { url: "https://evil.example/x" } })).toMatchObject({ status: 400 });
    expect(await start({ ...REQUEST, componentIds: ["D1"] })).toMatchObject({ status: 400 });
    expect(await start(REQUEST, { board: {} })).toMatchObject({ status: 400, body: { code: "COMPONENT_RESOLUTION_SCHEMATIC_UNVERIFIED" } });
    expect(await start({ ...REQUEST, componentIds: ["kc-r1"] })).toMatchObject({ status: 409, body: { code: "COMPONENT_RESOLUTION_NOT_ACQUIRABLE" } }); // R1 is resolved
    expect(await start({ ...REQUEST, componentIds: ["kc-d1", "kc-u1"] })).toMatchObject({ status: 409 }); // two catalog parts
    expect(chain.transport.requests).toEqual([]);
  });
});
