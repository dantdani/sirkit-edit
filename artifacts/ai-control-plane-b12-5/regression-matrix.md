# B12.5 — regression matrix

The stage's 18 required coverage items → permanent tests.

| # | Required coverage | Test(s) |
| --- | --- | --- |
| 1 | R1–R4 exactly | R1: atomicity "R1 closure" (the interleaving cannot lose a write); R2: activation "R2 closure"; R3: settlement "R3 closure"; R4: scope-identity "R4 closure" — each mirrors its pre-edit probe's scenario with the closed behavior |
| 2 | Real transactional store conflict between independent connections/contexts | atomicity: two store instances (own connections) over one factory — one true / one false; retry-from-fresh test |
| 3 | Different-identity concurrent writes with no lost entry | atomicity: concurrent `prepare` of two identities from two contexts — both entries present |
| 4 | Same-identity concurrent prepare/commit/finalize convergence | atomicity: full lifecycle raced from two journals — one entry, one receipt, all idempotent-ok |
| 5 | Atomic-store unavailability, quota failure, aborted transaction, retry exhaustion | atomicity: four dedicated tests (unavailability also proves NO localStorage fallback) |
| 6 | Collision-free key derivation for every allowed scope character | scope-identity: 14-scope adversarial sweep (colons, periods, hyphens, underscores, multi-splits, every tuple position) + bounds test incl. longest-legal id |
| 7 | Safe legacy journal migration | scope-identity: owned / victim / corrupt / mixed / empty / failed-import / concurrent — six tests |
| 8 | Pointer write returning false | activation: accepted-but-dropped write caught by read-back (`{ ok: false }` typed) |
| 9 | Pointer write throwing | activation: R2 closure |
| 10 | Failure before any target UI state changes | activation: prepare-phase failure (pointer unwritten, commit never entered) |
| 11 | Injected failure at each target-install phase | activation: prepare / pointer / commit injections with per-phase dispositions |
| 12 | Failed switch/create/import preserves A's visible state, pointer, session, history and active interlock | activation: R2 closure asserts all five identities + real lease + follow-up activation (create/import paths share `installFor` exactly as the page shares `installProject`; the b12-4 create/import pointer tests remain green unchanged) |
| 13 | Reentrant outcome callback acquiring a lease and requesting C | settlement: R3 closure |
| 14 | C waits until that exact lease releases | settlement: R3 closure (arbitrary flushes do not admit C; only the release does) |
| 15 | Successful and superseded activation pointer-write counts | activation: winner 1 / superseded 0 / re-activation 0 (plus b12-4's exactly-once test, green unchanged) |
| 16 | StrictMode teardown/remount and cancellation | settlement: cancelPending during the mid-cycle barrier + remount; dispose during the barrier; (b12-3 teardown suite green unchanged) |
| 17 | Zero unhandled rejections | settlement: process-level `unhandledRejection` capture asserted EMPTY after every scenario in the suite |
| 18 | All B12.4 receipt-forgery and journal-monotonicity tests unchanged in strength | b12-4-receipt-linkage (6), b12-4-journal-strictness (10), b12-4-concurrency (3), b12-4-transition-pointer (6) run green — receipt/monotonicity files byte-unchanged; concurrency dropped only dead `save` stub members, no assertion touched |

## Adversarial-closure additions (beyond the 18 required items)

| Closure | Test(s) |
| --- | --- |
| Post-cancel (StrictMode remount) request survives a suspended canceled cycle | settlement: "request made AFTER cancelPending … proceeds normally" |
| A cancel-only cycle never leaves the survivor with a retired interlock | settlement: "cancel with NO follow-up …" |
| A request from a cancel-dropped request's superseded callback is never stranded | settlement: two reentry tests (superseded-callback, installed-callback + cancel) |
| Hostile hook outcome objects become typed failures, zero unhandled rejections | settlement: throwing-`detail`-getter test |
| dispose() during a failing hook mints no leaseable authority | settlement: dispose-during-hook test |
| PCB persistence can never write the current-project pointer | activation: board-persistence source gate + behavioral no-repoint test; pcb-sync-authority fixture re-pin |
| Mixed-scope/duplicate-identity legacy corrupt for EVERY claimant at the journal surface (`corrupt`, never `conflict`) | scope-identity: two journal-surface tests |
| Success announced only as the commit phase's final act | activation: announce-ordering source gate |

Honesty note (per the stage): no `InMemoryApprovedMutationJournalStore`
test is labeled as browser cross-context atomicity proof — every
atomicity item above runs the production IndexedDB store on a
spec-faithful engine (the two-tab race runs BOTH durable layers on the
production IndexedDB implementations), and the residual real-browser
gap is recorded as INFERRED in
[validation-summary.md](validation-summary.md).
