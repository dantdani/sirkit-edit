# B21 closeout (1/2) — the standing single-agent statements superseded, the stale titles retitled, D21-36 retired, the tripwire

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **RECORDED** (written down without a claim), **UNKNOWN**.

Base: `d8680ea` (B21-F2b), 2026-09-29. Closes the closeout half of D21-27 (under OD-113) and D21-36. No behaviour change beyond deleting a
function no production code calls; no assertion weakened except the one the D21-36 map retires (section 3.1); no verdict - that is
commit 2/2, the lead's. The B21 README, `discovery.md` and the program's records are the lead's reserved files: their rows and closure
clauses for this commit point here. Every section below is pinned by `app/lib/agent/orchestration/__tests__/b21-closeout-statements.test.ts`
(the tripwire, section 4), which reads this page and the files it names.

## 1. What commit 1/2 changed, by kind

**CONFIRMED** (the diff against `d8680ea`, counted by script; the tripwire pins the note and retitle counts, and the page suites pin
every re-pinned row by anchor and line):

- **Dated notes, in place** - each stale statement keeps its own words and gains `[superseded <date> by the B21 closeout (D21-27,
  OD-113): …]` on its own line, the flag-off truth kept (with `SIRKIT_ORCHESTRATION_ENABLED` off every message is the single-agent loop
  exactly as before):
  - 16 production lines in 11 files, the notes adding or removing no line (`orchestration-runtime.ts` loses 20 lines to the D21-36
    retirement, below): `app/api/chat/route.ts:3`,
    `app/api/chat/orchestration-runtime.ts:13, :19, :26, :254`, `app/lib/acquisition/admission-control.ts:19, :47`,
    `app/lib/agent/contracts.ts:2`, `app/lib/agent/fixture-agent-adapter.ts:25`, `app/lib/agent/orchestration/role-tools.ts:94`,
    `app/lib/agent/orchestration/scheduler.ts:33`, `app/lib/agent/orchestration/store.ts:347`, `app/lib/agent/run-consumer.ts:10, :37`,
    `app/lib/auth/route-handlers.ts:755`, `app/page.tsx:4760` (three of them - route-handlers, run-consumer :10, page.tsx - wrap a
    statement that starts on the line above). `route.ts:14` ("No silent cross-provider fallback exists;") stands un-noted: three B21
    pages pin it as standing.
  - 13 notes in 10 test files (suite headers and the D2 fixtures' header).
  - 53 notes in 17 pages: 46 in 10 B21 pages and one in each of the seven B11 capsule pages that still named the capsule v3. A page
    gained lines only where no page case pins its line numbers (`specialist-roles.md`: the `cost-latency-router` row's note, a
    blockquote after its table, because the row is pinned equal to `ROLE_NOTES`; the B11.5/.6/.7 validation summaries: one blockquote
    each under the versioning heading).
- **Retitles, assertions unchanged** - 36 cases in 23 suites retitled to what their bodies assert, each with a same-line
  `[B21 closeout, 2026-09-29] retitled` note; every `it(` count unchanged; every page line that quoted an old title moved with it.
- **D21-36** - two symbols retired from `app/api/chat/orchestration-runtime.ts` (`specialistResultsEnvelope` and the
  `ENVELOPE_HEADER` const only it read; -20 lines), one tombstone line left after `usable` (section 3).
- **Re-pins** - 122 citation rows: 117 re-pinned by -20 into the runtime (`route-resume.md` 55, `run-events-and-trace.md` 18,
  `merge-and-disagreement.md` 10, `specialist-proposals.md` 10, `composer-and-first-turn.md` 7, `evaluation-matrix.md` 5,
  `task-complexity-router.md` 5, `provider-routing-and-failure.md` 4, `specialist-replacement.md` 2, `specialist-roles.md` 1), three
  re-anchored to the tombstone (B page C45, D page C74, F page C30), two carrying a note on their row (D3 page C38, B page C55); the two
  line literals in `b21-d3-page.test.ts` moved 260 -> 240.
- **The tripwire** - one new suite, `b21-closeout-statements.test.ts` (ten cases, section 4), riding the orchestration directory filter
  (no CI change).

## 2. The B07.5..B16 stop-condition lines (D21-27's artifact half)

**RECORDED** - the one dated note the discovery's Closeout plan names ("one dated note in the B21 README for the artifact NOT started
lines"); it is written here because the README is the lead's reserved file, whose closeout row points to this section:

> [B21 closeout, 2026-09-29] The B07.5..B16 stop-condition lines that list multi-agent orchestration or multi-agent work (or, for
> B07.5, agent orchestration) as not started, not done, or absent are true for their own chapters and stay as written.
> Since B21 (`4b6d0e2`..`d8680ea`), specialist orchestration exists behind SIRKIT_ORCHESTRATION_ENABLED=1.
> It is off by default: with the flag off, every chat message runs the single-agent loop.

This follows the B20 precedent (`8a5637f`), which left the parallel "MCP … NOT started" stop lines untouched. The 73 lines it covers -
the verified sweep's 72 (`closeout-scope/artifact-statements.json`: the finder's 70 plus `b15-2/final-verdict.md:50` and
`b16-1c/README.md:39`) and B07.5's out-of-scope line - each re-read at `d8680ea` and unchanged since (tripwire case 9 re-reads every
one):

