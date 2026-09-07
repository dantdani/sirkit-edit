# B16.1B — unknowns and owner decisions

## Decisions taken this stage (each reversible, each test-pinned)

1. **Add the session-liveness boundary even though the real project's key family is UNKNOWN.** With asymmetric keys the reproduced R8 fail-open is real (real SDK); with HS256 the check is redundant but harmless (one extra `/user` round trip for a live session). Correctness must not depend on an unverifiable dashboard setting. **CONFIRMED defect, closure PROPOSED-then-implemented.**
2. **Bound every provider call to one 5-second per-request budget** (`SESSION_VERIFICATION_DEADLINE_MS`) with a non-retryable sentinel after the deadline. Reproduced defect: 51 s request hold with a stale cookie. Consequence accepted and documented: an already-expired session that cannot refresh within the budget is retired locally by the proxy (SDK semantics); a valid token is never retired by a deadline. Owner may tune the constant; it must stay finite.
3. **Cookie hardening**: server-owned option set (HttpOnly, SameSite=Lax, Path=/, Secure iff the expected origin is https). Corrects a false in-repo claim. Safe because Sirkit has no browser Supabase client. If a browser-side client is ever introduced, HttpOnly must be revisited (the official docs' rationale for `httpOnly:false`).
4. **Sign-out reports two facts** (`signedOut`, `remoteRevocation`). The B16.0.24.1 exact-body pin was superseded to include the new field (documented in that test; not a weakening).
5. **RLS declared in the drizzle schema** (`.enableRLS()` + `pgPolicy`) with the migration's exact predicate, plus `entities.roles.provider = "supabase"` in `drizzle.config.ts`, so the documented `drizzle-kit push` path can no longer provision the table without RLS. No `push` was run.
6. **Did NOT register 0027/0028 in the drizzle journal.** The journal is not the repository's applied-migration mechanism (README uses `push`), the journal already lacks snapshots 0009–0026, and registering entries would create a second, divergent application path. B16.0.3's "owner-gated" position stands. Owner decision: keep `push` as the mechanism (schema now carries RLS) OR adopt `drizzle-kit migrate` and register 0027/0028 with generated snapshots.
7. **Live matrix implemented as an opt-in test** (`b16-1b-live-qualification.test.ts`) gated on BOTH `SIRKIT_LIVE_AUTH_QUALIFICATION=1` and a `sirkit-auth-qualification-*` project marker; skipped in ordinary CI; prints names/flags/statuses only.
8. **The R-extra callback fallback** (production runtime without `SIRKIT_EXPECTED_ORIGIN` redirects to the request-URL origin) was recorded, not changed: it is a documented B16.0.24 behaviour, only affects the caller's own request, and production sign-in is impossible without the configured origin anyway. Owner option: make the callback refuse with a relative `/signin?error=auth` redirect when the expected origin is unconfigured.

## Unknowns (precise)

| unknown | why | how it closes |
|---|---|---|
| everything LIVE (sign-in success, cookie set on sign-in, refresh rotation of a live pair, remote-confirmed sign-out, replay-after-sign-out, membership canary, foreign selectors with a live session, wrong-password vs unknown-account with a real account, migration applied, RLS enforced by the database) | the configured project does not resolve; no isolated project/account/credentials supplied | the owner recipe in `live-auth-qualification-matrix.md` |
| the real project's JWT signing family (ES256/RS256 vs legacy HS256) | JWKS endpoint unreachable | `GET <url>/auth/v1/.well-known/jwks.json` (public) once a project exists |
| whether "Allow new users to sign up" is off on the real project | settings endpoint unreachable | dashboard → Authentication → General; the app exposes no signup surface regardless |
| live Auth-server latency per authenticated request (the added `/user` call) | no reachable project | measure from the live run; expected tens–hundreds of ms |
| whether `.env.local` points at a deleted project or a mistyped reference | cannot be determined offline | owner checks the Supabase dashboard |

## Residual blockers / owner options

- **BLOCKED-LIVE-QUALIFICATION** (external): provide an isolated project + dedicated account + markers (recipe in the matrix artifact). No production database may be used for the canary.
- **Owner must set `SIRKIT_EXPECTED_ORIGIN` in production** (unchanged B16.0.2 requirement); cookie `Secure` now also derives from it.
- **Migration mechanism decision** (item 6).
- **Optional hardening not done here**: shorter access-token expiry in the Supabase dashboard (the docs recommend it because access tokens cannot be revoked); SHA-pinning of GitHub Actions and branch protection (carried from B16.1A).
- **Known pre-existing flake** (not touched): `b16-0-ai-approval-lifecycle` 22/23 can exceed 5 s under a parallel batch (dynamic import of the chat route graph); identical on the untouched tree (A/B via `git stash`), 3/3 green in isolation, recorded by B16.0.2 as well. No timeout was raised.
- **Repo-wide ESLint debt** (33 pre-existing React-hooks errors in old UI files, B16.1A) unchanged; scoped ESLint on every changed file is 0 errors / 0 warnings.

## Honest limitations

A fake-client or spy-backed result is never CONFIRMED LIVE in these artifacts. The strongest offline evidence here is the REAL SDK verifying REAL ES256 signatures against a spy-served JWKS and the REAL production build answering real HTTP; what those cannot prove is the behaviour of Supabase's own servers (session store, refresh rotation, revocation acknowledgement), which is exactly the BLOCKED set.
