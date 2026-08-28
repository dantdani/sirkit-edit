# B12.5 — validation summary

## Authoritative hashes and pins — unchanged before and after the battery

```
app/lib/pcb/types.ts                              sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
app/lib/agent/generated/pcb-shape-descriptor.ts   sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
artifacts/ai-control-plane-b11/replay-trace-pins.json  sha256=ab36b0c9f5e23cae333ece747fa220e44921d30746f9cfb1e4bf9316f9ea759c
```

Identical to the B12.3/B12.4 baseline. All 19 replay pins unchanged; the
B11 artifact generator byte-stable ×2 (19/19 cases, 59/59 checks both
runs; pins hash identical after each). Nine provider-facing read/propose
tools unchanged; apply unreachable by the model (§G suite green).
Receipt v1 / proposal v2 / identity v2 / journal v1 schema strings
unchanged — B12.5 changed the journal's storage ENGINE and storage
IDENTITY, not its wire format.

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| Scoped ESLint — journal, IDB store, interlock, coordinator, current.ts, 4 new suites, 2 updated suites | **clean** (0 errors, 0 warnings) |
| `npx eslint app/page.tsx` | **exactly the 14 pre-existing baseline errors** (0 new findings) |
| descriptor `--check` | **OK** — 81 named types / 8 sources; graph `sha256-34cb69e527ca461d09cb8fdcc95854a0`; sources `sha256-cf412478820e4a9930a88b8c95e9cdbf` |
| `git diff --check` | **clean** (pre-existing CRLF advisories only) |
| `generate-b11-artifacts` ×2 | byte-stable; pins hash unchanged |

## Test battery — exact counts (final state, after the internal adversarial pass)

| Suite | Result |
| --- | --- |
| **B12.5** `b12-5-journal-atomicity` (new) | **9 / 9** |
| **B12.5** `b12-5-scope-identity` (new) | **11 / 11** |
| **B12.5** `b12-5-transactional-activation` (new) | **11 / 11** |
| **B12.5** `b12-5-reentrant-settlement` (new) | **14 / 14** |
| **B12 family total** (18 files; the 120 prior tests unchanged in strength) | **165 / 165** |
| B07 gesture/interlock/serialization/scope/ownership/graph | **142 / 142** (6 files) |
| B08 canonical-PCB / lifecycle / authority / mutation-gate | **33 / 33** (4 files) |
| B06 (incl. re-pinned gate 19) + B03.2 boundary | **96 / 96** (5 files) |
| B09/B10 proposal/context/chat-boundary | **147 / 147** (14 files) |
| Agent runtime incl. the complete B11 pins/capture/replay/redaction family | **280 / 280** (19 files) |
| Project lifecycle/history (`app/lib/project`) | **37 / 37** (5 files) |
| PCB sync-authority + project-state (board-persistence coverage, incl. the re-pinned legacy-import fixture) | **20 / 20** (+1 env-gated skip) |
| Evaluation matrix | **19 / 19 cases, 59 / 59 checks** (×2 runs) |
| **Full suite** `npx vitest run` (final state) | **2538 passed, 20 skipped, 1 flake** (304 files) |

An earlier full-suite run at the pre-adversarial state passed 2526/20
with 3 flake-family non-passes (connectivity-board 63.0 ms vs <50 ms,
pcb-repair-agent 337.3 ms vs <250 ms, route-tool), each 3/3
isolated-green (25/25, 8/8, 10/10).

## The final run's one non-pass — classified only after isolated reproduction

`route-tool` (500-track wall-clock performance bound under full-suite
contention) — PCB code B12.5 never touched, a documented flake-family
member, re-run **three consecutive times in isolation: 25/25 every
time.** Classification: pre-existing timing flake, not a B12.5
regression. **No threshold was relaxed.**

## Assertions and bounds — nothing loosened

- No historical pin, validation bound, authority check, performance
  threshold, or one-shot semantic was weakened.
- The two page-gate re-pins (B06.2 gate 19, B07.4 T1+T22) assert
  strictly MORE: the old single-string pin plus the recovery routing.
- The B12.4 receipt-forgery and journal-monotonicity suites run
  byte-unchanged; the two suites touched for the interface change lost
  only dead `save` stub members, no assertion.
