/**
 * B16.0.15 §A — PERMANENT behavioral parity suite for the tranche-8 migration
 * of the two manufacturing routes:
 *   POST /api/pcb/qualify   (authenticated-release; pcb_editor | project_admin)
 *   POST /api/pcb/release   (authenticated-release; project_admin only)
 *
 * Written and run GREEN against the PRE-migration raw handlers, then kept green
 * unchanged after migration to `authenticatedJsonRoute`.
 *
 * NO live routing process, durable DB, provider or network. Every expensive /
 * durable seam is a spy: `stage3Repository`, `createAutonomousRouteExecutor`,
 * `qualifyAutonomousLayout`, `evaluateAutonomousCapability`,
 * `DurableManufacturingAuthorityStore`, `getDurableWorkflowRepository`,
 * `releaseManufacturingPackage`. The existing REAL qualification and MFG01
 * release-gate suites (unchanged) cover the full expensive success path.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { createEmptyBoard } from "@/app/lib/pcb/types";
import { authoritativeBoardDigest } from "@/app/lib/pcb/fab/release-gate";

// ── expensive / durable seams (spies) ────────────────────────────────────────
const getBoard = vi.hoisted(() => vi.fn());
const publishBoard = vi.hoisted(() => vi.fn());
// [B16.1C] the qualify route reads the durable HEAD (record + aggregate
// revision) and the server-owned binding repository; release re-reads the
// board head to refuse stale authority. `getBoard` stays for the legacy
// zero-work assertions (it is never reached any more, which is itself pinned).
const getBoardHead = vi.hoisted(() => vi.fn());
const listAudits = vi.hoisted(() => vi.fn<() => Promise<unknown[]>>(async () => []));
const getPlan = vi.hoisted(() => vi.fn<() => Promise<unknown>>(async () => null));
const listSelectedPeers = vi.hoisted(() => vi.fn<() => Promise<unknown[]>>(async () => []));
// [B16-A F4] the applied snapshot (RC01 parity source) is read by digest from the durable snapshot store.
const getSnapshotByDigest = vi.hoisted(() => vi.fn<() => Promise<unknown>>(async () => null));
vi.mock("@/app/api/pcb-sync/route", () => ({ stage3Repository: { getBoard, getBoardHead, publishBoard, listAudits, getPlan }, stage3BindingRepository: { listSelectedPeers }, stage3SnapshotProvider: { getSnapshotByDigest } }));

const createRouter = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/app/lib/pcb/autonomous/production-router", () => ({ createAutonomousRouteExecutor: createRouter }));

const qualifyLayout = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/autonomous/qualify-layout", () => ({ qualifyAutonomousLayout: qualifyLayout }));

const evalCapability = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/autonomous/capability-profile", async (orig) => ({ ...(await orig() as object), evaluateAutonomousCapability: evalCapability }));

const authoritySave = vi.hoisted(() => vi.fn(async () => ({ revision: 1, recordDigest: "sha256:auth" })));
const authorityGet = vi.hoisted(() => vi.fn());
// [B16.1C] both routes read the durable authority HEAD (payload + aggregate
// revision + record digest); `authorityGet` is kept as a spy so the legacy
// zero-work assertions still prove no bare read happens either.
const authorityGetHead = vi.hoisted(() => vi.fn());
const authorityLoader = vi.hoisted(() => vi.fn(() => vi.fn()));
vi.mock("@/app/lib/pcb/fab/authority-store", async (orig) => ({
  ...(await orig() as object),
  DurableManufacturingAuthorityStore: class { save = authoritySave; get = authorityGet; getHead = authorityGetHead; loader = authorityLoader; },
}));
const ledgerRecord = vi.hoisted(() => vi.fn<(scope: unknown, input: Record<string, unknown>) => Promise<{ created: boolean; record: { releaseId: string } }>>(async () => ({ created: true, record: { releaseId: "rel-abcdef123456" } })));
vi.mock("@/app/lib/pcb/fab/release-ledger", async (orig) => ({ ...(await orig() as object), DurableManufacturingReleaseLedger: class { record = ledgerRecord; latest = vi.fn(async () => null); list = vi.fn(async () => []); } }));

const getWorkflowRepo = vi.hoisted(() => vi.fn(() => ({ loadHead: async () => null }))); // [B16-C.1] both routes read the board lineage first (none recorded → current)
vi.mock("@/app/lib/durable-workflow/runtime", () => ({ getDurableWorkflowRepository: getWorkflowRepo }));
// [B16-A F7] the durable single-flight lease is a seam here (the workflow repository above is an empty stub); its own behaviour is covered by b16-a-qualification-commit.test.ts.
const leaseAcquire = vi.hoisted(() => vi.fn(async () => ({ ok: true as const, token: "lease-token", revision: 1, expiresAt: "2999-01-01T00:00:00.000Z" })));
const leaseRelease = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/app/lib/pcb/fab/qualification-lease", () => ({ DurableQualificationLease: class { acquire = leaseAcquire; release = leaseRelease; } }));

const releasePackage = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/release-gate", async (orig) => ({ ...(await orig() as object), releaseManufacturingPackage: releasePackage }));

import { POST as qualify } from "../pcb/qualify/route";
import { POST as release } from "../pcb/release/route";
import { MANUFACTURING_RULE_PROFILE_SCHEMA } from "@/app/lib/pcb/fab/release-manifest";
import { ruleProfileExpiry } from "@/app/lib/pcb/fab/rule-profile";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
const qReq = (body: string, h: Record<string, string> = {}): Request => post("/api/pcb/qualify", body, h);
const rReq = (body: string, h: Record<string, string> = {}): Request => post("/api/pcb/release", body, h);
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
const VALID = JSON.stringify({ designId: "d1", boardId: "b1" });
/** [B16-A F6] a release body carrying the administrator's confirmation of the stored authority head (revision 1, digest sha256:authrec). */
const PINNED = { designId: "d1", boardId: "b1", expectedAuthorityRevision: 1, expectedAuthorityDigest: "sha256:authrec" };
/** [B16.1C] the stored authority head the release route re-reads: board revision/digest plus the release-time facets it re-checks. */
// [B16-A F22] the profile evidence date is derived from the CURRENT clock (this file never fakes Date), so the
// release-time expiry check (366 days) can never make these tests rot.
const VERIFIED_TODAY = new Date().toISOString().slice(0, 10);
function storedAuthority(boardRevision: string, boardDigest: string) {
  return { boardRevision, boardDigest, manufacturingRuleProfile: { schemaVersion: MANUFACTURING_RULE_PROFILE_SCHEMA, evidence: { sourceRefs: ["https://jlcpcb.com/capabilities/pcb-capabilities"], retrievedAt: VERIFIED_TODAY, expiresAt: ruleProfileExpiry(VERIFIED_TODAY), scope: "JLCPCB 1-2 layer rigid FR-4 (test stub)", notes: [] }, profileId: "jlcpcb-2l" }, schematic: { revision: "schematic:1", digest: "sha256:sch" }, componentAuthority: { digest: "component-authority-x" }, qualificationAuthority: { digest: "qualification-authority-x" } };
}

