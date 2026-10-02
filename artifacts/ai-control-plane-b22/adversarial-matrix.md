# B22-D - the adversarial matrix: every runbook `:938` class, prevention offline, live on the diagnostic runner, OCI blocked

Labels: **CONFIRMED** (executed at a fake seam by a suite named here, or read at the cited file), **INFERRED** (a conclusion from
reading code or documentation; never executed), **RECORDED** (written down from a record or another increment's run, without a claim
of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Branch `chapter/b22-sandboxed-computation`, base `a269e7a` (B22-C), 2026-10-02. Runbook B22-D (`:936-938`), verbatim: "Test fork
bombs, child processes, filesystem escape, symlink/hardlink tricks, device paths, huge output, infinite simulation, malformed binary
output, NaN/Inf, locale drift, network attempts, environment-variable exfiltration, signal races, orphan processes, archive traversal
and parser differentials." Discovery D22-20 (closed here), section 7's B22-D items 1-16, 9.4's B22-D bullet and 9.5 item 30. Nothing
here started ngspice, java, kicad-cli, docker, wsl or any other real process: every P case runs at the fake `node:child_process` and
`node:fs/promises` seams, the live suite was written and never run by this increment, and nothing is called a sandbox or
authoritative. Production simulation authority stays BLOCKED (the CD-10 501 and `executeAuthoritativeSimulation` unchanged).

## 0. What B22-D is

- **P - prevention, offline** (`app/lib/computation/__tests__/b22-d-adversarial.test.ts`, 10 cases, in the default suite and in CI
  through the existing `app/lib/computation/__tests__` filter). Where SEC-1, B22-A1, A2, A3, B or C already pinned a prevention, the
  row cites that case by file and name (`[suite#N]` or `[suite: "title fragment"]`); case 9 resolves every citation against the
  repository, so a renamed or deleted case fails the matrix. B22-D added only what was missing, and each new case was proved by a
  deliberate breakage of its guard, restored by hash (section 4).
- **L - live, opt-in** (`app/lib/computation/__tests__/b22-d-adversarial-live.test.ts`, 13 cases numbered by class; skipped unless
  `SIRKIT_B22_LIVE_RUNNER=1`, never in CI). WRITTEN by B22-D and NOT run by it: the lead runs it once on the pinned install and
  records each result in the L column (section 3). Each case runs benign decks of ngspice's own commands only, and is built so an
  escape is OBSERVED: the case fails, and the class is then reported not contained - an escape never becomes a pass.
- **O - OCI**: BLOCKED-LIVE-QUALIFICATION under LB-10 for every class: no container engine was reachable on this host, the
  `ngspice-oci` profile is unqualified and carries no evidence (`isolation-verdict.md`; `b22-a2-runtime-profile` cases 8, 16, 18). No
  docker, podman or runsc command was run.

## 1. The matrix

| # | class | P (prevention, offline: the cases and their breakage proof) | L (live, `b22-d-adversarial-live`) | O (OCI) |
|---|---|---|---|---|
| 1 | fork bombs | Cited: every construct that runs a command or starts a program is refused before any process - [sec-1-deck-injection: "a second control block"], [sec-1-deck-injection: "a '*#' command line"], [sec-1-deck-injection: "a script title"], [sec-1-deck-injection: "a dot shell directive"], [sec-1-deck-injection: "a shell escape line"], [sec-1-deck-injection: "command substitution"], [sec-1-deck-injection: "an extra command inside the compiler's block"] (and its `.exec`, `.system`, `.source` rows), [b22-a1-model-screen: "an XSPICE d_process card (it spawns process_file)"], [b22-a1-model-screen: "an XSPICE d_cosim card (it loads the shared library simulation)"], [b19-d-deck-injection: "a deck with a second control block is refused by the output screen (defence in depth)"]; the runner starts only ngspice and its own taskkill [b22-a3-single-spawner#3]; no other module imports a process module [b22-b-no-generic-exec#1]. Breakage proof: the cited suites' own (SEC-1 page sections 2.5 and 8.4; B22-A3 page section 7, MH; B22-B page section 8). | case 1 (a control loop that never ends, stopped at the wall clock with its tree): written; not run by B22-D (the lead's run records it here). Windows sets no OS process cap (OD-145). | BLOCKED-LIVE-QUALIFICATION under LB-10 (no container engine reachable on this host; `ngspice-oci` unqualified) |
| 2 | child processes | Cited: the refusals of row 1 hold for every child (a deck reaches a command interpreter only through one of them); the tree kill - win32 `taskkill /PID <pid> /T /F` on the wall clock and on abort [b22-a3-diagnostic-runner#6], POSIX a process-group SIGKILL [b22-a3-diagnostic-runner#7]; exactly two spawns, ngspice and its taskkill [b22-a3-single-spawner#3]; the engine host starts worker threads, never a process [b22-b-no-generic-exec#1, 2]. Breakage proof: B22-A3's MH (taskkill without `/T`) and MD. | case 2 (no ngspice or taskkill the runner started is alive after a clean exit or a tree kill; a benign deck starts no descendant, so `/T` reaching one stays **INFERRED**): written; not run by B22-D. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 3 | filesystem escape | New [b22-d-adversarial#1]: an executed deck's `write` target must be a plain relative file inside the run directory - red on `a269e7a`, where the final deck screen admitted 17 targets (`../result.raw`, `/dev/null`, `//./pipe/b22d`, `//host/share/b22d.raw`, `NUL`, `CON` among them); `/api/simulate`'s deck writes exactly `write result.raw`. Cited: `.include` and `.lib` traversing, absolute and UNC paths refused [b22-a1-model-screen: "an .include traversing with slashes"], [b22-a1-model-screen: "an .include with a UNC path"], [sec-1-deck-injection: "a library read"]; one `mkdtemp` directory per run, the deck the only file the runner writes [b22-a3-diagnostic-runner#9], with an exclusive create [b22-a3-diagnostic-runner#2]. Breakage proof: D1. | case 3 (a deck naming only relative files writes inside its run directory and nowhere else; the directory's listing is taken just before its removal): written; not run by B22-D. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 4 | symlink/hardlink tricks | New [b22-d-adversarial#3]: the raw file is read back only when `lstat` shows a plain file with one name - a link or junction, a hardlink, a directory, a FIFO or a device is refused unread at the runner, `/api/simulate` and the Studio worker (red on `a269e7a`: a symlink at the runner read through - the case's first assertion stopped it there; [B22-D review] coverage-5: with the case's assertions soft, re-observed against `a269e7a`'s runner - all five kinds read and opened at the runner, `/api/simulate` answered 200 with `ok: true`, the Studio worker's run completed with a waveform). New [b22-d-adversarial#4]: a link, junction or file pre-planted at the runner root runs nothing and writes nothing (red: the runs went through the link). Cited: the install digest refuses a link anywhere, a real junction among them [b22-a2-runtime-profile#5]; the pin check refuses an install that is not a plain tree [b22-a3-diagnostic-runner#3]. Breakage proof: D3, D3b, D4 (D3 and D3b re-run on the review's suite; [B22-D lead] D3b's log shows the hardlink kind and the Studio worker red - the other kinds stayed refused and `/api/simulate` stayed green under that breakage). | case 4 (a hardlink planted as `result.raw` after the deck is written and before the spawn: the runner must refuse to read it; ngspice's write through it to the file outside is OBSERVED and fails the case - expected, **INFERRED**: the OS does not stop that write): written; not run by B22-D. | BLOCKED-LIVE-QUALIFICATION under LB-10 [B22-D lead, live 2026-10-02: L NOT CONTAINED - ngspice wrote through the planted hardlink to the file outside its run directory; the runner refused the read (`not-a-plain-file`); section 10] |
| 5 | device paths | New [b22-d-adversarial#2]: `\\.\`, `//./`, `\\?\`, a UNC share, `NUL`, `CON`, `COM1`, `CONIN$`, `CONOUT$`, a superscript `COM`, a device name under a folder, `/dev/*` and `/proc/*` in an include or an XSPICE file parameter are refused by the model screen and the final deck screen; new [b22-d-adversarial#1] (the same in the write target) and [b22-d-adversarial#3] (a FIFO or a device as the raw file). Cited: [b22-a1-model-screen: "an XSPICE file= naming a Windows device"]. Breakage proof: D2, D1, D3. | none by design: opening a device is not a benign ngspice command; the P cases hold it. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 6 | huge output | Cited: stdout and stderr held to twice the 64 KiB bound and returned within it, the tail kept and the marker first [b22-a1-diagnostic-bounds: "a long stdout and stderr are each cut to the channel bound, the tail kept, the marker first"], [b22-a3-diagnostic-runner#5]; a raw file over the read-back bound refused whole and unread [b22-a3-diagnostic-runner#5]; FreeRouting's session file the same [b22-a1-tool-output-bounds: "a .ses over the file bound is refused unread with a closed error that names the bound, never the content"]; an output past the route's own bounds refused whole [b22-c-output-validator#10]. Breakage proof: B22-A1's M1, M2, M4, M4b; B22-A3's N1; B22-C's tests-7. | case 6 (a control loop that prints without end is held within the bound and stopped at the wall clock; a raw file past a 4 KiB read-back bound is refused unread): written; not run by B22-D. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 7 | infinite simulation | Cited: the wall clock ends the tree and the run is terminal only after the close [b22-a3-diagnostic-runner#6], else `kill_unconfirmed` with its slot held [b22-a3-diagnostic-runner#8]; each entry point's answer (504, a failed record, a 422 check) [b22-a3-diagnostic-runner#13]; no result after a cancel [b22-c-job-store-terminal#5]; the engine host stops a loop that never yields at its budget [b22-b-bounded-host#2]. Breakage proof: B22-A3's MD; B22-C section 12. | case 7 (a transient far longer than the wall clock: `timeout`, its raw file never read): written; not run by B22-D. B22-A3's live case 4 stopped an 18.7 s transient at 1.5 s (RECORDED). | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 8 | malformed binary output | New [b22-d-adversarial#8]: ngspice's binary format, an ASCII header over binary values, a byte that is not UTF-8 and a NUL inside a value are refused by every parser. Cited: invalid UTF-8 refused at the read [b22-a3-diagnostic-runner#5]; a short, over-long or misaligned output [b22-c-output-validator#4]; a binary or inconsistent header [b22-c-output-validator#10]. Breakage proof: D8a, D8e. | case 8 (ngspice's own binary rawfile: refused by the runner's UTF-8 read, or by every parser): written; not run by B22-D. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 9 | NaN/Inf | Cited: `Infinity`, `1e999`, `nan`, `inf` and `1.#INF00e+000` refused whole [b22-c-output-validator#1, 2, 3]; non-finite numbers carried as closed states, never digested raw [b22-c-evidence-store#1]. New [b22-d-adversarial#8]: the strict reader refuses them too, so do the UCRT `-nan(ind)` and the MSVC `-1.#IND00e+000`, and so does a complex value whose magnitude overflows though both parts are finite (red: the validator read it and both parsers derived an infinite magnitude in dB). [B22-D review] tests-8: the MSVC indeterminate is now refused `OUTPUT_NON_FINITE`, as a NaN, where it was refused `OUTPUT_MALFORMED` (red first: the corpus pin had recorded the misclassification). Breakage proof: D8d, D8a, D8m. | case 9 (how ngspice-46 spells an overflowed and an undefined value - discovery 9.5 item 21, unmeasured until then - and every parser refuses them): written; not run by B22-D. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 10 | locale drift | Cited: every profile's exact environment carries `LC_ALL=C` and `TZ=UTC` [b22-a2-runtime-profile#7] and the child receives exactly that map [b22-a3-diagnostic-runner#2]. New [b22-d-adversarial#8]: decimal commas are refused by every parser (a transient and an operating point). Breakage proof: B22-A3's MB; D8e (values past the declared points ignored: the decimal-comma transient is then read as values). | case 10 ([B22-D review] tests-5, restated: an allowlist re-check - a decimal-comma locale set in the server's environment cannot reach the child, whose environment is the profile's map, so the raw file stays byte-identical - and one measurement, the decimals ngspice writes under the profile's environment and this host's OS user locale; the child's locale cannot be varied through the runner, so drift under a comma locale stays **INFERRED**; the P cases and the profile pin carry this row): written; not run by B22-D. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 11 | network attempts | New [b22-d-adversarial#2] and [b22-d-adversarial#1]: URLs (`http://`, `https://`, `file://`, `ftp://`), a UNC share and `\\?\UNC\` refused in an include, an XSPICE file parameter and the write target. Cited: [b22-a1-model-screen: "an .include with a UNC path"], [b22-a1-model-screen: "an XSPICE d_state state_file= with a UNC path"]; no computation input carries a URL [b22-b-catalog#2]; a local profile claims no network denial [b22-a2-runtime-profile#9]. Breakage proof: D2b. | none by design: no network attempt is made from this host. RECORDED: the diagnostic runner has no OS network denial, so only O could prove denial. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 12 | environment-variable exfiltration | New [b22-d-adversarial#5]: a canary and a provider-key name set in the server's environment reach neither the child nor any output - the runner's record, `/api/simulate`, the smoke test, the Studio worker's result and its log events - while the child's own environment does reach them (the positive control). Cited: the runner passes exactly the profile's keys [sec-1-deck-injection: "the worker, /api/simulate and the smoke test carry no environment of their own"], [b22-a3-diagnostic-runner#2]; kicad-cli's allowlist [b22-a1-secret-env: "the spawn passes env (inside the allowlist, none of the canaries set in this process)"]; FreeRouting's [runner-security: "does not expose Sirkit secrets to the Java child"]; the engine host passes an empty environment [b22-b-bounded-host#1]. Breakage proof: D5. | case 12 (ngspice's own `echo` of a canary set in the server's environment never prints it; `$TZ` is the positive control, [B22-D review] tests-4: asserted before the canary check, so a run where `echo` does not expand it fails as NOT MEASURED, never passes as contained): written; not run by B22-D. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 13 | signal races | New [b22-d-adversarial#6]: an abort after the exit, in the spawn's own tick, beside the child's clean exit or after the wall clock, an error from a live child and a second close each end in exactly one terminal state - never exited after a kill, no raw file read after one, one tree kill, the slot and the directory freed once. Cited: an abort during the pin check [b22-a3-diagnostic-runner#4], before the start [b22-a3-diagnostic-runner#6], while queued [b22-a3-diagnostic-runner#10]; a close that never comes [b22-a3-diagnostic-runner#8]; a late completion never overwrites a cancelled record [b22-c-job-store-terminal#5]; no engine answer after the budget [b22-b-bounded-host#3]. Breakage proof: D6, D6b. | case 13 (an abort before the call, during the run and after the exit, against the real process): written; not run by B22-D. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 14 | orphan processes | Cited: the tree kill [b22-a3-diagnostic-runner#6, 7]; a slot held until the close is observed, the directory removed again then [b22-a3-diagnostic-runner#8]. Breakage proof: B22-A3's MH and MD. | case 14 (after an abort and after a timeout, no ngspice or taskkill the runner started is alive - checked by pid with signal 0, no process listing): written; not run by B22-D. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 15 | archive traversal | New [b22-d-adversarial#7]: the SPICE reproducibility bundle writes exactly its eleven fixed entry names whatever the run carries (a traversing, a drive and an absolute name in the project, its test and its plan); no named computation reads an archive - no computation module imports an archive or inflate library, and artifact-parse's two parsers read server-held JSON. Cited: no computation input is a file or a byte field [b22-b-catalog#2]. Breakage proof: D7, D7b. | none by design: no live process reads an archive, and no named computation parses one. | BLOCKED-LIVE-QUALIFICATION under LB-10 |
| 16 | parser differentials | New [b22-d-adversarial#8]: one corpus of 39 raw files (37 first; [B22-D review] coverage-3, tests-1: two with a repeated `No. Variables:` header, one the last copy would read and one the first copy would) through the output validator, the Studio worker's parser, `/api/simulate`'s parser and the circuit-analysis strict reader - every verdict and every value agrees, and every number returned is finite (red: 23 disagreements); [B22-D review] coverage-2, tests-2: the strict reader's own bounds held at their edges - 64 variables and 100,000 points read, 65 variables and 100,001 points (declared, or counted with no `No. Points:` header) refused, each read by the validator's defaults and the worker. Cited: the model screen and the deck emitter read one text [b22-a1-model-screen: "one helper gives the emitted model text: the run deck and the smoke deck carry it, and the screen reads it"]; the route and the worker no longer disagree on `Infinity` [b22-c-output-validator#1]; the final screen reads a form feed as ngspice does [sec-1-deck-injection: "[review] a form feed hiding a control block"]. Breakage proof: D8a, D8b, D8c, D8f, D8g, D8h, D8i, D8j, D8k, D8l. | case 16 (the raw files ngspice-46 writes for an operating point, a transient and an AC sweep read the same through three parsers; their Variables lines printed): written; not run by B22-D. | BLOCKED-LIVE-QUALIFICATION under LB-10 |

## 2. The guards B22-D found missing (each test-first, red on `a269e7a`)

- **G1 - the output path** (`app/lib/spice/netlist.ts`, `assertCompiledDeckSafe`, in place on its line): the final deck screen pinned
  the compiler's own control block by a pattern whose `write` target class `[A-Za-z0-9._/-]+` admitted a traversing, absolute,
  UNC-shaped or device target. The compiler only ever writes the server's `result.raw` (every caller passes it), so this was the
  defence-in-depth layer, not an exploited path: a deck altered after compilation could have written `../../x` or `NUL`. The target
  must now also be a plain relative file name (B22-A1's `plainRelativeFileName`: no `..`, no device name, nothing absolute). Items 3, 5,
  11. `/api/simulate` keeps its own screen; its target is the fixed server name (section 6).
- **G2 - the raw file is a plain file** (`app/lib/computation/diagnostic-runner.ts`, `rawFileKind`): the runner opened `result.raw`
  through whatever stood at that name. It now reads it only when `lstat` shows a plain file with one name; a link, a junction, a
  hardlink, a directory, a FIFO or a device is `not-a-plain-file` and never opened (each entry point answers it as no output, the
  record names it). Items 4, 5.
- **G3 - the runner root** (`ensureRunnerRoot`): `mkdir(root, { recursive: true })` resolved over a pre-planted link to a directory,
  so every run directory would have been created through it. The runner now creates the root itself or, when it exists, runs only if
  `lstat` shows a plain directory (a link, a junction - Node reports one as a link - or a file is refused
  `NGSPICE_DIAGNOSTIC_RUN_DIRECTORY_FAILED`, naming no path). Item 4; D22-8's open item.
- **G4 - one reading of a raw file** (`request-executors.ts` `readStrictRaw`; `output-validator.ts`; `/api/simulate`): the
  circuit-analysis strict reader had its own reading, which disagreed with the one validator on ten of the corpus files ([B22-D review] coverage-5: ten, as the red log lists them; ngspice's
  ` grid=3` attribute, a missing `Flags:` or `No. Points:`, a `00` index, `re, im`, `-0`, a repeated time point, an undeclared type,
  duplicate headers); it is now read by the validator under its own bounds (64 variables, 100,000 points; [B22-D review] pinned at their edges by
  case 8, D8f and D8g). The validator refuses a repeated `Flags:`, `No. Variables:` or `No. Points:` header (the strict reader took the
  first copy, the validator the last; [B22-D review] each pinned either way, D8c and D8h-D8l) and a
  complex value whose magnitude overflows though both parts are finite. `/api/simulate` derives a complex magnitude with the worker's
  formula (`Math.hypot`, floored at 1e-30): its `re * re` overflowed to an infinity past 1e154 (answered as `null`) and its floor held
  only at zero. Items 16, 9, 10, 8. Stated choice (OD-143 as applied by B22-C, extended): one validator for every raw reader.
- **G5 - [B22-D review] the MSVC indeterminate is a NaN** (`output-validator.ts`, `numberOf`, in place on its line): a token the number
  pattern does not match was classified non-finite only when it spelled `nan` or `inf`, so the MSVC runtime's NaN `-1.#IND00e+000`
  was refused `OUTPUT_MALFORMED` (`1.#INF00e+000`, `1.#QNAN0e+000` and `-nan(ind)` were already `OUTPUT_NON_FINITE`). It is now
  `OUTPUT_NON_FINITE` (`#ind` added to the rule). The file was refused whole either way; only the closed code changes. Item 9 (tests-8;
  red first on the reviewed tree).

## 3. The live suite: how the lead runs it, and what counts as a finding

Run once, locally, with the owner's two settings pinning the install, through the lock:
`SIRKIT_B22_LIVE_RUNNER=1 bash run.sh <repo> <log> app/lib/computation/__tests__/b22-d-adversarial-live.test.ts`. Each case prints a
`[B22-D live]` line. Its two module seams are pass-through spies (the real spawn and the real file system run): one records each pid,
the other can plant a link after the runner writes its deck and records each run directory's listing before its removal. The suite
spells no command interpreter, no `*#`, no include or library, no path outside the run directory and no URL in any deck
(`b22-d-adversarial` case 10 reads every deck), and every file it writes is under its own `mkdtempSync(join(tmpdir(), ...))` root or
the runner's run directory (the B11.5 write gate's admission). [B22-D review] coverage-1, tests-3: case 10 now reads every deck line
by line, as ngspice reads it - each deck is one `ngspiceDeck` call over an array of string literals (no line built at runtime: live
case 3's second file is the literal `b22d-live-3.raw`, and a copy an earlier run left is refused before the run), the helper is the
only caller of `seedDiagnosticDeck`, every `runDiagnosticNgspice` call names its deck by an identifier bound only to such a literal,
no line holds a path separator, `~`, `<`, `>` or `|`, a control line is one of ngspice's own commands from a closed list (`set
filetype=`, `op`, `tran`, `ac`, `let`, `while`, `end`, `echo`, `write`, `quit`), and every `write` target is a plain relative file
(`plainRelativeFileName`: no device name, no drive, nothing absolute). The reviewed check missed `write /tmp/x`, `write ~/x`, a
`/Windows/Temp` path, an `echo ... > file` redirection and a deck built outside the helper (counterexample CE1, section 9).

- A case that fails because an escape was observed (case 4's write-through, case 12's canary, case 14's survivor, case 1's or 13's
  `kill_unconfirmed`) is a finding: the class is reported NOT contained in this table, never re-run until green.
- A case that fails because a measurement did not happen (case 9 when ngspice writes no non-finite token; [B22-D review] case 12 when
  `echo` does not expand `$TZ`, its positive control now asserted) is recorded as such, NOT MEASURED - never as contained.
- **Expected, INFERRED**: case 4's write-through is likely OBSERVED (ngspice opens `result.raw` for writing and the OS follows a
  hardlink); the runner's refusal is on the read side only, and no OS isolation exists to stop the write (OD-145). Whether ngspice's
  `echo` expands an environment variable at all is UNKNOWN: [B22-D review] case 12 asserts it (tests-4), so a run where it does not
  fails as NOT MEASURED instead of passing on a vacuous canary check.
- [B22-D review] tests-5: case 10 cannot vary the child's locale (the runner passes only the profile's map): it re-checks the
  allowlist and measures the decimals written under the profile's environment and this host's OS user locale. Drift under a comma
  locale stays **INFERRED**; row 10 rests on its P cases and the profile pin.

**Result**: not run by B22-D. The lead's run is recorded here.

## 4. Test-first record and the breakage proofs

Every run under the global heavy-job lock (`run.sh`, two workers), every exit code captured; no live suite run, no browser spec, no
full suite; no real process started.

- **Red on `a269e7a`** (the two suites written first, production code unmodified): `b22-d-adversarial` 6 failed / 4 passed, the live
  suite 13 skipped; exit 1. Red: case 1 (17 write targets admitted), case 3 (a link's raw file read: `state: "read"` - the first assertion; the other kinds
  and the two entry points were not reached, and are re-observed in section 9), case 4 (a run through a planted root link resolved),
  case 8 (23 disagreements: the strict reader on ten files ([B22-D review] coverage-5: was "nine"), `/api/simulate`'s complex
  magnitude on five, the validator reading the overflowing magnitude and both duplicate-header files, the worker returning an
  infinity), case 9 (no page), case 10 (no B11.5 admission). Green there: cases 2, 5, 6 and 7, which pin properties the code held -
  each proved below by a breakage instead.
- **Green** after G1-G4, the harness moves (section 5) and this page: `b22-d-adversarial` 10 passed, the live suite 13 skipped.
- **Deliberate breakages** (`breakages.py` in the scratch directory: each applied alone, `b22-d-adversarial` run under the lock, the
  file restored byte for byte and checked by SHA-256; twenty of twenty caught, each exit 1, each file identical before and after):

| id | file | breakage | caught by (`b22-d-adversarial`) |
|---|---|---|---|
| D1 | `app/lib/spice/netlist.ts` | the write-target rule removed (G1) | case 1 (1 failed / 9 passed) |
| D2 | `app/lib/spice/netlist.ts` | the Windows device-name rule matches nothing | cases 1, 2 (2 failed) |
| D2b | `app/lib/spice/netlist.ts` | the plain-name rule admits a colon, a leading separator and empty segments | cases 1, 2 (2 failed) |
| D3 | `app/lib/computation/diagnostic-runner.ts` | the raw file's `lstat` verdict ignored (G2) | case 3 |
| D3b | `app/lib/computation/diagnostic-runner.ts` | the one-name (hardlink) rule dropped | case 3 |
| D4 | `app/lib/computation/diagnostic-runner.ts` | the runner root's `lstat` verdict ignored (G3) | case 4 |
| D5 | `app/lib/computation/diagnostic-runner.ts` | the server's environment spread into the child's | case 5 |
| D6 | `app/lib/computation/diagnostic-runner.ts` | a close after a kill reported `exited` | case 6 |
| D6b | `app/lib/computation/diagnostic-runner.ts` | a second kill cause starts a second tree kill | case 6 - the first attempt was NOT caught (its abort came after the child's close, so the guard was never reached); the case was strengthened (the abort now lands while the killed child still runs), then caught |
| D7 | `app/api/spice/runs/[id]/bundle/route.ts` | an entry named `../logs/stdout.log` | case 7 |
| D7b | `app/lib/computation/catalog.ts` | `import "jszip";` added (case 7's pattern first matched only `from`, `import(` and `require(`; widened to a side-effect import while this breakage was designed, before its run) | case 7 |
| D8a | `app/lib/computation/request-executors.ts` | the strict reader's own reading restored (`a269e7a`'s file) | case 8 |
| D8b | `app/api/simulate/route.ts` | `Math.sqrt(re * re + im * im)` restored | case 8 |
| D8c | `app/lib/computation/output-validator.ts` | a repeated `Flags:` header read (the last wins) | case 8 |
| D8d | `app/lib/computation/output-validator.ts` | the complex-magnitude rule removed | case 8 |
| D8e | `app/lib/computation/output-validator.ts` | values past the declared points ignored (the decimal-comma transient is then read as values) | case 8 |
| D9 | `adversarial-matrix.md` | a citation to `b22-a3-diagnostic-runner` case 31 | case 9 |
| D9b | `adversarial-matrix.md` | row 15's class renamed | case 9 |
| D10 | `b22-d-adversarial-live.test.ts` | a live deck writing `../result.raw` | case 10 |
| D10b | `b22-d-adversarial-live.test.ts` | a live write under the OS temp directory, not its scratch root | case 10 |

  Restored file hashes (SHA-256, first twelve): `netlist.ts` `197edb0b04d3`, `diagnostic-runner.ts` `85f9f9f65072`, the bundle
  route `abd5f73a5c59` (unchanged from `a269e7a`), `catalog.ts` `ff24ffe578fb` (unchanged), `request-executors.ts` `513eab70752b`,
  `simulate/route.ts` `0ec28e91d4d3`, `output-validator.ts` `c99896ca4a41` ([B22-D review] `604d2a4a8859` after G5; the review's
  breakages section 9).

## 5. Reviewed pin and harness moves

- `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` case 12: one admission for `b22-d-adversarial-live.test.ts` on the B19-E
  precedent - every write-primitive line rooted at its `mkdtempSync(join(tmpdir(), "sirkit-b22-d-live-"))` root (`scratch`) or the
  runner's run directory (`runDir`), or the admission lapses. No other entry changed.
- Three suites' `node:fs/promises` fakes answer `lstat` for the raw file they serve (a plain file, or absent), because the runner now
  lstats it before its bounded read (G2): `b22-a3-diagnostic-runner` (its `lstat` already passed the install walk through; a raw file
  it holds is now answered), `b22-a1-diagnostic-bounds` and `app/api/__tests__/b16-0-24-tranche-parity.test.ts`. Harness only: no
  assertion, case or title changed; each move carries a `[B22-D] reviewed harness move` comment. Without it their completed runs read
  `missing` (six cases red in the probe run; a seventh, the B16.0.24.1 source gate, pinned the raw read's call text, which G2
  keeps as written).
- `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md` section 10, C42: `diagnostic-runner.ts:654` -> `:692` (+38 after
  `ensureRunnerRoot` and `rawFileKind`; the cited text unchanged), the reason written in the row. The one pin B22-D moved.
- No other pin moved: the B16.0.24.1 source gate's literal `readBoundedRawFile(join(directory, DIAGNOSTIC_RAW_OUTPUT_FILE), ...)` call and
  the B16.0.24 confinement gate's `runDir = await mkdtemp(join(runnerRoot, "run-"))` are kept as written; `netlist.ts` and
  `simulate/route.ts` were edited in place on their own lines, so no SEC-1, A1, A3 or C citation moved.

## 6. Residuals (recorded, not closed)

- **No OS limit on this Windows host** (OD-145): no job object bounds CPU, memory, process count or file size. A fork-bomb-like
  construct is prevented only by the deck screens; a loop that never ends is stopped by the runner's wall clock; a raw file is written
  to disk at any size and only its read is bounded; output channels are bounded in memory, but a printing process runs until its wall
  clock (the runner does not kill at the output bound).
- **No OS network denial** for the diagnostic runner: the screens refuse every path or URL that would reach the network, and only O
  could prove denial (LB-10).
- **A link planted by a process of the server user** between the deck write and the spawn redirects ngspice's write (expected in live
  case 4, INFERRED); the runner refuses the read only. The `lstat`-then-`open` window on the raw file and the check-then-`mkdtemp` window
  on the root are open to such a process; the runner is no boundary against one. With no POSIX profile, a root owned by another user is
  not checked (owner and mode would be the POSIX guard).
- **Descendant reach of `taskkill /T`** stays **INFERRED**: a benign deck starts no descendant (live case 2 checks the known pids only).
- **FreeRouting and kicad-cli** keep a direct-child SIGKILL and resolve before the child's exit (`runner.ts`, `kicad-cli-runner.ts`;
  D22-9's other half, assigned B22-B/D). Not changed here: it is not small (both runners' timing, their callers' cleanup of the files
  the process may still hold, and their suites); recorded for the lead (section 8).
- **`/api/simulate`'s own deck screen** (`assertNetlistSafe`) does not pin the `write` target; the target is the fixed server name
  (`rawOutputPath: "result.raw"`, pinned by `b16-0-24-tranche17-confinement-gate`) and no caller field reaches that line (B19-D's field
  screen); case 1 pins the deck it writes.
- **The fab archive reader** (`app/lib/pcb/fab/validate-package.ts`, `extractAndValidateReleaseArchive`) inflates each entry whole
  before its 64 MiB total check; it reads back only the archive Sirkit itself just built (`release-gate.ts`), never an upload, and it
  is not a named computation. Recorded for the lead.
- **UNKNOWN until the lead's live run**: how ngspice-46 spells NaN and infinity (case 9), the vector names and attributes it writes
  (case 16: whether ` grid=` appears, `i(v1)`'s spelling), whether `echo` expands an environment variable (case 12).
- The Studio record's cancel-at-request ordering (B16.0.23 §E/§F) is unchanged (B22-C's record).

## 7. Gates

All on the final tree, each set under the lock with its exit code captured (`d-gates.sh` in the scratch directory).

- **A** - `app/lib/computation/__tests__`, `app/lib/spice/__tests__`, `app/api/simulate/__tests__`, `app/lib/model-simulation`,
  `app/api/model-simulation`, `app/lib/firmware-bringup`, the CI guard (`b19-e-ci-job-scope`): first run 1 failed / 621 passed / 21
  skipped, exit 1 - the B22-A1 page's citation C42 named `diagnostic-runner.ts:654`, which G2 and G3 moved to `:692`; re-pinned as a
  reviewed move (section 5), then 36 files passed, 3 skipped (the live suites and `worker-integration`), 622 passed, 21
  skipped; exit 0. The two B22-D suites ride the existing `app/lib/computation/__tests__` filter (OD-146): no
  CI line added, the guard green.
- **J** - FreeRouting and fab: `app/lib/pcb/autoroute/__tests__`, `app/lib/pcb/fab/__tests__`, `kicad-cli-runner`, `build-bundle`,
  `kicad-cli-oracle`, `manufacturing-release-gate`, `app/api/pcb/export/gerbers/__tests__`, `app/api/pcb/autoroute/__tests__`: 16
  files, 105 passed, 2 skipped; exit 0.
- **B** - `app/lib/engineering/__tests__`: 99 files, 1,107 passed; exit 0.
- **C** - `app/lib/agent/__tests__` (B11.5's write gate among them, with the new admission): 36 files, 415 passed; exit 0.
- **D** - `app/lib/agent/orchestration/__tests__`: 49 files, 460 passed; exit 0.
- **E** - `app/lib/mcp`: 45 files, 825 passed; exit 0.
- **F** - the chat and MCP routes, the B18-B and B15.3 import gates, the route matrices and tree, the wrapper and analyzer gates, the
  B16.1C tripwires: 37 files, 314 passed; exit 0. **F2** - the B14.4 AST import gates, alone: 22 passed; exit 0.
- **H** - `app/api/__tests__`: 27 files, 1,059 passed; exit 0 (the B16.0.24 tranche parity suite with its harness move, the B16.0.24.1
  source gate unchanged).
- **I** - `app/lib/auth/__tests__` (the B16.0.23 and B16.0.24 confinement gates, the B16.0.2 CSV byte pin, the 501 pins): 41 files, 479
  passed, 9 skipped; exit 0.
- `tsc --noEmit -p tsconfig.json`: exit 0. `eslint` on the 11 changed or new TypeScript files: exit 0.
- Generators `generate-b16-0-2-artifacts`, `-b16-0-4-`, `-b16-0-7-`, `generate-b16-0-8-baseline`, `generate-b17-control-inventory`,
  `generate-b16-0-artifacts`, `generate-b16-0-1-artifacts`: each exit 0, zero drift (the status, the tracked diff and every untracked
  file's hash identical before and after). No route added: the census stays 165 = 162 canonical + 3 factories + 0 raw.
- Files are LF only, with no control byte; the reserved files are untouched.
- **[B22-D review] The review round's gates** (2026-10-02; `dfix/dfix-gates.sh`, the same sets, each under the lock with its exit code
  captured): A 36 files, 622 passed, 21 skipped; J 16 files, 105 passed, 2 skipped; B 99 files, 1,107 passed; C 36 files, 415 passed; D
  49 files, 460 passed; E 45 files, 825 passed; F 37 files, 314 passed; F2 22 passed (run alone); H 27 files, 1,059 passed; I 41 files,
  479 passed, 9 skipped - every set exit 0, the case counts unchanged (the review added assertions inside existing cases). `tsc --noEmit
  -p tsconfig.json` exit 0; `eslint` on the 11 changed or new TypeScript files exit 0; the seven generators each exit 0 with zero drift
  (status, tracked diff and every untracked file's hash identical before and after). Census unchanged: 165 = 162 canonical + 3
  factories + 0 raw. Files LF only, no control byte; the reserved files untouched.

## 8. Findings for the lead

1. **Run the live suite once** (section 3) and record each case's result in the L column; a failing case 4, 12 or 14, or a
   `kill_unconfirmed` in case 1 or 13, reports its class NOT contained. Case 4's write-through is expected (INFERRED). [B22-D review]
   A case 9 or 12 that fails on its measurement or its positive control is NOT MEASURED, recorded as such; live case 3 refuses to
   start while a `b22d-live-3.raw` an earlier run left sits in the working, OS temp or runner directory.
2. **FreeRouting and kicad-cli kills** (D22-9's other half, assigned B22-B/D): both resolve their run at the kill
   (`runner.ts` abort and timer handlers call `child.kill("SIGKILL")` and settle at once; `kicad-cli-runner.ts` likewise), so a
   caller's cleanup can remove files the process still holds, and a descendant is never killed. Their profiles already record the
   deviations (`direct-child-kill`, `terminal-before-exit`; `b22-a2-runtime-profile` case 13). Proposed: a follow-up giving both the
   diagnostic runner's kill semantics (`killDiagnosticProcessTree`, terminal after the close or `kill_unconfirmed`), test-first at
   their fake seams. Not done here: not small, and outside the seams this increment names.
3. **The fab archive reader** (`validate-package.ts` `extractAndValidateReleaseArchive`) inflates each entry whole before checking
   the 64 MiB total; a decompression bomb would be inflated into memory first. It reads only the archive `release-gate.ts` just built,
   never an upload, and is not a named computation, so it is outside B22-D's archive item; a per-entry bound read from the archive's
   directory before inflation would close it.
4. **One deck validator across `/api/simulate` and the Studio path** stays open (discovery 9.3): `/api/simulate`'s own screen does not
   pin the `write` target (its target is the fixed server name; section 6).
5. **The SEC-1 page** describes the final screen's `write` line as "a `write` line of the server-owned path and allowlisted
   expressions"; the code is now stricter (the target must also be a plain relative file, G1). The page was not edited: its own suite
   pins its counts and citations. A dated note there is the lead's choice.

## 9. Review round (2026-10-02): the confirmed findings, each fixed test-first

An adversarial review CONFIRMED ten findings (all low after verification): seven defects, three reported twice (coverage-1 and
tests-3, coverage-2 and tests-2, coverage-3 and tests-1). Every run under the lock with its exit code captured (`dfix/mut.py`,
`dfix/obs3.py` in the scratch directory); every file a run changed restored byte for byte and checked by SHA-256.

**Counterexamples first** (the REVIEWED suite, each alone, each green - exit 0, 10 passed - so each finding is CONFIRMED here too):

| id | finding | change | reviewed suite |
|---|---|---|---|
| CE1 | coverage-1, tests-3 | live decks writing `/tmp/b22d.raw`, `~/b22d.raw` and `/Windows/Temp/b22d.raw`, an `echo b22d > b22d.txt` line, and a run whose deck is a seeded string literal carrying `shell` | green (case 10 passed) |
| CE2 | coverage-2, tests-2 | `STRICT_RAW_LIMITS` emptied (the validator's defaults: 10,000 variables, 5,000,000 points) | green (case 8 passed) |
| CE3a | coverage-3, tests-1 | a repeated `No. Variables:` header read, the last copy wins | green |
| CE3b | coverage-3, tests-1 | a repeated `No. Variables:` header read, the first copy wins | green |

**Red on the reviewed tree** (the strengthened suite, production code unmodified): 2 failed / 8 passed, exit 1 - case 8 (the MSVC
indeterminate refused `OUTPUT_MALFORMED`, pinned `OUTPUT_NON_FINITE`; tests-8) and case 10 (live case 3's deck line built by
concatenation). After live case 3 named its file as a literal: still 2 failed / 8 passed - case 10 now on live case 12's positive
control, printed but not asserted (tests-4). **Green** after the fixes: `b22-d-adversarial` 10 passed, the live suite 13 skipped,
`b22-c-output-validator` 10 passed; exit 0.

**coverage-5, re-observed**: case 3's assertions are now soft; run alone against `a269e7a`'s `diagnostic-runner.ts` (restored,
`85f9f9f65072` before and after) it failed with 15 soft failures, exit 1: each of the five kinds read (`state: "read"`) and opened at
the runner, `/api/simulate` answered 200 with `ok: true`, the Studio worker's run completed with a waveform, and the raw file was opened
by both. Row 4's red claim is now observed; the count of strict-reader disagreements in the red log is ten (G4, section 4).

| finding | the fix |
|---|---|
| coverage-1, tests-3 | case 10 reads every live deck line by line (section 3); live case 3's second file is a literal |
| coverage-2, tests-2 | case 8 pins the strict reader's own bounds at their edges: five complete sweeps (64 and 65 variables; 100,000 and 100,001 points declared; 100,001 counted) |
| coverage-3, tests-1 | two corpus rows with a repeated `No. Variables:` header (one each way), pinned `OUTPUT_HEADER_INVALID` |
| coverage-5 | "nine" corrected to "ten" here (G4, section 4) and in `named-computations.md`; row 4's red re-observed (above) |
| tests-4 | live case 12 asserts its positive control before the canary check; case 10 requires it |
| tests-5 | live case 10 restated as an allowlist re-check plus the one measurement it can make (the decimals written); row 10's L cell restated |
| tests-8 | G5: `numberOf` classifies `#IND` as non-finite; the corpus pin moved to `OUTPUT_NON_FINITE` |

**Deliberate breakages of the strengthened suite** (each alone, `b22-d-adversarial` under the lock; eighteen of eighteen caught ([B22-D lead] the table and the logs hold eighteen: D8f-D8m and D10c-D10l), each
exit 1, each file identical before and after):

| id | file | breakage | caught by |
|---|---|---|---|
| D8f | `request-executors.ts` | the strict reader's variable bound dropped | case 8 (65 variables read) |
| D8g | `request-executors.ts` | the strict reader's point bound dropped | case 8 (100,001 points read, declared and counted) |
| D8h | `output-validator.ts` | a repeated `No. Variables:` header read, the last wins | case 8 |
| D8i | `output-validator.ts` | a repeated `No. Variables:` header read, the first wins | case 8 |
| D8j | `output-validator.ts` | a repeated `No. Points:` header read, the last wins | case 8 |
| D8k | `output-validator.ts` | a repeated `No. Points:` header read, the first wins | case 8 (`OUTPUT_SHORT`) |
| D8l | `output-validator.ts` | a repeated `Flags:` header read, the first wins | case 8 (`OUTPUT_SHORT`) |
| D8m | `output-validator.ts` | `#ind` removed from the non-finite rule | case 8 |
| D10c | live suite | a deck writing `/tmp/b22d.raw` | case 10 |
| D10d | live suite | a deck writing `~/b22d.raw` | case 10 |
| D10e | live suite | an `echo b22d > b22d.txt` line | case 10 |
| D10f | live suite | a deck writing `/Windows/Temp/b22d.raw` | case 10 |
| D10g | live suite | a run whose deck is a seeded string literal carrying `shell` | case 10 |
| D10h | live suite | live case 3's line concatenated again | case 10 |
| D10i | live suite | live case 12's positive control printed only | case 10 |
| D10j | live suite | a deck writing `NUL` | case 10 |
| D10k | live suite | a `hardcopy` line (a command outside the closed list that writes a file) | case 10 |
| D10l | live suite | a run whose deck is derived at runtime (`LONG_TRANSIENT.replace(...)` writing `/tmp`) | case 10 |

Re-run on the strengthened suite (the cases this round edited): D3, D3b (case 3; [B22-D lead] D3b red on the hardlink kind and the worker only, as its log shows), D8a, D8b, D8c,
D8d, D8e (case 8), D10, D10b (case 10) - nine of nine caught. Restored hashes (first twelve): `output-validator.ts` `604d2a4a8859`,
`request-executors.ts` `513eab70752b`, `diagnostic-runner.ts` `85f9f9f65072`, `simulate/route.ts` `0ec28e91d4d3`, the live suite
`638a030fb3a0`.

## 10. The lead's live run (2026-10-02)

The lead ran `b22-d-adversarial-live` once, locally, with `SIRKIT_B22_LIVE_RUNNER=1` and the pinned install
(`SIRKIT_NGSPICE_INSTALL_ROOT` = the Spice64 folder of the ngspice-46 Windows build; `SIRKIT_NGSPICE_INSTALL_SHA256` = its
`sirkit-install-tree-sha256/1` digest `c6e4e160...61ab1`, 778 files): **12 of 13 passed, case 4 failed - NOT CONTAINED** (CONFIRMED, the
run's own output; no ngspice or taskkill process was alive afterwards).

| case | result (the run's printed observations) |
|---|---|
| 1 fork bombs | passed - the endless control loop stopped at the wall clock (timeout after 2,563 ms against 1,500 ms, kill reason `timeout`) |
| 2 child processes | passed - 3 processes started (ngspice and taskkill), none alive afterwards; `/T` reaching a real descendant stays INFERRED (no benign deck starts one) |
| 3 filesystem escape | passed - the run directory held only `deck.cir`, `result.raw` and the deck's own relative file; nothing written outside it |
| 4 symlink/hardlink tricks | **FAILED - NOT CONTAINED**: a hardlink planted as `result.raw` (after the deck write, before the spawn) was refused by the runner (`raw not-a-plain-file`, never read), but ngspice wrote THROUGH it to the file outside the run directory (`written through the link: true`). The OS does not stop the write; the runner only refuses the read. Planting the link needs a process already running as the server's user inside the per-run directory - outside the threat model's adversaries (`threat-model.md`), recorded as a residual (section 6), never a pass. |
| 6 huge output | passed - stdout held at 65,536 bytes with the marker, the run stopped at the wall clock |
| 7 infinite simulation | passed - stopped at the wall clock, nothing parsed |
| 8 malformed binary output | passed - ngspice's binary rawfile was refused by every parser (validator and worker `OUTPUT_HEADER_INVALID`, the strict reader refused) |
| 9 NaN/Inf | passed - ngspice-46 writes `inf` and `-nan(ind)` (CONFIRMED, discovery 9.5 item 21's unmeasured spellings); every parser refused them whole |
| 10 locale drift | passed - the raw file's digest was identical under a decimal-comma server locale (`.` decimals; drift under the OS user locale stays INFERRED, section 3) |
| 12 environment-variable exfiltration | passed - the positive control expanded `$TZ` to `UTC`; the canary never printed |
| 13 signal races | passed - one terminal state for an abort before, during and after the run; the slots drained |
| 14 orphan processes | passed - 4 processes started, none alive afterwards |
| 16 parser differentials on real files | passed - ngspice-46's operating point, transient and AC sweep raw files read the same through the validator, the worker's parser and the strict reader |

Classes 5 (device paths), 11 (network attempts) and 15 (archive traversal) have no live case by design (section 3); their P rows stand.
