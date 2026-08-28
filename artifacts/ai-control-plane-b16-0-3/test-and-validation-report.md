# Test & validation report (B16.0.3)

## Full suite (final)
`npx vitest run` → **3220 passed / 0 failed / 20 skipped** across 358 files
(355 passed / 3 skipped files). The run reports one vitest-worker
`Timeout calling "onTaskUpdate"` — an IPC telemetry timeout with ZERO attached
test failures (0 failed), the same harness artifact documented in B16.0.1/2.

## Pre-edit reproductions
One disposable probe drove the REAL `POST /api/replacement-authority` with an
instrumented source factory and proved the source was resolved for an
explicitly unauthenticated caller (503, never 401/403; cross-origin also 503).
R2/R3/R5 were reproduced statically; R4's six-case Kleene evaluation showed
cases 1–3 = UNKNOWN → passing. All recorded in
`pre-edit-counterexamples.md`; the probe was deleted; every finding is now a
permanent regression test.

## New B16.0.3 suites (32 tests, all green)
- `b16-0-3-boundary-gate` (11) — structural analyzer positives + the four
  mandated negative tripwires + mention-only hardening (string/type/shadow/
  dead-code) + the real route's positive pin.
- `b16-0-3-effective-classification` (4) — truthful replacement-authority row;
  connective durable-call→annotation check over every route file; non-vacuity.
- `b16-0-3-bom-ownership-check` (5) — six-value truth table (old form as
  regression witness) + schema/migration parity.
- `b16-0-3-route-auth` (12) — the §E matrix against the real handler: 401/403
  with ZERO body pulls and ZERO source/facts resolutions; role/revoked/foreign/
  smuggle refusals; trusted scope reaching the source exactly; 503 only after
  authorization; nonce behaviour intact.

## Regression sweeps (all green)
- Gates + registry: `b16-0-2-gates` (19 — now exception-free structural),
  `action-registry`, `b16-0-auth-route-coverage` — 65 tests green combined
  with the new suites.
- `app/lib/project` + `app/lib/auth` + `app/api/auth` + `app/api/bom` +
  `app/api/replacement-authority`: 317/318 → the single miss was the
  DOCUMENTED chat dynamic-import lifecycle flake (5011 ms vs a 5 s cap under
  concurrent load).
- `app/lib/engineering` + `app/api/chat` (B12–B15 proposal/approval/apply/
  replay/import-boundary + the B14 route suites): **853/853**.
- B14 replacement suites specifically re-run after the §A change:
  b14-1 production-integration, b14-2 settlement/boundaries, b14-3
  stream-lifecycle/gates, b16-0-1-replacement-authorization,
  b14-route-replacement — all green.

## The one REAL regression found and fixed during validation
The first full-suite run failed 5 tests in
`app/api/chat/__tests__/b14-route-replacement.test.ts` — that suite drives
`REAUTH_POST` directly and predated the authentication requirement. It was
updated to authenticate (injected editor + selector headers); its
foreign-tenant/branch case was REWRITTEN as the stronger authenticated
scope-mismatch case (same core assertion: the durable loader is NEVER called).
This was treated as a functional failure and fixed — not classified as a flake.

## Flake discipline (per the mandate: repeated isolated runs + wall-clock-only
## assertions required)
- `b16-0-ai-approval-lifecycle` test 22/23 (5 s cap): **3/3 isolated green**
  at 2.1 s / 2.7 s / 2.9 s; the in-band failure was 5011 ms under full load.
  The assertion that fails is the vitest test timeout only.
- `route-tool` "500 tracks" perf: **3/3 isolated green** at 4.30 s / 4.18 s /
  4.19 s vs its 5 s wall-clock budget; in-band failure 5024 ms.
- `auto-place`, `pcb-repair-agent`, `b15-2-1-residual-closure`,
  `b14-3 §E` (import-walker timeout): green when run outside the 14-worker
  full-load window; all are wall-clock/timeout-bounded assertions. The FINAL
  full-suite run passed all of them (3220/0), so no failure stands anywhere.
- No budget, gate, schema, or assertion was loosened to obtain green.

## Static checks
- `tsc --noEmit` — clean.
- Scoped ESLint on every changed file — clean (one PRE-EXISTING
  `no-assign-module-variable` error in the gate file was fixed by a pure
  rename, required because the file was edited this stage).
- `git diff --check` — clean (pre-existing CRLF advisories only).
- All four artifact generators run twice → sha1-identical outputs
  (b16-0-2 classification, b16-0-1 exact-policy, b16-0 auth-route-coverage,
  b01 route-coverage/toolability).

## Constraints honoured
No provider credits spent; no live database contacted or migrated; no Drizzle
metadata invented; no security test weakened, deleted, skipped, or rewritten
to obtain green (the three test-file updates ADD authentication and keep every
prior assertion or strengthen it).
