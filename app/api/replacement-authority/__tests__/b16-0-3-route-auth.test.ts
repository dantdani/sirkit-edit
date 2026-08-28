/**
 * B16.0.3 §E — /api/replacement-authority authenticates at RUNTIME.
 *
 * Drives the REAL `POST` handler (not a copied validator) and proves:
 *  - anonymous same-origin valid request → 401, ZERO body/source/facts reads;
 *  - cross-origin authenticated request → 403, ZERO body/source/facts reads;
 *  - a disallowed role (viewer/commenter) → 403 before any source call;
 *  - revoked / foreign / missing membership → fail closed;
 *  - body-scope smuggling (a project ≠ the authenticated one) → 403;
 *  - an authenticated permitted member → the TRUSTED scope (from the session,
 *    NOT the body) reaches the authority source exactly;
 *  - body actor/role/tenant claims cannot affect identity;
 *  - a loader failure remains a bounded truthful 503 ONLY after authorization;
 *  - the nonce + response-binding behaviour is intact for a member.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../route";
import {
  injectAuthorizedPrincipal, injectIdentity, injectMembership, resetInjectedIdentity,
} from "@/app/lib/auth/test-support";
import {
  resetComponentAuthoritySourceFactory, setComponentAuthoritySourceFactory,
} from "@/app/api/chat/component-authority-runtime";
import {
  resetReplacementPinFactsSourceFactory, setReplacementPinFactsSourceFactory,
} from "@/app/api/chat/replacement-facts-runtime";
import { validApprovedAggregate, matchingAtomicConfirmer, FIXTURE_EXACT, FIXTURE_AUTHORITY_VARIANT } from "@/app/lib/engineering/__tests__/_authority-fixtures";
import { pcbBoardInstanceId, PCB_BOARD_HIERARCHY_PATH } from "@/app/lib/pcb/board-identity";
import type { PublishedSymbolPinFacts } from "@/app/lib/engineering/replacement-pin-facts";
import type { KicadPin } from "@/app/lib/kicad/types";

const PROJECT = "proj-reauth";
const NONCE = "abcdef0123456789abcdef0123456789";
const SELECTOR = { "x-sirkit-tenant-id": "local", "x-sirkit-project-id": PROJECT, "x-sirkit-branch-id": "main" };
const RA_COMPONENT = "u1-id";
function raPin(number: string, name: string, xMm: number): KicadPin { return { number, name, type: "passive", position: { x: xMm, y: 0 }, orientation: 0, length: 2.54 }; }
const RA_PINS: readonly KicadPin[] = [raPin("1", "A", -2.5), raPin("2", "B", 2.5)];
function raPinFacts(rev: string, symbol: string, certificateId: string): PublishedSymbolPinFacts {
  const ids = RA_PINS.map((e) => `pin-${e.number}`);
  return { atomicPartRevisionId: rev, symbolAssetVersionId: symbol, pins: [...RA_PINS], certificate: { id: certificateId, symbolVersionId: symbol, footprintVersionId: FIXTURE_EXACT.footprintAssetVersionId, symbolPinIds: ids, missingTerminalIds: [], missingSymbolPinIds: [], missingPadNumbers: [], ambiguous: [], state: "approved" }, symbolPinIds: ids };
}
const RA_CURRENT_FACTS = raPinFacts("rev-current", "sym-current", "cert-current");
const RA_TARGET_FACTS = raPinFacts(FIXTURE_EXACT.atomicPartRevisionId, FIXTURE_EXACT.symbolAssetVersionId, FIXTURE_EXACT.mappingCertificateId);

let sourceScopes: unknown[] = [];
let factsResolutions = 0;
let bodyPulls = 0;

beforeEach(() => {
  sourceScopes = [];
  factsResolutions = 0;
  bodyPulls = 0;
  setComponentAuthoritySourceFactory((scope) => { sourceScopes.push(scope); return null; });
  setReplacementPinFactsSourceFactory(() => { factsResolutions += 1; return null; });
});
afterEach(() => {
  resetComponentAuthoritySourceFactory();
  resetReplacementPinFactsSourceFactory();
  resetInjectedIdentity();
  vi.unstubAllEnvs();
});

function validBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ scope: { tenantId: "local", projectId: PROJECT, branchId: "main" }, componentInstanceId: "comp-1", currentAtomicPartRevisionId: null, nonce: NONCE, ...overrides });
}
function jsonReq(bodyStr: string, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/replacement-authority", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SELECTOR, ...headers }, body: bodyStr,
  });
}
/** A body stream whose pulls are counted — proves ZERO body reads on refusal. */
function countingStreamReq(headers: Record<string, string> = {}): Request {
  const stream = new ReadableStream<Uint8Array>({ pull(c) { bodyPulls += 1; c.enqueue(new TextEncoder().encode(validBody())); c.close(); } }, { highWaterMark: 0 });
  return new Request("http://localhost/api/replacement-authority", {
    method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...SELECTOR, ...headers }, body: stream, duplex: "half",
  } as RequestInit);
}
async function code(res: Response): Promise<unknown> { return res.json(); }

