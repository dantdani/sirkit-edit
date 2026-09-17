# B19 — test and validation report

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **RECORDED** (written down without a claim),
**UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Every number in §1 was produced on the final tree of `chapter/b19-external-acquisition` (code at `bf88eba`; the closeout
commits after it change only artifacts), not remembered from an increment. The machine has 16 GB; every run below used two
vitest workers, one run at a time, and each process was stopped when its run ended.

## 1. Runs on the final tree

| run | scope | result |
|---|---|---|
| full unit and integration suite | `pnpm exec vitest run --maxWorkers=2` over the whole tree, no exclusions | **634 files: 628 passed, 6 skipped whole; 6,595 tests: 6,560 passed, 35 skipped; 0 failures, 0 timeouts; 12.2 min; no process left behind** — CONFIRMED |
| typecheck | `tsc --noEmit` on the whole tree (4 GB heap: the check peaks near 2.2 GB) | **0 errors** (37 s non-incremental; the incremental check agrees) — CONFIRMED |
| lint | `eslint` on every `.ts`/`.tsx` this chapter changed (306 files) | 25 findings, every one pre-existing and unchanged in count since the increment that last touched the file: `app/page.tsx` 14 `react-hooks/refs`, `BomView.tsx` 4 `set-state-in-effect`, `PcbEditor.tsx` 1, `b14-replacement-proposal.test.ts` 3, and one unused-import warning each in `lcsc.ts`, `ingest-kicad.ts` and `project-state.test.tsx` (the last on a line from 2026-08-04 that B19 did not touch); **no new finding** — CONFIRMED |
| generators | the B19 source registry, the route-policy artifacts (B16.0.1/2/4/7 and the B16.0.8 baseline), action toolability, the agent artifacts (B01/B04/B09), B11, read invocation, B10, the B17 control inventory | 14 generators re-run on the final tree, exit 0 each: **zero drift** (`git status` identical before and after) — CONFIRMED |
| ratchets | `b16-1c-invariant-tripwires` (162 route methods = 159 canonical + 3 factories + 0 raw), `b17-f-agent-exposure`, the CI job-scope guard, the chat import-closure ratchet, the no-purchase tripwire, the B11.5 write-closure gate, the B14 AST import gates | all ran inside the full suite: tripwires 7/7, agent exposure 9/9, CI job scope 4/4, import closure 5/5, no-purchase 13/13, B11.5 18/18, AST import gates 22/22, never-execution sweep 4/4 — CONFIRMED |
| browser | not run in this chapter: the machine could not hold a Chromium run beside the suite; CI's `page-browser-e2e` job runs the committed browser specs against the fixture runtime on every push | RECORDED |
| live contract check | `b19-e-live-contract.test.ts` under `SIRKIT_LIVE_ACQUISITION_CONTRACT=1`: operator-run only, needs the operator's vendor credentials, spends quota | BLOCKED-LIVE-QUALIFICATION |

The six whole-file skips are opt-in suites without their environment marker: the live acquisition contract check
(`SIRKIT_LIVE_ACQUISITION_CONTRACT`), the live PCB assist (`PCB_ASSIST_LIVE` with a provider key), the SPICE worker integration
(`SPICE_WORKER_LIVE`), the Postgres qualification (a second qualification URL), the durable-workflow tenant scope and the PCB ingest
integrity (a qualified `DATABASE_URL`). The other 20 skipped cases sit inside files that otherwise ran: the live Supabase matrix (9),
the physical-binding schema integrity on Postgres (6), the kicad-cli oracle (2), and one case each in the pcb-sync route, the
electrical-identity boundary and the pcb-sync authority component. All 35 are skipped by design, none by failure.

## 2. What the suite proves, by checkpoint

The chapter added 98 test files under the `b19-` prefix (45 of them `b19-e-`), all in CI's deterministic lists (the job-scope
guard `b19-e-ci-job-scope.test.ts` refuses a B19 suite that is not listed, and confines every PGlite suite to the
`database-delivery` job). Every vendor interaction in them runs against fake servers injected through the egress boundary; the
model side uses scripted adapters; credentials are obvious fakes assembled at runtime.

