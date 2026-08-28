# B12.2 — concurrency regression matrix

20 new permanent tests across three files; the B12/B12.1 suites (59) kept
green under the corrected contracts with two deliberate strengthenings
(noted below). All passing.

## `b12-2-transition-serialization.test.ts` (7)

| Test | Locks |
| --- | --- |
| 1: lease held; request B then C → neither hydrates early; after release only C hydrates, exactly once | **R1** — the exact counterexample fails closed; latest-wins; no dispose mid-lease |
| 2: lease held; the same target requested twice → one hydration | duplicate-transition dedup |
| 3: while retirement is pending a NEW Apply sees the RETIRING interlock and refuses with zero second transaction (free-gateway lease-backstop proof) | requirement 6; interlock REQUIRED |
| 4+5: a stale deferred continuation can never retire or overwrite the replacement; the replacement owns a fresh ACTIVE interlock | inert losers; per-incarnation interlocks |
| 6: an idle transition preserves the existing synchronous behavior | no behavior change in the common case |
| 7: teardown (cancelPending) prevents late hydration after the barrier settles | teardown invalidation |
| 8: the retiring project's COMMITTED state is persisted (flush-before-install) and a fresh reopen resumes the committed head | requirement 7; persistence evidence |

## `b12-2-consumed-replay-scope.test.ts` (7) — ONE shared registry throughout

| Test | Locks |
| --- | --- |
| 1: exact consumed replay in the SAME live scope succeeds with the original receipt (head sequence deliberately not required) | same-scope idempotency preserved |
| 2: the same artifact from another LIVE PROJECT refuses and exposes no receipt (no `amr-`, no foreign ids in the outcome) | **R2** |
| 3: another BRANCH refuses | scope containment |
| 4: same project id with a REPLACEMENT LINEAGE refuses | lineage anchoring |
| 5: a RETIRED/unavailable session refuses (`session-not-ready`) | lifecycle gate |
| 6: a STALE scope (stillCurrent=false) refuses (`session-superseded`) | scope-token gate |
| 7: every foreign refusal leaves BOTH projects and BOTH histories unchanged; same-scope replay still works afterwards | non-mutation + no weakening |

## `b12-2-synchronous-adoption.test.ts` (6)

| Test | Locks |
| --- | --- |
| 1: the history entry exists BEFORE the committed promise settles and BEFORE committed-verified (event-order instrumented) | **R3** |
| 2: IMMEDIATE undo (no timer advance) restores the exact pre-apply state and reconciles the durable lineage | deterministic undo |
| 3: React effects/timers produce NO duplicate history entry (faithful watcher simulation, fake timers) | suppression contract |
| 4: an IMMEDIATE project transition preserves the retired project's committed projection | deterministic transition |
| 5: synchronous adoption failure after durable commit POISONS the identity and prevents retry | explicit recovery |
| 6: ordinary hand commands and gestures retain their established behavior | no regression to B07 semantics |

## Updated suites (strengthened, never loosened)

- `b12-1-lifecycle-interlock.test.ts` — the retired-session consumed replay
  now expects a `session-not-ready` REFUSAL (B12.1 had asserted the receipt
  was still answered; superseded by §B).
- All five B12/B12.1 test hosts now adopt through the SHARED
  `adoptCanonicalResult` primitive (no test-local adoption sequence
  remains); the service's `interlock` input is REQUIRED at every call site.
- B07.1 E5, B07.4 T1+T22, B06.2 test 19 — the page-wiring structural gates
  re-pin the NEW production shapes (installProject + transition-coordinator
  routing; the canonical applier's shared-primitive responsibilities) with
  strictly more assertions than before.

## Requirement coverage

| Requirement | Tests |
| --- | --- |
| R1 reentrant transition bypass | 4 (§A 1,2,4,7) |
| R2 foreign consumed replay | 6 (§B 2–7) |
| R3 history finalization | 3 (§C 1,3,4) |
| §A serialization/latest-wins/interlock reachability | 7 |
| §A persistence-before-install | 1 (+§C 4) |
| §B live-authority containment | 7 |
| §C synchronous adoption / immediate undo / poison-on-failure | 6 |
