# B12.3 — pre-edit counterexamples (R1–R3)

All reproductions were run against **production code, before any B12.3
edit**, through a transient probe
(`app/lib/engineering/__tests__/_tmp-b123-repro.test.ts`, deleted after
capture) over the real session, coordinator, shared adoption primitive,
interlock, transition coordinator, and B12.2 service. Outputs verbatim.

---

## R1 — reload defeats durable idempotency / R2 — receipt authority disappears

A valid sealed proposal was applied (one canonical transaction, one
receipt), the applied projection and canonical mark were persisted, and a
NEW `SchematicEditorSession` was opened over the SAME durable store at the
committed head with a FRESH `ApprovedMutationRegistry` — a genuine browser
reload. The exact intact proposal was then applied again:

```json
B123_R1R2_START{
 "one canonical transaction + one receipt before reload": "amr-d34db991b4674b1e…",
 "reloaded session resumed READY at committed head": true,
 "durable store HOLDS the exact transaction (clientOperationId === proposalId)": true,
 "EXACT intact replay after reload": "refused:verification-failed",
 "replay message excerpt": "Proposal rejected (stale-head): The canonical schematic head moved after this proposal was created (",
 "durable idempotency lookup ever reached": "NO — verification-failed (stale-head) precedes the executor's clientOperationId replay",
 "fresh registry knows the consumed identity": false,
 "any durable record stores the finalized receipt": "NO — ApprovedMutationRegistry and ApprovedMutationAuditLedger are in-memory only; no journal exists",
 "ORDINARY different stale proposal refusal": "refused:verification-failed",
 "exact replay and ordinary stale are INDISTINGUISHABLE to the approval layer": true,
 "second transaction executed": false
}B123_R1R2_END
```

**R1.** After reload the session's head is sequence 1, the sealed head mark
is sequence 0 — apply-boundary verification refuses `stale-head` BEFORE the
executor's durable idempotency lookup (which keys the exact transaction by
`clientOperationId === proposalId` and would have replayed it) can ever
run. Durable idempotency is structurally unreachable through the approval
boundary.

**R2.** The one-shot registry and audit ledger are in-memory classes with
no persistence; no durable record stores the finalized receipt. A fresh
browser can neither return nor verify the original receipt — and although
the canonical transaction exists durably, the approval layer answers the
exact intact replay with the SAME `verification-failed` an ordinary
unrelated stale proposal receives. Truthful "already applied" is
unexpressable after reload.

**Architectural cause.** B12.2's replay authority lives entirely in
process-local memory (the registry cache); the durable canonical record is
consulted only INSIDE `session.execute`, which sits behind current-head
verification that an already-applied proposal can never pass again.

## R3 — transition reentrancy defeats latest-wins

Real `ProjectTransitionCoordinator`: install A; hold A's commit lease;
request B; during B's `beforeInstall` hook synchronously request C (a user
clicking project C while B's transition completes); release the lease:

```json
B123_R3_START{
 "event sequence": [
  "hook(pending target install)",
  "install:A",
  "hook(pending target install)",
  "hook(pending target install)",
  "install:C",
  "install:B"
 ],
 "final installed project": "B",
 "older B overwrote newer C": true
}B123_R3_END
```

`install:C` is followed by `install:B` — the OLDER captured winner (B)
installed after the newer request (C), and B's completion also clobbered
C's freshly created interlock.

**Architectural cause.** `complete()` cleared `retirementPending` BEFORE
running the hook and install, so a reentrant `request()` during the hook
started a *second, immediately-completing* cycle; the outer frame then
resumed with its stale captured `winner` and installed it over the newer
target. `latest` was captured once instead of being re-consulted after
every synchronous reentry window, and the hook had no typed outcome.

---

## Closures (implemented by B12.3)

| # | Closure |
| --- | --- |
| R1 | §A/§B — a durable, integrity-protected approved-mutation replay journal + a read-only session idempotency-evidence query; for an authenticated artifact in a verified live scope, the durable journal/canonical lookup runs BEFORE current-head enforcement; the stale-head bypass exists ONLY when durable evidence proves this exact artifact produced the exact recorded transaction |
| R2 | §A/§C — the finalized receipt is persisted in the journal BEFORE committed success is returned; exact reload replay returns the byte-identical original receipt; every crash window has a deterministic typed disposition; legacy transactions answer a truthful typed already-applied refusal without inventing a receipt |
| R3 | §F — the transition coordinator keeps `transitionPending` true through hook + install settlement, re-consults `latest` after every synchronous reentry window (awaiting-retirement, beforeInstall, install, persistence callbacks, cancellation), retires each incarnation at most once, and reports typed transition outcomes; a failed persistence flush surfaces a controlled failure instead of silently installing |
