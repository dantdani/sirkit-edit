# Authoritative Physical Binding Foundation (Stage 1)

## Purpose and boundary

This subsystem records what Sirkit knows about the physical implementation of a schematic component, where that knowledge came from, whether it was selected and approved, whether its dependencies remain current, and why layout or manufacturing readiness is blocked.

It does not choose a footprint, alter the current resolver priority, change schematic-to-PCB sync, route or place a board, generate footprints, or change the AI editor guard. The feature is safe to run only as a read/write binding service and read-only shadow evaluator until later stages explicitly cut over consumers.

Stage 1 alone does not make a schematic transferable to PCB when footprint assignments are unresolved.

## Source of truth

`app/lib/physical-binding/types.ts` defines the authoritative project-level aggregate. Existing atomic catalog records remain authoritative for exact parts, evidence and immutable CAD assets. Existing PCB board state remains authoritative for placed geometry and copper. Existing production footprint assignment remains authoritative during Stage 1 rollout.

Compatibility views are explicitly marked `authoritative: false` and are never accepted as a mutation source.

## Entity model

- `StableComponentIdentity`: project-, board-, branch- and hierarchy-scoped instance identity. Refdes is absent by design.
- `ExactPartBinding`: exact manufacturer plus published MPN; supplier identities remain separate.
- `PackageBinding`: revisioned, explicit identity system and dimensions. Display tokens do not establish equality.
- `FootprintAssetBinding`: logical asset, immutable version, content digest, source namespace, availability and manufacturing metadata.
- `PinPadMappingReference`: Stage 4 contract boundary with symbol/footprint revisions, digest and verifier version.
- `ComponentPhysicalBinding`: immutable candidate revision containing provenance and independent state axes.
- `ComponentPhysicalBindingSet`: bounded candidates and at most one effective selection per exact assembly-variant scope.
- `PhysicalReadinessAssessment`: immutable derived gate results; callers cannot set readiness directly.

## Identity and variants

Native schematic instance IDs are preserved across refdes changes, value changes and symbol movement. Copy creates a new ID with traceable origin. Delete/recreate does not inherit a prior binding merely because refdes is reused. Legacy formats without stable IDs use a deterministic reconciliation key containing project, branch, board, hierarchy and source locator.

Assembly variant IDs are canonical sets. Different scopes produce different set identities. A selected binding is only effective for its exact scope.

## Canonicalization and digests

Canonical algorithm `sirkit.physical-binding-canonical/1`:

1. Normalize strings to Unicode NFC.
2. Sort object keys and omit `undefined`.
3. Normalize negative zero; reject non-finite numbers.
4. Sort fields declared semantically set-like; preserve order elsewhere.
5. Hash canonical UTF-8 JSON with SHA-256 and prefix `pb1-`.

The technical digest excludes lifecycle, approval, validation, freshness, conflict, timestamps and origin display details. Approval and validation must cite the exact technical digest. Material technical changes therefore invalidate old approval/validation without erasing history. The record digest covers the complete immutable revision.

## Independent state axes

| Axis | States |
|---|---|
| Lifecycle | draft, candidate, selected, superseded, withdrawn, orphaned, obsolete |
| Approval | unreviewed, pending, approved, rejected, expired, revoked |
| Technical validation | pending, valid, invalid, unsupported |
| Freshness | current, stale, unknown, missing_source |
| Conflict | none, present |
| Applicability | applicable, not_applicable, unknown |
| Layout readiness | ready, not_ready, not_applicable (derived) |
| Manufacturing readiness | ready, not_ready, not_applicable (derived) |

Origin never implies approval or validity. Approved does not imply technically valid; valid does not imply approved; selected does not imply either. DNP/not-applicable does not masquerade as footprint-ready.

All material actions produce immutable successor revisions plus append-only audit events. Human selection/approval is role-gated. AI may propose a candidate but cannot select or approve it. Optimistic set revisions reject stale concurrent writes; idempotency keys make retries deterministic.

## Readiness gates

Layout gates cover stable identity, applicability, explicit package identity, exact footprint asset and digest, source availability, package compatibility, revision-bound mapping, effective selection, digest-scoped approval, digest-scoped technical validation, current dependencies, no conflict, usable lifecycle, valid variant scope and resolvable evidence.

Manufacturing adds exact part/manufacturer, exact-part package tie, electrical validation, assembly data, manufacturing geometry validation, exact-part/footprint compatibility, manufacturing evidence, optional supply evidence and external stage prerequisites.

Every gate has a stable code, status, record path, remediation category, severity, blocking flag and evidence references. All gates are returned in deterministic order. A manufacturing-ready result does not certify manufacturability, availability, fabricator acceptance, production release or first-pass hardware.

## Provenance and evidence