describe("B16.0.3 §E — authentication precedes all body & durable work", () => {
  it("anonymous same-origin valid request → 401, ZERO body/source/facts reads", async () => {
    injectIdentity(null);
    const res = await POST(countingStreamReq());
    expect(res.status).toBe(401);
    expect(bodyPulls).toBe(0);
    expect(sourceScopes.length).toBe(0);
    expect(factsResolutions).toBe(0);
  });

  it("cross-origin authenticated request → 403 (production CSRF), ZERO body/source/facts reads", async () => {
    vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: PROJECT, role: "editor" });
    const res = await POST(countingStreamReq({ origin: "http://evil.example" }));
    expect(res.status).toBe(403);
    expect(bodyPulls).toBe(0);
    expect(sourceScopes.length).toBe(0);
  });

  it("a disallowed role (viewer) → 403 before any source call", async () => {
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "local", projectId: PROJECT, role: "viewer" });
    const res = await POST(jsonReq(validBody()));
    expect(res.status).toBe(403);
    expect(sourceScopes.length).toBe(0);
    injectAuthorizedPrincipal({ userId: "commenter-1", tenantId: "local", projectId: PROJECT, role: "commenter" });
    expect((await POST(jsonReq(validBody()))).status).toBe(403);
    expect(sourceScopes.length).toBe(0);
  });

  it("revoked membership → fail closed (403), zero source reads", async () => {
    injectIdentity({ userId: "editor-1" });
    injectMembership([{ tenantId: "local", projectId: PROJECT, userId: "editor-1", role: "editor", state: "revoked" }]);
    const res = await POST(jsonReq(validBody()));
    expect(res.status).toBe(403);
    expect(sourceScopes.length).toBe(0);
  });

  it("foreign project membership → fail closed (403): a member of another project cannot read this one", async () => {
    injectIdentity({ userId: "editor-2" });
    injectMembership([{ tenantId: "local", projectId: "some-other-project", userId: "editor-2", role: "editor" }]);
    const res = await POST(jsonReq(validBody())); // selector names PROJECT, membership is elsewhere
    expect(res.status).toBe(403);
    expect(sourceScopes.length).toBe(0);
  });

  it("body-scope smuggling (a project ≠ the authenticated one) → 403, zero source reads", async () => {
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: PROJECT, role: "editor" });
    const smuggled = validBody({ scope: { tenantId: "local", projectId: "victim-project", branchId: "main" } });
    const res = await POST(jsonReq(smuggled));
    expect(res.status).toBe(403);
    expect(await code(res)).toMatchObject({ ok: false });
    expect(sourceScopes.length).toBe(0);
  });

  it("body actor/role/tenant claims cannot affect identity (rejected as unexpected keys; source never reached)", async () => {
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: PROJECT, role: "editor" });
    for (const claim of [{ actor: "mallory" }, { role: "project_admin" }, { principalId: "root" }, { tenantId: "evil" }]) {
      const res = await POST(jsonReq(validBody(claim)));
      expect(res.status, JSON.stringify(claim)).toBe(400);
    }
    expect(sourceScopes.length).toBe(0);
  });
});

