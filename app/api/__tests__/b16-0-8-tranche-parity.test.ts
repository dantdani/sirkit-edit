/**
 * B16.0.8 §D — BEHAVIORAL PARITY for the first migration tranche.
 *
 * Written and run GREEN against the PRE-migration handlers, then kept green
 * after each method moves to its canonical wrapper — pinning success status,
 * body shape, content type, Cache-Control/custom headers, auth/role refusals,
 * media-type refusal, byte ceiling, query/dynamic params, and public error
 * codes. DB/catalog seams are mocked identically for both runs so the pins are
 * deterministic (no live database is contacted).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";

vi.mock("@/app/lib/db/client", () => ({
  getDb: () => { throw new Error("parity: no db"); },
}));
vi.mock("@/app/lib/atomic/server-catalog", () => ({
  loadPublishedPortableSnapshot: vi.fn(async () => null),
}));
import { loadPublishedPortableSnapshot } from "@/app/lib/atomic/server-catalog";

import { GET as capabilitiesGet } from "../requirements/capabilities/route";
import { GET as categoriesGet } from "../parts/categories/route";
import { GET as kicadRootGet } from "../kicad/v1/route";
import { GET as kicadCategoriesGet } from "../kicad/v1/categories.json/route";
import { GET as kicadPartGet } from "../kicad/v1/parts/[id]/route";
import { POST as constraintsExplain } from "../constraints/explain/route";
import { POST as constraintsPreview } from "../constraints/preview/route";
import { POST as partsSearch } from "../parts/search/route";
import { POST as materialize } from "../assignment-queue/materialize/route";
import { POST as revalidate } from "../assignment-queue/revalidate/route";
import { POST as engineeringEffects } from "../engineering-effects/route";
import { GET as footprintGet } from "../footprint-resolution/route";
import { GET as mappingGet } from "../mapping-verification/route";
import { POST as requirementsCompile } from "../requirements/compile/route";
import { POST as requirementsSources } from "../requirements/sources/route";

const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };
const WORKER_SECRET = "worker-parity-secret";

function jsonReq(path: string, body: string, headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...headers }, body });
}
function countingPost(path: string, headers: Record<string, string>, counter: { pulls: number }): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
  return new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: stream, duplex: "half" } as RequestInit);
}
async function body(res: Response): Promise<Record<string, unknown>> { return (await res.json()) as Record<string, unknown>; }

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); vi.mocked(loadPublishedPortableSnapshot).mockClear(); });

// ── Public no-body ────────────────────────────────────────────────────────────

describe("parity: GET /api/requirements/capabilities", () => {
  it("200, one embedded profile, Cache-Control public max-age=300", async () => {
    // Next always passes the Request; the pre-migration handler ignored it.
    const res = await capabilitiesGet(new Request("http://localhost/api/requirements/capabilities"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    const b = await body(res);
    expect(Array.isArray(b.profiles)).toBe(true);
    expect((b.profiles as unknown[]).length).toBe(1);
  });
});

describe("parity: GET /api/parts/categories", () => {
  it("db failure → 500 { ok:false, error } (mocked db seam, identical pre/post)", async () => {
    const res = await categoriesGet(new Request("http://localhost/api/parts/categories"));
    expect(res.status).toBe(500);
    const b = await body(res);
    expect(b.ok).toBe(false);
    expect(typeof b.error).toBe("string");
  });
});

describe("parity: KiCad HTTP library (token boundary)", () => {
  const tokenReq = (path: string, auth?: string): Request =>
    new Request(`http://localhost${path}`, { method: "GET", headers: auth ? { authorization: auth } : {} });
  it("unconfigured token → 503 for all three", async () => {
    expect((await kicadRootGet(tokenReq("/api/kicad/v1"))).status).toBe(503);
    expect((await kicadCategoriesGet(tokenReq("/api/kicad/v1/categories.json"))).status).toBe(503);
    expect((await kicadPartGet(tokenReq("/api/kicad/v1/parts/x"), { params: Promise.resolve({ id: "x" }) })).status).toBe(503);
  });
  it("wrong/missing token → 401 Unauthorized", async () => {
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", "kicad-token");
    expect((await kicadRootGet(tokenReq("/api/kicad/v1"))).status).toBe(401);
    expect((await kicadRootGet(tokenReq("/api/kicad/v1", "Token wrong"))).status).toBe(401);
  });
  it("valid token → discovery + categories bodies pinned", async () => {
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", "kicad-token");
    const root = await kicadRootGet(tokenReq("/api/kicad/v1", "Token kicad-token"));
    expect(root.status).toBe(200);
    expect(await root.json()).toEqual({ categories: "categories.json", parts: "parts" });
    const cats = await kicadCategoriesGet(tokenReq("/api/kicad/v1/categories.json", "Token kicad-token"));
    expect(cats.status).toBe(200);
    expect(((await cats.json()) as Array<{ id: string }>)[0]!.id).toBe("published");
  });
  it("parts/[id]: strips .json suffix, 404 for unknown part (mocked catalog)", async () => {
    vi.stubEnv("KICAD_HTTP_LIBRARY_TOKEN", "kicad-token");
    const res = await kicadPartGet(tokenReq("/api/kicad/v1/parts/abc.json", "Token kicad-token"), { params: Promise.resolve({ id: "abc.json" }) });
    expect(res.status).toBe(404);
    expect(await body(res)).toEqual({ error: "Part not found" });
    expect(vi.mocked(loadPublishedPortableSnapshot)).toHaveBeenCalledWith("abc"); // .json stripped
  });
});

// ── Public JSON ───────────────────────────────────────────────────────────────

describe("parity: POST /api/constraints/explain", () => {
  it("missing program/targetId → 400 exact error", async () => {
    const res = await constraintsExplain(jsonReq("/api/constraints/explain", "{}"));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("program and targetId are required");
  });
  it("text/plain → 415; oversized → 413; bad JSON → 400 AUTH_INVALID_JSON", async () => {
    expect((await constraintsExplain(jsonReq("/api/constraints/explain", "{}", { "content-type": "text/plain" }))).status).toBe(415);
    expect((await constraintsExplain(jsonReq("/api/constraints/explain", JSON.stringify({ pad: "x".repeat(2_100_000) })))).status).toBe(413);
    const bad = await constraintsExplain(jsonReq("/api/constraints/explain", "{nope"));
    expect(bad.status).toBe(400);
    expect((await body(bad)).code).toBe("AUTH_INVALID_JSON");
  });
});

describe("parity: POST /api/constraints/preview", () => {
  it("missing board/projectId/documents → 400 exact error", async () => {
    const res = await constraintsPreview(jsonReq("/api/constraints/preview", "{}"));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("board, projectId, and documents are required");
  });
});

describe("parity: POST /api/parts/search", () => {
  it("query too long → 400 exact error", async () => {
    const res = await partsSearch(jsonReq("/api/parts/search", JSON.stringify({ query: "q".repeat(501) })));
    expect(res.status).toBe(400);
    expect((await body(res)).error).toBe("query must be under 500 characters");
  });
  it("db failure on a valid body → 500 { ok:false } (mocked db seam)", async () => {
    const res = await partsSearch(jsonReq("/api/parts/search", JSON.stringify({ query: "res" })));
    expect(res.status).toBe(500);
    expect((await body(res)).ok).toBe(false);
  });
  it("oversized → 413; text/plain → 415", async () => {
    expect((await partsSearch(jsonReq("/api/parts/search", JSON.stringify({ query: "x".repeat(250_000) })))).status).toBe(413);
    expect((await partsSearch(jsonReq("/api/parts/search", "{}", { "content-type": "text/plain" }))).status).toBe(415);
  });
});

// ── Worker ────────────────────────────────────────────────────────────────────

describe("parity: worker routes — exact refusal codes and header presence", () => {
  it("materialize: missing secret → 401 AQ_SOURCE_WORKER_UNAUTHORIZED, NO Cache-Control, 0 body pulls", async () => {
    vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", WORKER_SECRET);
    const counter = { pulls: 0 };
    const res = await materialize(countingPost("/api/assignment-queue/materialize", {}, counter));
    expect(res.status).toBe(401);
    expect((await body(res)).code).toBe("AQ_SOURCE_WORKER_UNAUTHORIZED");
    expect(res.headers.get("Cache-Control")).toBeNull();
    expect(counter.pulls).toBe(0);
  });
  it("materialize: valid secret + text/plain → 415; + bad JSON → 400", async () => {
    vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", WORKER_SECRET);
    const auth = { authorization: `Bearer ${WORKER_SECRET}` };
    expect((await materialize(jsonReq("/api/assignment-queue/materialize", "{}", { ...auth, "content-type": "text/plain" }))).status).toBe(415);
    expect((await materialize(jsonReq("/api/assignment-queue/materialize", "{nope", auth))).status).toBe(400);
  });
  it("revalidate: missing secret → 401 AQ_REVALIDATION_WORKER_UNAUTHORIZED WITH no-store, 0 pulls", async () => {
    vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", WORKER_SECRET);
    const counter = { pulls: 0 };
    const res = await revalidate(countingPost("/api/assignment-queue/revalidate", {}, counter));
    expect(res.status).toBe(401);
    expect((await body(res)).code).toBe("AQ_REVALIDATION_WORKER_UNAUTHORIZED");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(counter.pulls).toBe(0);
  });
  it("engineering-effects: missing secret → 401 DW_WORKER_UNAUTHORIZED WITH no-store, 0 pulls", async () => {
    vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", WORKER_SECRET);
    const counter = { pulls: 0 };
    const res = await engineeringEffects(countingPost("/api/engineering-effects", {}, counter));
    expect(res.status).toBe(401);
    expect((await body(res)).code).toBe("DW_WORKER_UNAUTHORIZED");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(counter.pulls).toBe(0);
  });
  it("worker routes: unconfigured secret env → 401 (fail closed), never 500", async () => {
    const counter = { pulls: 0 };
    expect((await materialize(countingPost("/api/assignment-queue/materialize", { authorization: "Bearer x" }, counter))).status).toBe(401);
    expect((await revalidate(countingPost("/api/assignment-queue/revalidate", { authorization: "Bearer x" }, counter))).status).toBe(401);
    expect((await engineeringEffects(countingPost("/api/engineering-effects", { authorization: "Bearer x" }, counter))).status).toBe(401);
  });
});

// ── Authenticated no-body ─────────────────────────────────────────────────────

describe("parity: GET /api/footprint-resolution (authenticated, no body)", () => {
  it("anonymous → 401 AUTH_UNAUTHENTICATED", async () => {
    injectIdentity(null);
    const res = await footprintGet(new Request("http://localhost/api/footprint-resolution", { headers: { ...SEL } }));
    expect(res.status).toBe(401);
    expect((await body(res)).code).toBe("AUTH_UNAUTHENTICATED");
  });
  it("editor → 200 static capabilities JSON, no-store", async () => {
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-1", role: "editor" });
    const res = await footprintGet(new Request("http://localhost/api/footprint-resolution", { headers: { ...SEL } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const b = await body(res);
    expect(b.ok).toBe(true);
    expect(b.readOnly).toBe(true);
    expect(typeof b.resolverVersion).toBe("string");
    expect(b.cache).toMatchObject({ mode: "disabled" });
  });
});

describe("parity: GET /api/mapping-verification (authenticated, no body)", () => {
  it("anonymous → 401; editor → 200 with state header + capabilities", async () => {
    injectIdentity(null);
    expect((await mappingGet(new Request("http://localhost/api/mapping-verification", { headers: { ...SEL } }))).status).toBe(401);
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-1", role: "editor" });
    const res = await mappingGet(new Request("http://localhost/api/mapping-verification", { headers: { ...SEL } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("X-Sirkit-Mapping-Stage4")).toBeTruthy();
    const b = await body(res);
    expect(b.ok).toBe(true);
    expect(b.capabilities).toBeTruthy();
    expect(b.versions).toBeTruthy();
  });
});

// ── Authenticated JSON ────────────────────────────────────────────────────────

describe("parity: POST /api/requirements/compile", () => {
  const authed = (): void => { injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-1", role: "editor" }); };
  it("anonymous → 401 AUTH_UNAUTHENTICATED", async () => {
    injectIdentity(null);
    const res = await requirementsCompile(jsonReq("/api/requirements/compile", JSON.stringify({ input: {} }), SEL));
    expect(res.status).toBe(401);
  });
  it("scope-mismatched input → 403 exact error", async () => {
    authed();
    const res = await requirementsCompile(jsonReq("/api/requirements/compile", JSON.stringify({ input: { tenantId: "other", projectId: "px" } }), SEL));
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("requirements compile scope mismatch");
  });
  it("missing input → 400 exact error; text/plain → 415; bad JSON → 400 AUTH_INVALID_JSON", async () => {
    authed();
    expect((await body(await requirementsCompile(jsonReq("/api/requirements/compile", "{}", SEL)))).error).toBe("input is required");
    expect((await requirementsCompile(jsonReq("/api/requirements/compile", "{}", { ...SEL, "content-type": "text/plain" }))).status).toBe(415);
    expect(((await body(await requirementsCompile(jsonReq("/api/requirements/compile", "{nope", SEL)))) as { code?: string }).code).toBe("AUTH_INVALID_JSON");
  });
});

describe("parity: POST /api/requirements/sources", () => {
  it("anonymous → 401; editor scope mismatch → 403 exact error", async () => {
    injectIdentity(null);
    expect((await requirementsSources(jsonReq("/api/requirements/sources", JSON.stringify({ tenantId: "local", projectId: "proj-1" }), SEL))).status).toBe(401);
    injectAuthorizedPrincipal({ userId: "e1", tenantId: "local", projectId: "proj-1", role: "editor" });
    const res = await requirementsSources(jsonReq("/api/requirements/sources", JSON.stringify({ tenantId: "other", projectId: "px" }), SEL));
    expect(res.status).toBe(403);
    expect((await body(res)).error).toBe("requirements source scope mismatch");
  });
});
