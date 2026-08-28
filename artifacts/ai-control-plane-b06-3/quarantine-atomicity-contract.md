# B06.3 — Quarantine Atomicity Contract

B06.2 quarantined envelopes on a best-effort basis
(`preserveEnvelope?.().catch(() => false)`): a quarantine failure was
swallowed and the primary envelope was overwritten anyway — while the UI
claimed the history had been "preserved".

## The rule

Whenever an EXISTING envelope (valid or corrupt) would be replaced —
automatic legacy-divergence rebase, reconcile rebase, conflict resolution
"keep local", explicit corrupt-history "start fresh", or lineage migration —
quarantine MUST SUCCEED FIRST:

1. Existence is checked via `load` (a corrupt value that throws IS an
   existing value and must be preserved).
2. If nothing exists, no quarantine is required and the write proceeds.
3. If something exists, `preserveEnvelope` (raw copy, no validation, to a
   quarantine key invisible to `load`) must return true. A missing
   implementation, a false result, or an exception ABORTS the operation with
   the primary untouched.

## Failure behavior (per call site)

- **Conflict resolution / start-fresh**: the session stays `conflicted`,
  the recovery outcome reports the failure truthfully ("Nothing was
  changed"), and the page KEEPS the recovery dialog with refreshed detail —
  retry and the other recovery choices remain available. The dialog is never
  dismissed prematurely, and preservation is never claimed unless it
  occurred. Adopting the canonical head remains possible (resuming replaces
  nothing, so it needs no quarantine).
- **Automatic rebase inside a command**: the command is rejected
  (`persistence_failed`, `QUARANTINE_BEFORE_REBASE_FAILED`) with nothing
  mutated.
- **Undo/redo reconcile rebase**: the reconcile step is skipped and
  recorded; the canonical head stays untouched.
- **Legacy lineage migration**: the open aborts to `unavailable`; nothing is
  replaced.

## Ordering and retry

Quarantine happens strictly BEFORE the replacement write; on success the
quarantine key holds the EXACT prior head (byte-compared by envelope digest
in tests) and the primary holds the fresh lineage. After a failure, a healed
retry of the same choice succeeds cleanly.

Tests: `__tests__/b06-3-lineage-quarantine.test.ts` §3 (mandatory tests
14–17, plus the missing-`preserveEnvelope` refusal).
