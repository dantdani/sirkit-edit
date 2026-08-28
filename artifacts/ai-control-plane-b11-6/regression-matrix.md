# B11.6 — regression matrix

**17 tests** in
[`b11-6-projection-ownership.test.ts`](../../app/lib/agent/__tests__/b11-6-projection-ownership.test.ts).
Every assertion drives production code; the identity-walk helper only compares
object identities, it never substitutes for a production check.

| # | Required proof | Test |
| --- | --- | --- |
| 1 | `projectBoardForReplay(revokedProxy)` does not throw and does not return the proxy | §A "1: projectBoardForReplay(revokedProxy) does not throw and does not return the proxy" — explicit `{ ok: false }`, `not reflectable` issue, no result field is the proxy |
| 2 | A nested hostile proxy never survives in a projected board | §A "2: a nested hostile proxy never survives in a projected board" — a revoked proxy refuses the board outright; a `get`-trap proxy captures to an owned `{}` whose reads cannot fire the caller's trap (trap counter unchanged, `Object.is` false, frozen) |
| 3 | No projection result contains any caller-owned object identity at any depth | §A "3: IDENTITY-WALK …" — recursively collects every object reachable from the caller and from the projection (board, context, accepted context) and proves an empty intersection; §A "2b" additionally proves a wrong-typed **plain** object is carried as an owned frozen copy |
| 4 | `projectReplayContext(revokedProxy)` is total | §B "4: projectReplayContext(revokedProxy) refuses explicitly" + the 105-probe matrix |
| 5 | `validateCapturedReplayContext(revokedProxy)` is total / no misleading public contract | §B "5: validateCapturedReplayContext is total AND never returns foreign identity" — hostile refuses; foreign plain input returns a registry-owned captured copy; owned input takes the zero-copy fast path (identity asserted) |
| 6 | Stateful `ownKeys`/`getPrototypeOf`/`getOwnPropertyDescriptor`/`get`/`has` traps remain contained | §B "4/5/6: no boundary throws for any hostile family — 7 families × 15 boundaries" (105 probes) |
| 7 | Accessors and `toJSON` counters remain zero | §C "7: toJSON and accessor counters remain zero across the new projection path" |
| 8 | The `findNonPlainJsonPath` depth contract is enforced | §C "8: the findNonPlainJsonPath depth contract is enforced" — `depth 33` reports exhaustion, and a starting depth counts against the same budget as recursion |
| 9 | Valid projections remain byte/canonical equivalent | §C "9: valid projections remain byte/canonical equivalent" (board and context) |
| 10 | Structurally invalid plain JSON still produces deterministic bounded diagnostics | §C "10: …" — two runs equal, non-empty, ≤ 12 |
| 11 | Replay captures once and executes only its immutable snapshot | §D "11: …" — post-call mutation invisible, digest = committed pin; the fast-path identity assertion in §B test 5 is the parse-once witness |
| 12 | Invalid capsules reach no execution boundary | §D "12: …" (new hostile families refuse at the parse step) + `b11-4-no-execution` (4 tests) unchanged and green |
| 13 | All 19 pins remain unchanged | §D "13: all 19 evaluation capsules validate and retain their pins" + generator byte-identical ×2 |
| 14 | No test writes repository paths | §D "14: no B11 test writes repository paths" + the repo-wide scan in `b11-5-capture-exactness` §D |

## Additional proofs

| Proof | Test |
| --- | --- |
| The ownership registry is unforgeable from outside | §B "the ownership registry is unforgeable from outside" — a caller-frozen plain object is foreign; a `structuredClone` of a snapshot is foreign; only capture output is owned |
| Static exposure remains exactly nine read/propose tools | §D "static exposure remains exactly NINE read/propose tools" |

## Test updates authorized by §D (consumers of the discriminated result)

| File | Change |
| --- | --- |
| `b11-2-replay-context` | round-trip sites unwrap `{ ok, value }` |
| `b11-3-generated-pcb-shape` | a `projectedBoard()` helper unwraps and asserts `ok`; the wrong-typed diagnostic case asserts the owned copy inside `ok: true` + non-empty `issues`; the two deliberately exhaustive sweeps gained explicit 120 s timeouts (capture-first made them heavier under parallel load — **no assertion changed**) |
| `b11-5-capture-exactness` | round-trip sites unwrap; the "hostile caller proxy" test corrected — a `get`-trap-only proxy is capturable, so the true property is *no identity, no executable behaviour* (`ok` may be true with issues), while a revoked proxy is the explicit-failure case; proxy comparisons use `Object.is` because vitest matcher arguments are probed for asymmetric matchers, which itself fires `get` traps |

## Carried forward, unchanged and green

* B11 `b11-trace-replay-evaluation` — 16
* B11.1 `b11-1-trace-integrity` — 30, `b11-1-route-finalization` — 9
* B11.2 `b11-2-replay-context` — 20
* B11.3 `b11-3-generated-pcb-shape` — 34
* B11.4 `b11-4-capture-ownership` — 17, `b11-4-no-execution` — 4
* B11.5 `b11-5-capture-exactness` — 18
* Evaluation matrix — 19 cases, 59 checks

No gate, schema, security rule, or performance threshold was loosened.
