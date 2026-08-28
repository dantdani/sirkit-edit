# B12.2 — validation summary

> **SUPERSESSION NOTE (B12.3).** The INFERRED claim below that the
> transition coordinator's remaining interleavings "follow from the
> synchronous latest overwrite" missed synchronous reentry INSIDE the
> completion path (counterexample R3), and no battery covered
> reload-durable replay (counterexamples R1/R2: stale-head preceded durable
> idempotency; receipts were memory-only). Corrected battery and verdict:
> `../ai-control-plane-b12-3/validation-summary.md`. Preserved as
> historical evidence.


## Authoritative hashes and pins — unchanged before and after the battery

```
app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
artifacts/ai-control-plane-b11/replay-trace-pins.json  939 bytes  sha256=ab36b0c9f5e23cae333ece747fa220e44921d30746f9cfb1e4bf9316f9ea759c
```

Identical to the B12/B12.1 baseline. All 19 replay pins unchanged; the B11
artifact generator is byte-stable across two consecutive runs (19/19 cases,
59/59 checks both times). Nine provider-facing read/propose tools
unchanged; apply remains unreachable by the model. Receipt schema v1 and
identity schema v2 unchanged.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| `npx eslint` — both new modules, `schematic-session.ts`, `approved-agent-mutations.ts`, all three new B12.2 suites, all five updated B12/B12.1 suites, and the three re-pinned gate files | **clean** (0 errors, 0 warnings) |
| `npx eslint app/page.tsx` | **exactly the 14 pre-existing baseline errors** (13 refs-during-render + 1 setState-in-effect — the identical categories and count; 0 new findings) |
| `npx tsx scripts/generate-pcb-shape-descriptor.ts --check` | **OK** — 81 named types / 8 source files; graph `sha256-34cb69e527ca461d09cb8fdcc95854a0`; sources `sha256-cf412478820e4a9930a88b8c95e9cdbf` |
| `git diff --check` | **clean** (only pre-existing CRLF advisories) |
| `generate-b11-artifacts` ×2 | byte-stable; pins hash unchanged |

## Test battery — exact counts

| Suite | Result |
| --- | --- |
| **B12.2** `b12-2-transition-serialization` (new) | **7 / 7** |
| **B12.2** `b12-2-consumed-replay-scope` (new) | **7 / 7** |
| **B12.2** `b12-2-synchronous-adoption` (new) | **6 / 6** |
| **B12 + B12.1** (5 files, updated to the corrected contracts) | **59 / 59** |
| B07 coordinator/scope/serialization/lifecycle/undo/history (b07-1…b07-5, incl. the re-pinned E5 and T1+T22 gates and the B07.1 §E setter gate E1–E4) | **123 / 123** (5 files) |
| B08 canonical-PCB / lifecycle-hardening parity | **26 / 26** (2 files) |
| B06 schematic/proposal/authority/lineage (incl. re-pinned test 19) + B03.2 boundary | **96 / 96** (5 files) |
| B09/B10 proposal/context/chat-boundary (14 files incl. `app/api/chat`) | **147 / 147** |
| Agent runtime incl. the complete B11 pins/capture/replay/redaction family (19 files, 9 B11) | **280 / 280** |
| Engineering + agent + chat + PCB lifecycle + project batch | **899 / 899** (64 files) |
| Project lifecycle/history (`app/lib/project`) | **37 / 37** (5 files) |
| Evaluation matrix | **19 / 19 cases, 59 / 59 checks** |
| **Full suite** `npx vitest run` | **2452 passed, 20 skipped, 1 flake** (294 files) |

## The one non-pass — classified only after isolated reproduction

```
FAIL app/lib/pcb/__tests__/connectivity-board.test.ts
  > computeConnectivity handles a 200-instance / ~5k-item board in <50 ms
```

Re-run **three consecutive times in isolation: 10/10, 10/10, 10/10.** A
wall-clock performance threshold in PCB connectivity code B12.2 never
touched; a documented flake-family member failing only under the 294-file
parallel run's CPU contention. **Classification: pre-existing timing flake;
not a B12.2 regression. No threshold was relaxed.**

## Assertions and bounds — nothing loosened

- No production assertion, validation bound, performance gate, or
  historical pin was weakened.
- Three page-wiring structural gates were RE-PINNED to the new production
  shapes with strictly more assertions (E5 now also requires the shared
  primitive, the real-history port, watcher suppression, and
  throw-on-failure; the hydration gates now also require the
  transition-coordinator routing).
- One B12.1 behavioral expectation was STRENGTHENED (retired-session
  consumed replay: receipt → refusal), recorded as a supersession.

## Confidence

### CONFIRMED

| Claim | Evidence |
| --- | --- |
| R1–R3 reproduced against production code before any edit | verbatim outputs in [pre-edit-counterexamples.md](pre-edit-counterexamples.md), including the exact `["deferred:B","hydrate:A->C","hydrate:C->B"]` sequence |
| Overlapping transitions cannot bypass retirement; only the LATEST target hydrates; duplicates dedup; stale continuations are inert | §A suite tests 1, 2, 4, 7 |
| No project is disposed while its approved lease is held | §A test 1 (A stays `ready` until the critical section settles) |
| The retiring interlock is reachable throughout retirement and refuses new applies (interlock REQUIRED) | §A test 3 (free-gateway lease-backstop) + the type-level requirement |
| The committed retiring-project state is persisted before the winner installs; a fresh reopen resumes the committed head | §A test 8, §C test 4 |
| Foreign/replacement/retired/stale scope can never receive a consumed receipt; same-scope exact replay still returns the original receipt | §B suite (ONE shared registry throughout) |
| Committed success includes the real production history entry synchronously — before receipt consumption, audit finalization, and lease release | §C test 1 (event-order instrumented) |
| Immediate undo and immediate transition are deterministic; no timer/effect duplicate | §C tests 2–4 |
| Synchronous adoption failure after a durable commit poisons and refuses retries | §C test 5 |
| All previous B12/B12.1 invariants remain green | 59/59 + the full battery above |
| Hashes, 19 pins, nine tools unchanged | recorded above |

### INFERRED

| Claim | Why not CONFIRMED |
| --- | --- |
| The page watcher records no duplicate in the real React runtime | the suppression flag is the page's OWN pre-existing guard (hydration/undo/redo have always used it); the watcher's handling of it is pinned by the B07.1 E5 source gate and simulated faithfully under fake timers — but no jsdom render exercises the real effect here |
| The transition coordinator excludes every interleaving | all eight required orderings plus the queued race are proven; the remainder follows from the synchronous `latest` overwrite and single-threaded execution between the barrier settle and `complete()` |

### PROPOSED

| Item | Note |
| --- | --- |
| A jsdom StrictMode integration of hydrate/apply/watcher (b10-1-style) | would close the React-runtime INFERRED rows |
| `undo-observed` audit wiring from the production history step | vocabulary exists; still unwired |

### UNKNOWN

| Item | Note |
| --- | --- |
| Live model behaviour through a real provider | both provider accounts remain out of credits; every proof is provider-free by construction. No live call was made; no credits were spent; no provider configuration was changed. |

## Verdict

**All three counterexamples fail closed; ready for independent
verification.** Overlapping transitions serialize through one coordinator
with latest-wins and no null-interlock window; no project is disposed while
its approved lease is held; consumed receipts are contained to the matching
live authority through the session's own identity; and committed success
now includes the real production history entry synchronously — with
immediate undo, immediate transition, flush-before-install persistence, and
poison-on-adoption-failure all proven deterministic.

**B13 has not been started.**
