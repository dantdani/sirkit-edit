# B16.0.13 §E — Provider zero-call evidence

Five fakes are asserted after EVERY refusal, for EVERY route:
`llmRouter.generate`, `runFreerouting`, `resolveFreeroutingRuntime`,
`buildFabBundle`, `compileNativeFabPackage`.

## Zero calls proven for (×5 routes)

| Refusal | Work |
|---|---|
| authentication (anonymous 401) | **0** |
| CSRF (production cross-origin 403) | **0** |
| insufficient role (viewer 403) | **0** |
| revoked membership (403) | **0** |
| invalid media (415) | **0** |
| malformed JSON (400) | **0** |
| oversized body (413) | **0** |
| stalled body | settled by the shared reader before any callback (standing B16.0.4 behavior suite) — no work reachable |
| invalid board/netlist/request (route 400s) | **0** |
| pre-aborted request (autoroute) | **0** runtime lookups, **0** process spawns |

## Valid-path invocation counts (historical, preserved)

- repair/agent: `generate` exactly once on the no-tool path (pinned), the
  8-iteration tool loop unchanged (standing behavior);
- from-brief / edit-assist: `generate` exactly once per attempt with the
  requested provider; provider failure → normalized `providerErrorResponse`
  503 with exactly one call (pinned);
- autoroute: runtime discovery → DSN → `runFreerouting` per pass, unchanged
  (standing route.test);
- gerbers: `buildFabBundle` / native compiler invocation counts unchanged
  (standing gerbers suites).

No prompt or provider configuration was altered
([prompt-schema-and-provider-parity.md](prompt-schema-and-provider-parity.md)).
