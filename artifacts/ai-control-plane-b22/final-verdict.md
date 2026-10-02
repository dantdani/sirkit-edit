# B22 - final verdict (2026-10-02)

**Verdict: PARTIAL.** The production simulation runner remains BLOCKED: no measurable isolation boundary can be qualified on any
platform the program controls (the Docker engine on this host is unreachable, the WSL distros are stopped, and no production host is
named - LB-10), so `executeAuthoritativeSimulation` still throws (`b22-a2-blocked-runner` case 1) and the CD-10 execute route keeps its
501 text byte for byte (case 3; `b22-c-authority` case 3), but no request reaches that line: an AI actor is refused 403 and a malformed
body 400 before any authorization, and since B22-C an authenticated human request with a well-formed body is refused 409 - a body copy
of a provider or environment with a closed code (OD-138; a self-declared validated body is `b22-a2-blocked-runner` case 4, a
reviewed pin move in B22-C), and the server's own copies because neither a server provider nor a server profile is validated
(`b22-c-authority` case 2). What B22 delivers instead is a diagnostic-only local runner that is never called a sandbox or authoritative,
a closed catalog of named computations with no generic execution, simulation results bound as diagnostic evidence, and an adversarial
matrix over every runbook `:938` class. It is PARTIAL because the runbook's first pass clause - "Approved named computations execute
within a measurable isolation boundary" - is not met (the runner enforces its limits itself; the OS enforces none on Windows), and the
runbook's own alternative for that case is taken: "If production isolation cannot be proven, the production runner remains blocked and
the verdict must say so" (`:942`).

SANDBOX STATUS: production runner BLOCKED (no qualified isolation boundary; production host undetermined, B24-A; LB-10, OD-134). Named
computations and diagnostic simulation run diagnostic-only on local runners whose limits are enforced by the runner, not the OS.
Diagnostic simulation (`/api/simulate`, the Studio worker, the smoke test; and B22-B's process-backed circuit analysis, dormant until a
human approval route exists, OD-159) runs on the diagnostic-only local ngspice runner: the pinned install digest, cached behind a
stat fingerprint of the install tree that is re-taken before every spawn (any difference re-hashes; its recorded limits - a rewrite in
place that restores size, times and file id, and the check-to-spawn window - are in `diagnostic-runner.md`), `-n`, the profile's exact
environment map (on win32 Node adds eight server variables, OD-156), a per-run directory removed in the runner's finally and, after a
`kill_unconfirmed`, again once the child's close is observed (a child that never closes can keep its directory and its slot), stdout and
stderr bounded at 64 KiB each, the raw read-back bounded at 100 MiB for a Studio run and the circuit analysis and at 20,000,000 bytes
for `/api/simulate` (the smoke test reads none), a Studio run failed over 5,000,000 waveform points (the profile's `waveformPoints`, the
worker's bound), the wall clock (120 s for a Studio run point; 10 s for `/api/simulate`, the smoke test and the dormant circuit analysis's budget) with a tree kill, a global cap of four shared by
tenant. The three process-free named computations (opt-in, OD-158: `SIRKIT_NAMED_COMPUTATIONS=1` on a server process with no
V8 heap-size flag) run on the worker-thread engine host: its budget with a hard terminate, V8 heap limits, an empty environment, two
workers, one per tenant. No OS limit on CPU, memory, processes, file size or network.

Labels as in `README.md`: **CONFIRMED** (executed and measured), **INFERRED**, **PROPOSED**, **RECORDED**, **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION**.

## The runbook's pass criteria (`:942`), clause by clause

- "Approved named computations execute within a measurable isolation boundary" - **NOT MET.** No OS or container boundary exists on this
  host (`isolation-verdict.md`); the `ngspice-oci` profile is defined and validated offline only, unqualified (LB-10).
- "and import only validated artifacts" - **MET offline** (CONFIRMED by suites): one output validator refuses bad output whole for every
  raw reader (B22-C, B22-D G4/G5); named-computation inputs are closed schemas with no argv, path, URL, deck or code field, and their
  outputs pass typed validators that refuse whole (B22-B).
- "If production isolation cannot be proven, the production runner remains blocked and the verdict must say so" - **MET**: the stub
  still throws (`b22-a2-blocked-runner` case 1), and the 501 text and its source pins are unchanged (case 3; `b22-c-authority` case 3);
  the one behavioural pin that reached the 501, `b22-a2-blocked-runner` case 4, moved to 409 by a reviewed pin move in B22-C (OD-138;
  its title records the move); [B22 lead] with the real authorization no request reaches the 501 line, while
  `b16-0-20-tranche-parity` still reaches it with the authorization mocked to authoritative (its 501 assertion unchanged); this verdict
  says so.

## What B22 delivers (CONFIRMED by suites on the tree unless labelled)

