/**
 * B16-C.2 — component-binding review handoff through the real
 * `/api/physical-bindings` route (isolated repositories, blinker catalog).
 *
 * Reproduced gap: an editor who tried to publish an exact binding was refused
 * 422 `PB_ATOMIC_BIND_HUMAN_REVIEWER_REQUIRED` — the status of malformed
 * engineering input — and nothing carried the request to a reviewer.
 *
 * Proven here: 403 with the visible handoff; editor requests (idempotent);
 * reviewer sees candidate / symbol / footprint / package / pin-to-pad
 * evidence and source revisions; approve performs the ordinary binding under
 * the reviewer's identity; reject names the reason and the editor can ask
 * again; a role change or revocation retires a pending request; evidence
 * drift between request and approval is a 409; cross-project isolation.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({ snapshotOverride: null as null | ((revisionId: string, snapshot: unknown) => unknown) }));
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
  const { blinkerCatalog } = await import("@/app/lib/fixture-runtime/blinker/catalog");
  return {
    loadPublishedPortableSnapshot: async (revisionId: string) => {
      const snapshot = structuredClone(blinkerCatalog().snapshots.get(revisionId) ?? null);
      return snapshot && seams.snapshotOverride ? seams.snapshotOverride(revisionId, snapshot) : snapshot;
    },
  };
});

import { GET as bindingsGet, POST as physicalBindings } from "@/app/api/physical-bindings/route";
import { injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import type { InMemoryProjectMembershipRepository, MembershipRole } from "@/app/lib/auth/project-membership";
import { blinkerCatalog } from "@/app/lib/fixture-runtime/blinker/catalog";
import { pcbBoardInstanceId } from "@/app/lib/pcb/board-identity";
import type { ComponentReviewRequest } from "@/app/lib/physical-binding/review-handoff";

const SCOPE = { tenantId: "local", projectId: "b16-c-review", branchId: "main" } as const;
const OTHER = { tenantId: "local", projectId: "b16-c-other", branchId: "main" } as const;
const BOARD_ID = pcbBoardInstanceId(SCOPE.projectId);
const USERS = { editor: "u-review-editor", reviewer: "u-review-reviewer", admin: "u-review-admin", viewer: "u-review-viewer", stranger: "u-review-stranger" } as const;
type User = keyof typeof USERS;
const ROLES: Record<User, MembershipRole> = { editor: "editor", reviewer: "reviewer", admin: "admin", viewer: "viewer", stranger: "editor" };

let membership: InMemoryProjectMembershipRepository | null = null; void membership;
/** One membership repository for the whole project: signing in changes the IDENTITY only. */
function signIn(user: User, roles: Partial<Record<User, { role: MembershipRole; state?: "active" | "revoked"; version?: number }>> = {}): void {
  injectIdentity({ userId: USERS[user] });
  membership = injectMembership([
    ...(["editor", "reviewer", "admin", "viewer"] as User[]).map((name) => ({ tenantId: SCOPE.tenantId, projectId: SCOPE.projectId, userId: USERS[name], role: roles[name]?.role ?? ROLES[name], state: roles[name]?.state ?? "active", version: roles[name]?.version ?? 1 })),
    { tenantId: OTHER.tenantId, projectId: OTHER.projectId, userId: USERS.stranger, role: "reviewer" },
  ]);
}

