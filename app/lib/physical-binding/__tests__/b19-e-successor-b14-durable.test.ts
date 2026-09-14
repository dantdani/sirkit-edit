/**
 * [B19-E E5 b, e, f] Withdrawal, successor rebind and the B14 replacement against a real, migrated PostgreSQL (PGlite), through
 * the production compositions: the publication route's withdraw_revision operation, the physical-bindings route's rebind over
 * the PostgreSQL binding repository (its deferred foreign keys included), the chat's cancellable authority and pin-fact reads,
 * the /api/replacement-authority endpoint and the production replacement approval controller.
 *
 *  b. withdraw_revision writes one append-only status event; an illegal edge and a refused successor write nothing;
 *  e. a rebind whose commit fails leaves the old binding in effect; a successful one supersedes it and selects and approves the
 *     successor in one transaction, which the PostgreSQL foreign keys accept;
 *  f. a proposal moves a schematic instance off its REVOKED current revision onto the successor with zero dropped pins (the
 *     current pins are read from the revision being left; the target must be selectable), and applies; an apply is refused when
 *     the successor is withdrawn between proposal and apply.
 *
 * Reproduced on the unchanged code: none of the operations existed; the current pin facts of a revoked revision were withheld
 * (so a project could never move off it), and target pin facts were read in pinned mode (a deprecated target still sealed).
 *
 * [B19-E E5 review] The target-pin rule is checked on a DEPRECATED revision (a revoked one is refused by the pinned loader too)
 * and the apply refusal must be that rule; a successor candidate left by a refused bind is reused by the rebind on PostgreSQL
 * (it collided with PB_CANDIDATE_IDENTITY_COLLISION before).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/pglite";
import { getTableName, type Table } from "drizzle-orm";
import * as schema from "../../db/schema";
import { loadMigrationManifest } from "../../db/migrations/manifest";
import { migrateDatabase } from "../../db/migrations/runner";
import { disposablePostgres, type DisposablePostgres } from "../../db/disposable-postgres";
import type { CancellableAuthorityQuery, CancellableAuthoritySqlClient } from "@/app/api/chat/authority-cancellable-reads";

let pg: DisposablePostgres;
let orm: ReturnType<typeof drizzle<typeof schema>>;
const fault = vi.hoisted(() => ({ insertInto: null as string | null }));
/** postgres.js-shaped cancellable client over the same PGlite, for the chat's raw-SQL reads. */
const rawClient: CancellableAuthoritySqlClient = {
  unsafe(text: string, params: string[]): CancellableAuthorityQuery {
    const promise = pg.db.query<Record<string, unknown>>(text, params).then((result) => result.rows);
    return Object.assign(promise, { cancel: () => {} }) as unknown as CancellableAuthorityQuery;
  },
};
function database(): typeof orm {
  if (!fault.insertInto) return orm;
  return new Proxy(orm, {
    get(target, property, receiver) {
      if (property !== "transaction") return Reflect.get(target, property, receiver);
      return (run: (tx: unknown) => Promise<unknown>) => target.transaction((tx) => run(new Proxy(tx, {
        get(inner, key, innerReceiver) {
          if (key !== "insert") return Reflect.get(inner, key, innerReceiver);
          return (table: Table) => {
            if (getTableName(table) === fault.insertInto) throw new Error("B19E_E5_INJECTED_INSERT_FAILURE");
            return inner.insert(table);
          };
        },
      })));
    },
  });
}
vi.mock("../../db/client", () => ({ getDb: () => database(), getSqlClient: () => rawClient }));
vi.mock("@/app/lib/durable-workflow/runtime", async () => {
  const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
  const repository = new InMemoryDurableWorkflowRepository();
  return { getDurableWorkflowRepository: () => repository };
});

