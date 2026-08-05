# Sirkit CD-07 Deterministic Electrical Calculation Engine

Date: 2026-07-18  
Branch: `codex/cd-07-electrical-corners`  
Specification SHA-256: `8447F2C543DEDF19D8C431E35F450533A633A9AF72E67152A3CDF0DA7468BD1F`  
Protected working copy: `C:\Users\robsa\Documents\Codex\2026-07-13\do\work\sirkit-edit`  
Protected original: `C:\Users\robsa\sirkit` (unchanged)

## Outcome

Sirkit now has a fail-closed CD-07 foundation for exact, unit-safe circuit calculations. It compiles calculation obligations only from a current, human-approved CD-06 exact-part candidate; represents finite decimal values as canonical rational numbers; separates units, dimensions, affine temperatures, waveform semantics, angle conventions, tolerances, correlation, evidence quality, numerical error, corners, and governing limits; and refuses to turn unknown or typical data into a guaranteed result.

The kernel is separate from the existing SPICE runtime. SPICE remains useful for behavioral simulation, but its binary-float samples and Monte Carlo runs are not reused as worst-case proof. The legacy alternate classifier is also not reused because its unknown-tolerance behavior does not meet CD-07 evidence rules.

## Implemented architecture

- `app/lib/calculation/types.ts` defines versioned immutable problem, quantity, interval, expression, variable, tolerance, correlation, equation/model, graph, corner, solver-certificate, result, margin, value, report, decision, feedback, project, and transaction contracts.
- `rational.ts`, `units.ts`, and `interval.ts` provide canonical BigInt rational arithmetic, strict locale-independent parsing, exact SI prefix conversion, dimension checking, affine absolute/delta temperature rules, explicit Hz/rad/s and degree/radian conventions, and exact interval operations with divide-through-zero rejection.
- `expression.ts` evaluates a bounded allowlisted AST only. It performs dependency extraction, interval evaluation, branch handling, dimension inference, and node-resource limits without code, import, file, or network execution.
- `model-registry.ts` and `applicability.ts` require versioned implementation digests, evidence, oracle references, human review, exact topology/identity/region applicability, and active lifecycle state before a model can contribute proof.
- `problem.ts` checks CD-1 through CD-6 in order, pins the exact digest chain, rejects a generic/incomplete/stale CD-06 candidate, and compiles explicit role obligations. The real project currently stops at `BLOCKED BY CD-6`.
- `tolerance.ts` distinguishes guaranteed, characterized, nominal, absolute, relative, distribution, and correlation semantics. Unknown or unapproved correlation blocks statistical combination.
- `derating.ts` applies only human-approved, evidence-backed, component/stress/environment-scoped rules with exact factors; a waiver never changes the physical limit.
- `corners.ts` provides deterministic reachability-aware discrete enumeration, exact extrema selection, coverage certificates, resource limits, and an explicit `sampled_not_proven` state.
- `calculators.ts` includes bounded loaded-divider, RC time-constant, static-power, LDO-loss, ideal-ADC-LSB, and simple steady-state thermal-estimate kernels. The thermal path is explicitly estimate-only.
- `margins.ts` makes pass/fail/indeterminate decisions from worst bounds plus numerical uncertainty, never display rounding or nominal values.
- `synthesis.ts` enumerates E6/E12/E24 domains jointly and requires a full recalculation callback for every candidate. Hard failures sort before objectives; nearest-value shortcuts are not authoritative.
- `fixed-point.ts` detects stable CD6↔CD7 rebinding, oscillation, blockers, and resource limits using semantic digests.
- `graph.ts`, `report.ts`, `decision.ts`, `project.ts`, and `transactions.ts` provide canonical derivation graphs, dependency invalidation, proof-completeness report gates, human-only approval, optimistic concurrency, idempotency, atomic rollback, and immutable audit history.
- `agent-tools.ts` and `/api/calculation/propose` keep AI proposal-only through the shared provider-neutral LLM router. AI cannot return authoritative numeric results, select values, approve reports, or mutate schematic/PCB state.

## Product and storage surfaces

