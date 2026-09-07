# B16.1B — zero-secret evidence

## Rules applied (mandate §A/§C, rules 2–4)

- No password, JWT, refresh/access token, cookie value, database URL, Supabase key, service-role credential, or complete real user email was printed, serialized, screenshotted, committed, or placed in a command argument.
- Configuration was reported as `present` / `absent` / `malformed` only (`configuration-readiness.md`); `.env.local` was inspected by KEY NAME with a length bucket, never by value.
- Every probe and test uses synthetic sentinels: project reference `sirkitauthqualification`, key `sb_publishable_SIRKIT_AUTH_QUALIFICATION_SENTINEL_…`, user id `…-sirkitqual01`, refresh `sirkit-auth-qualification-refresh-sentinel`, emails under `example.invalid`, and locally generated ES256 key pairs that never leave the test process.
- The real-HTTP matrix derived the cookie NAME from the configured project reference in memory and printed it as `sb-<ref>-auth-token`; the script's output was additionally piped through a redaction filter for `*.supabase.co` hosts and the pooler user.
- Probe scripts lived under the git-ignored `scripts/output/` and were removed after use; the disposable vitest harness was deleted once the permanent suites existed.
- `.env*` is git-ignored (`!.env.example` only); no cookie jar, captured header, or raw provider response exists on disk or in Git.

## Mechanical scan of every changed and new file (pre-commit)

| check | result |
|---|---|
| files scanned (tracked modifications + every new file, artifacts included) | 27 |
| any REAL value from `.env.local` (all keys ≥ 8 chars, compared in memory) | 0 hits |
| the real project reference | 0 hits |
| JWT-shaped strings (`eyJ…` × 3 segments ≥ 20 chars) | 0 hits |
| `postgres://` / `postgresql://` URLs | 0 hits |
| email addresses other than `example.invalid` sentinels and the committer identity | 0 hits |

The same scan is repeated as part of the pre-commit secret check for each commit (`test-and-validation-report.md`).

## Runtime guarantees pinned by tests

- Refusal envelopes are `no-store`, bounded (`error` ≤ 300 chars), and carry only `{ok, code, error[, mode]}`; no `Set-Cookie` on a refusal; no sentinel URL/key/token/refresh/cookie name in any body or header (real-SDK suite; pre-edit harness over 31 envelopes; real HTTP over 23 rows).
- A provider error whose message contains a sentinel secret never reaches the response body, response headers, or the console (`b16-1b-auth-composition.test.ts`, console spied on all five levels).
- The bounded-fetch deadline sentinel handed to the SDK contains no token/cookie/key material and is never forwarded to a browser.
- Cookie NAMES and the SDK-supplied anti-caching headers never contain a token, key, or refresh value (real SSR).
- Redirects carry only `/signin?error=auth` on the server-owned origin, or the validated same-origin `next` path — never a code, token, or provider diagnostic.
- The opt-in live test prints statuses, codes, cookie NAMES, and flags only; assertion messages name cookies, never values.
