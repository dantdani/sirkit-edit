# Sirkit Footprint Binding Stage 7 Repository Discovery

## Scope and conclusion

This report inventories the protected Sirkit copy's persistence, identity, library, refresh/re-synchronization, import/export, copy/fork and recovery boundaries before Stage 7 implementation.

Stage 7 cannot start under the supplied prompt. Its mandatory prerequisite gate requires a persisted Stage 6 queue, decisions, audits, staleness/successor behavior and Stage 7 handoff. Stage 6 correctly stopped at its own mandatory gate and produced no queue implementation or Stage 7 handoff. Building Stage 7 storage around missing Stage 6 contracts would create the parallel state the prompt explicitly prohibits.

## Persistence and identity inventory

| Area | Repository owner | Actual behavior | Stage 7 assessment |
|---|---|---|---|
| Live project/schematic state | `lib/persistence.ts` | `SavedProject` JSON in browser `localStorage`; create/load/save/rename/delete/duplicate | Live product authority is client-local and lacks server transaction, optimistic concurrency and crash recovery |
| Live board state | `app/lib/pcb/board-persistence.ts` | Board stored inside `SavedProject`; current-project and last-sync hash are separate `localStorage` keys | Board and sync marker are not one durable transaction; sync hash is explicitly optional |
| PCB semantic revision | `app/lib/pcb/revision.ts` | Deterministic board semantic digest over stable fields | Useful dependency input, not a persistent manifest or commit protocol |
| PCB editing history | `app/lib/pcb/history.ts` | In-memory undo/redo plus append-only session engineering events | Board-command scope only; does not persist cross-stage decisions/recovery |
| Stage 1 physical binding | `app/lib/physical-binding/*`, `drizzle/0022_footprint_binding_stage01.sql` | Immutable successors, optimistic set head, audit and PostgreSQL repository | Strongest relevant server authority; isolated migration/restart qualification remains incomplete |
| Stage 2 resolver | `app/lib/footprint-resolver/*` | Deterministic read-only results with dependency/status details | Future manifest consumer; no persisted result/cache authority |
| Stage 3 sync | `app/lib/pcb-sync/*`, `app/api/pcb-sync/route.ts` | Plans, board CAS, audit/replay and invalidation modeled; live route instantiates in-memory repository/snapshot provider | Qualification-only and lost on process restart |
| Stage 4 mapping | `app/lib/mapping-verification/*`, mapping API | Immutable lifecycle modeled; live route uses in-memory repository/projector/invalidation | Qualification-only; no PostgreSQL durability or cross-stage atomicity |
| Stage 5 passive policy | `app/lib/passive-policy/*`, passive API | Policy lifecycle modeled; live route uses in-memory repository/context provider | Qualification-only; no durable component exception/opt-out decision operation |
| Stage 6 queue/decisions | None | Only blocked reports; no schemas, repository, route, UI, tests or handoff | Mandatory prerequisite absent |
| Generic engineering envelope | `app/lib/engineering/persistence.ts` | Integrity-chained project envelope and transactions backed by `InMemoryAtomicProjectStore` | Unused qualification model; not wired to live project or Stage 1-6 owners and cannot be promoted as a parallel truth |
| Atomic catalog | `app/lib/atomic/server-repository.ts`, database atomic tables | Transactionally publishes sources, records, licenses, raw content, immutable CAD assets, mapping and audit | Reusable exact-asset foundation, but not a project dependency manifest/source-health/reconciliation system |

Stable schematic component IDs and PCB `syncIdentity`/stable IDs exist in the current netlist and board models. The production bridge explicitly uses component IDs rather than refdes for reconciliation. That is a useful foundation, but project copy/fork and server persistence do not yet preserve a formally versioned identity/lineage contract.

## Library-source inventory

| Source/path | Identity and revision behavior | Availability/cache behavior | Gaps for Stage 7 |
|---|---|---|---|
| KiCad symbol and footprint tables | `app/lib/atomic/library-resolver.ts` parses `sym_lib_table`/`fp_lib_table`, gives project scope precedence, detects same-scope duplicates and resolves only permitted paths | Filesystem view under `SafePathPolicy`; unsupported source types fail visibly | No durable source registry, release history, health state, event ingestion or rename lineage |
| KiCad symbol/footprint content | `app/lib/atomic/kicad-assets.ts` records raw content SHA-256, semantic hash, parser version, source/license binding and exact version ID | Parsed under bounded S-expression rules; unsupported/lossy features remain diagnostics | No old/new semantic differ or project impact graph |
| Atomic published assets | PostgreSQL `atomic_raw_objects`, `atomic_cad_assets`, source/evidence/license tables | Exact raw objects and published portable snapshots can be reconstructed | No per-project lock manifest, tenant/project asset authorization model, referenced-asset retention/GC proof or offline project-open coordinator |
| Browser part data | `app/lib/parts-cache.ts` | Module-level session cache; hard refresh clears it; known misses cached only for session | Not an immutable/offline asset snapshot and not usable for reproducibility |
| Legacy PCB footprint APIs | `app/api/pcb/footprints/*`, package map and netlist bridge | Runtime lookup/default compatibility path | Mutable name/locator-oriented compatibility input; must not become lock authority |
| Project-local libraries/import | KiCad adapters and safe library resolver provide partial parsing | No complete project archive/import registry found | Portability, credentials, collision handling, archive integrity and transactional import are not implemented as Stage 7 contracts |

