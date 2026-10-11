# B24 - Unknowns and owner decisions (closeout commit 2/2)

Labels: **CONFIRMED** (read at the cited file:line at `26dc8b8`), **INFERRED** (a reading, nothing executed), **RECORDED** (taken from a
record without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION** (needs a live resource the owner has not supplied;
never faked, never claimed). State at `26dc8b8`, the final SHA of the chapter's code, read from
`artifacts/remaining-builder-program/OWNER_DECISIONS.md` (each OD's heading line), the discovery's section 4 with every dated closure
clause and its sections 8 and 10, `artifacts/remaining-builder-program/LIVE_BLOCKERS.md` and the B24 pages. The one list over every
owner-decision number, OD-1 to OD-241, is `open-risks-and-owner-decisions.md` section 1 (`b24-f-registers` 4); this page is B24's own
part of it, with what each decision leaves with the owner. Read by `b24-f-verdict-lines` 4, 7 and 8.

## 1. Owner decisions OD-190 to OD-241

OD-190..OD-222 were drafted in the discovery's section 6; OD-223..OD-241 are the increments' stated choices and proposals beyond them
(the next free numbers at each increment's base, lead decision D13). Every number is spent and has exactly one heading; B24's amendments
are dated lines under that heading, named in the state cell as `amended by` (the OD list's markers). The state is the heading's own word
(`applied`, `applied in part`, `proposed`), as `b24-f-registers` 4 derives it; "confirmation" means the record applies a default and
leaves the owner its confirmation ("Owner confirmation pending", or "the owner may choose otherwise"); anything more is named.

| OD | title (as recorded) | heading | state | open for the owner |
|---|---|---|---|---|
| OD-190 | the hosting platform and environment topology | `OWNER_DECISIONS.md:2581` | applied in part | the hosting platform itself (UNKNOWN); staging and production BLOCKED-LIVE-QUALIFICATION (LB-13); it also gates LB-10 |
| OD-191 | the main Supabase project and an isolated staging project | `OWNER_DECISIONS.md:2715` | applied, amended by B24-E | an isolated `sirkit-auth-qualification-*` project and its account (LB-1, LB-13); whether the main project holds production data (treated as production) |
| OD-192 | least-privilege roles and RLS | `OWNER_DECISIONS.md:2726` | applied | the application role, PROPOSED only: BYPASSRLS or one policy per table; the real platform (LB-14) |
| OD-193 | migration rollback policy | `OWNER_DECISIONS.md:2739` | applied | confirmation; a real-server rollback stays BLOCKED-LIVE-QUALIFICATION (LB-14) |
| OD-194 | backup, restore, point-in-time recovery and failover evidence | `OWNER_DECISIONS.md:2749` | applied | the plan's backups, the PITR window and failover (LB-14) |
| OD-195 | Secrets management and rotation | `OWNER_DECISIONS.md:2639` | applied, amended by B24-A2F, B24-D1 | confirmation; rotating real deployed secrets (LB-13) |
| OD-196 | Security headers and origin allowlists | `OWNER_DECISIONS.md:2646` | applied | an enforced content-security policy (report-only until the owner accepts one); the Supabase Site URL and redirect list, verified only in staging (LB-1, LB-13) |
| OD-197 | rate limits and abuse controls | `OWNER_DECISIONS.md:2668` | applied, amended by B24-A3b | the recorded trade-off: one shared window per public route while the trusted client-address header is unset, or sign-in required on those routes; configuring the header (LB-13) |
| OD-198 | health and readiness | `OWNER_DECISIONS.md:2587` | applied | confirmation; the readiness route shares the worker secret (a separate credential is OD-195's) |
| OD-199 | versioned provider and tool configuration | `OWNER_DECISIONS.md:2593` | applied | confirmation |
| OD-200 | feature flags for MCP, the sandbox and external manufacturing | `OWNER_DECISIONS.md:2599` | applied | confirmation |
| OD-201 | the test-data guard | `OWNER_DECISIONS.md:2759` | applied | confirmation; the server's own database is not checked (LB-14) |
| OD-202 | Retention and deletion | `OWNER_DECISIONS.md:2970` | applied | the records kept until the owner decides (the orchestration record, OD-111; the grants and their index; the release ledger; the others OD-202 lists) |
| OD-203 | the golden catalog: where it lives and how classes are typed | `OWNER_DECISIONS.md:2792` | applied | confirmation |
| OD-204 | CI admission of the older suites and the corpus | `OWNER_DECISIONS.md:2823` | applied | confirmation; 64 `b16-0-*` suites stay outside CI (OD-228 (f)) |
| OD-205 | the power and ground invariant | `OWNER_DECISIONS.md:2839` | applied | the member-pin counterexample, D24-42 (OD-229) |
| OD-206 | How partial and deviating scenarios are reported | `OWNER_DECISIONS.md:2903` | applied | reversing OD-122 (scenario 17), or a qualified runner changing B22's verdict (scenario 18) |
| OD-207 | Durable run traces and the model-calling routes | `OWNER_DECISIONS.md:2943` | applied | confirmation |
| OD-208 | Trace attribution additions | `OWNER_DECISIONS.md:2995` | applied | confirmation; live request ids BLOCKED-LIVE-QUALIFICATION (LB-2, LB-7, LB-9) |
| OD-209 | Cost and spend, and honest opt-in live suites | `OWNER_DECISIONS.md:2910` | applied, amended by B24-C2 | an owner price table: `MODEL_PRICE_TABLE` is null, so every run is unpriced |
| OD-210 | A server-side record of Tier 2 approvals | `OWNER_DECISIONS.md:3004` | applied | a server-held Tier 2 approval record, outside B24 (the recorded alternative) |
| OD-211 | Who may read stored traces | `OWNER_DECISIONS.md:3012` | applied | an access-audit aggregate (the recorded alternative); the read mode's only authorization is the database credential |
| OD-212 | latency targets and the benchmark job | `OWNER_DECISIONS.md:3040` | applied, amended by B24-D2 | benchmark-latency's Actions minutes, and so the first runner baseline (`baseline_missing` until then) |
| OD-213 | the bounded paged board read | `OWNER_DECISIONS.md:3065` | applied | a strict-mode provider's call is refused before the read (D24-43, OD-236) |
| OD-214 | two tabs, a crash and a restart | `OWNER_DECISIONS.md:3074` | applied, amended by B24-D2B | the recorded open items: the one-slot conflict record, an in-flight grant settled only at the next reopen, the sweep's cross-tab window (INFERRED) |
| OD-215 | Accessibility bar and responsive scope | `OWNER_DECISIONS.md:3113` | applied | WCAG 2.2 AA with an axe devDependency, a tablet layout, an assistive-technology run (discovery section 8 item 12) |
| OD-216 | Live provider runs | `OWNER_DECISIONS.md:2917` | applied | provider credits, an owner price table and a money cap (LB-2, LB-7, LB-9) |
| OD-217 | the live-blocker register | `OWNER_DECISIONS.md:2611` | applied in part, amended by B24-A4, B24-B2, B24-E | confirmation (B24-E's dated line applies it in full; the heading keeps its first word) |
| OD-218 | fabrication and physical evidence | `OWNER_DECISIONS.md:3138` | applied | approval of fabrication naming who inspects and tests; then the store, the recording route and the wired review port as their own increment (LB-5) |
| OD-219 | the rule-profile expiry | `OWNER_DECISIONS.md:3145` | applied | renewing the jlcpcb-2l evidence before a real-clock release is refused from 2027-09-10: an owner action and a reviewed code change |
| OD-220 | how the B24-F maps are produced | `OWNER_DECISIONS.md:3185` | applied, amended by B24-Fb | a regenerate-all and drift command, as its own reviewed change |
| OD-221 | program records and hygiene before the verdict, B24-F's half | `OWNER_DECISIONS.md:3206` | applied in part, amended by B24-closeout | an eslint step in CI once `5dfae2b` merges through its own pull request; the four corrective branches and the reconstruction branch, unmerged |
| OD-222 | CI admission for B24 suites | `OWNER_DECISIONS.md:2605` | applied, amended by B24-B3 | confirmation |
| OD-223 | B24-A1: stated choices beyond its task text | `OWNER_DECISIONS.md:2619` | applied | confirmation |
| OD-224 | B24-A2: stated choices beyond its task text | `OWNER_DECISIONS.md:2652` | applied | confirmation; HSTS's `includeSubDomains` and `preload` are the owner's (LB-13) |
| OD-225 | B24-A3: stated choices beyond its task text | `OWNER_DECISIONS.md:2693` | applied, amended by B24-A3b | confirmation |
| OD-226 | B24-A4: stated choices beyond its task text | `OWNER_DECISIONS.md:2769` | applied | confirmation |
| OD-227 | B24-B1: stated choices beyond its task text | `OWNER_DECISIONS.md:2806` | applied | confirmation |
| OD-228 | B24-B2: stated choices beyond its task text | `OWNER_DECISIONS.md:2848` | applied | confirmation; (f) the 64 `b16-0-*` suites outside CI |
| OD-229 | a delete that removes a wire joining surviving pins (D24-42) | `OWNER_DECISIONS.md:2890` | proposed | the owner's choice: fail closed, trim, or name the survivors (recommended: fail closed on the agent path) |
| OD-230 | B24-B3: stated choices beyond its task text | `OWNER_DECISIONS.md:2925` | applied | confirmation |
| OD-231 | B24-C1: stated choices beyond its task text | `OWNER_DECISIONS.md:2953` | applied | confirmation; (b) re-annotating the 22 rows' durable access is the owner's alternative |
| OD-232 | B24-C2: stated choices beyond its task text | `OWNER_DECISIONS.md:2979` | applied, amended by B24-C3 | confirmation; (a) the salt per scope, one salt per tenant the alternative |
| OD-233 | B24-C3: stated choices beyond its task text | `OWNER_DECISIONS.md:3022` | applied | confirmation; (e) a read-only database role for the operator is the alternative |
| OD-234 | B24-D1: stated choices beyond its task text | `OWNER_DECISIONS.md:3050` | applied | `route-bench`'s two absolute budgets: keep, drop, or convert to baselined metrics |
| OD-235 | B24-D2: stated choices beyond its task text | `OWNER_DECISIONS.md:3086` | applied | confirmation |
| OD-236 | a strict-mode provider's null for an optional argument | `OWNER_DECISIONS.md:3105` | proposed | the proposed fix: drop a null whose property the schema leaves optional, before validation (D24-43) |
| OD-237 | B24-D3: stated choices beyond its task text | `OWNER_DECISIONS.md:3121` | applied | confirmation |
| OD-238 | B24-Ea: stated choices beyond its task text | `OWNER_DECISIONS.md:3151` | applied | confirmation |
| OD-239 | B24-Eb: stated choices beyond its task text | `OWNER_DECISIONS.md:3168` | applied | confirmation |
| OD-240 | B24-Fa: stated choices beyond its task text | `OWNER_DECISIONS.md:3193` | applied | confirmation |
| OD-241 | B24-Fb: stated choices beyond its task text | `OWNER_DECISIONS.md:3214` | applied | confirmation |

Counts: 52 numbers - 47 applied, 3 applied in part (OD-190, OD-217, OD-221), 2 proposed (OD-229, OD-236). **CONFIRMED** (each heading
read at its line; [B24-closeout review, 2026-10-11] correctness-3: `b24-f-verdict-lines` 7 re-derives each row's heading line, title
and state, and these counts, from `OWNER_DECISIONS.md` as `b24-f-registers` 4 does for the full list).

## 2. Discovery defects D24-1 to D24-43

Severity as the discovery's tally states it: 13 high, 25 medium, 5 low. The state is the one the defect's dated closure clauses give
it: `closed` (the clause says closed), `closed offline` (built and tested offline; its live half, where it has one, is a live blocker),
`closed as recorded` (a recorded bound or decision, nothing more built), `in part`, `open`. The closing increment is the one the
clauses name: their tag, or the part of it their text names (B24-Fa, B24-Fb). [B24-closeout review, 2026-10-11] correctness-5: every
row now takes its clauses' state, D24-3 too (it read the register's `in part`); a clause that hands the row to the register's re-read
takes the register's state (D24-38); `b24-f-verdict-lines` 7 re-derives each state and the tallies.
`threat-model-closure-register.md` section 5 holds the same defects in its own closed set, which has no offline state (a `closed
offline` row here is `closed` there); where the two differ beyond that, the row says why (D24-3, D24-34, D24-35).

| defect | severity | title (paraphrase) | state | closing increment | what stays, and where |
|---|---|---|---|---|---|
| D24-1 | high | the code knew two runtime states and CI had never built or run the production one | closed offline | B24-A1 | a hosted staging or production environment (LB-13) |
| D24-2 | high | no supported rollback | closed offline | B24-A4 | a real-server rollback (LB-14) |
| D24-3 | high | one all-powerful database role; row security on 1 of 143 tables; no grants | closed offline | B24-A4 | the register holds it closed in part: the application role is PROPOSED (OD-192); the real platform LB-14 |
| D24-4 | medium | secrets single-valued, with no rotation window, no CI scan and an incomplete example | closed offline | B24-A2 (B24-A2F's history-only entries) | rotating deployed secrets (LB-13) |
| D24-5 | high | the only security header was an image source policy | closed offline | B24-A2 | the hosted edge (LB-13) |
| D24-6 | low | origin and redirect allowlists single-origin, the Supabase side unrecorded | closed as recorded | B24-A2 | verified only in staging (LB-1, LB-13) |
| D24-7 | high | no database backup, restore, point-in-time recovery, failover or reconnect evidence | closed offline | B24-A4 | the platform's backups, PITR and failover (LB-14) |
| D24-8 | high | anonymous callers could spend paid provider credit unmetered | closed offline | B24-A3 | per-process windows; the trusted client-address header (LB-13, OD-197) |
| D24-9 | medium | no health or readiness check | closed offline | B24-A1 | a hosted probe (LB-13) |
| D24-10 | low | provider and model configuration unversioned | closed | B24-A1 | - |
| D24-11 | medium | no flag or kill switch for the sandbox, and no flag inventory | closed | B24-A1 | - |
| D24-12 | medium | opt-in tests could reach real data | closed | B24-A4 | the server's own database is not checked (LB-14) |
| D24-13 | medium | no retention or deletion policy implemented | closed offline | B24-C2 | - |
| D24-14 | high | no versioned golden catalog or six-class taxonomy | closed offline | B24-B1 | the deterministic offline class reads `failing` on D24-42 (B24-B2) |
| D24-15 | medium | evaluation, budget and map-pinning suites ran in no CI job | closed offline | B24-B2 | - |
| D24-16 | medium | three runbook areas had no evaluation, power and ground among them | closed offline | B24-B2 | one recorded counterexample, D24-42 |
| D24-17 | high | no artifact mapped the twenty required scenarios | closed offline | B24-B3 | - |
| D24-18 | medium | the model-in-loop class: one record-only command, never run, no money bound | closed offline | B24-B3 | a live run (LB-2, LB-7, LB-9) |
| D24-19 | medium | opt-in live suites could report green without the resource | closed offline | B24-B3 | - |
| D24-20 | high | the chat run trace was built, validated and thrown away | closed offline | B24-C1 | - |
| D24-21 | high | 22 model-calling paths left no durable usage or error record | closed offline | B24-C1 | - |
| D24-22 | medium | a trace could not say who asked, what was read or what failed | closed offline | B24-C2 | live request ids (LB-2, LB-7, LB-9) |
| D24-23 | medium | cost recorded nowhere, budgets not in the trace, latency run-level only | closed offline | B24-C2 | every run unpriced until an owner price table (OD-209) |
| D24-24 | medium | Tier 2 approvals recorded only in the browser; Tier 1 settlement browser-attested | closed as recorded | B24-C3 | OD-210's alternative is the owner's |
| D24-25 | low | three stores kept text without the redaction authority | closed | B24-C2 | - |
| D24-26 | low | stored traces had no reader, export or access audit | closed offline | B24-C3 | the access audit deferred (OD-211) |
| D24-27 | medium | no latency measured or gated | closed offline | B24-D1 | the runner baseline BLOCKED (`baseline_missing`) until the Actions minutes (OD-212) |
| D24-28 | medium | fragile real-clock thresholds gated CI | closed offline | B24-D1 | - |
| D24-29 | high | memory never measured; a routed board not readable whole | in part | B24-D2 | D24-43 leaves the paged read unusable by a strict-mode provider |
| D24-30 | medium | multi-tab and crash recovery proven only in-process | closed | B24-D2 (the lead's browser run B24-D2B; CI's red fixed by B24-D4) | OD-214's open items |
| D24-31 | medium | FreeRouting and kicad-cli cleanup killed the direct child only | closed offline | B24-D2 | live orphan runs (LB-3, LB-17) |
| D24-32 | high | accessibility and responsive behaviour untested and largely unbuilt | closed offline | B24-D3 (CI's red fixed by B24-D4) | desktop only; OD-215's owner choices |
| D24-33 | medium | the live-blocker register outside B24-E's vocabulary | closed | B24-E | - |
| D24-34 | medium | no browser spec ran in production auth | closed offline | B24-E | the run stays BLOCKED-LIVE-QUALIFICATION (LB-1, LB-13), the state the register gives the row |
| D24-35 | medium | nothing could record fabrication, inspection or test evidence | closed as recorded | B24-E | nothing built (OD-218); BLOCKED-LIVE-QUALIFICATION (LB-5), the state the register gives the row |
| D24-36 | low | the deterministic 555 release is time-bound | closed as recorded | B24-E | valid through 2027-09-09 (OD-219) |
| D24-37 | medium | no generator joined the maps, and no generator inventory | closed | B24-Fa | the regenerate-all command recorded, not built (OD-220) |
| D24-38 | medium | the hand-written current-system, permission and database pages were stale | closed | B24-Fa, B24-closeout (1/2) | closed since commit 2/2 re-read the register's row (`threat-model-closure-register.md` section 5); five lines left not noted, their sources calling them still true or unchanged |
| D24-39 | medium | no threat-model closure register existed | in part | B24-Fb | the register's row keeps "its states are re-read at the closeout"; commit 2/2 re-read D24-38 and the twelve open rows only (`threat-model-closure-register.md` sections 5, 6) |
| D24-40 | medium | the program's records would not support the final report | in part | B24-Fb, B24-closeout (1/2 and 2/2) | `app/page.tsx`'s eslint errors until `5dfae2b` merges, no CI eslint step before then, the corrective branches unmerged (OD-221); the integrity lines answered at commit 2/2 (`final-verdict.md` section 5.3) |
| D24-41 | medium | the benchmark corpus had no executor for CD-9 | closed offline | B24-D1 | the nightly run unrecorded |
| D24-42 | medium | a delete removes a whole wire that also joins surviving pins | open | - | the owner's decision (OD-229, proposed) |
| D24-43 | high | a strict-mode provider cannot call a read whose optional arguments it leaves unset | open | - | the owner's decision (OD-236, proposed) |

Counts: 26 closed offline, 8 closed, 4 closed as recorded, 3 in part (D24-29, D24-39, D24-40), 2 open (D24-42, D24-43).
**RECORDED** from the closure clauses (D24-38's `closed` from the register's re-read at commit 2/2, to which its closeout clause hands
it; D24-3's register state, closed in part, beside its row).

## 3. The UNKNOWN and INFERRED items of the discovery's section 8

| item | recorded as | state at `26dc8b8` |
|---|---|---|
| 1 | UNKNOWN: the hosting platform and staging topology | UNKNOWN (OD-190 applied in part: no platform assumed; LB-13) |
| 2 | UNKNOWN: whether the main Supabase project holds production data | UNKNOWN; OD-191 treats it as production, and no B24 run touched it |
| 3 | UNKNOWN: the Data API exposure and grants; the role production's `DATABASE_URL` names | UNKNOWN (LB-14) |
| 4 | UNKNOWN: the Supabase plan, PITR window and backup schedule | UNKNOWN (OD-194; LB-14) |
| 5 | UNKNOWN: whether the B11 evaluation suite passes | ANSWERED: B24-B2 ran it locally before admission (OD-204: with the rest of its 36 files, 431 passed and 15 skipped at `b0af256`) and prompt-to-gerber selects it; the lead's final run at `26dc8b8` exits 0 |
| 6 | INFERRED: `assist-live` refused before any model call; the kicad-cli oracle's first case cannot pass | ANSWERED offline: B24-B3 repaired both (D24-19); a live run still needs credits or KiCad (LB-2, LB-17) |
| 7 | UNKNOWN: whether kicad-cli is installed on this host | UNKNOWN (LB-17) |
| 8 | INFERRED: the flag-off chat path is not LLM-metered | ANSWERED by B24-A3: 0 LLM admissions on the flag-off chat path (OD-197's B24-A3b line) |
| 9 | INFERRED: Next.js sends `X-Powered-By` | ANSWERED offline by B24-A2: `poweredByHeader: false` (OD-196); the hosted edge LB-13 |
| 10 | INFERRED: the approval dialogs trap focus; the BOM dialogs do not | in part (B24-D3's dated line): CONFIRMED for the Tier 1 card in the browser; the BOM dialogs moved onto the shared dialog, their name, focus move, Escape and focus return CONFIRMED in jsdom; no other dialog's Tab trap measured |
| 11 | UNKNOWN: latency targets, the reference machine, the benchmark job's minutes | in part: OD-212 applied (regression against a runner baseline on `ubuntu-latest`); the owner's acceptance of the minutes, and so the first baseline, UNKNOWN |
| 12 | UNKNOWN: WCAG 2.2 AA, an axe devDependency, tablet layouts | UNKNOWN; OD-215's defaults applied (AA for its scope, no new dependency, desktop only) |
| 13 | UNKNOWN: whether the owner will supply credits, projects, credentials, a platform, a provider account, fabrication approval and equipment | UNKNOWN: none supplied at `26dc8b8` |
| 14 | RECORDED: B24's numbers start at OD-190 | RECORDED: OD-190..OD-241 spent, OD-189 reserved and unspent; LB-13..LB-17 rows |
| 15 | RECORDED: no AI co-author trailer; the runbook's identity rule | RECORDED: no commit of the program carries a co-author trailer (`open-risks-and-owner-decisions.md` section 4.3) |
| 16 | ANSWERED at `dfd51e3`: what B22 and B23 deliver | ANSWERED; the counts moved since by review (census 168 = 165 + 3 + 0; tools 48 / 37 / 9 / 28; 107 action records; 32 migrations) |
| 17 | UNKNOWN: whether the four corrective branches merge before the verdict; whether the reconstruction branch is in scope of `HISTORY FABRICATED OR BACKDATED` | ANSWERED: all five stay unmerged at the verdict; the history line is answered for main's history and the chapter's, the reconstruction branch named (OD-221's default; `final-verdict.md` section 5.3) |
| 18 | the open design questions, OD-190..OD-222 | each OD's state in section 1 |
| 19 | the live behaviour of every external resource | BLOCKED-LIVE-QUALIFICATION (LB-1, LB-2, LB-5, LB-7, LB-8, LB-9, LB-10..LB-17), recorded and never converted into a claim; LB-4 QUALIFIED on a non-isolated server only (2026-09-24) |

Two items the closeout adds, both INFERRED and not measured: who wrote the 67 files of the protected checkout modified since
2026-09-07 (other tools and the owner), and why pull requests #4-#7 hold commits dated up to 237 minutes after their merges (a clock
writing UTC time under a -0400 label) - `final-verdict.md` section 5.3. [B24-closeout review, 2026-10-11] And one UNKNOWN: whether
the 167 commits of the five pushed, unmerged branches hold a secret - [B24-closeout lead, 2026-10-11] since answered: the lead's scan of each (`origin/main..origin/<branch>`, 0 hits, exit 0; `final-verdict.md` section 5.3).

## 4. The owner decisions still required (as the final report lists them)

- **Proposed, for the owner to decide:** OD-229 (D24-42), OD-236 (D24-43), and B22's OD-159 (a human approval surface for
  process-backed computation).
- **Resources:** an isolated Supabase project and account (OD-6, OD-191); provider credits, an owner price table and a money cap (OD-7,
  OD-216); the hosting platform (OD-190, applied in part); distributor credentials (LB-15); an approved external MCP server (OD-48,
  OD-102); a qualified OCI platform (OD-134, OD-147); a manufacturing provider account (OD-160); approval of fabrication naming who
  inspects and tests (OD-218); benchmark-latency's Actions minutes (OD-212).
- **Open from earlier chapters** (first-table rows): OD-9, OD-10, OD-12, OD-15, OD-16 and OD-17.
- **In part, or time-bound:** OD-221 (an eslint step once `5dfae2b` merges; the four corrective branches unmerged); OD-192 (the
  application role, PROPOSED); OD-219 (renewing the jlcpcb-2l evidence before 2027-09-10).
- **Confirmation:** every other B24 decision applies its default and awaits the owner's confirmation (section 1).
