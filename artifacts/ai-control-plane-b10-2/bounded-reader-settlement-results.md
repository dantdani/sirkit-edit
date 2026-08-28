# B10.2 §C — bounded-reader settlement

## Defect (R5)

`readBoundedBody` awaited `reader.cancel()` after crossing the byte
ceiling. A hostile stream whose `cancel()` returns a never-settling
promise blocked the 413 indefinitely (pre-edit evidence: the request was
still pending 500 ms after reading had stopped at 9 pulls).

## Change (`app/api/chat/route.ts`)

When the limit is crossed:

```ts
try {
  void reader.cancel("request body exceeds the bounded limit").catch(() => undefined);
} catch { /* a synchronously throwing cancel() is equally ignored */ }
return { ok: false, status: 413, error: … };
```

- consumption stops immediately (no further `read()` calls);
- cancellation is initiated as BEST-EFFORT cleanup, never awaited;
- an async cancel rejection is pre-swallowed (`.catch`), a synchronous
  cancel throw is caught — neither can become an unhandled rejection;
- 413 returns deterministically, independent of cancel behavior;
- decode (fatal UTF-8) and parse still run only after a SUCCESSFUL bounded
  read (unchanged from B10.1).

## Adversarial results (`b10-2-closure.test.ts` §C — all pass)

| Hostile `cancel()` | Result |
| --- | --- |
| Never settles (the R5 counterexample) | `POST` settles once with **413**; pulls ≤ 10 (reading stopped at the ceiling) |
| Rejects asynchronously | **413**; `process` `unhandledRejection` listener captures **zero** rejections |
| Throws synchronously | **413**; zero unhandled rejections |

The B10.1 consumed-byte regression (9-of-12 pulls) remains green.
