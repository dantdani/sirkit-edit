# Sirkit Footprint Binding Stage 1 Implementation Evidence

## 1. Verdict

BLOCKED

The authoritative Stage 1 foundation is implemented, compiles, builds, passes all 25 focused tests and the 1,267-test repository regression suite, and is safe behind its disabled/shadow boundary. The specification's strict `COMPLETE` bar is not yet provable because the additive migration, rollback and restart persistence were not executed against an isolated PostgreSQL qualification database; nine unrelated repository tests are skipped; no mutation-testing runner exists; and the broad repository lint gate has pre-existing failures outside this stage. No production footprint assignment or PCB mutation behavior was changed.

## 2. Repository discovery

The complete flow/ownership inventory is in `SIRKIT_FOOTPRINT_BINDING_STAGE_01_REPOSITORY_DISCOVERY.md`. Relevant authorities are `lib/schematic-types.ts` and `app/lib/schematic-compiler/types.ts` for component identity, `app/lib/atomic/*` and atomic DB tables for exact facts/evidence/assets, `lib/footprint-assign.ts` and `app/lib/pcb/netlist-bridge.ts` for unchanged production assignment/sync, `app/lib/pcb/pin-pad-mapping.ts` for existing runtime accounting, `app/api/pcb/assign/suggest/route.ts` for suggestions, and `lib/persistence.ts`/`app/lib/pcb/board-persistence.ts` for existing project/board persistence.

## 3. Implemented changes

- Authoritative model and contracts: `app/lib/physical-binding/types.ts`.
- Stable identity, canonicalization, validation, conflicts and immutable transitions: `identity.ts`, `stable.ts`, `validation.ts`, `conflicts.ts`, `transitions.ts`.
- Central readiness: `readiness.ts`.
- Service, in-memory qualification store and PostgreSQL repository: `repository.ts`, `server-repository.ts`.
- Legacy input/read-only projection: `legacy.ts`.
- Observation-only rollout and telemetry: `shadow.ts`, `observability.ts`.
- Scoped API: `app/api/physical-bindings/`.
- Additive schema: `app/lib/db/schema.ts`, `drizzle/0022_footprint_binding_stage01.sql`.

The authoritative mutable decision boundary is `PhysicalBindingService`; legacy views are derived and explicitly non-authoritative.

## 4. Data model and invariants

Bindings use stable component instance identity scoped by tenant/project/branch/board/hierarchy/assembly variants, never refdes. Exact part, supplier SKU, package, footprint locator/version/content digest and mapping certificate are separate. Lifecycle, approval, technical validation, freshness, conflict, applicability and readiness remain independent. Canonical version 1 uses NFC, sorted object keys, declared set ordering and SHA-256. Approval/validation cite the exact technical digest. Technical changes require immutable successors. Candidate sets are bounded at 256 and have one optimistic-lock effective selection pointer.

## 5. Migration and compatibility

Recognized legacy fields include footprint/footprintHint, package/packageNormalized, MPN, manufacturer, supplier SKU, part ID, component ID, refdes and value. Raw input and unknown fields are preserved. Bare ambiguous passive packages remain ambiguous. MPN without manufacturer remains non-exact. Migration produces an unapproved, unverified, unselected candidate with a deterministic key; repeated migration creates no duplicate record/audit. Dry run does not persist. Rollback disables the API/shadow consumer without deleting legacy or new records. The compatibility view is read-only and marked `authoritative: false`.

Qualification fixture count: 1,000 legacy capacitors, all correctly ambiguous and all blocked from layout readiness.

## 6. Readiness behavior

- Generic `J1`: not layout-ready; package, footprint, mapping, selection, approval, validation, freshness and evidence blockers; no connector facts invented.
- Generic `100n`: not layout-ready; capacitance does not imply package and matching counts do not imply mapping.
- Exact selected/validated/approved/current part: layout-ready.
- Same exact part without manufacturing hooks: layout-ready but not manufacturing-ready.
- Fully evidenced exact part fixture: manufacturing-ready under the declared profile, while explicitly not claiming certification, availability or release authority.

## 7. Security, authorization, and audit

