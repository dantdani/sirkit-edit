# B12.3 — durable approved-mutation replay, crash recovery, and reentrant transition completion

Corrective stage over B12.2. All three counterexamples were re-reproduced
pre-edit, verbatim, in
[pre-edit-counterexamples.md](pre-edit-counterexamples.md):

| # | Failure | Closure |
| --- | --- | --- |
| R1 | A genuine browser reload defeated durable idempotency: the exact intact proposal was refused `stale-head` BEFORE the executor's `clientOperationId` replay could run | §A/§B — a durable replay journal + a read-only session evidence query run BEFORE current-head enforcement; the stale-head bypass exists only for durable evidence proving this exact artifact produced the exact recorded transaction |
| R2 | Receipt authority evaporated on reload: registry/audit are in-memory, no durable record held the receipt, and exact replay was indistinguishable from ordinary staleness | §A/§C — the finalized receipt is persisted BEFORE committed success returns; exact reload replay answers the byte-identical original; every crash window has a deterministic typed disposition |
| R3 | A transition requested synchronously inside `beforeInstall` produced `install:C` then `install:B` — the older captured winner overwrote the newer target | §F — the transition coordinator re-consults the latest request after every synchronous reentry window, keeps `transitionPending` true through hook+install settlement, and reports typed outcomes |

## The corrected invariants

> An exact approved proposal can be retried after a real browser reload
> without a second transaction, with a truthful durable receipt or a typed
> recovery disposition. Every crash window fails closed. Reentrant project
> transitions preserve deterministic latest-wins.

## Artifacts

| File | Contents |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | R1–R3 verbatim pre-edit outputs + architectural causes |
| [durable-approved-replay-schema.md](durable-approved-replay-schema.md) | §A — the journal schema, stores, bounds, and integrity |
| [crash-recovery-state-machine.md](crash-recovery-state-machine.md) | §C — every crash window and its deterministic disposition |
| [canonical-transaction-linkage.md](canonical-transaction-linkage.md) | §B/§D — the evidence query and the exact-match bypass rules |
| [reload-and-idempotency-evidence.md](reload-and-idempotency-evidence.md) | what the reload tests prove (byte-identity, one transaction) |
| [reentrant-transition-contract.md](reentrant-transition-contract.md) | §F — the completion loop, typed outcomes, teardown |
| [migration-and-legacy-disposition.md](migration-and-legacy-disposition.md) | window 6 — pre-journal transactions |
| [regression-matrix.md](regression-matrix.md) | every permanent B12.3 test → the requirement it locks |
| [validation-summary.md](validation-summary.md) | gates, exact counts, hashes, flake classification, confidence |
| [changed-files.md](changed-files.md) | every changed path and symbol |

## Source of truth

- Journal (new): [`approved-mutation-journal.ts`](../../app/lib/engineering/approved-mutation-journal.ts)
- Evidence query: [`schematic-session.ts`](../../app/lib/engineering/schematic-session.ts) (`durableIdempotencyEvidence`)
- Apply boundary: [`approved-agent-mutations.ts`](../../app/lib/engineering/approved-agent-mutations.ts) (§B ordering; `journal`/`stillCurrent` REQUIRED; `recovery-required`)
- Transitions: [`project-transition-coordinator.ts`](../../app/lib/engineering/project-transition-coordinator.ts) (§F loop, typed outcomes)
- Page wiring: [`app/page.tsx`](../../app/page.tsx) (journal store, typed flush hook, outcome toast)
- Tests: `b12-3-durable-replay` (9), `b12-3-reentrant-transition` (7), plus the B12/B12.1/B12.2 suites (95 in-family total)

Supersession notes were added to the B12/B12.2 artifacts claiming reload
replay was closed or transition latest-wins covered all synchronous
interleavings; history preserved. **No provider credits, no B13, no MCP, no
manufacturing/specialist scope.**
