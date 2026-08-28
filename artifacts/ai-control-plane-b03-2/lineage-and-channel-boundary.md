# B03.2 — Lineage Identity and Channel Composition Boundary

Authoritative code: `app/lib/engineering/executor.ts` (`deriveExecutorLineageId`,
lineage checks in `executeUndoRedo`), `app/lib/engineering/interactive-channel.internal.ts`
(the ONLY channel module), `app/lib/engineering/editor-adapter.ts` (composition).
Tests: `__tests__/b03-2-boundary.test.ts`.

## 1. Executor lineage identity — enforced invariant

- Every `CanonicalExecutor` has an immutable `readonly lineageId`, fixed at
  construction. The editor session injects its current lineage id into every
  executor it constructs (fresh open, rebase, and exact-head restore — where
  the identity is set from the verified claim BEFORE the executor exists).
- Generic (non-editor) construction receives the deterministic default
  `deriveExecutorLineageId({tenantId, projectId, branchId,
  genesisStateDigest, parent: null})` computed from the service state at
  construction — the check below is NEVER optional. Identity is content +
  parent-chain derived; it is never inferred from project id, transaction
  id, or board digest alone.
- `UndoRedoReplayRequest.expectedLineage.lineageId` is REQUIRED. In
  `executeUndoRedo`, after the tenant/project/branch scope check and BEFORE
  the idempotency short-circuit and any durable-record lookup:
  - empty/missing lineage id → `reference_mismatch`;
  - lineage id ≠ executor's `lineageId` → `reference_mismatch`.
  Consequences (tested): a pre-rebase request cannot replay against the new
  lineage even when project, branch, transaction id, digests, and head
  fields all match; a duplicate idempotency key with the wrong lineage id is
  rejected rather than harvested as an idempotent replay.
- Lineage identity across the persistence boundary:
  - The envelope mirror stamps `ProjectPersistenceEnvelope.lineageId`
    (digest-protected — part of the envelope integrity manifest).
  - `PcbCanonicalHead` v2 carries the same id.
  - Exact-head restore requires claim.lineageId === envelope.lineageId (an
    envelope without one — pre-B03.2 — is refused) and restores the id
    verbatim into the session AND its executor.
  - Fresh open and every rebase mint a new deterministic id
    (`genesis digest + parent` chain); fallback after corrupt/stale
    persistence therefore never collides with the claimed lineage.

## 2. Interactive-channel composition boundary

- `InteractiveUiChannel` and `createEditorSessionChannel` live ONLY in
  `interactive-channel.internal.ts`. The class constructor is private; the
  module-scoped factory is the single creation path (captured in a static
  initialization block — no public static entry point exists).
- The engineering barrel (`index.ts`) does NOT export the module; `executor.ts`
  imports the class for `instanceof` verification without re-exporting it.
  No general factory exists on any supported public surface.
- Approved production importers (everything else fails CI):
  - `app/lib/engineering/executor.ts` (identity verification only)
  - `app/lib/engineering/editor-adapter.ts` (PCB session composition)
  - `app/lib/engineering/schematic-session.ts` (B06: schematic session
    composition — the same editor-session boundary)
  - dedicated security tests under `app/lib/engineering/__tests__/`
- Architectural CI test (`b03-2-boundary.test.ts`): scans every production
  `.ts`/`.tsx` under `app/`, `lib/`, `components/` (excluding tests) and
  fails on any unapproved occurrence of the module specifier
  `interactive-channel.internal` or the factory name — the only two vectors
  for obtaining the capability. A companion test asserts the barrel exports
  neither symbol.
- The capability remains non-serializable (`toJSON` → inert marker; JSON
  round-trips and structural forgeries fail `instanceof` and grant nothing —
  tested against a live executor).

## 3. Honest scope of the boundary

This is an APPLICATION COMPOSITION boundary, not cryptographic DRM. Any
in-process module could technically import the internal file — but such code
already has direct access to the transaction service and could mutate state
without the executor. What the boundary guarantees, with CI enforcement:

- no SUPPORTED public API (barrel, routes, agent runtimes, tool registries,
  workers, command callers) can create or receive the capability;
- no serialized input (request data, tool arguments, model context, traces,
  persisted state) can ever carry it;
- new production imports of the internal module fail the build until the
  approved list — and therefore this document — is deliberately amended.
