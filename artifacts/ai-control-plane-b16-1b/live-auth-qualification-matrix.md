# B16.1B §D — live auth qualification matrix

**Status: BLOCKED-LIVE-QUALIFICATION (external cause).** The Supabase project referenced by the local configuration no longer resolves (DNS `ENOTFOUND` for the project host from two independent resolvers; the regional pooler reports the tenant as not found), no isolated project marker, no qualification account, and no isolated admin credentials were supplied. Rule 10 applies: every offline and read-only verification possible was completed; nothing fake is represented as live.

Labels: **CONFIRMED (real HTTP)** = the REAL Next.js production build (`next build` + `next start`, `NODE_ENV=production`, `SIRKIT_EXPECTED_ORIGIN=http://127.0.0.1:3100`) exercised over loopback with the real `proxy.ts`, wrappers, policy table, and SDK — with the Supabase project unreachable. **CONFIRMED (real SDK, offline)** = the real `@supabase/*` packages with a fetch spy. **BLOCKED** = needs a reachable isolated project and is implemented in the opt-in live test `app/lib/auth/__tests__/b16-1b-live-qualification.test.ts`.

## §D requirements

| requirement | evidence available now | live status |
|---|---|---|
| start the real Next.js app in production auth mode with a loopback expected origin | done twice (pre-fix and post-fix builds), 23-row matrix each | CONFIRMED (real HTTP) |
| use an existing dedicated qualification account / provision only with isolated admin credentials | none supplied; none provisioned | BLOCKED |
| exercise the real `/api/auth/signin` | real HTTP: unknown-account attempt → 401 `AUTH_SIGNIN_FAILED` (provider unreachable) in 25 ms; CSRF 403; media 415; oversize 413 | success path BLOCKED |
| success returns only `{ok:true}` and writes the SSR cookie family without exposing values | fake SSR through the real route (pinned) | BLOCKED live |
| cookie flags and scope | server-owned option set proven with the REAL SSR client; retirement flags observed on real HTTP (`Path=/; Max-Age=0; HttpOnly; SameSite=lax`, Secure absent on loopback http) | set-on-sign-in BLOCKED live |
| cookie jar through a real protected read route with a valid selector and active membership | real SDK (ES256, offline): 200 with `actorId = sub`, role from `project_members` | BLOCKED live |
| actor id from JWT `sub`, role from `project_members`, browser authority headers inert | real SDK offline + real HTTP (forged headers → identical 401 to no-cookie) | BLOCKED live for the 200 path |
| authenticated state-changing route with exact same-origin CSRF and the smallest refusal payload | real HTTP: same-origin POST without a session → 401 (CSRF passed, identity refused); cross-origin / missing / null / spoofed → 403 | BLOCKED live for the authenticated path |
| sign out via the real endpoint, cookie retirement, then 401 | real HTTP: sign-out with a session cookie → 200 `{ok:true, signedOut:true, remoteRevocation:"unconfirmed"}` + retirement cookie; post-retirement request → 401 (no cookie) | remote-confirmed sign-out + replay-after-sign-out BLOCKED live |
| refresh/rotation through `proxy.ts` without logging values | fake SSR through the real `updateSession`; real HTTP shows the proxy retiring a dead session with the right flags | rotation of a live pair BLOCKED |
| wrong-password vs unknown-account byte-equivalence | fake SSR (pinned since B16.0.24.1); real HTTP unknown-account = 401 uniform body | BLOCKED (needs a real account) |
| malformed callback code → safe redirect, no leakage | real HTTP: 303 → `<origin>/signin?error=auth`, no `Set-Cookie`, open-redirect `next` ignored | CONFIRMED (real HTTP) |
| active → revoked membership on the immediately following request | fake repository + real SDK identity | canary BLOCKED |
| foreign tenant/project selectors never return another project's data | real SDK offline: identical 403 | BLOCKED live |

## Real-HTTP matrix — post-fix build (2026-09-07, loopback, provider unreachable)

