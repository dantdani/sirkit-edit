# B12.5 — journal storage migration (localStorage v1 → IndexedDB)

## What migrates

Pre-B12.5 journals live in localStorage under the colliding key
`sirkit.approved-mutation-journal.v1:${tenant}:${project}:${branch}`.
The IndexedDB store's `load` consults that key exactly when the atomic
store has NO record for the requesting scope (so newer atomic state can
never be shadowed or re-imported over).

## The migration state machine (per scope, per context)

```
atomic record exists ────────────────────────→ use it (legacy ignored)
atomic record absent:
  legacy layer absent/unreadable ───────────→ absent (unreadable: retry
                                              next load — never settled
                                              on a transient failure)
  legacy raw unparseable ───────────────────→ CORRUPT (raw surfaced →
                                              strict validation →
                                              recovery-required; kept)
  classifyLegacyJournalDocument:
    corrupt (malformed / checksum-broken /
             duplicate-identity / MIXED scope) → CORRUPT (as above)
    foreign (a collision victim's journal) ──→ absent for THIS scope;
                                              record left for its owner
    absent (valid, zero entries) ────────────→ absent; record left
    owned ───────────────────────────────────→ IMPORT (below)
```

IMPORT: one readwrite transaction performs get → (absent?) → put
(put-if-absent; a concurrent context's completed migration wins inside
the serialized transaction) → `transactionDone` = **durable
confirmation**. The legacy record is removed ONLY by the context that
actually performed the put, and only after that confirmation — a
context whose put became a no-op (another document already occupied the
key) deletes nothing, so content this context never confirmed durable
is never destroyed. Removal failure is non-fatal, because the atomic
record now exists and every later load prefers it.

CORRUPT records (including MIXED-scope and duplicate-identity) are
surfaced as the RAW legacy STRING, which the journal's strict load
classifies as a corrupt DOCUMENT: corrupt for EVERY identity and every
claimant scope — lookups refuse `corrupt` and writes refuse `corrupt`
(recovery-required), never a retry-suggesting `conflict` and never a
partial re-interpretation of the claimant's own entries (internal
refutation finding, closed with journal-surface tests for both
claimants of a mixed document).

## Validation strength

An imported document is validated with the FULL B12.4 strict validator
(closed keys, patterns, per-state invariants, integrity checksums, and
each entry checked against its own embedded scope) BEFORE import; the
document imported is the validated capture, and post-import loads pass
through the journal's ordinary capture-first strict load exactly like
any other document. Nothing about the wire format changed
(`…journal.v1` / `…journal-entry.v1` schema strings unchanged), so
there is no reinterpretation of v1 content — only relocation of
strictly-valid documents.

## Rollback and failure behavior

- Failed import transaction (quota/abort/crash): the atomic store keeps
  NO record, the legacy record is untouched, and the next load retries
  the whole migration. Until durable confirmation, the legacy record IS
  the authoritative state.
- Corrupt legacy records are never imported and never deleted; they
  surface deterministically as `corrupt` → `recovery-required` on every
  load until repaired or removed by a human. A corrupt record under a
  COLLIDED key fails closed for every claimant scope — ownership of a
  record that cannot be validated is undeterminable, so nobody may claim
  (or destroy) it.
- Migration is idempotent and concurrent-safe: two contexts racing the
  same owned record import exactly one copy and converge on it.

## Evidence

`b12-5-scope-identity.test.ts` — owned import + post-confirmation
removal + atomic-record preference (including a fresh context and a
tampered legacy resurrection); collision-victim non-import/non-delete
with subsequent true-owner migration; corrupt (tampered + unparseable)
determinism and non-deletion with refused writes; mixed-scope corrupt
FOR BOTH CLAIMANTS at the journal surface (lookup `corrupt`, prepare
refuses `corrupt`); duplicate-identity corrupt (classifier + journal
surface); empty-document classification; failed-import retry with the
legacy record preserved; concurrent two-context migration convergence.

## Residual risks (documented, out of the reproducible closure set)

- A TRANSIENT legacy `getItem` failure followed by a journal write in
  the same session creates the scope's IndexedDB document, after which
  the (unread) legacy record is permanently shadowed — its historical
  entries stay in localStorage but are no longer consulted. Accepted
  because the alternative (hard-failing the journal whenever the legacy
  layer is unreadable) would deny journal service entirely in
  localStorage-blocked browsers; no CAS or authority property is
  affected.
- During a MIXED-VERSION window (an un-refreshed pre-B12.5 tab still
  writing the colliding legacy key while B12.5 contexts run), a legacy
  record written AFTER a context settled "absent" can be shadowed
  un-imported. With the removal guard above, such a record is preserved
  (never deleted un-imported) for manual recovery. No same-version
  interleaving reproduces either behavior.
