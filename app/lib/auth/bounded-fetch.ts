/**
 * B16.1B §E — a per-request, deadline-bounded, abort-safe `fetch` for the
 * authentication provider SDK.
 *
 * Reproduced defect (B16.1B pre-edit counterexample, real Next.js HTTP): an
 * expired-session cookie held a protected request for ~51 s while the SDK
 * retried an unreachable refresh endpoint with exponential backoff inside its
 * 30-second window — once in the proxy and once in the route. Nothing bounded
 * the provider calls. This module gives every provider client ONE
 * per-request budget:
 *
 *  - every SDK network call carries the bound `AbortSignal`, so an in-flight
 *    call is cancelled at the deadline or when the caller's request aborts;
 *  - after the deadline the shim answers the SDK with a NON-RETRYABLE
 *    sentinel response (HTTP 400 with an error body; the installed auth-js
 *    retries only transport failures and 500–504 / 520–530) so the SDK's own
 *    retry loop stops immediately instead of sleeping through its backoff
 *    schedule after the caller has already been refused;
 *  - the sentinel carries no secret and never reaches a browser: it is
 *    consumed by the SDK, which surfaces a bounded error that the identity
 *    boundary maps to the uniform 401.
 *
 * Provider-neutral: it knows nothing about Supabase; it bounds a `fetch`.
 */

export const SESSION_VERIFICATION_DEADLINE_MS = 5_000;

/** The sentinel error code the SDK sees after the deadline (never a browser-facing value). */
export const VERIFICATION_DEADLINE_SENTINEL_CODE = "sirkit_verification_deadline";

export interface BoundedFetch {
  /** The bounded fetch to hand to the provider SDK. */
  readonly fetch: typeof fetch;
  /** The bound signal — aborted at the deadline or when the parent aborts. */
  readonly signal: AbortSignal;
  /** Abort early (e.g. the liveness boundary settled by timeout). */
  abort(reason?: unknown): void;
  /** Release the deadline timer and parent listener. Idempotent. */
  dispose(): void;
}

export interface BoundedFetchOptions {
  /** Hard budget for ALL calls made through this fetch. */
  deadlineMs: number;
  /** The caller's request signal — a disconnect cancels provider work. */
  parent?: AbortSignal;
  /** Injectable base fetch (tests). Defaults to the global fetch. */
  baseFetch?: typeof fetch;
}

function deadlineSentinelResponse(): Response {
  return new Response(
    JSON.stringify({ code: 400, error_code: VERIFICATION_DEADLINE_SENTINEL_CODE, msg: "The authentication verification deadline was exceeded." }),
    { status: 400, headers: { "content-type": "application/json" } },
  );
}

export function createBoundedFetch(options: BoundedFetchOptions): BoundedFetch {
  const controller = new AbortController();
  const base: typeof fetch = options.baseFetch ?? ((input, init) => globalThis.fetch(input, init));
  const deadlineMs = Number.isFinite(options.deadlineMs) && options.deadlineMs > 0 ? options.deadlineMs : 1;
  let disposed = false;

  const onParentAbort = (): void => { controller.abort(new Error("request aborted")); };
  const timer = setTimeout(() => { controller.abort(new Error("verification deadline exceeded")); }, deadlineMs);
  // Never keep a process alive for a deadline nobody is waiting on.
  (timer as unknown as { unref?: () => void }).unref?.();

  if (options.parent) {
    if (options.parent.aborted) onParentAbort();
    else options.parent.addEventListener("abort", onParentAbort, { once: true });
  }

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    options.parent?.removeEventListener("abort", onParentAbort);
  };

  const bounded: typeof fetch = async (input, init) => {
    if (controller.signal.aborted) return deadlineSentinelResponse();
    try {
      return await base(input, { ...(init ?? {}), signal: controller.signal });
    } catch (error) {
      // An abort we caused settles as the non-retryable sentinel; any other
      // transport failure propagates unchanged (the SDK classifies it).
      if (controller.signal.aborted) return deadlineSentinelResponse();
      throw error;
    }
  };

  return {
    fetch: bounded,
    signal: controller.signal,
    abort: (reason?: unknown) => { controller.abort(reason ?? new Error("aborted")); },
    dispose,
  };
}
