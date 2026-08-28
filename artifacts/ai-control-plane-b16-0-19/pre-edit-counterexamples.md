# B16.0.19 §A — Pre-edit behavioral pins (CONFIRMED)

[`b16-0-19-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-19-tranche-parity.test.ts)
was written against the PRE-migration raw handlers and ran GREEN first try
(**77/77**), then kept green unchanged post-migration.

Spies: `llmRouter.generate`; `validateRecipeSourceBundle` /
`validateClaimPromotion` / `validateCircuitVerificationProblem` (permissive,
boundary isolation — REAL validators covered by the standing routes/domain
suites). The verification run fixture uses the REAL `finalizeVerification`, so
the digest binding pins are genuine.

## Shared refusal classes ×9

401 unauthenticated · 403 foreign/revoked membership · 403 viewer ·
403 production cross-origin (**0 body pulls**) · 415 media ·
400 `AUTH_INVALID_JSON` · **family boundary: 8,000,001/32,000,001 → 413,
exactly 8 MB/32 MB → under-ceiling 400** · 400 `AUTH_BODY_ABORTED` pre-aborted ·
exact required-field errors — all with provider ZERO.

## Exact required-field refusals (RECORDED)

| Route | Refusal (400) |
|---|---|
| ck/applicability | `recipe, recipeRequest, and context are required` |
| ck/compile | `recipe and sourceBundle are required` |
| ck/compose | `bindings and recipes arrays are required` |
| ck/problem | `pinned CD-1 through CD-4 states plus PCB foundation and exact completion signoffs are required` |
| ck/propose | `problem, sourceBundle, and userRequest are required` |
| cv/problem | `approved CD-8 project, CD-1 through CD-8 signoff, approved registry, requirements, and contexts are required` |
| cv/propose | `problem, current full run, and user request are required` |
| cv/readiness | `problem, graph digest, registry, and explicit denominator are required` |
| cv/run | `problem, authoritative graph, and approved registry are required` |

## Scope / provider pins (pre = post)

ck/problem foreign body → 403 `circuit knowledge problem scope mismatch`;
ck/propose foreign → 403 `circuit proposal scope mismatch` (provider ZERO);
ck/propose valid → exactly-once (`maxTokens 4096`, `temperature 0`, forced
`propose_circuit_recipe_claim`, exact system prompt) with `proposal_only`,
`publicationEligible: false`, quarantined `confidence: "low"` +
`authorityAssessment: "unknown"`; cv/run + cv/readiness scope/pin mismatches
refuse before oracle/readiness work; cv/propose tampered run digest → 422
`pinned verification problem/run integrity or scope failed` (provider ZERO);
cv/propose valid-pin → exactly-once with forced
`propose_circuit_verification_remediation` and the exact CD-9 system prompt.
