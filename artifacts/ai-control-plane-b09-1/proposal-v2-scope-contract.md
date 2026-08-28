# B09.1 — Sealed Proposal V2: Scope and Lineage Contract

## Artifact (`sirkit.schematic-tier1-proposal.v2`)

```
{
  schema: "sirkit.schematic-tier1-proposal.v2",
  proposalId,                    // digest over EVERYTHING below (v2 id schema)
  scope: {
    tenantId, projectId, branchId,
    headMark: { lineageId, headSequence, canonicalStateDigest },  // SchematicEditorSession.headMark()
  },
  baseSchematicDigest, operations, operationsDigest,
  impacts, provenance{provider: "openai"|"anthropic", note, instruction},
  createdAt, expiresAt (10 min TTL)
}
```

- The head mark comes ONLY from the current READY `SchematicEditorSession`
  (page seal path) or, for the chat agent path, from the request body as a
  sealing LABEL — it never mints authority; the artifact is verified at
  apply against the CURRENT ready session.
- A missing/malformed/not-ready mark fails closed: the proposal tool is
  withheld from the run toolset AND its invocation refuses
  (`authority_unavailable`); read-only conversation continues.
- `sealTier1Proposal` REQUIRES a well-formed scope (else blocked);
  V1 sealing no longer exists anywhere.

## Verification order (`verifySealedTier1Proposal`)

1. schema — V1 → `wrong-version`; anything else non-V2/structurally bad →
   `malformed` (missing expected scope → `foreign-scope`).
2. operations digest → `altered`.
3. identity digest over the FULL body (scope + head fields included) →
   `altered` on any tampering.
4. tenant/project/branch or lineageId mismatch → `foreign-scope`.
5. headSequence or canonicalStateDigest mismatch → `stale-head` (covers
   the head advancing and RETURNING to an identical schematic digest).
6. expiry → `expired`.
7. schematic UI-projection digest → `stale-base`.

## Execution race closure

`SchematicCommandRequest.expectedHeadMark` is rechecked INSIDE the
session's serialized queue immediately before execution (lineage +
sequence + canonical digest); mismatch rejects `stale_revision` with
`EXPECTED_HEAD_MARK_MISMATCH` and zero mutation. Apply remains exactly
one canonical transaction with exact verified-replay undo — no new
mutation path exists.

## Cross-scope replay impossibility (proof map)

| attack | refusal | test |
|---|---|---|
| project A artifact in project B, byte-identical schematics | foreign-scope | b09-1 §1 A |
| branch A artifact in branch B, identical content | foreign-scope | §1 B |
| same project/branch/content, foreign lineage | foreign-scope | §1 C |
| same lineage, head advanced and returned to same schematic digest | stale-head (+ in-queue EXPECTED_HEAD_MARK_MISMATCH) | §1 D |
| tampered scope/head fields (verify against the tampered scope itself) | altered (identity digest) | §1 E |
| V1 artifact replay | wrong-version | §1 E |
| second apply of the exact artifact | in-queue head-mark mismatch | §1 F |
