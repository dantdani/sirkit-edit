/**
 * B16.0.5 §C/§D — media-type enforcement on REAL routes + wrapper integrity.
 *
 * §C: every JSON-consuming POST refuses text/plain, a missing Content-Type, and
 * other unsupported media with EXACTLY 415 AUTH_MEDIA_TYPE_UNSUPPORTED, before
 * the first body pull, no-store, with zero provider/durable/process work;
 * application/json (with or without charset) is accepted past the media gate.
 *
 * §D: the audited JSON-wrapper callback receives ONLY trusted context, the
 * parsed bounded body, the byte count, and non-secret metadata — never the raw
 * Request, Headers, Cookie, Authorization, or raw body access.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { authenticatedJsonRoute } from "@/app/lib/auth/route-handlers";

import { POST as architectureCandidates } from "../architecture/candidates/route";
import { POST as interfacesCandidates } from "../interfaces/candidates/route";
import { POST as powerCandidates } from "../power/candidates/route";
import { POST as schematicBuild } from "../schematic/build/route";
import { POST as pcbEditAssist } from "../pcb/edit/assist/route";
import { POST as spiceAi } from "../spice/ai/route";
import { POST as spiceCompile } from "../spice/compile/route";
import { POST as requirementsCompile } from "../requirements/compile/route";
import { POST as bomRoute } from "../bom/route";
import { POST as partsSearch } from "../parts/search/route";
import { POST as assignmentMaterialize } from "../assignment-queue/materialize/route";
import { POST as chatRoute } from "../chat/route";
import { POST as replacementAuthority } from "../replacement-authority/route";

type AuthKind = "authenticated" | "public" | "worker";
interface RouteCase { family: string; path: string; handler: (r: Request) => Promise<Response>; auth: AuthKind }

const WORKER_SECRET = "worker-secret-token";
const SEL = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": "proj-1", "x-sirkit-branch-id": "main" };

const ROUTES: RouteCase[] = [
  { family: "architecture", path: "/api/architecture/candidates", handler: architectureCandidates, auth: "authenticated" },
  { family: "interfaces", path: "/api/interfaces/candidates", handler: interfacesCandidates, auth: "authenticated" },
  { family: "power", path: "/api/power/candidates", handler: powerCandidates, auth: "authenticated" },
  { family: "schematic", path: "/api/schematic/build", handler: schematicBuild, auth: "authenticated" },
  { family: "pcb-ai", path: "/api/pcb/edit/assist", handler: pcbEditAssist, auth: "authenticated" },
  { family: "spice-ai", path: "/api/spice/ai", handler: spiceAi, auth: "authenticated" },
  { family: "requirements", path: "/api/requirements/compile", handler: requirementsCompile, auth: "authenticated" },
  { family: "spice-compile", path: "/api/spice/compile", handler: spiceCompile, auth: "public" },
  { family: "bom", path: "/api/bom", handler: bomRoute, auth: "public" },
  { family: "public-misc", path: "/api/parts/search", handler: partsSearch, auth: "public" },
  { family: "chat", path: "/api/chat", handler: chatRoute, auth: "public" },
  { family: "replacement-authority", path: "/api/replacement-authority", handler: replacementAuthority, auth: "authenticated" },
  { family: "worker", path: "/api/assignment-queue/materialize", handler: assignmentMaterialize, auth: "worker" },
];

function grantAuth(route: RouteCase): void {
  if (route.auth === "authenticated") injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: "proj-1", role: "editor" });
  if (route.auth === "worker") vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", WORKER_SECRET);
}
function authHeaders(route: RouteCase): Record<string, string> {
  if (route.auth === "authenticated") return { ...SEL };
  if (route.auth === "worker") return { authorization: `Bearer ${WORKER_SECRET}` };
  return {};
}
async function bodyOf(res: Response): Promise<{ code?: string }> {
  try { return (await res.json()) as { code?: string }; } catch { return {}; }
}
/** A counting body stream — proves ZERO body pulls on a media-type refusal. */
function countingReq(route: RouteCase, contentType: string | null, counter: { pulls: number }): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { counter.pulls += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
  const headers: Record<string, string> = { origin: "http://localhost", ...authHeaders(route) };
  if (contentType !== null) headers["content-type"] = contentType;
  return new Request(`http://localhost${route.path}`, { method: "POST", headers, body: stream, duplex: "half" } as RequestInit);
}

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); });

describe("B16.0.5 §C — unsupported media type → 415 before the first body pull (zero downstream)", () => {
  it.each(ROUTES)("[$family] text/plain → 415 AUTH_MEDIA_TYPE_UNSUPPORTED, no-store, 0 body pulls", async (route) => {
    grantAuth(route);
    const counter = { pulls: 0 };
    const res = await route.handler(countingReq(route, "text/plain", counter));
    expect(res.status, route.family).toBe(415);
    expect((await bodyOf(res)).code, route.family).toBe("AUTH_MEDIA_TYPE_UNSUPPORTED");
    expect(res.headers.get("Cache-Control"), route.family).toBe("no-store");
    expect(counter.pulls, route.family).toBe(0);
  });

  it.each(ROUTES)("[$family] MISSING Content-Type → 415, 0 body pulls", async (route) => {
    grantAuth(route);
    const counter = { pulls: 0 };
    const res = await route.handler(countingReq(route, null, counter));
    expect(res.status, route.family).toBe(415);
    expect(counter.pulls, route.family).toBe(0);
  });

  it.each(ROUTES)("[$family] application/json; charset=utf-8 is ACCEPTED past the media gate (status ≠ 415)", async (route) => {
    grantAuth(route);
    const counter = { pulls: 0 };
    const res = await route.handler(countingReq(route, "application/json; charset=utf-8", counter));
    expect(res.status, route.family).not.toBe(415);
  });
});

describe("B16.0.5 §D — the audited JSON wrapper callback receives no raw Request/headers/body", () => {
  it("authenticatedJsonRoute passes ONLY { context, body, bytes, meta } — no request/headers/cookie/authorization", async () => {
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: "proj-1", role: "editor" });
    let seenKeys: string[] = [];
    let seenInput: Record<string, unknown> = {};
    const handler = authenticatedJsonRoute({ maxBytes: 10_000 }, async (input) => {
      seenInput = input as unknown as Record<string, unknown>;
      seenKeys = Object.keys(seenInput).sort();
      return Response.json({ ok: true });
    });
    // A real authenticated POST policy path (the wrapper's authorizeRequest
    // resolves the exact policy row; a pathless synthetic would fail closed).
    const res = await handler(new Request("http://localhost/api/architecture/candidates", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost", cookie: "session=secret", authorization: "Bearer secret", ...SEL },
      body: JSON.stringify({ hello: "world" }),
    }));
    expect(res.status).toBe(200);
    expect(seenKeys).toEqual(["body", "bytes", "context", "meta"]);
    expect(seenInput).not.toHaveProperty("request");
    expect(seenInput).not.toHaveProperty("headers");
    expect(seenInput).not.toHaveProperty("cookie");
    expect(seenInput).not.toHaveProperty("authorization");
    // metadata is non-secret only
    expect(Object.keys(seenInput.meta as object).sort()).toEqual(["method", "pathname"]);
  });
});
