# B12.5 §A — production journal atomicity

Module: [`app/lib/engineering/approved-mutation-journal-idb.ts`](../../app/lib/engineering/approved-mutation-journal-idb.ts)
Supersedes: B12.4's `BrowserLocalStorageApprovedMutationJournalStore`
(REMOVED), whose synchronous read-check-write claimed that per-JS-turn
atomicity supplied cross-context CAS — reproduced FALSE (pre-edit
counterexample R1: both writers returned true from the same expected
version; one write silently lost).

## Why localStorage could never be the boundary

localStorage guarantees no cross-context atomicity for a read-check-write
sequence: two tabs run in separate OS processes and the legal ordering
read(A)/read(B)/write(B)/write(A) loses B's write while both `saveIf`
calls report success (modern browsers do not implement the HTML storage
mutex). The journal's monotonic entry transitions cannot save this: the
lost update in R1 involved DIFFERENT identities, so no transition rule
ever compared the two documents.

## The atomic boundary

`IndexedDbApprovedMutationJournalStore.saveIf` performs
read → version-check → write inside **one IndexedDB `readwrite`
transaction**. The serialization is supplied by the browser storage
engine itself — the IndexedDB specification orders overlapping readwrite
transactions across every participating context (tabs, workers) — never
by a module-global mutex (which cannot see other tabs) and never by
convention:

- Two independent contexts starting `saveIf` from the same expected
  version: the engine runs the transactions one after the other; the
  second one's read observes the first one's committed version; its check
  fails; the transaction aborts; `saveIf` returns false with NOTHING
  written. No writer can return success after its update was lost.
- The atomicity covers the COMPLETE journal update (the read, the version
  check, and the put commit or abort together), not just the final write.
- Version conflicts are retried by `ApprovedMutationJournal.write` only
  from freshly loaded state (bounded optimistic retries); exhaustion
  returns the typed `conflict` refusal without modifying durable state.
- Crash-shaped failures (an aborted transaction, even after a successful
  `put`) and quota failures commit NOTHING — IndexedDB transactions are
  atomic — so the last committed document survives byte-identical.
- Unavailability (no `indexedDB`, open failure) THROWS
  `JOURNAL_STORAGE_UNAVAILABLE`; the journal converts it into the typed
  `unavailable` disposition and the apply boundary fails closed with
  `recovery-required`. There is **no localStorage fallback** — proven by
  a test that plants a valid legacy record and shows unavailable
  IndexedDB still refuses.
- The store interface itself no longer has an unconditional `save`:
  every production journal write passes through the CAS boundary. (The
  in-memory TEST store keeps its clearly-named `unsafeSetRaw` seeding
  backdoor; it exists only to plant corrupt fixtures in tests.)

The journal document WIRE FORMAT is unchanged
(`sirkit.approved-mutation-journal.v1`, same entry schema, same strict
B12.4 validation) — only the storage engine and the storage identity
changed, which is why no schema version bump is warranted.

## What the two-tab concurrency guarantee now rests on

1. The durable canonical store's `clientOperationId` dedup (unchanged) —
   exactly one canonical transaction.
2. The journal's atomic CAS — a racing context can no longer clobber the
   other's entries (same OR different identities).
3. The monotonic transition rules (unchanged from B12.4) — destructive
   overwrites refuse even when versions agree.

Proven end-to-end with BOTH durable layers on production stores: two
full independent apply compositions — each with its own
`IndexedDbApprovedMutationJournalStore` connection AND its own
`BrowserIndexedDbProjectStore` connection over one shared engine —
racing the same sealed proposal produce exactly one canonical
transaction, identical committed receipts, and one journal entry
(`b12-5-journal-atomicity.test.ts`).

Precision notes (from the internal refutation pass): the one-time legacy
IMPORT is a put-if-absent inside its own single readwrite transaction
rather than a literal `saveIf` call — semantically an
`expectedVersion: null` CAS with identical serialization guarantees, so
"every production write passes through the atomic transactional
boundary" is exact and "through saveIf" is exact for every DOCUMENT
UPDATE. A dead cached connection (browser force-close, upgrade
elsewhere) invalidates the connection cache (`onclose`/`onversionchange`)
so availability recovers without a reload; a non-serializable document
is refused as `JOURNAL_DOCUMENT_INVALID` (distinct from
`JOURNAL_DOCUMENT_TOO_LARGE`); and transaction-level failures propagate
through the same guarded path the journal converts to its typed
`unavailable` disposition.

## Evidence honesty

Atomicity tests run the PRODUCTION IndexedDB store on `fake-indexeddb`
(new dev-only dependency, justified in [README.md](README.md)) — a
faithful implementation of the IndexedDB spec including transaction
serialization — with two store instances sharing one `IDBFactory` to
model two contexts over one browser profile. No
`InMemoryApprovedMutationJournalStore` test is labeled as cross-context
atomicity proof. Behavior in a real multi-process browser remains
INFERRED (spec-faithful engine, not a literal second OS process) and is
recorded as such in [validation-summary.md](validation-summary.md).
