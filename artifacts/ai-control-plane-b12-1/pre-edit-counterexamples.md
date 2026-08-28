# B12.1 — pre-edit counterexamples (R1–R4)

All four reproductions were run against **production code, before any B12.1
edit**, through a transient probe
(`app/lib/engineering/__tests__/_tmp-b121-repro.test.ts`, deleted after
capture). The probe used the real `SchematicEditorSession`, the real
`SchematicGestureCoordinator` with a production-shaped host, the real
`SchematicHistory`, the real `InMemoryAtomicProjectStore`, and the real
B12 service. Outputs are verbatim.

---

## R1 — UI adoption failure

```json
B121_R1_START{
 "service outcome": "committed",
 "session head advanced": 1,
 "session head digest === applied-state digest": false,
 "coordinator/editor visible digest unchanged (still the PRE-apply schematic)": true,
 "coordinator adoption (applyCanonicalProjection) calls": 0,
 "SchematicHistory entries": 1,
 "SchematicHistory canUndo": false
}B121_R1_END
```

`applyApprovedTier1Proposal` returned **committed** and durably advanced the
session head to sequence 1 — while the coordinator's authoritative/visible
editor state still carried the **pre-apply** schematic, the coordinator's
adoption applier was **never called**, and `SchematicHistory` still held only
its initial "Opened project" entry with `canUndo: false`. (The
`head digest === applied-state digest: false` line is a digest-domain
artifact of the probe — `canonicalStateDigest` lives in the canonical-project
digest domain, not the UI `schematicStateDigest` domain — and is not itself a
defect.)

**Architectural cause.** B12's `page.tsx` `applyTier1Proposal` called the
service directly with `currentState: currentSchematicState()` (a snapshot
taken **before** any queueing), and the service called `session.execute`
directly — bypassing the `SchematicGestureCoordinator` FIFO queue entirely.
No `applyCanonicalProjection`, no history entry, no
`notifyAuthoritativeProjection`, no serialization with gestures/undo/
lifecycle. B12's own §H tests labeled `commandResult.state` "the displayed
schematic", which no production code ever displayed.

## R2 — altered consumed replay

```json
B121_R2_START{
 "altered field": "operations (proposalId and scope retained)",
 "altered replay ok": true,
 "altered replay status": "already-applied",
 "altered replay returned the ORIGINAL receipt": true,
 "original receiptId": "amr-da1889dc29d422f5…"
}B121_R2_END
```

After a valid apply, a proposal whose **operations were replaced** (proposalId
and scope retained) received `ok: true, status: "already-applied"` **and the
original receipt** — success status inherited by a tampered artifact.

**Architectural cause.** The B12 registry key bound only
`proposalId + tenant/project/branch/lineage`, and the one-shot `claim()` ran
**before** `verifySealedTier1Proposal`. The altered body therefore hit the
`consumed` registry entry and returned the original receipt without the
integrity check (which would have refused it as `altered`) ever running.

## R3 — receipt validator unsoundness

```json
B121_R3_START{
 "genuine receipt issues": 0,
 "forged transactionId+undoReference issues": [],
 "forged schematicDigestAfter issues": [],
 "Object.create(validReceipt) issues": [],
 "Object.create(validReceipt) own keys": 0
}B121_R3_END
```

Three forgeries, each **zero validation issues**:

1. `transactionId` and the matching `undoReference.transactionId` both changed
   to a different valid string — the only cross-check was undo ≡ transaction.
2. `schematicDigestAfter` changed to another syntactically valid `eng1-`
   digest — no field was bound to the receipt's identity.
3. `Object.create(validReceipt)` — an object with **zero own properties**:
   `key in receipt` walked the prototype chain, `Object.keys` found no unknown
   keys, and every value read resolved through the prototype.

**Architectural cause.** Reflection-first validation on the raw object: `in`
lookups, direct property reads, no own-property/plain-object capture, and no
recomputation of `receiptId` from the receipt body.

## R4 — project retirement during commit

```json
B121_R4_START{
 "caller-visible outcome": "refused:postcondition-failed",
 "caller-visible message excerpt": "The commit could not be verified (1 postcondition failure(s)). The proposal is permanent",
 "retired session lifecycle": "unavailable",
 "retired session headMark()": null,
 "RETIRED durable store head sequence (0 = untouched, 1 = ADVANCED)": 1,
 "durable head digest === proposal's expected post-apply digest": true
}B121_R4_END
```

With a controllably delayed `AtomicProjectStore.commit`: the apply entered the
durable-commit critical section, the project was retired mid-commit (session
disposed, exactly as `hydrateProject` does), and the blocked commit was then
released. The **retired** durable store advanced to head sequence 1 carrying
the applied schematic — while the caller was told
`refused: postcondition-failed` ("The commit could not be verified…the
proposal is permanently refused"). A durable mutation of a retired project,
reported as a failure.

**Architectural cause.** The only guard was a **post-await** check
(`headMark()` after commit), which cannot undo a durable commit that already
landed. Nothing made retirement wait for an in-flight approved commit, and
nothing made a not-yet-started apply cancel once retirement began — the two
orderings were never interlocked.

---

## Closures (implemented by B12.1)

| # | Closure |
| --- | --- |
| R1 | §A — the apply flows through `SchematicGestureCoordinator.runCanonicalCommand`: verification at the serialized execution position, adoption via the production applier (one projection update + one `SchematicHistory` entry), receipt/consume only after adoption succeeds |
| R2 | §C — bounded capture → sealed-body integrity verification → identity derived from the **complete** verified sealed body → only then the one-shot/consumed lookup; an altered artifact refuses as `verification-failed (altered)` and can never see another artifact's receipt |
| R3 | §D — capture-first receipt validation: own-property plain-JSON capture, exact closed key set, per-field checks on captured values, and `receiptId` **recomputed from the captured body** with the exact production digest schema |
| R4 | §B — `ProjectCommitInterlock`: retirement-before-critical-section cancels the apply with zero durable transaction; a held commit/adoption lease makes retirement wait until the critical section settles; both orderings tested |
