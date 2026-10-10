# B24 - discovery: production qualification, evaluation and launch hardening

Labels: **CONFIRMED** (read at the cited file:line at HEAD `50fe156`, or observed with an allowed read-only git command), **INFERRED**
(a conclusion from reading code; nothing was executed), **PROPOSED** (designed, not exercised), **RECORDED** (written down from a
document or a reader's observation without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. "(reader N)" marks a fact
taken from reader N's map and not re-read by the synthesizer; every defect-bearing fact below was re-read at HEAD by the synthesizer
through `git show HEAD:<path>` or `git grep HEAD`.

Method: seven parallel read-only readers over the tree at `50fe156`: (1) environments and deployment, (2) the golden evaluation
program, (3) observability and replay, (4) reliability, performance and accessibility, (5) the live and physical gates, (6) prior
records, standing obligations and the final report, (7) the maps B24-F must produce and the generators behind them. They produced 82 gap
candidates (G-A1..14, G24B-1..11, G24C-1..12, B24D-1..16, S5-G1..10, S6-G1..10, G7-1..9), every claim with a file:line. One
synthesizer re-read every defect-bearing fact at HEAD, resolved the disagreements (section 0) and merged the gaps into D24-1..40
(section 4); the lead's reconciliation is section 9, empty until then. The synthesizer executed nothing (no vitest, eslint, tsc, tsx,
node, script, next, playwright or docker), wrote no repository file, fetched no page, read no `.env*` value (variable names only, with
`.env.example` values masked) and did not touch `C:\Users\robsa\sirkit`. The runbook was read at
`C:/Users/robsa/Downloads/Sirkit_Remaining_Builder_Master_Runbook.md:1021-1266` (B24 and sections 3-5) and `:1-190` (the global rules
quoted in section 5); of the B23 draft only the headings and tables of its sections 4 and 6, its section 0 numbering note, its section 7
conventions and closeout, and its section 8 were read.

