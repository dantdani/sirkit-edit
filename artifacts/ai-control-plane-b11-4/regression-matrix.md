# B11.4 §G — regression matrix

> **EXTENDED BY B11.5.** Proof 6 ("captured documents are deeply immutable")
> and the capture rows below were satisfied while capture was still LOSING
> `__proto__` keys and leaking untrusted key content into diagnostics. See
> [../ai-control-plane-b11-5/regression-matrix.md](../ai-control-plane-b11-5/regression-matrix.md).

**21 new tests** across two suites:

* [`b11-4-capture-ownership.test.ts`](../../app/lib/agent/__tests__/b11-4-capture-ownership.test.ts) — 17 tests
* [`b11-4-no-execution.test.ts`](../../app/lib/agent/__tests__/b11-4-no-execution.test.ts) — 4 tests

| # | Required proof | Test |
| --- | --- | --- |
| 1 | Nested and top-level `toJSON` hooks are never invoked | §G1/G2 "R1: a NESTED self-deleting toJSON is refused, uninvoked, before any execution" and "R2: a TOP-LEVEL self-deleting toJSON is refused, uninvoked" — the hook counter stays 0 **and** the self-deleting hook is still present, two independent witnesses; plus "hooks anywhere in a trace or a context are refused, uninvoked" and "an ACCESSOR is refused before it can run" |
| 2 | Hook-bearing capsules refuse before all execution boundaries | §E "hook-bearing, unknown-field, and hostile capsules trigger NONE of them" — 8 hostile documents × 8 instrumented boundaries |
| 3 | Revoked/throwing proxies return bounded issues and never throw | §G3 "every public validator returns bounded issues instead of throwing" — 3 proxy families × 6 functions, asserting `not.toThrow()` **and** a bounded non-empty refusal; plus "a proxy reporting STABLE data descriptors is captured ONCE" and "cycles and non-JSON values refuse" |
| 4 | Caller mutation after replay invocation has no effect | §G4 "R3: mutating the caller's capsule after replayCapsule has NO effect" — 6 markers, none observable; digest is the committed pin |
| 5 | `steps`, `context`, `expected` and `scope` are all snapshot-owned | same test — every one of those slots is mutated and every marker is absent |
| 6 | Captured documents are deeply immutable | §G5/G6 "the parsed capsule is DEEPLY immutable and independent of the caller" (8 `Object.isFrozen` assertions) and "a successful context parse returns CAPTURED data, not the caller's object" |
| 7 | Sparse arrays refuse in the low-level board validator | §G7 "a sparse array refuses in the LOW-LEVEL validator, not only in the context"; plus "foreign prototypes, symbols, non-enumerable indices and index accessors refuse" |
| 8 | Existing array-property/accessor closures remain green | §G8 "array-property and accessor closures from B11.3 remain green"; the B11.3 suite's own 7-test array block is unchanged and green |
| 9 | The five B11.3 nested-board counterexamples remain closed | §G9/G11 "the five B11.3 nested-board counterexamples stay closed and all 19 pins hold" |
| 10 | Generated union/record/type-graph gates remain green | the whole B11.3 suite (34 tests) is green, including the descriptor scope, discriminant, record, and no-second-key-table gates |
| 11 | All 19 evaluation traces retain their B11.3 pins | §G9/G11 (in-suite) and the regenerated `replay-trace-pins.json`, byte-identical |
| 12 | Static exposure remains exactly nine read/propose tools | §G12 "static exposure is still exactly NINE read/propose tools" |

## Additional proofs

| Proof | Test |
| --- | --- |
| The no-execution guard is **not vacuous** | §E "MUTATION TEST: a guard that lets execution happen FAILS" |
| A valid control capsule triggers every instrumented boundary | §E "the CONTROL capsule triggers EVERY probe" |
| The sink supplied through `ReplayOptions` is untouched for an invalid capsule | §E "the sink supplied through ReplayOptions is untouched" |
| The wire contract did not change | §G "the wire contract did NOT change: the committed versions are unchanged" |
| No test writes under `app/`, `lib/`, `scripts/`, `artifacts/` | §F "NO test in the repository writes under app/, lib/, scripts/ or artifacts/" |
| Drift gates are fully in memory | B11.3 §E/B11.4 §F block (4 tests) |

## Carried forward, unchanged and green

* B11 `b11-trace-replay-evaluation` — 16
* B11.1 `b11-1-trace-integrity` — 30, `b11-1-route-finalization` — 9
* B11.2 `b11-2-replay-context` — 20
* B11.3 `b11-3-generated-pcb-shape` — 34
* Evaluation matrix — 19 cases, 59 checks

## One earlier assertion re-layered, not weakened

B11.2's R6 test injected a 50 000-entry `recorderDiagnostics` array to prove the
diagnostics length bound is checked before scanning. The B11.4 capture layer now
refuses that array *earlier still*, at 20 000 entries. The test was re-layered
to assert **both**: a 5 000-entry array (above the diagnostics bound, below the
capture bound) still produces exactly the diagnostics-bound issue, and the
50 000-entry array produces exactly one capture-bound issue. Strictly more
coverage than before.
