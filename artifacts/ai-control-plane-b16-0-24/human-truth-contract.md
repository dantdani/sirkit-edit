# B16.0.24 §H — human-truth contract

## /api/simulate truthfulness

The route distinguishes execution states and never overstates them:

| state | representation |
|---|---|
| compiled | netlist generated (`schematicToSpice`) — no run implied |
| execution attempted | a child spawned |
| completed | exit code 0 + parsed data → `{ ok: true, … }` |
| cancelled | client abort → the child is killed; the request settles |
| timed out | 504 "Simulation timed out" |
| parse failed | 500 "Could not parse simulation output" |
| simulator unavailable | 500 "ngspice executable not found on PATH" |
| diagnostic-only | non-zero exit → `{ ok: false, error }` (stderr tail) |
| no data | 500 "Simulation produced no data points" |

A successful process exit is represented ONLY as an executed simulation
result — never physical validation, engineering approval, design readiness,
safety certification, or manufacturing release. The success envelope carries
`analysis`, `variables`, `points`, and the netlist/node maps (for the client's
plotting/probing) and nothing that asserts approval. Gate: no simulate/auth/
chat route contains `signoff`/`certif`/`manufacturing release` wording.
**CONFIRMED.**

## Agent (chat) truthfulness

No AI proposal constitutes an executed simulation: chat's proposals arrive as
review-gated `proposal_ready` / `pcb_proposal_ready` events; the run mutates
nothing and executes no simulation. The 12-tool registry exposes no
manufacturing-release tool. **CONFIRMED.**

## Not built

Authoritative execution was NOT expanded and no new simulator platform was
built. The existing single-shot runner was hardened in place (bounded, isolated,
env-allowlisted, shell-less); it was not blocked, because the hardening did not
require an architectural expansion. **CONFIRMED.**
