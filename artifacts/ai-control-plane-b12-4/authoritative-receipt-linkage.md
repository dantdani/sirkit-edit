# B12.4 §A — authoritative receipt linkage

Module: [`approved-agent-mutations.ts`](../../app/lib/engineering/approved-agent-mutations.ts)
(`verifyReceiptLinkage`, `receiptCommitmentFor`, the reworked replay
dispositions). Supersedes B12.3's replay verification
(`validateApprovedMutationReceipt` + `transactionId` equality — both
publicly recomputable, hence forgeable, R1).

## The rule

A persisted (or reconstructed) receipt is returned ONLY when **every**
field is authoritatively linked:

| Receipt field(s) | Authority |
| --- | --- |
| `schema`, `commandId`, `proposalId`, `operationsDigest`, `tenantId`, `projectId`, `branchId`, `lineageId`, `headBefore` (sequence + digest), `schematicDigestBefore`, `operationCount`, `destructive` | the CAPTURED, digest-AUTHENTICATED sealed proposal (exact equality, field by field) |
| `transactionId`, `undoReference.transactionId`, `headAfter.headSequence`, `headAfter.canonicalStateDigest` | the canonical durable transaction record (located by exact `clientOperationId`, protected by the envelope integrity chain, already exact-matched to the artifact by `evidenceMatchesProposal`) |
| `originRunId`, `completedAt` | the receipt COMMITMENT carried INSIDE the transaction: `provenance.candidateId = engineeringDigest({schema: "sirkit.approved-mutation-receipt-commitment.v1", identityKey, originRunId, completedAt})`, chosen and bound BEFORE the commit, protected by the canonical integrity chain |
| `schematicDigestAfter` | RE-DERIVED: the live session's `headProjectionDigest()` while the durable head still sits at this transaction's result (`headMark == resultHeadSequence/resultCanonicalStateDigest`). After later edits the field is UNPROVABLE and the receipt fails closed (typed `recovery-required`) |

The journal's `receiptId` and entry `integrity` digests remain in place as
**consistency checksums only** — they are never treated as authentication.

No new "publicly recomputable checksum beside the receipt" was added: the
commitment lives inside the canonical durable record, whose integrity chain
(`validatePersistenceEnvelope`) the evidence query verifies before
answering, and whose content an attacker cannot alter without breaking that
chain (which surfaces as `corrupt` evidence → `recovery-required`).

## Reconstruction (crash windows 2–4)

Reconstruction now requires the SAME commitment
(`commitment(identityKey, entry.originRunId, entry.committedAt) ==
record.provenanceCandidateId`) and derives `schematicDigestAfter` from the
canonical head — never from journal data — then passes the full linkage
check before being persisted and returned. Missing/mismatching commitment
or a moved head → `recovery-required`, never an invented receipt.

## Legacy dispositions (v1 receipts / pre-commitment transactions)

- Durable transaction WITHOUT a commitment + journal receipt/committed
  entry → **`recovery-required`** ("could not be authoritatively
  verified") — v1 receipts are never silently reinterpreted, and no receipt
  data is exposed.
- Durable transaction WITHOUT a commitment + NO journal entry (the
  B12/B12.1/B12.2 population) → the unchanged truthful receipt-less
  `already-applied` refusal.
- Fresh applies mint the commitment on every transaction; healthy exact
  reload replay returns the byte-identical original receipt with exactly
  one transaction (proven).

## Journal/service coherence (§B at the boundary)

Before any disposition, the journal entry found by `identityKey` must be
coherent with the authenticated proposal (proposalId, clientOperationId,
operationsDigest, tenant/project/branch/lineage, base head mark, base
schematic digest) — any mismatch is corrupt durable state →
`recovery-required`.

## In-memory cache note

The in-process one-shot registry's consumed fast path still returns its
cached receipt without re-linkage: that cache holds only receipts THIS
process minted or fully verified, in trusted memory — it is not reachable
by storage modification. All durable replay flows through the linkage.
