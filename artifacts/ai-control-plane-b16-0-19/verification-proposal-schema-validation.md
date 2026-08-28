# B16.0.19 §F — Verification-proposal schema validation (CONFIRMED)

## Schema tightening

`findingStableIdentities.items`, `proposedActions.items.actionId`, and
`targetIds.items` gained `maxLength: 4096` in the DECLARED schema (the CD-8
semantic-id precedent); the new schema-derived
`validateCircuitVerificationProposalToolInput` (beside the tool in
`agent-tools.ts`) reads every constraint from the nodes.

## Route flow

```
generate() own try/catch → providerErrorResponse (503 envelope)
no typed tool call → historical 422
validateCircuitVerificationProposalToolInput → 422 VERIFICATION_PROPOSAL_OUTPUT_INVALID
normalizeVerificationRemediationProposal own try/catch →
  CD9_AI_PROPOSAL_FINDING_REFERENCE_INVALID → 422 with that exact code
  CD9_REMEDIATION_PROPOSAL_INPUT_INVALID → 422 with that exact code
  anything else → 422 VERIFICATION_PROPOSAL_OUTPUT_INVALID
success → proposal_only_no_design_or_verdict_mutation with graphMutation /
schematicMutation / pcbMutation / waiverMutation / readinessMutation ALL null
```

## Adversarial proof (pinned)

- valid pinned proposal → 200, digest/run-bound, `status: "draft"`, the pinned
  run **byte-unchanged** after the call;
- unknown finding identity → exact `CD9_AI_PROPOSAL_FINDING_REFERENCE_INVALID`;
- action target outside the pinned semantic anchors → exact
  `CD9_REMEDIATION_PROPOSAL_INPUT_INVALID`;
- structurally malformed → `VERIFICATION_PROPOSAL_OUTPUT_INVALID`; unknown
  action `kind` (e.g. `delete_finding`) refused by the enum gate;
- provider rejection → 503 envelope, never a local code;
- provider output can therefore never change rule results, applicability,
  severity, waivers, readiness, requirement satisfaction, or claim
  safety/verification — no such channel exists in the schema, the validator,
  the factory, or the response.
