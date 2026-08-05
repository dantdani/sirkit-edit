# Sirkit Footprint Binding Stage 2 Implementation Evidence

## 1. Verdict

BLOCKED

The Stage 2 resolver is implemented, read-only, deterministic, tested, built and safe behind its API/optional-shadow boundary. The strict specification verdict cannot be `COMPLETE`: Stage 1's isolated PostgreSQL migration apply/rollback/restart qualification is still unproven, nine repository tests remain skipped, no mutation-testing runner exists, and broad repository lint has 30 errors/13 warnings outside Stage 2. No existing schematic, PCB, production footprint assignment, routing, copper, or library behavior was changed. The smallest next action is an isolated PostgreSQL Stage 1/2 qualification run, followed by review of the nine skips; there is no current design-data risk because production PCB sync still uses the legacy path.

## 2. Stage 1 prerequisite evidence

- Authoritative model: `app/lib/physical-binding/types.ts`, schema `sirkit.physical-binding.v1`.
- Mutable service boundary: `app/lib/physical-binding/repository.ts#PhysicalBindingService`.
- Deterministic readiness: `app/lib/physical-binding/readiness.ts`.
- Additive migration: `drizzle/0022_footprint_binding_stage01.sql`.
- Handoff: `docs/physical-binding-stage-02-handoff.json`.
- Focused prerequisite regression: 5 files, 25/25 tests passed.
- Drizzle consistency: passed.
- Compatibility mapping consumes Stage 1 binding sets, immutable candidate revisions, effective selection, readiness gates and legacy captures without changing their semantics.

Stage 1 remains strictly `BLOCKED` only at its live isolated-database and repository-wide hygiene gates; its in-memory contracts, migration logic, API, shadow equivalence, compilation and build evidence are green.

## 3. Repository discovery and authority map

The complete inventory is `SIRKIT_FOOTPRINT_RESOLVER_STAGE_02_REPOSITORY_DISCOVERY.md`.

- `lib/footprint-assign.ts`: legacy atomic/hint/category-default resolver; comparison-only future disposition.
- `app/lib/pcb/netlist-bridge.ts`: actual schematic-to-PCB production selection/mutation; unchanged until Stage 3.
- `app/lib/pcb/package-map.ts`: legacy package heuristic; unchanged until Stage 3.
- `app/api/pcb/assign/suggest/route.ts`: AI suggestion path; remains non-authoritative.
- `app/lib/atomic/*`: exact catalog/evidence producer; consumed through Stage 1 bindings.
- `app/lib/physical-binding/repository.ts`: sole binding mutation/selection/approval authority; Stage 2 added only `findForComponentVariant` read access.
- `app/lib/physical-binding/readiness.ts`: reused readiness authority.
- `app/components/pcb/PcbEditor.tsx`: production sync caller; untouched.

## 4. Implemented resolver architecture

- Single public service and immutable context assembler: `app/lib/footprint-resolver/service.ts#FootprintResolutionService`.
- Pure core: `engine.ts#DeterministicFootprintResolutionEngine`.
- Provider adapters and bounded collection: `adapters.ts`.
- Versioned types: `types.ts`.
- Policy: `policy.ts`.
- Technical identity and canonical digests: `stable.ts`.
- Conservative normalization/deduplication: `normalize.ts`.
- Request/context/Stage 1 validation composition: `validation.ts`.
- Read-only API: `app/api/footprint-resolution/route.ts` and `_scope.ts`.
- Shadow boundary: `shadow.ts`.
- Pseudonymized metrics: `observability.ts`, emitted by the service.

No Stage 2 database migration was needed; it reads the Stage 1 schema.

## 5. Resolution policy and safety behavior

Policy `sirkit.footprint-resolution-policy/1.0.0` ranks: selected Stage 1; approved exact part; approved component assignment; approved symbol fact; approved package mapping; disabled Stage 5 passive policy; suggestion-only. Precedence runs only after structural integrity, exact variant applicability, lifecycle, selection, digest-scoped approval, technical validation, freshness, conflict, package compatibility, asset availability, verified mapping and Stage 1 readiness.

Preview/layout/migration/shadow resolution requires layout readiness; manufacturing additionally requires manufacturing readiness. A lower suggestion never blocks a valid selected winner, but an incompatible current approved authoritative claim does. Equal high-authority material candidates block instead of using score/order. Status priority is conflict, invalid, stale, unavailable, unsupported, ambiguity, missing data, unapproved, then deferred decision; all issues are retained. Explicit valid/current DNP is handled before fake assignment.

Technical equivalence excludes library nickname/display name and includes immutable exact-part, package revision, footprint asset version/content/semantic digests and mapping certificate/revision data. Same name/different digest and same asset/different mapping do not merge.