import type { KicadPin } from "@/app/lib/kicad/types";
import type { SchematicState } from "@/lib/schematic-types";
import { kicadPinWorldPos } from "@/app/lib/geometry";
import { createAtomicRevision } from "@/app/lib/atomic/catalog";
import { publishPortableAtomicSnapshot } from "@/app/lib/atomic/server-repository";
import type { AtomicPartRevision, PortableAtomicSnapshot } from "@/app/lib/atomic/types";
import { blinkerCatalog, BLINKER_PART_IDS } from "@/app/lib/fixture-runtime/blinker/catalog";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST as publicationPost } from "@/app/api/components/atomic/publication/route";
import { GET as bindingsGet, POST as bindingsPost } from "@/app/api/physical-bindings/route";
import { POST as REAUTH_POST } from "@/app/api/replacement-authority/route";
import { resetAuthoritySqlClientFactory, resolveComponentAuthoritySource, setAuthoritySqlClientFactory } from "@/app/api/chat/component-authority-runtime";
import { resolveReplacementPinFactsSource } from "@/app/api/chat/replacement-facts-runtime";
import { loadRunComponentAuthority } from "@/app/lib/engineering/component-authority-source";
import { pcbBoardInstanceId, PCB_BOARD_ASSEMBLY_VARIANT_ID, PCB_BOARD_HIERARCHY_PATH } from "@/app/lib/pcb/board-identity";
import { SchematicEditorSession } from "@/app/lib/engineering/schematic-session";
import { InMemoryAtomicProjectStore } from "@/app/lib/engineering/persistence";
import { SchematicGestureCoordinator } from "@/app/lib/engineering/schematic-gesture-coordinator";
import { SchematicHistory } from "@/app/lib/project/schematic-history";
import { adoptCanonicalResult } from "@/app/lib/project/canonical-adoption";
import { ProjectCommitInterlock } from "@/app/lib/engineering/project-commit-interlock";
import { ApprovedMutationAuditLedger, ApprovedMutationRegistry } from "@/app/lib/engineering/approved-agent-mutations";
import { ApprovedMutationJournal, InMemoryApprovedMutationJournalStore } from "@/app/lib/engineering/approved-mutation-journal";
import { assembleReplacementProposal } from "@/app/lib/engineering/replacement-proposal-assembler";
import { buildAuthorizationBinding } from "@/app/lib/engineering/proposal-authorization";
import { approveAndApplyReplacement } from "@/app/lib/project/replacement-approval-controller.internal";
import type { MembershipReauthorization } from "@/app/lib/project/membership-reauthorization";
import type { PublishedSymbolPinFacts } from "@/app/lib/engineering/replacement-pin-facts";

const PUBLISHER = { actorId: "user:fixture-publisher", actorRole: "publisher" as const };
const GOVERNANCE = "sirkit-catalog-governance";
const PROJECT = "p-b19e-e5-durable";
const SCOPE = { tenantId: "local", projectId: PROJECT, branchId: "main" } as const;
const BOARD_ID = pcbBoardInstanceId(PROJECT);
const COMPONENT = "r1-e5-id";
const COMPONENT_ORPHAN = "r2-e5-orphan-id"; // [B19-E E5 review] a component whose successor review left an unselected candidate
const PRINCIPAL = "u-e5-editor";
const REVISION = "membership:e5";
const ids = { R: "", R2: "" };
let partMpn = "";

function snapshotFor(partId: string, value: string): PortableAtomicSnapshot {
  const catalog = blinkerCatalog();
  return structuredClone(catalog.snapshots.get(catalog.revisionFor(partId, value)!)!);
}
function successorOf(snapshot: PortableAtomicSnapshot): PortableAtomicSnapshot {
  const { id: _id, semanticHash: _hash, validatorVersion: _validator, schemaVersion: _schema, ...rest } = structuredClone(snapshot.atomicRevision);
  void _id; void _hash; void _validator; void _schema;
  const next = structuredClone(snapshot);
  next.atomicRevision = structuredClone(createAtomicRevision({ ...rest, revision: rest.revision + 1, policyVersion: "b19-e-e5-successor/1" })) as AtomicPartRevision;
  return next;
}
async function count(sql: string, params: unknown[] = []): Promise<number> {
  return (await pg.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, params as never)).rows[0]!.n;
}
const selectorHeaders = (projectId: string) => ({ "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" });
const post = (path: string, projectId: string, body: unknown) => new Request(`http://localhost${path}`, { method: "POST", headers: selectorHeaders(projectId), body: JSON.stringify(body) });
const payload = async (res: Response): Promise<Record<string, unknown>> => (await res.clone().json()) as Record<string, unknown>;

