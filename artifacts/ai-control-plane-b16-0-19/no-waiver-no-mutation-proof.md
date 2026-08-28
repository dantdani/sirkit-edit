# B16.0.19 §F/§G — No-waiver / no-mutation proof (CONFIRMED)

| Claim | Evidence |
|---|---|
| remediation proposal cannot alter findings | the pinned run is asserted **byte-unchanged** after a successful proposal; the proposal carries only finding stable identities + actions for human review |
| cannot waive findings | `waiverMutation: null` pinned; no waiver identifier in any route (gate); the proposal schema has no waiver channel |
| cannot change readiness | `readinessMutation: null` pinned; readiness is computed only by /readiness from pinned inputs |
| cannot change rule results / applicability / severity | the response carries no such fields; the factory copies findings' identities only; the run object is never written |
| cannot mutate graph / schematic / PCB | `graphMutation` / `schematicMutation` / `pcbMutation` all null (pinned + gate-asserted literals) |
| cannot claim requirement satisfaction / safety / verification | forbidden by the system prompt AND structurally impossible — no response channel exists |
| knowledge side cannot approve/publish | `publicationEligible: false`, `proposal_only`, low/unknown quarantine labels |
