# B12.1 §C — sealed-artifact identity and idempotency

Supersedes: B12's `concurrency-and-idempotency-matrix.md` identity section
(proposalId + scope fields). The state machine
(in-flight/consumed/poisoned, release-vs-poison semantics) is unchanged.

## What was wrong

B12's registry key bound only `proposalId + tenant/project/branch/lineage`,
and `claim()` ran BEFORE `verifySealedTier1Proposal`. R2: after a valid
apply, a proposal whose **operations were replaced** (proposalId and scope
retained) hit the `consumed` entry and received `already-applied` **and the
original receipt** — success inherited by a tampered artifact, because the
integrity check that would have refused it as `altered` was never reached.

## The required ordering, implemented

```
1. bounded capture                    capturePlainJson(proposal, "proposal", 512KB)
2. structural validation              exact closed key set {schema, proposalId, scope,
                                      baseSchematicDigest, operations, operationsDigest,
                                      impacts, provenance, createdAt, expiresAt};
                                      V1 → wrong-version; patterns/shapes per field
3. sealed-body INTEGRITY              verifySealedTier1ProposalIntegrity (schematic-proposals.ts):
                                      operations digest AND whole-body proposalId digest
                                      recomputed from the CAPTURED body — single source of
                                      truth, shared with apply-time verification
4. exact artifact IDENTITY            engineeringDigest({ schema:
                                      "sirkit.approved-mutation-identity.v2",
                                      proposal: <complete captured body> })
5. atomic one-shot claim/consumed     registry.claim(identityKey)
6. scope/head/base verification       at the SERIALIZED execution position (§A)
7. execution + verified adoption      then, and only then,
8. receipt consumption                registry.consume(identityKey, receipt)
```

Steps 1–4 run before ANY registry access. **An altered, malformed, foreign,
expired, or integrity-invalid artifact can never look up — let alone
inherit — another artifact's consumed status or receipt.**

## What the identity binds

The v2 identity digest covers the **complete verified sealed body**:

- `proposalId`;
- the complete `operations` array and `operationsDigest`;
- `baseSchematicDigest`;
- `scope`: tenantId / projectId / branchId / headMark (lineageId,
  headSequence, canonicalStateDigest);
- `impacts` (including `destructive` — the approval tier);
- `provenance` (provider, note, instruction);
- `createdAt` / `expiresAt`;
- `schema`.

Every field of the sealed proposal contract participates; nothing is
outside the identity. (B12's `sirkit.approved-mutation-identity.v1` —
proposalId + scope only — is superseded and no longer derivable.)

## Everything downstream reads the CAPTURED artifact

After authentication, the service reads only the captured (owned,
deep-frozen) body — the caller's object is never touched again. Submitted
operations are `structuredClone(captured.operations)`: caller mutation
after capture is irrelevant.

## Idempotency, preserved exactly

- **Exact replay of the same intact consumed artifact** (same reference or a
  structural copy — identity is content, not reference) returns the
  ORIGINAL receipt with no new transaction.
- Concurrent applies of the same artifact converge on ONE transaction
  (second → `already-in-flight`, refused before queue submission).
- Failed preflights RELEASE (a regenerated proposal — a different identity —
  may succeed); unverifiable commits POISON forever.
- A durable-executor `idempotent_replay` (reload emptied the in-memory
  registry) surfaces as an explicit `already-applied` refusal — never a
  second commit, never a new history entry.

## Hostile artifacts

Capture refuses prototype-carried proposals (`Object.create(sealed)` has a
foreign prototype and zero own keys), accessor-bearing fields, symbol keys,
cycles, non-finite numbers, oversized bodies, and revoked/throwing proxies —
all as `verification-failed`, before any registry or session access.

`approvedMutationIdentityKey(proposal)` is exported for registries, audits,
and tests: it derives the identity for an intact artifact and `null`
otherwise; derivation is not approval and carries no authority.

## Evidence

`b12-1-adoption-identity-receipt.test.ts` R2 group: altered-after-consumed
(operations, digests, scope fields, head mark, impacts, provenance,
createdAt, expiresAt, extra field — each refuses `verification-failed`),
exact-copy replay returns the original receipt, hostile artifacts refuse at
capture, identity derivation agrees with integrity verification.
