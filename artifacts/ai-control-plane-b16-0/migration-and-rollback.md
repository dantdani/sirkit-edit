# B16.0 — migration and rollback

## Route migration status

`auth-route-coverage.csv` classifies all 139 routes. Identity sources:

- **trusted-context** (migrated, server-derived): `/api/pcb-sync`,
  `/api/pcb/qualify`, `/api/pcb/release`, `/api/physical-bindings`,
  `/api/assignment-queue` — the release perimeter.
- **body-scope-server-actor** (already server-derived): `/api/chat`,
  `/api/replacement-authority`, `/api/auth/signout`.
- **worker-secret**: `/api/assignment-queue/materialize`,
  `/api/assignment-queue/revalidate`, `/api/engineering-effects`.
- **legacy-header-scope** (documented backlog — NOT yet migrated): the
  CD-stage `_scope.ts` families (calculation, architecture, interfaces, power,
  requirements, circuit-*, component-selection, schematic-compiler,
  model-simulation, firmware-bringup, release-engineering, full-flow,
  mapping-verification, footprint-resolution, passive-policy). These read
  `x-sirkit-*` identity headers as a labelled local-dev convenience. The CI
  forbidden-header gate pins this backlog: it may only SHRINK, and a NEW route
  reading a forbidden identity header outside it fails the build.
- **none**: public catalog/compute reads and a few latent state-changing
  routes (`bom/*`, `spice/*`, AI `pcb/*`, `schematic/*`) flagged for a future
  policy pass.

## DB migration

Apply `drizzle/0027_project_membership.sql` (idempotent `IF NOT EXISTS`),
which creates `project_members`, its unique index, lookup index, CHECK
constraints, and the RLS `SELECT` policy. Rollback SQL is in the file's DOWN [B24-closeout, 2026-10-10] superseded: B24-A4's record, artifacts/ai-control-plane-b24/database-and-recovery.md:399.
section (drop policy, disable RLS, drop indexes, drop table). No existing
table is altered; the migration is purely additive.

## Deployment (production auth)

1. Install the locked Supabase packages (already in `package.json`).
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   (browser-safe), the secret key (server-only, never `NEXT_PUBLIC_`), and
   `SIRKIT_AUTH_MODE=production` (+ `NEXT_PUBLIC_SIRKIT_AUTH_MODE=production`
   to hide the banner).
3. `proxy.ts` refreshes tokens; provision `project_members` rows out-of-band
   (no public grant endpoint).
4. Without config, production fails closed (sensitive routes 403).

## Rollback

- Set `SIRKIT_AUTH_MODE` unset / non-production ⇒ local_dev (frictionless).
- To fully revert: delete `app/lib/auth/`, `proxy.ts`, `app/api/auth/`, the
  banner + layout mount, restore the three migrated `_scope.ts` files and the
  UI clients from git, drop the `project_members` migration, remove the two
  Supabase deps. The release engine and the 12 tools are untouched, so
  reverting cannot affect PCB/schematic/manufacturing semantics.

## Known follow-ups
- `scripts/e2e-prompt-to-gerber.ts` self-asserts `x-sirkit-*` identity — it
  must move to the local_dev path or a test bypass before running against the
  migrated routes (not part of the test suite).
