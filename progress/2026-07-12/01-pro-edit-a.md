# Stage 17 Phase A — edit-command layer + global selection

## Files

**New:** `app/lib/pcb/edit/{commands,validate,apply,describe}.ts`,
`app/lib/pcb/selection.ts`, `app/lib/pcb/selection-queries.ts`,
`app/lib/pcb/padstack/types.ts` (pinned types only; registry lands in C),
`app/components/pcb/ContextMenu.tsx`, `docs/pcb-post-mvp.md`.
**Modified:** `render/pick.ts` (copper picking), `render/scene.ts`
(`setSelectionRefs`, per-kind outlines, copper pick index), `tools/select-move.ts`
(global store, Ctrl-add, dbl-click net, right-click, copper delete),
`PcbEditor.tsx` (store wiring + menu), `types.ts` (+`Via.padstackId?`,
+`FootprintInstance.locked?` — additive/optional).

## New exports (pinned)

- `EditCommand`, `SelectionRef`, `EditResult`, `refKey/sameRef` (commands.ts)
- `validateCommand(board, cmd): string[]` — unknown ids / footprint-delete /
  pad-move / NaN·neg dims / illegal layers (stackup-aware) / locked fp rejected
- `applyEdits(history, cmds, labelOverride?): EditResult` — validates ALL, then
  ONE `history.execute()`; `liveRefs(board, refs)` prunes dead selections
- `describeEdits(board, cmds): string` — "Set width 0.3 mm on 5 tracks"
- `createSelectionStore(): SelectionStore` — `get/replace/add/toggle/remove/
  clear/subscribe`, `SelectionSet = { refs, primary }`, insertion-ordered
- `getItems`, `sharedNetId/sharedLayer/sharedPadstackId`, `selectSimilar(board,
  ref, 'net'|'padstack'|'layer')`, `selectNet` (selection-queries.ts)
- `buildBoardPickEntries(board, tolNm)`, `PICK_TOLERANCE_NM` (pick.ts);
  `PcbScene.setSelectionRefs(refs)`; pick priority
  via > pad > track > text > footprint > zone, 0.15 mm at-cursor tolerance

## Verification gate

- `pnpm vitest run` new suites: **31/31 green** (edit-commands 14, selection 8,
  pick-copper 9). Seeded 20-command batch → exactly one history entry; undo
  deep-equals original; redo deep-equals after-state.
- Full suite: 381 passed / 2 skipped (ingest-integrity DB test flaked once on
  Supabase latency, passes on rerun). `pnpm tsc --noEmit` clean.
  `pnpm build` succeeds.
- Adversarial review workflow (4 lenses) on the staged diff: 15 raw findings
  (4 were the same right-click bug). The skeptic-verify stage hit session
  limits, so every finding was hand-verified against the code instead. Fixed:
  right-button events never reached the tool (PcbEditor's left-only guard);
  right-click mid-drag now cancels the gesture; gesture paths (drag/R/F/
  arrows) honor `locked`; `patch.locked` type-checked at the AI boundary;
  silk `mirror` follows layer changes; phantom empty context menu closes;
  overlay redraw uses O(board) lookup maps; zone pick bbox exact for marquee
  containment; DRC flash restores the ref selection; net-0 double-click and
  select-similar stay single-item; pad outlines read live drag transforms.
  Documented (spec-pinned, not fixed): duplicate pad numbers collapse to the
  first match — `SelectionRef` keys pads by number.

## Deviations

- Selection accent uses landed `ACCENT_COLOR` 0x14b8a6 (teal-500) — the stage
  doc's "#2dd4bf" appears nowhere in the codebase; landed convention wins.
- 'text' SelectionRefs target Stage 16 **silk text items** (`board.silkItems`);
  legacy `board.texts` is exporter-only and stays unselectable.
- `Via.padstackId?`/`FootprintInstance.locked?` added in A (commands reference
  them); Phase C's types.ts budget now only needs `board.padstacks`.
- Track selection outline is a teal halo (α 0.45), not a 2 px capsule outline —
  crisper at sub-0.3 mm widths; vias/pads/zones get true shape outlines.
- Deleted `scripts/_tmp-story-e2e.ts`: self-described Stage 16 throwaway,
  committed broken (imports a nonexistent `applyPlacements`), blocked the tsc
  gate. Restorable from git history.
- Picking ignores layer visibility (hits hidden-layer copper) — deferred, noted
  in docs/pcb-post-mvp.md.

## Notes for B–D

- Phase C/D command ops exist in the union; `validateCommand` rejects them with
  "isn't available yet (Stage 17 Phase C/D)" — flip there, not in apply.ts.
- Active DRC preset lives in `useDrc` state (`drc.activePresetId`) — thread it
  into `previewEdits` as a prop, don't reach for a store.
- No RTL/jsdom in the repo; Phase B's .test.tsx gates need
  `@testing-library/react` + `jsdom` devDeps and a vitest include widening.
- cmdk NOT vendored; no shadcn Command. Phase D palette: hand-roll or cmdk ^1.
