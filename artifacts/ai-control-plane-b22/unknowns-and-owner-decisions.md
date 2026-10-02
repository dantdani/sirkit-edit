# B22 - unknowns and owner decisions

Labels as in `README.md`: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED**, **RECORDED**,
**UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. State at HEAD `85439e7` (the B22 closeout (1/2)), read from
`artifacts/remaining-builder-program/OWNER_DECISIONS.md` (OD-134 onward, and the SEC-1 entries OD-151/OD-152),
`artifacts/ai-control-plane-b22/discovery.md` (section 4 with every closure clause, sections 6, 8, 9 and 10),
`artifacts/remaining-builder-program/LIVE_BLOCKERS.md` and the B22 pages. Drafted by the lead's read-only generator
(`scratchpad/b22/closeout/generate.py`) and corrected by hand against those records and the code at HEAD, with the verified records
audit (`scratchpad/b22/closeout-scope/records-audit.json`, at `a269e7a`) re-derived for what B22-D and the closeout (1/2) moved. The
generator's clause parser reads `Closed ... by <increment>` and a few "in part" phrases only, so its draft credited SEC-1 with part of
D22-2 and missed B22-A3's run-time digest check (recorded in OD-135's A3 entry, no clause under D22-2); counted D22-6 and D22-12 closed,
though part of each finding stays true with no clause closing it (execute's lowering manifest and content digests are still the
request's; the records still call the in-memory runs durable); credited D22-14 and D22-16 to B22-C and B22-B alone, missing the closeout
(1/2)'s halves; and stated neither D22-5's reopened remainder (OD-156) nor D22-20's live and OCI columns. It read one line of each
section-8 item. Its D22-4 in part stands, as the closeout (1/2)'s dated note on D22-4 in `deck-and-secret-corrections.md` (S28, pinned
by the tripwire) records it: the B22-A1 clause handed the shared deck validator to B22-A3, which built one runner, not one validator.
The tables below supersede the draft.

## Owner decisions (OD-134 to OD-159)

