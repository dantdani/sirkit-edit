# B16.0.16 §A — Pre-edit behavioral pins (CONFIRMED)

[`app/api/__tests__/b16-0-16-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-16-tranche-parity.test.ts)
was written against the PRE-migration raw handlers and run GREEN (**67/67**),
then kept green unchanged post-migration. `llmRouter.generate` is a spy;
`validateCircuitCalculationProblem` / `validateCalculationProjectState` are spied
to `[]` so the PROVIDER/SCOPE boundary can be exercised without reconstructing
the calculation domain (whose validation is covered by the standing
`app/lib/calculation` suite). All labels **CONFIRMED**.

## Shared refusal classes pinned for all 8 routes

| Class | Response |
|---|---|
| unauthenticated | 401, provider zero |
| foreign-project membership | 403, provider zero |
| revoked membership | 403, provider zero |
| production cross-origin CSRF | 403, **zero body pulls**, provider zero |
| text/plain media | 415 `AUTH_MEDIA_TYPE_UNSUPPORTED` |
| invalid JSON | 400 `AUTH_INVALID_JSON` |
| payload 12,000,001 bytes | 413 |
| payload 12,000,000 bytes | not 413 (under the ceiling → 400 invalid-json) |
| pre-aborted body | 400 `AUTH_BODY_ABORTED`, provider zero |
| authorized empty body | exact required-field refusal (below), provider zero |

## Exact required-field refusals (RECORDED)

| Route | Refusal |
|---|---|
| corners | 400 `corner dimensions are required` |
| evaluate | 400 `model and typed interval inputs are required` |
| export | 400 `state is required` |
| feedback | 422 (createCalculationFeedback rejects an empty body) |
| problem | 400 `pinned CD-1 through CD-6 states, signoff, and registry are required` |
| propose | 400 `problem, approved model IDs, and userRequest are required` |
| report | 400 `problem, graph, registry snapshot, and fixed-point result are required` |
| transaction | 400 `state, base digest, idempotency key, reason, and operations are required` |

## Role, scope, provider, deterministic pins

- role: the 6 restricted routes deny `viewer` (403); export/report (ALL_MEMBERS)
  admit `viewer` to the required-field check;
- problem foreign project/branch body → 403 `calculation problem scope mismatch`;
- transaction foreign project → 422 before any transaction created;
- transaction actor built ONLY from trusted context (attacker actor/role/session
  ignored — captured `createCalculationTransaction` actor = `{actorId:"u1",
  actorKind:"human", sessionId:<derived>, role:"pcb_editor"}`);
- corners valid → deterministic enumeration, no-store, provider zero;
- evaluate unapproved model → 422, provider zero;
- export no approved report → 422 `NOT_RELEASED`;
- propose valid → provider EXACTLY once, `proposal_only`, `calculatedResults:[]`,
  `decisions:[]`, `X-Sirkit-AI-Provider` header, `maxTokens:2048`,
  `temperature:0`, `toolChoice:{name:"propose_calculation_analysis"}`, exact
  system prompt; unpinned obligation / unapproved model → 422; no tool call →
  422; provider failure → 503; scope mismatch → 422 provider zero.
