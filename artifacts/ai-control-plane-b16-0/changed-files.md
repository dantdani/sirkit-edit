# B16.0 — changed files

## New auth core (`app/lib/auth/`)
- `types.ts` — `TrustedRequestContext`, auth method/strength, refusal shape.
- `mode.ts` — `resolveAuthMode` / `localDevAllowed` / `sensitiveOperationsBlocker`.
- `project-membership.ts` — membership model, role mapping, in-memory + local-dev repos, revision.
- `postgres-membership.ts` — production membership repository.
- `identity-provider.ts` — provider-neutral `IdentityProvider`, local-dev + Supabase adapters, `createSupabaseClaimsVerifier`.
- `identity-runtime.ts` — injectable identity + membership seams (set/reset factories).
- `request-security.ts` — same-origin CSRF, content-type, size, open-redirect, 401/403.
- `constant-time.ts` — constant-time secret compare.
- `worker-principal.ts` — worker/service secret → machine principal (never human).
- `trusted-request-context.ts` — the ONE resolver.
- `route-coverage.ts` — auth-route coverage registry + CSV renderer.
- `supabase-server.ts` — SSR server client + `updateSession` (production wiring).
- `test-support.ts` — deterministic identity/membership injection (test-only).

## New UI + wiring
- `app/components/auth/LocalDevIdentityBanner.tsx` — visible local-dev banner.
- `app/layout.tsx` — mounts the banner.
- `proxy.ts` — Supabase SSR token-refresh proxy (repo root).
- `app/api/auth/signout/route.ts` — minimal sign-out boundary.

## DB
- `app/lib/db/schema.ts` — `projectMembers` table + inferred types.
- `drizzle/0027_project_membership.sql` — migration + RLS policy + rollback.

## Migrated release perimeter (server-derived identity)
- `app/api/pcb-sync/_scope.ts` — `pcbSyncScope`/`scopedPcbSyncJson` now async, derive identity.
- `app/api/pcb-sync/route.ts`, `app/api/pcb-sync/handler.ts` — await the async scope.
- `app/api/physical-bindings/_scope.ts` + `route.ts`.
- `app/api/assignment-queue/_scope.ts` + `route.ts`.
- `app/api/chat/route.ts` — resolves the trusted context (verified principal + membership).

## UI clients (stop asserting identity)
- `app/lib/pcb-sync/client.ts` — sends only the project/branch SELECTOR.
- `app/components/pcb/PcbEditor.tsx` — drops hard-coded actor/role from the sync client, `bindingHeaders`, `scopeHeaders`.
- `app/components/pcb/AssignmentQueuePanel.tsx` — drops identity headers.

## Registry / artifacts
- `app/lib/engineering/action-registry.ts` — `auth.signout` record + `/api/auth/signout` route entry.
- `scripts/generate-b16-0-artifacts.ts` — new generator.
- `artifacts/ai-control-plane-b16-0/auth-route-coverage.csv` — new (139 routes).
- Regenerated `artifacts/ai-control-plane-b01/{api-route-coverage,ui-command-toolability-matrix}.csv`, `ui-control-fingerprint.json`.

## Dependencies (locked exact)
- `package.json` — `@supabase/ssr` 0.12.4, `@supabase/supabase-js` 2.112.3 (+ `pnpm-lock.yaml`).

## New tests
- `app/lib/auth/__tests__/b16-0-trusted-request-context.test.ts` (20)
- `app/lib/auth/__tests__/b16-0-ai-approval-lifecycle.test.ts` (5)
- `app/lib/auth/__tests__/b16-0-local-dev-and-csrf.test.tsx` (4)
- `app/api/__tests__/b16-0-identity-header-gate.test.ts` (6)
- `app/api/__tests__/b16-0-auth-route-coverage.test.ts` (3)

## Updated tests (migration semantics)
- `app/api/pcb-sync/__tests__/route.test.ts`, `app/api/assignment-queue/__tests__/_scope.test.ts`, `app/lib/physical-binding/__tests__/shadow-sync-api-migration.test.ts`.

## Not touched
The manufacturing release ENGINE/gate, the 12 exposed tools, the B12/B14/B15
approval boundaries, and the 12 unmigrated CD-stage `_scope.ts` files (legacy
header path — documented backlog). Protected original `C:\Users\robsa\sirkit`
at its 6-entry baseline.
