# Sirkit Footprint Binding Stage 6 Repository Discovery

## Scope and conclusion

This discovery covers the protected working copy only. It maps every current producer of footprint-assignment blockers, every relevant decision or mutation authority, persistence and invalidation boundaries, and user-facing paths before any Stage 6 queue implementation.

The mandatory prerequisite gate fails. Stage 6 must not be implemented yet: its decision workbench would have to compose Stage 1, 3, 4 and 5 mutations that do not currently share a durable, crash-recoverable transaction. Building a local substitute would create a second authority and violate the Stage 6 prompt.

## Authority and ownership map

| Concern | Current owner | Current behavior | Stage 6 classification |
|---|---|---|---|
| Physical binding identity, lifecycle, selection and approval | `app/lib/physical-binding/*` | Immutable candidate successors, explicit human transitions, readiness and audit; PostgreSQL adapter exists | Correct conceptual authority, but live migration/restart qualification remains blocked |
| Deterministic candidate resolution | `app/lib/footprint-resolver/*` | Read-only Stage 2 resolver with structured statuses, blockers, traces and dispositions | Safe queue source after prerequisites pass; never a mutation authority |
| Schematic-to-PCB preflight and apply | `app/lib/pcb-sync/*` | Separate preflight/plan/apply and plan invalidation; runtime API uses in-memory snapshots/repository | Qualification-only; cannot be Stage 6 re-preflight authority yet |
| Pin/package-terminal/pad mapping | `app/lib/mapping-verification/*` | Verify, persist, approve/reject/revoke/stale, Stage 1 projection and Stage 3 invalidation | Qualification-only in-memory composition; no durable cross-owner commit |
| Passive package policy | `app/lib/passive-policy/*` | Draft/validate/submit/approve/publish/revoke policy and read-only evaluation | Qualification-only; no authoritative component-exception/opt-out commit operation |
| Exact atomic assets and evidence | `app/lib/atomic/*` | Versioned symbols, footprints, exact parts and evidence | Input authority; Stage 6 must reference immutable revisions, never copy them |
| Existing PCB sync UX | `app/components/pcb/PcbEditor.tsx` | Legacy `Schematic -> PCB` calls `handleSync`; board state persists through current client flow | Existing production path; unsafe to reuse as a Stage 6 decision commit |
| AI schematic editing | `app/page.tsx#handleEditSchematic` and `Apply suggestions` | Validated schematic mutation path with special edit guard | Unrelated mutation authority; must not approve/commit footprint assignments |
| Legacy footprint defaults | `lib/footprint-assign.ts`, `app/lib/pcb/package-map.ts`, `app/lib/pcb/netlist-bridge.ts` | Heuristic/default assignment still used by the production bridge | Inventory/comparison only; forbidden as Stage 6 authority |
| Project persistence | `lib/persistence.ts` | Browser `localStorage` for current product project state | Not a server-side transactional decision ledger |
| PCB undo/audit | `app/lib/pcb/history.ts` | Client board-command undo/redo and board engineering events | Board-only; cannot roll back or prove cross-stage engineering decisions |
| Full-flow jobs | `app/lib/full-flow/jobs.ts` | CD-13-specific stage invocations, leases and exactly-once checks | Different bounded context; not a reusable Stage 6 event/job system without an explicit architecture change |

## Blocker producers

### Stage 1 physical readiness

`app/lib/physical-binding/readiness.ts` produces explicit gates for applicability, effective selection, approval, technical validation, freshness, mapping and evidence. It correctly distinguishes `not_applicable` from `not_ready`. `app/lib/physical-binding/transitions.ts` supplies explicit select, request-approval, approve, reject, revoke, stale, revalidate, supersede, orphan and withdraw actions.

These are actionable only through `PhysicalBindingService`. They are not safe to invoke from Stage 6 until the PostgreSQL migration, restart recovery and complete cross-stage transaction are qualified.

### Stage 2 resolution

`app/lib/footprint-resolver/types.ts` provides stable resolution status families including resolved, not applicable, missing data, ambiguity, conflict, invalidity, unapproved, stale, unavailable, unsupported, deferred and error. Candidate source, authority, disposition, conflict class and required remediation are structured.

Stage 2 is read-only. It is a future queue aggregator source and post-decision verifier, not an assignment mutation path.

### Stage 3 PCB-sync readiness

`app/lib/pcb-sync/service.ts` owns preflight and separately authorized apply. `app/lib/pcb-sync/repository.ts` owns board/plan compare-and-swap concepts, audit/replay and mapping/passive-policy invalidation. The live route explicitly instantiates `InMemoryPcbSyncRepository` and an in-memory snapshot provider, labels itself qualification-only, and has no qualified recovery after process loss.

