# B15.2.1 — pre-edit counterexamples (R17–R21, all reproduced)

Probe: a DISPOSABLE vitest file (`b15-2-1-probe.test.ts`, deleted after
capture) against the current production core. Exact outputs verbatim.
Classification: all **CONFIRMED**.

## R17 — wrong footprint-constraint property

```json
{"moveAccepted":true,"rotateAccepted":true}
```

The real property is `footprint.placementConstraints` (app/lib/pcb/types.ts).
The B15.2 compiler read `existing.placement`, and the B15.2 fixtures invented
that non-production property (cast through `never`). A real footprint carrying
`placementConstraints: { fixedPosition, mechanical, edgeConnector, allowedRotations:[0] }`
therefore has EVERY constraint ignored: `move_footprint` and
`rotate_footprint` both return `ok:true` where they must refuse.

## R18 — sampled geometry is not exact

```json
{"narrowNotchCrossingAccepted":true,"collinearRetraceAccepted":true,"vertexOnEdgeAccepted":true}
```

`segmentInsideOutline` samples 64 interior points. Outline: a rectangle
100×80 mm with a 200,000 nm-wide slit at x∈[49,743,750 , 49,943,750],
y∈[5 mm, 80 mm] (a concave notch). Keepout polygon:
`(40,40)–(60,40)–(60,42) mm`. The bottom edge runs across the slit at y=40 mm;
the slit is positioned in the gap between samples 31 (x=49,687,500) and 32
(x=50,000,000), so every sample lands in solid copper and the crossing is
**accepted**. Separately, a retracing polygon `A→B→A→C` (collinear overlap)
and a polygon whose vertex lands on a non-adjacent edge's interior are both
**accepted**, because `segmentsProperlyIntersect` ignores collinear overlap
and endpoint-on-interior contact.

## R19 — update_dimension bypasses rendered-geometry validation

```json
{"offBoardOffsetAccepted":true}
```

`add_dimension` validates the rendered `dimensionGeometry`; `update_dimension`
does not. An existing valid dimension updated to `offsetNm: -200,000,000`
renders far off the board and is **accepted**.

## R20 — rule delta changes unrequested semantics

```json
{"compiled":true,"beforeClass":"Power","afterClass":"Default",
 "beforeClearance":250000,"afterClearance":200000,
 "beforeViaSize":900000,"afterViaSize":800000,"classChanged":true}
```

A legacy `netClassing` with `assignments` but no optional `base` (a valid
PcbBoard representation). A `set_net_class_rule` naming only `trackWidthNm`
runs through `applyRuleDeltas`, which resets the assignment to `base ?? {}`
(empty) → the net's class flips **Power → Default**, and unrequested
`clearance` (250,000 → 200,000) and `viaSize` (900,000 → 800,000) both move.
A bounded operation must never silently change the class or any field the
request did not name.

## R21 — forgeable seal assembly

```json
{"assembleOk":true,"verifiedOk":true,"rawSealerIsExported":true,"rawSealerArtifactVerifies":true}
```

A plain fabricated `compiled` object — empty operations, an
attacker-computed `normalizedOperationsDigest`, an attacker-chosen
`candidateDigest`, a partial attacker impact whose `candidateBoardDigest`
matches, an attacker-computed `impactDigest`, no minted ids —
(1) `assemblePcbEditProposal` returns `ok:true`; (2)
`verifySealedPcbEditProposalIntegrity` returns `ok:true`; (3) the still-public
`sealPcbEditProposal` also produces an artifact that verifies. The "compiler
result" is only a forgeable structural TypeScript shape, and the raw sealer
remains publicly callable — there is no runtime proof the compiler actually
ran.
