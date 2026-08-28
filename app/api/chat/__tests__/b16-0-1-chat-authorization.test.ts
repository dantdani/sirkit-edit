/**
 * B16.0.1 §B/§C — the chat surface's authorization boundary.
 *
 * Mandatory-test closure: a cross-origin (or origin-less) chat POST refuses
 * 403 BEFORE any provider call (production mode — CSRF inside the trusted
 * resolver is production-gated), and a viewer member is refused by the exact
 * chat route policy's role set BEFORE any provider budget is spent. No
 * provider adapter is mocked because the refusal must occur before the loop
 * would ever construct one — a run id header or NDJSON stream in the response
 * would prove the boundary leaked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { injectAuthorizedPrincipal, resetInjectedIdentity } from "@/app/lib/auth/test-support";
import { POST } from "../route";

const BODY = JSON.stringify({
  messages: [{ role: "user", content: "hello" }],
  scope: { tenantId: "tenant-1", projectId: "project-1", branchId: "main" },
});

function chatRequest(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: BODY,
  });
}

beforeEach(() => {
  injectAuthorizedPrincipal({ userId: "human-1", tenantId: "tenant-1", projectId: "project-1", role: "editor" });
});
afterEach(() => {
  resetInjectedIdentity();
  vi.unstubAllEnvs();
});

describe("B16.0.1 — chat CSRF before any provider call", () => {
  function stubProduction(): void {
    vi.stubEnv("SIRKIT_AUTH_MODE", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    // [B16.0.2 §C] production CSRF compares against the server-owned expected origin.
    vi.stubEnv("SIRKIT_EXPECTED_ORIGIN", "http://localhost");
  }

  it("a cross-origin chat POST refuses 403 with NO run started", async () => {
    stubProduction();
    const response = await POST(chatRequest({ origin: "http://evil.example" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("X-Sirkit-Run-Id")).toBeNull();
    expect(response.headers.get("Content-Type")).not.toContain("ndjson");
  });

  it("an origin-less chat POST refuses 403 with NO run started", async () => {
    stubProduction();
    const response = await POST(chatRequest({}));
    expect(response.status).toBe(403);
    expect(response.headers.get("X-Sirkit-Run-Id")).toBeNull();
  });
});

describe("B16.0.1 — chat role enforcement before provider budget", () => {
  it("a viewer member is refused 403 AUTH_ROLE_DENIED before any provider call", async () => {
    injectAuthorizedPrincipal({ userId: "viewer-1", tenantId: "tenant-1", projectId: "project-1", role: "viewer" });
    const response = await POST(chatRequest({ origin: "http://localhost" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "AUTH_ROLE_DENIED" });
    expect(response.headers.get("X-Sirkit-Run-Id")).toBeNull();
  });

  it("an editor member passes authorization (the stream starts — a real run id is issued)", async () => {
    const response = await POST(chatRequest({ origin: "http://localhost" }));
    // Authorization passed; the run begins (provider failures inside the
    // stream are irrelevant to this boundary test).
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Sirkit-Run-Id")).toMatch(/^run-/);
    await response.body?.cancel();
  });
});
