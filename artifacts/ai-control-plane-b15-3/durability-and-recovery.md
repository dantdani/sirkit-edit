# B15.3 §J — durability and crash recovery

## The PCB-specific journal (never overloads schematic fields)

`approved-pcb-mutation-journal.ts` — a PCB sibling of the B12 journal with
the SAME proven skeleton but its OWN schema and fields:

- schemas `sirkit.approved-pcb-mutation-journal[-entry].v1`; receipt schema
  `sirkit.approved-pcb-mutation-receipt.v1`;
- states `prepared → canonical-committed → adopted → receipt-finalized`,
  plus `poisoned`; strictly monotonic (`STATE_ORDER`); no downgrade;
- the entry base is PCB-typed: `basePcbRevisionId` + `baseBoardDigest`
  (`pcb2-…`), `baseHeadSequence`, `lineageId`, `boardInstanceId`, the sealed
  `validationPolicy` — NOT a schematic head mark or schematic digest;
- CAS-only store (`saveIf` with in-document version; `saveIf` false means
  nothing was written); production `IndexedDbApprovedPcbMutationJournalStore`
  with strict-durability array keys and a size cap; unavailability THROWS
  and the journal converts it to a fail-closed `unavailable`;
- `validateEntry` enforces exact closed key sets, scope coherence (a foreign
  scope is corrupt), state-dependent commit-field completeness, a coherent
  receipt in `receipt-finalized`, and the integrity checksum LAST;
- `IMMUTABLE_KEYS` can never change across transitions.

## Integrity model, stated honestly

The `integrity` field is a content-CONSISTENCY checksum, NOT authentication
— anything this module computes, a forger computes. Authenticated identity
comes from three stronger mechanisms:

1. `identityKey` = digest over the COMPLETE verified sealed proposal body,
   computed only after independent seal verification;
2. the receipt commitment `pcbReceiptCommitmentFor(identityKey, originRunId,
   committedAt)` is bound into the canonical transaction's
   `provenance.candidateId`, and the canonical transaction log is a
   hash-chained durable ledger (`validatePersistenceEnvelope`);
3. recovery adopts a transaction ONLY when the canonical durable history
   proves it landed (`durableIdempotencyEvidence` — full chain validation).

A journal entry claiming a commit the canonical history cannot prove is
refused as `recovery-required` and the identity poisoned — never adopted
(§K41, permanent test: a checksum-consistent forged entry with a
transactionId the ledger lacks is refused with zero mutation).

## Crash windows (all permanent tests)

- **K37 — crash before prepare**: no journal residue, no canonical record ⇒
  a clean fresh commit. Nothing was lost, nothing double-applied.
- **K38 — crash after prepare, before commit**: a durable PREPARED entry
  with no canonical evidence ⇒ the retry commits exactly once, and the
  commitment is pinned to the PREPARED timestamp (`committedAt = preparedAt`
  when reusing the prepared entry) so recovery can re-derive and verify it
  deterministically. Pre-commit failure is truthfully "nothing changed".
- **K39/K40 — crash after commit, before finalization**: the canonical
  commit LANDED (chain-protected commitment recorded) but `markCommitted`
  never ran. Recovery recomputes the commitment from
  `(identityKey, originRunId, preparedAt)`, requires it to equal the durable
  record's `provenance.candidateId`, then adopts: `markCommitted →
  markAdopted → finalizeReceipt`, returns `already-applied` with NO second
  transaction. If the commitment does not match, it poisons and refuses.
- **K41 — forged recovery**: a checksum-consistent `canonical-committed`
  entry naming `txn-forged-never-landed` (absent from the ledger) is refused
  `recovery-required`, the identity poisoned, zero re-execution.

## Recovery result cross-check (adversarial-audit hardening)

An independent 6-lens adversarial audit found NO bypass; one MINOR
defense-in-depth note was actioned: recovery now requires the CANONICAL
record to independently prove the landed transaction advanced the head by
exactly one (`evidence.record.resultHeadSequence === base head + 1`) before
adopting it — in BOTH the committed/adopted branch and the
prepared-with-evidence branch. Previously the recovery receipt's result
fields were sourced only from the proposal; the commitment already
transitively bound `candidateDigest` (via `identityKey` = full sealed body
digest), but the head advance is now validated from canonical data, not
proposal data. All K39/K40 recovery tests remain green (a genuine landed
candidate necessarily advances +1).

## Truthful post-commit classification

Any failure after the commit phase (missing transaction id, postcondition
mismatch, journal update failure, or an unexpected throw once
`committedButUnfinalized`) POISONS the identity and reports
`recovery-required` with "the board HAS changed" — it never claims nothing
changed. Pre-commit failures release the claim and report that nothing
changed.

## Autosave settlement + restart consistency

The apply flushes the working copy (with the canonical head claim) via the
injected `settleAutosave` BEFORE reporting final success; the result carries
`autosaveSettled` truthfully (a false settle is committed canonically but
surfaced to the user). One canonical transaction = one PcbHistory entry =
per-gesture exact undo/redo, unchanged by the durability layer.
