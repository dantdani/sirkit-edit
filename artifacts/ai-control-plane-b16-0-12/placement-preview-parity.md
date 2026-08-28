# B16.0.12 §H — Placement preview parity

| Claim | Pin |
|---|---|
| Input board/state not mutated | the request board is JSON-frozen before the call and byte-compared after — unchanged |
| Deterministic for identical input | two identical requests produce byte-identical responses **modulo the engine's volatile `runId` and wall-clock `elapsedMs`** (historical per-invocation values, preserved — everything else exact, including seeds, candidates, digests) |
| Placement constraints and validation unchanged | `runEngineeringPlacement` and the options validator are byte-identical; the engine spy is a pass-through over the REAL engine |
| No durable save / history / revision / release | ZERO DB selects across the valid run (the DB fake counts) |
| Refusals precede computation | 415 / malformed JSON / missing board → refused with the engine NEVER invoked |
| Compute exactly once for a valid request | the engine spy records exactly one invocation |

The 16 MB / 45 s body contract is preserved verbatim in the wrapper options.
No placement behavior was changed.
