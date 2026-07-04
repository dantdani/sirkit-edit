# Integrate second-opinion suggestions (via validated edit)

Date: 2026-07-04 · Status: done (type-checked; page.tsx unchanged at 19 pre-existing errors)

## Goal
Let the user act on the SchGen cross-verify findings — add the flagged
possibly-missing support parts (decoupling caps, pull-ups, protection diodes) to
improve the generated schematic.

## Design (safe by construction)
Do NOT graft SchGen's netlist raw — its findings are class-level ("possibly
missing a capacitor"), and a mechanical merge could invent shorts. Instead route
the suggestions through the EXISTING validated edit pipeline:
suggestions → natural-language instruction → `handleEditSchematic` → Tier-2
`edit-build` (a frontier model adds the real parts/connections) →
`autoLayoutBuildValidated` (deterministic netlist validation) → `applySchematic`.
Same "agents propose, deterministic code disposes" spine as everything else.

## Change (`app/page.tsx`)
- `pendingSuggestions` state — the warning-severity findings (likely-missing
  support parts) captured in `handleSecondOpinion`; cleared on a new Generate.
- `handleApplySuggestions()` — composes an instruction from the suggestions
  (phrased as "add ONLY if it genuinely improves this circuit; keep existing
  parts/connections") and runs it through `handleEditSchematic` (the validated
  topology-edit path).
- A conditionally-rendered **"Apply suggestions (N)"** button — appears only when
  there are pending suggestions, sits beside 2nd opinion / Review / Tidy.
- Second-opinion chat note now hints "Click **Apply suggestions** to integrate…"
  when actionable findings exist.

## Why it's safe
- The edit model decides the concrete parts/values/connections (design judgment),
  not a blind merge; the instruction says add only if genuinely appropriate (the
  class-level gaps can be false positives).
- `autoLayoutBuildValidated` validates the result — structural faults are caught.
- User-initiated (opt-in), reversible (it's an edit like any other).

## Also fed by Review (so it's usable without the SchGen endpoint)
The button is conditional (`pendingSuggestions.length > 0`), so it stays hidden
until there are actionable findings. Since the SchGen endpoint is flaky
(paused / unparseable output), `handleReview` now ALSO populates
`pendingSuggestions` (its error/warning findings) — Review is Claude-based, no GPU,
works today. So "Apply suggestions" appears after a Review too. The apply
instruction was generalized to cover both additions and fixes.

## Verification
`npx tsc --noEmit` clean · eslint: page.tsx unchanged at its 19 pre-existing hooks
errors (none added).