Origins include exact catalog, symbol import, legacy migration, project policy, human selection, AI suggestion, package-derived data, generated overlay, upstream library import and API enrichment. Each contains actor/tool identity, source reference, time, evidence, optional rule version and confidence. Evidence references point to the existing atomic/project evidence stores; raw documents and credentials are not copied into binding rows.

## Freshness and invalidation

Dependency snapshots include symbol, package, footprint revision/digest, mapping certificate/verifier, exact-part evidence, approval policy, variant definition, package policy and external validation references. Material changes create a stale successor. Symbol/footprint/mapping changes also stale a previously verified mapping. Unrelated candidate scopes remain unchanged.

## Persistence and concurrency

Migration `drizzle/0022_footprint_binding_stage01.sql` adds:

- immutable physical binding revisions;
- one optimistic-lock binding-set head per project/component/variant scope;
- append-only audit events with scoped idempotency uniqueness;
- idempotent legacy migration records;
- immutable readiness assessments.

`PostgresPhysicalBindingRepository` writes the aggregate in one transaction. Revision and audit rows are insert-only. The set head is the sole mutable pointer and updates only when its expected revision matches.

## Legacy migration and rollback

The migration adapter preserves the complete raw legacy object and classifies recognized fields without changing them. A `legacy_migration` candidate always starts as:

- lifecycle `candidate`;
- approval `unreviewed`;
- technical validation `pending`;
- freshness `unknown`;
- mapping `legacy_unverified`;
- no effective selection.

Bare ambiguous package tokens remain unresolved. A legacy MPN without manufacturer is not promoted to an exact part. Invalid footprint locators produce diagnostics instead of being discarded or loaded as paths. Dry run creates no persistent state. The deterministic migration key makes retry/resume idempotent.

Rollback disables shadow/API consumers and leaves both original legacy information and new binding records intact. Stage 1 never writes normalized values back into legacy schematic fields, so old production behavior remains available.

## Shadow operation

Set `SIRKIT_PHYSICAL_BINDING_SHADOW=true` only to observe comparisons. `withPhysicalBindingShadow` executes the existing production callback exactly once, returns the same result object unchanged and emits comparison diagnostics out-of-band. It cannot select a candidate or mutate schematic, PCB, placement, routing, copper or board geometry.

## API and security

`/api/physical-bindings` requires tenant/project/branch/actor/role headers, caps JSON at 2 MB and verifies project isolation. Actor provenance is reconstructed from authenticated scope instead of trusting a client-supplied actor. Selection and approval require authorized human roles. Migration requires project or migration admin. Ordinary reads redact raw legacy fields.

Imported strings are bounded, Unicode-normalized and treated only as data. The migration adapter rejects null bytes, excessive nesting and oversized payloads. It never opens a path or dynamically imports a library name. Errors return stable codes without echoing raw hostile input.

## Observability

`PhysicalBindingTelemetry` records candidate lifecycle counts, readiness/gate counts, staleness, conflicts, migration outcomes, schema encounters, validation failures, optimistic conflicts, shadow disagreements and duration. Shared labels contain a project pseudonym and stable reason code, never raw MPN, component/user ID, filesystem path, prompt or credential.

## Worked examples

### Generic J1

`J1` is display metadata, not a connector choice. Without series, pitch, orientation, mounting, package, asset and mapping evidence, the evaluator reports explicit package/asset/mapping/approval blockers. It invents nothing.

### Generic 100n capacitor

`100n` is electrical value, not physical package. Bare `0603` is ambiguous between unit systems and remains unresolved. A legacy footprint string can be preserved as an unapproved candidate but cannot become layout-ready.

### Exact approved part

An exact atomic part with explicit package revision, available content-addressed footprint, verified revision-bound mapping, current dependencies, technical validation and human approval can become layout-ready. Manufacturing readiness additionally requires the stricter assembly/manufacturing/external gates.

## Operations

1. Apply the additive database migration.
2. Keep the shadow flag disabled by default.
3. Run migration dry-run and inspect ambiguous/failed counts.
4. Persist migrated candidates; verify no effective selections appear.
5. Enable shadow observation for a bounded project cohort.
6. Alert on migration failures, active-selection conflicts, broken evidence and shadow disagreements.
7. Disable the flag to return to pre-Stage-1 reads; no legacy rollback mutation is necessary.

## Limitations and non-goals

Stage 2 owns resolver priority and candidate synthesis. Stage 3 owns PCB-sync cutover/preflight. Stage 4 owns mapping verification. Stage 5 owns passive package policy. Stage 6 owns ambiguity assignment UX. Stage 7 owns full library revision monitoring. Stage 8 owns routed-copper footprint-change protection. Stage 9 owns AI/catalog selection. Stage 10 owns generated/custom footprints and full-flow qualification.
