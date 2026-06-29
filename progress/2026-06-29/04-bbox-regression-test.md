# Bbox sizing regression test

**Date**: 2026-06-29 · **Status**: Shipped · Follow-up to
[03-bbox-aware-routing](./03-bbox-aware-routing.md).

## What this adds
Locks in `componentBodyBox` so the routing/collision obstacle box can't silently
regress to the pin-tip sliver that let wires route through one-sided parts. Eight
`check()` cases in `scripts/netlist-validation.test.ts`, exercising the exact
geometry the routing fix was verified against (box dims are placement-invariant,
so they're read off a part at the origin):

1. **With graphics** → box matches the drawn symbol body:
   2-sided IC 80×160, USB-C 60×94, switch 60×55, regulator 40×40.
2. **Without graphics** (one-sided / malformed symbol) → pin extents + padding:
   3 west pins span 0×40px, padded 30/side → 60×100 (not a sliver).
3. Both cases are body-sized (≥50px each side), never the old ~24px sliver; plus a
   rotation check (IC at 90° → 160×80).

## Implementation note (one small code change)
To make case 2 a real guarantee, `componentBodyBox` now pads pin extents by
`BODY_FALLBACK_PAD = 30` when a symbol has no readable body graphics. Previously
the graphic-less path returned raw pin extents (min-clamped to 24px in
`obstacleFor`), so a graphic-less one-sided part still slivered. Real catalog
symbols carry graphics, so this only affects the malformed/missing path; the
verified graphics-path values (60×94, etc.) are unchanged.

## Modified files
- `scripts/netlist-validation.test.ts` — imports `componentBodyBox`; new
  "componentBodyBox: body-accurate obstacle sizing" section (8 checks).
- `lib/build-auto-layout.ts` — `BODY_FALLBACK_PAD` + graphic-less padding fallback
  in `componentBodyBox`.

## Verification
- `pnpm test:netlist` → ALL PASS (8 new bbox checks + the prior suite, no regression).
- `npx tsc --noEmit` clean; `eslint` on both files clean.
