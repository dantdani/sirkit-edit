/**
 * B10.1/B10.2 (extracted in B14.2 §B; lifecycle-bounded in B14.3 §A) — the
 * ONE streaming bounded reader.
 *
 * Consumption stops IMMEDIATELY once the byte ceiling is crossed — a hostile
 * oversized or never-ending stream is never fully buffered. [B10.2]
 * cancellation is BEST-EFFORT cleanup only and is never awaited: a stream
 * whose `cancel()` throws synchronously, rejects, or never settles cannot
 * delay the bounded refusal or produce an unhandled rejection. Byte counts
 * are REAL wire bytes (`Uint8Array.byteLength`), never JavaScript character
 * counts. Extracted verbatim from the chat route's `readBoundedBody` so the
 * request AND response boundaries share one proven implementation.
 *
 * [B14.3 §A] OPTIONAL LIFECYCLE BOUNDS. Without `lifecycle`, behavior is the
 * exact B10 default (byte ceiling only — a stream that never yields is the
 * CALLER's liveness problem). A caller that opts in gets the B09.2/B13.2
 * hard-race discipline around the read itself:
 *  - `signal`: an external AbortSignal terminates the read (`"aborted"`);
 *    a PRE-aborted signal settles without ever calling `getReader()`.
 *  - `deadlineMs`: a hard deadline on TOTAL stream consumption
 *    (`"timeout"`) — a stream that never emits its first chunk, or trickles
 *    forever, settles at the bound.
 *  - EXACTLY ONE terminal settlement; whichever of {abort, deadline,
 *    over-limit, completion, read failure} wins is final.
 *  - On abort/timeout/over-limit the active reader receives BEST-EFFORT,
 *    NON-AWAITED cancellation — cancellation is cleanup, never load-bearing;
 *    a cancel() that throws, rejects, or never settles cannot delay the
 *    result.
 *  - Late read resolutions are DISCARDED by the latch; late read rejections
 *    are OBSERVED (the read loop's catch), never unhandled.
 *  - The deadline timer and the abort listener are removed on EVERY terminal
 *    path.
 */

export type BoundedStreamResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "over-limit" | "unreadable" | "aborted" | "timeout" };

export interface BoundedStreamLifecycle {
  signal?: AbortSignal;
  deadlineMs?: number;
}

export async function readBoundedStream(
  body: ReadableStream<Uint8Array> | null | undefined,
  limit: number,
  lifecycle?: BoundedStreamLifecycle,
): Promise<BoundedStreamResult> {
  if (!body) return { ok: true, bytes: new Uint8Array(0) };
  const external = lifecycle?.signal;
  const deadlineMs = lifecycle?.deadlineMs;
  // [B14.3 §A] a pre-aborted read never touches the stream (no getReader()).
  if (external?.aborted) return { ok: false, reason: "aborted" };
  if (!external && deadlineMs === undefined) {
    // The unchanged B10 default path.
    return readToLimit(body.getReader(), limit);
  }
  const reader = body.getReader();
  return new Promise<BoundedStreamResult>((resolve) => {
    let settled = false;
    function bestEffortCancel(reasonText: string): void {
      // [B10.2] best-effort cleanup only — never awaited.
      try {
        void reader.cancel(reasonText).catch(() => undefined);
      } catch {
        // a synchronously throwing cancel() is equally ignored
      }
    }
    function settle(result: BoundedStreamResult): void {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
      resolve(result);
    }
    function onAbort(): void {
      bestEffortCancel("bounded stream aborted");
      settle({ ok: false, reason: "aborted" });
    }
    const timer = deadlineMs !== undefined
      ? setTimeout(() => {
          bestEffortCancel("bounded stream deadline exceeded");
          settle({ ok: false, reason: "timeout" });
        }, deadlineMs)
      : undefined;
    external?.addEventListener("abort", onAbort, { once: true });
    void (async () => {
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (settled) return; // late resolution: discarded by the latch
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > limit) {
            bestEffortCancel("bounded stream limit exceeded");
            settle({ ok: false, reason: "over-limit" });
            return;
          }
          chunks.push(value);
        }
        settle({ ok: true, bytes: concatChunks(chunks, total) });
      } catch {
        // A live read failure is terminal; a LATE rejection (after
        // abort/timeout cancellation) is observed here, never unhandled.
        settle({ ok: false, reason: "unreadable" });
      }
    })();
  });
}

/** The exact pre-B14.3 read loop — the B10 default, byte ceiling only. */
async function readToLimit(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit: number,
): Promise<BoundedStreamResult> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        // [B10.2] best-effort cleanup only — never awaited.
        try {
          void reader.cancel("bounded stream limit exceeded").catch(() => undefined);
        } catch {
          // a synchronously throwing cancel() is equally ignored
        }
        return { ok: false, reason: "over-limit" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  return { ok: true, bytes: concatChunks(chunks, total) };
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
