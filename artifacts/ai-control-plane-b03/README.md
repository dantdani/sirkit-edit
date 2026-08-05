# B03 — Editor Mutation Migration onto the Canonical Executor

Migrates the safest PCB editor vertical slice onto the B02 `CanonicalExecutor`
at runtime while preserving UI behavior, and establishes one coherent
revision/change-set/undo/hydration lineage. Editor-integration stage only: no
agent mutation tools, no prompt/provider changes, no schema migrations, and
manufacturing-release authority is untouched.

## Migrated at runtime (canonical executor is the mutation authority)

| Action | Surfaces | Command |
|---|---|---|
| Move footprint | canvas drag, arrow nudge, inspector position, mixed move | `pcb.move-footprint` |
| Rotate / change side | R key, F key, inspector rotation/side | `pcb.rotate-side-footprint` |
| Track width / layer | track + mixed inspector | `pcb.edit-track` |
| Delete track/via/zone | Delete key, context menu, inspector, palette | `pcb.delete-item` |
| Align / distribute / snap (all-footprint) | inspector, context menu, palette | `pcb.arrange` |
| Undo / redo of the above | Ctrl+Z/Y, toolbar | `pcb.undo-redo-canonical` (new B01 record) |

Flow per action: legacy validator (unchanged messages) → `CanonicalExecutor`
(B01 contract, fail-closed operation binding, authorization, expected
revision, idempotency, atomic persistence) → editor board set FROM the
canonical result in ONE `PcbHistory.execute` → one undo entry referencing the
transaction id and revisions. Failures surface as structured toasts; a
rejected gesture reverts its preview. Duplicate submissions replay
idempotently (no double mutation, no extra undo step).

- Adapter: `app/lib/engineering/editor-adapter.ts`
  (`bindCanonicalEditorSession`, `CanonicalEditorSession`,
  `applyEditsCanonical`, `canonicalLineageDigest`). Sessions are per history
  seed; a WeakMap keys sessions off the wrapped `PcbHistory`, so call sites
  need no new wiring and unbound histories (tests, server repair route) keep
  byte-identical legacy behavior.
- Contract: `revision-history-contract.md` (lineage digest, rebase rule,
  audited undo/redo, `PcbCanonicalHead` persistence, claim verification).
- Full path inventory: `mutation-migration-matrix.csv`.

## Explicitly NOT migrated (exact-representation rule)

Silk-text delete (no text operation in the Stage 10 vocabulary), zone/text
re-layer, mixed-kind arrange/move selections, footprint `locked` patches
(protection capability), route-tool endpoint geometry, and every path outside
the slice (zones, silk, routing, placement apply, sync, schematic, project
lifecycle). These keep their legacy authority — `applyEditsCanonical` falls
back synchronously — and are listed with their gaps in the matrix.

## Policy refinement recorded in B03 (superseded by B03.1)

B03 originally trusted caller-supplied human+`ui` fields for destructive-tier
approval and reopened reload lineages at sequence zero. **B03.1 hardened both**
(see `../ai-control-plane-b03-1/`): destructive approval now requires the
`InteractiveUiChannel` capability injected at editor-session composition
(forged request fields grant nothing), canonical undo/redo executes only
through the verified `executeUndoRedo` replay contract, and reload restores
the EXACT canonical head from the durable envelope when a v2 claim verifies —
falling closed to a fresh lineage otherwise. Release tier remains
categorically blocked.

## Verification

`npx vitest run app/lib/engineering/__tests__/editor-adapter.test.ts` — 18
deterministic tests: slice execution, one-transaction/one-undo batches,
serialized no-lost-update commits, idempotent replay, atomic rollback with
unchanged board/history/artifacts, deterministic derived invalidation,
operation-mismatch refusal, audited undo/redo with digest-verified state
restoration, legacy-entry realign/rebase rules, legacy hydration, verified
and stale head claims, autosave metadata guards, and legacy-path parity.
B01 matrices regenerated (70 records); B01/B02 suites unchanged and green.
