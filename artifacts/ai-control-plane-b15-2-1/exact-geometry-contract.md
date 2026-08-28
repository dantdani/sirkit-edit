# B15.2.1 §A — exact geometry contract

`app/lib/pcb/geometry-exact.ts` — ONE shared authority of BigInt integer
predicates. No finite sampling anywhere.

## Why BigInt

Coordinates run to ±10^10 nm (the parser's ceiling). A cross product of two
such coordinates reaches ~10^20, far past Number's safe-integer range
(9.0×10^15). Every orientation (`cross`), shoelace area, on-segment test,
segment/segment classification, and ray-cast comparison is computed in
BigInt, so sign and area can never be lost at any allowed magnitude. The
project targets ES2017, so BigInt literals are avoided (`ZERO`/`ONE`/`TWO`
constants via `BigInt(...)`).

## The outline is the SHARED authority

The board outline is converted to an integer polygon by the existing shared
`outlinePolygon` (app/lib/pcb/zones/geometry.ts) — this module defines no
second outline model. For a roundrect, `outlinePolygon` inscribes chords in
the true arcs, so requiring containment in that polygon is CONSERVATIVE
(stricter, never looser): a keepout/dimension in the sliver between chord
and arc is refused, which is the safe direction. 16 corner segments are used.

## Segment-in-outline is exact, not sampled

`segmentInClosedPolygon(a, b, poly)`:
1. both endpoints must be in the closed polygon;
2. collect EVERY parameter `t ∈ [0,1]` at which the segment meets the
   boundary — transversal crossings (rational `t = n/d`, kept exact) and
   collinear/vertex touches;
3. for each consecutive pair of parameters, test the exact rational midpoint
   (scaled into one BigInt space by the common denominator) for closed
   containment.

Because the boundary-crossing parameters are computed, not sampled, an
arbitrarily narrow concavity produces a sub-interval whose midpoint falls
outside — and is rejected. R18's 200,000 nm slit, placed exactly in the gap
between the old 64 sample positions, now refuses (§A R18a). A larger sample
count is explicitly NOT the fix.

## Simple-polygon validity

`validateSimplePolygon(poly)` refuses: fewer than 3 vertices, any repeated
vertex, any zero-length edge, zero shoelace area, proper self-intersection,
and — for adjacent edges — any contact beyond the single shared vertex
(retrace / collinear overlap / far-endpoint-on-edge), and — for non-adjacent
edges — ANY intersection at all (proper OR touch), which covers
endpoint-on-interior contact. The retrace `A→B→A→C` (§A R18b) is caught by
the repeated-vertex rule; the vertex-on-edge polygon by the non-adjacent
touch rule.

## Consumers

`bounded-edit-compiler.ts` routes keepout-edge containment, keepout-polygon
validity, footprint-envelope points, and every rendered dimension point/
segment through these predicates. `withinBoard`/`segmentInsideOutline` are
thin wrappers over `pointInClosedPolygon`/`segmentInClosedPolygon` on
`boardPolygon(board)`.

---

> **SUPERSEDED IN PART (B15.2.2).** The section "The outline is the SHARED
> authority" claimed that polygonising a roundrect with inscribed chords is
> CONSERVATIVE (stricter, never looser). That is wrong once the chord
> vertices are ROUNDED to integers: a rounded vertex can fall outside the
> true arc. Roundrect (and rect) containment is now decided by exact BigInt
> corner-circle predicates in the same module — `pointInExactOutline` /
> `segmentInExactOutline` — and the compiler no longer polygonises the
> outline at all. The polygon algorithm documented here is unchanged and
> still authoritative for genuinely polygonal outlines. See
> `../ai-control-plane-b15-2-2/exact-roundrect-contract.md`.
