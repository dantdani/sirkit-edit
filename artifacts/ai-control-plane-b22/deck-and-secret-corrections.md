# B22-A1 - the security corrections SEC-1 left: the model screen, kicad-cli's environment, output caps, SPICE AI approval levels

Labels: **CONFIRMED** (executed by a suite named here, or read at the cited file:line), **INFERRED** (a conclusion from reading
code or documentation; never executed), **RECORDED** (written down without a claim of our own), **UNKNOWN**.

Branch `chapter/b22-sandboxed-computation`, base `0432fb8` (the B22 discovery commit), 2026-10-01. Increment B22-A1 of the runbook's
B22 (`:882-942`), read with discovery section 7's [B22 lead] narrowing bullet, section 9.4 and the 9.5 items 15, 16 and 19. SEC-1
(`d0d2ec8`) had already closed D22-3 and D22-5's ngspice half; this increment closes what SEC-1 left of D22-4, kicad-cli's half of
D22-5, D22-8's output caps for kicad-cli and FreeRouting, and OD-150's approval half, and admits the first `b22-` suites to CI.

Test-first, twice. The first fix: six suites `app/lib/computation/__tests__/b22-a1-*.test.ts` were written and run RED on the
unmodified tree before any production edit - 64 failed / 25 passed of 89 (section 8) - then green; a self-review added two cases,
each red against an intermediate state, so 91 were green. The review: an adversarial review of that first fix CONFIRMED 16 findings
(four regressions, six coverage gaps, six weak or missing tests); each was reproduced by a new or strengthened case run RED on the
first fix - 40 failed / 353 passed of 393 across the four changed B22-A1 suites and SEC-1's - or, for a test-strength finding, by a
deliberate breakage of the source that the strengthened case catches, the source restored and checked by hash after each run (nine
breakages, section 8). Then fixed, and 137 B22-A1 tests are green ([B22-A1 lead] 134 before the lead's three non-ASCII continuation cases, section 12). **No process was started by this work**: every spawn in every
suite is an in-process fake (`node:child_process` for the ngspice paths, the bare `child_process` the two PCB runners import), and
the bounded reader's handle cases use a fake `FileHandle`; ngspice, kicad-cli and java were never run; the installed ngspice-46
code-model libraries were READ as strings, never loaded or run; no model, provider or network call. Production simulation authority
stays BLOCKED: the CD-10 routes, their 501 and its pin, and `executeAuthoritativeSimulation` are untouched, and nothing here calls a
subprocess a sandbox or authoritative.

## 0. What B22-A1 is

- **Delivers (CONFIRMED by the suites, section 8):** (1) the SPICE model screen reads exactly the text the deck emits and refuses a
  file read outside the run directory - a `.lib` line, an unsafe `.include`/`.inc` path, an XSPICE file parameter - and every code
  model of the installed ngspice-46 that starts a program or loads a library, reading XSPICE over the cards as ngspice joins them;
  it recomputes include dependencies from that text; the executed-deck screen reads the whole deck's cards the same way, across
  model boundaries; every refusal SEC-1 answered `422` before any job is still `422` before any job; (2) the ngspice output the smoke
  test returns and every stdout/stderr, failure message and log event a run record carries is bounded by one constant, with a
  truncation marker, and the reproducibility bundle says so; (3) kicad-cli gets an explicit environment allowlist and `windowsHide`;
  (4) kicad-cli's and FreeRouting's accumulated output is bounded in memory, in bytes, FreeRouting's stderr keeping its own share,
  and the files they write that Sirkit reads back go through a bounded reader that refuses an over-bound file unread; (5) every SPICE
  AI operation whose strings reach a deck, and the run request, is "review" and never pre-selected; (6) the `b22-` chapter is
  admitted to CI by one directory filter.
- **Is not:** no new route (the census stays 165 = 162 canonical + 3 factories + 0 raw), tool, control or runtime dependency; no
  change to the CD-10 routes, the 501 or `executeAuthoritativeSimulation`; no change to the ngspice environment allowlist, argv or
  kill semantics (B22-A3; SEC-1's suite still pins the allowlist literally); the worker's own whole read of `result.raw` stays
  (B22-A3); [superseded 2026-10-02 by the B22 closeout (D22-5, D22-8): since B22-A3 one runner passes the profile's exact map, which SEC-1's suite pins, and the worker's whole raw read is gone] the evidence half of OD-150 (D22-21) stays (B22-C); `/api/simulate` is unchanged (its own B19-D screens, bounded reader
  and output caps); the compile preview keeps a model's `.include`/`.lib` and XSPICE text for the user's own machine (SEC-1's
  decision, section 4 of its page; never executed by the server).
- **Stated additions beyond the task text (for the lead, section 11):** (a) a one-token `.lib` line is refused too (fail-closed;
  whether ngspice-46 reads its token as a file is **UNKNOWN**, and no executed deck has accepted any `.lib` line since SEC-1);
  (b) the path rule is an allowlist of plain relative names, so besides the task's forms it also refuses a home (`~`) path, a
  variable (`$x`, `%x%`, `{x}`), a Windows device name, a space and a quote; (c) the executed-deck screen also refuses an XSPICE file
  parameter (an advanced directive can carry the `.model` card, which the model screen never reads; red first, section 1);
  (d) the model screen's refusals of text SEC-1's final screen refused - a blank `transformedContent` hiding a refused original, an
  include in the text, every file read - are closed (`SPICE_DECK_UNSAFE`), so the runs preflight still answers them `422` before any
  job; the screen's own messages for text it refused before B22-A1 stay the worker's (`202`, the run failed before any deck, as SEC-1
  designed); (e) the smoke deck reads the same emitted text (a blank `transformedContent` now smoke-tests the original, as the run
  deck already emitted it); (f) the studio's AI drawer sentence states the new pre-selection; [B22-A1 review] (g) `d_process` and
  `d_cosim` cards are refused whatever they name - a plain relative program or library name included, since a spawn or a library
  load can search beyond the run directory (**INFERRED**); (h) a `.model` card is read token by token as XSPICE reads it, so a file
  parameter must be followed by a plain relative name (a value spelled exactly `file` at a card's end is refused, a fail-closed
  cost), and a `#`/`$` line is read as a card as well as skipped inside one; (i) model text that opens with a `+` line is refused
  (the deck would join it to the previous model's card); (j) the reproducibility bundle's README states the logs' bound.

## 1. The model screen screens what the deck emits (D22-4)

- **The defect (CONFIRMED at `0432fb8`).** `assertModelSafeForExecution` read `transformedContent ?? originalContent`
  (`models.ts:196`) while the deck emits `transformedContent?.trim() || originalContent.trim()` (`netlist.ts:48-50`), so an empty or
  whitespace `transformedContent` let an unscreened `originalContent` through; it refused only an absolute or UNC `.include`/`.inc`
  (`models.ts:203`; a single-backslash root-relative path passed), had no `.lib` rule and no XSPICE file-parameter rule, and
  trusted the client's `model.dependencies` (`models.ts:207-209`).
- **Red (CONFIRMED, `b22-a1-model-screen`, 31 failed / 14 passed of 45 on `0432fb8`).** Admitted by the screen: an empty and a
  whitespace `transformedContent` over a hostile original (a `.control`/`shell` block); 22 file reads - `.lib` with an absolute, UNC
  or relative path, `.LIB` indented, a one-token `.lib`, an `.include` root-relative with one backslash, an `.inc` drive-relative,
  `.include` traversing with slashes, backslashes, mid-path, double- and single-quoted, a prefix-spelled `.incl`, a home path, and
  XSPICE `file=` (quoted, unquoted, upper-case, a drive path), `input_file=` traversing, `state_file=` UNC, a `table2d` `file` split
  around its `=` over `+` continuation lines, a Windows device name and a `{param}` value; a client `dependencies: []` over an
  `.include` in the text; a recorded client dependency the text does not include (refused). At the fake spawn seam: the smoke test
  answered 200, wrote `smoke.cir` and spawned ngspice for model text naming `/marker.txt` in an XSPICE `file=`; `POST /api/spice/runs`
  answered 202, wrote `executed.cir` and spawned ngspice for the same model text and for an advanced directive carrying the XSPICE
  `.model` card; and the final deck screen admitted an executed deck whose model text names a host file in an XSPICE parameter.
- **First fix (CONFIRMED by reading).** One helper `emittedModelText` (`netlist.ts:48`, in place of `modelText`) gives the emitted
  text; the deck (`netlist.ts:239`), the model screen (`models.ts:196`) and the smoke deck (`smoke-test/route.ts:20`) all read it.
  The screen keeps its six rules (the dotted list stays `models.ts:200`), then refuses, closed (`SPICE_DECK_UNSAFE`, naming the rule
  and never the text), every `.lib` line and an `.include`/`.inc` (any line starting `.inc`, as ngspice reads it, **INFERRED**) whose
  path is not a plain relative name (`models.ts:305`); a plain relative name is letters, digits, `_ . + -` with `/` or a backslash
  between segments, no `..` segment and no device name (`netlist.ts:506`). Dependencies are recomputed from the screened text
  (`models.ts:208`), never taken from the client. A self-review added a vendor header comment naming its source file (refused by
  the first draft) and a `+ file=` line after a comment line inside a card (hidden by joining before dropping comments): each red
  against an intermediate state, the source restored and checked by hash.
- **The review (CONFIRMED, red on the first fix, then green; the red counts are in section 8):**
  - *regressions-1, coverage-3:* the first fix answered `202` with a job for two inputs SEC-1 refused `422` before any job - a blank
    `transformedContent` over a hostile original, and a plain relative `.include` in the text with a client `dependencies: []` (SEC-1's
    final screen refused both; the first fix's model screen refused them with a plain error, which the preflight leaves to the
    worker). Red: four runs-route cases answered `202`, `jobs: 1`, the run failed with a non-closed message; three smoke cases
    answered a non-closed `422`; SEC-1's own row "a model whose empty transformedContent hides a hostile originalContent" failed with
    `202`. Fix: a blank `transformedContent` hiding a refused original is refused closed (`models.ts:206`, `hidesOriginal` `:319`), and
    an include in the text is a closed refusal (`models.ts:210`); the preflight raises closed refusals (`job-store.ts:350`). Green:
    `422`, closed, no job, no deck, no process, for both inputs with and without an LF source value on the plan; SEC-1's row is back
    in its `422` list, unchanged from `0432fb8`. Kept: text the screen refused before B22-A1 (a `.control` line with no
    `transformedContent`) is still the worker's, `202`, even beside an LF source value (pinned in `b22-a1-model-screen`).
  - *tests-1:* the first fix joined `+` lines only after a space or a tab, read `file=` only, and the final screen read one line at a
    time. ngspice skips every character up to a space before a `+`, skips a `#`/`$` comment line inside a card and strips a `;`
    end-of-line comment, and XSPICE separates a parameter from its value by whitespace as well as `=` (**INFERRED** from ngspice's
    `inpcom.c` and `MIFgettok`; never executed). Red: the screen admitted a `table2d` `file` split over `+` lines whose second opens
    with a form feed or a control character, a parameter with no `=`, a `+ file =` / form-feed `+ "..."` split, a split across a `#`
    comment line and a value after a `;` comment; the final screen alone admitted the form-feed split and the no-`=` spelling; the
    runs route spawned ngspice for an advanced directive with the no-`=` spelling. Fix: one card reading, `ngspiceCards`
    (`netlist.ts:536`), for both screens; a `.model` card read token by token as XSPICE reads it (`xspiceTokens`, `:555`;
    `cardReadsOutsideRunDirectory`, `:563`); the reading done twice, form feeds as whitespace and as line breaks, either refusing
    (`:576`); the final screen reads the whole executed deck's cards after the title (`netlist.ts:479`, in place), and its per-line
    rule is back to SEC-1's (`netlist.ts:446`, as at `0432fb8`).
  - *coverage-1:* the first fix knew three parameter names. The installed ngspice-46 (`C:/Users/robsa/Tools/ngspice-46/Spice64`,
    whose `share/ngspice/scripts/spinit` loads all seven `lib/ngspice/*.cm` libraries; the worker runs `ngspice_con -b` without `-n`,
    so spinit loads) was READ with `strings`, never loaded or run. Its parameter tables (**CONFIRMED** by reading; that no parameter
    was missed is **INFERRED** from the descriptions):

    | library | code model | parameter naming a path, program or library | B22-A1 |
    |---|---|---|---|
    | analog.cm | `filesource` | `file` ("file name") | a plain relative name only |
    | analog.cm | `xfer` | `file` ("File in Touchstone format") | a plain relative name only |
    | table.cm | `table2d`, `table3d` | `file` ("file name") | a plain relative name only |
    | digital.cm | `d_source` | `input_file` ("digital input vector filename") | a plain relative name only |
    | digital.cm | `d_state` | `state_file` ("state transition specification file name") | a plain relative name only |
    | digital.cm | `d_process` | `process_file` ("file name of the executable process"), `process_params` | refused, whatever it names |
    | digital.cm | `d_cosim` | `simulation` ("A shared library containing a digital model"), `lib_args`, `sim_args` | refused, whatever it names |
    | spice2poly.cm, xtradev.cm, xtraevt.cm, tlines.cm | every model | none | unchanged |

    Red: the screen, the final screen alone and the runs route admitted `d_process` and `d_cosim` cards (upper case, split over a
    continuation line, in model text and in an advanced directive; the runs route wrote the deck and spawned ngspice; the smoke test
    answered 200 and spawned it). Fix: `XSPICE_FILE_PARAMETERS`, `XSPICE_REFUSED_WORDS` and `XSPICE_REFUSED_ANYWHERE`
    (`netlist.ts:524-527`). `xfer`'s Touchstone `file` with a host path was already refused by the `file=` rule and is pinned now.
  - *coverage-2:* the deck emits each bound model's lines right after the previous model's (`netlist.ts:235-240`), so model B's `+`
    line continues model A's last card. Red: model A ending `... file` and model B opening `+ = "/marker.txt")` each passed the
    screen, the final screen alone admitted their deck, and the runs route answered 202, wrote the deck and spawned ngspice. Fix:
    the model screen refuses text that opens with a `+` line (`models.ts:311`) and a file parameter with no value after it; the final
    screen joins across models (`netlist.ts:479`). Green: 422 closed, no job, no deck, no process.
- **Green (CONFIRMED):** `b22-a1-model-screen` 78/78. Legitimate vendor text - SEC-1's `Cd`/`Load`/`Define`/`Set`/`Source` cards,
  `.subckt` with `.param`/`.func`/`.model`, relative XSPICE data file names (`file="pwl-data.txt"`, `input_file=source.txt`,
  `state_file="models/state.in"`), a vendor header comment naming its source file, and [B22-A1 review] a relative data file on a `+`
  continuation line and a relative `xfer` Touchstone file - passes the screen, compiles to a deck that carries every line, previews,
  smoke-tests (200, one spawn) and runs (202, one deck, one spawn). Behind the model screen (switched off by a seam in the suite),
  the smoke deck's executed reading still refuses a traversing `.include` and a `.lib` read (SEC-1's tests-1 pin, kept), and the
  final screen alone refuses a host-path XSPICE parameter, the form-feed split, the no-`=` spelling, `d_process`, `d_cosim` and the
  two-model split, and admits a relative name.
- **RECORDED, not claimed:** that ngspice reads any `.inc`-prefixed line as an include, how it stitches continuation lines, how
  XSPICE tokenizes a `.model` card, that an XSPICE model reads its file at instance set-up, that `d_process`'s spawn and
  `d_cosim`'s library load search beyond the run directory, and that a one-token `.lib` line names no file are **INFERRED** or
  **UNKNOWN**; no hostile model was ever run. Whether numparam can substitute a string into a bare `file=name` value is **UNKNOWN**
  (a `{...}` value is refused). Fail-closed costs: a quoted name with a space (`file="my data.txt"`), a value spelled exactly `file`
  at a card's end, and a `#`/`$` comment line naming a host file are refused.

## 2. The diagnostic channels are bounded (D22-4, D22-8)

- **The bounds (CONFIRMED, `app/lib/computation/output-bounds.ts`):** `DIAGNOSTIC_OUTPUT_MAX_BYTES` = 65536 (64 KiB) bounds each
  returned or recorded stdout and stderr; `DIAGNOSTIC_EXCERPT_MAX_BYTES` = 1024 (a sixty-fourth of it, decided by the one constant)
  bounds a run record's one-line texts, a progress log event and a failure message. A cut text keeps its tail (where a failure
  prints), is cut on a UTF-8 character boundary, and opens with the marker `[SIRKIT: earlier output truncated]\n`; the whole text,
  marker included, is within the bound.
- **Red (CONFIRMED, `b22-a1-diagnostic-bounds`, 6 failed / 1 passed of 7 on `0432fb8`):** the smoke test returned up to 100,000
  characters per channel with no marker (`smoke-test/route.ts:103`; 200,000 bytes for a two-byte character); a run record carried
  the worker's whole accumulated stdout and stderr (up to its 100 MB kill bound) in the failed, no-waveform, cancelled and completed
  results (`worker.ts:193-200, :212-213, :243-244`), a 3,000-character failure message and 1,500-character log events, none marked
  (`worker.ts:186, :200`); the module did not exist. A short smoke output came back unchanged (green before and after).
- **Fix:** the smoke test bounds what it returns (`smoke-test/route.ts:103`); the worker bounds every stdout/stderr a record carries,
  the failure message and each log event (`worker.ts:186, :193, :196, :200, :212, :243`). Diagnosis still reads the whole in-memory
  log (`diagnoseNgspiceLog`), so a cut channel never hides a recognised failure.
- **The review:** *regressions-3:* the first fix set the excerpt bound to 4,096 bytes, above the 1,500 and 3,000 characters it
  replaced; red: the constant pin and the failed-run case (a 4,096-byte failure message); fix: a sixty-fourth, 1,024 bytes
  (`output-bounds.ts:22`), pinned at or below both old bounds. *coverage-5, tests-4:* the timed-out result (`worker.ts:196`) had no
  case; a new one (a hanging fake, a 20 ms limit) catches its bound removed (breakage M5). *regressions-4:* the reproducibility bundle
  zips the record's logs (`spice/runs/[id]/bundle/route.ts:30-31`), now bounded, while its README said the logs were preserved; red:
  the bundle of a failed run with long output; fix: the README states the bound and the marker (`bundle/route.ts:33`, the import
  `:8`, both in place). While building that case, a COMPLETED run's bundle answered `409` and its record never finished: D22-7
  (B22-C) observed at the fake seam - the worker's own "completed" event (`worker.ts:226`) makes the record terminal before its
  result is merged (`job-store.ts:148`); **CONFIRMED** at the fake seam only, not changed here, so the case uses a failed run.
- **Green:** 9/9.
- **RECORDED, not closed:** a bounded channel still carries what the process printed, up to the bound - a file a hostile deck made
  ngspice print would reach a caller up to 64 KiB. Still unbounded or separate: the run directory's `stdout.log`/`stderr.log` keep
  the whole output up to the worker's 100 MB kill bound (B22-A3, the per-run directory and its cleanup); `diagnoseNgspiceLog`'s raw
  excerpts are bounded by their own numbers, not by the one constant - at most five per pattern for 14 patterns, 2,000 characters
  each, about 140,000 characters in all, or a 3,000-character fallback (`diagnostics.ts:122, :136`) - and the smoke test and every
  failed record carry them; a run record's event list has no count bound (`job-store.ts:95`): one log event of at most 1 KiB every
  120 ms for the 120 s timeout, about 1 MiB a run; `/api/simulate` keeps its own caps (1 MB per stream, 3,000-character errors) [superseded 2026-10-02 by the B22 closeout (D22-8): since B22-A3 the run directory keeps no whole stdout.log or stderr.log - nothing writes either there, and the runner removes the directory in its finally (after a kill_unconfirmed, again once the child's close is observed) - and /api/simulate's per-stream cap is the runner's 64 KiB; the 3,000-character error cap stands]; the
  SPICE AI `diagnose_failure` tool reads browser-supplied run records (D22-21, B22-C).

## 3. kicad-cli's explicit environment (D22-5)

- **The defect (CONFIRMED at `0432fb8`):** `kicad-cli-runner.ts:50-53` passed no `env`, so Node's default - the whole server
  environment, every provider, database, Supabase and distributor key - reached kicad-cli; no `windowsHide`.
- **Red (CONFIRMED, `b22-a1-secret-env`, 2 failed of 2 on `0432fb8`):** the fake `child_process` seam saw no `env` option (six
  canary names set in the test process, assembled at runtime with fake values, all inherited) and no `windowsHide`; the helper and
  the list did not exist.
- **Fix:** `kicadCliEnvironment()` (`kicad-cli-runner.ts:58`) keeps only the allowlisted keys of the environment, and `NODE_ENV`
  as the FreeRouting precedent `freeroutingEnvironment()` does; the spawn passes it and `windowsHide: true`
  (`kicad-cli-runner.ts:92-93`), with its stdio and cwd unchanged.

The allowlist: `PATH`, `Path`, `PATHEXT`, `SystemRoot`, `SystemDrive`, `WINDIR`, `TEMP`, `TMP`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `HOME`, `LANG`, `LD_LIBRARY_PATH`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `KICAD_CONFIG_HOME` (and NODE_ENV).

- **Green:** 2/2 - the spawn's `env` holds only allowlisted keys and none of the canaries, `PATH` reaches the child, `windowsHide`
  is true; the list is pinned literally and the helper keeps exactly those keys. The review found nothing here.
- **INFERRED, not CONFIRMED:** that this list is what kicad-cli needs to find its install, libraries, per-user settings and a temp
  directory (from the FreeRouting precedent and KiCad's documented settings paths). kicad-cli was never run here; the opt-in
  `kicad-cli-oracle` suite (`KICAD_CLI` set) runs the real fab bundle through this runner and is the live check (skipped here).
  The ngspice allowlist is untouched: HOME and USERPROFILE in it, and `-n` on no spawn, stay with B22-A3. [superseded 2026-10-02 by the B22 closeout (D22-5): closed by B22-A3 - one runner passes the profile's exact map, no HOME or USERPROFILE in it, and every run carries -n (Node's eight win32 additions recorded, OD-156)]

## 4. Output caps for kicad-cli and FreeRouting (D22-8, OD-148)

- **The bound on a file read back (CONFIRMED, `output-bounds.ts`):** `TOOL_OUTPUT_FILE_MAX_BYTES` = 67108864 (64 MiB) per file.
  `readBoundedFile` follows `/api/simulate`'s `readBoundedRawFile` (`simulate/route.ts:222-254`) [B22 lead, 2026-10-02: since B22-A3 that reader is the diagnostic runner's `readBoundedRawFile`, diagnostic-runner.ts]: a handle, the declared size as an
  advisory fast-fail, 64 KiB chunks grown with the bytes actually read, a refusal on crossing the bound (never a partial read), the
  handle closed on every path.
- **Red (CONFIRMED, `b22-a1-tool-output-bounds`, 7 failed / 3 passed of 10 on `0432fb8`):** kicad-cli kept a 1 MB stdout and stderr
  whole on success, failure and timeout (`kicad-cli-runner.ts:64-69`); FreeRouting returned 2 MB of joined diagnostics
  (`runner.ts:178-183`) and read a 64 MiB + 1 byte `.ses` whole, returning `ok: true` (`runner.ts:206`); the fab bundle read and
  zipped a 64 MiB + 1 byte gerber and drill file (`build-bundle.ts:182, :208`); the reader did not exist. Green before and after: a
  short kicad-cli run, a normal `.ses` (unchanged, 25 bytes), a normal bundle.
- **Fix:** both runners collect each stream with `createDiagnosticCollector` (`kicad-cli-runner.ts:81`, `runner.ts:149`); FreeRouting
  reads the `.ses` through `readBoundedFile` and refuses an over-bound one, unread, with a closed message and `error: "io"`,
  `outputFileStatus: "not-checked"` (`runner.ts:207-215`; the result type is unchanged); the fab bundle reads every gerber and drill
  file through `readKicadCliOutput` (`build-bundle.ts:301`), which refuses an over-bound file with a closed
  `KicadCliError("cli-failed")` naming the step and the bound, and lets an unreadable file fail with its own error, as before.
- **The review:** *regressions-2:* the first fix joined FreeRouting's stderr and stdout into one tail-cut text, so a stdout near the
  bound pushed the whole stderr - where java prints its exception - out of the result that the production router and the pass
  executor report. Red: a short exception beside a 70,000-byte stdout, and a 10 KiB stack trace's header line beside a 60 KiB
  stdout, were both lost. Fix: `joinDiagnosticTexts` (`output-bounds.ts:111`, used at `runner.ts:149`) gives stderr up to half the
  bound and stdout the rest, each tail-cut and marked, the whole within the bound. *tests-3:* nothing pinned what a collector HOLDS
  (its returned text is bounded either way), and the cut counted UTF-16 units, so three-byte output was held to about six times the
  bound. Fix: the cut counts UTF-8 bytes (`output-bounds.ts:62`) and `heldBytes()` lets a test see what is held; the new case (2,000
  small one- and three-byte appends to a 4 KiB collector) failed without the seam, then catches the cut removed (M4: 200,014 and
  600,014 bytes held of an 8,192 bound) and the cut counted in units again (M4b: 24,495 bytes held). *tests-2:* every over-bound case was
  refused by the declared-size fast-fail, so the bound on bytes actually read, the "refused unread" claim and the handle close were
  unpinned; four cases with a fake `FileHandle` (a declared 1e15 bytes: no read, one close; a stat of 10 that streams ten 64 KiB
  chunks past a 100,000-byte bound: refused after two reads, one close; a read error and a stat error: unreadable with their error,
  one close each; a close error: the complete read stands) catch the read bound removed (M1), the fast-fail removed (M2) and the close
  dropped (M3). *tests-5:* the `.ses` read's missing and empty branches had no offline case; two cases (no `.ses`: `error: "io"`,
  `outputFileStatus: "missing"`, the diagnostics or the plain message; a blank `.ses`: `output-empty`, `empty`) catch each mislabelled
  (M6, M6b). *coverage-6:* FreeRouting's uuid files are at `runner.ts:129-130` (this page said `:128-129`).
- **Green:** 20/20, with the existing `runner-security`, `kicad-cli-runner`, `build-bundle`, FreeRouting route, fab and gerbers-route
  suites unchanged and green (section 8).
- **RECORDED, not closed:** the processes can still WRITE files of any size to the temporary directory; Sirkit only refuses to read
  one over the bound (no file-size limit on any spawn, B22-A2/A3; OS isolation, LB-10). FreeRouting's shared `tmpdir()` cwd and its
  uuid files there (`runner.ts:129-130, :161`) stay with B22-A3. [superseded 2026-10-02 by the B22 closeout (D22-8): B22-A3 changed ngspice only - FreeRouting's shared tmpdir() cwd and uuid files are unchanged and stay open]

## 5. SPICE AI approval levels (OD-150, the approval half)

- **The defect (CONFIRMED at `0432fb8`):** the route labelled `create-test` and every overlay "automatic" (`ai/route.ts:68-72`),
  a variable without a distribution "automatic" (`:206`) and the run request "automatic" (`:228`); the studio pre-selected every
  "automatic" entry (`SpiceStudio.tsx:461`) and starts the run plans of the selected run requests on Apply (`:467-475`), so one Apply
  ran a model-written overlay, variable and run request.
- **Red (CONFIRMED, `b22-a1-spice-ai-approval`, 11 failed / 7 passed of 18 on `0432fb8`):** "automatic" for `create_test`, the five
  overlay kinds, a variable without a distribution and `run_simulation`; the table and the pre-selection function did not exist;
  the studio pre-selected by the recorded level. (The suite's first red run had 16 failed / 2 passed: its harness built a new
  project per exchange, so five cases failed on "Test ... was not found" instead of the level; the harness was fixed in the test and
  the suite re-run red on the unmodified source.)
- **Fix:** one table `SPICE_AI_APPROVAL` (`app/lib/spice/ai-approval.ts:13`); the route's `approvalFor` returns it
  (`ai/route.ts:71`), also for a variable and the run request (`:206`, `:228`); the studio pre-selects only an entry whose recorded
  level AND whose kind's level are both "automatic" (`preselectedOperationIndexes`, `ai-approval.ts:36`; `SpiceStudio.tsx:461`), so
  a forged "automatic" on a deck-reaching kind, an unknown kind or a run request is never pre-selected; Apply still starts only the
  run requests a human selected (`SpiceStudio.tsx:472`, unchanged). The drawer's sentence now says what arrives selected.
- **The review:** *tests-7:* no fixture entry had an automatic kind with a non-automatic recorded level, so the AND was unpinned,
  and the studio was checked for one string only. Strengthened: a measurement recorded "review" and a specification recorded
  "explicit" stay unselected, and `SpiceStudio.tsx` holds exactly one `setApprovedOps(` call, the pre-selection, right after it
  records the proposal; together they catch the AND dropped and a second pre-selection added (M7, both cases red).
- **Green:** 18/18. Every operation kind and its level:

| operation kind | level | before B22-A1 | why |
|---|---|---|---|
| `create-test` | review | automatic | its name is the deck title and every run point's label |
| `duplicate-test` | review | automatic | the copy's name is the deck title (no AI tool proposes it today) |
| `assign-model` | review | review | the bound model's text and pin map write the part's element lines |
| `add-overlay-element` | review | automatic | element names, values and waveforms are deck lines |
| `set-variable` | review | automatic without a distribution, review with one | a `.param` line |
| `configure-analysis` | review | review | the analysis directive |
| `configure-sweep` | review | review | run point values and labels |
| `configure-corners` | review | review | run point values, temperatures and labels |
| `set-solver-profile` | review | review | `.options` lines (no AI tool proposes it today) |
| `request-run` | review | automatic | applying it starts the run plan |
| `define-measurement` | automatic | automatic | never written to a deck: evaluated in-process after the run (SEC-1 pins a measurement expression as never written) |
| `define-specification` | automatic | automatic | never written to a deck: a pass/fail limit on a measurement |
| `propose-design-patch` | explicit | explicit | never applied by the studio (`applyOperation` refuses it) |

- Read-only tools (`inspect_schematic`, `audit_simulation_readiness`, `search_models`, `estimate_run_plan`, `read_results`,
  `diagnose_failure`, `compare_runs`, `ask_user`, `submit_proposal`) record no operation and are unchanged. The evidence half of
  OD-150 (D22-21: evidence built from browser-supplied run records, `ai/route.ts:233`) is not in A1 (B22-C).

## 6. CI admission (OD-146)

- **Red (CONFIRMED):** with `b22-` added to `CHAPTERS` first, the guard `b19-e-ci-job-scope` failed 1 / passed 11 of 12 - its
  `it.each(CHAPTERS)` case listed the six `b22-a1` suites as admitted by no filter.
- **Fix:** one directory filter `app/lib/computation/__tests__` in `prompt-to-gerber` (workflow `:226`, after SEC-1's entry), and
  `b22-` in `CHAPTERS` (`b19-e-ci-job-scope.test.ts:54`, in place, its comment extended on the line above). No `it(` was added to the
  guard, so B21's `b21-a-page` case 4 pin (8 blocks) stands; a run prints 8 + 4 = 12 tests. No `b22-` suite starts PGlite; no
  explicit entry duplicates the filter (the guard's redundancy rule). The review added no suite file, so the filter is unchanged.
- **Green:** the guard 12/12. The inserted workflow line moved B21's `evaluation-matrix.md` citations C49, C93 and C94 by one line
  (`b21-f-page` case 6 red: 1 failed / 18 passed of 19, run on the pre-re-pin page and restored by hash); re-pinned in place (section
  7), then green.

## 7. Pin moves

Each is a reviewed move with its reason written beside it in the file.

- `app/lib/spice/__tests__/sec-1-deck-injection.test.ts` - [B22-A1 review] every move is now line-neutral against `0432fb8` (the
  first fix had shifted the suite by up to ten lines; discovery's citations into it, `:743-747`, `:781-789`, `:879-885`, `:925-933`,
  land on the same lines as at `0432fb8`, checked); the suite keeps its 268 cases:
  - `:580-588` - the four model texts SEC-1 showed pass the model screen and are refused by the final screen: the precondition "the
    existing model screen admits it" becomes a per-row expectation (the screen now refuses the empty-`transformedContent`
    differential, the traversing `.include` and the `.lib` read, and still admits a `*#` line); the final-screen refusal - the case's
    point - is unchanged (`compileWith` never runs the model screen). The note trails the `it.each` line.
  - `:813` - "a model whose empty transformedContent hides a hostile originalContent" stays in the `422` list, unchanged from
    `0432fb8` (the first fix had moved it to the `202` list; regressions-1 restored SEC-1's answer).
  - `:815` - "a model with a recorded include dependency, on a plan whose source value carries LF" moved from the `202` list to the
    `422` list, its input unchanged: the model screen judges include dependencies by the text, never the client's `dependencies`, so it
    admits this model and the preflight refuses the plan's LF source value - `422` before any job (was `202`, the worker's
    "unresolved include dependency"); a text include is refused `422` closed in `b22-a1-model-screen`.
  - `:904-910` - the two smoke cases (SEC-1's tests-1) now expect the model screen to refuse first, closed; the outcome (`422`
    closed, no file, no process) is unchanged; the final screen's executed reading stays pinned behind the model screen in
    `b22-a1-model-screen` section 5. The note trails the `it.each` line.
- `app/api/__tests__/b16-0-23-tranche-parity.test.ts:337-339` - "unresolved include dependencies fail closed" now puts the include
  in the model text (was a client `dependencies` entry); refusal, `422` and zero spawns unchanged; [B22-A1 review] the message is now
  closed (`SPICE_DECK_UNSAFE: model text has 1 unresolved include dependency file(s); ...`, no model name), which the case's
  `toContain("unresolved include dependency")` still holds.
- `b16-0-23-tranche-parity.test.ts:627` - the run request's level is "review" (was "automatic"), OD-150.
- `b16-0-23-tranche-parity.test.ts:315` (hygiene, not a pin): the file held a raw NUL byte in a string literal; it is now built at
  run time (`String.fromCharCode(0)`), the same string, so the staged file carries no control byte.
- `artifacts/ai-control-plane-b21/evaluation-matrix.md` C49, C93, C94 - re-pinned +1 (331, 334, 343) with a dated note: the B22-A1
  filter at workflow `:226`.
- `artifacts/ai-control-plane-b21/orchestration-contracts.md:351` - a dated note: the guard prints 8 + 4 = 12 tests since `b22-`.
- `artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md` - four dated notes where B22-A1 supersedes SEC-1's record (the
  smoke screen no longer the only guard; the XSPICE residual closed, with `d_process`/`d_cosim` and the joined-card reading; the
  "left to the worker" bullet narrowed to the screen's own messages; the "kept as they are" list), each at its own line's end.
- Line-neutral by design: `netlist.ts` (`:446` is again SEC-1's line; the whole-deck reading took the existing `:479`), `models.ts`
  (the dotted list stays `:200`), `worker.ts`, `smoke-test/route.ts`, `spice/runs/[id]/bundle/route.ts`, `ai/route.ts`,
  `build-bundle.ts`, `runner.ts` and `SpiceStudio.tsx` keep every cited line (new imports took an existing blank line; new helpers
  were appended), so the SEC-1 page's citations and its page case need no re-pin.

## 8. Gates

All under the global heavy-job lock (`run.sh` for vitest with two workers, `heavy.sh` for tsc, eslint and tsx); every exit code
captured; `SPICE_WORKER_LIVE` and `KICAD_CLI` unset for every vitest run, so no live suite ran. Every gate below ran again after the
review's last source edit; the page suites ran after the page's last edit.

| suite | it( / it.each( blocks | runtime tests | red on `0432fb8` | red on the first fix (the review) | green |
|---|---|---|---|---|---|
| `app/lib/computation/__tests__/b22-a1-model-screen.test.ts` | 23 | 78 | 31 failed / 14 passed of the first 45 (two self-review cases red against intermediate states) | 32 failed / 46 passed of 78 | 78 passed |
| `app/lib/computation/__tests__/b22-a1-diagnostic-bounds.test.ts` | 9 | 9 | 6 failed / 1 passed of 7 | 3 failed / 6 passed of 9 (the bundle case re-run after its harness waited for the merged record; M5 for the timeout case) | 9 passed |
| `app/lib/computation/__tests__/b22-a1-tool-output-bounds.test.ts` | 18 | 20 | 7 failed / 3 passed of 10 | 4 failed / 16 passed of 20 (M1, M2, M3, M4, M4b, M6, M6b for the test-strength cases) | 20 passed |
| `app/lib/computation/__tests__/b22-a1-secret-env.test.ts` | 2 | 2 | 2 failed | (no finding) | 2 passed |
| `app/lib/computation/__tests__/b22-a1-spice-ai-approval.test.ts` | 4 | 18 | 11 failed / 7 passed | 0 failed (test strength: M7, 2 failed / 16 passed) | 18 passed |
| `app/lib/computation/__tests__/b22-a1-page.test.ts` | 7 | 7 | 7 failed (no page) | (the page) | 7 passed |

- **The review's red run** (the four changed B22-A1 suites and SEC-1's on the first fix): 5 files, 40 failed / 353 passed of 393 -
  `b22-a1-model-screen` 32, `b22-a1-tool-output-bounds` 4 (the two regressions-2 cases, and the two tests-3 cases, which failed for
  want of the `heldBytes()` seam - what they catch is shown by M4 and M4b), `b22-a1-diagnostic-bounds` 3 (its bundle case first failed on `409`, the D22-7 observation of
  section 2; re-run after the harness waited for the merged record of a failed run: 3 failed / 6 passed of 9, the README's
  "preserved" sentence) and SEC-1's restored row 1.
- **Deliberate breakages** (`mut.py` in the scratch directory; each source restored and checked by hash after its run): M1 the bound
  on bytes read removed - 1 failed / 19 passed of 20 (`ok: true` with 655,360 bytes); M2 the declared-size fast-fail removed - 2
  failed / 18 passed; M3 the handle close dropped - 4 failed / 16 passed; M4 the collector's cut removed - 2 failed / 18 passed (200,014 and 600,014 bytes held); M4b
  the cut counted in UTF-16 units - 1 failed / 19 passed (24,495 bytes held of an 8,192 bound); M5 the timed-out record unbounded -
  1 failed / 8 passed of 9 (300,014 bytes of stdout); M6 a missing `.ses` reported as over the bound - 1 failed / 19 passed; M6b an empty `.ses` reported as
  `io` - 1 failed / 19 passed; M7 the AND dropped and a second studio pre-selection - 2 failed / 16 passed of 18.
- **The six suites after the fix and SEC-1's** (`b22-a1-*` but the page, `sec-1-deck-injection`): 6 files, 395 passed; exit 0.
- **SPICE, simulate, the new folder and the CI guard** (`app/lib/computation/__tests__` with the page, `app/lib/spice/__tests__`
  with SEC-1's 268 cases, `app/api/simulate/__tests__` with `b19-d-deck-injection`, `b19-e-ci-job-scope`): 15 files (14 passed, 1
  skipped: the opt-in `worker-integration`), 442 passed, 3 skipped; exit 0.
- **Every suite reading a changed file** (FreeRouting: `app/lib/pcb/autoroute/__tests__`, the autoroute route, `b16-0-13-tranche-parity`;
  fab and bundle: `build-bundle`, `kicad-cli-runner`, `kicad-cli-oracle` (opt-in, skipped), `app/api/pcb/export/gerbers/__tests__`,
  `app/lib/pcb/fab/__tests__`; SPICE AI route, studio and the SPICE bundle route: `b16-0-23-tranche-parity`,
  `b16-0-4-bounded-body-behavior`, `b16-0-5-media-type-and-wrapper`, `b07-5-async-ownership-closure`, `b17-a-control-inventory`,
  `b07-1-identity-geometry-gestures`; the confinement gates `b16-0-23-tranche16` and `b16-0-24-tranche17`; `b16-0-2-gates`,
  `b16-0-8-migration-ratchet`): 26 files, 405 passed, 2 skipped; exit 0. (`b16-0-2-spice-scope-isolation`, which reads the bundle
  route, runs in the SPICE gate above.)
- **Import gates and census** (`b20-b2`, `b20-b3`, `b20-d3` authority, `b14-4` AST, `b15-3`, `b18-b` import gates;
  `b16-1c-invariant-tripwires` (165 / 162 / 3 / 0); `b20-b2-route-tree`, `b20-b2-route-matrices-pinned`, `b16-0-1-ci-gates`,
  `b16-0-4-authorization-and-body-gates`, `b16-0-7-wrapper-adoption-gate`, `b16-0-7-analyzer-hardening`,
  `b16-0-24-1-security-correction`, `b16-0-24-tranche-parity`, `b20-c1-three-way-parity`; `b20-b4-process-gate` (still exactly the
  five spawners - the new module imports no process module), `b20-b4-stop-evidence`, `b20-b4-withhold-proposals`,
  `b16-0-23-adapter-schema-parity`): 20 files, 218 passed; exit 0.
- **B21's page pins** (`app/lib/agent/orchestration/__tests__`): 49 files, 460 passed; exit 0.
- `tsc --noEmit -p tsconfig.json`: exit 0. `eslint` on the 22 changed or new TypeScript files: exit 0.
- Route-source generators: `generate-b16-0-4-artifacts.ts` (165 + 165 rows), `generate-b16-0-7-artifacts.ts` (165 / 162 / 3 / 0),
  `generate-b16-0-8-baseline.ts` (3 -> 3): each exit 0, zero drift (`git status`, every changed file's hash and the diff's hash
  identical before and after).
- **Not run, by rule:** `app/lib/pcb/__tests__/autoroute-boundary-integrity.test.ts` (it spawns the real bundled FreeRouting under
  java, with no opt-in guard); the opt-in live suites; no browser spec; no full suite.

## 9. What stays open

- **D22-4:** the compile preview keeps a model's `.include`/`.lib` and XSPICE text (SEC-1's decision, for the user's own machine;
  never executed by the server) - RECORDED; the run manifest's model checksum still hashes `transformedContent ?? originalContent`
  (`server/manifest.ts:30`), not the emitted text - an evidence-identity gap for B22-C (D22-13), found while enumerating; the bounded
  channels still carry process output up to their bound, the diagnostic excerpts keep their own bounds and a record's event list
  has no count bound (section 2); the XSPICE readings of ngspice's line stitching and tokenizer are INFERRED until a live probe
  (B22-A3's runner) checks them; a `.spiceinit` in the run directory or HOME, and an `osdi` load, are B22-A3's (HOME, `-n`); one
  shared deck validator across `/api/simulate` and the Studio path is left to OD-136's single diagnostic runner (B22-A3). [superseded 2026-10-02 by the B22 closeout (D22-4): closed in part - the model checksum hashes the emitted text (B22-C) and every run passes -n so ngspice skips a .spiceinit and any osdi load in one (B22-A3; its effect INFERRED until a live run); still open: the XSPICE card and token readings (INFERRED until a live probe - neither live suite carries an XSPICE case), one shared deck validator (/api/simulate and the Studio keep their own screens), a count bound on a record's event list, the bounded channels and the excerpts' own bounds, and the preview's .include (by design)]
- **D22-5:** HOME and USERPROFILE in the ngspice allowlist, no `-n` on any spawn, and the B16.0.23 gate and boundary record that
  neither pin nor list env - B22-A3; the kicad-cli allowlist's adequacy is **INFERRED** until the opt-in oracle runs. [superseded 2026-10-02 by the B22 closeout (D22-5): the ngspice half closed by B22-A3 - the exact map without HOME or USERPROFILE, -n on every run, the B16.0.23 records noted - except Node's eight win32 additions, which OD-156 records]
- **D22-7 (B22-C):** observed at the fake seam while building the bundle case (section 2): a completed run's record never receives
  its result, and its bundle answers `409`. Not changed here. [superseded 2026-10-02 by the B22 closeout (D22-7): closed by B22-C - the job store attaches the result and its evidence before it publishes the terminal status]
- **D22-8:** the worker's whole read of `result.raw` (`worker.ts:205`) and the bundle route's (`spice/runs/[id]/bundle/route.ts:38`),
  the per-run directories never removed and their host path in records, FreeRouting's shared cwd, the run directory's whole logs
  (the bundle carries the record's bounded logs and says so), and no CPU, memory, process or file-size limit on any spawn - B22-A3
  (and B22-A2's profiles; LB-10 for isolation). [superseded 2026-10-02 by the B22 closeout (D22-8): the ngspice parts closed by B22-A3 - no whole raw read, per-run directories removed in the runner's finally (after a kill_unconfirmed, again once the child's close is observed), no host path in records; FreeRouting's shared cwd and the absence of any OS CPU, memory, process or file-size limit stay open (OD-145, LB-10)]
- **OD-150:** the evidence half (D22-21) - B22-C. [superseded 2026-10-02 by the B22 closeout (OD-150): every evidence reference is labelled caller-supplied (B22-C, D22-21); resolving references to server-held records waits for the aggregate's binding]
- **Kill semantics, concurrency (D22-9), parsers (D22-10) and the rest of D22-1..24** - their increments, unchanged here.

## 10. Citations

Each row resolves by content on the line it names (the page case 5 checks every row).

| id | file | line | anchor | what |
|---|---|---|---|---|
| C1 | `app/lib/computation/output-bounds.ts` | 19 | `export const DIAGNOSTIC_OUTPUT_MAX_BYTES = 64 * 1024;` | the one constant |
| C2 | `app/lib/computation/output-bounds.ts` | 22 | `export const DIAGNOSTIC_EXCERPT_MAX_BYTES = DIAGNOSTIC_OUTPUT_MAX_BYTES / 64;` | a record's one-line texts, 1 KiB |
| C3 | `app/lib/computation/output-bounds.ts` | 24 | `export const TOOL_OUTPUT_FILE_MAX_BYTES = 64 * 1024 * 1024;` | a file read back |
| C4 | `app/lib/computation/output-bounds.ts` | 26 | `export const OUTPUT_TRUNCATION_MARKER =` | the marker |
| C5 | `app/lib/computation/output-bounds.ts` | 40 | `export function boundDiagnosticText(` | the bound on a text |
| C6 | `app/lib/computation/output-bounds.ts` | 54 | `export function createDiagnosticCollector(` | the bound on a stream |
| C7 | `app/lib/computation/output-bounds.ts` | 62 | `if (heldBytes > maxBytes * 2) {` | the stream's cut, in bytes |
| C8 | `app/lib/computation/output-bounds.ts` | 82 | `export async function readBoundedFile(` | the bounded reader |
| C9 | `app/lib/computation/output-bounds.ts` | 94 | `if (total > maxBytes) return { ok: false, reason: "over-limit" };` | the bound on bytes actually read |
| C10 | `app/lib/computation/output-bounds.ts` | 111 | `export function joinDiagnosticTexts(` | stderr's own share |
| C11 | `app/lib/spice/netlist.ts` | 48 | `export function emittedModelText(` | the one emitted-text helper |
| C12 | `app/lib/spice/netlist.ts` | 239 | `else if (emittedModelText(model) &&` | the deck emits it |
| C13 | `app/lib/spice/netlist.ts` | 446 | `!includes.has(text)) throw new SpiceDeckSafetyError("the deck reads a file the compiler did not include");` | SEC-1's line rule, as at `0432fb8` |
| C14 | `app/lib/spice/netlist.ts` | 479 | `readsXspiceFileOutsideRunDirectory([...first.split(` | the executed deck's cards, read whole |
| C15 | `app/lib/spice/netlist.ts` | 506 | `export function plainRelativeFileName(path: string): boolean {` | the plain relative name |
| C16 | `app/lib/spice/netlist.ts` | 513 | `const XSPICE_FILE_PARAMETER =` | a `name=value` file parameter |
| C17 | `app/lib/spice/netlist.ts` | 524 | `const XSPICE_FILE_PARAMETERS: ReadonlySet<string> = new Set(["file", "input_file", "state_file"]);` | the file parameters |
| C18 | `app/lib/spice/netlist.ts` | 525 | `const XSPICE_REFUSED_WORDS: ReadonlySet<string>` | `d_process`, `d_cosim` and their parameters |
| C19 | `app/lib/spice/netlist.ts` | 527 | `const XSPICE_REFUSED_ANYWHERE =` | refused on any card |
| C20 | `app/lib/spice/netlist.ts` | 536 | `export function ngspiceCards(text: string, formFeedBreaks = false): string[] {` | the cards as ngspice joins them |
| C21 | `app/lib/spice/netlist.ts` | 555 | `function xspiceTokens(card: string): string[] {` | a `.model` card's tokens |
| C22 | `app/lib/spice/netlist.ts` | 563 | `function cardReadsOutsideRunDirectory(card: string): boolean {` | one card |
| C23 | `app/lib/spice/netlist.ts` | 576 | `export function readsXspiceFileOutsideRunDirectory(text: string): boolean {` | both readings |
| C24 | `app/lib/spice/models.ts` | 196 | `const content = emittedModelText(model);` | the screen reads the emitted text |
| C25 | `app/lib/spice/models.ts` | 200 | `label: "filesystem or shell commands"` | the dotted list, unchanged (SEC-1's page cites it) |
| C26 | `app/lib/spice/models.ts` | 206 | `if (hit) throw hidesOriginal(model) ? new SpiceDeckSafetyError(` | a hidden original, closed |
| C27 | `app/lib/spice/models.ts` | 207 | `assertModelFileReadsSafe(content);` | the closed file-read refusal |
| C28 | `app/lib/spice/models.ts` | 208 | `const dependencies = modelIncludeDependencies(content);` | dependencies from the text |
| C29 | `app/lib/spice/models.ts` | 210 | `unresolved include dependency file(s); package them before execution` | an include, closed |
| C30 | `app/lib/spice/models.ts` | 282 | `const INCLUDE_LINE =` | any `.inc` line |
| C31 | `app/lib/spice/models.ts` | 305 | `function assertModelFileReadsSafe(content: string): void {` | `.lib`, `.include`, XSPICE |
| C32 | `app/lib/spice/models.ts` | 311 | `if (ngspiceCards(content).some((card) => card.startsWith("+")))` | text opening with a `+` line |
| C33 | `app/lib/spice/models.ts` | 312 | `if (readsXspiceFileOutsideRunDirectory(content)) {` | XSPICE over the cards |
| C34 | `app/lib/spice/models.ts` | 319 | `function hidesOriginal(model: ModelAsset): boolean {` | a blank transformedContent |
| C35 | `app/api/spice/models/smoke-test/route.ts` | 18 | `const content = emittedModelText(model);` | the smoke deck emits the same text - [B22-A3, 2026-10-01] reviewed pin move: the line moved (was 20) |
| C36 | `app/api/spice/models/smoke-test/route.ts` | 72 | `assertModelSafeForExecution(model);` | the screen before any file or process - [B22-A3, 2026-10-01] reviewed pin move: the line moved (was 85); [B22-A3 review, 2026-10-01] reviewed pin move: the line moved again (was 69) |
| C37 | `app/api/spice/models/smoke-test/route.ts` | 95 | `stdout: boundDiagnosticText(result.stdout)` | the bounded return - [B22-A3, 2026-10-01] reviewed pin move: the line moved (was 103); [B22-A3 review, 2026-10-01] reviewed pin move: the line moved again (was 88) |
| C38 | `app/lib/spice/server/worker.ts` | 92 | `boundDiagnosticText(chunk, DIAGNOSTIC_EXCERPT_MAX_BYTES)` | a bounded log event - [B22-A3, 2026-10-01] reviewed pin move: the line moved (was 186); [B22-A3 review, 2026-10-01] reviewed pin move: the line moved again (was 87) |
| C39 | `app/lib/spice/server/worker.ts` | 106 | `return { status: "cancelled", ...output,` | a bounded cancelled record - [B22-A3, 2026-10-01] reviewed pin move: `output` is the record's bounded stdout and stderr (was 193, `processResult`); [B22-A3 review, 2026-10-01] reviewed pin move: the line moved again (was 99) |
| C40 | `app/lib/spice/server/worker.ts` | 109 | `Simulation timed out after ${run.wallClockMs} ms` | a bounded timed-out record - [B22-A3, 2026-10-01] reviewed pin move: the runner's applied wall clock (was 196, `limits.timeoutMs`); [B22-A3 review, 2026-10-01] reviewed pin move: the line moved again (was 102) |
| C41 | `app/lib/spice/server/worker.ts` | 119 | `error: boundDiagnosticText(run.stderr, DIAGNOSTIC_EXCERPT_MAX_BYTES)` | a bounded failure message - [B22-A3, 2026-10-01] reviewed pin move: the runner's record (was 200, `processResult`); [B22-A3 review, 2026-10-01] reviewed pin move: the line moved again (was 110) |
| C42 | `app/lib/computation/diagnostic-runner.ts` | 692 | `const read = await readBoundedRawFile(join(directory, DIAGNOSTIC_RAW_OUTPUT_FILE)` | the whole raw read, left to B22-A3 - [B22-A3, 2026-10-01] reviewed pin move: closed: the runner's bounded read replaced it (was `worker.ts:205`, `readFile`); [B22-A3 review, 2026-10-01] reviewed pin move: the line moved again (was 484); [B22-A3 lead, 2026-10-01] reviewed pin move: +5 after the interactive slot class (was 649); [B22-D, 2026-10-02] reviewed pin move: +38 after the runner root's and the raw file's `lstat` checks (`ensureRunnerRoot`, `rawFileKind`; was 654) |
| C43 | `app/lib/computation/runtime-profile.ts` | 313 | `const LOCAL_ENVIRONMENT = { LC_ALL: "C", TZ: "UTC", PATH: "{installBinDir}", SystemRoot: "{systemRoot}", TEMP: "{runDir}", TMP: "{runDir}" } as const;` | the ngspice allowlist, untouched - [B22-A3, 2026-10-01] reviewed pin move: replaced: the runner passes exactly this map (was `worker.ts:82`, the allowlist with HOME and USERPROFILE) |
| C44 | `app/lib/spice/server/worker.ts` | 141 | `input.onEvent({ status: "completed", progress: 100,` | D22-7: the terminal event before the result - [B22-A3, 2026-10-01] reviewed pin move: the line moved (was 226); [B22-A3 review, 2026-10-01] reviewed pin move: the line moved again (was 132); [B22-C, 2026-10-02] the line is unchanged, but the job store now holds this event and publishes it only after the result is attached (D22-7 closed) |
| C45 | `app/lib/spice/server/job-store.ts` | 372 | `if (error instanceof SpiceDeckSafetyError) throw error;` | the preflight raises the closed refusals - [B22-A3 review, 2026-10-01] reviewed pin move: the line moved (was 350); [B22-C, 2026-10-02] reviewed pin move: the line moved (was 352; B22-C's evidence fields and held terminal event sit above it) |
| C46 | `app/lib/spice/server/job-store.ts` | 101 | `job.record.events.push({ ...event, sequence: job.record.events.length + 1, timestamp });` | the event list, no count bound - [B22-A3 review, 2026-10-01] reviewed pin move: the line moved (was 95); [B22-C, 2026-10-02] reviewed pin move: the line moved (was 96; B22-C's evidence import and job fields sit above it) |
| C47 | `app/lib/spice/server/job-store.ts` | 164 | `if (TERMINAL.has(job.record.status)) return;` | D22-7: the result dropped - [B22-A3 review, 2026-10-01] reviewed pin move: the line moved (was 148); [B22-C, 2026-10-02] reviewed pin move: the line moved (was 150) and D22-7 is closed: the guard now drops only a settlement over a record a cancel made terminal, because the worker's own completed event is held until the result is attached |
| C48 | `app/api/spice/runs/[id]/bundle/route.ts` | 5 | `import { DIAGNOSTIC_OUTPUT_MAX_BYTES, OUTPUT_TRUNCATION_MARKER }` | the bundle reads the one constant - [B22-A3, 2026-10-01] reviewed pin move: the line moved (was 8; the raw read's imports are gone) |
| C49 | `app/api/spice/runs/[id]/bundle/route.ts` | 34 | `The logs are the run record's, each bounded to its last` | the README states the bound - [B22-A3 review, 2026-10-01] reviewed pin move: the line moved (was 33) |
| C50 | `app/lib/spice/diagnostics.ts` | 122 | `rawExcerpt: excerpt.slice(0, 2000),` | the excerpts' own bound |
| C51 | `app/lib/spice/diagnostics.ts` | 136 | `rawExcerpt: log.slice(-3000),` | the fallback excerpt |
| C52 | `app/lib/pcb/fab/kicad-cli-runner.ts` | 36 | `export const KICAD_CLI_ENV_KEYS = [` | the kicad-cli allowlist |
| C53 | `app/lib/pcb/fab/kicad-cli-runner.ts` | 58 | `export function kicadCliEnvironment(` | the helper |
| C54 | `app/lib/pcb/fab/kicad-cli-runner.ts` | 92 | `env: kicadCliEnvironment(),` | the spawn's env |
| C55 | `app/lib/pcb/fab/kicad-cli-runner.ts` | 93 | `windowsHide: true,` | hidden |
| C56 | `app/lib/pcb/fab/kicad-cli-runner.ts` | 81 | `const stdout = createDiagnosticCollector();` | bounded streams |
| C57 | `app/lib/pcb/autoroute/runner.ts` | 149 | `const diagnostics = (): string => joinDiagnosticTexts(` | bounded diagnostics, stderr's share |
| C58 | `app/lib/pcb/autoroute/runner.ts` | 207 | `const read = await readBoundedFile(outPath);` | the bounded `.ses` read |
| C59 | `app/lib/pcb/autoroute/runner.ts` | 212 | `exceeded the bounded size limit; it was not read` | the closed refusal |
| C60 | `app/lib/pcb/autoroute/runner.ts` | 226 | `outputFileStatus: "missing",` | no `.ses` |
| C61 | `app/lib/pcb/autoroute/runner.ts` | 234 | `error: "output-empty",` | an empty `.ses` |
| C62 | `app/lib/pcb/autoroute/runner.ts` | 161 | `cwd: tmpdir(),` | the shared cwd, left to B22-A3 |
| C63 | `app/lib/pcb/autoroute/runner.ts` | 129 | `sirkit-fr-${uuid}.dsn` | the uuid input file in `tmpdir()` |
| C64 | `app/lib/pcb/autoroute/runner.ts` | 130 | `sirkit-fr-${uuid}.ses` | the uuid output file in `tmpdir()` |
| C65 | `app/lib/pcb/fab/build-bundle.ts` | 182 | `readKicadCliOutput(join(gerberDir, found), "gerber")` | gerbers read bounded |
| C66 | `app/lib/pcb/fab/build-bundle.ts` | 208 | `readKicadCliOutput(join(drillDir, name), "drill")` | drill files read bounded |
| C67 | `app/lib/pcb/fab/build-bundle.ts` | 301 | `async function readKicadCliOutput(` | the closed `KicadCliError` |
| C68 | `app/lib/spice/ai-approval.ts` | 13 | `export const SPICE_AI_APPROVAL:` | the one table |
| C69 | `app/lib/spice/ai-approval.ts` | 36 | `export function preselectedOperationIndexes(` | what the studio pre-selects |
| C70 | `app/api/spice/ai/route.ts` | 71 | `return spiceAiApproval(operation);` | the route labels by the table |
| C71 | `app/api/spice/ai/route.ts` | 206 | `operations.push({ approval: approvalFor(operation), operation }); toolResult = { recorded: true };` | a variable |
| C72 | `app/api/spice/ai/route.ts` | 228 | `operations.push({ approval: approvalFor(operation), operation }); toolResult = { recorded: true, note:` | the run request |
| C73 | `app/api/spice/ai/route.ts` | 233 | `for (const scalar of run.scalars) evidence.push(` | the evidence half, left to B22-C |
| C74 | `app/components/spice/SpiceStudio.tsx` | 461 | `setApprovedOps(new Set(preselectedOperationIndexes(data.proposal)));` | the studio's one pre-selection |
| C75 | `app/components/spice/SpiceStudio.tsx` | 472 | `entry.operation.op === "request-run")` | Apply starts only selected run requests |
| C76 | `.github/workflows/deterministic-manufacturing.yml` | 226 | `app/lib/computation/__tests__` | the one directory filter |
| C77 | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 54 | `const CHAPTERS = ["b19-", "b20-", "b21-", "b22-"] as const;` | the chapter admitted |

## 11. For the lead

The reserved files are not edited here. `<sha>` is the commit that lands B22-A1 on the chapter branch.

### OWNER_DECISIONS (three entries as applied, each pasted as a `##` heading; an optional fourth for the stated additions)

> ## OD-146 — CI admission for B22 suites, as applied (B22-A1, 2026-10-01)
>
> - **Question:** how do the B22 suites enter CI?
> - **Default applied:** the first `b22-` suites (`app/lib/computation/__tests__/b22-a1-*.test.ts`, six suites) ride ONE directory
>   filter, `app/lib/computation/__tests__`, in the `prompt-to-gerber` job, and `b22-` joined `CHAPTERS` in
>   `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` in the same change; no `it(` was added to the guard (B21's
>   `b21-a-page` case 4 pin of 8 blocks stands; a run prints 8 + 4 = 12 tests); no `b22-` suite starts PGlite; live suites stay opt-in
>   (`SIRKIT_B22_LIVE_RUNNER=1` when one exists) and never run in CI - A1 has none.
> - **Evidence:** `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md` section 6 (the guard red with `b22-` and no filter,
>   then green); the workflow line `:226`; B21's matrix citations C49/C93/C94 re-pinned +1.
> - **The owner may choose otherwise:** explicit per-suite entries (each then exempt from a directory filter by the guard's
>   redundancy rule). Owner confirmation pending.

> ## OD-148 — kicad-cli and FreeRouting in B22, as applied (B22-A1, 2026-10-01)
>
> - **Question:** what does B22 do about kicad-cli's and FreeRouting's secret inheritance and unbounded output?
> - **Default applied:** kicad-cli spawns with an explicit environment allowlist (`KICAD_CLI_ENV_KEYS`: the search path, the Windows
>   system root and drive, temp directories, the user profile, application-data and home directories, the locale,
>   `LD_LIBRARY_PATH`, the XDG configuration, cache and data directories and `KICAD_CONFIG_HOME`, plus `NODE_ENV` as the FreeRouting
>   precedent) and `windowsHide: true`; both runners hold each output stream to at most twice the one 64 KiB diagnostic bound in
>   memory, counted in bytes, and return it within the bound with a truncation marker, FreeRouting's stderr keeping up to half the
>   bound beside its stdout so an exception survives; the files Sirkit reads back - FreeRouting's `.ses`, kicad-cli's gerber and
>   drill files - go through a bounded reader that refuses a file over 64 MiB unread with a closed error. Their full profiles (digest
>   pins at run time) are B22-A2's, diagnostic-only; their containers are LB-3/LB-10's.
> - **Evidence:** the page sections 3 and 4; `b22-a1-secret-env`, `b22-a1-tool-output-bounds` (with the review's fake-handle and
>   collector cases and their deliberate breakages); the existing runner, bundle and route suites unchanged and green.
> - **Limits recorded:** the allowlist's adequacy is INFERRED (kicad-cli was never run here; the opt-in kicad-cli oracle is the live
>   check); the processes may still write files of any size (no file-size limit on any spawn).
> - **The owner may choose otherwise:** a narrower allowlist after a live oracle run, or different bounds. Owner confirmation pending.

> ## OD-150 — SPICE AI approvals, the approval half, as applied (B22-A1, 2026-10-01)
>
> - **Question:** which SPICE AI operations may arrive pre-selected?
> - **Default applied:** every operation whose strings reach an ngspice deck (a test's name, overlay elements, variables, analyses,
>   sweeps, corners, model bindings, solver options) and the run request are "review" and never pre-selected - a human selects each
>   before Apply; a measurement and a specification (never written to a deck) stay "automatic"; a design patch stays "explicit".
>   One table (`app/lib/spice/ai-approval.ts`) decides the route's labels and the studio's pre-selection, which also refuses a forged
>   "automatic" on any other kind and a non-automatic level on an automatic kind. The evidence half (D22-21: evidence references
>   resolve to server-held records or carry a "caller-supplied" label) is NOT applied; it stays with B22-C.
> - **Evidence:** the page section 5; `b22-a1-spice-ai-approval`; the reviewed pin move in `b16-0-23-tranche-parity.test.ts:627`.
> - **The owner may choose otherwise:** keep a measurement and a specification "review" too (nothing would then arrive selected).
>   Owner confirmation pending.

> ## OD-153 — B22-A1: the stated additions to its task text, as applied (B22-A1, 2026-10-01) [optional]
>
> - **Question:** the task named the forms the model screen refuses; B22-A1 refuses more, fail-closed.
> - **Default applied:** a one-token `.lib` line is refused (whether ngspice-46 reads its token as a file is UNKNOWN; no executed deck
>   accepted any `.lib` line since SEC-1); a path must be a plain relative name, so a home (`~`) path, a variable, a Windows device
>   name, a space and a quote are refused too (a quoted vendor data file name with a space is the cost); the executed-deck screen
>   also refuses an XSPICE file parameter (an advanced directive can carry the `.model` card the model screen never reads) and reads
>   the whole deck's cards as ngspice joins them, across model boundaries; the code models of the installed ngspice-46 that start a
>   program or load a library (`d_process`, `d_cosim`) are refused whatever they name; a `.model` card is read token by token, so a
>   file parameter must be followed by a plain relative name (a value spelled exactly `file` at a card's end is the cost); model text
>   that opens with a `+` line is refused; every model-screen refusal of text SEC-1's final screen refused is closed, so the runs
>   preflight still answers it 422 before any job, while the screen's own messages stay the worker's (202) as SEC-1 designed; the
>   smoke deck reads the emitted model text; the reproducibility bundle's README states the logs' bound.
> - **Evidence:** the page sections 0, 1 and 2. Owner confirmation pending.

### README row (the `artifacts/ai-control-plane-b22/README.md` checkpoint table)

| B22-A1 security corrections SEC-1 left (D22-4's remainder; D22-5 kicad-cli's environment; D22-8 output caps for kicad-cli and FreeRouting; OD-150's approval half; OD-146 CI admission) | `deck-and-secret-corrections.md`; code `app/lib/computation/output-bounds.ts`, `app/lib/spice/models.ts`, `netlist.ts`, `ai-approval.ts`, `server/worker.ts`, `server/job-store.ts`, `app/api/spice/models/smoke-test/route.ts`, `app/api/spice/runs/[id]/bundle/route.ts`, `app/api/spice/ai/route.ts`, `app/components/spice/SpiceStudio.tsx`, `app/lib/pcb/fab/kicad-cli-runner.ts`, `build-bundle.ts`, `app/lib/pcb/autoroute/runner.ts`; suites `app/lib/computation/__tests__/b22-a1-*.test.ts` (six, 134 tests) | CONFIRMED offline (test-first: 64 red / 25 green of 89 on `0432fb8`; an adversarial review's 16 confirmed findings each reproduced first - 40 red of 393 on the first fix, nine deliberate breakages caught - then fixed; 134 green; every spawn faked, no process run; the installed ngspice-46 code models read, never run); the kicad-cli allowlist's adequacy and the ngspice card and token readings INFERRED; production authority still BLOCKED; commit `<sha>` |

### EXECUTION_LEDGER paragraph

> ### B22-A1 - the security corrections SEC-1 left: the model screen, kicad-cli's environment, output caps, SPICE AI approval levels (2026-10-01 local; increment workflow + lead; this commit)
>
> Test-first on `chapter/b22-sandboxed-computation` from `0432fb8`: six suites under the new `app/lib/computation/__tests__/` ran
> 64 red / 25 green of 89 on the unmodified tree, then green; a self-review added two cases (91 green). An adversarial review then
> CONFIRMED 16 findings against that first fix; each was reproduced first - 40 red of 393 across the changed suites and SEC-1's, and
> nine deliberate breakages of the source caught by strengthened cases, each source restored by hash - then fixed: 134 green (137 after the lead's close, section 12).
> MODEL SCREEN (D22-4): the screen read `transformedContent ?? originalContent` while the deck emits
> `transformedContent?.trim() || originalContent.trim()`, refused only an absolute or UNC include, had no `.lib` or XSPICE rule and
> trusted the client's `dependencies`; at the fake spawn seam the smoke test and `POST /api/spice/runs` spawned ngspice for model text
> naming a host file in an XSPICE `file=`. Now one helper `emittedModelText` feeds the deck, the screen and the smoke deck; the screen
> refuses, closed, every `.lib` line, an `.include`/`.inc` whose path is not a plain relative name, an include at all (dependencies
> recomputed from the text), a blank `transformedContent` hiding a refused original, and model text opening with a `+` line; both
> screens read XSPICE over the cards as ngspice joins them (a `+` after a form feed or a control character, a comment inside a card,
> a parameter with no `=`, a card continued from one model into the next) and refuse a file parameter naming anything but a plain
> relative file and every code model of the installed ngspice-46 that starts a program or loads a library (`d_process`, `d_cosim`;
> the seven `.cm` libraries read as strings, never run); what SEC-1 answered 422 before any job is still 422 before any job.
> Legitimate vendor text (SEC-1's command-word cards, `.subckt`/`.model`/`.param`/`.func`, relative XSPICE names, on continuation
> lines too) passes compile, preview, smoke test and runs. CHANNELS (D22-4/D22-8): one constant (64 KiB per channel, a sixty-fourth -
> 1 KiB, below the 1,500 and 3,000 characters it replaced - for log events and failure messages) bounds the smoke test's returned
> output and every stdout/stderr, failure message and log event a run record carries, timed-out runs included, the tail kept and a
> marker first, and the reproducibility bundle's README says its logs are bounded; RECORDED, not closed: a bounded channel still
> carries what a process prints, and the diagnostic excerpts (about 140,000 characters at most) and a record's event list (about
> 1 MiB a run) keep their own bounds. KICAD-CLI (D22-5): an explicit environment allowlist (canaries proven absent at the fake seam)
> and `windowsHide`; its adequacy INFERRED (never run). CAPS (D22-8, OD-148): kicad-cli's and FreeRouting's streams held to twice the
> bound in bytes, FreeRouting's stderr keeping its own share beside a long stdout; FreeRouting's `.ses` and kicad-cli's gerber and
> drill files read through a bounded reader refusing a file over 64 MiB unread with a closed error (its read bound, unread refusal and
> handle pinned with a fake handle). APPROVALS (OD-150, the approval half): every deck-reaching SPICE AI operation and the run request
> "review", never pre-selected, from one table the route and the studio share; measurements and specifications stay "automatic".
> CI (OD-146): one directory filter and `b22-` in `CHAPTERS`, no guard `it(` added. Reviewed pin moves: four in `sec-1-deck-injection`,
> line-neutral against `0432fb8`, its 268 cases kept (SEC-1's empty-`transformedContent` row back in its 422 list); two in
> `b16-0-23-tranche-parity` (and its raw NUL byte rebuilt at run time); B21's matrix C49/C93/C94 re-pinned +1. Gates: SPICE/simulate/
> new folder/guard 15 files 442 passed 3 skipped; every suite reading a changed file 26 files 405 passed 2 skipped; import gates and
> census 20 files 218 passed (165 / 162 / 3 / 0, five spawners); B21 orchestration 49 files 460 passed; tsc and eslint clean; three
> generators zero drift. Observed at the fake seam: D22-7 (a completed run's record keeps no result; its bundle answers 409) - B22-C.
> Not changed: the CD-10 routes, the 501, `executeAuthoritativeSimulation`, the ngspice allowlist/argv/kill, the worker's
> `result.raw` read, `/api/simulate`, routes, authentication, CSRF, roles; no dependency. Open: B22-A3 (HOME/USERPROFILE and `-n`,
> the raw read, run directories, FreeRouting's cwd, process limits, a live check of the card and token readings), B22-C (OD-150's
> evidence half, D22-7, the manifest checksum over `transformedContent ?? originalContent`). Page:
> `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md`. Commit `<sha>`.

### Discovery closure clauses (for D22-4, D22-5, D22-8 and OD-150 in `discovery.md`, and its section 10)

- D22-4: **Closed by B22-A1** (`<sha>`, 2026-10-01) but for what it records: the model screen reads exactly the text the deck emits
  (one helper, `emittedModelText`, for the deck, the screen and the smoke deck), refuses, closed, every `.lib` line, an
  `.include`/`.inc` whose path is not a plain relative name, an include at all (dependencies recomputed from the text, never the
  client), a blank `transformedContent` hiding a refused original, and model text opening with a `+` line; both the model screen and
  the executed-deck screen read XSPICE over the cards as ngspice joins them, across model boundaries, refusing a file parameter that
  names anything but a plain relative file and every code model of the installed ngspice-46 that starts a program or loads a library
  (`d_process`, `d_cosim`; the seven `.cm` libraries read, never run); every refusal SEC-1 answered 422 before any job is still 422
  before any job; the smoke test's returned ngspice output and every stdout/stderr, failure message and log event a run record
  carries are bounded by one constant with a truncation marker. Red first: 31 + 6 cases on `0432fb8`, among them the smoke test and
  the runs route spawning ngspice for a host-path XSPICE parameter; then 36 more on the first fix after the review (the runs route
  spawning ngspice for a `d_process` card and for a parameter with no `=`). Recorded, not closed: a bounded channel still carries what
  a process prints; the diagnostic excerpts (`diagnostics.ts:122, :136`, about 140,000 characters at most) and a record's event list
  (`job-store.ts:95`, about 1 MiB a run) keep their own bounds; the ngspice card and XSPICE token readings are INFERRED until a live
  probe; the compile preview keeps `.include`/`.lib` and XSPICE text (SEC-1's decision, never executed); the run manifest's model
  checksum still hashes `transformedContent ?? originalContent` (`server/manifest.ts:30`, B22-C); the shared deck validator across
  `/api/simulate` and the Studio path is left to OD-136's single runner (B22-A3).
- D22-5: **kicad-cli's half closed by B22-A1** (`<sha>`): kicad-cli spawns with an explicit environment allowlist and
  `windowsHide`, pinned literally and checked with canary keys at the fake seam; the list's adequacy is INFERRED (kicad-cli never run;
  the opt-in oracle is the live check). With SEC-1's ngspice half, no spawn inherits the whole server environment. Open: HOME and
  USERPROFILE in the ngspice allowlist, no `-n` on any spawn, and the B16.0.23 gate and boundary record that neither pin nor list
  env (B22-A3).
- D22-7: [B22-A1, 2026-10-01] Observed at the fake seam while B22-A1 built its bundle case: a completed run via
  `POST /api/spice/runs` never finished (`finishedAt` unset) and its bundle answered 409 "Run has no reproducibility artifacts",
  as section 0 inferred (`worker.ts:226`, `job-store.ts:148`) - CONFIRMED at the fake seam, not with a real ngspice; unchanged (B22-C).
- D22-8: **In part closed by B22-A1** (`<sha>`, OD-148): kicad-cli's and FreeRouting's accumulated output is held to twice the bound
  in bytes and returned bounded with a marker, FreeRouting's stderr keeping its own share; FreeRouting's `.ses` and kicad-cli's
  gerber and drill files are read through a bounded reader that refuses an over-bound file unread with a closed error; the SPICE
  reproducibility bundle carries the record's bounded logs and says so. Open (B22-A3): the worker's and the bundle route's whole reads
  of `result.raw`, the per-run directories never removed and their host path in records, FreeRouting's shared cwd and uuid files in
  `tmpdir()` (`runner.ts:129-130, :161`), the run directory's whole logs, and no CPU, memory, process or file-size limit on any spawn
  (the processes may still write files of any size).
- OD-150: **The approval half applied by B22-A1** (`<sha>`): every SPICE AI operation whose strings reach a deck and the run request
  are "review" and never pre-selected, from one table the route and the studio share; measurements and specifications stay
  "automatic", design patches "explicit". The evidence half (D22-21) stays with B22-C.
- Section 10 amendment: "B22-A1 (`<sha>`) closed what SEC-1 left of D22-4 (the model screen, its differential, client dependencies,
  XSPICE file parameters and program- or library-loading code models over joined cards, the bounded return channels), kicad-cli's
  half of D22-5, D22-8's output caps for kicad-cli and FreeRouting (OD-148) and OD-150's approval half, and admitted `b22-` to CI
  (OD-146); D22-7 was observed at the fake seam (B22-C); the shared deck validator is left to B22-A3."

## 12. The lead's close (2026-10-01)

The check of the review's fixes raised two new issues; the lead settled both on observed ngspice behaviour.

**A non-ASCII character before a `+` (medium, fixed).** The check said `ngspiceCards` skipped only code units up to a space before
a `+` while ngspice also skips non-ASCII bytes there. The lead's benign probes (ngspice-46, `ngspice_con -b`, ngspice's own `echo`
only, decks under the lead's scratchpad; recorded with SEC-1's p0-p13) CONFIRM it:

| probe | deck construct | observed |
|---|---|---|
| p14 | `R1 1 0` then a line `é+ 1k` | joined: the circuit simulates with R1 = 1k (V1 draws 1 mA) |
| p15 | `R1 1 0` then a line `<no-break space>+ 1k` | joined, as p14 |
| p16 | `R1 1 0` then a line `<TAB>+ 1k` (control) | joined, as both readings already held |
| p17 | `R1 1 0` then a line `x+ 1k` (control) | not joined: "unknown subckt: x+ 1k", exit 1 |
| p18 | a line `é*# echo MARKER` | nothing runs: "unknown device type", the marker never printed alone |
| p19 | a line `é.control`, `echo MARKER`, `.endc` | nothing runs: "Missing .control statement", the marker never printed |
| p20 | a line `<no-break space>*# echo MARKER` | nothing runs, as p18 |
| p21 | a line `<no-break space>.control` ... `.endc` | nothing runs, as p19 |
| p22 | a line `é.include <missing file>` | not read as an include: "unknown device type" on that line |

So a split XSPICE parameter (`.model src d_source (` then `é+ input_file "/x")`) reached ngspice whole while the screen read the
second line as a card of its own: three cases were red on the review's fix (the model screen twice - p14's e-acute and p15's no-break
space - and the final screen alone once), and `ngspiceCards` now skips every non-ASCII character too before it reads a line
(`netlist.ts:542`, in place). p18-p22 show the skip does NOT make a non-ASCII-prefixed `*#`, `.control` or `.include` line execute or
read, so SEC-1's line screen (which reads those only after ASCII whitespace) is not bypassed by it. The suite is 137 green.

**`d_process`, `d_cosim` and `process_file` refused on any card (low, kept).** The check said a benign net, element or output named
one of those words is refused. Kept as fail-closed defence in depth and recorded as a stated addition (OD-153): those words name
code models that start a program or load a library, a design rarely names a net after them, and the error names the rule.
