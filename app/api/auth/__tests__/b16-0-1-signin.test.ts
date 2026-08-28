/**
 * B16.0.1 §H — production sign-in boundary (R8 closure).
 *
 * Covers everything provable WITHOUT a live Supabase project: same-origin
 * CSRF before the body is read, bounded validation, uniform fail-closed
 * behavior when auth is not configured, NO sign-up endpoint anywhere, the
 * PKCE callback's open-redirect prevention, and the exact route policy
 * (public + CSRF — sign-in can never require prior authentication).
 * Credential verification itself is Supabase's job and stays UNKNOWN here.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as signinPost } from "../signin/route";
import { GET as callbackGet } from "../callback/route";
import { policyFor } from "@/app/lib/auth/route-policy";
import { authorizeRequest } from "@/app/lib/auth/authorize";
import { safeRedirectPath } from "@/app/lib/auth/request-security";

const ENV_KEYS = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function signinRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/auth/signin", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("B16.0.1 §H — POST /api/auth/signin", () => {
  it("refuses a cross-origin or origin-less POST BEFORE reading the body (CSRF)", async () => {
    const crossOrigin = await signinPost(signinRequest({ email: "a@b.c", password: "x" }, { origin: "http://evil.example" }));
    expect(crossOrigin.status).toBe(403);
    const noOrigin = await signinPost(new Request("http://localhost/api/auth/signin", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
    expect(noOrigin.status).toBe(403);
  });

  it("validates media type, JSON, and bounded credentials", async () => {
    const wrongType = await signinPost(new Request("http://localhost/api/auth/signin", { method: "POST", headers: { origin: "http://localhost", "content-type": "text/plain" }, body: "{}" }));
    expect(wrongType.status).toBe(415);
    expect((await (await signinPost(signinRequest("not json"))).status)).toBe(400);
    expect((await signinPost(signinRequest({ email: "", password: "" }))).status).toBe(400);
    expect((await signinPost(signinRequest({ email: "a@b.c" }))).status).toBe(400);
    expect((await signinPost(signinRequest({ email: "a@b.c", password: "x".repeat(2000) }))).status).toBe(400);
    const oversized = await signinPost(signinRequest({ email: "a@b.c", password: "x", pad: "y".repeat(20_000) }));
    expect(oversized.status).toBe(413);
  });

  it("fails closed (503, no cookies touched) when Supabase auth is not configured", async () => {
    const response = await signinPost(signinRequest({ email: "a@b.c", password: "hunter2!" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "AUTH_SIGNIN_UNAVAILABLE" });
  });

  it("has NO sign-up endpoint anywhere under /api/auth (existing accounts only)", () => {
    const authDir = join(process.cwd(), "app", "api", "auth");
    for (const forbidden of ["signup", "sign-up", "register", "create-account"]) {
      expect(existsSync(join(authDir, forbidden)), `app/api/auth/${forbidden} must not exist`).toBe(false);
    }
  });

  it("route policy: sign-in is public (no prior auth) WITH same-origin CSRF, and the adapter enforces it", async () => {
    const policy = policyFor("/api/auth/signin", "POST");
    expect(policy).toMatchObject({ requiresAuth: false, requiresCsrf: true, providerCredit: false, authoritativeWrite: false, releaseOrQualification: false });
    // The shared adapter refuses a cross-origin POST even on this public route.
    const outcome = await authorizeRequest(new Request("http://localhost/api/auth/signin", { method: "POST", headers: { origin: "http://evil.example" } }));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.response.status).toBe(403);
  });
});

describe("B16.0.1 §H — GET /api/auth/callback", () => {
  it("redirects to the sign-in page (same-origin, 303) when unconfigured or code-less — never a token, never a foreign host", async () => {
    for (const url of [
      "http://localhost/api/auth/callback",
      "http://localhost/api/auth/callback?code=abc&next=https://evil.example/steal",
    ]) {
      const response = await callbackGet(new Request(url));
      expect(response.status).toBe(303);
      const location = response.headers.get("location")!;
      expect(new URL(location).host).toBe("localhost");
      expect(new URL(location).pathname).toBe("/signin");
    }
  });

  it("safeRedirectPath refuses absolute/protocol-relative/backslash targets (open-redirect prevention)", () => {
    expect(safeRedirectPath("https://evil.example/x")).toBe("/");
    expect(safeRedirectPath("//evil.example/x")).toBe("/");
    expect(safeRedirectPath("/\\evil.example")).toBe("/");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/");
    expect(safeRedirectPath("/projects/1")).toBe("/projects/1");
  });
});
