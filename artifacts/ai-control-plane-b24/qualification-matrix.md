# B24-E - The qualification matrix: browser, live and physical gates

B24-E (2026-10-10), on `chapter/b24-production-qualification` from `6e4e1bb`, in one workflow run delivered as two tagged halves (lead
decision D21): **B24-Ea** - the production-auth browser harness, offline (item 2; D24-34 offline; OD-191) - and **B24-Eb** - the register
in OD-217's vocabulary, this matrix and the statement tripwire (items 3-7 recorded; D24-33; D24-35 as recorded, OD-218; D24-36 as
recorded, OD-219). Item 1 is B24-B3b's at `6e4e1bb`, and E builds nothing for it (part 1.1). Labels: **CONFIRMED** (run or read at the
cited line at `6e4e1bb` plus this increment), **INFERRED** (a reading of code, nothing run), **RECORDED** (taken from a record without a
claim of ours), **UNKNOWN**, **PROPOSED**, and **BLOCKED-LIVE-QUALIFICATION** (a live step with no owner resource: never run, never
claimed). Nothing live ran: no Playwright config, no provider, model, database, distributor, manufacturer, MCP server or executable was
reached, and no owner resource was supplied or invented.

## Part 1. B24-Ea - the production-auth browser harness, offline (D24-34 offline; OD-191)

### 1.1 Item 1 (runbook `:1115`) is B24-B3b's: nothing built here

B24-B3b holds item 1's offline work at `6e4e1bb`: `app/lib/evaluation/live-spend.ts` (`sirkit.live-price-table.v1`, `LivePriceTable`, its
validator and the money cap; OD-216 applied), the record-only command's refusals (the flag not exactly "1" exit 2; the scripted agent or an
absent key name exit 3; no `--price-table` or `--spend-cap` exit 2), its `--contract-turns` mode and the two-provider capsule, all pinned by
`b24-b3-model-in-loop` (scenario-map.md section 4). B24-C2's `MODEL_PRICE_TABLE` (`app/lib/evaluation/model-price-table.ts:27`) is null and
typed by B3b's `LivePriceTable`, so the program has ONE price table. **CONFIRMED** (read; `b24-e-register` 9 finds exactly one
`sirkit.*price-table.v<n>` literal under `app/` and `scripts/`). B24-E adds no spend guard, price table, contract turns, opt-in suite or
command edit (OD-102, OD-125: no permanently skipped live suite). Q1 below records it.

### 1.2 The target (`app/lib/deployment/production-auth-target.ts`, pure)

- **The staging list.** `PRODUCTION_AUTH_STAGING_TARGETS: readonly ProductionAuthStagingTarget[]` (`{ projectRef, label }`) is EMPTY
  (`:42`): no isolated project exists (OD-6, OD-191). A reviewed change adds one entry for an isolated project the owner names, never the
  main project. **CONFIRMED** (`b24-e-production-auth-config` 2).
- **The resolver.** `resolveProductionAuthTarget(env, targets)` (`:151`) answers `not_requested` (the flag `SIRKIT_LIVE_AUTH_QUALIFICATION`
  not exactly "1"), `refused` with every code that applies, in the closed order of `PRODUCTION_AUTH_REFUSAL_CODES` (`:45`), and the
  variable NAMES they concern, or `ready`. The fifteen codes: `target_list_malformed`, `marker_missing`, `marker_malformed`,
  `target_not_listed`, `supabase_url_missing`, `supabase_url_not_target`, `publishable_key_missing`, `publishable_key_secret`,
  `email_missing`, `password_missing`, `project_id_missing`, `selector_malformed`, `database_url_missing`, `database_url_not_target`,
  `base_url_not_reviewed`. **CONFIRMED** (case 1: each code by its own single fault, names only).
- **The inputs** are B16-1B's names: the marker `SIRKIT_AUTH_QUALIFICATION_PROJECT` must be `sirkit-auth-qualification-<label>` of a
  listed target (B16-1B's prefix rule); `NEXT_PUBLIC_SUPABASE_URL` https with host exactly `<projectRef>.supabase.co`; the key selected as
  `mode.ts:65` selects it (the publishable key, else the anon key; an empty publishable key never falls through), refused when it is a
  Supabase secret key or a JWT naming the service role, because `next build` inlines a public variable into the browser bundle; the
  email, the password and the project id set; the project and tenant ids by the trusted context's selector rule (a copy of `ID_PATTERN`,
  equality pinned); `SIRKIT_AUTH_QUALIFICATION_TENANT_ID` optional, default `local`; `SIRKIT_AUTH_QUALIFICATION_DATABASE_URL` REQUIRED
  and naming the same project (host `db.<projectRef>.supabase.co`, or a Supabase pooler host with the user `postgres.<projectRef>`);
  `SIRKIT_AUTH_QUALIFICATION_BASE_URL` set is refused `base_url_not_reviewed` (no target carries a reviewed app origin). A Supabase
  project ref is taken to be twenty lower-case letters or digits (INFERRED). **CONFIRMED** (cases 1, 3).
- **[B24-E review, 2026-10-10] One host for both parsers (security-3).** postgres.js 3.4.9 (`parseUrl`) reads a database URL's host after
  the FIRST "@" of the part before the first "/" or "?", percent-decoded, and takes a comma there as a host list it tries in order; the
  WHATWG parser the rules use ends the authority at "#" too and reads the host after the LAST "@". So `postgres://...@db.<other>...,x@db.
  <ref>.supabase.co/...` passed the rules while postgres.js would reach the other project first (the spec's canary and the server's
  `getDb` both connect with postgres.js). A database URL with a second "@" there, or a comma in postgres.js's host (one after a "#" never
  reaches the WHATWG host), is now refused `database_url_not_target`. **CONFIRMED** (read; case 1, four shapes, red before the fix).
- **[B24-E review, 2026-10-10] Every rule exercised (correctness-4).** Case 1 now breaks each URL and list rule ALONE: a port, a user
  name, a password, a query and a fragment on the Supabase URL; a duplicate ref, a duplicate label, an extra key and a malformed label
  on the list; the four database-URL shapes. With every one of those rules removed at once, case 1 named all thirteen inputs as ready
  (`e-fix-break-1`), so removing any one frees exactly its input; the source was restored by sha256.
- **No value is printed.** A refusal carries codes and names only; a ready answer keeps its three server values (the Supabase URL, the
  key, the database URL) as non-enumerable properties, so neither JSON nor a console inspection prints them. Planted secret-shaped values,
  assembled at run time, appear in no answer and no message. **CONFIRMED** (cases 1-4).
- **The builder.** `productionAuthPlaywrightConfig(ready)` (`:238`) returns the config as plain data; the config file only wraps it.

### 1.3 The config (`playwright.production-auth.config.ts`, at the root)