function authed(role: "viewer" | "commenter" | "editor" | "reviewer" | "admin"): void {
  injectAuthorizedPrincipal({ userId: "u1", tenantId: "local", projectId: "proj-1", role });
}
function production(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pk");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}
function counting(path: string, headers: Record<string, string>, counter: { pulls: number }): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode(VALID)); c.close(); } }, { highWaterMark: 0 });
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...SEL, ...headers }, body: stream, duplex: "half" } as RequestInit);
}
/** Every durable/expensive seam untouched — the refusal did zero real work. */
function zeroWork(): void {
  expect(getBoard).not.toHaveBeenCalled();
  expect(getBoardHead).not.toHaveBeenCalled();
  expect(listSelectedPeers).not.toHaveBeenCalled();
  expect(authorityGetHead).not.toHaveBeenCalled();
  expect(ledgerRecord).not.toHaveBeenCalled();
  expect(publishBoard).not.toHaveBeenCalled();
  expect(createRouter).not.toHaveBeenCalled();
  expect(qualifyLayout).not.toHaveBeenCalled();
  expect(authoritySave).not.toHaveBeenCalled();
  expect(authorityGet).not.toHaveBeenCalled();
  expect(releasePackage).not.toHaveBeenCalled();
}

afterEach(() => {
  resetInjectedIdentity(); vi.unstubAllEnvs();
  for (const s of [getBoard, getBoardHead, listAudits, getPlan, listSelectedPeers, publishBoard, createRouter, qualifyLayout, evalCapability, authoritySave, authorityGet, authorityGetHead, authorityLoader, getWorkflowRepo, releasePackage, ledgerRecord]) s.mockReset();
  listAudits.mockImplementation(async () => []); getPlan.mockImplementation(async () => null); listSelectedPeers.mockImplementation(async () => []);
  ledgerRecord.mockImplementation(async () => ({ created: true, record: { releaseId: "rel-abcdef123456" } }));
  createRouter.mockImplementation(async () => ({}));
  authoritySave.mockImplementation(async () => ({ revision: 1, recordDigest: "sha256:auth" }));
  authorityLoader.mockImplementation(() => vi.fn());
  getWorkflowRepo.mockImplementation(() => ({ loadHead: async () => null })); // [B16-C.1] both routes read the board lineage first (none recorded → current)
});

