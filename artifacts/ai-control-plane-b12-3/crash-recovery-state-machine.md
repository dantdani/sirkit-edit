# B12.3 §C — crash-window semantics

> **SUPERSESSION NOTE (B12.4).** Window-4/5 receipt finalization below
> verified only recomputable checksums plus transactionId equality — a
> forged journal could deterministically "finalize" modified receipts.
> Receipt-bearing dispositions now additionally require the B12.4
> authoritative linkage (chain-protected commitment + canonical
> derivation); commitment-less (pre-B12.4) receipt-bearing entries fail
> closed as recovery-required. The window structure itself stands and its
> tests remain green. See `../ai-control-plane-b12-4/`. Preserved as
> historical evidence.


Every window between "user clicked Apply" and "receipt returned" has a
deterministic, fail-closed disposition, proven with crash injection
(journal-write failures, adoption failures) plus genuine reload
compositions in `b12-3-durable-replay.test.ts`.

| # | Crash window | Journal state at reload | Disposition |
| --- | --- | --- | --- |
| 1 | prepared record, no canonical commit | `prepared`, durable evidence ABSENT | **safe fresh retry** — the normal path enforces the CURRENT sealed base/head/expiry; retry succeeds only while the base is still current (proven: retry commits; head count 0 → 1) |
| 2 | canonical commit landed, acknowledgement lost (journal's committed record never written) | `prepared`, durable evidence EXACT-MATCH | **typed `recovery-required`** — the exact durable transaction is detected, a second transaction is NEVER executed, and no receipt is invented (the deterministic receipt inputs were lost with the crash); stable across repeated replays |
| 3 | commit landed, UI adoption not completed | `poisoned` (persisted by the in-process poison path) | **`identity-poisoned`** — explicit recovery state; reload replay refuses and never re-executes (head count stays 1) |
| 4 | adoption completed, receipt persistence interrupted | `canonical-committed` / `adopted` with committed inputs, evidence EXACT-MATCH | **deterministic finalization** — the ORIGINAL receipt is reconstructed from durable prepared data + the canonical record (`completedAt := committedAt`, `receiptId` recomputed with the production digest), persisted, and returned as `already-applied`; byte-identical across repeated reloads |
| 5 | receipt finalized, response lost | `receipt-finalized` with the receipt | **byte-identical replay** — the persisted ORIGINAL receipt is capture-verified, cross-checked against the canonical record, and returned (`JSON.stringify` and canonical-JSON equal to the original) |
| 6 | legacy B12/B12.1/B12.2 transaction with no journal | ABSENT, durable evidence EXACT-MATCH | **truthful typed legacy `already-applied` refusal** — never re-executed, and no original receipt is pretended to exist (see [migration-and-legacy-disposition.md](migration-and-legacy-disposition.md)) |

## Fail-closed edges (also proven)

| Edge | Disposition |
| --- | --- |
| Journal store unavailable (load/save throws) | `recovery-required`; nothing executes |
| Corrupt/tampered journal entry (integrity broken) | `recovery-required`; no receipt exposed |
| Journal/canonical disagreement (valid integrity, mismatching `transactionId` or head) | `recovery-required` |
| Persisted receipt fails validation or disagrees with the record | `recovery-required` |
| Evidence found but NOT an exact identity match (reused operation id, different ops/scope/lineage/base) | `verification-failed`, no receipt |
| Journal claims a commit the canonical history lacks | `recovery-required` |
| In-process: `markCommitted` write fails after the commit landed | `recovery-required` (entry stays `prepared` → window 2 on reload) |
| In-process: `finalizeReceipt` write fails after adoption | `recovery-required` (entry keeps committed inputs → window 4 on reload finalizes the byte-identical receipt) |

## The ordering guarantee

The FINAL receipt is persisted (`finalizeReceipt`) **before** normal
committed success is returned — so a caller who ever saw `committed`
can always recover the byte-identical receipt after any crash, and a
caller who never saw success can never be handed an unverifiable one.
`completedAt` equals the journal's `committedAt` on the NORMAL path too,
which is what makes post-crash reconstruction byte-identical rather than
merely equivalent.
