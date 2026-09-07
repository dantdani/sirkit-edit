# B16.1B — final verdict

## Stop condition reached: **B** (offline work complete; exact external blocker documented)

**BLOCKED-LIVE-QUALIFICATION.** The Supabase project referenced by the local configuration does not resolve in DNS (from two independent resolvers; the `supabase.co` zone itself resolves) and the regional pooler reports its tenant as not found; no isolated project marker, no dedicated qualification account, and no isolated admin credentials were supplied. Condition A (a passing isolated live matrix) is therefore unmet; every offline and read-only verification possible was completed, the live matrix is implemented as an opt-in test with an exact owner recipe, and no fake-client result is labelled live anywhere.

## Authentication and revocation verdict (precise)

| fact | status | evidence |
|---|---|---|
| **JWT validity** (signature against the project keys + `exp`) is required | CONFIRMED (real SDK, offline) | forged signature / tampered payload / `alg=none` / unknown `kid` / expired → 401 |
| **Session liveness** is required in addition to validity: exactly one server confirmation (`getUser()`), `user.id === claims.sub` | CONFIRMED (real SDK, offline); **was FAIL-OPEN before this stage with asymmetric keys** | pre-edit R8 accepted a valid token from a revoked session with zero `/user` calls; post-edit 401 after exactly one; mismatch/timeout/abort/error/unavailable all 401 |
| **Membership authority** comes only from `project_members`, re-read every request; revocation observed on the next request; role change retires the revision | CONFIRMED (offline) | fake repository + real-SDK identity; repository tuple exactness with a recording DB handle |
| **Local cookie retirement** on sign-out is performed and reported as `signedOut` — never as proof of remote revocation | CONFIRMED (real SSR offline; real HTTP) | retirement `Set-Cookie` with `Max-Age=0`, HttpOnly, Path=/ observed |
| **Remote revocation** is reported as `remoteRevocation: confirmed|unconfirmed` from the Auth server's answer; the access token stays cryptographically valid until `exp` (Supabase design) but is refused by liveness | CONFIRMED (design + real HTTP `unconfirmed` path) | live `confirmed` path BLOCKED |
| Provider calls are bounded (5 s per request) and abort-safe; an unreachable provider fails CLOSED | CONFIRMED (real HTTP) | 51 116 ms → 6 294 ms |
| Cookie flags: HttpOnly, SameSite=Lax, Path=/, Secure iff https expected origin | CONFIRMED (real SSR offline; retirement flags on real HTTP) | set-on-sign-in BLOCKED live |
| CSRF exact-origin before body/identity/liveness/membership/handler; zero pulls | CONFIRMED (offline + real HTTP) | |
| Forged authority headers inert; foreign tenant/project identical 403 | CONFIRMED (real SDK offline) | live BLOCKED |
| Production can never resolve `local_dev` | CONFIRMED | mode matrix incl. missing host / headers |
| No unrestricted signup endpoint | CONFIRMED | fs + policy table + action registry + real HTTP 404 |
| Live: sign-in success, cookie set, rotation of a live pair, remote-confirmed sign-out, replay-after-sign-out, canary, foreign selectors with a live session, enumeration byte-equality with a real account | **BLOCKED** | opt-in test ready |

## Migration / RLS verdict

- `0027_project_membership.sql`: NOT journal-registered (unchanged; owner decision recorded); applied-to-live **UNKNOWN / BLOCKED**; nothing applied by this stage.
- Schema/runtime parity: CONFIRMED for every column, check, unique/lookup index — and, after this stage, for RLS enablement and the `project_members_self_select` policy, which the drizzle schema previously lacked (a `push`-provisioned database had no RLS). `drizzle-kit` told to treat Supabase roles as platform-provided.
- Authenticated users cannot write their own membership through the publishable-key client: CONFIRMED by construction (no INSERT/UPDATE/DELETE policy under RLS) — live enforcement PROPOSED/BLOCKED.

## Exact counts

- New tests: **74 always-on** (19 against the REAL SDK offline, 55 with fakes) + **9 opt-in live** (skipped: BLOCKED); 1 existing pin superseded.
- §H battery: **92 files · 1857 passed · 0 failed · 9 skipped**.
- Full bounded suite: run 1 **4591 / 1 (environmental: the dead database) / 29 skipped**; run 2 with that database excluded **4591 / 0 / 30 skipped · exit 0**.
- Invariants: **153 route methods · 150 canonical wrappers · 3 approved factories · 0 raw handlers · 12 exposed tools**; ratchet baseline byte-identical (`d0542262…`); generators byte-stable ×2.
- Static: tsc 0 · scoped ESLint 0/0 · `git diff --check` clean · secret scans 0 hits.
- Real HTTP: 2 production builds × 23 rows.

## Not started (per the stop condition)

MCP, multi-agent orchestration, provider expansion, signup, production data migration, component downloads, new editor features. `C:\Users\robsa\sirkit` untouched.

Awaiting independent verification.
