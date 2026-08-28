# B06 — Canonical Schematic Command Contract

Status: implemented and enforced. Every claim below is backed by code and by
`app/lib/engineering/__tests__/b06-schematic-mutations.test.ts`.

## Canonical model

`app/lib/engineering/schematic-model.ts` defines `CanonicalSchematic`
(`sirkit.schematic.v1`): `components` (theory), `kicadComponents`, `wires`,
`netLabels`, optional `pageSize`. It preserves the identities the product
depends on:

- **Component instance identity** — `id` (UUID). It is the netlist component
  id, the pcb-sync `componentInstanceId`, and the physical-binding scope key.
  `refDes` is display-only.
- **Component-authority identity** — the optional Stage-5 fields on
  `KicadComponentInstance` (`atomicPartRevisionId`, `symbolAssetVersionId`,
  `footprintAssetVersionId`, `mappingCertificateId`, `selectionRecordId`).
- **Symbol/library identity** — `partId` (catalog FK; static data is looked up,
  never denormalized into the document).
- **Editable properties** — `value`, `refDes`; **position/orientation** —
  integer-px `x`,`y` on a 10px grid, `rotation ∈ {0,90,180,270}`. The model
  has **no mirror state** (verified against the code).
- **Wires** — coordinate-attached polylines; **net membership is derived
  geometrically** (exact vertex==pin-coordinate identity), never stored.
- **Revision/schema version** — the model is versioned; the executor's
  `parseCanonicalSchematic` is a validating reader that returns `null` for
  anything else (operations then fail closed with
  `SCHEMATIC_MODEL_UNAVAILABLE`). Deterministic digests via
  `schematicSemanticDigest` / `schematicStateDigest`.

Adapters `toCanonicalSchematic`/`fromCanonicalSchematic` normalize the UI
`SchematicState` (optional arrays → required); no editor rewrite.

## Operations (`EngineeringOperation`, schemaVersion 1, units "px")

| Kind | Input | Inverse | Notes |
|---|---|---|---|
| `schematic_delete_component` | family, componentId, `removeWireIds[]`, `removeNetLabelIds[]` | `schematic_restore_entities` with **order-exact indexed snapshots** | The cleanup plan is part of the operation: validated, replayable, visible in the durable record |
| `schematic_restore_entities` | indexed snapshots (`{at, entity}`) per family | delete of the restored components | Insert-only; any id collision rejects; **only minted by the kernel as an inverse** |
| `schematic_replace_component` | componentId, `expectedCurrentPartId`, replacement identity+authority, validated `pinMapping`, `wireEndpointMoves`, `netLabelMoves` (B06.1: position-preconditioned label moves), optional `consumedAuthorityResources` | replace-back with the ORIGINAL identity/authority and reversed endpoint AND label moves | Identity and ALL authority fields are replaced together; absent fields are removed, never retained; verified authority only via the B06.1 bundle adapter |
| `schematic_set_component_properties` | family, componentId, patch {value?, refDes?} | property snapshot patch | refDes: non-empty, unique; theory has no refDes |
| `schematic_transform_component` | family, componentId, absolute x/y/rotation | prior transform | rotation domain enforced |

Every operation defines: deterministic operation identity (`operationId`,
duplicate-id rejection), target scope (declared per-entity in
`declaredScopeForOperations` — `schcomp:`/`schwire:`/`schlabel:` plus the
`schematic` global domain), expected preconditions (`expectedCurrentPartId`,
transaction-level expected revision), idempotency (durable
`clientOperationId` replay), validation result, exact state mutation, exact
inverse, affected entities, downstream invalidations (below), history and
revision behavior, approval classification (B01 registry tiers), and an audit
representation (the durable transaction record).

## Commands (B01 registry ↔ kernel bindings)

| Command | Operations | Tier | Runtime callers |
|---|---|---|---|
| `schematic.delete-component` | delete | destructive | canvas delete tool, Delete/Backspace, both properties panels |
| `schematic.replace-component` | replace | destructive | BOM part swap (all instances of a part, one transaction) |
| `schematic.set-property` | set-properties | reversible | both properties panels (commit-on-blur/Enter) |
| `schematic.move-rotate` | transform | reversible | Ctrl+R, panel rotate controls |
| `schematic.edit-tier1-propose` (B06.1) | none — proposal only | none | `/api/schematic/edit` responses sealed into pending proposals; zero mutation authority |
| `schematic.edit-tier1-apply` | set-properties + delete | destructive | B06.1: explicit "Apply exact proposal" only — digest-verified sealed operations, one atomic transaction |
| `pcb.undo-redo-canonical` | all schematic kinds (replay only) | destructive | `executeUndoRedo` verified replay exclusively |

Authorization is semantic-capability based: every `schematic_*` kind requires
`edit_components`, which the Stage-10 rule **categorically refuses for AI
actors**. Destructive-tier execution requires the branded
`InteractiveUiChannel` (B03.2 composition boundary; `schematic-session.ts` is
an approved importer, enforced by CI) or an independent `approve_proposal`
approval. Caller-supplied actorKind/provenance/labels can only narrow a
channel grant, never create one. Processor-name heuristics and UI labels play
no role in authorization.

## Execution path

`SchematicEditorSession` (`app/lib/engineering/schematic-session.ts`) is the
single UI boundary: queue-serialized, one command → one canonical transaction
(expected-revision check, capability check, atomic commit-or-rollback via the
`AtomicProjectStore`, deterministic revision advancement, idempotent retry,
durable record with exact inverses) → one `SchematicHistory` entry
(`commitCanonicalSchematic` labels the entry; rejected commands change
nothing and surface a structured toast). Undo/redo reconcile the snapshot
history onto the canonical lineage through the B03.1 verified-replay
contract; a non-matching restore rebases deterministically instead of
guessing.

**B06.1**: the session persists through the durable IndexedDB store
(`sirkit-schematic-canonical-v1`) — snapshot, revision, and transaction log
survive reload; the SavedProject projection is reconciled by its atomic
head mark and can never overwrite a newer canonical head; queued commands
build against the head at their execution position (known canonical
ancestor snapshots never rebase, so rapid commands cannot lose updates).
See `artifacts/ai-control-plane-b06-1/schematic-durability-contract.md`.

## Downstream invalidation

A schematic transaction advances `domainRevisions.schematic`, which
invalidates (dependency graph, tested): `electrical_truth` → `drc`,
`route_measurements`, `readiness`, `manufacturing_preflight`, `ai_snapshot`.
Invalidated kinds are returned in the structured execution result and
surfaced by the session as `invalidatedArtifactKinds`. Product-level
consequences (schematic parity, pcb-sync dirty flag/preflight fail-closed,
BOM regroup, SPICE design-revision capture, physical-binding qualification)
are recorded per-plan in the delete/replace impact plans.

## What is NOT exposed

No schematic mutation command or operation kind appears in the B04 tool
catalog, any discovery channel, provider (OpenAI/Anthropic) schemas, chat, or
MCP. `/api/schematic/edit` and `/api/schematic/edit-build` remain
proposal-only routes; their output executes exclusively through the trusted
human session after deterministic compilation (B06.1: `compileTier1Proposal`
→ sealed proposal → explicit human apply) — or not at
all.
