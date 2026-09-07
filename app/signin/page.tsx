"use client";

/**
 * B16.0.1 §H — the minimal production sign-in page (existing accounts only).
 *
 * Posts credentials to the same-origin /api/auth/signin boundary (the browser
 * supplies the Origin header the CSRF check requires). No sign-up link exists —
 * accounts are provisioned out of band. On success the session lives in
 * httpOnly cookies written by the server; nothing is stored client-side.
 */

import { useState, type FormEvent } from "react";

export default function SignInPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("error") === "auth"
      ? "Sign-in could not be completed. Try again."
      : null,
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/signin", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.ok) {
        window.location.assign("/");
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : null;
      setMessage(
        code === "AUTH_SIGNIN_UNAVAILABLE"
          ? "Sign-in is not available in this deployment."
          : "Sign-in failed. Check your email and password.",
      );
    } catch {
      setMessage("Sign-in could not be completed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 360, margin: "10vh auto", padding: "0 16px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 20, marginBottom: 4 }}>Sign in to Sirkit</h1>
      <p style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
        Use your provisioned account. There is no self-service sign-up.
      </p>
      <form onSubmit={submit}>
        <label style={{ display: "block", fontSize: 13, marginBottom: 8 }}>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4, padding: 8, boxSizing: "border-box" }}
          />
        </label>
        <label style={{ display: "block", fontSize: 13, marginBottom: 12 }}>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            style={{ display: "block", width: "100%", marginTop: 4, padding: 8, boxSizing: "border-box" }}
          />
        </label>
        <button type="submit" disabled={busy} style={{ width: "100%", padding: 10 }}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      {message ? (
        <p role="alert" style={{ fontSize: 13, color: "#b00020", marginTop: 12 }}>{message}</p>
      ) : null}
    </main>
  );
}