function post(body: unknown, scope: { tenantId: string; projectId: string; branchId: string } = SCOPE): Request {
  return new Request("http://localhost/api/physical-bindings", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": scope.tenantId, "x-sirkit-project-id": scope.projectId, "x-sirkit-branch-id": scope.branchId }, body: JSON.stringify(body) });
}
function get(path: string, scope: { tenantId: string; projectId: string; branchId: string } = SCOPE): Request {
  return new Request(`http://localhost${path}`, { method: "GET", headers: { origin: "http://localhost", "x-sirkit-tenant-id": scope.tenantId, "x-sirkit-project-id": scope.projectId, "x-sirkit-branch-id": scope.branchId } });
}
async function json<T = Record<string, unknown>>(response: Response): Promise<T> { return (await response.clone().json()) as T; }
type ListBody = { ok: boolean; viewer: { role: string; canRequest: boolean; canResolve: boolean }; membershipVerified: boolean; requests: Array<ComponentReviewRequest & { revision: number }> };

const revisions = [...blinkerCatalog().snapshots.keys()].sort();
const [REV_A, REV_B, REV_C] = revisions;

describe("B16-C.2 component-binding review handoff (real route, isolated stores)", () => {
  beforeAll(() => { expect(revisions.length).toBeGreaterThanOrEqual(3); });
  afterAll(() => { resetInjectedIdentity(); seams.snapshotOverride = null; });

  it("1. an editor cannot publish a binding: 403 (not 422) and the response names the handoff", async () => {
    signIn("editor");
    const refused = await physicalBindings(post({ operation: "bind_atomic_selection", componentInstanceId: "c-1", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_A }));
    expect(refused.status).toBe(403);
    expect(await json(refused)).toMatchObject({ ok: false, code: "PB_ATOMIC_BIND_HUMAN_REVIEWER_REQUIRED", handoff: "request_atomic_review" });
  });

  it("2. a viewer may not request review (403); an editor may (201, pending, evidence projected from the published snapshot); repeat is idempotent (200)", async () => {
    signIn("viewer");
    const viewer = await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-1", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_A }));
    expect(viewer.status).toBe(403);
    signIn("editor");
    const created = await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-1", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_A, reason: "please approve the exact timer" }));
    const body = await json<{ ok: boolean; created: boolean; request: ComponentReviewRequest }>(created);
    expect(created.status, JSON.stringify(body).slice(0, 300)).toBe(201);
    expect(body.created).toBe(true);
    expect(body.request.status).toBe("pending");
    expect(body.request.requestedBy.actorId).toBe(USERS.editor);
    expect(body.request.requesterMembershipRevision).toBeTruthy();
    const evidence = body.request.evidence;
    expect(evidence.candidate.exactMpn).toBeTruthy();
    expect(evidence.candidate.manufacturerName).toBeTruthy();
    expect(evidence.symbol.symbolName).toBeTruthy();
    expect(evidence.footprint?.footprintName).toBeTruthy();
    expect(evidence.package?.canonicalName).toBeTruthy();
    expect(evidence.pinToPad?.state).toBe("approved");
    expect(evidence.pinToPad?.entries.length).toBeGreaterThan(0);
    expect(evidence.pinToPad?.entries.every((entry) => entry.padNumbers.length > 0)).toBe(true);
    expect(evidence.sourceRevisions).toMatchObject({ atomicPartRevisionId: REV_A, symbolVersionId: evidence.symbol.versionId, footprintVersionId: evidence.footprint?.versionId, mappingId: evidence.pinToPad?.mappingId });
    expect(evidence.evidenceRefs.length).toBeGreaterThan(0);
    expect(evidence.evidenceDigest).toMatch(/^sha256:/);
    const again = await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-1", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_A }));
    expect(again.status).toBe(200);
    expect(await json<{ created: boolean; request: ComponentReviewRequest }>(again)).toMatchObject({ created: false, request: { requestId: body.request.requestId } });
  });

  it("3. an editor may not resolve (403); the reviewer lists the pending request and approves — the binding is published under the REVIEWER's identity", async () => {
    signIn("editor");
    const list = await json<ListBody>(await physicalBindings(post({ operation: "list_review_requests", boardInstanceId: BOARD_ID })));
    expect(list.viewer).toMatchObject({ role: "pcb_editor", canRequest: true, canResolve: false });
    expect(list.membershipVerified).toBe(true);
    const pending = list.requests.find((item) => item.componentInstanceId === "c-1")!;
    expect(pending.status).toBe("pending");
    const forbidden = await physicalBindings(post({ operation: "resolve_review_request", requestId: pending.requestId, decision: "approve", reason: "self-approval" }));
    expect(forbidden.status).toBe(403);
    expect((await json(forbidden)).code).toBe("PB_REVIEW_RESOLVE_FORBIDDEN");

    signIn("reviewer");
    const reviewerList = await json<ListBody>(await physicalBindings(post({ operation: "list_review_requests", boardInstanceId: BOARD_ID, status: "pending" })));
    expect(reviewerList.viewer).toMatchObject({ role: "reviewer", canResolve: true });
    expect(reviewerList.requests.map((item) => item.requestId)).toContain(pending.requestId);
    const approved = await physicalBindings(post({ operation: "resolve_review_request", requestId: pending.requestId, decision: "approve", reason: "candidate, footprint and pin map verified" }));
    const approvedBody = await json<{ ok: boolean; request: ComponentReviewRequest }>(approved);
    expect(approved.status, JSON.stringify(approvedBody).slice(0, 300)).toBe(200);
    expect(approvedBody.request.status).toBe("approved");
    expect(approvedBody.request.decision).toMatchObject({ decidedBy: { actorId: USERS.reviewer, role: "reviewer" }, lifecycleState: "selected" });
    expect(approvedBody.request.decision?.bindingRevisionId).toBeTruthy();
    // The binding set really exists and is approved.
    const set = await json<{ ok: boolean; set: { effectiveSelectedRevisionId: string }; bindings: Array<{ revisionId: string; approval: { state: string; decidedBy?: { actorId: string } }; createdBy: { actorId: string } }> }>(await bindingsGet(get(`/api/physical-bindings?setId=${encodeURIComponent(approvedBody.request.decision!.bindingSetId!)}`)));
    expect(set.ok).toBe(true);
    const selected = set.bindings.find((item) => item.revisionId === set.set.effectiveSelectedRevisionId)!;
    expect(selected.approval.state).toBe("approved");
    expect(selected.approval.decidedBy?.actorId).toBe(USERS.reviewer);
    // Resolving again is a truthful 409, never a second binding.
    const twice = await physicalBindings(post({ operation: "resolve_review_request", requestId: pending.requestId, decision: "approve", reason: "again" }));
    expect(twice.status).toBe(409);
    expect((await json(twice)).code).toBe("PB_REVIEW_REQUEST_STATE_CONFLICT");
    // The editor resumes: the approved request is visible authority; a fresh request for the same candidate is the approved one (200).
    signIn("editor");
    const resumed = await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-1", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_A }));
    expect(resumed.status).toBe(200);
    expect((await json<{ request: ComponentReviewRequest }>(resumed)).request.status).toBe("approved");
  });

  it("4. reject names the reason; the editor can ask again (a NEW pending request); withdraw is the requester's own act", async () => {
    signIn("editor");
    const first = await json<{ request: ComponentReviewRequest }>(await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-2", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_B })));
    signIn("reviewer");
    const rejected = await physicalBindings(post({ operation: "resolve_review_request", requestId: first.request.requestId, decision: "reject", reason: "wrong package variant for the assembly line" }));
    expect(rejected.status).toBe(200);
    expect((await json<{ request: ComponentReviewRequest }>(rejected)).request).toMatchObject({ status: "rejected", decision: { reason: "wrong package variant for the assembly line" } });
    signIn("editor");
    const second = await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-2", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_B, reason: "variant confirmed with purchasing" }));
    const secondBody = await json<{ created: boolean; request: ComponentReviewRequest }>(second);
    expect(second.status).toBe(201);
    expect(secondBody.created).toBe(true);
    expect(secondBody.request.requestId).not.toBe(first.request.requestId);
    expect(secondBody.request.status).toBe("pending");
    signIn("reviewer");
    const notMine = await physicalBindings(post({ operation: "withdraw_review_request", requestId: secondBody.request.requestId, reason: "not mine" }));
    expect(notMine.status).toBe(403);
    signIn("editor");
    const withdrawn = await physicalBindings(post({ operation: "withdraw_review_request", requestId: secondBody.request.requestId, reason: "changed my mind" }));
    expect(withdrawn.status).toBe(200);
    expect((await json<{ request: ComponentReviewRequest }>(withdrawn)).request.status).toBe("withdrawn");
  });

  it("5. a role change retires the pending request (409 on resolve); a revoked membership too", async () => {
    signIn("editor");
    const pending = await json<{ request: ComponentReviewRequest }>(await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-3", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_C })));
    expect(pending.request.status).toBe("pending");
    // The editor is demoted to viewer (membership version 2) before the reviewer looks.
    signIn("reviewer", { editor: { role: "viewer", version: 2 } });
    const list = await json<ListBody>(await physicalBindings(post({ operation: "list_review_requests", boardInstanceId: BOARD_ID })));
    const retired = list.requests.find((item) => item.requestId === pending.request.requestId)!;
    expect(retired.status).toBe("retired");
    expect(retired.retirement?.reasonCode).toBe("REQUESTER_ROLE_CHANGED");
    const resolve = await physicalBindings(post({ operation: "resolve_review_request", requestId: pending.request.requestId, decision: "approve", reason: "late" }));
    expect(resolve.status).toBe(409);
    expect((await json(resolve)).code).toBe("PB_REVIEW_REQUEST_RETIRED_CONFLICT");
    // Restored as an editor (version 3): a new request; then the membership is REVOKED before review.
    signIn("editor", { editor: { role: "editor", version: 3 } });
    const again = await json<{ created: boolean; request: ComponentReviewRequest }>(await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-3", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_C })));
    expect(again.created).toBe(true);
    expect(again.request.status).toBe("pending");
    signIn("reviewer", { editor: { role: "editor", version: 3, state: "revoked" } });
    const revoked = await physicalBindings(post({ operation: "resolve_review_request", requestId: again.request.requestId, decision: "approve", reason: "late" }));
    expect(revoked.status).toBe(409);
    const list2 = await json<ListBody>(await physicalBindings(post({ operation: "list_review_requests", boardInstanceId: BOARD_ID, status: "retired" })));
    expect(list2.requests.find((item) => item.requestId === again.request.requestId)?.retirement?.reasonCode).toBe("REQUESTER_MEMBERSHIP_REVOKED");
  });

  it("6. evidence that changed between request and approval is refused 409 — the reviewer approved what they saw", async () => {
    signIn("editor", { editor: { role: "editor", version: 4 } });
    const pending = await json<{ request: ComponentReviewRequest }>(await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-4", boardInstanceId: BOARD_ID, atomicPartRevisionId: REV_A })));
    expect(pending.request.status).toBe("pending");
    seams.snapshotOverride = (_id, snapshot) => { const s = snapshot as { exactPart?: { exactMpn: string } }; if (s.exactPart) s.exactPart.exactMpn = `${s.exactPart.exactMpn}-REV2`; return s; };
    try {
      signIn("reviewer", { editor: { role: "editor", version: 4 } });
      const drifted = await physicalBindings(post({ operation: "resolve_review_request", requestId: pending.request.requestId, decision: "approve", reason: "looks fine" }));
      expect(drifted.status).toBe(409);
      expect((await json(drifted)).code).toBe("PB_REVIEW_EVIDENCE_CHANGED_CONFLICT");
    } finally { seams.snapshotOverride = null; }
    const stillPending = await json<ListBody>(await physicalBindings(post({ operation: "list_review_requests", boardInstanceId: BOARD_ID, status: "pending" })));
    expect(stillPending.requests.map((item) => item.requestId)).toContain(pending.request.requestId);
  });

  it("7. cross-project isolation: another project's reviewer sees nothing and cannot resolve; malformed input is 400", async () => {
    signIn("stranger");
    const list = await json<ListBody>(await physicalBindings(post({ operation: "list_review_requests" }, OTHER)));
    expect(list.requests).toEqual([]);
    signIn("editor", { editor: { role: "editor", version: 4 } });
    const mine = await json<ListBody>(await physicalBindings(post({ operation: "list_review_requests", status: "pending" })));
    const target = mine.requests[0]!;
    signIn("stranger");
    const foreign = await physicalBindings(post({ operation: "resolve_review_request", requestId: target.requestId, decision: "approve", reason: "x" }, OTHER));
    expect(foreign.status).toBe(404);
    signIn("reviewer", { editor: { role: "editor", version: 4 } });
    expect((await physicalBindings(post({ operation: "resolve_review_request", requestId: target.requestId, decision: "maybe", reason: "x" }))).status).toBe(400);
    expect((await physicalBindings(post({ operation: "request_atomic_review", componentInstanceId: "c-9" }))).status).toBe(400);
  });
});
