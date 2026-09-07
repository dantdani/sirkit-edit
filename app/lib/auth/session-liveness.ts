/**
 * B16.1B §E — the ONE provider-neutral session-liveness boundary.
 *
 * Reproduced defect (B16.1B pre-edit counterexample R8, real SDK, ES256
 * key pair): a cryptographically VALID access token whose remote session had
 * been revoked was still accepted, because `getClaims()` with asymmetric
 * signing keys verifies the signature locally and never asks the Auth server
 * whether the session still exists. Official Supabase guidance says the same:
 * `getClaims()` proves the JWT is genuine and unexpired; it does not prove the
 * session is still live. Token validity ≠ session liveness.
 *
 * This module adds the minimum server-confirmed liveness check WITHOUT
 * spreading provider calls through routes: the identity provider runs EXACTLY
 * one liveness confirmation per request, after signed-claim validation, and
 * requires the server-confirmed user id to EXACTLY equal the verified
 * `claims.sub`. Every failure — revoked, mismatch, timeout, abort, SDK error,
 * provider unavailable — fails CLOSED and the resolver's uniform 401 applies.
 *
 * Settlement is bounded and abort-safe: a deadline or the caller's abort
 * settles the outcome ONCE; a late resolution or late rejection from the
 * verifier is ignored (never an unhandled rejection, never a second outcome).
 */

import { SESSION_VERIFICATION_DEADLINE_MS } from "./bounded-fetch";

export type SessionLivenessRefusal =
  /** The Auth server no longer knows the session (signed out / revoked / deleted). */
  | "revoked"
  /** The server-confirmed user is not the verified claims subject. */
  | "mismatch"
  /** The confirmation did not settle within the deadline. */
  | "timeout"
  /** The caller's request aborted before confirmation settled. */
  | "aborted"
  /** The verifier threw or returned an unusable shape. */
  | "error"
  /** No provider client could be built (configuration / SDK absent). */
  | "unavailable";

export type SessionLivenessOutcome =
  | { readonly live: true; readonly userId: string }
  | { readonly live: false; readonly reason: SessionLivenessRefusal };

/** A verifier server-confirms the session behind `request` and returns the
 *  confirmed user id. Implementations MUST NOT return authority (roles,
 *  membership) — only the identity the server currently vouches for. */
export interface SessionLivenessVerifier {
  confirm(request: Request, expectedUserId: string, signal: AbortSignal): Promise<SessionLivenessOutcome>;
}

export interface ConfirmSessionLivenessOptions {
  /** Hard deadline for the confirmation. Defaults to the shared verification budget. */
  deadlineMs?: number;
  /** The caller's request signal. */
  parent?: AbortSignal;
}

export { SESSION_VERIFICATION_DEADLINE_MS };

function sanitize(outcome: unknown): SessionLivenessOutcome {
  if (typeof outcome === "object" && outcome !== null) {
    const o = outcome as { live?: unknown; userId?: unknown; reason?: unknown };
    if (o.live === true && typeof o.userId === "string" && o.userId.length > 0) return { live: true, userId: o.userId };
    if (o.live === false && typeof o.reason === "string") return { live: false, reason: o.reason as SessionLivenessRefusal };
  }
  return { live: false, reason: "error" };
}

/**
 * Run EXACTLY one confirmation with settle-once semantics. Resolves — never
 * rejects — with a sanitized outcome. Timeout → "timeout"; parent abort →
 * "aborted"; verifier throw/reject → "error"; anything after settlement is
 * ignored.
 */
export function confirmSessionLiveness(
  verifier: SessionLivenessVerifier,
  request: Request,
  expectedUserId: string,
  options: ConfirmSessionLivenessOptions = {},
): Promise<SessionLivenessOutcome> {
  const deadlineMs = Number.isFinite(options.deadlineMs) && (options.deadlineMs as number) > 0 ? (options.deadlineMs as number) : SESSION_VERIFICATION_DEADLINE_MS;
  if (options.parent?.aborted) return Promise.resolve({ live: false, reason: "aborted" });

  return new Promise<SessionLivenessOutcome>((resolve) => {
    const controller = new AbortController();
    let settled = false;
    const timer = setTimeout(() => {
      controller.abort(new Error("session liveness deadline exceeded"));
      settle({ live: false, reason: "timeout" });
    }, deadlineMs);
    (timer as unknown as { unref?: () => void }).unref?.();
    const onParentAbort = (): void => {
      controller.abort(new Error("request aborted"));
      settle({ live: false, reason: "aborted" });
    };
    options.parent?.addEventListener("abort", onParentAbort, { once: true });

    function settle(outcome: SessionLivenessOutcome): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.parent?.removeEventListener("abort", onParentAbort);
      resolve(outcome);
    }

    let attempt: Promise<SessionLivenessOutcome>;
    try {
      attempt = Promise.resolve(verifier.confirm(request, expectedUserId, controller.signal));
    } catch {
      settle({ live: false, reason: "error" });
      return;
    }
    attempt.then(
      (outcome) => settle(sanitize(outcome)),
      () => settle({ live: false, reason: "error" }),
    );
  });
}
