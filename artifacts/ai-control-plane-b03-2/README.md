# B03.2 — Final Boundary Closure: Enforced Lineage Identity + Channel Composition Boundary

Closes the two boundary gaps B03.1 verification found. No new migration, no
agent tools, no provider/prompt changes, no manufacturing-release changes,
and no B01 registry metadata changes (action coverage did not change).

## 1. Lineage identity is now an enforced executor invariant

`CanonicalExecutor` carries an immutable `lineageId` fixed at construction:
injected by the editor session (fresh open and rebase mint a new
deterministic content+parent-derived id via `deriveExecutorLineageId`;
exact-head reload restores the persisted id verbatim — set before the
executor is constructed), or defaulted deterministically from the service
state for generic users, so the check is never optional.
`UndoRedoReplayRequest.expectedLineage.lineageId` is now REQUIRED and
compared to the executor's identity after the scope check and **before the
idempotency short-circuit and any durable-record lookup**: missing or
mismatched ids return `reference_mismatch`. A pre-rebase request cannot
replay — or harvest idempotent results — against the new lineage even when
project, branch, transaction id, digests, and head fields all match.
Persisted v2 claims and mirrored envelopes must agree on the lineage id
(`ProjectPersistenceEnvelope.lineageId`, digest-protected); disagreement
fails closed to a fresh lineage with a new identity.

## 2. Interactive-channel creation is restricted to the composition boundary

`InteractiveUiChannel` moved out of the public API into
`interactive-channel.internal.ts` — not exported by the engineering barrel,
private constructor, single module-scoped factory
(`createEditorSessionChannel`), no general public factory. Approved
production importers: `executor.ts` (identity verification) and
`editor-adapter.ts` (session composition). An architectural CI test scans
all production sources and fails on any other import of the module or
factory; a second test asserts the barrel exports neither. The capability
stays non-serializable, and forged/round-tripped objects grant nothing
against a live executor. Documented honestly as an application composition
boundary (not DRM) in `lineage-and-channel-boundary.md`.

## Verification

`npx vitest run app/lib/engineering/__tests__/b03-2-boundary.test.ts` — 10
tests covering all 14 required scenarios (several were already enforced by
the B03.1 suite, which remains green and was updated for the required
lineage field). Full engineering suite 105/105; B01 matrices unchanged;
`npx tsc --noEmit` clean; ESLint clean; full repo suite green.