## 6. Candidate sources and provenance

| Source | Version | Authority | Stage 2 behavior |
|---|---|---|---|
| selected Stage 1 | `sirkit.stage1-binding-source/1` | selected Stage 1 | implemented; may resolve after every gate |
| exact catalog binding | same | approved exact part | implemented from Stage 1 candidates; still needs selection/readiness for layout |
| human component assignment | same | approved component | implemented; manual origin alone grants nothing |
| symbol/upstream fact | same | approved symbol fact | implemented; imported property alone grants nothing |
| normalized package mapping | same | approved package mapping | implemented; ambiguous aliases remain blocked |
| legacy assignment | same | suggestion-only | implemented for migration/comparison; cannot be promoted |
| AI/catalog suggestion | same | suggestion-only | implemented; confidence never grants authority |
| passive policy | `sirkit.passive-policy-hook/disabled-stage2` | future approved policy | explicitly unsupported until Stage 5 |
| generated overlay | `sirkit.generated-overlay-hook/disabled-stage2` | suggestion-only | explicitly unsupported until Stage 10 |

Each adapter records kind/version/status/dependency digests and distinguishes success, empty, unavailable, failed, unsupported, timeout and cancellation. One failed lower adapter cannot corrupt a valid authoritative result.

## 7. Representative results

| Fixture | Status | Essential evidence |
|---|---|---|
| generic `J1` | `unresolved_missing_data` | `FR_STAGE1_BINDING_SET_MISSING`; no refdes/pin-count inference |
| generic `100n` | `unresolved_missing_data` | `FR_PACKAGE_MISSING`; value does not imply package |
| bare `0603` | `unresolved_ambiguous` | `FR_PACKAGE_AMBIGUOUS`; metric/imperial semantics required |
| exact approved STM32 fixture | `resolved` | immutable asset `footprint-stm32-ufqfpn48:r3`, verified mapping, layout ready |
| same part, manufacturing purpose | `unresolved_missing_data` | layout is ready; manufacturing is not ready and missing manufacturing gates remain visible |
| two current approved selected assets | `blocked_conflict` | multiple selection and incompatible-asset conflict records |
| footprint dependency marked stale | `blocked_stale` | dependency, mapping, approval and technical-validation stale reasons |
| explicit current DNP | `not_applicable` | no resolved footprint emitted |

## 8. Shadow comparison evidence

The matrix test covers ten reachable valid-input categories: one each for equivalent resolution, asset mismatch, legacy-resolved/new-blocked, legacy default, legacy hint, legacy-unresolved/new-resolved, both-unresolved equivalent/different reason, legacy error and new error. A separate timeout fixture produces `new_error` while returning the production object exactly. The generic capacitor produces high-risk `legacy_default_new_requires_policy`.

The actual `syncFromSchematic` fixture is deep-equal with shadow disabled/enabled, leaves the schematic unchanged and adds no PCB mutation. Mean synthetic enabled-shadow overhead was 0.652 ms versus 0.013 ms disabled; timeout is bounded. `comparison_unavailable` is reserved for future/invalid comparison shapes and is not emitted for the validated closed input union.

## 9. Security, authorization, cache, and operations

The API requires tenant/project/branch/actor/role scope; body scope is overwritten. Cross-tenant lookup returns no facts. Diagnostic traces require reviewer/admin roles. JSON bodies are capped at 4 MB and must use `application/json`; batches/candidates are capped at 256; traces at 2,048 steps; adapters at 1,500 ms. Exceptions are mapped to stable codes without raw stack/secret leakage.

Telemetry uses a deterministic project pseudonym and contains no component, raw tenant or raw project identifier. Cache is explicitly disabled (`no-cache/1`, `no-store`) because local mean exact resolution was 2.571 ms and safe invalidation would add risk. Deployment-level distributed rate limiting remains an infrastructure concern; in-process work is bounded by payload, batch, candidate and adapter limits.

## 10. Verification evidence

| Command | Purpose/environment | Exit | Passed/failed/skipped | Notes |
|---|---|---:|---|---|
| `pnpm exec vitest run app/lib/physical-binding/__tests__ --reporter=dot` | Stage 1 prerequisite | 0 | 25/0/0 | 5 files |
| `pnpm exec vitest run app/lib/footprint-resolver/__tests__ --reporter=dot` | Stage 2 unit/integration/API/security/fault/shadow | 0 | 39/0/0 | 5 files |
| `pnpm exec vitest run --reporter=json --silent --outputFile=...` | Full repository, Node 24/Windows x64 | 0 | 1,306/0/9 | 195 files executed |
| `pnpm exec tsc --noEmit --pretty false` | Whole-repository types | 0 | passed | no diagnostics |
| focused ESLint command | Stage 2 production/API/tests/evidence | 0 | 0 errors/0 warnings | clean |
| `pnpm exec drizzle-kit check` | migration consistency | 0 | passed | `Everything's fine` |
| `pnpm build` | Next.js 16.2.6 production build | 0 | passed | BUILD_ID and `/api/footprint-resolution` manifest verified |
| `pnpm exec eslint . --max-warnings=0` | broad repository lint | 1 | 30 errors/13 warnings | zero Stage 2 findings; pre-existing unrelated paths |
| HTTP `GET http://localhost:3001` | running protected copy | 0 | 200 | dev site reachable |
| isolated PostgreSQL apply/rollback/restart | persistence qualification | not run | unproven | strict blocker inherited from Stage 1 |

