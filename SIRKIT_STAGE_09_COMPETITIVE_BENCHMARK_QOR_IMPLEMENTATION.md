# Sirkit Stage 9 Competitive Benchmarking and QoR Implementation

Date: 2026-07-17  
Branch: `codex/stage-09-competitive-qor`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Specification SHA-256: `350F283982DCEFFFCA58BB543E7E07B191594DC16EDC7B5E12DB672933003C31`

The original `C:\Users\robsa\sirkit` tree was not modified.

## 1. Executive implementation summary

Stage 9 now has a typed, content-addressed benchmark foundation: eight schema families, a governed 20-package corpus, independent analytical/property oracles, 15 typed metrics, correctness-first comparison, deterministic statistics, an isolated/cancellable runner, immutable result/artifact storage, security and leakage guards, a CLI, static evidence reports, a dated capability-hypothesis registry, a versioned regression policy, and pull-request/nightly CI definitions.

The unoptimized public-development baseline is frozen with all outcomes retained: 8 passed, 2 failed correctness, and 1 blocked by the incomplete Stage 8 high-speed contract. One pre-registered placement experiment was run and rejected for insufficient evidence; it made no product/default change and never accessed the holdout. No superiority or QoR-improvement claim is made.

## 2. Prerequisite evidence

| Stage | Verified contract/evidence | State for Stage 9 |
|---|---|---|
| 1 | Stable identity, exact pin/pad mapping, protected mutation, revisions, atomic sync; current regression suite includes the Stage 1 tests. | Core usable; prior report says complete. |
| 2 | Shared revision-bound electrical truth, strict DSN/SES conservation/import, authoritative opens/shorts; current regression suite passes. | Core usable; progress record has no standalone final signoff file. |
| 3 | Distinct ready/blocked/incomplete/stale states, immutable release evidence, false-ready protection. | Core usable; prior report says complete. |
| 4 | Native zones/planes, stale-fill evidence, same-net policy, shared DRC/export geometry. | Core usable; prior report says complete. |
| 5 | Immutable atomic/evidence core exists. Main Build/manual paths, catalog population, UI and deployed-database validation remain incomplete. | Benchmarkable subset only. |
| 6 | Typed/unit-safe compiler, conflicts, coverage and key consumers exist. Full authoring UI, one-live-program coverage and migrations remain incomplete. | Benchmarkable subset only. |
| 7 | Deterministic candidates, legality, multi-start evidence and routeability proxies exist. Router correlation, advanced UI and large-scale evidence remain incomplete. | Benchmarkable subset only. |
| 8 | Authoritative route candidates, arbitrary angles, stackup transitions, protection, transactions and measurements exist. Full shove/drag, cornered pairs, pair tuning and complete corpus remain incomplete. | `routing-high-speed-blocked` is explicitly `blocked_by_prerequisite`. |

Stage 5-8 gaps do not prevent the benchmark core from existing, so the verdict is not `BLOCKED BY STAGE N`. They do prevent complete Stage 9 full-flow and held-out optimization evidence.

Current proof commands:

```text
npm test -- --reporter=dot
npx tsc --noEmit
npm run build
npm run benchmark:validate
npx vitest run app/lib/benchmark/__tests__/stage-09-benchmark-core.test.ts
```

## 3. Existing-evidence inventory

| Evidence class | Found | Decision |
|---|---:|---|
| Repository test files at inventory | 128 total; 95 PCB | Reuse as prior-stage regressions, not as benchmark results without manifests. |
| Stage 1-8 fixture/corpus code | Data integrity, electrical, readiness, zones, atomic, constraints, placement and routing | Wrap selected production-backed fixtures in canonical packages. |
| Prior performance assertions | Fill, connectivity, DRC, preview, routing, placement | Retain as local regression evidence; do not mix heterogeneous machines into competitive QoR. |
| Stage implementation reports/progress | Stage 1-8 records | Cite as prerequisite evidence; preserve incomplete verdicts. |
| FreeRouting integration | DSN/SES runner and tests | Retain; executable JAR/Java was unavailable for Stage 9 measured runs. |
| Competitive QoR result store/dashboard | None | Implement immutable result store and static report; interactive dashboard remains open. |
| Product marketing/feature claims | Informal and official vendor pages | Migrate only to dated feature hypotheses; never treat as measured QoR. |

