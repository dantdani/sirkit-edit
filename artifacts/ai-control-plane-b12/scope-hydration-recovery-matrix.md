# B12 §D — scope, hydration, and recovery matrix

> **SUPERSESSION NOTE (B12.3).** The "Reload → in-memory registry empty →
> replay" row below ("durable executor returns idempotent_replay → explicit
> already-applied; no second commit") overstated reality: the replay never
> reached the executor — stale-head verification refused it first, and the
> receipt was unrecoverable (B12.3 counterexamples R1/R2). See
> `../ai-control-plane-b12-3/reload-and-idempotency-evidence.md`.
> Preserved as historical evidence.


> **SUPERSESSION NOTE (B12.1).** The retirement rows below relied on
> post-await checks, which cannot undo a durable commit: retiring a project
> mid-commit durably advanced the RETIRED store while the caller was told
> "refused" (counterexample R4). Superseded by
> `../ai-control-plane-b12-1/project-lifecycle-interlock.md`
> (`ProjectCommitInterlock`: transition-first cancels with zero durable
> transaction; lease-first makes retirement wait). Preserved as historical
> evidence.


How the approved apply stays correct across scope pinning, reloads, replays, and
unverifiable commits — the "what if the world moved between seal and apply"
axis.

## Scope is pinned three times, checked three times

| Where | Pinned at | Re-checked at apply |
| --- | --- | --- |
| Sealed proposal (`scope`) | seal time: tenant/project/branch + `headMark{lineageId, headSequence, canonicalStateDigest}` + base schematic digest | `verifySealedTier1Proposal` against the **current** session identity |
| Service preflight | `session.headMark()` captured **before** any async work | passed as `expectedScope.headMark` to the verifier |
| Canonical queue | `expectedBaseDigest` + `expectedHeadMark` on the command | re-checked **inside** the session's serialized queue, under the lock |

The third check closes the seal→apply race: even if verification passes, another
transaction could land before the queue reaches this command; the in-queue
`expectedHeadMark`/`expectedBaseDigest` re-check rejects it as stale.

## Recovery scenarios

| Scenario | Behaviour | Fail direction |
| --- | --- | --- |
| **Head advanced** between seal and apply (a real edit) | verifier → `stale-head`; service → `verification-failed`; nothing changes; claim released | closed |
| **Base digest drifted** | verifier → `stale-base`; `verification-failed`; released | closed |
| **Foreign scope** (project/branch/lineage mismatch) | verifier → `foreign-scope`; `verification-failed`; released | closed |
| **Expired** (past TTL, 10 min) | verifier → `expired`; `verification-failed`; released | closed |
| **Altered** (digest seal broken) | verifier → `altered`; `verification-failed`; released | closed |
| **Reload → in-memory registry empty → replay** | fresh claim, but the durable executor returns `idempotent_replay` → explicit `already-applied`; **no second commit** | closed |
| **Commit lands but postconditions fail** | identity **poisoned**; `postcondition-failed`; permanently refused | closed |
| **Session not ready** (`headMark()` null) | `session-not-ready` before claiming; one-shot not spent | closed |
| **Undo after a verified commit** | `reconcileHistoryStep` restores the **exact** pre-apply canonical digest and lineage (R3/R8) | reversible |

## §D postconditions verified on every commit (recap)

Verified from the authoritative `result` + `session`, never assumed:

- status `executed`, non-empty `transactionId`;
- `revisionBefore` equals the sealed head canonical digest;
- head present after commit, lineage unchanged, advanced by **exactly one**;
- `result.headMark` agrees with the session head;
- post-apply schematic passes `validateSchematicStateIntegrity`.

Any failure ⇒ poison ⇒ `postcondition-failed`. The receipt is minted only after
all postconditions pass **and** the receipt validates against its own gate.

## Why the head is captured before async work

`headBefore = session.headMark()` runs synchronously at entry. If it were read
after `await`, an interleaved transaction could move the head between the read
and the verify, and the receipt's `headBefore` would not describe the state the
human actually approved. Capturing first pins the human-approved baseline; the
in-queue re-check pins the actual execution baseline; the receipt records both
and asserts they differ by exactly one transaction.
