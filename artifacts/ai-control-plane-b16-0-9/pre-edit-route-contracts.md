# B16.0.9 — Pre-edit route contracts (pinned before migration)

All 17 tranche-2 methods share ONE boundary class (verified in source before
editing): `authorizeRequest` (session identity + membership + role + exact
policy + production same-origin CSRF) → unreachable kind-guard 401 →
`readBoundedJsonObject(request, { maxBytes: 8_000_000, deadlineMs: 30_000 })`
(415 media / 400 JSON / 413 ceiling / 408 deadline from the shared reader) →
business logic on `context` + parsed body.

The pin suite
([`b16-0-9-tranche-parity.test.ts`](../../app/api/__tests__/b16-0-9-tranche-parity.test.ts),
**111 pins**) ran GREEN against the PRE-migration handlers, then stayed green
after migration. Per method: anonymous → 401 `AUTH_UNAUTHENTICATED` with ZERO
body pulls; production cross-origin → 403 with ZERO pulls; text/plain → 415
`AUTH_MEDIA_TYPE_UNSUPPORTED` with ZERO pulls; malformed JSON → 400
`AUTH_INVALID_JSON`; oversized (8 MB + 1) → 413 `AUTH_PAYLOAD_TOO_LARGE`; the
route's own post-boundary refusal with EXACT status + public error string:

| Method | Own refusal pinned |
|---|---|
| architecture/alternatives | 403 "architecture alternative scope mismatch" |
| architecture/candidates | 403 "architecture candidate scope mismatch" |
| architecture/compare | 403 "candidate scope mismatch" |
| architecture/problem | 403 "architecture problem scope mismatch" |
| architecture/propose | 403 "architecture proposal scope mismatch" |
| power/alternatives | 403 "power alternative scope mismatch" |
| power/candidates | 403 "power candidate scope mismatch" |
| power/compare | 403 "at least two same-project candidates are required" |
| power/problem | 403 "power problem scope mismatch" |
| power/propose | 403 "power proposal scope mismatch" |
| power/reconcile | 403 "candidate scope or expansions invalid" |
| interfaces/allocate | 400 "candidate, exact fact snapshot, and resource requirements are required" (this route performs NO body-scope check — historical behavior preserved, not "fixed" silently) |
| interfaces/alternatives | 403 "interface alternative scope mismatch" |
| interfaces/candidates | 403 "interface candidate scope mismatch" |
| interfaces/compare | 403 "at least two same-project candidates are required" |
| interfaces/problem | 403 "interface problem scope mismatch" |
| interfaces/propose | 403 "interface proposal scope mismatch" |

Provider-bound methods additionally pinned (fake `llmRouter` adapter, zero
credits): integrity-422 with diagnostics arrays and ZERO provider calls; valid
digest-valid fixture problems + REAL synthesized proposals → deterministic 200
with exactly-once `generate`, requested-provider routing (`provider:
"anthropic"` echoed in the call argument AND the `X-Sirkit-AI-Provider`
header), `Cache-Control: no-store`; provider failure → normalized 503 with
exactly-once invocation.

Discoveries recorded during pinning (current behavior, preserved as-is):

- `validateArchitectureProblem` / `validateInterfacePlanningProblem` THROW on a
  structurally missing problem (absent arrays) — such a body crashes into the
  catch/provider-error path rather than returning integrity-422. The pins use
  minimally-SHAPED problems so the validators run; the throwing behavior on
  shapeless bodies is pre-existing and unchanged by this stage.
- Success paths for the deterministic compilers remain covered by the family
  suites (`app/api/{architecture,power,interfaces}/__tests__` — 141 tests, all
  green pre- and post-migration).

Unreachable branch note: the old handlers' `kind !== "authenticated"` 401 and
the wrapper's `AUTH_UNSUPPORTED_PRINCIPAL` 403 are BOTH unreachable for
session-policy rows — not an observable change (established in B16.0.8).