- `artifacts/ai-control-plane-b07-5/README.md:154`
- `artifacts/ai-control-plane-b10/validation-summary.md:125`
- `artifacts/ai-control-plane-b10-1/validation-summary.md:102`
- `artifacts/ai-control-plane-b10-2/validation-summary.md:87`
- `artifacts/ai-control-plane-b12/README.md:44`
- `artifacts/ai-control-plane-b13/verdict.md:19`
- `artifacts/ai-control-plane-b14/final-verdict.md:61`
- `artifacts/ai-control-plane-b14-1/final-verdict.md:60`
- `artifacts/ai-control-plane-b14-2/final-verdict.md:55`
- `artifacts/ai-control-plane-b14-3/final-verdict.md:61`
- `artifacts/ai-control-plane-b14-4/final-verdict.md:83`
- `artifacts/ai-control-plane-b14-5/final-verdict.md:75`
- `artifacts/ai-control-plane-b15/final-verdict.md:92`
- `artifacts/ai-control-plane-b15-1/final-verdict.md:59`
- `artifacts/ai-control-plane-b15-2/final-verdict.md:50`
- `artifacts/ai-control-plane-b15-2-2/final-verdict.md:51`
- `artifacts/ai-control-plane-b15-2-3/final-verdict.md:51`
- `artifacts/ai-control-plane-b15-3/final-verdict.md:76`
- `artifacts/ai-control-plane-b16-0/final-verdict.md:93`
- `artifacts/ai-control-plane-b16-0-1/final-verdict.md:84`
- `artifacts/ai-control-plane-b16-0-2/final-verdict.md:83`
- `artifacts/ai-control-plane-b16-0-2/unknowns-and-owner-decisions.md:42`
- `artifacts/ai-control-plane-b16-0-3/final-verdict.md:74`
- `artifacts/ai-control-plane-b16-0-3/unknowns-and-owner-decisions.md:46`
- `artifacts/ai-control-plane-b16-0-4/README.md:70`
- `artifacts/ai-control-plane-b16-0-4/final-verdict.md:32`
- `artifacts/ai-control-plane-b16-0-4/superseded-claims.md:43`
- `artifacts/ai-control-plane-b16-0-4/unknowns-and-owner-decisions.md:78`
- `artifacts/ai-control-plane-b16-0-5/README.md:57`
- `artifacts/ai-control-plane-b16-0-5/final-verdict.md:37`
- `artifacts/ai-control-plane-b16-0-5/superseded-claims.md:61`
- `artifacts/ai-control-plane-b16-0-5/unknowns-and-owner-decisions.md:57`
- `artifacts/ai-control-plane-b16-0-6/README.md:53`
- `artifacts/ai-control-plane-b16-0-6/final-verdict.md:20`
- `artifacts/ai-control-plane-b16-0-6/superseded-claims.md:54`
- `artifacts/ai-control-plane-b16-0-6/unknowns-and-owner-decisions.md:63`
- `artifacts/ai-control-plane-b16-0-7/final-verdict.md:55`
- `artifacts/ai-control-plane-b16-0-7/superseded-claims.md:48`
- `artifacts/ai-control-plane-b16-0-7/unknowns-and-owner-decisions.md:52`
- `artifacts/ai-control-plane-b16-0-8/final-verdict.md:38`
- `artifacts/ai-control-plane-b16-0-8/superseded-claims.md:35`
- `artifacts/ai-control-plane-b16-0-9/final-verdict.md:25`
- `artifacts/ai-control-plane-b16-0-10/unknowns-and-owner-decisions.md:34`
- `artifacts/ai-control-plane-b16-0-11/unknowns-and-owner-decisions.md:37`
- `artifacts/ai-control-plane-b16-0-12/unknowns-and-owner-decisions.md:38`
- `artifacts/ai-control-plane-b16-0-13/unknowns-and-owner-decisions.md:42`
- `artifacts/ai-control-plane-b16-0-14/unknowns-and-owner-decisions.md:39`
- `artifacts/ai-control-plane-b16-0-15/final-verdict.md:41`
- `artifacts/ai-control-plane-b16-0-15/unknowns-and-owner-decisions.md:36`
- `artifacts/ai-control-plane-b16-0-16/final-verdict.md:45`
- `artifacts/ai-control-plane-b16-0-16/unknowns-and-owner-decisions.md:39`
- `artifacts/ai-control-plane-b16-0-17/final-verdict.md:42`
- `artifacts/ai-control-plane-b16-0-17/unknowns-and-owner-decisions.md:38`
- `artifacts/ai-control-plane-b16-0-18/final-verdict.md:33`
- `artifacts/ai-control-plane-b16-0-18/unknowns-and-owner-decisions.md:35`
- `artifacts/ai-control-plane-b16-0-19/final-verdict.md:32`
- `artifacts/ai-control-plane-b16-0-19/unknowns-and-owner-decisions.md:31`
- `artifacts/ai-control-plane-b16-0-20/final-verdict.md:34`
- `artifacts/ai-control-plane-b16-0-20/unknowns-and-owner-decisions.md:34`
- `artifacts/ai-control-plane-b16-0-21/final-verdict.md:31`
- `artifacts/ai-control-plane-b16-0-22/README.md:13`
- `artifacts/ai-control-plane-b16-0-22/final-verdict.md:34`
- `artifacts/ai-control-plane-b16-0-22/unknowns-and-owner-decisions.md:46`
- `artifacts/ai-control-plane-b16-0-23/README.md:16`
- `artifacts/ai-control-plane-b16-0-23/final-verdict.md:36`
- `artifacts/ai-control-plane-b16-0-23/unknowns-and-owner-decisions.md:51`
- `artifacts/ai-control-plane-b16-0-24/README.md:13`
- `artifacts/ai-control-plane-b16-0-24/final-verdict.md:38`
- `artifacts/ai-control-plane-b16-0-24/unknowns-and-owner-decisions.md:46`
- `artifacts/ai-control-plane-b16-0-24-1/final-verdict.md:28`
- `artifacts/ai-control-plane-b16-1b/README.md:23`
- `artifacts/ai-control-plane-b16-1b/final-verdict.md:41`
- `artifacts/ai-control-plane-b16-1c/README.md:39`