Stage 6 therefore cannot promise that a decision was followed by durable plan invalidation and a fresh authoritative preflight.

### Stage 4 mapping verification

`MappingVerificationService` exposes inspect, verify, persist verification, approve, reject, revoke and mark stale. Its route uses `InMemoryMappingRepository`, an in-memory Stage 1 projector and a scoped invalidation target. Mapping publication, Stage 1 successor projection, audit/idempotency and Stage 3 invalidation are not one durable commit.

Mapping blockers can be displayed, but remediation cannot be offered as an authoritative Stage 6 action yet.

### Stage 5 passive policy

`PassivePolicyService` exposes policy-level draft, edit, validate, submit, approve, publish, revoke and successor operations plus read-only evaluate/preview/history. It does not expose the Stage 6-required authoritative per-component operations for providing facts, approving an exception, selecting an exact binding or recording an opt-out. Its route uses `InMemoryPassivePolicyRepository` and an in-memory context provider and reports `qualification_only`.

The Stage 5 handoff explicitly says not to start authoritative Stage 6 integration until durable decision persistence, Stage 3 invalidation, audit/idempotency, PostgreSQL migration and restart recovery are qualified.

## Decision and mutation path classification

| Path | May Stage 6 eventually call it? | Current status |
|---|---:|---|
| Stage 1 immutable candidate + select/approve transitions | Yes, via authoritative service only | Blocked pending durable qualification and shared transaction coordinator |
| Stage 4 mapping verify/persist/approve transitions | Yes, through its owner and exact revisions | Blocked pending durable repository and atomic projection/invalidation |
| Stage 5 policy edit/publish | Only as a separate policy workflow | Blocked pending durable repository; component exception APIs are missing |
| Stage 3 plan invalidation and re-preflight | Yes, after every committed relevant decision | Blocked pending trusted durable snapshot/board/plan authority |
| Legacy `resolveFootprint`, package guessing or 0603 defaults | No | Heuristic production compatibility path; never authoritative |
| AI `Apply suggestions` / schematic editor | No | Discussion/edit workflow, not a human footprint-decision transaction |
| PCB history undo | No | Board mutation history only; wrong aggregate and persistence scope |
| CD-13 full-flow job lease/event helpers | No direct reuse | Separate schema and lifecycle; adopting it requires an explicit shared-platform design |

## Persistence and recovery findings

1. Stage 1 has a PostgreSQL repository with optimistic locking and insert-only audits, but its migration apply/rollback and restart recovery have not been qualified against an isolated live database.
2. Stage 3, Stage 4 and Stage 5 live routes instantiate process-memory repositories/providers. Their state is lost on restart.
3. Current product project state remains browser-local, so a server workbench cannot obtain one trusted durable component/variant/board snapshot.
4. There is no transaction/outbox/saga that atomically coordinates a Stage 1 decision, optional Stage 4/5 owner mutation, immutable audit/idempotency record, Stage 3 plan invalidation and queue successor state.
5. Existing idempotency is local to each stage. It does not prove exactly-once semantic completion across all participating aggregates.
6. There is no recovery worker that can distinguish committed decision/pending invalidation from an uncommitted decision after process death.

## UI and interaction findings

- `PcbSyncReadinessPanel`, `MappingVerificationPanel` and `PassivePackagePolicyPanel` are truthful stage-specific views; the latter two are not mounted into the legacy editor and are not a unified queue.
- The existing PCB editor intentionally has no footprint-assignment drawer. The legacy sync button remains the live path.
- AI `Apply suggestions` mutates the schematic through a guarded edit route. Reusing it would violate the required separation between discussion, suggestion, preview and explicit authorized commit.
- CD-06 component selection is a conceptual-design workspace and explicitly preliminary; it is not physical-binding approval authority.

## Unsafe duplication risks

A Stage 6 implementation today would necessarily duplicate at least one of: physical-binding transitions, mapping publication, passive exceptions, PCB-sync invalidation, project persistence, audit/idempotency or recovery. Any duplicate would permit divergence between the queue's displayed state and the authoritative owner. The prompt explicitly forbids that substitute architecture.

## Smallest safe enabling work

Implement and qualify a server-side transaction/recovery boundary that:

1. reads a trusted immutable project/component/variant snapshot;
2. invokes the existing owner services rather than cloning their logic;
3. commits Stage 1 decision successors, Stage 4 or Stage 5 owner changes, audit and idempotency durably;
4. records Stage 3 invalidation in the same transaction or a durable transactional outbox;
5. resumes idempotently after process death;
6. reruns Stage 2 and Stage 3 from pinned dependency digests;
7. passes isolated PostgreSQL apply/rollback/restart and Stages 1-5 regression gates.

Only after that work passes may Stage 6 build queue materialization, comparison, preview and workbench UI.
