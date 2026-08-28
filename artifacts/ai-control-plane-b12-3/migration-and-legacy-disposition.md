# B12.3 — migration and legacy disposition (crash window 6)

## The legacy population

Approved transactions committed by B12/B12.1/B12.2 exist in durable
canonical envelopes (exact `clientOperationId === proposalId` records) but
have NO journal entry and NO persisted receipt — those stages' receipts
lived only in process memory and died with the page.

## The disposition

When an authenticated exact artifact's durable evidence matches
(`accepted`, exact operation digest, scope, lineage, base) but the journal
has no entry for its identity:

- **never re-execute** — the durable transaction is proof of completion;
- **never pretend an original receipt exists** — none was ever durably
  finalized, and inventing one now would be an unverifiable fabrication;
- return the truthful typed outcome: the existing `already-applied`
  REFUSAL (`ok: false, code: "already-applied"`) with an explicit legacy
  message ("…before durable receipts existed; the canonical history is
  unchanged and no original receipt is available");
- leave the journal untouched (no backfilled entries: a journal entry's
  `preparedAt`/`committedAt` would have to be invented, which would then
  mint a fabricated-receipt path — exactly what window 6 forbids).

The disposition is deterministic and stable: every future replay of the
same legacy artifact answers the same refusal, and the one-shot registry is
released each time (nothing to consume — there is no receipt).

## No schema migration required

- The journal document/entry schema is NEW (`…journal.v1` /
  `…journal-entry.v1`) — there is no prior journal format to migrate.
- The receipt schema (`sirkit.approved-agent-mutation-receipt.v1`), sealed
  proposal schema (v2), identity schema (v2), and canonical envelope
  format are all unchanged.
- Legacy-vs-journaled coexistence is handled per-identity at lookup time,
  as above — no bulk scan, no rewrite of durable history.

## Evidence

`b12-3-durable-replay.test.ts` "windows 5+6": a committed transaction
replayed through a composition with an EMPTY journal store answers
`already-applied` (refusal), exposes no `amr-` receipt id, and leaves the
durable transaction count at exactly one.
