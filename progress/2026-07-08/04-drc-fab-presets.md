# Stage 12 — DRC engine + fab presets

## What changed
Batch **design-rule check**: eleven checks (clearance, min track width, via
outer/drill/annular, hole-to-hole, edge clearance, courtyard overlap, silk-over-pad,
unconnected, short) with per-net-class rule overrides, evaluated in one pass; a
**violations panel** with a preset picker, red/amber summary, plain-English rows,
click-to-zoom + item flash, expandable detail, and group-by-kind; and four **fab
presets** shipped as versioned JSON (JLCPCB 2L/4L, PCBWay standard, OSH Park 4L).
`checkClearance` is imported **verbatim** from Stage 7's `route-tool.ts` — not forked.

## New files
`drc/types.ts` (rules/violations/`DrcCheckContext`), `drc/rules.ts` (`effectiveRules`,
`maxClearance`), `drc/format.ts` (mm/layer/id helpers), `drc/run-drc.ts` (engine),
`drc/checks/{clearance,geometry,silk,connectivity}.ts`, `drc/presets/{4×.json,index.ts}`,
`components/pcb/DrcPanel.tsx`, `components/pcb/hooks/useDrc.ts`, 5 test files.

## Modified
- `render/scene.ts` — added `centerOn(world: Vec2, pxPerMm?)` to `PcbScene` (no
  center-on-point existed; mirrors `zoomToFit`). Used by zoom-to-violation.
- **Integration hunks (flagged for Stage 9 owner):**
  `PcbToolbar.tsx` — Run-DRC button (mirrors the autoroute button):
  ```tsx
  {onRunDrc && (
    <button type="button" title="Run design rule check" aria-label="Run DRC"
      onClick={onRunDrc} disabled={drcRunning}
      className={`${iconButtonClass(false)} flex items-center gap-1 disabled:opacity-50`}>
      {drcRunning ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
    </button>
  )}
  ```
  `useAutoroute.ts` — DRC on autoroute success (replaces the `TODO(stage12)` marker;
  `getDrcRules?: () => DrcRules` added to `AutorouteEditor`):
  ```ts
  const drcRules = editorRef.current.getDrcRules?.();
  const drcErrors = drcRules
    ? runDrc(h.present, drcRules).violations.filter((v) => v.severity === "error").length
    : undefined;
  // ...appended to the completion toast: ` · DRC: ${drcErrors} error(s)`
  ```
  `PcbEditor.tsx` — `const drc = useDrc({ scene, getHistory })`; passes `onRunDrc`/
  `drcRunning` to the toolbar, `getDrcRules: () => getPreset(drc.activePresetId).rules`
  to `useAutoroute`, and mounts `<DrcPanel drc={drc} />` under `LayerPanel`.

## New exports (signatures)
`runDrc(board, rules, options?): DrcResult`, `buildDrcContext(board, rules): DrcCheckContext`;
`effectiveRules(rules, netId, netClass): DrcRuleSet`, `maxClearance(rules): number`;
`PRESETS: DrcPreset[]`, `getPreset(id): DrcPreset`, `DEFAULT_PRESET_ID`, `convertMmToNm(mm): Partial<DrcRuleSet>`;
checks: `checkCopperClearance` (clearance + edge), `checkMinTrackWidth`, `checkVia`
(outer/drill/annular), `checkHoleToHole`, `checkCourtyardOverlap`, `checkSilkOverPad`,
`checkUnconnectedAndShorts` — each `(ctx: DrcCheckContext) => DrcViolation[]`;
`useDrc(editor): DrcHandle`, `DrcPanel`. Types: `DrcCheckKind`, `DrcSeverity`,
`DrcRuleSet`, `DrcRules`, `DrcPreset`, `DrcViolation`, `DrcResult`, `RunDrcOptions`.

## Design notes
- Clearance (#1) + edge (#7) reuse `checkClearance` per track/via at batch scope
  (first-offender). Touching different-net pairs (distance ≤ 0) are left to the SHORT
  check, so `clearance` only fires on a real positive gap.
- No SAT helper exists → courtyard overlap models each `courtyardBBox` as a rect
  `PlacedShape` and uses `shapeDistance` (OBB-aware); only same-side pairs compared.
- Silk-over-pad MVP covers line/circle/rect primitives (footprint outlines) via
  `trackShape`+`shapeDistance`; arc/poly/free-text silk deferred; refdes text skipped.

## Verification
- `pnpm test`: 205/205 pass (5 new files, 19 new DRC tests); Stages 1/5/6/7/9/10 green.
- `npx tsc --noEmit` + `eslint` clean.
- **Demo (`?pcbdemo=routed`, jlcpcb-2l)**: `runDrc` measured **12 ms** (< 200 ms), surfaces
  the intentional short as an `error` ("Short: GND touches VCC") + the orphan as an
  `unconnected` `warning`; `ok:false`. All summaries are plain English (test asserts no
  `CLR`/`VIA_`/`DRC_` codes, ≤120 chars). Deterministic sort verified across two runs.
- Dev server serves the demo page 200 with no compile errors (DRC panel renders client-side).

## TODOs
- **Zone-fill checks pending Stage 11** — `TODO(stage11)` marker in `run-drc.ts` where the
  zone-clearance loop goes; zone items skipped for now.
- kicad-cli DRC oracle deferred to Stage 13 (no `// TODO` gate — not blocking).
- **Stage 14 export gate**: the fab dialog should call `runDrc` and refuse Gerber
  generation when `ok:false` (return the `DrcResult`).
- Silk arc/poly/text primitives; pad-to-pad clearance (checkClearance takes only
  track/via candidates); per-fab preset suggestion — all post-MVP.
