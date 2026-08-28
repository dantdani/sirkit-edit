# B16.0.18 §F/§G — Preliminary export truthfulness (CONFIRMED)

| Rule | Evidence |
|---|---|
| project state + trusted scope validated | foreign scope → 422 (pinned) |
| candidate must exist in pinned state | unknown → 404 `candidate is not in the pinned state` (pinned) |
| `PRELIMINARY_NOT_RELEASED` preserved | the success status literal (gate-asserted in source); the response carries the preliminary BOM, assignment matrix, hard-gate report, downstream obligations, objective vector, alternatives, handoffs, and provenance digests unchanged |
| filename sanitization unchanged | `sirkit-preliminary-bom-<candidateId [^a-zA-Z0-9_.-]→_>.json` |
| NOT a purchase order / released BOM / schematic approval / PCB approval / manufacturing release | the status says PRELIMINARY_NOT_RELEASED; no purchase/release surface exists in the route (gates scan for purchase/release identifiers); manufacturing release remains internal-only (gate) |
