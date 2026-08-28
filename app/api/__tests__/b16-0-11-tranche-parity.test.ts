/**
 * B16.0.11 §A — BEHAVIORAL CONTRACT PINS for the tranche-4 BOM migration
 * (6 public bounded-JSON methods + 6 authenticated project-owned methods).
 * Written and run GREEN against the PRE-migration handlers, then kept green
 * unchanged after migration to publicJsonRoute / authenticatedJsonRoute /
 * authenticatedRoute.
 *
 * ALL external work is faked: `buildBomRows`/`buildBom` (distributor pricing),
 * `bomToCsv`, and the BOM repository (setBomRepositoryFactory). No live
 * distributor calls, no DB writes, no provider credits. CSV bytes for the
 * DigiKey/LCSC/Mouser/procurement downloads are REAL `cart-formats` output over
 * fixed rows — byte-pinned pre and post.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { setBomRepositoryFactory, resetBomRepositoryFactory } from "@/app/lib/bom/snapshot-repository";

vi.mock("@/app/lib/bom-builder", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, buildBomRows: vi.fn() };
});
vi.mock("@/app/lib/bom/build", async (orig) => {
  const actual = await orig() as Record<string, unknown>;
  return { ...actual, buildBom: vi.fn(), bomToCsv: vi.fn(() => "csv-bytes\n") };
});
import { buildBomRows } from "@/app/lib/bom-builder";
import { buildBom, bomToCsv } from "@/app/lib/bom/build";
const mockRows = vi.mocked(buildBomRows);
const mockBuild = vi.mocked(buildBom);
const mockToCsv = vi.mocked(bomToCsv);

import { POST as bomPost } from "../bom/route";
import { POST as digikeyPost } from "../bom/cart/digikey/route";
import { POST as lcscPost } from "../bom/cart/lcsc/route";
import { POST as mouserPost } from "../bom/cart/mouser/route";
import { POST as exportCsvPost } from "../bom/export-csv/route";
import { POST as packetPost } from "../bom/procurement-packet/route";
import { POST as diffPost } from "../bom/diff/route";
import { GET as notifGet, PATCH as notifPatch, DELETE as notifDelete } from "../bom/notifications/route";
import { POST as snapPost, GET as snapGet } from "../bom/snapshot/route";
import { toDigiKeyCsv, toLcscCsv, toMouserCsv, toProcurementPacketCsv } from "@/app/lib/cart-formats";

const PROJECT = "proj-1";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
const TRUSTED = { tenantId: "local", projectId: PROJECT, branchId: "main" };
const STATE = { components: [], wires: [], kicadComponents: [] };
/** buildBomRows fake result — passthrough-pinned for /api/bom, and shaped for
 *  snapshot/diff meta derivation. */
const BUILD_RESULT = {
  ok: true, marker: "result-passthrough", rows: [] as unknown[],
  estimatedProjectCost: { value: 1.23, currency: "USD" },
  riskSummary: { overallScore: 2 },
};

// ── fake project-owned repository (captures every ownership scope) ───────────
function makeRepo() {
  return {
    createSnapshot: vi.fn(async (...args: unknown[]) => { void args; return { id: "snap-new" }; }),
    listSnapshots: vi.fn(async (...args: unknown[]) => {
      void args;
      return [{ id: "s1", label: "L", takenAt: new Date("2026-01-01T00:00:00Z"), rows: [], bomMeta: { totalRows: 1, totalCostCents: 100, currency: "USD", designRiskScore: 2 } }];
    }),
    getSnapshot: vi.fn(async (...args: unknown[]) => {
      const id = args[1] as string;
      return id === "owned-from" || id === "owned-to"
        ? { id, projectKey: "pk", label: null, takenAt: new Date("2026-01-01T00:00:00Z"), rows: [], bomMeta: { totalRows: 0, totalCostCents: null, currency: "USD", designRiskScore: 0 } }
        : null;
    }),
    updateNotification: vi.fn(async (...args: unknown[]) => (args[1] as string) === "own-n1"),
    markAllNotificationsRead: vi.fn(async (...args: unknown[]) => { void args; return 3; }),
    deleteNotifications: vi.fn(async (...args: unknown[]) => { void args; return 2; }),
    listNotifications: vi.fn(async (...args: unknown[]) => { void args; return [{ id: "own-n1", title: "t" }]; }),
  };
}
let repo = makeRepo();
const installRepo = (): void => { repo = makeRepo(); setBomRepositoryFactory(() => repo as never); };