## 4. Corpus specification

Corpus `sirkit-stage9-core` v1 has 20 content-addressed packages and manifest digest `sha256:193cf31384bafb987dac6904e2c1080ccefa0342006c5f2c5b7f52ba97eb8899`.

| Dimension | Coverage |
|---|---|
| Tiers | 4 analytical, 7 subsystem, 5 synthetic, 1 private-replay mechanism, 1 competitive protocol, 2 stress |
| Partitions | 11 public development, 2 tuning, 4 validation, 1 hidden holdout, 2 stress |
| Difficulty | 9 micro, 3 moderate, 5 hard, 3 expert |
| Licenses | Generated CC0 fixtures or internal aggregate-only/private declarations with allowed scopes and retention policy |
| Leakage | Family and structural-source partition checks; candidate-visible holdout packages remove hidden inputs, oracle expectations and hidden assets |

Coverage gaps are material: no licensed-open real-board Tier 3 corpus, no production private replay ingestion/consent workflow, only one hidden family, and incomplete domain breadth for hierarchy, locked mutation, same-net geometry, high-speed, DSN/SES failures, AI and full flow.

## 5. Package and schema contracts

Versioned contracts exist for corpus, package, run, oracle, metric, result, experiment and competitive claim. Canonical JSON sorts object keys, rejects non-finite values, omits undefined values and uses SHA-256 stable IDs/digests. Validators reject digest mismatch, family leakage, missing canonical references, unresolved third-party licenses, invalid experiments and unsupported claim comparison semantics.

There is no database migration: Stage 9 artifacts are file-backed JSON. Schema migration tooling beyond v1 validation is not implemented.

## 6. Oracle matrix

| Task | Oracle | Independence | Conflict policy | Current evidence |
|---|---|---|---|---|
| Stable nets/protection | Closed-form expected values | Analytical | Block claim | Passing baseline package |
| Pin/pad parity | Exact counts/identity property | Analytical | Invalidate fixture/block | Passing baseline package |
| Electrical open/routed | Expected open/short values | Analytical over production output | Block claim | Two passing packages |
| Readiness truth table | Expected false-ready/status values | Property | Block claim | Passing package |
| Plane current/stale | Expected current/stale facts | Property over production fixture | Block claim | Failed; fixture/oracle boundary needs repair in corpus v2 |
| Atomic evidence | Required source/evidence facts | Property | Block claim | Passing package |
| Constraint units/precedence | Independent unit/error scan | Independent checker | Adjudicate | Failed; checker whitelist/canonical semantics need corpus v2 |
| Placement/routing | Legality plus exact fixture facts | Production cross-check plus property | Block claim | Focused packages pass; full routed QoR oracle absent |

Oracle disagreement is an explicit result state. Feasibility now includes failed, unknown, unsupported and disagreeing oracle states; a regression test preserves this rule.

## 7. Metric registry

The v1 registry contains 15 unit-typed metrics across correctness, placement, routing, performance, robustness, explainability and AI safety. Each defines direction, scope, implementation, aggregation, missing-data behavior, uncertainty, outlier policy and comparability requirements.

Critical gates include parse validity, hard failures, opens, shorts, protected mutations, false-ready and 100% typed AI mutation rate. Soft vectors include placement proxy/overflow, completed connections, route length, vias, elapsed time, success and evidence coverage. No universal normalized score exists; named decision profiles apply only after feasibility and raw vectors remain available.

## 8. Runner architecture

The CLI constructs complete run manifests, pins product/harness file-tree digests for future runs, dependency lock, environment, seeds, configuration, assistance level, package/input digests and artifact identities. Candidate execution receives no hidden oracle/holdout fields. Each run gets an exclusive directory, timeout/abort signal, output-size limit, path containment, executable-file rejection and secret scanning. Results and artifacts are immutable and content addressed.

Limits: execution is currently in-process, so declared memory/CPU limits are recorded but not OS-enforced; package network policy is not backed by an OS sandbox; artifact digests are store-consistent but external tools are not yet containerized. The frozen v1 baseline revision omitted untracked new product/harness files; `audit-baseline` preserves v1 and records a complete current product+harness derivation revision for subsequent runs.

