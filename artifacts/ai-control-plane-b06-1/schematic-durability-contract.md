# B06.1 — Schematic Durability Contract

> **Superseded in part by B06.2**
> (`artifacts/ai-control-plane-b06-2/projection-reconciliation-contract.md`
> and `hydration-readiness-contract.md`): (1) the reload decision table below
> trusted `mark.headSequence >= envelope.headSequence` — marks are now
> structurally validated and verified against actual durable log positions,
> with impossible orderings preserved as explicit conflicts; (2) the
> non-browser in-memory construction fallback described below was removed —
> production without IndexedDB is now `unavailable` with mutations disabled;
> (3) corrupt envelopes are no longer replaced automatically — they are
> preserved and quarantined behind an explicit recovery action; (4) editing
> is structurally disabled until the session lifecycle is `ready`
> (hydration/adoption gating).

Closes the B06 gap where `SchematicEditorSession` constructed a production
`InMemoryAtomicProjectStore`, making the "durable" transaction log vanish on
reload and leaving SavedProject/localStorage as the de-facto authority.

## One authoritative head

The canonical schematic head is the persistence envelope in
**IndexedDB** (`BrowserIndexedDbProjectStore`, database
`sirkit-schematic-canonical-v1`, keyed per project/branch): canonical
snapshot, revision, and the full durable transaction log, all
integrity-digest-chained and validated on load. In-memory stores are
test-only injections (the only in-memory branch in production code is the
`typeof indexedDB === "undefined"` non-browser construction fallback, which
real browsers never take — asserted structurally by a test).

`SavedProject`/localStorage is a **projection**. Every save writes the state
together with a `schematicCanonicalMark`
(`{lineageId, headSequence, canonicalStateDigest}`) in one atomic
localStorage write — the mark records which canonical head that projection
has seen.

## Commit ordering

UI state projects only AFTER the durable canonical commit succeeds:
`EngineeringTransactionService.submit` awaits `store.commit` (strict
durability) before the head advances, and the session returns the projected
state + new head mark only from a committed outcome.

- **Pre-commit failure** (`persistence_failed`): neither canonical nor
  visible state changes; the head mark is unchanged; nothing is written.
- **Committed-but-unacknowledged**: the service reloads the store, finds the
  durable record by `clientOperationId`, and returns it as an idempotent
  duplicate — the retry path is exact (tested).

## Reload reconciliation (`openForProject`)

| Envelope | Projection vs head | Outcome |
|---|---|---|
| absent | — | `fresh` — new lineage from the projection |
| valid | projection digest == head projection digest | `resumed` — exact head, sequence and log intact |
| valid | differs, mark ≥ envelope head sequence | `rebased-local-newer` — the projection saw this head and carries newer legacy edits; lineage rebases onto it (also the fail-safe when a mark claims to be AHEAD of the store) |
| valid | differs, mark absent or < envelope head sequence | `recovered-canonical` — the projection is STALE; the canonical head is projected back into the UI and **the stale projection never overwrites it** |
| integrity-failed / non-canonical schematic | — | `recovered-fresh-after-corruption` — fail closed: user-visible message, visible projection preserved, fresh lineage started (prior canonical history is not guessed at) |

Because state and mark are written atomically, a projection that predates
every canonical commit has no mark and is correctly classified stale; a
projection with post-commit legacy edits always carries the matching mark
and correctly wins.

## Project switching

Envelopes are keyed per project/branch; each hydrated project gets a fresh
session and its own lineage. Cross-project isolation over a shared store is
tested (§4.22).

## Undo/redo across reload (documented behavior)

Canonical snapshot, revision, and transaction log survive reload, and the
lineage id resumes when the projection mark matches the head. The session's
undo LINK TABLE (snapshot-digest → transaction) is in-memory: after a
reload, snapshot undo/redo keeps working for the user, and reconciliation of
pre-reload transactions falls back to the deterministic REBASE rule instead
of verified replay (B03.1's fail-closed default). Post-reload transactions
reconcile via verified replay as before.

## Serialized planning (lost-update prevention)

Queued commands build their operations against the canonical head at their
actual execution position. The session keeps the set of known canonical
digests (genesis + every commit edge): a caller whose React snapshot is
merely BEHIND the head (a known canonical ancestor) executes against the
current head — it is never treated as legacy divergence and never rebases
backwards, so two rapid commands serialize against successive heads and the
first edit survives (tested §5.23). Only a genuinely unknown digest (a real
legacy-path mutation) rebases; sealed-proposal applies additionally pin
`expectedBaseDigest`, which is re-verified inside the queue and rejects with
`stale_revision` instead of ever rebasing.