describe("B16.0.3 §E — an authenticated permitted member reaches the source with the TRUSTED scope", () => {
  it("the trusted scope (session-derived, NOT the body) reaches the authority source exactly", async () => {
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: PROJECT, role: "editor" });
    // body carries NO scope — proving the scope comes from the session/selector
    const res = await POST(jsonReq(JSON.stringify({ componentInstanceId: "comp-1", currentAtomicPartRevisionId: null, nonce: NONCE })));
    expect(res.status).toBe(503); // the instrumented factory withholds (returns null)
    expect(sourceScopes.length).toBe(1);
    expect(sourceScopes[0]).toEqual({ tenantId: "local", projectId: PROJECT, branchId: "main" });
  });

  it("a matching body scope is accepted and the SAME trusted scope reaches the source", async () => {
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: PROJECT, role: "editor" });
    const res = await POST(jsonReq(validBody()));
    expect(res.status).toBe(503);
    expect(sourceScopes[0]).toEqual({ tenantId: "local", projectId: PROJECT, branchId: "main" });
  });

  it("a loader failure remains a bounded truthful 503 ONLY after authorization (source WAS resolved)", async () => {
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: PROJECT, role: "editor" });
    const res = await POST(jsonReq(validBody()));
    expect(res.status).toBe(503);
    expect(await code(res)).toMatchObject({ ok: false });
    expect(sourceScopes.length).toBe(1); // authorization completed, THEN the source was resolved
  });

  it("nonce validation is intact for a member (absent/malformed nonce → 400)", async () => {
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: PROJECT, role: "editor" });
    for (const nonce of [undefined, "short", "bad nonce!"]) {
      const body = JSON.stringify({ scope: { tenantId: "local", projectId: PROJECT, branchId: "main" }, componentInstanceId: "comp-1", currentAtomicPartRevisionId: null, ...(nonce !== undefined ? { nonce } : {}) });
      const res = await POST(jsonReq(body));
      expect(res.status, String(nonce)).toBe(400);
    }
    expect(sourceScopes.length).toBe(0); // nonce refusal precedes source resolution
  });

  it("[B16.0.4 §D] a full member request returns EXACTLY 200 with the allowlisted result and the echoed nonce/component/trusted-scope binding", async () => {
    injectAuthorizedPrincipal({ userId: "editor-1", tenantId: "local", projectId: PROJECT, role: "editor" });
    // A GENUINELY valid durable authority aggregate under the route's exact
    // board scope, plus published pin facts — the real 200 path (mirrors the
    // B14 route coverage). No provider call, no credit.
    const aggregate = await validApprovedAggregate(RA_COMPONENT, { scopeOverrides: { tenantId: "local", projectId: PROJECT, branchId: "main", boardInstanceId: pcbBoardInstanceId(PROJECT), hierarchyPath: [...PCB_BOARD_HIERARCHY_PATH], assemblyVariantIds: [FIXTURE_AUTHORITY_VARIANT] } });
    setComponentAuthoritySourceFactory((scope) => {
      sourceScopes.push(scope);
      return { bindings: { loadForComponent: async () => [aggregate] }, atomic: matchingAtomicConfirmer() } as never;
    });
    setReplacementPinFactsSourceFactory(() => ({
      loadPinFacts: async (revision: string) => (revision === "rev-current" ? RA_CURRENT_FACTS : revision === FIXTURE_EXACT.atomicPartRevisionId ? RA_TARGET_FACTS : null),
    }) as never);
    const res = await POST(jsonReq(JSON.stringify({ scope: { tenantId: "local", projectId: PROJECT, branchId: "main" }, componentInstanceId: RA_COMPONENT, currentAtomicPartRevisionId: "rev-current", nonce: NONCE })));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; records: Array<{ componentId: string }>; targetPinFacts: { atomicPartRevisionId: string }; binding: { nonce: string; componentInstanceId: string; scope: unknown } };
    expect(body.ok).toBe(true);
    expect(body.records[0]!.componentId).toBe(RA_COMPONENT);
    expect(body.targetPinFacts.atomicPartRevisionId).toBe(FIXTURE_EXACT.atomicPartRevisionId);
    expect(body.binding.nonce).toBe(NONCE);
    expect(body.binding.componentInstanceId).toBe(RA_COMPONENT);
    expect(body.binding.scope).toEqual({ tenantId: "local", projectId: PROJECT, branchId: "main" });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
