# B16.0.17.1 §A — Pre-edit counterexample (reproduced verbatim, CONFIRMED)

## The flawed B16.0.17 fixture

```js
{ proposedActions: [{ targetSemanticIds: ["component:unknown"], referencedSemanticIds: [], rationale: "x" }] }
```

This is NOT the `SCHEMATIC_PROPOSAL_TOOL` contract — the declared schema
requires `proposalKind`, `referencedSemanticObjectIds`,
`proposedActions[].actionKind`, `proposedActions[].targetObjectIds`,
`assumptions`, and `warnings`.

## Reproduction (before any edit)

Calling the real `normalizeSchematicChangeProposal` with the flawed fixture:

```
VERBATIM ERROR: TypeError: Cannot read properties of undefined (reading 'map')
```

`raw.referencedSemanticObjectIds` is `undefined` (the fixture spelled it
`referencedSemanticIds` inside the action), so the spread into `new Set(...)`
crashed BEFORE the known-ID check on line 21. A second contributing defect: the
test's `bareGraph` fixture omitted `units` / `portBindings` /
`bundleDefinitions` / `graphId`, which `normalize` also maps — so even a
correct payload would have crashed on the graph shape.

## Consequence

The pin passed only because it accepted any non-200 response. It therefore
proved that malformed provider output crashes — NOT that a well-formed
proposal with an unknown semantic ID reaches and triggers
`CD8_AI_PROPOSAL_REFERENCE_INVALID`. The B16.0.17 report and artifacts
overstated the proof; supersession notes are now appended to each affected
artifact ([superseded-claims.md](superseded-claims.md)).