| # | probe | status | code | no-store | Set-Cookie (name/attrs only) | location | ms |
|---|---|---|---|---|---|---|---|
| 1 | `GET /` (app up, proxy runs) | 200 | – | n/a | none | – | 34 |
| 2 | GET protected: no cookie | 401 | `AUTH_UNAUTHENTICATED` | yes | none | – | 7 |
| 3 | GET protected: forged identity headers | 401 | `AUTH_UNAUTHENTICATED` | yes | none | – | 7 |
| 4 | GET protected: malformed cookie | 401 | `AUTH_UNAUTHENTICATED` | yes | none | – | 5 |
| 5 | GET protected: self-signed ES256 cookie (JWKS unreachable) | 401 | `AUTH_UNAUTHENTICATED` | yes | none | – | 27 |
| 6 | GET protected: HS256 cookie (`/user` unreachable) | 401 | `AUTH_UNAUTHENTICATED` | yes | none | – | 13 |
| 7 | GET protected: expired cookie (refresh unreachable) | 401 | `AUTH_UNAUTHENTICATED` | merged `private, no-cache, no-store, …` | `sb-<ref>-auth-token=; Path=/; Max-Age=0; HttpOnly; SameSite=lax` | – | **6 294** (pre-fix **51 116**) |
| 8 | GET protected: no selector, no cookie | 401 | `AUTH_UNAUTHENTICATED` | yes | none | – | 10 |
| 9 | POST protected: missing Origin | 403 | `AUTH_ORIGIN_MISSING` | yes | none | – | 12 |
| 10 | POST protected: foreign Origin | 403 | `AUTH_CROSS_ORIGIN_DENIED` | yes | none | – | 9 |
| 11 | POST protected: Origin `null` | 403 | `AUTH_ORIGIN_NULL` | yes | none | – | 9 |
| 12 | POST protected: forwarding spoof | 403 | `AUTH_CROSS_ORIGIN_DENIED` | yes | none | – | 8 |
| 13 | POST protected: same-origin, no cookie | 401 | `AUTH_UNAUTHENTICATED` | yes | none | – | 8 |
| 14 | POST sign-in: fabricated unknown account (same-origin) | 401 | `AUTH_SIGNIN_FAILED` | yes | none | – | 25 |
| 15 | POST sign-in: cross-origin | 403 | `AUTH_CROSS_ORIGIN_DENIED` | yes | none | – | 5 |
| 16 | POST sign-in: wrong media type | 415 | `AUTH_MEDIA_TYPE_UNSUPPORTED` | yes | none | – | 8 |
| 17 | POST sign-in: oversized body | 413 | `AUTH_SIGNIN_PAYLOAD_TOO_LARGE` | yes | none | – | 9 |
| 18 | GET callback: bogus code + open-redirect `next` | 303 | – | n/a | none | `<origin>/signin?error=auth` | 7 |
| 19 | GET callback: no code | 303 | – | n/a | none | `<origin>/signin?error=auth` | 5 |
| 20 | POST sign-out: same-origin, no cookie | 200 | – | yes | none | – | 9 |
| 21 | POST sign-out: cross-origin | 403 | `AUTH_CROSS_ORIGIN_DENIED` | yes | none | – | 5 |
| 22 | POST sign-out: with a session cookie (server unreachable) | 200 `{ok, signedOut:true, remoteRevocation:"unconfirmed"}` | – | yes | `sb-<ref>-auth-token=; Path=/; Max-Age=0; HttpOnly; SameSite=lax` | – | 18 |
| 23 | POST `/api/auth/signup` (must not exist) | 404 | – | n/a | none | – | 10 |

No response body or header contained the project reference, key, token, refresh sentinel, or any cookie value (scanned per row). The pre-fix run is identical except rows 7 (51 116 ms, no retirement cookie) and 22 (`{ok:true, signedOut:true}` — the conflation).

## How to unblock (owner recipe, secret-free)

1. Create or designate an **isolated** Supabase project used for nothing else; name it with the `sirkit-auth-qualification-` prefix; apply `drizzle/0027_project_membership.sql` (see `membership-and-rls-proof.md`); create ONE dedicated account (name it `sirkit-auth-qualification-…`); insert ONE active `project_members` row for it (project id `sirkit-auth-qualification-…`).
2. Start the real app in production auth mode on loopback with that project's URL/publishable key in the environment (never in a file that is committed) and `SIRKIT_EXPECTED_ORIGIN=http://127.0.0.1:3100`:
   ```bash
   pnpm exec next build
   ```
   ```bash
   PORT=3100 SIRKIT_EXPECTED_ORIGIN=http://127.0.0.1:3100 pnpm exec next start -p 3100
   ```
3. Run the opt-in live matrix (skipped everywhere else):
   ```bash
   SIRKIT_LIVE_AUTH_QUALIFICATION=1 SIRKIT_AUTH_QUALIFICATION_PROJECT=sirkit-auth-qualification-<label> SIRKIT_AUTH_QUALIFICATION_BASE_URL=http://127.0.0.1:3100 SIRKIT_AUTH_QUALIFICATION_PROJECT_ID=<project-id> pnpm exec vitest run app/lib/auth/__tests__/b16-1b-live-qualification.test.ts --reporter=verbose
   ```
   with `SIRKIT_AUTH_QUALIFICATION_EMAIL` / `SIRKIT_AUTH_QUALIFICATION_PASSWORD` (and optionally `SIRKIT_AUTH_QUALIFICATION_DATABASE_URL` for the membership canary) exported in the same shell. The test prints statuses, codes, cookie NAMES and flags only.
4. Delete the qualification account, project row(s), and canary rows afterwards (the test deletes its own canary).

What the live test proves, in order: unauthenticated 401 / cross-origin 403; sign-in `{ok:true}` + cookie family with the flags; real membership read 200 with forged headers inert, no selector 400, foreign selectors identical 403; same-origin state-changing route passes auth+CSRF (validation-class refusal) while cross-origin/missing Origin are 403; wrong-password vs unknown-account byte-equal; malformed callback safe redirect; proxy rotation family/flags; membership canary active → revoked; sign-out `remoteRevocation: "confirmed"` + retirement + 401 afterwards + **replayed pre-sign-out jar → 401** (session liveness with a still-valid token).
