# B24-C2 - Retention and deletion, and the redaction authority on the three stores

Labels: **CONFIRMED** (executed here and measured, or read at the cited file:line), **INFERRED** (code reading, nothing executed),
**PROPOSED** (designed, not exercised), **RECORDED** (written down without a claim of our own), **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION** (needs a live resource the owner has not supplied; never faked, never claimed).

Base: `4ec18eb` on `chapter/b24-production-qualification` (B24-A1..A4, B1, B2, B3 and C1 committed). B24-C2b closes D24-13 and D24-25
offline (runbook `:1038` "trace/audit retention and deletion policy;", `:1088` "Do not store hidden reasoning. Redact secrets and sensitive
source content.", `:1044` "Never reuse production data in tests.", `:171` the owner's authorisation "does not authorize ... production data
destruction"; OD-202 applied as discovery 9.4 restates it; OD-232 the choices beyond it; LB-14). It was delivered with B24-C2a (attribution,
cost and latency: `observability-and-replay.md` part 2) in one workflow run for one commit by the lead (lead decision D21). Every line number
on this page is the B24-C2 working tree's unless it names another tree.

## 0. What B24-C2b is

- **Retention as data.** `RETENTION_POLICY` (`sirkit.retention-policy.v1`, `app/lib/observability/retention-policy.ts`): one row per record
  class - 34 durable aggregate types, four audit tables, two per-process rings, one cache table, two browser-local stores - each with the
  store that holds it, its rule (days; until the owner decides; configuration; process lifetime; own purge; browser-local) and who deletes
  it. The purge is ALLOWLIST-ONLY: only a durable aggregate type with a finite day count can be deleted, five classes today (section 2).
- **A repository-boundary port and its PostgreSQL implementation** (`app/lib/durable-workflow/retention.ts`; runbook `:156`), a planner that
  binds the as-of instant, the limit and exactly the set to delete into a `planDigest`, and an operator CLI (`runRetentionCli`,
  `app/lib/durable-workflow/retention-cli.ts`; the thin wrapper `scripts/retention-purge.ts`) that is dry-run by default and deletes only with
  `--apply --confirm <planDigest> --as-of <the dry run's instant>` - one transaction per aggregate, whole or not at all.
- **The redaction authority on the three stores that kept text without it** (D24-25): the grant's 240-character instruction excerpt
  (`app/lib/execution-grant/mint.ts:181`), the SPICE studio's browser-local `aiAuditLog` (`app/lib/spice/project.ts`, `persistence.ts`) and
  the provider error's `detail` and log line (`app/lib/llm/errors.ts:180-184`). One classifier, `app/lib/agent/redaction.ts`, not edited.
- **What it is not.** No route, agent or MCP tool, action record, UI control, environment name or flag, package.json script, migration or
  dependency: the census stays 168 / 165 / 3 / 0, the tool counts 47 / 36 / 9 / 27, the action records 107, the migrations 32, the
  classification CSV byte-identical, `.env.example` unchanged, the nine B11-scanned files at their hashes. The port constructs no
  durable-workflow repository (D11: the one `PostgresDurableWorkflowRepository` construction stays `durable-workflow/runtime.ts`; the port
  issues its own statements through `getDb()`), imports no `postgres`, PGlite or disposable database, and never loads `.env.local`.
- **What the builder did not run.** The purge CLI never ran against any database but the disposable PGlite inside its suite - the dry run
  included (OD-191, OD-202, LB-14). No `next dev`, `next build`, `next start` or Playwright; no provider, model, host or account.

## 1. The pre-edit counterexamples (red first; **CONFIRMED**)

- `b24-c2-retention` and `b24-c2-retention-pglite` failed to load on `4ec18eb` ("Cannot find module `@/app/lib/observability/retention-policy`",
  "Failed to load url ../../../durable-workflow/retention"): no policy, no port, no CLI (exit 1, 2.96 s).
