# B12.4 §C — the monotonic, concurrency-safe journal state machine

> **SUPERSESSION NOTE (B12.5).** The claim below that localStorage's
> synchronous read-check-write ("atomic per JS turn") plus the monotonic
> transition rules covered cross-context interleavings was reproduced
> FALSE (B12.5 counterexample R1): two contexts both returned true from
> the same expected version and one write was silently lost — monotonic
> ENTRY rules cannot compare two documents carrying DIFFERENT identities.
> The production store is now an IndexedDB read/version-check/write in
> ONE engine-serialized readwrite transaction:
> `../ai-control-plane-b12-5/production-journal-atomicity.md`. The
> monotonic state machine itself stands unchanged. Preserved as
> historical evidence.


Supersedes B12.3's unconditional `prepare()` overwrite (R3: a
`canonical-committed` entry was downgraded to `prepared`, erasing
`transactionId` and every durable receipt input).

## Legal transitions — nothing else

```
prepared → canonical-committed → adopted → receipt-finalized
prepared | canonical-committed | adopted → poisoned
```

| Operation | From | Semantics |
| --- | --- | --- |
| `prepare` | (absent) | creates `prepared` |
| `prepare` | `prepared` | IDENTICAL immutable fields → idempotent no-op (the existing entry stands, `preparedAt` untouched); differing → `conflict` |
| `prepare` | any later state | `invalid-transition` — NEVER a downgrade, never an erasure |
| `markCommitted` | `prepared` | records the complete committed inputs |
| `markCommitted` | `canonical-committed` | identical payload → idempotent; differing → `conflict` |
| `markAdopted` | `canonical-committed` | → `adopted`; idempotent in `adopted` |
| `finalizeReceipt` | `canonical-committed` \| `adopted` | persists the receipt |
| `finalizeReceipt` | `receipt-finalized` | IDENTICAL receipt → idempotent; different → `conflict` — **the authoritative finalized receipt can never be replaced** |
| `poison` | `prepared` \| `canonical-committed` \| `adopted` | → `poisoned`, PRESERVING the known committed identity; idempotent in `poisoned` |
| `poison` | `receipt-finalized` | `invalid-transition` — a finalized receipt can never be poisoned away |

Every transition additionally verifies the IMMUTABLE identity/scope/base
fields are unchanged (`conflict` otherwise), and a failed write leaves the
previous durable state intact (proven with a throwing store).

## CAS-versioned concurrency

- Every document carries a monotonically increasing `version`; writes go
  through the store's **compare-and-swap** (`saveIf(document,
  expectedVersion)`) with up to 4 optimistic retries — the mutation is
  re-evaluated against the freshly loaded state on every attempt, so the
  monotonic rules re-apply after every interleave. Exhausted retries fail
  closed (`conflict`).
- No module-global lock exists anywhere.
- localStorage `saveIf` performs its read-check-write synchronously within
  one JS turn (atomic per event-loop turn). **Cross-context atomicity is
  NOT claimed**: two tabs' CAS operations are serialized per turn, and any
  residual interleaving lands on the monotonic-transition refusals (no
  destructive overwrite is expressible) plus the durable canonical store's
  own `clientOperationId` dedup (one transaction regardless).
- Demonstrated across two independent store/journal/service compositions:
  exactly one canonical transaction, identical receipts for every
  committed witness, the finalized receipt never erased or replaced, and a
  third composition converging deterministically
  (`b12-4-concurrency.test.ts`).
