# Layout critic — vision pass → deterministic re-spacing

Date: 2026-06-29 · Status: done (type-checked, lint-clean, unit-tested)

## Goal
"Take a screenshot, run it through Claude so it can suggest moving the
overlapping components before presenting to the user." Built as a **region critic
→ deterministic fix** (the chosen role), consistent with the project's
"agents propose, deterministic code disposes" spine.

## Why not let the LLM move components
Same reason the pin-coincidence guard stayed deterministic: a model (especially a
*vision* model estimating positions from pixels) can't reliably emit exact,
non-colliding grid coordinates. So vision only flags WHAT is crowded (by refDes);
deterministic geometry decides the new positions. The model never sees or emits
coordinates. The electrically dangerous overlaps (coincident pins) are already
handled deterministically — this pass is about READABILITY, not correctness.

## Flow
1. Client rasterizes the live schematic to PNG — clones `#sirkit-schematic-svg`,
   reframes it to the full content bounds via `getBBox()` on the inner `<g>` (so
   the whole circuit is captured regardless of pan/zoom), draws to a canvas.
   (`captureSchematicPng` in `app/page.tsx`.)
2. `POST /api/schematic/layout-critic` with `{ state, image }`.
3. Route sends the image PLUS a ground-truth manifest (every refDes + role +
   bounding box) to Claude vision (`sonnet-4-6`, forced `report_layout_issues`).
   Model returns GROUPS of crowded refDes with a reason + severity.
4. **Verify**: drop any refDes not in the manifest (anti-hallucination). Convert
   the survivors to per-component extra clearance (low 24 / med 44 / high 70 px).
5. **Apply deterministically**: invert the state to its netlist
   (`schematicToBuildNetlist`), re-run `autoLayoutBuildValidated(..., { spread })`.
   The flagged components get a wider courtyard so `resolveComponentCollisions`
   pushes them further apart; everything re-routes from the new positions.
6. **Safety gate**: only return the new layout if it stays electrically valid
   (`validation.ok` and component count preserved). Otherwise the ORIGINAL state
   is returned untouched. Never ship an electrically-worse schematic.

## Files
- `lib/build-auto-layout.ts` — added `spread?: number` on `Sized`, a
  `collisionBox` (= `footprintBox` + per-component spread) used by the de-overlap
  pass, and an `AutoLayoutOptions { spread }` param threaded through
  `autoLayoutBuild` / `autoLayoutBuildValidated`. `spread` affects ONLY the
  collision courtyard — not obstacle/page-fit boxes — so net geometry is untouched.
- `app/lib/prompts.ts` — `LAYOUT_CRITIC_SYSTEM_PROMPT` + `LAYOUT_CRITIC_TOOL`
  (`report_layout_issues`). Prompt forbids coordinates and electrical comments;
  readability/spacing only; empty groups when the layout is clear.
- `app/api/schematic/layout-critic/route.ts` — new route (manifest, vision call,
  verify, spread map, invert + re-layout, safety gate).
- `app/page.tsx` — `captureSchematicPng`, `handleTidyLayout`, `isTidying` state,
  `id="sirkit-schematic-svg"` on the editor SVG, and a **Tidy** button beside
  Review/Ask/Edit/Generate. Applies via the existing `applySchematic` path (logs
  the critique to chat); shows why nothing changed when the gate rejects.
- `scripts/netlist-validation.test.ts` — new test: a flagged component (extra
  spread) is pushed strictly further from its neighbour than the default pass.

## Notes / caveats
- **Tidy re-lays-out from current connectivity.** Because it inverts→re-layouts,
  manual hand-placement is discarded (same tradeoff as a Tier-2 topology edit).
  Acceptable for a "tidy" action; flagged in the chat note.
- **Manual, not auto-run.** A vision call on every generate adds latency + cost,
  so Tidy is an explicit button. Auto-run (debounced, like the Review pass) is the
  natural follow-up if wanted.
- New API route → the Turbopack dev server may need a restart to register it
  (same gotcha as `build-multi`).
- Capture relies on `canvas.toDataURL` of an inline SVG (no foreignObject/external
  refs → no taint); wrapped in try/catch returning null just in case.
