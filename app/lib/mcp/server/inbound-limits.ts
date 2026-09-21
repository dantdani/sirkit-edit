/**
 * [B20 B2] The inbound limits of Sirkit's MCP surface (D-9): per-process fixed windows, stated like OD-53 (a per-process
 * meter is a stated limit; several instances each allow the limit), keyed only on ids the caller's credential already
 * proved:
 *
 *  - the token route: 10 mints per 60 s per (tenant, project, principal);
 *  - the endpoint: 120 requests per 60 s per (tenant, project, token subject).
 *
 * A refused request does not consume. The key map is bounded: expired windows are swept first, and when it is still full a
 * NEW key is refused (fail closed). `Retry-After` is whole seconds in [1, 60]. An invalid clock, an invalid key or invalid
 * constants refuse. Nothing here throws.
 */
import { ID_PATTERN } from "../../auth/trusted-request-context";

export interface FixedWindowLimit {
  /** requests admitted per window */
  readonly limit: number;
  readonly windowMs: number;
  /** keys held at most (expired ones are swept first) */
  readonly maxKeys: number;
}

export const MCP_LIMITER_MAX_KEYS = 10_000;
export const MCP_TOKEN_ROUTE_LIMIT: FixedWindowLimit = Object.freeze({ limit: 10, windowMs: 60_000, maxKeys: MCP_LIMITER_MAX_KEYS });
export const MCP_ENDPOINT_LIMIT: FixedWindowLimit = Object.freeze({ limit: 120, windowMs: 60_000, maxKeys: MCP_LIMITER_MAX_KEYS });

const RETRY_AFTER_MIN_S = 1;
const RETRY_AFTER_MAX_S = 60;
const LIMIT_BOUNDS = Object.freeze({ limit: [1, 100_000], windowMs: [1_000, 3_600_000], maxKeys: [1, 1_000_000] } as const);
/** tenant, project, principal */
const KEY_PARTS = 3;

export type LimitRefusal = "limited" | "full" | "clock_invalid" | "key_invalid" | "misconfigured";
export type LimitDecision = { readonly ok: true } | { readonly ok: false; readonly reason: LimitRefusal; readonly retryAfterS: number };

/** S3: every constant a safe integer inside its bound (NaN, Infinity, negative, zero, fractional and huge values refused). */
export function validateFixedWindowLimit(value: unknown): string[] {
  const errors: string[] = [];
  if (typeof value !== "object" || value === null) return ["the limit is not an object"];
  for (const [name, [min, max]] of Object.entries(LIMIT_BOUNDS)) {
    let field: unknown;
    try {
      field = (value as Record<string, unknown>)[name];
    } catch {
      field = undefined;
    }
    if (typeof field !== "number" || !Number.isSafeInteger(field) || field < min || field > max) errors.push(`${name} must be a safe integer in [${min}, ${max}]`);
  }
  return errors;
}

export interface FixedWindowLimiter {
  /** Admit one request for `parts` (tenant, project, principal) at `nowMs`; a refusal consumes nothing. */
  take(parts: readonly string[], nowMs: number): LimitDecision;
  size(): number;
  reset(): void;
}

const ADMITTED: LimitDecision = Object.freeze({ ok: true });
const refusal = (reason: LimitRefusal, retryAfterS: number): LimitDecision => Object.freeze({ ok: false, reason, retryAfterS });
const clampRetry = (ms: number): number => Math.min(RETRY_AFTER_MAX_S, Math.max(RETRY_AFTER_MIN_S, Math.ceil(ms / 1000)));

function keyOf(parts: unknown): string | null {
  if (!Array.isArray(parts) || parts.length !== KEY_PARTS) return null;
  const copy: string[] = [];
  for (let index = 0; index < KEY_PARTS; index += 1) {
    const part: unknown = parts[index];
    if (typeof part !== "string" || !ID_PATTERN.test(part)) return null;
    copy.push(part);
  }
  return JSON.stringify(copy);
}

export function createFixedWindowLimiter(limit: FixedWindowLimit): FixedWindowLimiter {
  const valid = validateFixedWindowLimit(limit).length === 0;
  const { limit: perWindow, windowMs, maxKeys } = valid ? limit : { limit: 0, windowMs: 60_000, maxKeys: 0 };
  const windows = new Map<string, { windowStart: number; count: number }>();
  const sweep = (nowMs: number): void => {
    for (const [key, entry] of windows) if (nowMs >= entry.windowStart + windowMs) windows.delete(key);
  };
  return {
    take(parts, nowMs) {
      try {
        if (!valid) return refusal("misconfigured", RETRY_AFTER_MAX_S);
        if (typeof nowMs !== "number" || !Number.isSafeInteger(nowMs) || nowMs < 0) return refusal("clock_invalid", RETRY_AFTER_MAX_S);
        const key = keyOf(parts);
        if (key === null) return refusal("key_invalid", RETRY_AFTER_MAX_S);
        const entry = windows.get(key);
        if (entry !== undefined && nowMs < entry.windowStart + windowMs) {
          if (entry.count >= perWindow) return refusal("limited", clampRetry(entry.windowStart + windowMs - nowMs));
          entry.count += 1;
          return ADMITTED;
        }
        if (entry !== undefined) windows.delete(key);
        if (windows.size >= maxKeys) {
          sweep(nowMs);
          if (windows.size >= maxKeys) {
            let earliest = Number.POSITIVE_INFINITY;
            for (const held of windows.values()) earliest = Math.min(earliest, held.windowStart + windowMs);
            return refusal("full", clampRetry(earliest - nowMs));
          }
        }
        windows.set(key, { windowStart: nowMs, count: 1 });
        return ADMITTED;
      } catch {
        return refusal("key_invalid", RETRY_AFTER_MAX_S);
      }
    },
    size: () => windows.size,
    reset: () => windows.clear(),
  };
}

/** The two process-wide limiters. */
export const mcpTokenRouteLimiter: FixedWindowLimiter = createFixedWindowLimiter(MCP_TOKEN_ROUTE_LIMIT);
export const mcpEndpointLimiter: FixedWindowLimiter = createFixedWindowLimiter(MCP_ENDPOINT_LIMIT);

/** Test seam: empty both windows. */
export function resetMcpInboundLimitsForTests(): void {
  mcpTokenRouteLimiter.reset();
  mcpEndpointLimiter.reset();
}
