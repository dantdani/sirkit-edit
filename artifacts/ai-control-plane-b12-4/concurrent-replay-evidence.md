# B12.4 — concurrent replay evidence

> **SUPERSESSION NOTE (B12.5).** The two-tab convergence below is real,
> but the layer it credited — "turn-atomic localStorage CAS" — is not a
> cross-context CAS (B12.5 counterexample R1: a legal read/read/write/
> write interleaving lost a write while both writers claimed success).
> Convergence now additionally rests on a REAL atomic boundary
> (IndexedDB single-transaction saveIf), re-proven end-to-end over the
> production store in `../ai-control-plane-b12-5/`. Preserved as
> historical evidence.


`b12-4-concurrency.test.ts` — two INDEPENDENT compositions ("tabs": fresh
sessions, coordinators, registries, journal instances) share the SAME
durable canonical store and the SAME durable journal store and apply the
SAME sealed proposal concurrently.

## What holds under every interleaving

- **Exactly one canonical transaction.** The durable store's
  `clientOperationId` dedup means a racing tab WITNESSES the single commit
  rather than creating a second one; `transactionLog.length === 1` before
  and after every follow-up.
- **Truthful outcomes.** Each tab reports either `committed` (its receipt's
  `transactionId` equals THE one durable transaction), an idempotent
  `already-applied`, or a typed refusal — never a fabricated receipt.
- **One authoritative receipt.** When both tabs witness the commit their
  receipts are IDENTICAL (deterministic derivation: `completedAt` is the
  commitment-bound value); the journal's finalized receipt equals the
  committed receipt; `finalizeReceipt` with a differing receipt is a
  `conflict` — the finalized receipt is never erased or replaced.
- **Deterministic convergence.** A third composition replaying afterwards
  gets `already-applied` with the same receipt and no new transaction.

## CAS behavior

- Version conflicts (another composition wrote first) are retried against
  the fresh state — proven with an injected double-conflict store; the
  write succeeds on the third attempt.
- Exhausted retries fail closed (`conflict`) and the previous durable
  state is untouched.
- Document versions increase monotonically across writes.

## Crash/reload windows

All B12.3 crash windows (1–6) re-run green under the B12.4 code
(`b12-3-durable-replay.test.ts`, 9/9): window dispositions are unchanged
except that receipt-bearing paths now additionally pass the §A linkage —
which fresh applies satisfy by construction (commitment minted on every
transaction).
