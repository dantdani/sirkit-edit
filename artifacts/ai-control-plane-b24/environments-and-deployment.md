# B24-A1 - Environment profile, production-mode CI, health, readiness, configuration, flags

Labels: **CONFIRMED** (executed here and measured, or read at the cited file:line), **INFERRED** (code reading, nothing executed),
**PROPOSED** (designed, not exercised), **RECORDED** (written down from a document without a claim of our own), **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION** (needs a live resource the owner has not supplied; never faked, never claimed).

Base: `8664964` on `chapter/b24-production-qualification` (main `57c3b29` after PR #14, tree `f663d71`, plus the committed B24
discovery). B24-A1 closes D24-1 offline, D24-9, D24-10 and D24-11 (discovery `:552`, `:612`, `:616`, `:623`; runbook B24-A `:1029`,
`:1040-1042`, `:1044`). It was delivered as A1a (items 1-4: the profile, the configuration record, the flag inventory and the sandbox
switch, the CI admission) then A1b (items 5-6: health and readiness, production mode in CI) in one workflow run, for one commit by the
lead. Every citation in section 14 is the line at this increment's working tree; the discovery lines are its numbering at `8664964`.
[B24-A1 check, 2026-10-06] Its two workflow rows (C35, C47) stay A1's lines after later B24 insertions: no later task moves them, and
`b24-a1-environment-profile` 14 carries them through section 10's insertion rows (section 10).

## 0. What B24-A1 is

- **What it is.** An explicit deployment profile over `mode.ts` (unchanged), one sensitive-route blocker that also refuses a production
  runtime without a serving profile or an expected origin, a versioned and digested deployment configuration record, the Anthropic model
  setting as a decision (refused rather than sent), the Anthropic client's `timeout: 120_000`, a flag inventory of every `SIRKIT_*`
  name read in code with each flag's default pinned through its owner, an off-only switch for B22's diagnostic runner, `GET /api/health`
  and `GET /api/ready`, the CI admission of the `b24-` suites, and a `production-smoke` CI job written to build and start the
  production server and probe its fail-closed answers - **PROPOSED** until the lead's local production-mode run and its first CI run
  are green (section 6; nothing has built or started it yet).
- **What it is not.** No deployment, no live host, no account, no DNS or TLS action, no real database, no provider key or call: every
  live step is **BLOCKED-LIVE-QUALIFICATION** under LB-13 (section 7). No platform deployment file is written (OD-190). The builder ran
  no `next build`, `next start` or `next dev`: the job is written and its shape pinned, and the local production-mode run is the lead's
  (section 13). No UI control, no agent tool (the counts stay 47 / 36 / 9 / 27), no runtime dependency (OD-42), no edit to the nine
  B11-scanned files or to `mode.ts`; the 555 release identity and B17's 631 control sites on 63 surfaces are unchanged.
- **The census moved once, by review:** 168 = 165 canonical + 3 factories + 0 raw (was 166 = 163 + 3 + 0), by the two route files. The
  action records are 107 (was 106), by one record, `project.service-health`.

## 1. The deployment profile (D24-1 offline, OD-190)

- **The vocabulary.** `SIRKIT_DEPLOYMENT_ENV` takes `development`, `ci`, `staging` or `production`, exactly: no trim, no case folding.
  An absent variable is `unset`, anything else `invalid`, and the value is never echoed (`deployment-profile.ts`, C1-C3). **CONFIRMED**
  (`b24-a1-environment-profile` 1, 2).
- **The resolver.** `resolveDeploymentProfile(env)` returns `{ runtime, declared, servesSensitiveRoutes }`. In a production runtime
  (`isProductionRuntime`, `mode.ts:22-24`) only staging and production serve; in a non-production runtime the profile never blocks, so
  local_dev stays as it is. **CONFIRMED** (case 2; case 7 resolves a local principal under a `ci` profile).
- **The blocker.** `productionServingBlocker(env)` checks, in order: (a) `sensitiveOperationsBlocker` (C5, its text unchanged) ->
  `AUTH_PRODUCTION_NOT_CONFIGURED`; (b) in a production runtime, a profile that does not serve -> `AUTH_PRODUCTION_NOT_CONFIGURED`, the
  message naming only `SIRKIT_DEPLOYMENT_ENV`; (c) in a production runtime, a missing or malformed `SIRKIT_EXPECTED_ORIGIN` ->
  `AUTH_ORIGIN_NOT_CONFIGURED` or `AUTH_ORIGIN_CONFIG_MALFORMED`, derived through `resolveExpectedOrigin` (C6) with the auth mode
  forced to production, so the request URL is never consulted (`productionExpectedOrigin`, C3). The order keeps
  `b16-1b-auth-composition` (`:209`, `:215-221`) and `b20-b2-mcp-endpoint` (`:657-667`) green unchanged. **CONFIRMED** (case 3, and
  both suites in the gates).
- **Reads too.** Before A1 only state-changing requests checked the origin (`trusted-request-context.ts:68-73`), so an authenticated
  GET passed in production with no expected origin. Step (c) now refuses it with the existing codes `b16-0-2-csrf-exact-origin` pins
  (`:181`). **CONFIRMED** (case 6).
- **Wiring.** In place, line count unchanged, at the blocker's only two callers: `trusted-request-context.ts:24` and `:63-65` (C7, C8)
  and the MCP wrapper, `route-handlers.ts:46` and `:1010-1011` (C9, C10). **CONFIRMED** (cases 8 and 9: no other production source
  calls it; `sensitiveOperationsBlocker` is now called only by the profile module and readiness).
- **What is not blocked, by design.** The worker and public paths (`authorize.ts:62-83`, C11, C12) never call the blocker: a worker
  secret and a public row are served in a production runtime with no profile and no Supabase. **CONFIRMED** (case 9).
- **The fixtures that gained the profile.** Four auth suites outside CI build a production runtime: `b16-1b-auth-composition:29`,
  `b16-1b-real-sdk-identity:29`, `b16-1b-session-liveness:42` (which also gains the origin) and `b16-0-2-csrf-exact-origin:19-23`. Each
  gains `SIRKIT_DEPLOYMENT_ENV: "production"` in place with a dated note; their assertions are unchanged.
- **`.env.example`** declares `# SIRKIT_DEPLOYMENT_ENV=` commented and empty after `:79`, its four values named (case 10).

## 2. The configuration record and the runtime report (D24-10, OD-199)

- **The record.** `buildDeploymentConfiguration(env)` (C13) builds one deep-frozen `sirkit.deployment-configuration.v1` digested by
  `engineeringDigest`; `deploymentConfiguration()` builds it once per process, at first use, over `process.env`, with a reset for tests
  only. It holds names and closed states only: the profile and auth mode; OpenAI's model (`configuredOpenAIModel`), effort (the rule of
  `openai-config.ts:47-50` over the environment handed in, pinned equal to `configuredOpenAIReasoningEffort` under a stubbed
  `process.env` for every value of the source's own list, which the record's copy equals, since that reader takes `process.env`
  alone); the Anthropic model setting; every provider SDK client Sirkit builds, by the code that builds it, each with its timeout and
  retries (C52, C53; [B24-A1 review] coverage-4 - before the review the record named only the agent adapters' as if they were the
  provider's): the agent coordinator (OpenAI 120,000 ms and 2, Anthropic 120,000 ms and the SDK default), a specialist (120,000 ms and
  0), the llmRouter behind the model-calling routes (OpenAI 600,000 ms and 5, C54; Anthropic the SDK defaults, C55), the embedding
  client (C56) and the parts-search reranker (C57, both the SDK defaults); the role table (`ROLE_PROVIDER_POLICY` with
  `parseRoleModelOverrides`; an invalid override is `provider_policy_invalid`, never echoed); the registry versions each beside an
  `engineeringDigest` of the rows production reads - `SOURCE_REGISTRY`, the `MCP_SERVER_REGISTRY` rows and `PROVIDER_ROWS` (C14; D7),
  so a row change without a version bump still moves the record; the embedding and rerank models, copied (C15, C16) with source-reading
  parity cases; the runtime profiles through `runtimeProfiles()` (referenced, never re-created); `sirkitToolRegistry().digest()`; key
  presence; every flag state of the inventory. **CONFIRMED** (`b24-a1-configuration` 1-3, 9-14; sentinels never appear, case 2, a
  stage and two list values included; every construction site is read and the agent clients are built against the mocked SDK, case
  14; each recorded flag state equals its owner's answer, `b24-a1-flags` 3 and 4).
- **What it never names.** No A1 production file names B23's test oracle `PROVIDER_REGISTRY` or a generator render, or imports a module
  the B23 closeout records as dormant; the ordering switch is read by its owner's rule (any non-blank value,
  `ordering-enablement.ts:104-105`), copied, with a parity case against `orderingEnablement({ env })`. **CONFIRMED** (case 10, case 12,
  and `b23-closeout-statements` case 7 in the gates).
- **The Anthropic model setting.** `anthropicModelSetting(env)` is appended after `anthropic-config.ts:16` (C17): unset is the default,
  a value equal to its trim is exactly `configuredAnthropicModel`'s, an empty or padded value is refused as
  `SIRKIT_ANTHROPIC_MODEL_EMPTY` or `SIRKIT_ANTHROPIC_MODEL_PADDED`. The module stays dependency-free and B21's `:11` holds.
- **Refused rather than sent.** `sendableAnthropicModel` (`anthropic-model-guard.ts`, C18) throws `LLMProviderError("anthropic",
  "bad_request")` while the request is built, in place at `adapters.ts:219` and `anthropic-provider.ts:107` (C20, C22), each import after
  the file's last line (C21, C23): neither client calls the SDK with an empty or padded model. No provider-SDK importer is added. [PR-L step 0, 2026-10-17] C23 190 -> 196: the generation-budget correction (OD-251) adds the SDK request options and the aborted-error handling above the footer import; the anchor is unchanged and still after the file's last line, the `b24-a1-configuration` case 8 pin moved with it. Appended on this line so no line moves.
  [B24-A1 review] regressions-4: the refusal carries its own message (C58): Sirkit did not send the request, and the cause is the server
  setting `SIRKIT_ANTHROPIC_MODEL` - not the generic `bad_request` text, which says Anthropic rejected a request Sirkit built. The reason
  stays `bad_request`, as the task text set it (OD-223 (l)). **CONFIRMED** (`b24-a1-configuration` 7, 8).
- **The Anthropic client timeout.** `adapters.ts:213` gains `timeout: 120_000` in place (C19), OpenAI's value (`:112`) and the loop's
  run deadline (`contracts.ts:185`, C24), spelled before the retries so B21-E1's C19 anchor stays unique. **CONFIRMED** (case 5: the
  coordinator's client options are `apiKey`, `maxRetries` (undefined) and `timeout`).
