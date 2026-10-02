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

[B22-A3, 2026-10-01] Superseded in part: the process is the diagnostic runner's (OD-136). "simulator unavailable" is now 500
"ngspice could not be started from the pinned install" (nothing is looked up on PATH); a refusal before any process - an unpinned or
mismatched install, the runner's cap - is 503 with its closed text; cancelled is 500 "Simulation cancelled", answered only after the
process tree's exit was observed; a tree kill whose exit was not observed is 504 naming `kill_unconfirmed` at the wall clock, and
[B22-A3 review, 2026-10-01] 500 "Simulation cancelled; ... (kill_unconfirmed)" after an abort (the cause is kept); a success also
carries `runner` (the profile, the observed install digest, the labels `diagnostic_only`, `environment_dependent`, the seed and the
variables Node added on win32) (`artifacts/ai-control-plane-b22/diagnostic-runner.md`; each answer pinned by
`b22-a3-diagnostic-runner` case 13).

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
require an architectural expansion. **CONFIRMED.** [superseded 2026-10-02 by the B22 closeout (D22-14, OD-144): no local execution was ever authoritative, and the route's runner is gone: ngspice runs through the diagnostic runner (OD-136), which is not isolated and never authoritative. 'Not blocked' stays true: OD-136 retired none of the three entry points]