Tree: branch `chapter/b22-sandboxed-computation`, HEAD `50fe156` ("B22-A1: the security corrections SEC-1 left - the model screen,
kicad-cli's environment, output caps, SPICE AI approval levels"), which is main `d0d2ec8` (the PR #12 merge, SEC-1) plus two commits:
the B22 discovery `0432fb8` and B22-A1 (`git log main..HEAD`, 32 files, CONFIRMED). `git status --short` printed nothing when this
synthesis started; by the time it was written, another agent's B22-A2 work in progress had modified
`app/lib/auth/route-resource-classification.ts`, `app/lib/computation/__tests__/b22-a1-page.test.ts` and
`artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv` and added an untracked
`app/lib/computation/runtime-profile.ts` and three `b22-a2-*` tests. The untracked files were not read; the two modified files cited here
(the classification module and CSV) were read only through `git show HEAD:`, and the classification rows quoted in sections 0 and 4 are
HEAD's - B22-A2 (`c037627`) has since changed the `externalProcess` column (D22-18); the lead re-read those rows at `dfd51e3` (section 9). HEAD stayed `50fe156` throughout and
every citation below is against the committed tree. B22's later increments (A2, A3, B, C, D, closeout) and the whole of
B23 land before B24; they touch `app/lib/computation`, `app/lib/model-simulation`, the spawners, the `externalProcess` classification
rows, the CI workflow, the reviewed tool counts (42/33/9/24 here; 47/36/9/27 at `dfd51e3`, B22-B `b4c7be7`, OD-139) and the route census (165/162/3/0 here; 166/163/3/0 at `dfd51e3`, B23-B1 `0c78e93`, OD-174). The lead re-verifies every
citation in those areas, and every count, on the tree B24 starts from before committing this page. No `artifacts/ai-control-plane-b24/`
directory exists (`git ls-tree HEAD artifacts/`, CONFIRMED). Prepared 2026-10-01.

[B24 lead, 2026-10-06] Committed on `chapter/b24-production-qualification` from main `57c3b29`, after PR #14 (B23) merged normally on
2026-10-06. Before committing, twelve read-only verifiers and one synthesizer re-read every citation, count and claim of D24-1..D24-40
and of sections 0-8 at `dfd51e3` (B23 complete but for its closeout), and five read-only auditors checked every proposed correction
against the code: 37 were themselves corrected before use. No defect was refuted and none is fully closed; of D24-1..D24-40, 24 stand, 5
stand with moved citations, 4 changed since and 7 are partly closed since. The 193 text corrections are applied in place throughout this
page, which therefore cites `dfd51e3` wherever a position, count or record moved; section 9.2 lists every citation that moved or changed
(old -> new), and the dated notes appended to sixteen defects say what B22 and B23 changed in them. Every other citation reads the same
at both trees. B23's closeout (`b6c6b0d`, `f663d71`) landed after `dfd51e3`; the lead delta-checked it against every citation of this
page (section 9.6): four B23 discovery citations moved by one line and the statements about OD-160, OD-178 and OD-188 changed, each
corrected in place; nothing else this page cites moved. Main `57c3b29`'s tree equals `f663d71`'s.

## 0. Reader disagreements and UNKNOWNs resolved by reading the code

- **Does a trace record the model?** Reader 1 said the trace identity carries "no model id"; reader 3 said provider and model are
  recorded. Both are right about different objects. The constructor identity `AgentTraceIdentity` has `provider`, `promptVersion`,
  `promptDigest`, `registryDigest`, scope and context digests and no model (`app/lib/agent/trace-recorder.ts:134-143`); the finished
  document has a `model` field (`app/lib/agent/trace.ts:244-245`, in the closed key list `:271`) that the recorder fills from the last
  recorded `step` event (`trace-recorder.ts:349-361`, `:511`), and every `step` event carries its model (`trace.ts:226`). A run that ends
  before any step records `""` (`trace-recorder.ts:159`). CONFIRMED. Consequence: the model-id half of reader 1's G-A12 is dropped; the
  unversioned-configuration half stands (D24-10).
- **LB-4.** Reader 1 cited LB-4 as a dead database; readers 5, 6 and 7 cited a real-server run. Both hold at HEAD: the register row
  still reads "dead external resource; one opt-in DB test fails in the default suite" (`artifacts/remaining-builder-program/LIVE_BLOCKERS.md:10`),
  while the ledger records that on 2026-09-24, with the owner's authorisation, two EMPTY databases on "the main Supabase project"'s
  PostgreSQL 17.6 server ran every migration, the replay and the 0000-0026 upgrade to an identical fingerprint, and all nine DB-gated
  suites qualified (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md:2490-2509`); the B20 verdict says the same
  (`artifacts/ai-control-plane-b20/final-verdict.md:58-59`). CONFIRMED (D24-33). Whether 0029/0030 were in that run is not recorded; they
  were committed 2026-09-13 (`git log -- drizzle/0029* drizzle/0030*`), before the run, so INFERRED yes. Whether "the main Supabase project"
  holds production data: **UNKNOWN** (section 8 item 2).
- **SDK retries and timeouts.** Reader 3 INFERRED "SDK retries of 2"; reader 4 CONFIRMED them for OpenAI. Re-read: the OpenAI agent
  adapter defaults `maxRetries` to 2 and builds its client with `timeout: 120_000` (`app/lib/agent/adapters.ts:106, :112`); the
  Anthropic adapter passes `maxRetries` only when given (specialists 0) and sets no timeout (`:208, :213`), so the coordinator's Anthropic
  client uses the SDK defaults (INFERRED from the code comment at `:208`). Both stay under the loop's 120 s run deadline
  (`app/lib/agent/contracts.ts:185`). CONFIRMED.
- **CI chapter list and the OD-30 line.** The B22 discovery cited `CHAPTERS = ["b19-", "b20-", "b21-"]` and `timeout-minutes: 30` at
  `:315`. At HEAD B22-A1 added `b22-` (`app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:54`) and admitted the
  `app/lib/computation/__tests__` directory (`.github/workflows/deterministic-manufacturing.yml:226`); the browser job header was `:315` (`:317` at `dfd51e3`)
  and its `timeout-minutes: 30` was `:317` (`:319` at `dfd51e3`, after B23's one-line insertions at `:227` and `:301`; `CHAPTERS` also holds `b23-` since `79fa18b`). CONFIRMED.
- **How many LLM routes are untraced.** Reader 3 counted eighteen. `git grep -l 'llmRouter|agentAdapterFor' HEAD -- 'app/api/**/route.ts'`
  lists 19 route files, and only `app/api/chat/route.ts` and `app/api/chat/orchestration-runtime.ts` use the trace recorder. So at least 18
  route files call a model with no trace (a route that reaches a model through a library module without either import is not counted). At `dfd51e3` B23-A2's derived, test-pinned `MODEL_EGRESS_PATHS` (`app/lib/auth/route-resource-classification.ts:130-136`) lists 23 paths and only `/api/chat` traces, so 22 are untraced; the grep misses `/api/schematic/build`, `/api/schematic/edit-build`, `/api/parts/search` and `/api/pcb/footprints/search`.
  CONFIRMED (D24-21).
- **How the public embedding routes are classified.** Reader 1 found them declared `providerCredit: false` because `pub()` hard-codes it
  (`app/lib/auth/route-policy.ts:62-64`). The synthesizer adds: the generated classification gives `/api/parts/search` and
  `/api/pcb/footprints/search` `provider_credit false`, `expensive false` and `static_or_catalog true`, and gives the anonymous
  `/api/pcb/placement/preview` (measured at 124.9 s per request, `artifacts/ai-control-plane-b20/final-verdict.md:67-68`) `expensive false`
  (`artifacts/ai-control-plane-b16-0-2/route-data-and-resource-classification.csv:102, :116, :117`). At `dfd51e3` B23-A2 (`da36d51`) appended `outbound_egress` and `model_egress` (both searches `none,true`, the preview `none,false`) and lists both searches in `PUBLIC_MODEL_EGRESS` (`route-resource-classification.ts:137-142`) under OD-174's open owner question (`OWNER_DECISIONS.md:2045-2046`). CONFIRMED (D24-8).
- **The B11-scanned files are hash-pinned in CI.** Not raised by any reader as a constraint on B24: `trace.ts`, `trace-recorder.ts` and
  `evaluation.ts` are three of the nine B11-scanned files (`app/lib/agent/orchestration/tripwires.ts:9-19`), each pinned by sha256 in
  `b21-e2b-trace-attribution.test.ts:42-53`, which CI runs through the orchestration directory filter
  (`deterministic-manufacturing.yml:132`). Any B24 change to the trace contract, the recorder or the evaluation scorer is therefore a
  reviewed pin move under OD-113 (`artifacts/remaining-builder-program/OWNER_DECISIONS.md:1634-1645`); binding a durable sink through
  `setAgentTraceSinkFactory` from a composition root is not (`trace-recorder.ts:108-113`). CONFIRMED (shapes OD-203, OD-207, OD-208).
- **The B18 permission page's counts.** Reader 7 said it is frozen at "97 records, 143 routes, 573 / 58"; the same line also states
  "155 = 152 + 3 + 0" (`artifacts/ai-control-plane-b18/permission-tiers.md:37`; `:30` holds neither string). Both CONFIRMED; `50fe156` had 102 records, 165 route
  methods and 628 sites on 62 surfaces; `dfd51e3` has 106 records, 166 route methods and 631 sites on 63 surfaces (section 1.3).
- **Next free numbers.** OWNER_DECISIONS headings ended at OD-153 (`OWNER_DECISIONS.md:1695`; at `dfd51e3` OD-153 is `:1696` and the headings end at OD-187, `:2463`); every OD-134..OD-159 now has a heading: B22 recorded the rest of OD-134..OD-150 and OD-154..OD-159 in `c037627`..`849a933` (OD-151 and OD-152 are SEC-1's)
  and B23 used OD-160..OD-188 (OD-160 and OD-178 were discovery rows without a heading until B23's closeout recorded both, `b6c6b0d`, `f663d71`). Reader 6 said the B23 draft "reserves OD-181..OD-189";
  the draft read here did not, but the committed B23 discovery (`3806cba`) does (`artifacts/ai-control-plane-b23/discovery.md:1198, :1350`; `EXECUTION_LEDGER.md:4344`), and B23 spent OD-181..OD-188. This chapter starts at **OD-190** as
  instructed, which leaves OD-189 reserved and unspent (B23's closeout spent OD-188); at `dfd51e3` and after the closeout no OD-190 or higher is recorded, the only match being B23-C's fake test id `OD-999` (section 8 item 14). Live
  blockers: LB-1..LB-12 exist at `dfd51e3` (LB-10 recorded by B22, OD-147, `c037627`; LB-11/LB-12 by B23, OD-179, `79fa18b`), so B24's first new row is **LB-13**. No `D24-`
  id exists (`git grep`, CONFIRMED).
- **Two live suites, INFERRED broken.** `assist-live.test.ts` posts with only a content-type header (`app/api/pcb/edit/__tests__/assist-live.test.ts:40-46`)
  to a route wrapped by `authenticatedJsonRoute` (`app/api/pcb/edit/assist/route.ts:349`; `:35` is the import), whose trusted context refuses with 401 without a
  principal or 400 `AUTH_PROJECT_SELECTOR_REQUIRED` without a project selector (`app/lib/auth/trusted-request-context.ts:76-92`): under
  `PCB_ASSIST_LIVE=1` it would most likely be refused before any model call. The kicad-cli oracle's first case exports `createEmptyBoard()`
  (`app/lib/pcb/__tests__/kicad-cli-oracle.test.ts:30`) while its title and assertion expect the routed demo's deliberate short
  (`:29`, `:57-58`); `buildRoutedDemo` is imported (`:22`) and unused by that case. Neither was run: INFERRED (D24-19).

---

## 1. Scope and references

### 1.1 Chapter scope (`C:/Users/robsa/Downloads/Sirkit_Remaining_Builder_Master_Runbook.md:1021-1159`)

- **Mission** (`:1025`): "Prove the integrated product under real production-like conditions and establish an ongoing
  evaluation/security/reliability program. This is the final code-and-evidence chapter, not permission to overstate physical validation."
- **B24-A** (`:1027-1044`): "isolated development, CI, staging and production configurations" (`:1029`) with: supported database
  migration/rollback (`:1031`); real Supabase authentication qualification in staging (`:1032`); least-privilege service roles (`:1033`);
  secrets management and rotation (`:1034`); CSP/security headers (`:1035`); origin/redirect allowlists (`:1036`); backup/restore and
  point-in-time recovery evidence (`:1037`); trace/audit retention and deletion policy (`:1038`); rate limiting and abuse controls
  (`:1039`); health/readiness checks (`:1040`); versioned provider and tool configuration (`:1041`); feature flags for MCP, sandbox and
  external manufacturing (`:1042`). `:1044` verbatim: "Never reuse production data in tests."
- **B24-B** (`:1046-1070`): "Create a versioned benchmark covering:" (`:1048`) nineteen areas (`:1050-1068`): tool discovery and
  selection; argument generation; stable object/reference resolution; permission tier compliance; stale revision and conflict handling;
  undo/redo and refresh recovery; UI-command-tool parity; component deletion/replacement; power and ground preservation; exact
  footprint/pin authority; vias, tracks, rules, dimensions and geometry; 3D/view control; placement/routing; provider fallback and quota
  exhaustion; specialist disagreement; prompt/tool/MCP injection; sandbox escape attempts; manufacturing qualification/release; external
  quote/order denial and idempotency. `:1070` verbatim: "Classify each evaluation as deterministic offline, model-in-loop, browser E2E,
  database-backed, external-provider staging or physical-hardware validation. Keep scores separate so a fake-backed pass cannot hide a
  missing live test."
- **B24-C** (`:1072-1088`): provider-neutral traces capture request and trusted context references; project revisions read;
  orchestration plan and specialists; provider/model identity; tool discovery/calls/results; grants and human approvals; transactions and
  state changes; verification evidence; retries/cancellation/errors; token/cost/latency budgets; final user-visible result
  (`:1076-1086`). `:1088` verbatim: "Do not store hidden reasoning. Redact secrets and sensitive source content. Replay against immutable
  snapshots must never mutate current state unless a new explicit approval begins a new transaction."
- **B24-D** (`:1090-1109`): "Measure and gate:" (`:1092`) direct view/read command latency; reversible edit latency; complex verified
  workflow latency; streaming first-event and completion behavior; provider timeout/fallback; tool-loop limits; memory and large-board
  behavior; multi-tab concurrency; browser refresh/crash recovery; database failover/recovery; process/sandbox cleanup; keyboard and
  screen-reader usability; visible focus, error and approval states; responsive editor behavior (`:1094-1107`). `:1109` verbatim:
  "Replace fragile wall-clock unit thresholds with stable benchmark methodology where appropriate, without hiding real regressions."
- **B24-E** (`:1111-1123`): "When credentials and hardware are explicitly supplied:" (`:1113`) 1. live OpenAI and Anthropic
  contract/eval turns with strict spend limits (`:1115`); 2. production-auth browser E2E against an isolated Supabase staging project
  (`:1116`); 3. supported live component/distributor checks without purchasing (`:1117`); 4. real sandboxed simulator/router jobs on the
  qualified platform (`:1118`); 5. manufacturing DFM/quote staging if available (`:1119`); 6. "Produce the deterministic 555 release and
  fabricate only after separate owner approval." (`:1120`); 7. "Record incoming inspection and electrical/functional test evidence."
  (`:1121`). `:1123` verbatim: "If any resource is unavailable, mark that gate `BLOCKED-LIVE-QUALIFICATION`; do not convert a fake-backed
  result into a live claim."
- **B24-F** (`:1125-1159`): `artifacts/ai-control-plane-b24/` with executive summary; final current-system and trust-boundary maps; final
  UI-command-tool-MCP coverage matrix; final agent/specialist graph; final permission and autonomy matrix; final database/migration proof;
  final provider/MCP/sandbox security reports; complete eval catalog and results; browser/live/physical qualification matrix;
  performance/reliability report; threat-model closure register; open risks and owner decisions; changed files and commits; final verdict
  (`:1129-1142`). The verdict states separately (`:1144-1155`): deterministic local readiness; CI readiness; staging authentication
  readiness; live provider readiness; external component-provider readiness; MCP readiness; sandbox readiness; manufacturing-file readiness;
  external quote/order readiness; physical hardware validation. `:1157` verbatim: "“Application complete” may be claimed only for the
  scopes whose gates actually pass. Physical product completion requires physical evidence." `:1159`: "Commit, open the B24 PR, wait for
  CI and review, merge normally only if all applicable gates pass, fast-forward main, and produce the final program report."

### 1.2 Program-wide sections 3-5 (`:1163-1266`)

- **Section 3, required test scenarios** (`:1163-1186`): "The final system must demonstrate all of these without bypassing authority:"
  twenty scenarios, 1. inspect any selected object (`:1167`) to 20. "Refuse purchase/order without exact Tier 3 human authority."
  (`:1186`); among them 3. wires, nets, labels and power symbols (`:1169`), 8. "Change all vias on a stable net under manufacturing
  constraints." (`:1174`), 15. an approved external MCP read tool (`:1181`), 16. a Sirkit read/propose tool over MCP (`:1182`), 17. the
  timer replacement "with deterministic disagreement resolution" (`:1183`), 18. "Execute an approved sandboxed simulation without
  network/secrets/filesystem escape." (`:1184`).
- **Section 4, acceptance and stop rules** (`:1190-1212`): seventeen conditions, among them "every major chapter has its evidence
  directory and truthful verdict;" (`:1194`), "sandbox execution is proven isolated or remains honestly blocked;" (`:1204`), "trace/replay/evals
  cover the required scenarios;" (`:1206`), "GitHub CI and benchmark-quality are green;" (`:1207`), "no secrets are committed;" (`:1208`),
  "`C:\Users\robsa\sirkit` remains untouched;" (`:1209`), "all remaining live and physical unknowns are named precisely." (`:1210`); and
  "End only at the program verdict or a genuine blocker described in Section 0." (`:1212`).
- **Section 5, final report format** (`:1216-1266`): `SIRKIT REMAINING BUILDER PROGRAM: COMPLETE | PARTIAL | BLOCKED`; final main SHA;
  chapters completed and partial/blocked; PRs merged; full test and benchmark-quality results; route methods, canonical wrappers,
  approved factories, raw handlers; registered actions; agent- and MCP-exposed tools; direct Tier-1, proposal-only Tier-2 and
  `AGENT-EXPOSED TIER-3 OPERATIONS: 0`; ten status lines (provider, production auth, database/RLS, component acquisition, MCP,
  multi-agent, sandbox, manufacturing release, external quote/order, physical hardware); `SECRETS EXPOSED`, `PROTECTED ORIGINAL MODIFIED`,
  `HISTORY FABRICATED OR BACKDATED`; remaining unknown or blocked facts; owner decisions still required; a truthful product verdict.
  `:1266` verbatim: "Stop after this final report. Do not claim completion beyond the evidence."
- **Global rules that bind B24 most directly** (quoted in section 5): `:138`, `:144`, `:146-148`, `:152-158`, `:162-171`.

### 1.3 Repository state

- **Reviewed sets** (CONFIRMED): route census 166 = 163 canonical + 3 factories + 0 raw at `dfd51e3` (165/162/3/0 at `50fe156`; B23-B1 `0c78e93` added `POST /api/pcb/provider-exchange`, OD-174)
  (`app/api/__tests__/b16-1c-invariant-tripwires.test.ts:38, :48`); registry 47, agent-exposed 36, MCP-exposed 9, agent-only 27 (42/33/9/24 at `50fe156`; B22-B `b4c7be7`, OD-139)
  (`app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts:241`); the 36 exposed ids include six granted Tier 1 executions
  (move-footprint, rotate-side-footprint, arrange, silkscreen-text, dimension, undo-redo-granted) and five proposal tools
  and three Tier 0 named computations (`app/lib/engineering/agent-exposure.ts:30-64`; `app/lib/engineering/granted-execution-families.ts:24-60`); 106 action records (102 at `50fe156`)
  (`artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv`, 107 lines with the header); 631 control sites on 63 surfaces (628 on 62 at `50fe156`)
  (`artifacts/ai-control-plane-b17/ui-control-inventory-summary.json:3-4`); 152 `route.ts` files (`git ls-tree`; B23-B1 added `app/api/pcb/provider-exchange/route.ts`); 31 SQL migrations and 143
  distinct `CREATE TABLE` names under `drizzle/`.
- **CI**: two workflows, both `permissions: contents: read` (`.github/workflows/benchmark.yml:9-10`; `deterministic-manufacturing.yml:20-21`);
  jobs `benchmark-core` (corpus schema validation, `tsc`, one stage-09 suite and `stage10:test` = `vitest run app/lib/engineering/__tests__`,
  `benchmark.yml:28-35`; `package.json:41`), `benchmark-nightly` (`:47-77`), `prompt-to-gerber` (a listed set of files and directories,
  `deterministic-manufacturing.yml:50-259`, with `app/lib/manufacturing-providers/__tests__` admitted at `:227`), `database-delivery` (PGlite, no marker, `:272-302`, with `b23-b-exchange-ledger-pglite` at `:301`) and `page-browser-e2e` (both Playwright
  configs, `:317-336`). No step runs eslint, `next build`, a secret scan, or sets a secret or live flag (both files read in full).
  CONFIRMED
- **Live blockers**: LB-1..LB-12 (`LIVE_BLOCKERS.md:5-18`); `PROGRAM_STATE.json` mirrors eight of them (`:12-21`); B22 recorded LB-10 (`c037627`, OD-147) and B23
  LB-11/LB-12 (`79fa18b`, OD-179) plus a dated LB-5 note (`dfd51e3`). CONFIRMED
- **Chapters**: B16-B19 PASS, B20 PARTIAL, B21 PARTIAL (reader 6; `artifacts/ai-control-plane-b20/final-verdict.md:3`;
  `artifacts/ai-control-plane-b21/final-verdict.md:3`, CONFIRMED); B22 PARTIAL and merged as `43cb1b0` (PR #13), production simulation BLOCKED
  and a diagnostic-only runner; B23's discovery and A1..D landed on `chapter/b23-external-manufacturing` (`dfd51e3`), then its closeout (`b6c6b0d`, `f663d71`), verdict PARTIAL (`artifacts/ai-control-plane-b23/final-verdict.md`), merged as PR #14 (`57c3b29`). PRs merged on main #5..#13
  (`git log --merges --first-parent main`, CONFIRMED).
- **Production host**: declared nowhere in the repository (no deployment file, section 2.1). **UNKNOWN**.

---

## 2. What exists (per surface)

### 2.1 Environments, deployment and configuration (B24-A)

- **Two runtime states only.** `isProductionRuntime` is `NODE_ENV === "production"` (`app/lib/auth/mode.ts:22-24`); a production runtime
  always resolves production auth and `SIRKIT_AUTH_MODE` can only raise a non-production runtime to production (`:36-41`); local-development
  identity is allowed only outside production (`:78-80`); `sensitiveOperationsBlocker` refuses sensitive operations in production when the
  Supabase URL or publishable key is missing (`:87-95`). No staging, CI or preview identifier is read anywhere (reader 1's `SIRKIT_*`
  census; the synthesizer's own census of non-test `SIRKIT_*` names finds none). CONFIRMED
- **No deployment configuration.** `git ls-files` lists no Dockerfile, compose file, `vercel.json`, `netlify.toml`, `fly.toml`,
  `render.yaml`, Procfile or `supabase/config.toml`; the scripts are `build: next build` and `start: next start` (`package.json:9-10`).
  CONFIRMED
- **CI never builds or runs production mode.** No workflow runs `next build`; the browser jobs start `pnpm exec next dev` with
  `NODE_ENV: "development"`, `SIRKIT_AUTH_MODE: "local_dev"`, the blinker fixture runtime, the scripted agent and `DATABASE_URL: ""`
  (`playwright.config.ts:41, :47-68`), reusing an existing server outside CI (`:43`) and spreading `process.env` first (`:48`).
  CONFIRMED
- **Environment variable names.** `.env.example` declares (names only, values masked): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DATABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `KICAD_CLI`, `SIRKIT_NGSPICE_INSTALL_ROOT`, `SIRKIT_NGSPICE_INSTALL_SHA256` (B22-A3 `e483838` replaced `NGSPICE_BIN`, now only a comment at `:48`), `SIRKIT_ASSIGNMENT_QUEUE_STAGE6`,
  `SIRKIT_PCB_SYNC_STAGE3`, `SIRKIT_WORKFLOW_WORKER_SECRET`, and commented `SIRKIT_ANTHROPIC_MODEL`, `SIRKIT_OPENAI_MODEL`,
  `SIRKIT_OPENAI_REASONING_EFFORT`, `FREEROUTING_JAR`, `FREEROUTING_JAVA`, `JAVA_HOME`, `SIRKIT_MCP_ENABLED`, `SIRKIT_MCP_DISABLED_SERVERS`,
  `SIRKIT_MCP_TOKEN_SECRET` (`.env.example:6-79`). `SIRKIT_EXPECTED_ORIGIN` (required in production, `app/lib/auth/expected-origin.ts:16-19, :36`)
  and `KICAD_HTTP_LIBRARY_TOKEN` (`app/lib/atomic/server-auth.ts:5`) appear only inside a comment (`.env.example:77-78`); the distributor
  keys, `SIRKIT_AUTH_MODE`, the orchestration names and `SIRKIT_DB_POOL_MAX` are absent (reader 1, cited per name), and so are ten names B22 and B23 code reads: `SIRKIT_NAMED_COMPUTATIONS`, `SIRKIT_KICAD_CLI_INSTALL_ROOT`, `SIRKIT_KICAD_CLI_INSTALL_SHA256`, `SIRKIT_FREEROUTING_INSTALL_ROOT`, `SIRKIT_FREEROUTING_INSTALL_SHA256`, `SIRKIT_NGSPICE_OCI_IMAGE`, `SIRKIT_OCI_CLI_PATH`, `SIRKIT_OCI_CLI_SHA256`, `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS` and `SIRKIT_ORDERING_DISABLED`. CONFIRMED
- **Provider and tool configuration.** Models come from the environment with code defaults (`app/lib/llm/anthropic-config.ts:8, :14-16`;
  `app/lib/llm/openai-config.ts`, reader 1); the public `/api/ai/runtime` reports them (`app/api/ai/runtime/route.ts:13-40`) but computes the
  Anthropic model with `?.trim() || "claude-opus-4-7"` (`:16`) while every adapter uses `environment.SIRKIT_ANTHROPIC_MODEL ?? DEFAULT`
  (`anthropic-config.ts:15`; `adapters.ts:208, :328`): an empty or padded value is reported as the default and sent as given. Tool and
  registry versions exist (`ToolDescriptor.version`; `SOURCE_REGISTRY_VERSION` 1.1.0; `MCP_SERVER_REGISTRY_VERSION` 1.2.0, reader 1; since `50fe156` also B23-A1's `PROVIDER_REGISTRY_VERSION` 1.0.0, `app/lib/manufacturing-providers/provider-registry.ts:23`, and B22-A2's digest-pinned runtime profiles, `app/lib/computation/runtime-profile.ts:28-40`). No
  record versions a deployment's provider, model, reasoning effort and role table together. CONFIRMED
- **Feature flags.** MCP (`SIRKIT_MCP_ENABLED` exactly "1", remove-only `SIRKIT_MCP_DISABLED_SERVERS`, reader 1), orchestration
  (`SIRKIT_ORCHESTRATION_ENABLED` exactly "1", `app/api/chat/orchestration-runtime.ts:39-44`), off-only `SIRKIT_ACQUISITION_DISABLED_SOURCES`,
  four stage rollouts, two shadows, six fixture flags and the opt-in live gates (reader 1). At `dfd51e3` a computation opt-in and two off-only external-manufacturing switches exist, but no sandbox
  flag exists. The three are `SIRKIT_NAMED_COMPUTATIONS` exactly "1", default off (`app/api/chat/computation-runtime.ts:20, :24`; `b4c7be7`, OD-158), `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS` (`app/lib/manufacturing-providers/provider-admission.ts:23`; `79fa18b`) and `SIRKIT_ORDERING_DISABLED` (`ordering-enablement.ts:41`; `4e71563`). B23-C applied ordering disabled through a pure `orderingEnablement()` (`ordering-enablement.ts:93`) that no
  environment variable can enable (OD-171 as applied, `OWNER_DECISIONS.md:2338`). CONFIRMED
- **No health or readiness route.** None of the 152 `route.ts` files at `dfd51e3` is a health, readiness, status or ping endpoint; Playwright's start probe
  is `GET /api/ai/runtime` (`playwright.config.ts:42`), a public static-configuration route that checks no database, auth configuration or
  provider (`app/api/ai/runtime/route.ts:13-40`). CONFIRMED

### 2.2 Data layer: migrations, roles, RLS, backup, test isolation

- **Forward migration is supported.** `pnpm run db:migrate` with `--status`, `--dry-run` and `--baseline` (`scripts/db-migrate.ts:5-15,
  :46-99`; `package.json:14-15`), a transactional ledger with checksum-drift, unknown-row and gap refusals and an advisory lock
  (`app/lib/db/migrations/runner.ts:1-25, :49-54`); `db:push` is refused (`package.json:13`); the database-delivery job proves clean,
  upgrade, replay, drift and interruption on PGlite (`deterministic-manufacturing.yml:8-11, :285-302`; B23-B2's PGlite exchange-ledger suite is at `:301`). CONFIRMED
- **No rollback.** The runner and CLI have no down, revert or rollback path (`git grep -i 'down|rollback|revert'` over
  `app/lib/db/migrations` hits only an unrelated function name); 0027 says "Rollback: see the DOWN section" (`drizzle/0027_project_membership.sql:7`)
  and that section, like 0028's, is SQL commented out (`:57-62`; `drizzle/0028_bom_project_ownership.sql:62-72`). CONFIRMED
- **One database role for everything.** Every server query goes through one `postgres-js` client on `DATABASE_URL` (pool
  `SIRKIT_DB_POOL_MAX`, default 8) (`app/lib/db/client.ts:20-48`), the membership repository included
  (`app/lib/auth/postgres-membership.ts:11, :17`); 0027 calls that path "the trusted server membership repository", which "bypasses RLS"
  (`0027:40-41, :52-55`). No production code reads a Supabase service-role key (`SUPABASE_SERVICE_ROLE_KEY` appears only as a test sentinel,
  `app/api/__tests__/b16-0-12-tranche-parity.test.ts:105`). TLS is required only when the URL contains `supabase.` (`client.ts:33`; the same rule at `app/lib/db/migrations/postgres-executor.ts:32` and `scripts/backfill-mpn-and-generics.ts:77`). CONFIRMED
- **RLS on one table of 143.** The only `ENABLE ROW LEVEL SECURITY`/`CREATE POLICY` in `drizzle/` is `project_members` (`0027:44, :47-50`);
  no migration has `GRANT`, `REVOKE` or `CREATE ROLE` (`git grep`). The publishable key is browser-visible by design
  (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `app/lib/auth/mode.ts:65`). Whether the project's Data API exposes `public` with default grants is
  project configuration recorded nowhere: if it does, the other 142 tables are reachable with that key (INFERRED; **UNKNOWN** until a
  staging project is read). CONFIRMED (code)
- **No database backup, restore or point-in-time recovery.** Every `backup` hit is the project-envelope store
  (`app/lib/engineering/persistence.ts:8, :57`; `node-file-store.ts:55`; `browser-indexeddb-store.ts:30`); nothing names `pg_dump`,
  `pg_restore` or PITR. No failover, replica or reconnect-and-retry logic exists (`client.ts:29-46`). CONFIRMED
- **Real-server qualification is opt-in and, for one suite, unguarded.** The gate reads only `SIRKIT_DB_QUALIFICATION=1` and
  `SIRKIT_DB_QUALIFICATION_URL` (reader 1, `app/lib/db/test-qualification.ts:15-42`); the postgres-qualification suite refuses a non-empty
  target (`app/lib/db/__tests__/b16-b-postgres-qualification.test.ts:36`, the only `TARGET_NOT_EMPTY` at HEAD), but
  `schema-integrity.test.ts` sets `process.env.DATABASE_URL` to the qualification URL (`app/lib/physical-binding/__tests__/schema-integrity.test.ts:15-16`)
  and before each live case deletes every row of five tables, `physical_binding_audit_events` included, with no scope and no empty-target
  check (`:52-60, :124`). It is the only DB-gated suite with an unscoped `DELETE` (synthesizer grep of the DB-gated suites: nine test files import the gate, one of them its contract suite, and the ledger counts the same nine, `EXECUTION_LEDGER.md:2496-2507`). CONFIRMED
- **The live-auth matrix's isolation is a name.** It runs only when `SIRKIT_AUTH_QUALIFICATION_PROJECT` matches
  `/^sirkit-auth-qualification-[a-z0-9-]+$/i` (`app/lib/auth/__tests__/b16-1b-live-qualification.test.ts:27-28, :35`); nothing checks that
  the base URL or the optional `SIRKIT_AUTH_QUALIFICATION_DATABASE_URL` is not production. CONFIRMED
- **Other paths that could touch real data** (reader 1, INFERRED): the acceptance driver `scripts/e2e-prompt-to-gerber.ts` loads `.env.local`
  and drives a live server whose database it does not choose; local Playwright runs inherit `.env.local` through `next dev` (only
  `DATABASE_URL` is blanked, `playwright.config.ts:48, :68`) and, outside CI, reuse any server already on the port (`:43`).

### 2.3 Edge security: headers, origins, secrets, abuse controls

- **Headers.** One header on every path: `Content-Security-Policy: img-src 'self' data: blob:` (`next.config.ts:9-11`), proven served
  (`e2e/security-headers.spec.ts:10-21`). No `default-src`, `script-src`, `connect-src`, `frame-ancestors`, `X-Frame-Options`, HSTS,
  `X-Content-Type-Options`, `Referrer-Policy` or `Permissions-Policy` anywhere (`git grep` over `*.ts`, `*.tsx`, `*.mjs`); `poweredByHeader`
  is not set (`next.config.ts:3-12`), so Next.js presumably sends `X-Powered-By` (INFERRED); `allowedDevOrigins` names a LAN address
  (`:6`, dev server only). CONFIRMED
- **Cookies and origins.** Session cookies are HttpOnly, `SameSite=Lax`, and `Secure` only when `SIRKIT_EXPECTED_ORIGIN` is https
  (`app/lib/auth/session-cookies.ts:30-38`); the CSRF origin is one server-owned, validated origin, required in production and never taken
  from forwarding headers (`expected-origin.ts:16-31`); the OAuth callback redirects only to a single-slash relative path (reader 1,
  `app/api/auth/callback/route.ts:35-63`; `request-security.ts:76-89`). Supabase's own Site URL and redirect allowlist are recorded nowhere.
  CONFIRMED
- **Secrets.** Plain environment variables read at call time, `.env*` ignored except `.env.example` (`.gitignore:41-42`); no vault, KMS or
  secret-manager code (reader 1). Every shared secret is one value: the worker secret is one constant-time compare
  (`app/lib/auth/worker-principal.ts:49-55`), the KiCad library token one compare (`app/lib/atomic/server-auth.ts:4-14`), and the MCP
  HS256 key signs a header pinned byte for byte with no `kid` (`app/lib/auth/mcp-bearer.ts:39-40`), one-hour tokens (`:42`), 32-1024 bytes
  and never equal to the other two secrets (`:14-16, :35-36, :47-48`). Changing a value cuts every holder at once; there is no previous-key
  window. B23 adds two more single-value seams, neither holding a value today: the webhook HMAC secret (`app/lib/manufacturing-providers/webhook-verification.ts:9, :29-30`; caller-supplied, no `kid`, used only by the order contract that no composition root wires) and the provider credential header (`provider-egress.ts:198-201`; one environment variable per transfer descriptor, reached by `POST /api/pcb/provider-exchange` past admission, with `PROVIDER_TRANSFER_DESCRIPTORS` empty at `provider-egress.ts:69`). CI has no secret-scan step (section 1.3). CONFIRMED
- **Abuse controls that exist.** Per-process fixed windows for MCP: 10 token mints and 120 endpoint calls per 60 s per verified identity,
  429 with `Retry-After` (`app/lib/mcp/server/inbound-limits.ts:1-25`; `app/lib/auth/route-handlers.ts:1040`); process-wide LLM admission
  (240 a minute, agent share 60, breaker; "the coordinator's own first turn is not metered") (`app/lib/acquisition/admission-control.ts:324-350`),
  consulted only by the orchestration provider policy (`app/lib/agent/orchestration/provider-policy.ts:151-153`, the only non-test caller);
  per-route body and deadline bounds through the wrappers (`app/api/parts/search/route.ts:64`). Since `50fe156`: 429 `PX_PLAN_LIMIT_REACHED`/`PX_KEY_LIMIT_REACHED` on the authenticated `POST /api/pcb/provider-exchange` (`app/lib/manufacturing-providers/provider-exchange.ts:22, :84-85`), a per-process manufacturing-provider meter with agent share 0 (`admission-control.ts:472+`, OD-165) and a global ngspice process cap with a bounded queue (`NGSPICE_DIAGNOSTIC_BUSY`, `app/lib/computation/diagnostic-runner.ts:43-45`, OD-155). CONFIRMED
- **Abuse surface.** `POST /api/parts/search` and `GET /api/pcb/footprints/search` are public (`route-policy.ts:246, :256`) and embed every
  free-text query through the paid OpenAI embeddings API (`app/api/parts/search/route.ts:110, :241-250`;
  `app/api/pcb/footprints/search/route.ts:28, :58`; `app/lib/pcb/footprint-search-service.ts:63`; `app/lib/embeddings.ts:33-35, :50-53`)
  with no limiter (the only 429 in the wrappers is MCP's, `route-handlers.ts:1040`). `pub()` hard-codes `providerCredit: false`
  (`route-policy.ts:62-64`), so the `publicHasCreditOrWrite` census (`app/lib/auth/route-resource-classification.ts:210-215`) cannot see
  them, while B23-A2's `model_egress` column and `outboundEgressViolations` gate (`route-resource-classification.ts:130-142, :238-247`) record both as reviewed `PUBLIC_MODEL_EGRESS` exceptions under OD-174's open owner question, recorded, not changed; `providerCredit` is declared, never enforced (reader 1). `/api/pcb/placement/preview` is public (`route-policy.ts:257`) and blocked
  the event loop 124.9 s per request (B20 verdict `:67-68`). `POST /api/auth/signin` has no application throttle around
  `signInWithPassword` (`app/api/auth/signin/route.ts:83`). The single-agent chat path is not LLM-metered (INFERRED from the caller census).
  CONFIRMED

### 2.4 Evaluation harnesses (B24-B)

- **Three separate harnesses, three schemas.** (1) Stage-09 EDA benchmark: `sirkit.benchmark.v1`, a 63-package corpus, tiers tier0-tier6,
  statuses including `blocked_by_prerequisite`, `unsupported`, `license_unavailable` (reader 2, `app/lib/benchmark/types.ts:1-17`;
  `corpus-v1.ts:82-144`); no package evaluates AI-control-plane behaviour (`ai_safety` is a declared task kind, `types.ts:16`, and metric domain, `metrics.ts:20`, but no corpus package uses it). (2) B11 agent evaluation:
  `sirkit.agent-evaluation-case.v1`/`report.v1`, eleven categories, 19 scripted-replay cases (`app/lib/agent/evaluation.ts:15-22`;
  `artifacts/ai-control-plane-b11/evaluation-case-matrix.csv:2-20`). (3) B21-F matrix: `sirkit.b21-evaluation-matrix.v1`, 12 runbook rows
  with `offline`, `browser` and `model_in_loop` columns (`app/lib/agent/orchestration/__tests__/_f-cases.ts:71-72`). CONFIRMED
- **Classes and scores.** B11's case and report have no class field and pool every case into one `totals` block
  (`evaluation.ts:32-41, :107-125`); its matrix carries a `provider` column (`evaluation-case-matrix.csv:1`), so the scripted quota,
  no-fallback and Anthropic-parity rows read `anthropic`/`openai` with `passed=true` (`:16-18`). B21-F's `row()` writes `offline: "PROVEN"`
  as a literal (`_f-cases.ts:54`) and every model-in-loop cell is a BLOCKED-LIVE-QUALIFICATION constant (`:34-36`). Stage-09's regression
  check blocks only `failed_correctness`, `timeout`, `crash`, `cancelled`, `environment_failure`, `oracle_disagreement` and `invalid_fixture`
  (`app/lib/benchmark/regression-policy.ts:69`): a run whose statuses are all `blocked_by_prerequisite` with no failing critical gate
  evaluates `pass` (`:72-88`, INFERRED from the code). None of the six runbook classes exists as a type anywhere. CONFIRMED
- **What CI runs.** `benchmark-core` validates the corpus schema and runs one stage-09 suite plus the engineering directory
  (`benchmark.yml:28-35`); the 63-package corpus runs only through manual `benchmark run`/`baseline` (reader 2); the nightly job declares the
  holdout and licensed suites unavailable (`:74-77`). The prompt-to-gerber job runs B17-B23 suites by name or directory (B23's at `deterministic-manufacturing.yml:227`; its PGlite suite runs in database-delivery at `:301`) but no file under
  `app/lib/agent/__tests__/b09-*`, `b10-*` or `b11-*` and none of `app/api/chat/__tests__/b10-*`/`b11-*` (the 23 files exist,
  `git ls-tree`; `git grep -E 'b09|b10-|b11' HEAD -- .github/` is empty). B11's own summary still has a section "CI gates delivered"
  (`artifacts/ai-control-plane-b11/validation-summary.md:74`). The single-agent hard budgets (max steps and tool calls, cycle detection)
  and "no automatic provider fallback" are among the unadmitted cases (`app/lib/agent/__tests__/b09-loop-safety.test.ts:203, :218, :229`).
  CONFIRMED
- **Model-in-loop.** The only agent live harness is `scripts/run-b21-live-orchestration-evaluation.ts`: refused unless
  `SIRKIT_LIVE_ORCHESTRATION_EVALUATION` is exactly "1" (`:76-79`), one provider per run (`:80`), at most 40 requests with SDK retries 0
  (`:35-38`), the four task-graph capsules only (`:71-73`), `faultReproduced: false` recorded (`:88`); "It is NOT a test and no suite runs
  it" (`:4-5`); never run (`_f-cases.ts:34-35`; B21 verdict `:13-14`). The other model-in-loop check is `assist-live.test.ts` (Anthropic only, the PCB assist
  route, INFERRED broken, section 0). CONFIRMED
- **Area coverage** (reader 2, by area, with CI admission checked by the synthesizer for the cited suites): discovery and selection (B11
  e02/e03/e06c/e09 outside CI; b04 registry and b17-f exposure in CI); argument generation (three-way schema parity, explicit grammars in CI;
  live only in assist-live); reference resolution (b07, b18-e-via-facts, b14; browser Go-to); tier compliance (b18-a, b18-c sweeps, `b23-a-tier3-vocabulary`, `b23-a-route-vocabulary`, B20
  never-reachable sweep in CI; production auth BLOCKED, LB-1); stale revision (B21-F case 8, conflict dialogs in CI); undo/redo/refresh (b18-c,
  b18-d suites in CI; browser reload and Redo); UI-command-tool parity (b17-a inventory, b20-c1 in CI); deletion/replacement (b06, b14,
  b21-d3 in CI); **power and ground preservation: no agent or evaluation case names it** (`git grep` of test titles); exact footprint/pin authority (B13,
  b19-e adopt in CI; `pin-pad-mapping` and footprint-resolver suites outside CI); vias/tracks/geometry (b18-e in CI; routed board in a
  browser BLOCKED, LB-8); 3D/view (b17-f, view-session in CI; browser 3D); placement/routing (stage-08 nightly, recordings in CI; live router
  local-only, LB-3); provider fallback and quota (B21-E1 suites in CI with fake SDK clients; B11 e12/e13 outside CI; live BLOCKED, LB-9);
  specialist disagreement (B21-F case 6, browser F6 in part; live BLOCKED); injection (seven b19-d suites, b20-d1 in CI; no live model or
  live MCP server); sandbox escape (SEC-1 and B22-A1 screens in CI; B22-D's `b22-d-adversarial` in CI at `deterministic-manufacturing.yml:226` and the opt-in `b22-d-adversarial-live`, one lead run 12 of 13 with class 4 NOT CONTAINED; runner BLOCKED, LB-10); manufacturing
  release (acceptance pipeline, release-human-only in CI; external DFM fake-backed through `POST /api/pcb/provider-exchange` with `b23-b-*` suites in CI, live LB-11; physical LB-5); quote/order denial (forged `sirkit_bom_order`
  refused, `b18-e-scenario-8`; no order route, `b19-e-no-purchase-tripwire.test.ts:303`; no browser case sends "Order the parts.";
  idempotency evaluated offline by `b23-b-exchange-ledger` and its PGlite twin, `b23-b-approval-plan`, `b23-c-purchase-authorization` and `b23-c-order-contract`, live LB-12). INFERRED (mapping), CONFIRMED (cited lines re-read: section 1.3 and the files named)

### 2.5 Traces, audit records and replay (B24-C)

- **The run-trace contract.** `sirkit.agent-run-trace.v1` is audit metadata only: identities, digests, closed classes, bounded warnings; never
  keys, raw provider bodies, hidden reasoning, continuation state or unrestricted prompts and outputs; digest-only traces "deliberately CANNOT
  reconstruct model output" (`app/lib/agent/trace.ts:1-13`). Closed top-level keys (`:271`): provider, model, prompt version and digest,
  registry digest, scope, five context digests, `startedAt`/`endedAt`, events (`step` with model and tokens; `tool_invocation` with tool id,
  version, args and output digests, outcome class, verification, proposal id/digest, optional `external` block; one `terminal`), terminal
  usage, warnings, recorder diagnostics (`:224-263`). No request digest, principal, budget, cost, per-event time or answer digest. CONFIRMED
- **The coordinator and single-agent trace is discarded.** The default sink is a run-local `InMemoryTraceSink`
  (`app/lib/agent/trace-recorder.ts:108-113`), and "Durable retention, retention duration, and operator access are EXPLICIT FUTURE OWNER
  DECISIONS" (`:41-45`); `setAgentTraceSinkFactory` has no production caller (`git grep`); the chat route finalizes, validates and computes
  `void agentRunTraceDigest(trace)` and nothing else (`app/api/chat/route.ts:437, :458-465`). B11 left persistence, duration, location,
  readers, access audit and per-tenant salting to the owner (`artifacts/ai-control-plane-b11/redaction-and-retention-policy.md:41-57`).
  CONFIRMED
- **What is durable.** With orchestration on: the `agent.orchestration-run.v1` record (plan, request, result, decision, dissent; "silent";
  "retention: RECORDED on the page, not implemented here", `app/lib/agent/orchestration/store.ts:1-22`), a resume record holding the
  coordinator's final text up to 60,000 characters (`:398, :402`), and one `agent.orchestration-trace.v1` per specialist task (reader 3,
  `trace-attribution.ts:252-322`), written and never read by any route, UI or MCP tool (reader 3). Always: execution grants with a 240-character
  instruction excerpt (`app/lib/engineering/execution-grant.ts:88, :165`; `app/lib/execution-grant/mint.ts:181`; the excerpt is the message
  whitespace-collapsed and cut, `app/lib/engineering/explicit-request.ts:69`, with no redaction call in those modules) and a settlement marked
  `attestation: "browser-attested"` (`execution-grant.ts:190-203`). OD-111: kept "until an owner-decided purge exists (nothing in the
  substrate purges)" (`OWNER_DECISIONS.md:1096-1098`). The only implemented purge is the distributor offer cache (reader 1,
  `app/lib/distributors/cache.ts:222-248`). Since `50fe156`: B23-B2's durable `mfg.provider-exchange.v1` (`app/lib/manufacturing-providers/exchange-ledger.ts:43`), composed into `POST /api/pcb/provider-exchange` (`route.ts:62`) to keep each attempt's plan id and digest and its committer (`committedBy`, `exchange-ledger.ts:62`), has no purge, though nothing writes it at `dfd51e3` (it is written only past admission and a transfer descriptor, and no provider is admitted; `b23-b-exchange-ledger` cases 10, 21); B22-C's `computation.evidence.v1` (`app/lib/computation/evidence-store.ts:35`) is bound to no route. CONFIRMED
- **What is not traced.** At least 18 route files (22 untraced paths in B23-A2's derived `MODEL_EGRESS_PATHS` at `dfd51e3`; on those 18 a provider failure reaches only `console.error`, `app/lib/llm/errors.ts:188-194`) call a model with no durable trace, usage or error record (section 0), among them
  `app/api/spice/ai/route.ts`, whose only audit is the browser-local `aiAuditLog` holding the model's `rationale` and the approved
  `changeSet` with no bound or entry cap (`app/lib/spice/types.ts:458-468, :482`; `app/lib/spice/project.ts:318-332`; localStorage,
  `app/lib/spice/persistence.ts:6, :47-49`). Tier 2 approvals and their transactions are recorded in the browser IndexedDB journal, not on a
  server record tied to the run (reader 3, `app/lib/engineering/approved-mutation-journal.ts:1-50`). Refused tool calls on the single-agent
  path are untraced except `unknown_tool` (reader 3, `app/lib/agent/loop.ts:405-416`). A provider failure is logged with a provider-authored
  message cut to 300 characters and whitespace-collapsed, not run through the redactor (`app/lib/llm/errors.ts:180-194`). MCP request and read
  traces and B05 read traces live in per-process rings of 1,000 and 500 (reader 3). CONFIRMED (re-read lines), reader 3 (rings)
- **Hidden reasoning is kept out** of every stored artifact: steps record model, usage and tool-call count only; continuation state is opaque
  and transient; the capsule, redaction authority and orchestration contracts refuse reasoning and thinking key names (reader 3, eleven
  citations in `app/lib/agent`). RECORDED (reader 3); no reader found a counterexample.
- **Replay cannot mutate.** The B11 engine replays authored capsules through the real registry, loop and gateway with a scripted adapter and
  a gateway built with only a clock, so a granted execution refuses `execution_unavailable` (reader 3, `app/lib/agent/replay-capsule.ts:543-652`);
  durable commits replayed under the same idempotency key write nothing; the MCP replay cache returns `replayed` reads; an AI undo or redo
  needs a newly minted grant (reader 3). Live runs keep digests only, so no immutable snapshot of a production run exists to replay
  (`trace.ts:11-13`). CONFIRMED (`trace.ts`), reader 3 (the rest)

### 2.6 Reliability, performance and accessibility (B24-D)

- **Harness.** One Desktop Chrome project, one worker, retries 0, 180 s per test (`playwright.config.ts:22-26, :39`); the orchestration
  config starts its own server on its own port with the flag on (`reuseExistingServer: false`, `playwright.orchestration.config.ts:38-51`, `:42`); the browser job's 30-minute limit
  (`deterministic-manufacturing.yml:319` at `dfd51e3`) is governed by OD-30, "split it if a run comes within five minutes of the limit"
  (`OWNER_DECISIONS.md:104-108`), measured by hand: 462 s, 951 s, 402 s and 441 s (`EXECUTION_LEDGER.md:3298, :3356-3357, :3564-3565,
  :3684-3685`); the whole CI job ran 19m56s on `85439e7` and 19m50s on `849a933` (`EXECUTION_LEDGER.md:4261, :4281`). CONFIRMED
- **Latency.** No browser spec times a view, read, edit or workflow; page time is frozen by the fixture clock (reader 4,
  `e2e/prompt-to-gerber.spec.ts:50-56`). The only reversible-edit numbers are a 2026-07-17 stage-10 run (commit p50 13.38 ms, p95 16.11 ms)
  whose script runs in no workflow (reader 4, `artifacts/stage-10/foundation-evidence.json`; `package.json:35`). Complex workflows have
  ceilings only (qualify 170 s in replay, the DAG's 300 s cap; reader 4). Traces keep run-level `startedAt`/`endedAt` only (`trace.ts:251-252`).
  CONFIRMED
- **Streaming and budgets.** One terminal event per run and `stream_cut` on a cut stream are browser-gated (reader 4,
  `e2e/agent-execution.spec.ts:626-690`); no first-event timeout, idle timeout or keepalive exists (`git grep heartbeat|keepalive` over
  `app/api/chat`, `app/lib/agent`, `app/lib/llm`, empty). Budgets: 6 steps, 10 tool calls, 15 s per tool, 120 s per run, 2 identical calls
  (`app/lib/agent/contracts.ts:181-188`). CONFIRMED
- **Memory and large boards.** No memory measurement anywhere: the only `heapUsed` is a sanity check (`app/lib/computation/__tests__/b22-b-bounded-host.test.ts:145`, `b4c7be7`), and B22's worker heap bound (`engine-host.ts:197`) and runtime-profile `memoryMiB` are limits, not measurements. A placed golden board's
  `board-inspect` result is 40,410 characters, under the 60,000 budget; both recorded ROUTED boards (70,173 and 72,453) exceed it, so "the
  model would get no board facts" from `board-inspect` on any routed board (the narrow `sirkit.pcb.via-inspect` and `sirkit.pcb.mechanical-inspect` reads remain, `agent-exposure.ts:37-38`) (`app/lib/agent/__tests__/b18-e-board-inspect-budget.test.ts:1-12, :29-43`, in CI
  `:114`). CONFIRMED
- **Multi-tab and recovery.** No `BroadcastChannel`, storage-event listener or `navigator.locks` (`git grep`); cross-tab safety is
  IndexedDB compare-and-set proven with two fake-indexeddb connections (reader 4, `b12-5-journal-atomicity.test.ts:381-395`, in CI through
  `stage10:test`); every browser spec opens one page (reader 4). Refresh recovery is browser-gated; crash recovery is unit-level crash
  injection only; the only server-restart cases are in-process simulations for the provider-exchange record (`b23-b-exchange-ledger` cases 5, 16, 22, 25; `0cd3f59`), none for the editor or the e2e server, whose stores are in memory (reader 4). CONFIRMED (grep), reader 4
- **Process cleanup.** At `50fe156` only the direct child was killed: `child.kill()` in `/api/simulate`, the smoke test and the SPICE worker
  (`app/api/simulate/route.ts:268-274`; `app/api/spice/models/smoke-test/route.ts:66`; `app/lib/spice/server/worker.ts:74, :114, :128, :133`),
  `SIGKILL` for FreeRouting and kicad-cli (`app/lib/pcb/autoroute/runner.ts:167, :172`; `app/lib/pcb/fab/kicad-cli-runner.ts:98`), the last two still direct-child at `dfd51e3`. B22-A3 (`e483838`)
  delivered tree kill (`taskkill /T /F` on win32, process-group `SIGKILL` on POSIX) and `kill_unconfirmed` for ngspice only: the three ngspice callers now run through the diagnostic runner's `runDiagnosticNgspice` (`app/lib/computation/diagnostic-runner.ts:632`), whose tree kill is `:401-431` and which reports `kill_unconfirmed` after a bounded wait (`:560`; OD-145, `OWNER_DECISIONS.md:1768-1787`; D22-9 closed in part, B22 `final-verdict.md:100`). CONFIRMED
- **Accessibility.** No axe, a11y or lighthouse dependency (`package.json`); two `aria-live` regions in the whole app, the identity banner and
  the autonomy notice (`app/components/auth/LocalDevIdentityBanner.tsx:36`; `app/components/chat/AutonomyModeControl.tsx:158`); a provider
  failure renders `role="alert"` (`app/page.tsx:6851`); the chat transcript has no live region; the PCB canvas host is a bare `div`
  (`app/components/pcb/PcbCanvas.tsx:38`). The B17-A inventory checks classification and non-silence, not accessible names (reader 4; 195
  of 631 rows at `dfd51e3` (628 at `50fe156`) have no static label). Approval cards use the Base UI dialog and are browser-proven modal; the BOM dialogs are hand-rolled
  (reader 4, INFERRED no focus trap). CONFIRMED (re-read lines), reader 4
- **Responsive.** One Desktop Chrome project, no viewport emulation in any spec (`git grep setViewportSize|devices\[` over `e2e`,
  `e2e-orchestration`, empty), one responsive class in the page (`app/page.tsx:1982`, `sm:inline`). CONFIRMED
- **Thresholds.** `vitest.config.ts` sets no `testTimeout` (`:13-18`, default 5 s); about 40 CI-gated real-clock bounds (about 45 at `dfd51e3`), the tightest
  700 ms (`app/lib/mcp/__tests__/b20-a1-http-transport.test.ts:866-876`), and about 15 tight ones outside CI (reader 4); load-induced
  timeouts are on record (reader 4, `EXECUTION_LEDGER.md:249, :2566-2569`); since then slow cases have hit vitest's 5 s default or its RPC limit (`:4288`, `:4393-4398`; on the GitHub runner `:4619`), and the runner's `:4461` timeout was a lost abort fixed in `f0e7bae`, not load. A stable method exists and is unused in CI: `scripts/route-bench.ts`
  (20 warm-ups, sorted samples, p50/p95 budgets that throw, `:34-45, :86-87`) and the stage-09 `REGRESSION_BUDGETS` with a noise band
  (`regression-policy.ts:53-60`; unit-tested in `benchmark-core` on synthetic results only, `stage-09-benchmark-core.test.ts:181-183`, `benchmark.yml:34`). CONFIRMED

### 2.7 Live and physical gates (B24-E)

| Item (runbook) | What exists at HEAD | Names the run needs (names only) | Resource supplied? | State today |
|---|---|---|---|---|
| 1 live OpenAI + Anthropic (`:1115`) | the record-only command (one provider, 40 requests, 4 of 12 cases, never run); `assist-live` (INFERRED broken) | `SIRKIT_LIVE_ORCHESTRATION_EVALUATION`, `SIRKIT_LIVE_ORCHESTRATION_PROVIDER`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `PCB_ASSIST_LIVE` | No: OpenAI answered 429 no credits for both keys on 2026-09-24, Anthropic unrecorded (`LIVE_BLOCKERS.md:15`; `EXECUTION_LEDGER.md:2508-2509`) | BLOCKED-LIVE-QUALIFICATION (LB-2 is labelled UNKNOWN; LB-7, LB-9) |
| 2 production-auth browser E2E (`:1116`) | a 9-test HTTP matrix with fetch and a cookie jar, not a browser (`b16-1b-live-qualification.test.ts:86-96`); every Playwright run is `local_dev` | `SIRKIT_LIVE_AUTH_QUALIFICATION`, `SIRKIT_AUTH_QUALIFICATION_{PROJECT,BASE_URL,EMAIL,PASSWORD,PROJECT_ID,TENANT_ID,DATABASE_URL}`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SIRKIT_EXPECTED_ORIGIN` | No isolated project or account (OD-6, `OWNER_DECISIONS.md:12`) | BLOCKED-LIVE-QUALIFICATION (LB-1); no browser spec exists |
| 3 live distributors, no purchase (`:1117`) | `b19-e-live-contract.test.ts` (NE555P on DigiKey and Octopart), opt-in; no purchase path (cart routes export CSV; `b19-e-no-purchase-tripwire.test.ts`) | `SIRKIT_LIVE_ACQUISITION_CONTRACT`, `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET`, `OCTOPART_API_KEY` or `NEXAR_API_KEY` | No vendor credentials (`artifacts/ai-control-plane-b19/final-verdict.md:27`) | BLOCKED-LIVE-QUALIFICATION per B19; no LB row |
| 4 sandboxed simulator/router (`:1118`) | runner throws `CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX` (`app/lib/model-simulation/safe-execution.ts:27-28`), execute refuses 403, 400 or 409 before its retained 501 (`a269e7a`); diagnostic ngspice opt-in (`SPICE_WORKER_LIVE`); FreeRouting record/live switches; kicad-cli oracle on `KICAD_CLI` (INFERRED broken) | `SIRKIT_NGSPICE_INSTALL_ROOT`, `SIRKIT_NGSPICE_INSTALL_SHA256`, `SIRKIT_B22_LIVE_RUNNER`, `SIRKIT_NGSPICE_OCI_IMAGE`, `SIRKIT_OCI_CLI_PATH`, `SIRKIT_OCI_CLI_SHA256`, `SIRKIT_KICAD_CLI_INSTALL_SHA256`, `SIRKIT_FREEROUTING_INSTALL_SHA256`, `FREEROUTING_JAR`, `FREEROUTING_JAVA`, `JAVA_HOME`, `KICAD_CLI`, `SIRKIT_B16_1C_RECORD_ROUTES`, `SIRKIT_FIXTURE_ROUTER` | No qualified OCI platform or declared host (B22 discovery D22-1) | BLOCKED-LIVE-QUALIFICATION (LB-3, LB-8; LB-10 recorded, `LIVE_BLOCKERS.md:16`) |
| 5 DFM/quote staging (`:1119`) | B23's provider registry (nine rows, every DFM/quote operation refused `provider_not_admitted`, `79fa18b`) and the fake-backed `POST /api/pcb/provider-exchange` flow (`0c78e93`, `0cd3f59`, `8bca09e`); every credential reference is empty, and no code or suite reads `SIRKIT_B23_LIVE_PROVIDER` (records name it, and `b23-c-ordering-disabled.test.tsx:108` passes it only as a negative case that enables nothing) | per B23 OD-160 | No account | BLOCKED-LIVE-QUALIFICATION (LB-11 recorded, `LIVE_BLOCKERS.md:17`; ordering LB-12, `:18`) |
| 6 deterministic 555 release; fabricate only with separate approval (`:1120`) | release produced in CI under the frozen clock, fake provider, recorded router; pinned `mfg-release-45b3b7efbc85dc3a8ecd233c906384cd`, archive sha256 `997664c0...6dcc` (`app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities.json:3, :15-17`); in-repo verifier plus a local-only Python reader | none (deterministic) | Fabrication approval: none recorded; OD-8 authorises no live purchase (`OWNER_DECISIONS.md:14`) | Release: deterministic CI evidence; fabrication BLOCKED-LIVE-QUALIFICATION (LB-5) |
| 7 inspection and functional test evidence (`:1121`) | no store or route; `manufacturing.assembled-release` is `missing`, "explicitly blocked" (`app/lib/engineering/action-registry.ts:118`); the CD-11/12/13 measurement and claim functions have no production caller (`git grep`); B23-D delivered `physical-evidence.ts` (eight kinds, validators, a review port nothing wires, eligibility blocked for every input; OD-175, `OWNER_DECISIONS.md:2431`) but no store, route, tool or form | none defined | No boards, equipment or operator | BLOCKED-LIVE-QUALIFICATION (LB-5, labelled "not attempted") |

- **Release repeatability.** The rule-profile evidence was retrieved 2026-09-09 and is trusted 365 days (`app/lib/pcb/fab/rule-profile.ts:27-28,
  :45-48`); the release route refuses evidence older than 366 days (`app/api/pcb/release/route.ts:50-51, :185-189`, inside the exported `revalidateReleaseAuthority`, `:145`, which the provider exchange also runs): a real-clock release
  stops working around 2027-09-09 unless the profile is re-retrieved. CONFIRMED
- **The register's vocabulary.** LB-2 "UNKNOWN", LB-3 "local-only", LB-4 "dead external resource", LB-5 "not attempted"; the others
  BLOCKED-LIVE-QUALIFICATION, LB-10..LB-12 included (`LIVE_BLOCKERS.md:7-18`); `PROGRAM_STATE.json` lists eight (`:12-21`). No row exists for the distributor
  contract, a live external MCP server (OD-102, `OWNER_DECISIONS.md:820-824`, reader 5), staging/production deployment, the database
  platform (RLS exposure, backup, failover) or the kicad-cli oracle. CONFIRMED
- **Vacuous live passes.** The distributor contract returns with a passing assertion when a source is not admitted
  (`app/lib/acquisition/__tests__/b19-e-live-contract.test.ts:34-37`); the live-auth membership canary returns when its database URL is
  absent (`b16-1b-live-qualification.test.ts:196`). CONFIRMED

### 2.8 Inputs to the final verdict (B24-F)

- **Generators.** Twenty-one `scripts/generate-*.ts` (B23-A1 added `generate-b23-provider-registry.ts`) and two `scripts/gen-*.ts`; no `package.json` script runs any of them; no regenerate-all
  or drift command; the ledger's "17 generators with zero drift" names no list (`EXECUTION_LEDGER.md:2488`). CONFIRMED. Byte pins in CI:
  the B01 matrix, route coverage and fingerprint, B04, B05 read fixtures, B06/B07 fixtures, B17 inventory (engineering directory), B19 source
  registry, B20 manifests, parity and server registry, B21 matrix and pins, the B23 provider registry CSV (`b23-a-provider-registry.test.ts:557-560`), and three B16.0 route matrices
  (`app/lib/auth/__tests__/b20-b2-route-matrices-pinned.test.ts:9-31`, listed at `deterministic-manufacturing.yml:138`). Pins outside every
  CI job: `exact-route-authorization-policy.csv` (`app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts:107-111`), the route resource
  classification (`b16-0-2-gates.test.ts:266-270`; its bytes are also pinned in CI since `da36d51`, `b23-a-route-vocabulary.test.ts:667`), `auth-route-coverage.csv`, the raw-route baseline (`b16-0-8-migration-ratchet`), B09, B10
  and B11 artifacts (except B09's `provider-schema-parity.json`, byte-pinned in CI at `b20-c1-three-way-parity.test.ts:326`, and B11's `replay-trace-pins.json`, sha256-pinned in CI at `b21-f-evaluation.test.ts:530`). Unpinned outputs: three B05 files, B09's normalized-loop fixtures and the manifest CSV/JSON (content checks only), the
  demo fixtures and the silk font (reader 7). CONFIRMED (CI admission), reader 7 (unpinned outputs)
- **Hand-written maps are stale.** The B16.1C map: "153 route methods (150 canonical wrappers, 3 factories, 0 raw), the 12 agent-exposed
  tools" (`artifacts/ai-control-plane-b16-1c/current-prompt-to-gerber-map.md:18`); the B18 permission page at 155 methods, 97 records, 143
  routes, 573/58 (`artifacts/ai-control-plane-b18/permission-tiers.md:30, :37`, pinned by no test); the B16 closeout database proof at "29
  (`0000`…`0028`)" migrations (`artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md:14, :16-17`); the `externalProcess`
  rows were wrong for three routes until B22-A2 corrected them (`c037627`, D22-18; pinned by `b22-a2-process-census` in CI). CONFIRMED
- **No threat-model register.** No closure register exists (`git grep`). "Threat model" appears in a B03 pointer to B03.1's `security-boundary.md`
  (`artifacts/ai-control-plane-b03/revision-history-contract.md:120-121`), in the CD-10 stage report's `## Threat model` (`docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md:55`) and, since `c037627` and `c9fbbb0`, in B22's `threat-model.md` (threats, controls and tests `:117`; residual risk `:140`) and `adversarial-matrix.md` (residuals `:174`); closure state lives in per-chapter tables with different columns
  (F18, B19 follow-ups and matrix, D20, D21, D22, D23; reader 7). CONFIRMED
- **Owner-decision records.** The status column exists only in the first table (`OWNER_DECISIONS.md:5-23`); OD-5 still says "open (scheduled
  B16-B)" (`:11`) although B16-B delivered the migration CLI; OD-19 says "54 B18 commits used the owner's other address" (`:31-35`) while
  `git log --no-merges --format=%ae` shows 11 more in B17's range (`82ecbf8..804a08d`: 11 of 14) and 54 in B18's; every commit since
  `5a59a1f` uses `dandidesta82@gmail.com` under `--no-merges` (109 of 109 at `dfd51e3`), the five GitHub PR merge commits #9-#13 (`102dd27`, `6fd5a7b`, `e109d76`, `d0d2ec8`, `43cb1b0`) carrying a GitHub noreply author; no commit since `62ea4a6^` carries a co-author trailer. Every OD-134..OD-159 is now a register heading (B22 added OD-134..OD-145, OD-147, OD-149 and OD-154..OD-159 since `50fe156`), and
  B23 has recorded OD-160..OD-188 (OD-178 and OD-188 in its closeout's first commit, `:2536`, `:2545`, and OD-160 in its second, `:2560`); the highest heading is OD-188 (`:2545`; OD-153 is at `:1696`). CONFIRMED
- **Branches.** Unmerged into main `43cb1b0` (where `chapter/b22-sandboxed-computation` merged as PR #13): `chapter/b23-external-manufacturing` (pending its closeout), `codex/reconstruct-b06-b16-history` (162 commits), `fix/assignment-queue-selection-reset`,
  `fix/b16-0-revoked-member-cold-import-timeout`, `fix/b18-d-repair-reapply-after-undo`, `fix/b21-page-react-hooks-refs` (local and on
  origin), and `integration/ai-control-plane-b16-0` (2 local commits not in `dfd51e3`; `origin/integration/ai-control-plane-b16-0` at `6956e74` is contained) (`git branch -a --no-merged main`). `app/page.tsx` carries 14 react-hooks
  eslint errors whose fix sits on the unmerged branch, and "CI runs no eslint" (B21 verdict `:133-135`). CONFIRMED
- **The twenty scenarios as the records stand** (reader 6's map; the suites and lines it names; INFERRED as a mapping, the deviations
  CONFIRMED where cited):

| # | Standing | Evidence or reason |
|---|---|---|
| 1 inspect | demonstrated offline and in the browser | b17-d view commands, b20-b3 reads; `e2e/semantic-editor.spec.ts` |
| 2 schematic components by tier | in part: human commands; the agent proposes; schematic Tier 1 execution barred | b06, b14, b18-e-scenario-4; OD-15 (`OWNER_DECISIONS.md:21`) |
| 3 wires, nets, labels, power symbols | in part: human only; the agent can neither execute nor propose wires or labels; no power/ground test | OD-16 (`OWNER_DECISIONS.md:22`); section 2.4 |
| 4 exact symbols, footprints, pin-pad | demonstrated (fake vendors); RC03 refuses unconnected pins | b19-e adopt, acceptance pipeline; OD-10 |
| 5 move, rotate, lock | move/rotate granted; lock human-only | b18-c-rotate-arrange-e2e; registry `pcb.protection` |
| 6 auto-placement | demonstrated on recordings | b17-e candidates, b18-e-scenario-5 |
| 7 tracks, vias, zones, keepouts, dimensions, text, outline | in part: dimension and silkscreen granted; vias and tracks proposal-only; board `texts[]` uncovered | OD-13 (`OWNER_DECISIONS.md:18`) |
| 8 change all vias on a net | by refusal: padstack-bound on real boards, reachable only by a human fork; no browser board with vias | `app/lib/engineering/__tests__/b18-e-scenario-2.test.tsx:130, :142`; LB-8 |
| 9 selected-net and full-board routing | on committed recordings; live router local-only | LB-3 |
| 10 ERC/DRC/parity/readiness/release checks | demonstrated deterministically | acceptance pipeline, `e2e/prompt-to-gerber.spec.ts` |
| 11 3D focus J1 without engineering change | demonstrated | b17-c, `e2e/semantic-editor.spec.ts` |
| 12 recovery (refresh, cancel, provider, role, conflict, process) | in part: process-failure cleanup delivered by B22-A3 for the diagnostic runner only (`e483838`, OD-145; FreeRouting and kicad-cli still direct-child); revocation proven in integration only | OD-27 (reader 6) |
| 13 undo/redo without divergent history | demonstrated | b18-c-undo-redo, browser reload/Redo |
| 14 external observations not authority | demonstrated (fake vendors) | b19 quarantine suites; B23-B3's `b23-b-observation`, `b23-b-no-auto-accept`, `b23-b-stale-quote` |
| 15 approved external MCP read | fake servers only: the registry is empty and no live contract exists | OD-48, OD-102 |
| 16 Sirkit read/propose over MCP | reads only: propose withheld | OD-82, OD-87; B20 PARTIAL |
| 17 timer replacement with deterministic disagreement resolution | by recorded deviation: disagreement escalates, never resolved to a winner | B21 verdict `:89-95` |
| 18 approved sandboxed simulation | BLOCKED: B22 PARTIAL with the production runner BLOCKED (LB-10); the execute route refuses 403/400/409 before its retained 501 | B22 `final-verdict.md:3, :17`; OD-134 |
| 19 deterministic package the AI cannot release | demonstrated | release-human-only; b16-0-15 gate; `b23-d-assembled-release-blocked` (OD-177) |
| 20 refuse purchase/order | by refusal: ordering visibly disabled, the two-person purchase authorization and the order contract proven offline, no port wired (LB-12) | b19-e-no-purchase-tripwire; b18-e-scenario-8; `ordering-boundary.md`; OD-170..OD-172; `b23-a-no-order-structural`, `b23-c-*` |

---

## 3. What B24 reuses

| Requirement | Existing mechanism | file:line | Gap |
|---|---|---|---|
| A: environments | `resolveAuthMode`, `isProductionRuntime`, `localDevAllowed`, `sensitiveOperationsBlocker` | `app/lib/auth/mode.ts:22-95` | Two states only; no profile, no production-mode CI run (D24-1) |
| A: migration/rollback | runner, manifest, ledger, PGlite `disposable-postgres`, the database-delivery job | `app/lib/db/migrations/runner.ts:1-54`; `scripts/db-migrate.ts:5-99`; `deterministic-manufacturing.yml:272-302` | No down path (D24-2) |
| A: test isolation | `databaseQualification()`, the `TARGET_NOT_EMPTY` guard | `app/lib/db/test-qualification.ts` (reader); `b16-b-postgres-qualification.test.ts:36` | Guard in one suite only (D24-12) |
| A: headers | `headers()` in `next.config.ts`; the served-header spec | `next.config.ts:9-11`; `e2e/security-headers.spec.ts:10-21` | img-src only (D24-5) |
| A: origin/redirect | server-owned expected origin; `safeRedirectPath` | `expected-origin.ts:16-36`; `request-security.ts:76-89` (reader) | Supabase-side list unrecorded (D24-6) |
| A: rate limits | fixed-window limiter; LLM admission and breaker | `inbound-limits.ts:1-25`; `admission-control.ts:324-350`; B23-B2's manufacturing-provider meter `:472-521` (agent share 0) | Not on public paid routes, sign-in or single-agent chat (D24-8) |
| A: route census | `route-policy.ts`, the resource classification and its violation census | `route-policy.ts:62-85`; `route-resource-classification.ts:187, :210-215`; B23-A2's `PUBLIC_MODEL_EGRESS` `:137-142`, `modelEgress` `:201`, gate `:238-247` | `pub()` cannot declare credit; `expensive` mis-set; the egress census sees the two public model-egress routes only as reviewed exceptions (D24-8) |
| A: flags | exact-"1" and remove-only patterns | `orchestration-runtime.ts:39-44`; `app/lib/mcp/rollout.ts:12-26` (reader) | No sandbox flag, no inventory; `SIRKIT_NAMED_COMPUTATIONS`, `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS` and `SIRKIT_ORDERING_DISABLED` exist since B22-B and B23 (D24-11) |
| A: config versioning | `ToolDescriptor.version`, registry versions, `registryDigest` on the trace | `trace.ts:248`; reader 1 | Provider/model/effort/role table unversioned; B23's `PROVIDER_REGISTRY_VERSION` 1.0.0 and B22-A2's runtime profiles are versioned (D24-10) |
| B: catalog container | stage-09 statuses, result store, regression budgets, `hardware_evidence` oracle kind | `app/lib/benchmark/*` (reader 2); `regression-policy.ts:53-88` | No class dimension; blocked statuses can pass (D24-14) |
| B: deterministic engine | B11 replay and evaluation (checks, capsule v4); B21-F case table and generator | `evaluation.ts:65-200` (reader); `_f-cases.ts:34-78`; `scripts/generate-b21-artifacts.ts` | No class field; hash-pinned files (D24-14) |
| B: live harness | bounded record-only command (shared counter, retries 0) | `scripts/run-b21-live-orchestration-evaluation.ts:32-98` | One provider, never run, no money cap (D24-18) |
| B: CI admission | `CHAPTERS` and the job-scope guard | `b19-e-ci-job-scope.test.ts:52-55` | Pre-B19 suites outside CI (D24-15) |
| C: durable sink | `AgentTraceSink`, `setAgentTraceSinkFactory`, validate-before-persist | `trace-recorder.ts:86-130` (reader for `:86-107`) | Not bound (D24-20) |
| C: durable store pattern | `DurableOrchestrationTraceStore` (CAS append, digest-verified history) | `app/lib/agent/orchestration/trace-attribution.ts:252-322` (reader) | Write-only; no retention; B23-B2's route-wired, PGlite-tested `mfg.provider-exchange.v1` (`exchange-ledger.ts:43`) is a nearer template (D24-13, D24-26) |
| C: redaction | `sanitizeTraceText`, secret-shape validators | `app/lib/agent/redaction.ts:19-193` (reader); `trace.ts:136-194` | Not applied to grant excerpt, SPICE log, provider error log (D24-25) |
| C: cost arithmetic | CD-13 resource accounting (`costMicrounits`) | `app/lib/full-flow/budget.ts:4-11` (reader) | Not used by the chat path; no price table (D24-23) |
| D: benchmark method | `route-bench.ts` (warm-ups, percentiles); stage-10 evidence format; work counting | `scripts/route-bench.ts:34-87`; `b20-a4-observation-normalizer.test.ts:356-369` (reader) | Not in CI (D24-27, D24-28) |
| D: browser faults | stream-cut injection; reload helper | `e2e/agent-execution.spec.ts:626-690` (reader) | No first-event timing (D24-27) |
| D: multi-tab | fake-indexeddb two-connection harness | `b12-5-journal-atomicity.test.ts:60-122, :381-395` (reader) | No real two-page spec (D24-30) |
| D: a11y gate | B17-A control-surface scanner and inventory | `control-surface.ts:56, :173`; `b17-a-control-inventory.test.ts:31-96` (reader) | No accessible-name rule (D24-32) |
| E: live gates | B16-1B matrix, DB gate, B19-E contract, B21 command | section 2.7 | No browser auth spec; vacuous passes (D24-34, D24-19) |
| E: register | `LIVE_BLOCKERS.md` table | `LIVE_BLOCKERS.md:5-18` | Mixed vocabulary, stale LB-4 (D24-33) |
| F: maps | B01, B04, B09, B17, B20 generators; `permission-tiers.ts` decision functions; B21 graph data | `scripts/*`; `app/lib/engineering/permission-tiers.ts` (reader); `router.ts`, `scheduler.ts`, `role-tools.ts` (reader) | No join, no permission or graph render (D24-37) |
| F: statements | the B21 closeout statement tripwire | `app/lib/agent/orchestration/__tests__/b21-closeout-statements.test.ts:321-456` (reader) | B24 needs its own (no live or physical over-claim); B22's `app/lib/computation/__tests__/b22-closeout-statements.test.ts` is a second precedent |
| F: numeric report fields | census, counts and families pinned | section 1.3 | Moved by B22-B and B23: census 166/163/3/0, tools 47/36/9/27, unchanged by B23's closeout (its final validation run at `b6c6b0d`) |

---

## 4. Candidate defects and gaps

Severity: high = a B24 requirement is unmet and its absence carries a security, data or truth risk in production or in the final report;
medium = a requirement unmet or partly met without that risk, or one needing a contract change; low = a recordable limit or hygiene.
"Closes" names the increment in section 7 or an owner decision. Merged from the readers' 82 gap candidates; each defect keeps its sources.

### B24-A - environments and deployment

**D24-1 - The code knows two runtime states and CI has never built or run the production one.** Requirement: B24-A `:1029`. Finding:
production is only `NODE_ENV === "production"` (`app/lib/auth/mode.ts:22-24`); no staging, CI or preview profile exists; no deployment
file is committed (`git ls-files`); CI runs no `next build` and every browser run is `next dev` with `local_dev` auth and the fixture runtime
(`playwright.config.ts:41, :49-51`; both workflows read in full), so a production build, production-auth wiring, the fail-closed blocker
and the expected-origin requirement have never run together in CI. Severity high. **CONFIRMED**. Closes: B24-A1 offline (an explicit
environment profile and a production-mode build-and-start smoke job, OD-190); staging and production BLOCKED-LIVE-QUALIFICATION (LB-13).
Sources: G-A2, G-A3 (part).
- [B24-A1, 2026-10-06] D24-1: offline closed by B24-A1 for the deployment profile and its blocker - `SIRKIT_DEPLOYMENT_ENV` (development, ci, staging, production, exact) and `productionServingBlocker` (the unchanged `sensitiveOperationsBlocker`, then a serving profile, then the expected origin, reads included) at both callers (`b24-a1-environment-profile`); the production-mode half is PROPOSED: the `production-smoke` CI job (`next build`, `next start`, fail-closed probes) is written and its shape pinned (`b24-a1-environment-profile` 11) but has not run, and it closes that half offline only when the lead's local production-mode run and its first CI run are green (a failing first build is D24-1's own counterexample, recorded verbatim, never admitted red); staging and production BLOCKED-LIVE-QUALIFICATION (LB-13).
- [B24-A1, 2026-10-06] D24-1: the production-mode half closed offline - the lead's local production-mode run (next build 234 s, next start 2 s, engine-worker.mjs emitted as a hashed asset, sixteen probe checks passed) and the first CI run of `production-smoke` on `1b2c08c` (run 37499322603: job 2m16s, next build 99 s, next start 2 s, engine-worker.mjs emitted, every probe answered as pinned) are green; environments-and-deployment.md section 6.

**D24-2 - No supported rollback.** Requirement: B24-A `:1031`. Finding: the runner and CLI apply forward only (`scripts/db-migrate.ts:5-15`;
`runner.ts:49-54`); the two DOWN sections are commented SQL (`drizzle/0027_project_membership.sql:57-62`; `0028_bom_project_ownership.sql:62-72`),
the other 29 files have none, and 0027's header points at its commented section as the rollback (`0027:7`). Severity high. **CONFIRMED**.
Closes: B24-A4 (OD-193) offline on PGlite; a rollback on a real server BLOCKED-LIVE-QUALIFICATION (LB-14). Sources: G-A1, G7-5 (rollback).
- [B24-A4, 2026-10-08] D24-2: closed offline by B24-A4.

**D24-3 - One all-powerful database role; RLS on 1 of 143 tables; no grants.** Requirement: B24-A `:1033`. Finding: every server query uses
one `DATABASE_URL` connection (`app/lib/db/client.ts:20-48`), which bypasses RLS by INFERENCE (the connecting role owns the tables with no FORCE; `0027:40-41` attributes the bypass to a service-role key the code never reads, `:52-55` to the trusted server path); the only RLS
and policy is `project_members` (`0027:44, :47-50`); no `GRANT`, `REVOKE` or `CREATE ROLE` in `drizzle/`; TLS is required only for URLs
containing `supabase.` (`client.ts:33`; also `app/lib/db/migrations/postgres-executor.ts:32` and `scripts/backfill-mpn-and-generics.ts:77`). With a browser-visible publishable key (`mode.ts:65`), the other 142 tables are reachable if the
project's Data API exposes `public` with default grants (INFERRED; the setting is recorded nowhere, **UNKNOWN**). Severity high.
**CONFIRMED** (code), **INFERRED** (exposure). Closes: B24-A4 (OD-192) offline; the real project's exposure and roles
BLOCKED-LIVE-QUALIFICATION (LB-14). Sources: G-A4, reader 1 fact (TLS).
- [B24-A4, 2026-10-08] D24-3: closed offline by B24-A4.

**D24-4 - Secrets are single-valued plain environment variables with no rotation window, no CI scan and an incomplete example file.**
Requirement: B24-A `:1034`; global `:152-153`, `:168`. Finding: the worker secret, KiCad token and MCP signing key each accept exactly one
value (`worker-principal.ts:49-55`; `server-auth.ts:4-14`; `mcp-bearer.ts:39-40`); changing one cuts every holder at once; no vault or
secret-manager code (reader 1); no CI secret-scan step (section 1.3; the PEM-marker scan is a manual lead step); `.env.example` omits
`SIRKIT_EXPECTED_ORIGIN` and `KICAD_HTTP_LIBRARY_TOKEN` as declarations (comment only, `:77-78`) and the distributor key names (reader 1).
Severity medium. **CONFIRMED**. Closes: B24-A2 (OD-195). Sources: G-A5, S6-G7 (scan).
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`: `worker-principal.ts:49-55`, `server-auth.ts:4-14` and `mcp-bearer.ts:39-40` (single read at `:182-183`) hold, and there is still no vault, rotation or CI secret scan; the `.env.example` comment moved to `:77-78` (B22-A3 `e483838`). B22 and B23 widened the gap: ten names their code reads are not declared in `.env.example` (`SIRKIT_NAMED_COMPUTATIONS`, the kicad-cli, FreeRouting and OCI runtime-profile pins, `SIRKIT_NGSPICE_OCI_IMAGE`, `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS` and `SIRKIT_ORDERING_DISABLED`), and B23 added two single-value secret seams, neither holding a value today, that OD-195 must name or exclude: the webhook HMAC secret (`webhook-verification.ts:74`), used only by the order contract that no composition root wires, and the provider credential header (`provider-egress.ts:198-201`), reached by `POST /api/pcb/provider-exchange` only past admission, with `PROVIDER_TRANSFER_DESCRIPTORS` empty (`provider-egress.ts:69`).
- [B24-A2, 2026-10-06] D24-4: closed offline by B24-A2 - the worker secret, the KiCad library token and the MCP signing key each take a `*_PREVIOUS` value that only verifies (both compares in constant time before one answer; never signing, minting or configuring; the MCP previous key within the current key's bounds and separation), with the procedure written for a planned rotation (at most seven days; the MCP key at least 3,630 s) and for a suspected leak (no previous value, the outage accepted) (`b24-a2-secret-rotation`); the environment-name census (80 rows, nine closed classes) with `.env.example` declaring every name of a declared class exactly once (`b24-a2-env-names`); the secret scan (closed rules, a reviewed eight-line allowlist, tree, `--staged` and `--history` modes) in the `secret-scan` CI job on the tree and on every commit of a pull request, PROPOSED until its first CI run (`b24-a2-secret-scan`); B23's webhook secret and provider credential header recorded as single-valued (OD-195); rotating real deployed secrets BLOCKED-LIVE-QUALIFICATION (LB-13).

**D24-5 - The only security header is an image source policy.** Requirement: B24-A `:1035`. Finding: `img-src 'self' data: blob:` only
(`next.config.ts:9-11`); no `frame-ancestors` or `X-Frame-Options`, so every page, the Tier 1 grant confirmation card and the Tier 2 review
dialogs included, can be framed (INFERRED clickjacking exposure); no HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `script-src`
or `connect-src`; `X-Powered-By` not disabled (INFERRED). Header presence can be proven offline in the existing spec; HSTS and TLS need the
real edge. Severity high. **CONFIRMED**. Closes: B24-A2 (OD-196); the edge half BLOCKED-LIVE-QUALIFICATION (LB-13). Sources: G-A6.
- [B24-A2, 2026-10-06] D24-5: closed offline by B24-A2 - six security headers on every path from one pure builder (`frame-ancestors 'none'` beside the unchanged image directive, `X-Frame-Options: DENY`, `nosniff`, `strict-origin-when-cross-origin`, a five-feature `Permissions-Policy`, a report-only `default-src`/`script-src`/`connect-src`/`object-src`/`base-uri` policy), HSTS `max-age=31536000` only for an https `SIRKIT_EXPECTED_ORIGIN` read at build time, and `poweredByHeader: false` (`b24-a2-headers`); the served proof (`e2e/security-headers.spec.ts`, the `production-smoke` probes) PROPOSED until the lead's browser run, local production-mode run and first CI run are green; the edge half BLOCKED-LIVE-QUALIFICATION (LB-13).

**D24-6 - Origin and redirect allowlists are right in code but single-origin, and the Supabase side is unrecorded.** Requirement: B24-A
`:1036`. Finding: one validated `SIRKIT_EXPECTED_ORIGIN`, no forwarding-header override (`expected-origin.ts:16-31`); relative-path-only
redirects (reader 1); no preview or staging origin list; the Supabase Site URL and redirect allowlist are in no repository file. Severity
low. **CONFIRMED**. Closes: B24-A2 records the required allowlist values per environment (OD-196); verification BLOCKED-LIVE-QUALIFICATION
(LB-1, LB-13). Sources: G-A7.
- [B24-A2, 2026-10-06] D24-6: recorded by B24-A2 - the Supabase Site URL (the deployment's one origin, normalised) and redirect allowlist (exactly `<origin>/api/auth/callback`, no wildcard, no second host) per profile, an http origin refused off loopback for staging and production (`supabaseAuthUrls`, `b24-a2-origin-allowlist`); one origin per deployment, no multi-origin list (OD-196); the app starts no Supabase flow that redirects to the callback; the project's Site URL, redirect list and email templates UNKNOWN, and their verification BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13).

**D24-7 - No database backup, restore, point-in-time recovery, failover or reconnect, and no evidence of any.** Requirement: B24-A `:1037`;
B24-D `:1103`. Finding: nothing names `pg_dump`, `pg_restore` or PITR (only project-envelope backup, `persistence.ts:8, :57`); one client,
no replica or retry (`client.ts:29-46`); stores fail closed on outage (reader 4); database recovery evidence is a PGlite migration
interruption only (`deterministic-manufacturing.yml:285`; reader 4). Severity high. **CONFIRMED**. Closes: B24-A4 offline (a logical
dump and restore proven on PGlite, a written recovery runbook, a connection-loss case, OD-194); PITR, failover and restore on the real
platform BLOCKED-LIVE-QUALIFICATION (LB-14). Sources: G-A8, B24D-10.
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`: `persistence.ts:8, :57` and `client.ts:29-46` are unchanged and nothing names `pg_dump`, `pg_restore`, PITR or failover, so the gap stands. The workflow citation moved from `:284` to `:285` (B23-A1 `79fa18b`), and the database-delivery job now also runs B23-B2's `b23-b-exchange-ledger-pglite` suite (`:301`), which has no recovery or connection-loss case.
- [B24-A4, 2026-10-08] D24-7: closed offline by B24-A4.

**D24-8 - Anonymous callers can spend paid provider credit and block the server, unmetered, and seen by the census only as reviewed public model-egress exceptions (B23-A2, OD-174).** Requirement: B24-A
`:1039`; global `:155`. Finding: two public routes embed every free-text query through OpenAI (`app/api/parts/search/route.ts:110, :241-250`;
`app/lib/pcb/footprint-search-service.ts:63`; `app/lib/embeddings.ts:50-53`) with no limiter (`route-handlers.ts:1040` is the only 429),
declared `providerCredit: false` because `pub()` hard-codes it (`route-policy.ts:62-64, :246, :256`) and classified `expensive false`,
`static_or_catalog true` (classification CSV); the public placement preview (`route-policy.ts:257`) blocked the event loop 124.9 s per
request (B20 verdict `:67-68`) and is classified `expensive false`; `providerCredit` is never enforced (reader 1); sign-in has no app
throttle (`signin/route.ts:83`); the single-agent chat path is not LLM-metered (INFERRED: the meter's only caller is the orchestration policy,
`provider-policy.ts:151-153`); every meter is per process (`inbound-limits.ts:1-3`; `admission-control.ts:324-329`). Severity high.
**CONFIRMED**. Closes: B24-A3 (OD-197). Sources: G-A10, S6-G9 (placement preview).
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`. Every code citation holds except two: at `route-policy.ts:62-64` B23-A2 (`da36d51`) added `externalTransfer`/`spend` false to `pub()` (`providerCredit` is still false), and `route-handlers.ts:1040` is no longer the only 429, since the authenticated provider exchange answers 429 (`provider-exchange.ts:84-85`, B23-B2) and `token-issuance.ts:58` already did. `publicHasCreditOrWrite` moved to `route-resource-classification.ts:210-215`, and CSV rows `:102`, `:116` and `:117` gained `outbound_egress`/`model_egress`. "Unseen by the census" is narrowed: B23-A2 records both public embedding routes as reviewed `PUBLIC_MODEL_EGRESS` exceptions (`:139-142`, pinned at `b23-a-route-vocabulary.test.ts:679, :819`) under OD-174's open owner question, which names no B24 owner at `dfd51e3`. No limiter was added to the public routes, and no credit declaration, sign-in throttle or placement bound was added, so B24-A3 keeps that work and restates its census counterexample against the census, now 166.
- [B24-A3, 2026-10-08] D24-8: closed offline by B24-A3. The four anonymous rows meet per-process windows in `authorizeRequest`'s public branch, after CSRF and before the media type and the body:

**D24-9 - No health or readiness check.** Requirement: B24-A `:1040`. Finding: no such route among 152 (`dfd51e3`); the only probe in use is a static
public route that checks nothing (`playwright.config.ts:42`; `app/api/ai/runtime/route.ts:13-40`). Severity medium. **CONFIRMED**. Closes:
B24-A1 (OD-198); real dependency health in staging BLOCKED-LIVE-QUALIFICATION (LB-13). Sources: G-A11.
- [B24-A1, 2026-10-06] D24-9: offline closed by B24-A1 - `GET /api/health` (public liveness) and `GET /api/ready` (the worker class through a read-only row; nine closed checks, the database an injected port bounded at 2,000 ms, never a value; census 166 -> 168 by review; `b24-a1-readiness`); staging dependency health BLOCKED-LIVE-QUALIFICATION (LB-13).

**D24-10 - Provider and model configuration is unversioned, and the runtime report can disagree with the adapter.** Requirement: B24-A
`:1041`. Finding: provider, model, reasoning effort and the role table are environment values with code defaults and no versioned record
(reader 1; `anthropic-config.ts:14-16`); `/api/ai/runtime` reports `?.trim() || default` (`route.ts:16`) while adapters send `?? default`
(`anthropic-config.ts:15`; `adapters.ts:208, :328`); the Anthropic agent client sets no timeout of its own (`adapters.ts:213`). Traces do
record the adapter-reported model (section 0). Severity low. **CONFIRMED**. Closes: B24-A1 (OD-199). Sources: G-A12 (configuration half),
B24D-5 (timeout).
- [B24-A1, 2026-10-06] D24-10: closed by B24-A1 - the digested `sirkit.deployment-configuration.v1` record, every provider SDK client in it by the code that builds it with its timeout and retries (`b24-a1-configuration`), `/api/ai/runtime` reporting what the clients send and an empty or padded Anthropic model refused rather than sent, and the Anthropic client timeout (`adapters.ts:213`, `timeout: 120_000`); attaching the digest to trace records goes to B24-C2 (OD-208), after B24-C1's durable trace.

**D24-11 - No feature flag or kill switch for the sandbox (external manufacturing gained two off-only switches in B23), and no flag inventory.** Requirement: B24-A `:1042`.
Finding: MCP and orchestration have exact-"1" flags (reader 1; `orchestration-runtime.ts:39-44`); B22-B added `SIRKIT_NAMED_COMPUTATIONS` (exactly "1", default off, `computation-runtime.ts:20, :24`) and B23 the off-only `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS` (`provider-admission.ts:23`) and `SIRKIT_ORDERING_DISABLED` (`ordering-enablement.ts:41`), but no sandbox
switch exists beyond the diagnostic runner's unset install pin (`diagnostic-runner.ts:255-259`); no test pins every flag's default. The sandbox stays disabled by code (the 501) and B23
applied ordering disabled by a pure function (OD-171 as applied, `OWNER_DECISIONS.md:2338`), and `.env.example` declares none of the three new switches or `SIRKIT_ORCHESTRATION_ENABLED` (its only flags are the two stage rollouts, `:54`, `:61`, and the commented `SIRKIT_MCP_ENABLED` and `SIRKIT_MCP_DISABLED_SERVERS`, `:71`, `:74`). Severity medium. **CONFIRMED**. Closes: B24-A1 after B22 and B23 land (OD-200).
Sources: G-A13.
- [B24 lead, 2026-10-06] Re-verification (section 9): Partly closed since discovery. B22-B added the exact-"1", default-off `SIRKIT_NAMED_COMPUTATIONS` (`computation-runtime.ts:20, :24`; OD-158). B23 added the off-only `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS` (`provider-admission.ts:23, :59-60`, read by the provider-exchange route at `route.ts:47`) and `SIRKIT_ORDERING_DISABLED` (`ordering-enablement.ts:41, :116-117`; OD-171 applied in `4e71563`). Still open: no flag inventory, no test pinning every default (none of the three is in `.env.example`), and no off switch for B22's diagnostic runner beyond its unset install pin (`diagnostic-runner.ts:255-259`). OD-200 and B24-A1 shrink to the inventory plus that switch.
- [B24-A1, 2026-10-06] D24-11: closed by B24-A1 for the inventory (49 names, `flag-inventory.ts`), the pinned defaults (each recorded flag state checked against its owner) and the diagnostic-runner switch (`SIRKIT_DIAGNOSTIC_RUNNER_DISABLED`, off-only: every run and every install check refuse; `b24-a1-flags`). The `.env.example` declarations of `SIRKIT_NAMED_COMPUTATIONS`, `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS`, `SIRKIT_ORDERING_DISABLED` and `SIRKIT_ORCHESTRATION_ENABLED` are B24-A2's (OD-195).

**D24-12 - Opt-in tests can reach real data.** Requirement: B24-A `:1044`. Finding: `schema-integrity.test.ts` points `DATABASE_URL` at the
qualification URL and deletes all rows of five physical-binding tables, the audit table included, before every live case, with no scope and
no empty-target guard (`app/lib/physical-binding/__tests__/schema-integrity.test.ts:15-16, :52-60, :124`); the guard exists in one suite
(`b16-b-postgres-qualification.test.ts:36`); the live-auth isolation check is a name prefix (`b16-1b-live-qualification.test.ts:27-28`);
the acceptance driver and local Playwright inherit `.env.local` (reader 1, INFERRED). The owner authorised the MAIN Supabase project for live
tests on 2026-09-24 (`EXECUTION_LEDGER.md:2492`); whether it holds production data is **UNKNOWN**. Severity medium. **CONFIRMED** (code).
Closes: B24-A4 (one shared empty-target guard for every DB-gated suite; OD-191, OD-201). Sources: G-A14.
- [B24-A4, 2026-10-08] D24-12: closed by B24-A4.

**D24-13 - No retention or deletion policy is implemented for any trace or audit record.** Requirement: B24-A `:1038`. Finding: the
coordinator trace is not kept at all (D24-20); the orchestration record, resume record (up to 60,000 characters of model answer,
`store.ts:398`), specialist traces, grants and audit tables are kept with no purge ("RECORDED on the page, not implemented", `store.ts:22`;
OD-111 `OWNER_DECISIONS.md:1096-1098`); B11 deferred every retention question (`redaction-and-retention-policy.md:41-57`); the only purge
is the distributor offer cache (reader 1). Severity medium. **CONFIRMED**. Closes: B24-C2 (OD-202). Sources: G-A9, G24C-3.
- [B24-C2, 2026-10-08] D24-13: closed offline by B24-C2 (OD-202 applied as 9.4 restates it; OD-232): `RETENTION_POLICY` (`sirkit.retention-policy.v1`, `app/lib/observability/retention-policy.ts`) names every record class with its rule - 90 days for `agent.run-trace.v1`, `llm.call-record.v1`, `agent.run-trace-attribution.v1` and `agent.orchestration-trace.v1`, 30 days for `agent.orchestration-resume.v1` (deleted whole), until the owner decides for the orchestration record, the grants, the release ledger, the computation evidence, the provider exchange (with B23-B3's observations, its projections), the trace salt, the binding and catalog audit tables and aggregates, the CD-13 run events and the engineering state, configuration for the autonomy setting, process lifetime for the MCP and B05 rings, own purge for the offer cache, browser-local for the SPICE log and the approved-mutation journal - and a census pins that every aggregate type a production module passes to the durable repository (34) has a row; the purge is allowlist-only through a repository-boundary port (`app/lib/durable-workflow/retention.ts`, `getDb()` only, one transaction per aggregate: outbox rows, replay rows referencing only its records, records, head; `mixed_commit` and `outbox_in_flight` refused whole) and an operator CLI (`runRetentionCli`, `scripts/retention-purge.ts`) that is dry-run by default, requires `--apply --confirm <planDigest> --as-of <instant>` with the digest over exactly the set to delete, refuses every other flag before any repository call and prints no URL, payload or salt; proven on PGlite (`b24-c2-retention-pglite`) and with a fake port (`b24-c2-retention`); never run against a live database, the dry run included: BLOCKED-LIVE-QUALIFICATION (LB-14); `retention-and-deletion.md`.

### B24-B - golden evaluation program

**D24-14 - No versioned golden catalog, no six-class taxonomy, and scores that can hide a missing live test.** Requirement: B24-B `:1048`,
`:1070`. Finding: three harnesses under three schemas, none listing the nineteen areas (section 2.4); no type names the six classes; B11
pools every case into one total with no class and a provider column on scripted rows (`evaluation.ts:32-41, :107-125`;
`evaluation-case-matrix.csv:1, :16-18`); B21-F hard-codes `offline: "PROVEN"` (`_f-cases.ts:54`) and has no database-backed, staging or
physical column; stage-09's regression check can return `pass` over all-`blocked_by_prerequisite` runs (`regression-policy.ts:69, :72-88`,
INFERRED). `evaluation.ts` is hash-pinned (section 0), so a class field there is a pin move. Severity high. **CONFIRMED** (structure),
**INFERRED** (pooling consequence). Closes: B24-B1 (OD-203). Sources: G24B-1, G24B-2, G24B-3, S6-G8.
- [B24-B1, 2026-10-08] D24-14: closed offline by B24-B1 (OD-203). `app/lib/evaluation/golden-catalog.ts` (`sirkit.golden-eval-catalog.v1` 1.0.0) is the six-class catalog: 114 rows, one per (area, class), each linking its suites (with B11 and B21-F ids, and CI jobs derived from the workflows by a test-only helper), naming the missing evaluation and its owner, or blocked on its LB id. The validator refuses a live-class row without an LB id, a covered live row, and any blocked, missing, not-applicable, in-part or failing row without its reason. Scores are per class, typed so that two classes cannot be added (`Tally<C>`), and no verdict is a pass: deterministic offline incomplete, model-in-loop and external-provider staging BLOCKED-LIVE-QUALIFICATION, browser E2E and database-backed incomplete, physical-hardware validation failing (B22-D's live run, case 4 NOT CONTAINED, LB-10). Stage-09's `evaluateRegressionResults` no longer reads a run with no `passed` or `completed_with_unknowns` status as `pass` (`NO_EVIDENCE_STATUS`, insufficient_evidence; the counterexample answered `pass` at `72c1376`); a blocked run over a gated profile stays a misreported correctness block (recorded). The B11 scorer and B21-F are not edited. `eval-catalog.md`; `b24-b1-catalog` (11), `b24-b1-score-separation` (5).
- [B24-B2, 2026-10-08] D24-14: deterministic offline is `failing` since B24-B2 (power-ground, the member-pin counterexample, D24-42): missing 0, outside pull-request CI 1.

**D24-15 - Evaluation, budget and map-pinning suites run in no CI job.** Requirement: section 4 `:1206-1207`; OD-59/OD-124 practice.
Finding: the 23 B09-B11 suites, among them B11's whole evaluation and replay suite and the single-agent hard budgets
(`b09-loop-safety.test.ts:203, :218, :229`), are outside both workflows while B11's summary says "CI gates delivered"
(`validation-summary.md:74`); the byte pins of the exact route policy, the resource classification, auth coverage and the raw baseline are
outside too (`b16-0-1-ci-gates.test.ts:107-111`; `b16-0-2-gates.test.ts:266-270`), though since `da36d51` the classification CSV's bytes are also pinned in CI (`b23-a-route-vocabulary.test.ts:667`); `pin-pad-mapping` and footprint-resolver suites are
outside (reader 2); the 63-package corpus runs only by hand (`benchmark.yml:28-35`; baseline 2026-07-17, reader 2); whether the B11 suite
passes at `dfd51e3` is **UNKNOWN** (B22's local closeout run at `85439e7` had `app/lib/agent/__tests__` 415/415 green, `artifacts/ai-control-plane-b22/test-and-validation-report.md:94`). Severity medium. **CONFIRMED**. Closes: B24-B2 (OD-204). Sources: G24B-4, G24B-10, B24D-6, G7-8.
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`: still outside both workflows are the 23 B09-B11 suites (`b09-loop-safety.test.ts:203, :218, :229`), the exact-route-policy, auth-coverage and raw-baseline byte pins, `pin-pad-mapping`, the footprint-resolver suites and the 63-package corpus (`CHAPTERS` now `b19-`..`b23-`). B23-A2 (`da36d51`) narrowed the gap: `b23-a-route-vocabulary.test.ts:667` byte-pins the route resource classification CSV in CI through `deterministic-manufacturing.yml:227`. B22's closeout run at `85439e7` ran `app/lib/agent/__tests__` (B11 suites included), `app/api/chat` and `app/lib/auth/__tests__` green locally (`test-and-validation-report.md:94, :97, :101`); no pass at `dfd51e3` is recorded.
- [B24-B2, 2026-10-08] D24-15: closed offline by B24-B2 (OD-204). The 33 suites of D24-15 and the three catalogued opt-in live suites (skipping, OD-222) ride prompt-to-gerber as 32 lines before its `--reporter` line (`deterministic-manufacturing.yml:260-291`, the five footprint-resolver suites under one directory filter), after one local green run at `b0af256` (36 files, 431 passed, 15 skipped, 43.8 s; the B11 evaluation suite 16 of 16, which answers section 8 item 5). The guard `b24-b2-ci-admission` (9 cases) pins every catalogued link's admission, the closed negative list (three FreeRouting/Java suites, LB-3), the named list, the corpus step and the order case's own-turn checks. The corpus (`b24-b2-corpus-nightly`, 5 cases) runs the 58 non-holdout packages on benchmark-nightly only; its local flagged run is red on the three CD-9 packages, recorded, not excused (D24-41, owned by B24-D1). 64 of the 73 `b16-0-*` suites stay outside CI (OD-228 (f)). `ci-admission.md`.

**D24-16 - Three runbook areas had no evaluation; power and ground still has none.** Requirement: B24-B `:1058`, `:1066`, `:1068`. Finding: no case asserts power or ground
preservation across delete, replace or edit (test-title grep; B21 F1's sentence says "preserving compatible nets", its assertions do not,
`evaluation-matrix.csv:2`); B22-D's `b22-d-adversarial` now covers process-isolation escape offline in CI (`deterministic-manufacturing.yml:226`; the live suite's class 4 NOT CONTAINED; OCI BLOCKED, LB-10); quote/order idempotency is evaluated offline in CI by B23's suites (`b23-b-approval-plan.test.ts:208, :369`; `b23-c-order-contract.test.ts:130`; live LB-11, LB-12);
and no browser case drives an order request (reader 2). Severity medium. **CONFIRMED** (absence; F1 by reading `b21-f-evaluation.test.ts:168-195`). Closes:
B24-B2 (OD-205), linking the B22-D and B23 suites. Sources: G24B-5, G24B-8, G24B-9.
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`. Power and ground preservation still has no case: F1's assertions name no net, CONFIRMED by reading `b21-f-evaluation.test.ts:168-195`. No browser spec sends an order (e2e is unchanged; `agent-execution.spec.ts:474` is a static line). B22-D (`c9fbbb0`) closed the escape-suite part offline: `b22-d-adversarial` runs in CI via `deterministic-manufacturing.yml:226`, the live suite ran once with 12 of 13 and class 4 NOT CONTAINED (`adversarial-matrix.md:323-335`), and OCI is BLOCKED (LB-10). B23 closed quote/order idempotency offline (`b23-b-approval-plan.test.ts:208, :369`; `b23-c-order-contract.test.ts:130`; in CI via `:227`; live LB-11/LB-12).
- [B24-B2, 2026-10-08] D24-16: closed offline by B24-B2 (OD-205), with one recorded counterexample. `b24-b2-power-ground` (10 cases) evaluates delete, replace and edit through the agent's own path and the canonical executor; OD-205's default facts (net names, power symbols, net classes) hold in every case. The member-pin rule (OD-228 (c)) records a delete that removes a whole wire joining two surviving pins to GND and names no net (case 9; D24-42, OD-229), so the catalog's power-ground offline row is `failing`. Sandbox escape and quote/order links verified in the catalog. The browser order-refusal case (`e2e/agent-execution.spec.ts`, `[B24-B2]`) is green in the lead's browser run (2026-10-08: the default configuration 55 passed in 4.8 min, this case 8.3 s; the orchestration configuration 4 passed). No quote case (OD-173). `ci-admission.md`; `eval-catalog.md` section 17.

**D24-17 - No artifact maps the twenty required scenarios, and several stand only in part or by deviation.** Requirement: section 3
`:1165`; section 4 `:1206`. Finding: no artifact maps scenarios to suites (`git grep 'program-wide|required test scenarios'` hits only three
discovery pages, B21's, B22's and B23's (`artifacts/ai-control-plane-b23/discovery.md:127`), none a map); per the records scenarios 2, 3, 7, 12 stand in part, 8 by refusal, 15 on fake servers only, 16 reads only, 17 by recorded
deviation, 18 BLOCKED (B22's PARTIAL verdict, LB-10) and 20 by refusal under B23's visibly disabled ordering and offline Tier 3 contract (LB-12) (section 2.8). A final report that says "demonstrated" for these would overstate. Severity high.
**CONFIRMED** (absence and cited deviations), **INFERRED** (the mapping). Closes: B24-B3 (OD-206). Sources: S6-G1, S6-G2.
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`: no scenario map exists (the grep now hits three discovery pages, B21, B22 and B23, none of them a map). Three standings moved. Scenario 18 is now B22's recorded PARTIAL verdict with the production runner BLOCKED (B22 `final-verdict.md:3, :17`; LB-10). Scenario 20 is refused under a visibly disabled ordering path, with the Tier 3 purchase-authorization contract proven offline and no port wired (`ordering-boundary.md`; OD-170..OD-172; LB-12), no longer "by absence". Scenario 12's process-failure cleanup is delivered for the diagnostic runner only (B22-A3, OD-145).
- [B24-B3, 2026-10-08] D24-17: closed offline by B24-B3 (OD-206 applied). `app/lib/evaluation/scenario-map.ts` (`sirkit.scenario-map.v1` 1.0.0) maps the twenty scenarios of runbook `:1167-1186`, each with a standing from OD-206's closed six, its evidence (class, path, refs that resolve, the CI jobs that run it), what it does not demonstrate, its ODs and LB ids; `scenarioMapProblems` refuses an open standing, an LB id off the register, a demonstrated row with a remainder or a suite no job selects, and an unresolved cite, and `scripts/generate-b24-scenario-map.ts` writes `scenario-map.csv`/`.json` only on none. Standings at `4738aa3`: 1, 5, 6, 10, 11, 13, 19 demonstrated; 4, 9, 14, 15 demonstrated offline only (LB-15; LB-3, LB-8; LB-15, LB-11; LB-16); 2, 3, 7, 12, 16 in part; 8 and 20 by refusal (LB-8; LB-12); 17 by recorded deviation (OD-122, LB-9); 18 blocked (LB-10). `scenario-map.md`; `b24-b3-scenario-map` (6).

**D24-18 - The model-in-loop class has one record-only, one-provider command that has never run, and no money bound.** Requirement: B24-B
`:1070`; B24-E `:1115`. Finding: section 2.4 (`run-b21-live-orchestration-evaluation.ts:4-5, :35-38, :71-80`); no per-provider contract
turn (structured output, forced tool) exists; disagreement and fallback cannot arise on one provider (`:15-18`); the bound is requests and
tokens, cost is unpriced (OD-107, reader 3); `assist-live` would likely be refused before any model call (section 0, INFERRED). Severity
medium. **CONFIRMED**. Closes: B24-B3 repairs and extends offline (OD-209); runs BLOCKED-LIVE-QUALIFICATION (LB-2, LB-7, LB-9; OD-216).
Sources: G24B-6, S5-G2, S5-G3.
- [B24-B3, 2026-10-08] D24-18: closed offline by B24-B3 (OD-216 and OD-209 applied; OD-125 amended). `assist-live` reaches the model once on Anthropic with an injected editor and the project selector (offline, the router mocked); the record-only command refuses a scripted agent and an absent key with exit 3 and runs only with an owner price table (`sirkit.live-price-table.v1`, `app/lib/evaluation/live-spend.ts`, the program's one table) that prices every model the run calls, and a money cap, each request priced at its worst case, at the model it is sent with, before it is sent; `both` runs the separate two-provider capsule (the full-circuit-creation DAG, the schematic role on Anthropic), which cannot force a disagreement or a fallback; `--contract-turns` adds one forced-tool turn per provider through the router's provider classes over `maxRetries: 0` clients, each with the adapters' output ceiling. Every live run BLOCKED-LIVE-QUALIFICATION (LB-2, LB-7, LB-9). `b24-b3-model-in-loop` (9).

**D24-19 - Opt-in live suites can report green without exercising the resource.** Requirement: B24-E `:1123`; B24-B `:1070`. Finding: the
distributor contract passes when a source is not admitted (`b19-e-live-contract.test.ts:34-37`); the auth canary passes with no database URL
(`b16-1b-live-qualification.test.ts:196`); the kicad-cli oracle exports an empty board against a short-expecting assertion
(`kicad-cli-oracle.test.ts:29-32, :57-58`, INFERRED); `assist-live` (above). Severity medium. **CONFIRMED** (early returns), **INFERRED**
(oracle, assist). Closes: B24-B3 (OD-209). Sources: S5-G4, S5-G9.
- [B24-B3, 2026-10-08] D24-19: closed offline by B24-B3 (OD-209 applied). `app/lib/evaluation/live-suites.ts` registers the seven opt-in live suites (`LIVE_SUITES`) and B24-B2's nightly corpus gate (`NON_LIVE_GATES`, D2); each runs on its flag alone and its gated blocks fail `NOT EXERCISED` when a resource is absent, never skip or pass. The two vacuous passes are gone (`b19-e-live-contract.test.ts:34-37` now fails `NOT EXERCISED: <id> not admitted (<refusal>)`; the live-auth canary is `it.runIf(DB_URL !== "")`, skipped, never passed), the oracle exports the routed demo behind a NOT MEASURED positive control (offline: our DRC finds the short on the routed demo and nothing on the empty board), and `worker-integration` rides prompt-to-gerber (`deterministic-manufacturing.yml:292`). The census holds 19 line-start gates in 16 files to four kinds. Counterexamples before and after recorded (`scenario-map.md` section 5). Every live suite stays not exercised but B22's two (LB-1, LB-2, LB-7, LB-10, LB-13, LB-15, LB-17). `b24-b3-live-suite-honesty` (10).

### B24-C - observability and replay

**D24-20 - The coordinator and single-agent run trace is built, validated and thrown away.** Requirement: B24-C `:1074-1086`; B24-A
`:1038`. Finding: `trace-recorder.ts:108-113`; `app/api/chat/route.ts:437, :458-465`; no production caller of `setAgentTraceSinkFactory`.
After a request ends there is nothing to inspect, audit or replay. Severity high. **CONFIRMED**. Closes: B24-C1 (OD-207). Sources: G24C-1.
- [B24-C1, 2026-10-08] D24-20: closed offline by B24-C1 (OD-207 applied): every run that reaches the chat route's recorder hands its finalized, validated `sirkit.agent-run-trace.v1` document to a durable sink bound through `setAgentTraceSinkFactory` at the chat composition root (`app/api/chat/trace-runtime.ts`, imported on `app/api/chat/route.ts:40`; no B11-scanned file edited), kept as `agent.run-trace.v1` on the durable-workflow substrate - one record per trace in one aggregate per scope and run id (the scope as the substrate stores it), a resume's trace at revision 2 - and retrievable by run id through `DurableRunTraceStore.history`, every load re-verified; proven in memory, through the production chat POST and on PGlite (`b24-c1-durable-trace`, `b24-c1-durable-records-pglite`); the real database platform is BLOCKED-LIVE-QUALIFICATION (LB-14), and whether a serverless platform keeps the scheduled write alive is LB-13's (OD-190); `observability-and-replay.md`.

**D24-21 - Twenty-two model-calling route paths besides `/api/chat` build no trace and leave no durable usage or error record.** Requirement: B24-C `:1074-1086`. Finding: section
0; among them `spice/ai`, `pcb/repair/agent`, `pcb/edit/assist`, `schematic/edit` and the `*/propose` family; SPICE's only audit is
browser-local (`app/lib/spice/project.ts:318-332`). Severity high. **CONFIRMED**. Closes: B24-C1 (OD-207). Sources: G24C-2.
- [B24-C1, 2026-10-08] D24-21: closed offline for the 22 derived paths by B24-C1 (OD-207 applied; OD-231 (a): the two public paths under the reserved operator scope `~sirkit-operator`, which no authenticated selector can name): every provider call made inside one of the 22 `model_egress` paths other than `/api/chat` leaves one `sirkit.llm-call-record.v1` (route, method, scope, provider, model, call kind, token counts, latency, a closed outcome class, the start time; no content) through one seam at the four call points (`LLMRouter.generate`/`stream`, `embedBatch`, the rerank), kept as `llm.call-record.v1` through the sink `instrumentation.ts` binds; each path driven through its real handler with fake SDKs (`b24-c1-llm-call-record`), on PGlite too; the fixture runtime's router short-circuit and a failure before any request leaves Sirkit write none, the SDK's own retries are not visible (D24-22's UNKNOWN), and live usage shapes stay BLOCKED-LIVE-QUALIFICATION (LB-2, LB-7, LB-9); `observability-and-replay.md`.

**D24-22 - A trace cannot say who asked, what was asked, what was discovered or read, what failed before running, or what the user saw.**
Requirement: B24-C `:1076-1077`, `:1080`, `:1084`, `:1086`. Finding: no request digest or principal reference in the trace
(`trace-recorder.ts:134-143`; `trace.ts:271`; the grant and resume records do carry `userMessageDigest`, `store.ts:402`); the discovered
toolset and per-read source revisions are not recorded (reader 3; the B05 read trace that holds them is an in-memory ring nothing reads);
refused calls are untraced except `unknown_tool` (reader 3); SDK retries and provider request ids are not recorded (reader 3); the terminal
carries no answer digest (`trace.ts:254-260`). Any change inside `trace.ts` is a pin move (section 0). Severity medium. **CONFIRMED**.
Closes: B24-C2 (OD-208). Sources: G24C-5, G24C-6, G24C-7, G24C-8.
- [B24-C2, 2026-10-08] D24-22: closed offline by B24-C2 (OD-208 applied; OD-232): every validated run trace gets one `sirkit.agent-run-trace-attribution.v1` beside it (`agent.run-trace-attribution.v1`, `app/lib/observability/run-trace-attribution.ts`), keyed by trace id in the run's scope and bound to the stored trace by digest, written once by compare-and-set from the chat composition root (`app/api/chat/attribution-runtime.ts`, imported in place on `route.ts:35`) after the recorder's hand-over: who asked (the trusted context by closed class and a per-scope salted principal digest, `agent.trace-salt.v1`), what was asked (a salted message digest and the count), the discovered toolset digest, at most 64 reads' source revisions and consumed resources, the refused-call classes, the provider request ids (the SDKs' `_request_id`, at most 2 x maxModelSteps, bounded), the retry ceiling with the SDK's retries stated UNKNOWN, a salted answer digest and A1's deployment configuration digest published by `instrumentation.ts`; no text field, `findSecretShapedPath` over the document, no edit to a B11-scanned file; proven through the production chat POST in memory (`b24-c2-attribution`); the real database platform is BLOCKED-LIVE-QUALIFICATION (LB-14), live request ids LB-2, LB-7, LB-9; `observability-and-replay.md` part 2.

**D24-23 - Cost is recorded nowhere, budgets are not in the trace, and latency is run-level only.** Requirement: B24-C `:1085`. Finding:
tokens per step and in total (`trace.ts:226, :259`); no cost field anywhere (reader 3; OD-107 "reported, not priced"); the run budget
(`contracts.ts:181-188`) is absent from the trace; only `startedAt`/`endedAt` (`trace.ts:251-252`). Severity medium. **CONFIRMED**.
Closes: B24-C2 (OD-209). Sources: G24C-4, B24D-4 (trace half).
- [B24-C2, 2026-10-08] D24-23: closed offline by B24-C2 (OD-209's cost half amended; lead decision D1): the attribution carries the run's budget (`DEFAULT_AGENT_BUDGET`'s six fields), its cost through the program's one price table (`app/lib/evaluation/model-price-table.ts`: `MODEL_PRICE_TABLE: LivePriceTable | null = null`, `priceUsage` over B3's `sirkit.live-price-table.v1` validator and the `procurement.ts` decimal helpers - decimal text in per-million units, no division, no float; "unpriced" with a closed reason until the owner supplies a table, never zero) and its latency on a monotonic clock (one offset per appended trace event by seq, at most 256, the first text delta and the terminal) measured at C1's sink and the route's emit, never inside `trace.ts` or `trace-recorder.ts`; C1's call records stay token counts, never priced (`b24-c2-cost`, `b24-c2-attribution` 1, 6); `observability-and-replay.md` part 2.

**D24-24 - Human approvals of Tier 2 work are recorded only in the browser, and Tier 1 settlement is browser-attested.** Requirement: B24-C
`:1081-1082`. Finding: the approved-mutation journal is IndexedDB (reader 3); the server's apply-authorization route is a membership read
(reader 3); grant settlement `attestation: "browser-attested"` (`execution-grant.ts:192`). Severity medium. **CONFIRMED** (settlement),
**INFERRED** (consequence: no server record ties a Tier 2 apply to a run). Closes: OD-210 (default: recorded limitation, B24-C3 records it).
Sources: G24C-9.
- [B24-C3, 2026-10-09] D24-24: closed AS RECORDED by B24-C3 (OD-210 applied: nothing is built, the limitation is pinned): Tier 2 approvals stay browser-only - the approved-mutation and approved-PCB-mutation IndexedDB journals are imported by the PCB editor and reach no `app/api/**/route.ts` closure (pinned by exact path), the server's two apply-time checks (`POST /api/pcb/apply-authorization`, `POST /api/replacement-authority`) are authenticated-read rows with `authoritativeWrite: false` and the apply-authorization route's one runtime import is the canonical wrapper - so no server record ties a Tier 2 apply to a run (INFERRED, as far as code can show); Tier 1 settlement stays browser-attested, structurally (under `app/lib/execution-grant/` the only `attestation` literal is "browser-attested", `settle.ts:58`, the only other `attestation:` copies a stored settlement, `store.ts:175`, and `SettleRequest.settlement` omits the field), while the grant itself is server-held and bound to the run (`session.runId` set from the run context at mint, `mint.ts:175`, required by the browser-side parser) - the limit is the outcome's attestation, not a missing run-bound record; Tier 3's exchange ledger names `committedBy` and no run; each pinned by `b24-c3-recorded-limits` 1-7 with an injected variant turning each pin red; `observability-and-replay.md` part 3.

**D24-25 - Three stores keep user or model text without the redaction authority.** Requirement: B24-C `:1088`. Finding: the grant's
240-character instruction excerpt (`mint.ts:181`; `explicit-request.ts:69`); SPICE `aiAuditLog` rationale and change set, unbounded and
uncapped, in localStorage (`types.ts:458-468`; `project.ts:318-332`; `persistence.ts:47-49`); the provider error log's provider message
(`errors.ts:180-194`). Severity low. **CONFIRMED**. Closes: B24-C2. Sources: G24C-10.
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`: `mint.ts:181`, `explicit-request.ts:69`, `project.ts:318-332` (B22-C `a269e7a` relabelled evidence provenance at `:330` in place), `persistence.ts:47-49` and `errors.ts:180-194` hold. `AiAuditEntry` moved from `types.ts:451-461` to `:458-468` after B22-C's seven-line header addition. B23's provider-text stores screen through the redaction authority (`provider-text-screen.ts:19`), so the count stays at three unredacted stores.
- [B24-C2, 2026-10-08] D24-25: closed by B24-C2 (OD-232): the redaction authority (`app/lib/agent/redaction.ts`, not edited) now covers the three stores - the grant's instruction excerpt is the token-anchored redaction of the whole collapsed message cut at 240 (`mint.ts:181`: a straddling key redacted whole, design text kept, a control or format character a space; `explicit-request.ts` unchanged), the SPICE `aiAuditLog` is bounded to 200 entries behind one `audit-log-truncated` marker with its `reason` redacted and capped at 2,000, a change set redacted or withheld past 16,000 characters and its evidence references redacted and bounded to 200 with the excess counted (`project.ts`, one append helper for both writers; `loadAiAuditLog` applies the same redaction, caps and bound to every stored entry at `loadStudioProject`, `persistence.ts:40`), and the provider error's `detail` and log line pass through `sanitizeTraceText` before the 297 + "..." cut (`errors.ts:183`); every secret-shaped fixture assembled at run time (`b24-c2-redaction`, 11 cases; `errors.test.ts:22` and `b22-c-ai-evidence` 2 hold); `retention-and-deletion.md`.

**D24-26 - Stored traces have no reader, no export and no access audit; MCP and read traces die with the process; replay covers authored
capsules only.** Requirement: B24-C (observability as an operable program); `:1088` (replay). Finding: reader 3 (specialist trace store
written only, rings of 1,000 and 500, no telemetry dependency in `package.json`); live runs keep digests only (`trace.ts:11-13`). Severity
low. **CONFIRMED** (`trace.ts`), reader 3. Closes: B24-C3 (OD-211). Sources: G24C-11, G24C-12.
- [B24-C3, 2026-10-09] D24-26: closed offline by B24-C3 (OD-211 applied; OD-233): stored traces have a reader and an export - B24-C2's purge CLI's `--read` mode (`scripts/retention-purge.ts`, the pure core `app/lib/observability/trace-read.ts`) reads one of four closed kinds (`run-trace`, `run-trace-attribution`, `llm-call-record`, `specialist-trace`) of one scope, each record through its store's digest-verified reader, over a read-only adapter of the durable-workflow repository (`listHeads`, `history`, `loadHead`, `loadRecord` only; every write and `getReplay`/`listOutbox` refused), as one JSON document on stdout under B16-A's read policy (`ok`/`absent`/`corrupt`/`withheld` with closed codes, never a payload, a message or a stack), a 1 MiB cap dropping whole records, a 30 s deadline on the whole read and on each repository call within it, `--limit` 1..100 default 20, and a production runtime refusing without `--acknowledge-unaudited-read`; the access audit stays deferred and stated (`accessAudit: "not_recorded"`, OD-111); the MCP and B05 rings (1,000; 1,000; 500) still die with their process or instance and replay still covers authored capsules only, each pinned (`b24-c3-recorded-limits` 8, 9, 10); proven in memory (`b24-c3-trace-read`) and on PGlite (`b24-c3-trace-read-pglite`); a read against a real store is BLOCKED-LIVE-QUALIFICATION (LB-14; LB-13 for production); `observability-and-replay.md` part 3.

### B24-D - reliability, performance and accessibility

**D24-27 - No latency is measured or gated for view and read commands, reversible edits, complex workflows or the first stream event, and
long tool waits send nothing.** Requirement: B24-D `:1094-1097`. Finding: section 2.6; the client has no first-event or idle timeout and the
server no keepalive (reader 4; `git grep`). Severity medium. **CONFIRMED**. Closes: B24-D1 (OD-212). Sources: B24D-1, B24D-2, B24D-3,
B24D-4.
- [B24-D1, 2026-10-09] D24-27: closed offline by B24-D1 (OD-212 applied); the four runbook measurements (view and read commands, a granted reversible edit, one verified workflow on recordings, the first stream event and completion) are measured locally with fixed warm-ups and samples and gated on the runner baseline, which is BLOCKED-LIVE-QUALIFICATION until the owner accepts `benchmark-latency`'s minutes (lead decision D3: `baseline_missing` is a recorded, non-blocking BLOCKED state while the latest version is the declared-without-values v1). Its keepalive half is measured and stated: after `run_started` the route sends seven `warning` lines at once and nothing more until the provider answers (a 250 ms delayed fake: the silent gap's median 260.1 ms on the review round's re-run, 255.3 ms on the first local run), and the question - a protocol keepalive, or silence stated - is OD-234's, never built here.

**D24-28 - Fragile real-clock thresholds gate CI, the stable method runs nowhere, and the browser budget is tracked by hand.** Requirement:
B24-D `:1109`; OD-30. Finding: about 45 CI-gated real-clock bounds at `dfd51e3` (about 40 at `50fe156`), the tightest 700 ms (`b20-a1-http-transport.test.ts:874`); the 5 s
default timeout (`vitest.config.ts:13-18`); load-induced failures on record (reader 4), one on the GitHub runner itself (`EXECUTION_LEDGER.md:4619`); `route-bench` runs in no workflow and the regression budgets, unit-tested on synthetic results only, gate measured latency in no
workflow; OD-30 durations from 402 s to 951 s and the whole browser job (19m50s on `849a933`, `EXECUTION_LEDGER.md:4281`) recorded by hand (section 2.6). Severity medium. **CONFIRMED**. Closes: B24-D1 (OD-212).
Sources: B24D-15, B24D-16.
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`. All cited lines hold except the browser job's `timeout-minutes`, which moved from `deterministic-manufacturing.yml:317` to `:319` (B23 `79fa18b`, `0cd3f59`). The gap widened. B22-B and B23-B2 added five more CI-gated real-clock bounds (about 45; the tightest is still 700 ms). CI on `0cd3f59` failed `b23-b-page` case 4 at the 5 s default on the runner itself (`EXECUTION_LEDGER.md:4619`). The response was explicit per-test budgets (`a02c9fb`, with `d5f5512` restoring `b23-b-approval-plan` case 18), as earlier local timeouts had drawn budgets and yields (`e8c7928`, `4a988c8`, `9cb675d`), rather than a stable method. The browser job's whole-job time is still recorded by hand (19m50s on `849a933`, `:4281`). `REGRESSION_BUDGETS` are unit-tested in benchmark-core on synthetic results only.
- [B24-D1, 2026-10-09] D24-28: closed offline by B24-D1 (OD-212 applied). The method: a closed metric catalogue, `sirkit.latency-results.v1` (sorted samples, the stage-09 `quantile`, `correctness: "verified"`, the environment as stage10-evidence records it), the append-only `sirkit.latency-baseline.v1` with the stage-09 budget shape plus a floor and never a `maximumP95`, `evaluateLatency` (pass / block on the band AND the floor, p95 from 20 samples / baseline_missing / sample_shortfall / unmeasured) and the widening rule over every consecutive pair through `validateThresholdChange`. The job: `benchmark-latency` (`benchmark.yml`, appended; 30 minutes, no `if:`, the flag in its vitest step's env, the directory outside the repository, the gate, `route-bench` unchanged, the headroom report, the `always()` upload). The census (`threshold-census.ts`, `threshold-classification.ts`, `threshold-census.csv` byte-pinned): 55 CI-gated bounds at `6acae24` (53 before the review round taught the scanner helper-returned and best-of-runs timings) - 33 deadline-proofs and 15 complexity-proofs kept with what each disproves, 7 performance bounds moved in place to catalogued metrics (b20-a4-observation-normalizer case 6's four, pcb-sync performance-resilience's two, b20-a1-redaction-linear's one), 13 outside CI; 178 budgets, 23 yields, 26 CI `vi.waitFor` calls in 12 files, 14 config rows. OD-30 enforced in CI from D1 on: the start and headroom steps of `prompt-to-gerber`, `page-browser-e2e` and `agent-boundary-suites` (lead decision D19), `OD30_SPLIT_REQUIRED` under five minutes. The stage-09 `REGRESSION_BUDGETS` (`qor-runtime-p95-v1`, `maximumP95` 2,000, `regression-policy.ts:57`) still gate no measured run; D1's latency budgets are the measured ones, and the corpus run belongs to B24-B2 (OD-204). `performance-and-reliability.md` part 1; suites `b24-d1-latency-policy` (10), `b24-d1-threshold-census` (7), `b24-d1-latency` (7), `b24-d1-latency-workflow` (1). The exception of lead decision D3 is version 1's alone (`DECLARED_AFTER_V1`, `values_dropped`; the gate refuses a committed baseline with an unreviewed widening), a results file carries only its own suite's metrics and a doubled metric is refused (the review round, 2026-10-09).

**D24-29 - Memory is never measured, and the model cannot read a routed board's full snapshot.** Requirement: B24-D `:1100`. Finding: no memory sampling
(the benchmark's `memoryMiB` budgets are declared, never filled, reader 4); every recorded routed board's `board-inspect` result exceeds the
60,000-character budget, so the model gets no board facts from `board-inspect` (`b18-e-board-inspect-budget.test.ts:29-43`), only narrower bounded reads: `sirkit.pcb.mechanical-inspect` and `sirkit.pcb.via-inspect` (`agent-exposure.ts:37-38`) beside the selection, connectivity and DRC reads (`:55-57`); the routed-board browser journey is
BLOCKED (LB-8). Severity high (a large board is the product's normal case once routed). **CONFIRMED**. Closes: B24-D2 (OD-213). Sources:
B24D-7.
- [B24-D2, 2026-10-09] D24-29: partly closed offline by B24-D2 (OD-213 applied; OD-212's memory half): the bounded paged read `sirkit.pcb.board-page-inspect` reads every recorded routed board, and a synthetic board with ten times their tracks, within 48,000 characters a page measured on the text the model receives, through the real loop with a scripted model (`b24-d2-board-read` 1-8, 10), and six memory metrics in MiB ride `benchmark-latency` (`b24-d2-memory`); it stays OPEN for strict-mode providers: the argument shape they must send (every unset optional property null) is refused `invalid_input` by B05's validation before the read runs (`b24-d2-board-read` 9, a recorded defect shared with via-inspect; D24-43 and OD-236, proposed); the routed-board browser journey is BLOCKED (LB-8), and the memory baseline waits on the owner's Actions minutes (OD-212, OD-30).

**D24-30 - Multi-tab and crash recovery are proven only in-process.** Requirement: B24-D `:1101-1102`. Finding: no real two-page spec, no
cross-tab notice (`git grep`); no tab-crash or server-restart case; the e2e server's stores are in memory (reader 4). Severity medium.
**CONFIRMED**. Closes: B24-D2 (OD-214); a durable-store restart on a real database BLOCKED-LIVE-QUALIFICATION (LB-14). Sources: B24D-8,
B24D-9.
- [B24-D2, 2026-10-09; browser run B24-D2B, 2026-10-10] D24-30: closed by B24-D2 (OD-214 applied): the PCB working copy is compare-before-write across tabs, a write that changes no board keeping the copy's token and a checkpoint restore adopted as the tab's own (`b24-d2-working-copy` 1-7, red first), the conflict record one slot (case 8, a recorded limit and OD-214's open item), the durable head survives a restart on PGlite ("not reproduced", `b24-d2-restart-pglite`); in the browser (the default configuration green; the orchestration configuration runs neither spec), on the paths tested no tab overwrites another's board record, publication or head - a second tab's stale schematic edit is refused by the shared canonical store and said so; a tab that never reloaded creates no publication when it Syncs after the other's (the replay of its own revision, pinned as today's behaviour under an open owner question), its preflight is blocked as stale and said so, the apply it is offered is refused (409) and the board record and the head stay the other tab's; a reloaded tab's stale publication is refused `PS_SNAPSHOT_REVISION_CONFLICT`; a stale board save is kept as the conflict record; and no cross-tab channel is used (`e2e/multi-tab.spec.ts`, 3 of 3, after four fixes of the spec's own premises and, on review, the fully stale tab's path restored; the product right on what was tested; the replayed revision saved in the browser storage the tabs share, INFERRED from the code, recorded); and the crash spec found a product defect, CONFIRMED and fixed test-first: a grant the server consumed for a page that closed before the answer was left in flight on reopen with no notice, the entry showing its pre-crash `executing` (a silent loss); the editor's recovery notice now names every grant left in flight that no ritual of the page holds as interrupted, and every editor load re-derives each reloaded, unsettled chat entry from durable truth - the sweep's reading of the journal and the server, or the profile journal's record of the grant's end - saying only what held at that load: interrupted, not started while the server holds the grant issued (never "not made" while another open tab may hold its card), committed once a commit is recorded, not made once the grant is closed, in progress in another tab when another tab moved its journal entry while the sweep read it, of unknown outcome naming a reopened canonical lineage as the cause - never a terminal "not made" the records contradict within the commit window (one exception stays, INFERRED and not run: a committing tab stalled more than 120 s past it, which a later tab's sweep closes as not made while the stalled tab's change still lands - OD-214's open item), the sweep writing only on a journal entry as it read it and answering only for the project the page showed when it started; once a record names its grant a reloaded entry no longer reads "awaiting the editor's result" (one no record names keeps B18's pre-crash "... awaiting the editor's result (interrupted by reload)", case 5), and a restored entry never offers the editor's one-step Undo (`b24-d2-crash-recovery` 1-10, red first; the cross-tab paths at the unit level only, and a window between the sweep's re-read and its write recorded as OD-214's open item); `e2e/crash-recovery.spec.ts`, 2 of 2 (its assertions red in the browser on two older code states - (a), and (b) alone, on the code before the review round; (a) on the round-2 code - and green on the final bytes, alone and in the default configuration: never applied twice, never lost without a notice, the entry itself saying so once the toast is gone), its settlement still waiting for a sweep after the commit window (once per lifecycle; a recorded limit); a real-store restart is BLOCKED (LB-14).
- [B24-D4, 2026-10-10] D24-30: CI's run 38061798204 on `1fe719e` failed `multi-tab` case 2 again. D3's diagnostic line showed B's board (R3 51.0 mm) stored over A's (50.5 mm) with no conflict record. The path (INFERRED for CI, CONFIRMED at the unit level): B's first nudge was saved alone, because two serialized commits outlasted the 600 ms autosave debounce; that board equalled A's newer copy, so the "unchanged" rule adopted A's token as B's own, and B's second nudge was judged untouched. Fixed in place in `app/lib/pcb/board-persistence.ts`. A write equal to another tab's newer copy now writes nothing and keeps the tab's base; a tab that loaded no copy still takes a copy of its very board, as at `1fe719e`. The checkpoint-restore adoption takes the stored copy only when it holds the restored board the editor hands it (`PcbEditor.tsx:602`, `:629`, in place). A tab's save is now refused whenever another tab wrote the stored copy after the copy its board derives from and the stored board is not this tab's board, whether the tab got that board by a load, a save or a restore. One exception is recorded open (INFERRED, low): a tab that loaded no copy, whose first save is an edit reproducing another tab's newer copy exactly. Tests: `b24-d2-working-copy` 9-13 (red first). The spec is unchanged; its CI run, in `page-browser-e2e-b24` since OD-30's split (the lead's option (b)), is the browser proof (`performance-and-reliability.md` section 29).

**D24-31 - FreeRouting and kicad-cli cleanup kills the direct child only, and nothing in CI measures orphans.** Requirement: B24-D `:1104`. Finding: section 2.6
(`autoroute/runner.ts:167, :172`; `kicad-cli-runner.ts:98`; at `50fe156` also `simulate/route.ts:268-274` and `worker.ts:74-133`, which since B22-A3 `e483838` run ngspice only through the diagnostic runner's tree kill, `diagnostic-runner.ts:407`). Severity medium.
**CONFIRMED**. Closes: in part B22-A3 (ngspice tree kill, OD-145) and B22-D's opt-in orphan case 14 (`b22-d-adversarial-live.test.ts:290`, not in CI); B24-D2 owns the FreeRouting and kicad-cli remainder; OCI cleanup BLOCKED (LB-10). Sources: B24D-11.
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`. B22-A3 (`e483838`) closed the ngspice half: `/api/simulate`, the smoke test and the Studio worker start no process, and ngspice runs only through the diagnostic runner's tree kill (`diagnostic-runner.ts:407, :422, :431`; `kill_unconfirmed`). B22-D's opt-in live case 14 (`b22-d-adversarial-live.test.ts:290`, skipped in CI) found no orphan in the lead's single run on 2026-10-02. FreeRouting (`runner.ts:167, :172`) and kicad-cli (`kicad-cli-runner.ts:98`) still kill only the direct child, and nothing measures their orphans. B22 left this open (D22-9, `final-verdict.md:100`), so B24-D2 owns it instead of consuming it from B22-A3.
- [B24-D2, 2026-10-09] D24-31: the FreeRouting and kicad-cli remainder is closed offline by B24-D2 (OD-145's method): both runners end the whole tree and settle on the child's exit or after the 5,000 ms confirm wait, and a kill whose exit was not observed is reported in each route attempt's evidence and in kicad-cli's bundle error and gerbers answer (`app/lib/pcb/process-tree.ts`; `b24-d2-process-cleanup` 1-8, with one real node process tree on win32). The live Java and kicad-cli orphan runs stay under LB-3 and LB-17, and OCI cleanup under LB-10.

**D24-32 - Accessibility and responsive behaviour are untested and largely unbuilt.** Requirement: B24-D `:1105-1107`. Finding: no a11y
tooling or assertion; no live region on the chat transcript (two `aria-live` regions in the app); an unlabelled canvas host; keyboard use
exercised only incidentally; the B17-A inventory does not audit accessible names; visible focus untested; hand-rolled BOM dialogs with no
programmatic focus (INFERRED); one Desktop Chrome project and one breakpoint class in `app/page.tsx` (section 2.6). Severity high (users of assistive
technology cannot follow an AI answer arriving). **CONFIRMED**. Closes: B24-D3 (OD-215). Sources: B24D-12, B24D-13, B24D-14.
- [B24-D3, 2026-10-10] D24-32: closed offline by B24-D3 (OD-215 applied; OD-237): the accessible-name rule over B17-A's control sites (`app/lib/engineering/accessible-names.ts`; closed statuses - eight name sources, six exemption reasons, `unnamed`; a placeholder, test id, name or id is never a name) and its byte-pinned census (`accessible-name-census.csv`, 628 sites / 63 surfaces) gate OD-215's scope at zero unnamed, zero structural problems and no name that is a glyph alone (six named red first on `3773c6a`, and the More checks button), and ratchet the rest (111 unnamed at `3773c6a`, pinned at 102 after D3 with a frozen key list in the suite that regeneration cannot move; the generator refuses a new one against the census committed at its repository path); the chat transcript is a polite `log` with `aria-busy`, the chat error and the provider refusal are `alert`s, focus returns to the prompt after a chat run sent from it unless a pointer was pressed since (a model run of the page's code, case 11), the two canvases are `role="img"` named by statements that name Go to component, the four BOM dialogs run on the shared dialog (named, focus inside, Escape, focus back, one shared Close and no glyph-only button; 16 jsdom cases, red first), and desktop only at 1,280 CSS px with a CSS-only notice below; two browser specs (`keyboard-and-focus`, 5 cases; `minimum-width`, 3), red on `3773c6a`'s code and green on the lead's runs (local, win32; `BROWSER_SPECS_EXECUTED` flipped, rows 2.1.1, 2.4.3 and 2.4.7 tested in part), case 1 measuring 95 Tab presses from AI Chat to the prompt (the chat follows the whole editor in the DOM and opening it does not move focus: a 2.4.3 / 2.4.1 gap, recorded); one review round, six findings fixed test-first. Residuals: no assistive-technology run and no axe audit (owner actions, NOT MEASURED); contrast (1.4.3) NOT MEASURED; 1.4.10 Reflow NOT MET by OD-215's desktop-only scope; 2.5.7 Dragging Movements NOT MET for the panel resizers (`app/page.tsx:6288`, `:6471`); 2.4.2 NOT MET (the title "Create Next App", `app/layout.tsx:20`); 102 out-of-scope unnamed sites (the census); handler-less focusable controls outside the census (4.1.2; the rule was not extended in scope); the Tab trap measured on the Tier 1 card only (section 8 item 10); the four non-BOM hand-rolled dialogs (`SyncPlacementDialog`, the routing rules editor, `FabDialog`, `ShortcutsHelp`); the canvases accessible only through Go to; the chat prompt 95 Tab presses after its opener with no skip link (2.4.3, 2.4.1).
- [B24-D4, 2026-10-10] D24-32: CI's run 38061798204 failed `keyboard-and-focus` case 4 with focus on `body` after Escape on the Tier 1 card; the INFERRED fallback to the header's first button was the defect. When the card closes with the prompt enabled, it now returns focus to the prompt through its `finalFocus` (`GrantedExecutionDialog.tsx:55`, in place). When the prompt is still disabled (the card closed while its run streams), the card moves no focus (`:125`), so focus stays on `body` until page.tsx's run-end return takes it to the prompt. Tests: `b24-d3-bom-dialogs` 5 and 6 (Escape, Cancel and Confirm; red first; case 6 runs page.tsx's run-end code over jsdom). Case 4 asserts focus on the prompt (`keyboard-and-focus.spec.ts:235`, stricter, PROPOSED until the lead's browser run; `accessibility.md` sections 4, 7 and 12). A pointer close during the run leaves focus on `body`, by B24-D3's pointer rule (INFERRED, low).

### B24-E - live and physical gates

**D24-33 - The live-blocker register is not in B24-E's vocabulary, LB-4 is stale, and gates have no row.** Requirement: B24-E `:1123`;
section 4 `:1210`. Finding: section 2.7 (`LIVE_BLOCKERS.md:7-18`); LB-4 contradicts the 2026-09-24 run (section 0); no rows for staging and
production, the database platform, the distributor contract, a live external MCP server or the kicad-cli oracle; `PROGRAM_STATE.json` lists
eight of twelve (`:12-21`; OD-179 leaves LB-4, LB-6, LB-7 and LB-8 out on purpose). Severity medium. **CONFIRMED**. Closes: B24-E (OD-217). Sources: S5-G5, S6-G3, S6-G4, S6-G5, G24B-11.
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`. The register now has twelve rows (`LIVE_BLOCKERS.md:7-18`): B22-A2 `c037627` added LB-10, B23-A1 `79fa18b` added LB-11/LB-12 (OD-179), and B23-D `dfd51e3` put a dated note on LB-5. `PROGRAM_STATE.json` now mirrors eight of the twelve (`:12-21`); OD-179 leaves LB-4, LB-6, LB-7 and LB-8 out on purpose. The gap stands. LB-2 is still UNKNOWN, LB-3 local-only, LB-4 "dead external resource" (B22's `artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:174` repeats it as unchanged) and LB-5 "not attempted". Staging/production, the database platform, the B19-E distributor contract, a live external MCP server and the kicad-cli oracle still have no row. LB-13..LB-17 and OD-217 remain free.
- [B24-E, 2026-10-10] D24-33: closed by B24-E (OD-217 applied in full): every register classification takes one of `BLOCKED-LIVE-QUALIFICATION`, `QUALIFIED (date, scope, resource)` or `NOT APPLICABLE` (LB-2 and LB-5 BLOCKED, LB-3 BLOCKED for CI and qualified platforms, LB-4 QUALIFIED 2026-09-24 non-isolated with isolated staging BLOCKED under LB-14), each old wording kept in its cell; LB-13..LB-17 checked with dated notes, no row added; `PROGRAM_STATE.json` mirrors every row (OD-179 reversed); the qualification matrix Q1..Q15 covers every LB both ways; `b24-e-register` (10), `b24-e-statements` (7: negation read only where it governs a statement, one find allow-listed, one reviewed negation, eight in-place notes, four finds left for the closeout); qualification-matrix.md.

**D24-34 - No browser spec runs in production auth.** Requirement: B24-E `:1116`; B24-A `:1032`. Finding: every Playwright run is
`local_dev` (`playwright.config.ts:50`); the live auth gate is fetch-based (`b16-1b-live-qualification.test.ts:86-96`). Even with a staging
project, item 2 cannot run today. Severity medium. **CONFIRMED**. Closes: B24-E writes the spec and its config offline; the run stays
BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13; whether an isolated project exists is OD-191's). Sources: S5-G1, G-A3.
- [B24-E, 2026-10-10] D24-34: offline: the config and the spec are written; the run is BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13; OD-191). `playwright.production-auth.config.ts` throws `PRODUCTION_AUTH_NOT_EXERCISED` unless `resolveProductionAuthTarget` answers ready over the empty staging list; `e2e-production-auth/production-auth.spec.ts` and its form steps `e2e-production-auth/sign-in-form.ts` sit outside both CI browser folders; `b24-e-production-auth-config` (8); qualification-matrix.md part 1.

**D24-35 - Nothing can record fabrication, inspection or functional-test evidence.** Requirement: B24-E `:1120-1121`; `:1157`. Finding: no
admitted upload or order path (B23's upload behind `POST /api/pcb/provider-exchange` is refused for every provider; the order contract has no wired port), no recorded fabrication approval (OD-8), no physical-evidence store or route; `manufacturing.assembled-release`
is `missing` (`action-registry.ts:118`); the CD-11/12/13 measurement and claim functions have no production caller; B23-D defines the model (`physical-evidence.ts`: eight kinds, validators, an unwired review port, eligibility blocked for every input)
(OD-175, `OWNER_DECISIONS.md:2431`; OD-176, OD-177, OD-187). Severity medium. **CONFIRMED**. Closes: OD-218 (default: nothing built until the owner approves fabrication and supplies
hardware; BLOCKED-LIVE-QUALIFICATION, LB-5). Sources: S5-G8, S5-G7.
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`. B23-D (OD-175/176/177/187) closed the "model" part: `physical-evidence.ts` defines eight closed kinds (`sirkit.physical-evidence.v1`) with validators and a server-derived review port, `PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING` is 'none', `assembledProductEligibility` is blocked for every input, and no production module imports it. B23-D also pinned the five CD-11/12/13 functions callerless (`b23-d-latent-claim-paths`) and kept `manufacturing.assembled-release` 'missing' (`action-registry.ts:118`). B23-B/C added an upload path (`provider-egress.ts` behind `POST /api/pcb/provider-exchange`) that admission refuses for every provider, and an order contract with no wired port. Nothing can record physical evidence yet: the store, the recording route that derives the reviewer from the session, and the wired review port are B24-E's under LB-5, and OD-218 should name all three.
- [B24-E, 2026-10-10] D24-35: as recorded: OD-218's default applies, nothing built, items 6 (fabrication) and 7 BLOCKED-LIVE-QUALIFICATION (LB-5); qualification-matrix.md Q7, Q8.

**D24-36 - The deterministic 555 release is time-bound.** Requirement: B24-E `:1120` (repeatable release). Finding: section 2.7
(`rule-profile.ts:27-28, :45-48`; `release/route.ts:185-189`): from about 2027-09-09 a real-clock release refuses until the jlcpcb-2l
profile is re-retrieved; the pinned identity reproduces only under the frozen clock (`expected-identities.json:3`). Severity low.
**CONFIRMED**. Closes: OD-219 (recorded; renewal is an owner action and a reviewed code change). Sources: S5-G10.
- [B24 lead, 2026-10-06] Re-verification (section 9): Re-verified at `dfd51e3`: `rule-profile.ts:27-28, :45-48`, `release/route.ts:50-51` and `expected-identities.json:3` hold. The release-instant expiry check moved to `release/route.ts:185-189`, inside the exported `revalidateReleaseAuthority` (`:145`, B23-B1 `0c78e93`), which the provider exchange also runs. B23 added more dependents of the 2027-09-09 expiry: OD-168 observation staleness (`provider-observation.ts:238-239`) and the registry's reviewed jlcpcb-2l mapping (`provider-registry.ts:180-186`). Renewal is therefore a reviewed code change as well as an owner action. It would move the registry row, three suites' date pins and (INFERRED from `release-manifest.ts:137`) the pinned release identity and its fixture clock.
- [B24-E, 2026-10-10] D24-36: as recorded (OD-219): the expiry is pinned - valid through 2027-09-09, a real-clock release refused from 2027-09-10T00:00:00.000Z UTC (`b24-e-register` 10); renewal is an owner action and a reviewed code change; qualification-matrix.md Q6.

### B24-F - final product verdict

**D24-37 - No generator joins the coverage matrix, the permission and autonomy matrix or the agent graph, and the generators themselves
have no inventory.** Requirement: B24-F `:1131-1133`. Finding: the pieces are separate generated files (B17, B01, B04, B09, B20) and code
data (role table, DAG lists, caps); no script imports `role-tools`, `permission-tiers` or `DAG_ROLE_LISTS` (reader 7); no artifact renders the
decision over tier x autonomy mode x role x tool; no regenerate-all command and some outputs unpinned (section 2.8). Severity medium.
**CONFIRMED**. Closes: B24-F (OD-220). Sources: G7-1, G7-2, G7-3, G7-9.
- [B24-F, 2026-10-10] D24-37: closed by B24-Fa (OD-220): `scripts/generate-b24-maps.ts` renders the six derived maps of `artifacts/ai-control-plane-b24/` - `trust-boundary-map.md`, `current-system-map.md`, `coverage-matrix.csv`, `agent-graph.md`, `permission-autonomy-matrix.csv` (the registry's role gate beside the tier function's decision) and `generator-inventory.md` (28 generators; each output's pinning suites, checks and pin class derived from the test files) - byte-pinned by `b24-f-maps` (10) and checked by `b24-f-generator-inventory` (6); the regenerate-all and drift command recorded, not built (OD-220).

**D24-38 - The hand-written current-system, permission and database pages are stale.** Requirement: B24-F `:1130`, `:1133-1134`; section 4
`:1194`. Finding: section 2.8 (153/12; 155/97/143/573; 29 migrations; three `externalProcess` rows wrong until B22-A2 corrected them in `c037627`); until B23-A2 (`da36d51`) no artifact listed
outbound egress per route or module (reader 7; now the CSV's CI-pinned `outbound_egress`/`model_egress` columns, `b23-a-route-vocabulary.test.ts:667`, and `tier3-vocabulary.md:210-236`); the pre-program B15 and B16.0.7 verdicts still headline INCOMPLETE (reader 6, matters only if
cited). Severity medium. **CONFIRMED**. Closes: B24-F (regenerated or re-derived from tests, never hand-counted). Sources: G7-4, G7-5
(pages), S6-G10.
- [B24 lead, 2026-10-06] Re-verification (section 9): Partly closed. Three pages are unchanged, unpinned and carry no superseding note: the B16.1C map (`:18`, 153/12), the B18 page (`:30`/`:37`, 155/97/143/573/58) and the B16 closeout DB proof (`:14`/`:16-17`, 29 migrations). The current values are 166/163/3/0, 36 of 47 tools, 106 records, 152 B01 route paths, 631 controls on 63 surfaces and 31 migrations. B22-A2 (`c037627`) corrected the three `externalProcess` rows. B23-A2 (`da36d51`) closed the outbound-egress gap: the classification CSV carries `outbound_egress` and `model_egress` on all 166 rows, CI-pinned by `b23-a-route-vocabulary.test.ts:667`, and `tier3-vocabulary.md:210-236` lists the transport modules and per-route egress. B24-F should derive its maps from these.
- [B24-F, 2026-10-10] D24-38: in part: the derived maps and the superseded table - `current-system-map.md` derives every reviewed count beside its pin and lists the stale lines of the three hand-written pages (`b24-f-maps` 8, 9), and `open-risks-and-owner-decisions.md` section 3 gathers every B24 increment's superseded statements into one table of 206 rows, eight of them marked never noted in place (six checksum-bound migrations, two lines of a B11-scanned file); the stale pages' in-place notes are closeout 1/2's.

**D24-39 - No threat-model register exists to close.** Requirement: B24-F `:1139`. Finding: section 2.8; no closure register exists; B03.1's `security-boundary.md` (the "Full threat model" of `revision-history-contract.md:120-121`), the CD-10 stage report (`docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md:55`) and B22's `threat-model.md` and `adversarial-matrix.md` are chapter-scoped threat models, B09 and B13 have security-boundary statements of the same kind as B03.1's, and the other chapters were not
threat-modelled as such. Severity medium. **CONFIRMED**. Closes: B24-F writes the register by hand from the per-chapter defect tables
citing those threat models as inputs and claiming no others (OD-220). Sources: G7-7.
- [B24 lead, 2026-10-06] Re-verification (section 9): Stands with a corrected finding: no threat-model closure register exists anywhere (`git grep`). B22-A2 (`c037627`) wrote `artifacts/ai-control-plane-b22/threat-model.md` (threats, controls and tests `:117`; residual risk `:140`), and B22-D (`c9fbbb0`) wrote the adversarial matrix with residuals (`:174`). Before B22, B03.1's `security-boundary.md` (called "Full threat model" at `revision-history-contract.md:120-121`) and the CD-10 stage report's `## Threat model` (`docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md:55`) already existed. B24-F's register cites these as inputs and must not imply that no earlier threat modelling exists.
- [B24-F, 2026-10-10] D24-39: in part: the list and the risks - `threat-model-closure-register.md` closes the seven numbered registers, 189 rows (132 closed, 20 closed in part, 21 closed as recorded, 12 open, 4 BLOCKED-LIVE-QUALIFICATION), from B03.1's, B09's and B13's security boundaries, the CD-10 threat model and B22's threat model and adversarial matrix, claiming no threat modelling for any other chapter (`b24-f-registers` 1-3); OD-5/OD-19 and the integrity measurements are the closeout's.

**D24-40 - The program's own records and hygiene would not support the final report as they stand.** Requirement: B24-F `:1140-1141`;
section 5; `:162-171`. Finding: no single open-decision list; OD-5 stale and OD-19 undercounted; B23's OD-160 and OD-178 not recorded as
headings (section 2.8); CI runs no eslint and `app/page.tsx` carries 14 errors fixed only on an unmerged branch (B21 verdict `:133-135`);
four corrective branches and the history-reconstruction branch unmerged (section 2.8); the integrity lines (`SECRETS EXPOSED`, `PROTECTED
ORIGINAL MODIFIED`, `HISTORY FABRICATED OR BACKDATED`) rest on process only. Severity medium. **CONFIRMED**. Closes: B24-F and the
closeout (OD-221). Sources: S6-G6, S6-G7, S6-G9.
- [B24 lead, 2026-10-06] Delta after B23's closeout (`b6c6b0d`, `f663d71`): OD-178 and OD-160 are now recorded (`OWNER_DECISIONS.md:2536`, `:2560`), and OD-188 is spent (`:2545`); the rest of the finding stands.
- [B24 lead, 2026-10-06] Re-verification (section 9): Partly closed. Every OD-134..OD-159 is now a register heading (B22's, except SEC-1's OD-151 and OD-152; headings now end at OD-187, `:2463`; OD-153 moved to `:1696`), and `chapter/b22-sandboxed-computation` merged as `43cb1b0` (PR #13). OD-181..OD-189 are reserved at `EXECUTION_LEDGER.md:4344`, and no OD-190+ or LB-13+ is recorded (B23-C's tests use only a fake `OD-999`), so no renumbering is needed. Still true: OD-5 is stale (`:11`); OD-19 counts 54 commits under the other address where there are 54+11; there is no single open-decision list; CI runs no eslint; `app/page.tsx` is unchanged and its fix `5dfae2b` is unmerged; four fix branches and the reconstruction branch (162 commits) are unmerged; and the integrity lines rest on process only. B23's OD-160 and OD-178 have no heading, and the five PR merge commits #9-#13 are authored by a GitHub noreply address.
- [B24-F, 2026-10-10] D24-40: in part: the list and the risks - `open-risks-and-owner-decisions.md` lists OD-1..OD-241 with every gap and duplicate marked (`b24-f-registers` 4), the open risks and the three integrity lines' methods, and `final-verdict.md` holds the ten scope lines and the status-line -> row table (`b24-f-verdict-lines`); OD-5/OD-19 and the integrity measurements are the closeout's.

Count: 40 defects; 12 high (D24-1, 2, 3, 5, 7, 8, 14, 17, 20, 21, 29, 32), 23 medium, 5 low (D24-6, 10, 25, 26, 36). Not carried as B24
defects because another chapter owns them: the README and quickstart JLCPCB claim (B23 D23-16, OD-178), D22-18's `externalProcess` rows
(B22-A2), sandbox isolation (B22, LB-10), the DFM/quote and ordering paths (B23).
- [B24-B2 lead, 2026-10-08] Count amended: 42 defects. B24-B2 opened D24-41 and D24-42 (both medium): 12 high, 25 medium, 5 low.
- [B24-B2 lead, 2026-10-08] **D24-41 - The benchmark corpus has no executor for CD-9, so three of its packages fail correctness.** Requirement: OD-204's corpus in the nightly job (B24-B2). Finding (B24-B2 lead, 2026-10-08): `app/lib/benchmark/builtin-executor.ts` dispatches every CD-5..CD-12 operation to its domain's `benchmark.ts` executor except CD-9: `circuit_verification_manifest`, `_authority` and `_scale` fall to its `default`, which answers `{ sourceImmutable: true }` with the note "no full production QoR executor yet", and the oracles of `corpus-v1.ts:121-123` refuse it; no `app/lib/circuit-verification/benchmark.ts` exists. `b24-b2-corpus-nightly`'s local flagged run is red on `cd9-verification-manifest`, `-authority` and `-scale` (`failed_correctness`; 51 passed, 2 blocked, 5 failing of 58). Severity medium. **CONFIRMED** (executed at the B24-B2 tree). Closes: B24-D1 (the lead decision under OD-204): a CD-9 executor written test-first, every expected value derived from the CD-9 modules, never typed.
- [B24-B2 lead, 2026-10-08] **D24-42 - A delete removes a whole wire that also joins surviving pins, and names no net.** Requirement: OD-205 (power and ground preserved by every agent verb unless the sealed proposal names the net). Finding (B24-B2, 2026-10-08): the delete plan (`app/lib/engineering/schematic-plans.ts:90-98`) removes every wire with an end on a deleted pin; a wire whose interior vertex lies on a surviving pin is removed with it, so the survivors it joined are split. `b24-b2-power-ground` case 9: R4's wire runs through C5's pin to C6's GND symbol, and a sealed agent delete of R4 takes C5 off GND while the sealed impact lists only the wire id. The same planner serves the agent's Tier 1 delete (`gateway.ts:330`, through `compileTier1Proposal`) and the user's own delete (`app/page.tsx:3616`). Severity medium. **CONFIRMED** (executed). Closes: the owner's decision (OD-229); until then the catalog's power-ground x deterministic offline row is `failing`.
- [B24-D2 lead, 2026-10-10] Count amended: 43 defects. B24-D2's review opened D24-43 (high): 13 high, 25 medium, 5 low.
- [B24-D2, 2026-10-09] **D24-43 - A strict-mode provider cannot call a read whose optional arguments it leaves unset.** Requirement: B09's strict rendering ("previously-optional fields become nullable ... so optionality survives strict mode without semantic drift", `app/lib/agent/provider-tools.ts:11-12`) and D24-29's paged read (OD-213). Finding (B24-D2 review, 2026-10-09; CONFIRMED by `b24-d2-board-read` 9 through the real loop and gateway): the strict renderer makes every optional property required and nullable (`provider-tools.ts` `convert`), the loop passes the arguments unchanged (`loop.ts:431-433`), and B05's `validateAgainstSchema` refuses `null` for a string or a number (`tool-io-validation.ts:118`, `:126`), so `sirkit.pcb.board-page-inspect` (at least five nulls in every strict call) and `sirkit.pcb.via-inspect` (`{"netName":null}`) answer `invalid_input` before their builders run; the MCP path already reads such a `null` as absent (`app/lib/mcp/server/read-arguments.ts:6-7`, `:139`); every other tool with an optional property on the agent path is INFERRED to share it. Severity high: D24-29's read is unusable by a real provider. Proposed fix: OD-236; owner: the increment the lead names.
- [B24-D1, 2026-10-09] D24-41: closed offline by B24-D1 (OD-204): `app/lib/circuit-verification/benchmark.ts` exports `executeCircuitVerificationBenchmark(operation)` and `builtin-executor.ts` dispatches the three CD-9 operations to it beside CD-8's; every value is derived from the CD-9 modules (the manifest and its digest; `humanReviewer`, `evaluateCircuitReadiness`, `createCircuitWaiver` and `classifyNativeErcCorroboration` over one full oracle run on a benchmark graph; the approved profile's `maximumRuleInstances`, a selector cut at the profile's limit, one evaluator failing `failed_isolated`). The flagged corpus run is green (`d1-green-corpus-flagged-2`: 54 passed, 2 blocked, 2 failing of 58, the two baseline-recorded failed_correctness packages only; red first on `d1-red-corpus-flagged-1`).

---

## 5. Obligations kept verbatim (with the pinning test for each)

From the runbook (`C:/Users/robsa/Downloads/Sirkit_Remaining_Builder_Master_Runbook.md`):

- `:1025` "This is the final code-and-evidence chapter, not permission to overstate physical validation." No pin today; B24-F adds a
  statement tripwire (no page, README or UI string claims a live, staging or physical qualification the B24-E matrix does not hold).
- `:1044` "Never reuse production data in tests." Partly pinned: the empty-target refusal in `b16-b-postgres-qualification.test.ts:36`;
  `schema-integrity.test.ts` is unguarded (D24-12). B24-A4 adds one shared guard and a test that every DB-gated suite uses it.
- `:1070` "Classify each evaluation as deterministic offline, model-in-loop, browser E2E, database-backed, external-provider staging or
  physical-hardware validation. Keep scores separate so a fake-backed pass cannot hide a missing live test." Partly pinned: B21-F's class
  columns derived from the live command (`b21-f-replay-capsule.test.ts:173-181`, reader 2) and the register header "a fake-backed pass is
  never reported as a live pass" (`LIVE_BLOCKERS.md:3`). B24-B1 pins the six-class catalog.
- `:1088` "Do not store hidden reasoning. Redact secrets and sensitive source content. Replay against immutable snapshots must never mutate
  current state unless a new explicit approval begins a new transaction." Pinned by the B11 trace and replay suites (reader 6:
  `b11-trace-replay-evaluation.test.ts:82`, `b11-1-trace-integrity.test.ts:445-448` - both outside CI, D24-15) and
  `b21-a-contracts.test.ts:4, :27` (reasoning-shaped stems, in CI); `app/lib/agent/trace.ts:5-13` states it.
- `:1109` "Replace fragile wall-clock unit thresholds with stable benchmark methodology where appropriate, without hiding real regressions."
  No pin; B24-D1 adds the benchmark job and converts cases one by one, each conversion recorded.
- `:1113` "When credentials and hardware are explicitly supplied:" and `:1123` "If any resource is unavailable, mark that gate
  `BLOCKED-LIVE-QUALIFICATION`; do not convert a fake-backed result into a live claim." Process plus the register; B24-E pins the register
  vocabulary (every row one of a closed set) and that every live suite records "exercised" or "not exercised".
- `:1120` "Produce the deterministic 555 release and fabricate only after separate owner approval." The release identity is pinned
  (`expected-identities.json:15-17`, `app/lib/workflow/prompt-to-gerber/__tests__/acceptance-pipeline.test.ts:419-421`, reader 6); fabrication approval is process only (OD-8,
  `OWNER_DECISIONS.md:14`).
- `:1157` "“Application complete” may be claimed only for the scopes whose gates actually pass. Physical product completion requires
  physical evidence." and `:1266` "Stop after this final report. Do not claim completion beyond the evidence." Process only; B24-F pins the
  ten readiness lines to the qualification matrix by a generated check.
- `:1159` "merge normally only if all applicable gates pass" with `:166` "Do not rewrite main or force-push." and `:171` (no force-push,
  history rewriting, access or billing change, live purchase or production data destruction). OD-8; process only.
- `:138` "Never accept browser-authored or model-authored state as canonical merely because it has a plausible shape or digest." Pinned by
  the release and qualification human-only suites (`app/api/pcb/qualify/__tests__/qualify-human-only.test.ts`, in CI) and B16-A release
  confirmation (reader 6).
- `:144` "Never tell a human that a design, part, simulation, DRC result, Gerber package, quote, order, assembly, or physical board is
  verified beyond the evidence actually obtained." and `:146` "“Gerbers generated” does not mean fabricated, electrically certified,
  ordered, assembled, or safe." Pinned for the release panel by `app/components/pcb/__tests__/manufacturing-workflow-panel.test.tsx:148`
  ("not a fabricated, ordered, assembled, or electrically certified board"); the archive README sentence "No manufacturer upload/order has been
  performed. External board-house DFM and physical prototype review remain mandatory." (`app/lib/pcb/fab/release-gate.ts:272`) sits inside
  the pinned release bytes (INFERRED).
- `:147` "Missing evidence must remain missing or unknown; never invent a pass." Pinned for CD-10 by `app/lib/model-simulation/__tests__/foundation.test.ts:52` (reader, B22
  discovery section 5); B24-B1 pins it for the catalog (a blocked class is never a pass).
- `:148` "Qualification, release, uploads, purchasing and ordering must never be smuggled through a lower-tier tool or a generic execute
  path." and section 4 `:1199` "Tier 3 cannot be agent-approved or silently executed;" Pinned by `b18-a-permission-tiers.test.ts:44-64,
  :84-93`, `b18-c-never-execution-sweep.test.ts:63-88`, `b20-b1-mcp-exposure.test.ts:382`, `b21-c-role-tools.test.ts:81` (reader 6), and
  `b16-1c-invariant-tripwires.test.ts:56-60` (no exposed qualify or release tool; the release descriptor not callable).
- `:152` "Never expose credential values, tokens, cookies, connection strings, private keys or secret-bearing request bodies." and `:153`
  "Secrets remain server-side and are projected to the least-privilege client/adapter shape." Pinned per surface (B22 discovery section 5;
  the B20 secret-hygiene suites, reader 6); B24-A2 adds a CI secret scan.
- `:155` (SSRF, redirect escape, oversized bodies, unbounded streams and tool loops; it names no rate bound; for the upload path pinned by `b23-b-bounded-upload`); `:157` "No generic model-facing shell, SQL, migration, filesystem-write or process-spawn tool." Pinned by
  `b17-f-agent-exposure.test.ts:71` and `b20-b4-process-gate.test.ts:37-44` (case 1 `:209`; the spawner list rewritten by `e483838` and `b4c7be7`) (reader 6).
- `:158` "Preserve same-origin CSRF protection, authenticated server-derived identity, membership and role checks, bounded readers,
  cancellation and one-terminal-event semantics." Pinned by the B16.0 gates (reader 6) and the B11.1 route finalization suite (outside CI,
  D24-15).
- `:162` "Use real current timestamps. Never fabricate or backdate activity."; `:164` the identity `Dandi Desta <dandidesta82@gmail.com>`;
  `:165` "Do not add Claude, Anthropic, Codex, OpenAI or other AI co-author trailers."; `:168` "Run a staged-content secret scan before every
  push." Process only: every non-merge commit since `5a59a1f` (109 of 109 at `dfd51e3`) uses the approved address, the five GitHub PR merges carrying the GitHub noreply author, and none since `62ea4a6^` has a trailer (section 2.8).
- Section 4 `:1209` "`C:\Users\robsa\sirkit` remains untouched;" Process only (`EXECUTION_LEDGER.md:5`, reader 6); the final report's line
  needs a recorded check at closeout.

From the code (verbatim, must stay true; pinning test named):

- The census 166/163/3/0 (`b16-1c-invariant-tripwires.test.ts:38, :48`; `0c78e93`, OD-174) and the counts 47/36/9/27 (`b20-c1-three-way-parity.test.ts:241`; `b4c7be7`, OD-139),
  moved only by review (B22-B and B23-B1 moved them by review).
- `app/api/model-simulation/execute/route.ts` "CD-10 authoritative runner is blocked until the sandbox image/executable and environment
  corpus are independently validated" with 409 and 501 (`b16-0-20-simulation-confinement-gate.test.ts:90-96`); since `a269e7a` every well-formed human request ends 409, so the 501 text is kept but unreachable (also pinned in CI by `b22-a2-blocked-runner` case 3 and `b22-c-authority` case 3).
- The nine B11-scanned files carry no orchestration identifier (`app/lib/agent/orchestration/tripwires.ts:9-22`) and keep their sha256
  (`b21-e2b-trace-attribution.test.ts:42-53`); OD-113.
- `trace.ts:5-13` "It NEVER contains API keys/credentials/environment values, raw provider request/response bodies, hidden reasoning or
  thinking blocks, provider continuation state" (pinned by the B11.1 integrity suite, outside CI, D24-15).
- The pinned release identity (`expected-identities.json:15-17`) and "No manufacturer upload/order has been performed."
  (`release-gate.ts:272`).
- `CHAPTERS` admission (`b19-e-ci-job-scope.test.ts:54`), already extended with `b23-` (`79fa18b`, OD-180); `b24-` remains (OD-222).
- OD-30's split rule (`OWNER_DECISIONS.md:104-108`; `deterministic-manufacturing.yml:319`; no test).

Owner decisions that bind B24 (`artifacts/remaining-builder-program/OWNER_DECISIONS.md`): OD-6, OD-7 (resources), OD-8 (`:14`), OD-19
(`:31-35`), OD-30 (`:104-108`), OD-42 (no new dependency), OD-48 (empty MCP allowlist), OD-54 (MCP off), OD-59/OD-124/OD-146 (CI
admission), OD-82/OD-87 (no proposal over MCP), OD-102 (no live external MCP contract), OD-107 (budgets reported, not priced), OD-111
(`:1077-1098`), OD-113 (`:1634-1645`), OD-125 (`:1611-1631`), and the B22 and B23 records OD-134 (`:1705`), OD-138 (`:1879`), OD-147 (`:1720`), OD-158 (`:1862`), OD-167 (`:2182`), OD-171 (`:2338`), OD-174 (`:2034`, `:2127`), OD-175 (`:2431`), OD-177 (`:2453`), OD-179 (`:1970`) and OD-180 (`:1978`), with OD-160 still a B23 discovery row (`artifacts/ai-control-plane-b23/discovery.md:767`).

---

## 6. Owner decisions needed (OD-190 onward) with a safe default each

No production deployment, production data or live resource is assumed anywhere; every live and physical gate is
BLOCKED-LIVE-QUALIFICATION until the owner supplies the resource in writing; nothing is deployed to any environment by the builder.

| OD | Question | Safe default (applied unless the owner says otherwise) |
|---|---|---|
| OD-190 | The hosting platform and environment topology (development, CI, staging, production). | None assumed. B24-A1 adds a closed environment profile (`SIRKIT_DEPLOYMENT_ENV` in `development`, `ci`, `staging`, `production`; in a production runtime anything but `staging`/`production` refuses to start serving sensitive routes) and a CI job that runs `next build` then `next start` in production mode with no Supabase configuration and proves the fail-closed answers. No deployment file for a specific platform is written; staging and production are BLOCKED-LIVE-QUALIFICATION (LB-13), and under this default B22's LB-10 stays blocked too (B22 `final-verdict.md:17, :124`). |
| OD-191 | Is the "main Supabase project" authorised on 2026-09-24 production, and will an isolated staging project exist? | B24 treats the main project as production: no B24 test, script or run touches it (runbook `:1044`). The 2026-09-24 database run is recorded as "real-server qualification on a non-isolated project", not staging. Staging auth stays BLOCKED-LIVE-QUALIFICATION (LB-1) until an isolated `sirkit-auth-qualification-*` project and account exist. |
| OD-192 | Least-privilege roles and RLS. | B24-A4 writes, and proves only on PGlite, a reviewed migration that enables RLS with no policy on every table except `project_members` (deny-by-default for the Data API roles; the server's owning role is unaffected) and records a proposed application role with table-level grants; nothing is applied to a live database by the builder; the server keeps one `DATABASE_URL` until the owner provisions a role. TLS is required for every non-loopback database URL. |
| OD-193 | Migration rollback policy. | Reviewed DOWN SQL, as executable sections, for B24's own migrations and for 0027-0030 where reversible; `db:migrate -- --rollback <name>` runs reviewed DOWN SQL for the newest applied migrations only, one transaction each with its ledger row; earlier migrations are declared forward-only (rollback = restore). Proven apply -> rollback -> re-apply on PGlite in the database-delivery job; real-server rollback BLOCKED (LB-14). |
| OD-194 | Backup, restore, point-in-time recovery and failover evidence. | B24-A4 writes a recovery runbook and proves a logical dump and restore of a migrated schema with fixture rows on PGlite, plus a connection-loss case that fails closed; Supabase plan, PITR window and failover are BLOCKED-LIVE-QUALIFICATION (LB-14) and never claimed. |
| OD-195 | Secrets management and rotation. | No secret-manager dependency (OD-42). The worker secret, KiCad token and MCP signing key each accept an optional `*_PREVIOUS` value for verification only (signing and issuing use the current value; the MCP header stays byte-identical); `.env.example` declares every name the code reads, with no value, the ten B22/B23 names included; B23-C's caller-supplied webhook secret (`order-contract.ts:107`) and B23-B2's provider credential header (`provider-egress.ts:198-201`) are recorded as single-valued, the webhook secret unwired and the credential header reached only past admission with no transfer descriptor; a CI step scans the tree for PEM markers and provider key shapes. |
| OD-196 | Security headers and origin allowlists. | Enforced on every path: `frame-ancestors 'none'` and `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, a minimal `Permissions-Policy`, `poweredByHeader: false`, HSTS only when `SIRKIT_EXPECTED_ORIGIN` is https; `default-src`/`script-src`/`connect-src` shipped as `Content-Security-Policy-Report-Only` until the owner accepts an enforced policy; each asserted in `e2e/security-headers.spec.ts`. The required Supabase Site URL and redirect list per environment are written down; verified only in staging (LB-1, LB-13). |
| OD-197 | Rate limits and abuse controls. | No new dependency; per-process fixed windows (stated as per-process): the two public embedding routes (a global window per route, plus per-client only when a trusted proxy header is configured), sign-in, `/api/chat` per principal, the placement preview (with a hard compute bound); the two embedding routes go through the LLM admission meter under an `embedding` key; their policy rows declare provider credit and `expensive`; a gate that every provider-credit, expensive or public `model_egress` route (B23-A2's `PUBLIC_MODEL_EGRESS`, OD-174) has an enforced limiter, moving B23's `b23-a-route-vocabulary` pins (`:679`, `:817-819`) by review. The routes stay public; requiring auth is the owner's alternative. |
| OD-198 | Health and readiness. | `GET /api/health` public liveness (static, no detail) and `GET /api/ready` on the internal-worker class (worker secret) reporting, by NAME only, the auth mode, Supabase and expected-origin configuration, a bounded database probe and provider-key presence; never a value. The census moves once by review (+2 methods, 166 -> 168); each new row states `externalTransfer` and `spend` and gets derived `outbound_egress`/`model_egress`; `/api/ready` checks key names only and binds no SDK client; its row comes from a reviewed read-only constructor or override, not `worker()`, which hard-codes `authoritativeWrite: true` (`route-policy.ts:77-79`). |
| OD-199 | Versioned provider and tool configuration. | One frozen, digest-bearing `sirkit.deployment-configuration.v1` record built at start-up (provider, model, reasoning effort, role table, registry digests, flag states, names only), its digest reported by `/api/ready` and attached to new trace records outside the hash-pinned files; `/api/ai/runtime` reads `configuredAnthropicModel()`; an empty model value refuses rather than being sent. |
| OD-200 | Feature flags for MCP, the sandbox and external manufacturing. | One flag inventory module listing every `SIRKIT_*` flag, its default and its direction, pinned by a test; the sandbox gets an off-only operator kill switch (it can disable B22's diagnostic runner, never enable production simulation); external manufacturing keeps B23's off-only `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS` and `SIRKIT_ORDERING_DISABLED`, listed in the inventory with `SIRKIT_NAMED_COMPUTATIONS` and `SIRKIT_MCP_DISABLED_SERVERS`; MCP keeps its exact-"1" flag. |
| OD-201 | The test-data guard. | One shared helper refuses any DB-gated suite whose target is non-empty before its first write, and every DB-gated suite uses it (a test pins the list); `schema-integrity.test.ts` scopes its deletes to its own run's ids; the acceptance driver refuses unless its server reports the fixture runtime or an explicit disposable marker. |
| OD-202 | Retention and deletion. | Policy as data: run traces, specialist traces and MCP traces 90 days; resume-record answer text 30 days; grants, release ledger, binding and catalog audit records, B22-C's `computation.evidence.v1` (OD-141), B23-B2's `mfg.provider-exchange.v1` (OD-167) and B23-B3's provider observations (OD-168) kept until the owner decides; deletion only through an operator CLI that is dry-run by default and refuses in a production runtime without an explicit confirmation; proven on PGlite; never run by the builder against a live database. |
| OD-203 | Where the golden catalog lives and how classes are typed. | A new module outside the nine B11-scanned files (proposed `app/lib/evaluation/`) with a closed six-class enum and a versioned `sirkit.golden-eval-catalog.v1`: one row per area x class, each linking existing suites or naming the missing one; generated and byte-pinned; scores per class, never summed across classes; a class without its resource reports BLOCKED-LIVE-QUALIFICATION with its LB id. The B11 scorer is not edited (no pin move). |
| OD-204 | CI admission of the older suites and the corpus. | Admit the B09-B11 agent and chat suites and the B16.0 byte-pin suites to the prompt-to-gerber job after one local green run, and the 63-package corpus to the nightly job; OD-30's arithmetic recorded per change. |
| OD-205 | The power and ground invariant. | Net names, power-symbol presence and net-class membership of every power and ground net are unchanged by any agent delete, replace or edit unless the user's sealed proposal names that net; one offline evaluation per verb. |
| OD-206 | How partial and deviating scenarios are reported. | A closed vocabulary per scenario: `demonstrated`, `demonstrated offline only`, `in part`, `by refusal`, `by recorded deviation`, `blocked` (with LB id); scenario 17 is "by recorded deviation" and 18 "blocked" unless the owner reverses OD-122 or B22's verdict changes. |
| OD-207 | Durable run traces and the model-calling routes. | A durable `agent.run-trace.v1` aggregate on the durable-workflow substrate, bound through `setAgentTraceSinkFactory` at the chat composition root (no pin move); the 22 `model_egress` paths other than `/api/chat` (B23-A2's derived column, `route-resource-classification.ts:130`) get a minimal `sirkit.llm-call-record.v1` (route id, provider, model, token counts, latency, outcome class; no content) written through one shared seam; legacy routes are not retired by B24 (OD-106 stands). |
| OD-208 | Trace attribution additions. | A sibling `agent.run-trace-attribution.v1` keyed by trace id (never inside `trace.ts`): a per-tenant salted user-message digest, an opaque principal digest, the budget snapshot, per-event monotonic offsets, the discovered toolset digest, refused-call classes, an answer digest; provider request ids captured as bounded strings. |
| OD-209 | Cost and spend. | Tokens recorded; cost computed only from an owner-supplied, versioned price table, otherwise reported "unpriced"; live runs bounded by requests and tokens as today and, when the owner names one, a monetary cap checked before each request. Opt-in live suites, B22's `b22-a3-runner-live` and `b22-d-adversarial-live` included, gain a recorded `exercised`/`not exercised` status (reusing B22-D's NOT MEASURED positive-control convention) and fail when their flag is set but their resource is absent; `assist-live` gets an injected principal and selector; the kicad-cli oracle exports the routed demo. |
| OD-210 | A server-side record of Tier 2 approvals. | Not built in B24 (it changes the approval flow); recorded as a limitation in the observability report; the Tier 1 settlement stays browser-attested, stated. |
| OD-211 | Who may read stored traces. | No new route or MCP read tool in B24; operator access through the purge CLI's read mode only; access audit deferred and stated (OD-111 stands). |
| OD-212 | Latency targets and the benchmark job. | No absolute targets until the owner sets them: B24-D1 measures p50 and p95 on the GitHub `ubuntu-latest` runner in a separate benchmark job (warm-ups, fixed sample counts) and gates only on regression against a recorded baseline with a noise band (the stage-09 budget shape); deadline-enforcement unit tests keep generous bounds or fake timers, performance assertions move to the benchmark job, each move recorded. |
| OD-213 | Reading a routed board. | B24-D2 adds bounded, paged board reads (by layer, net or region) under the existing registry review, so a routed board yields facts within the 60,000-character budget; until then the verdict states the limit. |
| OD-214 | Multi-tab, crash and restart scope. | A real two-page fixture spec proving refuse-on-conflict, no `BroadcastChannel`; a tab-crash spec (page close mid-commit, reopen); a PGlite-backed restart case offline; a real-store restart BLOCKED (LB-14). |
| OD-215 | Accessibility bar and responsive scope. | WCAG 2.2 AA as the bar for the chat, approval dialogs, side panels and B23's `ProviderExchangePanel`, `ProviderObservationList` and ordering-disabled notice; no new dependency (an axe devDependency needs the owner): a B17-A accessible-name rule, a polite live region on the chat transcript, keyboard-only Playwright journeys, visible-focus assertions, the BOM dialogs moved onto the shared dialog; the canvas declared non-accessible with keyboard Go-to as the alternative; desktop only with a stated minimum width and a visible notice below it, pinned by one spec at that width. |
| OD-216 | Live provider runs. | None without owner-supplied credits and a monetary cap; when supplied, the record-only command once per provider, the extended two-provider capsule (OD-125) and per-provider contract turns, recorded beside, never inside, the offline scores. |
| OD-217 | The live-blocker register. | Every row takes one of `BLOCKED-LIVE-QUALIFICATION`, `QUALIFIED (date, scope, resource)` or `NOT APPLICABLE`; LB-4 becomes "QUALIFIED 2026-09-24 on a non-isolated server: migrations and the nine DB-gated suites; isolated staging BLOCKED (LB-14)"; LB-2 and LB-5 become BLOCKED-LIVE-QUALIFICATION, LB-3 BLOCKED-LIVE-QUALIFICATION for CI and qualified platforms; new rows LB-13 (staging and production environments, edge TLS and headers, Supabase redirect list), LB-14 (database platform: Data API exposure, roles, backup, PITR, failover, restart), LB-15 (live distributor contract), LB-16 (live approved external MCP server), LB-17 (kicad-cli live oracle); `PROGRAM_STATE.json` mirrors every row, reversing OD-179's choice to leave LB-4, LB-6, LB-7 and LB-8 unmirrored (with a dated OD-179 note). |
| OD-218 | Fabrication and physical evidence. | No fabrication, upload or order; no evidence store is built; B24-E items 6 (fabrication) and 7 stay BLOCKED-LIVE-QUALIFICATION (LB-5). If the owner separately approves fabrication and names who inspects and tests, B24-E adds what B23-D handed it (`artifacts/ai-control-plane-b23/physical-evidence.md:272-273`; OD-187 (c), (h)): a reviewed store for B23-D's record kinds, a recording route that derives the reviewer from the session, and the wired review port, and nothing else; a pass needs a human-reviewed record, never a fixture. |
| OD-219 | The rule-profile expiry. | Recorded in the verdict with its date (about 2027-09-09); re-retrieval is an owner action outside B24 and a reviewed code change (it moves the B23 registry's jlcpcb-2l row, three suites' date pins and, INFERRED, the pinned release identity and its fixture clock); until then the frozen-clock CI identity is unaffected; B23-B3 stales every provider exchange and observation at that expiry (OD-168). |
| OD-220 | How the B24-F maps are produced. | One byte-pinned generator (proposed `scripts/generate-b24-maps.ts`) for the coverage matrix, the permission and autonomy matrix, the agent graph and a generator inventory, run after B22 and B23 merge; the threat-model register written by hand from the numbered defect registers (F18, B19, D20, D21, D22, D23, D24), citing B03.1's `security-boundary.md`, the CD-10 stage report's threat-model section and B22's `threat-model.md` and adversarial matrix as inputs, with no claim that other chapters were threat-modelled. |
| OD-221 | Program records and hygiene before the verdict. | OD-5 closed and OD-19 corrected (11 + 54 commits) with dated notes; B23's OD-160 and OD-178 already recorded at its closeout (`b6c6b0d`, `f663d71`; every OD-134..OD-159 is now a heading); eslint added to CI only after the page fix merges (the fix branch goes through its own PR, never merged by B24); the four fix branches and the reconstruction branch listed as open risks; `HISTORY FABRICATED OR BACKDATED` answered for main's history with the unmerged branch named. |
| OD-222 | CI admission for B24 suites. | `CHAPTERS` gains `b24-` (after B23's `b23-`) and one directory filter admits the B24 suite folder; live suites opt-in only, admitted to CI and skipping themselves without their flag, as the OD-59 every-suite guard requires (`b19-e-ci-job-scope.test.ts:148-153`); adding `b24-` moves B22's C77 (`deck-and-secret-corrections.md:484`) and B23's C15 (`provider-registry.md:303`) line pins in place by review. |

---

## 7. Increment plan (test-first, gated)

Conventions: B24 starts after B23's closeout merges (runbook `:28`), on a new chapter branch `chapter/b24-production-qualification` from
main, after the lead re-verifies this page on that tree; every increment = failing suite first, then code, then green, then generators,
`git status` clean, commit, push (the owner's commit-and-push rule; never merge automatically); suites `b24-<letter>-<subject>.test.ts`
under one directory (proposed `app/lib/qualification/__tests__`) admitted to CI in the same commit (OD-222), with PGlite suites kept out of every prompt-to-gerber filter (`b19-e-ci-job-scope.test.ts:96-99`) and admitted file by file to database-delivery (`:148-154`), B23's sibling `database/__tests__` folder being the precedent (`deterministic-manufacturing.yml:301`); no vitest concurrent with
Playwright, every runner process stopped afterwards; no B24 identifier in the nine B11-scanned files and no edit to them without a reviewed
pin move; the census and the tool counts move only by review; no live call, no production database, no deployment and no account action by
the builder - every live step is BLOCKED-LIVE-QUALIFICATION unless the owner supplies the resource; commits as `Dandi Desta
<dandidesta82@gmail.com>` with no AI trailer; a staged-content secret scan before every push. A pre-edit counterexample that does not
reproduce is recorded "not reproduced" and its guard stays as defence in depth.

### B24-A1 - Environment profile, production-mode CI, health, readiness, configuration, flags (closes D24-1 offline, D24-9, D24-10, D24-11)
- Tests first: a production runtime with no profile, a non-production profile or a missing expected origin refuses sensitive routes
  (counterexample: today the profile does not exist); `/api/ai/runtime` with an empty `SIRKIT_ANTHROPIC_MODEL` reports what the adapter sends
  (counterexample red); every `SIRKIT_*` flag's default is pinned.
- Code: the profile resolver over `mode.ts`; the deployment-configuration record (OD-199); `/api/health`, `/api/ready` (OD-198, census 166 -> 168 by
  review); the flag inventory with every default pinned and one off-only switch for B22's diagnostic runner, B23's two manufacturing switches already existing (OD-200); a CI job `production-smoke` (`next build`, `next start` in
  production mode, a few `curl` probes: health 200, ready not-ready by name, a sensitive route refused, headers present).
- Suites: `b24-a-environment-profile`, `b24-a-readiness`, `b24-a-configuration`, `b24-a-flags`.
- Pages: `environments-and-deployment.md` (what is proven offline, what is BLOCKED under LB-13).
- Stop: anything that needs a platform-specific deployment file or a live host stops for OD-190.

### B24-A2 - Headers, origins, secrets (closes D24-4, D24-5, D24-6)
- Tests first: the served-header spec extended (each header red first); a rotation case per secret (the previous value verifies, never
  signs); `.env.example` declares every name the code reads (a parity test over a names census); the CI secret scan finds a planted PEM
  marker in a fixture directory excluded from the build.
- Code: `next.config.ts` headers (OD-196); previous-value verification (OD-195); the scan step.
- Suites: `b24-a-headers` (unit, plus `e2e/security-headers.spec.ts`), `b24-a-secret-rotation`, `b24-a-env-names`.
- Pages: `edge-security.md` (each header, each secret, the allowlist values per environment).
- Stop: an enforced `script-src` that breaks a page stops at report-only (OD-196).

### B24-A3 - Abuse controls (closes D24-8)
- Tests first: N+1 embedding requests in a window reach the provider fake N times (counterexample: today all N+1); the classification census
  refuses a reviewed `PUBLIC_MODEL_EGRESS` path without an enforced limiter (counterexample red; B23-A2's census already flags unreviewed public model egress, `route-resource-classification.ts:238-247`); the placement preview stops at its compute bound.
- Code: limiters (OD-197), the `pub()` credit and `expensive` declarations, the embedding admission key, the enforcement gate.
- Suites: `b24-a-abuse-limits`, `b24-a-credit-census`.
- Pages: `abuse-controls.md` (every limit, keyed on what, per process).
- Stop: a limiter that needs a shared store stops for OD-197's alternative.

### B24-A4 - Data layer: roles, RLS, rollback, recovery, test isolation (closes D24-2, D24-3 offline, D24-7 offline, D24-12)
- Tests first (PGlite): a Data API role reads a non-membership table (counterexample red); rollback of the newest migration is refused
  (counterexample: no path); `schema-integrity` against a non-empty disposable database deletes foreign rows (counterexample, on PGlite only).
- Code: the RLS migration (OD-192), executable DOWN sections and `--rollback` (OD-193), the dump/restore proof and connection-loss case
  (OD-194), the shared empty-target guard (OD-201), TLS for every non-loopback URL.
- Suites: `b24-a-rls-default-deny`, `b24-a-rollback`, `b24-a-restore`, `b24-a-test-isolation`; the database-delivery job admits them.
- Pages: `database-and-recovery.md` (offline proofs; LB-14 for the real platform).
- Stop: any statement that would run against a non-disposable database stops.

### B24-B1 - The golden catalog (closes D24-14)
- Tests first: a catalog row whose class is model-in-loop with no LB id is refused; a blocked class never contributes to a pass; summing
  across classes is impossible by type.
- Code: the six-class catalog module and generator (OD-203); every nineteen-area row linked to the suites in section 2.4.
- Suites: `b24-b-catalog`, `b24-b-score-separation`.
- Pages: `eval-catalog.md` and the generated `eval-catalog.csv`/`.json`.
- Stop: a change needed inside `evaluation.ts` stops for a reviewed pin move.

### B24-B2 - CI admission and the missing areas (closes D24-15, D24-16)
- Tests first: the job-scope guard requires every catalogued suite to be admitted (red for the B09-B11 and B16.0 pin suites).
- Code: workflow admissions (OD-204), the power/ground evaluation (OD-205), the browser order-refusal case ("Order the parts." is already
  scripted), links to B22-D's `b22-d-adversarial` and B23's `b23-b-exchange-ledger`, `b23-b-exchange-ledger-pglite` and `b23-c-order-contract`, all CI-admitted at `dfd51e3`.
- Suites: `b24-b-ci-admission`, `b24-b-power-ground`; `e2e/agent-execution.spec.ts` gains the order case.
- Pages: the catalog regenerated; OD-30 arithmetic in the ledger.
- Stop: an admitted older suite that fails at HEAD is recorded and fixed as its own counterexample, never skipped.

### B24-B3 - Scenario map and trustworthy live suites (closes D24-17, D24-18 offline, D24-19)
- Tests first: each opt-in live suite with its flag set and its resource absent fails with "not exercised" (red today); the scenario map
  generator refuses a scenario without a closed standing.
- Code: the twenty-scenario map (OD-206); the live-suite repairs (OD-209); the two-provider capsule for the record-only command (offline
  shape only).
- Suites: `b24-b-scenario-map`, `b24-b-live-suite-honesty`.
- Pages: `scenario-map.md`.
- Stop: none of these runs a live call.

### B24-C1 - Durable traces (closes D24-20, D24-21)
- Tests first: after a chat request the trace is retrievable by run id (red: discarded); a call through each `model_egress` path but `/api/chat` (22 at `dfd51e3`, `route-resource-classification.ts:130`) leaves one
  call record (red).
- Code: the durable sink bound at the chat composition root; the call-record seam (OD-207); the import gate keeps durable-runtime
  imports out of the agent loop's closure.
- Suites: `b24-c-durable-trace`, `b24-c-llm-call-record`.
- Pages: `observability-and-replay.md` (part 1).
- Stop: anything requiring an edit to a B11-scanned file stops.

### B24-C2 - Attribution, cost, latency, retention, redaction (closes D24-13, D24-22, D24-23, D24-25)
- Tests first: an attribution document exists per trace with the closed fields; a secret-shaped instruction excerpt is stored redacted (red);
  the SPICE log is bounded (red); the purge CLI in dry-run lists and deletes nothing.
- Code: OD-208 attribution, OD-209 cost (unpriced without a table), OD-202 retention policy and CLI, the redactor on the three stores.
- Suites: `b24-c-attribution`, `b24-c-retention`, `b24-c-redaction`.
- Pages: `observability-and-replay.md` (part 2), `retention-and-deletion.md`.
- Stop: a field that would hold model text stops.

### B24-C3 - Readers and recorded limits (closes D24-24 as recorded, D24-26)
- Code: the CLI read mode (OD-211); the limits stated: Tier 2 approvals browser-local (OD-210), replay of authored capsules only.
- Suites: `b24-c-trace-read`.
- Pages: `observability-and-replay.md` (part 3).

### B24-D1 - Benchmark methodology and latency (closes D24-27, D24-28)
- Code: a `benchmark-latency` CI job (OD-212) measuring view/read commands, a granted reversible edit, one verified workflow on recordings
  and the first stream event (a delayed-first-chunk route), each against a recorded baseline with a noise band; `route-bench` admitted; the
  real-clock unit bounds classified one by one (deadline-proof kept, performance moved), each move recorded; an OD-30 duration check that
  reports the browser job's headroom.
- Suites: `b24-d-latency` (benchmark job), `b24-d-threshold-census`.
- Pages: `performance-and-reliability.md` (part 1).
- Stop: a gate that would hide a regression (a widened bound with no baseline) stops.

### B24-D2 - Large boards, memory, multi-tab, crash, cleanup (closes D24-29, D24-30 and D24-31's FreeRouting and kicad-cli remainder)
- Tests first: board facts on a recorded routed board within the budget (red today); a two-page conflict refuses the second write; a page
  closed mid-commit recovers on reopen.
- Code: bounded paged reads (OD-213, registry review); memory sampling in the benchmark job; the specs (OD-214); B22-A3's ngspice tree kill (`diagnostic-runner.ts:401-431`) and B22-D's opt-in orphan case 14 (`b22-d-adversarial-live.test.ts:290`) cited; the FreeRouting and kicad-cli tree kill and an orphan check built or recorded open.
- Suites: `b24-d-board-read`, `b24-d-memory`; `e2e/multi-tab.spec.ts`, `e2e/crash-recovery.spec.ts`.
- Pages: `performance-and-reliability.md` (part 2).

### B24-D3 - Accessibility and responsive scope (closes D24-32)
- Tests first: the accessible-name rule fails on today's unnamed controls; a keyboard-only journey cannot reach the chat answer by a live
  region (red).
- Code: OD-215 items.
- Suites: `b24-d-accessible-names`; `e2e/keyboard-and-focus.spec.ts`, `e2e/minimum-width.spec.ts`.
- Pages: `accessibility.md`.
- Stop: anything needing a new dependency stops for OD-215.

### B24-E - Live and physical gates (closes D24-33, D24-34 offline, D24-35 and D24-36 as recorded)
Each item: what is built offline, the resource that unblocks it, and its state without that resource.
1. Live OpenAI and Anthropic (`:1115`): offline - the two-provider capsule, per-provider contract turns written as an opt-in suite with a
   request, token and (if named) money bound; resource - credits and a cap (OD-216); state - BLOCKED-LIVE-QUALIFICATION (LB-2, LB-7, LB-9).
2. Production-auth browser E2E (`:1116`): offline - `playwright.production-auth.config.ts` (`next build`/`next start`, production auth,
   the B16-1B variable names, an isolated-project marker, refusing any URL not on the staging list) and its spec (sign-in, cookie flags,
   liveness, revocation, sign-out); resource - isolated project, account, staging host (OD-191); state - BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13).
3. Live distributors (`:1117`): offline - the repaired contract (OD-209); resource - DigiKey and Nexar credentials and quota consent; state -
   BLOCKED-LIVE-QUALIFICATION (LB-15).
4. Sandboxed simulator and router (`:1118`): offline - nothing beyond B22's contracts; resource - a qualified OCI platform and a declared
   host (B22 OD-134/OD-147); state - BLOCKED-LIVE-QUALIFICATION (LB-10, LB-3, LB-8).
5. DFM/quote staging (`:1119`): offline - B23's built fake-backed flow; resource - a provider account and sandbox (B23 OD-160, recorded at its closeout, `f663d71`), a reviewed transfer descriptor and the owner-run B23-B4; state -
   BLOCKED-LIVE-QUALIFICATION (LB-11).
6. Deterministic 555 release (`:1120`): CI evidence (the pinned identity) and the expiry recorded (OD-219); fabrication - BLOCKED-LIVE-QUALIFICATION
   (LB-5) until separate owner approval (OD-218).
7. Inspection and functional test (`:1121`): B23-D's `physical-evidence.ts` exists (review port unwired, `:330`; eligibility blocked for every input, `:484`, the assembly-data authority "absent", `:454`); B24-E adds the store, the session-derived recording route and the wired review port only if OD-218 is answered; state - BLOCKED-LIVE-QUALIFICATION (LB-5).
- Code: the register normalised (OD-217) with a test that every row's classification is from the closed set and that `PROGRAM_STATE.json`
  mirrors every row (reversing OD-179's choice, with a dated OD-179 note); a statement tripwire extending B22's `b22-closeout-statements` (no copy claims a live, staging or physical pass absent from the matrix).
- Suites: `b24-e-register`, `b24-e-statements`.
- Pages: `qualification-matrix.md` (browser / live / physical, one row per gate and class).
- Stop: any step that would use an owner credential, account or hardware without a written approval stops.

### B24-F - Final product verdict artifacts (closes D24-37, D24-38, D24-39, D24-40)
- Generated (OD-220), after B22 and B23 merge and every count is re-measured: `current-system-map.md` and `trust-boundary-map.md` (routes
  with auth class, identity source, roles, CSRF, credit, external process and outbound egress; spawners; providers; stores);
  `coverage-matrix.csv` (control -> record -> command -> tool -> agent exposure -> role -> MCP exposure -> tier); `agent-graph.md` (roles,
  DAG kinds, trim, caps, merge rules, per-role tools); `permission-autonomy-matrix.csv` (decision over tier x mode x role x tool);
  `generator-inventory.md`.
- Written from test output and records: `executive-summary.md`; `database-migration-proof.md` (31+ migrations from the suite's own output,
  the 2026-09-24 run as non-isolated, rollback and recovery as proven offline, LB-14); `provider-security-report.md`, `mcp-security-report.md`
  (B20's D1-D3 with OD-51 and D2.5 open), `sandbox-security-report.md` (B22's verdict, production BLOCKED); `eval-catalog-and-results.md`;
  `qualification-matrix.md`; `performance-reliability-report.md`; `threat-model-closure-register.md`; `open-risks-and-owner-decisions.md`
  (one list over OD-1..OD-222, every gap and duplicate marked: OD-83..OD-86 and OD-88 reserved, `OWNER_DECISIONS.md:687`; OD-189 reserved and unspent (OD-188 spent by B23's closeout); OD-47, OD-51, OD-89, OD-93 and OD-94 without a heading; OD-52, OD-54, OD-74, OD-80, OD-135, OD-150 and OD-174 each with two headings, OD-74's and OD-80's second one an amendment); `changed-files.md` and the commit list; `final-verdict.md`.
- **The ten readiness scopes**, each stated separately, with its gate and the state reachable without owner-supplied live resources
  (INFERRED from sections 2 and 4):

| Scope (`:1146-1155`) | Gate | Reachable offline |
|---|---|---|
| deterministic local readiness | the full suite, tsc, eslint and both Playwright configs green locally at the final SHA | yes, if they pass |
| CI readiness | every catalogued suite admitted; both workflows plus the new jobs green on the final commit | yes, if they pass |
| staging authentication readiness | B24-E item 2 on an isolated project | no: BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13) |
| live provider readiness | B24-E item 1 on both providers | no: BLOCKED-LIVE-QUALIFICATION (LB-2, LB-7, LB-9) |
| external component-provider readiness | B24-E item 3 | no: BLOCKED-LIVE-QUALIFICATION (LB-15) |
| MCP readiness | read-only server proven offline and in the fixture browser; external consumption live | in part only: the read-only server subset; consuming an approved external server BLOCKED (empty registry, LB-16); proposals deferred (OD-82/OD-87) |
| sandbox readiness | B22's verdict | no: production BLOCKED (LB-10); diagnostic-only runner, whose live adversarial run recorded class 4 NOT CONTAINED (`adversarial-matrix.md:325-345`) |
| manufacturing-file readiness | the pinned deterministic release and its readers | yes, scoped: the jlcpcb-2l bare-board Gerber/Excellon package, valid until the profile expires; never manufacturer-accepted |
| external quote/order readiness | B23's flow live | no: BLOCKED-LIVE-QUALIFICATION (LB-11, LB-12); ordering disabled |
| physical hardware validation | B24-E items 6-7 | no: BLOCKED-LIVE-QUALIFICATION (LB-5) |

- Suites: `b24-f-maps` (byte pins of every generated map), `b24-f-verdict-lines` (each readiness line equals the qualification matrix).
- Stop: a count that differs from its pinning test stops; never hand-corrected.

### Closeout and the final program report
- Commit 1/2: OD-221's record corrections; the superseding notes beside the stale pages; the statement tripwire green.
- Commit 2/2: `test-and-validation-report.md`, `unknowns-and-owner-decisions.md` (OD-190..OD-222, D24-1..40 with their closing increment),
  `final-verdict.md`; ledger, `PROGRAM_STATE.json` and the register; the chapter PR undrafted and merged normally only if every applicable
  gate passes (`:1159`).
- Then the final program report, exactly in the format of runbook `:1220-1264`, every field from a measurement at the final main SHA:
  `SIRKIT REMAINING BUILDER PROGRAM:` PARTIAL unless every scope passes (expected PARTIAL: B20, B21 and B22 are PARTIAL or BLOCKED in part, B23 is PARTIAL (`artifacts/ai-control-plane-b23/final-verdict.md`), and
  every live and physical gate is BLOCKED-LIVE-QUALIFICATION); route and tool counts from their pins; the ten status lines from the
  qualification matrix; `SECRETS EXPOSED` from a recorded scan of main's history, `PROTECTED ORIGINAL MODIFIED` from a recorded read-only check
  of `C:\Users\robsa\sirkit` (a directory listing with modification times only; never `git status` there, which can rewrite its index), `HISTORY FABRICATED OR BACKDATED` for main's history with the
  unmerged reconstruction branch named; remaining unknowns and owner decisions from the closeout list; a truthful product verdict naming what
  Sirkit can and cannot do. Stop after the report (`:1266`).

---

## 8. Questions and unknowns

1. **UNKNOWN** - The intended hosting platform and staging topology. Resolves by an owner statement (OD-190), which also gates B22's LB-10 (B22 `final-verdict.md:17, :124`); until then staging and
   production are BLOCKED-LIVE-QUALIFICATION (LB-13).
2. **UNKNOWN** - Whether the "main Supabase project" used on 2026-09-24 holds production data. Resolves by the owner (OD-191); the default
   treats it as production.
3. **UNKNOWN** - Whether that project's Data API exposes `public` and with which grants; which Postgres role production's `DATABASE_URL`
   names. Resolves only by reading the staging or production project's settings (LB-14).
4. **UNKNOWN** - The Supabase plan, PITR window and backup schedule. Resolves by the owner (OD-194).
5. **UNKNOWN** - Whether the B11 evaluation suite passes at `dfd51e3` (no CI job runs it; B21-F recorded it green on 2026-09-28, and B22's local closeout run at `85439e7` had `app/lib/agent/__tests__` 415/415 green, `artifacts/ai-control-plane-b22/test-and-validation-report.md:94`). Resolves by
   one local run in B24-B2 before admission.
6. **INFERRED** - `assist-live` would be refused before any model call; the kicad-cli oracle's first case cannot pass as written. Resolves
   by the offline repairs in B24-B3; a live run still needs credits or KiCad (LB-2, LB-17).
7. **UNKNOWN** - Whether kicad-cli is installed on this host (the oracle header says it was once measured on KiCad 10). Resolves by an
   owner statement; LB-17.
8. **INFERRED** - The single-agent chat path is not LLM-metered (the meter's only caller is the orchestration policy). Resolves by a test in
   B24-A3 that counts admissions on a flag-off chat run.
9. **INFERRED** - Next.js sends `X-Powered-By` with the current config. Resolves by the B24-A2 header spec.
10. **INFERRED** - The approval dialogs on the shared dialog trap focus; the hand-rolled BOM dialogs do not. Resolves by the B24-D3
    keyboard spec.
- [B24-D3, 2026-10-10] Item 10: CONFIRMED for the Tier 1 granted-execution card only, by `e2e/keyboard-and-focus.spec.ts` case 4 (green on the lead's run) (focus inside, Tab and Shift+Tab cycle among Close, Cancel and Confirm, Escape cancels); INFERRED (the same Base UI component, `components/ui/dialog.tsx` unchanged) for the other in-scope approval dialogs and the four BOM dialogs moved onto it; the BOM dialogs' name, focus move, Escape and focus return are CONFIRMED in jsdom (`b24-d3-bom-dialogs`, 16 of 16), the other approval dialogs' `DialogTitle` by AST (`b24-d3-accessible-names` 5); neither group's Tab trap is measured (runbook `:147`).
11. **UNKNOWN** - Latency targets, the reference machine, and whether the benchmark job's minutes are acceptable (OD-212, OD-30).
12. **UNKNOWN** - Whether the owner wants WCAG 2.2 AA and an axe devDependency (OD-215), and whether tablet layouts matter (OD-215).
- [B24-D3, 2026-10-10] Item 12: stays UNKNOWN (the owner's WCAG 2.2 AA choice, an axe devDependency, tablet layouts); OD-215's defaults applied: AA as the bar for its scope, no new dependency, desktop only at 1,280 CSS px with a notice below.
13. **UNKNOWN** - Whether the owner will supply provider credits with a monetary cap, an isolated Supabase project, distributor credentials,
    an OCI platform, a provider account, fabrication approval and test equipment (OD-216, OD-191, LB-15, B22 OD-147, B23 OD-160, OD-218).
14. **RECORDED** - B24 numbers start at OD-190 as instructed; OD-181..OD-189 were reserved by B23 (`artifacts/ai-control-plane-b23/discovery.md:1350`; `EXECUTION_LEDGER.md:4344`), which spent OD-181..OD-188 (OD-188 at its closeout) and left OD-189 unspent; no OD-190+ or LB-13+ is recorded at `dfd51e3` or after the closeout (B23-C's tests use only a fake `OD-999`), so nothing
    shifts (B23's own section 8 item 12 now reads "ANSWERED by B22", `discovery.md:941-942`).
15. **RECORDED** - This session's harness reminder asks for a co-author trailer on commits; runbook `:165`, OD-19 and the owner's standing
    rule forbid AI trailers and fix the identity; the lead confirms the runbook rule governs B24 commits.
16. **ANSWERED at `dfd51e3`** - What B22 and B23 deliver (B22-B moved 42/33/9/24 to 47/36/9/27; B23-B1 the census to 166/163/3/0 and B23-A2 the classification
    columns (`outbound_egress`/`model_egress`); B22 PARTIAL with LB-10; B23's LB-11/LB-12 and the ordering contract; only B23's own verdict is pending). Re-verified by the lead (section 9) and re-checked on B24's starting
    tree; every count in this page is re-measured there.
17. **UNKNOWN** - Whether the four unmerged corrective branches merge before the verdict (OD-221); whether the reconstruction branch is in
    scope of `HISTORY FABRICATED OR BACKDATED` (OD-221 default: main's history, the branch named).
18. Open design questions carried to the owner table: environments (OD-190), the main project (OD-191), roles and RLS (OD-192), rollback
    (OD-193), recovery (OD-194), secrets (OD-195), headers and origins (OD-196), abuse (OD-197), health (OD-198), configuration (OD-199),
    flags (OD-200), test isolation (OD-201), retention (OD-202), the catalog (OD-203), CI admission (OD-204), power/ground (OD-205),
    scenario vocabulary (OD-206), durable traces (OD-207), attribution (OD-208), cost and live-suite honesty (OD-209), Tier 2 records
    (OD-210), trace access (OD-211), latency (OD-212), routed-board reads (OD-213), multi-tab and crash (OD-214), accessibility and
    responsive (OD-215), live providers (OD-216), the register (OD-217), physical evidence (OD-218), the rule profile (OD-219), the maps
    (OD-220), records hygiene (OD-221), CI for B24 (OD-222).
19. Live behaviour of every external resource (providers, Supabase staging, distributors, an external MCP server, a qualified sandbox
    platform, a manufacturer, physical boards) and of the real database platform: BLOCKED-LIVE-QUALIFICATION (LB-1, LB-2, LB-5, LB-7, LB-8,
    LB-9, LB-10..LB-17), recorded and never converted into a claim.

---

## 9. Lead reconciliation

### 9.1 Method

Read-only verifiers re-read every citation, count and claim in the draft on `dfd51e3`. That covers the header, sections 0, 1.1-1.3, 2.1-2.8, 3, 5, 6, 7 (taken increment by increment) and 8, and each of D24-1..D24-40 for section 4. `dfd51e3` is the B23-complete tree: B23 A1..D sit on `chapter/b23-external-manufacturing` above main `43cb1b0`, where B22 merged as PR #13. Each fact was compared with `50fe156` using `git diff 50fe156 dfd51e3 -- <file>`, `git show` and `git log 50fe156..dfd51e3 -- <file>`, and the commit that moved it is named. Runbook lines were re-read in the runbook itself.

Nothing was executed: no vitest, tsc, eslint, node, next, Playwright or docker. Every INFERRED item stays INFERRED.

Verdicts used:

| Verdict | Meaning |
|---|---|
| `stands` | The fact and its line are unchanged. |
| `stands-with-moved-citations` | The fact is unchanged but the line moved. |
| `changed-since` | A B22 or B23 commit changed the fact. |
| `partly-closed-since` | B22 or B23 closed part of the gap. |
| `wrong` (citation status) | The citation was already wrong at `50fe156`. |

Tally for the 40 defects: 24 stand, 5 stand with moved citations, 4 changed since and 7 are partly closed since. No defect is fully closed.

The drafter of this section also ran read-only `git grep` at `dfd51e3` for `OD-174`, `B24`, `B24-A3` and `D24-` (results in 9.3).

B23's closeout is not in `dfd51e3`. It only adds dated notes, retitles and records. The lead delta-checks it before committing this page (9.5 item 34). Process deviations by the verifiers are listed in 9.5 item 35.

### 9.2 Per-item verdicts

| Item | Verdict | Citations moved or changed (old -> new) | Note |
|---|---|---|---|
| Header (lines 1-34) | changed-since | reviewed tool counts 42/33/9/24 -> `app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts:241` (47/36/9/27, `b4c7be7`, OD-139); route census 165/162/3/0 -> `app/api/__tests__/b16-1c-invariant-tripwires.test.ts:38, :48` (166/163/3/0, `0c78e93`, OD-174); "B22-A2 is changing the `externalProcess` column" (changed-since: landed in `c037627`) | No `artifacts/ai-control-plane-b24/` yet. |
| 0 | changed-since | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:54` (changed-since: `b23-` added, `79fa18b`); `deterministic-manufacturing.yml:315` (browser job header) -> `.github/workflows/deterministic-manufacturing.yml:317`; `deterministic-manufacturing.yml:317` (`timeout-minutes: 30`) -> `.github/workflows/deterministic-manufacturing.yml:319`; classification CSV rows -> `route-data-and-resource-classification.csv:1, :102, :116, :117` (changed-since: `outbound_egress`/`model_egress`); `artifacts/ai-control-plane-b18/permission-tiers.md:30` -> `artifacts/ai-control-plane-b18/permission-tiers.md:37` (wrong); "HEAD has 102 records, 165 route methods and 628 sites on 62 surfaces" (changed-since: 106 / 166 / 631 on 63); `OWNER_DECISIONS.md:1695 (headings end at OD-153)` -> `OWNER_DECISIONS.md:1696 (OD-153); last heading OD-187 at :2463`; "nothing records that reservation" -> `artifacts/ai-control-plane-b23/discovery.md:1197, :1349; EXECUTION_LEDGER.md:4344`; `app/api/pcb/edit/assist/route.ts:35` -> `app/api/pcb/edit/assist/route.ts:349` (wrong) | The derived `MODEL_EGRESS_PATHS` (23 paths) gives 22 untraced. OD-190 / LB-13 / D24- are free. |
| 1.1 | stands | none | B22 hands the production host to B24-A (LB-10). B23 hands the physical-evidence store, route and review port to B24-E (LB-5). |
| 1.2 | stands | none | Runbook sections 3-5 are quoted exactly. |
| 1.3 | changed-since | `b16-1c-invariant-tripwires.test.ts:38, :48` (165 -> 166/163/3/0); `b20-c1-three-way-parity.test.ts:241` (42/33/9/24 -> 47/36/9/27); `app/lib/engineering/agent-exposure.ts:28-66` -> `app/lib/engineering/agent-exposure.ts:30-64`; B01 matrix (102 -> 106 records, 107 lines); `ui-control-inventory-summary.json:3-4` (628/62 -> 631/63); 151 `route.ts` -> 152; `deterministic-manufacturing.yml:50-258` -> `deterministic-manufacturing.yml:50-259`; `deterministic-manufacturing.yml:271-300` -> `deterministic-manufacturing.yml:272-302`; `deterministic-manufacturing.yml:315-334` -> `deterministic-manufacturing.yml:317-336`; `LIVE_BLOCKERS.md:5-15` -> `LIVE_BLOCKERS.md:5-18`; `PROGRAM_STATE.json:12-17` -> `PROGRAM_STATE.json:12-21`; chapter status (changed-since: B22 PARTIAL, merged as `43cb1b0`; B23 A1..D landed); PRs (changed-since: #13 merged) | Migrations (31) and tables (143) are unchanged. |
| 2.1 | partly-closed-since | `.env.example:6-74` -> `.env.example:6-79`; `.env.example:72-73` -> `.env.example:77-78`; tool/registry versions (changed-since: `PROVIDER_REGISTRY_VERSION` 1.0.0 at `provider-registry.ts:23`; runtime profiles at `runtime-profile.ts:28-40, :162-166`); "No sandbox, computation or external-manufacturing flag exists" (changed-since); B23 draft OD-171 -> `app/lib/manufacturing-providers/ordering-enablement.ts:93; OWNER_DECISIONS.md:2338-2346`; "None of the 151 route.ts files" (changed-since: 152) | No staging profile, no deployment file, no `next build`, no health route. |
| 2.2 | stands-with-moved-citations | `deterministic-manufacturing.yml:284-300` -> `deterministic-manufacturing.yml:285-302`; "synthesizer grep of the ten gated suites" (wrong: nine importing files, one of them the gate's contract suite; the ledger counts the same nine) | Findings unchanged. |
| 2.3 | changed-since | `app/lib/auth/route-resource-classification.ts:160-165` -> `app/lib/auth/route-resource-classification.ts:210-215`; abuse-control inventory (changed-since: `provider-exchange.ts:22, :84-85`; `admission-control.ts:472+`; `diagnostic-runner.ts:43-45`) | `model_egress` / `PUBLIC_MODEL_EGRESS` now records the two anonymous searches (OD-174 open). |
| 2.4 | partly-closed-since | "prompt-to-gerber job runs B17-B22 suites" (changed-since: B17-B23, `deterministic-manufacturing.yml:227, :301`); sandbox escape "no process-escape suite until B22-D" (changed-since); "external DFM none" (changed-since); "idempotency not evaluable until B23" (changed-since) | `ai_safety` is a declared kind that no package uses. |
| 2.5 | stands-with-moved-citations | `app/lib/spice/types.ts:451-461, :475` -> `app/lib/spice/types.ts:458-468, :482` | Add `mfg.provider-exchange.v1` and `computation.evidence.v1` to "what is durable". |
| 2.6 | partly-closed-since | `playwright.orchestration.config.ts:38-51` "reuses the server" (wrong: `reuseExistingServer: false`, `:42`); `deterministic-manufacturing.yml:317` -> `deterministic-manufacturing.yml:319`; memory grep (changed-since: `b22-b-bounded-host.test.ts:145`); "no server-restart case" (changed-since: `b23-b-exchange-ledger` cases 5, 16, 22, 25); `app/api/simulate/route.ts:268-274`, `app/api/spice/models/smoke-test/route.ts:66`, `app/lib/spice/server/worker.ts:74, :114, :128, :133` (changed-since: diagnostic runner; `kill_unconfirmed` at simulate `:213-216`, smoke test `:84`, worker `:111-115`); "B22-A3 plans tree kill" (changed-since: `diagnostic-runner.ts:401-431`, `OWNER_DECISIONS.md:1768-1787`); "195 of 628" (changed-since: 195 of 631) | FreeRouting and kicad-cli still kill only the direct child. |
| 2.7 | changed-since | `app/lib/model-simulation/safe-execution.ts:20-21` -> `app/lib/model-simulation/safe-execution.ts:27-28`; "execute answers 501" (changed-since: 403/400/409 first); `NGSPICE_BIN` (changed-since); "LB-10 proposed" (changed-since: `LIVE_BLOCKERS.md:16`); item 5 (changed-since: registry, flow, `LIVE_BLOCKERS.md:17`, :18); item 7 (changed-since: `physical-evidence.ts`, `OWNER_DECISIONS.md:2431`); `app/api/pcb/release/route.ts:116-120` -> `app/api/pcb/release/route.ts:185-189`; `LIVE_BLOCKERS.md:7-15` (changed-since: `:7-18`); `PROGRAM_STATE.json:12-17` (changed-since: eight entries at `:12-21`) | |
| 2.8 | changed-since | generators (changed-since: 21 `generate-*` plus 2 `gen-*`); byte pins in CI (changed-since: add `b23-a-provider-registry.test.ts:557-560`); "B09, B10 and B11 artifacts" outside CI (wrong: `b20-c1-three-way-parity.test.ts:326`, `b21-f-evaluation.test.ts:530`); externalProcess rows (changed-since: `c037627`); `artifacts/ai-control-plane-b03/revision-history-contract.md:120` sole threat-model mention (changed-since: B22 `threat-model.md`); "every commit since 5a59a1f" (wrong: true for non-merge commits only); B22 OD headings (changed-since: all recorded); branches (changed-since: B22 merged); scenarios 12, 18, 20 (changed-since) | |
| 3 | changed-since | `deterministic-manufacturing.yml:271-300` -> `deterministic-manufacturing.yml:272-302`; `route-resource-classification.ts:139, :160-165` -> `route-resource-classification.ts:187, :210-215`; `LIVE_BLOCKERS.md:5-15` -> `LIVE_BLOCKERS.md:5-18`; numeric report fields row (changed-since: re-measure precondition met) | New reusable parts listed in 9.3. |
| D24-1 | stands | none | B22 widened the need for production-smoke (B22 `final-verdict.md:110, :124`; OD-158). |
| D24-2 | stands | `drizzle/0028_bom_project_ownership.sql:62-70` -> `:62-72` (already short at `50fe156`) | 31 migrations, 29 without DOWN. |
| D24-3 | stands | none (`0027:40-41` supports the `DATABASE_URL` RLS bypass only by inference) | TLS rule at three sites. B23's ledger uses the same single role. |
| D24-4 | stands-with-moved-citations | `.env.example:72-73` -> `.env.example:77-78` | Widened: ten undeclared names and two B23 single-value secret seams, neither holding a value today. |
| D24-5 | stands | none | Latent frameable Tier 3 surface (`ProviderExchangePanel.tsx:135-140`). |
| D24-6 | stands | none | B23 allowlists are outbound only. |
| D24-7 | stands-with-moved-citations | `.github/workflows/deterministic-manufacturing.yml:284` -> `.github/workflows/deterministic-manufacturing.yml:285` | The B23 PGlite suite has no recovery case. |
| D24-8 | changed-since | `app/lib/auth/route-policy.ts:62-64` (changed-since: `externalTransfer`/`spend` false added; `providerCredit` still false); classification CSV rows (changed-since: still `:102`, `:116`, `:117`, plus egress columns); `publicHasCreditOrWrite` -> `route-resource-classification.ts:210-215` | Census half narrowed; abuse half open. No B24 owner named at `dfd51e3`. |
| D24-9 | stands | none (count 151 -> 152 `route.ts`) | OD-198 takes the census from 166 to 168. |
| D24-10 | stands | none | Only adjacent configuration is versioned. |
| D24-11 | partly-closed-since | "no computation, sandbox or manufacturing name among the non-test SIRKIT_* names" -> `app/api/chat/computation-runtime.ts:20`; "B23 plans ordering disabled by a pure function (B23 OD-171)" -> `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2338` | Inventory, default pins and sandbox switch remain. |
| D24-12 | stands | none | No new real-server DB-gated suite. |
| D24-13 | stands | none | Widened by two durable aggregates with no purge. |
| D24-14 | stands | none | B22-D P/L/O and B23-D hardware/dry_run each cover one area only. |
| D24-15 | partly-closed-since | none moved | Classification CSV now byte-pinned in CI. Local green run at `85439e7`. |
| D24-16 | partly-closed-since | "no process-isolation escape suite exists at HEAD (B22-D plans one)" (changed-since); "quote/order idempotency cannot be evaluated before B23" (changed-since) | Power/ground and the browser order case remain. F1 is now CONFIRMED. |
| D24-17 | changed-since | `git grep 'program-wide\|required test scenarios'` (changed-since: three pages, B23 `discovery.md:127`); scenario 12 (changed-since); scenario 18 (changed-since); scenario 20 (changed-since) | Scenario map still missing. |
| D24-18 | stands | section 0 `app/api/pcb/edit/assist/route.ts:35` -> `app/api/pcb/edit/assist/route.ts:349` (wrong) | No model contract turn or money bound added. |
| D24-19 | stands | none (same `:35` -> `:349`) | assist-live and the oracle would most likely go red, not green (INFERRED). |
| D24-20 | stands | none | B22-B added only a test caller. |
| D24-21 | stands | none moved (count: 22 untraced of 23 `MODEL_EGRESS_PATHS`) | |
| D24-22 | stands | none | `loop.ts:405-416` did not move. |
| D24-23 | stands | none | B23's `spend` and price ceilings concern ordering, not model cost. |
| D24-24 | stands | none | The exchange ledger names the Tier 3 committer but is not tied to a run. |
| D24-25 | stands-with-moved-citations | `app/lib/spice/types.ts:451-461` -> `app/lib/spice/types.ts:458-468` | Still three unredacted stores. |
| D24-26 | stands | none | B23-B3's `GET /api/pcb-sync` reader is a precedent. |
| D24-27 | stands | none | B22-B's tools add more silent waits. |
| D24-28 | stands-with-moved-citations | `.github/workflows/deterministic-manufacturing.yml:317` -> `.github/workflows/deterministic-manufacturing.yml:319` | Widened (about 45 bounds; a failure on the CI runner itself). |
| D24-29 | stands | section 2.6 memory grep (changed-since: `b22-b-bounded-host.test.ts:145`; `engine-host.ts:197`; `runtime-profile.ts:352, :415, :468, :529`) | "Any routed board" was overstated even at `50fe156`. |
| D24-30 | stands | none | B23's restart case is in-process. |
| D24-31 | partly-closed-since | `app/api/simulate/route.ts:268-274` -> `app/lib/computation/diagnostic-runner.ts:407`; `app/api/spice/models/smoke-test/route.ts:66` -> `app/lib/computation/diagnostic-runner.ts:407`; `app/lib/spice/server/worker.ts:74-133` -> `app/lib/computation/diagnostic-runner.ts:407` | FreeRouting and kicad-cli remain open. |
| D24-32 | stands | `artifacts/ai-control-plane-b17/ui-control-inventory-summary.json:3-4` (changed-since: 631 sites, 63 surfaces) | 195 rows unlabelled. |
| D24-33 | changed-since | `artifacts/remaining-builder-program/LIVE_BLOCKERS.md:7-15` -> `artifacts/remaining-builder-program/LIVE_BLOCKERS.md:7-18`; `artifacts/remaining-builder-program/PROGRAM_STATE.json:12-17` -> `artifacts/remaining-builder-program/PROGRAM_STATE.json:12-21` | Vocabulary, LB-4 and the five missing rows are unchanged. |
| D24-34 | stands | none | B23's human-only route and panel have no browser spec. |
| D24-35 | partly-closed-since | B23 OD-175 ("B23-D defines types only") -> `artifacts/remaining-builder-program/OWNER_DECISIONS.md:2431` | Store, route and port remain. |
| D24-36 | stands-with-moved-citations | `app/api/pcb/release/route.ts:116-120` -> `app/api/pcb/release/route.ts:185-189` | More things now depend on the 2027-09-09 expiry. |
| D24-37 | stands | section 2.8 generator count (changed-since: 21 + 2); `app/lib/auth/__tests__/b16-0-2-gates.test.ts:266-270` (changed-since: pinned in CI by `b23-a-route-vocabulary.test.ts:667`) | Tier 3 inputs widened. |
| D24-38 | partly-closed-since | `route-data-and-resource-classification.csv` externalProcess rows (changed-since: closed by `c037627`); "no artifact lists outbound egress per route or module" (changed-since: closed by `da36d51`) | The three hand-written pages are still stale. |
| D24-39 | changed-since | section 2.8 "'threat model' appears only in a B03 pointer" (wrong); "earlier chapters were not threat-modelled as such" (wrong) | Still no closure register. |
| D24-40 | partly-closed-since | `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1695` (changed-since: OD-153 at `:1696`; headings end at OD-187, `:2463`); section 2.8 branches (changed-since: `chapter/b22` merged) | OD-5, OD-19, eslint and branches are still open. |
| 5 | changed-since | runbook `:155` "rate and stream bounds" (wrong); `b20-b4-process-gate.test.ts:38-44` -> `app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts:37-44 (case 1 :209)`; `acceptance-pipeline.test.ts:139-143` -> `app/lib/workflow/prompt-to-gerber/__tests__/acceptance-pipeline.test.ts:419-421` (wrong); census -> `b16-1c-invariant-tripwires.test.ts:38, :48 (166/163/3/0)`; counts -> `b20-c1-three-way-parity.test.ts:241 (47/36/9/27)`; execute 409/501 (changed-since: 501 unreachable since `a269e7a`); `CHAPTERS` (changed-since: `b23-` present); `deterministic-manufacturing.yml:317` -> `.github/workflows/deterministic-manufacturing.yml:319`; "from the drafts B22 OD-134/OD-147 and B23 OD-160/OD-171/OD-175/OD-179" (changed-since: now register entries) | `foundation.test.ts:52` needs its path. |
| 6 | partly-closed-since | OD-198, OD-197, OD-200, OD-195, OD-202, OD-207, OD-209, OD-215, OD-218, OD-217, OD-221, OD-222 (all changed-since) | OD-190..OD-222 and LB-13..LB-17 are free. |
| 7 (conventions) | changed-since | "suites under one directory (proposed `app/lib/qualification/__tests__`)" (changed-since: PGlite suites go per file to database-delivery); census and tool counts (changed-since: 166/163/3/0, 47/36/9/27) | Adding `b24-` moves B22 C77 and B23 C15 pins. |
| 7/B24-A1 | partly-closed-since | `/api/health`, `/api/ready` "census +2" (changed-since: 166 -> 168); the two off-only kill switches (changed-since); deployment-configuration record (changed-since) | |
| 7/B24-A2 | changed-since | `.env.example` parity test (changed-since: wider scope) | Webhook secret goes in OD-195. |
| 7/B24-A3 | partly-closed-since | "the classification census flags a public route that calls a provider (counterexample: today it cannot)" -> `app/lib/auth/route-resource-classification.ts:130 (MODEL_EGRESS_PATHS), :139 (PUBLIC_MODEL_EGRESS), :238-247 (outboundEgressViolations, public_model_egress)`; enforcement gate (changed-since) | |
| 7/B24-A4 | stands | none | Restore proof should cover the two aggregates. |
| 7/B24-B1 | changed-since | area links (changed-since: B22-D and B23 suites) | |
| 7/B24-B2 | partly-closed-since | links to B22-D and B23 suites "once merged" (changed-since) | |
| 7/B24-B3 | changed-since | live-suite counterexample (changed-since: B22's two live suites) | |
| 7/B24-C1 | changed-since | "a call through each of the 18 routes" (wrong) -> `app/lib/auth/route-resource-classification.ts:130 (MODEL_EGRESS_PATHS, 23 paths)` | |
| 7/B24-C2 | changed-since | OD-202 retention policy (changed-since: two aggregates) | |
| 7/B24-C3 | stands | none | |
| 7/B24-D1 | changed-since | real-clock unit bounds (changed-since: new budgets and yields); OD-30 duration check -> `.github/workflows/deterministic-manufacturing.yml:319` | |
| 7/B24-D2 | partly-closed-since | "consumes D24-31 from B22-A3; B22-A3's orphan suite cited" -> `app/lib/computation/diagnostic-runner.ts:401-431; b22-a3-diagnostic-runner cases 6, 7, 8, 12, 13; b22-d-adversarial-live.test.ts:290 (case 14)` | |
| 7/B24-D3 | stands | none | Inventory is now 631/63. |
| 7/B24-E | partly-closed-since | item 5 (changed-since); item 7 -> `app/lib/manufacturing-providers/physical-evidence.ts:330 (review port 'none'), :454 (ASSEMBLY_DATA_AUTHORITY 'absent')`; "PROGRAM_STATE.json mirrors every row" (changed-since: 8 of 12; OD-179) | |
| 7/B24-F | partly-closed-since | trust-boundary columns (changed-since: committed); `generator-inventory.md` (changed-since: 23 scripts); threat-model register (changed-since: B22 `threat-model.md`); open-risks list (changed-since: OD-160/OD-178 unheaded, OD-188/189 reserved) | |
| 7/Closeout | partly-closed-since | expected PARTIAL list (changed-since: add B23); OD-221 (changed-since: B22 part done) | |
| 8 | partly-closed-since | Q5 (changed-since: `85439e7` local run); Q14 (changed-since: `discovery.md:1349`, `EXECUTION_LEDGER.md:4344`); Q16 (changed-since: answered except B23's verdict) | Q1 now also gates LB-10. |

### 9.3 What B22 and B23 changed that B24 inherits

#### Narrowed, from the verifier results (no defect is fully closed)

- **Process cleanup (D24-31, 2.6, scenario 12).**
  - B22-A3 (`e483838`, OD-145) routes every ngspice run through one diagnostic runner. It kills the whole tree (`taskkill /T /F` on win32, process-group `SIGKILL` on POSIX; `app/lib/computation/diagnostic-runner.ts:401-431`) and reports `kill_unconfirmed` after a bounded wait (`:560`). `/api/simulate`, the smoke test and the SPICE worker start no process themselves.
  - B22-D's opt-in live case 14 (`b22-d-adversarial-live.test.ts:290`) found no orphan in the lead's single run on 2026-10-02. It never runs in CI.
  - FreeRouting (`autoroute/runner.ts:167, :172`) and kicad-cli (`kicad-cli-runner.ts:98`) still kill only the direct child. B22 records D22-9 as closed in part (`final-verdict.md:100`).
  - Whether `/T` reaches real descendants is INFERRED.
- **Sandbox-escape evaluation (D24-16, 2.4).**
  - B22-D's `b22-d-adversarial` covers all 16 runbook `:938` classes offline, in CI (`deterministic-manufacturing.yml:226`).
  - The live diagnostic run passed 12 of 13. Class 4 (hardlink write-through) is NOT CONTAINED (`adversarial-matrix.md:323-345`).
  - The OCI class is BLOCKED (LB-10).
- **Quote/order denial and idempotency (D24-16, 2.4, scenario 20).**
  - These are now proven offline in CI through `deterministic-manufacturing.yml:227` and `:301`: `b23-b-approval-plan.test.ts:208, :369`; `b23-c-order-contract.test.ts:68, :130, :294`; `b23-b-exchange-ledger` and its PGlite twin; `b23-c-ordering-disabled`; `b23-a-no-order-structural.test.ts:181`.
  - Ordering is visibly disabled (OD-170..OD-172 applied). Live work stays BLOCKED (LB-11, LB-12).
  - The proofs use fake ports. No browser case sends an order.
- **Flags (D24-11, 2.1).** Three switches now exist:
  - `SIRKIT_NAMED_COMPUTATIONS`: B22-B, exactly "1", default off (`computation-runtime.ts:20, :24`; OD-158).
  - `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS`: B23-A1, off-only (`provider-admission.ts:23`), read by `POST /api/pcb/provider-exchange` (`route.ts:47`).
  - `SIRKIT_ORDERING_DISABLED`: B23-C, off-only (`ordering-enablement.ts:41`; OD-171 applied, `OWNER_DECISIONS.md:2338`).

  Still missing: a flag inventory, a test that pins every default, and any sandbox switch other than the diagnostic runner's unset install pin (`diagnostic-runner.ts:255-259`).
- **Route classification (D24-8, D24-15, D24-38).** B23-A2 (`da36d51`) added:
  - explicit `externalTransfer` and `spend` on every route policy;
  - derived `outbound_egress` and `model_egress` columns on all 166 CSV rows;
  - `outboundEgressViolations`, with `PUBLIC_MODEL_EGRESS` (`route-resource-classification.ts:137-142`) recording the two anonymous OpenAI-embedding routes as reviewed exceptions under OD-174;
  - a CI byte pin of the classification CSV (`b23-a-route-vocabulary.test.ts:667`);
  - a transport and per-route egress inventory (`artifacts/ai-control-plane-b23/tier3-vocabulary.md:210-236`).

  `providerCredit` is still hard-coded false and never enforced, and no limiter was added to the public routes.
- **`externalProcess` rows (D24-38).** Corrected by B22-A2 (`c037627`) and pinned in CI by `b22-a2-process-census`.
- **Physical evidence (D24-35).**
  - B23-D's `app/lib/manufacturing-providers/physical-evidence.ts` defines `sirkit.physical-evidence.v1`: eight closed kinds, validators, and a server-derived review port with `PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING = 'none'`. `assembledProductEligibility` answers blocked for every input.
  - `manufacturing.assembled-release` stays `missing` (`action-registry.ts:118`), pinned by `b23-d-assembled-release-blocked` (OD-177).
  - The five CD-11/12/13 functions are pinned callerless by `b23-d-latent-claim-paths` (OD-176).
  - There is no store, route, tool or form.
- **Threat modelling (D24-39).** B22 wrote `artifacts/ai-control-plane-b22/threat-model.md` (`c037627`) and `adversarial-matrix.md` (`c9fbbb0`). There is still no program-wide closure register.
- **Records (D24-40).** Every OD-134..OD-159 is now a register heading, and `chapter/b22-sandboxed-computation` merged as `43cb1b0` (PR #13).
- **Versioned tool configuration (2.1).** B22-A2 added digest-pinned runtime profiles, and B23-A1 added `PROVIDER_REGISTRY_VERSION` 1.0.0. The LLM provider, model, effort and role configuration is still unversioned (D24-10).
- **B11 suite health (D24-15, Q5).** B22's local closeout run at `85439e7` was green:
  - `app/lib/agent/__tests__`: 415 of 415;
  - gate F (`app/api/chat` with `app/api/mcp`, the import gates and the route matrices): 39 files, 357 passed;
  - `app/lib/auth/__tests__`: 479 passed, 9 skipped;

  per `test-and-validation-report.md:94, :97, :101`. These suites are still outside CI and were not re-run at `dfd51e3`.

#### Widened

- **D24-1.** B22 records that no `next build` was ever run, and that how `next build` serves `engine-worker.mjs` is UNKNOWN (`final-verdict.md:110`; `unknowns-and-owner-decisions.md:141`; OD-158; `computation-runtime.ts:7-9`). Production simulation stays BLOCKED until B24-A names the production host (`final-verdict.md:124`; `OWNER_DECISIONS.md:1710, :1723`).
- **D24-3.** B23's exchange ledger is written through the same single `DATABASE_URL` role (`provider-exchange/route.ts:51, :62`). The `supabase.`-only TLS rule also appears at `migrations/postgres-executor.ts:32` and `scripts/backfill-mpn-and-generics.ts:77`.
- **D24-4.** Ten names read by B22/B23 code are undeclared in `.env.example`. B23 also added two single-value secret seams, neither holding a value today: the webhook HMAC secret, used only by the order contract that no composition root wires, and the provider credential header (`provider-egress.ts:198-201`), reached by `POST /api/pcb/provider-exchange` only past admission, with `PROVIDER_TRANSFER_DESCRIPTORS` empty (`provider-egress.ts:69`).
- **D24-5.** B23-B1's `ProviderExchangePanel` preview and commit controls (`ProviderExchangePanel.tsx:135-140`) are another frameable approval surface. The exposure is latent while the server refuses every commit.
- **D24-13.** Two durable aggregates have no purge: `mfg.provider-exchange.v1` (composed into a route but written only past admission, which no provider passes; OD-167) and `computation.evidence.v1` (bound to no route; OD-141). B23's only time-based deletions are in-memory maps.
- **D24-21.** B23-A2's derived `MODEL_EGRESS_PATHS` counts 23 model-egress paths. Only `/api/chat` is traced, so 22 are untraced.
- **D24-28.**
  - Five more CI-gated real-clock bounds (about 45 in total; the tightest is still 700 ms).
  - The first load failure on the GitHub runner itself (`EXECUTION_LEDGER.md:4619`).
  - Per-test budgets and yields followed earlier local timeouts (`e8c7928`, `4a988c8`, `9cb675d`), and explicit budgets followed that CI failure (`a02c9fb`, with `d5f5512` restoring `b23-b-approval-plan` case 18); no bound was reclassified.
  - The browser job now takes about 19m50s against its 30-minute limit (`:4281`).
- **D24-34.** The human-only `project_admin` route `POST /api/pcb/provider-exchange` and its panel have no browser spec in any auth mode.
- **D24-36.** The provider exchange re-runs `revalidateReleaseAuthority`. OD-168 marks provider observations stale at the expiry. The registry pins `evidenceExpiresAt` '2027-09-09' (`provider-registry.ts:180-186`).
- **D24-37 and D24-38.** The Tier 3 decision functions now also cover the external-transfer side effect and `TIER3_FLOOR_PATTERN`, so the stale hand-written pages are further behind.

#### Unchanged in substance

D24-2, D24-6, D24-7, D24-9, D24-10, D24-12, D24-14, D24-17, D24-18, D24-19, D24-20, D24-22, D24-23, D24-24, D24-25, D24-26, D24-27, D24-29, D24-30, D24-32 and D24-33. Some of these had citations or inputs move.

#### New counts at `dfd51e3`

| Item | `50fe156` | `dfd51e3` | Source |
|---|---|---|---|
| Route census | 165/162/3/0 | 166/163/3/0 | `b16-1c-invariant-tripwires.test.ts:38, :48`; `0c78e93` |
| Tool counts | 42/33/9/24 | 47/36/9/27 | `b20-c1-three-way-parity.test.ts:241`; `b4c7be7` |
| Action records | 102 | 106 | B01 matrix, 107 lines |
| UI control sites / surfaces | 628 / 62 | 631 / 63 (195 unlabelled) | B17 summary |
| `route.ts` files | 151 | 152 | `git ls-tree` |
| Migrations / tables | 31 / 143 | 31 / 143 | `drizzle/` |
| Live-blocker rows | LB-1..LB-9 | LB-1..LB-12 | `LIVE_BLOCKERS.md:5-18` |
| `PROGRAM_STATE.json` mirror | 4 of 9 | 8 of 12 | `:12-21` |
| Generators | 20 + 2 | 21 + 2 | `scripts/` |
| CI-gated real-clock bounds | about 40 | about 45 | heuristic; the +5 is certain |
| Model-egress paths (untraced) | at least 18 (grep) | 23 (22 untraced) | `route-resource-classification.ts:130-136` |
| New non-test `SIRKIT_*` env names | — | +12 | 9.5 item 28 |
| CI ranges | — | prompt-to-gerber `:50-259`; database-delivery `:272-302`; page-browser-e2e `:317-336`, timeout `:319` | `deterministic-manufacturing.yml` |

#### New records and numbering

- **OD headings.**
  - Every OD-134..OD-159 is now a heading, all B22's except SEC-1's OD-151 and OD-152 (OD-146, OD-148, OD-150's approval half and OD-153 were already headings at `50fe156`).
  - B23 recorded OD-161..OD-187 except OD-178. OD-160 and OD-178 remain discovery rows (`artifacts/ai-control-plane-b23/discovery.md:767, :785`).
  - OD-135, OD-150 and OD-174 each have two headings, new since `50fe156` (OD-52, OD-54, OD-74 and OD-80 already had two).
  - The headings end at OD-187 (`OWNER_DECISIONS.md:2463`).
- **Reservation.** B23 recorded its OD-181..OD-189 reservation (`discovery.md:1197, :1349`; `EXECUTION_LEDGER.md:4344`). OD-188 and OD-189 are unspent.
- **Live blockers.** New rows LB-10 (`c037627`, OD-147) and LB-11/LB-12 (`79fa18b`, OD-179). LB-5 has a dated B23-D note but is still "not attempted". OD-179 deliberately leaves LB-4, LB-6, LB-7 and LB-8 out of `PROGRAM_STATE.json`.
- **OD-174.** It records the two anonymous OpenAI routes as an open owner question: "A2 records them and changes no route" (`OWNER_DECISIONS.md:2045-2046`). The drafter's `git grep` at `dfd51e3` found:
  - no `B24-A3` and no `D24-` anywhere in `artifacts`, `app` or `scripts`;
  - no `B24` in OD-174's two headings (`OWNER_DECISIONS.md:2034`, `:2127`);
  - `B24` mentioned only at `:1708`, `:1710` and `:1723` (B22: B24-A names the production host) and at `:2439`, `:2473` and `:2496` (B23-D: recording, the review port and the recording route belong to B24-E).

  The context's statement that OD-174 names B24-A3 / D24-8 is not in `dfd51e3`. The lead checks B23's closeout for it.

#### Reusable parts B24 inherits

- the `model_egress` / `PUBLIC_MODEL_EGRESS` census;
- the versioned provider registry and runtime profiles;
- `mfg.provider-exchange.v1`, a store composed into a route and tested on PGlite in CI, as a durable-store template;
- the append-only extension of the admission-key union, as done for `manufacturing-provider` (`admission-control.ts:48-51`, `:472+`);
- B22's `b22-closeout-statements` tripwire;
- B22-D's NOT MEASURED positive-control convention;
- B23-B3's scoped read-only reader (`GET /api/pcb-sync`).

### 9.4 Consequences for the increment plan (section 7) and the owner decisions (section 6)

#### Increment plan

- **Start.** Main is still `43cb1b0`. B24 starts after B23's closeout merges, and the lead delta-checks the closeout first.
- **Conventions.**
  - The review baselines are 166/163/3/0 and 47/36/9/27.
  - PGlite suites must sit outside every prompt-to-gerber filter (`b19-e-ci-job-scope.test.ts:96-99`) and be admitted file by file to database-delivery (`:148-154`). B23's sibling `database/__tests__` folder is the precedent (`deterministic-manufacturing.yml:301`).
  - Adding `b24-` at `b19-e-ci-job-scope.test.ts:54` moves two line pins by review, as OD-180 did: B22's C77 (`deck-and-secret-corrections.md:484`) and B23's C15 (`provider-registry.md:303`).
- **B24-A1.**
  - Health and ready move the census from 166 to 168. Each new row must state `externalTransfer` and `spend` and gets derived egress columns.
  - `/api/ready` must read key names only and bind no SDK client; otherwise `model_egress` is derived true.
  - `worker()` hard-codes `authoritativeWrite: true` (`route-policy.ts:77-79`), so `/api/ready` needs a reviewed read-only constructor.
  - OD-200 shrinks to an inventory with pinned defaults over the current names (12 new since `50fe156`), plus one off-only switch for B22's diagnostic runner.
  - OD-199 should reference B22-C's server-registry runtime-profile digests and B23's provider registry rather than re-create them.
  - The production-smoke job will be the first `next build` of `engine-worker.mjs`.
- **B24-A2.**
  - The env-name parity test covers the ten B22/B23 names.
  - OD-195 records B23-C's caller-supplied webhook secret (`order-contract.ts:107`) and B23-B2's provider credential header as single-valued, the webhook secret unwired and the credential header reached only past admission, with no transfer descriptor.
  - The header spec also protects the latent `ProviderExchangePanel` surface.
- **B24-A3.**
  - Its census counterexample is false at `dfd51e3`. Restate it as "a reviewed `PUBLIC_MODEL_EGRESS` path has no enforced limiter".
  - B24-A3 edits `route-resource-classification.ts`, regenerates the CSV and moves `b23-a-route-vocabulary` pins (`:679`, `:817-819`) by review.
  - The `embedding` admission key follows B23's append-only pattern.
  - The gate's scope includes `/api/pcb/provider-exchange`, whose CSV row is `expensive=true`.
- **B24-A4.** Unchanged in substance. Its restore fixture should include `computation.evidence.v1` and `mfg.provider-exchange.v1`. The TLS change touches three sites.
- **B24-B1.**
  - The catalog links B22-D's suites and B23's `b23-a-no-order-structural`, `b23-c-order-contract`, `b23-b-exchange-ledger` (plus `-pglite`) and `b23-b-approval-plan`.
  - B22-D's live class 4 NOT CONTAINED is carried as a failing physical-runner result.
  - B23-D's `hardware|dry_run` execution class is the nearest physical-class contract.
- **B24-B2.**
  - The escape and idempotency links are concrete now.
  - What remains: the B09-B11 and B16.0 admissions, the power/ground evaluation (OD-205) and the browser order case. A quote-refusal case could join it, since B23 left a quote ask unrouted (OD-173).
  - Admissions must be measured against prompt-to-gerber's 25-minute limit (`deterministic-manufacturing.yml:26`) and the vitest worker-RPC timeouts behind `4a988c8` and `9cb675d`.
- **B24-B3.** The honesty census adds `b22-a3-runner-live` and `b22-d-adversarial-live` (`SIRKIT_B22_LIVE_RUNNER=1`) and reuses B22-D's NOT MEASURED convention. No suite reads `SIRKIT_B23_LIVE_PROVIDER`.
- **B24-C1.** It iterates the 22 `MODEL_EGRESS_PATHS` other than `/api/chat`, not 18 routes. `mfg.provider-exchange.v1` is the nearer durable-store template.
- **B24-C2.** The retention policy names the two aggregates and B23-B3's observations. B23's descriptor-level "retention" field limits which provider content is kept; it is not a time rule.
- **B24-C3.** Unchanged. B23-B3's reader is a precedent.
- **B24-D1.**
  - The threshold census includes the new per-case budgets, the yields and the vitest 60 s worker-RPC limit.
  - The OD-30 timeout line is now `:319`.
  - The browser job runs about 19m50s.
- **B24-D2.**
  - Owns, or records as open, the tree kill and an orphan check for FreeRouting and kicad-cli.
  - Cites B22-A3's ngspice tree kill and B22-D's opt-in case 14.
  - A paged board read moves 47/36/9/27 by review.
  - Routed boards are already partly readable through `sirkit.pcb.via-inspect` and `sirkit.pcb.mechanical-inspect`.
- **B24-D3.** Its rule covers 631 sites on 63 surfaces, including `ProviderExchangePanel`.
- **B24-E.**
  - Item 4 uses B22's pin names, not `NGSPICE_BIN`.
  - Item 5 builds on B23's existing fake-backed flow and also needs a reviewed transfer descriptor and the owner-run B23-B4.
  - Item 7 builds on `physical-evidence.ts`.
  - Mirroring every row in `PROGRAM_STATE.json` reverses OD-179, which needs a dated OD-179 note.
  - The statement tripwire extends `b22-closeout-statements` and B23's planned receipt-claim tripwire.
- **B24-F.**
  - It joins columns that are already committed: `outbound_egress`, `model_egress`, `externalTransfer` and `spend` (B23-A2); `external_process` (B22-A2); `APP_SPAWNERS`.
  - It inventories 23 generators and cites B22's `threat-model.md`.
  - Its OD list marks every gap and duplicate: OD-83..OD-86 and OD-88 reserved (`OWNER_DECISIONS.md:687`), OD-188/OD-189 reserved and unspent, OD-47, OD-51, OD-89, OD-93, OD-94, OD-160 and OD-178 unheaded, OD-52, OD-54, OD-135, OD-150 and OD-174 as double headings, and OD-74 and OD-80 as amended in place (each with a second, amendment heading).
  - Its sandbox line states class 4 NOT CONTAINED.
- **Closeout.** B23 is added to the expected-PARTIAL list. OD-221's remaining record work is OD-5, OD-19, OD-160 and OD-178. The identity statement names the five GitHub PR merge commits that carry a noreply author.

#### Owner decisions

- **Restated (Part 3 carries the text):**
  - OD-190 also gates LB-10.
  - OD-195: ten names and two seams.
  - OD-197: keys on public `model_egress` and moves B23's pins.
  - OD-198: 166 -> 168, plus a reviewed read-only constructor.
  - OD-200: inventory plus a diagnostic-runner switch.
  - OD-202: names the two aggregates and the observations.
  - OD-207: 22 paths.
  - OD-209: B22's live suites.
  - OD-215: B23's panels.
  - OD-217: reverses OD-179.
  - OD-218: store, recording route and wired review port (`physical-evidence.md:272-273`; OD-187 (c), (h)).
  - OD-219: renewal is also a reviewed code change.
  - OD-220: cites the existing threat models.
  - OD-221: OD-160 and OD-178 instead of B22's decisions.
  - OD-222: admitted-but-skipped live suites, plus the C77/C15 pin moves.
- **Should also be restated:** OD-199 should reference the runtime-profile and provider-registry digests (no Part 3 text was drafted for it).
- **Still hold as written:** OD-191 to OD-194, OD-196, OD-201, OD-203 to OD-206, OD-208, OD-210 to OD-214 and OD-216.

#### Numbering

| Range | Status at `dfd51e3` |
|---|---|
| OD-190..OD-222 | Free. The highest OD heading is OD-187; the highest real OD number mentioned anywhere is OD-189 (the reservation text); B23-C's tests and `ordering-boundary.md:53` use only a fake `OD-999`. |
| LB-13..LB-17 | Free. LB rows end at LB-12. |
| D24- ids | None exist (the drafter's `git grep`). |

No draft OD or LB number needs to shift. Re-check after B23's closeout, which must not spend OD-188 or later, or LB-13 or later.

### 9.5 Problems the re-verification found (old text -> corrected text; applied in place, 9.6)

1. **Section 0, assist route.** "(`app/api/pcb/edit/assist/route.ts:35`)" -> "`:349`". `:35` is the import at both trees; D24-18 and D24-19 inherit it.
2. **Section 0, B18 counts.** "(`artifacts/ai-control-plane-b18/permission-tiers.md:30, :37`)" -> "`:37`". `:30` holds only "153 -> 155 methods" (D24-38 verifier). Section 2.8's ":30, :37" for "155 methods, 97 records…" is correct as written.
3. **Section 5, release identity.** "`acceptance-pipeline.test.ts:139-143`" is the re-recording branch -> "`app/lib/workflow/prompt-to-gerber/__tests__/acceptance-pipeline.test.ts:419-421`". Wrong at `50fe156` too.
4. **Section 5, runbook `:155`.** "- `:155` rate and stream bounds;" is wrong. `:155` lists SSRF, DNS rebinding, redirect escape, oversized bodies, decompression bombs, path traversal, archive confusion, unsafe MIME types, unbounded streams and unbounded tool loops; it has no rate bound. `:1039` carries the rate requirement. The two pins named (`b17-f :71`, `b20-b4`) pin `:157`. `b23-b-bounded-upload` now pins part of `:155` for the upload path.
5. **Section 5, foundation suite.** "`foundation.test.ts:52`" -> "`app/lib/model-simulation/__tests__/foundation.test.ts:52`". Four files share that name (under `firmware-bringup`, `full-flow`, `model-simulation` and `release-engineering`).
6. **Section 5, process gate.** "`b20-b4-process-gate.test.ts:38-44`" -> "`:37-44` (case 1 `:209`)". The spawner list was rewritten by `e483838` and `b4c7be7`.
7. **Section 2.6, orchestration config.** "config reuses the server with the flag on" -> it starts its own server (`reuseExistingServer: false`, `playwright.orchestration.config.ts:42`). Inaccurate since `50fe156`.
8. **Section 2.2, gated-suite count.** "(synthesizer grep of the ten gated suites)" -> nine test files import the gate at both trees (one of them its contract suite, `b16-b-database-qualification`), and the ledger counts the same nine DB-gated suites (`EXECUTION_LEDGER.md:2496-2507`). The finding itself holds.
9. **Sections 2.8 and 5, commit identity.** "every commit since `5a59a1f` uses …" holds only under `--no-merges` (109 of 109). The five PR merges #9-#13 (`102dd27`, `6fd5a7b`, `e109d76`, `d0d2ec8`, `43cb1b0`) carry a GitHub noreply author.
10. **Section 2.8, pins outside CI.** "B09, B10 and B11 artifacts" -> B10 only. B09's `provider-schema-parity.json` (`b20-c1-three-way-parity.test.ts:326`) and B11's `replay-trace-pins.json` digest (`b21-f-evaluation.test.ts:530`) are pinned in CI. Wrong at `50fe156` too.
11. **Section 2.8 and D24-39, threat models.** Two statements are wrong:
    - "\"threat model\" appears only in a B03 pointer";
    - "earlier chapters were not threat-modelled as such".

    Other sources exist:
    - B03.1's `security-boundary.md`, which `revision-history-contract.md:120-121` calls the "Full threat model";
    - the CD-10 stage report's `## Threat model` (`docs/stage-reports/SIRKIT_CD_10_MODEL_BACKED_SIMULATION_IMPLEMENTATION.md:55`);
    - mentions in `app/lib/requirements/verification.ts:12` and, at `50fe156` only, `PROGRAM_STATE.json:5` (B22-A2's planned threat model);
    - B22's `threat-model.md` and `adversarial-matrix.md`.

    OD-220's "with no claim that B01-B17 were threat-modelled" changes with this.
12. **D24-2 and 2.2, DOWN section range.** "`0028_bom_project_ownership.sql:62-70`" -> "`:62-72`". The file has 72 lines.
13. **D24-3, RLS bypass.** "which 0027 describes as bypassing RLS (`0027:40-41, :52-55`)" is not supported as stated. `0027:40-41` attributes the bypass to a service-role key that the code never reads; the repository uses `getDb()` on `DATABASE_URL` (`postgres-membership.ts:11, :17`). The `DATABASE_URL` bypass is INFERRED. Section 2.2's wording is the more exact one.
14. **Section 2.4, `ai_safety`.** "(no `ai_safety` task, reader 2)" -> `ai_safety` is a declared task kind (`types.ts:16`) and metric domain (`metrics.ts:20`); no corpus package uses it.
15. **Section 2.4, power and ground.** "no suite or case names it" -> "no agent or evaluation case names it". Deterministic titles do mention grounds or power: `graph-authority.test.ts:19`, `route-tool.commands.test.ts:145`, `verification-corpus.test.ts:53`.
16. **D24-29 and 2.6, routed boards.** "the model cannot read any routed board" was overstated even at `50fe156`. Only `board-inspect`'s full snapshot exceeds the budget. `sirkit.pcb.via-inspect`, `sirkit.pcb.mechanical-inspect`, `sirkit.selection.inspect`, connectivity-verify and drc-run remain (`agent-exposure.ts:37-38`; `tool-bindings-readonly.ts:170-191`).
17. **D24-19, framing.** The title fits only the two early returns. On reading:
    - `assist-live` expects 200 in every case (`:57, :71, :80, :89`) while the route answers 400/401;
    - the oracle asserts `toBeGreaterThan(0)` on an empty board.

    Both would most likely go red (INFERRED). Suggested title: "Two opt-in live suites can report green without exercising the resource, and two more are broken."
18. **D24-21 and 2.5, untraced routes.** "At least eighteen" -> 22 untraced paths, from the derived set. "No error record" is true only for durable records: on the 18 grep routes, provider failures are `console.error`-logged (`errors.ts:188-194`).
19. **D24-32, breakpoint class.** "one breakpoint class" -> "in `app/page.tsx`". Other workspace components carry 44 responsive classes, the same count at both trees.
20. **D24-34 vs section 7 B24-E item 2.** "(LB-1, OD-191)" vs "(LB-1, LB-13)". Align the two.
21. **Section 2.8, integration branch.** "the local-only `integration/ai-control-plane-b16-0`" is imprecise. `origin/integration/ai-control-plane-b16-0` exists at `6956e74` and is contained in `dfd51e3`; the local branch has 2 commits not in `dfd51e3`. Only the named branches were checked (`git branch -a` was outside the allowed commands).
22. **Section 0 and Q14, numbering.** Two statements are stale:
    - "headings end at OD-153 (`:1695`)" -> they end at OD-187 (`:2463`), and OD-153 is now at `:1696`;
    - "nothing records that reservation" -> B23 recorded it (`discovery.md:1197, :1349`; `EXECUTION_LEDGER.md:4344`). B23's item 12 now reads "ANSWERED by B22" (`discovery.md:941-942`).
23. **Stale counts throughout** (header, 0, 1.3, 2.1, 2.6, 2.7, 2.8, 3, 5, 6, 7, 8). The 9.3 table gives the new values; Part 3 replaces each one.
24. **Section 7 B24-A3, counterexample.** "the classification census flags a public route that calls a provider (counterexample: today it cannot)" is false at `dfd51e3`. Restate it, and note that the edit moves `b23-a-route-vocabulary` pins `:679` and `:817-819` by review.
25. **D24-31 and B24-D2, ownership.** "Closes: B22-A3 (tree kill, orphan suite, OD-145), consumed by B24-D2" and "B22-A3's orphan suite cited" name the wrong increment. The orphan check is B22-D's opt-in case 14, and the FreeRouting and kicad-cli work remains open.
26. **Section 6 defaults built on stale facts:**
    - OD-200: external manufacturing already has two switches.
    - OD-218: "a store … and nothing else" understates B23-D's handoff.
    - OD-219: "the frozen-clock CI identity is unaffected" holds only until renewal.
    - OD-221: the B22 part is done.
    - OD-222: "never in CI" conflicts with the OD-59 every-suite guard (`b19-e-ci-job-scope.test.ts:148-153`).
    - OD-217: mirroring every row reverses OD-179.
27. **Verifier conflict, undeclared names.** The D24-4 and 2.1 verifiers write "nine" over a ten-name list; the section 6 verifier counts ten. This page uses ten.
28. **Verifier conflict, `SIRKIT_*` census.** The 2.1 verifier gives 46 -> 59 and the D24-11 verifier 47 -> 60. They differ by one name already at `50fe156` (scope), and both deltas are 13: the 12 new environment names that 7/B24-A1 also counts, plus the regex constant `SIRKIT_MINTED_ID` (`physical-evidence.ts:124`). Re-derive before printing an absolute number.
29. **Verifier conflict, database-delivery range.** The 1.3, 2.2 and 3 verifiers give `:272-302` for the draft's shifted range; the D24-7 verifier gives `:272-310` for the whole job. Part 3 uses `:272-302`; the lead checks the end line.
30. **Verifier conflict, who owns OD-174's question.** The 7/B24-A3 verifier says OD-174 "leaves them to B24-A3". The D24-8, 2.3 and section 0 verifiers, and the drafter's `git grep` (9.3), find no B24 assignment at `dfd51e3`. Check B23's closeout.
31. **Verifier conflict, webhook citations.** Three sets were given: `webhook-verification.ts:74, :90` with `order-contract.ts:295` (D24-4); `:9, :29-30` (2.3); `:19, :29` with `order-contract.ts:107` (7/B24-A2). Re-read once and use one set.
32. **Not re-read by the verifiers:**
    - D24-7: "stores fail closed on outage" has no file:line.
    - D24-10: the `openai-config` claims and `ToolDescriptor.version`.
    - D24-12: `test-qualification.ts`'s read of only `SIRKIT_DB_QUALIFICATION` and `SIRKIT_DB_QUALIFICATION_URL` (the file is unchanged since `50fe156`).
    - D24-13: the audit tables, table by table.
    - D24-17: scenarios 1, 4-6, 9-11, 13-16 and 19, and OD-27.
    - D24-27: reader 4's 170 s qualify and 300 s DAG cap.
    - D24-11: the B23 default-pin suites; that every SPICE caller goes through the diagnostic runner is inferred from imports.
    - D24-16: B23's idempotency proofs use fakes; B22-D's live result is taken from the records.
    - D24-38: mapping "143 routes" to 152 B01 route paths is an interpretation.
    - D24-37: what the ledger's "21 generators" denotes.
    - D24-40: the 14 eslint errors.
    - D24-15 and D24-21: no CI log was read.
33. **Still INFERRED or UNKNOWN by design:**
    - D24-3: Data API exposure.
    - D24-5: `X-Powered-By` and clickjacking exposure.
    - D24-6: the Supabase Site URL and redirect list.
    - D24-12: whether the main project holds production data.
    - D24-14: whether a run that is all `blocked_by_prerequisite` passes the regression check.
    - D24-18 and D24-19: live-suite outcomes.
    - D24-22: whether SDK retries are invisible in traces.
    - D24-31: whether `/T` reaches real descendants.
    - D24-36: whether renewal moves the pinned release identity (from `release-manifest.ts:137, :188-196`).
    - Section 2.1 also omits that `mode.ts:89-91` falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
34. **B23's closeout is not in `dfd51e3`.** Delta-check before committing:
    - `LIVE_BLOCKERS.md` and `PROGRAM_STATE.json`;
    - `OWNER_DECISIONS.md`: headings for OD-160 and OD-178, any B24 link on OD-174, and any number beyond OD-189;
    - any LB-13 or later;
    - any threat section or receipt-claim tripwire.
35. **Process deviations.**
    - The D24-4 verifier wrote `envnames-50fe156.txt` and `envnames-dfd51e3.txt` to the session scratchpad.
    - The D24-10 and header verifiers wrote `sirkit_names_50fe156.txt` and `sirkit_names_dfd51e3.txt` there. All four files hold names only, outside the repository; the lead may delete them.
    - The D24-10 verifier piped git output through `sed`, `cut`, `grep`, `wc`, `sort`, `diff` and `cat`.
    - The 2.6 verifier ran one read-only python one-liner on `git show` output, then re-derived the count with `git show | grep`.
    - The drafter of this section ran one `wc -l` on the draft file.

    No repository file was touched and nothing in the repository was executed.

### 9.6 The lead's decisions

- **All 193 text corrections are applied in place** (the draft was never committed, so no superseded statement stands in the
  repository). Before applying them, five read-only auditors checked every correction, amendment and section-9 claim against the code
  at `dfd51e3` and found 37 problems (wrong attributions such as OD-151 and OD-152 to B22, a nine-suite count given as eight, a credential
  seam called unwired that the provider exchange route reaches past admission, two wrong line numbers, overstated counts); one agent
  corrected each, and the lead validated the result (every replaced text unchanged, unique and applicable in order) and re-read eight of
  the new citations at `dfd51e3`. The sixteen dated notes on D24-4..D24-40 are the re-verification's section-4 amendments.
- **9.5 item 29 (database-delivery range):** the job runs `deterministic-manufacturing.yml:272-309` and its vitest step `:286-302`;
  `:272-302` (the job's start through that step) stands where the draft cites it.
- **9.5 item 31 (webhook citations):** one set - `webhook-verification.ts:29-30, :74` (the secret check, the HMAC and the verifier that
  takes a caller-supplied secret) and `order-contract.ts:107, :295` (the contract's webhook option and its one call).
- **9.5 item 30 (OD-174's question):** B23's closeout leaves the assignment to this discovery (`artifacts/ai-control-plane-b23/final-verdict.md`: "its assignment is for the B24 discovery to record"), and this discovery records it - B24-A3 owns OD-174's open question (D24-8, OD-197).
- **9.5 item 20 (D24-34 vs B24-E item 2):** aligned on B24-E's reading - the production-auth browser run stays
  BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13), and whether an isolated project exists is OD-191's; D24-34 is corrected in place.
- **9.5 item 34 (B23's closeout, `b6c6b0d`, `f663d71`), delta-checked:** it moved no line in any production file (each note in place on its line)
  and appended its page sections after each page's last line; the one insertion inside a cited file is D23-16's closure clause at B23
  `discovery.md:656`, so this page's B23 discovery citations moved by one (`:767` -> `:768`, `:785` -> `:786`, `:1197` -> `:1198`,
  `:1349` -> `:1350`; corrected in place in sections 0-8). OD-178 (`OWNER_DECISIONS.md:2536`) and OD-188 (`:2545`) were recorded in
  `b6c6b0d` and OD-160 (`:2560`) in `f663d71`, so OD-188 is spent and OD-189 alone stays reserved; the statements of sections 0, 1.3, 2.8,
  6, 7 and 8 that said otherwise are corrected in place, and D24-40 carries a dated delta note. No OD-190+ or LB-13+ was recorded. The
  receipt-claim tripwire 9.4 calls planned now exists (`b23-closeout-statements`, `b6c6b0d`), which B24-E's statement tripwire
  extends. B23's verdict is PARTIAL (`artifacts/ai-control-plane-b23/final-verdict.md`), as section 7's closeout expected. The census and
  the tool counts did not move (166/163/3/0, 47/36/9/27). Section 9 above is the record of what was verified at `dfd51e3` and is left
  as written.
- **9.5 items 32 and 33** stay open as listed: each increment re-reads what it relies on before its commit or keeps it UNKNOWN.
- **9.5 item 35:** the four scratch files of names the verifiers wrote outside the repository were deleted by the lead; nothing in the
  repository was written or executed.
- **Numbering:** OD-190..OD-222 and LB-13..LB-17 stay as drafted (free at `dfd51e3` and after B23's closeout); OD-223 onward is
  reserved for choices the increments make beyond them.
- **Baselines:** census 166/163/3/0 and agent-tool counts 47/36/9/27 at `dfd51e3`; B24-A1's health and readiness routes take the
  census to 168 by review (OD-198).
- **Every B24 page** keeps the B21, B22 and B23 closeout tripwires green: no superseded phrase they scan for and none of their dated
  note prefixes (this page included; checked by running all three suites on it before the commit).

---

## 10. Amendments recorded by the increments

(none yet)
- [B24-A1, 2026-10-06] B24-A1 landed the deployment profile and its blocker, the configuration record, the flag inventory and the diagnostic-runner switch, the CI admission of `b24-`, `/api/health` and `/api/ready` (census 168 / 165 / 3 / 0) and the `production-smoke` job (PROPOSED until the lead's local production-mode run and its first CI run are green; environments-and-deployment.md). Pins the plan did not name (OD-222 and 9.4 name the two `CHAPTERS` anchors, which are not repeated here): the census lines `b16-1c-invariant-tripwires.test.ts:5, :38, :48`, `b16-1b-auth-composition.test.ts:242, :255`, `b22-a2-process-census.test.ts:315, :317`, `b23-a-no-order-structural.test.ts:183`, `b23-a-route-vocabulary.test.ts:11, :618, :658, :778-779` and `b23-b-exchange-route.test.ts:104, :116` (166 -> 168); the action-record pin `b23-a-tier3-vocabulary.test.ts:272` with B23's C52 (106 -> 107), the record placed at the registry's end (`action-registry.ts:186`) to keep B23's C51; the eight regenerated CSVs (B01 `api-route-coverage.csv` and `ui-command-toolability-matrix.csv`, B16.0 `auth-route-coverage.csv`, B16.0.1 `exact-route-authorization-policy.csv`, B16.0.2 `route-data-and-resource-classification.csv`, B16.0.4 `method-authorization-matrix.csv` and `request-body-boundary-matrix.csv`, B16.0.7 `route-wrapper-matrix.csv`); the four production fixtures that gained the profile (`b16-1b-auth-composition.test.ts:29`, `b16-1b-real-sdk-identity.test.ts:29`, `b16-1b-session-liveness.test.ts:42`, `b16-0-2-csrf-exact-origin.test.ts:19-23`); B21-E1's C20 re-anchored and `b21-e1-provider-policy.test.ts:168` (the Anthropic client timeout); the B16.1B recipe notes (`live-auth-qualification-matrix.md:64`, `b16-1b-live-qualification.test.ts:12`); B21's C49, C93, C94, B23's C64 and B23's prose citation `dfm-quote-flow.md:269` (+1, the filter line; every workflow line from 228 on moved +1, the page's section 10 is the old -> new table and later insertions are rows under it); `b23-a-provider-admission` case 8 admits the four B24 roots (D6).
- [B24-A2, 2026-10-06] B24-A2 landed the security headers (D24-5), the Supabase auth URLs per environment (D24-6), and the previous-value rotation, the environment-name census and the secret scan (D24-4); edge-security.md. Lead notes 1-7 of its task, as applied: (1) the census found 51 names read and undeclared at `1b2c08c`, not the discovery's twenty, so OD-195 is narrowed to the declared classes with every undeclared name listed by class; (2) the scan's six test sentinels are allowlisted by path, rule and line digest (eight since the review round: the connection-string rule's two test fakes); (3) every planted marker is assembled at run time, never committed; (4) the `secret-scan` job is appended after every job and A2's probes sit inside `production-smoke`, so no cited workflow line moved (A1's insertion table: `:420` 11 and `:447` 26); (5) the fourth and fifth suites are `b24-a2-secret-scan` and `b24-a2-origin-allowlist`; (6) the suite names are `b24-a2-*` (D17); (7) HSTS follows the build-time origin (INFERRED), and the builder is a named export of `next.config.ts` (the task's fallback). Pins the plan did not name: `b24-a1-flags` case 1 (49 -> 51, secret 3 -> 5) with dated notes on A1's page section 3; `b24-a1-environment-profile` case 16, a STOP: A1's simulation re-applies A2's planned groups on top of A2's real rows, and its reviewed move is the lead's (edge-security.md section 13).
- [B24-A3, 2026-10-08] B24-A3 landed the abuse controls in one run, A3a then A3b (D24-8; OD-197 applied, OD-174's question answered, OD-225):
- [B24-A4, 2026-10-08] B24-A4 landed the data layer in one run, A4a then A4b (D24-2, D24-3 and D24-7 offline, D24-12; OD-191, OD-192, OD-193, OD-194 and OD-201 applied; OD-217 in part, for LB-14; OD-226); `database-and-recovery.md`.
- [B24-B1, 2026-10-08] B24-B1 landed the golden catalog (D24-14; OD-203 applied; OD-217 in part, for LB-15..LB-17; OD-227); `eval-catalog.md`.
- [B24-B2, 2026-10-08] B24-B2 landed the CI admissions, the corpus on the nightly, power and ground, the browser order case and the catalog links (D24-15, D24-16; OD-204 and OD-205 applied; OD-228; D24-41 and D24-42 opened; OD-229 proposed). Pins it moved that the plan did not name: `b24-b1-catalog` cases 2 and 9, A1's insertion-table row, B23's prose citation of the PGlite entry (`:302` -> `:334`), `abuse-controls.md:75, :385, :388`, `unknowns-and-owner-decisions.md:90`, two production comments, and A1 case 17's reviewed move (the lead's). `ci-admission.md`.
- [B24-B3, 2026-10-08] B24-B3 landed the scenario map (D24-17; OD-206), the live-suite registry with the seven repairs and the census (D24-19; OD-209), and the model-in-loop command offline - the money bound, the two-provider capsule, the contract turns (D24-18 offline; OD-216, OD-125); one workflow line (`worker-integration`, prompt-to-gerber `:292`); suites `b24-b3-scenario-map`, `b24-b3-live-suite-honesty`, `b24-b3-model-in-loop` (section 7 wrote `b24-b-*`; `CHAPTERS`' `b24-` admits both); OD-230. Pins the plan did not name: `b24-a1-configuration` case 14 (a sixth SDK client construction site, the command's, outside the deployment record: its expected site list, the lead's reviewed move, OD-230 (n)), `b24-a2-headers` case 11 through A2's OD-195 block (`edge-security.md:523`), `b24-a2-env-names` `CLASS_COUNTS` and case 10, `ci-admission.md:185`, `mcp-provider-connectors.md:160`, `orchestration-contracts.md:311`. `scenario-map.md`.
- [B24-B3, 2026-10-08] Where the discovery and the code disagreed at `f663d71` (each re-read at `4738aa3`): (1) `assist-live` did not reach Claude - the route defaults to OpenAI when no `provider` is sent (`app/lib/llm/request.ts:3-5`, `assist/route.ts:359-361`), so section 2.4's "Anthropic only" (`:330`) and 2.7's item-1 row (`:436`) were wrong; it now sends `provider: "anthropic"`; (2) it also skipped silently - `describe.skipIf(!hasKey)` folded the flag and the key (D24-19's defect, not listed there); (3) `b16-1b-live-qualification`'s gap was wider than the canary - `LIVE` folded the flag, the marker, the base URL, the email, the password and the project id; it now runs on `FLAG`; (4) the census missed `worker-integration` (`SPICE_WORKER_LIVE`), which failed with a runner error with the flag and no pin; now registered and admitted to CI; (5) the database marker has the same shape (`SIRKIT_DB_QUALIFICATION=1` with no URL skips, `test-qualification.ts:72-75`) and stays B24-A4's (OD-201); (6) the B21 command could record a scripted run as live (`adapters.ts:267, :323`); it now refuses with exit 3; (7) 9.5 item 32's unread scenarios (1, 4-6, 9-11, 13-16, 19) and OD-27 were re-read before each standing (`scenario-map.md` section 2).
- [B24-B3, 2026-10-08] (a) One price table (lead decision D1): B24-B3 built `sirkit.live-price-table.v1` (decimal text), `LivePriceTable`, `livePriceTableProblems` and the money cap in `app/lib/evaluation/live-spend.ts`, and OD-216 is applied; B24-C2 prices through that schema, validator and the `procurement.ts` decimal helpers with one `MODEL_PRICE_TABLE: LivePriceTable | null = null` and no second schema (its Read-first names the money cap as B24-B3's); B24-E's Q1 row points at the one table.
- [B24-C1, 2026-10-08] B24-C1 landed the durable run trace (D24-20) and the LLM call record (D24-21) in one run, C1a then C1b (OD-207 applied; OD-231); one workflow line (database-delivery `:340`); suites `b24-c1-durable-trace`, `b24-c1-durable-records-pglite`, `b24-c1-llm-call-record` (section 7 wrote `b24-c-*`; `CHAPTERS`' `b24-` admits both). Pins the plan did not name: `app/lib/auth/route-handlers.ts:43` (the seam's import, in place), `artifacts/ai-control-plane-b24/ci-admission.md:185` (the browser timeout citation, +1), the appended lines of `router.ts`, `embeddings.ts` and `parts-search.ts`. No migration (32), no census, tool-count, classification or flag move. Two review rounds, test-first: the second keyed the run-trace store by the scope as the substrate stores it (security-1; the chat route's identifier rule, `app/lib/agent/context.ts:268-270`, already refused a padded id before its recorder - the review's chat-level scenario refuted and pinned), moved the reserved operator tenant id outside the selector alphabet (`~sirkit-operator`, security-7) and recorded that a trace warning may carry up to 80 characters of a model-chosen tool name (security-5). `observability-and-replay.md`.
- [B24-C2, 2026-10-08] B24-C2 landed attribution, cost and latency (D24-22, D24-23; OD-208 applied, OD-209's cost half amended) and retention and redaction (D24-13, D24-25; OD-202 applied) in one run, C2a then C2b (OD-232 the choices beyond the drafts); one workflow line (database-delivery `:341`); suites `b24-c2-attribution`, `b24-c2-cost`, `b24-c2-retention`, `b24-c2-redaction`, `b24-c2-retention-pglite` (section 7 wrote `b24-c-*`; `CHAPTERS`' `b24-` admits both). Pins the plan did not name, each moved in place with a dated note: `b24-c1-llm-call-record` 12's `SEAM_CLOSURE` (+ `app/lib/agent/redaction.ts`, reached through `llm/errors.ts`), `b21-e1-stop-reasons` 1's `AgentStep` field list (+ `providerRequestId?`), `ci-admission.md:185` (+1). The census the task named as 30 types at `f663d71` is 34 at C2 (C1's two, C2's two); OD-202's "MCP traces 90 days" and "answer text 30 days" and OD-208's per-tenant salt are restated (process lifetime for the rings; the resume record deleted whole; the salt per scope). No migration (32), no census, tool-count, classification or flag move. `observability-and-replay.md` part 2, `retention-and-deletion.md`.
- [B24-C3, 2026-10-09] B24-C3 landed the read mode of the purge CLI (D24-26; OD-211 applied; OD-233) and the recorded limits (D24-24 as recorded; OD-210 applied) in one run (lead decision D21); one workflow line (database-delivery `:342`); suites `b24-c3-trace-read`, `b24-c3-recorded-limits`, `b24-c3-trace-read-pglite` (section 7 wrote `b24-c-trace-read`; lead decision D17). Where the discovery and the code disagreed at `f663d71` (each re-read at `600d1ba`): D24-24 names one journal and one server check where the code has two of each (two Tier 2 IndexedDB journals plus the Tier 1 grant journal; two read-only server checks, both `read(...)` rows); the Tier 1 grant is server-held and run-bound (`session.runId`), the settlement alone browser-attested; section 2.5's "specialist trace store written only" was too strong - `DurableOrchestrationTraceStore.history` is digest-verified and had no production caller until this read mode; the rings are 1,000 per process for each MCP trace and 500 per `ReadToolInvocationService` instance. Pins moved by review, each in place with a dated note: the constructor census of `b24-c1-durable-trace` 11, `b24-c1-llm-call-record` 12 and `b24-c2-attribution` 12 (+ `scripts/retention-purge.ts`, D11); `b24-c2-retention` 1 (the script's `load-env-local` specifier), 5 (`--read` refused by the purge parser alone) and 7 (the script's constructor and loader text) (D12); B21's C49, C93, C94 (+1); `ci-admission.md:185` (+1); A1's insertion-table row; `retention-cli.ts:13` and `retention-and-deletion.md:138` (dated notes). The adversarial review's eleven confirmed findings were closed test-first in the same commit: the dispatcher is driven over PGlite (`b24-c3-trace-read-pglite` 4), the 30 s deadline is on the whole read, a withheld document's `omitted` counts every collected record, the database client is ended after a read, `TRACE_READ_HEAD_MISMATCH` and `TRACE_READ_FAILED` are reached, the Tier 1 pin reads quoted and computed keys, assignment statements and calls naming the property, the no-access-audit filters show their strength, the two limits of the read mode's access control are recorded (the credential is the only authorization; the production refusal keys on the runtime, not the target), OD-233 (i) is reworded, and the hand check that stood in for the pre-edit run of the B22/B23 page suites is recorded as a deviation. No migration (32), no census, tool-count, classification or flag move; no new dependency. `observability-and-replay.md` part 3.
- [B24-D0, 2026-10-09] B24-D0 landed the OD-30 split of prompt-to-gerber by insertions only (the lead's option 2 after the first run's measurement and STOP; closes no defect): 38 `--exclude` lines at `deterministic-manufacturing.yml:293-330` and the appended job `agent-boundary-suites` (`:551-616`, 20 minutes, no env, secret, database or browser) move 109 files, 398.84 s = 42.8 % of the measured 931.21 s of local testcase time (`ci-split.md` section 4; evidence `artifacts/ai-control-plane-b24/evidence/d0-ptg-timing.xml`); `_ci-admission.ts` reads `--exclude` lines and `jobsOf` is net of them, the B19-E guard admits every non-PGlite suite in exactly one of the two jobs (+1 case), `golden-catalog.ts` and `scenario-map.ts` record the move (both generators twice, zero drift); pins moved in place with dated notes: `b24-a1-environment-profile` 16 (13 -> 15), `b24-a2-secret-scan` (c), `b24-b2-ci-admission` 3 and 4, `b24-b1-catalog` 4, B19-E's cases 1, E3, the chapter case, A0, A4, B21-A and SEC-1, B21-A's guard row (8 -> 9), B21's C49/C93/C94, B23's C64 and prose citation, B24's C50 and the C1-C3 and A4 workflow lines, A1's insertion table (two rows), and the superseded statements of B20, B22, A2, B1 and B2 noted; the review round's ten confirmed findings closed in-tree (the guard's helpers at the end of its file and every guard citation re-pinned, the gates recorded, B2's section-13 statements and the C1-C3 README-row drafts noted, A2's (c) retitled, the evidence's hostname recorded, the merge gate drafted). Expected CI times INFERRED (prompt-to-gerber 11 min 47 s of 25, agent-boundary-suites 8 min 50 s of 20) until the first run. Counts unchanged (census 168 / 165 / 3 / 0, tools 47 / 36 / 9 / 27, 107 action records, 32 migrations, six SDK importers). `ci-split.md`.
- [B24-A2F, 2026-10-09] B24-A2F landed the secret scan's history-only allowlist entries (OD-195 amended; closes no defect; the lead's corrective increment after B24-C3's `ba4f562:75` fake left the pull request's history scan red): `SecretScanAllowlistEntry.historyOnly?: true` in the pure `runSecretScan` - exempt from the tree-mode stale check, allowlisting in `--history` mode exactly as an ordinary entry, its line back in the tree or the index reported and never allowlisted, its reason required to name the replacing commit (a 7-40 hex id) and say replaced or rewritten (`secret-scan.ts` in place `:16`, `:70`, `:108`, `:150`, `:162`; the helper and its two patterns appended at `:384-406`); the ninth entry appended to `secret-scan-allowlist.ts` (`:60-69`, the digest of the line as committed re-derived from the blob and never printed; header `:4-6` amended); no rule, script or workflow line changed, no entry removed, no history rewritten; the real scanner tree 4,127 entries / 8 allowlisted and history `57c3b29..HEAD` 396 entries / 1 allowlisted, both exit 0, the counterexample without the entry reporting the one `ba4f562` line (exit 1); `b24-a2-secret-scan` 18 -> 26 (l-q test-first, 7 red at `b3a4f2d`; r-s in the review round), `b24-a2-headers` 12 -> 13 (section 15's citations C37-C46 checked on their lines as section 14's are, the cited helper range and the judgement's label with them); pins moved in place with dated notes ((d)'s shape list eight -> nine, the suite headers, section 10's `it(` cells, the page's section count 15 -> 16); the review round's four low findings (the helper range `:384-405` -> `:384-406`, the allowlist header's "every entry" sentence, section 15's unchecked citations, the "not a second way" judgement relabelled INFERRED with its cross-commit limit pinned and a `commit` field drafted as PROPOSED) closed in-tree test-first. CI's two `secret-scan` steps after the push are the lead's reading (PROPOSED until read). Counts unchanged (census 168 / 165 / 3 / 0, tools 47 / 36 / 9 / 27, 107 action records, 32 migrations, six SDK importers). `edge-security.md` section 15.
- [B24-D1, 2026-10-09] B24-D1 landed the latency policy, the benchmark job, the threshold census and the OD-30 headroom steps (D24-27, D24-28; OD-212 applied, OD-30 amended, OD-234) and the CD-9 corpus executor (D24-41; OD-204) in one run; suites `b24-d1-latency-policy`, `b24-d1-threshold-census`, `b24-d1-latency`, `b24-d1-latency-workflow` (section 7 wrote `b24-d-*`; `CHAPTERS`' `b24-` admits both). Amendments: the "qualify 170 s in replay" of 2.6 and D24-27 is the browser spec's replay budget (`e2e/prompt-to-gerber.spec.ts:67`), the unit replay budget is 60 s (`acceptance-pipeline.test.ts:109`) and the measured replay is 770 ms median locally; 9.4's "about 19m50s" is superseded by 20 min 25 s on `b6c6b0d` and 16 min 24 s at `b3a4f2d`; "about 45" CI-gated bounds are 55 at `6acae24` (53 before the review round taught the scanner helper-returned timings); section 3's `b20-a4-observation-normalizer.test.ts:356-369` is the NFC counter's `:358-369` (its wall-clock bounds were `:338, :343, :354, :370`, moved by D1). The lead's departures from section 7's D1: the headroom steps in `prompt-to-gerber` and `agent-boundary-suites` too (D19), the non-blocking `baseline_missing` under v1 (D3), the `NON_LIVE_GATES` registration of the two benchmark suites (D2). Pins the plan did not name: `b24-b3-live-suite-honesty` 1 (19 gates in 16 files -> 21 in 18) and 10 (the flag matched as a whole name; each gate's own local run), `b24-a1-flags` 1 (62 -> 65 and the kinds pin), `b24-a2-env-names` `CLASS_COUNTS`, 5 and 10 (`GITHUB_STEP_SUMMARY`, read by the two scripts for the step summary, is a platform census row beside D1's three names; OD-195's undeclared list grows by the four), `b24-d0-ci-split` 1, 5, 7, 10, 11 and its tree constants (D1's four suites in prompt-to-gerber's selection, 472 -> 476), ci-split.md C2-C14, C16, C17, C48 and its moved-set table, observability-and-replay.md C50, B23's C14 and C46, every B21 row that cites the workflow; `b24-a1-environment-profile` 16 is the lead's move (15 -> 17 rows). The review round (2026-10-09; nine confirmed findings, each test-first) moved by review: `b24-d1-threshold-census` 1, 3 and 7 (55 / 48 / 7 / 13; seven markers), `b24-d1-latency-policy` 1-6 and 8 (16 metrics; the D3 exception version 1's alone; the writer's dotted children; a foreign suite's metric and a doubled metric refused; the latest version by shape), `b24-d0-ci-split` 11 (D0's C64 sentence whole), `b24-b3-live-suite-honesty` 10 (a dated note on its title line), `mcp-client-boundary.md:399`, `b20-a1-redaction-linear.test.ts:90, :93` (the seventh moved bound, `moved.redaction-linear-200-scrubs`).
- [B24-D2, 2026-10-09] B24-D2 landed the paged board read and the memory metrics (D24-29 in part; OD-213, OD-212's memory half), the working-copy compare, the restart characterization and the two browser specs (D24-30; OD-214) and the FreeRouting and kicad-cli tree kill (D24-31's remainder; OD-145), with OD-235 for its stated choices; its review round fixed a two-tab lockout, a same-tab restore refusal, the page bound's blindness to the sanitizer and the dropped kill confirmation, strengthened four suites and the crash spec, and recorded D24-43 (OD-236, proposed); [B24-D2B, 2026-10-10] the lead's browser run found a silent loss after a crash (a consumed grant left in flight with no notice), fixed test-first in the editor's recovery notice and, after its review, in the reloaded chat entry - after its second review a still-issued grant's entry is not started and open, never "not made" while another tab may hold its card, and after its third every editor load re-derives a reloaded, unsettled entry from the journal's record, saying only what held at that load, and after its fourth a sweep writes only on a journal entry as it read it (never "not made" for a change another tab committed within the commit window (one exception stays, INFERRED and not run: a committing tab stalled more than 120 s past it, which a later tab's sweep closes as not made while the stalled tab's change still lands - OD-214's open item)), answers only for the project the page showed when it started and names a reopened lineage as a lasting cause, and a restored entry never offers the editor's one-step Undo - and four wrong premises in the multi-tab spec, fixed in the spec with the fully stale tab's path kept; one run, the lead's one commit (lead decision D21).
- [B24-D3, 2026-10-10] B24-D3 landed the accessible-name rule and census, the in-scope names and announcements, the declared canvases (D3a) and the BOM dialogs on the shared dialog, the minimum width and its notice, the two browser specs (D3b) in one run (lead decision D21; D24-32; OD-215 applied; OD-237), then one review round (six findings, all fixed test-first: the out-of-scope ratchet frozen in the suite and the generator's baseline read from the repository path; the focus return limited to a run sent from the prompt with no pointer press since; the BOM dialogs' glyph-only close and the More checks glyph name caught; WCAG rows on unrun browser cases PROPOSED until the lead's green runs, then flipped by the lead); suites `b24-d3-accessible-names` (11), `b24-d3-bom-dialogs` (16), specs `e2e/keyboard-and-focus.spec.ts` (5), `e2e/minimum-width.spec.ts` (3) (section 7 wrote `b24-d-accessible-names`; lead decision D17); no workflow line. Where the discovery was imprecise at `8664964` (re-resolved at `3773c6a`; accessibility.md section 10): two explicit `aria-live` regions but 13 more implicit live sites; "195 unlabelled" is B17-A's key label, not a name count (117 unnamed of 631 by the rule); the cards' "browser-proven modal" a reachability proof; the BOM dialogs' missing focus CONFIRMED by reading; `globals.css:11-27` a second breakpoint; OD-42 the MCP SDK only. Pins the plan did not name: `b24-d1-threshold-census` 5 (302 -> 305 rows: two budget rows, one yield row; the D3 row counts budgets 10, yields 5 after the review round; elapsed counts unchanged), `b24-d0-ci-split` 1 (the set-aside pattern `b24-d[123]`, `.tsx`) and 7 (481 -> 483). No census, tool-count, action-record, route, registry, migration or workflow move; no new dependency. `accessibility.md`.
- [B24-D4, 2026-10-10] B24-D4 landed the OD-30 split of page-browser-e2e by insertions only (the lead's corrective increment; option A after the first run's STOP, then option (b) and the rename, both the lead's on 2026-10-10; closes no new defect): `playwright.config.ts:21` reads `SIRKIT_E2E_SKIP` into `testIgnore` in place, page-browser-e2e's first browser step sets it to B24's own four browser specs - `multi-tab`, `crash-recovery`, `keyboard-and-focus`, `minimum-width` (`deterministic-manufacturing.yml:418-419`) - the appended `page-browser-e2e-b24` (`:629-663`, 20 minutes) runs them, one inventory row and one census row (`flag-inventory.ts:65`, `environment-names.ts:137`, on existing lines), `_ci-admission.ts` reads the split, and guard `b24-d4-browser-split` (8) pins it. Part 1 fixed B24-D3's two CI reds test-first: D24-30's silent overwrite (`board-persistence.ts`; `PcbEditor.tsx:602`, `:629` in place; `b24-d2-working-copy` 9-13) and D24-32's focus on `body` after Escape (`GrantedExecutionDialog.tsx:55`, `:125`; `b24-d3-bom-dialogs` 5, 6; `keyboard-and-focus.spec.ts:235` stricter). No census, tool-count, action-record, route or migration move (168 = 165 + 3 + 0; 48 / 37 / 9 / 28; 107; 32), and no `timeout-minutes` raised. Expected page-browser-e2e about 22 min 03 s of 30 and `page-browser-e2e-b24` about 12 min 48 s of 20, each at least OD-30's five minutes (INFERRED until CI). The `--list` check and the browser runs are the lead's (`ci-split.md` section 11).
- [B24-E, 2026-10-10] B24-E landed the production-auth harness offline (Ea: D24-34 offline; OD-191 amended; OD-238) and the register, the matrix and the statement tripwire (Eb: D24-33; D24-35 and D24-36 as recorded; OD-217 amended, OD-179 noted, OD-218, OD-219, OD-239) in one run, with a review round of eight confirmed findings fixed test-first (the harness's credential exposure on a test timeout, the server's 0.0.0.0 binding, a database URL two parsers read differently, unexercised resolver rules, the tripwire's sentence-wide negation and its line-wide note); suites `b24-e-production-auth-config` (8), `b24-e-register` (10), `b24-e-statements` (7); no workflow line, route, tool, UI control or migration; census 168 / 165 / 3 / 0 and tools 48 / 37 / 9 / 28 unchanged; pins the plan did not name, each in place with a dated note: `b24-a2-headers` 11, `b24-d4-browser-split` 8, `b24-d0-ci-split` 1 and 7 (484 -> 487), `threshold-census.csv` (306 -> 311), B23-D's C41 anchor; `qualification-matrix.md`.
- [B24-F, 2026-10-10] B24-F landed the derived maps and the generator inventory (Fa: D24-37; D24-38 in part; OD-220, OD-240) and the registers, the reports and the verdict (Fb: D24-39 and D24-40 in part; OD-220 amended, OD-221, OD-241) in one run, with a review round of twelve confirmed findings fixed test-first: the inventory's suites, checks and pin classes now derived from the test files, the permission matrix's role gate beside the tier function's decision, D24-3 closed in part (OD-192 keeps the application role PROPOSED), commits bound to their own closing increment by a record, the frozen migration and B11-scanned lines marked never noted in place, and the discovery's rows cited at `58c0834`'s numbering.
