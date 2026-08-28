# B12.3 — reload and idempotency evidence

> **SUPERSESSION NOTE (B12.4).** The "byte-identical original receipt"
> claim below relied on `validateApprovedMutationReceipt` + transactionId
> equality — both publicly recomputable checksums. A modified receipt with
> recomputed digests passed as the original (B12.4 counterexample R1).
> Receipt authority now requires full authoritative linkage (proposal +
> canonical record + chain-protected commitment + re-derived after-digest):
> `../ai-control-plane-b12-4/authoritative-receipt-linkage.md`. Preserved
> as historical evidence.


What `b12-3-durable-replay.test.ts` proves with GENUINE reload
compositions: a fresh `SchematicEditorSession` over the SAME durable
`AtomicProjectStore` (opened at the committed head, including the
production `recovered-canonical` → `confirmAdoption` handshake when the
persisted projection predates the crash), a FRESH in-memory registry and
interlock, and the SAME durable journal store.

## The R1/R2 closure

| Claim | Evidence |
| --- | --- |
| Exact replay after reload returns `already-applied` | fresh registry, fresh session — the durable journal + canonical evidence answer, not process memory |
| The returned receipt is BYTE-IDENTICAL to the original | `receiptId` equal, `JSON.stringify` equal, canonical-JSON equal; still validates under `validateApprovedMutationReceipt` |
| The transaction count remains exactly one | durable `transactionLog.length === 1` asserted before and after every replay, across two consecutive reloads |
| An altered proposal after reload does not inherit replay | authentication (`verification-failed (altered)`) before any registry/journal access |
| Foreign project replay exposes no receipt | a live foreign composition sharing the durable journal store refuses `verification-failed`; the serialized outcome contains no `amr-` |
| `stillCurrent` is REQUIRED and refuses every path | type-level requirement + runtime test: `stillCurrent: () => false` → `session-superseded` with no receipt, even for a consumed identity |
| A transition-pending (retiring-interlock) receipt lookup refuses | the pre-flight §E check refuses `session-superseded` before any journal/registry lookup — old-project UI state and messages are never published during a transition |

## Why the reload could not work before B12.3

The sealed head mark pins sequence N; after the commit the durable head is
N+1. Apply-boundary verification enforced the CURRENT head first, so an
already-applied artifact could never survive to the executor's
`clientOperationId` idempotent replay — `stale-head` always won (pre-edit
counterexample R1: `"stale-head" … BEFORE the executor's clientOperationId
replay`). B12.3 consults the durable journal + canonical evidence for the
AUTHENTICATED artifact before current-head enforcement; the normal path
(step 7) is unchanged for artifacts with no durable history.

## Determinism across retries

Windows 4/5 replay byte-identically because every receipt field is
reconstructible from the journal's durable inputs: `completedAt` is the
recorded `committedAt` (also used on the normal path), and `receiptId` is
recomputed with the exact production digest schema — two reloads, and an
in-process retry after a failed receipt persist, all produce the same
bytes. Window 2 (inputs lost) is deterministic in the other direction:
always `recovery-required`, never a second transaction, never an invented
receipt.
