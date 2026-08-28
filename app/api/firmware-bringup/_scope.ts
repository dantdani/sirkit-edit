/**
 * B16.0.1 §A — firmware-bringup request scope, SERVER-DERIVED through the shared
 * authorization adapter (no `x-sirkit-*` identity headers).
 */
import type { TrustedRequestContext } from "@/app/lib/auth/types";
import { scopedTrustedJson, flatScopeOf } from "@/app/lib/auth/authorize";

/** [B16.0.21] the family's historical body contract, now named for canonical
 *  adopters: 64 MB ceiling; the deadline is the bounded reader's 30 s default
 *  (`scopedTrustedJson` passes no deadlineMs). */
export const FIRMWARE_BRINGUP_API_MAX_BYTES = 64_000_000;
export const FIRMWARE_BRINGUP_API_DEADLINE_MS = 30_000;

/** Request-free projection of the trusted context into the exact family scope
 *  shape — delegates to the shared `flatScopeOf`. */
export function firmwareBringupScopeFromContext(context: TrustedRequestContext): ReturnType<typeof flatScopeOf> {
  return flatScopeOf(context);
}

export function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

export async function scopedCd11Json(request: Request) {
  const scoped = await scopedTrustedJson(request, { maxBytes: FIRMWARE_BRINGUP_API_MAX_BYTES });
  if (!scoped.ok) return { ok: false as const, response: scoped.response };
  return { ok: true as const, body: scoped.body, scope: flatScopeOf(scoped.context) };
}
