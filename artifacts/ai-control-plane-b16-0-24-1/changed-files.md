# B16.0.24.1 — files changed by THIS stage

## Production

| file | change |
|---|---|
| `app/api/simulate/route.ts` | §1 — `readFile` import → `open`/`FileHandle`; NEW `readBoundedRawFile` (handle, stat fast-fail, 64 KiB chunked, actual-read cap, fatal UTF-8, close-every-path); the POST callback replaces the buffered-slice read with the bounded reader and three explicit refusal envelopes (over-limit NEW, invalid-utf8 deterministic, unreadable = historical no-output-file) |
| `app/lib/auth/mode.ts` | §2 — NEW `AuthRuntimeProjection` + `projectAuthRuntime` (frozen three-field least-privilege projection; exact historical `??` key selection) |
| `app/lib/auth/route-handlers.ts` | §2 — `exposeEnvironment`/`input.environment` REMOVED; `exposeAuthRuntime`/`input.authRuntime` added (per-request `projectAuthRuntime(opts.environment ?? process.env)`) |
| `app/api/auth/signout/route.ts` | §2 — consumes the projection (`{ mode, supabaseUrl, supabaseKey }`); no `process.env`, no `resolveAuthMode` import needed |

## Tests / gates

| file | change |
|---|---|
| `app/api/__tests__/b16-0-24-1-security-correction.test.ts` | NEW — 22 tests: 9 §1 bounded-read (unit + source gate), 4 §2 projection/sentinel, 9 §3 fake-SSR (callback/sign-in/sign-out) |
| `app/api/__tests__/b16-0-24-tranche-parity.test.ts` | fs seam upgraded to a fake HANDLE (`open`/stat/read/close) serving `fsState.raw`; + 2 route-level bounded pins (over-ceiling explicit 500; exactly-at-ceiling 200) |
| `app/lib/auth/__tests__/b16-0-24-tranche17-confinement-gate.test.ts` | sign-out gate updated: pins `exposeAuthRuntime`, absence of `exposeEnvironment` (route + wrapper), no `process.env` in the route, `extra.authRuntime = projectAuthRuntime(` in the wrapper |
| `app/lib/auth/__tests__/b16-0-2-mode-diagnostics.test.tsx` | comment updated to describe the projection (assertions unchanged) |

## Artifacts

| file | change |
|---|---|
| `artifacts/ai-control-plane-b16-0-24/{README, simulate-process-security-proof, simulator-output-and-cleanup-proof, signout-session-retirement-proof, signin-credential-boundary, auth-callback-security-proof, final-verdict, unknowns-and-owner-decisions}.md` | supersession notes APPENDED (historical text preserved) |
| `artifacts/ai-control-plane-b16-0-24-1/*` | this stage's 9 artifacts |

No route classification changed (inventory sha1s identical to B16.0.24); no
security test was weakened or skipped; nothing deleted carried behavior.
