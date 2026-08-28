# B15.2.1 §B/§C — footprint constraints and dimension validation

## §B — canonical footprint constraints (R17)

The real production property is `footprint.placementConstraints`
(app/lib/pcb/types.ts) — NOT the invented `placement` the B15.2 compiler
read and the B15.2 fixtures faked through `never`.

The compiler now reads `placementConstraints` and enforces its production
semantics:

- `fixedPosition` → refuse move AND rotate;
- `mechanical` → refuse move AND rotate;
- `edgeConnector` → refuse unrestricted move (bound to its edge);
- `allowedRotations` → the authoritative allow-list for rotation.

Every fixture that used `placement` is replaced with a TYPE-CORRECT
`placementConstraints` fixture built as a real `PcbBoard["footprints"][number]`
— no `as never` cast on an invalid shape (b15-2-core-closure, b15-2-1).

## Complete transformed envelope

Move and rotate both compute the full courtyard envelope at the NEW
position/rotation via the shared `localCourtyardBBox` +
`worldCourtyardBBox` (with `mirrorX` from `side === "bottom"`) and require
`courtyardFitsOutline`. An anchor just inside the edge whose body would hang
over refuses (§C R12c carried forward; §B rotate envelope added).

## §C — dimension validation, identical for add and update (R19)

`update_dimension` previously skipped rendered-geometry validation. Now both
paths:
1. build the effective candidate dimension (`mergeDimensionUpdate` for the
   partial update);
2. reject a zero-length result;
3. render it through the shared `dimensionGeometry`;
4. validate every rendered point and segment against the exact outline
   authority.

An update to `offsetNm: -200,000,000` whose rendered line leaves the board
now refuses (§C R19); a modest on-board update still succeeds and is written
to the candidate.