const authed = (): void => { injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: PROJECT, role: "editor" }); };
function jsonReq(path: string, body: string, method = "POST", headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json", origin: "http://localhost", ...SEL, ...headers }, body });
}
function countingReq(path: string, headers: Record<string, string>, counter: { pulls: number }, method = "POST"): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
  return new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json", ...SEL, ...headers }, body: stream, duplex: "half" } as RequestInit);
}
async function payload(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }
function stubProduction(): void {
  vi.stubEnv("SIRKIT_AUTH_MODE", "production");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
  vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
}
const zeroExternal = (): void => {
  expect(mockRows).not.toHaveBeenCalled();
  expect(mockBuild).not.toHaveBeenCalled();
  for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
};

afterEach(() => {
  resetInjectedIdentity(); resetBomRepositoryFactory(); vi.unstubAllEnvs(); vi.useRealTimers();
  mockRows.mockReset(); mockBuild.mockReset(); mockToCsv.mockClear();
});

// ── PUBLIC methods ───────────────────────────────────────────────────────────

interface PublicCase { name: string; path: string; handler: (r: Request) => Promise<Response>; missingStateError: string }
const PUBLIC: PublicCase[] = [
  { name: "bom", path: "/api/bom", handler: bomPost, missingStateError: "Body must include a `state` with components/kicadComponents." },
  { name: "bom/cart/digikey", path: "/api/bom/cart/digikey", handler: digikeyPost, missingStateError: "Body must include a `state`." },
  { name: "bom/cart/lcsc", path: "/api/bom/cart/lcsc", handler: lcscPost, missingStateError: "Body must include a `state`." },
  { name: "bom/cart/mouser", path: "/api/bom/cart/mouser", handler: mouserPost, missingStateError: "Body must include a `state`." },
  { name: "bom/export-csv", path: "/api/bom/export-csv", handler: exportCsvPost, missingStateError: "Body must include a `state` with components/kicadComponents." },
  { name: "bom/procurement-packet", path: "/api/bom/procurement-packet", handler: packetPost, missingStateError: "Body must include a `state`." },
];

describe("B16.0.11 §A — public BOM boundary pins (×6)", () => {
  it.each(PUBLIC)("[$name] text/plain → 415 with ZERO body pulls and ZERO business calls", async (r) => {
    installRepo();
    const counter = { pulls: 0 };
    const res = await r.handler(countingReq(r.path, { origin: "http://localhost", "content-type": "text/plain" }, counter));
    expect(res.status).toBe(415);
    expect((await payload(res)).code).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    expect(counter.pulls).toBe(0);
    zeroExternal();
  });
  it.each(PUBLIC)("[$name] malformed JSON → 400 AUTH_INVALID_JSON, zero business calls", async (r) => {
    installRepo();
    const res = await r.handler(jsonReq(r.path, "{not json"));
    expect(res.status).toBe(400);
    expect((await payload(res)).code).toBe("AUTH_INVALID_JSON");
    zeroExternal();
  });
  it.each(PUBLIC)("[$name] oversized (8 MB + 1) → 413, zero business calls", async (r) => {
    installRepo();
    const res = await r.handler(jsonReq(r.path, "x".repeat(8_000_001)));
    expect(res.status).toBe(413);
    zeroExternal();
  });
  it.each(PUBLIC)("[$name] missing `state` → 400 with the exact historical error, zero business calls", async (r) => {
    installRepo();
    const res = await r.handler(jsonReq(r.path, JSON.stringify({})));
    expect(res.status).toBe(400);
    expect((await payload(res)).error).toBe(r.missingStateError);
    zeroExternal();
  });
});