const ROUTES = [
  { name: "qualify", handler: qualify, req: qReq, path: "/api/pcb/qualify", okRole: "editor" as const },
  { name: "release", handler: release, req: rReq, path: "/api/pcb/release", okRole: "admin" as const },
];

describe("B16.0.15 §A — shared security refusal classes (both manufacturing routes)", () => {
  it.each(ROUTES)("[$name] unauthenticated → 401, ZERO durable/expensive work", async (r) => {
    injectIdentity(null);
    const res = await r.handler(r.req(VALID));
    expect(res.status).toBe(401);
    zeroWork();
  });

  it.each(ROUTES)("[$name] wrong project membership → 403, ZERO work", async (r) => {
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "other-proj", userId: "u1", role: "admin" }]);
    const res = await r.handler(r.req(VALID));
    expect(res.status).toBe(403);
    zeroWork();
  });

  it.each(ROUTES)("[$name] revoked membership → 403, ZERO work", async (r) => {
    injectIdentity({ userId: "u1" });
    injectMembership([{ tenantId: "local", projectId: "proj-1", userId: "u1", role: "admin", state: "revoked" }]);
    const res = await r.handler(r.req(VALID));
    expect(res.status).toBe(403);
    zeroWork();
  });

  it.each(ROUTES)("[$name] production cross-origin CSRF → 403 with ZERO body pulls + ZERO work", async (r) => {
    production(); authed(r.okRole);
    const counter = { pulls: 0 };
    const res = await r.handler(counting(r.path, { origin: "http://evil.example" }, counter));
    expect(res.status).toBe(403);
    expect(counter.pulls).toBe(0);
    zeroWork();
  });

  it.each(ROUTES)("[$name] text/plain → 415 AUTH_MEDIA_TYPE_UNSUPPORTED (no-store); malformed → 400 AUTH_INVALID_JSON; oversized 8MB+1 → 413 — ZERO work", async (r) => {
    authed(r.okRole);
    const media = await r.handler(r.req(VALID, { "content-type": "text/plain" }));
    expect(media.status).toBe(415);
    expect((await payload(media)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    expect(media.headers.get("Cache-Control")).toBe("no-store");
    const bad = await r.handler(r.req("{not json"));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("AUTH_INVALID_JSON");
    const big = await r.handler(r.req("x".repeat(8_000_001)));
    expect(big.status).toBe(413);
    zeroWork();
  });

  it.each(ROUTES)("[$name] missing designId/boardId → 400 MFG_API_SCOPE_REQUIRED, ZERO work", async (r) => {
    authed(r.okRole);
    const res = await r.handler(r.req(JSON.stringify({ designId: "d1" })));
    expect(res.status).toBe(400);
    expect((await payload(res)).code).toBe("MFG_API_SCOPE_REQUIRED");
    zeroWork();
  });

  it.each(ROUTES)("[$name] forbidden authority key (snapshot|board|path) → 400 AUTH_AUTHORITATIVE_INPUT_FORBIDDEN, ZERO work", async (r) => {
    authed(r.okRole);
    for (const key of ["snapshot", "board", "path"]) {
      const res = await r.handler(r.req(JSON.stringify({ designId: "d1", boardId: "b1", [key]: "evil" })));
      expect(res.status, key).toBe(400);
      const body = await payload(res);
      expect(body.code, key).toBe("AUTH_AUTHORITATIVE_INPUT_FORBIDDEN");
      expect(body.error, key).toBe("The request body carries a forbidden authoritative field.");
      expect(res.headers.get("Cache-Control"), key).toBe("no-store");
    }
    zeroWork();
  });

  it.each(ROUTES)("[$name] pre-aborted request → bounded reader refuses (AUTH_BODY_ABORTED) with ZERO work — no expensive work can start", async (r) => {
    authed(r.okRole);
    const ac = new AbortController(); ac.abort();
    const res = await r.handler(new Request(`http://localhost${r.path}`, {
      method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL }, body: VALID, signal: ac.signal,
    }));
    expect(res.status).toBe(400);
    expect((await payload(res)).code).toBe("AUTH_BODY_ABORTED");
    zeroWork();
  });
});