Left alone as still true (the sweep's list): chapter-scoped or past-tense absence lines ("No … multi-agent surface was added" in B09.1,
B10-B11.x and B12.x; the B09 README title), the B11 tripwire rows kept verbatim under OD-113, and every reserved-text section and
"Citations, as of base" table of the B21 pages (dated, append-only records).

## 3. D21-36: B's envelope retired, and the other exports with no production caller

### 3.1 The retirement

**CONFIRMED** (`git grep` finds no production caller at `d8680ea`: since B21-D the route builds the merge's `mergedResultsEnvelope`):
`specialistResultsEnvelope` and `ENVELOPE_HEADER` are deleted from `app/api/chat/orchestration-runtime.ts`; `interface
SpecialistResultsEnvelope` (which `mergedResultsEnvelope` returns) and `usable` stay; ONE tombstone comment line after `usable` (line
189) is the only runtime line that names the function. B's route case 12 keeps its `it(` block as the retirement's TRIPWIRE (the suite
stays at 18 cases): the runtime exports no such function, names it in one line, and has no `ENVELOPE_HEADER`. Its assertions moved:

| B route case 12 checked (on B's function) | now checked (on the production envelope) |
|---|---|
| the bound under `MAX_RESULT_CHARS`, with an over-budget input | D route case 6 (the over-budget precondition moved there) |
| the over-budget fallback: summaries only, never a truncated document | D route case 6: the view lands in the `summaries` stage, each of the four specialists keeps its summary, no assumption record, a whole document after the header ([B21 closeout-1 fix] tests-1 / coverage-3: the stage and the summaries were added by the review) |
| the merged digest carried | D route case 6 (`bigMerge.digest`) |
| a secret-shaped reason redacted | D route case 6 |
| a directive-looking summary carried as DATA under the header, "never instructions" first | D route case 6 and B route cases 4 and 12b |
| one provider and model -> `sameSource:true` | D route case 6 (one provider reporting two models is one source) and B route case 4 |
| `/shape-validated/` in the header | B route case 4 |
| the contracts refuse a secret-shaped summary | `b21-a-contracts.test.ts` |
| two models of one provider -> `sameSource:false` | **RETIRED, not moved** - it contradicts the one-provider-one-source rule the merge has kept since B21-D (`21ae845`), which D route case 6 pins |

C's least-privilege case 8 read the not-run sourcing task in B's envelope: the attempt-1 string is D route case 6's, the attempt-0
string B route case 4's (the production POST), and the case keeps an outcome-level reason check. The B page's C45, the D page's C74
and the F page's C30 cite the tombstone; `specialist-roles.md` keeps the function's name in a dated note (the C page case pins it).

### 3.2 The other exports with no production caller

**CONFIRMED** at `d8680ea` by tripwire case 10, which re-derives each row from the tree: the export exists, no other production source
names it (comments stripped), and its own module uses it only as the kind says - a test seam, test oracle, documentary table or type
name only at its declaration, a vocabulary only through `typeof`. **RECORDED**, none retired: each has a reason to exist, none is plainly
dead, and retiring any shifts cited lines in its file (an in-place record shifts none).

| module | export | kind | why it stays |
|---|---|---|---|
| `app/lib/agent/orchestration/role-tools.ts` | `roleExposureReport` | test oracle | the per-role exposure report the C and D3 role suites check the reviewed rows with |
| `app/lib/agent/orchestration/run-events.ts` | `orchestrationRunEventIssue` | test oracle | the closed-shape judge the E2 builders are tested against; the client reducer reads `isOrchestrationRunEventType` |
| `app/lib/agent/orchestration/store.ts` | `setOrchestrationRunStoreFactory` | test seam | store case 11's factory seam; the composition root binds its own factory (the note at store.ts:347) |
| `app/lib/agent/orchestration/store.ts` | `resetOrchestrationRunStoreFactory` | test seam | the reset of store case 11's factory seam |
| `app/api/chat/orchestration-runtime.ts` | `setOrchestrationStoreFactory` | test seam | the route suites' in-memory durable record (the sibling-runtime seam pattern) |
| `app/api/chat/orchestration-runtime.ts` | `resetOrchestrationStoreFactory` | test seam | the reset of the route suites' record seam |
| `app/api/chat/orchestration-runtime.ts` | `setTaskComplexityRouterFactory` | test seam | the resume runtime suite's router double |
| `app/api/chat/orchestration-runtime.ts` | `resetTaskComplexityRouterFactory` | test seam | the reset of the resume runtime suite's router double |
| `app/api/chat/orchestration-runtime.ts` | `setSpecialistSchedulerFactory` | test seam | the route suites' scheduler double |
| `app/api/chat/orchestration-runtime.ts` | `resetSpecialistSchedulerFactory` | test seam | the reset of the route suites' scheduler double |
| `app/lib/agent/orchestration/merge.ts` | `MERGE_RULES` | documentary table | the merge's rules as data, pinned by the D and E1 pages; the merge implements them procedurally |
| `app/lib/agent/orchestration/result-tool.ts` | `RESULT_TOOL_REFUSALS` | documentary table | the result tool's refusals as data, pinned by the E1 page and its result-tool suite |
| `app/lib/agent/orchestration/role-tools.ts` | `ROLE_RUNBOOK_LINES` | documentary table | each role's runbook line, pinned by the C role-tools suite |
| `app/lib/agent/orchestration/role-tools.ts` | `ROLE_NOTES` | documentary table | each role's reason, pinned equal to the C page's cells (role-tools case 4) |
| `app/lib/agent/orchestration/role-tools.ts` | `DORMANT_SPECIALIST_PROPOSALS` | documentary table | the proposals no specialist is offered and why, pinned by the D2 and D3 pages and suites |
| `app/lib/agent/orchestration/router.ts` | `FULL_CIRCUIT_RUNBOOK_ROLES` | documentary table | the runbook's full-circuit role list, pinned by the B router and scheduler suites and the C page |
| `app/lib/agent/orchestration/router.ts` | `FULL_CIRCUIT_TRIM` | documentary table | OD-107's fixed trim to the cap of four; `DAG_ROLE_LISTS` hard-codes the trimmed lists |
| `app/lib/agent/orchestration/router.ts` | `ROUTER_RULES` | documentary table | the router's rule table as data (B page, B router suite, C page, D3); `routeTaskComplexity` implements it procedurally |
| `app/lib/agent/orchestration/tripwires.ts` | `ORCHESTRATION_MODULE_PREFIX` | test oracle | where the orchestration modules live, read by the A import gate and the E2b and F suites |
| `app/lib/agent/orchestration/tripwires.ts` | `B11_SCANNED_FILES` | test oracle | the nine B11-scanned files the orchestration stays out of (OD-113), read by the same suites |
| `app/lib/agent/orchestration/tripwires.ts` | `ORCHESTRATION_IDENTIFIER_PATTERN` | test oracle | the identifier pattern those suites scan the nine files for |
| `app/lib/agent/orchestration/contracts.ts` | `ORCHESTRATION_REFUSALS` | vocabulary | the contracts' closed refusal vocabulary, named as data beside its type |
| `app/lib/agent/orchestration/merge.ts` | `MERGE_IDENTITY_KINDS` | vocabulary | the merge's identity kinds, named as data beside its type |
| `app/lib/agent/orchestration/merge.ts` | `MERGE_REFUSALS` | vocabulary | the merge's refusals, named as data beside its type |
| `app/lib/agent/orchestration/merge.ts` | `SPECIALIST_APPROVAL_OUTCOMES` | vocabulary | the approval decision's outcomes, named as data beside its type |
| `app/lib/agent/orchestration/provider-policy.ts` | `PROVIDER_ROUTE_REFUSALS` | vocabulary | the provider route's refusals, named as data beside its type |
| `app/lib/agent/orchestration/router.ts` | `ROUTE_PLAN_KINDS` | vocabulary | the router's plan kinds, named as data beside its type (no test reads it either) |
| `app/lib/agent/orchestration/scheduler.ts` | `SCHEDULER_REFUSALS` | vocabulary | the scheduler's refusals, named as data beside its type |
| `app/lib/agent/orchestration/scheduler.ts` | `SCHEDULER_STOPS` | vocabulary | the scheduler's stops, named as data beside its type |
| `app/lib/agent/orchestration/scheduler.ts` | `SPECIALIST_TASK_STATUSES` | vocabulary | the task statuses, named as data beside its type |
| `app/lib/agent/orchestration/store.ts` | `ORCHESTRATION_STORE_REFUSALS` | vocabulary | the store's refusals, named as data beside its type |
| `app/lib/agent/orchestration/merge.ts` | `MergeIdentityKind` | type name | the name of the identity-kind vocabulary's type; referenced nowhere, not even by a test |
| `app/lib/agent/orchestration/router.ts` | `DagShape` | type name | the name of the DAG shapes' type (the keys of `DAG_ROLE_LISTS`); referenced nowhere, not even by a test |
| `app/lib/agent/orchestration/store.ts` | `OrchestrationStoreRefusal` | type name | the name of the store refusals' type; referenced nowhere, not even by a test |

Every other B21 export is used at run time inside its own module (for example `MERGED_ENVELOPE_STAGES` and `boundedRecordCall`), so it
is live (the verified sweep, `closeout-scope/d21-36-dead-code.json` section 2).

## 4. The tripwire

**CONFIRMED** - `b21-closeout-statements.test.ts`, ten cases (the D20-30 pattern of `b20-b4-withhold-proposals` case 8):

1. no production source states the old claim (the chat surface as the single-agent loop alone, a Retry that always starts a NEW run, a
   B21-E promise B21-E did not keep) without the closeout's note on its line - or, for one of three wrapped statements, on the next line -
   outside a six-entry allow-list of flag-off statements B21 itself wrote;
2. the allow-list and the three wrapped statements are exact and cannot rot, and the scan bites (a note stripped, an allowed line
   moved, a fresh claim written directly above an unrelated noted line - all reported);
3. all sixteen production notes keep what they must say, and no other production line carries one;
4. the 36 retired titles never come back;
5. every page statement a later increment made untrue carries a note in its own block, and a verbatim row's note is the first block
   after its table;
6. every test file and page keeps its pinned number of notes (66), and no other file carries one (the lead's records not scanned);
7. a note that says the trace records a line states the recorder's shared 32-warning bound (`TRACE_BOUNDS.maxWarnings`);
8. the route header's proposal bound is the scheduler's, proved by a run (below);
9. section 2's note covers its 73 lines, each still as written;
10. section 3.2's record, re-derived from the tree.

Failing first: at `d8680ea` (before the notes and retitles) cases 1, 3, 4 and 5 failed and case 2 passed (its own mutation checks);
after them all five passed. The review's cases (section 5) failed first as listed there.

The proposal bound, stated exactly (case 8, over the D2 fixtures in memory): the loop refuses a second proposal in ONE run
(`proposal_exists`), but a task has `SPECIALIST_CAPS.attemptsPerTask` (2) attempts, each a fresh loop run with the same offered
tools - so a specialist that seals and then fails retryably seals again on its retry: two sealed artifacts from one task, at most
eight in a request of four specialists. The failed attempt's seal, which no merge judged, withholds the presentation (`incomplete`),
so nothing more reaches approval. **RECORDED** for the lead: the merged envelope's own header (model-facing text, `MERGED_ENVELOPE_HEADER`)
says "at most one inert sealed proposal per proposing specialist"; changing it is a behaviour change, outside this commit.

## 5. The adversarial review's findings, fixed test-first

**CONFIRMED** - eight findings, each reproduced before its fix. The four test-strength findings were reproduced by deliberate
breakages (M1 the envelope's summaries stage dropping every summary, M2 the fixture adapter's note reverted to its `d8680ea` text,
M3 a fresh claim on the blank line above store.ts's noted JSDoc, M4 the `cost-latency-router` note moved to the end of its page): the
pre-fix suites stayed green under all four (12 of 12). The fixed suites went red under each of them and under M5 (the D2 fixtures'
header note reverted to its `d8680ea` text - a test-file note, which the pre-fix suite scanned nowhere, **INFERRED** from its code):
5 of 17 red, each at the assertion its finding names. Every mutated file was restored byte-identical (sha256 checked).

| finding | test | red before the fix | fix | after |
|---|---|---|---|---|
| regressions-1 (low): a note said the trace records the stand-down line with no bound | case 7; case 3's runtime :19 entry | case 7 listed the runtime :19 note and `task-complexity-router.md` :366 (the same unbounded claim, a second instance) | both notes state the recorder's shared 32-warning bound, in place (no line moved) | green |
| security-1 (low): route.ts's note said "at most one inert sealed proposal each" | case 8 (a two-seal run); case 3's route.ts entry | the run sealed [1, 1] across the two attempts, then the header assertion failed | route.ts:3's note states one per specialist run, one per attempt, two attempts per task, and the withheld presentation, in place | green |
| coverage-1 (medium): the B07.5..B16 note was never written | case 9 | ENOENT: no page | section 2 of this page (the README is the lead's reserved file) | green |
| coverage-2 (low): the no-production-caller exports were recorded only in a report | case 10 | ENOENT: no page | section 3.2 of this page | green |
| coverage-3 / tests-1 (low): D route case 6 accepted any fallback stage, so B's "the summary survives" check was dropped | D route case 6 | green under M1 before the fix | case 6 pins the `summaries` stage and four kept summaries | red under M1, green restored |
| tests-2 (low): seven production notes (and every test and page note) could be reverted with the tripwire green | cases 3 and 6 | green under M2 before the fix | NOTED holds all sixteen production notes; case 6 pins every test and page note count | case 3 red under M2, case 6 red under M5, green restored |
| tests-3 (low): any claim directly above ANY noted line was excused | cases 1 and 2 | green under M3 before the fix | the next-line allowance is an explicit list of the three wrapped statements | red under M3, green restored |
| tests-4 (low): one page entry was the note itself | case 5 | green under M4 before the fix | the entry replaced by a row check: the note must be the first block after the row's table | red under M4, green restored |