The supported KiCad parser comments currently scope modern S-expression libraries approximately from KiCad 6 through the KiCad 10-era formats represented by date versions `20210108` through `20269999`; unsupported formats are quarantined. That parser scope is not yet a Stage 7 product capability profile.

## Refresh and re-synchronization paths

- `app/components/pcb/PcbEditor.tsx#handleSync` calls the legacy `syncFromSchematic`, then reseeds board history and saves through the client persistence path.
- `app/lib/pcb/netlist-bridge.ts` documents sync-twice idempotence and stable component reconciliation, but it still owns compatibility footprint resolution and is not the default-off Stage 3 authoritative service.
- `app/lib/pcb/board-persistence.ts` compares/stores a deterministic netlist hash for the UI dirty badge. The hash and board save are separate operations.
- Stage 3 has explicit preflight/plan/apply and stale-plan modeling but only in-memory live repositories.
- Stage 4 and Stage 5 can generate invalidation intent in their qualification repositories, not a durable outbox shared with Stage 1/3/6.
- No complete library refresh/update event pipeline, semantic change detector, reconciliation planner or authorized reconciliation executor exists.
- No code path was found that durably reopens a project by loading one server-side Stage 1-6 snapshot and validating exact locked content before external libraries.

## Copy, fork, import and export

`duplicateProject` creates a new random project ID and copies schematic state, AI settings and component selections. It deliberately does not clone the PCB or define physical-binding, asset, audit, credential or manifest lineage. This is not a Stage 7 fork contract.

KiCad and manufacturing export routes exist, plus stage-specific exports. They do not form a signed/integrity-checked physical dependency portability package. No complete Sirkit project import transaction was found that verifies archive paths, reconciles tenant/project identities, preserves unknown schemas and refuses unverifiable approvals.

## Transaction, audit, event and recovery inventory

- Stage 1 uses a PostgreSQL transaction and optimistic head revision for its own aggregate.
- Atomic catalog publication transactionally commits a portable published snapshot and audit.
- Stage 3-5 use stage-local in-memory locks, optimistic revisions, idempotency maps and audits.
- `app/lib/engineering/persistence.ts` models an integrity envelope and failure points, but only provides an in-memory store and has no live consumers outside its own engineering package/tests.
- CD-13 job leases/exactly-once helpers are a separate conceptual-design bounded context.
- No shared transactional outbox table, recovery worker or persisted cross-stage saga was found for footprint binding.
- No Stage 6 storage/event model exists to invalidate or preserve.

## Authority classification

| Classification | Paths |
|---|---|
| Authoritative binding truth | Stage 1 physical-binding service/repository |
| Authoritative catalog asset publication | Atomic server repository and atomic database tables |
| Live project/board product state | Browser `SavedProject` and board persistence |
| External/upstream source view | KiCad library table resolver and file/API adapters |
| Dependency manifest/lock projection | Missing |
| Library source registry/change detector | Missing |
| Semantic differ/impact graph | Missing |
| Reconciliation planner/executor | Missing |
| Stage 2/3/4/5 invalidation targets | Modeled, but Stage 3-5 live targets are process-memory only |
| Stage 6 consumer/invalidation target | Missing |
| Compatibility adapters | Legacy footprint assignment, package mapping, netlist bridge and KiCad adapters |
| Unsafe duplicate authority | Any new Stage 7 store that directly writes bindings/mappings/policies/queue decisions instead of calling their owners |

## Specification dependency deadlock

The Stage 6 prompt forbids implementing its workbench until durable Stage 1 decisions, Stage 3 invalidation, Stage 4/5 owner operations, idempotency and restart recovery are qualified. The Stage 7 prompt is designed to implement durable persistence and recovery, but forbids starting until the Stage 6 queue and decisions already persist and expose a Stage 7 handoff.

Both requirements cannot be satisfied in the current order. Treating Stage 7 as permission to invent missing Stage 6 records would violate Stage 7; treating Stage 6 as permission to use in-memory persistence would violate Stage 6.

## Safe revised sequence

1. Introduce a narrowly scoped **foundation-remediation stage** authorized to build the shared PostgreSQL project snapshot/transactional-outbox/recovery substrate for existing Stage 1, 3, 4 and 5 owner contracts only.
2. Qualify migrations, process-kill recovery, idempotent replay, cross-stage invalidation and trusted server snapshots without enabling production behavior.
3. Resume Stage 6 against that substrate and complete its durable queue/decision/audit/staleness contracts plus Stage 7 handoff.
4. Resume Stage 7 to add project manifests, immutable locks, library source registry/events, semantic differs, impact analysis, reconciliation, portability and Stage 8 handoff.

This sequencing keeps Stage 1 authoritative and avoids a second truth.
