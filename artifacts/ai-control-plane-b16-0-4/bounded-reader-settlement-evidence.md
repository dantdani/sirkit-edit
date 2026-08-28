# B16.0.4 §D — Behavioral proof of the bounded-body contract

Static gates prove the *shape* (a bounded reader is called, auth dominates).
§D proves the *behavior* by driving the **real exported handlers** and the one
shared reader — no provider credit spent, no database touched, every case
refuses at the bounded read (which precedes all provider/durable/process work).

## Files

- [`app/api/__tests__/b16-0-4-bounded-body-behavior.test.ts`](../../app/api/__tests__/b16-0-4-bounded-body-behavior.test.ts)
  — 52 tests: a per-family matrix over representative real handlers plus the
  shared-reader guarantees.
- [`app/api/replacement-authority/__tests__/b16-0-3-route-auth.test.ts`](../../app/api/replacement-authority/__tests__/b16-0-3-route-auth.test.ts)
  — the exact-200 fix (see [replacement-authority-exact-200.md](replacement-authority-exact-200.md)).

## Per-family matrix (real handlers)

One+ representative route from each of the nine migrated families
(architecture, interfaces, power, schematic, pcb-ai, spice-ai, spice-compile,
requirements, bom, public-misc, worker), each asserting:

| Behavior | Input | Expected |
|---|---|---|
| Malformed JSON refuses | `"{ not json"` | 400 `AUTH_INVALID_JSON` |
| Non-object refuses | `"[1,2,3]"` | 400 `AUTH_OBJECT_REQUIRED` |
| **Pre-aborted ⇒ zero work** | aborted `AbortController` signal | 400 `AUTH_BODY_ABORTED` (⇒ zero provider/durable/process, since the refusal precedes all of it) |
| Malformed UTF-8 refuses | stream of `0xFF 0xFE 0xFF` | 400 `AUTH_BODY_NOT_UTF8` |

Authenticated families inject an authorized editor + project selector so the
boundary *passes* and the bounded read is actually reached; the worker family
supplies its `timingSafeEqual` bearer secret; public families need neither.

## Ceiling, deadline, abort, latch (shared reader + real handler)

- **Oversized stops at the ceiling** — a 250 KB body to `parts/search`
  (200 KB ceiling) → 413 `AUTH_PAYLOAD_TOO_LARGE`, and the DB is never reached
  (a clean 413, not a 500 from an unconfigured `getDb()`).
- **Never-settling ⇒ deadline** — a stream that never enqueues, read at
  `deadlineMs: 40` → 408 `timeout` (fast; proves the mechanism the routes' 30 s
  deadline relies on, without a 30 s wait).
- **Slow trickle ⇒ deadline** — a stream that trickles one byte every 25 ms and
  never completes → 408 `timeout`.
- **Unbounded ⇒ ceiling, promptly** — a stream that enqueues forever at
  `maxBytes: 1000` → 413 `over-limit`, having pulled fewer than 5 chunks (it
  stopped at the ceiling rather than reading forever).
- **Pre-aborted ⇒ no read at all** — an aborted signal → 400 `aborted` with the
  counting stream pulled **0** times.
- **Late completion ⇒ no unhandled rejection** — a source that completes 90 ms
  after a 30 ms deadline: the reader had already settled `timeout`; the late
  enqueue produces no unhandled rejection and no second settlement (a
  `process.on("unhandledRejection")` probe asserts silence).

## Protected refusal precedes the body

For `schematic/build` and `interfaces/candidates`, an anonymous same-origin
request with a **counting** body stream → 401 with **0** body pulls: the
boundary refuses before a single byte is pulled. (The `replacement-authority`
route proves the same with its instrumented stream in the B16.0.3 suite.)

## Why "body refusal ⇒ zero provider/durable/process" holds

Every refusal above returns the bounded reader's public contract shape
(`{ ok:false, code: "AUTH_…" }`). That response is only reachable at the bounded
read, which is sequenced *before* any provider call, durable loader, or process
spawn in every migrated handler (proven structurally by §A dominance and
concretely by the clean refusal status — a provider or `getDb()` call on these
paths would surface as spend, a hang, or a 5xx, none of which occur).
