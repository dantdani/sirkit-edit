# B13 — production authority source map

## The two durable subsystems and the one bridge

- **Physical-binding** (`app/lib/physical-binding/**`) — tenant/project/
  branch/board/component-scoped, immutable-revision, optimistic-locked
  aggregates with a Postgres adapter. Carries the selection's facet
  states (lifecycle/approval/freshness/conflict), the footprint asset,
  the pin/pad mapping (symbol/footprint asset versions + mapping
  certificate), and the exact part (`atomicPartRevisionId`, MPN,
  manufacturer). **This is the scoped authority.**
- **Atomic catalog** (`app/lib/atomic/**`) — a GLOBAL, tenant-less
  published part library. `loadPublishedPortableSnapshot(revisionId)`
  returns non-null only for a PUBLISHED revision. **This is the
  cross-check that an `atomicPartRevisionId` is real and published.**

Scope is applied on the physical-binding side only (the atomic side has
nothing to filter on). The loader confirms the atomic revision but sources
the asset identity from the SCOPED binding.

## The loader

`loadComponentAuthorityRecords(deps, input)` in
[component-authority-source.ts](../../app/lib/engineering/component-authority-source.ts):

- `deps.bindings: AuthorityBindingSource` — a narrow, injectable, server-
  only read interface (`loadForComponent(scope, componentInstanceId)`).
  Production adapts `PhysicalBindingRepository`; tests inject deterministic
  in-memory aggregates. Any throw ⇒ the whole load fails closed.
- `deps.atomic: AtomicRevisionConfirmer` — confirms a revision is
  published (production adapts `loadPublishedPortableSnapshot`).
- Input: authenticated `scope` (+ boardInstanceId), the run's
  `canonicalRevision`, the stable `componentInstanceIds`, optional
  `assemblyVariantId` and `signal`.
- Output: `{ status: "loaded"; records; candidates; sourceDigest }` or
  `{ status: "unavailable"; reason }`.

### Projection table (durable binding → authority record)

| `ComponentAuthorityRecord` field | Source |
| --- | --- |
| `authorityRecordId` | `set.setId` (conflicted: sorted set ids joined) |
| `componentId` | requested `componentInstanceId` |
| `projectId` | authenticated scope |
| `authorityRevision` | selected `binding.revisionId` |
| `selectedPart.{mpn,manufacturer,package}` | `exactPart.exactPublishedMpn` / `exactPart.manufacturerId` / `package.canonicalName` |
| `lifecycle/approval/freshness/conflict` | selected binding facet `.state`s |
| `footprintAsset` | `footprint.availability` |
| `mappingVerification` | `pinPadMapping.state` |
| `footprintBindingRevision` | `footprint.assetVersionId` |
| `mappingVerificationRevision` | `pinPadMapping.mappingCertificateId` |
| `approvalRevision` | `approval.decisionId` |
| `exactAuthority` | resolved ONLY for a fully verified selection whose atomic revision is confirmed published (see [exact-target-authority-contract.md](exact-target-authority-contract.md)) |

Never exposed: database rows, credentials, supplier internals, SDK
objects, raw provider content. The result is deterministic (sorted by
componentId), bounded (`MAX_AUTHORITY_COMPONENTS = 512`), and carries a
`sourceDigest` over the projected records for provenance.

## Failure surfaces (from the discovery agents, all fail-closed here)

- The physical-binding barrel re-exports the Postgres adapter; the loader
  depends only on the narrow injected interface, so it drags in no DB at
  import. `getDb()` throws when `DATABASE_URL` is unset — surfaced as
  `unavailable`.
- `findForComponentVariant` is N+1; the production adapter is the caller's
  concern (the loader bounds component count and fails closed on throw).
- The atomic search/catalog endpoints are unauthenticated and unbounded;
  the loader uses only the by-revision published confirmer, never a full
  catalog scan.
