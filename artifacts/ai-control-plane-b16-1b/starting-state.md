# B16.1B §A — starting state

| item | value | label |
|---|---|---|
| repository | `C:\Users\robsa\Desktop\sirkit-edit` (the protected `C:\Users\robsa\sirkit` was never opened for writing) | CONFIRMED |
| `origin/main` at issuance | `0193e5fcac8009bd0aba88dc83958fab3aaa5d90` — exactly the SHA the mandate named; no new commits to inspect | CONFIRMED |
| worktree before editing | clean (`git status --porcelain` empty) | CONFIRMED |
| fetch | `git fetch origin` — fast-forward only; local `main` == `origin/main` | CONFIRMED |
| implementation branch | `integration/b16-1b-production-auth`, created from `0193e5f` (NOT the history-reconstruction branch) | CONFIRMED |
| git identity | `Dandi Desta <dandidesta82@gmail.com>` (GitHub-linked to `dantdani`, proven in B16.1A) | CONFIRMED |
| commit hygiene | no AI attribution, no co-author trailers, real timestamps, no force-push, no rewrite of `main` | CONFIRMED (applied to every B16.1B commit) |

## Installed versions (recorded, not upgraded)

| package | version | note |
|---|---|---|
| `@supabase/ssr` | 0.12.4 | exact pin in `package.json` |
| `@supabase/supabase-js` | 2.112.3 | exact pin |
| `@supabase/auth-js` | 2.112.3 | nested dependency of supabase-js (GoTrueClient) |
| `next` | 16.2.6 | `proxy.ts` is the renamed middleware |
| `react` / `react-dom` | 19.2.4 | |
| `drizzle-orm` / `drizzle-kit` | see `configuration-readiness.md` versions table | RLS helpers (`pgPolicy`, `enableRLS`, `drizzle-orm/supabase`) present |
| `postgres` | 3.4.9 | the durable DB driver |
| `vitest` | 3.2.6 | |
| Node / pnpm | v24.15.0 / 11.2.2 | |

No dependency was upgraded: no reproduced incompatibility required it.

## Prior evidence read (§A rule 1)

`artifacts/ai-control-plane-b16-0`, `-b16-0-1`, `-b16-0-2`, `-b16-0-24`, `-b16-0-24-1`, `-b16-1a` — every markdown/csv file, plus the auth module sources (`app/lib/auth/*`), the three auth routes, `proxy.ts`, `drizzle/0027_project_membership.sql`, `drizzle/meta/_journal.json`, and the installed SDK sources. The consistent prior position was: every auth CONFIRMED label was static or fake-client; LIVE Supabase behaviour UNKNOWN; migration 0027 "owner-applied MANUAL migration, drizzle-kit registration owner-gated" (B16.0.3); session liveness, revocation propagation, and RLS parity never addressed by any stage.

## Migration journal state at start

`drizzle/meta/_journal.json` registers entries 0000–0026 only; `0027_project_membership.sql` and `0028_bom_project_ownership.sql` are NOT journal-registered (unchanged by this stage — see `membership-and-rls-proof.md`).
