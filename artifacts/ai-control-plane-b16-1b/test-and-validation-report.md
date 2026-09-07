# B16.1B §H — test and validation report

All runs on 2026-09-07, LF working tree, branch `integration/b16-1b-production-auth`. No provider credits, no live simulator, no live database write, no live Supabase (unreachable — see `configuration-readiness.md`).

## New B16.1B tests (exact counts)

| file | always-on | opt-in live | what runs against |
|---|---|---|---|
| `b16-1b-session-liveness.test.ts` | 24 | — | fake verifiers + fake `@supabase/ssr` module |
| `b16-1b-real-sdk-identity.test.ts` | 13 | — | REAL `@supabase/ssr` + `@supabase/auth-js`, real ES256 signatures, `fetch` spy |
| `b16-1b-cookie-semantics.test.ts` | 6 | — | REAL `@supabase/ssr` client, `fetch` spy |
| `b16-1b-proxy-and-route-cookies.test.ts` | 5 | — | fake SSR + fake `next/headers`, real `updateSession` / routes |
| `b16-1b-membership-schema-parity.test.ts` | 8 | — | migration SQL, drizzle table config, recording fake DB handle |
| `b16-1b-auth-composition.test.ts` | 17 | — | real wrappers/resolver/policy table, fake verifiers, source walk |
| `b16-1b-live-qualification.test.ts` | 1 (gate) | 9 | the real app over HTTP + an ISOLATED Supabase project (BLOCKED — skipped) |
| **total** | **74** | **9 (skipped: BLOCKED)** | |

Live vs fake, stated plainly: **0 tests ran against a live Supabase project.** 19 tests ran the REAL SDK offline (real signatures, spy-served Auth endpoints); 55 ran with fakes; 9 live tests are implemented and gated. Two real-HTTP matrix runs (23 rows each, pre-fix and post-fix production builds) ran as scripts against the real Next.js server with the provider unreachable.

Superseded pin: `b16-0-24-1-security-correction.test.ts` sign-out body now `{ok:true, signedOut:true, remoteRevocation:"confirmed"}` + `scope:"global"` (documented in the test; not a weakening).

## Pre-edit reproduction harness (deleted after the permanent suites landed)

27/27 probes behaved as recorded in `pre-edit-counterexamples.md` (31 refusal envelopes checked). The post-edit rerun of the same harness with the production composition: 29/29, including the R8 closure (revoked → 401 after exactly one `/user` call), mismatch, and the bounded hang.

## §H battery (targeted; `--pool=forks --maxForks=2`)

`app/lib/auth/__tests__` (all B16.0.x gates, ratchet, CSRF, trusted context, approval lifecycle, tranche gates, and the new suites) + `app/api/auth/__tests__` + `app/api/__tests__` (all tranche-parity suites, B16.0.24 parity, B16.0.24.1 corrections, identity-header gate, route coverage) + `app/api/chat/__tests__` + `b16-0-2-session-identity` + `b14-1-approval-and-reauthorization` + `app/lib/agent/__tests__`:

**92 files · 1857 passed · 0 failed · 9 skipped (the opt-in live matrix) · exit 0.**

Route migration ratchet (inside the battery): green — 153 methods, 150 canonical, 3 approved factories, 0 raw; baseline untouched. 12 exposed tools pinned (agent suites + the new composition suite).

## Static gates

| gate | result |
|---|---|
| `pnpm exec tsc --noEmit` | 0 errors (run after every edit and finally) |
| scoped ESLint on every changed source and test | 0 errors, 0 warnings (one unused directive removed during the stage) |
| `git diff --check` (committed range and artifacts) | clean |
| sanctioned generators ×2 (`generate-b16-0-7-artifacts.ts`, `generate-b16-0-8-baseline.ts`) | byte-stable; regenerated files identical to the committed ones (`git status` empty for them); baseline sha1 `d0542262…` unchanged |
| secret scan of every changed/new file and of every staged diff before each commit | 27 files / 0 hits; per-commit scans 0 hits ×4 (×5 with the artifacts commit) |

## benchmark-quality commands (local)

| command | result |
|---|---|
| `pnpm run benchmark:validate` | `{ packages: 63, diagnostics: [] }` |
| `pnpm exec tsc --noEmit` | 0 errors |
| stage-09 benchmark core | 18/18 |
| `pnpm run stage10:test` | 56 files, 801/801 |
| stage-08 professional routing | 11/11 |

## Complete bounded Vitest suite (`--pool=forks --maxForks=2 --minForks=1`)

| run | result | note |
|---|---|---|
| 1 (environment as found) | 408 files passed, 1 failed · **4591 passed / 1 failed / 29 skipped** · 256 s · exit 1 | the ONE failure is `app/lib/pcb/__tests__/ingest-integrity.test.ts › pcb_footprints raw_sexpr round-trip (DB)`: `PostgresError: (ENOTFOUND) tenant/user … not found`. The test opens the database named by `.env.local` (its own `describe.skipIf(!hasDb)` gating runs it because the URL is present); that database belongs to the Supabase project that no longer resolves. File untouched by this stage; the identical error reproduces in isolation. This is a functional environmental failure — NOT a timing flake and NOT a B16.1B regression (the same test passed in B16.1A on 2026-08-28, when the project still existed) |
| 2 (`DATABASE_URL=""` so the dead database is excluded by the test's own gate) | 408 files passed, 4 skipped · **4591 passed / 0 failed / 30 skipped** · 279 s · **exit 0** | proves the code is green; the only difference from run 1 is the skipped DB-bound test |

Skipped tests (30): the 9 opt-in live tests, and the repository's pre-existing DB/credential-gated suites (e.g. `R03_B07_DATABASE_URL`, live assist).

## Flake / failure classification (proof, not assertion)

- `b16-0-ai-approval-lifecycle › 22/23` timed out at 5 s in the parallel auth batch (default forks). A/B via `git stash` on the UNTOUCHED tree: identical timeout; 3/3 green in isolation (~1.5 s); green in the bounded battery and in both full runs; recorded by B16.0.2 as the chat-route dynamic-import flake. Nothing was loosened.
- No other failure occurred in any run.

## Real Next.js HTTP (production build)

Pre-fix build (`0193e5f` tree) and post-fix build (B16.1B tree), each `next build` exit 0, `next start` on loopback 3100 in production auth mode; 23-row matrix each (`live-auth-qualification-matrix.md`). Delta: row 7 expired-cookie hold 51 116 ms → 6 294 ms with a retirement cookie; row 22 sign-out now reports `remoteRevocation: "unconfirmed"`. Every other row byte-equivalent in status/code.
