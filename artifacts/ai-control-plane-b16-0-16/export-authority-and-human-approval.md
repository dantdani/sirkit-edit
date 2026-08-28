# B16.0.16 §D/§G — Export authority & human approval (CONFIRMED)

`/export` migrated to the wrapper (`{ context, body }`). Its handoff semantics
are unchanged.

## Requires one current human-approved report

The callback validates the calculation project state, checks scope
(`state.projectId/branchId === scope`), and then requires:

```
state.decision?.state === "approved"
  && the report whose reportId === decision.reportId
     AND deterministicDigest === decision.reportDigest exists
```

If no such report → **422 `{ ok:false, status: "NOT_RELEASED", … }`** (pinned).

## Explicitly NOT a release

A successful handoff returns
`status: "APPROVED_CALCULATION_HANDOFF_NOT_A_SCHEMATIC_OR_PCB_RELEASE"` with the
approved report, the decision, and provenance digests. This deliberately does
NOT represent:

- a schematic approval,
- a PCB approval,
- a manufacturing release.

The gate suite asserts the route source contains
`APPROVED_CALCULATION_HANDOFF_NOT_A_SCHEMATIC_OR_PCB_RELEASE` and `NOT_RELEASED`,
and that no calculation route references `releaseManufacturingPackage` /
`manufacturing.release`.

## Filename sanitization

`Content-Disposition: attachment; filename="sirkit-calculation-<reportId
sanitized [^a-zA-Z0-9_.-]→_>.json"` — byte-identical to the pre-migration
handler.
