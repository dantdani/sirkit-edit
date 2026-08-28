# B12.3 — regression matrix

16 new permanent tests across two files; the entire B12 family (95
in-family tests across 10 files) green under the corrected contracts.

## `b12-3-durable-replay.test.ts` (9)

| Test | Locks |
| --- | --- |
| exact replay after a genuine reload: already-applied, BYTE-IDENTICAL receipt, exactly one transaction, stable across two reloads; altered replay refuses; foreign live composition sees no receipt | **R1/R2**, §A/§B, §G bullets 1–5 |
| §E: `stillCurrent` required and refusing every path; a retiring interlock refuses even an exact receipt lookup, publishing nothing | §E, §G stillCurrent + transition-pending bullets |
| window 1: prepared-only → safe fresh retry while the base is current | §C.1 |
| window 2: commit landed, ack lost → typed `recovery-required`, never a second transaction, stable across replays | §C.2 |
| window 3: commit landed, adoption failed → poisoned; reload replay `identity-poisoned`, never re-executes | §C.3 |
| window 4: receipt persistence interrupted → reload deterministically finalizes the ORIGINAL receipt; byte-identical across reloads | §C.4 |
| windows 5+6: finalized receipt replays byte-identically (proven in the reload test); LEGACY transaction answers a truthful receipt-less `already-applied` | §C.5, §C.6, migration disposition |
| corrupt/tampered entries and journal/canonical disagreement → `recovery-required`; unavailable store fails closed; the healthy journal still replays | §A integrity, §B fail-closed edges |
| journal schema constants pinned | schema stability |

## `b12-3-reentrant-transition.test.ts` (7)

| Test | Locks |
| --- | --- |
| R3 closure: a request inside `beforeInstall` supersedes the in-flight winner — only the LATEST installs (`["install:A","install:C"]`), typed outcomes | **R3**, §F hook reentrancy |
| a request DURING an install supersedes it: the just-installed incarnation retires exactly once; the survivor's interlock is fresh and ACTIVE | §F install reentrancy, retire-at-most-once, no stale retire |
| duplicate requests while awaiting retirement → one hydration, earlier superseded | §F barrier joins |
| failed persistence flush → `transition-failed`, no install, recoverable retry succeeds | §F typed hook outcome |
| teardown during the hook and during the barrier → nothing installs; the coordinator stays usable | §F teardown |
| no unhandled rejection from throwing hooks/installs or barrier paths (process-level capture) | §F rejection totality |
| idle transitions and truthful outcome reporting unchanged | §F compatibility |

## Updated suites (strengthened, never loosened)

- `interlock`, `journal`, and `stillCurrent` are now REQUIRED at every
  apply call site (type-level) — all 8 prior B12-family suites updated.
- Two timing-sensitive B12.1 tests gained explicit microtask flushes so the
  apply's new pre-queue durable lookups complete before the scenario's
  invalidate/begin fires (assertions unchanged).
- B06.2 test 19 + B07.4 T1+T22 hydration gates re-pinned: `hydrateProject`
  must route through the transition coordinator AND surface
  `transition-failed` outcomes.
- The B12.2 §A/§B/§C suites (transition/adoption/replay) remain green
  unmodified in their assertions.

## §G checklist coverage

Every §G bullet maps to at least one test above; the "all B12.2
transition/adoption/replay tests remain green" bullet is the 10-file
95-test in-family battery reported in
[validation-summary.md](validation-summary.md).
