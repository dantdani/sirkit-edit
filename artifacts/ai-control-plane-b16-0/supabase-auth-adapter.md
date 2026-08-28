# B16.0 — the Supabase Auth production adapter

## Official docs used (primary sources, current Aug 2026)

- Supabase Auth SSR for Next.js (App Router) — `@supabase/ssr`
  `createServerClient(url, key, { cookies: { getAll, setAll } })`.
- Identity validation with `supabase.auth.getClaims()` (JWT-signature
  verified against the project JWKS; NEVER `getSession()` user data for
  authorization).
- Row Level Security + `auth.uid()`, `(select auth.uid())` performance form.
- Roles must NOT live in user-editable `user_metadata` (`raw_user_meta_data`).
- The secret/service_role key bypasses RLS and must never reach the browser.
- Next.js Route Handler + async `cookies()`, Secure/HttpOnly/SameSite; Route
  Handlers get no automatic CSRF (validate Origin/Host yourself).

## Locked dependency versions

`@supabase/ssr` and `@supabase/supabase-js` are added to `package.json` with
the exact current-stable versions found on the official npm/docs:

```
"@supabase/ssr": "0.12.4",
"@supabase/supabase-js": "2.112.3"
```

(`@supabase/ssr` is pre-1.0 — pinned exactly, not `^`.)

## Adapter design (isolated + fail-closed)

`app/lib/auth/identity-provider.ts` defines the provider-neutral
`IdentityProvider`. The Supabase adapter (`SupabaseIdentityProvider`) consumes
a `SupabaseClaimsVerifier` (`request → verified claims | null`). The
production verifier `createSupabaseClaimsVerifier(env)`:

- reads `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  (falls back to `…ANON_KEY`); absent ⇒ returns null (fail closed);
- **lazily dynamic-imports `@supabase/ssr` in exactly ONE place** — so the
  type checker and the entire test suite never require the package installed,
  and a missing package fails CLOSED (production refuses, never a fake human);
- builds the server client's cookie adapter from the request `Cookie` header
  (`getAll`), with a no-op `setAll` (a route handler is a READ path; token
  rotation belongs in the proxy);
- calls `supabase.auth.getClaims()` and returns `data.claims` (or null).

`SupabaseIdentityProvider.verify` derives:
- `userId` from the verified `claims.sub` (NEVER a header, NEVER metadata);
- `authStrength` from `claims.aal` (aal1/aal2);
- and independently rejects an already-expired `exp` (defence in depth).

The ROLE is NOT read from any JWT claim or metadata — it is looked up from the
`project_members` table (`project-membership.ts`). `getSession()` is never
used for authorization.

## Refresh-token rotation, sign-in/out (SSR)

The SSR refresh pattern lives in a repo-root `proxy.ts` (Next 16's renamed
middleware) calling `updateSession` — token rotation writes rotated cookies
onto both the request and the response so client and server stay in sync;
`getClaims()` refreshes an about-to-expire token. Sign-in/sign-out is a
minimal boundary (a Server Action / Route Handler calling `signOut()` to clear
cookies); unrestricted self-signup is NOT enabled, and no real emails/users
are created in tests. (These SSR wiring files are documented here as the
production deployment contract; the adapter's IDENTITY logic is fully covered
by injected fakes so the ordinary test suite never contacts Supabase Auth.)

## Service-role key safety

The secret/service_role key is never `NEXT_PUBLIC_`, never imported by a
browser module (the B16.0 browser→server-secret import gate pins this), and
is used only by the trusted server membership path (which bypasses RLS by
design). RLS on `project_members` restricts even a direct anon-key read to a
user's own active membership.
