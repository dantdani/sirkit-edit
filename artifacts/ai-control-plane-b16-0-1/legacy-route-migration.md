# B16.0.1 §A — legacy route migration (legacy-header-scope → 0)

## The model

ONE exact, method-aware policy table (`app/lib/auth/route-policy.ts`) with one
explicit row per (path, method) — 153 rows over 142 route files — and ONE
enforcement adapter (`app/lib/auth/authorize.ts`):

1. `authorizeRequest(request)` derives pathname+method from the request itself,
   looks up the exact policy (dynamic `[segment]` wildcards supported), and
   enforces in order: same-origin CSRF (automatic for authenticated non-GET,
   production-gated inside the resolver), server-derived identity + ACTIVE
   membership (`resolveTrustedRequestContext`), then the row's exact permitted
   roles / required capability. A route/method with NO row fails closed
   (500 `AUTH_POLICY_MISSING`).
2. `scopedTrustedJson` adds media-type, byte-ceiling, JSON-object, and
   forbidden-authoritative-key validation for the `_scope.ts` families.

## What migrated (identity-header reads → 0)

- **15 `_scope.ts` families** (pcb-sync, physical-bindings, assignment-queue,
  calculation, component-selection, circuit-knowledge, circuit-verification,
  schematic-compiler, model-simulation, firmware-bringup, release-engineering,
  full-flow, mapping-verification, footprint-resolution, passive-policy) — all
  now call `authorizeRequest`/`scopedTrustedJson`; role + CSRF are automatic
  per-route (a request through a shared scope helper gets ITS OWN path's
  policy, so `/api/pcb/release` demands `project_admin` even though it shares
  the pcb-sync chokepoint).
- **19 inline CD-stage routes** (architecture ×5, interfaces ×6, power ×6,
  requirements ×2) — header reads replaced with the trusted context; the
  synthetic AI actor's sessionId now comes from the verified session.
- **13 provider-credit AI routes** (pcb/edit/assist, pcb/repair/agent,
  pcb/assign/suggest, pcb/ai-rules/from-brief, schematic ×8, spice/ai) — were
  fully PUBLIC; now require an authenticated editor-class member before any
  credit is spent.
- **5 local-store state-changing routes** (bom/snapshot, bom/notifications,
  spice/runs, spice/runs/[id], spice/models/import) — were `identity_source=
  none` writes; now authenticated mutations (their per-project membership
  scoping of the projectKey remains future work — see
  migration-and-rollback.md).
- **Auth boundary** (§H): signin/signout/callback carry accurate public+CSRF
  rows (sign-in can never require prior authentication).
- **Workers** (assignment-queue/materialize, /revalidate, engineering-effects)
  stay on the constant-time worker-secret boundary (never a human actor).

## Proof

- `b16-0-1-ci-gates.test.ts`: route↔policy bijection in BOTH directions over
  the live filesystem; zero identity-header reads in production `app/api`
  (with a synthetic tripwire); `legacy-header-scope` count pinned at ZERO and
  the B16.0 backlog constant pinned EMPTY; unclassified-path tripwires.
- `b16-0-1-route-authorization.test.ts`: role + CSRF enforcement through the
  real adapter with injected identities.
- The committed `exact-route-authorization-policy.csv` is byte-pinned to the
  renderer.

## Supersession

The B16.0 coarse prefix model in `app/lib/auth/route-coverage.ts` now DERIVES
from the exact policy table (see the module's supersession note);
`artifacts/ai-control-plane-b16-0/auth-route-coverage.csv` was regenerated —
zero `legacy-header-scope`, zero `demo-deprecated` rows remain.
