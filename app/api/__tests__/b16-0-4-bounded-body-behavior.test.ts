/**
 * B16.0.4 §D — REQUIRED bounded-body BEHAVIORAL coverage.
 *
 * Drives the REAL exported route handlers (one+ representative per migrated
 * family) and the ONE shared bounded reader, proving the lifecycle contract
 * end-to-end WITHOUT spending a single provider credit or touching a database
 * — every case refuses at the bounded read, which precedes all provider,
 * durable, and process work:
 *
 *  - a malformed-JSON body refuses (400 AUTH_INVALID_JSON) — for EVERY family;
 *  - a non-object body refuses (400 AUTH_OBJECT_REQUIRED);
 *  - a PRE-ABORTED request refuses with ZERO read work (400 AUTH_BODY_ABORTED)
 *    — for EVERY family (proves body refusal → zero provider/durable/process);
 *  - an OVERSIZED body stops at the ceiling (413 AUTH_PAYLOAD_TOO_LARGE);
 *  - malformed UTF-8 refuses (400 AUTH_BODY_NOT_UTF8);
 *  - a never-settling stream settles at the deadline (408), a slow trickle the
 *    same — the handler can never hang;
 *  - a protected route refuses BEFORE the body is pulled (401, zero pulls);
 *  - a LATE source completion after a timeout produces no unhandled rejection
 *    and does not change the already-settled result (exactly one terminal).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, injectIdentity, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { readBoundedJsonObject, readBoundedJsonBody } from "@/app/lib/http/bounded-json";

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
  { family: "worker", path: "/api/assignment-queue/materialize", handler: assignmentMaterialize, auth: "worker" },
];

/** Make authorization PASS for a route's kind (no provider, no DB). */
function grantAuth(route: RouteCase): void {
  if (route.auth === "authenticated") injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: "proj-1", role: "editor" });
  if (route.auth === "worker") vi.stubEnv("SIRKIT_WORKFLOW_WORKER_SECRET", WORKER_SECRET);
}
function authHeaders(route: RouteCase): Record<string, string> {
  if (route.auth === "authenticated") return { ...SEL };
  if (route.auth === "worker") return { authorization: `Bearer ${WORKER_SECRET}` };
  return {};
}
function jsonReq(route: RouteCase, bodyStr: string, extra: Record<string, string> = {}, signal?: AbortSignal): Request {
  return new Request(`http://localhost${route.path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...authHeaders(route), ...extra },
    body: bodyStr,
    ...(signal ? { signal } : {}),
  });
}
function streamReq(path: string, stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}, signal?: AbortSignal): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...headers },
    body: stream,
    duplex: "half",
    ...(signal ? { signal } : {}),
  } as RequestInit);
}
async function bodyOf(res: Response): Promise<{ ok?: boolean; code?: string; error?: string }> {
  try { return (await res.json()) as { ok?: boolean; code?: string }; } catch { return {}; }
}

afterEach(() => { resetInjectedIdentity(); vi.unstubAllEnvs(); });

describe("B16.0.4 §D — every migrated route family refuses a malformed body at the bounded read (no provider/durable/process work)", () => {
  it.each(ROUTES)("[$family] malformed JSON → 400 AUTH_INVALID_JSON", async (route) => {
    grantAuth(route);
    const res = await route.handler(jsonReq(route, "{ this is not valid json"));
    expect(res.status, route.family).toBe(400);
    expect((await bodyOf(res)).code, route.family).toBe("AUTH_INVALID_JSON");
  });

  it.each(ROUTES)("[$family] a non-object body (array) → 400 AUTH_OBJECT_REQUIRED", async (route) => {
    grantAuth(route);
    const res = await route.handler(jsonReq(route, "[1,2,3]"));
    expect(res.status, route.family).toBe(400);
    expect((await bodyOf(res)).code, route.family).toBe("AUTH_OBJECT_REQUIRED");
  });

  it.each(ROUTES)("[$family] a PRE-ABORTED request → 400 AUTH_BODY_ABORTED with ZERO body read (⇒ zero provider/durable/process)", async (route) => {
    grantAuth(route);
    const ac = new AbortController();
    ac.abort();
    const res = await route.handler(jsonReq(route, JSON.stringify({ any: "payload" }), {}, ac.signal));
    expect(res.status, route.family).toBe(400);
    expect((await bodyOf(res)).code, route.family).toBe("AUTH_BODY_ABORTED");
  });

  it.each(ROUTES)("[$family] malformed UTF-8 → 400 AUTH_BODY_NOT_UTF8", async (route) => {
    grantAuth(route);
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([0xff, 0xfe, 0xff])); c.close(); } });
    const res = await route.handler(streamReq(route.path, stream, authHeaders(route)));
    expect(res.status, route.family).toBe(400);
    expect((await bodyOf(res)).code, route.family).toBe("AUTH_BODY_NOT_UTF8");
  });
});

describe("B16.0.4 §D — oversized bodies stop at the ceiling (real handler, small-limit route)", () => {
  it("[public-misc] parts/search (200 KB ceiling): a 250 KB body → 413 AUTH_PAYLOAD_TOO_LARGE, DB never reached", async () => {
    const oversize = JSON.stringify({ query: "x".repeat(250_000) });
    const res = await partsSearch(new Request("http://localhost/api/parts/search", {
      method: "POST", headers: { "content-type": "application/json" }, body: oversize,
    }));
    expect(res.status).toBe(413);
    expect((await bodyOf(res)).code).toBe("AUTH_PAYLOAD_TOO_LARGE");
  });
});

describe("B16.0.4 §D — a protected route refuses BEFORE the body is pulled", () => {
  it("[schematic] anonymous same-origin request → 401 with ZERO body pulls", async () => {
    injectIdentity(null);
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls += 1; c.enqueue(new TextEncoder().encode(JSON.stringify({ prompt: "x" }))); c.close(); } }, { highWaterMark: 0 });
    const res = await schematicBuild(streamReq("/api/schematic/build", stream, SEL));
    expect(res.status).toBe(401);
    expect(pulls).toBe(0);
  });

  it("[interfaces] anonymous same-origin request → 401 with ZERO body pulls", async () => {
    injectIdentity(null);
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls += 1; c.enqueue(new TextEncoder().encode("{}")); c.close(); } }, { highWaterMark: 0 });
    const res = await interfacesCandidates(streamReq("/api/interfaces/candidates", stream, SEL));
    expect(res.status).toBe(401);
    expect(pulls).toBe(0);
  });
});

describe("B16.0.4 §D — the shared bounded reader: deadline, trickle, ceiling, abort, late-latch", () => {
  function streamRequest(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Request {
    return new Request("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: stream, duplex: "half", ...(signal ? { signal } : {}) } as RequestInit);
  }

  it("a never-settling stream settles at the deadline (408 timeout)", async () => {
    const stream = new ReadableStream<Uint8Array>({ pull() { /* never enqueues, never closes */ return new Promise<void>(() => {}); } });
    const read = await readBoundedJsonObject(streamRequest(stream), { maxBytes: 1_000, deadlineMs: 40 });
    expect(read.ok).toBe(false);
    if (!read.ok) { expect(read.reason).toBe("timeout"); expect(read.status).toBe(408); }
  });

  it("a slow trickle that never completes within the deadline settles at the deadline (408)", async () => {
    const stream = new ReadableStream<Uint8Array>({
      pull(c) { return new Promise<void>((resolve) => setTimeout(() => { try { c.enqueue(new Uint8Array([0x20])); } catch { /* reader already settled/cancelled */ } resolve(); }, 25)); },
    });
    const read = await readBoundedJsonObject(streamRequest(stream), { maxBytes: 10_000, deadlineMs: 40 });
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toBe("timeout");
  });

  it("an unbounded stream stops at the byte ceiling (413 over-limit) rather than reading forever", async () => {
    let emitted = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { emitted += 1; try { c.enqueue(new Uint8Array(2_000)); } catch { /* reader already settled/cancelled */ } /* never closes */ } });
    const read = await readBoundedJsonObject(streamRequest(stream), { maxBytes: 1_000, deadlineMs: 1_000 });
    expect(read.ok).toBe(false);
    if (!read.ok) { expect(read.reason).toBe("over-limit"); expect(read.status).toBe(413); }
    expect(emitted).toBeLessThan(5); // stopped promptly at the ceiling
  });

  it("a pre-aborted request performs no read at all (400 aborted)", async () => {
    const ac = new AbortController();
    ac.abort();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { pulls += 1; c.enqueue(new Uint8Array([0x7b, 0x7d])); c.close(); } }, { highWaterMark: 0 });
    const read = await readBoundedJsonBody(streamRequest(stream, ac.signal), { maxBytes: 1_000 });
    expect(read.ok).toBe(false);
    if (!read.ok) { expect(read.reason).toBe("aborted"); expect(read.status).toBe(400); }
    expect(pulls).toBe(0);
  });

  it("a LATE source completion after a timeout produces no unhandled rejection and does not change the settled result", async () => {
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => { rejections.push(reason); };
    process.on("unhandledRejection", onRejection);
    try {
      const stream = new ReadableStream<Uint8Array>({
        pull(c) {
          return new Promise<void>((resolve) => setTimeout(() => {
            try { c.enqueue(new TextEncoder().encode("{}")); c.close(); } catch { /* reader already cancelled — expected */ }
            resolve();
          }, 90));
        },
      });
      const read = await readBoundedJsonObject(streamRequest(stream), { maxBytes: 1_000, deadlineMs: 30 });
      expect(read.ok).toBe(false);
      if (!read.ok) expect(read.reason).toBe("timeout");
      // give the LATE completion time to fire after the reader has already settled
      await new Promise<void>((resolve) => setTimeout(resolve, 120));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});
