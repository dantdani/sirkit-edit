# B16.0.1 — Pre-edit counterexamples (R1–R9)

Every counterexample was reproduced against the pre-edit tree before any fix
was written. R1/R3/R7 were captured with a disposable vitest probe
(`b16-0-1-probe.test.ts`, deleted after capture); the others are structural
facts established by direct code/artifact inspection. Classification per the
stage vocabulary.

## R1 — a viewer reaches the release scope (CONFIRMED)

Probe: `resolveTrustedRequestContext` with an injected **viewer** membership
against a release-scoped request resolved `{"resolved":true,"role":"viewer"}` —
identity resolution succeeded and NO role gate existed between the resolved
context and the release/qualification handlers. B16.0 checked membership
EXISTENCE, not role sufficiency, and `enforceSameOrigin`/role enforcement were
not applied per-route.

Closure: exact per-route role sets in `app/lib/auth/route-policy.ts`
(`/api/pcb/release` = `project_admin` ONLY; `/api/pcb/qualify` =
`pcb_editor|project_admin`), enforced by `authorizeRequest` →
`authorizeActor` BEFORE any downstream authority load. Permanent regression:
`app/lib/auth/__tests__/b16-0-1-route-authorization.test.ts` (viewer → 403
`AUTH_ROLE_DENIED` on release, qualify, pcb-sync, physical-bindings,
assignment-queue, requirements/sources; editor refused on release; admin
passes).

Note: release is gated by ROLE, deliberately NOT by the `export_project`
capability — `ROLE_CAPABILITIES` grants `export_project` to viewers and
commenters, so a capability gate would have been a fail-open trap.

## R2 — the CSRF helper was connected to no production caller (CONFIRMED)

`enforceSameOrigin`/`requireSameOrigin` existed (B16.0) but `grep` showed no
production route invoked it on the cookie-authenticated mutation paths; the
manual call in assignment-queue was the single exception. Closure: the policy
table marks `requiresCsrf` on every authenticated non-GET/HEAD row and
`authorizeRequest` enforces it automatically (`enforceSameOrigin:
policy.requiresCsrf` through the trusted resolver; worker and public rows with
`requiresCsrf` enforce it directly in the adapter). Regression:
`b16-0-1-route-authorization.test.ts` (production-mode cross-origin/origin-less
POST → 403 even for an admin) and
`app/api/chat/__tests__/b16-0-1-chat-authorization.test.ts` (cross-origin chat
→ 403 with NO run id issued, i.e. before any provider call).

## R3 — the verified principal was discarded by the agent assembly (CONFIRMED)

Probe: `assembleAgentRunContext` returned
`{"actorId":"local-user","actorRole":"project_admin","source":"local-only"}`
regardless of the trusted context the chat route had resolved — the B16.0
`resolveTrustedRequestContext` call's result was dropped on the floor and
`createLocalOnlyActor()` was unconditional.

Closure: `VerifiedRunPrincipal` threading (`verifiedActor` input →
`buildRunActor`), the chat route projects
`{principalId, actor.role, membershipRevision, authMethod}` from the trusted
context into BOTH assembler calls. Regression:
`app/lib/agent/__tests__/b16-0-1-verified-actor.test.ts`.

## R4 — the membership revision was not load-bearing (CONFIRMED)

`membershipRevision` existed on `TrustedRequestContext` (B16.0) but appeared
nowhere in `AgentRunContext`, any sealed proposal family, any approval intent,
the journals, receipts, or the apply paths — grep-verified absence. A
membership revoked after sealing could not stop the sealed proposal from
applying.

Closure: §E authorization bindings in all three sealed families + §F apply-time
reauthorization + journal/receipt/intent binding (see
`proposal-membership-binding.md` and `apply-time-reauthorization.md`).
Stop-condition regression: `b16-0-1-apply-reauthorization.test.ts` (the full
denial matrix with ZERO mutation and ZERO journal prepare).

## R5 — 74 routes on legacy-header-scope (CONFIRMED)

The B16.0 `auth-route-coverage.csv` recorded 74 routes with
`identity_source=legacy-header-scope` (60 propose / 7 mutation / 7 read), each
reading `x-sirkit-actor-id`/`x-sirkit-role`/`x-sirkit-actor-kind` as identity.

Closure: every family migrated to `authorizeRequest`/`scopedTrustedJson`;
production `app/api` now contains ZERO reads of any identity header
(`b16-0-1-ci-gates.test.ts` pins the count at zero with a synthetic-injection
tripwire; the B16.0 gate's backlog constant is now the EMPTY list).

## R6 — the CI gate legitimized whole legacy prefixes (CONFIRMED)

`LEGACY_HEADER_SCOPE_PATH_PREFIXES` allowlisted 16 whole route families; any
new header-reading route beneath them passed CI. Closure: the list is pinned
EMPTY, coverage derives from the exact per-route policy table, and the §I gate
adds path+method-exact classification with negative tripwires
(`/api/calculation/evil` → no policy → 500 `AUTH_POLICY_MISSING`).

## R7 — production could enter local-dev admin mode (CONFIRMED)

Probe: `resolveAuthMode` with a missing deployment host resolved
`local_dev` (`{"missingHost":"local_dev","loopbackHost":"local_dev",
"allowedMissingHost":true}`) — a production deployment with an unset host
variable silently granted the fixed local admin. Closure (§G): `mode.ts`
resolves `production` FIRST whenever `isProductionRuntime`; `SIRKIT_AUTH_MODE`
and host headers can never downgrade it; the host-based escape hatch was
removed. Regression: `b16-0-trusted-request-context.test.ts` item 18
(updated, stricter) + mode-combination negatives.

## R8 — production login incomplete (CONFIRMED)

No sign-in page, no sign-in action, no PKCE callback existed; only sign-out.
Closure (§H): `POST /api/auth/signin` (existing accounts, uniform 401, no
enumeration), `GET /api/auth/callback` (PKCE `exchangeCodeForSession`,
open-redirect-safe), `app/signin/page.tsx`, NO signup endpoint (gated).
Regression: `app/api/auth/__tests__/b16-0-1-signin.test.ts`.

## R9 — live production auth unproven (UNKNOWN — deliberately kept)

No live Supabase project or test user is available in this environment. Every
Supabase-side behavior (real JWT verification, real membership rows, real
cookie rotation) remains classified **UNKNOWN**; the identity logic is proven
against injected fakes only. This stage does NOT claim live production
authentication was tested.
