/**
 * B16.0 — local-development banner visibility (item 20) and CSRF / open-
 * redirect request-security helpers (item 14 supporting).
 */

// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { LocalDevIdentityBanner, LOCAL_DEV_BANNER_TEXT, localDevBannerVisible } from "@/app/components/auth/LocalDevIdentityBanner";
import { requireSameOrigin, safeRedirectPath, requireJsonContentType } from "../request-security";

describe("B16.0 — the local-development banner", () => {
  it("20: renders the exact warning outside production and nothing in production", () => {
    expect(localDevBannerVisible(undefined)).toBe(true);
    expect(localDevBannerVisible("local_dev")).toBe(true);
    expect(localDevBannerVisible("production")).toBe(false);

    render(<LocalDevIdentityBanner authMode="local_dev" />);
    expect(screen.getByTestId("local-dev-identity-banner").textContent).toBe(LOCAL_DEV_BANNER_TEXT);
    cleanup();

    const { container } = render(<LocalDevIdentityBanner authMode="production" />);
    expect(container.querySelector('[data-testid="local-dev-identity-banner"]')).toBeNull();
  });
});

describe("B16.0 — request security helpers", () => {
  function post(headers: Record<string, string>): Request {
    return new Request("http://localhost/api/x", { method: "POST", headers });
  }

  it("same-origin: cross-origin POST is refused, same-origin passes, GET is exempt", () => {
    expect(requireSameOrigin(post({ origin: "https://evil.example", host: "localhost" }))).not.toBeNull();
    expect(requireSameOrigin(post({ origin: "http://localhost", host: "localhost" }))).toBeNull();
    expect(requireSameOrigin(new Request("http://localhost/api/x", { method: "GET" }))).toBeNull();
    // A missing Origin on a state-changing request is refused.
    expect(requireSameOrigin(post({ host: "localhost" }))).not.toBeNull();
  });

  it("open-redirect: only same-origin relative paths survive", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
    expect(safeRedirectPath("//evil.example/x")).toBe("/");
    expect(safeRedirectPath("https://evil.example")).toBe("/");
    expect(safeRedirectPath("/\\evil")).toBe("/");
    expect(safeRedirectPath("/ok?q=1")).toBe("/ok?q=1");
  });

  it("content-type: only application/json is accepted", () => {
    expect(requireJsonContentType(post({ "content-type": "application/json" }))).toBeNull();
    expect(requireJsonContentType(post({ "content-type": "text/plain" }))).not.toBeNull();
    expect(requireJsonContentType(post({}))).not.toBeNull();
  });
});
