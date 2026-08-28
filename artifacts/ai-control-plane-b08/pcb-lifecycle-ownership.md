# B08 — PCB Lifecycle Adoption Ownership

`adoptBoardLifecycle(reason, board)` in `app/components/pcb/PcbEditor.tsx`
is the ONE typed boundary for board REPLACEMENT (never an ordinary edit):

| reason | source | claims |
|---|---|---|
| checkpoint-restore | BOARD_RESTORE_EVENT / pending restore during load | explicit restore wins over server authority |
| working-copy-restore | loadWorkingCopy (server failed / not found / same ancestry) | verified `PcbCanonicalHead` staged via `pendingCanonicalClaims` |
| server-authority-adoption | verified `loadBoard` record (no working copy, or diverged after `stashWorkingConflict`) | authoritative record cached; divergent local board preserved as a recoverable conflict |
| sync-adoption | `handleApplySync` after CAS-verified apply (`committedBoardRevision`/`Digest` equality) | server CAS authority untouched; browser adopts the VERIFIED returned record |
| qualification-adoption | `handleQualify` reload after RC01–RC03 | authoritative record cached |
| (initial-hydration) | reducer init / demo boards | no claim |

Mechanics (unchanged B03.x machinery, now typed):

- Adoption dispatches a NEW board identity → the history effect reseeds
  `PcbHistory` and binds a FRESH `CanonicalEditorSession`; the old session
  is disposed (its queued work rejects → the gateway maps it to a
  structured refusal — b08 §5 T15). Undo can never cross the replacement.
- Head claims are VERIFIED, never trusted: exact-head restore requires the
  durable envelope to match claim sequence/transaction/digest/lineage
  (B03.1/B03.2); every failure falls closed to a fresh lineage.
- Late outcomes from a previous load generation are rejected by the
  effect's `cancelled` flag; project identity is bounded by the
  project-keyed PcbEditor mount (B07.5).
- Stale service bindings refuse: `usePcbRepair.serviceCurrent` compares
  the captured history against the live one and refuses with a truthful
  toast after any lifecycle replacement.
- Only a board that semantically IS the canonical head persists a claim
  (`headMetadataFor`), so a forged/stale claim can never be minted.
