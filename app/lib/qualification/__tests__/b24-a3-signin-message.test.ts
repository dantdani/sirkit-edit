// @vitest-environment jsdom
/**
 * [B24-A3] What a person sees when sign-in is throttled (D24-8, OD-197; abuse-controls.md section 7). The sign-in route answers 429
 * `PUBLIC_RATE_LIMITED` once its window is used up (b24-a3-abuse-limits); the page (`app/signin/page.tsx`) gains one message branch
 * for that code, in place, and nothing else: no new control (app/signin is outside B17-A's control roots, control-surface.ts:66).
 *
 * Failing first on b3b6b05: a throttled sign-in shows "Sign-in failed. Check your email and password." - the credentials message - so
 * a person is told their password is wrong when it is not (page section 10). The environment is jsdom for this file only; `fetch` is a
 * stub answering the route's envelopes; nothing leaves the process.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import SignInPage from "@/app/signin/page";

const THROTTLED = "Too many sign-in attempts; try again in a minute.";
const CREDENTIALS = "Sign-in failed. Check your email and password.";

/** The route's refusal envelope (request-security.ts jsonError shape) with the given status and code. */
function answer(status: number, code: string): Response {
  return new Response(JSON.stringify({ ok: false, code, error: "refused" }), { status, headers: { "Content-Type": "application/json" } });
}

async function submitWith(response: Response): Promise<string> {
  const fetchStub = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => response);
  vi.stubGlobal("fetch", fetchStub);
  render(createElement(SignInPage));
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "person@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "not-a-real-password" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  const alert = await screen.findByRole("alert");
  expect(fetchStub).toHaveBeenCalledTimes(1);
  expect(fetchStub.mock.calls[0]?.[0]).toBe("/api/auth/signin");
  return alert.textContent ?? "";
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("[B24-A3] the sign-in page's throttled message", () => {
  it("1. counterexample (red on b3b6b05): a 429 PUBLIC_RATE_LIMITED shows the throttled message, never the credentials message", async () => {
    const text = await submitWith(answer(429, "PUBLIC_RATE_LIMITED"));
    expect(text).toBe(THROTTLED);
    expect(text).not.toBe(CREDENTIALS);
  });

  it("2. a 401 AUTH_SIGNIN_FAILED still shows the credentials message; a 503 AUTH_SIGNIN_UNAVAILABLE still shows its own; another 429 code is not the throttled one", async () => {
    expect(await submitWith(answer(401, "AUTH_SIGNIN_FAILED"))).toBe(CREDENTIALS);
    cleanup();
    expect(await submitWith(answer(503, "AUTH_SIGNIN_UNAVAILABLE"))).toBe("Sign-in is not available in this deployment.");
    cleanup();
    expect(await submitWith(answer(429, "MCP_RATE_LIMITED"))).toBe(CREDENTIALS);
  });
});
