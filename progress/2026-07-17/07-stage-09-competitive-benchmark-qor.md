# Stage 9 competitive benchmark and QoR

Date: 2026-07-17

## Outcome

Implemented the Stage 9 benchmark foundation in the protected Sirkit copy: versioned/content-addressed schemas, governed 20-package corpus, independent oracles, typed correctness-first metrics, statistics, immutable/cancellable runner and result store, leakage/security controls, CLI, baseline/static report, capability registry, pre-registered placement experiment, regression policy and CI tiers.

The frozen baseline retained 8 passes, 2 correctness failures and 1 Stage 8 prerequisite blocker. A classifier self-audit found that v1's derived feasibility summary did not count independent-oracle failures; v1 remains immutable and audit v2 records the corrected 8 feasible / 2 failed / 1 incomplete view. The placement experiment was rejected for insufficient evidence and did not alter product defaults or access holdout data.

## Verification

- Stage 9 focused tests: passed.
- Corpus validation: 20 packages, zero diagnostics.
- Full suite: 126 files passed, 2 skipped; 810 tests passed, 9 skipped.
- TypeScript, focused Stage 9 ESLint and production build: passed.
- Full repository lint still reports inherited React hook/ref debt outside Stage 9.

## Verdict

Stage 9 remains incomplete because licensed-open real boards, full flow, routing/proxy variability, AI/human protocols, enforced process sandboxing, meaningful held-out optimization and full reporting/scale evidence are not yet present. See `SIRKIT_STAGE_09_COMPETITIVE_BENCHMARK_QOR_IMPLEMENTATION.md` for the complete evidence and exact remaining work.
