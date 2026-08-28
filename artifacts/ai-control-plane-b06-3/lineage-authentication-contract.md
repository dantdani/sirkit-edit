# B06.3 — Lineage Authentication Contract

Closes the B06.2 gap where projection reconciliation compared marks only by
sequence and digest: `decideProjectionReconciliation` never authenticated
`mark.lineageId` against the durable envelope, so a foreign-lineage mark
whose sequence and digest happened to equal the envelope head returned
`rebase-local-newer`, and `resumeHead()` could adopt a mark's lineage as the
executor lineage.

## The durable envelope is the EXCLUSIVE lineage authority

- **Commits carry the lineage forward.** Both `AtomicProjectStore`
  implementations rebuild the envelope on commit WITH the current envelope's
  `lineageId`, so the lineage survives every head advancement (pre-B06.3 it
  was dropped, which is why marks had crept into lineage selection).
- **Integrity-bound.** `lineageId` participates in the envelope digest
  (tampering → `ENVELOPE_DIGEST_MISMATCH`), and
  `validatePersistenceEnvelope` additionally rejects malformed formats
  (`INVALID_LINEAGE_ID`) — enforced on every `load` and `restore`.
- **`resumeHead(envelope)` takes only the envelope.** The executor lineage is
  `envelopeLineage(envelope)`; the mark parameter was REMOVED. A projection
  mark can never choose, replace, or invent the executor lineage.

## Mark lineage authentication (decision table, evidence-pinned)

A validated mark is lineage evidence ONLY when the envelope carries a valid
lineage, `mark.lineageId === envelope.lineageId`, and its sequence/digest
match an actual position in that lineage's log:

| Case | Decision |
|---|---|
| projection == head (any mark) | resume on the ENVELOPE lineage; a foreign mark is discarded, the mismatch recorded, and the next ready autosave overwrites it with the envelope-lineage mark |
| mark absent/malformed | recover-canonical (untrusted projection, preserved) |
| envelope lineage unverifiable (defensive; migration runs first) | recover-canonical — the mark is downgraded, never authority |
| **mark lineage ≠ envelope lineage** | **conflict (`foreign-lineage-mark`)** — including the previously-missed exact case: foreign lineage, sequence == head, digest == head digest, differing projection. Foreign marks never resume, never rebase, never count as verified-older |
| same lineage, mark == exact head | rebase-local-newer (documented legacy-edit path) |
| same lineage, verified older position | recover-canonical |
| same lineage, ahead / wrong digest / unverifiable position | conflict |

## Legacy envelope migration (deterministic, durable, recorded)

Envelopes predating lineage persistence (or carrying a malformed lineage)
are migrated BEFORE any reconciliation decision:

1. The lineage derives from the envelope's OWN genesis digest
   (`transactionLog[0].transaction.baseRevision`, or the head digest for an
   empty log) via `deriveExecutorLineageId` — never from a projection mark.
   Because the derivation inputs equal the original ones, migration
   legitimately RECOVERS the original lineage id.
2. The prior raw value is quarantined first (mandatory — failure aborts to
   `unavailable`, nothing replaced).
3. The migrated envelope is rebuilt (same snapshot/revision/log), carries
   the lineage, records a `b06.3-lineage-backfill` entry in
   `migrationHistory`, and is persisted through the validating `restore`.
4. A later reload loads the SAME migrated lineage without re-migrating
   (tested: quarantine count stable across reloads).

Tests: `__tests__/b06-3-lineage-quarantine.test.ts` §1–§2; fixtures in
`lineage-recovery-fixtures.json` (generated from the real decision table).
