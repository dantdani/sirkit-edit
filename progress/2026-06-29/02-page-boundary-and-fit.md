# Page boundary + auto-fit

## What this changed
Added a visible page-size boundary to the schematic canvas (default A4, selectable
A5/A4/A3/A2/A1/US Letter/US Legal). Auto-layout now sizes the sheet to the circuit
and shifts the whole layout inside the printable margin, so generated components no
longer float off-page. The KiCad exporter emits the configured page size instead of
a hardcoded "A3".

## How auto-fit works (deviation from the original plan)
The plan suggested clamping each component's x/y into the boundary. That would break
wire/label routing, which is computed from final pin positions. Instead, after layout
is complete we compute the content bounds, pick the smallest sheet on the A4→A1 ladder
that fits (A4 floor; A1 caps with overflow allowed), then apply a single grid-snapped
**rigid translation** so the content's top-left sits at the margin corner. A rigid
shift preserves every component's grid alignment and every wire route — netlist tests
still pass unchanged.

## New files
- `lib/page-sizes.ts` — `pageSizePx`, `titleBlockPx`, `PAGE_MARGIN_PX` (60),
  `PAGE_SIZE_LADDER`, `fitPageSize`, `planPageFit`. Uses `KICAD_SCALE_PX_PER_MM`
  as the single source of truth for mm↔px.

## Modified files
- `lib/schematic-types.ts` — `PageSize`, `PAGE_SIZES_MM`, `TITLE_BLOCK_MM`,
  `DEFAULT_PAGE_SIZE`, `isPageSize()`, and optional `SchematicState.pageSize`.
  (Optional, not required, so existing state constructors in BomView/tests keep
  compiling — matches how `kicadComponents`/`netLabels` are already handled.)
- `lib/build-auto-layout.ts` — content bounds + `planPageFit` + rigid translate;
  returns the chosen `pageSize`.
- `lib/auto-layout.ts` — same for Theory mode.
- `app/lib/kicad-export.ts` — `(paper "${state.pageSize ?? "A4"}")`.
- `lib/persistence.ts` — `importProjectJSON` validates/migrates `pageSize` (→ A4).
- `app/page.tsx` — `pageSize` state in `Home`; boundary + title-block render in the
  `SchematicEditor` SVG (under everything, non-scaling stroke); top-right page-size
  `<select>` + "Fit" button; `fitToPage()` (mount + on size change); export posts
  `pageSize`; `applySchematic` adopts the layout's `pageSize`.

Note: actual paths are `lib/…` not `app/lib/…` (the plan guessed the latter); the
canvas lives inline in `app/page.tsx`, not a separate `SchematicCanvas.tsx`.

## TODOs / Known limitations
- `PAGE_MARGIN_PX = 60` (~7.6mm) may need tuning.
- Auto-upgrade only walks the A-series ladder; manual US Letter/Legal is export-only
  and a regenerate will reset it to an A-size.
- Regenerating onto the *same* size doesn't auto-reframe (Fit button covers it).
- The user can still drag components past the boundary; KiCad shows them off-page.
- No multi-sheet (hierarchical) support — single page only.

## Verification
- `npx tsc --noEmit` → clean (exit 0).
- `pnpm test:netlist` → ALL PASS (rigid shift preserves electrical correctness).
- `npx eslint app/page.tsx` → 19 pre-existing errors only (refs-during-render /
  setState-in-effect that predate this work); **0 new** problems introduced.
- Manual: canvas shows an A4 boundary by default; generate a Build circuit →
  components land inside it; bigger circuits bump the sheet up the ladder; the
  dropdown + Fit reframe; export `.kicad_sch` opens in KiCad on the matching sheet.
