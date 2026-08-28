# B16.0.15 §F — Internal-only release proof (CONFIRMED)

Permanent gates in
[`b16-0-15-manufacturing-boundary-gate.test.ts`](../../app/lib/auth/__tests__/b16-0-15-manufacturing-boundary-gate.test.ts)
plus the standing `b16-0-2-gates` invariants:

| Invariant | Status |
|---|---|
| `sirkit.manufacturing.release`: discovery `internal-only`, callability `not-callable`, agentExposed `false` | CONFIRMED |
| total agent-exposed tool count remains EXACTLY **12** | CONFIRMED |
| no agent-exposed tool routes to `/api/pcb/qualify` or `/api/pcb/release` | CONFIRMED (serialized exposed set matches neither) |
| no provider-visible exposed descriptor advertises a callable manufacturing release | CONFIRMED (no exposed descriptor matches `manufacturing.release`) |
| neither HTTP route becomes an agent tool | CONFIRMED — the routes are HTTP handlers only; the registry exposes no route-backed manufacturing tool |
| no MCP exposure added | CONFIRMED — this stage adds no tool/MCP surface; only a route boundary changed |
| no proposal tool can directly call qualification/release | UNCHANGED — the proposal/apply flows were not touched; the standing agent-boundary suites (b09/b12–b15) pass |
| no alternate engineering-export route can claim verified release | UNCHANGED — the engineering Gerber export's `releaseMode:"verified"` refusal (B16.0.13) remains green |

## Negative tripwires (CI fails if loosened)

The gate suite fails CI if the exposed-tool count ≠ 12, if the release
descriptor's discovery/callability/agentExposed drift, or if an exposed
descriptor begins mentioning a callable manufacturing release. The migration
changed only the request boundary — it added no tool exposure.
