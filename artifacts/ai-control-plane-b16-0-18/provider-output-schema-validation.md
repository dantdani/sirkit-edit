# B16.0.18 §E — Strict provider-output validation (CONFIRMED)

The B16.0.17.1/.2 lesson applied DURING this stage, not afterward.

## The validator (one source of truth)

`validateComponentSearchProposalToolInput` lives beside
`COMPONENT_SEARCH_PROPOSAL_TOOL` in
`app/lib/component-selection/agent-tools.ts` and derives EVERY constraint from
the schema nodes at call time: required fields (`schema.required` iterated),
`additionalProperties: false` (unexpected keys refused), each array's
`maxItems`, and each string's `minLength`/`maxLength` — no hard-coded parallel
limit. The schema already declared complete bounds (roleRequirementId 1..300;
categories ≤16×120; exactAtomicRevisionIds ≤128×300; manufacturerIds ≤64×300;
rationale/missingEvidenceRequests ≤32×500), so no schema additions were needed.

## The route flow (§D/§E separation)

```
generate() own try/catch      → providerErrorResponse (503 envelope)
no typed tool call            → historical 422
validateComponentSearchProposalToolInput → 422 COMPONENT_PROPOSAL_OUTPUT_INVALID
                                 (diagnostics ≤20×200 field names, no payload echo)
createCatalogSearchProposal own try/catch →
  CD6_AGENT_ROLE_OUT_OF_SCOPE / CD6_AGENT_ATOMIC_REVISION_OUT_OF_SNAPSHOT /
  CD6_AGENT_PROPOSAL_LIMIT_EXCEEDED → 422 with that exact code
  anything else → 422 COMPONENT_PROPOSAL_OUTPUT_INVALID (bounded generic text)
success → unchanged proposal_only response + provider header
```

## Adversarial proof (15 tests, REAL validator + REAL factory)

- fixture schema-checked in-suite (`validate(...) === []`);
- data-driven boundaries: at/over `items.maxLength` and at/over `maxItems` for
  ALL five array fields + roleRequirementId 300/301; required-field removal
  iterated from the schema; unexpected key refused;
- malformed outputs (missing/wrong-type/oversized/non-object/unexpected-key) →
  422 `COMPONENT_PROPOSAL_OUTPUT_INVALID`, never a provider classification
  (no `provider`/`retryable` fields, asserted);
- unpinned role → 422 `CD6_AGENT_ROLE_OUT_OF_SCOPE`; out-of-snapshot revision →
  422 `CD6_AGENT_ATOMIC_REVISION_OUT_OF_SNAPSHOT`;
- pinned valid proposal → 200 digest-bound;
- provider rejection (incl. quota-style) → 503 envelope, never a local code;
- boundary refusal → provider ZERO.
