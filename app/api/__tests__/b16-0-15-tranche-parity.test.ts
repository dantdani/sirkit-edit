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

// ── expensive / durable seams (spies) ────────────────────────────────────────
const getBoard = vi.hoisted(() => vi.fn());
const publishBoard = vi.hoisted(() => vi.fn());
vi.mock("@/app/api/pcb-sync/route", () => ({ stage3Repository: { getBoard, publishBoard } }));

const createRouter = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/app/lib/pcb/autonomous/production-router", () => ({ createAutonomousRouteExecutor: createRouter }));

const qualifyLayout = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/autonomous/qualify-layout", () => ({ qualifyAutonomousLayout: qualifyLayout }));

const evalCapability = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/autonomous/capability-profile", async (orig) => ({ ...(await orig() as object), evaluateAutonomousCapability: evalCapability }));

const authoritySave = vi.hoisted(() => vi.fn(async () => ({ revision: 1, recordDigest: "sha256:auth" })));
const authorityGet = vi.hoisted(() => vi.fn());
const authorityLoader = vi.hoisted(() => vi.fn(() => vi.fn()));
vi.mock("@/app/lib/pcb/fab/authority-store", async (orig) => ({
  ...(await orig() as object),
  DurableManufacturingAuthorityStore: class { save = authoritySave; get = authorityGet; loader = authorityLoader; },
}));

const getWorkflowRepo = vi.hoisted(() => vi.fn(() => ({})));
vi.mock("@/app/lib/durable-workflow/runtime", () => ({ getDurableWorkflowRepository: getWorkflowRepo }));

const releasePackage = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/pcb/fab/release-gate", async (orig) => ({ ...(await orig() as object), releaseManufacturingPackage: releasePackage }));

import { POST as qualify } from "../pcb/qualify/route";
import { POST as release } from "../pcb/release/route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
function post(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
const qReq = (body: string, h: Record<string, string> = {}): Request => post("/api/pcb/qualify", body, h);
const rReq = (body: string, h: Record<string, string> = {}): Request => post("/api/pcb/release", body, h);
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
const VALID = JSON.stringify({ designId: "d1", boardId: "b1" });

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
  expect(publishBoard).not.toHaveBeenCalled();
  expect(createRouter).not.toHaveBeenCalled();
  expect(qualifyLayout).not.toHaveBeenCalled();
  expect(authoritySave).not.toHaveBeenCalled();
  expect(authorityGet).not.toHaveBeenCalled();
  expect(releasePackage).not.toHaveBeenCalled();
}

afterEach(() => {
  resetInjectedIdentity(); vi.unstubAllEnvs();
  for (const s of [getBoard, publishBoard, createRouter, qualifyLayout, evalCapability, authoritySave, authorityGet, authorityLoader, getWorkflowRepo, releasePackage]) s.mockReset();
  createRouter.mockImplementation(async () => ({}));
  authoritySave.mockImplementation(async () => ({ revision: 1, recordDigest: "sha256:auth" }));
  authorityLoader.mockImplementation(() => vi.fn());
  getWorkflowRepo.mockImplementation(() => ({}));
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
      getBoard.mockResolvedValueOnce(null);
      authed(role);
      const res = await qualify(qReq(VALID));
      expect(res.status, role).toBe(404); // reached getBoard → not-found (proves authorization passed)
      expect((await payload(res)).code).toBe("MFG_AUTHORITATIVE_BOARD_NOT_FOUND");
      resetInjectedIdentity(); getBoard.mockReset();
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
    authorityGet.mockResolvedValueOnce(null);
    authed("admin");
    const res = await release(rReq(VALID));
    expect(res.status).toBe(404); // reached store.get → not-found (proves project_admin passed)
    expect((await payload(res)).code).toBe("MFG_AUTHORITY_NOT_FOUND");
  });
});

