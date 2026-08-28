# B16.0.18 §A — Pre-edit behavioral pins (CONFIRMED)

[`b16-0-18-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-18-tranche-parity.test.ts)
was written against the PRE-migration raw handlers and run GREEN (**79/79**
after one recorded pin-authoring correction: an empty `{}` body on `/sourcing`
takes the non-`normalize` path and returns the fail-closed **503** — the
required-field 400 needs `{"operation":"normalize"}`; the pin was corrected to
match the RECORDED raw behavior). Kept green unchanged post-migration.

Spies: `llmRouter.generate`; the domain problem/catalog/project validators
(permissive, boundary isolation — REAL validators covered by the standing
routes.test + domain suites); transactions (actor capture).
`createCatalogSearchProposal` is REAL.

## Shared refusal classes ×10

401 unauthenticated · 403 foreign/revoked membership · 403 production
cross-origin (**0 body pulls**) · 415 media · 400 `AUTH_INVALID_JSON` ·
**12,000,001 → 413** / **12,000,000 → under-ceiling 400** ·
400 `AUTH_BODY_ABORTED` pre-aborted · exact required-field errors — all with
provider ZERO.

## Exact required-field refusals (RECORDED)

| Route | Refusal |
|---|---|
| alternative | 400 `primary, independently evaluated alternative, class, and impacts are required` |
| catalog | 400 `pinned engineering catalog snapshot is required` |
| evaluate | 400 `problemId, requirement, and catalog are required` |
| export | 400 `state and candidateId are required` |
| feedback | 422 (domain factory rejects an empty body) |
| problem | 400 `pinned CD-1 through CD-5 states and exact completion signoff are required` |
| propose | 400 `problem, pinned catalog, and userRequest are required` |
| solve | 400 `problem, model, and evaluations are required` |
| sourcing (`operation:"normalize"`) | 400 `snapshot, observation, and quantityProfile are required` |
| transaction | 400 `state, base digest, idempotency key, reason, and operations are required` |

## Role split (RECORDED)

catalog + export are ALL-members (viewer admitted to required-field); the other
eight deny viewer 403 (transaction additionally excludes automation per its
policy row).

## Scope / actor / provider pins

transaction actor CAPTURED from trusted context (`u1`/`human`/`pcb_editor`;
attacker body actor ignored; trusted project/branch); foreign transaction scope
→ 422 before `createComponentSelectionTransaction`; export foreign scope → 422,
unknown candidate → 404 `candidate is not in the pinned state`; sourcing
refresh → 503 + `Retry-After: 300` + "no live observation was invented";
propose valid → exactly-once (`maxTokens 4096`, `temperature 0`, forced
toolChoice, exact system prompt) with `proposal_only` + `hardGateResults: []` +
`selectedPart: null` + `X-Sirkit-AI-Provider`; catalog-digest mismatch and
scope mismatch → 422 provider-ZERO; no-tool-call → 422; provider failure → 503
envelope.
