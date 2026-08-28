# B12.1 — approved-mutation UI adoption, sealed identity, receipt soundness, and project-lifecycle interlocking

> **SUPERSESSION NOTE (B12.2, 2026-08-12).** Independent verification found
> three gaps in the implementation this stage delivered: overlapping
> project transitions could bypass a held commit lease (the deferral nulled
> the interlock ref and a stale continuation overwrote newer targets), an
> exact consumed proposal returned project A's receipt from a live
> project-B scope through the shared registry, and receipts finalized
> before the page's real debounced SchematicHistory entry existed. The
> corrected contracts live in `../ai-control-plane-b12-2/`. Preserved as
> historical evidence.


Corrective stage over B12, after independent verification reproduced four
failures against the B12 implementation (all four re-reproduced here
pre-edit, verbatim, in
[pre-edit-counterexamples.md](pre-edit-counterexamples.md)):

| # | Failure | Closure |
| --- | --- | --- |
| R1 | `applyApprovedTier1Proposal` returned **committed** and advanced the session while the editor state and `SchematicHistory` never changed — the page → service → `session.execute` path bypassed the coordinator entirely | §A — the apply now flows through the production `SchematicGestureCoordinator.runCanonicalCommand`: serialized with gestures/edits/undo/lifecycle, verified at execution position, adopted via the production applier (one projection update + one history entry), receipt only after adoption |
| R2 | An **altered** proposal (operations replaced, proposalId+scope retained) received `already-applied` and the **original receipt** | §C — capture → structural validation → sealed-body integrity → identity from the **complete** verified body → only then the one-shot lookup |
| R3 | The receipt validator accepted a consistent transactionId+undoReference forgery, a forged `schematicDigestAfter`, and `Object.create(validReceipt)` — each with **zero issues** | §D — capture-first validation with an exact closed key set and `receiptId` **recomputed from the captured body** |
| R4 | With a delayed store commit, retiring the project mid-commit left the **retired durable store advanced** while the caller was told `refused` | §B — `ProjectCommitInterlock`: transition-first ⇒ zero durable transaction; lease-first ⇒ retirement waits for the critical section; both orderings tested |

## The corrected invariant

> An approved Tier-1 apply executes **exactly once** through the **same
> serialized canonical interaction path** as ordinary schematic edits, is
> **visibly adopted** into the production editor and its **real undo
> history**, can inherit success only through the **exact intact sealed
> artifact**, produces a **capture-first, content-integrity-verified
> receipt**, and can never commit into a **retired** project.

## Artifacts

| File | Contents |
| --- | --- |
| [pre-edit-counterexamples.md](pre-edit-counterexamples.md) | R1–R4 verbatim pre-edit outputs + architectural causes |
| [corrected-execution-and-adoption-contract.md](corrected-execution-and-adoption-contract.md) | §A — the gateway flow, execution-position verification, adoption-gated finalization |
| [sealed-identity-and-idempotency-contract.md](sealed-identity-and-idempotency-contract.md) | §C — the seven-step ordering and the complete-body identity |
| [receipt-capture-and-integrity-contract.md](receipt-capture-and-integrity-contract.md) | §D — capture-first validation and the content-integrity digest |
| [project-lifecycle-interlock.md](project-lifecycle-interlock.md) | §B — the lease/retirement protocol and every race ordering |
| [production-ui-undo-evidence.md](production-ui-undo-evidence.md) | §E — what the integration tests prove about visible adoption and undo |
| [regression-matrix.md](regression-matrix.md) | every permanent test → the requirement it locks |
| [validation-summary.md](validation-summary.md) | gates, exact counts, hashes, flake classification, confidence |
| [changed-files.md](changed-files.md) | every changed path and symbol |

## Source of truth

- Service (rewritten): [`app/lib/engineering/approved-agent-mutations.ts`](../../app/lib/engineering/approved-agent-mutations.ts)
- Interlock (new): [`app/lib/engineering/project-commit-interlock.ts`](../../app/lib/engineering/project-commit-interlock.ts)
- Integrity split: [`app/lib/engineering/schematic-proposals.ts`](../../app/lib/engineering/schematic-proposals.ts) (`verifySealedTier1ProposalIntegrity`)
- Production wiring: [`app/page.tsx`](../../app/page.tsx) (`applyTier1Proposal`, `hydrateProject`)
- Tests: `b12-1-adoption-identity-receipt` (15), `b12-1-lifecycle-interlock` (7), `b12-1-production-integration` (5), plus the two updated B12 suites (19 + 13)

Supersession notes were added to the affected B12 artifacts; historical
evidence is preserved unchanged.

**B12.1 does not extend scope**: no new tools, the nine read/propose
provider tools are unchanged, apply remains unreachable by the model, no
provider configuration was touched, and no live provider call was made.
**B13 is not started.**
