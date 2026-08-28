# B13.1 §C — durable aggregate validation

## The defect (R4)

The B13 loader consumed durable rows as ground truth: tampered digests,
selected-outside-candidates sets, empty approval evidence, and
mapping/footprint disagreement all projected as if valid — some minting
exactAuthority.

## The rule

[component-authority-source.ts](../../app/lib/engineering/component-authority-source.ts)
`aggregateIsValid(aggregate, scope)` runs BEFORE any projection:

1. Non-empty binding list; bounded (`MAX_AGGREGATES_PER_COMPONENT = 8`,
   `MAX_BINDINGS_PER_AGGREGATE = 256`, `MAX_EVIDENCE_PER_BINDING = 512` —
   oversized data is a validity failure, not a truncation).
2. EVERY binding's scope equals the run scope
   (tenant/project/branch/board) — cross-scope rows can never leak in.
3. EVERY binding passes the REAL `validatePhysicalBinding` (schema
   version, technical digest recompute, record digest recompute,
   approval-evidence requirements, mapping↔footprint agreement, lifecycle
   consistency — the same validator the binding service itself uses).
4. The set passes the REAL `validateBindingSet` against its bindings
   (selected binding must be a candidate, set record-digest recompute,
   lifecycle agreement).

## Fail-closed truthfulness

An invalid aggregate does NOT vanish and does NOT project: the loader
emits a truthful `conflictedRecord` for that component — state
`conflicted`, no facets, no exactAuthority, gap text naming durable-source
validation. The agent sees that authority for the component is
conflicted/inconsistent rather than a fabricated "unknown component".

## Proof (§C, six tamper cases + control)

Starting from a REAL approved aggregate built through
`PhysicalBindingService` (fixtures in `_authority-fixtures.ts`), each
single-field tamper flips the record to `conflicted` with
`exactAuthority` absent:

| tamper | result |
| --- | --- |
| `schemaVersion` bumped | conflicted |
| `technicalDigest` byte-flipped | conflicted |
| binding `recordDigest` byte-flipped | conflicted |
| set `recordDigest` byte-flipped | conflicted |
| selected binding removed from candidates | conflicted |
| `decisionEvidenceRefs` emptied | conflicted |
| mapping `footprintAssetVersionId` mismatched | conflicted |

The untampered control projects `verified-exact` with full exactAuthority
(§D test 18) — proving the validators are wired to the same data the happy
path uses, not to a strawman.
