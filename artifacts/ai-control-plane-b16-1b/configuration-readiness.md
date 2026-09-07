# B16.1B §A/§D — configuration readiness (names and states only; never a value)

## Environment variables (shell of the qualification session)

| variable | state |
|---|---|
| `SIRKIT_AUTH_MODE` | absent |
| `NEXT_PUBLIC_SUPABASE_URL` | absent |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | absent |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ACCESS_TOKEN` / `SUPABASE_DB_PASSWORD` | absent |
| `DATABASE_URL` / `SIRKIT_DATABASE_URL` / `POSTGRES_URL` | absent |
| `SIRKIT_EXPECTED_ORIGIN` | absent |
| `SIRKIT_LIVE_AUTH_QUALIFICATION` | absent |
| `SIRKIT_AUTH_QUALIFICATION_PROJECT` (isolated-project marker) | absent |
| `SIRKIT_AUTH_QUALIFICATION_EMAIL` / `_PASSWORD` / `_PROJECT_ID` / `_BASE_URL` / `_DATABASE_URL` | absent |

## `.env.local` (git-ignored, untracked; key names only)

| key | state |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | present (url-shaped, `*.supabase.co`, 20-character project ref) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | present (`sb_publishable_…` class) |
| `DATABASE_URL` | present (Supabase session-pooler URL shape) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, distributor keys, `SIRKIT_PCB_SYNC_STAGE3` | present — irrelevant to this stage; never read by any B16.1B probe or test |
| `SIRKIT_EXPECTED_ORIGIN`, `SIRKIT_AUTH_MODE`, service-role key, any qualification variable | absent |

Git safety: `.gitignore` has `.env*` with `!.env.example`; only `.env.example` is tracked. No `.env*`, cookie jar, captured header, or raw provider response was ever staged.

## Live reachability of the configured project (read-only probes, 2026-09-07)

| probe | result | label |
|---|---|---|
| general internet from the session | `HEAD https://supabase.com/` 200, `github.com` 200, `registry.npmjs.org` 200 | CONFIRMED |
| DNS for the configured project host `<ref>.supabase.co` | `ENOTFOUND` — from the tool sandbox AND from a plain PowerShell `Resolve-DnsName` | CONFIRMED |
| DNS for the `supabase.co` zone | resolves (14 NS records) | CONFIRMED |
| `GET <url>/auth/v1/health` / `/settings` / `/.well-known/jwks.json` | transport failure (`getaddrinfo ENOTFOUND`) — no HTTP response at all | CONFIRMED |
| database via the configured pooler URL | pooler host resolves; connection refused by the pooler with `XX000` "tenant/user … not found" | CONFIRMED |

Conclusion: the Supabase project referenced by the local configuration does not exist at that reference any more (a paused project still resolves in DNS; a deleted or mistyped reference does not, and the pooler does not know the tenant). There is therefore **no reachable Supabase project of any kind**, let alone an explicitly isolated one, and:

- the JWKS key family of the real project (asymmetric ES256/RS256 vs legacy HS256) is **UNKNOWN** — both branches are covered by tests and the liveness boundary is correct under either;
- whether "Allow new users to sign up" is disabled on the real project is **UNKNOWN** (the settings endpoint is unreachable) — the application itself exposes no signup surface (pinned);
- whether migration `0027_project_membership.sql` is applied to any live database is **UNKNOWN** — read-only structural checks could not run;
- no dedicated qualification account and no isolated admin/service credentials were supplied, so none could be used or provisioned (rule 10 forbids substituting fakes).

Verdict for §D: **BLOCKED-LIVE-QUALIFICATION** (external cause). Every offline and read-only verification that was possible was completed; see `live-auth-qualification-matrix.md` for the precise owner unblock steps.

## Versions used by the parity checks

| package | installed |
|---|---|
| `drizzle-orm` | 0.45.x (declared `^0.45.2`; `pgPolicy`, `enableRLS`, `drizzle-orm/supabase` roles present) |
| `drizzle-kit` | 0.31.x (declared `^0.31.10`; `entities.roles.provider = "supabase"` supported) |
