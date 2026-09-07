# B16.1B — changed files

## Production code

| file | change | why |
|---|---|---|
| `app/lib/auth/session-liveness.ts` (new, 118 lines) | provider-neutral `SessionLivenessVerifier`, `SessionLivenessOutcome`, settle-once `confirmSessionLiveness` | §E boundary |
| `app/lib/auth/bounded-fetch.ts` (new, 99 lines) | per-request deadline-bounded, abort-safe `fetch` with a non-retryable deadline sentinel; `SESSION_VERIFICATION_DEADLINE_MS` | 51-second hold reproduced; bounded deadlines |
| `app/lib/auth/session-cookies.ts` (new, 39 lines) | server-owned session-cookie option set (HttpOnly, Lax, Path=/, Secure iff https expected origin) | false HttpOnly claim; §D flags |
| `app/lib/auth/identity-provider.ts` (+162/−) | `SupabaseIdentityProvider` gains the liveness policy (claims → exp → liveness → principal; `userId === sub`); `createSupabaseSessionVerifiers` builds ONE bounded read-only client per request for `getClaims` + `getUser`; `createSupabaseClaimsVerifier` delegates | R8 closure; exactly-once sequence |
| `app/lib/auth/identity-runtime.ts` | production factory composes claims + liveness | composition |
| `app/lib/auth/supabase-server.ts` | `updateSession`: bounded fetch, server-owned cookie options, SDK anti-caching headers applied, provider failure never breaks the request | proxy rotation contract |
| `app/api/auth/signin/route.ts` | bounded fetch + cookie options; comment corrected | flags; deadline |
| `app/api/auth/callback/route.ts` | bounded fetch + cookie options | flags; deadline |
| `app/api/auth/signout/route.ts` | `signOut({scope:"global"})`; body `{ok, signedOut, remoteRevocation}`; bounded fetch + cookie options | local retirement ≠ remote revocation |
| `app/lib/db/schema.ts` | `projectMembers`: `.enableRLS()` + `pgPolicy("project_members_self_select", …)` with the migration's predicate; `pgPolicy`/`authenticatedRole` imports | §F RLS parity |
| `drizzle.config.ts` | `entities: { roles: { provider: "supabase" } }` | drizzle-kit must not manage platform roles |

Untouched by design: route policy table (`route-policy.ts`), wrappers (`route-handlers.ts`), the CSRF/origin modules, membership repositories, provider routing, prompts, AI tools, PCB/schematic authorities, manufacturing release, the 153-route ratchet and its baseline, generators, benchmark workflow.

## Tests

| file | tests | scope |
|---|---|---|
| `app/lib/auth/__tests__/b16-1b-session-liveness.test.ts` (new) | 24 | settle-once boundary (revoked, mismatch, timeout, late resolution, late rejection, abort, error, unavailable, exactly-once), adapter ordering, one-client-per-request (fake SDK), runtime composition, bounded fetch |
| `app/lib/auth/__tests__/b16-1b-real-sdk-identity.test.ts` (new) | 12 | REAL `@supabase/*` SDK + ES256 key pair + fetch spy: cookie classes, R8 closure (+ claims-only contrast, HS256 contrast), mismatch, hang, forged headers, wrapper path, revocation-next-request, isolation |
| `app/lib/auth/__tests__/b16-1b-cookie-semantics.test.ts` (new) | 6 | REAL SSR client: option set on write, Secure derivation, retirement, unreachable-server retirement, no secret in names/headers |
| `app/lib/auth/__tests__/b16-1b-proxy-and-route-cookies.test.ts` (new) | 5 | fake SSR + fake `next/headers`: proxy rotation/pass-through, routes pass options + bounded fetch, sign-out two-fact body |
| `app/lib/auth/__tests__/b16-1b-membership-schema-parity.test.ts` (new) | 8 | migration ↔ schema parity (columns, checks, indexes, RLS, policy, no write policy), idempotence, drizzle-kit roles, repository tuple exactness, revoked/malformed fail-closed |
| `app/lib/auth/__tests__/b16-1b-auth-composition.test.ts` (new) | 15 | wrapper → identity → membership → handler; refusal ordering with zero pulls; no-secret in bodies/logs; production never local_dev; no signup surface; exact 153/150/3/0 and 12 tools |
| `app/lib/auth/__tests__/b16-1b-live-qualification.test.ts` (new) | 1 always-on gate + 9 opt-in live | the §D live matrix; skipped without BOTH markers |
| `app/api/__tests__/b16-0-24-1-security-correction.test.ts` | 1 assertion superseded | sign-out body now includes `remoteRevocation: "confirmed"`; `scope: "global"` pinned |

## Artifacts

`artifacts/ai-control-plane-b16-1b/` — the 16 files required by §I.

## Not changed / not created

No `.env*`, no cookie jar, no captured header, no raw provider response, no migration applied, no journal entry, no dependency upgrade, no generated baseline/matrix drift (both sanctioned generators re-run twice: byte-identical to the committed files).
