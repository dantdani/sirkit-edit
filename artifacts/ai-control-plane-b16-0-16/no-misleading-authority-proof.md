# B16.0.16 §G — No misleading authority (CONFIRMED)

Permanent assertions in
[`b16-0-16-calculation-confinement-gate.test.ts`](../../app/lib/auth/__tests__/b16-0-16-calculation-confinement-gate.test.ts):

| Assertion | Status |
|---|---|
| calculation proposals are advisory/proposal-only | CONFIRMED — propose returns `authority: "proposal_only"`, `calculatedResults: []`, `decisions: []` |
| calculated results originate only from approved deterministic evaluators | CONFIRMED — `/evaluate` restricts to the 6-model registry (unapproved → 422); propose emits no numeric result |
| reports require verified digests and evidence | CONFIRMED — `/report` digest gates precede materialization ([report-integrity-proof.md](report-integrity-proof.md)) |
| export requires current human approval | CONFIRMED — `NOT_RELEASED` without an approved report |
| export is NOT schematic / PCB / manufacturing release | CONFIRMED — explicit `APPROVED_CALCULATION_HANDOFF_NOT_A_SCHEMATIC_OR_PCB_RELEASE` |
| no calculation route can invoke manufacturing release | CONFIRMED — no route references `releaseManufacturingPackage`/`manufacturing.release` |
| no calculation route becomes agent-exposed | CONFIRMED — exposed set matches no `api/calculation` / `calculation.*` |
| total exposed tools remain EXACTLY 12 | CONFIRMED |

This layered evidence prevents humans from mistaking AI-generated analysis for
authoritative approval or release.
