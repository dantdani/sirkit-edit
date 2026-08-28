# B16.0.20 §D — Authoritative runner remains BLOCKED (CONFIRMED)

Even when `authorizeSimulationExecution` returns
`{ authorized: true, mode: "authoritative" }`, the route fail-closes:

```
501 { ok: false, authorization, error:
  "CD-10 authoritative runner is blocked until the sandbox image/executable
   and environment corpus are independently validated" }
```

Pinned exactly (status + error text). Guarantees:

- **zero process spawn / container launch / network / external simulator
  call / durable result publication** — the route contains NO such surface,
  enforced by the code-only gate (no `child_process`/`spawn`/`exec`/`Worker`/
  docker/container/`fetch` identifier in any of the six routes);
- the runner was NOT implemented in this stage (mandate);
- the 501 body returns the authorization diagnosis for transparency but
  publishes nothing.
