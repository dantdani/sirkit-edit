# B03.1 — Security Boundary

Authoritative code: `app/lib/engineering/executor.ts` (kernel gates,
`InteractiveUiChannel`, `executeUndoRedo`), `app/lib/engineering/editor-adapter.ts`
(session composition). Tests: `__tests__/b03-1-hardening.test.ts`.

## What is NEVER trusted

Every field of an execution request is caller-controlled DATA:
`actor.actorKind`, `actor.role`, `provenance.source`, approvals arrays,
digests, ids. B03.1 removes all security decisions that *granted* authority
from these fields. They may only NARROW a grant (deny), never create one.

## Destructive-tier approval

Two authorities, no third path:

1. **Independent approval** — an `approve_proposal` approval from an actor
   other than the requester (B02 rule, unchanged). This is the ONLY path for
   API, AI, worker, automation, and any executor constructed without a
   channel.
2. **`InteractiveUiChannel`** — a capability object created by trusted
   application composition (the editor-session constructor creates one
   privately and injects it into that session's executors). **B03.2:** the
   channel lives exclusively in `interactive-channel.internal.ts` — private
   constructor, single module-scoped factory, NOT exported from the
   engineering barrel, with an architectural CI test failing any production
   import outside `executor.ts`/`editor-adapter.ts` (see
   `../ai-control-plane-b03-2/lineage-and-channel-boundary.md`). Properties:
   - It is a branded class instance. Request data — deserialized JSON, tool
     arguments, model context, traces — can never contain one; `toJSON()`
     yields an inert marker, so it cannot leak into serialized state,
     browser persistence, or logs as a reusable secret. A structurally
     forged object fails `instanceof`.
   - Scope: approves only destructive-tier commands that are already
     kernel-executable (shipped, reversible, canonically undoable UI
     behavior — today: `pcb.delete-item` for track/via/zone). Release-tier
     commands are categorically rejected BEFORE the approval gate and are
     unaffected by any channel.
   - The executor additionally requires `actorKind === "human"` and
     `provenance.source === "ui"` WHEN a channel is present — deny-only
     narrowing: a channel-held executor still refuses ai/api/worker
     provenance and non-human actors; a channel-less executor refuses
     regardless of what the request claims.
   - In-process composition rule: `createEditorSessionChannel` is called
     ONLY from `CanonicalEditorSession`'s constructor. Route handlers, agent
     tools, and API surfaces must never construct one — since B03.2 this is
     enforced by an architectural CI import scan, not review convention.

## Canonical undo/redo — verified replay only

`pcb.undo-redo-canonical` is unreachable through generic `execute()`
(rejected `unverified_replay` before any other processing). The only path is
`CanonicalExecutor.executeUndoRedo(request)`, where the request REFERENCES a
durable transaction and carries no operations:

1. Scope: request lineage identity (tenant/project/branch) must match the
   service — cross-project/cross-lineage requests are rejected before lookup.
   **B03.2:** `expectedLineage.lineageId` is REQUIRED and must equal the
   executor's immutable lineage identity — checked before the idempotency
   short-circuit and any record lookup, so pre-rebase or forged lineages can
   neither replay nor harvest idempotent results.
2. Idempotency: a duplicate key replays the original applied transaction;
   reusing a key for a different reference/direction is rejected.
3. Reference: the durable record must exist in THIS lineage's log, belong to
   this project/branch, and have been applied (`accepted` + change set).
4. Head identity: `expectedHeadRevision` must match the current head
   (full-revision equality — stale requests rejected).
5. Position: the current head's SEMANTIC state digest must equal the
   record's result (undo) / base (redo) semantic digest.
6. Digests: caller-expected semantic source/result digests must equal the
   record's own; then a pure dry-run proves the record's operations
   reproduce the expected result BEFORE anything mutates.
7. Operations: selected exclusively from the durable record
   (`inverseOperations` for undo, original operations for redo). Smuggled
   request fields are inert (tested).
8. The applied transaction is provenance-linked
   (`candidateId: "{direction}:{referencedTransactionId}"`) — durably audited.

Semantic domain: geometry operations re-mark derived zone fills dirty on both
apply and inverse-apply, so a recorded inverse is exact over the SEMANTIC
state (zone-fill lifecycle normalized — `semanticStateDigest`), and only over
it. Records created before semantic digests existed are NOT replayable and
fail closed to the adapter's rebase rule. No inverse is ever invented or
approximated.

## What a forged request can achieve

Nothing beyond B02 baseline: a caller with in-process access to a service
could always mutate state directly — the boundary defends the EXECUTION
CONTRACT (auditability, approval policy, replay integrity), ensuring no
serialized or model-mediated input can (a) execute destructive commands
without approval, (b) submit fabricated "undo" operations, or (c) claim an
exact-head lineage it cannot prove (see head-persistence-contract.md).
