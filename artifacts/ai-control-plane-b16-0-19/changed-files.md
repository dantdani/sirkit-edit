# B16.0.19 — Changed files

## Migrated routes

circuit-knowledge (8 MB/30 s): applicability, compile, compose `{ body }`;
problem, propose `{ context, body }` + `circuitKnowledgeScopeFromContext`.
circuit-verification (32 MB/30 s): problem, readiness, run, propose
`{ context, body }` + `circuitVerificationScopeFromContext`.

Business logic byte-identical EXCEPT the two propose routes' §D/§F hardening
(intentional, mandated).

## Shared authorities

- NEW `app/lib/circuit-knowledge/agent-tools.ts` — `CIRCUIT_RECIPE_CLAIM_TOOL`
  (moved from the route inline; ref-array items now `minLength: 1,
  maxLength: 300`) + `validateCircuitRecipeClaimToolInput`.
- `app/lib/circuit-verification/agent-tools.ts` — id items gained schema
  `maxLength: 4096`; ADDED `validateCircuitVerificationProposalToolInput`.
  `createVerificationRemediationProposal` / `normalize…` UNCHANGED.
- Both `_scope.ts` files — ADDED deadline constants + Request-free projectors;
  `scopedJson` retained.

## Routes rewritten for §D/§F

- `app/api/circuit-knowledge/propose/route.ts` — wrapper + boundary split +
  structural validation; prompt/config/success shape unchanged.
- `app/api/circuit-verification/propose/route.ts` — wrapper + boundary split +
  structural validation before normalize; exact CD9 codes; prompt/config/
  success shape unchanged.

## Tests

- `b16-0-19-tranche-parity.test.ts` — NEW; 77 §A pins (green first run,
  pre = post).
- `b16-0-19-proposal-validation.test.ts` — NEW; 11 §D/§F adversarial tests.
- `b16-0-19-adapter-schema-parity.test.ts` — NEW; 5 adapter-parity tests.
- `b16-0-19-circuit-confinement-gate.test.ts` — NEW; 8 §G/§H gates.
- ratchet — `TRANCHE_12`; 52→43; floor 110.

## Regenerated via sanctioned generators only

Baseline 52→43; matrices ×2 byte-stable; manifest extracted here.

## NOT changed

Oracle/readiness/applicability/compile/compose logic, source-evidence chain,
`createProposedRecipeClaim`, `normalizeVerificationRemediationProposal`,
prompts, provider config, tool registry, hashes, replay pins.
`C:\Users\robsa\sirkit` untouched.