describe("B16.0.15 §C — role separation (policy-exact)", () => {
  it("qualify: viewer/commenter/reviewer → 403; pcb_editor + project_admin reach the durable read", async () => {
    for (const role of ["viewer", "commenter", "reviewer"] as const) {
      authed(role);
      const res = await qualify(qReq(VALID));
      expect(res.status, role).toBe(403);
      resetInjectedIdentity();
    }
    for (const role of ["editor", "admin"] as const) {
      getBoardHead.mockResolvedValueOnce(null); // [B16.1C] the durable read is the board HEAD
      authed(role);
      const res = await qualify(qReq(VALID));
      expect(res.status, role).toBe(404); // reached getBoardHead → not-found (proves authorization passed)
      expect((await payload(res)).code).toBe("MFG_AUTHORITATIVE_BOARD_NOT_FOUND");
      resetInjectedIdentity(); getBoardHead.mockReset();
    }
  });

  it("release: pcb_editor + reviewer + viewer → 403; ONLY project_admin reaches the durable authority read", async () => {
    for (const role of ["editor", "reviewer", "viewer", "commenter"] as const) {
      authed(role);
      const res = await release(rReq(VALID));
      expect(res.status, role).toBe(403);
      expect(releasePackage).not.toHaveBeenCalled();
      resetInjectedIdentity();
    }
    authorityGetHead.mockResolvedValueOnce(null); // [B16.1C] the durable read is the authority HEAD
    authed("admin");
    const res = await release(rReq(VALID));
    expect(res.status).toBe(404); // reached store.getHead → not-found (proves project_admin passed)
    expect((await payload(res)).code).toBe("MFG_AUTHORITY_NOT_FOUND");
  });
});

