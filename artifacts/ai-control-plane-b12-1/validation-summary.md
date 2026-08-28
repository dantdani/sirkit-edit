# B12.1 — validation summary

> **SUPERSESSION NOTE (B12.2).** The INFERRED rows below ("the interlock
> excludes every retirement interleaving", "the page-host React internals
> adopt exactly as the test host does") and the CONFIRMED replacement-
> containment row overstated coverage: overlapping transitions bypassed the
> interlock (R1), the shared registry exposed a consumed receipt to a live
> foreign scope (R2), and production history finalized 350 ms after the
> receipt (R3). Corrected battery and verdict:
> `../ai-control-plane-b12-2/validation-summary.md`. One B12.1 test
> expectation was strengthened (retired-session consumed replay now
> refuses). Preserved as historical evidence.


## Authoritative hashes and pins — unchanged before and after the battery

```
app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
artifacts/ai-control-plane-b11/replay-trace-pins.json  939 bytes  sha256=ab36b0c9f5e23cae333ece747fa220e44921d30746f9cfb1e4bf9316f9ea759c
```

Identical to the B12 baseline. All 19 replay pins unchanged; the B11
artifact generator is byte-stable across two consecutive runs
(19/19 cases, 59/59 checks both times). Nine provider-facing read/propose
tools unchanged; apply remains unreachable by the model.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| `npx eslint` — `approved-agent-mutations.ts`, `project-commit-interlock.ts`, `schematic-proposals.ts`, all five B12/B12.1 test files | **clean** (0 errors, 0 warnings) |
| `npx eslint app/page.tsx` | **exactly the 14 pre-existing baseline errors** (line-shifted; none in B12.1-edited regions; 0 new findings) |
| `npx tsx scripts/generate-pcb-shape-descriptor.ts --check` | **OK** — 81 named types / 8 source files; graph `sha256-34cb69e527ca461d09cb8fdcc95854a0`; sources `sha256-cf412478820e4a9930a88b8c95e9cdbf` |
| `git diff --check` | **clean** (only pre-existing CRLF advisories) |
| `generate-b11-artifacts` ×2 | byte-stable; pins hash unchanged |

## Test battery — exact counts

| Suite | Result |
| --- | --- |
| **B12.1** `b12-1-adoption-identity-receipt` (new) | **15 / 15** |
| **B12.1** `b12-1-lifecycle-interlock` (new) | **7 / 7** |
| **B12.1** `b12-1-production-integration` (new) | **5 / 5** |
| **B12** `b12-approved-mutation` (updated to the corrected contract) | **19 / 19** |
| **B12** `b12-boundary-and-e2e` (updated) | **13 / 13** |
| B07 coordinator/serialization/scope gates (b07-1…b07-5) | **123 / 123** (5 files) |
| B08 canonical-PCB / lifecycle-hardening parity | **26 / 26** (2 files) |
| B06 schematic/proposal/authority/lineage + B03.2 boundary | **96 / 96** (5 files) |
| B09/B10 proposal/context/chat-boundary (14 files incl. `app/api/chat`) | **147 / 147** |
| Agent runtime incl. complete B11 family (19 files, 9 B11) | **280 / 280** |
| Engineering + agent + chat + PCB lifecycle + project batch | **879 / 879** (61 files) |
| Project lifecycle/history (`app/lib/project`, incl. `schematic-history`) | **37 / 37** (5 files) |
| Evaluation matrix | **19 / 19 cases, 59 / 59 checks** |
| **Full suite** `npx vitest run` | **2430 passed, 20 skipped, 3 flakes** (291 files) |

## The three non-passes — classified only after isolated reproduction

```
FAIL auto-place        > 100-footprint synthetic board … (perf-bounded synthesis)
FAIL pcb-repair-agent  > … under the performance target
FAIL route-tool        > … avoids catastrophic slowdown with 500 tracks
```

Each was re-run **three consecutive times in isolation**: `auto-place`
8/8 ×3, `pcb-repair-agent` 8/8 ×3, `route-tool` 25/25 ×3. All three are
wall-clock performance thresholds in PCB code B12.1 never touched, all
members of the documented flake family, failing only under the 291-file
parallel run's CPU contention. **Classification: pre-existing timing
flakes; not B12.1 regressions. No threshold was relaxed.**

## Assertions and bounds — nothing loosened

- No production assertion, validator bound, or historical pin was weakened.
- The B12 test updates strengthen (visible-adoption assertions added); the
  only semantic reorder is documented: `verifySealedTier1Proposal` now
  reports `altered` before the expectedScope-well-formed check for
  artifacts failing both.
- The refusal vocabulary was EXTENDED (`editor-busy`,
  `session-superseded`) — extension, not loosening; both are covered by
  tests and the audit ledger.

## Versioning

- Receipt schema `sirkit.approved-agent-mutation-receipt.v1` — UNCHANGED
  (same 20 fields; the validator hardened, the mint path unchanged, every
  existing receipt still validates).
- Registry identity — `sirkit.approved-mutation-identity.v2` (in-process
  registry key only, never a wire document; B12's v1 derivation removed).
- Proposal schema v2, capsule v3, context v2 — untouched.

## Confidence

### CONFIRMED

| Claim | Evidence |
| --- | --- |
| R1–R4 reproduced against production code before any edit | verbatim outputs in [pre-edit-counterexamples.md](pre-edit-counterexamples.md) |
| A committed apply is VISIBLY adopted: one canonical projection update, one real SchematicHistory entry, coordinator authoritative state = durable head | R1 group + §E per-provider flows |
| Verification runs at the serialized execution position | queued-hand-edit test: the apply refuses against the post-edit head with zero partial effect |
| The normal UI undo path restores the exact pre-apply digest and reconciles the durable lineage | `runHistoryStep("undo")` through the real coordinator/history/session |
| An altered sealed body can never inherit consumed status or another artifact's receipt | R2 group: operations/scope/head/impacts/provenance/createdAt/expiresAt/extra-field mutations all refuse `verification-failed` after consumption |
| Exact intact replay returns the original receipt without a new transaction | reference-independent (structural copy) replay test |
| Receipt validation is capture-first and content-integrity-verified; no field is outside the digest | the three R3 forgeries + the systematic 20-mutation battery + hostile-input totality |
| Transition-before-commit yields ZERO durable transaction | both submission-time and queued-race orderings, store-head asserted |
| Lease-before-transition makes retirement WAIT and the caller is told the truth | deterministic settlement probes; committed + adopted before retirement settles |
| A queued apply targeting an obsolete session never runs against the retired project or its replacement | epoch/scope cancellation + foreign-scope containment tests |
| Nine tools / channel importers / hashes / pins unchanged | §G scans + hash table above |

### INFERRED

| Claim | Why not CONFIRMED |
| --- | --- |
| The interlock excludes every retirement interleaving | both orderings plus the queued race are proven; the argument for the remaining interleavings is the synchronous `retiring` mark at `retire()` call — any lease acquisition after that call refuses, and JS's single-threaded execution admits no third ordering between the mark and the check |
| The page-host React internals adopt exactly as the test host does | the host contract is typed, documented ("records ONE history entry"), and CI-gated (schematic-setter-gate); the debounced history record is pre-existing page behavior exercised by the b10-1 jsdom suite family — not re-proven here |

### PROPOSED

| Item | Note |
| --- | --- |
| A jsdom StrictMode integration of `applyTier1Proposal` (b10-1-style) | would close the remaining React-internals gap; the framework-free controller boundary was chosen to keep the engineering service React-free per the stage's constraint |
| `undo-observed` audit wiring from the page's history step | vocabulary exists; recording the event from production undo is a candidate for the next corrective |

### UNKNOWN

| Item | Note |
| --- | --- |
| Live model behaviour through a real provider | both provider accounts remain out of credits; every proof is provider-free by construction. No live call was made; no credits were spent; no provider configuration was changed. |

## Verdict

**All four counterexamples fail closed; ready for independent
verification.** The real production Apply path proves visible adoption and
exact undo through the same serialized canonical interaction path as
ordinary edits; sealed-artifact identity binds the complete verified body
ahead of any one-shot lookup; receipts are capture-first with recomputed
content integrity; and project retirement is interlocked with the approved
commit critical section in both orderings. Hashes, pins, and the nine-tool
exposure are unchanged; the full suite is green apart from three
isolated-green wall-clock flakes in untouched PCB perf tests.

**B13 has not been started.**
