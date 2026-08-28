# B14 §F — the replacement receipt and journal

## `sirkit.approved-replacement-receipt.v1`

The B12 core linkage (20 fields — proposal identity, evidence-domain
operations digest, command id `schematic.replace-component`, scope, lineage,
head before/after, schematic digests before/after, transaction record,
operation count 1, destructive true, verified postconditions, undo
reference, completedAt, origin run id) PLUS the replacement linkage:

- `componentInstanceId`, `sourcePartId`, the complete `target` identity
  (partId/manufacturer/atomic/symbol/footprint/mapping/selection);
- `authorityLinkage` — the reviewed proposal's operation digest, impact
  digest, authority/canonical resource ids + content digests, consumed
  authority digest, mapping certificate;
- `approvalActor: "human:interactive"` (the only invoker is the trusted
  interactive channel).

`receiptId` = `arr-…` over the body
(`sirkit.approved-replacement-receipt-id.v1`); the receipt is
RECONSTRUCTIBLE byte-identically from (sealed proposal, journal entry) alone
— proven by the crash-window test (finalize failure → fresh composition
reconstructs the identical receipt). The chain-protected commitment
(`sirkit.approved-replacement-receipt-commitment.v1` over identityKey +
originRunId + committedAt) travels in the transaction's
`provenanceCandidateId` INSIDE the canonical integrity chain, and
already-applied receipt claims require it plus the live head still at the
transaction.

## Journal integration (shared, not duplicated)

Replacement entries flow through the SAME `ApprovedMutationJournal`
(document schema, CAS store, monotonic states, integrity checksums).
Strict validation was EXTENDED, never loosened:

- the proposal-id vocabulary gained the `rprop-` prefix
  (`/^r?prop-[0-9a-f]{8,64}$/` — Tier-1 ids unchanged);
- `receipt-finalized` entries accept EITHER the unchanged 20-key Tier-1
  receipt OR the closed replacement receipt shape
  (`isReplacementReceiptShaped`: exact 25 keys, `arr-` id, `rprop-`
  proposal id, command id, closed target/linkage sub-shapes, fixed
  approval actor) — the entry↔receipt coherence checks (proposalId,
  operations digest, scope, transaction, heads, digests, counts,
  completedAt) apply to both kinds unchanged;
- journal/receipt forgery tests: a tampered receipt field or entry field is
  detected as corrupt on the next lookup ⇒ `recovery-required`, never
  honored.

Identity keys are kind-disambiguated
(`sirkit.approved-replacement-identity.v1` vs the Tier-1 v2 schema), so the
shared one-shot registry and journal can never confuse the two kinds.
