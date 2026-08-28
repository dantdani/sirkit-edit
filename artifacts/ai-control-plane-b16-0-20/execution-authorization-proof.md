# B16.0.20 §D — Execution authorization proof (CONFIRMED)

The complete `authorizeSimulationExecution` gate is UNCHANGED (real function;
pass-through spy overridden only to pin the two verdict paths):

- provider definition / environment / lowering manifest / content digests
  pinned inputs; requested network policy, timeout bound, output-byte bound,
  memory/resource policy all evaluated inside the unchanged domain function;
- `authoritativeEligible` + validated provider/environment state required for
  `mode: "authoritative"`.

## Pinned verdict paths

| Authorization outcome | Response |
|---|---|
| absent / diagnostic-only / denied | **409** `authoritative execution denied` — zero runner/process/container/network work (statically: no such surface exists in the route) |
| authorized + authoritative | **501** — see [authoritative-runner-blocked.md](authoritative-runner-blocked.md) |

Authorization is therefore NEVER execution: both outcomes terminate without
any spawn, container, network call, external simulator call, or durable result
publication.