- **`/api/ai/runtime`.** `route.ts:16` (C25) reads `anthropicModelSetting()`: a refused setting reports `model: null` and a label that
  names the variable; the keys stay `embeddings`/`providers` and `anthropic`/`openai`, and it stays 200 (Playwright's start probe).
  **CONFIRMED** (case 7).

## 3. The flag inventory and the sandbox switch (D24-11, OD-200)

- **The inventory.** `FLAG_INVENTORY` (`flag-inventory.ts`, C26) is data, imports nothing, and lists the 49 `SIRKIT_*` names read in
  code (comments aside) under `app/`, `lib/`, `components/`, `scripts/`, the root configs and both Playwright configs, outside tests -
  47 at `8664964` and A1's two - each with its kind, default, direction, owner `file:line` and the owner's exported name constant (or
  null). Every other `SIRKIT_` token is one of eleven reviewed exclusions, one reason each (bundle file names, a SPICE model name, the
  stage-report names, two constants, the two Anthropic refusal codes, the `_ENV` constants of inventoried names, and the two atomic
  catalog names inside a description string). **CONFIRMED** (`b24-a1-flags` 1, 2: the census is re-derived from the tree). [B24-A2, 2026-10-06] 49 -> 51: B24-A2 reads and appends `SIRKIT_MCP_TOKEN_SECRET_PREVIOUS` and `SIRKIT_WORKFLOW_WORKER_SECRET_PREVIOUS` (kind secret, verification only; D16, OD-195), on the lines of their current names (`flag-inventory.ts:84`, `:99`), and moved `b24-a1-flags` case 1 in place with a dated note. [B24-A3, 2026-10-06] 51 -> 52: B24-A3 reads and appends `SIRKIT_TRUSTED_CLIENT_IP_HEADER` (kind configuration: the trusted proxy header that keys the public per-client windows, unset by default; D16, OD-197) on the line of `SIRKIT_PHYSICAL_BINDING_SHADOW` (`flag-inventory.ts:98`), and moved `b24-a1-flags` case 1 in place with a dated note. [B24-B3, 2026-10-08] 52 -> 62: B24-B3's live-suite registry (`app/lib/evaluation/live-suites.ts`, OD-209) reads ten live-suite and opt-in names by name - `SIRKIT_LIVE_AUTH_QUALIFICATION` and its six `SIRKIT_AUTH_QUALIFICATION_*` resources, `SIRKIT_LIVE_ACQUISITION_CONTRACT`, `SIRKIT_B22_LIVE_RUNNER` and B24-B2's `SIRKIT_B24_CORPUS_NIGHTLY` - kind live-test-gate, appended on the lines of their sorted neighbours (`flag-inventory.ts:56`, `:57`, `:77`), and moved `b24-a1-flags` case 1 and `b24-a2-env-names` case 10 in place with dated notes. [B24-D1, 2026-10-09] 62 -> 65: B24-D1 reads and appends `SIRKIT_B24_BENCHMARK` (kind live-test-gate: the latency benchmark flag, measurement only, set by `benchmark-latency`'s vitest step), `SIRKIT_B24_BENCHMARK_DIR` and `SIRKIT_JOB_STARTED_AT` (kind tooling: the results directory outside the repository and the CI job's start second; D16, OD-212, OD-30), on the lines of their sorted neighbours (`flag-inventory.ts:57`, `:75`), and moved `b24-a1-flags` case 1 and `b24-a2-env-names` case 10 in place with dated notes. [B24-D4, 2026-10-10] 65 -> 66: B24-D4 (OD-30's split of page-browser-e2e, the lead's option A) reads and appends `SIRKIT_E2E_SKIP` (kind tooling: the spec globs a browser run leaves out, read on `playwright.config.ts:21` and set by CI's page-browser-e2e step; direction disables, a list parse; no flag state is recorded), on the line of its sorted neighbour `SIRKIT_E2E_PORT` (`flag-inventory.ts:65`), and moved `b24-a1-flags` case 1 and `b24-a2-env-names` cases 5, 9 and 10 in place with dated notes. [B24-E, 2026-10-10] 66 -> 67: B24-E's production-auth target (`app/lib/deployment/production-auth-target.ts`, D24-34 offline, OD-191) reads `SIRKIT_AUTH_QUALIFICATION_TENANT_ID` in production code (kind live-test-gate: the selector tenant, default `local`; the other seven live-auth names were already B24-B3's rows), appended on the line of its sorted neighbour `SIRKIT_AUTH_QUALIFICATION_PROJECT_ID` (`flag-inventory.ts:56`), and moved `b24-a1-flags` case 1 and `b24-a2-env-names` cases 5 and 10 in place with dated notes.
- **The kinds** are closed: enable-flag (3), disable-switch (5), rollout-stage (4), shadow (2), fixture (6), live-test-gate (4),
  configuration (19), secret (3), tooling (3). `SIRKIT_AUTH_MODE` is configuration, never a fixture. B24-A2 pins the map to its census
  classes (D16); B24-D1 adds its three names in these kinds (D15). Live-suite flags read only by tests are B24-B3's (OD-209). [B24-A2, 2026-10-06] secret (3) -> secret (5): the same two `*_PREVIOUS` names. [B24-A3, 2026-10-06] configuration (19) -> configuration (20): `SIRKIT_TRUSTED_CLIENT_IP_HEADER`. [B24-B3, 2026-10-08] live-test-gate (4) -> live-test-gate (14): the ten names above. [B24-D4, 2026-10-10] tooling (5) -> tooling (6): `SIRKIT_E2E_SKIP` (B24-D1's two tooling names made it 5). [B24-E, 2026-10-10] live-test-gate (15) -> live-test-gate (16): `SIRKIT_AUTH_QUALIFICATION_TENANT_ID` (B24-D1's `SIRKIT_B24_BENCHMARK` made it 15). [PR-D, 2026-10-17] 67 -> 68: `SIRKIT_BUILD_ITERATION_CAP` (configuration: PR-C's operator cap of the Build generation's model turns, an integer 1..20 lowering `BUILD_BUDGET.iterationCap`; owner `app/lib/schematic/build-result.ts:75`, constant `BUILD_ITERATION_CAP_ENV`; read in production since 6bdd7f7 and censused here, OD-242); configuration (20) -> configuration (21). Appended on this line so no line moves. [PR-L step 0, 2026-10-17] the owner line is now `build-result.ts:80` (OD-251: the generation-budget correction added fields and a comment above it); appended on this line so no line moves. [PR-L6, 2026-10-19] 68 -> 74: + `SIRKIT_GENERATION_ALLOWANCE_MODEL_CALLS`, `_OUTPUT_TOKENS`, `_INPUT_TOKENS`, `_CATALOG_SEARCHES`, `_WALL_CLOCK_MS` (configuration: the operator's per-task allowance unit, which may only lower the default and adds an optional input dimension; owner `app/lib/generation-task/contracts.ts:159`, read once by the composition root; OD-252 item 1, OD-253 item 6) and `SIRKIT_CATALOG_SEARCH_CONCURRENCY` (configuration: the catalog slots' bound, which may only lower `min(4, max(1, SIRKIT_DB_POOL_MAX - 3))`; owner `app/lib/schematic/catalog-slots.ts:16`, constant `CATALOG_SEARCH_CONCURRENCY_ENV`; L.6 part 2 item 5); configuration (21) -> configuration (27). [PR-L6 spend, 2026-10-19] 74 -> 75: + `SIRKIT_POST_APPLY_INPUT_TOKENS` (configuration: the per-request input ceiling of the post-apply Tidy and Review calls, default 200000, which an integer 1..199999 may only LOWER; owner `app/lib/llm/post-apply-admission.ts:26`, constant `POST_APPLY_INPUT_TOKENS_ENV`; SPEND-3, runbook line 28 and L.6), inserted on the line of its sorted neighbour `SIRKIT_PHYSICAL_BINDING_SHADOW` (`flag-inventory.ts:98`), and moved `b24-a1-flags` case 1 and `b24-a2-env-names` cases 5 and 10 in place with dated notes; configuration (27) -> configuration (28).
- **Defaults pinned through the owners.** With an empty environment MCP, orchestration and named computations are off, the four stages
  off, both shadows off, every off-only switch unset; each flag's parse equals its owner's over sample values. **CONFIRMED** (cases 3, 4).
- **The off-only switches** only ever turn something off (acquisition sources, manufacturing providers, ordering, MCP servers, the
  diagnostic runner). **CONFIRMED** (case 5).
- **The sandbox switch.** `SIRKIT_DIAGNOSTIC_RUNNER_DISABLED`, any non-blank value (the `SIRKIT_ORDERING_DISABLED` precedent), refuses
  every run and every install check of B22's diagnostic runner first with a new code, `NGSPICE_DIAGNOSTIC_DISABLED`. One read is
  answered from memory, with no refusal and no process: a version line already probed, for an install handed to
  `diagnosticNgspiceVersion` as `verified` (C60; the worker verifies the install first, so its run still refuses). [B24-A1 review] coverage-6: the earlier
  text claimed more than this. The code is appended to the union on
  `:74` (C27), the check prepended in place on `:249` (in `preflight`, for `verifyDiagnosticInstall`) and `:633` (in
  `runDiagnosticNgspice`, before the deck screen) (C28, C29), the reader after `:755` (C31); B22's C42 (`:692`, C30) holds. "1", "true",
  " 1" and "0" disable; unset, "" and " " do not. Nothing turns anything on, and production simulation stays BLOCKED (B22). The callers
  already map the refusal: `/api/simulate` answers 503 (C32) and the computation executor refuses with the code (C33). **CONFIRMED**
  (cases 6-8, 10). `.env.example` declares `# SIRKIT_DIAGNOSTIC_RUNNER_DISABLED=` (case 9).

## 4. CI admission of b24- (OD-222)

`b19-e-ci-job-scope.test.ts:54` takes `"b24-"`, appended in place with a dated note on `:53` (C34); one filter line,
`app/lib/qualification/__tests__`, is inserted after `deterministic-manufacturing.yml:227` (C35). No A1 suite starts PGlite, so all four
run in prompt-to-gerber. A1 builds no shared CI-admission helper (B24-B1 builds its own, D17). The B22 C77 and B23 C15 anchors on the
`CHAPTERS` line were re-pinned in place, and the four workflow pins after `:227` moved +1 (sections 9 and 10). **CONFIRMED**
(`b19-e-ci-job-scope` in the gates; `b24-a1-environment-profile` 12).

## 5. Health and readiness (D24-9, OD-198)

- **`GET /api/health`** (C36) is public liveness through `publicRoute`: `{ ok: true }`, no-store, reading nothing. **CONFIRMED**
  (`b24-a1-readiness` 2).
- **`GET /api/ready`** (C37) is on the worker class through `workerRoute` (`verifyWorkerSecret`, C38): 401 without the credential,
  else 200 or 503 with `{ ready, checks, configurationDigest }`. Its row comes from a reviewed read-only constructor, `readOnlyWorker`
  (C40), not `worker()`, which hard-codes an authoritative write: no write, no transfer, no spend, no credit. Both rows are appended in
  place at the end of `route-policy.ts:304` (C39), whose head anchors B23's C13. **CONFIRMED** (cases 1, 3, 4).
- **The checks** (`readiness.ts`, C41): `deployment_profile`, `auth_mode`, `supabase_auth_configuration`, `expected_origin`,
  `database`, `openai_api_key`, `anthropic_api_key`, `anthropic_model_setting`, `role_table`, each a name and a closed state. Ready
  requires every check but the two key checks, which are reported only. Every auth check is derived through its owner function:
  `supabase_auth_configuration` is `configured` exactly when `sensitiveOperationsBlocker` passes with production forced (the anon-key
  fallback and a set-but-empty publishable key behave as `mode.ts:89-91`), `expected_origin` through `resolveExpectedOrigin`'s rules
  with production forced, `deployment_profile` through `resolveDeploymentProfile`. No value appears; sentinels prove it. **CONFIRMED**
  (cases 4-6).
- **The database probe** is an injected port: the default runs `select 1` through `getSqlClient()` (C42, C43), bounded at 2,000 ms;
  an unset or blank `DATABASE_URL` answers `not_configured` without connecting, a throw `unreachable`, a stall `timeout` within the
  bound (its signal aborted). The suites inject fakes only: no database was contacted (runbook `:1044`). **CONFIRMED** (case 7).
  [B24-A1 review] regressions-1 / tests-3: before the review, case 10 called the route with no fake port, so a shell that exported
  `DATABASE_URL` would have reached the default port and a real database. Now a refusing guard port replaces the default before every
  case, `getSqlClient` is replaced by a fake that never builds a client, and a case that reaches it unasked fails; case 10 runs with
  `DATABASE_URL` set, as a shell export would set it. **CONFIRMED** (case 10). tests-6: the route's own bound and the default port are
  exercised under a fake clock - a stalled database answers `timeout` at 2,000 ms and not before, and the default port's `select 1` is
  cancelled when the bound expires; a port that throws at once answers `unreachable`. **CONFIRMED** (case 11).
- **Least privilege, RECORDED.** The worker secret that reads readiness also authorizes the three worker write routes
  (`route-policy.ts:101-103`); a separate credential is OD-195's (B24-A2).
- **The classification.** Both rows derive `model_egress` false, `outbound_egress` `none` and no `external_process`; ready is annotated
  `durable: "none"`, `sensitivity: "none"` in place on `route-resource-classification.ts:99` (C44), health is static. Neither route binds
  an SDK client. **CONFIRMED** (case 8; `b23-a-route-vocabulary` 4 and 8 and `b22-a2-process-census` derive them in the gates).
- **The action registry.** One record, `project.service-health` (read, api-only, no tool, approval none), owns both routes. It is appended
  at the registry's end, on `action-registry.ts:186` after B23-C's record (C45), not on `:162` as the task text said: on `:162` the B01
  matrix would have moved B23's line-checked C51 (`ui-command-toolability-matrix.csv:107`, `b23-c-ordering-disabled` 7), a pin the task
  does not list. The two route rows are appended in place on `:276` (C46). **CONFIRMED** (case 8: the matrix keeps provider-order on
  row 107).

## 6. Production mode in CI (D24-1 offline, OD-190)

- **The job.** `production-smoke` is appended after the last line of `page-browser-e2e` (C47), so no cited line moves: the usual
  setup, `pnpm exec next build` with a 4 GB heap, then `pnpm exec next start` in the background, `timeout-minutes: 20`. The server's
  environment is `SIRKIT_DEPLOYMENT_ENV=ci`, `SIRKIT_EXPECTED_ORIGIN=http://localhost:3200` and a worker secret generated per run with
  `openssl rand -hex 32` and masked; no Supabase, database, provider or fixture variable. **PROPOSED** until its first CI run; its shape
  is **CONFIRMED** (`b24-a1-environment-profile` 11).
- **The probes:** health 200; ready 503 naming `deployment_profile`, `supabase_auth_configuration` and `database` as failing, without the
  secret; ready 401 without the credential; `GET /api/agent/autonomy` with a project selector 403 `AUTH_PRODUCTION_NOT_CONFIGURED`;
  `POST /api/auth/signout` 403 `AUTH_CROSS_ORIGIN_DENIED` from `http://evil.example` and 503 `AUTH_SIGNOUT_UNAVAILABLE` from the
  server's own origin (sign-out is a public CSRF row that never reaches the blocker, so together these show the built server honours
  the configured expected origin, the `b16-0-24-tranche-parity:231-237` and `b16-0-2-mode-diagnostics:80-90` precedents); the
  `Content-Security-Policy` header present; `/api/ai/runtime` 200. An `always()` step stops the server and the logs upload on failure.
  No `secrets.` reference; `permissions` unchanged (`:20-21`).
- **INFERRED**: on a probe without cookies, `proxy.ts`'s `updateSession` passes straight through when Supabase is not configured
  (`supabase-server.ts:46`, C48), so the probes reach the route handlers; this was read, not run on a built server.
- **The `next build` history (RECORDED):** B16.1B built twice, each `next build` exit 0, then `next start` on loopback 3100
  (`artifacts/ai-control-plane-b16-1b/test-and-validation-report.md:70`); footprint-binding stages 01-04 each built with exit 0
  (their stage reports); stage 05's two builds did not finish in about 6-8 minutes
  (`docs/stage-reports/SIRKIT_FOOTPRINT_BINDING_STAGE_05_IMPLEMENTATION.md:146`); B22 ran none (`final-verdict.md:110`). A gitignored
  `.next/` folder (about 3.4 GB, a `BUILD_ID` dated 2026-09-07 and a later `dev/` folder) was found in this working tree and removed
  before the whole-tree import gates, as the task requires; which build wrote it is not recorded. The job is the first `next build` in
  CI and the first since B22 added `engine-worker.mjs`.
- **Durations and `engine-worker.mjs`: UNKNOWN here.** The builder runs no build. The job prints "next build took N s", "next start
  answered after N s" and whether `engine-worker.mjs` is emitted; the lead's local run (section 13) and the first CI run record them.
  Named computations stay off (`SIRKIT_NAMED_COMPUTATIONS` unset).

[B24-A1 lead, 2026-10-06] **The lead's local production-mode run** of the job's steps, before the commit: a fresh detached worktree
holding the uncommitted A1 tree, no `.env*` file but `.env.example`, every live variable explicitly empty, dependencies installed as
CI installs them (`pnpm install --frozen-lockfile --offline`, pnpm 11.2.2). `next build` exit 0 in **234 s**; `engine-worker.mjs`
**emitted**, as the hashed asset `.next/server/assets/engine-worker.<hash>.mjs`; `next start` answered after **2 s**; the job's sixteen
probe checks all passed and no answer carried the worker secret. CONFIRMED (locally; the job's first CI run is recorded with the next
increment). Two earlier attempts failed on the lead's environment, not on A1: Turbopack refuses a `node_modules` junction that points
outside the project root, and a long worktree path pushed pnpm's deepest package past Windows' 260-character limit.

## 7. Live: BLOCKED-LIVE-QUALIFICATION (LB-13)

- Staging and production environments, the edge's TLS and headers, and the Supabase Site URL and redirect list (discovery `:941`) are
  **BLOCKED-LIVE-QUALIFICATION** (LB-13): no staging or production project exists and nothing was deployed.
- The hosting platform is **UNKNOWN** (OD-190): no platform deployment file was written, and none exists in the repository.
- LB-10 is still blocked: production simulation authority stays BLOCKED (B22), and OD-190 still gates it.
- Real dependency health in staging (a real database, real Supabase, a real provider key) is **BLOCKED-LIVE-QUALIFICATION** (LB-13):
  readiness was proven against fake ports only. The main Supabase project is production (OD-191) and was not contacted.
- What the CI job will prove is a production build of this tree starting and refusing; it is not a deployment and proves nothing of a
  live host.

## 8. Test-first record

| run | tree | result |
|---|---|---|
| red 1 | `8664964` + the four suites only | 4 files failed to load (`Cannot find module` for `deployment/configuration`, `auth/deployment-profile`, `deployment/flag-inventory`, `api/health/route`); no tests; vitest exit 1 |
| red 2 | + the new modules, not wired (no edit to the callers, the adapters, the route, the runner's checks, the workflow or `.env.example`) | three suites: 20 failed, 17 passed, exit 1 - each counterexample failing for its reason (below) |
| green | the increment | the four suites 47 / 47 (15 + 13 + 9 + 10) |

The counterexamples in red 2:
- a production runtime with Supabase and the origin set but no profile resolved (`b24-a1-environment-profile` 4), a `ci` profile
  resolved (5), and with profile `production` and no origin an authenticated GET passed (6); the MCP wrapper answered 503
  `MCP_NOT_CONFIGURED` with no profile (8);
- the coordinator's Anthropic client options were `apiKey` and `maxRetries` only (`b24-a1-configuration` 5), and with
  `SIRKIT_ANTHROPIC_MODEL=""` the route reported `claude-opus-4-7` (7);
- with `SIRKIT_DIAGNOSTIC_RUNNER_DISABLED=1` a fake-host pinned run still reached its install check, refusing
  `NGSPICE_DIAGNOSTIC_INSTALL_UNREADABLE` (`b24-a1-flags` 7);
- the readiness suite could not load (no route file; `policyFor("/api/ready", "GET")` null).

### The review round (2026-10-06)

An adversarial review confirmed 14 findings (13 distinct: regressions-1 and tests-3 are one). Each was reproduced first on the tree
before its fix, through the lock script, then fixed and re-run. **CONFIRMED** (executed here):

| run | tree | result |
|---|---|---|
| review red 1 | the A1 tree + the strengthened suites only (no fix) | 11 failed, 43 passed (54), exit 1 - each reproduction failing for its reason (below); environment-profile 13 failed only on the it( counts this table had not yet moved |
| review red 2 | + `jobOrderProblems` fixed, `shiftTableProblems` not | `b24-a1-environment-profile` 16 alone: failed, 12 rows off their anchors after a simulated C1 insertion recorded in place (exit 1) |
| review green | the fixes | the four suites 54 / 54 (19 + 14 + 10 + 11), exit 0 |
| mutations | each deliberate breakage applied, run, then the source restored and its sha256 checked equal | every one caught, exit 1 each (below); the tree hashed identical before and after all seven |

What each reproduction showed before its fix:
- regressions-1 / tests-3: with `DATABASE_URL` set as a shell export sets it, `b24-a1-readiness` 10 reached the default port - the
  database client was requested twice (the suite's fake refused it, so nothing connected) and the guard port never ran;
- regressions-2: a simulated B24-A2 job appended after A1's CI job failed case 11's order check (a job header followed A1's); with
  that fixed, a simulated C1 line after the PGlite entry, recorded in place, left 12 table rows off their anchors (red 2);
- regressions-3: B23's `dfm-quote-flow.md:269` cited `:301`, now `app/lib/physical-binding/__tests__/b19-e-successor-b14-durable.test.ts`;
- regressions-4: both Anthropic clients surfaced "Anthropic rejected the request as malformed ..." for a model never sent;
- coverage-1: section 0's statement of the job carried no PROPOSED (the first of several);
- coverage-2: the amendment named none of the census pins (its first missing entry, `b16-1c-invariant-tripwires.test.ts`);
- coverage-4: the record held no llmRouter client (`undefined`, expected 600,000 ms and 5 retries);
- coverage-6: section 3 said the switch refused "every entry"; the cached version line was in fact answered (the behavioural half of
  `b24-a1-flags` 10 passed before its statement check failed);
- tests-4: with `SIRKIT_OPENAI_MODEL=o3-mini` in the process, `b24-a1-flags` 3 compared the inventory's "high" with `undefined`.

The test-strength findings (tests-1, tests-2, tests-5, tests-6, and coverage-4's parity) were green on the A1 tree, so each
strengthened case was proven against a deliberate breakage of the source, restored afterwards (sha256 equal):

| breakage | file | caught by |
|---|---|---|
| a flag's exact compare made truthy (`value ? "on" : "off"`) | `configuration.ts` | `b24-a1-flags` 4 (`SIRKIT_MCP_ENABLED " "` recorded on) |
| a stage echoed (`value?.trim() ?? "off"`) | `configuration.ts` | `b24-a1-flags` 4 and `b24-a1-configuration` 2 (the stage sentinel in the record) |
| the origin checks moved before the profile check | `deployment-profile.ts` | `b24-a1-environment-profile` 3, 4 and 8 (`AUTH_ORIGIN_NOT_CONFIGURED` where the profile answers) |
| "ultra" added to the source's effort list | `openai-config.ts` | `b24-a1-configuration` 3 (the copy no longer equals the source) |
| the route's default bound 60,000 ms | `readiness.ts` | `b24-a1-readiness` 11 (not settled at 2,000 ms) |
| the default port's cancel on abort removed | `readiness.ts` | `b24-a1-readiness` 11 (no cancel) |
| the llmRouter's OpenAI retries 6 | `openai-provider.ts` | `b24-a1-configuration` 14 (the record says 5) |

### The check round (2026-10-06)

An independent check of the review fixes found two low issues. Each was reproduced first on the tree, through the lock script, then
fixed and re-run. **CONFIRMED** (executed here):
- check-1: case 17 pinned B23's prose citation on `dfm-quote-flow.md:269` to `:302` with A1's exact note text, so a later task that
  inserts lines above the PGlite entry (B2, B3, D1) had to rewrite A1's case whether it left the citation alone (as `task-D1.md:553-554`
  says) or moved it with its own note. The same trap sat in case 12 (A1's filter pinned at `:228`, B23's at `:227`, and D1's first
  step lands above both), in section 14's C35 and C47 (moved in place while section 10 was carried) and in case 11 (the permissions at
  `:20-21`).
- check-2: the insertion-table protocol was handed to A2, C1 and C2 only. A4, B2, B3, C3, D1 and D2 also insert workflow lines, and
  their task files tell them to move B24 page citations in place, which case 14 refuses by design.

| run | tree | result |
|---|---|---|
| check red 1 | the A1 tree + the new expectations, with the checks' logic as the review round left it | `b24-a1-environment-profile`: 4 failed, 16 passed (20), exit 1. Case 16: the nine tasks' 13 planned groups, recorded in the handover's row form, left all 17 old -> new rows off their anchors (the rows were not composed). Case 17: with B2's, B3's and D1's insertions recorded and the citation moved with each task's own note, "dfm-quote-flow.md:269 does not cite :302 with A1's note". Case 20: section 10 did not name A2, A4, B2, B3, C1, C2, C3, D1 and D2. Case 13: the it( count (20; the table said 19) |
| check green | the fixes | `b24-a1-environment-profile` 20 / 20, exit 0 |
| mutations | each breakage applied, the suite run, the file restored and its sha256 checked equal | 16 of 16 caught, exit 1 each (below); the tree hashed identical before and after |

| breakage | file | caught by |
|---|---|---|
| the line-total check dropped | the suite | 16 (A2's appended job left unrecorded: no "53 recorded") |
| the frozen old column dropped | the suite | 16 (both columns moved in place) |
| the job check dropped | the suite | 16 (a wrong job) |
| a malformed row skipped | the suite | 16 (the review round's row form) |
| the rows not carried | the suite | 16 (19 problems on the planned edits) |
| a row's first line read as the line it follows (`>` for `>=`) | the suite | 16 (5 problems on the planned edits) |
| only A1's note required on the prose citation | the suite | 17 (no B2 note reported) |
| section 14's workflow rows not carried | the suite | 16 (C35 and C47 off their anchors) |
| case 12's `:228` pin put back | the suite | 16 ("A1's filter is not on :228" on the planned edits; the tree itself passed) |
| case 17's `:302` pin put back | the suite | 17 ("not :302 with A1's note" on the planned edits; the tree itself passed) |
| the prose citation set to `:301` | `dfm-quote-flow.md` | 17 |
| A1's note stripped from that line | `dfm-quote-flow.md` | 17 |
| one unrecorded line inside A1's CI job | the workflow | 14, 16 |
| a row with no insertion | this page | 14, 16 |
| section 10's PGlite row's new cell set to `:303` | this page | 14, 16, 17 |
| `contents: write` | the workflow | 11 |

[B24-A1 lead, 2026-10-06] The check round's own check raised one more low issue: case 11's "no `secrets.` reference" guard was
`\bsecrets\.` over the whole workflow, which also matches B24-A2's planned `scripts/scan-secrets.ts` step, so A2 would have had to edit
A1's test logic. The lead closed it test-first: case 16 now applies the guard to the simulated planned workflow, which failed on the old
pattern (`a1lead-secrets-red2`); the guard is now a GitHub `${{ ... secrets. ... }}` expression (`SECRETS_REFERENCE`, at the suite's end),
green with the three closeout tripwires (`a1lead-secrets-green`, 4 files, 47 tests), and case 16 pins that such an expression is still
refused. CONFIRMED

## 9. Every pin moved, and why

| pin | move | why |
|---|---|---|
| `b16-1c-invariant-tripwires.test.ts` header `:5`, title `:38`, `:48` | 166 / 163 -> 168 / 165, in place, dated `[B24-A1, 2026-10-06]` | the census, by review (OD-198) |
| `b16-1b-auth-composition.test.ts` `:242`, `:255` | 166 / 163 -> 168 / 165, in place, dated | the census |
| `b22-a2-process-census.test.ts` `:315`, `:317` | 166 -> 168, in place, dated | the census (neither route reaches a spawner) |
| `b23-a-no-order-structural.test.ts` `:183` | 166 -> 168, in place, dated | the census (neither row is spend) |
| `b23-a-route-vocabulary.test.ts` `:11`, `:618`, `:658`, `:778-779` | 166 -> 168, in place, dated | the census |
| `b23-b-exchange-route.test.ts` `:104`, `:116` | 166 / 163 -> 168 / 165, in place, dated | the census |
| `b23-a-provider-admission.test.ts` case 8, `:50` | the push skips a path under `B24_QUALIFICATION_ROOTS` (declared after the last line); `:164-165` byte for byte; `it(` count 11 | D6, the one reviewed move: the B24 roots admitted as a class by prefix |
| `b23-a-tier3-vocabulary.test.ts` `:272`; B23 C52 (`ordering-boundary.md:570`) | 106 -> 107, in place, dated; C52 re-anchored to the dated line | one action record (D9) |
| B21-E1 C20 (`provider-routing-and-failure.md:661`) | anchor re-pinned in place to the new `:213` text, dated | the Anthropic client timeout |
| `b21-e1-provider-policy.test.ts` `:168` | the Anthropic client's keys `["apiKey", "maxRetries", "timeout"]`, in place, dated (`:178` holds) | the Anthropic client timeout |
| B22 C77 (`deck-and-secret-corrections.md:484`), B23 C15 (`provider-registry.md:303`) | the `CHAPTERS` anchor re-pinned in place, dated | `b24-` admitted (OD-222) |
| B23 C64 (`dfm-quote-flow.md:537`) | `:301` -> `:302`; its table has no note column, so the dated note stands in place on the paragraph above it (`:470`, [B24-A1 review] regressions-3) | the filter line after `:227` |
| B23 prose citation `dfm-quote-flow.md:269` (the PGlite entry, "an explicit database-delivery entry") | `:301` -> `:302`, in place, dated (C59; [B24-A1 review] regressions-3: missed before the review) | the filter line after `:227` |
| B21 C49, C93, C94 (`evaluation-matrix.md:1139, :1183, :1184`) | `:333` -> `:334`, `:336` -> `:337`, `:345` -> `:346`, in place, dated | the filter line after `:227` |
| `live-auth-qualification-matrix.md:64`, `b16-1b-live-qualification.test.ts:12` | a dated trailing note, no line moved | the B16.1B recipe now needs the profile |
| `b16-1b-auth-composition:29`, `b16-1b-real-sdk-identity:29`, `b16-1b-session-liveness:42`, `b16-0-2-csrf-exact-origin:19-23` | the production fixtures gain the profile (the liveness one the origin too), in place, dated | a production runtime now needs them |
| the generated CSVs | B01 `api-route-coverage.csv`, `ui-command-toolability-matrix.csv`; B16.0 `auth-route-coverage.csv`; B16.0.1 `exact-route-authorization-policy.csv`; B16.0.2 classification CSV; B16.0.4's two matrices; B16.0.7 `route-wrapper-matrix.csv` - each regenerated by its generator, two rows (one in the action matrix) added, nothing else | the two routes and the record |

Unmoved, as required: 47 / 36 / 9 / 27; B17's 631 / 63; the 555 release identity; the nine B11-scanned files; `mode.ts`.

## 10. The workflow shift (old -> new)

Every `deterministic-manufacturing.yml` line from 228 on that the discovery or a later B24 task file cites moved +1 after A1's filter
line (the old numbers are `f663d71`'s and `8664964`'s; the anchor is checked on the new line by `b24-a1-environment-profile` 14).
The discovery's older numbers (`:315`, `:271-300`, `:284`, `:284-300`, `:315-334`) are `50fe156`'s history and do not move.

| old | new | anchor | who cites it |
|---|---|---|---|
| `:50-259` | `:50-260` | `--outputFile=vitest-deterministic-manufacturing.xml` | discovery 1.3; task B2 |
| `:260-270` | `:261-271` | `retention-days: 14` | task D1 |
| `:272-302` | `:273-303` | `--outputFile=vitest-database-delivery.xml` | discovery 1.3, 3; task A3 |
| `:272-309` | `:273-310` | `if-no-files-found: ignore` | discovery 9.6; task F |
| `:276` | `:277` | `- uses: actions/checkout@v4` | task F |
| `:285` | `:286` | `# No DATABASE_URL, no qualification marker` | discovery D24-7 |
| `:285-302` | `:286-303` | `--outputFile=vitest-database-delivery.xml` | discovery 2.2 |
| `:286-302` | `:287-303` | `--outputFile=vitest-database-delivery.xml` | discovery 9.6; tasks B2, C2, D2 |
| `:301` | `:302` | `b23-b-exchange-ledger-pglite.test.ts` | discovery 2.4, 7, 9.3, 9.4; B23 C64 and the prose citation `dfm-quote-flow.md:269`; tasks C1, C3 |
| `:317` | `:318` | `page-browser-e2e:` | discovery 0, 2.6 |
| `:317-336` | `:318-337` | `run: pnpm exec playwright test -c playwright.orchestration.config.ts` | discovery 1.3 |
| `:319` | `:320` | `timeout-minutes: 30` | discovery 2.6, 5, 9.4; task D3 |
| `:323` | `:324` | `- uses: actions/checkout@v4` | task F |
| `:333` | `:334` | `- run: pnpm exec playwright test` | B21 C49; tasks B2, D3, E |
| `:336` | `:337` | `run: pnpm exec playwright test -c playwright.orchestration.config.ts` | B21 C93; tasks B2, E |
| `:345` | `:346` | `playwright-report-orchestration` | B21 C94 |
| `:348` | `:349` | `retention-days: 14` | task A2 (A1's job is appended after it) |

[B24-A1 review] regressions-2: the table above is A1's own shift and never moves. Case 11 pins only that `production-smoke` is the job
after `page-browser-e2e`, so a job appended after it is allowed.

[B24-A1 check, 2026-10-06] The review round's note here named only B3, C1 and C2 and gave a row of another form; it is replaced by
the following. The later B24 tasks that insert workflow lines are, by their task files read at this date (section 13):
A2, A4, B2, B3, C1, C2, C3, D1 and D2 (A3, B1, D3, E and F add none). [B24-D4, 2026-10-10] B24-D4, the lead's corrective increment under OD-30, appends two rows below: page-browser-e2e's `env:` mapping (`SIRKIT_E2E_SKIP`) and the appended `page-browser-e2e-b24` job (its count includes the leading blank line; [B24-D4 lead, 2026-10-10] named for B24's own browser specs, B24-D2's two and B24-D3's two, by the lead's option (b), `ci-split.md` section 11.9). [PR-G, 2026-10-17] PR-G (OD-250: the 19 pr- suites no CI job selected admitted to prompt-to-gerber and moved with the `app/lib/agent/orchestration/__tests__` filter to agent-boundary-suites, `ci-split.md` section 4) appends five rows below in the same form under its own id, `[PR-G, 2026-10-17]` (the row pattern of `b24-a1-environment-profile`, `b24-d0-ci-split` and `b24-d4-browser-split` admits `PR-[A-G]` beside `B24-<id>`), and joins five wrapped lines of section 11 (no word changed) so every line from section 12 on keeps its number.
None of them rewrites the table above or moves any workflow line number on this page, here or in section 14. For each contiguous
group of lines it inserts - an appended job, and lines inside `production-smoke` (PROPOSED until its first CI run), included - it
appends one row to the insertion table below, in insertion order: ``| [B24-<id>, <date>] | <job> | `:<first>` | <count> |``, where
<first> is the group's first line in the workflow as that task leaves it (one task's groups one row each, top to bottom).
`b24-a1-environment-profile` 14 composes every row. It carries each old -> new row, and section 14's C35 and C47, through the rows to
the line where the anchor must stand; it checks that the old column is A1's, that each row's lines lie in its job (blank and comment
lines just above a job header belong to that job), and that the rows account for every line the workflow gained since A1's 435. Case
16 simulates the nine tasks' 59 planned lines in 13 groups passing that way, and shows each designed failure: an insertion left
unrecorded, the new column or both columns moved in place, an earlier row edited, a wrong count, a wrong job, a row in the old form, a
section-14 number moved as well as recorded. Case 17 resolves B23's prose citation of the PGlite entry by its content, and requires
a dated note on its line from A1 and from every task whose rows moved the entry. Case 12 finds A1's filter line by its content. The
handover text the lead pastes into the nine task files is in section 13.

| task | job | first line | count |
|---|---|---|---|
| [B24-A2, 2026-10-06] | production-smoke | `:420` | 11 |
| [B24-A2, 2026-10-06] | secret-scan | `:447` | 26 |
| [B24-A4, 2026-10-08] | database-delivery | `:303` | 4 |
| [B24-B2, 2026-10-08] | prompt-to-gerber | `:260` | 32 |
| [B24-B3, 2026-10-08] | prompt-to-gerber | `:292` | 1 |
| [B24-C1, 2026-10-08] | database-delivery | `:340` | 1 |
| [B24-C2, 2026-10-08] | database-delivery | `:341` | 1 |
| [B24-C3, 2026-10-09] | database-delivery | `:342` | 1 |
| [B24-D0, 2026-10-09] | prompt-to-gerber | `:293` | 38 |
| [B24-D0, 2026-10-09] | agent-boundary-suites | `:551` | 66 |
| [B24-D1, 2026-10-09] | prompt-to-gerber | `:32` | 1 |
| [B24-D1, 2026-10-09] | prompt-to-gerber | `:344` | 2 |
| [B24-D1, 2026-10-09] | page-browser-e2e | `:405` | 1 |
| [B24-D1, 2026-10-09] | page-browser-e2e | `:432` | 2 |
| [B24-D1, 2026-10-09] | agent-boundary-suites | `:565` | 1 |
| [B24-D1, 2026-10-09] | agent-boundary-suites | `:624` | 2 |
| [B24-D2, 2026-10-09] | database-delivery | `:384` | 1 |
| [B24-D4, 2026-10-10] | page-browser-e2e | `:418` | 2 |
| [B24-D4, 2026-10-10] | page-browser-e2e-b24 | `:629` | 35 |
| [PR-G, 2026-10-17] | prompt-to-gerber | `:294` | 19 |
| [PR-G, 2026-10-17] | prompt-to-gerber | `:316` | 1 |
| [PR-G, 2026-10-17] | prompt-to-gerber | `:352` | 19 |
| [PR-G, 2026-10-17] | agent-boundary-suites | `:622` | 1 |
| [PR-G, 2026-10-17] | agent-boundary-suites | `:658` | 19 |

## 11. Gates

| suite | `it(` |
|---|---|
| `app/lib/qualification/__tests__/b24-a1-environment-profile.test.ts` | 20 |
| `app/lib/qualification/__tests__/b24-a1-configuration.test.ts` | 14 |
| `app/lib/qualification/__tests__/b24-a1-flags.test.ts` | 10 |
| `app/lib/qualification/__tests__/b24-a1-readiness.test.ts` | 11 |

[B24-A1 check, 2026-10-06] `b24-a1-environment-profile` went from 19 to 20 cases (case 20, the handover); the four suites now hold 55.

Every gate below ran through the lock script (two workers), one at a time, every process stopped after; `.next/` was removed before the first. Counts are files, then tests.

| gate | result |
|---|---|
| the four suites (`b24-a1-environment-profile`, `b24-a1-configuration`, `b24-a1-flags`, `b24-a1-readiness`) | 4 files; 47 passed; exit 0 |
| `app/lib/auth/__tests__` | 41 files; 479 passed, 9 skipped; exit 0 |
| `app/api/__tests__`, `app/api/mcp/__tests__`, `app/api/chat/__tests__` | 56 files; 1303 passed; exit 0 |
| `app/lib/manufacturing-providers` (the PGlite suite included), `app/lib/acquisition/__tests__` | 44 files passed, 1 skipped; 606 passed, 2 skipped; exit 0 (the final run; the first run's three failures are below) |
| `app/lib/mcp`, `app/lib/llm`, `app/lib/fixture-runtime` | 55 files; 867 passed; exit 0 |
| `app/lib/agent/__tests__`, `app/lib/agent/orchestration/__tests__` | 85 files; 875 passed; exit 0 |
| `app/lib/computation/__tests__`, `app/api/simulate/__tests__`, `app/lib/spice/__tests__` | 33 files passed, 3 skipped; 596 passed, 21 skipped; exit 0 |
| `app/lib/engineering/__tests__` | 99 files; 1107 passed; exit 0 |
| `app/lib/project/__tests__`, `b15-2-1-residual-closure`, `b15-2-2-exact-outline-and-shape` | 39 files; 323 passed; exit 0 |
| `app/lib/db/__tests__/b16-b-database-qualification.test.ts` (reads the B16.1B live file) | 1 file; 26 passed; exit 0 |
| the four suites with `b21-closeout-statements`, `b22-closeout-statements` and `b23-closeout-statements`, on the final tree with this page | 7 files; 74 passed; exit 0 |
| `tsc --noEmit -p tsconfig.json` (4 GB heap) | exit 0 |
| eslint on every changed or new `.ts` file (35) | exit 0, no warning |
| the 21 generators | each exit 0; no drift (status, tracked diff and new files hashed before and after) |
| a content scan of every changed or new file (control bytes, CRLF, PEM markers, provider key shapes; the staged-content scan is the lead's) | none found |

Found in the run and fixed before the final gates (each was this increment's own slip, caught by an existing gate):
- `b23-a-provider-admission` case 8 listed the new B24 files until its one reviewed move (D6) landed;
- `b23-closeout-statements` case 7 refused `b24-a1-configuration` for spelling B23's deferred retirement (`DC-05R`) in a list of names production must not use; the name was dropped from the list (the closeout's own case pins it);
- `b23-d-physical-evidence-contract` case 8 refused the flag inventory for spelling the evidence module's path in an exclusion's sites; the exclusion now cites no site and says why.
No other gate failed; no case timed out and no `Timeout calling onTaskUpdate` was seen.

### The review round's gates (2026-10-06, the final tree)

The table above is A1's own run. After the review fixes every gate ran again through the lock script, one at a time, with no `.next/` present, every process stopped after. **CONFIRMED**:

| gate | result |
|---|---|
| the four suites with `b21-closeout-statements`, `b22-closeout-statements` and `b23-closeout-statements`, on the final tree with this page | 7 files; 81 passed (54 + 27); exit 0 |
| `app/lib/auth/__tests__` | 41 files; 479 passed, 9 skipped; exit 0 |
| `app/api/__tests__`, `app/api/mcp/__tests__`, `app/api/chat/__tests__` | 56 files; 1303 passed; exit 0 |
| `app/lib/manufacturing-providers` (the PGlite suite and `b23-b-dfm-quote-flow-page` included), `app/lib/acquisition/__tests__` | 44 files passed, 1 skipped; 606 passed, 2 skipped; exit 0 |
| `app/lib/mcp`, `app/lib/llm`, `app/lib/fixture-runtime` | 55 files; 867 passed; exit 0 |
| `app/lib/agent/__tests__`, `app/lib/agent/orchestration/__tests__` | 85 files; 875 passed; exit 0 |
| `app/lib/computation/__tests__`, `app/api/simulate/__tests__`, `app/lib/spice/__tests__` | 33 files passed, 3 skipped; 596 passed, 21 skipped; exit 0 |
| `app/lib/engineering/__tests__` | 99 files; 1107 passed; exit 0 |
| `app/lib/project/__tests__`, `b15-2-1-residual-closure`, `b15-2-2-exact-outline-and-shape` | 39 files; 323 passed; exit 0 |
| `app/lib/db/__tests__/b16-b-database-qualification.test.ts` | 1 file; 26 passed; exit 0 |
| `tsc --noEmit -p tsconfig.json` (4 GB heap) | exit 0 |
| eslint on every changed or new `.ts` file (35) | exit 0, no warning |
| the 21 generators | each exit 0; no drift (status, every changed or new file's hash and the tracked diff identical before and after) |
| a byte scan of every file the review round changed (control bytes, CR, PEM markers, provider key shapes) | none found |

No gate failed, no case timed out and no `Timeout calling onTaskUpdate` was seen. The slowest new case is `b24-a1-flags` 4 (about 1.2 s here; it declares a 30 s timeout).

### The check round's gates (2026-10-06, the final tree)

The check round changed only `b24-a1-environment-profile` and this page. Each gate ran through the lock script, one at a time, with no
`.next/` present and every process stopped after. **CONFIRMED**:

| gate | result |
|---|---|
| `app/lib/qualification/__tests__` (the four suites), `b21-closeout-statements`, `b22-closeout-statements`, `b23-closeout-statements`, `b21-f-page`, `b23-b-dfm-quote-flow-page`, `b19-e-ci-job-scope` | 10 files; 125 passed (55 + 70); exit 0 |
| `app/lib/auth/__tests__` (the four production-fixture suites among them) | 41 files; 479 passed, 9 skipped; exit 0 |
| `app/lib/engineering/__tests__` | 99 files; 1107 passed; exit 0 |
| `tsc --noEmit -p tsconfig.json` (4 GB heap) | exit 0 |
| eslint on the one changed `.ts` file | exit 0, no warning |
| generators | none run: no generator reads either changed file, and no generated artifact changed |
| a byte scan of both changed files (CR, control bytes, PEM markers, provider key shapes) | none found |

No gate failed and no case timed out.

## 12. Statements A1 supersedes

For B24-F's single table at closeout commit 1/2 (D5); A1 changes none of them itself:
- discovery `:205-209` (section 2.1: "Two runtime states only ... No staging, CI or preview identifier is read anywhere") - since A1 the
  deployment profile is read (D24-1's closure clause covers it);
- discovery `:235-237` (section 2.1: "No health or readiness route") - since A1 `GET /api/health` and `GET /api/ready` exist;
- discovery `:619` (D24-10: "the Anthropic agent client sets no timeout of its own") - since A1 it sets `timeout: 120_000`;
- `app/lib/auth/expected-origin.ts:16-19` (its header: a missing or malformed production origin refuses "every protected
  non-idempotent request") - still true, and since A1 a production runtime refuses sensitive reads too, through the blocker;
- `app/lib/auth/trusted-request-context.ts:15-16` (its header: "production without configured authentication => 403") - still true,
  and since A1 a production runtime also needs a serving profile and an expected origin.

## 13. For the lead

### Closure clauses (each one dated line under its defect in `discovery.md`)

- [B24-A1, 2026-10-06] D24-1: offline closed by B24-A1 for the deployment profile and its blocker - `SIRKIT_DEPLOYMENT_ENV` (development, ci, staging, production, exact) and `productionServingBlocker` (the unchanged `sensitiveOperationsBlocker`, then a serving profile, then the expected origin, reads included) at both callers (`b24-a1-environment-profile`); the production-mode half is PROPOSED: the `production-smoke` CI job (`next build`, `next start`, fail-closed probes) is written and its shape pinned (`b24-a1-environment-profile` 11) but has not run, and it closes that half offline only when the lead's local production-mode run and its first CI run are green (a failing first build is D24-1's own counterexample, recorded verbatim, never admitted red); staging and production BLOCKED-LIVE-QUALIFICATION (LB-13).
- [B24-A1, 2026-10-06] D24-9: offline closed by B24-A1 - `GET /api/health` (public liveness) and `GET /api/ready` (the worker class through a read-only row; nine closed checks, the database an injected port bounded at 2,000 ms, never a value; census 166 -> 168 by review; `b24-a1-readiness`); staging dependency health BLOCKED-LIVE-QUALIFICATION (LB-13).
- [B24-A1, 2026-10-06] D24-10: closed by B24-A1 - the digested `sirkit.deployment-configuration.v1` record, every provider SDK client in it by the code that builds it with its timeout and retries (`b24-a1-configuration`), `/api/ai/runtime` reporting what the clients send and an empty or padded Anthropic model refused rather than sent, and the Anthropic client timeout (`adapters.ts:213`, `timeout: 120_000`); attaching the digest to trace records goes to B24-C2 (OD-208), after B24-C1's durable trace.
- [B24-A1, 2026-10-06] D24-11: closed by B24-A1 for the inventory (49 names, `flag-inventory.ts`), the pinned defaults (each recorded flag state checked against its owner) and the diagnostic-runner switch (`SIRKIT_DIAGNOSTIC_RUNNER_DISABLED`, off-only: every run and every install check refuse; `b24-a1-flags`). The `.env.example` declarations of `SIRKIT_NAMED_COMPUTATIONS`, `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS`, `SIRKIT_ORDERING_DISABLED` and `SIRKIT_ORCHESTRATION_ENABLED` are B24-A2's (OD-195).

Once `production-smoke` (PROPOSED today) is green - the lead's local production-mode run and its first CI run - append under D24-1 (the lead's line, not written by A1):

    - [B24-A1, <date>] D24-1: the production-mode half, PROPOSED until then, closed offline - the lead's local production-mode run and the first CI run of `production-smoke` green (`next build` <N> s, `next start` <N> s, `engine-worker.mjs` emitted: <yes|no>; environments-and-deployment.md section 6).

and a dated note of the same run under OD-190, in the LB-13 row and on the README row.

### The OD entries for `OWNER_DECISIONS.md` (no OD-190+ heading exists at `8664964`; headings end at OD-188, `:2545`)

In the register each heading is `## OD-NNN — <title>, as applied (B24-A1, 2026-10-06)`; written here one level down.

### OD-190 — the hosting platform and environment topology, as applied in part (B24-A1, 2026-10-06)

- **Default applied:** no platform assumed and no deployment file written. `SIRKIT_DEPLOYMENT_ENV` is a closed, exact vocabulary (development, ci, staging, production); in a production runtime only staging and production serve sensitive routes, and an unset or invalid profile answers 403 `AUTH_PRODUCTION_NOT_CONFIGURED`; a non-production runtime is never blocked. The CI job `production-smoke` is written to build and start the production server with the ci profile and no Supabase and to pin its fail-closed answers - PROPOSED until the lead's local production-mode run and its first CI run are green (nothing has built or started it yet). Staging and production are BLOCKED-LIVE-QUALIFICATION (LB-13); LB-10 stays blocked. The hosting platform is UNKNOWN.
- Owner confirmation pending.

### OD-198 — health and readiness, as applied (B24-A1, 2026-10-06)

- **Default applied:** `GET /api/health` public liveness (`{ ok: true }`, no-store, reads nothing); `GET /api/ready` on the internal-worker class through the reviewed read-only constructor `readOnlyWorker` (no write, transfer, spend or credit), reporting by name and closed state only the deployment profile, auth mode, Supabase and expected-origin configuration, a bounded database probe (an injected port; `select 1`, 2,000 ms), key presence, the Anthropic model setting and the role table, plus the configuration digest; never a value. The census moved once by review, 166 -> 168 = 165 + 3 + 0; both rows derive `model_egress` false, `outbound_egress` none and no process; the action records are 107. The same worker secret also authorizes the three worker write routes (recorded; a separate credential is OD-195's).
- Owner confirmation pending.

### OD-199 — versioned provider and tool configuration, as applied (B24-A1, 2026-10-06)

- **Default applied:** one frozen `sirkit.deployment-configuration.v1` record, built once per process over `process.env`, digested by `engineeringDigest`: profile, auth mode, OpenAI model and effort, the Anthropic model setting, every provider SDK client Sirkit builds with its timeout and retries (the agent coordinator: OpenAI 120,000 ms and 2, Anthropic 120,000 ms and the SDK default; a specialist: 120,000 ms and 0; the llmRouter: OpenAI 600,000 ms and 5, Anthropic the SDK defaults; the embedding client and the parts-search reranker: the SDK defaults), the role table, the source, MCP-server and provider registry versions each with a digest of its rows (`PROVIDER_ROWS`, the rows production reads), the embedding and rerank models (copied), the runtime profiles (referenced), the tool registry digest, key presence and every flag state; names and closed states only. `/api/ready` reports its digest; attaching it to trace records is B24-C2's (OD-208). `/api/ai/runtime` reads `anthropicModelSetting()`; an empty or padded model is refused (bad_request, with the refusal's own message naming the server setting) rather than sent, by both Anthropic clients.
- Owner confirmation pending.

### OD-200 — feature flags for MCP, the sandbox and external manufacturing, as applied (B24-A1, 2026-10-06)

- **Default applied:** one data-only inventory (`app/lib/deployment/flag-inventory.ts`) of every `SIRKIT_*` name read in code, with kind, default, direction, owner and constant, pinned by `b24-a1-flags` against the tree and the owners; the sandbox gets the off-only `SIRKIT_DIAGNOSTIC_RUNNER_DISABLED` (any non-blank value refuses every diagnostic run and every install check with `NGSPICE_DIAGNOSTIC_DISABLED`; a version line already probed is answered from memory, with no process; it never enables production simulation); external manufacturing keeps B23's two off-only switches; MCP keeps its exact-"1" flag.
- Owner confirmation pending.

### OD-222 — CI admission for B24 suites, as applied (B24-A1, 2026-10-06)

- **Default applied:** `CHAPTERS` gains `b24-` (`b19-e-ci-job-scope.test.ts:54`) and one directory filter, `app/lib/qualification/__tests__`, admits the B24 suites to prompt-to-gerber after `deterministic-manufacturing.yml:227`; PGlite suites go per file to database-delivery (none in A1). The B22 C77 and B23 C15 anchors were re-pinned in place, and B21's C49, C93, C94 and B23's C64 moved +1 by review. B24-B3 amends this heading for the live suites.
- Owner confirmation pending.

### OD-217 — the live-blocker register, as applied in part (B24-A1, 2026-10-06)

- **Default applied in part:** the LB-13 row, in OD-217's vocabulary (below), and its `PROGRAM_STATE.json` mirror. B24-A4 (LB-14), B24-B1 (LB-15..LB-17) and B24-E (the rest of OD-217) append dated amendments under this heading.
- Owner confirmation pending.

### OD-223 — B24-A1: stated choices beyond its task text, as applied (B24-A1, 2026-10-06)

- **Default applied:**
  - (a) The blocker order and codes: `sensitiveOperationsBlocker` first (text unchanged, `AUTH_PRODUCTION_NOT_CONFIGURED`), then in a production runtime a non-serving profile (`AUTH_PRODUCTION_NOT_CONFIGURED`, the message naming only `SIRKIT_DEPLOYMENT_ENV`), then a missing or malformed expected origin (`AUTH_ORIGIN_NOT_CONFIGURED`, `AUTH_ORIGIN_CONFIG_MALFORMED`, by `resolveExpectedOrigin`'s rules with production forced); its own two messages name the variables only.
  - (b) The profile scope: exact matching; an absent variable is `unset` and any other value, an empty one included, `invalid`; only the trusted context and the MCP wrapper call the blocker; the worker and public paths never do.
  - (c) The worker-secret limit: `/api/ready` shares the worker secret with the three worker write routes (OD-195 owns a separate credential).
  - (d) The Anthropic client timeout: `timeout: 120_000` on `adapters.ts:213`, OpenAI's value and the loop's run deadline, spelled before the retries so B21-E1's C19 anchor stays unique.
  - (e) The record's registry digests read `PROVIDER_ROWS`, never `PROVIDER_REGISTRY` (B23's test oracle), and no generator render; the embedding (`text-embedding-3-small`) and rerank (`claude-haiku-4-5`) models are copied, each with a source-reading parity case; the OpenAI reasoning efforts accepted are copied too (not exported by `openai-config.ts`), pinned equal to the source's list, read from the file, and to `configuredOpenAIReasoningEffort` over it; every provider SDK client's timeout and retries is copied from its construction site (`OPENAI_CLIENTS`, `ANTHROPIC_CLIENTS`: the agent coordinator and a specialist, the llmRouter, the embedding client, the parts-search reranker), each pinned by reading the site, and those five sites are pinned as the only ones in production code (review finding coverage-4; the record named only the agent adapters' before).
  - (f) The hand-overs: the trace attachment of the digest to B24-C2 (OD-208); the `.env.example` declarations of four names to B24-A2 (OD-195); the kinds-to-classes map to B24-A2 (D16); D1's three names to B24-D1 (D15); test-only live flags to B24-B3 (OD-209).
  - (g) The inventory kinds: nine, closed; `SIRKIT_DB_QUALIFICATION_URL` is a `secret` (a connection string), not a live-test gate, and `SIRKIT_LIVE_ORCHESTRATION_PROVIDER` a live-test gate that selects; the census does not scan the inventory module itself (it is the list); the two Anthropic refusal codes are exclusions.
  - (h) The B24-root class of `b23-a-provider-admission` case 8: `app/lib/deployment/`, `app/lib/evaluation/`, `app/lib/qualification/`, `app/lib/observability/`, by prefix; the walk still reads every file under them.
  - (i) The switch name and parse: `SIRKIT_DIAGNOSTIC_RUNNER_DISABLED`, any non-blank value, read from the process at each call; the code `NGSPICE_DIAGNOSTIC_DISABLED`. Its reach: every run and every install check refuse first; a version line already probed, for an install handed to `diagnosticNgspiceVersion` as `verified`, is answered from memory, with no refusal and no process (the two checks stay where the task put them, `:249` and `:633`; review finding coverage-6).
  - (j) The `project.service-health` record is appended at the registry's end (`action-registry.ts:186`), not on `:162`, so the B01 matrix keeps B23's line-checked C51 on row 107.
  - (k) The CI job uses port 3200 and polls `/api/health` for at most 90 s after `next start`; it prints the build and start durations and whether `engine-worker.mjs` is emitted, and sets no Supabase, database, provider or fixture variable at all (in CI none exists to blank).
  - (l) The local refusal of an empty or padded Anthropic model keeps the reason `bad_request` (the task text) and carries its own message (`ANTHROPIC_MODEL_REFUSED_MESSAGE`): Sirkit did not send the request, and the cause is the server setting `SIRKIT_ANTHROPIC_MODEL`. The generic `bad_request` text says Anthropic rejected a request Sirkit built, which is untrue here (review finding regressions-4). `model_access` was not taken: its text says Anthropic denied access, also untrue when nothing was sent.
  - (m) Section 10's workflow table is A1's own shift and never moves: a later task that inserts workflow lines appends one dated row to the insertion table under it, and `production-smoke` (PROPOSED until its first CI run) is pinned as the job after `page-browser-e2e`, not as the last job (review finding regressions-2). [B24-A1 check, 2026-10-06] Every inserting task (A2, A4, B2, B3, C1, C2, C3, D1, D2) appends one row per contiguous group, ``| [B24-<id>, <date>] | <job> | `:<first>` | <count> |``, and moves no workflow number of this page (sections 10 and 14): A1's checks carry A1's lines through the rows, A1's tree frozen at 435 workflow lines and section 10's old column; B23's prose citation of the PGlite entry is resolved by its content, with a dated note from A1 and from each task whose rows moved it; A1's filter line and the workflow's permissions are found by their content.
  - (n) The record's flag states are checked against each flag's owner, not against a copy of the parse: the three list owners spell one parse, so MCP's exposed result answers for all three; the two owners the suite does not import (named computations, orchestration) answer by the compare literal read from their lines (review finding tests-1).
- Owner confirmation pending.

### LB-13 (A1 owns it)

For `LIVE_BLOCKERS.md`, after `:18`:

| LB-13 | Staging and production environments: a hosted deployment of each, the edge's TLS and security headers, and the Supabase Site URL and redirect list (discovery `:941`) | BLOCKED-LIVE-QUALIFICATION | B24-A1: the deployment profile (`SIRKIT_DEPLOYMENT_ENV`) and the production blocker proven offline (`b24-a1-environment-profile`); `/api/health` and `/api/ready` proven against fake ports (`b24-a1-readiness`); the `production-smoke` CI job, written to build and start the production server with the ci profile and pin its fail-closed answers, PROPOSED until the lead's local production-mode run and its first CI run are green - no deployment, no live host | the owner names the hosting platform and supplies isolated staging and production projects (OD-190, OD-191) |

For `PROGRAM_STATE.json`'s `liveBlockers`, appended after `:20` in the array's form:

    "staging and production environments, edge TLS and headers, the Supabase redirect list: BLOCKED-LIVE-QUALIFICATION (LB-13)"

B24-A4 owns LB-14 and B24-B1 LB-15..LB-17; a later task adds only dated notes to LB-13.

### The B16.1B recipe notes

Written in place by A1 (no line moved): `artifacts/ai-control-plane-b16-1b/live-auth-qualification-matrix.md:64` (a trailing shell comment) and `app/lib/auth/__tests__/b16-1b-live-qualification.test.ts:12` (the header): in a production runtime the server also needs `SIRKIT_DEPLOYMENT_ENV=staging` (or `production`), or every sensitive route answers 403 `AUTH_PRODUCTION_NOT_CONFIGURED`.

### The workflow shift for the later increments

The section-10 amendment names the old -> new table (section 10 of this page). Task A4 already states `:302` after B24-A1 (`task-A4.md:249`). Before each launch, re-derive every later task file's `deterministic-manufacturing.yml` citations made at `f663d71` numbers: every cited line from 228 on moves +1, and A1's `production-smoke` job (PROPOSED until its first CI run) now occupies the lines after `:349`. Each later task that adds a workflow line (B3, C1 and C2 included) re-derives B21's C49, C93, C94, B23's C64 and B23's prose citation `dfm-quote-flow.md:269` at its own `8664964` and lists their move (D8). [B24-A1 check, 2026-10-06] Those tasks are A2, A4, B2, B3, C1, C2, C3, D1 and D2 (below); this page's own workflow numbers are not among the citations they move.

[B24-A1 check, 2026-10-06] The insertion-table handover, for every B24 task that inserts workflow lines. It replaces the review round's note, which named A2, C1 and C2 only, gave a row of another form and let section 14's numbers move in place. Read from the task files (read-only, at this date):
- inserting: A2 (`task-A2.md:340`, a `secret-scan` job appended at the end; `:359-364`, probes inside `production-smoke`, PROPOSED until its first CI run), A4 (`task-A4.md:249`, `:296`: four database-delivery entries), B2 (`task-B2.md:110-113`, `:238-242`: 36 or 32 prompt-to-gerber entries before the `--reporter` line), B3 (`task-B3.md:377-381`: one prompt-to-gerber entry, if it admits a live suite), C1 (`task-C1.md:378-387`), C2 (`task-C2.md:398-400`, `:478-486`), C3 (`task-C3.md:235`, `:282-285`) and D2 (`task-D2.md:445`, `:511-514`): one database-delivery entry each; D1 (`task-D1.md:321-331`, `:529-532`): three groups in four blocks, prompt-to-gerber's first and last steps and page-browser-e2e's;
- adding none: A3 (`task-A3.md:222`), B1 (`task-B1.md:509`), D3 (`task-D3.md:380`), E (`task-E.md:552`) and F (`task-F.md:439-440`).

Paste this paragraph, unchanged, into each of the nine task files, at the place given for it below:

> [B24-A1 handover, 2026-10-06] Workflow insertions and B24-A1's checks. For `artifacts/ai-control-plane-b24/environments-and-deployment.md` this replaces every instruction in this file to move a B24 page citation of a workflow line in place. (1) For each contiguous group of lines this task inserts into `.github/workflows/deterministic-manufacturing.yml` - an appended job, and lines inside B24-A1's `production-smoke` job (PROPOSED until its first CI run), included - append one row, in insertion order, to the insertion table at the end of that page's section 10: ``| [B24-<id>, <date>] | <job> | `:<first>` | <count> |``, where <job> is the top-level job that holds the group (blank and comment lines just above a job header belong to that job), <first> is the group's first inserted line in the workflow as this task leaves it (several groups: one row each, top to bottom), and <count> is its number of lines. (2) Never edit an earlier row of that table, the old -> new table above it, or any workflow line number in that page's sections 10 and 14: `b24-a1-environment-profile` 14 carries each of them through the rows. (3) Re-derive by anchor, after the insertion, every other page citation of a workflow line the insertion moved - B21's C49, C93 and C94 (`evaluation-matrix.md`; `b21-f-page` 6), B23's C64 (`dfm-quote-flow.md`; `b23-b-dfm-quote-flow-page` 3) and B23's prose citation of the PGlite entry (`dfm-quote-flow.md`, "an explicit database-delivery entry"; `b24-a1-environment-profile` 17 resolves it, so it moves even where this file says a prose citation no suite resolves does not move) - and move each number in place with this task's own dated `[B24-<id>, <date>]` note, keeping the earlier notes. (4) Never edit the test logic of `app/lib/qualification/__tests__/b24-a1-*.test.ts`: run `b24-a1-environment-profile` before and after the workflow edit, and if it fails after (1)-(3), STOP and report.

Where it goes, and what it changes in each task file:
- `task-A2.md`, after `:364`: rows for the probe lines inside `production-smoke` (job `production-smoke`, PROPOSED until its first CI run) and one for the appended job (job `secret-scan`, its blank separator line included); for this page it replaces `:362-364`'s "list old -> new" and `:454`'s "A1's `environments-and-deployment.md` workflow citations"; the prose citation holds (the lines sit below the PGlite entry).
- `task-A4.md`, after `:296`: one row (`database-delivery`, 4); the prose citation holds.
- `task-B2.md`, after `:242`: one row (`prompt-to-gerber`, 36 or 32); for this page `:242`'s "every pin B24-A1..B1 placed on a later workflow line" is the row; the prose citation moves (the entries sit above the PGlite entry).
- `task-B3.md`, after `:381`: one row (`prompt-to-gerber`, 1) if it inserts; the prose citation moves.
- `task-C1.md`, after `:388`: one row (`database-delivery`, 1); for this page `:380-381`'s "Re-resolve every B24 page citation of those lines" is the row; the prose citation holds.
- `task-C2.md`, after `:486`: one row (`database-delivery`, 1); `:481-483`'s "move each +1 in place" does not apply to this page; the prose citation holds.
- `task-C3.md`, after `:285`: one row (`database-delivery`, 1); `:284`'s "moves any B24 page citation of a workflow line below it" does not apply to this page; the prose citation holds.
- `task-D1.md`, after `:555`: four rows, top to bottom (`prompt-to-gerber` 1 and 2, `page-browser-e2e` 1 and 2); `:546-547`'s "Also moved: any B24 page citation below an inserted line" and `:552`'s in-place moves do not apply to this page, and `:553-554`'s "does not move" no longer holds for `dfm-quote-flow.md:269`, which moves; `benchmark.yml` is outside the table.
- `task-D2.md`, after `:514`: one row (`database-delivery`, 1); for this page `:514`'s "plus any pins A1..D1 added" is the row; the prose citation holds.

### The local production-mode run

Not run by the builder (lead decision). In a fresh worktree under the session's `.claude\worktrees` with no `.env*` file but `.env.example` (`.gitignore:41-42`; list the `.env*` names first and stop if any other exists), one heavy process at a time:

    DATABASE_URL= NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= NEXT_PUBLIC_SUPABASE_ANON_KEY= OPENAI_API_KEY= ANTHROPIC_API_KEY= SIRKIT_DB_QUALIFICATION_URL= NODE_OPTIONS=--max-old-space-size=4096 pnpm exec next build
    DATABASE_URL= NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= NEXT_PUBLIC_SUPABASE_ANON_KEY= OPENAI_API_KEY= ANTHROPIC_API_KEY= SIRKIT_DB_QUALIFICATION_URL= SIRKIT_DEPLOYMENT_ENV=ci SIRKIT_EXPECTED_ORIGIN=http://localhost:3200 SIRKIT_WORKFLOW_WORKER_SECRET=<openssl rand -hex 32> pnpm exec next start --port 3200

then the job's probes against `http://localhost:3200` (section 6), the build and start durations and whether `engine-worker.mjs` is emitted recorded on this page (section 6), the server stopped and `.next/` removed before any vitest run. Then both Playwright configs once (`/api/ai/runtime` is the start probe), never concurrent with vitest.

### The README row

| B24-A1 environment profile, production-mode CI, health, readiness, configuration, flags (D24-1 offline, D24-9, D24-10, D24-11; OD-190, OD-198, OD-199, OD-200, OD-222, OD-217 in part, OD-223) | `environments-and-deployment.md`; code `app/lib/auth/deployment-profile.ts`, `app/lib/deployment/{configuration,flag-inventory,readiness}.ts`, `app/lib/llm/anthropic-model-guard.ts`, `app/api/health/route.ts`, `app/api/ready/route.ts`; suites `app/lib/qualification/__tests__/b24-a1-*` | done 2026-10-06 offline, except the `production-smoke` CI job: PROPOSED until the lead's local production-mode run and its first CI run are green; census 168 / 165 / 3 / 0, counts 47 / 36 / 9 / 27, 107 action records; staging and production BLOCKED-LIVE-QUALIFICATION (LB-13) |

### The ledger paragraph

### B24-A1 - environment profile, production-mode CI, health, readiness, configuration, flags (2026-10-06 local; increment workflow + lead; this commit)

- Test-first on `chapter/b24-production-qualification` from `8664964`: the four `b24-a1-*` suites failed to load on the unmodified tree; with the new modules present but unwired, 20 of 37 failed, each counterexample for its reason (no profile, a ci profile and an origin-less read resolved; the MCP wrapper passed the blocker; the coordinator's Anthropic client had no timeout; the route reported `claude-opus-4-7` for an empty model; the diagnostic runner reached its install check with the switch set); then 47 / 47.
- The profile and the blocker (D24-1 offline, OD-190): `SIRKIT_DEPLOYMENT_ENV`, `productionServingBlocker` at its two callers in place, the four production fixtures outside CI gaining the profile; the worker and public paths never call it.
- The configuration (D24-10, OD-199): the digested `sirkit.deployment-configuration.v1` record, every provider SDK client in it with its timeout and retries; the Anthropic model setting refused rather than sent by both clients, with the refusal's own message; `adapters.ts:213` `timeout: 120_000`; `/api/ai/runtime` reporting what the clients send.
- The flags (D24-11, OD-200): the 49-name inventory pinned against the tree and the owners, each recorded flag state checked against its owner; `SIRKIT_DIAGNOSTIC_RUNNER_DISABLED`, off-only, refusing every diagnostic run and every install check first.
- CI (OD-222): `b24-` admitted by one directory filter; the `production-smoke` job (`next build`, `next start`, fail-closed probes) appended, PROPOSED until the lead's local production-mode run and its first CI run are green; no `next build` was run by the builder.
- Health and readiness (D24-9, OD-198): `GET /api/health`, `GET /api/ready`; census 166 -> 168 by review; action records 106 -> 107; every pin moved in place with a dated note (page section 9), the eight CSVs regenerated.
- Records: OD-190, OD-198, OD-199, OD-200, OD-222 and OD-217 (in part) as applied, OD-223 for A1's own choices; LB-13; the closure clauses; `environments-and-deployment.md`. Staging, production and every live step BLOCKED-LIVE-QUALIFICATION (LB-13).
- Review round (2026-10-06): 14 confirmed findings (13 distinct) fixed test-first, the test-strength ones proven against seven deliberate breakages, each restored by hash; the four suites 54 / 54 (page section 8): readiness can no longer reach a real database (a guard port before every case, the database client faked) and its 2,000 ms bound and default port are exercised; the record covers every provider SDK client and its flag states are checked against the owners; the Anthropic model refusal says it sent nothing; the blocker order, the effort list and the ambient-model independence are pinned; the workflow table and the job-order case take later insertions in place; B23's `dfm-quote-flow.md:269` prose citation moved; the production-smoke statements say PROPOSED; the section-10 amendment lists the unnamed pins.
- Check round (2026-10-06): two low findings fixed test-first. A later workflow insertion now changes only data: every inserting B24 task (A2, A4, B2, B3, C1, C2, C3, D1, D2) appends one row per contiguous group to the page's section-10 insertion table. A1's checks carry A1's lines (the old -> new table, C35, C47) through the rows, check each row's job and the line total since A1's 435, and find A1's filter line, the permissions block and B23's prose citation of the PGlite entry by content; that citation needs a dated note from each task whose rows moved it. A simulation of the nine tasks' 13 planned groups passes; each designed failure still bites (16 breakages caught, each restored by hash). The paste-ready handover for the nine task files is in section 13, and the edge cases left open are in section 15 (INFERRED).

### Section 10 amendment (for `discovery.md`)

- [B24-A1, 2026-10-06] B24-A1 landed the deployment profile and its blocker, the configuration record, the flag inventory and the diagnostic-runner switch, the CI admission of `b24-`, `/api/health` and `/api/ready` (census 168 / 165 / 3 / 0) and the `production-smoke` job (PROPOSED until the lead's local production-mode run and its first CI run are green; environments-and-deployment.md). Pins the plan did not name (OD-222 and 9.4 name the two `CHAPTERS` anchors, which are not repeated here): the census lines `b16-1c-invariant-tripwires.test.ts:5, :38, :48`, `b16-1b-auth-composition.test.ts:242, :255`, `b22-a2-process-census.test.ts:315, :317`, `b23-a-no-order-structural.test.ts:183`, `b23-a-route-vocabulary.test.ts:11, :618, :658, :778-779` and `b23-b-exchange-route.test.ts:104, :116` (166 -> 168); the action-record pin `b23-a-tier3-vocabulary.test.ts:272` with B23's C52 (106 -> 107), the record placed at the registry's end (`action-registry.ts:186`) to keep B23's C51; the eight regenerated CSVs (B01 `api-route-coverage.csv` and `ui-command-toolability-matrix.csv`, B16.0 `auth-route-coverage.csv`, B16.0.1 `exact-route-authorization-policy.csv`, B16.0.2 `route-data-and-resource-classification.csv`, B16.0.4 `method-authorization-matrix.csv` and `request-body-boundary-matrix.csv`, B16.0.7 `route-wrapper-matrix.csv`); the four production fixtures that gained the profile (`b16-1b-auth-composition.test.ts:29`, `b16-1b-real-sdk-identity.test.ts:29`, `b16-1b-session-liveness.test.ts:42`, `b16-0-2-csrf-exact-origin.test.ts:19-23`); B21-E1's C20 re-anchored and `b21-e1-provider-policy.test.ts:168` (the Anthropic client timeout); the B16.1B recipe notes (`live-auth-qualification-matrix.md:64`, `b16-1b-live-qualification.test.ts:12`); B21's C49, C93, C94, B23's C64 and B23's prose citation `dfm-quote-flow.md:269` (+1, the filter line; every workflow line from 228 on moved +1, the page's section 10 is the old -> new table and later insertions are rows under it); `b23-a-provider-admission` case 8 admits the four B24 roots (D6).

## 14. Citations

| # | file | line | anchor |
|---|---|---|---|
| C1 | `app/lib/auth/deployment-profile.ts` | 21 | `export const DEPLOYMENT_PROFILE_ENV = "SIRKIT_DEPLOYMENT_ENV";` |
| C2 | `app/lib/auth/deployment-profile.ts` | 37 | `export function resolveDeploymentProfile(` |
| C3 | `app/lib/auth/deployment-profile.ts` | 52 | `export function productionExpectedOrigin(` |
| C4 | `app/lib/auth/deployment-profile.ts` | 67 | `export function productionServingBlocker(` |
| C5 | `app/lib/auth/mode.ts` | 87 | `export function sensitiveOperationsBlocker(` |
| C6 | `app/lib/auth/expected-origin.ts` | 88 | `export function resolveExpectedOrigin(` |
| C7 | `app/lib/auth/trusted-request-context.ts` | 24 | `import { productionServingBlocker } from "./deployment-profile";` |
| C8 | `app/lib/auth/trusted-request-context.ts` | 63 | `const blocker = productionServingBlocker(environment);` |
| C9 | `app/lib/auth/route-handlers.ts` | 46 | `import { productionServingBlocker } from "./deployment-profile";` |
| C10 | `app/lib/auth/route-handlers.ts` | 1010 | `const blocker = productionServingBlocker(environment);` |
| C11 | `app/lib/auth/authorize.ts` | 63 | `if (policy.identitySource === "worker-secret") {` |
| C12 | `app/lib/auth/authorize.ts` | 77 | `if (!policy.requiresAuth) {` |
| C13 | `app/lib/deployment/configuration.ts` | 144 | `export function buildDeploymentConfiguration(` |
| C14 | `app/lib/deployment/configuration.ts` | 167 | `digest: engineeringDigest(PROVIDER_ROWS)` |
| C15 | `app/lib/embeddings.ts` | 11 | `export const EMBEDDING_MODEL = "text-embedding-3-small";` |
| C16 | `app/lib/parts-search.ts` | 215 | `const RERANK_MODEL = "claude-haiku-4-5";` |
| C17 | `app/lib/llm/anthropic-config.ts` | 26 | `export function anthropicModelSetting(` |
| C18 | `app/lib/llm/anthropic-model-guard.ts` | 9 | `export function sendableAnthropicModel(model: string): string {` |
| C19 | `app/lib/agent/adapters.ts` | 213 | `new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: this.maxRetries })` |
| C20 | `app/lib/agent/adapters.ts` | 219 | `model: sendableAnthropicModel(this.model),` |
| C21 | `app/lib/agent/adapters.ts` | 335 | `import { sendableAnthropicModel } from "../llm/anthropic-model-guard";` |
| C22 | `app/lib/llm/anthropic-provider.ts` | 107 | `model: sendableAnthropicModel(this.model),` |
| C23 | `app/lib/llm/anthropic-provider.ts` | 196 | `import { sendableAnthropicModel } from "./anthropic-model-guard";` |
| C24 | `app/lib/agent/contracts.ts` | 185 | `runDeadlineMs: 120_000,` |
| C25 | `app/api/ai/runtime/route.ts` | 16 | `const anthropicSetting = anthropicModelSetting();` |
| C26 | `app/lib/deployment/flag-inventory.ts` | 103 | `export const FLAG_INVENTORY: readonly FlagInventoryEntry[]` |
| C27 | `app/lib/computation/diagnostic-runner.ts` | 74 | `"NGSPICE_DIAGNOSTIC_DISABLED"; // [B24-A1] OD-200` |
| C28 | `app/lib/computation/diagnostic-runner.ts` | 249 | `refuseIfDiagnosticRunnerSwitchedOff(); const platform = host.platform();` |
| C29 | `app/lib/computation/diagnostic-runner.ts` | 633 | `refuseIfDiagnosticRunnerSwitchedOff(); const profile = runtimeProfile(DIAGNOSTIC_RUNNER_PROFILE_ID);` |
| C30 | `app/lib/computation/diagnostic-runner.ts` | 692 | `const read = await readBoundedRawFile(join(directory, DIAGNOSTIC_RAW_OUTPUT_FILE)` |
| C31 | `app/lib/computation/diagnostic-runner.ts` | 764 | `export const DIAGNOSTIC_RUNNER_DISABLE_ENV = "SIRKIT_DIAGNOSTIC_RUNNER_DISABLED";` |
| C32 | `app/api/simulate/route.ts` | 204 | `if (e instanceof DiagnosticRunnerError) return Response.json({ error: e.message }, { status: 503 });` |
| C33 | `app/lib/computation/request-executors.ts` | 117 | `return refused(error instanceof DiagnosticRunnerError ? error.code : "RUNNER_FAILED");` |
| C34 | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 54 | `const CHAPTERS = ["b19-", "b20-", "b21-", "b22-", "b23-", "b24-"] as const;` |
| C35 | `.github/workflows/deterministic-manufacturing.yml` | 228 | `app/lib/qualification/__tests__` |
| C36 | `app/api/health/route.ts` | 12 | `export const GET = publicRoute(undefined, () => Response.json({ ok: true }` |
| C37 | `app/api/ready/route.ts` | 16 | `export const GET = workerRoute({}, async () => {` |
| C38 | `app/lib/auth/worker-principal.ts` | 49 | `export function verifyWorkerSecret(` |
| C39 | `app/lib/auth/route-policy.ts` | 304 | `...readOnlyWorker("/api/ready", ["GET"],` |
| C40 | `app/lib/auth/route-policy.ts` | 401 | `function readOnlyWorker(path: string, methods: readonly string[], evidence: string): RoutePolicy[] {` |
| C41 | `app/lib/deployment/readiness.ts` | 23 | `export const READINESS_CHECK_NAMES = Object.freeze([` |
| C42 | `app/lib/deployment/readiness.ts` | 72 | `const query = getSqlClient()` |
| C43 | `app/lib/db/client.ts` | 20 | `export function getSqlClient(): Sql {` |
| C44 | `app/lib/auth/route-resource-classification.ts` | 99 | `"/api/ready": { durable: "none", sensitivity: "none" },` |
| C45 | `app/lib/engineering/action-registry.ts` | 186 | `action({ id: "project.service-health", version: 1, area: "project",` |
| C46 | `app/lib/engineering/action-registry.ts` | 276 | `route("/api/ready", ["GET"], "project.service-health", "read"),` |
| C47 | `.github/workflows/deterministic-manufacturing.yml` | 356 | `production-smoke:` |
| C48 | `app/lib/auth/supabase-server.ts` | 46 | `if (!conf) return response;` |
| C49 | `app/lib/manufacturing-providers/__tests__/b23-a-provider-admission.test.ts` | 50 | `!B24_QUALIFICATION_ROOTS.some((root) => path.startsWith(root))` |
| C50 | `.env.example` | 87 | `# SIRKIT_DEPLOYMENT_ENV=` |
| C51 | `.env.example` | 93 | `# SIRKIT_DIAGNOSTIC_RUNNER_DISABLED=` |
| C52 | `app/lib/deployment/configuration.ts` | 44 | `export const OPENAI_CLIENTS = Object.freeze({` |
| C53 | `app/lib/deployment/configuration.ts` | 55 | `export const ANTHROPIC_CLIENTS = Object.freeze({` |
| C54 | `app/lib/llm/openai-provider.ts` | 152 | `this.client ??= new OpenAI({` |
| C55 | `app/lib/llm/anthropic-provider.ts` | 100 | `this.client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });` |
| C56 | `app/lib/embeddings.ts` | 25 | `client = new OpenAI({ apiKey });` |
| C57 | `app/lib/parts-search.ts` | 222 | `anthropic = new Anthropic({ apiKey });` |
| C58 | `app/lib/llm/anthropic-model-guard.ts` | 18 | `export const ANTHROPIC_MODEL_REFUSED_MESSAGE =` |
| C59 | `artifacts/ai-control-plane-b23/dfm-quote-flow.md` | 269 | `there) and is an explicit database-delivery entry (` |
| C60 | `app/lib/computation/diagnostic-runner.ts` | 727 | `const cached = state.versions.get(pinned);` |

### Discovery citations (at `8664964`'s numbering; the lead's later dated closure lines are skipped when resolving)

| # | discovery | anchor |
|---|---|---|
| D1 | `discovery.md:203` | `### 2.1 Environments, deployment and configuration (B24-A)` |
| D2 | `discovery.md:205` | `- **Two runtime states only.**` |
| D3 | `discovery.md:235` | `- **No health or readiness route.**` |
| D4 | `discovery.md:552` | `**D24-1 - The code knows two runtime states` |
| D5 | `discovery.md:612` | `**D24-9 - No health or readiness check.**` |
| D6 | `discovery.md:616` | `**D24-10 - Provider and model configuration is unversioned` |
| D7 | `discovery.md:623` | `**D24-11 - No feature flag or kill switch for the sandbox` |
| D8 | `discovery.md:914` | `The hosting platform and environment topology` |
| D9 | `discovery.md:922` | `Health and readiness.` |
| D10 | `discovery.md:923` | `Versioned provider and tool configuration.` |
| D11 | `discovery.md:924` | `Feature flags for MCP, the sandbox and external manufacturing.` |
| D12 | `discovery.md:941` | `The live-blocker register.` |
| D13 | `discovery.md:946` | `CI admission for B24 suites.` |
| D14 | `discovery.md:962` | `### B24-A1 - Environment profile, production-mode CI, health, readiness, configuration, flags` |

## 15. What stays open

[B24-A1 check, 2026-10-06] Edge cases of the insertion-table protocol (section 10) found in the check round and recorded rather than
fixed, that round being A1's last; each is **INFERRED** (reasoned from the checks' code, not run):
- A compensating edit of an earlier row passes: if a task raises an earlier row's count by the lines it inserts directly after that
  group, instead of appending its own row, every carried anchor, every job and the line total still agree.
- A row's first line is checked only through its job and the anchors at or below it: a first line a few lines off inside the same
  job, with no A1 anchor between the true and the recorded line, passes (A2's probe lines, below every anchor, are such a case).
- Only insertions are in the protocol (a count is at least 1). Deleting or moving workflow lines (an OD-30 split of a job, a removed
  step) fails the line total and the carried anchors and needs the lead's reviewed change to A1's check; so does a line inserted above
  `jobs:`, which no job holds.
- Case 17 requires a dated note on the citation's line from each task that moved the PGlite entry, not that the note names the right
  earlier line.
- The prose citations of workflow lines that no suite resolves (B20's `mcp-client-boundary.md:41` and `mcp-provider-connectors.md:254`,
  B23's `unknowns-and-owner-decisions.md:50`) still go stale when lines are inserted above them; A1 resolves only the one it moved.
- `A1_WORKFLOW_LINES` (435) in `b24-a1-environment-profile` is A1's own tree. If the lead's local production-mode run changes A1's
  `production-smoke` job (PROPOSED until its first CI run) before the A1 commit, the lead moves that constant in place with a dated
  note, as A1's own amendment; after the A1 commit it never moves.

- [B24-A2 lead, 2026-10-06] **Case 16, moved by review.** With A2 landed, case 16 simulated A2's planned rows on top of its real
  ones (15 rows where 13 were pinned). The lead's reviewed move: only the tasks still to land are simulated (`stillPlanned()`), the line
  and row counts are derived from them, and A2's job is found by its row, not its index; at A1's tree this gives 59 lines, 13 groups and
  "53 recorded" as before. A later task that lands needs no further move. CONFIRMED (`a2lead-case16`, the qualification suites 113 of
  113)