The raw full-suite result, compact lint summary and qualification evidence are under `artifacts/footprint-binding-stage-02/`.

## 11. Performance evidence

Windows x64, Node v24.15.0 synthetic deterministic fixtures:

| Fixture | Samples | Mean | p95 | Max |
|---|---:|---:|---:|---:|
| exact selected resolution | 50 | 2.571 ms | 3.961 ms | 5.276 ms |
| missing component | 50 | 1.337 ms | 1.988 ms | 2.367 ms |
| 100-component batch | 5 | 81.264 ms | 100.995 ms | 100.995 ms |
| 256 equivalent candidates normalized | 20 | 22.926 ms | 31.463 ms | 33.198 ms |
| enabled shadow | 30 | 0.665 ms | 1.308 ms | 2.131 ms |

These measurements justify no cache in Stage 2; they are regression indicators, not universal production latency guarantees. PostgreSQL/network latency was not measured.

## 12. Documentation and Stage 3 handoff

- `docs/footprint-resolver-stage-02.md`: architecture, semantics, API and operational contract.
- `docs/footprint-resolver-stage-03-handoff.json`: exact transferable output and atomic cutover requirements.
- `SIRKIT_FOOTPRINT_RESOLVER_STAGE_02_REPOSITORY_DISCOVERY.md`: all current authorities/mutation points.
- `progress/2026-07-18/11-footprint-binding-stage-02.md`: concise change record.
- `artifacts/footprint-binding-stage-02/qualification-evidence.json`: machine-readable evidence.

Stage 3 must accept only `status === resolved` and `resolvedBinding`, recheck revision/dependency guards immediately before one undoable transaction, fail before mutation if any populated component is unresolved, and retain legacy production authority until explicit qualification/cutover.

## 13. Limitations and deferred work

- Qualification: run Stage 1 migration apply/rollback/restart against an isolated PostgreSQL database; classify/remove nine repository skips; add a mutation-testing tool if the strict gate remains mandatory.
- Stage 3: production schematic-to-PCB cutover, atomic application, rollback, UI preflight and rollout metrics.
- Stage 4: create new pin-pad verification certificates; Stage 2 only consumes existing verified records.
- Stage 5: passive policy; disabled, so `100n` never implies `0603`.
- Stage 6: user-facing decision/selection/approval queue.
- Stage 7/8: no placement/routing changes in this task.
- Stage 9: richer AI/catalog suggestions remain non-authoritative.
- Stage 10: generated/custom footprint overlay generation.
- Operations: distributed rate limiting and live PostgreSQL latency/load qualification.

## 14. Changed-file inventory

Production code:

- `app/lib/physical-binding/repository.ts` — added scoped read query in both repositories.
- `app/lib/footprint-resolver/{types,policy,stable,validation,adapters,normalize,engine,service,shadow,observability,index}.ts`.
- `app/api/footprint-resolution/{_scope,route}.ts`.

Schemas/migrations: none; Stage 2 consumes Stage 1 migration `0022`.

Tests/fixtures/evidence:

- `app/lib/footprint-resolver/__tests__/{fixtures,policy-request,resolution-e2e,normalization-conflict,safety-status-property,service-shadow-api-security}.ts`.
- `scripts/footprint-resolver-stage2-evidence.ts`.
- `artifacts/footprint-binding-stage-02/{qualification-evidence,full-suite,full-lint-summary}.json`.

Documentation:

- `SIRKIT_FOOTPRINT_RESOLVER_STAGE_02_REPOSITORY_DISCOVERY.md`.
- `SIRKIT_FOOTPRINT_BINDING_STAGE_02_IMPLEMENTATION.md`.
- `docs/footprint-resolver-stage-02.md`.
- `docs/footprint-resolver-stage-03-handoff.json`.
- `progress/2026-07-18/11-footprint-binding-stage-02.md`.

The protected worktree already contained extensive changes from earlier Sirkit stages; they remain untouched except for the explicitly listed Stage 1 repository read interface. The original `C:\Users\robsa\sirkit` folder was not modified.
