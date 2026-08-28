# B16.0.12 §F — Atomic component & part authority proof

All four catalog/part surfaces are READ-ONLY and none can promote, approve, or
publish anything — the migration moved only the boundary; every authority
behavior is byte-preserved and pinned.

| Claim | Evidence |
|---|---|
| Only published atomic revisions appear publicly | the catalog query keeps `publicationState = 'published'` (byte-identical WHERE); `searchPublishedAtomicCatalog` (unchanged) backs `/atomic/search`; the KiCad category lists published-only |
| `catalogSnapshotId` deterministic over the exact published-id set | pinned: two identical published-id sets → identical `catalog_<semanticHash>` id |
| Pagination / `nextCursor` | pinned: `limit+1` probe row → cursor = last emitted id; `after` cursor threads into the WHERE |
| Semantic hashes unchanged | `semanticHash` module untouched; catalog emits stored `semanticHash` verbatim |
| No draft authority leak | `/parts/[id]`'s `atomicCompatibility` remains the labeled **draft compatibility bridge** (`legacyPartToAtomicDraft`, never approval); `atomicAssignments` are emitted ONLY from existing `partsAtomicLinks` rows (published authority links), pinned by the missing-part case |
| Malformed part ids keep their historical in-bound responses | `/parts/[id]` → `{ok:true, part:null}` (200) with ZERO DB work; `/parts/[id]/alternates` → 400 `Invalid part id` with ZERO DB work; `/pcb/footprints/[id]` → 404 with ZERO DB work — all pinned |
| Alternate ranking / lifecycle / stock / best-price unchanged | the alternates query pipeline and `bestOfferPrice` aggregation are byte-preserved (only the `kind`/`limit` reads moved to `meta.query` with identical semantics) |
| No promotion path | none of the four routes performs any write; the DB fake proves the invocation set is selects-only |
