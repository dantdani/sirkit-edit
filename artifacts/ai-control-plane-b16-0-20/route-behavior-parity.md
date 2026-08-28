# B16.0.20 §B — Route behavior parity (CONFIRMED)

Prologues became `authenticatedJsonRoute({ maxBytes: 64_000_000, deadlineMs:
30_000 })` callbacks: `{ body }` for measure; `{ context, body }` +
`modelSimulationScopeFromContext` for the other five. Business logic
byte-identical EXCEPT the mandated §C execute-gate correction. All 44 §A pins
pass pre = post; the standing model-simulation route suite passes unchanged.

Role separation: all six deny viewer (403); permitted = pcb_editor, reviewer,
project_admin, automation (per policy rows, unchanged). Material headers:
`Cache-Control: no-store` on every success — byte-identical.