/** A governance administrator withdraws through the publication route. */
async function withdraw(body: Record<string, unknown>): Promise<Response> {
  injectIdentity({ userId: "u-e5-governance-admin" });
  injectMembership([{ tenantId: "local", projectId: GOVERNANCE, userId: "u-e5-governance-admin", role: "admin" }]);
  return publicationPost(post("/api/components/atomic/publication", GOVERNANCE, { operation: "withdraw_revision", ...body }));
}
function asProjectMember(role: "editor" | "reviewer"): void {
  injectAuthorizedPrincipal({ userId: role === "editor" ? PRINCIPAL : "u-e5-reviewer", projectId: PROJECT, role });
}

beforeAll(async () => {
  pg = await disposablePostgres();
  await migrateDatabase(pg, { manifest: loadMigrationManifest() });
  orm = drizzle(pg.db, { schema });
  const R = snapshotFor(BLINKER_PART_IDS.resistor, "330");
  const R2 = successorOf(R);
  for (const snapshot of [R, R2]) await publishPortableAtomicSnapshot({ snapshot, ...PUBLISHER, requiredProfile: "pcb_assignable", reason: "B19-E E5 durable proof" });
  Object.assign(ids, { R: R.atomicRevision.id, R2: R2.atomicRevision.id });
  partMpn = R.exactPart!.exactMpn;
}, 180_000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => {
  fault.insertInto = null;
  vi.stubEnv("SIRKIT_ATOMIC_CATALOG_PROJECT_ID", GOVERNANCE);
  vi.stubEnv("SIRKIT_ATOMIC_CATALOG_TENANT_ID", "local");
  vi.stubEnv("DATABASE_URL", "postgres://pglite-only.invalid/b19e");
  setAuthoritySqlClientFactory(() => rawClient);
});
afterEach(() => { resetInjectedIdentity(); resetAuthoritySqlClientFactory(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

type SetBody = { set: { setId: string; revision: number; effectiveSelectedRevisionId?: string }; bindings: Array<{ revisionId: string; bindingId: string; lifecycleState: string; approval: { state: string }; exactPart?: { atomicPartRevisionId: string } }>; auditEvents: Array<{ action: string; bindingId: string; occurredAt: string; fromRevisionId: string }> };
let setId = "";
let oldBindingRevisionId = "";

describe("[B19-E E5] withdrawal and rebind on PostgreSQL", () => {
  it("a reviewer binds the instance to R while it is published", async () => {
    asProjectMember("reviewer");
    const bound = await bindingsPost(post("/api/physical-bindings", PROJECT, { operation: "bind_atomic_selection", componentInstanceId: COMPONENT, boardInstanceId: BOARD_ID, atomicPartRevisionId: ids.R }));
    const body = await payload(bound);
    expect(bound.status, JSON.stringify(body).slice(0, 300)).toBe(201);
    setId = body.setId as string;
    oldBindingRevisionId = body.bindingRevisionId as string;
    const second = await bindingsPost(post("/api/physical-bindings", PROJECT, { operation: "bind_atomic_selection", componentInstanceId: COMPONENT_ORPHAN, boardInstanceId: BOARD_ID, atomicPartRevisionId: ids.R }));
    expect(second.status).toBe(201);
  });

  it("b. withdraw_revision revokes R naming its successor; an illegal edge and a refused successor write nothing", async () => {
    const revoked = await withdraw({ revisionId: ids.R, to: "revoked", successorRevisionId: ids.R2, reason: "field failures: replaced by the reissued revision" });
    expect(revoked.status, JSON.stringify(await payload(revoked))).toBe(200);
    expect(await count(`atomic_revision_status_events WHERE revision_id = $1`, [ids.R])).toBe(1);
    const eventsBefore = await count(`atomic_revision_status_events`);
    const illegal = await withdraw({ revisionId: ids.R, to: "deprecated", reason: "again" });
    expect([illegal.status, (await payload(illegal)).code]).toEqual([409, "ATOMIC_PUBLICATION_WITHDRAWAL_ILLEGAL"]);
    const badSuccessor = await withdraw({ revisionId: ids.R2, to: "superseded", successorRevisionId: ids.R, reason: "the revoked one cannot succeed" });
    expect([badSuccessor.status, (await payload(badSuccessor)).code]).toEqual([409, "ATOMIC_PUBLICATION_SUCCESSOR_REFUSED"]);
    expect(await count(`atomic_revision_status_events`)).toBe(eventsBefore);
  });

  it("e. a rebind whose commit fails leaves the old binding in effect", async () => {
    asProjectMember("reviewer");
    const before = (await payload(await bindingsGet(new Request(`http://localhost/api/physical-bindings?setId=${encodeURIComponent(setId)}`, { headers: selectorHeaders(PROJECT) })))) as unknown as SetBody;
    const preview = (await payload(await bindingsPost(post("/api/physical-bindings", PROJECT, { operation: "preview_atomic_successor", componentInstanceId: COMPONENT, boardInstanceId: BOARD_ID, fromRevisionId: ids.R, toRevisionId: ids.R2 })))).preview as { diffDigest: string; fromStatus: string; diff: { blockers: string[] } };
    const rowsBefore = await count(`physical_binding_revisions WHERE component_instance_id = $1`, [COMPONENT]);
    expect(preview.fromStatus).toBe("revoked");
    expect(preview.diff.blockers).toEqual([]);
    fault.insertInto = "physical_binding_audit_events";
    const failed = await bindingsPost(post("/api/physical-bindings", PROJECT, { operation: "rebind_atomic_successor", componentInstanceId: COMPONENT, boardInstanceId: BOARD_ID, fromRevisionId: ids.R, toRevisionId: ids.R2, diffDigest: preview.diffDigest, reason: "move off the revoked revision" }));
    fault.insertInto = null;
    expect(failed.ok).toBe(false);
    const after = (await payload(await bindingsGet(new Request(`http://localhost/api/physical-bindings?setId=${encodeURIComponent(setId)}`, { headers: selectorHeaders(PROJECT) })))) as unknown as SetBody;
    expect(after.set).toEqual(before.set);
    expect(after.set.effectiveSelectedRevisionId).toBe(oldBindingRevisionId);
    expect(after.bindings).toHaveLength(before.bindings.length);
    expect(await count(`physical_binding_revisions WHERE component_instance_id = $1`, [COMPONENT])).toBe(rowsBefore);
  });

  it("e. a reviewer's rebind supersedes the old binding and selects and approves the successor in one PostgreSQL transaction", async () => {
    asProjectMember("reviewer");
    const preview = (await payload(await bindingsPost(post("/api/physical-bindings", PROJECT, { operation: "preview_atomic_successor", componentInstanceId: COMPONENT, boardInstanceId: BOARD_ID, fromRevisionId: ids.R, toRevisionId: ids.R2 })))).preview as { diffDigest: string };
    const rebound = await bindingsPost(post("/api/physical-bindings", PROJECT, { operation: "rebind_atomic_successor", componentInstanceId: COMPONENT, boardInstanceId: BOARD_ID, fromRevisionId: ids.R, toRevisionId: ids.R2, diffDigest: preview.diffDigest, reason: "move off the revoked revision" }));
    const body = await payload(rebound);
    expect(rebound.status, JSON.stringify(body).slice(0, 400)).toBe(201);
    const state = (await payload(await bindingsGet(new Request(`http://localhost/api/physical-bindings?setId=${encodeURIComponent(setId)}`, { headers: selectorHeaders(PROJECT) })))) as unknown as SetBody;
    const selected = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    expect(selected.exactPart?.atomicPartRevisionId).toBe(ids.R2);
    expect(selected.approval.state).toBe("approved");
    const oldBindingId = oldBindingRevisionId.split(":r")[0];
    expect(state.bindings.find((binding) => binding.bindingId === oldBindingId)?.lifecycleState).toBe("superseded");
    const supersede = state.auditEvents.find((event) => event.action === "supersede")!;
    const newEvents = state.auditEvents.filter((event) => event.bindingId === selected.revisionId.split(":r")[0]);
    expect(supersede.fromRevisionId).toBe(oldBindingRevisionId);
    expect(newEvents.map((event) => event.action).sort()).toEqual(["approve", "create_candidate", "revalidate", "select"]);
    for (const event of newEvents) expect(event.occurredAt >= supersede.occurredAt, event.action).toBe(true);
    // every intermediate binding revision an audit event names is a durable row (the deferred foreign keys held)
    expect(await count(`physical_binding_audit_events a WHERE a.aggregate_set_id = $1 AND NOT EXISTS (SELECT 1 FROM physical_binding_revisions r WHERE r.revision_id = a.to_revision_id)`, [setId])).toBe(0);
  });
});

describe("[B19-E E5 review] a successor bind refused while the old binding is in effect never blocks the rebind (PostgreSQL)", () => {
  it("the refused bind's candidate is reused by the rebind in one transaction the foreign keys accept", async () => {
    asProjectMember("reviewer");
    // binding the successor directly (as an approved review of it does) creates its candidate, then select refuses
    const refused = await bindingsPost(post("/api/physical-bindings", PROJECT, { operation: "bind_atomic_selection", componentInstanceId: COMPONENT_ORPHAN, boardInstanceId: BOARD_ID, atomicPartRevisionId: ids.R2 }));
    expect([refused.status, (await payload(refused)).code]).toEqual([409, "PB_ACTIVE_SELECTION_CONFLICT"]);
    const orphanRows = await count(`physical_binding_revisions WHERE component_instance_id = $1`, [COMPONENT_ORPHAN]);
    const preview = (await payload(await bindingsPost(post("/api/physical-bindings", PROJECT, { operation: "preview_atomic_successor", componentInstanceId: COMPONENT_ORPHAN, boardInstanceId: BOARD_ID, fromRevisionId: ids.R, toRevisionId: ids.R2 })))).preview as { diffDigest: string; setId: string };
    const rebound = await bindingsPost(post("/api/physical-bindings", PROJECT, { operation: "rebind_atomic_successor", componentInstanceId: COMPONENT_ORPHAN, boardInstanceId: BOARD_ID, fromRevisionId: ids.R, toRevisionId: ids.R2, diffDigest: preview.diffDigest, reason: "move off the revoked revision" }));
    expect(rebound.status, JSON.stringify(await payload(rebound)).slice(0, 300)).toBe(201);
    const state = (await payload(await bindingsGet(new Request(`http://localhost/api/physical-bindings?setId=${encodeURIComponent(preview.setId)}`, { headers: selectorHeaders(PROJECT) })))) as unknown as SetBody;
    const selected = state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)!;
    expect([selected.exactPart?.atomicPartRevisionId, selected.approval.state]).toEqual([ids.R2, "approved"]);
    // one create_candidate for the successor's binding (the reused one), and every audited revision is a durable row
    expect(state.auditEvents.filter((event) => event.bindingId === selected.bindingId && event.action === "create_candidate")).toHaveLength(1);
    expect(await count(`physical_binding_revisions WHERE component_instance_id = $1`, [COMPONENT_ORPHAN])).toBeGreaterThan(orphanRows);
    expect(await count(`physical_binding_audit_events a WHERE a.aggregate_set_id = $1 AND NOT EXISTS (SELECT 1 FROM physical_binding_revisions r WHERE r.revision_id = a.to_revision_id)`, [preview.setId])).toBe(0);
  });
});

// ─── f. B14 end to end ───────────────────────────────────────────────────────

const AUTHORIZED_LIVE: MembershipReauthorization = { ok: true, principalId: PRINCIPAL, role: "pcb_editor", membershipRevision: REVISION, scope: { ...SCOPE } };

function instanceAt(facts: PublishedSymbolPinFacts): { state: SchematicState; pins: readonly KicadPin[] } {
  const instance = { id: COMPONENT, partId: partMpn, x: 300, y: 100, rotation: 0 as const, refDes: "R1", value: "330", atomicPartRevisionId: ids.R, symbolAssetVersionId: facts.symbolAssetVersionId };
  const pin1 = kicadPinWorldPos(instance, facts.pins[0]!);
  const pin2 = kicadPinWorldPos(instance, facts.pins[1]!);
  return {
    pins: facts.pins,
    state: { components: [], kicadComponents: [instance], wires: [{ id: "w1", vertices: [{ x: pin1.x - 60, y: pin1.y }, pin1] }, { id: "w2", vertices: [pin2, { x: pin2.x + 60, y: pin2.y }] }], netLabels: [] },
  };
}

/** The platform fetch reaches the REAL /api/replacement-authority handler (the production channel transport, unmodified). */
function stubPlatformFetch(): void {
  vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url.toString();
    if (!href.includes("/api/replacement-authority")) throw new Error(`unexpected fetch: ${href}`);
    const { signal: _signal, ...rest } = (init ?? {}) as RequestInit & { signal?: unknown };
    void _signal;
    return REAUTH_POST(new Request(new URL(href, "http://localhost").toString(), rest as RequestInit));
  });
}

