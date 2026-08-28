# B12.1 §A — the corrected execution and adoption contract

> **SUPERSESSION NOTE (B12.2).** The adoption step below assumed the
> coordinator host's applier synchronously records ONE SchematicHistory
> entry; page.tsx's applier only SCHEDULED a debounced 350 ms record, so
> receipts were consumed and leases released before the entry existed
> (counterexample R3). Superseded by
> `../ai-control-plane-b12-2/synchronous-production-adoption-contract.md`
> (the shared `adoptCanonicalResult` primitive). Preserved as historical
> evidence.


Module: [`app/lib/engineering/approved-agent-mutations.ts`](../../app/lib/engineering/approved-agent-mutations.ts)
Supersedes: B12's `approved-execution-contract.md` (see its supersession note).

## What was wrong

B12's service called `session.execute` directly, with a `currentState`
snapshot the page captured from React **before** any queueing. The session
committed durably; nothing adopted the result: no coordinator job, no
`applyCanonicalProjection`, no `SchematicHistory` entry, no
`notifyAuthoritativeProjection`. The apply also did not serialize with
gestures, hand edits, undo/redo, hydration, or lifecycle replacement — it
raced them all and relied on the session's internal base-digest check to
lose those races safely. B12's §H tests labeled `commandResult.state` "the
displayed schematic"; production displayed nothing.

## The corrected path

The production page → service bypass is REMOVED. The service now requires an
**injected execution/adoption gateway**:

```ts
export interface ApprovedApplyExecutionGateway {
  runCanonicalCommand(input: {
    label: string;
    execute(authoritativeBase: SchematicState): Promise<SchematicCommandResult | null>;
    stillCurrent?(): boolean;
  }): Promise<CanonicalCommandGateOutcome>;
}
```

This is structurally the production
`SchematicGestureCoordinator.runCanonicalCommand` — the SAME B07.3 FIFO
queue every ordinary editor command, gesture commit, lifecycle adoption, and
undo/redo step runs on. `page.tsx` passes its live coordinator; the
engineering service imports no React or page code and mints no trust.

### Inside the serialized job (execution position)

1. `headBefore = session.headMark()` — the LIVE head, read inside the job.
2. `verifySealedTier1Proposal` against `schematicStateDigest(authoritativeBase)`
   — the base the COORDINATOR supplies at execution position, never a
   pre-queue React snapshot — and the live head as `expectedScope.headMark`.
3. §B commit/adoption lease acquisition (see
   [project-lifecycle-interlock.md](project-lifecycle-interlock.md)).
4. `session.execute` with EXACTLY the authenticated sealed operations
   (`structuredClone(captured.operations)`), `expectedBaseDigest`,
   `expectedHeadMark` (re-checked a third time inside the session's own
   queue), `idempotencyKey = proposalId`.
5. §D postconditions verified from the authoritative result + session,
   still inside the job — **before any adoption**. A failed postcondition
   returns `null` to the gateway: an unverified commit is **never adopted,
   never displayed**.
6. Only a fully verified `executed` result is returned to the gateway.

### Adoption

The gateway job then calls the host's `applyCanonicalProjection(label,
state)` — in production, `applyCanonicalSchematicProjection` in `page.tsx`:
**exactly one canonical projection update** and **exactly one real
`SchematicHistory` entry** (label `"Applied AI edit proposal"`), plus
`notifyAuthoritativeProjection`. The visible authoritative state equals the
durable head after queue settlement (B07.3's core invariant, now true for
approved applies too).

### Finalization is adoption-gated

Receipt construction, self-validation, `registry.consume`, and the
`committed-verified` audit event run **only after** the gate resolves
`applied`. Success is never displayed or finalized merely because
`session.execute` returned a changed state:

| Gate outcome | Service outcome |
| --- | --- |
| `applied` + verified postconditions | build receipt → validate → consume → `committed` |
| `rejected` / `noop` | release claim → `command-rejected` |
| `refused-gesture-active` | release claim → `editor-busy` (retryable; dialog kept) |
| `canceled-stale` before-execution | release claim → `session-superseded`, ZERO durable transaction |
| `canceled-stale` after-commit / adoption unverifiable | **POISON** → `postcondition-failed` — the existing recovery path; never retried as a fresh commit |
| durable `idempotent_replay` | release claim → `already-applied` refusal; **no new history entry** for an old transaction |

### Serialization and interaction rules

- Apply serializes with gestures, hand edits, undo/redo, hydration,
  recovery, and lifecycle replacement (one FIFO queue).
- A gesture owning the preview refuses the apply (`editor-busy`) — and while
  an apply is queued/running, `begin()` refuses, so a drag can never
  interleave.
- Double-clicking Apply: the second click's one-shot claim refuses
  (`already-in-flight`) BEFORE any queue submission — one submission, one
  transaction, one history entry.
- Reject (Cancel) and Tidy remain non-mutating with respect to the proposal.
- An `idempotent_replay` from the durable executor is surfaced as
  `already-applied` and deliberately NOT adopted — adoption would record a
  new history entry for a transaction that already exists.

## Evidence

`b12-1-adoption-identity-receipt.test.ts` (R1 group: visible adoption, one
history entry, execution-position verification, gesture exclusion,
double-click, adoption-gated consumption) and
`b12-1-production-integration.test.ts` (per-provider full flows). See
[regression-matrix.md](regression-matrix.md).
