# B12.2 — reentrant project-transition serialization, consumed-replay scope containment, and production history finalization

> **SUPERSESSION NOTE (B12.3).** Two implied closures were incomplete:
> (1) transition latest-wins did NOT cover requests made synchronously
> inside `beforeInstall`/install — an older captured winner could install
> over a newer target (`install:C` then `install:B`, counterexample R3);
> (2) durable approved-mutation replay remained false after a browser
> reload (exact replay refused `stale-head`; receipts unrecoverable —
> counterexamples R1/R2). Corrected in `../ai-control-plane-b12-3/`.
> Preserved as historical evidence.


Corrective stage over B12.1, after independent verification confirmed three
gaps (all three re-reproduced pre-edit, verbatim, in
[pre-edit-counterexamples.md](pre-edit-counterexamples.md)):

| # | Failure | Closure |
| --- | --- | --- |
| R1 | Overlapping transitions bypassed the held commit lease: `["deferred:B","hydrate:A->C","hydrate:C->B"]` — project A disposed while leased, a null-interlock window, stale B overwriting the newer C | §A — hook-free `ProjectTransitionCoordinator` (monotonic identity, latest-wins, one barrier, retiring interlock always reachable, no dispose while leased) |
| R2 | An exact consumed project-A proposal returned **project A's receipt from a live project-B scope** through the shared registry | §B — consumed receipts gated on the LIVE session's `scopeIdentity()` (tenant/project/branch/lineage/lifecycle) + the current scope token |
| R3 | Receipts were consumed and leases released while the page's real `SchematicHistory` entry was still 350 ms away in the debounce watcher; tests substituted a synchronous host | §C — ONE shared synchronous adoption primitive (`adoptCanonicalResult`) imported by page.tsx AND tests: projection + one real history entry exist before the coordinator job returns |

## The corrected invariants

> Only the **latest** requested transition target ever hydrates, never while
> an approved commit lease is held. A consumed receipt is visible only to
> the **matching live authority**. A committed Apply's receipt exists only
> **after** the real production history entry does — undo and transition are
> deterministic immediately after success.

## Artifacts

| File | Contents |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | R1–R3 verbatim pre-edit outputs + architectural causes |
| [project-transition-state-machine.md](project-transition-state-machine.md) | §A — the transition coordinator's states, orderings, and page wiring |
| [consumed-replay-scope-contract.md](consumed-replay-scope-contract.md) | §B — the live-authority gate on consumed receipts |
| [synchronous-production-adoption-contract.md](synchronous-production-adoption-contract.md) | §C — the shared adoption primitive and watcher suppression |
| [concurrency-regression-matrix.md](concurrency-regression-matrix.md) | every permanent B12.2 test → the requirement it locks |
| [persistence-and-undo-evidence.md](persistence-and-undo-evidence.md) | flush-before-install, fresh-reopen, immediate undo/transition proofs |
| [validation-summary.md](validation-summary.md) | gates, exact counts, hashes, flake classification, confidence |
| [changed-files.md](changed-files.md) | every changed path and symbol |

## Source of truth

- Transition coordinator (new): [`app/lib/engineering/project-transition-coordinator.ts`](../../app/lib/engineering/project-transition-coordinator.ts)
- Adoption primitive (new): [`app/lib/project/canonical-adoption.ts`](../../app/lib/project/canonical-adoption.ts)
- Session identity accessor: [`app/lib/engineering/schematic-session.ts`](../../app/lib/engineering/schematic-session.ts) (`scopeIdentity()`)
- Consumed-replay gate + required interlock: [`app/lib/engineering/approved-agent-mutations.ts`](../../app/lib/engineering/approved-agent-mutations.ts)
- Production wiring: [`app/page.tsx`](../../app/page.tsx) (`installProject`/`hydrateProject`, `applyCanonicalSchematicProjection`, `applyTier1Proposal`)
- Tests: `b12-2-transition-serialization` (7), `b12-2-consumed-replay-scope` (7), `b12-2-synchronous-adoption` (6), plus the updated B12/B12.1 suites (59)

Supersession notes were added to the affected B12.1 artifacts; historical
evidence is preserved unchanged.

**Scope unchanged**: nine read/propose provider tools, apply unreachable by
the model, no provider configuration touched, no live provider call.
**B13 is not started.**
