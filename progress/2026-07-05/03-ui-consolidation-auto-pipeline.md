# UI consolidation — advisory passes run automatically, buttons demoted

Date: 2026-07-05 · Status: done (type-checked; page.tsx unchanged at 19 pre-existing errors)

## Problem
The button row had grown by accretion: Tidy · Review · Check with SchGen ·
Apply suggestions · Ask · Edit · Generate. The sorting principle applied:
deterministic → silent in the pipeline (already true for validator/ERC/pin
guard); cheap advisory → auto-run; expensive/stochastic → explicit but demoted;
judgment-required → explicit.

## Changes (`app/page.tsx`)
- **Auto pipeline**: `autoRunToken` + `autoRunIncludesTidy` ref. Bumped by
  `applySchematic` (generate / Tier-2 edit / apply-suggestions → tidy+review) and
  by Tier-1 attribute-edit apply (review only — attribute edits keep the user's
  placement, so never auto-tidy there). A debounced (1.2 s — lets the SVG render
  for Tidy's screenshot) effect runs `handleTidyLayout(true)` then
  `handleReview(true)`.
- **Loop protection**: `applySchematic` gained `opts.skipAutoRun`; Tidy's own
  apply passes it, otherwise auto-tidy would re-trigger itself on its own output.
- **auto mode semantics**: silent skips + silent errors; tidy posts to chat ONLY
  when it changed something; review posts its findings without the fake
  "Review the circuit" user turn. The review after an auto-tidy reads the
  pre-tidy snapshot — electrically identical by Tidy's validation gate.
- **Buttons removed** from the primary row: Tidy, Review, Check with SchGen.
  Row is now: [Apply suggestions (N) — conditional] · Ask · Edit · Generate · ⋯
- **Overflow "⋯" menu** (manual re-runs): Re-run design review · Re-tidy layout ·
  Second opinion (SchGen). Same disabled conditions as the old buttons.
- **Busy status** replaces the "Enter to ask" hint while a pass runs
  ("Tidying layout…" / "Reviewing design…" / "Consulting SchGen…").
- Menu onClick handlers wrap calls (`() => handleReview()`) so the click event
  can't leak into the new `auto` parameter.

## Resulting flow
Generate → validate → ERC (self-correcting) → layout (validated) → **auto-tidy**
(regression-guarded, silent no-op) → **auto-review** (advisory findings in chat)
→ **Apply suggestions** appears when actionable. SchGen stays a deliberate,
patient action in the menu.

## Verification
`npx tsc --noEmit` clean · eslint: page.tsx at its 19 pre-existing hooks errors
(none added; the pipeline effect carries an exhaustive-deps disable) · no direct
handler refs remain that could pass an event as `auto`.
