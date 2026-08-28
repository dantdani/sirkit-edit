# B14 §F — approved replacement execution

> **SUPERSEDED IN PART by B14.1**: "explicit trusted human approval" was
> asserted but NOT authenticated — a direct service call committed and the
> receipt stamped `approvalActor: "human:interactive"` unconditionally, and
> the `reauthorize` input was a structural trust seam. B14.1 adds the
> required one-shot `ReplacementApprovalIntent` capability and the branded
> one-shot reauthorization channel. Historical text below is preserved
> unmodified.


Module: [approved-replacement-mutations.ts](../../app/lib/engineering/approved-replacement-mutations.ts)
(`applyApprovedReplacementProposal`).

## Architecture choice

The stage permitted either generalizing the B12 service or a
replacement-specific sibling "using the same journal, receipt, interlock,
adoption, and recovery primitives". B14 implements the SIBLING and shares
every synchronization primitive — so no unsynchronized second implementation
exists:

| primitive | shared with Tier-1 |
| --- | --- |
| one-shot identity registry | the SAME `ApprovedMutationRegistry` (identity keys are kind-disambiguated by digest schema, so Tier-1 and replacement identities can never collide yet serialize through one claim space) |
| durable replay journal | the SAME `ApprovedMutationJournal` class, document schema, CAS store, and monotonic states (`prepared → canonical-committed → adopted → receipt-finalized`, poison) — its strict validation gained the closed replacement-receipt shape and the `rprop-` id prefix WITHOUT loosening any Tier-1 rule |
| commit interlock | the SAME `ProjectCommitInterlock` lease (project transition/retirement ordering) |
| serialized execution | the SAME `ApprovedApplyExecutionGateway` (production `SchematicGestureCoordinator.runCanonicalCommand`) |
| adoption | the SAME `adoptCanonicalResult` host path (one projection update + ONE history entry) |
| audit | the SAME `approvedMutationAudit` ledger (one additive code: `authority-unavailable`) |
| refusal vocabulary | B12's, plus `authority-unavailable` |

Tier-1 (`applyApprovedTier1Proposal`) is byte-behavior UNCHANGED — the whole
B12/B12.x family runs green.

## Preserved guarantees (proven in b14-replacement-apply)

explicit trusted human approval (only the review UI invokes it; provider
classes refuse) · immutable captured proposal identity · one-shot claim ·
durable prepared journal state · optimistic head precondition (sealed head +
session-queue recheck) · ONE canonical transaction (`executedCount === 1`
across duplicate/concurrent/retry scenarios) · exact idempotency
(duplicate ⇒ `already-applied` with the SAME receipt) · durable canonical
evidence (`durableIdempotencyEvidence` found) · receipt recovery after crash
windows (finalize-failure ⇒ recovery-required ⇒ fresh composition
reconstructs the byte-identical receipt from the journal) ·
poison-on-unverifiable (adoption/postcondition failures poison, never claim
success) · project-switch settlement (`stillCurrent` false ⇒
session-superseded) · retirement safety (retiring interlock refuses) ·
UI adoption only after verified commit · exact undo/redo (prior digest AND
prior authority fields restored; committed digest restored) ·
provider-neutral provenance · bounded redacted audit events.