## 9. Baseline report

Frozen baseline code label: `2bd1603a775bd4b409b89710cd4e5f8d70201632+product-de46a7fc710bed35`.

| Status | Count | Meaning |
|---|---:|---|
| passed | 8 | Stable net, pin/pad, electrical open, electrical routed, readiness, atomic, placement and arbitrary routing |
| failed_correctness | 2 | Plane-current/stale oracle failure; constraint unit checker failure |
| blocked_by_prerequisite | 1 | High-speed routing depends on incomplete Stage 8 pair/tuning behavior |

The immutable v1 summary incorrectly classified the two independent-oracle failures as feasible while its run-status denominators remained correct. The bug was not erased: v1 remains frozen. Audit v2 uses the corrected classifier and reports 8 feasible, 2 failed correctness, 1 incomplete evidence.

## 10. Placement proxy validation

Not complete. The forced-channel baseline measured proxy penalty and overflow, and the tuning experiment exercised candidate allocation, but no fixed multi-board study correlates Stage 7 proxies with actual autorouted completion, DRC, length, vias and runtime. The one validation pair produced zero proxy/overflow delta and is insufficient for calibration or Spearman claims.

## 11. Routing variability report

The runner retains seeds, per-trial status, elapsed samples and artifacts; statistical helpers retain failures and quantify distributions. The current baseline has only one internal arbitrary-routing trial. Java, the FreeRouting JAR and KiCad CLI were unavailable, so no FreeRouting repeated-seed distribution, partial SES/import failure distribution, best-of-N accounting or cross-tool route validation was measured.

## 12. Component-to-board full-flow report

Canonical packages declare private replay, competitive interchange and hidden full-flow boundaries, but no package currently executes component selection through schematic, constraints, placement, routing, DRC/connectivity/readiness and export as one boundary-attributed flow. Stage 1-8 focused packages isolate several boundaries; this is not a substitute for the required full flow.

## 13. AI safety and productivity report

The data model records assistance level, provider/model, prompt/tool digests, typed mutation policy, human actions/corrections, latency/tokens/cost and evidence accuracy. Security tests remove hidden expectations and reject secrets. No model/provider protocol was actually run across repeated tasks, so task success, correction burden, latency/cost, repeatability, prompt leakage and human productivity are unmeasured.

## 14. Competitive capability registry

Five dated official-source hypotheses are recorded separately from QoR:

| Product | Scope | Measurement state |
|---|---|---|
| Cadence Allegro X | Constraint-driven PCB, in-design analysis, high-speed and documented AI assistance | `license_unavailable` |
| Altium Designer high-speed | xSignals, differential routing and tuning | `license_unavailable` |
| Altium Constraint Manager | Project constraint management | `license_unavailable` |
| Synopsys.ai/DSO.ai | IC/chip optimization methodology | `not_comparable` to board-level PCB QoR |
| KiCad 10 PCB Editor | Open interactive routing/tuning reference | `environment_unavailable` |

Sources are the official Cadence Allegro X page, Altium high-speed and Constraint Manager documentation, Synopsys AI EDA page and KiCad 10 PCB Editor manual. These are capability hypotheses only.

## 15. Competitive measurement report

No authorized measured competitor run exists. Cadence and Altium are `license_unavailable`; Synopsys is `not_comparable`; KiCad is `environment_unavailable`. A common-denominator protocol declares generated inputs, adapters/loss reports, assistance levels, budgets, independent validation, outcomes and publication review. There are no invented win/tie/loss results.

## 16. Experiment registry

Experiment `experiment:placement-candidate-allocation-v1` was pre-registered against the frozen baseline. It tried candidate counts 1, 2, 3 and 4 on tuning data, retained all four attempts, selected 2 by declared ordering and evaluated one validation pair. The holdout was not accessed.

## 17. Optimization and ablation report

Decision: `insufficient_evidence`. Reasons: fewer than three independent paired families, placement proxy improvement not confirmed, and routing-overflow improvement not confirmed. Validation deltas were both zero. No product algorithm/default was changed, no experiment was promoted, and therefore no misleading ablation or rollback claim is made.

