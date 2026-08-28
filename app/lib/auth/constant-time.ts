/**
 * B16.0 — constant-time string comparison for secret material, matching the
 * existing `app/lib/atomic/server-auth.ts` precedent (`node:crypto`
 * `timingSafeEqual`). Length differences are folded into the decision without
 * a length-revealing early return; secrets are never logged or placed in
 * errors.
 */

import { timingSafeEqual } from "node:crypto";

export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.byteLength !== bb.byteLength) {
    // Keep a comparable timing shape (compare the presented value with
    // itself) and return false — never an early length-only branch that
    // skips the compare entirely.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}
