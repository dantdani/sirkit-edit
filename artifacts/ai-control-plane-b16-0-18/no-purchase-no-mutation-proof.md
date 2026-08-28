# B16.0.18 §G — No-purchase / no-mutation proof (CONFIRMED)

Permanent human-truth assertions in
[`b16-0-18-component-selection-confinement-gate.test.ts`](../../app/lib/auth/__tests__/b16-0-18-component-selection-confinement-gate.test.ts):

| Assertion | Status |
|---|---|
| proposal is not selection | CONFIRMED — `proposal_only` + `hardGateResults: []` + `selectedPart: null` |
| compatibility evaluation is not approval | CONFIRMED — evaluate returns evaluations; approval lives only in human project-state decisions |
| alternative is not equivalence | CONFIRMED — the plan carries impacts, never an equivalence/approval claim |
| solver result is not human approval | CONFIRMED — solve returns candidates; the transaction layer denies direct AI mutation |
| sourcing snapshot not live unless approved-source acquired | CONFIRMED — refresh fail-closes 503 ([sourcing-fail-closed-proof.md](sourcing-fail-closed-proof.md)) |
| preliminary BOM is not released | CONFIRMED — `PRELIMINARY_NOT_RELEASED` |
| no route purchases components | CONFIRMED — code-only scan: no purchase/checkout/order/cart identifier |
| no route mutates schematic or PCB state | CONFIRMED — no `applySchematicTransaction`/`runEngineeringPlacement`/`publishBoard` reference |
| no fetch/network/distributor call | CONFIRMED — code-only scan across all ten routes |
| no component-selection route agent-exposed; tools EXACTLY 12 | CONFIRMED |
| manufacturing release internal-only & not-callable | CONFIRMED — descriptor re-asserted |
