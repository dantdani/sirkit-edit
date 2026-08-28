# B16.0.17.1 §B — Real tool-schema fixture (CONFIRMED)

## The corrected fixture

```js
{
  proposalKind: "connectivity",
  referencedSemanticObjectIds: [],
  proposedActions: [{
    actionKind: "connect_pin",
    targetObjectIds: ["component:unknown"],
    rationale: "Attempt to reference an unknown semantic object"
  }],
  assumptions: [],
  warnings: []
}
```

## No drifting duplicate schema

The adversarial suite's `validProposal()` fixture is CHECKED against the
production contract at test time:

```ts
expect(validateSchematicProposalToolInput(validProposal())).toEqual([]);
```

— and `validateSchematicProposalToolInput` itself reads its enums, item caps
and length limits FROM the `SCHEMATIC_PROPOSAL_TOOL.schema` literal, so there
is exactly one source of truth end to end. If the schema ever changes, both the
validator and the fixture check follow it automatically or fail loudly.

## What the corrected pin now proves (all nine §B items)

1. the tool call name is exactly `SCHEMATIC_PROPOSAL_TOOL.name`
   (`propose_schematic_semantic_changes` — the B16.0.17 pin had also initially
   guessed this wrong before correction);
2. the payload satisfies the structural contract (validator returns `[]`);
3. `normalizeSchematicChangeProposal` IS invoked (spy assertion);
4. it reaches the known-ID validation (the structural gate passed first);
5. it rejects specifically with **`CD8_AI_PROPOSAL_REFERENCE_INVALID`** — the
   exact code is pinned at **422**, never `status !== 200`;
6. no proposal is returned (`body.proposal` undefined);
7. `graphMutation`/`diagramMutation`/`pcbMutation` are absent from the refusal;
8. the submitted graph is byte-identical after the call (frozen JSON compare);
9. no transaction or apply path is reached
   (`createSchematicTransaction`/`applySchematicTransaction` never called).

The graph fixture now carries EVERY array `normalize` reads
(`graphId, components, units, pins, nets, sheetInstances, portDefinitions,
portBindings, bundleDefinitions`).


---

## ⚠️ SUPERSESSION NOTE (B16.0.17.2)

The one-source-of-truth claim in THIS document was **overstated**. Independent
verification found that `validateSchematicProposalToolInput` hard-coded a
4,096-character limit for `referencedSemanticObjectIds` and
`proposedActions[*].targetObjectIds` items while the declared tool schema
carried only `minLength: 1` (no `maxLength`) — so the provider-facing strict
schema permitted strings the local validator refused, and those two limits were
NOT schema-derived. B16.0.17.2 closed the drift: `maxLength: 4096` now lives in
the schema nodes themselves, the validator reads min/max from the nodes (no
hard-coded limits remain — gated), and an executable schema-parity gate plus
provider-adapter parity tests prove agreement at the 4,096/4,097 boundaries.
See `artifacts/ai-control-plane-b16-0-17-2/`. The historical text above is
retained as evidence.
