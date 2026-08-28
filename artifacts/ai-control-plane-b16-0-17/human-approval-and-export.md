# B16.0.17 §G — Human approval & export (CONFIRMED)

`/export` (migrated) preserves the human-approval gate byte-identically:

A successful handoff requires ALL of:

1. `state.decision.state === "approved"` (the human decision);
2. the candidate matching `decision.candidateId` with
   `approvalState === "approved"` AND `lifecycleState === "approved_for_CD9"`;
3. the graph matching `candidate.semanticGraphRevisionId` with
   `deterministicDigest === candidate.semanticGraphDigest` (digest binding);
4. the PCB synchronization contract (`candidate.pcbSynchronizationContractId`);
5. the round-trip certificate with
   `certificateState === "semantically_equivalent"`.

Missing ANY → **422 `{ status: "NOT_RELEASED" }`** (pinned).

Success returns
`status: "APPROVED_CD8_HANDOFF_NOT_ERC_SIMULATION_OR_PCB_RELEASE"` — explicitly
NOT ERC approval, NOT simulation approval, NOT PCB release, NOT manufacturing
release. Filename sanitization
(`sirkit-cd8-<candidateId [^a-zA-Z0-9_.-]→_>.json`) unchanged.

## /problem (CONFIRMED)

Pinned CD-1…CD-7 states + upstream signoff + atomic snapshot + variantIds
required (400 exact); trusted tenant/project/branch binding → 403
`schematic problem scope mismatch` (pinned); actor built only from trusted
context; `LOW_VOLTAGE_SCHEMATIC_PROFILE_V1` unchanged.
