# B16.0.23 — zero-call refusal evidence

Every authorization/validation refusal on a protected method causes ZERO
downstream work. Pinned via three seams whose call logs are asserted empty:
the fake `llmRouter.generate` spy, the fake `node:child_process.spawn` call
log, and the real in-memory job store (`getRuns(SCOPE)` empty).

| refusal | spice/ai | models/import | models/smoke-test | runs(start) |
|---|---|---|---|---|
| unauthenticated 401 | generate 0 | — | spawn 0 | store empty |
| foreign membership 403 | generate 0 | — | spawn 0 | store empty |
| revoked membership 403 | generate 0 | — | spawn 0 | store empty |
| viewer/commenter 403 | generate 0 | — | spawn 0 | store empty |
| production cross-origin 403 | 0 body pulls | 0 pulls | 0 pulls, spawn 0 | 0 pulls |
| 415 media type | generate 0 | — | spawn 0 | — |
| 413 over-ceiling | generate 0 | — | spawn 0 | — |
| pre-abort 400 | generate 0 | — | spawn 0 | — |
| required-field 400 | generate 0 | — | — | store empty |
| .control model refused | — | — | **spawn 0** | — |
| unresolved dependency | — | — | **spawn 0** | — |

Additional §G pins: `run_simulation` records a proposal but the job store
stays empty (`getRuns(SCOPE)` empty); a LOCAL AI failure returns a 422 with no
`provider` field. The single provider call on a valid request is the ONLY
provider invocation, and it is dominated by the completed authorization +
bounded read. **CONFIRMED.**
