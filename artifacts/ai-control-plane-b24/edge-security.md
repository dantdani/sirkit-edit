# B24-A2 - Headers, origins, secrets

Labels: **CONFIRMED** (executed here and measured, or read at the cited file:line), **INFERRED** (code reading, nothing executed),
**PROPOSED** (designed, not exercised), **RECORDED** (written down from a document without a claim of our own), **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION** (needs a live resource the owner has not supplied; never faked, never claimed).

Base: `1b2c08c` on `chapter/b24-production-qualification` (B24-A1 committed on main `57c3b29`'s tree plus the B24 discovery).
B24-A2 closes D24-4, D24-5 and D24-6 (discovery `:574`, `:582`, `:588`; runbook B24-A `:1034-1036`, global `:152-153`, `:168`).
It was delivered in one workflow run, the headers and origins half (deliverables 1-3) first, then rotation, the census and the scan
(deliverables 4-6), for one commit by the lead. Every citation in section 14 is the line at this increment's working tree.

## 0. What B24-A2 is

- **What it is.** Six security headers on every path from one pure builder, `poweredByHeader: false`, and HSTS only for an https
  origin (D24-5); the Supabase Site URL and redirect allowlist each environment needs, as a pure function and a table (D24-6); a
  previous value that only verifies for the worker secret, the KiCad library token and the MCP signing key, a census of every
  environment name the code reads with `.env.example` parity over the declared classes, and a secret scan with a reviewed allowlist,
  a script with three modes and a CI job (D24-4).
- **What it is not.** No deployment, no edge or CDN setting, no Supabase dashboard change, no real secret rotated, no `.env*` value
  read (names only): each is **BLOCKED-LIVE-QUALIFICATION** (LB-1, LB-13; section 11). No route, tool, action record, UI control,
  dependency (OD-42) or secret manager. The census stays 168 / 165 / 3 / 0, the tool counts 47 / 36 / 9 / 27, the action records
  107 and B17's 631 control sites on 63 surfaces; the nine B11-scanned files are untouched; the 555 release identity does not move.
- **What the builder did not run.** No `next dev`, `next build`, `next start` or Playwright: the served-header spec, both Playwright
  configs and the local production-mode run are the lead's (section 13). Every statement below about a served header is
  **PROPOSED** until those runs, and the real edge is **BLOCKED-LIVE-QUALIFICATION** (LB-13).

## 1. Security headers on every path (D24-5, OD-196)

`next.config.ts` keeps its one rule, `source: "/:path*"` (`:10`), and sends what `securityHeaders(process.env)` builds (C1-C3):

| header | value | why | proven |
|---|---|---|---|
| `Content-Security-Policy` | `img-src 'self' data: blob:; frame-ancestors 'none'` | the image directive B19-D pins, unchanged, and no page may be framed (clickjacking: the Tier 1 grant card, the Tier 2 dialogs, B23's latent `ProviderExchangePanel` controls) | unit `b24-a2-headers` 1, 2 (**CONFIRMED**); served: `e2e/security-headers.spec.ts` and `production-smoke` (**PROPOSED**, the lead's runs) |
| `X-Frame-Options` | `DENY` | the same refusal for browsers that predate `frame-ancestors` | as above |
| `X-Content-Type-Options` | `nosniff` | no MIME sniffing of a response | as above |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | a cross-origin request carries the origin only, never a path or query | as above |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | five powerful features off; no production source asks for any of them (case 6, **CONFIRMED**) | as above |
| `Content-Security-Policy-Report-Only` | `default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'` | what an enforced policy would allow, reported, not enforced, until the owner accepts one (OD-196); no report endpoint (that would be a route); no browser module imports `@supabase` (case 6), so `connect-src 'self'` is the expectation | as above; the violations Chromium reports on `/` are attached to the spec's result, asserted on nothing |
| `Strict-Transport-Security` | `max-age=31536000` | only when `SIRKIT_EXPECTED_ORIGIN` normalises to https - the session cookie's `Secure` rule (`session-cookies.ts:30-38`, C5); no `includeSubDomains`, no `preload` (the owner's, LB-13) | unit case 2 over 32 origin shapes, equal to the cookie rule (**CONFIRMED**); absent in the dev browser run (http origin) and in `production-smoke`, whose `next build` step builds with no `SIRKIT_EXPECTED_ORIGIN` (its http origin is set for `next start` only; **PROPOSED** until the job's first CI run; [B24-A2 review, 2026-10-06] coverage-4); the real edge **BLOCKED-LIVE-QUALIFICATION** (LB-13) |

- **The builder is pure.** It reads `SIRKIT_EXPECTED_ORIGIN` from the map it is handed and nothing else - never `process.env` itself,
  a request or a forwarding header (case 3, a recording proxy). `headers()` hands it `process.env` (`:10`).
- **`poweredByHeader: false`** is appended to `:6`. X-Powered-By before A2: Next 16.2.6 defaults `poweredByHeader: true`
  (`node_modules/next/dist/server/config-shared.js:101`) and sets `X-Powered-By: Next.js` on HTML render results only
  (`node_modules/next/dist/server/send-payload.js:55-56`), so `/` sent it and the JSON routes did not - **CONFIRMED** by reading,
  which answers discovery section 8 item 9 (INFERRED there); after A2 the config turns it off (case 1, **CONFIRMED**), and the spec
  asserts it absent on every path it probes (**PROPOSED**, the lead's browser run).
- **When the headers are computed.** **INFERRED**: `headers()` runs when Next loads the config, and `next build` writes its answer into
  the routes manifest that `next start` serves, so HSTS follows the build-time `SIRKIT_EXPECTED_ORIGIN`, not a runtime switch: a
  deployment builds with its own origin. Read from `node_modules/next/dist/server/config.js` (the config loader), not run.
- **`allowedDevOrigins`** (`:6`) is unchanged and dev-server only: `next dev` reads it (cross-origin dev resources such as HMR), and
  it has no effect on a production server. RECORDED.
- **Why the builder sits in `next.config.ts` (the fallback).** A relative TypeScript import from the config file is unproven under
  `next dev` and `next build`: the builder ran neither, and `instrumentation.ts:11` proves nothing about the config loader (Next's
  bundler compiles it). Reading Next 16.2.6's loader (`node_modules/next/dist/build/next-config-ts/transpile-config.js`, and its
  require hook) suggests the import would load (**INFERRED**), but the task's rule is to prove it first. So the builder is a named
  export appended after `:14` (C2), `:1-14` keep their lines (`:1` gains no import), the config imports nothing at run time (case 3),
  and `normalizeOrigin`'s lenient rule (`expected-origin.ts:63-85`, C4) is restated (C3), pinned equal to the cookie rule by case 2.
  Next reads the default export only (`interopDefault`, `node_modules/next/dist/server/config.js:1252`), so the named export changes
  nothing it applies (**INFERRED**). `app/lib/deployment/security-headers.ts` is therefore not created; moving the builder there is
  a follow-up once the lead's runs prove the import (section 12).
- **In place.** `:6` (the appended key), `:8` (the B19-D comment, now false, with a dated B24-A2 note at its end) and `:10` (the
  array replaced by the builder call) changed; `:3-12` and `:9-11` keep their lines. B19-D's pin
  (`b19-d-chat-markdown.test.tsx:70-77`) holds unchanged, and B14's case 20 scans the file (no new import).

## 2. The served-header proof (`e2e/security-headers.spec.ts`)

The spec keeps its two tests (`:12-21`, byte for byte) and gains, after them (C6-C8):
- for `/`, `/api/ai/runtime`, `/favicon.ico` (outside `proxy.ts`'s matcher, `:22`) and `/api/health` (A1's): every header with its
  exact value, `x-powered-by` absent, `strict-transport-security` absent (the server's origin is `http://localhost:3100`,
  `playwright.config.ts:65`);
- the framing case: an `about:blank` page frames `/`; the response carries `X-Frame-Options: DENY` and `frame-ancestors 'none'`,
  and the frame never commits the Sirkit URL or the app's layout body;
- the report-only violations Chromium reports on `/`, attached to the result as JSON and asserted on nothing (`next dev` adds
  violations a production build would not).

`b24-a2-headers` case 5 pins the spec's literals equal to the builder's output for an http origin, so the two cannot drift. Running
the spec is the lead's (both Playwright configs, one at a time, never beside vitest): **PROPOSED** until then.

## 3. Origins and the Supabase redirect allowlist per environment (D24-6, OD-196)

`supabaseAuthUrls(profile, configuredOrigin)` (`app/lib/deployment/auth-url-allowlist.ts`, C9) takes one of A1's profile values and
the deployment's one configured origin and returns exactly two values: the Supabase **Site URL**, which is that origin normalised
(`normalizeOrigin`), and the redirect allowlist, exactly `<origin>/api/auth/callback` - no wildcard, no second host. A `*` in the
origin is refused (the URL parser accepts it, but it is a glob in Supabase's allowlist). That path is the one callback
(`route-policy.ts:131`, C10; the handler redirects only to the server-owned origin and limits `next` with `safeRedirectPath`,
`app/api/auth/callback/route.ts:38`, `:63`, C11, C12). **CONFIRMED** (`b24-a2-origin-allowlist` 1-4).

| profile | Site URL | redirect allowlist | an http origin |
|---|---|---|---|
| `development` | the developer's origin (normally `http://localhost:3000`) | `<origin>/api/auth/callback` | accepted |
| `ci` | the CI server's origin (`production-smoke`: `http://localhost:3200`) | `<origin>/api/auth/callback` | accepted |
| `staging` | the staging deployment's https origin | `<origin>/api/auth/callback` | refused unless loopback (the `expected-origin.ts:96-98` rule) |
| `production` | the production deployment's https origin | `<origin>/api/auth/callback` | refused unless loopback |

- **One origin per deployment** (`expected-origin.ts:16-22`): a preview deployment declares its own `SIRKIT_EXPECTED_ORIGIN` and
  gets its own pair; there is no multi-origin list (a stated choice, OD-196). Loopback http is accepted for every profile.
  [B24-A2 review, 2026-10-06] coverage-4: OD-196, as `auth-url-allowlist.ts` records it (task deliverable 3), not OD-224.
- **How a code reaches the callback.** The app starts no flow that redirects there: its only Supabase auth calls are
  `signInWithPassword` (`app/api/auth/signin/route.ts:83`, C13), `exchangeCodeForSession` (the callback, `:59`), `signOut` and the
  session reads; no sign-up, OAuth, OTP, recovery request, invite or generated link, and no `redirectTo` or `emailRedirectTo`, exists
  in production code (case 5, **CONFIRMED**). So the app starts none of them itself. The Supabase-initiated flows that must land on
  `<origin>/api/auth/callback` are an invite, a recovery (password reset) and an email confirmation, through the project's email
  templates or a `redirect_to` the project issues. The project's Site URL, redirect list and template settings are **UNKNOWN** and
  **BLOCKED-LIVE-QUALIFICATION** (LB-1, LB-13): no staging or production project exists (OD-190, OD-191) and none was read.
- The function claims nothing beyond the two values; nothing here is verified against a Supabase project.

## 4. Secrets: readers, rotation, separation (D24-4, OD-195)

Each shared secret now takes an optional previous value that verifies only and never signs, mints or configures
(`b24-a2-secret-rotation`, **CONFIRMED**):

| secret | reader | previous value | rotation procedure and window | separation |
|---|---|---|---|---|
| `SIRKIT_WORKFLOW_WORKER_SECRET` | `worker-principal.ts:49-55` (`verifyWorkerSecret`), every worker route through `authorize.ts` | `SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS` (`:63`, C14) | set the old value as previous and the new one as current; move every worker caller to the new one; unset the previous. Window: until every caller has moved, at most seven days ([B24-A2 review] security-4). After a suspected leak: no previous value (below). | the MCP key may equal neither value |
| `KICAD_HTTP_LIBRARY_TOKEN` | `server-auth.ts:4-14` (`authorizeKicadHttpLibrary`, through `kicadLibraryRoute`) | `KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS` (`:12`, C15) | the same, at most seven days; 503 while the current token is unset, whatever the previous one is | the MCP key may equal neither value |
| `SIRKIT_MCP_TOKEN_SECRET` | `mcp-bearer.ts:182-195` (`secretBytesOf`), minting and verification | `SIRKIT_MCP_TOKEN_SECRET_PREVIOUS` (`:555`, C16) | the same, keeping both for at least `MCP_TOKEN_LIFETIME_S`, 3600 s (a token minted under the old key lives that long), plus the 30 s clock skew - 3,630 s - and at most seven days; minting uses the current key only | neither key may equal the worker secret or the KiCad token, current or previous |

- **The worker secret.** The bearer verifies against the current value, or the previous one while it is set; both are trimmed,
  both compared with `timingSafeEqualString` in two declarations before the one return (`:54`, `:67`, C17); a previous value
  alone (current unset or blank) configures nothing, and `verifyWorkerSecret` stays a nullable result whose refusal is a bare
  negation (`_boundary-analysis.ts:229`). Cases 1, 2.
- **The KiCad token.** 503 while the current token is unset; otherwise 401 unless the token is the current or the previous value,
  each compared by length and then `timingSafeEqual`, both computed before the answer (`:12-13`, `:23`, C15, C18). Cases 3, 4.
- **The MCP key.** Minting and `resolveMcpResourceConfiguration` read the current key only; verification checks the signature
  against the current key, then the previous one, both in constant time (`:276`, `:584`, C19, C20); a token signed by neither is
  `bad_signature`. The previous key passes the current key's own bounds and separation - `secretBytesOf` applied to it (`:570`) - or
  it is never used, and it never unconfigures the endpoint; the current key's separation now covers the previous worker secret and
  KiCad token too (`:194`, `:560`). The header stays byte for byte (no `kid`); no refusal code and no `MCP_BEARER_BOUNDS` entry was
  added (the B20 page lists each, `b20-b2-mcp-endpoint.test.ts:873-880`). Cases 5-8.
- **No value echoed.** Every refusal and outcome in the suite is checked against the sentinels in six encodings; the browser
  spec's existing guard `mcp-endpoint.spec.ts:295` refuses any response naming `SIRKIT_MCP_TOKEN_SECRET`, which covers its
  `_PREVIOUS` name as a prefix.
- **B23's two single-value seams, recorded, not changed** (discovery 9.4, OD-195): the webhook HMAC secret is caller-supplied
  (`order-contract.ts:107`, its one use at `:295`; `webhook-verification.ts:29-30, :74`) and no composition root wires it; the
  provider credential header (`provider-egress.ts:198-201`) is read from a transfer descriptor's `auth.env`, reached only past
  admission, and no descriptor exists (`PROVIDER_TRANSFER_DESCRIPTORS` is empty, `:69`). The census pins that list empty, so a
  future descriptor whose name is no census row fails closed (section 5). Neither seam has a previous value: the first reviewed
  descriptor or webhook wiring decides one.
- **After a suspected leak** ([B24-A2 review, 2026-10-06] security-4): rotate with no previous value - never put a leaked value in a
  _PREVIOUS name, because a previous value verifies (an attacker's bearer, or an MCP token signed with the leaked key, would keep
  working). Replace the current value, leave the _PREVIOUS name unset and update every holder at once; the outage until they have the
  new value is accepted. The window of a planned rotation has a maximum: keep the previous value only until every holder has moved,
  and at most seven days after the switch; the MCP key at least 3,630 s (`MCP_TOKEN_LIFETIME_S`, 3600 s, plus `MCP_TOKEN_CLOCK_SKEW_S`,
  30 s, for a token minted by an instance whose clock runs behind). `.env.example` says the same beside the three names. Nothing
  enforces the seven days, and nothing reports whether a _PREVIOUS value is set: A1's configuration record carries flag states, never
  a secret's presence, and readiness names none of the three _PREVIOUS names, so a forgotten previous value stays valid unseen
  (**CONFIRMED** by reading `configuration.ts:72`, C36, and a search of both modules; section 12). **CONFIRMED** for the records (`b24-a2-secret-rotation` 11).
- **Through the MCP endpoint** ([B24-A2 review, 2026-10-06] coverage-7, tests-6): `POST /api/mcp`, driven through the canonical
  wrapper with both keys set, serves a token signed under the previous key and one under the current key, and answers a token
  signed by neither key, or by a previous key out of bounds, 401 `MCP_TOKEN_INVALID` with the invalid-token challenge and the
  endpoint's one body; no body or header carries a sentinel or a _PREVIOUS name (`b24-a2-secret-rotation` 10, **CONFIRMED**; it went
  red when the wrapper handed the verifier an environment without the previous key, restored by hash, section 8).
- **No secret manager** (OD-42): plain environment variables read at call time, as before.
- Rotating a real deployed secret is **BLOCKED-LIVE-QUALIFICATION** (LB-13): no deployment exists, and the owner holds the values.

## 5. The environment-name census and `.env.example` (D24-4, OD-195)

`ENVIRONMENT_NAMES` (`app/lib/deployment/environment-names.ts`, C21) is data: one row per name with its class, its reader and, for an
undeclared class, the reason; the module imports nothing, so neither import gate can trip (`b16-0-1-ci-gates.test.ts:247-264`,
`b20-b2-import-gates.test.ts:74`). `b24-a2-env-names` scans the production tree with the TypeScript parser, comments ignored: names
read off `process.env` or an identifier named `env` or `environment` (dot, `?.` or string-literal element access); string literals of
environment-name shape under a closed prefix list; and the names that come from data - the acquisition registry's secrets and
fallbacks (`source-registry.ts:217-218, :302, :391`), each transfer descriptor's `auth.env` (none: pinned empty), the MCP server
registry's credentials (none, OD-48) and the provider registry's credential references (none). The scan runs over B14's walker
(`collectProductionFiles`) minus tests, specs, `e2e*/`, the Playwright and vitest configs, the Playwright output folders, any
worktree inside the repository, the census and A1's inventory. Every hit is a row; every row's reader holds its name in code (a name
present only in a comment fails: `NGSPICE_BIN` at `app/api/simulate/route.ts`, `diagnostic-runner.ts` and
`model-simulation/provider.ts`); the census and A1's inventory never count as readers. **CONFIRMED** (cases 1-3).

| class | count | in `.env.example` | names (an undeclared class: each name) |
|---|---|---|---|
| `secret` | 14 | declared | the API keys, `DATABASE_URL`, the distributor credentials, the KiCad token, the SchGen token and `HF_TOKEN`, the worker secret, the MCP key, `SIRKIT_DB_QUALIFICATION_URL` |
| `configuration` | 28 | declared | the Supabase URL and keys (the older anon-key name included), the origin, the auth mode, models, pool size, role table, catalog ids, the runtime-profile pins, the FreeRouting, Java and KiCad paths, the SchGen endpoint, the deployment profile; [B24-A3, 2026-10-06] 27 -> 28: + `SIRKIT_TRUSTED_CLIENT_IP_HEADER`, the trusted proxy header of the public windows (OD-197) |
| `flag` | 14 | declared | every enable flag, off-only switch, rollout stage and shadow of A1's inventory |
| `rotation-previous` | 3 | declared | `SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS`, `KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS`, `SIRKIT_MCP_TOKEN_SECRET_PREVIOUS` |
| `fixture` | 6 | not declared: honoured only outside production | `SIRKIT_FIXTURE_AGENT`, `SIRKIT_FIXTURE_CLOCK`, `SIRKIT_FIXTURE_ROUTER`, `SIRKIT_FIXTURE_ROUTER_DUMP`, `SIRKIT_FIXTURE_ROUTER_FIXTURE`, `SIRKIT_FIXTURE_RUNTIME` |
| `qualification-opt-in` | 17 | not declared: arms an opt-in test or live run | `SIRKIT_B16_1C_RECORD_ROUTES`, `SIRKIT_DB_QUALIFICATION`, `SIRKIT_LIVE_ORCHESTRATION_EVALUATION`, `SIRKIT_LIVE_ORCHESTRATION_PROVIDER`; [B24-B3, 2026-10-08] 4 -> 16, the names B24-B3's live-suite registry reads (`app/lib/evaluation/live-suites.ts`, OD-209): `PCB_ASSIST_LIVE`, `SPICE_WORKER_LIVE`, `SIRKIT_LIVE_AUTH_QUALIFICATION`, `SIRKIT_AUTH_QUALIFICATION_PROJECT`, `SIRKIT_AUTH_QUALIFICATION_BASE_URL`, `SIRKIT_AUTH_QUALIFICATION_EMAIL`, `SIRKIT_AUTH_QUALIFICATION_PASSWORD`, `SIRKIT_AUTH_QUALIFICATION_PROJECT_ID`, `SIRKIT_AUTH_QUALIFICATION_DATABASE_URL`, `SIRKIT_LIVE_ACQUISITION_CONTRACT`, `SIRKIT_B22_LIVE_RUNNER`, `SIRKIT_B24_CORPUS_NIGHTLY`; [B24-D1, 2026-10-09] 16 -> 17, `SIRKIT_B24_BENCHMARK` (B24-D1's latency benchmark flag, a non-live gate; D16, OD-212) |
| `platform` | 12 | not declared: set by the runtime, the toolchain or the test harness | `LC_ALL`, `NEXT_RUNTIME`, `NODE_ENV`, `NODE_OPTIONS`, `SIRKIT_E2E_BASE_URL`, `SIRKIT_E2E_ORCHESTRATION_PORT`, `SIRKIT_E2E_PORT`, `TZ`; [B24-D1, 2026-10-09] 8 -> 11, `SIRKIT_B24_BENCHMARK_DIR` and `SIRKIT_JOB_STARTED_AT` (B24-D1's results directory and CI start second, tooling; D16, OD-212, OD-30) and `GITHUB_STEP_SUMMARY` (the runner's step-summary path B24-D1's headroom script and latency gate append to; no inventory entry: not a Sirkit name); [B24-D4, 2026-10-10] 11 -> 12, `SIRKIT_E2E_SKIP` (the spec globs a fixture browser run leaves out, read on `playwright.config.ts:21`; tooling; OD-30's split of page-browser-e2e, the lead's option A) |
| `child-passthrough` | 1 | not declared: handed to a child process, never read for Sirkit | `KICAD_CONFIG_HOME` |
| `not-an-environment-name` | 3 | not declared: a literal that only looks like a name | `SIRKIT_ANTHROPIC_MODEL_EMPTY`, `SIRKIT_ANTHROPIC_MODEL_PADDED` (refusal codes), `SIRKIT_D1N4148` (a SPICE model name) |

80 rows. [B24-A3 review, 2026-10-08] 80 -> 81: + `SIRKIT_TRUSTED_CLIENT_IP_HEADER` (configuration, the row above). [B24-B3, 2026-10-08] 81 -> 93: + the twelve `qualification-opt-in` names of B24-B3's live-suite registry (its row in the table above). [B24-D1, 2026-10-09] 93 -> 97: + `SIRKIT_B24_BENCHMARK` (`qualification-opt-in`), `SIRKIT_B24_BENCHMARK_DIR`, `SIRKIT_JOB_STARTED_AT` and `GITHUB_STEP_SUMMARY` (`platform`), B24-D1's three names and the runner's step-summary path its two scripts append to (the rows above). [B24-D4, 2026-10-10] 97 -> 98: + `SIRKIT_E2E_SKIP` (`platform`, the row above). `SIRKIT_AUTH_MODE` is `configuration`, declared: it is honoured only outside production (`mode.ts:36-41`) but it is a
deployment knob, never a fixture.

**The kind -> class map (D16)**, pinned as a constant by `b24-a2-env-names` case 4 and total over A1's nine kinds:

| A1 kind | census class |
|---|---|
| `enable-flag`, `disable-switch`, `rollout-stage`, `shadow` | `flag` |
| `fixture` | `fixture` |
| `live-test-gate` | `qualification-opt-in` |
| `configuration` | `configuration` |
| `secret` | `secret` (one refinement: a `secret` named `*_PREVIOUS` is `rotation-previous`) |
| `tooling` | `platform` |

`child-passthrough` and `not-an-environment-name` have no A1 kind (`KICAD_CONFIG_HOME` is not a `SIRKIT_*` name; A1 keeps
`SIRKIT_D1N4148` on its exclusion list). A1's inventory gained the two `SIRKIT_*_PREVIOUS` names as kind `secret`, appended in place
on the lines of their current names (`flag-inventory.ts:84`, `:99`, C22, C23), so its `:103` (A1's C26) holds; `b24-a1-flags` case
1's kind pin moved in place with a dated note (section 9).

**The parity.** `.env.example` declares every name of a declared class exactly once, as `NAME=` or `# NAME=`, and every declaration
line names a census row; no name of an undeclared class is declared. The 36 missing declarations are appended after its last line at
`1b2c08c` (`:93`), each a commented assignment with no value, grouped and commented by class, so no existing line moves
(`b20-b2-mcp-access-token :294-299`, `b20-a0-feature-flag :105-112`, `runtime-profile.ts:452`, the discovery's `:6-79` hold).
**CONFIRMED** (cases 6-8). OD-195 as applied narrows its default: "`.env.example` declares every name the code reads" -> ".env.example
declares every name of a declared class", with every undeclared name listed by class above.

**B24-D1's three names** (`SIRKIT_B24_BENCHMARK`, `SIRKIT_B24_BENCHMARK_DIR`, `SIRKIT_JOB_STARTED_AT`) are D1's rows: no file reads
them at A2's tree, and a row whose reader does not hold its name fails. They will take `qualification-opt-in` (the gate,
`live-test-gate`) and `platform` (`SIRKIT_JOB_STARTED_AT`, `tooling`; `SIRKIT_B24_BENCHMARK_DIR` takes the class of the kind D1
records) through the map: both undeclared, so they need no new class and no `.env.example` line (case 5). [B24-D1, 2026-10-09] Landed: the three rows are in the census (`app/lib/deployment/environment-names.ts`, appended on an existing line), `SIRKIT_B24_BENCHMARK` as `qualification-opt-in` (read by `app/lib/qualification/latency-results-writer.ts`), `SIRKIT_B24_BENCHMARK_DIR` as `platform` (the same writer) and `SIRKIT_JOB_STARTED_AT` as `platform` (`scripts/ci-job-headroom.ts`); `.env.example` is unchanged.

## 6. The secret scan (D24-4, OD-195, runbook `:168`)

`runSecretScan` (`app/lib/deployment/secret-scan.ts`, C24, C25) is pure: `{ path, text }` entries in, `lines` of the form
`path:line rule` out - never the matched text - with exit code 1 on any hit the allowlist does not hold, and the entries over 4 MiB
(4,194,304 bytes; the largest tracked file is about 1 MiB) skipped and counted.

**No file is skipped for a NUL byte** ([B24-A2 review, 2026-10-06] security-1). Before the review a NUL byte skipped a whole file as
binary and the run still exited 0, so three tracked TypeScript files holding raw NULs - `app/lib/engineering/pcb-delta.ts`
(production code, its `.join` separators) and two tests - and any UTF-16 text were never scanned in any mode. Now each file is read
as UTF-16 when it opens with that byte-order mark (little or big endian) and as UTF-8 otherwise (`decodeScanText`, C28), and a line
holding a NUL byte is matched as it is and with its NULs dropped (C29), which catches BOM-less UTF-16 too; binary files are scanned
like any other. A blob git does not return - `cat-file --batch-check` answers `missing`, or `--batch` leaves it out - is counted,
named as `unscanned: <path>` and fails the run (C30, C25); before, it was dropped, or scanned as empty. `b24-a2-secret-scan` (i) and
(j), **CONFIRMED**; the tree run of section 10 scanned the 32 PNGs, the favicon and the three .ts files it used to skip, with no hit.

The rules are closed (`SECRET_SCAN_RULES`), each stated in words here, never as a matching literal:

| rule | what it looks for |
|---|---|
| `pem-private-key` | a PEM private-key marker line: BEGIN, optional capitals and spaces, then the PRIVATE KEY form or the PRIVATE KEY BLOCK form |
| `anthropic-key-shape` | the Anthropic key prefix followed by at least 20 key characters (restated from `source-registry.ts:592` and `server-registry.ts:360`) |
| `openai-key-shape` | the OpenAI key prefix followed by at least 32 letters or digits (the same source); [B24-A2 review] security-2: or its project, service-account or admin form - the prefix at a word start, the form's word and a dash, then at least 20 key characters |
| `github-token-shape` | a GitHub personal-token prefix followed by 36 letters or digits (the same source); [B24-A2 review] security-2: or the OAuth, user, server or refresh prefix the same way, or the fine-grained prefix followed by at least 60 key characters |
| `aws-access-key-id-shape` | an AWS access key id: its four-capital prefix and 16 capitals or digits (the same source) |
| `huggingface-token-shape` | a Hugging Face token prefix followed by at least 30 letters or digits (the same source) |
| `jwt-shape` | two base64url segments of at least 20 characters joined by a dot, the first opening a JSON object (the same source) |
| `supabase-secret-key-shape` | the Supabase secret-key prefix followed by at least 20 key characters; the bare prefix is no hit (no file holds it) |
| `connection-string-password` | [B24-A2 review] security-2: a database URL (a Postgres, MySQL, MariaDB, MongoDB, Redis or AMQP scheme) holding a password of at least 6 characters, either assigned to a name ending in `_URL` (`DATABASE_URL` and `SIRKIT_DB_QUALIFICATION_URL` are the project's two connection-string secrets) or, for Postgres, naming a Supabase host; a password written as an angle-bracket placeholder (the form of `docs/SCHEMA.md:45`) is no hit |

The connection-string rule is scoped: a bare user-and-password URL rule hits some 25 test sentinel lines and a production comment
(`app/lib/agent/redaction.ts:25`), so it looks only where the project's real connection strings would stand (OD-224 (g)).
`b24-a2-secret-scan` (h) holds a hit for each new form and a miss for a word that only contains a prefix, a too-short key, a
placeholder password, a short password and an https URL with userinfo, **CONFIRMED**.

No rule matches its own statement: each pattern puts a quantifier or a character class where a literal would stand, every test
marker is assembled at run time (the `b21-e3-resume-record.test.ts:223` precedent), and scanning the scanner, its allowlist, the
script, `b24-a2-secret-scan` and this page gives zero hits with no allowlist entry (case d, **CONFIRMED**).

**The allowlist** (`app/lib/deployment/secret-scan-allowlist.ts`, C26): exact paths only - a glob, a directory, an absolute or
climbing path is refused - each with a rule, the sha256 of the line's text and a reason. An edited line hits again; in tree mode an
entry whose line no longer hits fails as stale (a `--staged` or `--history` run sees part of the tree, so it skips that check). An
entry holds one path and one rule: the same line copied to another path, or hitting another rule, is a hit ([B24-A2 review]
tests-3, case b2). It holds the six test sentinels of the task's Lead note 2 and, since the review round, the two test fakes the
connection-string rule hits (C31), each read in its test first and characterised by length only ([B24-A2F, 2026-10-09] and a ninth entry of the history-only kind, exempt from the stale check and allowlisting the history scan alone, for `app/lib/qualification/__tests__/b24-c3-trace-read.test.ts` as committed at `ba4f562:75` and rewritten at `aaa6a1b`: section 15):

| path | rule | reason |
|---|---|---|
| `app/lib/mcp/server/__tests__/b20-c3-descriptor-text-gate.test.ts` | `pem-private-key` | the gate's `marker pem` case: a bare marker string, no key material |
| `app/lib/agent/__tests__/b11-1-trace-integrity.test.ts` | `anthropic-key-shape` | a 27-character fake inside an object key the trace validator must not echo |
| `app/lib/agent/__tests__/b11-1-trace-integrity.test.ts` | `anthropic-key-shape` | a 29-character fake on a prototype the capsule validator must refuse unread |
| `app/lib/agent/__tests__/b11-1-trace-integrity.test.ts` | `anthropic-key-shape` | a 27-character fake inside an object key the capsule validator must not echo |
| `app/lib/agent/__tests__/b11-1-trace-integrity.test.ts` | `aws-access-key-id-shape` | a 20-character fake in a JSON credential field the classifier must flag |
| `app/lib/agent/__tests__/b11-trace-replay-evaluation.test.ts` | `anthropic-key-shape` | a 29-character fake the recorder must redact |
| `app/api/__tests__/b16-0-12-tranche-parity.test.ts` | `connection-string-password` | a 66-character line: a database URL whose password is a named SENTINEL, stubbed so the runtime report can be checked for it |
| `app/lib/db/__tests__/b16-b-database-qualification.test.ts` | `connection-string-password` | a 120-character line: a pooler URL for a project named deadtenant that does not resolve, which the qualification must refuse |

**The three modes** (`scripts/scan-secrets.ts`, C27; the only file that runs git, each call `execFileSync` with an argument array and
no shell, the `scripts/benchmark.ts` precedent; nothing is written; its exit is the scan's, `process.exitCode = result.exitCode;` once
and last, C32, [B24-A2 review] tests-2, case f2):
- `pnpm exec tsx scripts/scan-secrets.ts` - tree mode: `git ls-files -z --cached --others --exclude-standard` (tracked, and new files
  not yet staged), each regular file read from disk; the stale-entry check runs.
- `pnpm exec tsx scripts/scan-secrets.ts --staged` - the staged blobs: `git diff --cached --raw -z --no-renames --no-abbrev` (no diff
  filter since the review round, so a staged deletion counts as something staged), then the index blobs through `git cat-file
  --batch-check` and `--batch`. [B24-A2 review] security-3: an index with no staged change is `nothing scanned`, exit 1 (C33) - it
  used to exit 0 having read nothing. Run it before the commit; after the commit, before the push, scan the commits not yet pushed
  with `pnpm exec tsx scripts/scan-secrets.ts --history origin/<branch>..HEAD` (this chapter:
  `--history origin/chapter/b24-production-qualification..HEAD`).
- `pnpm exec tsx scripts/scan-secrets.ts --history <range>` - `git rev-list --reverse <range> --`, then for each commit
  `git diff-tree -r -m --root --no-renames --no-abbrev -z <commit>`: the regular-file blobs it adds or changes against each parent,
  merges included; deletions, links and submodules are not read. One entry per blob and path, under the first commit of the range
  that brought that blob to that path, as git's `<commit>:<path>`; each blob read once; a blob over the bound is never read. An
  output line is `<commit>:<path>:<line> <rule>`, never the text; the allowlist matches by the `<path>` part, the rule and the line
  digest. A missing range, or one beginning with `-`, is refused before any git call (exit 2); a range with no commit is `nothing
  scanned`, exit 1 (C34).

The flags were checked on the installed `git version 2.55.0.windows.3`: `diff-tree -r -m --root --no-renames -z` printed a
commit-id header per parent with a diff (a merge's second parent with an equal tree prints none), then
`:<srcmode> <dstmode> <src> <dst> <status>` and the path, NUL-separated, full ids (**CONFIRMED**, read on `1b2c08c` and `57c3b29`);
`rev-list --reverse`, `cat-file --batch-check` and `--batch` answered as parsed in the history run of section 10 (63 entries over
`57c3b29..HEAD`, **CONFIRMED**). The `--staged` form uses git's same raw format (**INFERRED**: this tree's index is empty, and the
review round's `--staged` run answered `nothing scanned` with exit 1, section 10; the lead's `--staged` run before the commit is the
first over content).

**In CI** ([B24-A2 review, 2026-10-06] security-3): the `secret-scan` job checks out the whole history (`fetch-depth: 0`), runs
tree mode on every event and, on a pull request, also runs
`pnpm exec tsx scripts/scan-secrets.ts --history "$BASE_SHA..$HEAD_SHA"` over every commit of it (`BASE_SHA` and `HEAD_SHA` from the
pull request's base and head, set as step environment, never spliced into the command). A secret added in one commit and deleted
in a later one of the same pull request no longer passes, before a merge commit would keep it in main's history; a key pushed on
its own is still exposed on the branch once pushed (the scan reports it, it cannot unexpose it). **PROPOSED** until the job's first
CI run; its shape is **CONFIRMED** (`b24-a2-secret-scan` c, k).

**For the closeout's `SECRETS EXPOSED`** (D5): on main after the B24 merge, `pnpm exec tsx scripts/scan-secrets.ts --history main`
scans every commit reachable from main, the root included (`--root`). A hit outside the allowlist goes to the lead as
`<commit>:<path>:<line> <rule>` only, never printed further, never allowlisted: removing it from the tree does not unexpose it, and
rotating a real secret is the owner's (LB-13). B24-F records the method; this increment ran only
`pnpm exec tsx scripts/scan-secrets.ts --history 57c3b29..HEAD` (section 10). In every mode a hit is reported as path:line rule
only.

## 7. CI

- **`secret-scan`**, a new job appended after every existing job (A1's `production-smoke` included), so no cited line moves: it
  inherits `permissions: contents: read`, checks out the whole history (`fetch-depth: 0`), sets up pnpm and node 24, installs, runs
  `pnpm exec tsx scripts/scan-secrets.ts` (tree mode) and, on a pull request only, the history step over the pull request's commits
  (section 6). The file still has exactly two lines containing `playwright test` (`b21-f-page.test.ts:259-267`). [B24-D4, 2026-10-10] Superseded: three - B24-D4 appended `page-browser-e2e-b24`, whose run line names the four moved specs ([B24-D4 lead, 2026-10-10] the lead's option (b): B24-D2's two, then B24-D3's two; OD-30's split, `ci-split.md` section 11); `b24-a2-secret-scan` (c) and `b21-f-page` 10 moved in place. **PROPOSED** until
  its first CI run; its shape is **CONFIRMED** (`b24-a2-secret-scan` c, k). Its row in A1's insertion table is `:447`, 26 lines (18
  before the review round's eight).
- **`production-smoke`** (A1's job, **PROPOSED** until its first CI run) gains probes in place, after A1's last probe (its row in
  A1's insertion table: `:420`, 11 lines): every security header with its exact value and `X-Powered-By` absent on `/`,
  `/api/ai/runtime`, `/api/health` and `/favicon.ico` ([B24-A2 review, 2026-10-06] coverage-4: `/` was missing from this list), and
  HSTS absent - the job builds with no `SIRKIT_EXPECTED_ORIGIN` (its http origin is set only for `next start`), so HSTS is absent by
  the build-time reading; the https case is the unit suite's (case 2). The probes are pinned by content ([B24-A2 review] tests-5,
  `b24-a2-headers` 9): the path list, each expected `name: value` line equal to the builder's output for the job's origin, the
  failing branch of a missing or different header, and the two refusals.
- The suites run in prompt-to-gerber through A1's directory filter (`app/lib/qualification/__tests__`); none starts PGlite.

## 8. Test-first record

| run | tree | result |
|---|---|---|
| red 1 | `1b2c08c` + the five suites (and the spec's additions) only | 5 files failed: three failed to load (`Cannot find module` for `deployment/environment-names`, `deployment/auth-url-allowlist`, `deployment/secret-scan`); `b24-a2-headers` and `b24-a2-secret-rotation` 15 failed, 1 passed (16); vitest exit 1 |
| red 2 | + the new modules (census, origin function, scanner, allowlist, script), no existing file edited | 5 files failed; 26 failed, 16 passed (42); exit 1 - each counterexample for its reason (below) |
| green | the increment | 43 / 43 at the review baseline (the five suites) |
| review baseline | the increment as the review read it | the five suites green; `b24-a1-environment-profile` case 16 red - `expected [ …(15) ] to have a length of 13 but got 15` at `:633` (73 tests, 1 failed; exit 1) |
| review red | + the review round's 15 new cases, no source edited | 5 files failed; 13 failed, 45 passed (58); exit 1 - each counterexample for its reason (below) |
| review mutations | eight deliberate breakages of the source, one or two at a time, each restored by hash | each caught by its new case (below) |
| review green | the review round's fixes | section 10 |

The counterexamples in red 1 and red 2:
- `securityHeaders` did not exist and `:6` had no `poweredByHeader` (`b24-a2-headers` 1-4);
- with the previous worker secret set, its bearer was refused; with the previous KiCad token set, it was answered 401; a token signed
  under the old MCP key was `bad_signature` with the previous key set, and a current MCP key equal to the previous worker secret
  configured the endpoint (`b24-a2-secret-rotation` 1, 3, 5, 6); the in-place lines were the old single compares (2, 4, 8);
- 51 names were read and not declared in `.env.example`, 33 of them of a declared class; no name was pinned declared
  (`b24-a2-env-names` 6, 8); A1's inventory had no `_PREVIOUS` entry (4);
- the workflow's last job was `production-smoke` (`b24-a2-secret-scan` c); no page existed (every page case).

**The review round** ([B24-A2 review, 2026-10-06]; 16 confirmed findings, 14 distinct). Red on the tree the review read, each for its
reason:
- security-1: a UTF-8 source holding raw NULs (`pcb-delta.ts` with a planted marker), UTF-16 with and without a byte-order mark and
  a binary file holding a key gave no line (`b24-a2-secret-scan` i: `expected [] to deeply equal [ …(5) ]`); a blob git reported
  missing, or did not return, was dropped or scanned as empty (j: no `unscanned` line);
- security-2: an OpenAI project key, GitHub's other tokens and the two connection-string forms gave no line (h: `hit 0: expected []`);
- security-3: an empty `--staged` run and a `--history` range with no commit exited 0 (k: `expected +0 to be 1`); the CI job had no
  history step;
- security-4: neither `.env.example` nor section 4 said what to do after a leak, or gave a maximum window (`b24-a2-secret-rotation`
  11);
- regressions-3, coverage-5: A1's page section 3 still said 49 names and secret (3) (`b24-a2-env-names` 10);
- coverage-2: section 13 held one sentence (`b24-a2-headers` 11: 339 characters); coverage-3: section 10 held no gate run (12);
  coverage-4: section 7 left out `/`, section 1 said "an http origin at build time" (10), and section 3 said OD-224 where the module
  says OD-196 (`b24-a2-origin-allowlist` 7);
- `b24-a2-headers` 8 failed on its it( counts (12 against the page's 8), moved with section 10; `b24-a2-headers` 9 failed once on a
  slicing bug of its own (it read up to `production-smoke`'s earlier `done`), fixed before any source change, then green on the
  unchanged workflow;
- regressions-1, coverage-1, tests-1 (one defect): `b24-a1-environment-profile` case 16, red as above - a STOP for the lead, not
  fixable from A2 (section 13, "The case-16 STOP").

The test-strength findings, green on the unchanged source and red under a deliberate breakage, each restored byte for byte (sha256
before and after equal; `b24/fix/mutate.py` in the session scratchpad):

| breakage | finding | caught by |
|---|---|---|
| M1: the script's `process.exitCode = result.exitCode;` deleted | tests-2 | `b24-a2-secret-scan` f2 (`expected [] to have a length of 1`) |
| M2: the allowlist match ignores the path | tests-3 | b2 (the copied line allowlisted: exit 0) |
| M3: the allowlist match ignores the rule | tests-3 | b2 (another rule's entry allowlisted the line) |
| M4: a missing or different header no longer fails `production-smoke` (its failing branch replaced by `true`) | tests-5 | `b24-a2-headers` 9 |
| M5: `/` dropped from `production-smoke`'s loop | tests-5 | `b24-a2-headers` 9 (`expected '/api/ai/runtime' to be '/'`) |
| M6: the MCP wrapper hands its verifier an environment without the previous key | coverage-7, tests-6 | `b24-a2-secret-rotation` 10 (401 where 200 was due); case 5 stayed green |
| M7: an oversized blob is read after all (after the fix) | tests-4 | `b24-a2-secret-scan` j (the blob asked of `--batch`) |
| M8: an oversized blob no longer told apart (after the fix) | tests-4 | j (`expected +0 to be 1`, oversized) |

## 9. Every pin moved, and why

| pin | move | why |
|---|---|---|
| `b24-a1-flags.test.ts` case 1, `:217` (the `secret` kind list) and `:220` (`toHaveLength`) | + `SIRKIT_MCP_TOKEN_SECRET_PREVIOUS`, `SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS`; 49 -> 51; in place, dated `[B24-A2, 2026-10-06]` | D16: the case's own comment makes a new name a reviewed move of this pin; A1's census turns red when A2 reads the two names |
| `flag-inventory.ts:84`, `:99` | the two entries appended on the lines of their current names, dated | the inventory stays sorted and its `:103` (A1's C26) holds |
| `environments-and-deployment.md` section 3 (`:106`, `:109`) | dated `[B24-A2, 2026-10-06]` notes at the ends of the lines: 49 -> 51, secret (3) -> secret (5) | [B24-A2 review] regressions-3, coverage-5: A1's page stated a count the code no longer holds; no line moves |
| `environments-and-deployment.md` section 10, A2's own `secret-scan` row | `:447` 18 -> 26 (this increment's row, uncommitted; no earlier row edited) | [B24-A2 review] security-3: the job gained `fetch-depth: 0` (2 lines) and the pull request's history step (6 lines) |
| `next.config.ts:6`, `:8`, `:10` | in place; the builder after `:14` | deliverable 1; `:3-12`, `:9-11` keep their lines |
| `worker-principal.ts:54`; `server-auth.ts:12-13`; `mcp-bearer.ts:29`, `:189`, `:194`, `:276` | in place, each dated; helpers appended after each file's last line | `worker-principal.ts:49-55`, `server-auth.ts:4-14`, `mcp-bearer.ts:14-16, :35-36, :39-40, :42, :47-48, :182-183` and B20's C19 (`mcp-bearer.ts:302`) keep their lines |
| `.env.example` | 75 lines appended after `:93`; [B24-A2 review] the rotation comment in that block rewritten, 5 -> 8 lines (C35) | no existing line moves |
| `e2e/security-headers.spec.ts` | appended after `:21` | `:12-21` keep their bytes |
| `b24-a2-secret-scan` (a), (a2), (c), (d), (e4) | in place, each with a dated `[B24-A2 review, 2026-10-06]` note: the rule ids and sources (security-2), no binary count and an entry holding a NUL scanned (security-1), the job's sixth step (security-3), the allowlist six -> eight (security-2), the staged diff without `--diff-filter` (security-3) | A2's own suite, moved with the rules it pins |
| `b24-a2-secret-scan` (f) | a local variable `module` renamed `scanner`, dated | eslint's `@next/next/no-assign-module-variable`; no assertion changed |

Unmoved, as required: 168 / 165 / 3 / 0; 47 / 36 / 9 / 27; 107 action records; 631 / 63; the 555 release identity; the nine
B11-scanned files; the pinned release bytes. No workflow line any page cites moved (every A2 workflow line lies below `:356`).

## 10. Gates

| suite | `it(` ([B24-A2F, 2026-10-09] `b24-a2-secret-scan` 18 -> 24: section 15's six cases, l-q; [B24-A2F review, 2026-10-09] `b24-a2-headers` 12 -> 13 and `b24-a2-secret-scan` 24 -> 26: the review round's cases 13, r and s) |
|---|---|
| `app/lib/qualification/__tests__/b24-a2-headers.test.ts` | 13 |
| `app/lib/qualification/__tests__/b24-a2-origin-allowlist.test.ts` | 7 |
| `app/lib/qualification/__tests__/b24-a2-secret-rotation.test.ts` | 11 |
| `app/lib/qualification/__tests__/b24-a2-env-names.test.ts` | 10 |
| `app/lib/qualification/__tests__/b24-a2-secret-scan.test.ts` | 26 |

[B24-A2 review, 2026-10-06] coverage-3: the gate runs of the review round's final tree, every vitest run through the lock script
(two workers, one at a time), tsc, eslint, the generators and the scans through the heavy-job script; **CONFIRMED** by execution:

| gate | result | exit |
|---|---|---|
| `app/lib/qualification/__tests__` | 9 files, 113 tests: 112 passed, 1 failed - `b24-a1-environment-profile` case 16, the STOP (section 13); the five A2 suites 58 / 58 | exit 1 |
| `app/lib/auth/__tests__` | 41 files; 479 passed, 9 skipped (488); 110 s | exit 0 |
| `app/api/__tests__` | 27 files, 1,059 / 1,059 passed; vitest exit 1 on one unhandled `Timeout calling "onTaskUpdate"`: `b16-0-identity-header-gate` held the worker 60.3 s. Run alone: 6 / 6 passed in 65.1 s, the same error, exit 1. Not loosened; it is B16.0's file, not A2's, and it took 16-17 s on this machine at 04:05 and 05:14 today and 52-53 s in A2's first runs (13:07, 13:45), so the slowdown predates this round (**INFERRED**: the machine's state; for the lead) | exit 1 |
| `app/api/mcp/__tests__` | 7 files, 95 / 95 | exit 0 |
| `app/lib/mcp` | 45 files, 825 / 825 (`b20-b4-process-gate` among them); 208 s | exit 0 |
| `app/lib/atomic/__tests__/kicad-http-route.test.ts` | 3 / 3 | exit 0 |
| `app/lib/atomic/__tests__/b19-e-atomic-revision-loaders.test.ts` | 16 / 16 on PGlite, alone, no browser run beside it | exit 0 |
| `app/components/chat/__tests__/b19-d-chat-markdown.test.tsx` | 14 / 14 | exit 0 |
| `app/lib/project/__tests__/b14-4-ast-import-gates.test.ts` | 22 / 22; 70 s | exit 0 |
| `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 14 / 14 | exit 0 |
| `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` | 18 / 18 (no new test file spells a write primitive) | exit 0 |
| `app/lib/agent/orchestration/__tests__` | 49 files, 460 / 460 (`b21-closeout-statements` and `b21-f-page` among them) | exit 0 |
| `app/lib/computation/__tests__` | 26 files passed, 2 skipped; 300 passed, 18 skipped (`b22-closeout-statements`, `b22-a2-process-census` and `b22-a1-page` among them) | exit 0 |
| `app/lib/manufacturing-providers/__tests__` | 29 files, 387 / 387 (`b23-closeout-statements`, `b23-a-provider-admission` and `b23-b-dfm-quote-flow-page` among them); B23-D's physical-evidence case 8 green in 37.1 s (in the implementer's run it timed out after 2,271,061 ms) | exit 0 |
| `tsc` | `--noEmit -p tsconfig.json`: 0 errors, after the last .ts edit | exit 0 |
| `eslint` | the 17 changed .ts files: the first run found 1 error, in A2's own case (f) from before the review (a variable named `module`), renamed `scanner`; the second run 0 problems | exit 0 |
| `generate-action-toolability-matrix` | ran; zero drift (status, diff and untracked-file hashes equal before and after the three generators) | exit 0 |
| `generate-agent-artifacts` | ran; zero drift | exit 0 |
| `generate-b17-control-inventory` | ran; zero drift | exit 0 |
| `scan tree` | `pnpm exec tsx scripts/scan-secrets.ts`: 4,034 entries, 0 oversized, 0 unscanned, 8 allowlisted, no hit - the 32 PNGs, the favicon and the three NUL-bearing .ts files the old rule skipped among the scanned | exit 0 |
| `scan --staged` | `pnpm exec tsx scripts/scan-secrets.ts --staged` on this tree's empty index: `nothing scanned` (the review round's rule; it answered 0 before) | exit 1 |
| `scan --history 57c3b29..HEAD` | `pnpm exec tsx scripts/scan-secrets.ts --history 57c3b29..HEAD`: 2 commits (`8664964`, `1b2c08c`), 63 entries, 0 oversized, 0 unscanned, no hit | exit 0 |

The three closeout tripwires ran inside their directories on this page before this table and the ledger's gate line were filled in;
they were re-run alone, with the qualification suites, on the final page (the report to the lead).

The browser and production-mode runs (both Playwright configs, `e2e/security-headers.spec.ts` among them, and the local
production-mode run of `production-smoke`'s probes) are the lead's: the builder runs no `next dev`, `next build`, `next start` or
Playwright (section 13).

## 11. Live: BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13)

- The real edge's headers, HSTS and TLS: **BLOCKED-LIVE-QUALIFICATION** (LB-13); the headers are proven by the unit suite and, once
  the lead runs them, the dev browser spec and `production-smoke` - never by a deployed host.
- The Supabase Site URL, redirect list and email templates of a staging or production project: **BLOCKED-LIVE-QUALIFICATION** (LB-1,
  LB-13); the required values are recorded per environment (section 3).
- A real secret rotation: **BLOCKED-LIVE-QUALIFICATION** (LB-13); the procedure is written (section 4) and proven offline.
- No `.env*` value was read; the main Supabase project is production (OD-191) and was not contacted.

## 12. What stays open

**INFERRED** unless stated; recorded rather than fixed:
- The builder sits in `next.config.ts` (the fallback); once the lead's `next dev` and `next build` runs prove a relative import, it can
  move to `app/lib/deployment/security-headers.ts` with the config importing it.
- The report-only directives stay report-only until the owner accepts an enforced policy (OD-196); `next dev` reports violations a
  production build would not.
- `/api/ready` still shares the worker secret with the three worker write routes (A1's OD-198 record); a separate readiness
  credential is not built here and stays the owner's choice.
- The census scan cannot see a name read through a computed key built from an unprefixed literal (for example the benchmark runner's
  presence probe of `CI`, `TZ` and `LANG`); such a read is outside its rules, as stated.
- The `--staged` mode has run on this tree's empty index only (`nothing scanned`, exit 1, section 10); the lead's run before the commit
  is its first over content (section 6).
- [B24-A2 review, 2026-10-06] security-4: nothing reports whether a `_PREVIOUS` value is set, and nothing enforces the seven days.
  Reporting presence (set or unset, never the value) would change A1's configuration record and its pinned suite, which A2 does not
  edit; it is offered to the lead (OD-224 (f)).
- [B24-A2 review] security-2: the connection-string rule looks only at an assignment to a `*_URL` name and at a Supabase host; a
  database URL with a password written elsewhere (another variable name, another host) is outside its rules, as stated (section 6).
- [B24-A2 review] security-3: the history step runs on pull requests; a commit pushed to main without a pull request is covered by
  tree mode only, and a secret pushed to a branch is exposed there before any scan runs (the scan reports, it cannot unexpose).
- [B24-A2 review] the served `/` in `production-smoke` passes through `proxy.ts`; whether Next's header rule also applies when the
  proxy answers with a redirect is shown only by the lead's local production-mode run and the first CI run.
- B24-A1's `b24-a1-environment-profile` case 16 simulates the planned workflow edits on top of the tree as it stands; with A2's real
  edits and rows in place it applies A2's plan a second time - a STOP for the lead, with the proposed reviewed move written in
  section 13 ("The case-16 STOP").

[B24-A2 lead, 2026-10-06] The independent check of the review round's fixes raised three low issues, recorded here rather than in
another round (none blocks a later increment):
- **The PR history step against tree mode's stale-entry check.** A pull request whose commits hold an allowlisted fake line that its
  final tree no longer has would make one of the two fail. INFERRED; this branch's `--history 57c3b29..HEAD` run had no hit.
- **The connection-string-password rule** backtracks in quadratic time on long runs of capitals, digits or underscores. INFERRED; a
  bound or an atomic form is later work.
- **Case (i) of `b24-a2-secret-scan`** asserts that an unrelated production file, `app/lib/engineering/pcb-delta.ts`, still holds raw NUL
  bytes; a change that removes them moves that pin by review. RECORDED
- **A one-off stall.** In A2's first implementer run the `app/lib/manufacturing-providers/__tests__` gate held B23-D case 8 for about
  2,271 s; the fix round's run of the same set passed 387 of 387. Not reproduced; cause UNKNOWN.

[B24-A2 lead, 2026-10-06] **The framing case, fixed by the lead after the browser run.** As reviewed, it waited for a page response
event for the framed navigation, which Chromium does not emit for a document it refuses to frame: the case failed alone and in the
full default configuration (180 s timeout; `a2-browser-default`, `a2-browser-framing`). It now reads the headers by a direct request
and adds a positive control (`/` loaded directly shows Sirkit's layout body, so the frame check would see a document wrongly allowed);
the frame check is unchanged. The spec alone: 8 of 8 (`a2-browser-framing2`). Its four added lines move citation C8 (the
report-only case) from `:81` to `:85`, in place in section 14. The default configuration was 53 of 54 before the fix
(10.3 min) and the orchestration configuration 4 of 4 (2.6 min). CONFIRMED

## 13. For the lead

Written out in full here and in the report to the lead ([B24-A2 review, 2026-10-06] coverage-2: before the review round this section
held one sentence). Every OD number was read off the register at `1b2c08c`: its last heading is OD-223 (`OWNER_DECISIONS.md:2604`,
B24-A1's), so A2's own entry is OD-224; OD-195 and OD-196 have no heading there yet (the register's B24 headings are OD-190, OD-198,
OD-199, OD-200, OD-222, OD-217 and OD-223), so each gets one, never a second.

### Closure clauses (each one dated line under its defect in `discovery.md`)

Under D24-4 after its re-verification note (`:580`), under D24-5 (`:586`) and under D24-6 (`:592`), bottom-up so the numbers given
hold:

- [B24-A2, 2026-10-06] D24-4: closed offline by B24-A2 - the worker secret, the KiCad library token and the MCP signing key each take a `*_PREVIOUS` value that only verifies (both compares in constant time before one answer; never signing, minting or configuring; the MCP previous key within the current key's bounds and separation), with the procedure written for a planned rotation (at most seven days; the MCP key at least 3,630 s) and for a suspected leak (no previous value, the outage accepted) (`b24-a2-secret-rotation`); the environment-name census (80 rows, nine closed classes) with `.env.example` declaring every name of a declared class exactly once (`b24-a2-env-names`); the secret scan (closed rules, a reviewed eight-line allowlist, tree, `--staged` and `--history` modes) in the `secret-scan` CI job on the tree and on every commit of a pull request, PROPOSED until its first CI run (`b24-a2-secret-scan`); B23's webhook secret and provider credential header recorded as single-valued (OD-195); rotating real deployed secrets BLOCKED-LIVE-QUALIFICATION (LB-13).
- [B24-A2, 2026-10-06] D24-5: closed offline by B24-A2 - six security headers on every path from one pure builder (`frame-ancestors 'none'` beside the unchanged image directive, `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`, a five-feature `Permissions-Policy`, a report-only `default-src`/`script-src`/`connect-src`/`object-src`/`base-uri` policy), HSTS `max-age=31536000` only for an https `SIRKIT_EXPECTED_ORIGIN` read at build time, and `poweredByHeader: false` (`b24-a2-headers`); the served proof (`e2e/security-headers.spec.ts`, the `production-smoke` probes) PROPOSED until the lead's browser run, local production-mode run and first CI run are green; the edge half BLOCKED-LIVE-QUALIFICATION (LB-13).
- [B24-A2, 2026-10-06] D24-6: recorded by B24-A2 - the Supabase Site URL (the deployment's one origin, normalised) and redirect allowlist (exactly `<origin>/api/auth/callback`, no wildcard, no second host) per profile, an http origin refused off loopback for staging and production (`supabaseAuthUrls`, `b24-a2-origin-allowlist`); one origin per deployment, no multi-origin list (OD-196); the app starts no Supabase flow that redirects to the callback; the project's Site URL, redirect list and email templates UNKNOWN, and their verification BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13).

### The OD entries for `OWNER_DECISIONS.md` (appended after `:2621`, the end of OD-223)

In the register each heading is `## OD-NNN — <title>, as applied (B24-A2, 2026-10-06)`; written here one level down.

### OD-195 — Secrets management and rotation, as applied (B24-A2, 2026-10-06)

- **Default applied:** no secret manager (OD-42): plain environment variables read at call time. The worker secret, the KiCad library token and the MCP signing key each accept an optional previous value - `SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS`, `KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS`, `SIRKIT_MCP_TOKEN_SECRET_PREVIOUS` - for verification only: both values compared in constant time before one answer; a previous value alone configures nothing; signing, minting and the resource configuration use the current MCP key only; the MCP header stays byte-identical (no `kid`), and no refusal code or bound is added; key separation covers the previous values. A planned rotation keeps the previous value until every holder has moved and at most seven days, the MCP key at least 3,630 s; after a suspected leak the value is replaced with no previous value, the outage accepted. Narrowed as applied, old -> new: "`.env.example` declares every name the code reads" -> "`.env.example` declares every name of a declared class" (`secret`, `configuration`, `flag`, `rotation-previous`: 58 names, each exactly once, the ten B22/B23 names among them). The census (`app/lib/deployment/environment-names.ts`, 80 rows) lists the 22 names read and not declared, by class: `fixture` (honoured only outside production) - `SIRKIT_FIXTURE_AGENT`, `SIRKIT_FIXTURE_CLOCK`, `SIRKIT_FIXTURE_ROUTER`, `SIRKIT_FIXTURE_ROUTER_DUMP`, `SIRKIT_FIXTURE_ROUTER_FIXTURE`, `SIRKIT_FIXTURE_RUNTIME`; `qualification-opt-in` (arms an opt-in test or live run) - `SIRKIT_B16_1C_RECORD_ROUTES`, `SIRKIT_DB_QUALIFICATION`, `SIRKIT_LIVE_ORCHESTRATION_EVALUATION`, `SIRKIT_LIVE_ORCHESTRATION_PROVIDER`; `platform` (set by the runtime, the toolchain or the test harness) - `LC_ALL`, `NEXT_RUNTIME`, `NODE_ENV`, `NODE_OPTIONS`, `SIRKIT_E2E_BASE_URL`, `SIRKIT_E2E_ORCHESTRATION_PORT`, `SIRKIT_E2E_PORT`, `TZ`; `child-passthrough` (handed to a child process) - `KICAD_CONFIG_HOME`; `not-an-environment-name` (a literal that only looks like one) - `SIRKIT_ANTHROPIC_MODEL_EMPTY`, `SIRKIT_ANTHROPIC_MODEL_PADDED`, `SIRKIT_D1N4148`. B23-C's caller-supplied webhook secret (`order-contract.ts:107`, its one use `:295`; `webhook-verification.ts:29-30, :74`) and B23-B2's provider credential header (`provider-egress.ts:198-201`) are recorded as single-valued: the webhook secret unwired, the header reached only past admission, no transfer descriptor (`PROVIDER_TRANSFER_DESCRIPTORS` empty, `:69`). The CI step is the `secret-scan` job: tree mode on every run and every commit of a pull request, over closed rules (PEM private-key markers, the provider key shapes, the Supabase secret-key shape, the project's connection strings) with a reviewed allowlist of eight test fakes; PROPOSED until its first CI run. Rotating real deployed secrets BLOCKED-LIVE-QUALIFICATION (LB-13). [B24-B3, 2026-10-08] `qualification-opt-in` gains the twelve names B24-B3's live-suite registry (`app/lib/evaluation/live-suites.ts`, OD-209) reads: `PCB_ASSIST_LIVE`, `SPICE_WORKER_LIVE`, `SIRKIT_LIVE_AUTH_QUALIFICATION`, `SIRKIT_AUTH_QUALIFICATION_PROJECT`, `SIRKIT_AUTH_QUALIFICATION_BASE_URL`, `SIRKIT_AUTH_QUALIFICATION_EMAIL`, `SIRKIT_AUTH_QUALIFICATION_PASSWORD`, `SIRKIT_AUTH_QUALIFICATION_PROJECT_ID`, `SIRKIT_AUTH_QUALIFICATION_DATABASE_URL`, `SIRKIT_LIVE_ACQUISITION_CONTRACT`, `SIRKIT_B22_LIVE_RUNNER`, `SIRKIT_B24_CORPUS_NIGHTLY` (undeclared, so `.env.example` does not change). [B24-D1, 2026-10-09] + `SIRKIT_B24_BENCHMARK` (qualification-opt-in), `SIRKIT_B24_BENCHMARK_DIR`, `SIRKIT_JOB_STARTED_AT` and `GITHUB_STEP_SUMMARY` (platform), read since B24-D1 (D16, OD-212, OD-30; undeclared, so `.env.example` does not change). [B24-D4, 2026-10-10] + `SIRKIT_E2E_SKIP` (platform: the spec globs a fixture browser run leaves out, read on `playwright.config.ts:21`; OD-30's split of page-browser-e2e, the lead's option A; undeclared, so `.env.example` does not change).
- Owner confirmation pending.

### OD-196 — Security headers and origin allowlists, as applied (B24-A2, 2026-10-06)

- **Default applied:** on every path (`next.config.ts`'s one rule, `/:path*`), from one pure builder (`securityHeaders`, a named export of `next.config.ts` that reads only `SIRKIT_EXPECTED_ORIGIN` from the map it is handed): `Content-Security-Policy: img-src 'self' data: blob:; frame-ancestors 'none'` (B19-D's image directive unchanged, one header), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`, and `Content-Security-Policy-Report-Only: default-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'` with no report endpoint, report-only until the owner accepts an enforced policy; `Strict-Transport-Security: max-age=31536000` only when `SIRKIT_EXPECTED_ORIGIN` normalises to https (the session cookie's Secure rule), read at build time; `poweredByHeader: false`; `allowedDevOrigins` unchanged, dev-server only. Asserted in `b24-a2-headers`, in `e2e/security-headers.spec.ts` (PROPOSED until the lead's browser run) and in `production-smoke` (PROPOSED until the lead's local production-mode run and its first CI run). The Supabase Site URL and redirect allowlist per environment are recorded (`supabaseAuthUrls`: the deployment's one origin and exactly `<origin>/api/auth/callback`; an http origin refused off loopback for staging and production); one origin per deployment, a preview deployment its own, no multi-origin list (a stated choice); verified only in staging (LB-1, LB-13).
- Owner confirmation pending.

### OD-224 — B24-A2: stated choices beyond its task text, as applied (B24-A2, 2026-10-06)

- **Default applied:**
  - (a) The HSTS value: `max-age=31536000`, with no `includeSubDomains` and no `preload` (the owner's, LB-13).
  - (b) The Permissions-Policy list: camera, microphone, geolocation, payment and USB off; no production source asks for any of them (`b24-a2-headers` 6).
  - (c) The report-only directives: `default-src`, `script-src` and `connect-src` `'self'`, `object-src 'none'`, `base-uri 'self'`, sent as `Content-Security-Policy-Report-Only` with no report endpoint (that would be a route); the dev browser run's violations are attached to the spec's result and asserted on nothing.
  - (d) The build-time HSTS reading (INFERRED): `headers()` runs when Next loads the config, and `next build` writes its answer into the routes manifest `next start` serves, so HSTS follows the build-time `SIRKIT_EXPECTED_ORIGIN`; a deployment builds with its own origin. The builder is a named export of `next.config.ts` (the task's fallback: a relative TypeScript import from the config is unproven under `next dev` and `next build`), `normalizeOrigin`'s rule restated and pinned equal to the cookie rule.
  - (e) The census classes: declared `secret`, `configuration`, `flag`, `rotation-previous`; undeclared, each for its reason - `fixture` (honoured only outside production), `qualification-opt-in` (arms an opt-in test or live run), `platform` (set by the runtime, the toolchain or the test harness), `child-passthrough` (handed to a child process), `not-an-environment-name` (a literal that only looks like one). The kind -> class map (D16): `enable-flag`, `disable-switch`, `rollout-stage`, `shadow` -> `flag`; `live-test-gate` -> `qualification-opt-in`; `tooling` -> `platform`; `fixture`, `configuration`, `secret` one to one; a `secret` named `*_PREVIOUS` -> `rotation-previous`. `SIRKIT_AUTH_MODE` is `configuration`, never a fixture.
  - (f) The previous-key rules: verification only, both compares before one answer; a previous value alone configures nothing; the MCP previous key passes the current key's bounds and separation or is never used, and never unconfigures the endpoint. [B24-A2 review] security-4: a planned rotation keeps the previous value at most seven days (the MCP key at least 3,630 s, a token's lifetime plus the clock skew); a suspected leak is rotated with no previous value, the outage accepted; nothing enforces the seven days or reports whether a previous value is set - reporting its presence (set or unset, never the value) in A1's configuration record or readiness is the lead's to choose, as it changes A1's record and pinned suite.
  - (g) The scan: the rules closed and pinned - PEM private-key markers; the Anthropic, OpenAI, GitHub, AWS, Hugging Face and JWT shapes restated from `source-registry.ts:592` and `server-registry.ts:360` and, [B24-A2 review] security-2, widened to OpenAI's project, service-account and admin forms and GitHub's OAuth, user, server, refresh and fine-grained tokens; the Supabase secret-key shape; [B24-A2 review] `connection-string-password`, scoped to an assignment to a `*_URL` name or a Supabase host (a bare userinfo rule hits some 25 test sentinels and a production comment), a placeholder password no hit. The size bound 4 MiB; [B24-A2 review] security-1: no file skipped for a NUL byte - UTF-16 read by its byte-order mark, a line holding a NUL matched with and without its NULs - and a blob git does not return named `unscanned`, failing the run. The allowlist: exact path, rule, the line's sha256 and a reason, eight test fakes. Three modes: tree (`git ls-files`, the stale-entry check), `--staged` ([B24-A2 review] security-3: an empty index is `nothing scanned`, exit 1) and `--history <range>` (each blob once, under the first commit's `<commit>:<path>`; a range with no commit is `nothing scanned`, exit 1); after a commit, before the push, `--history origin/<branch>..HEAD`.
  - (h) The planted marker: every marker and key-shaped fake in the suites is assembled at run time in injected entries (the `b21-e3-resume-record.test.ts:223` precedent), never committed; it replaces the discovery section 7's fixture directory.
  - (i) The job's placement: `secret-scan` appended after every job, `production-smoke` included, so no cited line moves; [B24-D0, 2026-10-09] B24-D0 appended `agent-boundary-suites` after it (OD-30), so secret-scan follows production-smoke and is the workflow's last job no more (`b24-a2-secret-scan` (c) moved in place); it inherits `contents: read`; [B24-A2 review] security-3: it checks out the whole history (`fetch-depth: 0`) and, on a pull request, also scans every commit of it (base..head, the two SHAs passed as step environment).
  - (j) The suite names: `b24-a2-headers`, `b24-a2-origin-allowlist`, `b24-a2-secret-rotation`, `b24-a2-env-names`, `b24-a2-secret-scan` - the committed names (D17); the discovery section 7's `b24-a-*` were placeholders.
- Owner confirmation pending.

### OD-30 — CI time: a dated amendment under its existing heading (`OWNER_DECISIONS.md:104-108`, after `:107`; never a second heading)

- [B24-A2, 2026-10-06] B24-A2 adds six tests to `e2e/security-headers.spec.ts` (four served-header paths, the framing case with its one-second negative wait, the report-only case) on `page-browser-e2e`'s default configuration, and one CI job, `secret-scan` (tree mode on every run, every commit of a pull request; a 10-minute limit, beside the other jobs). The builder ran no browser job: once the lead's run is green, record here `page-browser-e2e` <N> min against its 30-minute limit and `secret-scan` <N> min (the default applies: split the browser job if a run comes within five minutes of its limit).

### The LB-13 note (A1 owns LB-13; no new row)

For `LIVE_BLOCKERS.md`, a dated note under A1's LB-13 row (`:19`), in the register's form for a later note; `PROGRAM_STATE.json`'s LB-13 line stays as A1 wrote it:

- [B24-A2, 2026-10-06] LB-13 (B24-A2): still BLOCKED-LIVE-QUALIFICATION for the real edge's security headers, HSTS and TLS (proven offline by `b24-a2-headers`; served by `next dev` in `e2e/security-headers.spec.ts` and by `next start` in `production-smoke`, both PROPOSED until the lead's runs); for the Supabase Site URL and redirect list of a staging and a production project (the required values recorded per environment by `supabaseAuthUrls`; the email templates UNKNOWN); and for a real secret rotation (the previous-value procedure and the leak procedure proven offline by `b24-a2-secret-rotation`). Unblocks when the owner names the hosting platform and supplies isolated staging and production projects (OD-190, OD-191).

### The README row (after `README.md:14`)

| B24-A2 headers, origins, secrets (D24-4, D24-5, D24-6; OD-195, OD-196, OD-224) | `edge-security.md`; code `next.config.ts` (`securityHeaders`), `app/lib/deployment/{auth-url-allowlist,environment-names,secret-scan,secret-scan-allowlist}.ts`, `scripts/scan-secrets.ts`, the previous-value reads in `worker-principal.ts`, `server-auth.ts` and `mcp-bearer.ts`; suites `app/lib/qualification/__tests__/b24-a2-*`, `e2e/security-headers.spec.ts` | done 2026-10-06 offline, except the served headers (`e2e/security-headers.spec.ts`, `production-smoke`) and the `secret-scan` job: PROPOSED until the lead's browser run, local production-mode run and first CI run are green; `b24-a1-environment-profile` case 16 a STOP for the lead (its reviewed move proposed, section 13); census 168 / 165 / 3 / 0, counts 47 / 36 / 9 / 27, 107 action records; the edge, the Supabase project and a real rotation BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13) |

### The ledger paragraph (for `EXECUTION_LEDGER.md`, after B24-A1's entry, which ends at `:4874`)

### B24-A2 - headers, origins, secrets (2026-10-06 local; increment workflow + lead; this commit)

- Test-first on `chapter/b24-production-qualification` from `1b2c08c`: the five `b24-a2-*` suites failed first (three failed to load; with the new modules present and no existing file edited, 26 of 42 red, each counterexample for its reason: no builder and the one image header; a previous worker secret, KiCad token or MCP key refused; 51 names read and undeclared, 33 of a declared class; the workflow's last job `production-smoke`); then green.
- Headers (D24-5, OD-196): six headers on every path from `securityHeaders` (a named export of `next.config.ts`, the task's fallback), HSTS only for an https build-time origin, `poweredByHeader: false`; `e2e/security-headers.spec.ts` gains the served proof and `production-smoke` the probes, both PROPOSED until the lead's runs.
- Origins (D24-6, OD-196): `supabaseAuthUrls` records the Site URL and the one redirect per profile; the app starts no Supabase flow that lands on the callback; the project's settings UNKNOWN and BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13).
- Secrets (D24-4, OD-195): previous values that only verify for the worker secret, the KiCad token and the MCP key, with the planned-rotation and leak procedures; the 80-row census and `.env.example` parity over the declared classes (OD-195 narrowed); the secret scan in three modes and the `secret-scan` CI job (PROPOSED until its first CI run); B23's two single-value seams recorded.
- Records: OD-195 and OD-196 as applied, OD-224 for A2's own choices, the OD-30 amendment, the LB-13 note, the closure clauses, `edge-security.md`. The edge, the Supabase project and a real rotation BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13).
- Review round (2026-10-06): 16 confirmed findings (14 distinct) fixed test-first, the test-strength ones proven against eight deliberate breakages, each restored by hash (page section 8): no file skipped for a NUL byte any more (UTF-16 decoded; `pcb-delta.ts` and two tests were never scanned) and a blob git does not return fails the run; the rules widened to OpenAI's and GitHub's current forms and the project's connection strings (allowlist six -> eight test fakes); an empty `--staged` or `--history` run fails, and CI scans every commit of a pull request; the leak procedure and a seven-day maximum written; A1's page notes 49 -> 51; the page's records completed (section 13 in full, every gate run in section 10). One STOP for the lead: `b24-a1-environment-profile` case 16 re-applies A2's planned groups on top of A2's real rows (15 rows where 13 are pinned) - A2 does not edit A1's test logic; the proposed reviewed move is written and was probed green on the tree. Gates (page section 10): the qualification suites 112 of 113 (case 16, the STOP); `app/lib/auth/__tests__` 479 + 9 skipped; `app/api/__tests__` 1,059 of 1,059 with one `onTaskUpdate` timeout in B16.0's `b16-0-identity-header-gate` (alone: 6 / 6, the same timeout; recorded, not loosened); MCP 95 and 825; orchestration 460; computation 300 + 18 skipped; manufacturing providers 387; B14 22; tsc 0; eslint 0 on 17 files; three generators with no drift; the tree scan and `--history 57c3b29..HEAD` clean.

### The PROGRAM_STATE.json line

Set `"currentCheckpoint": "B24-A2 committed on chapter/b24-production-qualification (records in the ledger)"` and `"nextAction": "B24-A3, then the rest of B24 in order (A4, B1..B3, C1..C3, D1..D3, E, F), then the closeout and the final program report"`; `liveBlockers` unchanged (A1's LB-13 line holds); `updatedAt` the commit time.

### The section-10 line (for `discovery.md` section 10, after `:1627`)

- [B24-A2, 2026-10-06] B24-A2 landed the security headers (D24-5), the Supabase auth URLs per environment (D24-6), and the previous-value rotation, the environment-name census and the secret scan (D24-4); edge-security.md. Lead notes 1-7 of its task, as applied: (1) the census found 51 names read and undeclared at `1b2c08c`, not the discovery's twenty, so OD-195 is narrowed to the declared classes with every undeclared name listed by class; (2) the scan's six test sentinels are allowlisted by path, rule and line digest (eight since the review round: the connection-string rule's two test fakes); (3) every planted marker is assembled at run time, never committed; (4) the `secret-scan` job is appended after every job and A2's probes sit inside `production-smoke`, so no cited workflow line moved (A1's insertion table: `:420` 11 and `:447` 26); (5) the fourth and fifth suites are `b24-a2-secret-scan` and `b24-a2-origin-allowlist`; (6) the suite names are `b24-a2-*` (D17); (7) HSTS follows the build-time origin (INFERRED), and the builder is a named export of `next.config.ts` (the task's fallback). Pins the plan did not name: `b24-a1-flags` case 1 (49 -> 51, secret 3 -> 5) with dated notes on A1's page section 3; `b24-a1-environment-profile` case 16, a STOP: A1's simulation re-applies A2's planned groups on top of A2's real rows, and its reviewed move is the lead's (edge-security.md section 13).

### The browser and production-mode runs (the lead's)

Not run by the builder (lead decision; no agent runs `next dev`, `next build`, `next start` or Playwright). One heavy process at a time,
never beside vitest:
1. Both Playwright configurations, one at a time. The default one holds `e2e/security-headers.spec.ts`: the two B19-D tests and A2's
   six - every header exact on `/`, `/api/ai/runtime`, `/favicon.ico` and `/api/health`, no `x-powered-by`, no HSTS (the server's
   origin is `http://localhost:3100`), the framing case refusing the document, and the report-only case attaching
   `csp-report-only-violations.json` (record its counts in section 2). Record `page-browser-e2e`'s time under OD-30 (above).
2. The local production-mode run, as for A1 (`environments-and-deployment.md` section 13, "The local production-mode run": a fresh
   worktree, no `.env*` file but `.env.example`, every live variable empty, `next build`, then `next start --port 3200` with
   `SIRKIT_DEPLOYMENT_ENV=ci`, `SIRKIT_EXPECTED_ORIGIN=http://localhost:3200` and a generated worker secret), then the whole probe step
   of `production-smoke`, A2's loop included: the six headers exact and no `x-powered-by` or HSTS on `/`, `/api/ai/runtime`,
   `/api/health` and `/favicon.ico`. One thing only this run shows (INFERRED, section 12): `/` passes through `proxy.ts`, and if the
   proxy answers it with a redirect, Next's header rule must still apply to that answer.
3. The scans around the commit: `pnpm exec tsx scripts/scan-secrets.ts --staged` after staging the A2 files and before the commit
   (its first run over content), then after the commit, before the push,
   `pnpm exec tsx scripts/scan-secrets.ts --history origin/chapter/b24-production-qualification..HEAD`. A hit goes to the lead as
   `path:line rule` only, never allowlisted unless it is a test fake read first.
4. The first CI run: `production-smoke` (A1's probes and A2's) and `secret-scan` (its pull-request step runs on PR #15).

### The case-16 STOP

`app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts` case 16 is red on this tree, and A2 may not edit A1's test logic
(the A1 handover's rule 4: run it before and after the workflow edit and STOP if it fails after). The review baseline run
(`a2fix-baseline`, before any review edit): 1 failed, 72 passed (73), exit 1 - `expected [ …(15) ] to have a length of 13 but got 15`
at `:633`; the implementer's own after-run (`a2-workflow-after`, 13:51) failed the same way (1 failed, 80 passed of 81), its before-run
(`a2-workflow-before`) green. The cause: `simulate(PLANNED)` (`:563-582`) starts from the live workflow and page, which now hold A2's
real lines and its two real insertion rows (`environments-and-deployment.md` section 10: `:420` 11, `:447` 26), and appends all 13
planned groups again, A2's two included (`:545-546`); so 15 rows where `:633` pins 13, and `rows[1]` (`:645`, "53 recorded") is now
A2's real `secret-scan` row. Cases 14 and 17 are green: the real rows carry A1's lines correctly. Removing A2's rows would turn case
14 red (inserted 37 lines, 0 recorded), so the fix is a reviewed in-place move of case 16, the lead's.

The proposed move (dated, in place; no row of the page and no other case changes): simulate only the tasks still to land - a task
whose rows the insertion table already records has landed - and find A2's appended job by its row, not by its index. It keeps every
number A1 pinned at A1's tree (59 lines in 13 groups, "53 recorded") and gives, at this tree, 51 lines in 11 groups beside A2's two
real rows (13 rows) and "62 recorded" (88 inserted since A1, A2's 26-line row removed). A copy of the suite with this move applied
ran green beside the unchanged suite on this tree (`a2fix-case16-probe`: the copy 20 / 20; the original 19 / 20, case 16 red) and was
deleted at once. The diff:

    --- a/app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts
    +++ b/app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts
    @@ -556,6 +556,12 @@
       { task: "B24-D2", job: "database-delivery", after: lastDatabaseEntry, lines: [pgliteEntry("B24-D2")] },
     ];
    +/** [B24-A2 STOP, 2026-10-06] reviewed move (the lead's): the planned steps of the tasks still to land - a task whose rows section 10's
    + *  insertion table already records has landed, its real lines stand in the tree, and it is simulated no more. */
    +const stillPlanned = (): PlannedInsertion[] => {
    +  const landed = new Set(insertionTable(read(PAGE)).rows.map((row) => row.task));
    +  return PLANNED.filter((step) => !landed.has(step.task));
    +};
    @@ case 16, its title @@
    -  ...every later inserting task plans (A2, A4, B2, B3, C1, C2, C3, D1, D2: 59 lines in 13 groups) keep cases 11, 12 and 14 green...
    +  ...every later inserting task plans (A2, A4, B2, B3, C1, C2, C3, D1, D2: 59 lines in 13 groups at A1; [B24-A2 STOP, 2026-10-06] a task that landed is simulated no more, its real rows standing in the table) keep cases 11, 12 and 14 green...
    @@ case 16, its first lines (:631-633) @@
    -    const planned = simulate(PLANNED);
    -    expect(lineCount(planned.workflow) - lineCount(lines(WORKFLOW))).toBe(59);
    +    // [B24-A2 STOP, 2026-10-06] reviewed move (the lead's): the tasks still to land are simulated on top of the landed tasks' real rows
    +    // (59 lines in 13 groups at A1; after A2, 51 lines in 11 groups beside A2's two real rows); every task's groups are still 13 rows
    +    const remaining = stillPlanned();
    +    const planned = simulate(remaining);
    +    expect(lineCount(planned.workflow) - lineCount(lines(WORKFLOW))).toBe(remaining.reduce((sum, step) => sum + step.lines.length, 0));
    +    expect(insertionRowsOf(planned.page)).toHaveLength(insertionTable(read(PAGE)).rows.length + remaining.length);
         expect(insertionRowsOf(planned.page)).toHaveLength(13);
    @@ case 16, :645 @@
    -    expect(shiftTableProblems(replaceRow(rows[1]!, ""), planned.workflow).join(" "), "A2's appended job unrecorded").toMatch(/53 recorded/);
    +    // [B24-A2 STOP, 2026-10-06] reviewed move (the lead's): A2's appended job by its row (real once A2 landed), not by its index; 53 at A1
    +    const secretScan = rows.find((row) => row.includes("| secret-scan |"))!;
    +    const recordedWithout = lineCount(planned.workflow) - A1_WORKFLOW_LINES - Number(/\| (\d+) \|$/.exec(secretScan)![1]);
    +    expect(shiftTableProblems(replaceRow(secretScan, ""), planned.workflow).join(" "), "A2's appended job unrecorded").toContain(`${recordedWithout} recorded`);

The full patched suite and the exact unified diff are in the session scratchpad (`b24/fix/case16/`). The alternative the review
names - reverting A2's workflow lines and rows until the move lands - would drop the scan job and the header probes; not proposed.
Case 17 also calls `simulate(PLANNED)` and stays green either way; switching it to `stillPlanned()` is optional.

## 14. Citations

| # | file | line | anchor |
|---|---|---|---|
| C1 | `next.config.ts` | 10 | `return [{ source: "/:path*", headers: securityHeaders(process.env) }];` |
| C2 | `next.config.ts` | 30 | `export function securityHeaders(` |
| C3 | `next.config.ts` | 45 | `function normalisesToHttps(value: string \| undefined): boolean {` |
| C4 | `app/lib/auth/expected-origin.ts` | 63 | `export function normalizeOrigin(` |
| C5 | `app/lib/auth/session-cookies.ts` | 37 | `secure: normalized !== null && normalized.startsWith("https:"),` |
| C6 | `e2e/security-headers.spec.ts` | 30 | `const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [` |
| C7 | `e2e/security-headers.spec.ts` | 57 | `test("[B24-A2] framing: ` |
| C8 | `e2e/security-headers.spec.ts` | 85 | `test("[B24-A2] report-only: ` |
| C9 | `app/lib/deployment/auth-url-allowlist.ts` | 31 | `export function supabaseAuthUrls(` |
| C10 | `app/lib/auth/route-policy.ts` | 131 | `...pub("/api/auth/callback", ["GET"],` |
| C11 | `app/api/auth/callback/route.ts` | 38 | `const next = safeRedirectPath(meta.query?.next, "/");` |
| C12 | `app/api/auth/callback/route.ts` | 63 | `return Response.redirect(new URL(next, origin), 303);` |
| C13 | `app/api/auth/signin/route.ts` | 83 | `supabase.auth.signInWithPassword(` |
| C14 | `app/lib/auth/worker-principal.ts` | 63 | `export const WORKER_SECRET_PREVIOUS_ENV = "SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS";` |
| C15 | `app/lib/atomic/server-auth.ts` | 12 | `const current = kicadTokenMatches(a, expected); const previous = kicadTokenMatches(a, process.env.KICAD_HTTP_LIBRARY_TOKEN_PREVIOUS);` |
| C16 | `app/lib/auth/mcp-bearer.ts` | 555 | `export const MCP_TOKEN_SECRET_PREVIOUS_ENV = "SIRKIT_MCP_TOKEN_SECRET_PREVIOUS" as const;` |
| C17 | `app/lib/auth/worker-principal.ts` | 67 | `function matchesCurrentOrPreviousWorkerSecret(` |
| C18 | `app/lib/atomic/server-auth.ts` | 23 | `function kicadTokenMatches(supplied: Buffer, value: string \| undefined): boolean {` |
| C19 | `app/lib/auth/mcp-bearer.ts` | 276 | `if (!signedByCurrentOrPreviousKey(` |
| C20 | `app/lib/auth/mcp-bearer.ts` | 584 | `function signedByCurrentOrPreviousKey(` |
| C21 | `app/lib/deployment/environment-names.ts` | 150 | `export const ENVIRONMENT_NAMES: readonly EnvironmentNameRow[]` |
| C22 | `app/lib/deployment/flag-inventory.ts` | 84 | `{ name: "SIRKIT_MCP_TOKEN_SECRET_PREVIOUS", kind: "secret",` |
| C23 | `app/lib/deployment/flag-inventory.ts` | 99 | `{ name: "SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS", kind: "secret",` |
| C24 | `app/lib/deployment/secret-scan.ts` | 34 | `export const SECRET_SCAN_RULES: readonly SecretScanRule[]` |
| C25 | `app/lib/deployment/secret-scan.ts` | 117 | `export function runSecretScan(` |
| C26 | `app/lib/deployment/secret-scan-allowlist.ts` | 10 | `export const SECRET_SCAN_ALLOWLIST: readonly SecretScanAllowlistEntry[]` |
| C27 | `scripts/scan-secrets.ts` | 23 | `execFileSync("git", [...args],` |
| C28 | `app/lib/deployment/secret-scan.ts` | 280 | `export function decodeScanText(bytes: Uint8Array): string {` |
| C29 | `app/lib/deployment/secret-scan.ts` | 145 | `const views = line.includes(NUL) ? [line, line.split(NUL).join("")] : [line];` |
| C30 | `app/lib/deployment/secret-scan.ts` | 325 | `function blobEntry(` |
| C31 | `app/lib/deployment/secret-scan-allowlist.ts` | 50 | `rule: "connection-string-password",` |
| C32 | `scripts/scan-secrets.ts` | 38 | `process.exitCode = result.exitCode;` |
| C33 | `app/lib/deployment/secret-scan.ts` | 353 | `return raw.length === 0 ? { entries, unreadable: 0, nothing: "the index holds no staged change` |
| C34 | `app/lib/deployment/secret-scan.ts` | 357 | `if (commits.length === 0) return { entries: [], unreadable: 0, nothing: "the range holds no commit" };` |
| C35 | `.env.example` | 122 | `# After a suspected leak, rotate without it: never put a leaked value in a _PREVIOUS name.` |
| C36 | `app/lib/deployment/configuration.ts` | 72 | `const FLAG_STATE_KINDS: readonly FlagKind[] = Object.freeze(["enable-flag", "disable-switch", "rollout-stage", "shadow"]` |

## 15. [B24-A2F, 2026-10-09] The secret scan's history-only allowlist entries (the lead's corrective increment)

**Why.** CI's `secret-scan` job runs the tree scan on every event and, on a pull request, the history scan over every commit of it
(section 6, `--history "$BASE_SHA..$HEAD_SHA"`). B24-C3's commit `ba4f562` carried, at
`app/lib/qualification/__tests__/b24-c3-trace-read.test.ts:75`, a fake connection string in the one source shape the
`connection-string-password` rule reads (a template literal assigned to a name ending in `_URL`; host `db.invalid`; user and password
assembled from joined fragments; no credential), so the tree scan was red at `ba4f562` (run 37905772899; this and the next run attribution are the lead's reading of CI, recorded in the ledger's B24-C3 fix note and B24-D0 lead close - [B24-A2F review, 2026-10-09] correctness-2: this increment read no CI run). The lead's fix `aaa6a1b`
rewrote the line as joined fragments under `FAKE_CONNECTION`, which made the tree scan green and left the pull request's history scan
red (run 37912316237): the blob as committed at `ba4f562` is still in the range the step reads, history is not rewritten (runbook
2.4), and an ordinary allowlist entry for a line that exists only in history is stale in tree mode (`runSecretScan`'s stale check,
C25's tail). Re-read at `b3a4f2d` and reproduced offline (the counterexample below): **CONFIRMED**. The scanner had a design gap for
a fake sentinel that was later rewritten; this increment closes it without changing a rule, removing an entry or rewriting history.
It closes no defect and writes no OD entry, LB row or closure clause (the lead's decisions at launch).

**The kind** (`SecretScanAllowlistEntry.historyOnly?: true`, C37; every judgement in the pure `runSecretScan`):
- tree mode: a history-only entry is exempt from the stale check (C40); a tree line that hits with its path, rule and digest is
  reported as `path:line rule`, never allowlisted (C39) - the line was declared gone, so its return is a finding;
- `--staged` mode: a history-only entry never allowlists (C39; a staged line is about to enter the tree);
- `--history` mode: a history-only entry allowlists exactly as an ordinary entry - the same `<path>`, rule and line digest - and the
  match is counted (C39);
- `allowlistProblems`: a history-only entry's reason must name the replacing commit as a 7-40 hex id and say `replaced` or
  `rewritten` (C38, C41), or the allowlist is unusable and every mode exits 1, as for any malformed entry; a mark that is present and
  not `true` is refused the same way.

Nothing else changes: an ordinary entry keeps today's behaviour (cases b, b2, e2, e4 and d unchanged in their assertions),
`SECRET_SCAN_RULE_IDS` and every pattern are byte-identical (case a's pins), the script and the workflow are untouched, no rule is
weakened. The helper and its two patterns are declared at the end of `secret-scan.ts` (`:384-406`; [B24-A2F review, 2026-10-09] correctness-2, security-4: was `:384-405`, one line short of the helper's closing brace; `b24-a2-headers` 13 checks the range), so every line this page and
`ci-split.md:523` cite in it (`:34`, `:117`, `:145`, `:280`, `:325`, `:353`, `:357`) holds; the five in-place edits sit on `:16`,
`:70`, `:108`, `:150` and `:162`, each tagged. **CONFIRMED** (read at those lines; `b24-a2-secret-scan` l-p).

**The entry** (`secret-scan-allowlist.ts:60-69`, C42, appended at the end of the array; C26 `:10` and C31 `:50` hold): path
`app/lib/qualification/__tests__/b24-c3-trace-read.test.ts`, rule `connection-string-password`, sha256
`8bbe84aef14181902a233659797cf030bfd89aceb5f844542df7aee61e584a01`, `historyOnly: true`, the reason naming `ba4f562:75` and
`aaa6a1b` and the word `replaced`. The digest is the module's own `lineDigest` rule (sha256 over the UTF-8 text of the line without
its line break) over the line as committed: the lead computed it, and this increment re-derived it from
`git show ba4f562:<path> | sed -n 75p` piped into a sha256 digest - the two equal, the line never printed, the blob LF (0 CR bytes).
No line of the file at `b3a4f2d` carries the digest (case q computes every line's), so in tree mode the entry is neither used nor
stale. **CONFIRMED**.

**Test-first** (`b24-a2-secret-scan`, 18 -> 24 cases, 26 after the review round below (r, s); the new describe block at `:533-624`, every fake assembled at run time, nothing
written, no process). Red first at `b3a4f2d` with the extended suite against the unchanged scanner and allowlist, 7 failed of 24
(`a2f-03-red-secret-scan`): (d) the pinned shape list, 8 rows where 9 are pinned; (l) the history-only entry reported `is stale: no
line of that file hits with that digest`; (m) the returned line allowlisted (exit 0, allowlisted 1) where exit 1 is pinned; (n) its
last assertion, the same allowlist stale over the tree; (o) the staged line allowlisted; (p) `allowlistProblems` answered `[]` for a
reason naming no commit; (q) eight entries where nine are pinned. After the module and allowlist edits, 22 of 24 with (g) red - the
page's section 6 did not yet name the ninth path - and (m) red on this increment's own assertion (the rule id ends in the word the
case looked for; the assertion now checks the fake's userinfo), then 24 of 24 (`a2f-08-green-secret-scan`). **CONFIRMED**.

**The real scanner** (the script through the heavy-job lock, git objects only, no network; every count from its summary line):

| run | result | exit |
|---|---|---|
| `pnpm exec tsx scripts/scan-secrets.ts` (tree mode, this working tree) | 4,127 entries, 0 oversized, 0 unscanned, 0 listed paths not a regular file, **8 allowlisted**, no hit: the eight ordinary entries used, the ninth neither used nor stale (A2's run of section 10: 4,034 entries, 8 allowlisted) | 0 |
| `pnpm exec tsx scripts/scan-secrets.ts --history 57c3b29..HEAD` (the pull request's range at `b3a4f2d`: 13 commits, `8664964` to `b3a4f2d`) | 396 entries, 0 oversized, 0 unscanned, **1 allowlisted**, no hit (A2's run of section 10 over the then two commits: 63 entries) | 0 |
| the counterexample: the same history run with the eight ordinary entries only (a scratchpad script calling `runSecretScanCommand` with `SECRET_SCAN_ALLOWLIST` filtered of its history-only entry - the allowlist as it stood before this increment, for which an ordinary entry's behaviour is unchanged) | 396 entries, 0 allowlisted, exactly one line: `ba4f5623e95efe8cd8c5151f8c3adb12c8097d46:app/lib/qualification/__tests__/b24-c3-trace-read.test.ts:75 connection-string-password` - the hit CI's history step reported | 1 |

So the one allowlisted line of the history run is that hit, and nothing else in the range hits: **CONFIRMED** by execution. CI's two
`secret-scan` steps after the push are the lead's reading; until then the clearing of the pull request's check is **PROPOSED** (the
local history run over the same range is the whole of what the step runs, on the same script and allowlist).

**What stays as it was.** The nine rules and their patterns; the eight ordinary entries, each still read in its test; the script
(`scripts/scan-secrets.ts`, C27 and C32 hold); the `secret-scan` job and its two steps (no `.github` edit; cases c and k unchanged);
the counts at `b3a4f2d`, re-measured by their own pins before any edit: 168 / 165 / 3 / 0 (`b16-1c-invariant-tripwires`),
47 / 36 / 9 / 27 (`b22-b-exposure` 1), 107 action records (`b23-a-tier3-vocabulary`), 32 migrations (`b16-b-migrations`), the
SDK-importer pins (`b21-a-import-gates` 1, `b24-a1-configuration` 14), all green (`a2f-00-baseline-qualification`,
`a2f-01-count-pins`); no route, flag, environment name or agent tool added; no history rewritten, no force-push, nothing live. What
a history-only entry does is pinned: it allowlists one exact line digest in the history scan alone (n), its reason must name a
replacing commit (p), and the line's return to the tree or the index is reported, never hidden (m, o); the judgement built on that
stands under "What stays open" below ([B24-A2F review, 2026-10-09] security-3: moved out of this paragraph). **CONFIRMED**.

**Review round** ([B24-A2F review, 2026-10-09]; four findings, each low, each closed in-tree test-first; the three page readers'
baseline first, `a2f-18`: 3 files, 48 passed). `b24-a2-headers` 13 and `b24-a2-secret-scan` (r) red first on the review's tree
(`a2f-19`: 3 failed, 36 passed of 39; (s) green at launch, a pin of the kind's limit): 13 listed its three problems in one run -
`secret-scan.ts:405 is not the file's last line, the helper's closing brace (:406)`, `the judgement sits outside the INFERRED
paragraph`, `the judgement's paragraph carries a CONFIRMED` - and no anchor problem (C37-C43 held); (r) found no `[B24-A2F,
2026-10-09]` on the allowlist header's `:3-4`; 8 read 13 `it(` where the cell said 12. The fixes: correctness-2 and security-4, the
helper range on this page `:384-405` -> `:384-406` in place (the drafted records carry `:384-406` too) and a pointer beside the two
run ids naming them the lead's reading (the CONFIRMED at the end of that paragraph was already scoped to the offline reproduction);
security-1, the allowlist header's "every entry" sentence amended on its own `:4`, the header still seven lines, the pin row below
corrected to `:4-6`; security-2, case 13 appended to `b24-a2-headers` (section 15's citations checked as section 14's are, C37
onward, plus the helper range and the judgement's label), proved against a deliberate breakage of `secret-scan.ts` (one line
inserted before `historyOnlyProblems`, `a2f-21`) and the module restored byte for byte (sha256 equal before and after); security-3,
the "not a second way" judgement moved under INFERRED with its limit pinned by (s), the `commit` field drafted for the lead as
PROPOSED. Then green (`a2f-20b`; `a2f-20` was red on this page's own wrapping of the judgement phrase over a line break, after which
case 13 reads a paragraph with its line breaks as spaces and the phrase was re-wrapped), the gates below. **CONFIRMED** by execution.

**Pins moved, every one in place with a dated note, none loosened:**

| pin | move |
|---|---|
| `b24-a2-secret-scan` (d): the allowlist's pinned shape (the `SECRET_SCAN_ALLOWLIST` path and rule list) and the case title | eight -> nine rows, the ninth `app/lib/qualification/__tests__/b24-c3-trace-read.test.ts connection-string-password`, dated; the tree-mode count stays 8 (the comment beside it says why) |
| `b24-a2-secret-scan`, the header | one dated sentence appended on the existing line after "no process is started" - on that line and no new one, because `ci-split.md` C25 and C40 cite case (c) at `:183` and `:187` (the first draft added a line and `b24-d0-ci-split` 4 caught it, `a2f-11`); the sentence B24-D0 pins is untouched |
| this page, section 6 (`:257`) | the dated clause naming the ninth entry and its kind, appended inside the line, so no line of this page before this section moves (`scenario-map.md:422` cites `:523`; `ci-split.md:485` cites `:542`) |
| this page, section 10's `it(` table (`:410`) | 18 -> 24, the real count (`b24-a2-headers` 8 reads the cell as a number and compares it with the suite's `it(` count, so the dated note sits in the table's header row, `:404`) |
| `b24-a2-headers` 8, the page's section count | 15 -> 16, in place, dated: this section is the page's sixteenth (`a2f-11` caught the pin; the case's citation check over section 14 and its `it(` check over section 10 are unchanged and green) |
| `secret-scan.ts:16`; `secret-scan-allowlist.ts:4-6` ([B24-A2F review, 2026-10-09] security-1: this row said `:5-6` while the "every entry" sentence stood unamended; its exception now sits on `:4`, the sentence's own second line, pinned by `b24-a2-secret-scan` r) | the statements "an entry whose line no longer hits fails as stale" (`secret-scan.ts:16`; `secret-scan-allowlist.ts:5-6`) and "every entry is a test sentinel ... read in its test" (`secret-scan-allowlist.ts:3-4`, the exception on `:4`) each amended in place with the dated exception; both files keep every cited line and the allowlist header its seven |
| this page, section 10's `it(` table (`:406`, `:410`) | [B24-A2F review, 2026-10-09] 12 -> 13 (`b24-a2-headers`, case 13) and 24 -> 26 (`b24-a2-secret-scan`, r and s), the real counts, each in place; the header row's note (`:404`) extended |
| this page, `:720` and this section's "What stays as it was" | [B24-A2F review, 2026-10-09] the helper range `:384-405` -> `:384-406` in place with its note; the judgement sentence moved from the CONFIRMED paragraph to "What stays open" (INFERRED); no line before this section moved |

**What stays open** (**INFERRED**): a history-only entry stays in the allowlist for as long as the commit it covers is in a range a
history scan reads - after the B24 merge, `--history main` (the closeout's `SECRETS EXPOSED` run, section 6) still reads `ba4f562`,
so the entry is permanent unless history is rewritten, which the runbook forbids. Nothing checks that a history-only entry's
replacing commit is an ancestor of HEAD: the id is checked for shape only, because the pure module runs no git of its own by design.
[B24-A2F review, 2026-10-09] security-3, the judgement and its limit: that a history-only entry is
not a second way to allowlist a real secret - it allowlists one exact line digest in the history scan alone, its reason must name
a replacing commit, and the line's return to the tree or the index is reported, never hidden (cases m-p) - is a design judgement,
so it stands here and under no CONFIRMED. Its limit, pinned by `b24-a2-secret-scan` (s): in `--history` mode the entry matches
its path, rule and digest under
every commit of the range (C39 compares no commit; `:142` strips the `<commit>:` prefix), exactly as an ordinary entry does, and the
id its reason names is checked for shape only (`REPLACING_COMMIT`, `:394`; a seven-digit numeral passes), so the kind's one new
power is the tree-mode stale exemption; for the committed entry the only line its digest can ever cover is the known fake, so
today's exposure is nil. An optional `commit` field on a history-only entry, compared in history mode against the `<commit>:` prefix
(the full id or a prefix of it) so that the entry exempts one blob under one commit and a reintroduction elsewhere in the range is
reported, with the id the reason names required to equal it, is a choice beyond this task: drafted for the lead as **PROPOSED**
(the next free number at `b3a4f2d` is OD-234), not applied; (s) is the pin that would move with it, by review.

**Citations** (this increment's; C1-C36 above hold; [B24-A2F review, 2026-10-09] C37 onward are checked on their lines by
`b24-a2-headers` 13 as C1-C36 are by 8, numbered on from section 14's last):

| # | file | line | anchor |
|---|---|---|---|
| C37 | `app/lib/deployment/secret-scan.ts` | 70 | `readonly historyOnly?: true;` |
| C38 | `app/lib/deployment/secret-scan.ts` | 108 | `else problems.push(...historyOnlyProblems(entry, at));` |
| C39 | `app/lib/deployment/secret-scan.ts` | 150 | `&& (mode === "history" \|\| allowed.historyOnly !== true));` |
| C40 | `app/lib/deployment/secret-scan.ts` | 162 | `if (used.has(index) \|\| allowed.historyOnly === true) return;` |
| C41 | `app/lib/deployment/secret-scan.ts` | 399 | `function historyOnlyProblems(` |
| C42 | `app/lib/deployment/secret-scan-allowlist.ts` | 67 | `historyOnly: true as const,` |
| C43 | `app/lib/qualification/__tests__/b24-a2-secret-scan.test.ts` | 533 | `describe("[B24-A2F, 2026-10-09] the history-only allowlist entries` |
| C44 | `app/lib/qualification/__tests__/b24-a2-headers.test.ts` | 371 | `it("13. [B24-A2F review, 2026-10-09] section 15 is checked as section 14 is` |
| C45 | `app/lib/qualification/__tests__/b24-a2-secret-scan.test.ts` | 601 | `it("(r) [B24-A2F review, 2026-10-09] security-1, red first on the review's tree` |
| C46 | `app/lib/qualification/__tests__/b24-a2-secret-scan.test.ts` | 615 | `it("(s) [B24-A2F review, 2026-10-09] security-3, green at launch` |

**Gates** (every vitest run through the lock script, two workers, one job at a time; tsc, eslint and the scanner through the heavy-job
script; the logs under the scratchpad's `b24/logs/a2f-*`; **CONFIRMED** by execution):

| gate | result | exit |
|---|---|---|
| baseline before any edit: `app/lib/qualification/__tests__` (`a2f-00`) | 34 files, 359 passed, 3 skipped (362); 147.7 s | 0 |
| the count pins at `b3a4f2d` (`a2f-01`): `b16-1c-invariant-tripwires`, `b22-b-exposure`, `action-registry`, `b23-a-tier3-vocabulary`, `b21-a-import-gates`, `b16-b-migrations` | 6 files, 57 passed (168 / 165 / 3 / 0; 47 / 36 / 9 / 27; 107; 32; the SDK-importer pins) | 0 |
| baseline: the three closeout tripwires (`a2f-02`) | 3 files, 27 passed | 0 |
| `b24-a2-secret-scan` red first (`a2f-03`), the extended suite on the unchanged scanner and allowlist | 7 failed, 17 passed (24): d, l, m, n, o, p, q | 1 |
| `b24-a2-secret-scan` after the module and allowlist edits (`a2f-04`) | 2 failed, 22 passed: g (the page did not yet name the ninth path), m (the increment's own assertion, corrected) | 1 |
| `pnpm exec tsx scripts/scan-secrets.ts` (`a2f-05`) | 4,127 entries, 0 oversized, 0 unscanned, 0 unreadable, 8 allowlisted, no hit | 0 |
| `pnpm exec tsx scripts/scan-secrets.ts --history 57c3b29..HEAD` (`a2f-06`) | 13 commits, 396 entries, 0 oversized, 0 unscanned, 1 allowlisted, no hit | 0 |
| the counterexample: the same history run with the eight ordinary entries only (`a2f-07`) | 396 entries, 0 allowlisted, one line: `ba4f562…:app/lib/qualification/__tests__/b24-c3-trace-read.test.ts:75 connection-string-password` | 1 |
| `b24-a2-secret-scan` green (`a2f-08`) | 24 passed (24) | 0 |
| `tsc --noEmit -p tsconfig.json` (`a2f-09`; again after the last .ts edit, `a2f-14`) | 0 errors, both runs | 0 |
| `eslint` on the changed .ts files (`a2f-10`, three files; `a2f-15`, the four with `b24-a2-headers`) | 0 problems, both runs | 0 |
| `app/lib/qualification/__tests__` after every edit (`a2f-11`) | 2 failed, 363 passed, 3 skipped (368): `b24-a2-headers` 8 (the page's section count 15, and the `it(` cell read as a number) and `b24-d0-ci-split` 4 (`ci-split.md` C25 and C40 cite `b24-a2-secret-scan.test.ts:187` and `:183`; the first header edit had added a line) - the three pins handled in place (the table above) | 1 |
| `app/lib/qualification/__tests__` after the pin fixes (`a2f-12`) | 34 files, 365 passed, 3 skipped (368); 174.6 s | 0 |
| the three closeout tripwires over this page (`a2f-13`) | 3 files, 27 passed | 0 |
| `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` (`a2f-16`) | 18 passed (no new test file spells a write primitive) | 0 |
| [B24-A2F review, 2026-10-09] the three page readers before any edit of the round (`a2f-18`): `b24-a2-headers`, `b24-a2-secret-scan`, `b24-d0-ci-split` | 3 files, 48 passed (12, 24, 12) | 0 |
| the review round red first (`a2f-19`): the two extended suites on the review's tree | 3 failed, 36 passed (39): `b24-a2-headers` 13 (its three problems listed, no anchor problem), `b24-a2-secret-scan` (r) (no `[B24-A2F, 2026-10-09]` on the allowlist header's `:3-4`), `b24-a2-headers` 8 (the `it(` cell 12 where the suite has 13); (s) green at launch | 1 |
| the three page readers after the fixes (`a2f-20`) | 1 failed, 50 passed (51): case 13 found the judgement in 0 paragraphs - this page's own wrapping had split the phrase over a line break; the case now reads a paragraph with its line breaks as spaces, and the phrase was re-wrapped | 1 |
| the three page readers again (`a2f-20b`) | 3 files, 51 passed (13, 26, 12) | 0 |
| the test-strength proof of case 13 (`a2f-21`): one blank line inserted before `historyOnlyProblems` (`secret-scan.ts:399`), `b24-a2-headers` alone, the module restored from a copy and its sha256 compared | 1 failed, 12 passed (13): `C41 app/lib/deployment/secret-scan.ts:399 does not hold its anchor` and `secret-scan.ts:406 is not the file's last line, the helper's closing brace (:407)`; restored, sha256 `40f8f006…1960fc` before and after | 1 |
| `tsc --noEmit -p tsconfig.json` (`a2f-22`) | 0 errors | 0 |
| `eslint` on the three changed .ts files (`a2f-23`: the allowlist module, `b24-a2-headers`, `b24-a2-secret-scan`) | 0 problems | 0 |
| `pnpm exec tsx scripts/scan-secrets.ts` (`a2f-24`) | 4,127 entries, 0 oversized, 0 unscanned, 0 listed paths not a regular file, 8 allowlisted, no hit - the counts of `a2f-05` | 0 |
| `pnpm exec tsx scripts/scan-secrets.ts --history 57c3b29..HEAD` (`a2f-25`) | 396 entries, 0 oversized, 0 unscanned, 1 allowlisted, no hit - the counts of `a2f-06` | 0 |
| `app/lib/qualification/__tests__` (`a2f-26`) | 34 files, 368 passed, 3 skipped (371: `a2f-12`'s 368 and the round's three cases); 165.6 s | 0 |
| the three closeout tripwires over this page (`a2f-27`) | 3 files, 27 passed | 0 |
| `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` (`a2f-28`) | 18 passed (the two extended suites spell no write primitive) | 0 |

The page suites (`b24-a2-headers`, `b24-a2-secret-scan`, `b24-d0-ci-split`) and the three tripwires were re-run on the final page,
after this table, and reported to the lead with their counts ([B24-A2F review, 2026-10-09] and again after the review round's rows
above, `a2f-29`, reported the same way). No browser run and no `next build`, `next start` or `next dev`: A2F
changes two modules, two suites and this page; no UI, no route, no workflow line. CI's two `secret-scan` steps after the push are the
lead's reading.