API requests require explicit tenant/project/branch/actor/role scope, are capped at 2 MB and are isolated by project. Server provenance overwrites client actor data. Human reviewer/admin authorization is required for selection/approval; migration requires admin. Imported values are bounded; null bytes, deep/oversized objects and unsafe locators are rejected without path access. Ordinary reads redact raw migration fields. Immutable audits carry scoped idempotency keys and deterministic event digests. Remaining risk: live database authorization/rollback behavior awaits isolated integration qualification.

## 8. Verification evidence

| Command | Purpose | Exit | Result | Notes |
|---|---|---:|---|---|
| `pnpm exec tsc --noEmit --pretty false` | Strict type check | 0 | passed | Whole repository |
| `pnpm exec eslint app/lib/physical-binding app/api/physical-bindings --max-warnings=0` | Focused lint | 0 | passed | Zero warnings |
| `pnpm exec vitest run app/lib/physical-binding/__tests__ --reporter=dot` | Stage 1 qualification | 0 | 25 passed | Includes security, migration, state, API, performance and real PCB-sync shadow equivalence |
| `pnpm test -- --reporter=dot` | Repository regression | 0 | 1,267 passed, 9 skipped | 188 files passed, 2 skipped |
| `pnpm exec drizzle-kit check` | Migration consistency | 0 | passed | `Everything's fine` |
| `pnpm build` | Production build | 0 | passed | 133 pages; `/api/physical-bindings` emitted; five unrelated dynamic spawn trace warnings |
| `pnpm exec eslint . --max-warnings=0` | Broad lint | 1 | failed | 30 errors/13 warnings in pre-existing unrelated files; Stage 1 paths clean |
| PostgreSQL migration apply/rollback/restart | Live persistence qualification | skipped | not proven | Requires an isolated DB; no external schema was mutated |

Shadow evidence executes the actual `syncFromSchematic` production path with Stage 1 disabled and enabled, proving deep-equal board, netlist and report output and no added mutation.

## 9. Performance evidence

Windows x64, Node v24.15.0: 10,000 canonical digests in 88.272 ms (5,000 ms budget); 1,000 migrations in 371.786 ms (5,000 ms); 1,000 readiness evaluations in 153.04 ms (5,000 ms); sorting the bounded 256-candidate set in 0.238 ms (100 ms). These are regression indicators, not universal hardware guarantees. PostgreSQL latency was not measured.

## 10. Documentation and Stage 2 handoff

- `docs/physical-binding-stage-01.md`
- `docs/physical-binding-stage-02-handoff.json`
- `SIRKIT_FOOTPRINT_BINDING_STAGE_01_REPOSITORY_DISCOVERY.md`
- `progress/2026-07-18/10-footprint-binding-stage-01.md`

The Stage 2 contract defines candidate queries, effective-selection semantics, raw fact handling, proposal creation, authorized selection/approval, deterministic readiness, compatibility/shadow behavior, concurrency/idempotency, gate/error codes and permitted/deferred behavior. It does not implement resolver priority.

## 11. Limitations and deferred work

- Qualification blocker: isolated PostgreSQL migration/apply/rollback/restart test.
- Stage 2: unified resolver priority and proposal synthesis.
- Stage 3: production PCB-sync cutover and preflight UI.
- Stage 4: mapping verification engine.
- Stages 5–10: passive policy, assignment UX, library monitoring, routed-copper protection, AI/catalog selection, custom footprints and final full-flow qualification.
- No current schematic, board, placement, route, copper, DRC, exporter or AI-editor behavior was changed.

## 12. Changed-file inventory

Production: `app/lib/physical-binding/*`, `app/api/physical-bindings/*`, `app/lib/db/schema.ts`.  
Migration/schema: `drizzle/0022_footprint_binding_stage01.sql`, `drizzle/meta/_journal.json`.  
Tests/fixtures/evidence: `app/lib/physical-binding/__tests__/*`, `scripts/physical-binding-stage1-evidence.ts`, `artifacts/footprint-binding-stage-01/qualification-evidence.json`.  
Documentation: the four files listed in section 10 plus this report.

The protected worktree already contained extensive unrelated changes from earlier Sirkit stages; they were intentionally preserved. The original `C:\Users\robsa\sirkit` folder was not modified.