- `/calculation?project=<project-id>` is linked from CD-06. It shows `BLOCKED BY CD-6` until one exact, current, complete, feasible, human-approved CD-06 candidate exists. The workspace exposes obligations, blocking unknowns, variables, models, graph status, corners, margins, fixed-point state, and approval state.
- Scoped APIs cover prerequisite compilation, approved bounded evaluators, corner enumeration, proof-gated report materialization, feedback, proposal-only AI, transactions, and approved-report export.
- Browser persistence stores `calculationProgram` and immutable history separately from schematic and PCB state. Any changed CD-1 through CD-6 digest archives and removes the current CD-07 successor. Imported CD-07 state requires an explicit project-fork migration.
- `drizzle/0015_cd07_deterministic_calculation.sql` adds immutable signoff, registry, problem, graph, report, decision, and idempotent transaction records.

## Safety invariants with automated evidence

| Invariant | Enforcement |
|---|---|
| Decimal arithmetic is exact where promised | canonical rational parser/arithmetic tests |
| Unit mistakes fail rather than coerce | dimension, prefix, affine-temperature, Hz/rad/s, degree/radian tests |
| Unknown/typical/characterized is not guaranteed | evidence-class and variable-domain gates |
| Sampling is not exhaustive proof | `sampled_not_proven` coverage test and authority benchmark |
| Numerical uncertainty can block a boundary decision | pass/fail/indeterminate margin tests |
| Loaded networks include the load | loaded-versus-unloaded divider oracle |
| Preferred values are joint and fully recomputed | callback-count enumeration test |
| AI has no mutation/approval authority | proposal shape and transaction authorization tests |
| Rebinding oscillation cannot loop forever | semantic fixed-point oscillation test |
| Upstream changes cannot leave an approved stale report | digest-pinned persistence invalidation and history |

## Verification corpus and benchmarks

All 93 nominal, boundary, negative, adversarial, and known-answer case classes explicitly listed by the specification are registered with immutable hashes in `calculation/corpus.ts`. They remain honestly marked `manifest_only`; metadata is not licensed manufacturer evidence, an independent golden, mutation score, solver proof, expert review, or hardware validation.

- Governed Stage-09 manifest: 45 packages, zero diagnostics.
- CD-07 manifest package: passed; 93 visible case classes and zero invalid hashes.
- CD-07 authority package: passed; AI, estimates, and sampling cannot claim proof.
- CD-07 10,000-variable deterministic scale package: passed.
- Focused CD-07 domain tests: 26 passed.
- Complete Sirkit suite: 166 files passed, 1,113 tests passed, 9 skipped, zero failed.
- TypeScript and focused ESLint: passed.
- Production build: passed and emitted `/calculation` plus eight calculation API routes. Five pre-existing Turbopack file-tracing warnings remain in Java/FreeRouting, ngspice, and `next.config.ts` paths.

## Honest limitations

- The current production chain does not contain a complete, human-approved CD-06 exact-part candidate. CD-06 is itself formally blocked by CD-05, so no real CD-07 report can be authorized.
- The approved model registry is intentionally empty by default. Production equations/models require source evidence, independent oracles, qualification, and human review; Sirkit does not pre-approve formulas merely because they are familiar.
- Supported calculators are a bounded low-voltage embedded subset. Switching compensation, op-amp stability/noise, crystal startup, protection coordination, coupled electrothermal analysis, mains/high-energy, RF, SerDes, regulatory safety, CFD, and extracted SI/PI remain external-review or unsupported scopes.
- Transcendental verified numerics, general root/DAE solvers, validated table/curve interpolation, branch-and-bound continuous optimization, full derating databases, and proof-producing large-scale CP-SAT/SMT/MILP are not implemented.
- The 93-case corpus still needs licensed source fixtures, independent goldens, mutation/metamorphic evidence, cross-platform numerical replay, manufacturer reference designs, expert review, and downstream CD-8 through CD-13 evidence.

## Formal verdict

### `BLOCKED`

Primary blocker: `BLOCKED BY CD-6`. The safe CD-07 kernel, contracts, APIs, UI, persistence, migration, tests, and governed verification manifest are implemented, but neither the prerequisite production candidate nor the full expert/licensed verification evidence required for a genuine CD-07 completion verdict exists.
