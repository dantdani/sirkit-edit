# B12.4 §B — the strict journal schema

> **SUPERSESSION NOTE (B12.5).** Validation below stands unchanged, but
> the storage boundary it fed was not: the localStorage store's key
> encoding collided distinct valid scopes (B12.5 counterexample R4 —
> `:` is a legal scope character, so {a:b, c} and {a, b:c} shared one
> key) and its saveIf was not a cross-context CAS (R1). The production
> store now uses injective [tenant, project, branch] array keys with
> bounds validated before key derivation and a truly atomic saveIf:
> `../ai-control-plane-b12-5/collision-free-scope-identity.md`.
> Preserved as historical evidence.


Module: [`approved-mutation-journal.ts`](../../app/lib/engineering/approved-mutation-journal.ts)
(`validateEntry`, `isReceiptShaped`, `loadDocument`). Supersedes B12.3's
partial-cast `validateEntry` (R2: a `canonical-committed` entry with
`baseHeadMark: null` and a valid checksum was accepted).

## Document validation

- Capture-first (`capturePlainJson`, bounded ≤ 256 KB) — hostile, cyclic,
  oversized input can never throw.
- Exact closed key set `{schema, version, entries}` (`version` absent on
  pre-B12.4 documents reads as 0); `schema` exact; `version` a safe
  integer ≥ 0; `entries` an array. Anything else → document-corrupt.
- Duplicate identities within a document flag that identity as corrupt
  (first entry wins for reads; writes refuse).

## Entry validation (all 24 keys, closed)

- Exact closed key set; exact `schema`; `identityKey`/`operationsDigest`/
  `baseSchematicDigest` matching `eng1-…`; `proposalId` matching
  `prop-…`; `clientOperationId === proposalId`; `lineageId` matching
  `lin1-…`; scope ids matching the bounded id pattern.
- **Scope coherence**: `tenantId`/`projectId`/`branchId` must equal THIS
  `ApprovedMutationJournal` instance's scope — a foreign-scope entry with
  a valid checksum is CORRUPT (cross-project receipt substitution dies
  here).
- Nested head marks: exact two keys, safe-integer sequence ≥ 0, `eng1-`
  digest. `originRunId` null or a bounded string; `operationCount`
  1…256; `destructive` boolean; `preparedAt`/`committedAt` finite.
- Receipts: exact 20-key closed set, exact schema/patterns/bounds
  (`isReceiptShaped`), and full COHERENCE with the entry (proposalId, ops
  digest, scope, base mark, head after, digests, counts, classification,
  `completedAt === committedAt`, `originRunId` equal).

## State-dependent invariants

| State | Must hold |
| --- | --- |
| `prepared` | NO commit/adoption/receipt fields (all null) |
| `canonical-committed` | complete committed inputs (committedAt, transactionId, headAfter, schematicDigestAfter; revisions null-or-digest); NO receipt |
| `adopted` | same as canonical-committed |
| `receipt-finalized` | complete committed inputs + an exact coherent receipt |
| `poisoned` | receipt null; committed fields either absent or COMPLETE — the known canonical transaction is never half-erased |

The consistency checksum is verified LAST and is explicitly not
authentication. Validation and every service lookup are total — proven
over hostile, malformed, cyclic, oversized, and checksum-valid-malformed
input in `b12-4-journal-strictness.test.ts`.
