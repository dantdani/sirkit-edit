// @vitest-environment jsdom
/**
 * B16.0.2 §H — truthful mode/UI diagnostics.
 *
 * The local-development banner derives from the SAME server auth-mode
 * authority as the request resolver (`resolveAuthMode`), passed down by the
 * server layout; `NEXT_PUBLIC_SIRKIT_AUTH_MODE` alone can never contradict
 * `NODE_ENV=production`. An unconfigured PRODUCTION sign-out never reports
 * `mode: local_dev`.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LOCAL_DEV_BANNER_TEXT, LocalDevIdentityBanner, localDevBannerVisible } from "@/app/components/auth/LocalDevIdentityBanner";
import { resolveAuthMode } from "../mode";
import { POST as signoutPost } from "@/app/api/auth/signout/route";

afterEach(() => { cleanup(); });

describe("B16.0.2 §H — the banner follows the SERVER auth mode", () => {
  it("production runtime with the public variable UNSET / CONTRADICTORY / MISSING still resolves production → banner hidden", () => {
    for (const env of [
      { NODE_ENV: "production" },
      { NODE_ENV: "production", NEXT_PUBLIC_SIRKIT_AUTH_MODE: "local_dev" },
      { NODE_ENV: "production", NEXT_PUBLIC_SIRKIT_AUTH_MODE: "" },
      { NODE_ENV: "production", SIRKIT_AUTH_MODE: "local_dev", NEXT_PUBLIC_SIRKIT_AUTH_MODE: "local_dev" },
    ]) {
      const mode = resolveAuthMode(env);
      expect(mode, JSON.stringify(env)).toBe("production");
      expect(localDevBannerVisible(mode), JSON.stringify(env)).toBe(false);
    }
  });

  it("non-production runtime resolves local_dev (even when the public variable claims production) → banner shown", () => {
    for (const env of [{}, { NEXT_PUBLIC_SIRKIT_AUTH_MODE: "production" }, { SIRKIT_AUTH_MODE: "local_dev", NEXT_PUBLIC_SIRKIT_AUTH_MODE: "production" }]) {
      const mode = resolveAuthMode(env);
      expect(mode, JSON.stringify(env)).toBe("local_dev");
      expect(localDevBannerVisible(mode)).toBe(true);
    }
    // the only non-production way to be "production" is the SERVER variable
    expect(localDevBannerVisible(resolveAuthMode({ SIRKIT_AUTH_MODE: "production" }))).toBe(false);
  });

  it("renders from the passed server mode only; an unknown value is shown as local development (never silently hidden)", () => {
    render(<LocalDevIdentityBanner authMode="local_dev" />);
    expect(screen.getByTestId("local-dev-identity-banner").textContent).toBe(LOCAL_DEV_BANNER_TEXT);
    cleanup();
    const { container } = render(<LocalDevIdentityBanner authMode="production" />);
    expect(container.querySelector('[data-testid="local-dev-identity-banner"]')).toBeNull();
    cleanup();
    render(<LocalDevIdentityBanner authMode={undefined} />);
    expect(screen.getByTestId("local-dev-identity-banner")).toBeDefined();
  });

  it("SOURCE: the banner no longer reads NEXT_PUBLIC_SIRKIT_AUTH_MODE; the server layout passes resolveAuthMode(process.env)", () => {
    const banner = readFileSync(join(process.cwd(), "app", "components", "auth", "LocalDevIdentityBanner.tsx"), "utf8");
    expect(banner.includes("process.env.NEXT_PUBLIC_SIRKIT_AUTH_MODE")).toBe(false);
    const layout = readFileSync(join(process.cwd(), "app", "layout.tsx"), "utf8");
    expect(layout).toContain("<LocalDevIdentityBanner authMode={resolveAuthMode(process.env)}"); // [B16-C §5] the fixture-runtime flag is passed beside it
    expect(layout).toContain('import { resolveAuthMode } from "./lib/auth/mode";');
  });
});

describe("B16.0.2 §H — sign-out reports the server mode truthfully", () => {
  // [B16.0.24 §D / B16.0.24.1 §2] the route now derives its runtime through
  // the canonical `publicRoute({ exposeAuthRuntime })` wrapper — a frozen
  // least-privilege projection (mode + Supabase URL + key) resolved per
  // request from process.env, NOT a raw second Next handler argument and NOT
  // the full environment. Tests inject declaratively via vi.stubEnv.
  afterEach(() => { vi.unstubAllEnvs(); });
  const post = async (env: Record<string, string | undefined>, request?: Request) => {
    vi.unstubAllEnvs();
    for (const k of ["NODE_ENV", "SIRKIT_AUTH_MODE", "NEXT_PUBLIC_SIRKIT_AUTH_MODE", "SIRKIT_EXPECTED_ORIGIN", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) vi.stubEnv(k, "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v ?? "");
    return signoutPost(request ?? new Request("http://localhost/api/auth/signout", { method: "POST", headers: { origin: "http://localhost" } }));
  };

  it("production, UNCONFIGURED → 503 AUTH_SIGNOUT_UNAVAILABLE with mode: production (never local_dev), for unset/contradictory public variables", async () => {
    for (const env of [
      { NODE_ENV: "production", SIRKIT_EXPECTED_ORIGIN: "http://localhost" },
      { NODE_ENV: "production", NEXT_PUBLIC_SIRKIT_AUTH_MODE: "local_dev", SIRKIT_EXPECTED_ORIGIN: "http://localhost" },
      { SIRKIT_AUTH_MODE: "production", SIRKIT_EXPECTED_ORIGIN: "http://localhost" },
    ]) {
      const response = await post(env);
      expect(response.status, JSON.stringify(env)).toBe(503);
      const body = (await response.json()) as { ok: boolean; code: string; mode: string };
      expect(body).toMatchObject({ ok: false, code: "AUTH_SIGNOUT_UNAVAILABLE", mode: "production" });
    }
  });

  it("local development → 200 mode: local_dev (nothing to sign out of)", async () => {
    const response = await post({});
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, signedOut: false, mode: "local_dev" });
  });

  it("production sign-out still enforces exact-origin CSRF (unconfigured origin → 403, spoof → 403)", async () => {
    const unconfigured = await post({ NODE_ENV: "production" });
    expect(unconfigured.status).toBe(403);
    const spoof = await post({ NODE_ENV: "production", SIRKIT_EXPECTED_ORIGIN: "https://sirkit.example" }, new Request("https://sirkit.example/api/auth/signout", { method: "POST", headers: { origin: "https://evil.example", "x-forwarded-host": "evil.example" } }));
    expect(spoof.status).toBe(403);
  });
});
