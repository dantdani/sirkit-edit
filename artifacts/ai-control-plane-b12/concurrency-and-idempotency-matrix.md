# B12 §C — one-shot and concurrency matrix

> **SUPERSESSION NOTE (B12.3).** The row below claiming the reload race was
> closed ("Reload empties in-memory registry, then replay → the durable
> executor returns idempotent_replay … never a second commit") was FALSE in
> practice: apply-boundary verification refused the replay `stale-head`
> BEFORE the executor's idempotency lookup could ever run, and no durable
> record held the receipt (B12.3 counterexamples R1/R2). Durable replay now
> lives in `../ai-control-plane-b12-3/` (journal + evidence lookup before
> current-head enforcement). Preserved as historical evidence.


> **SUPERSESSION NOTE (B12.1).** The identity described here (proposalId +
> sealed scope fields, `sirkit.approved-mutation-identity.v1`) was
> insufficient: an ALTERED body retaining proposalId+scope inherited the
> consumed receipt (counterexample R2), because the claim ran before
> integrity verification. Superseded by
> `../ai-control-plane-b12-1/sealed-identity-and-idempotency-contract.md`
> (complete-verified-body identity v2, authentication before any registry
> lookup). The state machine and release/poison semantics stand. Preserved
> as historical evidence.


`ApprovedMutationRegistry` — a sealed proposal may commit **at most once** within
its project/branch/lineage.

## Identity = proposal id **plus** sealed scope

A proposal id alone is never authority. The registry key is an
`engineeringDigest` over:

```
schema:     "sirkit.approved-mutation-identity.v1"
proposalId: proposal.proposalId
tenantId:   proposal.scope.tenantId
projectId:  proposal.scope.projectId
branchId:   proposal.scope.branchId
lineageId:  proposal.scope.headMark.lineageId
```

So the "same" proposal id under a different tenant/project/branch/lineage is a
**different** identity, and a scope-mismatched replay cannot masquerade as the
original.

## State machine

```
            claim (fresh)
   (none) ─────────────────▶ in-flight
      ▲                       │  │  │
      │ release               │  │  └── consume(receipt) ──▶ consumed ──▶ claim ⇒ already-applied(receipt)
      │ (failed preflight,    │  │
      │  rejected command,    │  └───── poison ────────────▶ poisoned ──▶ claim ⇒ identity-poisoned
      │  durable replay)      │
      └───────────────────────┘
```

- **claim** → `in-flight`, or refuses: `already-in-flight` / `already-applied`
  (returns the stored receipt) / `identity-poisoned`.
- **release** — only from `in-flight`; deletes the key so a **regenerated**
  retry may legitimately succeed. Used for failed preflight, rejected command,
  and durable `idempotent_replay`.
- **consume(receipt)** → `consumed`, storing the original receipt.
- **poison** → `poisoned` **forever** for that identity.

## Every race and its resolution

| Scenario | Resolution | Evidence |
| --- | --- | --- |
| Two concurrent applies, same proposal | first claims `in-flight` → commits; second sees `in-flight` → `already-in-flight` refusal. **Converges on ONE transaction.** | test: *concurrent apply … converges on ONE transaction* |
| Sequential replay after a verified commit | claim sees `consumed` → returns `already-applied` with the **ORIGINAL** receipt. **Never a second commit.** | test: *sequential replay returns an idempotent already-applied … ORIGINAL receipt* |
| Reload empties in-memory registry, then replay | claim is fresh (`in-flight`), but the **durable executor** returns `idempotent_replay` → service releases and returns explicit `already-applied`. **Never a second commit.** | service step 4; scope-recovery matrix |
| Failed preflight (verification-failed) | `release` — identity NOT consumed; a regenerated proposal can still succeed. | test: *failed preflight does NOT consume the proposal* |
| Rejected canonical command (`command-rejected`) | `release` — same rationale. | test: *rejected canonical command … no consume* |
| Command throws before commit (`command-failed`) | `release` — nothing committed. | service step 4 catch |
| Unverifiable commit (postcondition/receipt fail, or throw after commit) | **poison** — fails closed forever; a retry can never double-commit a proposal whose first commit may have landed. | test: *unverifiable commit poisons the identity so it can never retry into a double commit* |
| Not-ready session | refuse `session-not-ready` **before** claiming — the one-shot is not spent. | test: *not-ready session refuses without consuming the proposal* |

## Why poison-on-unverifiable is fail-closed, not fail-open

Once `session.execute` has returned a committed result, the canonical
transaction may already be durably recorded. If postcondition verification then
fails (or an unexpected exception is thrown *after* the commit flag is set),
**releasing** the claim would allow a second apply of a proposal whose first
apply may have landed — a double-commit. Poisoning refuses that identity
permanently; the correct recovery is to inspect history and **regenerate a new
proposal**, which is a new identity.