1. **SEC-1 (PR #12) and B22-A1, the security corrections.** Every Studio deck field screened as one line and a final deck screen cut to
   what ngspice-46 executes (the lead's benign probes p0-p13; the card reader's non-ASCII continuations p14-p22); the model screen reads
   the emitted text, refuses host-path includes and XSPICE file parameters over joined cards; kicad-cli's explicit environment; output
   caps for kicad-cli and FreeRouting; SPICE AI changes that reach a deck need human review (`sec-1-spice-deck-injection.md`,
   `deck-and-secret-corrections.md`).
2. **B22-A2, the threat model, immutable runtime profiles and the isolation verdict.** A closed, deep-frozen profile contract with an
   install-tree digest from a server setting, exact environments and every limit's enforcer stated; a connective process census (three
   classification rows corrected); LB-10 (`threat-model.md`, `runtime-profiles.md`, `isolation-verdict.md`).
3. **B22-A3, the diagnostic-only local runner.** One ngspice spawner for `/api/simulate`, the Studio worker and the smoke test, executing
   the profile (CONFIRMED live once on the pinned install: 5 of 5; the lead's probes p23-p27 and p29 behind its `-n`, seed, environment
   and batch-deck choices) (`diagnostic-runner.md`).
4. **B22-B, named computations.** The runbook's five kinds in a closed catalog; three process-free reads behind an opt-in
   (`SIRKIT_NAMED_COMPUTATIONS=1` on a server process with no V8 heap-size flag - under `next dev` also `NEXT_DISABLE_MEM_OVERRIDE=1`,
   since `next dev` sets one; OD-158), two process-backed requests inert until a human approval route exists (OD-159); a worker-thread
   engine host with a hard stop at the budget; the reserved OD-83..86/88 design recorded, the reversal NOT performed
   (`named-computations.md`, `mcp-proposal-reversal-design.md`).
5. **B22-C, simulation authority.** CD-10 execute and readiness bound to the server's providers and profiles (a body copy refused 409);
   the job store attaches results and evidence before the terminal status; the evidence aggregate with an explicit non-finite encoding
   (not yet bound to a route, OD-141); the disclosure; SPICE AI evidence labelled caller-supplied (`simulation-authority.md`).
6. **B22-D, the adversarial matrix.** All 16 classes prevented offline (five guards added test-first); the live column run once by the
   lead (12 of 13 - case 4 NOT CONTAINED, below); the OCI column BLOCKED-LIVE-QUALIFICATION (`adversarial-matrix.md`).
7. **The closeout (1/2).** The sandbox, authority, network, PATH and count statements superseded in place (83 dated notes), 20 stale
   titles retitled with assertions unchanged, 26 exports with no production caller recorded and 4 retired, pinned by the tripwire
   `b22-closeout-statements` (`closeout-statements.md`).

The chapter's commits are listed in `changed-files.md` (192 paths across 8 first-parent commits since `main` d0d2ec8); its suites and
gates in `test-and-validation-report.md`; its decisions and open items in `unknowns-and-owner-decisions.md`. The 165-route ratchet is
unchanged at 162 canonical + 3 factories + 0 raw.

**Totals on the tree:** 28 B22 suites and SEC-1's, 291 `it(` blocks (typed `it.each<...>(` tables counted) and 586 tests in a run (568
offline, all passing; the two opt-in live suites' 18 skipped). The final validation run at HEAD `85439e7` is green
(`test-and-validation-report.md` section 2: eleven vitest gates, 6,719 passed and 34 opt-in skipped - gate J's
`autoroute-boundary-integrity` ran the real bundled FreeRouting twice, recorded there; tsc 0; eslint clean on the 130 files B22 changed,
121 TypeScript and 9 .mjs; 20 generators with zero drift; the existing browser suite 48 of 48 in 256 s and the orchestration config 4 of
4 in 151 s, 407 s of OD-30's 30 minutes). CI ran green on every B22 commit (section 3).

## What B22 does not deliver, stated plainly

- **No isolation boundary and no OCI qualification** (LB-10): the `ngspice-oci` profile is unqualified; its output transport and the
  docker CLI's context are UNKNOWN until an owner-supplied engine (B22-A4).
- **No OS limits on Windows** (OD-145): CPU, memory, process count, file size and network are not enforced by the OS; the deck screens are
  the only prevention of a spawning construct.
- **A planted hardlink redirects ngspice's write** (live case 4, NOT CONTAINED): the runner refuses to read it, but a process already
  running as the server's user could plant one in a run directory before the spawn - outside the threat model's adversaries, recorded.
- **Node's win32 additions** (OD-156): USERPROFILE and seven other variables reach the child (CONFIRMED live), recorded per run; `-n` keeps a
  home `.spiceinit` from running.
- **The evidence store is not bound to a route** (OD-141), so nothing resolves as server-held evidence yet, and the classification and
  the action registry still call the in-memory SPICE runs durable (D22-12, open); the process-backed computation requests stay dormant
  (OD-159); the placement engine has no worker entry (F1 open).
- **FreeRouting and kicad-cli** still use direct-child kills and settle before exit (D22-9's other half), keep host environment
  allowlists with HOME, USERPROFILE and APPDATA, and have profiles no runner executes or digest-checks (D22-2, D22-5); FreeRouting still
  runs in the shared temporary directory (D22-8); the fab archive reader inflates each entry before its total check.
- **CD-10 has no execution path** (D22-19 in part): its independent deck validator exists but no CD-10 path calls it, and the
  authoritative corpus has no golden outputs; execute still takes its lowering manifest and content digests from the body (D22-6 in
  part, latent behind the 409); `/api/simulate` keeps its own deck screen beside the Studio's (no one deck validator spans both; D22-4
  in part).
- **Readings that stay INFERRED or UNKNOWN**: the XSPICE card and token readings (no live case), whether numparam can substitute a
  string into a bare `file=name` value and whether ngspice-46 reads a one-token `.lib` line's token as a file (both refused,
  fail-closed), the reach of `taskkill /T` to a real descendant, the Windows C runtime's locale, ngspice's vector type list, kicad-cli's
  version, and how `next build` serves the engine worker (no `next build` was run; OD-158 keeps the named computations off by default
  for it).
