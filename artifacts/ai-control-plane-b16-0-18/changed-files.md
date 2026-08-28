# B16.0.18 — Changed files

## Migrated routes (all → `authenticatedJsonRoute({ maxBytes: 12_000_000, deadlineMs: 30_000 })`)

`{ body }`: alternative, catalog, evaluate, feedback, sourcing.
`{ context, body }` + `componentSelectionScopeFromContext`: export, problem,
solve, transaction, propose.

Business logic byte-identical EXCEPT propose (below).

## Propose — §E hardening (intentional, mandated)

- `app/api/component-selection/propose/route.ts` — provider call in its own
  try/catch → `providerErrorResponse`; NEW structural validation before the
  domain factory → 422 `COMPONENT_PROPOSAL_OUTPUT_INVALID` (bounded
  diagnostics); `createCatalogSearchProposal` in its own try/catch → 422 with
  the exact `CD6_*` code. Prompt/tool/config/success-shape unchanged.
- `app/lib/component-selection/agent-tools.ts` — ADDED
  `validateComponentSearchProposalToolInput` (schema-node-derived; no
  hard-coded limits). Tool schema and `createCatalogSearchProposal` UNCHANGED.

## Shared helper (extended, NOT weakened)

- `app/api/component-selection/_scope.ts` — ADDED
  `COMPONENT_SELECTION_API_DEADLINE_MS = 30_000` and
  `componentSelectionScopeFromContext(context)`. `scopedJson` retained.

## Tests

- `app/api/__tests__/b16-0-18-tranche-parity.test.ts` — NEW; 79 §A pins
  (pre = post; one disclosed correction: the sourcing required-field pin needs
  `operation:"normalize"`).
- `app/api/__tests__/b16-0-18-proposal-validation.test.ts` — NEW; 12 §E
  adversarial tests (real validator + real factory).
- `app/lib/llm/__tests__/b16-0-18-adapter-schema-parity.test.ts` — NEW; 3
  adapter-parity tests (one disclosed lint/brace cleanup of the fake-client
  mocks; behavior identical).
- `app/lib/auth/__tests__/b16-0-18-component-selection-confinement-gate.test.ts`
  — NEW; 11 §G/§H gates.
- `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` — `TRANCHE_11`;
  `BASELINE_MAX` 62→52; `MIGRATED_FLOOR` 91→101.

## Regenerated through sanctioned generators only

- `_raw-route-baseline.json` — 62→52; matrices ×2 byte-stable; manifest here.

## NOT changed

Domain evaluators, solver, alternative planner, sourcing factories, feedback
consequences, transactions, capability profile, tool schema, prompts, provider
config, tool registry, hashes, replay pins. `C:\Users\robsa\sirkit` untouched.
