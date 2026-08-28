# B16.0.10 §D — Provider zero-call evidence (fake adapters; no credits)

All 8 routes are provider-bound (directly via `llmRouter.generate`, or via
`runBuildToolLoop`, or both for `build-multi`; `cross-verify` calls an external
SchGen endpoint only when configured). The pin suite mocks ALL seams
(`vi.mock`): `@/app/lib/llm/router`, `@/app/lib/build-loop`,
`@/app/lib/parts-search` — **zero provider credits, zero DB**.

## Zero-call refusals (×8 routes, both seams asserted)

| Refusal | Provider calls |
|---|---|
| authentication (anonymous 401) | **0** |
| CSRF (production cross-origin 403) | **0** |
| invalid media (415) | **0** |
| malformed JSON (400) | **0** |
| oversized body (413) | **0** |
| required-field refusal (route's own 400) | **0** |

(Stalled-body/deadline settlement over the same reader is pinned by the
standing B16.0.4 behavior suite; the reader refuses before any callback runs,
so no provider call is reachable.)

## Valid paths — exactly-once, requested-provider routing, normalization

| Route | Proven |
|---|---|
| `/api/schematic` | `generate` ONCE with `provider:"anthropic"`; 200 returns the RAW netlist; no-tool → 500; provider failure → normalized 503 with `generate` exactly once |
| `/api/schematic/build` | `runBuildToolLoop` ONCE with the exact prompt + requested provider; ok shape and failure pass-through (`{error, code, provider}` + loop status) preserved |
| `/api/schematic/build-multi` | planner `generate` ONCE + complexity-gate single `runBuildToolLoop` ONCE, provider threaded to both |
| `/api/schematic/cross-verify` | SchGen unconfigured → 200 `available:false` with ZERO provider calls (the pre-provider unavailability contract) |
| `/api/schematic/edit` | `generate` ONCE (`apply_edits` forced tool); op filtering preserved |
| `/api/schematic/edit-build` | `getPartsByIds` ONCE (seeding) then `runBuildToolLoop` ONCE; instruction embedded in the historical user-message shape |
| `/api/schematic/layout-critic` | `generate` ONCE (`report_layout_issues`); hallucinated refDes verified away → `applied:false`, original state returned |
| `/api/schematic/review` | `generate` ONCE (`report_findings`); contradicted claims dropped with the `dropped` count |

No provider configuration was changed; requested-provider routing
(`requestedProvider(body.provider)`) is byte-identical to the pre-migration
code and asserted behaviorally.