- **The Studio record is still marked cancelled at the request** (B16.0.23 §E/§F), while its process ends after; the job store has no
  per-scope plan limit (OD-155's recorded low) and a record's event list no count bound (D22-4); OD-157's promised early 422 for a deck
  that sets its own seed was not added.
- **Local simulation fails closed until the owner pins the install**: `SIRKIT_NGSPICE_INSTALL_ROOT` and `SIRKIT_NGSPICE_INSTALL_SHA256`.

## Owner follow-ups

- **The two pinning settings** (OD-135): run `tsx scripts/print-install-tree-digest.ts <Spice64 folder>` and set
  `SIRKIT_NGSPICE_INSTALL_ROOT` and `SIRKIT_NGSPICE_INSTALL_SHA256` in `.env.local`; until then `/api/simulate` answers 503, the smoke test
  422 and every Studio run fails, closed. The owner's `.env.local` was not changed by any increment.
- **Isolation** (OD-134, OD-147, LB-10): a reachable OCI engine (a repaired Docker Desktop with a recorded backend, or a Linux host or CI
  runner) and approval of the opt-in B22-A4 (the image and the docker CLI pinned, an output transport chosen, qualification evidence
  recorded); production stays BLOCKED even then until B24-A names the production host.
- **Owner decisions, by number**: OD-159 (a human approval route for the process-backed computations - a census move 165 -> 166+, CSRF,
  approver roles; a decision is needed before either runs), OD-158 (enable the named computations by default after a `next build`
  qualification), OD-141 (bind the evidence aggregate to a route; drop the unwired CD-10 tables by migration), OD-140 (the engine host's
  caps, a queue, F1 on the host), OD-155 (the runner's shares; tenant plus caller kind), OD-156 (neutral values for Node's eight win32
  variables), OD-151 (keep or drop the `*#`-title refusal). Every other B22 decision awaits the owner's confirmation only
  (`unknowns-and-owner-decisions.md`).
- **Later work, no owner decision**: FreeRouting's and kicad-cli's kill semantics, run-time digest checks and per-run directories; the
  fab archive reader's per-entry bound; one deck validator across `/api/simulate` and the Studio; a count bound on a record's event
  list; the job store's per-scope plan limit; execute's lowering manifest and content digests bound to the server (D22-6's remainder);
  the D22-12 relabel (a B16.0.2 CSV move); OD-157's early 422; a live case for the XSPICE readings; the closeout (1/2)'s optional steps
  (a schema id for dormant request evidence, the restated validator id bound, two names in `b21-d3-pin-facts`' closed list).

## Report lines

```
SANDBOX STATUS: production runner BLOCKED (no qualified isolation boundary on any platform the program controls; production host undetermined, B24-A; LB-10, OD-134; the CD-10 501 text kept and never reached - an AI actor 403, a malformed body 400, every well-formed human request 409); named computations and diagnostic simulation run diagnostic-only on local runners whose limits are enforced by the runner, not the OS - the ngspice runner (the pinned install digest, cached behind a stat fingerprint re-taken before every spawn; -n; the exact environment map (Node's eight win32 additions recorded, OD-156); a per-run directory removed in its finally and, after a kill_unconfirmed, again once the child's close is observed - a child that never closes can keep its directory and its slot; 64 KiB per output stream; a raw read-back of 100 MiB (Studio, circuit analysis) or 20,000,000 bytes (/api/simulate; the smoke test reads none); 5,000,000 waveform points (Studio); a 120 s / 10 s wall clock with a tree kill; a global cap of four shared by tenant) for diagnostic simulation and the dormant circuit analysis, and the worker-thread engine host (budget with a hard terminate, V8 heap limits, empty environment, two workers, one per tenant) for the three opt-in process-free computations; no OS limit on CPU, memory, processes, file size or network
ROUTE RATCHET: 165 = 162 canonical + 3 factories + 0 raw (unchanged)
```