| checkpoint | increment (commit) | tests introduced (all green at the increment and on the final tree) |
|---|---|---|
| discovery | `de2d6c2` | none (read-only; D19-1 … D19-7 recorded, reproduced by I1/I2 before any fix) |
| B19-B boundary | I1 `237e433` | outbound-fetch 19, distributor-egress 8: HTTPS only, exact-host allowlists, every resolved address checked, one deadline including DNS, bounded reads, media-type checks, manual redirects revalidated per hop, redacted closed-code errors |
| B19-B boundary | I2 `85a0fa9` | pricing-live-gate 4, bom-quota 12: live pricing is a granted capability (`providerCredit`); no BOM route repeats a failure's text |
| B19-B boundary | I2b `c5b972c` | cross-verify-egress 12, schgen-endpoint-client 14: the second opinion's call goes through the same boundary (D19-6 closed) |
| B19-A registry | I3 `c452155` | source-registry 24, connector-policy 6, source-admission 7, offer-retention 5: registry 1.0.0 checked against current vendor documentation; Mouser disabled (OD-32), LCSC blocked; storage terms enforced (D19-8 … D19-11) |
| B19-B boundary | I3b `244c7c4` | quota-breaker-coalescing 7, admission-control 9: registered quotas, circuit breakers, in-flight coalescing |
| B19-C pipeline | I4 `583691e` | quarantine-pipeline 20: observation → candidate → evidence bundle, nothing authoritative |
| B19-C pipeline | I4b `d1d5ed0`, `ad3f066` | approval-evidence-authority 17: a reviewed revision rests only on engineering-authoritative evidence, never sourcing text or unreviewed AI extraction |
| B19-D import security | I5a `bea0d35` | export-license 7: license enforced at the KiCad export (D19-7) |
| B19-D import security | I5b `2feaeee`, review `1144287` | exact-MPN connectors 7, pricing 5, vendor values 26, lifecycle 2, quarantine; review 5 + 36 + 2 + 16: wrong-part binding and hostile vendor data |
| B19-D import security | I5c `5eec196`, review `19be27f` | chat markdown 7, href and CSV 11, export selections 7, fab CSV 2, KiCad emit 13, report: output injection closed in chat, writers, links and CSVs |
| B19-D import security | I5d `cf3993e`, review `248c5e1` | claims-values 27, KiCad hostile 21, s-expression hostile 8, atomic integrity 16; review 32 + 3 + 2 |
| B19-D import security | I5e-1 `8df97ff`, I5e-2 `a75fc1e`, review `8fb9569` | project import 13, BOM table 9, source unions 11, DSN tokens 10; build-loop injection 11, compose 3, tool-result hygiene 2, excerpt 2; review: deck injection, review-input bounds, pinned checkout (matrix rows 01–53) |
| B19-E product | E1 `076d542`, `58cdc89`, review `2dee62c` | provenance cache 5, counts 3, source labels 7, BOM sources 5, packet 5, workbench 7, no-purchase tripwire 9 |
| B19-E product | E2 `5c8de9d` (+ CI heap `5b2c3ca`) | seven suites: external search, its contract, the route (ratchet 159 → 160), registry 1.1.0, purpose share, CI job scope |
| B19-E authority | E3 `875da8f` | three suites: two-person validation, revision status transitions, withdrawal, selectable loaders, collision and replay |
| B19-E authority | E4 `40c15b6` | import review, publication review (ratchet → 162 with the publication pair), publication boundaries with fixture KiCad libraries, offer-cache observations |
| B19-E lifecycle | E5 `78a0d21`, `b7a0661` | lifecycle, successor rebind, exact-revision adoption, the revision status read (ratchet 162 final), the physical-binding handoff fix |
| gate repair | `b363b0f` | the B11.5 write-closure gate admits the E4 fixture test by justification (root under the OS temp directory) |
| B19-E agent | E6 `bf88eba` | external-read descriptors, service, agent read port, chat external acquisition, live contract (opt-in), exact-MPN offer cache (PGlite) |

## 3. The adversarial reviews

Each substantive increment was reviewed by a workflow of four read-only lenses (regressions, security, coverage, tests), one
skeptic per lens told to refute, a fixer that had to reproduce every confirmed finding with a failing test before touching the
source (or, for a test-strength finding, break the source deliberately and show the strengthened test catches it, restoring by
hash), and an independent checker that re-read the diff. Refuted findings are recorded with their reasons in the ledger.

