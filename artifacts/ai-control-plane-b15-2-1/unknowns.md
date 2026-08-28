# B15.2.1 — unknowns and honest limits

Classification: these are **UNKNOWN**/deliberate-scope items, not open
defects in R17–R21.

1. **Roundrect containment is conservative, not analytic.** The outline is
   polygonised by the shared `outlinePolygon` (16 chord segments inscribed
   in each arc). Containment against that polygon is exact, and because the
   chords are inside the true arc it is CONSERVATIVE — a keepout in the thin
   sliver between chord and true arc is refused. This over-refuses a
   vanishingly small region near rounded corners; it never accepts anything
   truly off-board. A fully analytic arc predicate would remove the sliver
   but is out of scope here.

2. **The internal-sealer import gate approves exactly two modules today**
   (the sealer itself and the service). When B15.3 wires the tool handler /
   apply path, that handler becomes a legitimate importer and the approved
   set must be extended THROUGH the official gate update — the negative
   tripwire ensures the gate keeps failing on any unlisted importer until
   then.

3. **Legacy no-base netClassing is refused, not migrated.** §D refuses a
   rule that would flip a class on a legacy `assignments`-without-`base`
   record, with a precise diagnostic, rather than attempting a migration
   whose semantics are ambiguous. If the product later wants such boards to
   accept rules, a deterministic base-migration must be defined first.

4. **Dimension render traversal is structural.** The check walks whatever
   `dimensionGeometry` returns and validates any `{x,y}` point/polyline it
   finds. If that authority's return shape gained a non-geometric
   point-like field, the check would over-approximate (refuse more), never
   under-approximate.

5. **Everything downstream of the sealed core remains unbuilt** (H–K:
   registry exposure, gateway/loop, `pcb_proposal_ready`, review UI,
   approval/apply, durability/recovery). B15.2.1 is core-only, tool
   unexposed.