describe("B16.0.15 §D/§E — trusted-scope durable reads & locator pinning", () => {
  it("[qualify] the durable board read uses the TRUSTED context scope + validated body.boardId only", async () => {
    authed("editor");
    getBoard.mockResolvedValueOnce(null);
    const res = await qualify(qReq(JSON.stringify({ designId: "d1", boardId: "b1", tenantIdBogus: "evil" })));
    expect(res.status).toBe(404);
    expect(getBoard).toHaveBeenCalledTimes(1);
    expect(getBoard.mock.calls[0]![0]).toEqual({ tenantId: "local", projectId: "proj-1", branchId: "main", boardId: "b1" });
    expect(createRouter).not.toHaveBeenCalled(); // not-found → no router work
  });

  it("[qualify] an INELIGIBLE design performs ZERO router/process work (pre-flight before router creation)", async () => {
    authed("editor");
    getBoard.mockResolvedValueOnce({ board: createEmptyBoard(), revision: 1, digest: "sha256:src" });
    evalCapability.mockReturnValue({ placementMayStart: false, blockers: ["outside-profile"] });
    const res = await qualify(qReq(VALID));
    expect(res.status).toBe(422);
    expect((await payload(res)).code).toBe("MFG_AUTONOMOUS_INELIGIBLE");
    expect(createRouter).not.toHaveBeenCalled();
    expect(qualifyLayout).not.toHaveBeenCalled();
    expect(authoritySave).not.toHaveBeenCalled(); // no authority persisted on failure
  });

  it("[release] missing authority → exact 404 MFG_AUTHORITY_NOT_FOUND; releaseManufacturingPackage NEVER called", async () => {
    authed("admin");
    authorityGet.mockResolvedValueOnce(null);
    const res = await release(rReq(VALID));
    expect(res.status).toBe(404);
    expect((await payload(res)).code).toBe("MFG_AUTHORITY_NOT_FOUND");
    expect(authorityGet.mock.calls[0]![0]).toEqual({ tenantId: "local", projectId: "proj-1", branchId: "main", designId: "d1", boardId: "b1" });
    expect(releasePackage).not.toHaveBeenCalled();
  });

  it("[release] the release locator is pinned from TRUSTED context + stored authority revision/digest (never the client)", async () => {
    authed("admin");
    authorityGet.mockResolvedValueOnce({ boardRevision: "rev-9", boardDigest: "sha256:board9" });
    releasePackage.mockResolvedValueOnce({ releaseId: "rel-abc123456789", archiveSha256: "sha256:arch", manifest: { m: 1 }, validation: { v: 1 }, archiveBytes: new Uint8Array([1, 2, 3]) });
    const res = await release(rReq(JSON.stringify({ designId: "d1", boardId: "b1", boardRevision: "attacker-rev", boardDigest: "attacker-digest" })));
    expect(res.status).toBe(200);
    expect(releasePackage).toHaveBeenCalledTimes(1);
    const locator = (releasePackage.mock.calls[0]![0] as { locator: Record<string, unknown> }).locator;
    expect(locator).toEqual({
      tenantId: "local", projectId: "proj-1", branchId: "main", designId: "d1", boardId: "b1",
      expectedBoardRevision: "rev-9", expectedBoardDigest: "sha256:board9", // from STORED authority, not the attacker body
    });
  });

  it("[release] format=manifest returns the exact JSON shape; default returns a ZIP with exact headers", async () => {
    authed("admin");
    authorityGet.mockResolvedValue({ boardRevision: "rev-9", boardDigest: "sha256:board9" });
    releasePackage.mockResolvedValue({ releaseId: "rel-abcdef123456", archiveSha256: "sha256:arch", manifest: { kind: "manifest" }, validation: { ok: true }, archiveBytes: new Uint8Array([9, 8, 7]) });
    const manifest = await release(rReq(JSON.stringify({ designId: "d1", boardId: "b1", format: "manifest" })));
    expect(manifest.status).toBe(200);
    expect(await payload(manifest)).toEqual({ ok: true, releaseId: "rel-abcdef123456", archiveSha256: "sha256:arch", manifest: { kind: "manifest" }, validation: { ok: true } });
    expect(manifest.headers.get("Cache-Control")).toBe("no-store");

    const zip = await release(rReq(JSON.stringify({ designId: "d1", boardId: "b1" })));
    expect(zip.status).toBe(200);
    expect(zip.headers.get("Content-Type")).toBe("application/zip");
    expect(zip.headers.get("Content-Disposition")).toBe('attachment; filename="sirkit-b1-abcdef123456.zip"');
    expect(zip.headers.get("Cache-Control")).toBe("no-store");
    expect(zip.headers.get("X-Sirkit-Release-Id")).toBe("rel-abcdef123456");
    expect(zip.headers.get("X-Sirkit-Release-Disposition")).toBe("verified_manufacturing_release");
    expect(zip.headers.get("X-Sirkit-Archive-Sha256")).toBe("sha256:arch");
    expect(zip.headers.get("X-Sirkit-Board-Revision")).toBe("rev-9");
    expect(new Uint8Array(await zip.arrayBuffer())).toEqual(new Uint8Array([9, 8, 7]));
  });
});
