# B12.4 — pre-edit counterexamples (R1–R5)

All reproductions were run against **production code, before any B12.4
edit**, through a transient probe
(`app/lib/engineering/__tests__/_tmp-b124-repro.test.ts`, deleted after
capture) over the real journal, session, coordinator, transition
coordinator, service, and the production current-project functions
(localStorage shimmed for node). Outputs verbatim.

---

## R1 — forged finalized receipt

Commit an approved proposal; read its persisted journal record; change
`receipt.completedAt` (retaining the real `transactionId`); recompute
`receiptId` with the PUBLIC `sirkit.approved-mutation-receipt-id.v1`
digest; recompute the PUBLIC journal-entry integrity digest; reload with a
fresh session and registry; replay the exact proposal:

```json
B124_R1_START{
 "replayOk": true,
 "replayStatus": "already-applied",
 "returnedForgedReceipt": true,
 "forgedReceiptIdDiffersFromOriginal": true,
 "transactionCount": 1
}B124_R1_END
```

The MODIFIED receipt was returned as the supposedly byte-identical
original. **Architectural cause:** both `receiptId` and the journal-entry
integrity digest are publicly recomputable consistency checksums — B12.3's
replay verification (`validateApprovedMutationReceipt` + `transactionId`
equality) treated them as authentication. Nothing linked `completedAt`,
`originRunId`, or `schematicDigestAfter` to any chain-protected canonical
evidence.

## R2 — malformed checksum-valid entry

A `canonical-committed` entry with `baseHeadMark: null` and a correctly
recomputed integrity digest:

```json
B124_R2_START{
 "entry has baseHeadMark: null and state canonical-committed": true,
 "lookup kind": "entry",
 "malformed checksum-valid entry ACCEPTED": true
}B124_R2_END
```

**Architectural cause:** `validateEntry` checked schema/id/state/integrity
and then CAST the rest — no closed key sets, no nested-shape validation,
no scope-vs-instance matching, no state-dependent invariants.

## R3 — state-machine downgrade

```json
B124_R3_START{
 "state before re-prepare": { "state": "canonical-committed", "transactionId": "tx-1" },
 "re-prepare accepted": true,
 "state after re-prepare": { "state": "prepared", "transactionId": null },
 "DOWNGRADED committed→prepared with transactionId erased": true
}B124_R3_END
```

`prepare()` unconditionally replaced the entry — a committed/finalized
record could be downgraded to `prepared`, erasing the durable receipt
inputs and the known transaction identity.

## R4 — failed transition retires the surviving project

```json
B124_R4_START{
 "transition outcome": "transition-failed",
 "currentInterlock is the SAME object as A's": true,
 "survivor interlock retired": true,
 "acquireCommitLease refuses": true,
 "approved mutation capability on the surviving project": "LOST"
}B124_R4_END
```

The retirement barrier ran BEFORE the hook; when `beforeInstall` failed,
the surviving project kept its now-RETIRED interlock — visible but not
usable: every subsequent approved apply refused `session-superseded` until
a successful switch replaced the interlock.

## R5 — visible/persisted project split-brain

Production `openProject`/`startNewProject`/`bootstrapCurrentProject` with
the real switch ordering (pointer moves BEFORE the transition request) and
a failing required flush:

```json
B124_R5_START{
 "transition outcome": "transition-failed",
 "visible project after failed switch": "A (unchanged)",
 "persisted sirkit:currentProjectId": "B (the target that NEVER installed)",
 "SPLIT-BRAIN: visible A, pointer B": true,
 "a reload would bootstrap": "B — despite the UI reporting the current project is unchanged"
}B124_R5_END
```

`openProject(id)` (and `startNewProject`) SET the persisted pointer at
load/create time; the transition could then fail or be superseded, leaving
`sirkit:currentProjectId` referring to a project that never installed — a
reload bootstraps the wrong project.

---

## Closures (implemented by B12.4)

| # | Closure |
| --- | --- |
| R1 | §A — every returned receipt field is authoritatively linked: proposal-derived fields to the captured authenticated proposal; transaction/head fields to the canonical durable record; `originRunId`+`completedAt` to a receipt commitment carried INSIDE the chain-protected transaction (`provenance.candidateId`); `schematicDigestAfter` re-derived from the canonical head. Unprovable/legacy receipts → `recovery-required` without exposing receipt data |
| R2 | §B — complete capture-first strict validation: closed key sets, exact types/patterns/bounds, scope-vs-instance matching, per-state invariants; total on hostile input |
| R3 | §C — monotonic transitions only; `prepare` is idempotent against an identical `prepared` and fails closed otherwise; no downgrade can erase committed identity; failed writes leave prior durable state intact; CAS-versioned documents |
| R4 | §D — a failed `beforeInstall` reactivates the surviving project with a FRESH ACTIVE interlock (only after the retirement barrier settled); mutation capability restored without a successful switch |
| R5 | §E — the persisted pointer commits exactly once, inside the WINNING install; switch/create/import load/persist records without activating them; failed/superseded targets never touch the pointer; raw pre-transition flushes removed (the typed `beforeInstall` flush is the one flush) |