async function composition(state: SchematicState) {
  const editor = new SchematicEditorSession({ ...SCOPE }, { store: new InMemoryAtomicProjectStore() });
  await editor.openForProject(state, null);
  let visible = structuredClone(state);
  const history = new SchematicHistory<SchematicState>(structuredClone(state), { label: "open" });
  const coordinator: SchematicGestureCoordinator = new SchematicGestureCoordinator({
    currentState: () => structuredClone(visible),
    applyPreviewFrame: () => {},
    applyCanonicalProjection: (label, next) => {
      const outcome = adoptCanonicalResult<SchematicState>({
        flushPendingRecord: () => {}, history: () => history,
        applyProjection: (authoritative) => { visible = structuredClone(authoritative); coordinator.notifyAuthoritativeProjection(authoritative); },
        snapshot: (authoritative) => structuredClone(authoritative),
        historyRecorded: () => {}, suppressEffectRecord: () => {}, scheduleAutosave: () => {},
      }, label, next);
      if (!outcome.ok) throw new Error(outcome.detail);
    },
    applyRollbackProjection: (next) => { visible = structuredClone(next); },
    execute: (base, request) => editor.execute(base, request),
    notify: () => {},
  });
  // seal from exactly what the reauthorization endpoint serves, so the apply-time recompile can byte-match
  const served = await payload(await REAUTH_POST(post("/api/replacement-authority", PROJECT, { componentInstanceId: COMPONENT, currentAtomicPartRevisionId: ids.R, nonce: "b19ee5durablenonce0001" })));
  const sealed = assembleReplacementProposal({
    state, componentId: COMPONENT,
    authority: { records: served.records as never, candidates: served.candidates as never },
    scope: { ...SCOPE, headMark: editor.headMark()! },
    authorization: buildAuthorizationBinding({ principalId: PRINCIPAL, membershipRevision: REVISION, scope: SCOPE }),
    currentPinFacts: served.currentPinFacts as PublishedSymbolPinFacts | null,
    targetPinFacts: served.targetPinFacts as PublishedSymbolPinFacts | null,
    provenance: { provider: "anthropic", note: "n", instruction: "move R1 off the revoked revision" },
    now: Date.now(),
  });
  const journalStore = new InMemoryApprovedMutationJournalStore();
  return {
    sealed, editor,
    visible: () => visible,
    executedCount: () => editor.events.filter((event) => event.kind === "executed").length,
    apply: () => {
      if (sealed.kind !== "sealed") throw new Error("not sealed");
      return approveAndApplyReplacement({
        proposal: sealed.proposal, session: editor, gateway: coordinator, interlock: new ProjectCommitInterlock(),
        journal: new ApprovedMutationJournal(journalStore, SCOPE), stillCurrent: () => true, currentProjectId: PROJECT, currentBranchId: "main",
        originRunId: "run-b19e-e5", registry: new ApprovedMutationRegistry(), audit: new ApprovedMutationAuditLedger(),
        reauthorize: async () => AUTHORIZED_LIVE,
      });
    },
  };
}