- The outcome vocabulary was EXTENDED (`recovery` flag on
  `transition-failed`; typed `ProjectInstallResult`;
  `MarkProjectCurrentResult`; `pointerPersisted`), never narrowed.
- `dispose()` reporting the dropped request is strictly more truthful
  (a request can no longer end without a terminal outcome).

## Confidence

### CONFIRMED

| Claim | Evidence |
| --- | --- |
| R1–R4 reproduced against production code before any edit (R1 and R3 byte-matching the independent verifier's observations) | verbatim outputs in [pre-edit-counterexamples.md](pre-edit-counterexamples.md) |
| The R1 interleaving cannot lose a write on the production store; no writer returns success after its update was lost | atomicity suite over real serialized IndexedDB transactions |
| Different-identity and same-identity concurrent writes converge without erasure; exact concurrent apply → one canonical transaction + one durable receipt | atomicity suite incl. the full two-tab composition |
| Unavailability/quota/abort/exhaustion fail closed; last committed document preserved; NO localStorage fallback | atomicity suite |
| Valid scopes cannot collide; bounds precede key derivation; migration authority comes from content scope only; legacy never deleted before durable confirmation | scope-identity suite |
| Pointer persistence failure (throwing OR silently dropped) can never produce `installed` or UI/pointer disagreement; failed activation leaves the survivor visible, current, operational with an ACTIVE interlock | activation suite |
| NO non-transition path writes the pointer — the PCB stack's fallback (the one live bypass, found by the internal refutation pass) is closed and gated | activation suite + board-persistence gates + pcb-sync-authority re-pin |
| Commit-phase failure enters explicit blocking recovery with no installed claim and a retired target interlock | activation + settlement suites |
| A lease acquired in a failed-outcome callback blocks the next install until released; `transitionPending` truthful; no stranded lease; every request gets exactly one terminal outcome (including cancel/dispose/reentrant-callback paths); post-cancel requests survive; zero unhandled rejections even under hostile outcome objects | settlement suite (incl. six adversarial closures) |
| Mixed-scope/duplicate-identity legacy records are corrupt for EVERY claimant at the journal surface (`corrupt`, never `conflict`) | scope-identity journal-surface tests |
| All previous B12-family invariants green; 120 prior tests unchanged in strength | 165/165 + the full battery above |
| Hashes, 19 pins, nine tools, schema strings unchanged | recorded above |

### INFERRED

| Claim | Why not CONFIRMED |
| --- | --- |
| Cross-context atomicity in a REAL multi-process browser | proven on fake-indexeddb, a faithful implementation of the IndexedDB spec's transaction serialization — the exact property browsers must implement — with BOTH durable layers (journal + canonical project store) on their production implementations; but no literal second OS process runs in vitest |
| The page's three-phase install under real React rendering | the protocol is proven on a page-faithful harness plus page source gates; no jsdom full-page mount exercises installProject end-to-end |
| IndexedDB durability across a literal power loss | `durability: "strict"` is requested; the spec makes flushing best-effort |
| Connection-cache invalidation on a browser force-close | the `onclose`/`onversionchange` cache reset is code-level hardening; fake-indexeddb does not simulate forced connection closure |

Two documented residual risks (transient-legacy shadowing; the
mixed-version legacy-writer window) are recorded with rationale in
[journal-storage-migration.md](journal-storage-migration.md) — neither
is reachable by any same-version interleaving, and the mixed-version
case now preserves (never deletes) the affected record.

### PROPOSED

| Item | Note |
| --- | --- |
| Migrate the journal store and the canonical `BrowserIndexedDbProjectStore` into ONE database/transaction scope | would make journal-vs-canonical agreement itself transactional; today their coherence is enforced by the §A linkage + dedup + monotonic rules |
| A user-visible migration/queue-state surface | migration is silent when healthy; only corrupt legacies surface (as recovery-required) |
| Deleting the deprecated `openProject`/`startNewProject` once no caller remains | retained deprecated for bootstrap-fallback semantics documentation |

### UNKNOWN

| Item | Note |
| --- | --- |
| Live model behaviour through a real provider | provider-free by construction; no live call was made, no credits spent, no provider configuration changed |

## Verdict

**All four counterexamples fail closed. Ready for independent
verification. B13 has not been started.**
