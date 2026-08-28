# B14 §C/§I — impact plan and postconditions

## The reviewed impact plan (sealed + digest-pinned)

Produced by the ONE existing `planSchematicReplacement` (no second
algorithm): source component + part, target exact part, mode
(`pin-identical-substitution` / `mapped-substitution` / `value-only`),
mapping evidence, the exact pin mapping, preserved connections, wire
endpoint moves, net-label moves, downstream invalidations, warnings, and
ZERO dropped connections (structurally enforced — a nonzero list fails
artifact integrity, and the assembler never supplies the acknowledgement
that would permit drops).

## Post-commit verification (inside the serialized job)

B12 core: transaction id present; commit base equals the sealed head
digest; a post-commit head mark exists; lineage UNCHANGED; head sequence
advanced by EXACTLY one; whole-schematic validation clean.

Replacement-specific (`replacementPostconditions`):

- the component still owns the same stable `componentInstanceId`;
- the instance's `partId`, `atomicPartRevisionId`, `symbolAssetVersionId`,
  `footprintAssetVersionId`, `mappingCertificateId`, and
  `selectionRecordId` EXACTLY match the fresh server-verified target —
  source stale authority fields are gone (identity + authority replaced
  together, the B06 operation semantic);
- every reviewed wire endpoint move landed exactly (the wire's first/last
  vertex equals the reviewed `to` position);
- every reviewed net-label move landed exactly;
- no unreviewed wire or label changed (the canonical operation only touches
  the reviewed moves — B06 kernel semantics — and the undo test proves the
  prior digest is exactly restorable);
- no connected pin was dropped (plan + artifact + postcondition).

Any postcondition failure → `postcondition-failed` → registry + journal
POISON — success is never claimed (B12 recovery semantics). Derived
PCB-sync/BOM/SPICE/readiness state invalidates through the existing
canonical invalidation mechanism (`invalidatedArtifactKinds` on the
transaction; the committed message and dialog note the recompute).

Undo/redo: exact — undo restores the prior schematic digest AND the prior
identity/authority fields (stale fields truly gone after redo again);
redo restores the committed digest (b14-replacement-apply 45/46).
