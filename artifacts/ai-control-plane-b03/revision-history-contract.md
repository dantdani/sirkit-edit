# B03 — Revision / Change-Set / Undo / Hydration Contract

One coherent lineage for migrated PCB editor mutations. Authoritative code:
`app/lib/engineering/editor-adapter.ts` (adapter), `app/lib/engineering/executor.ts`
(kernel), `app/lib/engineering/transaction-service.ts` (Stage 10 service),
`app/lib/pcb/history.ts` (UI-facing undo), `lib/persistence.ts` (`PcbCanonicalHead`).

## 1. The authoritative change record

For every migrated action the ONE authoritative record is the Stage 10
`DurableTransactionRecord` produced by the canonical executor: transaction
(operations, actor, base revision, deterministic digest), authorization and
validation decisions, the applied `EngineeringChangeSet` (base/result
`ProjectRevision`, created/updated/deleted ids, before/after object versions,
affected nets/layers/bounds, semantic impact flags, dependency keys),
`inverseOperations`, and an integrity digest chained to the previous record.

`PcbHistory` remains the UI-facing adapter. A migrated entry references the
canonical identity: `metadata.transactionId` is the canonical transaction id
and `metadata.details.b03` carries `{ commandId, lineageId, headSequence
before/after, revision digests before/after, changeSetDigest,
invalidatedArtifacts }`. The entry's Immer patches are the UI's synchronous
undo mechanism, not the audit record.

## 2. Revisions and the lineage rule

- Canonical head: Stage 10 `ProjectRevision` (headSequence, headTransactionId,
  `canonicalStateDigest`, per-domain revisions) over a per-editing-session
  in-memory `EngineeringTransactionService`.
- **Lineage digest** (`canonicalLineageDigest`): the board with zone-fill
  DERIVED state normalized out (`fill: []`, `dirty: false`, no
  `fillState`/`fillHash`). Zone refills run through `applyDerived` outside the
  undo log; they are not lineage drift. Everything else (placement, copper,
  nets, outline, stackup, constraints, silk, texts) is lineage-bearing.
- Board ↔ head invariant: after every migrated action the editor board IS the
  canonical result (`replaceBoardContents` inside one `history.execute`), so
  `lineageDigest(board) === lineageDigest(headBoard)`.
- **Rebase rule (the only reconciliation)**: when a legacy-path mutation moves
  the board off the head, the next canonical action (or undo/redo reconcile)
  reopens the service seeded from the current board — a NEW lineage
  (`lineageId` bumps, links cleared), recorded as a `rebased` /
  `reconcile-rebased` adapter event. The adapter never merges or guesses.
- Stale protection: commits are queue-serialized against the live head, and
  the kernel independently refuses `BASE_REVISION_MISMATCH`. A stale mutation
  can never overwrite newer state.

## 3. Undo / redo

- `Ctrl+Z`/`Ctrl+Shift+Z`/`Ctrl+Y` and the toolbar reach the ADAPTER-WRAPPED
  history. Patch undo/redo stays synchronous — identical UI feel, exact state
  restoration (asserted by digest in tests).
- **B03.1:** for a canonical entry the adapter then calls
  `CanonicalExecutor.executeUndoRedo` — a VERIFIED replay contract. The
  request references the durable transaction (id, direction, lineage
  identity, expected head, expected semantic source/result digests, unique
  idempotency key) and carries NO operations; the executor loads the durable
  record, verifies tenant/project/branch scope, lineage position, and both
  digests (including a pure dry-run proving the record's operations reproduce
  the expected state) before anything mutates, then applies the record's own
  inverse (undo) or forward (redo) operations as a NEW transaction
  provenance-linked to the referenced id and direction. Generic `execute()`
  categorically refuses `pcb.undo-redo-canonical`. The replay-verification
  domain is the SEMANTIC state (derived zone-fill lifecycle normalized) —
  the exact-invertible domain of the operation model; head identity and
  stale detection keep the full canonical digest. Records without semantic
  digests (pre-B03.1) are not replayable and fail closed.
- Idempotency key: `undo:{txId}:{occurrence}` / `redo:{txId}:{occurrence}`
  (each occurrence of an undo→redo→undo cycle is its own audit record); a
  duplicate key replays the original result, and reusing a key for a
  different replay is refused.
- Precondition (deterministic, adapter-side defense in depth): head board
  digest must equal the entry's recorded pre-state digest AND the post-undo
  board must equal the entry's recorded base (resp. result) digest. Any
  mismatch — legacy entries interleaved, entry evicted past the 200-entry
  cap, lineage already rebased — falls back to the rebase rule. Undo of a
  NEWER unrelated state can therefore never silently rewind it.
- Legacy entries keep pure patch undo; if the undo lands the board back ON the
  canonical head, no rebase is needed (coherence is re-detected by digest).

## 4. Persistence and hydration (updated by B03.1)

- `PcbWorkingCopy.canonicalHead` (`PcbCanonicalHead`): v1 (B03) is a
  CONTENT-equivalence claim `{ lineageDigest, boardSemanticRevision (pcb2-…),
  headSequence, headTransactionId, canonicalStateDigest }`; v2 (B03.1) adds
  `lineageId`, and together with the durable envelope enables verified
  EXACT-head restoration. See
  `../ai-control-plane-b03-1/head-persistence-contract.md` for the full
  verification checklist and failure modes.
- WRITTEN only by the guarded working-copy autosave, and only when
  `headMetadataFor(board)` confirms the saved board is the canonical head; a
  legacy-path edit yields null and CLEARS the claim. Nothing is written by
  merely opening a project.
- B03.1: every committed canonical transaction also mirrors the full
  validated persistence envelope (snapshot + integrity-chained log) to the
  durable store (IndexedDB in the browser). On reload with a verified v2
  claim, the service REOPENS AT THE EXACT HEAD — same sequence, head
  transaction, state digest, and durable log — and the lineage continues.
  Every verification failure (missing/corrupt/foreign/mismatched envelope,
  v1 claim, no durable store) falls closed to the B03 behavior: a fresh
  content-equivalence lineage at sequence 0, with the rejection recorded.
- Hydration: R06 branch table is unchanged (checkpoint restore > server/working
  ancestry rules; `cancelled` guard against late responses; autosave bails
  until a board exists). When a working copy carrying a claim is adopted, the
  claim is staged against that exact board object and consumed by the next
  history seed; the session VERIFIES the claim against the loaded board —
  stale claims are refused (`claim-stale`) and a fresh lineage derives from
  the board as loaded. The board content is never rewritten by verification.

## 5. Approval policy note (hardened in B03.1)

Destructive-tier commands (`pcb.delete-item`): approval comes from EITHER an
independent `approve_proposal` approval OR the trusted `InteractiveUiChannel`
capability injected into the editor session's executor at composition time —
matching shipped editor behavior (interactive delete never required a second
reviewer, and every migrated delete is undoable through the verified replay
contract). Caller-supplied `actorKind`/`provenance` fields can only NARROW
the channel grant, never create authority; `ai`/`api`/`worker` callers keep
the B02 fail-closed rule. Release-tier commands remain categorically refused
by the kernel; MFG01 keeps manufacturing-release authority. No agent mutation
tool exists or was added. Full threat model:
`../ai-control-plane-b03-1/security-boundary.md`.
