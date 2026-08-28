# B12.4 — validation summary

> **SUPERSESSION NOTE (B12.5).** Four production-boundary gaps survived
> this battery: the localStorage saveIf lost concurrent writes while both
> writers claimed success (R1), an ignored pointer-write failure produced
> installed + visible-B/persisted-A (R2), reentry from a
> transition-failed outcome callback abandoned a live leased interlock
> (R3), and the delimiter-joined journal key collided distinct valid
> scopes (R4). Corrected battery and verdict:
> `../ai-control-plane-b12-5/validation-summary.md`. Preserved as
> historical evidence.


## Authoritative hashes and pins — unchanged before and after the battery

```
app/lib/pcb/types.ts                              15088 bytes  sha256=72ad7c7758b4441422ba48ccd25c10c649f009b19a7d5167a9d2cdb0c42d19a5
app/lib/agent/generated/pcb-shape-descriptor.ts  213528 bytes  sha256=5501d810e583395de585315ee75b8e32f4a0f82db06a1949495ece836753a44d
artifacts/ai-control-plane-b11/replay-trace-pins.json  939 bytes  sha256=ab36b0c9f5e23cae333ece747fa220e44921d30746f9cfb1e4bf9316f9ea759c
```

Identical to the B12.3 baseline. All 19 replay pins unchanged; the B11
artifact generator byte-stable ×2 (19/19 cases, 59/59 checks both runs).
Nine provider-facing read/propose tools unchanged; apply unreachable by the
model; human approval mandatory. No canonical-persistence version change
was needed (the commitment rides the EXISTING `provenance.candidateId`
field of the transaction schema).

## Static gates

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| `npx eslint` — journal, service, session, transition coordinator, `current.ts`, all four new suites | **clean** (0 errors, 0 warnings) |
| `npx eslint app/page.tsx` | **exactly the 14 pre-existing baseline errors** (13 refs-during-render + 1 setState-in-effect; 0 new findings) |
| descriptor `--check` | **OK** — 81 named types / 8 sources; graph `sha256-34cb69e527ca461d09cb8fdcc95854a0`; sources `sha256-cf412478820e4a9930a88b8c95e9cdbf` |
| `git diff --check` | **clean** (pre-existing CRLF advisories only) |
| `generate-b11-artifacts` ×2 | byte-stable; pins hash unchanged |

## Test battery — exact counts

| Suite | Result |
| --- | --- |
| **B12.4** `b12-4-receipt-linkage` (new) | **6 / 6** |
| **B12.4** `b12-4-journal-strictness` (new) | **10 / 10** |
| **B12.4** `b12-4-concurrency` (new) | **3 / 3** |
| **B12.4** `b12-4-transition-pointer` (new) | **6 / 6** |
| **B12 family** (14 files: B12, B12.1, B12.2, B12.3, B12.4) | **120 / 120** |
| B07 lifecycle/transition/history (b07-1…b07-5) | **123 / 123** (5 files) |
| B06 authority/persistence + B03.2 boundary | **96 / 96** (5 files) |
| B08 canonical-PCB / lifecycle-hardening | **26 / 26** (2 files) |
| B09/B10 proposal/request-boundary (14 files incl. `app/api/chat`) | **147 / 147** |
| Agent runtime incl. complete B11 replay/capture/redaction family | **280 / 280** (19 files) |
| Engineering + agent + chat + PCB lifecycle + project batch | **940 / 940** (70 files) |
| Project lifecycle/history | **37 / 37** (5 files) |
| Evaluation matrix | **19 / 19 cases, 59 / 59 checks** |
| **Full suite** `npx vitest run` | **2489 passed, 20 skipped, 5 flakes** (300 files) |

## The five non-passes — classified only after isolated reproduction

`auto-place`, `compute-fill`, `connectivity-board`, `pcb-repair-agent`,
`route-tool` — every one a wall-clock performance threshold in PCB code
B12.4 never touched; every one a documented flake-family member. Each FILE
re-run **three consecutive times in isolation: 8/8, 7/7, 10/10, 8/8,
25/25 — all green every time.** Classification: pre-existing timing flakes
under 300-file parallel contention; not B12.4 regressions. No threshold was
relaxed. (Separately, three new §E pointer tests carry EXPLICIT 20 s vitest
timeouts because they exercise the real `lib/persistence` storage stack —
an allowance declared in the test, not a production threshold change.)

## Confidence

### CONFIRMED

| Claim | Evidence |
| --- | --- |
| R1–R5 reproduced against production code before any edit | verbatim outputs in [pre-edit-counterexamples.md](pre-edit-counterexamples.md), R1 matching the independent verifier's exact shape |
| A checksum-valid modified receipt can never be returned as authoritative | R1 test + the systematic 12-field coherent-forgery battery + incoherent-forgery + cross-scope substitution — all `recovery-required`/corrupt with no receipt data exposed and one transaction |
| Healthy exact reload replay still returns the byte-identical authoritative receipt, one transaction | receipt-linkage test 4 + the B12.3 reload suite re-run green |
| Legacy (commitment-less) receipts fail closed as recovery-required; v1 is never reinterpreted | the legacy test (hand-built pre-B12.4 transaction + journal receipt) |
| Malformed/cross-scope/checksum-valid-malformed journal entries fail closed without throwing | §B batteries (24 hostile cases) |
| Journal states cannot downgrade or erase durable committed identity | R3 test + the full transition matrix + failed-write intactness |
| Concurrent exact applications preserve exactly one transaction and one authoritative receipt | the two-tab test + CAS tests |
| A failed transition leaves the surviving project fully operational with an ACTIVE interlock | R4 end-to-end (real apply succeeds after the failed switch); reactivation strictly post-barrier |
| The persisted pointer always agrees with the successfully installed project | R5 + superseded + create/import + exactly-once write-count + page source gates |
| All previous gates intact | the full battery above; 95 prior B12-family tests unchanged in strength |

### INFERRED

| Claim | Why not CONFIRMED |
| --- | --- |
| Cross-TAB CAS interleavings in a real browser | localStorage CAS is turn-atomic and proven in-process; true cross-process interleaving is not exercised in vitest — the safety net (monotonic-transition refusals + canonical clientOperationId dedup) is what the tests prove |
| The canonical integrity chain as the trust anchor | the chain's digests are themselves recomputable by an attacker with full storage control; B12.4 (per the stage's framing) treats canonical durable persistence as the root of durability truth — receipts are now exactly as trustworthy as that chain, no longer weaker |

### PROPOSED

| Item | Note |
| --- | --- |
| An IndexedDB-transaction journal store | would give real cross-context atomicity instead of turn-atomic CAS + refusal safety nets |
| A user-visible recovery surface for `recovery-required` | still a UI follow-up |

### UNKNOWN

| Item | Note |
| --- | --- |
| Live model behaviour through a real provider | both provider accounts remain out of credits; every proof is provider-free by construction. No live call; no credits; no provider configuration changes. |

## Verdict

See [final-verdict.md](final-verdict.md).
