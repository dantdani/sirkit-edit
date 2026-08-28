# B15.2.2 — pre-edit counterexamples (R22, R23) — both CONFIRMED

Probe: a DISPOSABLE vitest file (`b15-2-2-probe.test.ts`, deleted after
capture) against current production code.

## R22 — roundrect polygonization accepts TRUE off-board geometry

Outline `{ kind: "roundrect", width: 80000000, height: 80000000,
cornerRadius: 20000000, origin: { x: 0, y: 0 } }`; keepout vertex
`{ x: 96305, y: 18039657 }`.

```json
{"trueOutlineInside":false,"polygonInside":true,"compilerAccepted":true}
```

- **true-outline result** — `pointInOutline` (the existing exact roundrect
  authority): **false**, the point is genuinely off-board.
- **polygonized-outline result** — `pointInClosedPolygon` over
  `outlinePolygon(outline, 16)` with rounded vertices: **true**.
- **compiler result** — `compileBoundedPcbEdit` with a small keepout
  containing that vertex: **ok:true**, accepted.

Cause: `outlinePolygon` computes chord vertices with floating-point
trigonometry and the compiler ROUNDS them to integers. A rounded vertex can
land OUTSIDE the true circular arc, so the polygon locally bulges beyond the
board. The B15.2.1 "conservative-exact" claim (chords always inside the arc)
is therefore **false** — the approximation can be looser, not merely
stricter.

## R23 — malformed nested proposals verify

A genuine proposal from `createSealedPcbEditProposal`, then three copies
with all affected public checksums recomputed with the existing public
digest algorithm (`engineeringDigest({schema:
"sirkit.pcb-bounded-edit-proposal-id.v1", body})`, and the
operations digest where the operations changed):

```json
{"malformedScope":{"ok":true},"wrongTypes":{"ok":true},"evilOperations":{"ok":true}}
```

1. `scope` replaced with `{tenantId: 7, projectId: null, branchId: [],
   boardInstanceId: {}}` → **ok:true**.
2. `actor`/`discovery`/`provenance` nested values replaced with wrong types
   (`actorId: 1`, `kind: null`, `digest: []`, `contextDigest: 3`,
   `provider: {}`, `model: 9`, `runId: 5`) → **ok:true**.
3. `operations` replaced with `[{kind: "evil_operation", payload:
   {arbitrary: true}}]` and `operationsDigest` recomputed → **ok:true**.

Cause: verification checked the closed KEY SET, the tool identity, the
digests, the TTL window, and the impact's field shapes — but never the types
or permitted values of `scope`, `base`, `actor`, `effectiveActor`,
`discovery`, `provenance`, or the operations themselves. Any body whose
checksum is recomputed passes.

This is a STRUCTURAL-VALIDATION failure. The digest is an integrity
checksum, never authentication — human approval capability and live
reauthorization remain the mutation authority; that architectural statement
is unchanged and is preserved in the closure.