- `b24-c2-redaction` ran 2 / 10 on `4ec18eb`'s stores (the same run): the grant's excerpt kept a secret-shaped instruction as typed (case 1),
  a key starting ten characters before the 240 cut survived as a fragment (3), U+200B was kept (4), 501 test edits left 501 audit entries (5),
  a stored project with 501 entries loaded whole (6), a 29,000-character change set was stored as text (7), and the provider's `detail` and
  the `console.error` line carried the key (9, 10). Cases 2 ("desk-lamp-controller" survives) and 8 (B22-C's evidence labels) held before and
  after, as they must.
- **The review round (2026-10-09; CONFIRMED).** Three findings of the adversarial review were reproduced test-first before they were fixed:
  `b24-c2-redaction` ran 3 red / 11 on the unfixed stores (case 5: `AI_AUDIT_LOG_BOUNDS` held three keys and no evidence bound; case 6: a
  stored entry whose `reason` carried a joined key loaded as typed - `loadStudioProject` bounded the entry count only; case 11: an evidence
  reference's `signal` holding a joined key was stored as typed), then 11 / 11. `b24-c2-retention-pglite`'s new case 6 was proven against the
  port with its three `head_moved` throws deleted (5 / 6: the mutated port deleted all three targets - aggregates 3, records 4, replays 5 -
  while cases 1-5 stayed green, so the five earlier cases never reached those guards), then against the port restored byte for byte (sha256
  `431e9dfc…ac53e` before and after): 6 / 6. A first mutated run had failed for the wrong reason (the suite had not imported `applyRetention`)
  and does not count; the import was added and the proof re-run.

## 2. The retention policy (D24-13, OD-202; **CONFIRMED**, `b24-c2-retention` 1, 2)

| rule | record classes | deleted by |
|---|---|---|
| 90 days | `agent.run-trace.v1` (C1), `llm.call-record.v1` (C1), `agent.run-trace-attribution.v1` (C2), `agent.orchestration-trace.v1` (B21-E2b) | the purge CLI |
| 30 days | `agent.orchestration-resume.v1` (B21-E3; OD-202 named its answer text, the whole aggregate is deleted - a stated choice, OD-232; its answer is at most 60,000 characters, `store.ts:398`) | the purge CLI |
| until the owner decides (listed, never purged) | `agent.orchestration-run.v1` (OD-111); `agent.execution-grant.v1`, `agent.execution-grant-index.v1`; `mfg.release-ledger.v1`; `computation.evidence.v1` (OD-141); `mfg.provider-exchange.v1` (OD-167) together with B23-B3's provider observations, which are projections of it read at `GET /api/pcb-sync` (`provider-observation.ts`), so their retention is this record's; `agent.trace-salt.v1` (deleting a scope's salt crypto-shreds every salted digest written under it); OD-202's binding and catalog audit records - the tables `physical_binding_audit_events` (0022), `atomic_audit_events` (0006), `atomic_revision_status_events` (0030) and the aggregates `pcb-sync.audit-stream.v1`, `pb.component-review-request.v1`, `atomic.publication-request.v1`; the CD-13 run events table `full_flow_run_events` (0021); engineering state, stated as not trace records: `pcb-sync.board-lineage.v1`, `pcb-sync.board.v1`, `pcb-sync.plan.v1`, `pcb-sync.authoritative-snapshot.v1`, `mfg.release-authority.v1`, `mfg.qualification-lease.v1`, the four `assignment-queue.*`, the five `mapping-verification.*`, the three `passive-policy.*` | the owner |
| configuration, never purged | `agent.autonomy-settings.v1` | never |
| process lifetime | the MCP request and read trace rings; the B05 read trace ring (500, `tool-invocation.ts:204`) - nothing durable to purge, so OD-202's "MCP traces 90 days" cannot apply (a stated restatement) | process exit |
| own purge | the distributor offer cache, `part_offers` (`distributors/cache.ts:222-248`: each source's bounded retention, on the read path at most every five minutes) | the offer cache |
| browser-local | the SPICE `aiAuditLog` (section 5) and the approved-mutation journal (OD-210) | the browser |

- **The census** (`b24-c2-retention` 1) reads every production module under `app/lib` and `app/api` for a constant bound to a literal of the
  form `/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+\.v\d+$/` - or the literal itself at an `aggregateType:` position or as `durableAggregateIdentity`'s
  second argument - whose use reaches an aggregate type in that module or in a module importing it. It finds 34 types (30 at `f663d71`, C1's
  two, C2's two): module-local constants such as `pcb-sync/durable.ts`'s `BOARD` and `pcb/fab/release-ledger.ts`'s `LEDGER` among them;
  numeric constants (`MAX_AGGREGATES_PER_COMPONENT`) and schema strings (`sirkit.*`, the type annotation `aggregateType: "computation.evidence.v1";`
  in `spice/types.ts`) excluded. The policy's durable-aggregate rows equal that set; a new type fails the test until it has a row. The exported
  constants (`RUN_TRACE_AGGREGATE_TYPE`, `PROVIDER_EXCHANGE_AGGREGATE_TYPE`, ...) equal the literals. The policy imports nothing - no store
  module - and names every type by its string literal; only the census test imports the store constants to compare them. The runtime
  importers of `exchange-ledger.ts` stay the three files `b23-b-egress-import-gate` 1 pins, and no retention module is in the chat route's
  closure.
- **The head-age rule.** An aggregate expires when its head's `updated_at` is older than its row's cutoff (`asOf` minus the days). Every
  commit refreshes `updated_at` (`server-repository.ts:25`), so the rule holds only for an aggregate that covers one run or one call - which
  every purgeable class is: per run (`store.ts:455`, `trace-attribution.ts:268`), per call (C1), per trace id (C2). An aggregate that
  gathered revisions across runs would never age out and is not purged.

## 3. The port, the planner and the PostgreSQL implementation (**CONFIRMED** on PGlite, `b24-c2-retention-pglite`)

- **`expiredAggregates({ aggregateType, cutoff, limit })`** lists, for one type, the heads older than the cutoff (at most `limit`, by
  `updated_at` then scope then key) with each chain's inventory: the record ids, the replay rows whose `result.records` reference its records
  (a replay that also references a record of another aggregate marks a MIXED COMMIT), and its outbox rows by state. A head without a record is
  no chain this port purges.
- **`purgeAggregate(target)`** deletes one aggregate whole in ONE `getDb().transaction(...)`: it re-reads the head (locked `FOR UPDATE`),
  the record set, the outbox states and the replays, refuses `head_moved` (the head's revision or the record set or the replay set changed
  since the plan), `outbox_in_flight` (a pending or processing outbox row), `mixed_commit` (a replay row that also references a kept record) or
  `not_found`, else deletes the owner's outbox rows, the replay rows that reference only its records, every record and the head. A refusal
  rolls back; 0024's `DEFERRABLE INITIALLY DEFERRED` foreign keys - heads -> records (`:163`), records -> heads (`:164`), outbox owner ->
  records (`:165`) - hold at commit, so a partial chain can never be committed (Lead note 6: replay rows hold the full record payloads, so
  heads and records alone would leave the text behind). PGlite case 4: after the purge of an aggregate with a COMPLETED outbox row, no record
  without its head, no head without its record, no outbox row without its owner record.
- **`planRetention(port, { rows, asOf, limit })`** asks the port for the given rows only (the policy's five), classifies each inventory
  (`outbox_in_flight` first, then `mixed_commit`, else purgeable), bounds the whole run to `limit` deleted aggregates (default 1,000, maximum
  10,000, `listHeads`' range; each later type sees the remaining budget), and binds `asOf`, the limit and EXACTLY the set to delete - each
  target's scope, type, key, head revision, sorted record ids and replay ids - into `planDigest` (`sirkit.retention-plan-digest.v1`, an
  engineering digest). Time passing, a moved head, a landed row or another set all change the digest. **`applyRetention`** purges the plan's
  targets one transaction each and counts refusals (`mixed_commit`, `outbox_in_flight`, `head_moved`, `not_found`).
- **The PGlite proof.** A migrated PGlite holding, for each of the five classes, one expired aggregate (committed 2026-01-01, its payload
  carrying a sentinel) and one fresh (committed at `asOf`); an expired `agent.orchestration-run.v1` (kept); an expired run trace with a
  completed outbox row (claimed and completed through the repository); a mixed commit (one commit writing a run trace and an orchestration
  run: its replay row references both); an expired call record with a pending outbox row. The dry run (case 1) plans 2 run traces (one with the
  outbox row), 1 call record, 1 attribution, 1 specialist trace, 1 resume record, refuses the mixed commit and the in-flight outbox, and
  changes no row count. The apply (case 2) deletes exactly 6 aggregates, 6 records, 6 replays and 1 outbox row; no surviving row in records,
  replays or outbox holds a purged sentinel; the fresh and the kept rows stand row for row (case 3); nothing dangles (case 4); the two
  refusals are left whole, the first digest no longer confirms once the set moved, a fresh dry run plans only the two refusals and an apply of
  it deletes nothing of them (case 5). [B24-C2 review, 2026-10-09] `head_moved` is proven by the port itself (case 6): a planned target
  whose head moved (a resumed run committed revision 2 through the repository after the plan), whose record set differs from the plan's (a
  stale plan) or whose replay set grew (a replay row referencing a planned record landed after the plan - planted directly, since the
  repository writes a replay row only with a commit, which also moves the head) is refused inside the transaction, `head_moved` 3, nothing
  deleted, every row count unchanged, nothing dangling; each guard is then refused on its own against the chain as the port reads it (the
  revision, the record set, the replay set); a fresh plan sees the moved head as fresh and purges the other two with their current chains,
  the landed replay row among them (deleted aggregates 2, records 2, replays 3). RECORDED limit (the B23-B2 and B24-C1 statement): PGlite
  is one connection running one transaction at a time, so the per-aggregate transaction is proven for its atomicity under the deferred
  constraints, not against an interleaved writer.

## 4. The CLI (`runRetentionCli`; **CONFIRMED**, `b24-c2-retention` 4-7, the PGlite suite)

- **Dry run by default.** It prints `retention-purge: dry run (nothing is deleted)`, `as-of: <instant>`, `limit: <n>`, the runtime line,
  one line per class - `<type> (<days> days, cutoff <instant>): aggregates <n> purgeable, <n> refused (mixed_commit <n>, outbox_in_flight <n>);
  records <n>; replays <n>; outbox <n>` - then `planDigest: eng1-...` and the footer naming the exact `--apply --confirm <digest> --as-of
  <instant>` that would delete this set. It deletes nothing.
- **Confirmation always required** (stricter than OD-202's production-only confirmation; OD-232): `--apply` needs `--confirm <planDigest>` and
  the same `--as-of` as the dry run it confirms; a digest that does not match the plan recomputed at that instant exits 2
  (`RETENTION_CONFIRMATION_MISMATCH`) and deletes nothing. `--as-of` defaults to the clock's now, is printed in the header and bound into the
  digest; a value after the clock's now is refused (`RETENTION_AS_OF_IN_FUTURE`: it would expire fresh rows) before any repository call.
- **The flags are closed:** `--apply`, `--confirm <planDigest>`, `--limit <1..10000>`, `--as-of <ISO instant>`. Any other flag - B24-C3's
  `--read` included until C3 adds it by review (lead decision D12; C3 then moves `b24-c2-retention` 5's `--read` case in place and states
  `--limit` per mode: the purge 1..10000 default 1,000, the read 1..100 default 20) - a stray word, a repeated flag or a malformed value exits
  2 before any repository call (`RETENTION_ARGUMENT_UNKNOWN`, `_REPEATED`, `_MISSING`, `_MALFORMED`, `RETENTION_ARGUMENTS_CONFLICT`; the
  parser is A4's `cli-arguments.ts` precedent, side-effect free, so the suite pins it without importing the script).
- **The runtime line.** `runtime: production (A1 profile staging or production, or NODE_ENV production)` when A1's profile is `staging` or
  `production` or `isProductionRuntime()` (`auth/mode.ts:22-24`), else `runtime: non-production`; the thin wrapper computes it, the runner
  prints it.
- **What it never prints:** the database URL's value, a payload, a salt or a key - counts, cutoffs and digests only (case 7 stubs a fake
  connection string and asserts its absence from every line). The target is the process's database URL as the operator exported it, through
  `getDb()` alone; the wrapper loads no `.env.local`. No package.json script and no environment variable name the CLI (a stated choice). [B24-C3, 2026-10-09] The wrapper now loads `.env.local` for its READ mode only (`--read`; `scripts/db-migrate.ts`'s order: the arguments parse first), and constructs the PostgreSQL durable-workflow repository for that mode (D11); the purge mode still loads none and constructs none (`observability-and-replay.md` part 3).

## 5. The redaction authority on the three stores (D24-25; **CONFIRMED**, `b24-c2-redaction`)

- **The grant excerpt** (`mint.ts:181`, in place): `sanitizeModelBoundText(ctx.userMessage.replace(/\s+/g, " ").trim()).slice(0,
  MAX_INSTRUCTION_EXCERPT)` - redact first, then cut, so a key-shaped token that straddles character 240 is redacted whole and no fragment
  survives (case 3); the token-anchored patterns keep design text such as "desk-lamp-controller" (case 2); a message with no secret shape and
  no control or format character keeps today's excerpt byte for byte, a long one cut at 240 included (case 4); a control or format character
  (U+200B, U+202E) becomes a space - a stated change, OD-232. `explicit-request.ts:69` is unchanged and the proof still reads the whole
  message (an explicit instruction is still proven `whole-message`); the record validator's 240 cap (`execution-grant.ts:386`) holds. The
  excerpt travels to the model (`loop.ts:134`), the confirmation dialog (`GrantedExecutionDialog.tsx:93`) and the chat run view
  (`chat-run-view.ts:230`) redacted, since all three read the record.
- **The SPICE log** (`project.ts`, appended helpers; `persistence.ts:3, :40`): `AI_AUDIT_LOG_BOUNDS` = 200 entries, 2,000 reason characters,
  16,000 change-set characters, 200 evidence references per entry (stated choices, OD-232; the fourth is the server's own cap on a proposal's
  references, `/api/spice/ai`), applied through ONE append helper both writers use (`updateTest`, `applyAiProposal`; Lead note 2) and again
  at `loadStudioProject` through `loadAiAuditLog` ([B24-C2 review, 2026-10-09]: every stored entry - one written before the redaction, or by
  a writer that set `aiAuditLog` directly, included - is redacted and capped exactly as on write, then the log is bounded; a non-object entry
  is dropped). Past 200 entries the oldest go first behind one leading `system` entry `audit-log-truncated` whose `changeSet.droppedEntries`
  carries the cumulative number dropped (501 edits leave 200 entries: the marker and the newest 199; case 5; a stored project of 501 entries
  loads the same way, and a stored entry carrying a joined key in a 30,000-character `reason`, a 40,000-character change set and a key-shaped
  evidence `signal` loads redacted, capped at 2,000, withheld and redacted while the store still holds the pre-redaction bytes, case 6).
  `reason` goes through the token-anchored redactor and is capped; a change set's string leaves are redacted; a change set whose JSON exceeds
  16,000 characters is stored as `{ withheld: "change_set_too_large", operationCount, digest }` (case 7); the evidence references' string
  leaves (`signal`, `unit`, the ids) are redacted, at most 200 are kept and the excess is counted in `evidenceWithheld` (absent when none;
  `types.ts`, a merging declaration appended at the end so no cited line moves; case 11: 10,000 references store 200 and `evidenceWithheld`
  9,800). B22-C's case 2 fields hold: every evidence reference labelled caller-supplied, `changeSet[].operation.op` readable (case 8).
  Nothing in `app/` reads `aiAuditLog` back; the browser keeps it in localStorage, and the stored bytes are rewritten only by the next save.
- **The provider detail** (`errors.ts:183`, in place): `providerDetail` runs the whitespace-collapsed message through
  `sanitizeTraceText(..., Number.MAX_SAFE_INTEGER)` before the existing 297 + "..." cut, so a key straddling character 300 is redacted whole
  and a message over 300 characters still ends in "..." at 300 (the cut may fall inside the replacement token, never inside a key; case 10);
  that one function feeds the `console.error` line and the 503 body's `detail` (Lead note 1; case 9). `errors.test.ts:22` holds: a plain
  message reaches `detail` as before. `errors.ts` now imports the redaction authority (dependency-neutral: the module imports nothing), which
  moved C1's `b24-c1-llm-call-record` 12 `SEAM_CLOSURE` pin in place with a dated note (section 7).

## 6. Live: BLOCKED-LIVE-QUALIFICATION

- **LB-14** (the database platform): the purge, its dry run included, ran only against the disposable PGlite inside `b24-c2-retention-pglite`;
  never against "the main Supabase project" (OD-191), a staging or a production database. Whether a production server's isolation level lets
  two interleaved purges or a purge and a concurrent commit interleave is UNKNOWN (the per-aggregate `FOR UPDATE` and the deferred keys are
  the design; the B23-B2 statement on PGlite stands).
- **LB-13**: nothing of this half runs on a host; the CLI is an operator's process.

## 7. Pins moved, and why (each in place, with a dated `[B24-C2, 2026-10-08]` note)

| pin | move | why |
|---|---|---|
| `.github/workflows/deterministic-manufacturing.yml:379` | one database-delivery line, `app/lib/qualification/database/__tests__/b24-c2-retention-pglite.test.ts`, after C1's entry (`:378`; [B24-D0, 2026-10-09] was `:341` after `:340` before B24-D0's 38 prompt-to-gerber `--exclude` lines at `:293-330`; [B24-D1, 2026-10-09] now `:382` after B24-D1's OD-30 steps at `:32` and `:344-345`), above `--reporter=dot` | the PGlite suite, admitted file by file (OD-222; `b19-e-ci-job-scope` green) |
| B21 C49, C93, C94 (`evaluation-matrix.md:1139, :1183, :1184`; `b21-f-page` 6) | `:372` -> `:373`, `:375` -> `:376`, `:384` -> `:385`, each with a dated `re-pinned +1` note naming the entry at `:341` | the inserted line moves every later workflow line +1 (D8) |
| `ci-admission.md:185` | the browser job's `timeout-minutes: 30` citation `:358` -> `:359`, earlier notes kept | the same +1 (re-derived by anchor) |
| `environments-and-deployment.md` section 10 | one row appended to A1's insertion table (`[B24-C2, 2026-10-08]`, `database-delivery`, `:341`, 1) | A1's insertion-table protocol; no earlier row and no number of sections 10 and 14 moved (`b24-a1-environment-profile` 14, 16, 17 green) |
| `b24-c1-llm-call-record` 12, `SEAM_CLOSURE` | + `app/lib/agent/redaction.ts` | `llm/errors.ts` now imports the redaction authority (D24-25); the module imports nothing, so no closure grows beyond it |
| `b21-e1-stop-reasons` 1, the `AgentStep` field list | + `providerRequestId?` | OD-208's request id on the step (C2a), folded onto the `model` line so no cited line of `contracts.ts` moves |
| `app/lib/execution-grant/mint.ts:16, :181` | the import widened and the excerpt built from the redacted whole message, both in place | D24-25 (mint.ts is pinned by four import gates, none of which names its lines) |
| `app/lib/spice/project.ts:207, :318` and appended lines; `persistence.ts:3, :40`; `types.ts` appended | both writers through the one append helper; the redaction, the caps and the bound on load (`loadAiAuditLog`); the value imports hoisted to the END of `project.ts`; `evidenceWithheld?` as a merging `AiAuditEntry` declaration at the END of `types.ts` ([B24-C2 review, 2026-10-09]) | A1's flag census cites `project.ts:72`, so no top line may move; the discovery cites `types.ts:458-468, :482` |
| `app/lib/llm/errors.ts:2, :183` | the import and the redactor before the cut, in place | D24-25 |

**Not moved:** B23's C64 (`dfm-quote-flow.md:537`) and its prose citation (`:269`) cite `:335`, above the inserted line; the nine B11 hashes;
the census 168 / 165 / 3 / 0; the tool counts 47 / 36 / 9 / 27; the action records 107; the migrations 32; the six SDK importers and the six
client construction sites; the classification CSV; `b23-a-provider-admission` case 8 (every C2 file outside A1's admitted roots - the port,
the CLI, the script, the four in-place edits - never names the provider directory; the census test and the PGlite suite sit inside them);
`b23-b-egress-import-gate` 1-2; C1's import gates; `drizzle/`; `.env.example`; `package.json`. B24-B1's catalog lists no C2 suite and was not
regenerated; B3's scenario-map generator was not touched.

## 8. What stays open (**INFERRED**, low)

- The port lists expired heads of one type with four queries per aggregate; at the 10,000 ceiling that is tens of thousands of statements
  for one dry run. An operator's CLI tolerates it; a batched read is a later refinement, not a correctness matter.
- A replay row whose `result.records` is malformed (no record ids) under an expired aggregate marks it `mixed_commit` and keeps it: the
  conservative answer, stated.
- The audit tables and `full_flow_run_events` are listed, never purged: until the owner decides, they grow (OD-202).
- Deleting a scope's salt (an owner action, not the CLI's) shreds the digests of every attribution of that scope; a later attribution of the
  scope creates a new salt, so digests across the deletion never correlate.
- The SPICE marker entry carries the number dropped and nothing of the dropped entries; a browser that never re-saves keeps its old log's
  bytes in localStorage until the next save - a load returns it redacted, capped and bounded, but rewrites nothing until the project is saved.

## 9. Superseded statements, handed to B24-F (file:line at C2's commit)

- `artifacts/ai-control-plane-b24/discovery.md:951` (the lead's file), OD-202's "MCP traces 90 days" (the rings are process-lifetime) and
  "resume-record answer text 30 days" (the whole aggregate is deleted) - restated here, OD-232.
- `artifacts/ai-control-plane-b24/discovery.md:952` (the lead's file), OD-208's "per-tenant salted" - the salt is per scope (OD-232).
- `app/lib/agent/orchestration/store.ts:22`, "retention: RECORDED on the page, not implemented here" - true of the orchestration record
  (kept until the owner decides); its sibling resume record is now purged at 30 days by the CLI (stated here, not edited).
- `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1096-1098` (the lead's file), OD-111's "until an owner-decided purge exists
  (nothing in the substrate purges)" - a purge now exists for the five day-counted classes; the orchestration record itself stays kept.
- `artifacts/ai-control-plane-b11/redaction-and-retention-policy.md:41-57` - "no durable retention" and the deferred retention questions:
  the duration is answered for the five classes (the B11 page keeps C1's dated note; not edited by C2).
- `app/lib/observability/run-trace-store.ts:23` and `trace-runtime.ts` - unchanged; part 1's "nothing purges either aggregate" (section 11,
  `observability-and-replay.md:298-299`) is superseded by this page.

## 10. Test-first record and gates

The gate table is `observability-and-replay.md` part 2, section 28 (one record for both halves; the review round's red and green runs of
2026-10-09 are its last rows). The runs of the three closeout tripwires, `b24-c1-durable-trace` 13 and `b24-a1-environment-profile` after
both pages were written, and the review round's gate re-runs, are in the increment report (a page cannot carry the result of the run that
reads its final text).

## 11. For the lead (B24-C2b's share; B24-C2a's is `observability-and-replay.md` section 30)

Every text below is written out in full for a reserved file. Nothing here was written to `OWNER_DECISIONS.md`, `EXECUTION_LEDGER.md`,
`PROGRAM_STATE.json`, `LIVE_BLOCKERS.md`, `discovery.md` or the B24 `README.md`. No OD-202 heading exists at `4ec18eb` (`grep '^## OD-202'`
finds none), so the entry below is its one heading; OD-232 is the next free number (the headings end at OD-231, `OWNER_DECISIONS.md:2946`).

### Closure clauses (each one dated line under its defect in `discovery.md`)

- [B24-C2, 2026-10-08] D24-13: closed offline by B24-C2 (OD-202 applied as 9.4 restates it; OD-232): `RETENTION_POLICY` (`sirkit.retention-policy.v1`, `app/lib/observability/retention-policy.ts`) names every record class with its rule - 90 days for `agent.run-trace.v1`, `llm.call-record.v1`, `agent.run-trace-attribution.v1` and `agent.orchestration-trace.v1`, 30 days for `agent.orchestration-resume.v1` (deleted whole), until the owner decides for the orchestration record, the grants, the release ledger, the computation evidence, the provider exchange (with B23-B3's observations, its projections), the trace salt, the binding and catalog audit tables and aggregates, the CD-13 run events and the engineering state, configuration for the autonomy setting, process lifetime for the MCP and B05 rings, own purge for the offer cache, browser-local for the SPICE log and the approved-mutation journal - and a census pins that every aggregate type a production module passes to the durable repository (34) has a row; the purge is allowlist-only through a repository-boundary port (`app/lib/durable-workflow/retention.ts`, `getDb()` only, one transaction per aggregate: outbox rows, replay rows referencing only its records, records, head; `mixed_commit` and `outbox_in_flight` refused whole) and an operator CLI (`runRetentionCli`, `scripts/retention-purge.ts`) that is dry-run by default, requires `--apply --confirm <planDigest> --as-of <instant>` with the digest over exactly the set to delete, refuses every other flag before any repository call and prints no URL, payload or salt; proven on PGlite (`b24-c2-retention-pglite`) and with a fake port (`b24-c2-retention`); never run against a live database, the dry run included: BLOCKED-LIVE-QUALIFICATION (LB-14); `retention-and-deletion.md`.
- [B24-C2, 2026-10-08] D24-25: closed by B24-C2 (OD-232): the redaction authority (`app/lib/agent/redaction.ts`, not edited) now covers the three stores - the grant's instruction excerpt is the token-anchored redaction of the whole collapsed message cut at 240 (`mint.ts:181`: a straddling key redacted whole, design text kept, a control or format character a space; `explicit-request.ts` unchanged), the SPICE `aiAuditLog` is bounded to 200 entries behind one `audit-log-truncated` marker with its `reason` redacted and capped at 2,000, a change set redacted or withheld past 16,000 characters and its evidence references redacted and bounded to 200 with the excess counted (`project.ts`, one append helper for both writers; `loadAiAuditLog` applies the same redaction, caps and bound to every stored entry at `loadStudioProject`, `persistence.ts:40`), and the provider error's `detail` and log line pass through `sanitizeTraceText` before the 297 + "..." cut (`errors.ts:183`); every secret-shaped fixture assembled at run time (`b24-c2-redaction`, 11 cases; `errors.test.ts:22` and `b22-c-ai-evidence` 2 hold); `retention-and-deletion.md`.

## OD-202 — Retention and deletion, as applied (B24-C2, 2026-10-08)

- Policy as data, `sirkit.retention-policy.v1` (`app/lib/observability/retention-policy.ts`): one row per record class with its store, its rule and who deletes it; the census (`b24-c2-retention` 1) compares its durable-aggregate rows with every aggregate type a production module passes to the durable repository - 34 at B24-C2 - so a new type fails until it has a row. The purge is allowlist-only: a durable aggregate type with a finite day count, nothing else.
- The rules: 90 days for the run trace, the LLM call record, the attribution and the specialist trace; 30 days for the resume record, deleted whole (the draft named its answer text; OD-232); kept until the owner decides: the orchestration record (OD-111), the grants and their index, the release ledger, B22-C's `computation.evidence.v1` (OD-141), B23-B2's `mfg.provider-exchange.v1` (OD-167) together with B23-B3's provider observations (OD-168: projections of it, read at `GET /api/pcb-sync`), the per-scope trace salt, the binding and catalog audit records (three tables, three aggregates), the CD-13 run events and the engineering state (board lineage, board, plan, snapshot, release authority, qualification lease, assignment queue, mapping verification, passive policy); configuration, never purged: the autonomy setting; process lifetime: the MCP and B05 trace rings (the draft's "MCP traces 90 days" cannot apply: nothing durable exists to purge); own purge: the distributor offer cache; browser-local: the SPICE audit log and the approved-mutation journal.
- An aggregate expires when its head's `updated_at` is older than its row's cutoff (every purgeable class is per run, per call or per trace) and is deleted whole, in one transaction through the repository-boundary port (`app/lib/durable-workflow/retention.ts`, `getDb()` only, no repository constructed): its terminal outbox rows, the replay rows whose result references only its records, every record and the head; a replay row that also references a kept record (`mixed_commit`) or a pending or processing outbox row (`outbox_in_flight`) refuses the aggregate and deletes nothing of it; 0024's deferred foreign keys hold at commit, so a partial chain is never committed.
- Deletion only through the operator CLI (`runRetentionCli`, `app/lib/durable-workflow/retention-cli.ts`; `scripts/retention-purge.ts`): dry run by default (the plan per class, the cutoffs, a `planDigest` over exactly the set to delete, bound to `--as-of`); `--apply` always requires `--confirm <planDigest>` and the dry run's `--as-of` (stricter than the draft's production-only confirmation, OD-232); the flags are closed (`--apply`, `--confirm`, `--limit` 1..10000 default 1,000, `--as-of`; B24-C3's `--read` joins by review, D12), any other refused before any repository call; a production runtime is named in the header; nothing printed carries the database URL, a payload or a salt; no package.json script, no environment variable.
- Proven on PGlite (`b24-c2-retention-pglite`: the dry run deletes nothing, the apply deletes exactly the plan and no surviving row holds a purged payload, kept and fresh rows untouched, a completed outbox row purged whole with nothing dangling, `mixed_commit` and `outbox_in_flight` refused whole) and with a fake port (`b24-c2-retention`). Never run by the builder against a live database, the dry run included (OD-191; LB-14).

## OD-232 — B24-C2: stated choices beyond its task text, as applied (B24-C2, 2026-10-08)

- (a) The attribution's salt is per scope (tenant, project, branch), finer than OD-208's per tenant: one `agent.trace-salt.v1` per scope, created once by compare-and-set, so digests of one project never correlate with another's inside a tenant; deleting a scope's salt crypto-shreds its digests. The alternative (one salt per tenant) is the owner's.
- (b) The resume record is deleted whole at 30 days (OD-202 named its answer text): the aggregate is per run and its answer is the record's largest field, so the aggregate is the unit the head-age rule can purge. The alternative (rewriting the record without its answer) would be a second write path into B21-E3's store.
- (c) The purge's confirmation is always required - `--apply --confirm <planDigest> --as-of <the dry run's instant>`, the digest over exactly the set to delete with `--as-of` and `--limit` bound into it - in every runtime, not only production (OD-202's draft); the flags are closed; a mismatch refuses and deletes nothing.
- (d) The SPICE audit log's bounds: 200 entries (the oldest out first, behind one `audit-log-truncated` marker carrying the cumulative number dropped), 2,000 reason characters, 16,000 change-set characters (a larger set withheld as `{ withheld: "change_set_too_large", operationCount, digest }`) and 200 evidence references per entry (the server's own cap on a proposal's references; the excess counted in `evidenceWithheld`, the kept references' string leaves redacted), applied by one append helper both writers use and again on load, where every stored entry is redacted and capped as on write before the log is bounded.
- (e) The grant excerpt's control and format characters (U+200B, U+202E and the like) become a space, as `sanitizeModelBoundText` renders them; a message without them keeps today's excerpt byte for byte.
- (f) The provider request ids are captured on the coordinator adapter through a step-observing decorator in the chat composition root, from the SDKs' `_request_id` the two adapter normalizers set in place as an optional `providerRequestId` on `AgentStep` (absent when a response carries none): at most 2 x the budget's `maxModelSteps`, each matching `^[A-Za-z0-9_-]{1,128}$` and free of a secret shape, the rest counted; the retry ceiling is the adapter's configured value (`COORDINATOR_SDK_RETRY_CEILING`: OpenAI 2, Anthropic `"sdk_default"`), `sdkRetriesObserved` always `"unknown"`.
- (g) No package.json script and no environment variable name the purge CLI; the operator runs `scripts/retention-purge.ts` through `tsx` with the database URL exported deliberately; the wrapper loads no `.env.local`.
- (h) `app/lib/evaluation/model-price-table.ts` sits beside B3's `live-spend.ts` (the one table beside the one schema; D1); neither the retention port nor the CLI constructs a `PostgresDurableWorkflowRepository` - the port issues its own statements through `getDb()`, so the one construction site stays `durable-workflow/runtime.ts` (D11: prefer neither).
- (i) A1's deployment configuration digest reaches the attribution through a `globalThis` slot `instrumentation.ts` publishes at start-up (`app/lib/observability/deployment-configuration-digest.ts`), because the record digests the provider registry and the chat route's closure must stay clear of the provider directory (the B19-D tripwire, `b23-a-tier3-vocabulary` 7); unpublished, the attribution carries null with `deployment_configuration_unavailable`.
- (j) Two pins moved in place with dated notes beyond the task's list: `b24-c1-llm-call-record` 12's `SEAM_CLOSURE` (+ `app/lib/agent/redaction.ts` through `llm/errors.ts`) and `b21-e1-stop-reasons` 1's `AgentStep` field list (+ `providerRequestId?`).
- (k) An invalid price table (one B3's validator refuses) is "unpriced" with the reason `no_owner_price_table`: no usable owner table exists; the three closed reasons the task names are kept, no fourth is added.
- (l) The attribution validator's `retryCeiling` is the closed class `[2, "sdk_default"]`, the adapters' configured values, pinned equal to `COORDINATOR_SDK_RETRY_CEILING`'s values by `b24-c2-attribution` 8.

### The LB-14 note

- [B24-C2, 2026-10-08] LB-14 note: B24-C2's purge CLI (`scripts/retention-purge.ts`, `runRetentionCli`), its dry run included, never ran against a live database and never will by the builder: its only runs are `b24-c2-retention-pglite`'s on a disposable in-process PostgreSQL (the dry run deletes nothing; the apply deletes exactly the plan; the deferred foreign keys hold at commit; `mixed_commit` and `outbox_in_flight` refused whole), and the attribution and salt aggregates ride the existing durable-workflow tables (no migration; 32). The production server's isolation under an interleaved writer stays UNKNOWN (the B23-B2 statement).

### The README row

| B24-C2 attribution, cost, latency, retention, redaction (D24-13, D24-22, D24-23, D24-25; OD-202, OD-208, OD-209 cost half, OD-232) | `observability-and-replay.md` (part 2), `retention-and-deletion.md`; code `app/lib/observability/{run-trace-attribution,trace-salt,run-attribution-collector,deployment-configuration-digest,retention-policy}.ts`, `app/api/chat/attribution-runtime.ts`, `app/lib/evaluation/model-price-table.ts`, `app/lib/durable-workflow/{retention,retention-cli}.ts`, `scripts/retention-purge.ts`; in place `app/api/chat/route.ts:35, :398, :427, :437, :463, :486`, `app/lib/agent/adapters.ts:88, :190` (+ appended), `app/lib/agent/contracts.ts:233`, `instrumentation.ts`, `app/lib/execution-grant/mint.ts:16, :181`, `app/lib/spice/project.ts` (+ appended), `app/lib/spice/persistence.ts:3, :40`, `app/lib/spice/types.ts` (+ appended), `app/lib/llm/errors.ts`; workflow `deterministic-manufacturing.yml:379` ([B24-D0, 2026-10-09] was `:341` before B24-D0's 38 prompt-to-gerber `--exclude` lines at `:293-330`); suites `b24-c2-attribution` (14), `b24-c2-cost` (5), `b24-c2-retention` (7), `b24-c2-redaction` (11), `b24-c2-retention-pglite` (6) | done 2026-10-08 offline; the real database platform and any live purge BLOCKED-LIVE-QUALIFICATION (LB-14), live request ids (LB-2, LB-7, LB-9), a scheduled write on a serverless host (LB-13); census 168 / 165 / 3 / 0, counts 47 / 36 / 9 / 27, 107 action records, 32 migrations; `MODEL_PRICE_TABLE` null; [B24-D1, 2026-10-09] the workflow line is now `:382` after B24-D1's OD-30 steps at `:32` and `:344-345` |

### The ledger paragraph

### B24-C2 - attribution, cost, latency, retention, redaction (2026-10-08 local; increment workflow + lead; this commit)

Test-first on `chapter/b24-production-qualification` from `4ec18eb`, one run in two tagged halves (D21). B24-C2a: `b24-c2-attribution` and
`b24-c2-cost` failed first with their modules absent; `run-trace-attribution.ts` keeps one `sirkit.agent-run-trace-attribution.v1` per
validated trace (`agent.run-trace-attribution.v1`, compare-and-set at revision 0, no outbox, replay per trace id, every load re-verified;
closed keys, digests, ids, classes, counts and bounded numbers only, `findSecretShapedPath` over the document), `trace-salt.ts` one
`agent.trace-salt.v1` per scope (OD-232), `run-attribution-collector.ts` the route's passive observers (the sink wrapped for monotonic
offsets and the validated document, the coordinator adapter for the SDKs' `_request_id`, the emit for the first text delta, the refused-call
classes and the answer), `app/api/chat/attribution-runtime.ts` the composition root (imported in place on `route.ts:35`; the five other route
edits in place on 398, 427, 437, 463, 486; the route keeps its 562 lines), `model-price-table.ts` the one table (`MODEL_PRICE_TABLE` null) and
`priceUsage` over B3's schema and validator (D1), the adapters' `providerRequestId` in place (`adapters.ts:88, :190`; `contracts.ts:233`), and
`instrumentation.ts` publishes A1's configuration digest (the chat closure may not import the record). B24-C2b: `b24-c2-retention` and
`b24-c2-retention-pglite` failed first with no policy and no port, `b24-c2-redaction` 2 / 10 on the three unredacted stores;
`retention-policy.ts` names every class (a 34-type census), `durable-workflow/retention.ts` the port, planner and PostgreSQL implementation
(`getDb()` only, one transaction per aggregate, `mixed_commit` and `outbox_in_flight` refused whole), `retention-cli.ts` and
`scripts/retention-purge.ts` the dry-run-by-default CLI with `--apply --confirm <planDigest> --as-of` and closed flags; `mint.ts:181`,
`spice/project.ts` and `persistence.ts:3, :40`, `llm/errors.ts:183` take the redaction authority in place. One database-delivery line (`:341`)
moved B21's C49, C93, C94 and `ci-admission.md:185` +1 in place with A1's insertion-table row; two pins moved in place with dated notes
beyond the task's list (`b24-c1-llm-call-record` 12's `SEAM_CLOSURE`, `b21-e1-stop-reasons` 1's `AgentStep` fields). Suites 5 files, 41 / 41
at the first round; the gate sets re-run on that tree (`observability-and-replay.md` section 28: qualification 37 files 375 + 3; chat, llm,
computation 57 + 2; orchestration 48 + the moved file; manufacturing 30; agent, grant, durable, fixture, spice, components 52 + 2; auth and api
68; mcp 52; engineering and project 136; database-delivery 21 + 3 and the re-run of the two files; four red runs each the suites' own
expectations or a cited line moved by a top-of-file import, each fixed in the test or by hoisting, recorded); tsc 0; eslint 0 on 25 files; five
generators zero drift. The adversarial review (2026-10-09) confirmed four findings, each fixed test-first: the SPICE log's evidence references
were stored unredacted and unbounded (now redacted, at most 200, the excess in `evidenceWithheld`; `b24-c2-redaction` 11, red then green);
`loadStudioProject` bounded the entry count only (now `loadAiAuditLog` redacts and caps every stored entry as on write; case 6 extended, red
then green); the port's `head_moved` guards had no PostgreSQL proof (`b24-c2-retention-pglite` 6, proven against the port with its three
throws deleted - 5 / 6 - then restored byte for byte, 6 / 6); and the records cited the adapters' two edits one line too low (the `model:` lines) and the
persistence edit one line too high (`assertProjectShape`); corrected by anchor to `adapters.ts:88, :190` and `persistence.ts:40`. Suites 43 / 43 after the round; the gate re-runs are in the increment report. No migration
(32), census, tool-count, classification, flag or environment-name move; every live step BLOCKED-LIVE-QUALIFICATION (LB-14, LB-13, LB-2,
LB-7, LB-9).

### The lead's runs (not run by the builder)

- **Both Playwright configs, once** (no vitest beside them): every chat run now also schedules one attribution write into the fixture
  runtime's in-memory repository (after C1's trace write) and reads the published configuration digest `register()` sets under `next dev`.
  Record what the browser proof sees; never assume it.
- **The local production-mode run** (a fresh worktree with no `.env*` file): `next build` now bundles `instrumentation.ts`'s dynamic imports
  of `app/lib/deployment/configuration.ts` and `app/lib/observability/deployment-configuration-digest.ts` for the nodejs runtime; then `next
  start` and `production-smoke`'s probes. Expected unchanged answers (INFERRED: the record is built once at start, in a try/catch, and no probe
  runs a chat).
- **CI on the pushed commit:** prompt-to-gerber's duration against its 25-minute limit (C2's four non-PGlite suites ride its directory filter;
  locally about 45 s together) - within five minutes of the limit, STOP (OD-30); database-delivery against its 15 (one more PGlite file, about
  5 s locally); `production-smoke` green.
- **The B17-A browser suite:** not needed - C2 changes no UI and no control (`generate-b17-control-inventory`: no drift).
- **Never run** `scripts/retention-purge.ts` against any database, the dry run included (OD-191, OD-202, LB-14).
