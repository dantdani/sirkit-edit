# B15.2.2 §A — the exact outline contract

`app/lib/pcb/geometry-exact.ts` — `pointInExactOutline` /
`segmentInExactOutline` over an `ExactOutline` (rect | roundrect | polygon).

## What was wrong

B15.2.1 routed ALL outlines through `outlinePolygon` chord vertices, then
ROUNDED them to integers. Two floating-point steps sat inside an
authoritative accept decision, and a rounded chord vertex can land OUTSIDE
the true arc — so the polygon locally bulges beyond the board. The
documented "conservative-exact" property (chords always inside the arc) was
FALSE, and `{x: 96305, y: 18039657}` on an 80×80 mm / r=20 mm roundrect was
accepted while the true authority reported it outside (R22).

## The contract now

| outline | point containment | segment containment |
| --- | --- | --- |
| `rect` | exact BigInt bbox test | both endpoints inside (convex) |
| `roundrect` | exact BigInt bbox test, then — inside a corner square — `dx² + dy² ≤ r²` against the applicable **corner circle**, all in BigInt | both endpoints inside (convex) |
| `polygon` | the proven BigInt even/odd ray cast | the full boundary-parameter algorithm (handles arbitrarily narrow concavities) |

- **No trigonometry, no chords, no rounding of the outline** in any
  authoritative accept decision. The board outline is passed through as-is.
- The corner radius is clamped exactly as the product's own roundrect model
  does (`min(r, w/2, h/2)`), computed in BigInt.
- **Convexity invariant (explicit and permanently tested):** rect and
  roundrect are convex, so a segment lies inside iff both endpoints do
  (§A R22d). Polygons make no such assumption and keep the full algorithm
  (the B15.2.1 narrow-notch regression, §A R18a, remains green).

## Evidence

- The exact R22 coordinates now refuse, and the compiler refuses a keepout
  containing them (§A R22).
- **A ~9,900-point fuzz** across six outlines — two origins (including a
  negative-origin translation), manufacturing-scale and small radii
  (20 mm, 0.5 mm), the degenerate `r = w/2 = h/2` case, `r = 0`, and a plain
  rect — asserts `pointInExactOutline` NEVER disagrees with the existing
  true `pointInOutline` authority (§A R22b).
- Points exactly ON the true arc (constructed with a 3-4-5 Pythagorean
  triple scaled by r/5, so the on-arc integer point is exact), one nanometre
  inside, and one nanometre outside are each classified correctly, at all
  four corners (§A R22c).
- A keepout wholly inside a roundrect still compiles (§A R22e) — the fix is
  not blanket over-refusal.

Increasing the chord count is explicitly NOT the fix and is not used.
