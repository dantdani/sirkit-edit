# B16.0 — the trusted request context

> **SUPERSEDED IN PART (B16.0.1, 2026-08-21).** "Trusted production identity
> proven" was an overclaim: the resolver worked, but the chat surface DISCARDED
> its result (the agent still ran as the hard-coded local owner, R3), 74
> routes never called it (R5), role sufficiency was unchecked (R1), CSRF was
> not wired into any production caller (R2), and production could resolve
> local_dev via the missing-host path (R7). Live Supabase behavior remains
> UNKNOWN (R9). B16.0.1 wires the resolver into every sensitive route through
> the exact route-policy adapter and threads the verified principal to the
> agent runtime and every sealed proposal.

## The one server-derived identity

`app/lib/auth/trusted-request-context.ts` exports the single authority
`resolveTrustedRequestContext(request, options)`, returning a
`TrustedRequestContext` with SERVER-DERIVED: `principalId`, `tenantId`,
`projectId`, `branchId`, `actor` (EngineeringActor — role and kind derived,
not from a header), `sessionIdentity`, `authMethod`, `authStrength`,
`membershipRevision`, and `correlationId`. It carries no token, cookie, or
secret (a permanent test asserts a `sb-access-token` cookie value never
appears in the serialized context).

## The call graph

```
resolveTrustedRequestContext(request)
  ├─ sensitiveOperationsBlocker(env)      # production w/o auth configured → 403
  ├─ requireSameOrigin(request)            # (production, enforceSameOrigin) CSRF → 403
  ├─ resolveIdentityProvider().verify()    # → VerifiedPrincipal | null
  │     • production: SupabaseIdentityProvider (getClaims, JWT-verified)
  │     • local_dev:  LocalDevIdentityProvider (fixed principal)
  │     • tests:      injected fake
  │   └─ null → 401 (missing / expired / invalid)
  ├─ selector = headers(x-sirkit-{tenant,project,branch}-id) | options.selector
  │   └─ empty/malformed project → 400
  ├─ resolveMembershipRepository().loadActiveMembership(tenant, project, principal)
  │     • production: PostgresProjectMembershipRepository (project_members)
  │     • local_dev:  LocalDevProjectMembershipRepository (admin on any project)
  │     • tests:      injected fake
  │   └─ null (missing / revoked / cross-tenant / cross-project) → 403
  ├─ projectRoleFromMembership(role)       # closed table → ProjectRole | null(403)
  └─ actor = { actorId: principal, actorKind: "human", role, sessionId }
```

Rules enforced:
- Client headers may REQUEST a project/branch selector; they never establish
  identity, actor kind, role, or membership.
- Browser/session principals are ALWAYS `actorKind: "human"` here. AI actors
  are minted internally, only after a verified human request enters the agent
  boundary. Worker identity uses `verifyWorkerSecret` on a SEPARATE boundary
  (`actorKind: automated_engine`) and can never mint a human actor.
- Missing / expired / malformed identity → 401. Missing / inactive / foreign
  / insufficient membership → 403. Production without configured auth → 403.

## The migrated release perimeter

The three sensitive `_scope.ts` chokepoints now derive identity from the
resolver (return shape `{tenantId, projectId, branchId, actor}` unchanged, so
downstream engines are untouched):

- `app/api/pcb-sync/_scope.ts` → `/api/pcb-sync`, `/api/pcb/qualify`,
  `/api/pcb/release`
- `app/api/physical-bindings/_scope.ts` → `/api/physical-bindings`
- `app/api/assignment-queue/_scope.ts` → `/api/assignment-queue`

`/api/chat` (provider-credit) additionally calls the resolver directly: a
verified principal with an active membership is required; it already read no
identity headers and refuses body authority claims.

## What remains on the legacy header path (documented backlog)

The CD-stage propose/compute `_scope.ts` files (calculation, architecture,
interfaces, power, requirements, circuit-*, component-selection,
schematic-compiler, model-simulation, firmware-bringup, release-engineering,
full-flow, mapping-verification, footprint-resolution, passive-policy) still
read `x-sirkit-*` identity headers — a labelled local-dev convenience,
classified `legacy-header-scope` in `auth-route-coverage.csv`. The CI
forbidden-header gate pins this set: a NEW route reading a forbidden identity
header OUTSIDE the backlog fails the build. See
[migration-and-rollback.md](migration-and-rollback.md).
