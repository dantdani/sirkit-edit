# Stage 17 Phase D — arrange, command palette, AI assist

## Files

**New:** `app/lib/pcb/edit/{arrange,digest}.ts`, `app/api/pcb/edit/assist/route.ts`,
`app/components/pcb/{CommandPalette.tsx,AssistBox.tsx}`,
`inspectors/ArrangeSection.tsx`, tests `arrange.test.ts`, `digest.test.ts`,
`assist-validation.test.ts` (mocked SDK), `assist-live.test.ts` (opt-in).
**Modified:** `edit/apply.ts` (align/distribute/snap compile through arrange.ts;
bbox helpers moved there; `selectionBBoxCenter` re-exported),
`edit/validate.ts` (arrange ops live), `Inspector.tsx` (Arrange section +
Assist box in footer), `PcbEditor.tsx` (Ctrl+K palette, action registry,
floating assist, context-menu arrange items).

## New exports (pinned)

- `computeAlign(board, refs, mode)` / `computeDistribute(board, refs, axis)` /
  `computeSnapToGrid(board, refs, gridNm)` → `Map<refKey, deltaNm>` — pure;
  align targets the selection bbox union (left/right/centerH act on X,
  top/bottom/centerV on Y), distribute anchors first/last and equalizes
  center spacing, snap moves whole items by their anchor's snap delta.
- `buildDigest(board, selection, {presetId})` → `BoardDigest` (mm values;
  nets with classes + track-width histograms, padstack usage, counts,
  ≤50-item selection detail); `buildItemIndex(board)` → the `query_items`
  index (all items, compact rows).
- `POST /api/pcb/edit/assist` — Anthropic tool-use (claude-sonnet-4-6,
  temperature 0, mirrors Stage 4/10), tools `emit_edits` / `ask_user` /
  `query_items` (max 3), one is_error retry then 422, strict hand-written
  structural validation of every command, explanation truncated to 300.
- Client gate in AssistBox: `compileEdits` against the live board +
  `previewEdits` dry-run; failing output is DISCARDED with a visible message,
  never patched. Apply = one undo entry labeled `AI: <instruction>`.
- `CommandPalette` (Ctrl+K — the only new keybinding): hand-rolled fuzzy
  listbox (~150 lines; cmdk not needed), full keyboard nav,
  disabled-with-reason. Registry covers arrange, select-similar, zoom, DRC,
  autoplace/route, 3D, fab, export, padstacks, grid, layer toggles, assist.

## Measured (gates)

- **Digest: 8,789 bytes** on the 600-instance high-density demo (≤ 20 KB).
- **100-item align: 117.5 ms** through the full applyEdits path (< 200 ms).
- Arrange math unit-tested on known fixtures (align modes, distribute
  spacing, snap preserves geometry — track endpoints move by one delta).
- Malformed-AI-output tests: unknown op → retry → 422; footprint delete
  rejected server-side; hallucinated id passes the server (it can't know the
  live board) and is rejected by the CLIENT gate — board untouched (asserted).

## Blocked / pending

- **Live assist verification** (`assist-live.test.ts`, the four example
  instructions incl. request/response capture) reached the real API but the
  ANTHROPIC_API_KEY in .env.local has **no credit balance** ("credit balance
  is too low"). The route's error path handled it correctly. Once funded:
  `PCB_ASSIST_LIVE=1 pnpm vitest run app/api/pcb/edit/__tests__/assist-live.test.ts`
- Manual browser pass on `?pcbdemo=routed` (click/inspect/palette/assist
  round-trip) — everything headless is covered by the 60 Stage 17 tests.

## Verification

Full suite 445 passed / 6 skipped (2 env-gated DB/live + 4 opt-in live
assist); the only full-run failures across sessions were two pre-existing
wall-clock perf budgets (zone pour < 300 ms, connectivity < 50 ms) flaking
under parallel load on a busy machine — both pass in isolation, both in
untouched code. `pnpm tsc --noEmit` clean. `pnpm build` succeeds.

## Deviations

- Palette is hand-rolled, not cmdk — the permitted dependency wasn't needed
  at this size (fuzzy subsequence scorer + listbox).
- AssistBox also mounts as a palette-launched floating panel (bottom-right)
  because instructions like "make all GND traces 0.5 mm" need no selection
  and the inspector (its pinned home) renders only when one exists.
- `query_items` runs server-side against a client-sent compact index
  (`items` in the request body) — the server never sees the full board, and
  the model only ever references surfaced ids.
