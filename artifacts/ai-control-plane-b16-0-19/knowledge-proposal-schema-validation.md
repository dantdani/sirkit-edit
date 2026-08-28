# B16.0.19 §D — Knowledge-proposal schema validation (CONFIRMED)

## Shared authority (new)

`app/lib/circuit-knowledge/agent-tools.ts` now owns
`CIRCUIT_RECIPE_CLAIM_TOOL` (name + description + strict schema — previously
inlined in the route) beside its validator
`validateCircuitRecipeClaimToolInput`, which derives required fields,
additionalProperties, min/max items and string bounds FROM the schema nodes.

## Security tightening (schema-side, per the mandate)

`sourceEvidenceRefs.items`, `sourceLocationRefs.items`, and
`reviewerQueueIds.items` were previously UNBOUNDED strings; they now declare
`minLength: 1, maxLength: 300` in the schema itself — mirrored automatically
by the validator (no parallel limit).

## Route flow

```
generate() own try/catch → providerErrorResponse (503 envelope)
no typed tool call → historical 422
validateCircuitRecipeClaimToolInput → 422 CIRCUIT_CLAIM_OUTPUT_INVALID
  (diagnostics ≤20×200 field names, no payload echo)
createProposedRecipeClaim + validateClaimPromotion own try/catch →
  traceability failure keeps its historical 422 diagnostics response;
  unexpected throw → 422 CIRCUIT_CLAIM_OUTPUT_INVALID (bounded)
success → proposal_only + publicationEligible false + provider header
```

## Adversarial proof

Fixture schema-checked in-suite; boundaries data-driven from the nodes
(at/over 300 on all three ref arrays, minItems, required iteration,
additionalProperties); malformed cases → 422 `CIRCUIT_CLAIM_OUTPUT_INVALID`
never a provider classification; provider rejection → 503 envelope.
