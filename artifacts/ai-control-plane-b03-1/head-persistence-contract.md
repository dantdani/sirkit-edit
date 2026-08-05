# B03.1 — Exact-Head Persistence Contract

Authoritative code: `app/lib/engineering/editor-adapter.ts`
(`persistEnvelope`, `tryRestoreExactHead`), `app/lib/engineering/persistence.ts`
(envelope + integrity chain), `app/lib/engineering/browser-indexeddb-store.ts`
(durable browser store), `lib/persistence.ts` (`PcbCanonicalHead`).

## Persisting

- After EVERY committed canonical transaction (including verified undo/redo
  replays), the session mirrors the full persistence envelope — canonical
  snapshot, current revision, and the complete integrity-chained durable
  transaction log — to the durable store via `restore()` (IndexedDB
  `BrowserIndexedDbProjectStore` in the browser; injectable in tests). The
  envelope is digest-validated on write and on read.
- The working-copy autosave persists `PcbCanonicalHead` **v2**
  (`schemaVersion: 2`): `lineageId` (deterministic content-derived lineage
  identity), `lineageDigest` (fill-normalized board digest),
  `boardSemanticRevision` (`pcb2-…`), `headSequence`, `headTransactionId`,
  `canonicalStateDigest` — and only when the saved board provably IS the
  canonical head. Legacy-path edits clear the claim.
- Merely opening a project writes NOTHING: envelope mirroring happens only
  post-commit, and binding a session never touches persistence. Demo boards
  never receive a durable store.
- Mirror failures are recorded (`envelope-persist-failed`) and non-fatal:
  reload then falls back to a fresh lineage.

## Reloading

`tryRestoreExactHead` runs before any lineage is opened. ALL of the
following must hold, in order; the FIRST failure records `envelope-rejected`
with its reason and falls closed to the B03 content-equivalence behavior
(fresh verified lineage at sequence 0). The loaded board is never modified
by verification.

1. A durable store is configured, and the claim is v2 with a `lineageId`.
2. The envelope loads for THIS project/branch without integrity errors
   (`validatePersistenceEnvelope`: snapshot digest, log digest, per-record
   digest chain, envelope digest, project/branch consistency, head-sequence/
   log-length consistency).
3. Envelope tenant/project/branch equal the session identity (foreign
   envelopes rejected).
4. Envelope head equals the claim: `headSequence`, `headTransactionId`, and
   `canonicalStateDigest` all match (an older claim against a newer envelope
   — or vice versa — is rejected, not reconciled). **B03.2:** the envelope's
   digest-protected `lineageId` must also equal the claim's — an envelope
   without one (pre-B03.2) or with a different one is refused, and the
   restored lineage id is injected into the session's executors as their
   immutable identity.
5. The LOADED board's fill-normalized lineage digest equals both the claim's
   `lineageDigest` and the envelope head snapshot's — the board on disk is
   the board the head describes.
6. The board's `pcb2-…` semantic revision equals the claim's.
7. The service reopens from the restored envelope; failure at this step also
   rejects.

On success the session CONTINUES the persisted lineage: same `lineageId`,
same head sequence/transaction, full durable log restored (`head-restored`
event); the next mutation lands at `headSequence + 1`.

## Downgrade semantics (truthful, fail-closed)

| Condition | Behavior |
|---|---|
| No claim (legacy project) | Open unchanged; fresh lineage; nothing written |
| v1 claim (B03-era) | Content-equivalence verification only; fresh lineage |
| Claim stale for the board | `claim-stale`; fresh lineage from the board as loaded |
| Envelope missing / corrupt / tampered | `envelope-rejected`; fresh lineage |
| Envelope for foreign tenant/project/branch | `envelope-rejected`; fresh lineage |
| Claim/envelope head mismatch (e.g. autosave died before flush) | `envelope-rejected`; fresh lineage |
| Durable store unavailable (no IndexedDB) | Fresh lineage; mirror failures recorded |

A sequence-zero lineage is NEVER described or treated as a continuation of a
previous transaction log — it has a new `lineageId`, no links, and no
replayable records from before.

## Known limitations

- The claim (localStorage autosave, 600 ms debounce) and the envelope
  (post-commit mirror) are written by different paths; a tab killed between
  them yields a mismatch on reload — detected and downgraded, never merged.
- The mirror writes the full envelope per commit (snapshot + log). At editor
  cadence this matches the existing working-copy autosave cost; incremental
  durable commits can adopt `BrowserIndexedDbProjectStore.commit` in a later
  stage without contract changes.
- The UI undo stack (`PcbHistory`) still reseeds on reload (shipped product
  behavior). Exact-head restoration preserves the CANONICAL log and head —
  pre-reload transactions are auditable and position-verified, but the
  in-editor Ctrl+Z stack starts empty; replaying older durable records into
  fresh UI undo entries is future work.
