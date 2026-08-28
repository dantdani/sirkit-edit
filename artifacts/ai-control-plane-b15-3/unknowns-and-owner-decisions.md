# B15.3 — unknowns and owner decisions

## Intentional decisions (documented)

1. **Schema/tool version stays `sirkit.pcb-bounded-edit-proposal.v1` /
   1.0.0** even though the validation-policy field was added. Rationale: the
   contract had NEVER been exposed or crossed a wire before B15.3; every
   consumer is in-repo and migrated atomically. No unsafe pre-exposure wire
   contract is owed compatibility (the stage explicitly permits this).
2. **`approvalTier: "none"` on the propose tool** (matching both schematic
   propose tools). SEALING requires no approval — it mints a display-only
   artifact. The topology-or-geometry tier lives on the sealed ARTIFACT and
   the `pcb.bounded-edit-apply` action, enforced by the human-gated apply.
3. **`requiresLineage: false` on the propose tool.** The discovery lineage
   anchor is the SCHEMATIC session lineage (B09.3 digest-domain separation).
   The PCB proposal's lineage binding is the PCB CANONICAL session lineage,
   enforced by the `pcbProposalBasis` prerequisite (loop + gateway fail
   closed without it), sealed into `base.lineageId`, and re-verified at
   apply. Setting `requiresLineage: true` would incorrectly gate the PCB
   tool on a SCHEMATIC lineage.
4. **The PCB journal has NO legacy migration** (unlike the B12 schematic
   journal): this journal never had a pre-IndexedDB format.

## Honest limits (CONFIRMED / INFERRED)

- **CONFIRMED** — the integrity checksum is NOT authentication (documented,
  and §K41 proves a checksum-consistent forged journal entry is refused);
  authority is the identityKey-over-verified-body, the chain-protected
  commitment in `provenance.candidateId`, and canonical-history-proven
  recovery.
- **INFERRED (defended)** — the review dialog's disable conditions are a
  courtesy; the SECURITY boundary is the apply service, which re-verifies
  every condition at the serialized position. A UI that enabled a button the
  service would refuse is harmless (the service refuses); the tests confirm
  the service refuses each stale/foreign/mismatch case with zero mutation.
- **INFERRED** — `pcbProposalBasis` is captured from the live editor and
  shape-validated server-side; it is a scope LABEL only (like the schematic
  head mark). It is never granted authority: the live editor re-verifies
  head/lineage/policy at apply, so a stale or manipulated basis can only
  cause a refusal, never an incorrect apply.
- **INFERRED** — the `pcb.bounded-edit-apply` kernel operation binding lists
  the bounded vocabulary; if a future bounded operation kind is added to
  `bounded-edit-operations.ts`, this binding must be extended too (a
  recompiled delta touching an unlisted kind is rejected by the executor —
  fail closed, but it would block a legitimate new op until the binding is
  updated). Recorded so the next stage remembers.

## UNKNOWN / deferred

- The production IndexedDB PCB journal store is covered by the in-memory CAS
  store in tests (identical contract); a fake-indexeddb integration test for
  the IDB store specifically (mirroring b12-5) is a reasonable future
  addition but not required by the stage's K list.
- The pre-existing `assignment-queue-panel.test.tsx` flake (recorded since
  B15.2.2) remains un-repaired and unrelated; it did not fire this run.

## PROPOSED

- None blocking. A future stage could seal the PCB proposal basis with a
  server-verifiable digest (as the schematic head mark participates in an
  identity digest) to strengthen the label from shape-validated to
  integrity-pinned — but the apply-time re-verification already makes a
  manipulated basis refusal-only, so this is a hardening, not a fix.