describe("B16.0.15 §D/§E — trusted-scope durable reads & locator pinning", () => {
  it("[qualify] the durable board read uses the TRUSTED context scope + validated body.boardId only; an undeclared body key is refused with ZERO durable work (B16-A F3)", async () => {
    authed("editor");
    const bogus = await qualify(qReq(JSON.stringify({ designId: "d1", boardId: "b1", tenantIdBogus: "evil" })));
    expect(bogus.status).toBe(400);
    expect(await payload(bogus)).toMatchObject({ code: "MFG_API_UNKNOWN_FIELD", fields: ["tenantIdBogus"] });
    zeroWork();
    getBoardHead.mockResolvedValueOnce(null);
    const res = await qualify(qReq(VALID));
    expect(res.status).toBe(404);
    expect(getBoardHead).toHaveBeenCalledTimes(1);
    expect(getBoardHead.mock.calls[0]![0]).toEqual({ tenantId: "local", projectId: "proj-1", branchId: "main", boardId: "b1" });
    expect(getBoard).not.toHaveBeenCalled(); // [B16.1C] the head read replaced the bare record read
    expect(createRouter).not.toHaveBeenCalled(); // not-found → no router work
  });

  it("[qualify] an INELIGIBLE design performs ZERO router/process work (pre-flight before router creation)", async () => {
    authed("editor");
    // [B16.1C] the route now resolves server-owned component authority (an
    // empty board has no footprints → trivially complete) and the schematic
    // synchronization identity BEFORE the capability screen; both are mocked
    // as present so the screen is what refuses.
    getBoardHead.mockResolvedValueOnce({ record: { board: createEmptyBoard(), revision: "pcb2-src", digest: "sha256:src" }, aggregateRevision: 1 });
    listAudits.mockResolvedValueOnce([{ outcome: "committed", planId: "plan-1" }]);
    getPlan.mockResolvedValueOnce({ planId: "plan-1", scope: { tenantId: "local", projectId: "proj-1", branchId: "main", designId: "d1", boardId: "b1" }, snapshot: { schematicRevision: "schematic:1", schematicDigest: "sha256:sch", snapshotDigest: "sha256:snap", assemblyVariantId: "variant-default" } });
    getSnapshotByDigest.mockResolvedValueOnce({ designId: "d1", components: [], nets: [] });
    authorityGetHead.mockResolvedValueOnce(null);
    evalCapability.mockReturnValue({ placementMayStart: false, blockers: ["outside-profile"] });
    const res = await qualify(qReq(VALID));
    expect(res.status).toBe(422);
    expect((await payload(res)).code).toBe("MFG_AUTONOMOUS_INELIGIBLE");
    expect(createRouter).not.toHaveBeenCalled();
    expect(qualifyLayout).not.toHaveBeenCalled();
    expect(authoritySave).not.toHaveBeenCalled(); // no authority persisted on failure
    // [B16-A F4] the applied snapshot was read by the plan's exact digest from the durable snapshot store.
    expect(getSnapshotByDigest).toHaveBeenCalledWith({ tenantId: "local", projectId: "proj-1", branchId: "main", designId: "d1", assemblyVariantId: "variant-default" }, "sha256:snap");
  });

  it("[qualify] a designId that does not name the synchronized design is refused 422 MFG_DESIGN_SCOPE_MISMATCH before the capability screen and the router (B16-A F5)", async () => {
    authed("editor");
    getBoardHead.mockResolvedValueOnce({ record: { board: createEmptyBoard(), revision: "pcb2-src", digest: "sha256:src" }, aggregateRevision: 1 });
    listAudits.mockResolvedValueOnce([{ outcome: "committed", planId: "plan-1" }]);
    getPlan.mockResolvedValueOnce({ planId: "plan-1", scope: { tenantId: "local", projectId: "proj-1", branchId: "main", designId: "design:proj-1", boardId: "b1" }, snapshot: { schematicRevision: "schematic:1", schematicDigest: "sha256:sch", snapshotDigest: "sha256:snap", assemblyVariantId: "variant-default" } });
    getSnapshotByDigest.mockResolvedValueOnce({ designId: "design:proj-1", components: [], nets: [] });
    const res = await qualify(qReq(JSON.stringify({ designId: "design:someone-else", boardId: "b1" })));
    expect(res.status).toBe(422);
    expect(await payload(res)).toMatchObject({ code: "MFG_DESIGN_SCOPE_MISMATCH", synchronizedDesignId: "design:proj-1" });
    expect(authorityGetHead).not.toHaveBeenCalled();
    expect(evalCapability).not.toHaveBeenCalled();
    expect(createRouter).not.toHaveBeenCalled();
    expect(authoritySave).not.toHaveBeenCalled();
  });

  it("[qualify] a synchronized board with NO server-owned binding authority is refused BEFORE the capability screen and the router (B16.1C probe P5/P6)", async () => {
    authed("editor");
    const board = { ...createEmptyBoard(), footprints: [{ id: "f1", ref: "R1", footprintId: "fp", at: { x: 0, y: 0 }, rotationDeg: 0, side: "top", padNets: {}, def: { libName: "L", name: "N", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, models: [], rawSexpr: "" }, syncIdentity: { componentInstanceId: "c1", bindingRevisionId: "b:r1", footprintAssetVersionId: "fp", footprintContentDigest: "sha256:fp", mappingCertificateId: "m1", symbolAssetVersionId: "s1", syncPlanId: "plan-1" } }] };
    getBoardHead.mockResolvedValueOnce({ record: { board, revision: "pcb2-src", digest: "sha256:src" }, aggregateRevision: 3 });
    const res = await qualify(qReq(VALID));
    expect(res.status).toBe(422);
    const body = await payload(res);
    expect(body.code).toBe("MFG_COMPONENT_AUTHORITY_INCOMPLETE");
    expect((body.blockers as Array<{ code: string }>).map((b) => b.code)).toEqual(["QA_BINDING_NOT_FOUND"]);
    expect(listSelectedPeers).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "local", projectId: "proj-1", branchId: "main", boardInstanceId: "b1", componentInstanceId: "c1" }));
    expect(evalCapability).not.toHaveBeenCalled();
    expect(createRouter).not.toHaveBeenCalled();
    expect(authoritySave).not.toHaveBeenCalled();
  });

  it("[release] missing authority → exact 404 MFG_AUTHORITY_NOT_FOUND; releaseManufacturingPackage NEVER called", async () => {
    authed("admin");
    authorityGetHead.mockResolvedValueOnce(null);
    const res = await release(rReq(VALID));
    expect(res.status).toBe(404);
    expect((await payload(res)).code).toBe("MFG_AUTHORITY_NOT_FOUND");
    expect(authorityGetHead.mock.calls[0]![0]).toEqual({ tenantId: "local", projectId: "proj-1", branchId: "main", designId: "d1", boardId: "b1" });
    expect(releasePackage).not.toHaveBeenCalled();
    expect(ledgerRecord).not.toHaveBeenCalled();
  });

  it("[release] authority qualified against an EARLIER board revision → 409 MFG_AUTHORITY_STALE; releaseManufacturingPackage NEVER called (B16.1C probe P7)", async () => {
    authed("admin");
    authorityGetHead.mockResolvedValueOnce({ authority: storedAuthority("rev-9", "sha256:board9"), revision: 1, recordDigest: "sha256:authrec" });
    getBoardHead.mockResolvedValueOnce({ record: { board: createEmptyBoard(), revision: "rev-10", digest: "sha256:board10" }, aggregateRevision: 2 });
    const res = await release(rReq(JSON.stringify(PINNED)));
    expect(res.status).toBe(409);
    const body = await payload(res);
    expect(body.code).toBe("MFG_AUTHORITY_STALE");
    expect(body).toMatchObject({ authorityBoardRevision: "rev-9", currentBoardRevision: "rev-10" });
    expect(releasePackage).not.toHaveBeenCalled();
    expect(ledgerRecord).not.toHaveBeenCalled();
  });

  it("[release] the release locator is pinned from TRUSTED context + stored authority revision/digest (never the client); a client-supplied locator is REFUSED, not ignored (B16-A F6)", async () => {
    authed("admin");
    // A body that tries to name the board identity is refused before any durable read.
    const attacker = await release(rReq(JSON.stringify({ ...PINNED, boardRevision: "attacker-rev", boardDigest: "attacker-digest" })));
    expect(attacker.status).toBe(400);
    expect(await payload(attacker)).toMatchObject({ code: "MFG_API_UNKNOWN_FIELD", fields: ["boardDigest", "boardRevision"] });
    zeroWork();
    // [B16.1C] the current durable board must MATCH the stored authority (revision + content digest) or the release is refused as stale.
    const digest = authoritativeBoardDigest(createEmptyBoard());
    authorityGetHead.mockResolvedValueOnce({ authority: storedAuthority("rev-9", digest), revision: 1, recordDigest: "sha256:authrec" });
    getBoardHead.mockResolvedValueOnce({ record: { board: createEmptyBoard(), revision: "rev-9", digest }, aggregateRevision: 1 });
    releasePackage.mockResolvedValueOnce({ releaseId: "rel-abc123456789", archiveSha256: "sha256:arch", manifest: { m: 1, manifestContentDigest: "mfg-manifest-1" }, validation: { v: 1 }, archiveBytes: new Uint8Array([1, 2, 3]) });
    const res = await release(rReq(JSON.stringify(PINNED)));
    expect(res.status).toBe(200);
    expect(releasePackage).toHaveBeenCalledTimes(1);
    const locator = (releasePackage.mock.calls[0]![0] as { locator: Record<string, unknown> }).locator;
    expect(locator).toEqual({
      tenantId: "local", projectId: "proj-1", branchId: "main", designId: "d1", boardId: "b1",
      expectedBoardRevision: "rev-9", expectedBoardDigest: digest, // from STORED authority, not the attacker body
    });
    // [B16.1C] every release is ledgered against the exact authority head it packaged.
    expect(ledgerRecord).toHaveBeenCalledTimes(1);
    expect(ledgerRecord.mock.calls[0]![1]).toMatchObject({ releaseId: "rel-abc123456789", archiveSha256: "sha256:arch", authorityRevision: 1, authorityRecordDigest: "sha256:authrec", boardRevision: "rev-9", actor: "u1" });
  });

  it("[release] format=manifest returns the exact JSON shape; default returns a ZIP with exact headers", async () => {
    authed("admin");
    const digest = authoritativeBoardDigest(createEmptyBoard());
    authorityGetHead.mockResolvedValue({ authority: storedAuthority("rev-9", digest), revision: 1, recordDigest: "sha256:authrec" });
    getBoardHead.mockResolvedValue({ record: { board: createEmptyBoard(), revision: "rev-9", digest }, aggregateRevision: 1 });
    releasePackage.mockResolvedValue({ releaseId: "rel-abcdef123456", archiveSha256: "sha256:arch", manifest: { kind: "manifest", manifestContentDigest: "mfg-manifest-1" }, validation: { ok: true }, archiveBytes: new Uint8Array([9, 8, 7]) });
    const manifest = await release(rReq(JSON.stringify({ ...PINNED, format: "manifest" })));
    expect(manifest.status).toBe(200);
    // [B16.1C] the manifest response additionally names the filename, the authority head, and the ledger record.
    expect(await payload(manifest)).toEqual({ ok: true, releaseId: "rel-abcdef123456", filename: "sirkit-b1-abcdef123456.zip", archiveSha256: "sha256:arch", manifest: { kind: "manifest", manifestContentDigest: "mfg-manifest-1" }, validation: { ok: true }, authorityRevision: 1, authorityDigest: "sha256:authrec", record: { releaseId: "rel-abcdef123456" } });
    expect(manifest.headers.get("Cache-Control")).toBe("no-store");

    const zip = await release(rReq(JSON.stringify(PINNED)));
    expect(zip.status).toBe(200);
    expect(zip.headers.get("Content-Type")).toBe("application/zip");
    expect(zip.headers.get("Content-Disposition")).toBe('attachment; filename="sirkit-b1-abcdef123456.zip"');
    expect(zip.headers.get("Cache-Control")).toBe("no-store");
    expect(zip.headers.get("X-Sirkit-Release-Id")).toBe("rel-abcdef123456");
    expect(zip.headers.get("X-Sirkit-Release-Disposition")).toBe("verified_manufacturing_release");
    expect(zip.headers.get("X-Sirkit-Archive-Sha256")).toBe("sha256:arch");
    expect(zip.headers.get("X-Sirkit-Board-Revision")).toBe("rev-9");
    expect(zip.headers.get("X-Sirkit-Authority-Revision")).toBe("1");
    expect(zip.headers.get("X-Sirkit-Authority-Digest")).toBe("sha256:authrec");
    expect(zip.headers.get("X-Sirkit-Manifest-Digest")).toBe("mfg-manifest-1");
    expect(zip.headers.get("X-Sirkit-Release-Recorded")).toBe("created");
    expect(new Uint8Array(await zip.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
  });
});
