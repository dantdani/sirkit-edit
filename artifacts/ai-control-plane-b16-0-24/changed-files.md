# B16.0.24 — files changed by THIS stage

## Production

| file | change |
|---|---|
| `app/lib/auth/route-handlers.ts` | + `requestOrigin` option (`meta.origin` from `resolveExpectedOrigin`); + `exposeEnvironment` option (`input.environment`); + `auth-signin-v1` closed reader-refusal profile (frozen table) honored by `publicJsonRoute`; + `agentStreamRoute` wrapper (body-scope + lenient parse + streaming + abort signal) |
| `app/api/auth/callback/route.ts` | GET → `publicRoute({ query, requestOrigin })`; redirect origin from `meta.origin` |
| `app/api/auth/signin/route.ts` | POST → `publicJsonRoute({ …, legacyReaderRefusals: "auth-signin-v1" })` |
| `app/api/auth/signout/route.ts` | POST → `publicRoute({ exposeEnvironment: true })`; env from `input.environment` (no raw 2nd arg) |
| `app/api/chat/route.ts` | POST → `agentStreamRoute`; auth boundary moved into the wrapper; `req.signal` → `signal`; dead `readBoundedBody` removed |
| `app/api/simulate/route.ts` | POST → `authenticatedJsonRoute({ …, exposeAbortSignal })`; hardened runner (isolated `mkdtemp` dir, `safeEnvironment` allowlist, `shell:false`, bounded output/parse, `assertSchematicFieldsSafe` + `assertNetlistSafe` injection guards, cleanup, no design-data logging) |

## Tests / gates / generated

| file | change |
|---|---|
| `app/lib/auth/__tests__/_boundary-analysis.ts` | + `agentStreamRoute` in `APPROVED_ROUTE_WRAPPERS` and the route-handlers canonical-sink symbol list |
| `app/api/__tests__/b16-0-24-tranche-parity.test.ts` | NEW — 19 §A pins |
| `app/lib/auth/__tests__/b16-0-24-tranche17-confinement-gate.test.ts` | NEW — 14 gates |
| `app/lib/auth/__tests__/b16-0-8-migration-ratchet.test.ts` | + TRANCHE_17; BASELINE_MAX 8→3; MIGRATED_FLOOR 145→150; split inventory (factory vs raw); + exact-zero-raw + exact-factory-allowlist assertions |
| `app/lib/auth/__tests__/_raw-route-baseline.json` | regenerated (sanctioned): 8 → 3 rows |
| `app/lib/auth/__tests__/b16-0-2-gates.test.ts` | + `agentStreamRoute` in the §C bounded-authority regex |
| `app/lib/auth/__tests__/b16-0-22-tranche15-confinement-gate.test.ts` | updated: closed-enum now 2 members; the two exact adopters (replacement-authority + sign-in) |
| `app/lib/auth/__tests__/b16-0-2-mode-diagnostics.test.tsx` | migrated sign-out env injection from the raw 2nd arg to `vi.stubEnv` |
| `artifacts/ai-control-plane-b16-0-7/route-wrapper-matrix.csv` | regenerated: 150/3/0 |
| `artifacts/ai-control-plane-b16-0-24/*` | this stage's 25 artifacts |

Nothing was deleted that carried behavior; no security test was weakened or
skipped. The chat route's rich body validation, trace machinery, and streaming
protocol are unchanged; only its boundary moved into the wrapper.
