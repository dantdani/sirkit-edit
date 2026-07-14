# Stage 17 Phase B — inspector + field primitives + live preview DRC

## Files

**New:** `app/lib/pcb/edit/preview.ts`, `app/components/pcb/Inspector.tsx`,
`inspectors/{Via,Track,Pad,Footprint,Zone,Text,Mixed}Inspector.tsx`,
`inspectors/shared.ts`,
`inspectors/fields/{NumberField,SelectField,LayerField,PadstackField,BooleanField,ReadonlyRow}.tsx`,
`hooks/{useSelection,useLivePreview}.ts`.
**Modified:** `PcbEditor.tsx` (inspector mounted in the right column between
LayerPanel and the DRC panel), `edit/apply.ts` (+`dryRunEdits`),
`hooks/useDrc.ts` (+`restoreSelection` after the zoom-to flash),
`vitest.config.ts` (`.test.tsx` + jsx transform), `package.json`
(devDeps: @testing-library/react, @testing-library/dom, jsdom).

## New exports (pinned)

- `previewEdits(board, cmds, rules?): { errors, violations }` — dry-run on a
  throwaway immer draft + SINGLE-ITEM-SCOPE checks: landed Stage 12
  `checkMinTrackWidth`/`checkVia` over a scoped board + Stage 7
  `checkClearance` per touched item (never full `runDrc`). Pure — the Phase D
  AI gate calls this exact function. `previewSummary(preview)` → hint line.
- `dryRunEdits(board, cmds): PcbBoard` (apply.ts) — validated-batch dry run.
- Field convention: all primitives take ARRAYS and speak commands; mixed ⇒
  '—' placeholder (indeterminate checkbox for booleans); Enter/blur commits
  to all; Esc reverts; `preview` prop runs the pending value through
  `useLivePreview` (150 ms debounce) — warnings render under the field and
  never block.

## Verification gate

- `pnpm vitest run`: preview 8/8, fields-multivalue 8/8,
  inspector-commands 6/6. Full suite 64 files / 408 passed / 2 skipped.
  `pnpm tsc --noEmit` clean.
- **Measured preview latency: 4.48 ms** for a width edit across all 15 routed-
  demo tracks (gate target < 20 ms compute + 150 ms debounce). Printed by
  preview.test.ts on every run.
- Warning appears < 150 ms typing 0.10 mm under jlcpcb-2l (fake-timer test:
  debounce fires at exactly 150 ms) and the commit still lands; the same
  violation then appears in a batch `runDrc` (asserted).
- Every inspector edit is one history entry (undo restores pre-edit widths
  for a 2-track batch commit — asserted).

## Deviations

- Inspector column stays the landed 240 px (`w-60`) right column, not 280 px —
  "match the landed panel column" won.
- Via dims are read-only rows in B (no set-via-dims command exists; dims edits
  ARE the Phase C padstack fork rule). PadstackField ships as a shell that
  renders "None yet" until the C migration populates the library.
- Component tests needed jsdom + RTL devDeps and a vitest include widening —
  the repo had node-env vitest only. `.test.tsx` files opt into jsdom via
  docblock.
- Zone clearance field shows the EFFECTIVE clearance (override ?? net-class)
  and always writes an override — clearing an override back to "inherit" is
  not expressible yet (needs a nullable patch field; deferred).
- `ingest-integrity.test.ts` timeout 5 s → 30 s: the remote-DB test flaked
  under full-suite parallelism (passes solo); pre-existing, unrelated.