## 18. Before/after QoR scorecard

There is no qualifying before/after product scorecard because no change was promoted. Correctness remains the first dimension; the candidate did not improve the two measured placement proxies. Robustness, scalability, interoperability, explainability, AI safety and downstream routed QoR lack paired validation/holdout evidence. A Pareto implementation exists and excludes infeasible candidates, but the current experiment supplies no meaningful frontier shift.

## 19. Regression policy

The versioned policy defines eight tiers: pre-commit micro, pull-request correctness, pull-request QoR smoke, nightly stochastic, scheduled full, release hidden holdout, manual licensed competitor and periodic expert usability. Budgets cover hard failures, false-ready, protected mutation, runtime p95, route length and placement overflow. Aggregate gains cannot hide a domain correctness regression.

Threshold changes require version, rationale, before/after distributions, affected claims and reviewer approval. Quarantines require owner, evidence, scope, expiry, remediation and visible denominators. The GitHub workflow runs validation, TypeScript and benchmark tests on pull requests; scheduled/manual jobs keep hidden/licensed suites isolated.

## 20. Dashboard and claim-evidence report

Implemented: machine-readable baseline/audit summaries, denominator-visible package/metric/failure tables, static HTML report, result queries and drill-down to run/result/artifact digests. Not implemented: interactive trends, Pareto plots, per-board deltas, stochastic charts, scale plots, AI panels and claim review UI. No competitive performance claim is registered or supported.

## 21. Security, privacy and licensing report

Threats covered include traversal, executable payloads, artifact escape, secret leakage, unresolved license assets, source mutation, hidden-oracle exposure, partition leakage and result tampering. Private packages declare classification, redistribution, retention and allowed scopes; candidates receive neither hidden inputs nor oracle expectations. Missing controls include OS/container sandbox enforcement, prompt-injection agent runs, production consent/delete workflow, encryption/remote retention, and a real private replay export pipeline.

## 22. Performance and scale report

Environment: Windows x64, Node v24.15.0, Intel Core Ultra 5 125U, 14 logical CPUs, 15.5 GiB RAM. The frozen deterministic baseline records per-trial elapsed values; the aggregate median across 10 measured packages was about 1.256 ms with p05 about 0.259 ms and p95 about 147.516 ms. These package-level samples are heterogeneous and not a competitive performance claim.

The full repository suite retained its existing gates, including fill, connectivity, route preview and 100-footprint placement. No Stage 9 cold/warm comparison, enforced memory profile, concurrency curve, large-scale family, AI cost curve or breakdown-point study exists.

## 23. Failure-cluster and product-gap report

| Cluster | Affected baseline | Severity | Root cause / next owner |
|---|---:|---|---|
| Independent oracle correctness | 2/11 | Critical benchmark evidence | Plane fixture does not prove expected current fill; unit checker disagrees with supported syntax. Create corpus v2 and adjudicate independently; benchmark-core + Stage 4/6. |
| High-speed prerequisite | 1/11 | Critical capability gap | Cornered differential pair, uncoupling/recoupling and exact pair tuning remain incomplete; Stage 8. |
| Full-flow/real corpus absent | Not in baseline | High evidence gap | Add licensed open boards, boundary-attributed flow and private replay governance; benchmark-core. |
| Routing/AI variability absent | Not in baseline | High evidence gap | Provision open tools and controlled model/human protocols; routing + AI evaluation. |
| Runner isolation incomplete | Systemic | High security/reproducibility gap | Container/process sandbox with enforced CPU/memory/network; benchmark-core. |

## 24. Sirkit differentiator report

Measured with strong local evidence: content-addressed evidence lineage, explicit unsupported/blocked outcomes, deterministic typed engineering actions in focused prior-stage paths, and correctness-first result handling. Partially measured: explainability structure and reversible routing/placement contracts. Still hypotheses: superior expert productivity, better QoR than Cadence/Altium/KiCad, safer AI at scale, stronger full-flow interoperability and better routeability prediction.

## 25. Stage 10 handoff