Unless the resolver answers `ready`, its default export throws `PRODUCTION_AUTH_NOT_EXERCISED: <codes> (<names>)` and nothing is built
or started; with the committed list every environment answers `target_not_listed` at best. When ready (shown only with a fixture list
injected in the suite): `testDir: "./e2e-production-auth"`, `testMatch` the spec files, workers 1, retries 0, `fullyParallel: false`; the
list reporter alone (no HTML or JUnit report, so no `playwright-report-production-auth` folder); its own `outputDir`,
`test-results-production-auth` (`.gitignore`, appended); trace, screenshot and video `"off"`; fresh storage; one Chromium project
(1280 x 720); the fixed loopback origin `http://127.0.0.1:3102` (no new environment name); `webServer` `pnpm exec next build && pnpm exec
next start --hostname 127.0.0.1 --port 3102` (A1's smoke has no reusable invocation: it is inline in `production-smoke`; the hostname is
the review's, security-4, below), ready on `/api/health`, `reuseExistingServer: false`, a 600 s start budget, its output not echoed;
every action bounded at 15 s and every navigation at 30 s (`actionTimeout`, `navigationTimeout`; the review's, correctness-1). The
server's environment, set in full: `NODE_ENV=production`,
`SIRKIT_AUTH_MODE=production`, `SIRKIT_DEPLOYMENT_ENV=staging`, `SIRKIT_EXPECTED_ORIGIN` the loopback origin, `DATABASE_URL` the
qualification database, `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` the resolver's values and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` empty (the developer's key, the main project's, is never paired with the isolated URL); `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, the six `SIRKIT_FIXTURE_*` names, `SIRKIT_MCP_ENABLED`, `SIRKIT_TRUSTED_CLIENT_IP_HEADER` (the review's,
security-4), every other `secret` and `rotation-previous` name of A2's census, and the qualification account's email, password and
database URL all empty. The command builds under the same environment. It never selects the local development auth mode. A ready config
also sets `PRODUCTION_AUTH_RUNNER_ENV` (`PLAYWRIGHT_NO_COPY_PROMPT=1`) in its own process, the runner's and each worker's, since a worker
loads the config too (the review's, correctness-1, part 1.5). **CONFIRMED** (case 4: the config imported with `@playwright/test` stubbed,
as `b21-f-page` does, throws without the flag and with the committed list, and with a fixture list IS the builder's shape and sets the
runner switch; it is the one root config that neither sets the fixture runtime's auth mode nor imports the base config - red on
`6e4e1bb`, where every config did one or the other).

**[B24-E review, 2026-10-10] Loopback only (security-4).** `next start` listens on 0.0.0.0 unless told (Next 16.2.6's CLI: `-H,
--hostname`, "default: 0.0.0.0"), so an owner-resourced run served the production-mode server, wired to the isolated project, on the
machine's network for its length, and a client there could send the loopback Origin the CSRF check compares; a developer's
`SIRKIT_TRUSTED_CLIENT_IP_HEADER` in `.env.local` would also have keyed A3's public windows on a header such a client chooses. The
command now passes `--hostname 127.0.0.1` (`PRODUCTION_AUTH_COMMAND`, `:216`) and the server's environment blanks the header name (A3's
`trustedClientIpHeaderName` reads a blank as unset: one shared window per route). **CONFIRMED** (read; case 4, each shown by a breakage,
`e-fix-break-2`, `-3`).

### 1.4 The spec (`e2e-production-auth/production-auth.spec.ts`)

In a real Chromium against the production-mode server, serially (`:76`, `:94`, `:107`, `:128`; [B24-E review, 2026-10-10] moved from
`:81`, `:103`, `:116`, `:137` when test 1's form steps left the spec):

1. **Sign-in** through `/signin` (the labels Email and Password, the button Sign in; `app/signin/page.tsx:60-84`) lands on `/`; every
   cookie is the `sb-<ref>-auth-token(.N)` family of the listed ref, HttpOnly, SameSite Lax, Path /, Secure only on https, unexpired.
2. **Liveness**: `GET /api/pcb-sync` with the selector headers through the page's request context answers 200; without cookies 401
   `AUTH_UNAUTHENTICATED`.
3. **Revocation**: B16-1B's membership canary in the isolated database (a `sirkit-auth-qualification-canary-*` project, its rows deleted in
   `afterAll`): active answers 200, revoked answers 403 `AUTH_NO_ACTIVE_MEMBERSHIP` on the next request. Its one postgres client takes
   `ssl: databaseTls(<its url>)`, as every client does; a database failure is reported by its error code alone.
4. **Sign-out**: `POST /api/auth/signout` through the page's request context with the page's Origin answers `{ ok: true, signedOut: true,
   remoteRevocation: "confirmed" }`; the family is retired; the pre-sign-out cookies, replayed in a fresh context, answer 401.

It reads the credentials by name only, logs nothing, and asserts names, flags, statuses and codes, never a value. **CONFIRMED** offline by
case 6 (an AST check); **BLOCKED-LIVE-QUALIFICATION** as a run (LB-1, LB-13): it has never run, and no owner resource exists.

[B24-E review, 2026-10-10] Test 1's form steps live in `e2e-production-auth/sign-in-form.ts` (correctness-1, security-1): `openSignIn`
(the navigation, bounded at 20 s, before any field holds a value), `submitSignIn` (each credential the argument of one page evaluation,
`setInputValue`, bounded at 10 s: the input's prototype value setter, as React's onChange reads it, then one bubbling input event; the
sign-in answer's wait, 30 s, started before the click, 10 s, and observed if the click fails) and `clearCredentialFields` (a 10 s settle,
then each field the page still shows blanked by the same setter at 5 s; it never throws). The bounds sum to `SIGN_IN_WORST_CASE_MS` =
100 s, 20 s inside the 120 s test timeout, so the `finally` ends before Playwright gives up on the test. That the setter reaches React's
state in a real Chromium is INFERRED (the mechanism React's own input tracking leaves to a prototype setter); the spec has never run.
**CONFIRMED** offline: case 8 runs the three steps on a recording page (order, bounds, arguments, the clearing on a page with and without
the form and with every wait failing, the page function on a stand-in input whose own setter React-style tracking would catch) and case 6
pins test 1's shape on the spec's syntax tree and that no harness call types a value.

### 1.5 What the harness rests on (read at `6e4e1bb`)

- **The failure error context holds typed input.** Playwright 1.63 writes `error-context.md` into the output folder on any failing test,
  whatever the trace and screenshot settings, holding an ARIA snapshot of the page (`node_modules/playwright/lib/index.js`,
  `buildErrorContext` with `page.ariaSnapshot({ mode: "ai" })`), and the snapshot gives every input but a checkbox, radio or file its
  `element.value` (playwright-core's `toAriaNode`) - the password field included. So test 1 fills both fields, clicks Sign in and waits
  for the answer inside a `try`, and in its `finally` waits for the form to settle and fills both fields with "" through the page (so
  React's state is cleared too) before its first assertion. **CONFIRMED** (read; case 6 pins the order on the spec's text).
  [B24-E review, 2026-10-10] correctness-1, security-1: that `finally` was no guarantee. With no action timeout an unanswered sign-in (a
  server crash, a network failure, or Chromium's email check holding the form) left `await signin` pending until the 120 s test timeout;
  Playwright's worker then races past the body (`workerProcessEntry.js`, `Promise.race`), tears the test's fixtures down and writes
  `error-context.md` from the still-open beforeAll context's page - both fields filled - before afterAll closes it and the pending
  `finally` runs. And `fill` titles its step `Fill "<value>"` and logs `fill("<value>")` into the call log a failed or timed-out action's
  error carries, so the password could reach that file or the terminal on any failing fill. Now, three layers: no harness call types a
  value (each credential is an evaluation's argument; part 1.4); every step is bounded and their worst case ends 20 s inside the test
  timeout, with `actionTimeout` and `navigationTimeout` as a backstop; and a ready config sets `PLAYWRIGHT_NO_COPY_PROMPT=1`, under which
  `_takePageSnapshot` (`node_modules/playwright/lib/index.js`) returns at once, so no page snapshot is written at all. **CONFIRMED** (read;
  cases 4, 6 and 8, red before the fix in `e-fix-red-1`, each layer shown by a breakage, `e-fix-break-1`, `-4`, `-5`). The switch is
  read from Playwright 1.63 (`package.json` pins it); a later version must be re-read (INFERRED for any other).
- **`.env.local` and a production server.** `@next/env` 16.2.6 (`processEnv`) loads a name from a file only when the server's environment
  leaves it undefined; an empty string counts as set and is kept. So every name the config sets, empty or not, shuts the developer's
  `.env.local` value out. **CONFIRMED** (read). The task's INFERRED "next start loads .env.local for any name the server's environment does
  not set" is CONFIRMED by the same read.
- **The base config captures typed input.** `trace: "retain-on-failure"` and `screenshot: "only-on-failure"` (`playwright.config.ts:33-34`)
  and its HTML reporter (`:27`). The production-auth config turns all three off. **CONFIRMED** (read).
- **A4's guard census does not reach the spec.** `b24-a4-test-isolation` case 1 walks `.test.ts` and `.test.tsx` files under `app`, `lib`
  and `components` that import `db/test-qualification`; the spec is a `.spec.ts` outside them that imports neither, so it is no DB-gated
  suite of that census and no named exception is needed. A4's TLS census (`b24-a4-database-tls` 3) walks `app`, `lib`, `components`,
  `scripts` and `e2e`, not `e2e-production-auth`; the spec's client takes the rule anyway. **CONFIRMED** (read).
- **No UI control signs out**: `/api/auth/signout` is named only in `route-policy.ts` and `action-registry.ts`, so the spec signs out
  through the page's request context. **CONFIRMED** (read).

### 1.6 Pins moved (Ea), each in place with a dated `[B24-E, 2026-10-10]` note

- The resolver reads `SIRKIT_AUTH_QUALIFICATION_TENANT_ID` in production code; the other seven live-auth names were already B24-B3's
  rows. A1's inventory gains it (kind `live-test-gate`, owner `production-auth-target.ts:179`, appended on `flag-inventory.ts:56`) and
  A2's census (class `qualification-opt-in`, D16's map; undeclared, so no `.env.example` line). Moved: `b24-a1-flags` case 1 (the kinds
  pin, 66 -> 67), `b24-a2-env-names` `CLASS_COUNTS` (`qualification-opt-in` 17 -> 18) and case 10 (67; D4's note held to its own 65 -> 66,
  E's carries 66 -> 67), `environments-and-deployment.md` section 3 (two notes), `edge-security.md` section 5 (the class row 17 -> 18, the
  total 98 -> 99) and its OD-195 block (`b24-a2-headers` 11). `b24-d4-browser-split` case 8: D4's note is held to its own text and to
  standing before the `SIRKIT_AUTH_MODE` sentence (was: directly before it), since E's total note now stands between them, the last move on
  the line where `b24-a2-env-names` 9 reads the total.
- `b24-d0-ci-split` cases 1 and 7: the three `b24-e-*` suites join prompt-to-gerber's qualification filter after D0's measurement, set
  aside as D1-D4's were (484 -> 487).
- `b23-a-provider-admission` case 8: no move (Ea's files name no `manufacturing-providers`; the root config and `e2e-production-auth/` lie
  outside its walk). The record-only command: not edited. `.gitignore`: append only (`b21-f-page` 10 reads it by containment).
- No workflow line, no route, tool, UI control or `package.json` change. The census stays 168 = 165 + 3 + 0 and the agent-tool counts
  48 / 37 / 9 / 28.

### 1.7 Test-first record (Ea)

| run | what | result |
|---|---|---|
| `e-red-1-production-auth-config` | the new suite on `6e4e1bb` | red: `Cannot find module '@/app/lib/deployment/production-auth-target'`, no test ran, exit 1 |
| `e-ea-1` | the suite with the module, the config and the spec; A1's and A2's censuses | the suite 7 of 7; red where the inventory and the census lacked `SIRKIT_AUTH_QUALIFICATION_TENANT_ID` (`b24-a1-flags` 2, `b24-a2-env-names` 2, 6), exit 1 |
| `e-ea-2` | after the two rows and the pins | red on two page pins the rows moved (`b24-a2-headers` 11, `b24-d4-browser-split` 8), exit 1 |
| `e-ea-3` | after the OD-195 note and D4's pin move | 12 files, 155 of 155, exit 0 |
| `e-fix-red-1` | [B24-E review, 2026-10-10] the strengthened suites on the reviewed tree | config suite red on cases 1 (three database URLs with a second "@" answered ready), 4 (no runner switch; the command, the bounds and the header name were asserted after it), 6 (no `sign-in-form.ts`; the spec typed both values with `fill`), 8 (module absent); the statement suite on case 3 (part 3.5); 10 passed, 5 failed, exit 1 |
| `e-fix-green-2` | after the fixes | 2 files, 15 of 15, exit 0 (`e-fix-green-1` was red on statements 6 only, part 3.5) |
| `e-fix-break-1` .. `-6` | deliberate breakages, each restored by sha256 (1 and 2 re-run on the final module layout, `-final`) | every resolver rule removed: case 1 names all thirteen inputs; the runner switch removed: case 4; the clearing's `> 0` flipped: case 8; the hostname removed: case 4; the header name kept: case 4; the answer's bound and the action backstop removed: cases 4, 8; the password typed with `fill`: cases 6, 8; the answer's wait left unobserved after a failed click: vitest's unhandled rejection; each exit 1 |

The statement tripwire (part 3) then caught the config's own header, which read as a sign-in claim ("signed in to an ISOLATED Supabase
project"); it was reworded before any run of the harness (part 3.5).

## Part 2. The matrix (D24-35 as recorded, OD-218; D24-36 as recorded, OD-219)

### 2.1 Column rules

- **Class**: B24-B1's closed six (`sirkit.golden-eval-catalog.v1`, OD-203), by label.
- **Readiness scope**: one of the ten of runbook `:1146-1155`, or `—`.
- **State**: the register's three forms. A row is `QUALIFIED (...)` only when every LB it cites is, with that form; `NOT APPLICABLE` only
  when it cites none; else `BLOCKED-LIVE-QUALIFICATION`.
- **Passing, for B24-F**: a row passes when its State is QUALIFIED, or NOT APPLICABLE with CI evidence named in Built offline.
- **Scopes, for B24-F**: each readiness scope is computed from every row whose scope matches it, not from items 1-7 only: MCP readiness is
  Q12 + Q14 (IN PART: Q14 passes, Q12 is BLOCKED); sandbox readiness is Q4.
- **Recorded live runs**: each run named with its date and result; a failing result is marked `failing`. A recorded result never changes
  State.
- **The sandbox rule** (B24-F's): Q4's State stays BLOCKED, and B24-F renders sandbox readiness as NOT READY with class 4 NOT CONTAINED and
  production BLOCKED-LIVE-QUALIFICATION (LB-10, LB-3, LB-8) whenever Q4's recorded runs hold a failing result - at `6e4e1bb` they do.

All five rules, and that the code fact of each row holds, are pinned by `b24-e-register` 7-9.

### 2.2 The table

| Row | Gate | Runbook | Class | Readiness scope | Built offline | Recorded live runs | Unblocking resource | State | LB |
|---|---|---|---|---|---|---|---|---|---|
| Q1 | item 1, live OpenAI and Anthropic contract and eval turns with strict spend limits | `:1115` | model-in-loop | live provider readiness | B24-B3b's record-only command (`scripts/run-b21-live-orchestration-evaluation.ts`): the flag not "1" exit 2, the scripted agent or an absent key name exit 3, no `--price-table` or `--spend-cap` exit 2 (OD-216), `--contract-turns`, the two-provider capsule; the ONE price table `sirkit.live-price-table.v1` (`app/lib/evaluation/live-spend.ts`); `MODEL_PRICE_TABLE` is null, typed by `LivePriceTable` (C2); `b24-b3-model-in-loop` in prompt-to-gerber | 2026-07-29, R05-E2E01: a first acceptance prompt `failing` (Anthropic 400, credit balance too low), then three live acceptance runs on Anthropic `claude-opus-4-7` that completed every stage (RECORDED, `artifacts/prompt-to-gerber/r05-e2e01-report.md:51-64`, `:262-273`; before this program's model-in-loop class, with no spend limit and no contract turn); 2026-09-24: OpenAI answered 429 no credits for both configured keys, `failing`, nothing exercised (`EXECUTION_LEDGER.md:2508-2509`) | provider credits on both providers, an owner price table in `sirkit.live-price-table.v1` and a money cap passed to the command (OD-216) | BLOCKED-LIVE-QUALIFICATION | LB-2, LB-7, LB-9 |
| Q2 | item 2, production-auth browser E2E against an isolated Supabase staging project | `:1116` | browser E2E | staging authentication readiness | B24-Ea's harness: `playwright.production-auth.config.ts` (throws `PRODUCTION_AUTH_NOT_EXERCISED` unless ready), `e2e-production-auth/production-auth.spec.ts` (sign-in, cookie flags, liveness, revocation, sign-out); `PRODUCTION_AUTH_STAGING_TARGETS` is empty; `b24-e-production-auth-config` in prompt-to-gerber; B16-1B's opt-in HTTP matrix `b16-1b-live-qualification` (not exercised) | none | an isolated `sirkit-auth-qualification-*` Supabase project and its account, one reviewed staging-list entry (OD-191) | BLOCKED-LIVE-QUALIFICATION | LB-1, LB-13 |
| Q3 | item 3, live component and distributor checks without purchasing | `:1117` | external-provider staging | external component-provider readiness | B24-B3's repaired `b19-e-live-contract` (fails NOT EXERCISED without a credential name or an admitted source); `admitSource("digikey", {})` refuses `credentials_missing` (`source-registry.ts:568, :584`); the fake-vendor suites and the PGlite offer cache; no purchase path (`b19-e-no-purchase-tripwire`) | none | DigiKey and Nexar or Octopart credentials with quota consent (`SIRKIT_LIVE_ACQUISITION_CONTRACT`, `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET`, `OCTOPART_API_KEY` or `NEXAR_API_KEY`) | BLOCKED-LIVE-QUALIFICATION | LB-15 |
| Q4 | item 4, real sandboxed simulator and router jobs on the qualified platform | `:1118` | physical-hardware validation | sandbox readiness | `executeAuthoritativeSimulation` throws `CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX` (`safe-execution.ts:28`); B22's runtime profiles and `b22-d-adversarial` in agent-boundary-suites; the committed router recordings replayed in prompt-to-gerber | 2026-10-02, B22-D's diagnostic run of `b22-d-adversarial-live`: 12 of 13, class 4 NOT CONTAINED, `failing`, diagnostic only (`adversarial-matrix.md:323-327`); 2026-10-01, B22-A3's lead run of `b22-a3-runner-live`: 5 of 5, diagnostic only (B22 `test-and-validation-report.md:17`; B22 `discovery.md:569`) | a qualified OCI engine and B22-A4: `SIRKIT_NGSPICE_OCI_IMAGE`, `SIRKIT_OCI_CLI_PATH`, `SIRKIT_OCI_CLI_SHA256`; the pinned install `SIRKIT_NGSPICE_INSTALL_ROOT`, `SIRKIT_NGSPICE_INSTALL_SHA256`; the live flag `SIRKIT_B22_LIVE_RUNNER` (`runtime-profile.ts:33-34, :40, :338`; `b22-a3-runner-live.test.ts:17`); a qualified runner with FreeRouting's JRE | BLOCKED-LIVE-QUALIFICATION | LB-10, LB-3, LB-8 |
| Q5 | item 5, manufacturing DFM and quote staging | `:1119` | external-provider staging | external quote/order readiness | B23's fake-backed `POST /api/pcb/provider-exchange` flow (`b23-b-*` in prompt-to-gerber); every DFM/quote operation refused `provider_not_admitted`; `PROVIDER_TRANSFER_DESCRIPTORS` is empty (`provider-egress.ts:69`); ordering disabled: `ORDERING_OWNER_RECORD === null`, `ORDER_SUBMISSION_PORT_WIRING === "none"` (`ordering-enablement.ts:36, :39`) | none | an approved provider account with a sandbox or staging path (OD-160), a reviewed transfer descriptor and the owner-run B23-B4; for ordering, OD-171's owner record and a reviewed port wiring | BLOCKED-LIVE-QUALIFICATION | LB-11, LB-12 |
| Q6 | item 6, the deterministic 555 release | `:1120` | deterministic offline | manufacturing-file readiness | the release made in CI under the frozen clock `2026-09-09T12:00:00.000Z`: release id `mfg-release-45b3b7efbc85dc3a8ecd233c906384cd` and archive sha256 `997664c0b9a87c4d3a65e64eeb90b98159b2ad6ad8806e4ebea748a592ac6dcc` equal `expected-identities.json:15, :17` (`acceptance-pipeline.test.ts:419-421`, prompt-to-gerber); the jlcpcb-2l rule-profile evidence valid through 2027-09-09, a real-clock release refused from 2027-09-10T00:00:00.000Z UTC (`rule-profile.ts:33-37, :48, :114`; `release/route.ts:185-186`) | none | none: no live resource; renewal of the rule profile is an owner action and a reviewed code change (OD-219) | NOT APPLICABLE | none |
| Q7 | item 6, fabrication only after separate owner approval | `:1120` | physical-hardware validation | physical hardware validation | none built (OD-218's default: no fabrication, upload or order; no evidence store) | none | the owner's separate approval of fabrication naming who inspects and tests (OD-218), boards | BLOCKED-LIVE-QUALIFICATION | LB-5 |
| Q8 | item 7, incoming inspection and electrical and functional test evidence | `:1121` | physical-hardware validation | physical hardware validation | B23-D's `physical-evidence.ts` offline: `PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING === "none"` (`physical-evidence.ts:330`), `ASSEMBLY_DATA_AUTHORITY === "absent"` (`:454`), eligibility blocked for every input (`:484`); `manufacturing.assembled-release` is `missing` (`action-registry.ts:118`); `b23-d-*` in prompt-to-gerber | none | OD-218's answer; then the store, the session-derived recording route and the wired review port as their own increment; boards, equipment, an operator | BLOCKED-LIVE-QUALIFICATION | LB-5 |
| Q9 | real-server database qualification | `:1031`, `:1044` | database-backed | — | the migration runner and the nine DB-gated suites behind the shared guard (OD-201, `b24-a4-test-isolation`); PGlite in database-delivery | 2026-09-24, the lead's owner-authorised run on two empty databases of the main project's PostgreSQL 17.6 server: every migration and the nine DB-gated suites passed, non-isolated (`EXECUTION_LEDGER.md:2490-2509`) | none for this row; an isolated server is Q10 | QUALIFIED (2026-09-24, migrations and the nine DB-gated suites on two empty databases of a non-isolated server, the PostgreSQL 17.6 server of the main Supabase project) | LB-4 |
| Q10 | isolated database platform: Data API exposure, roles, backup, PITR, failover, restart | `:1033`, `:1037`, `:1103` | database-backed | — | A4's PGlite proofs (`b24-a4-rls-default-deny`, `b24-a4-database-tls`, `b24-a4-test-isolation`, `b24-a4-rollback`, `b24-a4-restore`), C1-C3's PGlite records, D2's `b24-d2-restart-pglite`, in database-delivery | none | an isolated, disposable project, or the staging or production project's settings, grants, role attributes and backup plan (OD-191, OD-192, OD-194); a repaired Docker Desktop or a disposable PostgreSQL URL | BLOCKED-LIVE-QUALIFICATION | LB-14, LB-6 |
| Q11 | staging and production environments: a hosted deployment, the edge's TLS and headers, the Supabase Site URL and redirect list | `:1029`, `:1032` | external-provider staging | — | A1's deployment profile and blocker (`b24-a1-environment-profile`), `/api/health` and `/api/ready` (`b24-a1-readiness`), the `production-smoke` job (next build, next start, fail-closed probes; a CI server, not a hosted environment); A2's headers and per-environment auth URLs (`b24-a2-headers`) | none | the owner names the hosting platform and supplies isolated staging and production projects (OD-190, OD-191) | BLOCKED-LIVE-QUALIFICATION | LB-13 |
| Q12 | an approved external MCP server read live | `:1181` | external-provider staging | MCP readiness | the B20 client suites on fake servers (`b20-a2-tool-discovery`, `b20-d1-malicious-server`) in agent-boundary-suites; no `MCP_SERVER_REGISTRY` row is approved (`server-registry.ts:140`, OD-48) | none | an owner-approved external MCP server and an account for it (OD-48, OD-102) | BLOCKED-LIVE-QUALIFICATION | LB-16 |
| Q13 | the kicad-cli live oracle | `:1060` | physical-hardware validation | — | `kicad-cli-oracle` (B24-B3's repair: the routed demo behind a NOT MEASURED positive control; a `KICAD_CLI` naming no file fails NOT EXERCISED; it skips in prompt-to-gerber without `KICAD_CLI`); the deterministic geometry suites (`b18-e-via-facts`, `b18-c-dimension`) | none | a qualified runner or machine with the pinned kicad-cli (`KICAD_CLI`, `SIRKIT_KICAD_CLI_INSTALL_SHA256`) | BLOCKED-LIVE-QUALIFICATION | LB-17 |
| Q14 | Sirkit's read-only MCP server (nine reads), offline and in the fixture browser | `:1182` | deterministic offline | MCP readiness | `b20-c1-three-way-parity.test.ts:241` pins mcpExposed 9 in agent-boundary-suites; `e2e/mcp-endpoint.spec.ts` in page-browser-e2e under the fixture runtime | none | none: the server is Sirkit's own; proposals over MCP stay withheld (OD-82, OD-87) | NOT APPLICABLE | none |
| Q15 | multi-agent specialist orchestration with live models (B21's DAG: disagreement, fallback, quota failure) | `:1063`, `:1064`, `:1183` | model-in-loop | — | B21's suites offline in CI with scripted adapters and fake SDK clients, named as such: the prompt-to-gerber job lists `app/lib/agent/orchestration/__tests__` ([PR-G, 2026-10-17] OD-250: as a positional filter it excludes; the suites under it run in the agent-boundary-suites job, `ci-split.md` section 4), and the page-browser-e2e job runs `pnpm exec playwright test -c playwright.orchestration.config.ts` over `e2e-orchestration/specialist-orchestration.spec.ts` (both found by content, not line); B3b's two-provider capsule offline (`b24-b3-model-in-loop` 3) | none | credits on both providers, an owner price table and a money cap (OD-216); even then a two-provider capsule cannot force a disagreement or a fallback (OD-125) | BLOCKED-LIVE-QUALIFICATION | LB-9, LB-7 |

### 2.3 What the rows rest on

- **Q1's recorded runs.** R05-E2E01 (2026-07-29) predates this program's model-in-loop class: the report records a first prompt refused
  for an unfunded Anthropic account and then three live runs on `claude-opus-4-7` that completed every stage of the prompt-to-Gerber path
  (RECORDED from the report; no log was re-read). They were acceptance runs of the product path, with no spend limit and no contract
  turn, so item 1 stays BLOCKED-LIVE-QUALIFICATION; nothing in B24 has called a provider.
- **Q4's resource** is named by B22's pin names only (`runtime-profile.ts:33-34`, `:40`, `:338`; `b22-a3-runner-live.test.ts:17`), and
  this page names no retired ngspice variable. The sandbox rule holds: the 2026-10-02 result is `failing`, so Q4 stays BLOCKED whatever a
  later diagnostic run records.
- **Q6's expiry** is `ruleProfileExpiry(JLCPCB_2L_RULE_PROFILE_EVIDENCE.retrievedAt)` = 2027-09-09 (`rule-profile.ts:33-37`, `:48`), the
  same date the provider registry copies (`provider-registry.ts:185`); "the expiry date itself is still valid" (`:114`), so
  `ruleProfileEvidenceStatus` answers ok at 2027-09-09T23:59:59.999Z and expired at 2027-09-10T00:00:00.000Z, and a real-clock release is
  refused from 2027-09-10T00:00:00.000Z UTC (`release/route.ts:185-186`), not "about 2027-09-09". Renewal is an owner action and a reviewed
  code change: it moves the registry row, the date pins, the frozen fixture clock (`expected-identities.json:3`) and (INFERRED,
  `release-manifest.ts:137`) the release identity. At the expiry every provider observation and exchange goes stale (OD-168,
  `provider-observation.ts:238-239`). **CONFIRMED** (`b24-e-register` 9, 10).
- **Q7 and Q8** are D24-35 as recorded: OD-218's default holds - no fabrication, upload or order; no store, recording route or wired port.
  If the owner answers OD-218, those three are their own increment, not B24-E's (part 3.6).
- **Q9** is the one QUALIFIED row: LB-4's run, on the main project (OD-191 treats it as production), recorded as non-isolated; isolated
  staging is Q10 (LB-14).
- **Q14 and Q15** stand for the MCP and MULTI-AGENT status lines; their CI jobs are read from the workflow by `_ci-admission.ts`.

### 2.4 The status lines, for B24-F

B24-F's status-line -> row table (`final-verdict.md`, pinned by `b24-f-verdict-lines`) reads these row ids, never renumbered: provider Q1;
production auth Q2; database/RLS Q9 + Q10; component acquisition Q3; MCP Q12 + Q14; multi-agent Q15; sandbox Q4; manufacturing release
Q6; external quote/order Q5; physical hardware Q7 + Q8 (`STATUS_LINE_ROWS`, `_b24-e-register.ts`).

## Part 3. The register, its vocabulary and the statement tripwire (D24-33, OD-217)

### 3.1 The register in OD-217's vocabulary

Every classification cell of `LIVE_BLOCKERS.md` starts with exactly one of three forms, and nothing else comes first:
`BLOCKED-LIVE-QUALIFICATION` (optionally followed by a qualifier), `QUALIFIED (<YYYY-MM-DD>, <scope>, <resource>)` with no comma in the scope
or the resource, or `NOT APPLICABLE`. Four cells change; each keeps its old wording in the same cell as `[B24-E, 2026-10-10] was "<old
text>" (OD-217)`:

| row | was (f663d71, unchanged at 6e4e1bb) | becomes |
|---|---|---|
| LB-2 | UNKNOWN | BLOCKED-LIVE-QUALIFICATION |
| LB-3 | local-only; CI replays committed recordings keyed by placed-board revision and refuses unknown boards | BLOCKED-LIVE-QUALIFICATION for CI and qualified platforms |
| LB-4 | dead external resource; one opt-in DB test fails in the default suite | QUALIFIED (2026-09-24, migrations and the nine DB-gated suites on two empty databases of a non-isolated server, the PostgreSQL 17.6 server of the main Supabase project); isolated staging: BLOCKED-LIVE-QUALIFICATION (LB-14) |
| LB-5 | not attempted | BLOCKED-LIVE-QUALIFICATION |

LB-4's check keeps "points to a project that no longer resolves" with a dated note that the clause is stale. Dated notes in the "unblocks
when" cells: LB-1 (this harness, plus a staging-list entry; LB-13), LB-2, LB-7 and LB-9 (an owner price table in the one table and a money
cap passed to B3b's command, plus credits), LB-5 (OD-218's approval, then the store, the route and the port as their own increment), and
one note each on LB-13..LB-17, checked against OD-217's title and pointing at their rows here. No row is added and none is renumbered
(LB-13 is A1's, LB-14 A4's, LB-15..LB-17 B1's); every 6e4e1bb cell stays the prefix of its cell (`b24-e-register` 5 pins the prefixes by
digest). The register and `PROGRAM_STATE.json` are the lead's files (lead decision D14): this increment drafts both in full, checks the
drafts with the suite's own functions, and the lead applies them. **PROPOSED** until applied; `b24-e-register` 1, 3-5 and 8 are red until
then (part 3.5).

### 3.2 The mirror, and OD-179 reversed

`PROGRAM_STATE.json` `liveBlockers` becomes one string per register row, in id order, `"LB-<n>: <form>: <check, short>"`, the id and the
form equal to the register's; the LB-13..LB-17 lines A1, A4 and B1 added keep their id and classification and only take the string form.
Before, it held thirteen strings, three with no LB id or form and LB-4, LB-6, LB-7 and LB-8 left out by OD-179's choice
(`OWNER_DECISIONS.md:1984-1985`); OD-217 reverses that choice (a dated OD-179 note is the lead's). No other key changes.

### 3.3 The statement tripwire (`b24-e-statements`)

- **Scope.** Production copy: `app`, `lib`, `components`, `scripts`, `e2e`, `e2e-orchestration`, `e2e-production-auth` and the root source
  files (the B21-B23 tripwires read the first six and the root files; none reads `e2e-production-auth/`). Pages: every
  `artifacts/**.md` but `artifacts/remaining-builder-program/`, B24's README and discovery and this page; `docs/**.md`; `README.md`. Test
  files are not copy.
- **The vocabulary**, closed, 22 forms in the task's twelve kinds, each pinned by its own claimed examples and by a negated or conditional
  non-claim: (a) a live provider turn or evaluation passed, or a multi-agent run with live models passed; (b) production or staging
  authentication passed; (c) a live distributor check passed; (d) a run on the qualified sandbox platform; (e) a board fabricated,
  assembled, inspected, functionally or electrically tested, or physically validated; (f) a blocked readiness scope stated as ready; (g) a
  real-server or staging database property verified; (h) Sirkit deployed to, or verified on, a staging or production environment; (i) a
  live external MCP server consumed, or its contract passed; (j) the kicad-cli live oracle passed; (k) a live router run in CI or on a
  qualified runner; (l) a live DFM, quote or order exchange. It is a vocabulary: a phrasing outside it is not seen.
- **What admits a statement**, exactly one of: a negation or a condition that governs it; an allow-list entry by exact text, with its
  reason, its count and the matrix row whose recorded live runs hold it; or B24-E's dated in-place note after the statement it supersedes.
- **[B24-E review, 2026-10-10] A negation governs a statement only where B23's tripwire would read one (correctness-2, security-2).**
  The first rule admitted any statement with a negation, a condition or a time word anywhere earlier in its sentence, back 160
  characters to a full stop, a semicolon, a cell or a paragraph - so "When the owner supplied the isolated project on 2026-10-12,
  production authentication passed." and "LB-1 is no longer blocked: production authentication passed." were admitted. Now a statement
  is negated or conditional only by: a verb negation or a modal right before its verb, with only auxiliaries and adverbs between ("has
  not been exercised", "could have passed"); or, right before its first word with only articles, "of", "that", auxiliaries and a few
  adverbs between, a negation ("No live provider turn", "Nothing was qualified"), a negated reporting verb ("does not mean a board was
  fabricated"), a condition ("if", "unless", "whether"), or a time word ("until", "before", "when", "once") before a present or perfect
  verb only - before a simple past a time word dates a claim ("When the live provider turn passed"), as B23's lead decided. A comma, a
  colon, a full stop, any bracket or cell mark, and a blank line end the words read. "blocked", "missing", "absent", "may", "could" and
  "should" admit nothing from earlier in the sentence. For a negation of a shape the rule does not parse, a reviewed exact text with its
  reason and count admits it, held unparsed and note-free so the list cannot rot (one entry, below). Case 3 pins eleven claims with an
  earlier negated, conditional or dated clause as reported and seven governed negations as admitted.
- **[B24-E review, 2026-10-10] A note admits only the statement it supersedes (correctness-3).** The first rule admitted every claim that
  ended before the note on its line; now the statement must lie inside the noted statement (`NOTED`'s claim) that ends before the note.
  The register's LB-3 form ends on a lookahead so the statement is exactly that claim. Case 3 pins a claim before the noted statement
  and one between it and its note as reported.
- **Self-checks**: every allow-list row exists in the matrix and its recorded runs hold its date; every row citing an LB (Q1-Q5, Q7-Q13,
  Q15) is spoken for by a kind, and Q6 and Q14 by none; admissions are counted per entry; a claim planted in production copy or a page,
  appended to an allowed text, moved to another file, or written after or inside a note is reported; every foreign note prefix, tag and
  claim word is assembled at run time, so the suite spells no B21, B22 or B23 note.
- **The finds at `6e4e1bb`**, triaged: one, `artifacts/ai-control-plane-b20/final-verdict.md:58-59` ("WAS qualified on a real PostgreSQL
  17.6 server on 2026-09-24 (LB-4)", form g) - allowed, Q9's recorded run. B22-D's and B22-A3's diagnostic runs match no form, so they need
  no entry. During this increment the tripwire also caught B24-E's own new config header (part 1.7), reworded before the commit.
- **[B24-E review, 2026-10-10] The finds under the local rule.** Of the nine statements of the vocabulary in scope (the first rule
  admitted eight), the local rule admits seven: three by a verb negation, two by a negation before the subject, one by a time word
  before a present verb, and `artifacts/ai-control-plane-b16-1c/fabrication-profile-sources.md:36` ("does not mean a board was
  fabricated") by its negated reporting verb. It reports two: `artifacts/ai-control-plane-b20/final-verdict.md:59` (allowed, Q9) and
  `artifacts/footprint-binding-remediation/r03-b10d-u01-report.md:80` ("no revision-zero or empty committed board is fabricated": R03's
  loader contract, the word in its sense of "invented", negated by the determiner of a four-word noun phrase), which is the one reviewed
  negation. No new note was needed.

### 3.4 Superseded statements (file:line, for B24-F's one table)

Noted in place by B24-E, each with `[superseded 2026-10-10 by B24-E (D24-33, OD-217): ...]` in its own block on the statement's line, the
text never rewritten and no line added (eight, of a budget of ten):

| line | statement | the note says |
|---|---|---|
| `artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md:157` | LB-4 "dead external resource" | QUALIFIED (2026-09-24, ...), non-isolated; isolated staging LB-14 |
| `artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:172` | LB-2 "UNKNOWN" | BLOCKED-LIVE-QUALIFICATION; credits, a price table and a cap (OD-216) |
| `artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:173` | LB-3 "local-only" | BLOCKED-LIVE-QUALIFICATION for CI and qualified platforms |
| `artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:174` | LB-4 "dead external resource" | as `:157` above |
| `artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:175` | LB-5 "not attempted" | BLOCKED-LIVE-QUALIFICATION; nothing until OD-218 |
| `artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md:49` | OD-179: LB-4, LB-6, LB-7 and LB-8 "stay unmirrored" | the mirror holds every row (OD-217) |
| `artifacts/ai-control-plane-b23/unknowns-and-owner-decisions.md:200` | LB-5 "not attempted" | BLOCKED-LIVE-QUALIFICATION; nothing until OD-218, then its own increment |
| `artifacts/ai-control-plane-b23/physical-evidence.md:271` | LB-5 (C41) "stays not attempted", unblocking on "B24-E" | BLOCKED-LIVE-QUALIFICATION; E built nothing (OD-218); C41's anchor narrowed to the row's first two cells (`:746`) |

Left for the closeout's one table (OD-221), each admitted by its exact text and counted (`b24-e-statements` 6): B21's and B18's
close-time copies of the register's old words, `artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md:155` (LB-2 UNKNOWN),
`artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md:156` (LB-3 local-only),
`artifacts/ai-control-plane-b21/unknowns-and-owner-decisions.md:158` (LB-5 not attempted) and
`artifacts/ai-control-plane-b18/unknowns-and-owner-decisions.md:12` (U18-3 "not attempted (LB-5)").

Also superseded by this increment, in the lead's files, for the closure clauses rather than a note: the discovery's D24-33 finding
(the register's mixed vocabulary, LB-4 stale, the eight-of-twelve mirror), D24-34's "every Playwright run is `local_dev`" (still true of
every run; the production-auth config exists and has never run), section 2.7's item 2 "no browser spec exists", and item 7's "B24-E adds
the store, the session-derived recording route and the wired review port only if OD-218 is answered" (part 3.6).

### 3.5 Test-first record (Eb)

| run | what | result |
|---|---|---|
| `e-red-2-register-statements` | `b24-e-register` and `b24-e-statements` on the tree before the notes, the matrix and the drafts | red: register 1, 3, 4, 5 (the four cells outside the closed set; the mirror's three id-less strings and missing LB-4, LB-6, LB-7, LB-8), 2 (then also counting classifications; split into `classificationProblems` so 2 reads the shape alone and is green on `6e4e1bb`), 7, 8, 9 (no matrix); statements 1 (the new config's header, a sign-in claim), 2, 4 (no matrix), 3, 5, 6 (no note); 3 passed (register 6, 10; statements 7); exit 1 |
| `e-fix-red-1` | [B24-E review, 2026-10-10] `b24-e-statements` with case 3 strengthened, on the reviewed rule | red on case 3 alone, twelve problems: the claim before a noted statement and the claim between it and its note, each admitted by the note (correctness-3); ten claims after an earlier clause, each admitted by a word in it - "When ... , production authentication passed.", "Once credits arrived, ...", "LB-1, blocked since B16, is closed: ...", "LB-1 is no longer blocked: ...", "... yet.(newline)Production authentication passed ...", "When ..., Sirkit was deployed to production.", "When the live provider turn passed, ...", "Missing credits aside, ...", "The live provider turn that had not run before passed.", "The capsule may be retired, but ..." (correctness-2, security-2); exit 1 |
| `e-fix-green-1` | the local rule and the note fix | red on case 6 only: the register's LB-3 form ended on its following character, one past the noted claim, so the stricter note no longer admitted `b22 unknowns:173`; the form now ends on a lookahead; exit 1 |
| `e-fix-green-2` | after that | 7 of 7, exit 0 |

### 3.6 What stays open

- **Every live gate is BLOCKED-LIVE-QUALIFICATION** but Q9, which is QUALIFIED on a non-isolated server; nothing here converts a
  fake-backed result into a live claim (runbook `:1123`). "Application complete" may be claimed only for the scopes whose gates pass, and
  physical product completion needs physical evidence (`:1157`): none exists.
- **Item 7 departs from the discovery's section 7**, which said B24-E adds the store, the session-derived recording route and the wired
  review port if OD-218 is answered. At `6e4e1bb` `OWNER_DECISIONS.md` holds no answer to OD-218, so nothing is built; and when the owner
  answers, those three are their own increment, not B24-E's (a dated section-10 amendment and an OD choice, the lead's).
- ~~**`next start` binds every interface by default**~~ - [B24-E review, 2026-10-10] closed (security-4): the command passes `--hostname
  127.0.0.1` and the server's environment blanks `SIRKIT_TRUSTED_CLIENT_IP_HEADER` (part 1.3); a departure from the task's verbatim
  command, recorded in OD-238 (e).
- **The tripwire's local rule is a vocabulary too** (INFERRED): a negation it does not parse is reported, not admitted (a false report,
  never a false admission), and is either rephrased or reviewed by exact text; a governed negation through a longer noun phrase ("no
  revision-zero or empty committed board") is the one such shape at this tree.
- **B1's browser-E2E reading** (`golden-catalog.ts`, `browser_e2e`) names the two fixture configs; the production-auth spec is linked from no
  catalog row, because it has never run. INFERRED: B24-F may link it as an opt-in browser spec under LB-1 and LB-13.
- **The project-ref rule** (twenty lower-case letters or digits) is INFERRED from Supabase's refs; a target with another shape is refused
  `target_list_malformed` until a reviewed change widens it.

### 3.7 Gates (2026-10-10, two vitest workers, one heavy job at a time; Ea and Eb on one tree)

Every run went through the lock scripts; no Playwright config, no live suite with its flag and no Java-capable `app/lib/pcb` suite ran.

| gate | files | tests | exit |
|---|---|---|---|
| the baseline on `6e4e1bb`, B24-E's files set aside: `app/lib/qualification/__tests__` | 43 passed, 3 skipped (46) | 463 passed, 15 skipped | 0 |
| the baseline: `b21-f-page`, the three closeout tripwires, `b23-d-latent-claim-paths`, `b23-d-physical-evidence-contract`, `b24-a4-test-isolation` | 7 passed | 84 passed | 0 |
| `app/lib/qualification/__tests__` (B24-E's three suites with it) | 45 passed, 3 skipped, 1 failed (49) | 482 passed, 15 skipped, 5 failed: `b24-e-register` 1, 3, 4, 5, 8, which read the register and its mirror before the lead applies the drafts | 1 |
| `app/lib/agent/orchestration/__tests__` (`b21-f-page`, `b21-closeout-statements`, the sha pins), `b22-closeout-statements`, `b23-closeout-statements`, `b14-4-ast-import-gates`, `b19-e-ci-job-scope`, `b20-a0-feature-flag` | 54 passed | 536 passed | 0 |
| `app/lib/auth/__tests__`, `app/api/auth/__tests__` | 42 passed | 486 passed, 9 skipped | 0 |
| `app/lib/manufacturing-providers/__tests__` (the `b23-d-*` suites, `b23-a-provider-registry`, `b23-a-provider-admission`, `b23-closeout-statements`), `b22-a2-blocked-runner` | 30 passed | 393 passed | 0 |
| `app/lib/pcb/fab/__tests__`, `app/lib/mcp` (`b20-c1-three-way-parity`: 48 / 37 / 9 / 28) | 52 passed | 876 passed | 0 |
| `app/lib/acquisition/__tests__`, `app/lib/engineering/__tests__`, `b16-1c-invariant-tripwires` (168 = 165 + 3 + 0) | 114 passed, 1 skipped | 1,329 passed, 2 skipped | 0 |
| `b11-5-capture-exactness`, `b24-a4-test-isolation` | 2 passed | 34 passed | 0 |
| the drafted register and mirror through `b24-e-register`'s own functions (cases 1-5 and 8 re-run as a script) | - | 75 checks pass; HEAD's register and mirror fail 47 of them | 0; 1 on HEAD |
| `tsc --noEmit` | - | - | 0 |
| `eslint` on the 13 changed and new TypeScript files | - | - | 0 |
| the four B24 generators (eval catalog, scenario map, threshold census, accessible names), twice | - | zero drift between the runs; only `threshold-census.csv` moves, 306 -> 311 rows (three budget and two yield rows of B24-E's suites) | 0 |
| A2's nine secret-scan rules over the 22 changed and new files and the two drafts; control bytes and CR | - | 0 hits; none | 0 |

B24-E's suites alone: `b24-e-production-auth-config` 7 of 7, `b24-e-statements` 7 of 7 (about 1.7 s), `b24-e-register` 5 of 10 until the
lead applies the drafts, then 10 of 10 (shown by function on the drafts). Strength by deliberate breakage, each restored by its sha256
(`e-break-1`): a one-character change to Q6's release id fails `b24-e-register` 9; one entry on `PRODUCTION_AUTH_STAGING_TARGETS` fails
`b24-e-production-auth-config` 2 and `b24-e-register` 9; "Sirkit is deployed to production." appended to a B24 page fails
`b24-e-statements` 2 at its line.

**[B24-E review, 2026-10-10] Re-run after the review's fixes** (correctness-1..4, security-1..4; logs `e-fix-*`), on one tree, the same
way:

| gate | files | tests | exit |
|---|---|---|---|
| `app/lib/qualification/__tests__` | 45 passed, 3 skipped, 1 failed (49) | 483 passed, 15 skipped, 5 failed: the same `b24-e-register` 1, 3, 4, 5, 8 until the lead applies the drafts (the first re-run, `e-fix-gate-1`, also failed `b24-a1-flags` 1 and 2: a helper inserted mid-module moved the inventory's owner line `production-auth-target.ts:179`; the review's declarations now stand at the module's end and every cited line is back) | 1 |
| orchestration, the three closeout tripwires, `b14-4-ast-import-gates`, `b19-e-ci-job-scope`, `b20-a0-feature-flag` | 54 passed | 536 passed | 0 |
| `app/lib/auth/__tests__`, `app/api/auth/__tests__` | 42 passed | 486 passed, 9 skipped | 0 |
| `app/lib/manufacturing-providers/__tests__`, `b22-a2-blocked-runner` | 30 passed | 393 passed | 0 |
| `app/lib/pcb/fab/__tests__`, `app/lib/mcp` (48 / 37 / 9 / 28) | 52 passed | 876 passed | 0 |
| `app/lib/acquisition/__tests__`, `app/lib/engineering/__tests__`, `b16-1c-invariant-tripwires` (168 = 165 + 3 + 0) | 114 passed, 1 skipped | 1,329 passed, 2 skipped | 0 |
| `b11-5-capture-exactness`, `b24-a4-test-isolation` | 2 passed | 34 passed | 0 |
| B24-E's three suites and the three closeout tripwires | 5 passed, 1 failed | 47 passed, 5 failed (the same register cases) | 1 |
| the drafts (the LB-13 note reworded for the loopback command) through `b24-e-register`'s functions | - | 75 checks pass | 0 |
| `tsc --noEmit`; `eslint` on the 14 changed and new TypeScript files (`sign-in-form.ts` the new one) | - | - | 0; 0 |
| the four B24 generators, twice | - | zero drift against the tree before them and between the runs (the review's tests add no budget and no yield) | 0 |
| A2's nine secret-scan rules over the 23 changed and new files and the two drafts; control bytes and CR | - | 0 hits; none | 0 |

`b24-e-production-auth-config` is now 8 of 8 and `b24-e-statements` 7 of 7. Strength, each breakage restored by sha256 and re-run on the
final module layout: `e-fix-break-1`..`-6` and `e-fix-break-1-final`, `-2-final` (part 1.7); `e-fix-break-6` (the answer's wait left
unobserved after a failed click) passed every case but failed the run on vitest's unhandled rejection, exit 1.