Every number from OD-134 to OD-159 is spent but one: OD-137 is drafted in `discovery.md` section 6 (with the lead's dated answer) and
has no heading in `OWNER_DECISIONS.md`, although discovery 9.4 asks for it to be recorded - named for the lead. OD-151 and OD-152 are
SEC-1's (recorded with the discovery commit); OD-153..OD-159 were reserved for B22's increments (the B22-A1 ledger entry); B23's
discovery starts at OD-160. Two numbers carry two headings each: OD-135 (B22-A2's contract and B22-A3's enforcement) and OD-150
(B22-A1's approval half and B22-C's evidence half). The B22-C entries (OD-138, OD-141..OD-144 and OD-150's evidence half) carry no
"Owner confirmation pending" line and no options; every other B22 entry is "applied, owner confirmation pending" but OD-159, a proposal.
"Open" names what the records leave with the owner.

| OD | title (as recorded) | state at the close of B22 | open for the owner |
|---|---|---|---|
| OD-134 | the isolation verdict and the production runner, as applied (B22-A2, 2026-10-01) | applied (A2): production simulation authority BLOCKED - `executeAuthoritativeSimulation` throws `CD10_AUTHORITATIVE_RUNNER_BLOCKED_NO_VALIDATED_SANDBOX`, the execute route's 501 text unchanged, no profile `validated` or authoritative-eligible, `ngspice-oci` defined and tested offline only (`b22-a2-blocked-runner`, 6 cases). Since B22-C a self-declared validated body is refused 409 before the 501 (OD-138; case 4's reviewed pin move), so the entry's sentence that such a body "still answers 501" is stale - named for the lead | **open**: supply an OCI engine (a repaired Docker Desktop with a recorded backend, or a Linux host or CI runner) and approve the opt-in B22-A4; production stays BLOCKED until B24-A names the production host |
| OD-135 | which ngspice build each profile pins, as applied (B22-A2, 2026-10-01); the same, as applied (B22-A3, 2026-10-01) | applied: the contract (A2: the `sirkit-install-tree-sha256/1` digest read only from `SIRKIT_NGSPICE_INSTALL_SHA256`, the root from `SIRKIT_NGSPICE_INSTALL_ROOT`) and its enforcement before every spawn (A3: mismatch, unpinned and unset refused closed; `NGSPICE_BIN` and PATH choose nothing; `b22-a3-diagnostic-runner` cases 2, 3, 4, 13) | **owner action**: pin the local install (`tsx scripts/print-install-tree-digest.ts <Spice64 folder>`, then both settings in `.env.local`); until then every local ngspice path fails closed (`/api/simulate` 503, the smoke test 422, a Studio run failed). Options: another build (re-pin) |
| OD-136 | the three legacy ngspice entry points, as applied (B22-A3, 2026-10-01) | applied: `/api/simulate`, the Studio worker (its run and its `-n -v` probe) and the smoke test call the one diagnostic runner and import no `child_process`; `APP_SPAWNERS` moved once (`b22-a3-single-spawner`, 4 cases) | confirmation only |
| OD-137 | Where the security and correctness corrections found here land (D22-3, D22-4, D22-5, D22-7, D22-8 output caps) - drafted in discovery section 6 | **not recorded as a heading**. As the discovery's dated answer and the ledger state it: the alternative for D22-3 and D22-5's ngspice half (SEC-1, a corrective branch from main, PR #12, `d0d2ec8`); the default for the rest - D22-4's remainder, kicad-cli's environment and D22-8's caps in B22-A1, D22-7 in B22-C - each with a pre-edit counterexample | confirmation (the lead records it) |
| OD-138 | the server's provider and environment, as applied (B22-C, 2026-10-02; review 2026-10-02) | applied: execute and readiness resolve the provider from the server's frozen set and the environment from the B22-A2 registry by id and digest; a differing body copy is refused 409 with one of four closed codes; execute still ends 409/501 (`b22-c-authority`, 8 cases). Recorded, not bound: readiness's other body-taken inputs; execute's lowering manifest and content digests stay the body's (D22-6 in part) | none recorded (no pending line) |
| OD-139 | the named computation catalog, as applied (B22-B, 2026-10-01; review 2026-10-02) | applied: exactly the runbook's five kinds under `sirkit.computation.*`, closed inputs, three process-free Tier 0 reads, two dormant propose-class requests, all MCP-withheld (reason `computation`), dormant for specialists; ratchets 42 -> 47, 33 -> 36, 9, 24 -> 27 | confirmation only |
| OD-140 | the bounded engine host and the experiment profile; F1, as applied (B22-B, 2026-10-01; review 2026-10-02) | applied: one `worker_threads` host, closed entry table, `env: {}`, `execArgv: []`, heap `resourceLimits`, `terminate()` at the budget and on abort, 2 workers per process and 1 per tenant, no queue, refused under any V8 heap-size flag; placement has no worker entry (`ENGINE_UNAVAILABLE`); the lead's note: one tenant's members wait for each other | **open**: other caps; a bounded fair queue; a share that admits a second slot while no other tenant runs; F1 on the host once placement has a worker entry |
| OD-141 | computation evidence persistence, as applied (B22-C, 2026-10-02; review 2026-10-02) | applied with its stated deviation: the silent `computation.evidence.v1` aggregate exists and every completed SPICE run carries its document (`not_recorded`, `EVIDENCE_STORE_UNBOUND`), but no route binds a repository; the unwired CD-10 tables not reused, no migration | **open**: binding the aggregate to a route (with it, server-held SPICE AI evidence and the classification relabel, D22-12); dropping the unwired CD-10 tables (an owner migration) |
| OD-142 | what a server-run simulation binds its input to, as applied (B22-C, 2026-10-02; review 2026-10-02) | applied: the server's SHA-256 of `{ scope, project, runPlanId, parts }`, labelled "bound to a submitted snapshot", never authority; OD-69 not reversed | none recorded |
| OD-143 | digests and the non-finite encoding, as applied (B22-C, 2026-10-02; review 2026-10-02) | applied (C), extended by B22-D (one validator for every raw reader; a repeated decisive header and an overflowing complex magnitude refused; the MSVC indeterminate non-finite) | none recorded |
| OD-144 | legacy wording, the UI half, as applied (B22-C, 2026-10-02) | the UI half applied (C: the fixed disclosure in the report and the studio; `/api/spice/reports` public with "caller-supplied records, not verified by Sirkit"); the records half applied by the closeout (1/2) (83 dated notes, the tripwire `b22-closeout-statements`; the discovery's D22-14 clause), with no amendment under this heading | none recorded |
| OD-145 | kill semantics and limits for the diagnostic runner on Windows, as applied (B22-A3, 2026-10-01) | applied for ngspice: `taskkill /PID <pid> /T /F` on win32, a process-group kill on POSIX, terminal only after `close` or as `kill_unconfirmed`; no job object, so no OS limit on CPU, memory, processes, file size or network (recorded); B22-D's recorded addition (a spawning construct prevented only by the deck screens). FreeRouting's and kicad-cli's direct-child kills, handed to "B22-B/D", were taken by neither (open, D22-9) | confirmation; FreeRouting and kicad-cli kill semantics are a later increment's |
| OD-146 | CI admission for B22 suites, as applied (B22-A1, 2026-10-01) | applied: `b22-` in `CHAPTERS`, one directory filter `app/lib/computation/__tests__` in prompt-to-gerber; every later B22 suite rode it (B22-D's addition); live suites opt-in, never in CI | options only: explicit per-suite entries |
| OD-147 | live-blocker rows, as applied (B22-A2, 2026-10-01) | applied: LB-10. Its state column still says "the execute route answers 501" - since B22-C no request reaches the 501 (an AI actor 403, a malformed body 400, every well-formed human request 409; the 501 text kept) - and its "Unblocks when" still names "B22-C to resolve profiles from the server registry at execute and readiness (OD-138)", done since B22-C - both named for the lead | confirmation |
| OD-148 | kicad-cli and FreeRouting in B22, as applied (B22-A1, 2026-10-01) | applied: kicad-cli's explicit allowlist and `windowsHide`; both runners' streams bounded; `.ses`, gerber and drill files read through a bounded reader; their diagnostic profiles (A2) exist, but no runner executes them. The allowlist's adequacy INFERRED (kicad-cli never run; the opt-in oracle never run) | options only: a narrower allowlist after a live oracle run; other bounds |
| OD-149 | model-generated scripts, as applied (B22-B, 2026-10-01) | applied: not allowed - no kind, schema or validator accepts code or a script | confirmation only |
| OD-150 | SPICE AI approvals, the approval half, as applied (B22-A1, 2026-10-01); SPICE AI approvals and evidence, the evidence half, as applied (B22-C, 2026-10-02) | applied in full: every deck-reaching operation and the run request "review", never pre-selected (A1, one table); every evidence reference built from `body.runs` labelled `caller-supplied` (C). Server-held resolution waits for D22-12's binding | options only: a measurement and a specification "review" too |
| OD-151 | SEC-1: the SPICE deck screen refuses a non-banner `*#` title, as applied (SEC-1, 2026-10-01) | applied: kept as fail-closed defence in depth, stricter than the ground (probes p11-p13: a `*#` title runs nothing); a project named `*#...` is refused | **open**: keep it, or drop it (restores main's behaviour; the probes support dropping) |
| OD-152 | SEC-1: the stated deviations from its task text, as applied (SEC-1, 2026-10-01) | applied: a TAB passes single-line fields; a form feed and non-line-break controls pass in model text; the dotted-directive refusal kept | options only: refuse a TAB or the other controls; drop the dotted-directive refusal |
| OD-153 | B22-A1: the stated additions to its task text, as applied (B22-A1, 2026-10-01) | applied, fail-closed: a one-token `.lib` line (whether ngspice-46 reads its token as a file is UNKNOWN), a non-plain path, an XSPICE file parameter in the executed deck, `d_process`/`d_cosim`/`process_file` on any card (the lead's note: a net so named is refused), a leading `+` line; non-ASCII continuations joined as ngspice joins them (probes p14-p15) | confirmation; the costs named (a quoted vendor file name with a space; a value spelled `file` at a card's end; a net named `d_process`) |
| OD-154 | B22-A2: stated choices beyond its task text, as applied (B22-A2, 2026-10-01) | applied: `legacySpawn`, `readBackBytes`, `waveformPoints`; the OCI flag vector (1024m, pids 64, `--cpus 1`, `--ulimit cpu=120:120`, tmpfs, user 65534) designed, unqualified; the closed docker-argv grammar; `hostClient`; bigint stat. The OCI run argv carries no `-n` (`runtime-profile.ts:403`; the local profile's does) - B22-A4's to decide with the output transport | confirmation; B22-A4's choices |
| OD-155 | the diagnostic runner's cap: shared by tenant, every wait bounded, as applied (B22-A3, 2026-10-01) | applied: 4 running and 64 waiting per server process, a tenant at most 3 running and 32 waiting, an interactive request (`/api/simulate`, the smoke test) taking a free slot past its tenant's share (the A3 lead); every wait bounded. The A3 lead's low (one tenant can exceed its 32-entry queue share with several plans; the job store has no per-scope limit) was recorded "for B22-C" and taken by no increment - open | options: other shares; tenant plus caller kind as the holder; a per-scope plan limit in the job store |
| OD-156 | the win32 child environment: Node's eight additions recorded, not removed, as applied (B22-A3, 2026-10-01) | applied: HOMEDRIVE, HOMEPATH, LOGONSERVER, SYSTEMDRIVE, USERDOMAIN, USERNAME, USERPROFILE and WINDIR reach the child (CONFIRMED by the review's probe and the lead's live case 5), named on every record (`hostAddedEnvironment`); `-n` is the single layer against a home `.spiceinit` | options: a profile revision giving all eleven an explicit neutral value (an A2 validator change plus the lead's probes) |
| OD-157 | B22-A3: stated choices beyond its task text, as applied (B22-A3, 2026-10-01) | applied; the closeout (1/2) lead's dated addition: the early 422 at `POST /api/spice/runs` for a deck that sets its own seed was not added (such a plan fails each point at the runner, closed, nothing run) | confirmation |
| OD-158 | B22-B: the opt-in and its other stated choices, as applied (B22-B, 2026-10-01; review 2026-10-02) | applied: the chat port bound only with `SIRKIT_NAMED_COMPUTATIONS=1` (off by default) on a server with no V8 heap-size flag (under `next dev` also `NEXT_DISABLE_MEM_OVERRIDE=1`), because how `next build` serves `engine-worker.mjs` is UNKNOWN; no queue; no ninth specialist claim | **open**: enable by default after a `next build` qualification; the ninth claim (a reviewed B21 pin move); a queue |
| OD-159 | a human approval surface for process-backed computation requests (proposed, B22-B, 2026-10-01) | **PROPOSED**: an authenticated route (a reviewed census move 165 -> 166+, CSRF; approvers `pcb_editor`, `reviewer` or `project_admin` in scope, approving the exact digest) persisting with the evidence aggregate; until then `circuit-analysis` and `layout-experiment` stay dormant and the request store is an in-memory contract | **owner decision needed** |

Reserved and unspent: **OD-83, OD-84, OD-85, OD-86, OD-88** (the MCP proposal reversal). B22-B copied its design verbatim into
`mcp-proposal-reversal-design.md` (lines 786-923 of the lead's `scratchpad/b20/task-B4.md`; body SHA-256 pinned by `b22-b-catalog`
case 6) and did NOT perform the reversal: MCP stays read-only (D22-22).

Additions recorded inside existing headings: B22-D in OD-143, OD-145 and OD-146; the B22-A1 lead in OD-153; the B22-A3 lead in OD-155
and OD-156; the B22-B lead and review in OD-140 and OD-158; the closeout (1/2) lead in OD-157.

## Discovery defects D22-1..24

Severity as the defect states it. "Closed" means every clause of the defect is closed; a RECORDED residual its clauses name is listed
beside it. "Closed in part" means a clause leaves part of the defect open, or part of its finding stays true with no clause closing it
(each named). "Recorded" means the defect is written down and cannot be closed on this host or by B22.

| defect | severity | title | state | by | live |
|---|---|---|---|---|---|
| D22-1 | high | No measurable isolation boundary exists, and none can be qualified on this host today. | **RECORDED** (OD-134, LB-10): every process runs as a plain host child with no OS limit; the lead's 2026-10-01T09:20:48Z probe reached no Docker engine and found the WSL distros Stopped; no production host named (B24-A); the stub and the 501 pinned (`b22-a2-blocked-runner`). Not closable on this host | A2 | BLOCKED-LIVE |
| D22-2 | high | No immutable runtime profile binds any executable. | **closed in part**: the contract and registry by A2 (`runtime-profile.ts`, every runbook `:892-904` item); the ngspice digest check before every spawn by A3 (OD-135's A3 entry; `b22-a3-diagnostic-runner` cases 2, 3, 4, 13 - the discovery has no A3 clause under D22-2, named for the lead). Open: kicad-cli and FreeRouting have profiles but no runner checks their digests; the `ngspice-oci` image and the host docker CLI unpinned (B22-A4, LB-10) | A2, A3 | BLOCKED-LIVE (OCI) |
| D22-3 | high | The SPICE Studio deck path admits caller and model text as live deck lines; a second `.control` block with `shell` is probably reachable. | closed (SEC-1, `d0d2ec8`): every compiler field screened as one line, the final deck screen cut to ngspice-46's probed executing set (p0-p13), a hostile plan answered 422 before any job; RECORDED: end-to-end exploitation through a real ngspice INFERRED, never run with a hostile deck | SEC-1 |  |
| D22-4 | medium | The model screen lets file reads outside the run directory through, and screens different text from what it emits. | **closed in part** (A1, C; as the closeout (1/2)'s dated S28 note on D22-4 in `deck-and-secret-corrections.md` records it): `emittedModelText` for the deck, the screen and the smoke deck; `.lib`, non-plain includes, any include, a hiding blank `transformedContent`, XSPICE file parameters and `d_process`/`d_cosim` refused over joined cards; the returned channels bounded; the manifest-checksum remainder closed by C (`manifest.ts:35` hashes `emittedModelText`); `-n` on every run, so ngspice skips a `.spiceinit` and an osdi load in one (A3; its effect INFERRED until a live run). Open: one shared deck validator across `/api/simulate` and the Studio path (the B22-A1 clause handed it to B22-A3, which built one runner, not one validator - `/api/simulate` and the Studio keep their own screens); a count bound on a record's event list (`job.record.events.push`, `job-store.ts:101`); the XSPICE card and token readings INFERRED, with no live case in either live suite. RECORDED: a bounded channel still carries what a process prints, and the diagnostic excerpts keep their own bounds; the compile preview keeps `.include`/`.lib` and XSPICE text (by design, never executed) | A1, C, A3 |  |
| D22-5 | high | Three spawns inherit the full server environment; the others still pass HOME and USERPROFILE. | **closed in part**: the ngspice allowlist (SEC-1), kicad-cli's allowlist (A1), the profile's exact map and `-n` (A3) - no spawn inherits the whole server environment. Reopened (OD-156): on win32 Node adds eight server variables to the ngspice child, USERPROFILE among them (CONFIRMED live, case 5); kicad-cli's and FreeRouting's host allowlists still pass HOME, USERPROFILE and APPDATA (their contract profiles drop them; no runner executes those profiles) | SEC-1, A1, A3 |  |
| D22-6 | high | The CD-10 execute and readiness routes trust a provider, environment and lowering manifest taken from the request body. | **closed in part** (C, OD-138): provider and environment are the server's copies by id and digest, a differing copy refused 409 with a closed code (`b22-c-authority`). Open: execute still takes its lowering manifest and content digests from the body (`manifest: body.manifest as unknown as NetlistLoweringManifest`; `authorizeSimulationExecution` checks the body's structural results and include digests against the body's own `availableContentDigests`) - the defect's title names the manifest and no clause closes that half; latent behind the 409, since no server provider or profile is validated (`b22-c-authority` case 2). RECORDED: readiness's other body-taken inputs (the clause's list); the CD-11 handoff always blocked | C |  |
| D22-7 | high | The SPICE Studio job store very probably drops every completed run's results. | closed (C): the result and its evidence attached before the terminal status (`b22-c-job-store-terminal`, 10 cases); both counterexamples CONFIRMED at the fake seam only. RECORDED: the Studio record is still marked cancelled at the request (B16.0.23 §E/§F) | C |  |
| D22-8 | medium | Output and temporary files are not bounded or isolated. | **closed in part**: A1's caps (kicad-cli, FreeRouting, the bounded reader); A3's runner half (per-run `mkdtemp` directories removed in the runner's finally and, after a `kill_unconfirmed`, again once the child's close is observed - a child that never closes can keep its directory and its slot; opaque `diagrun_` ids, redaction, the bounded raw read-back); D's G2/G3 (a raw file that is a link and a planted runner root refused). Open: no OS file-size limit on any spawn; FreeRouting's shared `tmpdir()` cwd; a link a server-user process plants before the spawn redirects ngspice's write (live case 4) | A1, A3, D | live case 4 NOT CONTAINED |
| D22-9 | medium | Kill is direct-child only, cancellation is reported before the process exits, and concurrency is unbounded across batches. | **closed in part**: the ngspice half by A3 (tree kill, terminal only after `close` or `kill_unconfirmed`, one cap shared by tenant; OD-145, OD-155; live cases 1, 2, 13 and 14 passed, the lead's run). Open: FreeRouting and kicad-cli still kill the direct child and resolve before its exit (neither B22-B nor B22-D took them); the Studio record is still marked cancelled at the request; the reach of `taskkill /T` to a descendant INFERRED; no OS process cap | A3 |  |
| D22-10 | medium | The live raw parsers lose values silently and disagree with each other. | closed (C, extended by D's G4/G5): one whole-output validator for every raw reader, eight closed codes; live: ngspice-46 writes `inf` and `-nan(ind)` and every parser refused them; real operating-point, transient and AC files read the same through every parser. RECORDED: ngspice's vector type list INFERRED from its source; whether ngspice repeats a time point UNKNOWN | C, D |  |
| D22-11 | medium | Locale, timezone, randomness and thread count are uncontrolled. | closed for ngspice (A2 contract, A3 runtime): `LC_ALL=C`, `TZ=UTC`, `.options seed=1` before every run deck's `.end`, a deck's own seed refused, threads pinned by the install digest, every result `environment_dependent`. RECORDED: the Windows C runtime's locale INFERRED (live case 10: the raw file's digest identical under a decimal-comma server locale); kicad-cli and FreeRouting control none of these | A2, A3 |  |
| D22-12 | medium | No server-held, durable, digest-bound simulation evidence exists, and the records call the in-memory runs durable. | **closed in part** (C): the silent digest-bound aggregate exists and every completed run carries its document. Open: no route binds a repository, so nothing is server-held (OD-141's deviation); the classification still calls `/api/spice/runs*` `project-durable` (`route-resource-classification.ts:57-61`) and the action registry "durable run records" (`action-registry.ts:156`) - relabelling moves the byte-pinned B16.0.2 CSV | C |  |
| D22-13 | medium | Evidence identities are not collision-resistant, and non-finite numbers have no durable encoding. | closed (C, OD-143): SHA-256 over an explicit encoding with closed non-finite states; CD-10's FNV digests and the client-asserted `schematicHash` stay identity keys, never evidence | C |  |
| D22-14 | medium | Records and UI call diagnostic subprocess output a sandbox, authoritative or a qualification. | closed: the UI half by C (the fixed disclosure, `b22-c-wording`); the records half by the closeout (1/2) (83 dated notes in place; the tripwire `b22-closeout-statements`, 9 cases) | C, closeout (1/2) |  |
| D22-15 | medium | No named computation exists, and the registry has no vocabulary for one. | closed (B, OD-139): the five-kind catalog and the vocabulary. RECORDED: off in production chat until the owner opts in (OD-158); the two process-backed kinds dormant (OD-159); placement has no worker entry | B |  |
| D22-16 | low | Every B22 tool or runner must move pins that are lexical or exact, and three of their titles are stale. | closed: the pin moves by B (each reviewed, no gate regex widened); 20 stale titles in 15 suites retitled by the closeout (1/2), assertions and `it(` counts unchanged | B, closeout (1/2) |  |
| D22-17 | medium | In-process engines cannot be stopped at their budget. | **closed in part** (B, OD-140): the bounded engine host stops what it runs at the budget (`b22-b-bounded-host`, real worker threads). Open: the placement engine has no worker entry, so B20's F1 (the anonymous placement preview blocking the event loop) stays open, as do OD-87's second and third paths | B |  |
| D22-18 | medium | The census of which routes run external processes is wrong for three routes and has no connective test. | closed (A2): the connective census, three rows corrected, the four `/api/spice/runs/[id]*` exemptions reviewed | A2 |  |
| D22-19 | medium | CD-10 authority has no execution or import path and no evidence corpus; the live decks are not CD-10 decks. | **closed in part** (C): an independent CD-10 deck validator exists but no CD-10 path calls it (`lowerNetlistIr` has no production caller). Open: the authoritative corpus, golden outputs and a CD-10 execution path (blocked by D22-1) | C | BLOCKED-LIVE |
| D22-20 | medium | No adversarial test touches a real or sandboxed process. | closed (D): every runbook `:938` class prevented offline at the fake seams (`b22-d-adversarial`, five guards added test-first); the live column run once by the lead on the diagnostic runner (12 of 13; class 4 NOT CONTAINED, a recorded residual); the OCI column BLOCKED-LIVE-QUALIFICATION under LB-10 | D | O column BLOCKED-LIVE; L run once |
| D22-21 | medium | The SPICE AI cites browser-supplied run records as evidence. | closed (C) as "labelled caller-supplied" (OD-150's evidence half); server-held resolution waits for D22-12's binding | C |  |
| D22-22 | low | The design the reserved OD-83..86/88 numbers wait for is not in the repository. | **RECORDED** (B): the design copied verbatim and hash-pinned; the reversal not performed; OD-83..86/88 unspent | B |  |
| D22-23 | low | No live-blocker row names the blocked simulation runner or an isolation platform. | closed (A2, OD-147): LB-10 (its state column's "the execute route answers 501" and its unblock text stale since B22-C, both named for the lead) | A2 | BLOCKED-LIVE |
| D22-24 | low | CI admits no B22 suite. | closed (A1, OD-146): `b22-` in `CHAPTERS` and one directory filter; every later B22 suite rides it | A1 |  |

Counts: 24 defects - 13 closed (D22-3, -7, -10, -11, -13, -14, -15, -16, -18, -20, -21, -23, -24; each with the RECORDED residuals its
row names), 9 closed in part (D22-2, -4, -5, -6, -8, -9, -12, -17, -19), 2 RECORDED (D22-1, D22-22), none wholly open. The generator's
draft counted 15 / 7 / 2, with D22-4 in part as here but D22-6 and D22-12 closed (see the opening paragraph); this table supersedes it.

## Unknowns and blocked items named by the discovery (section 8)

1. **UNKNOWN** - whether the Docker Desktop engine can start on this host, and with which backend: still UNKNOWN. The lead's
   2026-10-01T09:20:48Z probe reached no engine (RECORDED, `isolation-verdict.md` section 3); starting it was never tried (OD-134).
2. **UNKNOWN** - the production host: still undeclared; B24-A decides. Production authority stays BLOCKED whatever the answer.
3. **INFERRED** - the local ngspice is release 46: still INFERRED for the release number (the folder name and the bundled manual). Its
   identity is now pinned: the lead's live runs used the install digest `c6e4e160...61ab1` (778 files, 49,046,261 bytes;
   `scripts/print-install-tree-digest.ts`), and the opt-in `b22-a3-runner-live` case 2 printed a version line naming ngspice under the
   runner (5 of 5, 2026-10-01); the line itself is not quoted in any committed record.
4. **UNKNOWN** - ngspice behaviour the manual would settle: answered in part by the lead's probes and live runs - `-n` is honoured by
   ngspice-46 (p23, CONFIRMED); its non-finite spellings are `inf` and `-nan(ind)` (B22-D live case 9, CONFIRMED); batch mode with a
   transient and no output line simulates nothing (p27); the default seed stays UNKNOWN (moot: every run deck carries `.options seed=1`,
   p24); batch exit codes on parse and convergence failures, `strict_errorhandling` placement and a `.endc` with trailing tokens stay
   UNKNOWN.
5. **UNKNOWN** - whether the D22-3 deck executes `shell` under `ngspice_con -b`: answered in part (SEC-1 page section 1b: a `.control`
   block, a `*#` line and an `*ng_script` deck execute ngspice's own `echo`); no `shell` and no hostile deck was ever run, so end-to-end
   exploitation stays INFERRED; D22-3's closure does not depend on it.
6. **UNKNOWN** - a Windows job object from Node without a native dependency: not resolved by reading; moot under OD-145's default - no
   native dependency was added, so there is no job object and no OS memory or process cap on Windows (recorded, never claimed).
7. **Resolved** by B22-B: the Node `worker_threads` termination and `resourceLimits` pages were read and dated 2026-10-01
   (`named-computations.md` section 4; D22-17's clause).
8. **Resolved**: `task-B4.md` section 8 is in the lead's `scratchpad/b20/`; B22-B copied lines 786-923 verbatim into
   `mcp-proposal-reversal-design.md` (re-verified byte-identical 2026-10-02).
9. **INFERRED** - GitHub-hosted `ubuntu-latest` runners provide Docker and allow installing `runsc`: unchanged; it resolves only if
   OD-134's alternative is taken.
10. **RECORDED** - `.wslconfig` places `autoMemoryReclaim` under `[wsl2]`: unchanged; it matters only if WSL 2 Docker becomes the
    qualification platform.
11. **RECORDED** - the co-author trailer: every B22 commit is authored by Dandi Desta with no AI trailer (`git log d0d2ec8..HEAD`:
    8 commits, 0 `Co-Authored-By` lines).
12. The open design questions carried to the owner table: every OD above, with its state.
13. **BLOCKED-LIVE-QUALIFICATION** - the live behaviour of any OCI boundary (all 16 classes' O column, LB-10) and of real FreeRouting or
    kicad-cli under a profile (LB-3, LB-8): recorded, never converted into a claim. Real ngspice under the adversarial cases is no longer
    wholly blocked: the lead ran the diagnostic runner's live column once (12 of 13; class 4 NOT CONTAINED).

Other UNKNOWN / BLOCKED items the increments recorded:

- **UNKNOWN** - whether a real ngspice-46 transient's last point lands exactly on `time`, which the circuit-analysis strict reader
  checks (`named-computations.md` section 5). [B22 lead] The vector names it reads are no longer UNKNOWN: the lead's live run printed
  them lower-cased - `v(out)`, `i(v1)` (`adversarial-matrix.md` section 10, case 16).
- **UNKNOWN** - how `next build` serves `engine-worker.mjs` (OD-158; the opt-in is off by default for it); no `next build` was run in
  B22. B22-C's client-bundle fix is pinned offline by a static client-graph gate (`b22-c-authority` case 8), and CI's page-browser-e2e
  job compiled the editor green on every B22 commit (section 3 of `test-and-validation-report.md`).
- **UNKNOWN** - the `ngspice-oci` output transport and the host docker CLI's context, configuration and proxy variables (B22-A4); the
  OCI run argv's missing `-n` (OD-154).
- **UNKNOWN** - the vector names and attributes ngspice-46 writes (whether ` grid=` appears; how `i(v1)` is spelled): the live case 16
  printed them but no committed record quotes them; whether ngspice repeats a time point.
- **INFERRED** - the adequacy of kicad-cli's B22-A1 allowlist (kicad-cli never run here; the opt-in kicad-cli oracle never run;
  `deck-and-secret-corrections.md`, D22-5).
- **UNKNOWN** - the adequacy of kicad-cli's and FreeRouting's contract environments (`runtime-profiles.md`, `threat-model.md`; never
  run; OD-154), and kicad-cli's version (`runtime-profiles.md`, the kicad-cli profile: "KiCad 8.x or newer" per `.env.example`;
  kicad-cli was never run here).
- **INFERRED** or **UNKNOWN** - the model screen's and the final deck screen's readings of ngspice-46 (`deck-and-secret-corrections.md`,
  D22-4's recorded list; no hostile model was ever run): the XSPICE card and token readings, that ngspice reads any `.inc`-prefixed line
  as an include, how it stitches continuation lines, that an XSPICE model reads its file at instance set-up, and that `d_process`'s
  spawn and `d_cosim`'s library load search beyond the run directory; no live case in either live suite (found by the closeout (1/2)).
- **UNKNOWN** - whether numparam can substitute a string into a bare `file=name` value (`deck-and-secret-corrections.md`, D22-4's
  recorded list; a `{...}` value is refused, fail-closed).
- **UNKNOWN** - whether ngspice-46 reads a one-token `.lib` line's token as a file (`deck-and-secret-corrections.md`, B22-A1's stated
  additions, and OD-153; such a line is refused, fail-closed, and no executed deck has accepted any `.lib` line since SEC-1).
- **UNKNOWN** - the OCI image's own values: its digest and the thread count it pins (`runtime-profiles.md`, the `ngspice-oci` profile;
  no image exists until B22-A4), and which user-profile keys the docker CLI needs on Windows (B22-A4).
- **INFERRED** - the reach of `taskkill /T` to a real descendant (no benign deck starts one; live case 2 checks the known pids only).
- **INFERRED** - the Windows C runtime's locale under `LC_ALL=C` (live case 10 measured only the server-environment half).
- **BLOCKED-LIVE-QUALIFICATION** - the OCI column of every adversarial class, under LB-10.

## Live blockers

| LB | check | classification | B22's relation |
|---|---|---|---|
| LB-1 | Production Supabase authentication browser E2E | BLOCKED-LIVE-QUALIFICATION | unchanged |
| LB-2 | Real LLM provider turn (OpenAI / Anthropic) | UNKNOWN | unchanged; B22 called no provider (every suite offline; the browser runs under the fixture runtime) |
| LB-3 | Live routing in CI | local-only | unchanged; its "a container profile (B22)" is not met - B22 delivered only `freerouting-local-diagnostic`, a diagnostic profile with no OS limit that no runner executes (OD-148: the containers belong to LB-3/LB-10) |
| LB-4 | Database-backed tests | dead external resource | unchanged; the evidence aggregate has no route binding and no migration (OD-141) |
| LB-5 | Physical fabrication | not attempted | unchanged |
| LB-6 | Local container PostgreSQL | BLOCKED-LIVE-QUALIFICATION | unchanged; the lead's 2026-10-01 probe again reached no Docker engine |
| LB-7 | A real model's chat execution | BLOCKED-LIVE-QUALIFICATION | unchanged |
| LB-8 | A routed board in a browser journey | BLOCKED-LIVE-QUALIFICATION | unchanged |
| LB-9 | Real specialist disagreement / provider fallback / quota failure with live models | BLOCKED-LIVE-QUALIFICATION | unchanged; the computation reads are dormant for specialists (OD-139) |
| LB-10 | Authoritative sandboxed simulation on a qualified OCI platform | BLOCKED-LIVE-QUALIFICATION | **added by B22-A2 (OD-147)**; every OCI column of the adversarial matrix is recorded under it. Its state column still says "the execute route answers 501" - since B22-C no request reaches the 501 (an AI actor 403, a malformed body 400, every well-formed human request 409, `b22-a2-blocked-runner` cases 3-5 and `b22-c-authority` case 2; the 501 text kept). Its "Unblocks when" still names B22-C's registry binding, done since `a269e7a` (D22-6 in part) - what remains is the OCI engine, B22-A4 (image and CLI pins, output transport, qualification evidence), B24-A's production host and D22-19's corpus and wired deck validator (both named for the lead) |

## Owner questions open at the close of B22 (one list)

The two pinning settings first: `SIRKIT_NGSPICE_INSTALL_ROOT` and `SIRKIT_NGSPICE_INSTALL_SHA256` (OD-135) - until the owner sets them
in `.env.local`, every local simulation path fails closed. Then: OD-134 (an OCI engine and B22-A4; B24-A's production host), OD-159 (a
human approval route for the process-backed computations - an owner decision), OD-158 (enabling the named computations by default after
a `next build` qualification), OD-141 (binding the evidence aggregate to a route; dropping the unwired CD-10 tables), OD-140 (the engine
host's caps and a queue; F1), OD-155 (the runner's shares; the job store's per-scope plan limit), OD-156 (neutral values for Node's
eight win32 variables), OD-151 (keep or drop the `*#`-title refusal). Every other OD carries only "the owner may choose otherwise"
options or a confirmation.