describe("B16.0.11 §F — public output parity (real cart-formats bytes; headers; call counts)", () => {
  it("[bom] valid → buildBomRows ONCE with (state, choice, forceRefresh); result passthrough verbatim", async () => {
    mockRows.mockResolvedValue(BUILD_RESULT as never);
    const res = await bomPost(jsonReq("/api/bom", JSON.stringify({ state: STATE, pricingChoice: "digikey", forceRefresh: true })));
    expect(mockRows).toHaveBeenCalledTimes(1);
    expect(mockRows.mock.calls[0]![1]).toBe("digikey");
    expect(mockRows.mock.calls[0]![2]).toBe(true);
    expect(res.status).toBe(200);
    expect((await payload(res)).marker).toBe("result-passthrough");
  });
  it.each([
    ["digikey", digikeyPost, "sirkit-bom-digikey.csv", (): string => toDigiKeyCsv([])],
    ["lcsc", lcscPost, "sirkit-bom-lcsc.csv", (): string => toLcscCsv([])],
    ["mouser", mouserPost, "sirkit-bom-mouser.csv", (): string => toMouserCsv([])],
  ] as const)("[cart/%s] valid → REAL CSV bytes over the built rows; exact filename + Content-Type", async (name, handler, filename, expected) => {
    mockRows.mockResolvedValue(BUILD_RESULT as never);
    const res = await handler(jsonReq(`/api/bom/cart/${name}`, JSON.stringify({ state: STATE, pricingChoice: "none" })));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="${filename}"`);
    expect(await res.text()).toBe(expected()); // byte parity with the real formatter
  });
  it("[export-csv] valid → buildBom ONCE, bomToCsv output passed through; exact headers; legacy 'both'→'all' normalization", async () => {
    mockBuild.mockResolvedValue({ any: "result" } as never);
    const res = await exportCsvPost(jsonReq("/api/bom/export-csv", JSON.stringify({ state: STATE, pricingChoice: "both" })));
    expect(mockBuild).toHaveBeenCalledTimes(1);
    expect(mockBuild.mock.calls[0]![1]).toBe("all"); // legacy persisted value normalized
    expect(mockToCsv).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="sirkit-bom.csv"');
    expect(await res.text()).toBe("csv-bytes\n");
  });
  it("[procurement-packet] valid → REAL packet CSV (frozen clock) with title/quantity/notes; exact filename", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T00:00:00Z"));
    mockRows.mockResolvedValue(BUILD_RESULT as never);
    const res = await packetPost(jsonReq("/api/bom/procurement-packet", JSON.stringify({ state: STATE, pricingChoice: "none", title: "My Board", buildQuantity: 5, notes: "n1" })));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="sirkit-procurement-packet.csv"');
    expect(await res.text()).toBe(toProcurementPacketCsv([], { title: "My Board", buildQuantity: 5, date: new Date("2026-01-02T00:00:00Z"), notes: "n1" }));
  });
});

// ── AUTHENTICATED project-owned methods ──────────────────────────────────────

interface AuthCase { name: string; method: string; make: (body: string) => Request; handler: (r: Request) => Promise<Response>; oversize: number }
const AUTH: AuthCase[] = [
  { name: "bom/diff POST", method: "POST", make: (b) => jsonReq("/api/bom/diff", b), handler: diffPost, oversize: 8_000_001 },
  { name: "bom/snapshot POST", method: "POST", make: (b) => jsonReq("/api/bom/snapshot", b), handler: snapPost, oversize: 8_000_001 },
  { name: "bom/notifications PATCH", method: "PATCH", make: (b) => jsonReq("/api/bom/notifications", b, "PATCH"), handler: notifPatch, oversize: 16_001 },
  { name: "bom/notifications DELETE", method: "DELETE", make: (b) => jsonReq("/api/bom/notifications", b, "DELETE"), handler: notifDelete, oversize: 16_001 },
];
const AUTH_GETS: Array<{ name: string; path: string; handler: (r: Request) => Promise<Response> }> = [
  { name: "bom/notifications GET", path: "/api/bom/notifications", handler: notifGet },
  { name: "bom/snapshot GET", path: "/api/bom/snapshot", handler: snapGet },
];

describe("B16.0.11 §A — authenticated BOM boundary pins", () => {
  it.each([...AUTH.map((a) => ({ name: a.name, handler: a.handler, method: a.method, path: a.name.includes("diff") ? "/api/bom/diff" : a.name.includes("snapshot") ? "/api/bom/snapshot" : "/api/bom/notifications" })), ...AUTH_GETS.map((g) => ({ name: g.name, handler: g.handler, method: "GET", path: g.path }))])(
    "[$name] anonymous → 401 with ZERO body pulls and ZERO repository calls", async (c) => {
      installRepo();
      injectIdentity(null);
      const counter = { pulls: 0 };
      const req = c.method === "GET"
        ? new Request(`http://localhost${c.path}`, { method: "GET", headers: { ...SEL } })
        : countingReq(c.path, { origin: "http://localhost" }, counter, c.method);
      const res = await c.handler(req);
      expect(res.status).toBe(401);
      expect(counter.pulls).toBe(0);
      for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
    });

  it.each(AUTH)("[$name] production cross-origin → 403 CSRF with ZERO pulls + ZERO repository calls", async (a) => {
    installRepo(); stubProduction(); authed();
    const counter = { pulls: 0 };
    const path = a.name.includes("diff") ? "/api/bom/diff" : a.name.includes("snapshot") ? "/api/bom/snapshot" : "/api/bom/notifications";
    const res = await a.handler(countingReq(path, { origin: "http://evil.example" }, counter, a.method));
    expect(res.status).toBe(403);
    expect(counter.pulls).toBe(0);
    for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
  });

  it("revoked membership → 403 with zero repository calls (representative: snapshot GET)", async () => {
    installRepo();
    injectIdentity({ userId: "e1" });
    injectMembership([{ tenantId: "local", projectId: PROJECT, userId: "e1", role: "editor", state: "revoked" }]);
    const res = await snapGet(new Request("http://localhost/api/bom/snapshot", { method: "GET", headers: { ...SEL } }));
    expect(res.status).toBe(403);
    for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
  });

  it.each(AUTH)("[$name] text/plain → 415 with ZERO pulls; malformed JSON → 400; oversized → 413 — all zero repository calls", async (a) => {
    installRepo(); authed();
    const path = a.name.includes("diff") ? "/api/bom/diff" : a.name.includes("snapshot") ? "/api/bom/snapshot" : "/api/bom/notifications";
    const counter = { pulls: 0 };
    const m = await a.handler(countingReq(path, { origin: "http://localhost", "content-type": "text/plain" }, counter, a.method));
    expect(m.status).toBe(415);
    expect(counter.pulls).toBe(0);
    const bad = await a.handler(a.make("{not json"));
    expect(bad.status).toBe(400);
    expect((await payload(bad)).code).toBe("AUTH_INVALID_JSON");
    const big = await a.handler(a.make("x".repeat(a.oversize)));
    expect(big.status).toBe(413);
    for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
  });

  it.each(AUTH)("[$name] EVERY forbidden authority key → the exact historical 400 refusal, zero repository calls", async (a) => {
    installRepo(); authed();
    for (const key of ["projectKey", "tenantId", "projectId", "branchId", "actor", "actorId", "role"]) {
      const res = await a.handler(a.make(JSON.stringify({ [key]: "evil" })));
      expect(res.status, key).toBe(400);
      const body = await payload(res);
      expect(body.code, key).toBe("AUTH_AUTHORITATIVE_INPUT_FORBIDDEN");
      expect(body.error, key).toBe(`\`${key}\` is server-derived and may not be supplied.`);
      expect(res.headers.get("Cache-Control"), key).toBe("no-store");
    }
    for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("B16.0.11 §D — trusted ownership scope + cross-project refusal", () => {
  it("[snapshot POST] valid → buildBomRows then createSnapshot with EXACTLY the trusted scope; 200 {ok,id}", async () => {
    installRepo(); authed();
    mockRows.mockResolvedValue(BUILD_RESULT as never);
    const res = await snapPost(jsonReq("/api/bom/snapshot", JSON.stringify({ state: STATE, label: " L1 " }), "POST"));
    expect(res.status).toBe(200);
    expect((await payload(res)).id).toBe("snap-new");
    expect(repo.createSnapshot).toHaveBeenCalledTimes(1);
    expect(repo.createSnapshot.mock.calls[0]![0]).toEqual(TRUSTED);
    expect((repo.createSnapshot.mock.calls[0]![1] as { label: string }).label).toBe("L1");
  });
  it("[snapshot GET] list uses the trusted scope; mapped summary shape", async () => {
    installRepo(); authed();
    const res = await snapGet(new Request("http://localhost/api/bom/snapshot", { method: "GET", headers: { ...SEL } }));
    expect(res.status).toBe(200);
    expect(repo.listSnapshots.mock.calls[0]![0]).toEqual(TRUSTED);
    const out = await payload(res);
    expect(out.snapshots).toEqual([{ id: "s1", label: "L", takenAt: "2026-01-01T00:00:00.000Z", rowCount: 1, totalCostCents: 100, currency: "USD", designRiskScore: 2 }]);
  });
  it("[diff] foreign/legacy `from` id → uniform 404 BOM_NOT_FOUND; lookup carried the trusted scope", async () => {
    installRepo(); authed();
    const res = await diffPost(jsonReq("/api/bom/diff", JSON.stringify({ from: "foreign-id", to: "owned-to" })));
    expect(res.status).toBe(404);
    expect((await payload(res)).code).toBe("BOM_NOT_FOUND");
    expect(repo.getSnapshot.mock.calls[0]![0]).toEqual(TRUSTED);
  });
  it("[diff] owned from→to → 200 with changes; `from`/`to` required refusal preserved", async () => {
    installRepo(); authed();
    const ok = await diffPost(jsonReq("/api/bom/diff", JSON.stringify({ from: "owned-from", to: "owned-to" })));
    expect(ok.status).toBe(200);
    expect((await payload(ok)).ok).toBe(true);
    const missing = await diffPost(jsonReq("/api/bom/diff", JSON.stringify({ from: "owned-from" })));
    expect(missing.status).toBe(400);
    expect((await payload(missing)).error).toBe("`from` and `to` are required.");
  });
  it("[diff to=current] requires `state`; a valid current-diff builds an UNPERSISTED snapshot (no repository write)", async () => {
    installRepo(); authed();
    const noState = await diffPost(jsonReq("/api/bom/diff", JSON.stringify({ from: "owned-from", to: "current" })));
    expect(noState.status).toBe(400);
    expect((await payload(noState)).error).toBe("`state` is required (and must be a schematic state) when `to=current`.");
    mockRows.mockResolvedValue(BUILD_RESULT as never);
    const ok = await diffPost(jsonReq("/api/bom/diff", JSON.stringify({ from: "owned-from", to: "current", state: STATE })));
    expect(ok.status).toBe(200);
    expect(repo.createSnapshot).not.toHaveBeenCalled(); // unpersisted, ownership authority unchanged
  });
  it("[notifications PATCH] foreign id → uniform 404, repository predicate carried (id AND trusted scope); owned id updates", async () => {
    installRepo(); authed();
    const foreign = await notifPatch(jsonReq("/api/bom/notifications", JSON.stringify({ id: "foreign-n9", readAt: "2026-01-01T00:00:00Z" }), "PATCH"));
    expect(foreign.status).toBe(404);
    expect((await payload(foreign)).code).toBe("BOM_NOT_FOUND");
    expect(repo.updateNotification.mock.calls[0]![0]).toEqual(TRUSTED);
    const owned = await notifPatch(jsonReq("/api/bom/notifications", JSON.stringify({ id: "own-n1", readAt: "2026-01-01T00:00:00Z" }), "PATCH"));
    expect(owned.status).toBe(200);
  });
  it("[notifications PATCH markAllRead] bulk stays scope-constrained", async () => {
    installRepo(); authed();
    const res = await notifPatch(jsonReq("/api/bom/notifications", JSON.stringify({ markAllRead: true }), "PATCH"));
    expect(res.status).toBe(200);
    expect((await payload(res)).updated).toBe(3);
    expect(repo.markAllNotificationsRead.mock.calls[0]![0]).toEqual(TRUSTED);
  });
  it("[notifications DELETE] bulk cleanup carries the trusted scope (+olderThan when valid)", async () => {
    installRepo(); authed();
    const res = await notifDelete(jsonReq("/api/bom/notifications", JSON.stringify({ olderThan: "2026-01-01T00:00:00Z" }), "DELETE"));
    expect(res.status).toBe(200);
    expect((await payload(res)).deleted).toBe(2);
    expect(repo.deleteNotifications.mock.calls[0]![0]).toEqual(TRUSTED);
    expect((repo.deleteNotifications.mock.calls[0]![1] as { olderThan: Date }).olderThan.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
  it("[notifications GET] unreadOnly=true reaches the repository under the trusted scope; list returned", async () => {
    installRepo(); authed();
    const res = await notifGet(new Request("http://localhost/api/bom/notifications?unreadOnly=true", { method: "GET", headers: { ...SEL } }));
    expect(res.status).toBe(200);
    expect(repo.listNotifications.mock.calls[0]![0]).toEqual(TRUSTED);
    expect((repo.listNotifications.mock.calls[0]![1] as { unreadOnly: boolean }).unreadOnly).toBe(true);
    expect(((await payload(res)).notifications as unknown[]).length).toBe(1);
  });
  it("[notifications PATCH] `id` required + nothing-to-update refusals preserved", async () => {
    installRepo(); authed();
    const noId = await notifPatch(jsonReq("/api/bom/notifications", JSON.stringify({}), "PATCH"));
    expect(noId.status).toBe(400);
    expect((await payload(noId)).error).toBe("`id` is required.");
    const nothing = await notifPatch(jsonReq("/api/bom/notifications", JSON.stringify({ id: "own-n1" }), "PATCH"));
    expect(nothing.status).toBe(400);
    expect((await payload(nothing)).error).toBe("Nothing to update.");
  });
  it("[snapshot POST] `state` required refusal preserved; body scope keys cannot select another project (forbidden before any read)", async () => {
    installRepo(); authed();
    const res = await snapPost(jsonReq("/api/bom/snapshot", JSON.stringify({}), "POST"));
    expect(res.status).toBe(400);
    expect((await payload(res)).error).toBe("Body must include a `state`.");
    for (const fn of Object.values(repo)) expect(fn).not.toHaveBeenCalled();
  });
});
