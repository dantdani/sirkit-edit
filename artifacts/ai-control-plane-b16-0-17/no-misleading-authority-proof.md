# B16.0.17 §I — No misleading authority (CONFIRMED)

Permanent assertions in
[`b16-0-17-schematic-compiler-confinement-gate.test.ts`](../../app/lib/auth/__tests__/b16-0-17-schematic-compiler-confinement-gate.test.ts)
plus the parity pins:

| Assertion | Status |
|---|---|
| proposal is not mutation | CONFIRMED — `proposal_only` + `graphMutation/diagramMutation/pcbMutation: null` |
| layout view is not graph authority | CONFIRMED — `view_only` |
| KiCad inspection is not semantic import | CONFIRMED — `quarantine_inspection_only` + `semanticImport: null` |
| diagnostic comparison is not certified round-trip proof | CONFIRMED — 422 + `none-certified` + `NO_CERTIFIED_KICAD_SEMANTIC_ADAPTER` |
| graph export requires human approval | CONFIRMED — `NOT_RELEASED` without the approved candidate chain |
| CD-8 handoff is not verification/PCB/manufacturing release | CONFIRMED — `APPROVED_CD8_HANDOFF_NOT_ERC_SIMULATION_OR_PCB_RELEASE` |
| direct AI transactions remain denied | CONFIRMED — routes.test invariant unchanged green |
| no route becomes an agent tool | CONFIRMED — exposed set matches no `schematic-compiler` |
| total exposed tools remain exactly 12 | CONFIRMED |
| manufacturing release internal-only & not-callable | CONFIRMED — descriptor re-asserted in this gate |
