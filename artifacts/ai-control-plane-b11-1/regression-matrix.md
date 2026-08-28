# B11.1 §H — regression matrix

> **SUPERSEDED IN PART BY B11.2.** Proofs 11 and 12 in the table below were
> satisfied by a forbidden-NAME scan over opaque fixtures, which B11.2 R1–R3
> showed to be incomplete. They are now satisfied by the versioned
> `sirkit.agent-replay-context` contract (v1 in B11.2, v2 since B11.3) and the recursive
> pre-serialization secret scan; see
> [../ai-control-plane-b11-2/regression-matrix.md](../ai-control-plane-b11-2/regression-matrix.md).
> Proof 14's "all 19 pins byte-identical" statement is superseded: 18 of 19
> remain byte-identical, and `e04-invalid-board` changed because its fixture
> was corrected — see
> [../ai-control-plane-b11-2/validation-summary.md](../ai-control-plane-b11-2/validation-summary.md).

All 16 required proofs, mapped to permanent tests. Route cases are driven
through the PRODUCTION `POST /api/chat` with controlled adapters and sinks
(not isolated helpers).

| # | Required proof | Test |
| --- | --- | --- |
| 1 | Every R1 terminal/timestamp/totals forgery refuses | `b11-1-trace-integrity` §A "R1: every terminal/timestamp/totals forgery is REFUSED" — 14 forgeries incl. endedAt<startedAt, nonfinite startedAt, summary≠event, invalid/present-when-completed reason, negative & fractional counters, string usage, extra usage keys, usage≠summed steps, totals≠ledger, model≠last step, duplicate diagnostics |
| 2 | Missing run_started refuses | §A "missing, duplicate, and non-final terminal all REFUSE" (also covers duplicate run_started and a terminal that is not last) |
| 3 | Sink append mutation cannot change recorder state | §B "an append-mutating and complete-mutating sink cannot change internal events, identity, totals, or diagnostics" |
| 4 | Sink complete mutation cannot change recorder state | same test (complete rewrites provider/scope/steps/events/diagnostics; all rejected) + "recorder-owned events and returned documents are immutable snapshots" |
| 5 | append-only, complete-only and factory failures are classified | §C "an append-only failure, a complete-only failure, and a factory failure are each classified" |
| 6 | Throwing factory cannot break POST /api/chat | `b11-1-route-finalization` "R4: a THROWING sink factory cannot break POST" + "a factory returning a MALFORMED sink … cannot abort the request or alter the NDJSON" |
| 7 | Cyclic arguments/output cannot break the run | §F "cyclic arguments/output are digested as a sentinel and classified; the recorder never throws" |
| 8 | Invalid usage/clock values cannot create an invalid trace | §F "invalid usage values, oversized identifiers, and secret-shaped fields normalize into a VALID trace" + "a throwing, nonfinite, or backwards clock is classified" |
| 9 | Invalid trace is never handed to sink.complete | §C "D: an INVALID trace is never handed to sink.complete — it is classified instead" |
| 10 | Unexpected loop/stream failure still finalizes one failed trace | `b11-1-route-finalization` "R6: an UNEXPECTED loop throw emits stream_error AND finalizes exactly one failed trace" |
| 11 | Replay refuses every forbidden field before execution | §G "R5: every forbidden field is refused BY NAME before any execution" (9 fields) + "forbidden field names nested inside context fixtures are refused" |
| 12 | Replay refuses secret-shaped fixture content | §G "secret-shaped capsule content is refused, and the refusal never echoes the secret" |
| 13 | No network/provider/database/gateway/tool call for invalid capsules | §G "an invalid capsule executes NOTHING" (sink factory instrumented; never touched) |
| 14 | Deterministic trace pins remain stable | §G "the VALID committed capsules still validate and replay to their pinned digests"; all 19 pins byte-identical to the pre-B11.1 values (verified by diff) — **no trace contract version change was required** |
| 15 | Static exposed tool count remains exactly nine | §H "static exposure is exactly NINE ids" |
| 16 | No mutation, release, MCP or multi-agent exposure | §H (operation classes restricted to read/propose; source scan of all five B11 modules) |

## Additional coverage from the adversarial review

| Proof | Test |
| --- | --- |
| Sink re-entrancy cannot inject, truncate, or recursively finalize | §B "a RE-ENTRANT sink cannot inject, truncate, or recursively finalize the ledger" |
| Prototype-carried / symbol-keyed / non-enumerable / accessor documents refuse | §A "PROTOTYPE-supplied fields are refused…", "ACCESSOR properties are refused…" |
| Prototype-carried / zero-own-key / hidden-fixture capsules refuse before execution | §G "PROTOTYPE-supplied capsule fields are refused BEFORE execution…" |
| Secret in a KEY NAME is redacted, never echoed | §A "a secret embedded in a KEY NAME is redacted…" and §G (capsule) |
| `seq` deletion (with totals adjusted) refuses | §A "SEQ must be contiguous…" |
| Near-miss forbidden names refuse; JSON-quoted credentials detected without false positives | §G "NEAR-MISS forbidden names are refused…" |
| Async sink cannot leak an unhandled rejection | §C "an ASYNC sink cannot leak an unhandled rejection…" |
| Already-aborted request propagates cancellation (provider never called) | route "an ALREADY-ABORTED request propagates cancellation…" |
| Route owns its own single-terminal stream guard | route "the route enforces exactly ONE stream terminal event of its own" |
| Cancellation finalizes exactly one `cancelled` trace | route "a CANCELLED run finalizes exactly one trace whose terminal is cancelled" |

The prototype-chain `kind` crash is covered by the existing bounded-output
test plus the `unknown event kind` path (all five `Object.prototype`
members now return bounded issues instead of throwing).

Supporting coverage carried forward unchanged: the 16 B11 tests
(`b11-trace-replay-evaluation`) and the 19-case evaluation matrix
(59 checks) both still pass.
