# Footprint binding Stage 2 — unified resolver

Implemented one deterministic read-only footprint resolver over the Stage 1 physical-binding model. Added versioned request/context/policy/result/trace contracts; conservative immutable-identity normalization; bounded Stage 1 adapters; eligibility/readiness composition; explicit conflict, ambiguity, precedence and status derivation; single/batch/explain/compare API; pseudonymized telemetry; and an observation-only legacy shadow boundary.

Safety decisions:

- Generic `J1` and value-only `100n` remain unresolved.
- Bare `0603` remains explicitly ambiguous.
- AI, human, legacy and inferred suggestions cannot satisfy authority.
- Exact current selected/approved/validated/mapped assets can resolve for layout.
- Manufacturing assessment cannot resolve without manufacturing readiness.
- Stale footprint/mapping dependencies block.
- Explicit current DNP returns `not_applicable`.
- Production PCB sync remains unchanged until Stage 3.

Verification: Stage 1 25/25; Stage 2 39/39; repository 1,306 passed, 9 skipped, 0 failed; type check, focused lint, migration check and production build passed; website returned HTTP 200. Broad lint still reports the same 30 errors/13 warnings outside Stage 2. Strict verdict remains `BLOCKED` because Stage 1 isolated PostgreSQL apply/rollback/restart qualification and the skipped-test/no-mutation-runner gates are still unproven.

Key evidence: `SIRKIT_FOOTPRINT_BINDING_STAGE_02_IMPLEMENTATION.md`, `docs/footprint-resolver-stage-02.md`, `docs/footprint-resolver-stage-03-handoff.json`, and `artifacts/footprint-binding-stage-02/qualification-evidence.json`.