Stage 10 should reuse stable-net permutation, electrical open/routed, readiness mutation, plane stale/current, constraint program revision, placement stale-candidate and routing transaction packages. Required metrics are protected mutation count, opens, shorts, false-ready, evidence currentness, incremental-vs-full equivalence, persistence replay digest, merge/conflict count and collaboration convergence. Add metamorphic edit sequences and crash/reopen/multi-client fixtures without exposing the hidden holdout.

## 26. Files changed

- Schemas/governance: `app/lib/benchmark/types.ts`, `stable.ts`, `validation.ts`, `governance.ts`.
- Corpus/oracles/metrics/statistics: `corpus-v1.ts`, `oracles.ts`, `metrics.ts`, `statistics.ts`.
- Runner/store/security: `runner.ts`, `result-store.ts`, `security.ts`, `builtin-executor.ts`.
- Analysis/optimization/competition/regression: `analysis.ts`, `promotion.ts`, `capability-registry.ts`, `regression-policy.ts`.
- Tests: `app/lib/benchmark/__tests__/stage-09-benchmark-core.test.ts`.
- CLI/experiments: `scripts/benchmark.ts`, `scripts/stage9-placement-experiment.ts`, `package.json`.
- CI: `.github/workflows/benchmark.yml`.
- Evidence: `artifacts/stage-09/**`.
- Documentation: this report and `progress/2026-07-17/07-stage-09-competitive-benchmark-qor.md`.

## 27. Test evidence

| Command | Result |
|---|---|
| `npm run benchmark:validate` | 20 packages, 0 diagnostics |
| `npx vitest run app/lib/benchmark/__tests__/stage-09-benchmark-core.test.ts` | 18 passed |
| `npm test -- --reporter=dot` | 126 files passed, 2 skipped; 810 passed, 9 skipped |
| `npx tsc --noEmit` | Passed |
| `npx eslint app/lib/benchmark scripts/benchmark.ts scripts/stage9-placement-experiment.ts` | Passed |
| `npm run build` | Passed; five existing Turbopack dynamic executable/file-tracing warnings |
| `npm run lint` | Repository baseline not green: 30 errors, 20 warnings in existing React/ref/effect paths; Stage 9 initially had warnings that were fixed and its focused lint is clean |

Explicit non-passes: 9 existing external/live tests skipped; FreeRouting/Java/KiCad environment unavailable; Cadence/Altium licenses unavailable; Synopsys task not comparable; high-speed package blocked by Stage 8; two frozen baseline correctness failures; AI/human/full-flow/scale/holdout protocols not run.

## 28. Remaining limitations

- Product limitations: incomplete Stage 5-8 consumer/UI/high-speed behavior.
- Corpus gap: no licensed open-real boards and insufficient families/domains.
- Oracle weakness: plane-current and constraint-unit v1 disputes require independently reviewed corpus v2.
- Statistical uncertainty: one validation pair, no held-out effect, no router/model distributions.
- Competitor access: no licensed Cadence/Altium; no local KiCad; Synopsys non-comparable.
- Performance limit: in-process runner, no enforced memory/CPU/network and no scale curves.
- Reporting limit: static tables only, no complete interactive evidence dashboard.
- Reproducibility limit: the original frozen v1 revision label omitted untracked source/harness files; the separately immutable audit records the defect and corrected current derivation but cannot retroactively strengthen that label.
- Engineering signoff: no SI/PI/EM/thermal/EMC/reliability/regulatory/fabrication proof.

## 29. Completion verdict

Smallest exact remaining work:

1. Publish corpus v2 with licensed-open real boards, adjudicated plane/unit oracles, broader required microcases and at least three independent validation/holdout families.
2. Execute boundary-attributed full-flow and private-replay mechanisms with lawful consent/retention.
3. Provision open FreeRouting/KiCad references and run repeated routing/proxy-correlation/variability studies.
4. Run AI safety/productivity and expert-human protocols with pinned models/prompts/tools and retained corrections/cost.
5. Enforce process/container CPU, memory and network isolation; add clean-environment replay.
6. Complete Stage 8 high-speed prerequisite behavior and affected benchmark packages.
7. Pre-register an evidence-backed product change, pass multi-family validation and untouched holdout, then run ablation/sensitivity and the full prior-stage gates.
8. Add complete scale/performance and interactive claim-evidence reporting.

### STAGE 9 INCOMPLETE
