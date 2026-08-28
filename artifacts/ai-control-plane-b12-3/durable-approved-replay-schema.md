# B12.3 §A — the durable approved-mutation replay journal

> **SUPERSESSION NOTE (B12.4).** The entry integrity digest below is a
> CONSISTENCY CHECKSUM, not authentication (it is publicly recomputable);
> validation was a partial cast that accepted checksum-valid malformed and
> foreign-scope entries, and `prepare()` could downgrade committed entries
> (B12.4 counterexamples R1–R3). Superseded by
> `../ai-control-plane-b12-4/strict-journal-schema.md` and
> `../ai-control-plane-b12-4/monotonic-journal-state-machine.md`.
> Preserved as historical evidence.


Module: [`app/lib/engineering/approved-mutation-journal.ts`](../../app/lib/engineering/approved-mutation-journal.ts)

## Authority model

The journal's authority is **the canonical transaction record plus the
exact authenticated proposal identity** — it never mints approval, never
bypasses authentication, and is consulted only AFTER capture + sealed-body
integrity + live-scope verification. The in-memory
`ApprovedMutationRegistry` remains a concurrency cache; it is no longer the
only source of completed-execution identity or receipts.

## Schemas

- Document: `sirkit.approved-mutation-journal.v1` — `{ schema, entries[] }`,
  project/branch scoped, bounded (≤ 64 entries, FIFO eviction; ≤ 256 KB
  serialized).
- Entry: `sirkit.approved-mutation-journal-entry.v1`, binding:

| Field | Meaning |
| --- | --- |
| `identityKey` | the complete approved-mutation identity (v2 — the whole sealed body) |
| `proposalId` / `clientOperationId` | the sealed id, which is also the executor's idempotency key |
| `operationsDigest` | the sealed operations digest |
| `tenantId` / `projectId` / `branchId` / `lineageId` | the sealed scope |
| `baseHeadMark` / `baseSchematicDigest` | the sealed base head mark and schematic digest |
| `originRunId`, `operationCount`, `destructive`, `preparedAt` | deterministic receipt inputs (identity side) |
| `committedAt`, `transactionId`, `revisionBefore`, `revisionAfter`, `headAfter`, `schematicDigestAfter` | deterministic receipt inputs (canonical side — recorded at commit; `committedAt` IS the receipt's `completedAt`) |
| `receipt` | the finalized ORIGINAL receipt, once persisted |
| `state` | explicit lifecycle state (below) |
| `integrity` | digest over the entry body (this field excluded), schema-versioned |

## State machine

```
prepared → canonical-committed → adopted → receipt-finalized
                    ↘ poisoned (permanent, recovery required)
```

Transitions are persisted at: `prepare` (before the canonical commit
begins), `markCommitted` (before adoption — the deterministic receipt
inputs), `markAdopted` (after the production adoption; a lost write is the
same recovery class), `finalizeReceipt` (REQUIRED before committed success
is returned), `poison` (on any unverifiable commit/adoption).

## Stores

`ApprovedMutationJournalStore` (`load`/`save` by tenant/project/branch):

- `BrowserLocalStorageApprovedMutationJournalStore` — the production
  browser implementation (localStorage, size-bounded; unavailability
  THROWS and surfaces as a typed `unavailable` disposition → the apply
  boundary fails closed with `recovery-required`).
- `InMemoryApprovedMutationJournalStore` — instance-scoped test
  implementation. **No module-global memory anywhere.**

## Load discipline

Loads are **capture-first** (`capturePlainJson`, bounded) and
integrity-verified per entry: a tampered or malformed entry surfaces as
`corrupt` for its identity (never silently dropped, never trusted); a
malformed document surfaces as document-corrupt; storage failures surface
as `unavailable`. Writes are read-modify-write over the validated document
and never throw (`{ ok } | { ok: false, reason }`).
