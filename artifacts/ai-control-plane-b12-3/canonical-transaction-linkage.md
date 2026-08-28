# B12.3 §B/§D — canonical-transaction linkage and the replay ordering

## §D — the session's durable idempotency evidence query

`SchematicEditorSession.durableIdempotencyEvidence(clientOperationId)`
([schematic-session.ts](../../app/lib/engineering/schematic-session.ts)):

- **read-only** — exposes no mutation capability; it loads the durable
  envelope (already a defensive clone) and returns a frozen, owned,
  bounded metadata record;
- verifies the **full envelope integrity chain**
  (`validatePersistenceEnvelope`: record digests, chain links, envelope
  digest, head/log consistency) before answering — a tampered store is
  `corrupt`, never data;
- finds records by **exact `clientOperationId`**;
- returns: `unavailable` (no store / load threw), `absent`, `corrupt`
  (integrity or malformed record), or `found` with
  `{ transactionId, clientOperationId, status, operationsDigest
  (schema-domain digest over the recorded operations), operationCount,
  projectId, branchId, lineageId, baseHeadSequence,
  baseCanonicalStateDigest, resultHeadSequence,
  resultCanonicalStateDigest }`;
- classification (exact vs mismatch) deliberately belongs to the APPROVED
  apply boundary — the query itself cannot be used to bypass base/head
  checks, and the executor's own duplicate/reference-mismatch checks are
  untouched.

## §B — the corrected replay ordering

```
1. bounded capture + FULL sealed-body integrity verification
2. trusted LIVE tenant/project/branch/lineage + current-scope +
   non-retiring-interlock verification            (§E — every path)
3. in-memory claim (concurrency cache only)
4. durable journal lookup + durable evidence lookup
5. EXACT comparison — the bypass condition:
     record.status === "accepted"
     ∧ record.clientOperationId === proposalId
     ∧ operations digest equal (recorded ops vs sealed ops)
     ∧ project/branch equal ∧ envelope lineage === sealed lineage
     ∧ record base head sequence + canonical digest === sealed base mark
     ∧ (journal transactionId, when recorded, === record transactionId)
6. already durable → replay/recovery disposition (crash-recovery table)
7. otherwise → the NORMAL path: current sealed base/head/expiry enforced
   at the serialized execution position; ONE new transaction
```

**Stale-head validation is never generally bypassed.** The bypass applies
only when step 5 proves this exact authenticated artifact already produced
the exact recorded transaction — a reused proposalId with a different
operation set, digest, scope, lineage, base, or an inconsistent record
fails closed (`verification-failed` / `recovery-required`) **without a
receipt**.

## Linkage invariants

- journal `clientOperationId` = sealed `proposalId` = executor idempotency
  key — one identity across all three layers;
- journal `transactionId` (recorded at commit) must equal the canonical
  record's; `headAfter.headSequence` must equal the record's
  `resultHeadSequence` when present — any disagreement is
  `recovery-required`, never a guess;
- the persisted receipt's `transactionId` is re-checked against the
  canonical record at every replay before it is returned;
- one-shot semantics unchanged: in-flight claims refuse concurrents; the
  durable executor's own `idempotent_replay` path remains the last-resort
  backstop inside the commit itself.
