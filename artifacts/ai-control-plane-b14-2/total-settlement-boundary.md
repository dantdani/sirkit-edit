# B14.2 §A — the total-settlement reauthorization boundary

## The defect (R1)

`consumeReplacementReauthorization` awaited the channel transport with no
timeout and no AbortSignal — a never-settling fetch left it
`HUNG_AFTER_250MS` (and after 2 virtual minutes) while the project COMMIT
LEASE was held inside `runCanonicalCommand`, blocking the apply, the
serialized gateway, and project retirement/switch settlement. The 30-second
result TTL was checked only AFTER transport completion — a freshness bound,
never an execution deadline.

## The closure

`REAUTHORIZATION_TRANSPORT_DEADLINE_MS = 10_000` (documented) with the
B09.2/B13.2 hard-race discipline inside `consumeInternal`:

- an internal `AbortController` is threaded through the PRODUCTION fetch
  (`signal` on the request) AND the response-body read, so the deadline
  actually cancels platform work;
- ONE terminal settlement via the settle latch: deadline or external abort
  wins permanently; the timer is cleared and the external listener removed
  on every terminal path (`vi.getTimerCount() === 0` asserted);
- late resolutions are discarded; late rejections are observed by the
  handled arm — a `process.on("unhandledRejection")` trap stays empty;
- a PRE-ABORTED consumption never calls the transport (invocation count 0);
- ONE-SHOT is preserved across pre-abort, timeout, and refusal: the channel
  burns on any consumption attempt, so a fresh attempt requires a fresh
  channel from a fresh explicit activation;
- the result TTL remains a separate content-freshness bound, now documented
  as exactly that.

## Timeout consequences (service level, fake timers)

A hung channel under a real session/coordinator/interlock: the apply refuses
`authority-unavailable` at the deadline with ZERO journal entries (no
`journal.prepare`) and ZERO canonical transactions; afterwards the commit
lease acquires normally, an ordinary editor command executes through the
same serialized gateway, and `interlock.retire()` settles — a hostile
transport can no longer hold the lease or block project transitions.

---

> **SUPERSESSION NOTE (B14.3).** The total-settlement guarantee described
> above was accurate for the TRANSPORT race but incomplete one level down:
> the shared bounded reader itself had no signal/deadline path around
> `reader.read()`, so (a) the `/api/replacement-authority` endpoint could
> hang forever on a request stream that never emitted its first chunk
> (reproduced: `HUNG_REQUEST_AFTER_250MS`), and (b) a response stream that
> ignored the fetch abort kept an ORPHANED read attached after the deadline
> settled (reproduced: `{"result":null,"canceled":false}`). B14.3 closes
> both: optional lifecycle bounds on the ONE shared reader, the endpoint's
> documented 10 s request-read deadline (stalled ⇒ 408), and the channel's
> internal signal threaded into the response reader (abandoned reads receive
> best-effort, never-load-bearing cancellation). See
> `../ai-control-plane-b14-3/`.
