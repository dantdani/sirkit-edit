# B12 §A / §D — the approved execution contract

> **SUPERSESSION NOTE (B12.1).** This workflow called `session.execute`
> directly with a pre-queue state snapshot; nothing adopted the result into
> the editor or `SchematicHistory` (counterexample R1), and the one-shot
> claim ran before verification (R2). Superseded by
> `../ai-control-plane-b12-1/corrected-execution-and-adoption-contract.md`
> (gateway-routed execution, execution-position verification,
> adoption-gated finalization). Preserved as historical evidence.


Module: [`app/lib/engineering/approved-agent-mutations.ts`](../../app/lib/engineering/approved-agent-mutations.ts)
Entry point: `applyApprovedTier1Proposal(input): Promise<ApprovedTier1ApplyOutcome>`

One function performs the entire "Apply exact proposal" workflow (minus UI
adoption, which stays with the coordinator that invokes it). It is
provider-neutral, tested against the real `SchematicEditorSession`, and
identical wherever invoked.

## Input — trust is supplied, never minted

```ts
interface ApprovedTier1ApplyInput {
  proposal: SealedTier1Proposal;      // the EXACT sealed proposal the human reviewed
  session: SchematicEditorSession;    // the live trusted session — supplied ONLY by the interactive root
  currentState: SchematicState;       // authoritative base at execution position
  currentProjectId: string;
  currentBranchId: string;
  tenantId?: string;                  // default "local"
  originRunId?: string | null;        // metadata only
  now?: () => number;                 // deterministic/injectable clock
  registry?: ApprovedMutationRegistry;
  audit?: ApprovedMutationAuditLedger;
}
```

The service **never creates, imports, or serializes trust.** The live session
is the human's capability; the module deliberately imports neither the
interactive channel nor its factory (proven by the §G import scan).

## Outcome — a closed, typed union; nothing throws across the boundary

```ts
type ApprovedTier1ApplyOutcome =
  | { ok: true;  status: "committed";       receipt; commandResult }
  | { ok: true;  status: "already-applied"; receipt }                 // idempotent
  | { ok: false; status: "refused"; code: ApprovedMutationRefusalCode; message };
```

## The workflow, in order

```
1. capture identity   headBefore = session.headMark()   (null → session-not-ready refusal)
2. one-shot claim     registry.claim(proposal)          (in-flight | already-applied | poisoned)
3. sealed verify      verifySealedTier1Proposal(...)     (fail → release, verification-failed)
4. canonical submit   session.execute(EXACT sealed ops)  (throw → release, command-failed;
                                                          !ok → release, command-rejected;
                                                          idempotent_replay → release, already-applied)
5. postconditions     verify from the AUTHORITATIVE result + session   (fail → POISON, postcondition-failed)
6. receipt            deep-frozen, self-validated        (invalid → POISON, postcondition-failed)
                      registry.consume(); audit "committed-verified"; return committed
```

### 1 — capture identity first

`session.headMark()` is read **before** any asynchronous work. A null head means
the session cannot yet verify scope → `session-not-ready`, and **the proposal is
not claimed** (a not-ready session must not consume the one-shot).

### 2 — one-shot claim (§C)

`registry.claim` transitions the identity to `in-flight` or refuses:
`already-in-flight`, `already-applied` (returns the **original** receipt as a
success outcome), or `identity-poisoned`. See
[concurrency-and-idempotency-matrix.md](concurrency-and-idempotency-matrix.md).

### 3 — sealed verification

`verifySealedTier1Proposal` re-checks digest seal, scope
(tenant/project/branch/lineage), head mark, base digest, and TTL against the
**current** session identity. Any failure **releases** the claim (a regenerated
retry may legitimately succeed) and returns `verification-failed` with the
verifier's controlled code and detail.

### 4 — canonical submission

```ts
session.execute(currentState, {
  commandId: "schematic.edit-tier1-apply",
  buildOperations: () => structuredClone(proposal.operations),   // EXACTLY the sealed ops
  expectedBaseDigest: proposal.baseSchematicDigest,              // re-checked INSIDE the queue
  expectedHeadMark: proposal.scope.headMark,                     // re-checked INSIDE the queue
  idempotencyKey: proposal.proposalId,
});
```

The sealed operations are submitted **exactly** — never compiled, repaired,
reinterpreted, or partially applied. The session's serialized queue re-checks
the base digest and head mark a second time, inside the lock, closing the
seal→apply race. A throw → `command-failed`; a rejected result →
`command-rejected` (surfacing the session's message); an `idempotent_replay`
(the durable executor replaying a prior commit after a reload emptied the
in-memory registry) → an explicit `already-applied` refusal, **never** a second
commit.

### 5 — §D postcondition verification

Verified from the authoritative `result` and `session`, never from optimism.
Every check that fails is collected:

| Postcondition | Failure |
| --- | --- |
| `result.status === "executed"` | `status <x>` |
| `result.transactionId` non-empty string | missing transaction id |
| `result.revisionBefore === sealed head canonical digest` | before-revision mismatch |
| `session.headMark()` present after commit | session head unavailable |
| head lineage unchanged | lineage changed |
| `headAfter.headSequence === sealed headSequence + 1` | more than one transaction advanced the head |
| `result.headMark` agrees with the session head | result head disagrees with session head |
| `validateSchematicStateIntegrity(result.state)` empty | post-apply schematic fails validation |

**Any** failure ⇒ the commit may have landed ⇒ **poison** the identity (never
release — releasing could permit a double-commit) and return
`postcondition-failed`. Diagnostic codes only; specifics stay in the controlled
refusal message.

### 6 — the receipt

A deep-frozen, bounded plain-JSON receipt (§B) is built from pinned + verified
values and **validated by the service's own gate** before it is claimed. A
receipt that fails its own validator poisons the identity — the service refuses
to claim an unverifiable commit as verified. On success: `registry.consume`,
audit `committed-verified`, return `committed`.

## Totality

The whole body is wrapped so that an unexpected failure **before** a commit
releases the claim (`command-failed`) and **after** a commit poisons the
identity (`postcondition-failed`). No path returns success without a validated
receipt, and no path throws across the UI boundary.
