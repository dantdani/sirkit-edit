# B12.3 — validation summary

> **SUPERSESSION NOTE (B12.4).** The CONFIRMED byte-identical-replay and
> corruption-fail-closed rows below were narrower than stated: a
> checksum-valid MODIFIED receipt replayed as the original, checksum-valid
> malformed/foreign-scope entries passed validation, prepare() downgraded
> committed entries, a failed transition stranded the survivor with a
> retired interlock, and the persisted project pointer could disagree with
> the installed project (B12.4 counterexamples R1–R5). Corrected battery
> and verdict: `../ai-control-plane-b12-4/validation-summary.md`.
> Preserved as historical evidence.


## Authoritative hashes and pins — unchanged before and after the battery

```
app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
artifacts/ai-control-plane-b11/replay-trace-pins.json  939 bytes  sha256=ab36b0c9f5e23cae333ece747fa220e44921d30746f9cfb1e4bf9316f9ea759c
```

Identical to the B12.2 baseline. All 19 replay pins unchanged; the B11
artifact generator byte-stable ×2 (19/19 cases, 59/59 checks both runs).
Nine provider-facing read/propose tools unchanged; apply unreachable by the
model. Receipt v1 / proposal v2 / identity v2 schemas unchanged; the
journal schemas are NEW (v1) with no prior format to migrate.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| `npx eslint` — the journal, the transition coordinator, the service, the session, both new suites, and every updated suite | **clean** (0 errors, 0 warnings) |
| `npx eslint app/page.tsx` | **exactly the 14 pre-existing baseline errors** (13 refs-during-render + 1 setState-in-effect; 0 new findings) |
| descriptor `--check` | **OK** — 81 named types / 8 sources; graph `sha256-34cb69e527ca461d09cb8fdcc95854a0`; sources `sha256-cf412478820e4a9930a88b8c95e9cdbf` |
| `git diff --check` | **clean** (pre-existing CRLF advisories only) |
| `generate-b11-artifacts` ×2 | byte-stable; pins hash unchanged |

## Test battery — exact counts

| Suite | Result |
| --- | --- |
| **B12.3** `b12-3-durable-replay` (new) | **9 / 9** |
| **B12.3** `b12-3-reentrant-transition` (new) | **7 / 7** |
| **B12 + B12.1 + B12.2** (8 files, updated to the required journal/stillCurrent contract) | **79 / 79** |
| B07 coordinator/scope/serialization/lifecycle/undo/history (incl. re-pinned hydration gates) | **123 / 123** (5 files) |
| B08 canonical-PCB / lifecycle-hardening parity | **26 / 26** (2 files) |
| B06 (incl. re-pinned test 19) + B03.2 boundary | **96 / 96** (5 files) |
| B09/B10 proposal/context/chat-boundary | **147 / 147** (14 files) |
| Agent runtime incl. the complete B11 pins/capture/replay/redaction family | **280 / 280** (19 files) |
| Engineering + agent + chat + PCB lifecycle + project batch (executor, transaction, persistence, session, hydration, history included) | **915 / 915** (66 files) |
| Project lifecycle/history (`app/lib/project`) | **37 / 37** (5 files) |
| Evaluation matrix | **19 / 19 cases, 59 / 59 checks** |
| **Full suite** `npx vitest run` | **2464 passed, 20 skipped, 5 flakes** (296 files) |

## The five non-passes — classified only after isolated reproduction

`passive-policy performance-property`, `auto-place` (×2 assertions),
`compute-fill`, `connectivity-board`, `pcb-repair-agent` — every one a
wall-clock performance threshold in PCB/policy code B12.3 never touched,
every one a documented flake-family member. Each FILE was re-run **three
consecutive times in isolation: 3/3, 8/8, 7/7, 10/10, 8/8 — all green
every time.** This full-suite run showed heavier-than-usual CPU contention
(reference tests ran ~3× slower than their isolated times).
**Classification: pre-existing timing flakes; not B12.3 regressions. No
threshold was relaxed.**

## Assertions and bounds — nothing loosened

- No historical pin, validation bound, authority check, performance
  threshold, or one-shot semantic was weakened.
- The executor's duplicate/reference-mismatch checks are untouched; the
  stale-head bypass exists ONLY for exact durable-evidence matches.
- The refusal vocabulary was EXTENDED (`recovery-required`) — tested and
  audited; the two B12.1 timing fixes changed scheduling only, not
  assertions; the three gate re-pins assert strictly more.

## Confidence

### CONFIRMED

| Claim | Evidence |
| --- | --- |
| R1–R3 reproduced against production code before any edit | verbatim outputs in [pre-edit-counterexamples.md](pre-edit-counterexamples.md) |
| Exact replay after a REAL reload: already-applied, byte-identical receipt, exactly one transaction | reload compositions with fresh registries over shared durable stores, two consecutive reloads |
| Every crash window (1–6) has a deterministic fail-closed disposition | crash-injection + reload tests per window; see [crash-recovery-state-machine.md](crash-recovery-state-machine.md) |
| The receipt is durably persisted before committed success is returned | `finalizeReceipt` failure → `recovery-required`, and the next attempt finalizes the byte-identical receipt |
| Corrupt/tampered/disagreeing/unavailable journal evidence fails closed without receipts | tamper + disagreement + unavailable-store tests |
| Legacy transactions never re-execute and never receive invented receipts | window-6 test (empty journal, durable evidence exact) |
| `stillCurrent` required; transition-pending lookups publish nothing | type-level + runtime refusal tests |
| Reentrant transitions preserve latest-wins in every listed window | the §F suite incl. the exact R3 sequence, install-reentrancy, teardown, flush failure, zero unhandled rejections |
| All previous B12/B12.1/B12.2 invariants remain green | 79/79 in-family + the full battery above |
| Hashes, 19 pins, nine tools unchanged | recorded above |

### INFERRED

| Claim | Why not CONFIRMED |
| --- | --- |
| localStorage journal behavior in a real browser | the production store is exercised through its interface contract; jsdom/localStorage integration is not run here (the in-memory store is API-identical and the localStorage implementation is 20 lines of guarded get/set) |
| Crash windows under a REAL process kill | windows are induced by deterministic write-failure injection and fresh compositions — equivalent state transitions to a kill between persisted writes, but no literal process termination occurs in vitest |

### PROPOSED

| Item | Note |
| --- | --- |
| An IndexedDB journal store implementation | localStorage chosen for synchronous simplicity and small bounded documents; IndexedDB would align the journal with the canonical store's storage engine |
| A user-visible recovery surface for `recovery-required` | the code and message exist; a dedicated dialog (like schematic recovery) is a UI follow-up |

### UNKNOWN

| Item | Note |
| --- | --- |
| Live model behaviour through a real provider | both provider accounts remain out of credits; every proof is provider-free by construction. No live call was made; no credits were spent; no provider configuration was changed. |

## Verdict

**All three counterexamples fail closed; ready for independent
verification.** An exact approved proposal retried after a real reload
returns the byte-identical original receipt (or a truthful typed recovery
disposition) without ever executing a second transaction; every crash
window is deterministic and fail-closed; and reentrant project transitions
preserve latest-wins with typed, truthful outcomes.

**B13 has not been started.**
