/**
 * [B19-E E5 e, g] Moving a bound component to its withdrawn revision's successor, through the real /api/physical-bindings route
 * (isolated in-memory stores, the blinker catalog plus one successor revision).
 *
 *  e. preview_atomic_successor recomputes the upgrade diff and its digest; rebind_atomic_successor is a human reviewer's or
 *     administrator's act (an editor gets 403 with the review handoff; automation is refused); the from revision must be the
 *     effective approved selection and the to revision its named successor; a missing digest is 400, a stale digest and a diff
 *     with blockers are 409; on success the old binding is superseded and the successor created, selected, revalidated and
 *     approved in that order, in one commit — a failure leaves the old binding in effect;
 *  g. a review request or a bind whose installed symbol differs from the revision's symbol is blocked
 *     ("symbol differs from revision"): the review cannot be approved and the bind is refused.
 *
 * Reproduced on the unchanged code: neither operation existed (400 PB_API_OPERATION_UNSUPPORTED), and a request or bind with a
 * mismatched symbol was approved and bound.
 *
 * [B19-E E5 review] Reproduced on the first E5 implementation: the digest hashed the previewing member's actor (a digest one
 * member previewed was 409 for another); a rebind replay answered 200 for a revoked successor and echoed the caller's digest; an
 * editor's refusal named the review-request handoff, and approving that review left an orphan candidate that made the reviewer's
 * rebind collide (422) forever; a revision whose named successor was itself withdrawn could never be moved (409 not successor);
 * there was no read of a component's effective binding. The from-not-effective rule and the replay symbol check had no test of
 * their own (proven by deliberate breakage).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  statuses: new Map<string, { state: string; successorRevisionId?: string }>(),
  extraSnapshots: new Map<string, unknown>(),
  successorId: "",
  secondSuccessorId: "",
  failNextCommit: false,
  commits: 0,
}));
vi.mock("@/app/lib/durable-workflow/runtime", async () => {
  const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
  const repo = new InMemoryDurableWorkflowRepository();
  return { getDurableWorkflowRepository: () => repo };
});
vi.mock("@/app/lib/physical-binding/server-repository", async (orig) => {
  const actual = await orig() as object;
  const { InMemoryPhysicalBindingRepository } = await import("@/app/lib/physical-binding/repository");
  class FaultyRepository extends InMemoryPhysicalBindingRepository {
    override async commit(input: Parameters<InMemoryPhysicalBindingRepository["commit"]>[0]) {
      seams.commits += 1;
      if (seams.failNextCommit) { seams.failNextCommit = false; throw new Error("PB_INJECTED_COMMIT_FAILURE"); }
      return super.commit(input);
    }
  }
  const shared = new FaultyRepository();
  class SharedRepository { constructor() { return shared; } }
  return { ...actual, PostgresPhysicalBindingRepository: SharedRepository };
});
vi.mock("@/app/lib/atomic/server-catalog", async () => {
  const { blinkerCatalog } = await import("@/app/lib/fixture-runtime/blinker/catalog");
  const { createAtomicRevision } = await import("@/app/lib/atomic/catalog");
  const catalog = blinkerCatalog();
  const first = [...catalog.snapshots.keys()].sort()[0]!;
  const base = structuredClone(catalog.snapshots.get(first)!);
  const { id: _id, semanticHash: _hash, validatorVersion: _validator, schemaVersion: _schema, ...rest } = base.atomicRevision;
  void _id; void _hash; void _validator; void _schema;
  const successor = { ...structuredClone(base), atomicRevision: createAtomicRevision({ ...rest, revision: rest.revision + 1, policyVersion: "b19-e-e5-successor/1" }) };
  seams.successorId = successor.atomicRevision.id;
  seams.extraSnapshots.set(successor.atomicRevision.id, successor);
  // [B19-E E5 review] the successor's own successor (a chain: R -> S -> S2)
  const second = { ...structuredClone(base), atomicRevision: createAtomicRevision({ ...rest, revision: rest.revision + 2, policyVersion: "b19-e-e5-successor-2/1" }) };
  seams.secondSuccessorId = second.atomicRevision.id;
  seams.extraSnapshots.set(second.atomicRevision.id, second);
  const snapshotOf = (id: string) => structuredClone((catalog.snapshots.get(id) ?? seams.extraSnapshots.get(id) ?? null) as typeof base | null);
  const stateOf = (id: string) => seams.statuses.get(id)?.state ?? "published";
  return {
    loadPublishedPortableSnapshot: async (id: string) => (stateOf(id) === "revoked" ? null : snapshotOf(id)),
    loadSelectablePortableSnapshot: async (id: string) => (stateOf(id) === "published" ? snapshotOf(id) : null),
    loadHistoricalPortableSnapshot: async (id: string) => snapshotOf(id),
    loadAtomicRevisionStatus: async (ids: readonly string[]) => new Map(ids.flatMap((id) => {
      const snapshot = snapshotOf(id);
      if (!snapshot) return [];
      const state = stateOf(id);
      const successorRevisionId = seams.statuses.get(id)?.successorRevisionId;
      return [[id, { revisionId: id, logicalPartId: snapshot.atomicRevision.logicalPartId, state, selectable: state === "published", pinnable: state !== "revoked", ...(successorRevisionId ? { successorRevisionId } : {}) }] as const];
    })),
  };
});

import { GET as bindingsGet, POST as physicalBindings } from "@/app/api/physical-bindings/route";
import { injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { policyFor } from "@/app/lib/auth/route-policy";
import { blinkerCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import { pcbBoardInstanceId } from "@/app/lib/pcb/board-identity";
import { rebindAtomicSuccessor } from "@/app/lib/physical-binding/atomic-successor";
import { InMemoryPhysicalBindingRepository, PhysicalBindingService } from "@/app/lib/physical-binding/repository";
import type { ComponentReviewRequest } from "@/app/lib/physical-binding/review-handoff";

const SCOPE = { tenantId: "local", projectId: "b19-e-e5-rebind", branchId: "main" } as const;
const BOARD_ID = pcbBoardInstanceId(SCOPE.projectId);
const USERS = { editor: "u-e5-editor", reviewer: "u-e5-reviewer", admin: "u-e5-admin" } as const;
type User = keyof typeof USERS;

function signIn(user: User): void {
  injectIdentity({ userId: USERS[user] });
  injectMembership((Object.keys(USERS) as User[]).map((name) => ({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, userId: USERS[name], role: name === "editor" ? "editor" : name })));
}
function post(body: unknown): Request {
  return new Request("http://localhost/api/physical-bindings", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": SCOPE.tenantId, "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": SCOPE.branchId }, body: JSON.stringify(body) });
}
function get(setId: string): Request {
  return new Request(`http://localhost/api/physical-bindings?setId=${encodeURIComponent(setId)}`, { method: "GET", headers: { origin: "http://localhost", "x-sirkit-tenant-id": SCOPE.tenantId, "x-sirkit-project-id": SCOPE.projectId, "x-sirkit-branch-id": SCOPE.branchId } });
}
async function json<T = Record<string, unknown>>(response: Response): Promise<T> { return (await response.clone().json()) as T; }

type SetBody = { set: { setId: string; revision: number; effectiveSelectedRevisionId?: string }; bindings: Array<{ revisionId: string; bindingId: string; lifecycleState: string; approval: { state: string }; exactPart?: { atomicPartRevisionId: string } }>; auditEvents: Array<{ action: string; bindingId: string }> };
type Preview = { fromRevisionId: string; toRevisionId: string; fromStatus: string; toStatus: string; setId: string; bindingRevisionId: string; diff: { blockers: string[]; impacts: string[] }; diffDigest: string };

const revisions = [...blinkerCatalog().snapshots.keys()].sort();
const REV_A = revisions[0]!;
const REV_B = revisions[1]!;
const COMPONENT = "c-e5-rebind";
const target = () => ({ componentInstanceId: COMPONENT, boardInstanceId: BOARD_ID, fromRevisionId: REV_A, toRevisionId: seams.successorId });

let setId = "";
let oldBindingRevisionId = "";

describe("[B19-E E5 e] successor preview and rebind through the route", () => {
  beforeEach(() => { seams.failNextCommit = false; });
  afterAll(() => { resetInjectedIdentity(); seams.statuses.clear(); });

  it("0. a reviewer binds the component to revision A; A is then superseded by its successor", async () => {
    signIn("reviewer");
    const bound = await physicalBindings(post({ operation: "bind_atomic_selection", componentInstanceId: COMPONENT, boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_A }));
    const body = await json<{ setId: string; bindingRevisionId: string }>(bound);
    expect(bound.status, JSON.stringify(body)).toBe(201);
    setId = body.setId;
    oldBindingRevisionId = body.bindingRevisionId;
    seams.statuses.set(REV_A, { state: "superseded", successorRevisionId: seams.successorId });
    expect(seams.successorId).not.toBe("");
  });

  it("1. the route policy never admits automation, and the library refuses a non-human actor before reading anything", async () => {
    expect(policyFor("/api/physical-bindings", "POST")!.permittedRoles).not.toContain("automation");
    const repository = new InMemoryPhysicalBindingRepository();
    let reads = 0;
    const deps = { service: new PhysicalBindingService(repository), repository, loadStatus: async () => { reads += 1; return new Map(); }, loadSnapshot: async () => { reads += 1; return null; } };
    for (const actor of [{ actorId: "svc-automation", actorKind: "automated_engine", sessionId: "s", role: "automation" }, { actorId: "u-model", actorKind: "ai", sessionId: "s", role: "project_admin" }] as const) {
      await expect(rebindAtomicSuccessor(deps as never, { scope: SCOPE, actor: actor as never, ...target(), diffDigest: `sha256:${"0".repeat(64)}`, reason: "automated rebind" })).rejects.toThrow(/PB_ATOMIC_REBIND_HUMAN_REQUIRED/);
    }
    expect(reads).toBe(0);
  });

  it("2. an editor may preview (the diff and its digest) but not rebind: 403 with the reviewer-rebind handoff", async () => {
    signIn("editor");
    const preview = await physicalBindings(post({ operation: "preview_atomic_successor", ...target() }));
    const previewBody = await json<{ ok: boolean; preview: Preview }>(preview);
    expect(preview.status, JSON.stringify(previewBody).slice(0, 400)).toBe(200);
    expect(previewBody.preview).toMatchObject({ fromRevisionId: REV_A, toRevisionId: seams.successorId, fromStatus: "superseded", toStatus: "published", setId, bindingRevisionId: oldBindingRevisionId });
    expect(previewBody.preview.diff.blockers).toEqual([]);
    expect(previewBody.preview.diffDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    const refused = await physicalBindings(post({ operation: "rebind_atomic_successor", ...target(), diffDigest: previewBody.preview.diffDigest, reason: "move to the successor" }));
    expect(refused.status).toBe(403);
    // [B19-E E5 review] a review request cannot complete a rebind (its approval binds without superseding): the handoff names the
    // reviewer's rebind instead
    expect(await json(refused)).toMatchObject({ code: "PB_ATOMIC_REBIND_REVIEWER_REQUIRED", handoff: "reviewer_rebind_atomic_successor" });
  });

  it("3. a missing digest or reason is 400; a stale digest is 409; a to revision that is not the successor is 409", async () => {
    signIn("reviewer");
    const digest = (await json<{ preview: Preview }>(await physicalBindings(post({ operation: "preview_atomic_successor", ...target() })))).preview.diffDigest;
    const noDigest = await physicalBindings(post({ operation: "rebind_atomic_successor", ...target(), reason: "move" }));
    expect([noDigest.status, (await json(noDigest)).code]).toEqual([400, "PB_API_REBIND_INPUT_INVALID"]);
    const noReason = await physicalBindings(post({ operation: "rebind_atomic_successor", ...target(), diffDigest: digest, reason: "   " }));
    expect(noReason.status).toBe(400);
    const stale = await physicalBindings(post({ operation: "rebind_atomic_successor", ...target(), diffDigest: `sha256:${"a".repeat(64)}`, reason: "move" }));
    expect([stale.status, (await json(stale)).code]).toEqual([409, "PB_REBIND_DIFF_CHANGED_CONFLICT"]);
    const notSuccessor = await physicalBindings(post({ operation: "rebind_atomic_successor", ...target(), toRevisionId: REV_B, diffDigest: digest, reason: "move" }));
    expect([notSuccessor.status, (await json(notSuccessor)).code]).toEqual([409, "PB_REBIND_NOT_SUCCESSOR_CONFLICT"]);
    const notEffective = await physicalBindings(post({ operation: "preview_atomic_successor", ...target(), componentInstanceId: "c-e5-unbound" }));
    expect([notEffective.status, (await json(notEffective)).code]).toEqual([409, "PB_REBIND_FROM_NOT_EFFECTIVE_CONFLICT"]);
  });

  it("4. a diff with blockers is refused even with its own digest (a deprecated successor is not selectable)", async () => {
    signIn("reviewer");
    seams.statuses.set(seams.successorId, { state: "deprecated" });
    try {
      const preview = (await json<{ preview: Preview }>(await physicalBindings(post({ operation: "preview_atomic_successor", ...target() })))).preview;
      expect(preview.diff.blockers).toContain("target revision is deprecated");
      const refused = await physicalBindings(post({ operation: "rebind_atomic_successor", ...target(), diffDigest: preview.diffDigest, reason: "move" }));
      expect([refused.status, (await json(refused)).code]).toEqual([409, "PB_REBIND_DIFF_BLOCKED_CONFLICT"]);
    } finally {
      seams.statuses.delete(seams.successorId);
    }
  });

  it("5. a failed commit leaves the old binding in effect and adds nothing", async () => {
    signIn("reviewer");
    const before = await json<SetBody>(await bindingsGet(get(setId)));
    const digest = (await json<{ preview: Preview }>(await physicalBindings(post({ operation: "preview_atomic_successor", ...target() })))).preview.diffDigest;
    seams.failNextCommit = true;
    const failed = await physicalBindings(post({ operation: "rebind_atomic_successor", ...target(), diffDigest: digest, reason: "move to the successor" }));
    expect(failed.ok).toBe(false);
    const after = await json<SetBody>(await bindingsGet(get(setId)));
    expect(after.set.revision).toBe(before.set.revision);
    expect(after.set.effectiveSelectedRevisionId).toBe(oldBindingRevisionId);
    expect(after.bindings).toEqual(before.bindings);
    expect(after.auditEvents).toHaveLength(before.auditEvents.length);
  });

  it("5b. the digest pins the diff, the scope, the component and the binding revision, never who previewed it", async () => {
    // [B19-E E5 review] the scope the route passed carried the actor (id, role, session): each member's digest differed
    signIn("editor");
    const editorDigest = (await json<{ preview: Preview }>(await physicalBindings(post({ operation: "preview_atomic_successor", ...target() })))).preview.diffDigest;
    signIn("reviewer");
    const reviewerDigest = (await json<{ preview: Preview }>(await physicalBindings(post({ operation: "preview_atomic_successor", ...target() })))).preview.diffDigest;
    expect(reviewerDigest).toBe(editorDigest);
  });

  it("6. a reviewer's rebind supersedes the old binding, then selects and approves the successor, in one commit", async () => {
    // [B19-E E5 review] the digest an editor previewed is the one the reviewer rebinds with
    signIn("editor");
    const digest = (await json<{ preview: Preview }>(await physicalBindings(post({ operation: "preview_atomic_successor", ...target() })))).preview.diffDigest;
    signIn("reviewer");
    const before = await json<SetBody>(await bindingsGet(get(setId)));
    const commitsBefore = seams.commits;
    const rebound = await physicalBindings(post({ operation: "rebind_atomic_successor", ...target(), diffDigest: digest, reason: "move to the successor" }));
    const body = await json<{ ok: boolean; rebind: { setId: string; supersededBindingRevisionId: string; bindingRevisionId: string; lifecycleState: string; alreadyBound: boolean; diffDigest: string } }>(rebound);
    expect(rebound.status, JSON.stringify(body).slice(0, 400)).toBe(201);
    expect(body.rebind).toMatchObject({ setId, supersededBindingRevisionId: oldBindingRevisionId, lifecycleState: "selected", alreadyBound: false, diffDigest: digest });
    expect(seams.commits - commitsBefore).toBe(1);

    const after = await json<SetBody>(await bindingsGet(get(setId)));
    const selected = after.bindings.find((binding) => binding.revisionId === after.set.effectiveSelectedRevisionId)!;
    expect(selected.revisionId).toBe(body.rebind.bindingRevisionId);
    expect(selected.exactPart?.atomicPartRevisionId).toBe(seams.successorId);
    expect(selected.approval.state).toBe("approved");
    const old = before.bindings.find((binding) => binding.revisionId === oldBindingRevisionId)!;
    expect(after.bindings.find((binding) => binding.bindingId === old.bindingId)?.lifecycleState).toBe("superseded");
    const added = after.auditEvents.slice(before.auditEvents.length).map((event) => `${event.action}:${event.bindingId === old.bindingId ? "old" : "new"}`);
    expect(added).toEqual(["supersede:old", "create_candidate:new", "select:new", "revalidate:new", "approve:new"]);
  });

  it("7. repeating the rebind is idempotent: 200 alreadyBound, nothing written", async () => {
    signIn("admin");
    const before = await json<SetBody>(await bindingsGet(get(setId)));
    const again = await physicalBindings(post({ operation: "rebind_atomic_successor", ...target(), diffDigest: `sha256:${"b".repeat(64)}`, reason: "again" }));
    expect(again.status).toBe(200);
    const replay = (await json<{ rebind: { alreadyBound: boolean; diffDigest: string | null } }>(again)).rebind;
    expect(replay.alreadyBound).toBe(true);
    // [B19-E E5 review] nothing was previewed on a replay: the caller's digest is never echoed as if it had been verified
    expect(replay.diffDigest).toBeNull();
    expect((await json<SetBody>(await bindingsGet(get(setId)))).set.revision).toBe(before.set.revision);
  });

  it("7b. a repeated rebind re-reads the successor's status: once it is revoked the replay is refused, never answered as success", async () => {
    // [B19-E E5 review] bind_atomic_selection's replay refuses a revoked revision; the rebind replay answered 200 alreadyBound
    signIn("reviewer");
    const before = await json<SetBody>(await bindingsGet(get(setId)));
    seams.statuses.set(seams.successorId, { state: "revoked" });
    try {
      const again = await physicalBindings(post({ operation: "rebind_atomic_successor", ...target(), diffDigest: `sha256:${"c".repeat(64)}`, reason: "again, after the successor was revoked" }));
      expect(again.ok).toBe(false);
      expect([again.status, (await json(again)).code]).toEqual([422, "PB_ATOMIC_REVISION_REVOKED"]);
    } finally {
      seams.statuses.delete(seams.successorId);
    }
    expect((await json<SetBody>(await bindingsGet(get(setId)))).set.revision).toBe(before.set.revision);
  });
});

describe("[B19-E E5 g] an installed symbol that differs from the revision's symbol blocks review and binding", () => {
  const symbolOf = (id: string) => blinkerCatalog().snapshots.get(id)!.symbol.versionId;

  it("the review request carries the blocker and cannot be approved; a matching symbol has none", async () => {
    signIn("editor");
    const mismatched = await json<{ request: ComponentReviewRequest }>(await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-e5-sym", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_B, symbolAssetVersionId: "symbolv_not_this_revision" })));
    expect(mismatched.request.evidence.blockers?.[0]).toMatch(/^symbol differs from revision/);
    const matching = await json<{ request: ComponentReviewRequest }>(await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-e5-sym-ok", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_B, symbolAssetVersionId: symbolOf(REV_B) })));
    expect(matching.request.evidence.blockers).toBeUndefined();
    signIn("reviewer");
    const approve = await physicalBindings(post({ operation: "resolve_review_request", requestId: mismatched.request.requestId, decision: "approve", reason: "looks fine" }));
    expect([approve.status, (await json(approve)).code]).toEqual([409, "PB_REVIEW_BLOCKED_CONFLICT"]);
    const approveOk = await physicalBindings(post({ operation: "resolve_review_request", requestId: matching.request.requestId, decision: "approve", reason: "symbol matches" }));
    expect(approveOk.status).toBe(200);
  });

  it("a bind that names a different installed symbol is 409 and binds nothing", async () => {
    signIn("reviewer");
    const refused = await physicalBindings(post({ operation: "bind_atomic_selection", componentInstanceId: "c-e5-sym-bind", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_B, symbolAssetVersionId: "symbolv_not_this_revision" }));
    expect([refused.status, (await json(refused)).code]).toEqual([409, "PB_ATOMIC_SYMBOL_MISMATCH_CONFLICT"]);
    const bound = await physicalBindings(post({ operation: "bind_atomic_selection", componentInstanceId: "c-e5-sym-bind", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_B, symbolAssetVersionId: symbolOf(REV_B) }));
    expect(bound.status).toBe(201);
    // [B19-E E5 review] the replay of an existing approved binding checks the installed symbol too
    const boundSet = (await json<{ setId: string }>(bound)).setId;
    const before = await json<SetBody>(await bindingsGet(get(boundSet)));
    const replayMismatch = await physicalBindings(post({ operation: "bind_atomic_selection", componentInstanceId: "c-e5-sym-bind", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_B, symbolAssetVersionId: "symbolv_not_this_revision" }));
    expect([replayMismatch.status, (await json(replayMismatch)).code]).toEqual([409, "PB_ATOMIC_SYMBOL_MISMATCH_CONFLICT"]);
    const after = await json<SetBody>(await bindingsGet(get(boundSet)));
    expect(after.set.revision).toBe(before.set.revision);
    expect(after.set.effectiveSelectedRevisionId).toBe(before.set.effectiveSelectedRevisionId);
    const replayMatching = await physicalBindings(post({ operation: "bind_atomic_selection", componentInstanceId: "c-e5-sym-bind", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_B, symbolAssetVersionId: symbolOf(REV_B) }));
    expect([replayMatching.status, (await json<{ alreadyBound: boolean }>(replayMatching)).alreadyBound]).toEqual([200, true]);
  });
});

type SuccessorPreviewBody = { preview: Preview };
const previewOf = async (body: Record<string, unknown>) => {
  const response = await physicalBindings(post({ operation: "preview_atomic_successor", ...body }));
  return { status: response.status, body: await json<SuccessorPreviewBody & { code?: string }>(response) };
};

describe("[B19-E E5 review] the from revision must be the component's effective approved selection", () => {
  afterAll(() => { seams.statuses.clear(); });

  it("a component bound to another revision can neither preview nor rebind a move from a revision it is not bound to", async () => {
    seams.statuses.clear();
    signIn("reviewer");
    const bound = await physicalBindings(post({ operation: "bind_atomic_selection", componentInstanceId: "c-e5-other-rev", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_B }));
    expect(bound.status).toBe(201);
    const otherSet = (await json<{ setId: string }>(bound)).setId;
    seams.statuses.set(REV_A, { state: "superseded", successorRevisionId: seams.successorId });
    const before = await json<SetBody>(await bindingsGet(get(otherSet)));
    const move = { componentInstanceId: "c-e5-other-rev", boardInstanceId: BOARD_ID, fromRevisionId: REV_A, toRevisionId: seams.successorId };
    const preview = await previewOf(move);
    expect([preview.status, preview.body.code]).toEqual([409, "PB_REBIND_FROM_NOT_EFFECTIVE_CONFLICT"]);
    const rebind = await physicalBindings(post({ operation: "rebind_atomic_successor", ...move, diffDigest: `sha256:${"e".repeat(64)}`, reason: "move a part that is bound elsewhere" }));
    expect([rebind.status, (await json(rebind)).code]).toEqual([409, "PB_REBIND_FROM_NOT_EFFECTIVE_CONFLICT"]);
    const after = await json<SetBody>(await bindingsGet(get(otherSet)));
    expect(after.set).toEqual(before.set);
    expect(after.bindings).toEqual(before.bindings);
  });
});

describe("[B19-E E5 review] an editor's handoff and a review of another revision never break the reviewer's rebind", () => {
  const COMPONENT_H = "c-e5-handoff";
  const move = () => ({ componentInstanceId: COMPONENT_H, boardInstanceId: BOARD_ID, fromRevisionId: REV_A, toRevisionId: seams.successorId });
  afterAll(() => { seams.statuses.clear(); });

  let handoffSet = "";

  it("an editor's refused rebind names the reviewer's rebind, never a review request (which cannot complete a rebind)", async () => {
    seams.statuses.clear();
    signIn("reviewer");
    const bound = await physicalBindings(post({ operation: "bind_atomic_selection", componentInstanceId: COMPONENT_H, boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_A }));
    expect(bound.status).toBe(201);
    handoffSet = (await json<{ setId: string }>(bound)).setId;
    seams.statuses.set(REV_A, { state: "superseded", successorRevisionId: seams.successorId });

    signIn("editor");
    const editorPreview = await previewOf(move());
    const refused = await physicalBindings(post({ operation: "rebind_atomic_successor", ...move(), diffDigest: editorPreview.body.preview.diffDigest, reason: "move to the successor" }));
    expect(refused.status).toBe(403);
    expect((await json(refused)).handoff).toBe("reviewer_rebind_atomic_successor");
  });

  it("approving a review of the successor while the old binding is in effect is 409, and the candidate it left never blocks the rebind", async () => {
    expect(handoffSet).not.toBe("");
    seams.statuses.set(REV_A, { state: "superseded", successorRevisionId: seams.successorId });
    signIn("editor");
    // what an editor could still do through the API: request review of the successor itself
    const requested = await json<{ request: ComponentReviewRequest }>(await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: COMPONENT_H, boardInstanceId: BOARD_ID, atomicPartRevisionId: seams.successorId })));
    expect(requested.request.status).toBe("pending");

    signIn("reviewer");
    const before = await json<SetBody>(await bindingsGet(get(handoffSet)));
    const approve = await physicalBindings(post({ operation: "resolve_review_request", requestId: requested.request.requestId, decision: "approve", reason: "approve the successor" }));
    expect([approve.status, (await json(approve)).code]).toEqual([409, "PB_ACTIVE_SELECTION_CONFLICT"]);
    // the refused select still leaves the candidate it created (pre-existing lifecycle behaviour, kept: the committed recovery
    // route fixture's board content depends on it); the old binding stays in effect
    const after = await json<SetBody>(await bindingsGet(get(handoffSet)));
    expect(after.set.effectiveSelectedRevisionId).toBe(before.set.effectiveSelectedRevisionId);
    const orphan = after.bindings.find((binding) => binding.exactPart?.atomicPartRevisionId === seams.successorId);
    expect(orphan?.lifecycleState).toBe("candidate");

    // the reviewer's rebind reuses that identical candidate instead of colliding with it (PB_CANDIDATE_IDENTITY_COLLISION, 422)
    const digest = (await previewOf(move())).body.preview.diffDigest;
    const rebound = await physicalBindings(post({ operation: "rebind_atomic_successor", ...move(), diffDigest: digest, reason: "move to the successor" }));
    expect(rebound.status, JSON.stringify(await json(rebound)).slice(0, 300)).toBe(201);
    const afterRebind = await json<SetBody>(await bindingsGet(get(handoffSet)));
    const selected = afterRebind.bindings.find((binding) => binding.revisionId === afterRebind.set.effectiveSelectedRevisionId)!;
    expect([selected.bindingId, selected.exactPart?.atomicPartRevisionId, selected.approval.state]).toEqual([orphan!.bindingId, seams.successorId, "approved"]);
    expect(afterRebind.bindings.filter((binding) => binding.bindingId === orphan!.bindingId)).toHaveLength(1);
    // and the pending review of the successor now resolves as already bound
    const approveAgain = await physicalBindings(post({ operation: "resolve_review_request", requestId: requested.request.requestId, decision: "approve", reason: "the rebind happened" }));
    expect(approveAgain.status).toBe(200);
  });
});

describe("[B19-E E5 review] a named successor that was itself withdrawn: the move follows the chain to a selectable revision", () => {
  const CHAIN = "c-e5-chain";
  const move = (toRevisionId: string) => ({ componentInstanceId: CHAIN, boardInstanceId: BOARD_ID, fromRevisionId: REV_A, toRevisionId });
  afterAll(() => { seams.statuses.clear(); });

  it("a component on a revoked revision whose named successor was superseded moves to that successor's successor", async () => {
    seams.statuses.clear();
    signIn("reviewer");
    const bound = await physicalBindings(post({ operation: "bind_atomic_selection", componentInstanceId: CHAIN, boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_A }));
    expect(bound.status).toBe(201);
    const chainSet = (await json<{ setId: string }>(bound)).setId;
    // R (revoked, names S) -> S (superseded, names S2) -> S2 (published): TRANSITIONS.revoked is [], so R's successor never changes
    seams.statuses.set(REV_A, { state: "revoked", successorRevisionId: seams.successorId });
    seams.statuses.set(seams.successorId, { state: "superseded", successorRevisionId: seams.secondSuccessorId });

    const toNamed = await previewOf(move(seams.successorId));
    expect(toNamed.status).toBe(200);
    expect(toNamed.body.preview.diff.blockers).toContain("target revision is superseded");
    const toChainEnd = await previewOf(move(seams.secondSuccessorId));
    expect(toChainEnd.status, JSON.stringify(toChainEnd.body).slice(0, 300)).toBe(200);
    expect(toChainEnd.body.preview).toMatchObject({ fromStatus: "revoked", toStatus: "published", toRevisionId: seams.secondSuccessorId });
    expect(toChainEnd.body.preview.diff.blockers).toEqual([]);
    const offChain = await previewOf(move(REV_B));
    expect([offChain.status, offChain.body.code]).toEqual([409, "PB_REBIND_NOT_SUCCESSOR_CONFLICT"]);

    const rebound = await physicalBindings(post({ operation: "rebind_atomic_successor", ...move(seams.secondSuccessorId), diffDigest: toChainEnd.body.preview.diffDigest, reason: "move off the revoked revision to the current reissue" }));
    expect(rebound.status, JSON.stringify(await json(rebound)).slice(0, 300)).toBe(201);
    const state = await json<SetBody>(await bindingsGet(get(chainSet)));
    expect(state.bindings.find((binding) => binding.revisionId === state.set.effectiveSelectedRevisionId)?.exactPart?.atomicPartRevisionId).toBe(seams.secondSuccessorId);
  });

  it("list_effective_atomic_selections answers each component's approved binding revision (null when unbound); malformed input is 400", async () => {
    signIn("editor");
    const listed = await physicalBindings(post({ operation: "list_effective_atomic_selections", boardInstanceId: BOARD_ID, componentInstanceIds: [CHAIN, "c-e5-never-bound"] }));
    expect(listed.status).toBe(200);
    expect((await json<{ selections: unknown }>(listed)).selections).toEqual([
      { componentInstanceId: CHAIN, atomicPartRevisionId: seams.secondSuccessorId },
      { componentInstanceId: "c-e5-never-bound", atomicPartRevisionId: null },
    ]);
    for (const body of [
      { boardInstanceId: BOARD_ID },
      { boardInstanceId: BOARD_ID, componentInstanceIds: [] },
      { boardInstanceId: BOARD_ID, componentInstanceIds: [42] },
      { boardInstanceId: BOARD_ID, componentInstanceIds: Array.from({ length: 51 }, (_, index) => `c-${index}`) },
      { componentInstanceIds: [CHAIN] },
    ]) {
      const malformed = await physicalBindings(post({ operation: "list_effective_atomic_selections", ...body }));
      expect([malformed.status, (await json(malformed)).code], JSON.stringify(body).slice(0, 80)).toEqual([400, "PB_API_EFFECTIVE_INPUT_INVALID"]);
    }
  });
});
