# B16.0.17.1 §E — Semantic-ID validation proof (CONFIRMED)

The permanent suite
[`b16-0-17-1-proposal-validation.test.ts`](../../app/api/__tests__/b16-0-17-1-proposal-validation.test.ts)
(19 tests) uses the REAL `validateSchematicProposalToolInput` and REAL
`normalizeSchematicChangeProposal` — nothing in the validation path is spied.

## The 16 mandated cases

| # | Case | Result |
|---|---|---|
| 1 | valid proposal, unknown `referencedSemanticObjectId` | 422 `CD8_AI_PROPOSAL_REFERENCE_INVALID` |
| 2 | valid proposal, unknown `targetObjectId` | 422 `CD8_AI_PROPOSAL_REFERENCE_INVALID`; graph byte-identical |
| 3 | known semantic IDs | **200** proposal_only, digest-bound proposal, null mutations, provider header |
| 4 | missing `referencedSemanticObjectIds` | 422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID` |
| 5 | missing `proposedActions` | 422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID` |
| 6 | missing `assumptions` | 422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID` |
| 7 | missing `warnings` | 422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID` |
| 8 | wrong `proposalKind` | 422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID` |
| 9 | wrong `actionKind` | 422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID` |
| 10 | `targetObjectIds` wrong type | 422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID` |
| 11 | blank rationale (schema-passing whitespace) | 422 `CD8_AI_PROPOSAL_REFERENCE_INVALID` (normalize's trim check — recorded split) |
| 12 | oversized arrays (513) + oversized rationale (2001) | 422 `SCHEMATIC_PROPOSAL_OUTPUT_INVALID` |
| 13 | missing typed tool call | historical 422 `provider returned no typed schematic proposal` |
| 14 | genuine provider rejection | 503 provider envelope, never a local code |
| 15 | provider quota/timeout-style rejection | 503 provider envelope, never a local code |
| 16 | successful valid proposal | 200 (merged with case 3's assertions) |

Extra permanent cases: unexpected nested action key; non-object action; the
ORIGINAL malformed B16.0.17 fixture (the §A counterexample) → 422 structural.

## The local-refusal contract (asserted on every local 422)

status **422** · deterministic local `code` · NOT the provider envelope (no
`provider`/`retryable` fields) · no proposal · no
graphMutation/diagramMutation/pcbMutation channel · no
`createSchematicTransaction`/`applySchematicTransaction` call · **exactly one**
provider invocation · exactly one terminal response.

Boundary refusals (e.g. unauthenticated 401) make **zero** provider
invocations.