| increment | findings | confirmed | refuted | outcome |
|---|---|---|---|---|
| I5b | 39 | 22 (1 medium, 21 low) | 17 | all fixed in `1144287` |
| I5c | 20 | 17 | 3 | all fixed in `19be27f` (one refuted-as-out-of-scope item became matrix row 52 and was closed in I5e) |
| I5d | 30 | 12 | 18 | all fixed in `248c5e1` |
| I5e | 35 | 19 (14 distinct) | 16 | all fixed in `8fb9569`; 28 cases failed on the unchanged code first |
| E1-C | 17 | 15 (13 distinct) | 2 | all fixed in `2dee62c`; 18 deliberate breakages each caught; two independent checkers |
| E2 | 17 | 12 | 5 | fixed inside the increment; 19 failing cases first, 16 breakages caught |
| E3 | two workflow runs | 10 confirmed by the second run's checker, plus the first run's | — | fixed inside the increment; split verdicts resolved fail-closed by the lead |
| E4 | 24 | 16 | 8 | fixed inside the increment; a follow-up workflow closed the checker's four residual items |
| E5 | 21 | 14 | 7 | fixed inside the increment |
| E6 | four lenses | 15 | — | fixed inside the increment; the lead then closed the checker's four residual low items with two failing-first cases and two pins |

None of the confirmed findings was closed by argument; each has a test that fails on the code before its fix.

## 4. Defects found and fixed inside the chapter

Product defects from discovery (each reproduced before it was fixed): an anonymous, CSRF-free `/api/bom` driving paid live
calls with a caller-supplied cache bypass (D19-1); raw distributor error text reflected to unauthenticated callers (D19-2); no
timeout or abort on any distributor call (D19-4); unbounded `res.json()` on every outbound response (D19-5); cross-verify
following redirects with its bearer attached and reflecting the remote body (D19-6); license enforced at publication but not at
export (D19-7); DigiKey called faster than its documented limit (D19-8); stored offers ignoring the vendors' storage terms
(D19-9); Mouser used against its terms (D19-11). One regression the chapter itself introduced was caught and closed inside it:
after I2 the operator refresh job silently refreshed nothing (D19-10, found in I3). D19-3 was a discovery error, corrected
against Mouser's current documentation; D19-12 (Nexar OAuth) is recorded, not changed.

Pre-existing defects found while proving B19-E, all fixed with regressions that fail on the pre-fix code:

1. **Durable component-review approvals were always refused** on PostgreSQL (`b7a0661`): the catalog loader stamps each
   portable snapshot's `capturedAt` with the load time and the review evidence digest included it, so the second read never
   matched the first. The digest now excludes the read time; evidence drift is still refused.
2. **A withdrawn revision could be re-published or linked by replay** (E3 review), and a value whose own link pointed at a
   withdrawn revision fell back to the family (lead fix, fail-closed).
3. **A slow vendor defeated the agent's per-run cap and the "pending" promise** (E6 review): the port's deadline equalled the
   service's timer, so a hung vendor timed the whole call out instead of settling its misses as pending.
4. **The B11.5 write-closure gate had been red since E4** (`b363b0f`): not in a CI list, found by the E6 implementer's full
   run; admitted by justification, not loosened.
5. **A governance path case had never run on Linux** (`ad3f066`): CI found it on the I4b push.

## 5. CI on the branch

Two workflows run on every push (`deterministic-manufacturing`: prompt-to-gerber, database-delivery with PGlite, benchmark-core,
page-browser-e2e; `benchmark-quality`). Of the 31 chapter commits before the closeout, two were red and each was fixed by the
very next commit: `d1d5ed0` (the Linux-only governance path case, `ad3f066`) and `5c8de9d` (the type-check step's V8 heap at
about 2 GB — resources, not a type error — `5b2c3ca` gives both tsc steps a 4 GB heap). Every other commit is green in both
workflows; `bf88eba` (E6, the final code commit) is green in both workflows, and the artifact-only closeout commits are watched to green before the merge.

## 6. Environment notes (RECORDED)

The full suite cannot be run beside anything else on this machine: an earlier full run under contention produced 68 timeouts
that a per-file re-run under the bounded runner reduced to the one real failure (the `write-dsn` escaped-quote pin, moved as a
reviewed pin move to expect the refusal). This closeout ran the suite alone (12.2 min, no timeout), then tsc, eslint and the generators one at a time, stopping each
process when it ended; every run’s log is in the session scratchpad and its totals are copied here verbatim.
