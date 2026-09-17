/**
 * [B19-E E5 b] The publication route's `withdraw_revision` operation: deprecate, supersede or revoke a published atomic revision.
 *
 * OD-37: only in the catalog governance tenant and project (default branch), only a project administrator, only a human; a
 * reason is required; only the legal edges from the revision's latest state (409 otherwise); a successor must be a selectable
 * revision of the same logical part (required to supersede). The operation name avoids "publish". It calls E3's
 * append-only `withdrawPublishedAtomicRevision` (the durable path is proven in b19-e-successor-b14-durable.test.ts).
 *
 * Reproduced on the unchanged code: the operation did not exist (400 ATOMIC_PUBLICATION_OPERATION_UNSUPPORTED).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seams = vi.hoisted(() => ({
  statuses: new Map<string, { revisionId: string; logicalPartId: string; state: string; selectable: boolean; pinnable: boolean; successorRevisionId?: string }>(),
  withdrawCalls: [] as Array<Record<string, unknown>>,
  withdrawError: null as Error | null,
  dbReads: 0,
}));
vi.mock("@/app/lib/db/client", () => ({ getDb: () => { seams.dbReads += 1; throw new Error("no database in this suite"); } }));
vi.mock("@/app/lib/durable-workflow/runtime", async () => {
  const { InMemoryDurableWorkflowRepository } = await import("@/app/lib/durable-workflow/repository");
  const repository = new InMemoryDurableWorkflowRepository();
  return { getDurableWorkflowRepository: () => repository };
});
vi.mock("@/app/lib/acquisition/offer-cache-observations", () => ({ loadCachedExternalObservations: async () => [] }));
vi.mock("@/app/lib/atomic/server-catalog", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadAtomicRevisionStatus: async (ids: readonly string[]) => new Map(ids.flatMap((id) => (seams.statuses.has(id) ? [[id, seams.statuses.get(id)!] as const] : []))),
}));
vi.mock("@/app/lib/atomic/server-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/lib/atomic/server-repository")>();
  return {
    ...actual,
    withdrawPublishedAtomicRevision: vi.fn(async (input: Parameters<typeof actual.withdrawPublishedAtomicRevision>[0]) => {
      seams.withdrawCalls.push({ ...input });
      if (seams.withdrawError) throw seams.withdrawError;
      return { revisionId: input.revisionId, from: seams.statuses.get(input.revisionId)!.state, to: input.to, eventId: "status_fixture", auditId: "audit_fixture" };
    }),
  };
});

import { POST } from "../atomic/publication/route";
import { handleAtomicPublicationPost } from "../atomic/publication/handler";
import { injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import type { MembershipRole } from "@/app/lib/auth/project-membership";
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { ATOMIC_PUBLICATION_OPERATIONS } from "@/app/lib/atomic/publication-review-contract";
import { ACTION_COVERAGE_REGISTRY } from "@/app/lib/engineering/action-registry";

const PATH = "/api/components/atomic/publication";
const GOVERNANCE = "sirkit-catalog-governance";
const DESIGN = "a-design-project";
const USERS = { editor: "u-wd-editor", reviewer: "u-wd-reviewer", admin: "u-wd-admin", bot: "agent:catalog-bot" } as const;
type User = keyof typeof USERS;
const ROLE: Record<User, MembershipRole> = { editor: "editor", reviewer: "reviewer", admin: "admin", bot: "admin" };

function signIn(user: User): void {
  injectIdentity({ userId: USERS[user] });
  injectMembership((Object.keys(USERS) as User[]).flatMap((name) => [GOVERNANCE, DESIGN].map((projectId) => ({ tenantId: "local", projectId, userId: USERS[name], role: ROLE[name] }))));
}
function post(body: unknown, projectId = GOVERNANCE): Request {
  return new Request(`http://localhost${PATH}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", "x-sirkit-tenant-id": "local", "x-sirkit-project-id": projectId, "x-sirkit-branch-id": "main" }, body: JSON.stringify(body) });
}
const payload = async (res: Response): Promise<Record<string, unknown>> => (await res.clone().json()) as Record<string, unknown>;
const status = (revisionId: string, state: string, logicalPartId = "lp-timer", successorRevisionId?: string) => seams.statuses.set(revisionId, { revisionId, logicalPartId, state, selectable: state === "published", pinnable: state !== "revoked", ...(successorRevisionId ? { successorRevisionId } : {}) });
const WITHDRAW = { operation: "withdraw_revision", revisionId: "atomic_rev_a", to: "deprecated", reason: "the manufacturer marked it not recommended for new designs" };

beforeEach(() => {
  seams.statuses.clear();
  seams.withdrawCalls.length = 0;
  seams.withdrawError = null;
  seams.dbReads = 0;
  vi.stubEnv("SIRKIT_ATOMIC_CATALOG_PROJECT_ID", GOVERNANCE);
  vi.stubEnv("SIRKIT_ATOMIC_CATALOG_TENANT_ID", "local");
  status("atomic_rev_a", "published");
  status("atomic_rev_b", "published");
  status("atomic_rev_other_part", "published", "lp-resistor");
  status("atomic_rev_deprecated", "deprecated");
  status("atomic_rev_revoked", "revoked");
});
afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("[B19-E E5 b] the operation exists, is named for what it does, and is a human administrator's act", () => {
  it("withdraw_revision is a declared operation whose name avoids publish; the action record names it", () => {
    expect(ATOMIC_PUBLICATION_OPERATIONS).toContain("withdraw_revision");
    expect("withdraw_revision").not.toMatch(/publish/i);
    expect(ACTION_COVERAGE_REGISTRY.find((record) => record.id === "parts.atomic-publication-review")!.domainCommand).toContain("withdraw_revision");
  });

  it("outside the governance project, or with governance unconfigured, it is 403 and nothing is withdrawn", async () => {
    signIn("admin");
    const outside = await POST(post(WITHDRAW, DESIGN));
    expect([outside.status, (await payload(outside)).code]).toEqual([403, "ATOMIC_PUBLICATION_GOVERNANCE_FORBIDDEN"]);
    vi.stubEnv("SIRKIT_ATOMIC_CATALOG_PROJECT_ID", "");
    const unconfigured = await POST(post(WITHDRAW));
    expect([unconfigured.status, (await payload(unconfigured)).code]).toEqual([403, "ATOMIC_PUBLICATION_GOVERNANCE_UNCONFIGURED"]);
    expect(seams.withdrawCalls).toEqual([]);
  });

  it("an editor or a reviewer is 403; an AI principal or an AI actor kind is 403 HUMAN_REQUIRED", async () => {
    for (const user of ["editor", "reviewer"] as const) {
      signIn(user);
      const res = await POST(post(WITHDRAW));
      expect([res.status, (await payload(res)).code], user).toEqual([403, "ATOMIC_PUBLICATION_FORBIDDEN"]);
    }
    signIn("bot");
    const bot = await POST(post(WITHDRAW));
    expect([bot.status, (await payload(bot)).code]).toEqual([403, "ATOMIC_PUBLICATION_HUMAN_REQUIRED"]);
    const context = { principalId: "u", tenantId: "local", projectId: GOVERNANCE, branchId: "main", actor: { actorId: "u-model", actorKind: "ai", sessionId: "s", role: "project_admin" }, sessionIdentity: "s", authMethod: "supabase_cookie", authStrength: "aal1", membershipRevision: "m", correlationId: "c" } as unknown as TrustedRequestContext;
    const direct = await handleAtomicPublicationPost({ context, body: WITHDRAW }, { env: { SIRKIT_ATOMIC_CATALOG_PROJECT_ID: GOVERNANCE, SIRKIT_ATOMIC_CATALOG_TENANT_ID: "local" }, review: () => { throw new Error("composed before the actor was checked"); } });
    expect([direct.status, (await payload(direct)).code]).toEqual([403, "ATOMIC_PUBLICATION_HUMAN_REQUIRED"]);
    expect(seams.withdrawCalls).toEqual([]);
  });
});

describe("[B19-E E5 b] the body is closed and the reason is required", () => {
  it.each([
    ["no reason", { ...WITHDRAW, reason: undefined }, "reason"],
    ["a blank reason", { ...WITHDRAW, reason: "   " }, "reason"],
    ["a state that is not a withdrawal", { ...WITHDRAW, to: "published" }, "to"],
    ["a malformed revision id", { ...WITHDRAW, revisionId: "atomic rev" }, "revisionId"],
    ["supersede without a successor", { ...WITHDRAW, to: "superseded" }, "successorRevisionId"],
    ["a revision as its own successor", { ...WITHDRAW, to: "superseded", successorRevisionId: "atomic_rev_a" }, "successorRevisionId"],
  ])("%s is 400", async (_label, body, field) => {
    signIn("admin");
    const res = await POST(post(JSON.parse(JSON.stringify(body))));
    const answer = await payload(res);
    expect([res.status, answer.code]).toEqual([400, "ATOMIC_PUBLICATION_INPUT_INVALID"]);
    expect(answer.detail).toEqual([field]);
    expect(seams.withdrawCalls).toEqual([]);
  });

  it("a reason within 2 000 code points but over E3's 2 000 UTF-16 units (astral characters) is 400, never a 500", async () => {
    // [B19-E E5 review] the E4 reason bound counts code points; withdrawPublishedAtomicRevision counts UTF-16 units and threw a
    // message no refusal pattern matched (500). The mock refuses the way E3 does, so a reason reaching it shows here.
    signIn("admin");
    const astral = String.fromCodePoint(0x1f600).repeat(1_500);
    expect([Array.from(astral).length, astral.length]).toEqual([1_500, 3_000]);
    seams.withdrawError = new Error("Atomic withdrawal reason is limited to 2000 characters");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = await POST(post({ ...WITHDRAW, reason: astral }));
    const answer = await payload(res);
    expect([res.status, answer.code]).toEqual([400, "ATOMIC_PUBLICATION_INPUT_INVALID"]);
    expect(answer.detail).toEqual(["reason"]);
    expect(seams.withdrawCalls).toEqual([]);
    // exactly 2 000 UTF-16 units still reaches the transaction
    seams.withdrawError = null;
    const bounded = await POST(post({ ...WITHDRAW, reason: String.fromCodePoint(0x1f600).repeat(1_000) }));
    expect(bounded.status).toBe(200);
    expect(seams.withdrawCalls).toHaveLength(1);
  });

  it("an undeclared field (an actor role or an event id) is 400; a forbidden authority key is refused by the wrapper", async () => {
    signIn("admin");
    for (const extra of [{ actorRole: "publisher" }, { eventId: "status_x" }, { idempotencyKey: "k-1" }]) {
      const res = await POST(post({ ...WITHDRAW, ...extra }));
      expect([res.status, (await payload(res)).code], JSON.stringify(extra)).toEqual([400, "ATOMIC_PUBLICATION_INPUT_INVALID"]);
    }
    const forbidden = await POST(post({ ...WITHDRAW, evidence: {} }));
    expect([forbidden.status, (await payload(forbidden)).code]).toEqual([400, "AUTH_AUTHORITATIVE_INPUT_FORBIDDEN"]);
    expect(seams.withdrawCalls).toEqual([]);
  });
});

describe("[B19-E E5 b] legal edges and successor rules, before and inside the transaction", () => {
  it("an unknown revision is 404", async () => {
    signIn("admin");
    const res = await POST(post({ ...WITHDRAW, revisionId: "atomic_rev_missing" }));
    expect([res.status, (await payload(res)).code]).toEqual([404, "ATOMIC_PUBLICATION_REVISION_NOT_FOUND"]);
    expect(seams.withdrawCalls).toEqual([]);
  });

  it.each([
    ["revoked -> deprecated", "atomic_rev_revoked", "deprecated"],
    ["revoked -> revoked", "atomic_rev_revoked", "revoked"],
    ["deprecated -> deprecated", "atomic_rev_deprecated", "deprecated"],
  ])("an illegal edge (%s) is 409", async (_label, revisionId, to) => {
    signIn("admin");
    const res = await POST(post({ ...WITHDRAW, revisionId, to }));
    const answer = await payload(res);
    expect([res.status, answer.code]).toEqual([409, "ATOMIC_PUBLICATION_WITHDRAWAL_ILLEGAL"]);
    expect(seams.withdrawCalls).toEqual([]);
  });

  it.each([
    ["a missing successor", "atomic_rev_missing"],
    ["a withdrawn successor", "atomic_rev_deprecated"],
    ["a successor of another logical part", "atomic_rev_other_part"],
  ])("%s is 409", async (_label, successorRevisionId) => {
    signIn("admin");
    const res = await POST(post({ ...WITHDRAW, to: "superseded", successorRevisionId }));
    expect([res.status, (await payload(res)).code]).toEqual([409, "ATOMIC_PUBLICATION_SUCCESSOR_REFUSED"]);
    expect(seams.withdrawCalls).toEqual([]);
  });

  it("a legal supersession by a selectable same-part successor calls the append-only withdrawal as an administrator and answers the event", async () => {
    signIn("admin");
    const res = await POST(post({ ...WITHDRAW, to: "superseded", successorRevisionId: "atomic_rev_b" }));
    const answer = await payload(res);
    expect(res.status, JSON.stringify(answer)).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(answer).toMatchObject({ ok: true, withdrawal: { revisionId: "atomic_rev_a", from: "published", to: "superseded", eventId: "status_fixture", auditId: "audit_fixture" } });
    expect(seams.withdrawCalls).toEqual([{ revisionId: "atomic_rev_a", to: "superseded", successorRevisionId: "atomic_rev_b", actorId: USERS.admin, actorRole: "admin", reason: WITHDRAW.reason }]);
    // revoking a deprecated revision is a legal edge too; no successor is needed
    const revoke = await POST(post({ ...WITHDRAW, revisionId: "atomic_rev_deprecated", to: "revoked" }));
    expect(revoke.status).toBe(200);
  });

  it.each([
    ["Illegal withdrawal published -> deprecated", 409, "ATOMIC_PUBLICATION_WITHDRAWAL_ILLEGAL"],
    ["Successor atomic_rev_b is not a selectable published revision", 409, "ATOMIC_PUBLICATION_SUCCESSOR_REFUSED"],
    ["A successor must be a revision of the same logical part", 409, "ATOMIC_PUBLICATION_SUCCESSOR_REFUSED"],
    ["atomic_rev_a is not a published atomic revision", 404, "ATOMIC_PUBLICATION_REVISION_NOT_FOUND"],
  ])("a transaction that refuses (%s) keeps its truthful status", async (message, statusCode, code) => {
    signIn("admin");
    seams.withdrawError = new Error(message);
    const res = await POST(post({ ...WITHDRAW, to: "superseded", successorRevisionId: "atomic_rev_b" }));
    expect([res.status, (await payload(res)).code]).toEqual([statusCode, code]);
  });

  it("any other failure answers the fixed sentence (500) without the error text", async () => {
    signIn("admin");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    seams.withdrawError = new Error("connection to postgres://user:secret@db failed");
    const res = await POST(post(WITHDRAW));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/secret|postgres/);
  });
});
