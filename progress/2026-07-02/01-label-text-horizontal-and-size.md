# Label text horizontal + size bump

## What this changed
Net labels (power, ground, generic) now render their text horizontally always,
while the flag/arrow rotates with orientation. Text size bumped to 16px bold
(weight 600). Power port and ground symbols scaled up (power wedge 24×32,
ground 28px tall, generic pentagon 1.8x). Connection dot r=4. Stacked labels
stagger 20px so they don't crash into each other, tied back to their pin by a
short wire stub so the exact-position net binding survives.

## Modified files
- app/page.tsx (NetLabelGlyph) — split into a rotating flag group + a
  never-rotating text node; per-glyph transparent hit rects (≥24px thick)
- lib/build-auto-layout.ts — labelExitDirection (inverse of labelOrientation),
  chainClusters + staggerCrowdedLabels; called after PHASE 2 routing, before
  terminal splitting / page fit. Guards skip the stagger when the moved anchor
  would land on live geometry (occupied pointKey), sit strictly inside a
  foreign wire segment (reads as a junction; shorts nets in the KiCad export,
  where labels bind to any crossing wire), or when the stub would swallow a
  foreign wire vertex. Routing detours run ROUTE_CLEARANCE=20px off obstacle
  edges — the same line staggered anchors land on — so this is reachable.

## New helpers
- page.tsx: labelWorldDir(kind, orientation) → world extent direction
  (orientation is per-kind: natural power=north, ground=south, label=east);
  labelTextProps(dir, tip) → x/y/textAnchor/dominantBaseline
- build-auto-layout.ts: labelExitDirection, chainClusters, staggerCrowdedLabels

## Notes / deviations from the prompt
- SchematicCanvas lives inline in app/page.tsx; build-auto-layout is at
  lib/build-auto-layout.ts (not app/lib/).
- Pre-change font was 9px (the assumed 13px bump had not landed); target
  values (16px/600, new glyph sizes) applied as specified.
- Text offsets are computed from actual glyph tip lengths per kind rather
  than the prompt's fixed ±8/20 offsets (glyphs are bigger than assumed).
- Generic labels keep text inside the pentagon when horizontal; vertical
  orientations use a compact pentagon with text past the tip.
- Stagger moves the label anchor, so a pin→anchor wire stub is added
  (labels bind electrically by exact position; validate-netlist requires
  anchors on a pin or wire vertex).

## TODOs
- If labels still crash on tight layouts, may need auto-page-size-upgrade
- Hit target sizes may be tunable

## Verification
- tsc --noEmit clean; pnpm test:netlist 37/37 PASS
- Generate a Build-mode circuit with an STM32/ATmega (many top-pin power pins)
- +3V3 stack: flags vertical toward pins, text horizontal above, alternating
  20px stagger with visible stubs
- Ground labels on bottom pins: symbol hangs down, named grounds read
  horizontally below
- Left/right pin labels: text horizontal, vertically centered on the flag
- Single-click drag-alone and delete-tool behavior unchanged