describe("[B19-E E5 f] the B14 replacement moves off a revoked current revision", () => {
  it("the production sources: authority names the successor; current pins are read from the revoked revision, target pins only from a selectable one", async () => {
    const authority = await loadRunComponentAuthority(resolveComponentAuthoritySource({ ...SCOPE }), {
      scope: { ...SCOPE, boardInstanceId: BOARD_ID }, canonicalRevision: "b19e-e5", componentInstanceIds: [COMPONENT], hierarchyPath: PCB_BOARD_HIERARCHY_PATH, assemblyVariantId: PCB_BOARD_ASSEMBLY_VARIANT_ID,
    });
    const record = authority?.records.find((item) => item.componentId === COMPONENT);
    expect(record?.exactAuthority?.atomicPartRevisionId).toBe(ids.R2);
    expect(record?.catalogStatus).toBeUndefined();
    const facts = resolveReplacementPinFactsSource()!;
    expect(await facts.loadPinFacts(ids.R, undefined, "current")).not.toBeNull();
    expect(await facts.loadPinFacts(ids.R, undefined, "target")).toBeNull();
    expect(await facts.loadPinFacts(ids.R2, undefined, "target")).not.toBeNull();
  });

  it("a sealed proposal preserves every connection (zero dropped pins) and applies through the production controller", async () => {
    asProjectMember("editor");
    stubPlatformFetch();
    const current = (await resolveReplacementPinFactsSource()!.loadPinFacts(ids.R, undefined, "current"))!;
    const { state } = instanceAt(current);
    const c = await composition(state);
    expect(c.sealed.kind, JSON.stringify(c.sealed).slice(0, 600)).toBe("sealed");
    if (c.sealed.kind !== "sealed") return;
    expect(c.sealed.proposal.impact.droppedConnections).toEqual([]);
    expect(c.sealed.proposal.impact.preservedConnections.length).toBeGreaterThan(0);
    expect(c.sealed.proposal.target.atomicPartRevisionId).toBe(ids.R2);
    const outcome = await c.apply();
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);
    expect(c.executedCount()).toBe(1);
    expect(c.visible().kicadComponents?.[0]?.atomicPartRevisionId).toBe(ids.R2);
  });

  it("an apply is refused, with nothing changed, when the successor is withdrawn between proposal and apply", async () => {
    asProjectMember("editor");
    stubPlatformFetch();
    const current = (await resolveReplacementPinFactsSource()!.loadPinFacts(ids.R, undefined, "current"))!;
    const c = await composition(instanceAt(current).state);
    expect(c.sealed.kind).toBe("sealed");
    const deprecated = await withdraw({ revisionId: ids.R2, to: "deprecated", reason: "a newer reissue is coming; do not select this one" });
    expect(deprecated.status).toBe(200);
    // [B19-E E5 review] the rule itself, on a DEPRECATED revision (the pinned loader would still serve it; only the selectable one
    // refuses): target pin facts refuse it, the pins of a revision being left do not
    const facts = resolveReplacementPinFactsSource()!;
    expect(await facts.loadPinFacts(ids.R2, undefined, "target")).toBeNull();
    expect(await facts.loadPinFacts(ids.R2, undefined, "current")).not.toBeNull();
    asProjectMember("editor");
    const outcome = await c.apply();
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.code).toBe("verification-failed");
    // [B19-E E5 review] the refusal is the target pin rule, not a digest drift the deprecated facet alone would also cause
    expect(outcome.message).toMatch(/\(target-pin-authority-unavailable\)/);
    expect(c.executedCount()).toBe(0);
    expect(c.visible().kicadComponents?.[0]?.atomicPartRevisionId).toBe(ids.R);
  });
});
