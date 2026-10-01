# SEC-1 - the SPICE Studio deck injection (closes D22-3; the ngspice half of D22-5)

Corrective security branch `fix/spice-deck-injection`, cut from `origin/main` at `6fd5a7b` (runbook section 2.4), 2026-09-30,
with an adversarial review round on 2026-10-01 (section 2.5). Test-first: the suite
`app/lib/spice/__tests__/sec-1-deck-injection.test.ts` was written and run red on the unmodified tree, then the fix made it
green; each confirmed review finding was reproduced red (or, for a test-strength finding, proved by a deliberate breakage of
the source) before its fix. No hostile deck was ever run by ngspice: the reproduction is at the deck level (the compiler, with
the worker's options) and through the routes with `node:child_process` and `node:fs/promises` replaced by in-process fakes (the
B19-D pattern), so no deck reaches the disk and no process starts. The fake spawn records environment KEY NAMES only.

Line numbers in section 1 are of the base `6fd5a7b`; in sections 3 and 6 of the SEC-1 tree.

## 1. The defect (D22-3, high; the ngspice half of D22-5) - CONFIRMED by reading and by the red run

- **The writer split every string into deck lines.** `createWriter().push` turned any pushed string into lines with
  `text.split(/\r?\n/)` (`app/lib/spice/netlist.ts:33`), so a caller string carrying a line feed became several live deck lines.
- **Unscreened caller and model strings reached it.** The deck title (project and test name, `:216`, CR/LF only replaced), the
  comment lines (design revision id, test id and revision, run point label, `:218-220`; the label carries the test, analysis,
  corner and sweep variable names, `app/lib/spice/run-plan.ts:74`, `:89`, `:230`), `.param` values and names (`:223-230`; run
  point values include sweep, corner and Monte Carlo custom or discrete samples, `run-plan.ts:113-124`), `.temp` (`:231`),
  solver options (`:182-201`; the custom `.options` screen `^[A-Za-z0-9_.=+\-\s]+$` admits a line break through `\s`,
  `:196-199`), element and source values and waveforms (`:64-100`; `toSpiceValue` returns unparseable text unchanged,
  `app/lib/spice/units.ts:137-145`), model and subcircuit names and parameter overrides on element lines (`:72`, `:86-91`; from
  `app/lib/spice/ir.ts:266-267`), the `.ic` overlay value and the advanced directives as custom directives (`ir.ts:305-308`,
  `:358-360`), every analysis field (`netlist.ts:110-148`), and the output expressions, written in `.save` (`:247`) and INSIDE
  the compiler's own `.control` block on the `write` line (`:255`; a current probe's expression carries the probe's raw name,
  `ir.ts:301`). Identity names (references, net labels, overlay names and target nets) were reduced to identifier characters
  by the IR compiler's sanitizers (`ir.ts:43-52`): no injection, but a refused character was silently stripped into a
  different deck.
- **`assertSafeDirective` checked only the start of the whole text** (`netlist.ts:151-158`, `^` without the `m` flag), so
  `.save v(VIN)` + LF + `.control` + LF + `shell ...` + LF + `.endc` passed and was split into a live block.
- **No final screen.** `compileNgspiceNetlist` returned the normalized text as `executed` unchecked (`:266`) and the worker wrote
  and ran it after only the model screen and the readiness audit (`app/lib/spice/server/worker.ts:162-176`).
- **Reach.** `POST /api/spice/runs` (WRITE_EDITORS, CSRF) takes the whole `SimulationProject` from the body
  (`app/api/spice/runs/route.ts:18-30`) and starts the plan with no deck screening (`app/lib/spice/server/job-store.ts:166-239`);
  the SPICE AI route records overlay and variable operations and the run request as `"automatic"`
  (`app/api/spice/ai/route.ts:68-72`, `:201-206`, `:228`), which the studio pre-selects (`app/components/spice/SpiceStudio.tsx:461`).
  So an authenticated member, or a model steered by injected text after one human Apply, could put `shell` into a control block
  ngspice runs in batch mode: server command execution (INFERRED for the last step: ngspice was never run on a hostile deck).
- **Found while enumerating (same class).** A single-line output expression needs no line break: ngspice's command language
  reads `;` as a command separator and `<`/`>` as redirection on the compiler's own `write` line (INFERRED from the ngspice
  front end). Model text, multi-line by nature, reaches the deck through the existing model screen, which does not refuse a `*#`
  line (ngspice runs one as a control command, INFERRED) and screens `transformedContent ?? originalContent` while the deck emits
  `transformedContent?.trim() || originalContent.trim()` (`app/lib/spice/models.ts:196` against `netlist.ts:48-50`, D22-4's
  differential), so an empty `transformedContent` let a hostile `originalContent` with a `.control` block through. The smoke
  test wrote the caller's `subcircuitName` into its deck unscreened (`app/api/spice/models/smoke-test/route.ts:21-28`).
- **D22-5's ngspice half.** The smoke test (`smoke-test/route.ts:58`) and the worker's `-v` probe (`worker.ts:60`) passed no
  `env`, so ngspice inherited the whole server environment (Node's default).

## 2. Reproduction: red before, green after

The suite has 244 cases. Run against main's sources (the four SEC-1 source files replaced by their `6fd5a7b` text for one run,
then restored and checked by hash): **227 failed, 17 passed**. The 17 are the baseline deck, the two never-written strings,
and the cases that pin what main already did right and SEC-1 must keep: a TAB in a directive or option (compile and route),
`ng_script` inside a name or comment, a title starting `.control` or `.endc`, compiler element cards named like a command word,
vendor `*#` banners and form-feed page breaks in model text, the preview keeping a model's file directive, a TAB, ESC or DEL
inside a model line, and the three run requests the worker refuses before any deck. On the first SEC-1 tree (before the review
round) the same suite ran **106 failed, 138 passed** (section 2.5). After the fix: **244 passed**. (The suite's first version,
158 cases with a TAB counted as a refused form, ran 148 red / 10 green on `6fd5a7b`.)

Each field case applies a legitimate value first (it must still compile to a clean deck: exactly the compiler's own control
block, no command, `*#` or file line), then 12 payloads, each with the field's legitimate text as a prefix: LF, CR, CRLF,
U+0085, U+2028, U+2029, VT and FF each carrying `.control` / `shell sec1-marker` / `.endc`, and NUL, ESC, DEL and a backtick pair
carried bare. Pass: every payload is refused with a closed error (the message starts `SPICE_DECK_UNSAFE: `, names the field and
holds none of the refused text). Then a TAB: SPICE whitespace, so it must stay inside its one line (a clean deck with the same
number of lines), except where the `write` line's allowlist refuses it.

### 2.1 Per field (79 fields; red = the 12 payloads on `6fd5a7b`, and what LF produced)

| Field (where it is written) | Red: not refused | Red: the LF payload | Green |
|---|---|---|---|
| project name (deck title) | 12/12 | clean (title LF, CR and CRLF replaced by spaces); the other 9 forms reached the deck raw | 12/12 refused |
| test name (title and run point label) | 12/12 | live second `.control` with `shell` (via the run point comment) | 12/12 refused |
| design revision id; test id; test revision (comment lines) | 12/12 each | live second `.control` with `shell` | 12/12 refused each |
| analysis name; corner name; sweep variable name (run point label) | 12/12 each | live second `.control` with `shell` | 12/12 refused each |
| design variable value; corner variable value; Monte Carlo custom sample; Monte Carlo discrete value; global parameter value (`.param`) | 12/12 each | live second `.control` with `shell` | 12/12 refused each |
| sweep value (run point label and `.param`) | 12/12 | live `.control` with `shell` twice (three `.control` lines) | 12/12 refused |
| design variable name; global parameter name; model parameter override name (sanitized by `safeParamName`) | 12/12 each | clean (sanitized to `_`) | 12/12 refused each (raw at the boundary) |
| temperature; corner temperature (`.temp`) | 12/12 each | live second `.control` with `shell` | 12/12 refused each |
| solver method; solver tolerance as text; custom `.options` entry | 12/12 each | live second `.control` with `shell` | 12/12 refused each |
| schematic resistor value; schematic source value | 12/12 each | live second `.control` with `shell` | 12/12 refused each |
| overlay source waveform; current source value; load value; fault resistance | 12/12 each | live second `.control` with `shell` | 12/12 refused each |
| initial condition value (`.ic`); advanced directive | 12/12 each | live second `.control` with `shell` | 12/12 refused each |
| output expression; current probe name (`.save` and the control block's `write` line) | 12/12 each | three `.control` lines (`.save` and `write` both split) | 12/12 refused each; a TAB refused too (the `write` allowlist) |
| model subcircuit name; model name; model parameter override value (element line) | 12/12 each | live second `.control` with `shell` | 12/12 refused each |
| schematic reference; net label name; overlay element name; overlay target net; KiCad reference (identity names, sanitized by `ir.ts:43-52`) | 12/12 each | clean (sanitized to identifier characters; also on the first SEC-1 tree) | 12/12 refused each (the raw name, review finding coverage-3) |
| 39 analysis fields: tran outputStep, stopTime, startTime, maxStep; dc source, start, stop, step and nested.source, .start, .stop, .step; ac scale, startFrequency, stopFrequency; noise output, inputSource, scale, startFrequency, stopFrequency; tf output, inputSource; pz inputPositive, inputNegative, outputPositive, outputNegative, transfer, calculation; sens output, ac.scale, ac.start, ac.stop; disto scale, startFrequency, stopFrequency, f2overF1; fourier fundamentalFrequency, outputs[0]; custom commands[0] | 12/12 each | live second `.control` with `shell` | 12/12 refused each |

In all, 70 of the 79 wrote a live second `.control` block with `shell` on LF, and 9 compiled a clean deck (the title, the
three sanitized parameter names and the five identity names). **A TAB** was admitted by main in every field, refused in every
field by the first SEC-1 screen (the review's regression), and is now admitted inside its one line in every field but the
output expression and the probe name. **Never written (green before and after, kept as pins):** a measurement expression and a
variable description; part snapshot pins reach only the pin map, never a deck line.

### 2.2 The other deck-level cases (each red before, refused with a closed error after, unless stated)

- Output expressions with `;`, `>`, `<`, `|`, `>&`, `$`, `!`, `{}`, `~` or a quote (single line, no control character), and the
  same text as a current probe's name: red, compiled with the payload on the control block's `write` line.
- A project named `*ng_script` and a `.title *ng_script` directive (a script deck runs every line): red, compiled.
- A one-line `.control` or `.endc` directive: red only as an open error (`Unsafe custom ngspice directive is not allowed: .control`
  echoed the text); now closed and a `SpiceDeckSafetyError`. A prefix-spelled `.controls` (ngspice matches the prefix): red,
  compiled with two control lines.
- An `.include` and a `.lib` directive: red, compiled into the executed deck.
- Model text (each passes the existing model screen, asserted in the suite): an empty `transformedContent` over a hostile
  `originalContent` (red: two control blocks), a `*#` line (red: compiled), a relative `.include` with no recorded dependency and
  a `.lib` read (red: compiled), and a line starting with each of the 13 command words the task names (`cd`, `load`, `quit`,
  `define`, `codemodel` were still compiled on the first SEC-1 tree, review findings coverage-2 and tests-1). Model text carrying
  each line-break form, NUL or a backtick is refused at compile and by the smoke test before any file (review finding tests-6);
  a TAB, ESC or DEL inside a model line opens no line and passes, as on main.
- The final screen alone, on hand-altered compiled decks (40 alterations: a second or prefix-spelled control block, `*#`,
  `shell` outside the block, `*ng_script`, `.include`, `.lib`, `.shell`, `!`, command substitution, an extra command inside the
  compiler's block, `;` or `>` on the `write` line, CR, NUL, U+2028, U+2029, U+0085, VT, a form feed hiding a control block or a
  command in the title, the seven dot directives `.cd`/`.source`/`.quit`/`.exec`/`.system`/`.destroy`/`.remcirc` and the 12
  command words other than `shell`): red (the screen did not exist), refused after; a compiler element card named like a command
  word passes only as the compiler's own card.
- Each defence layer on its own (review finding tests-2): `assertSafeDirective` refuses a line break anywhere, before the trim;
  the writer refuses a string with a line break instead of splitting it; the `.options` screen keeps a TAB-separated entry and
  drops one with a line break.
- Refused characters at the start or end of a value, where a trim would remove them (review finding tests-8): seven fields by 10
  edge forms, each refused raw.
- Legitimate inputs (green on main, kept green): a TAB-separated `.param` directive and `.options` entry; `ng_script` in a
  project name, a node name and a model comment; a project named `.controller demo` or `.endc review`; compiler cards named `CD`
  and `load`; vendor banners (`*####`, `*#----`, `*#====`, `*#`) and form-feed page breaks in model text (run, preview and smoke
  test). Still refused: a `*#` line naming a command or holding a `*`, a banner going on to a command, and a form feed before a
  `*#` command, a command word or a control block.

### 2.3 End to end: `POST /api/spice/runs` with ngspice not executed

The route suites' harness (`injectAuthorizedPrincipal`, same-origin CSRF headers, an editor member), the real job store and the
real worker, with the spawn and the file system faked. Outcome recorded per request: status, closed error, jobs, decks written,
the deck's findings, ngspice runs.

- **Red** (each of the 12 source-value forms, a custom `.options` entry with LF, an `.ic` value with LF, an advanced directive
  with LF, an output expression with `;`, the model differential, a model `*#` line, a net label with LF, a model `codemodel`
  line, and a hostile value on a later sweep point, a second analysis or a second test): `202`, one or two jobs, the deck
  **written** with the injected line(s) (the net label: stripped into a different deck) and **ngspice spawned**: the exploit
  path reaches `spawn`. A one-line `.control` directive: `202`, the run failed in the worker with no deck.
- **Green:** every one of those requests answers `422 {"ok":false,"error":"SPICE_DECK_UNSAFE: ..."}`, no job, no deck written,
  no process.
- **Left to the worker (review findings coverage-5 and tests-4):** a plan whose model the existing model screen refuses (a
  `.control` line; or a recorded include dependency, here with an LF source value as well), and a plan whose deck fails to
  compile for a reason that is no deck refusal (a directive without its period), answer `202`; the run fails with the screen's
  or the compiler's own message, no deck written, ngspice never run (green before and after).
- **The worker's own screen (defence in depth):** with the compiled `executed` deck replaced after compilation by one carrying a
  second control block, the request starts (`202`) and the run ends `failed` with a closed error, no deck written, ngspice never
  run (red: the deck was written and spawned).
- **The preflight's cost (review finding regressions-preflight-sync-compile):** a 24-point sweep plan compiles one deck in the
  request (two with two analyses); red on the first SEC-1 tree: 24 compiles, one per run point.
- **Baseline:** a legitimate request still answers `202`, writes exactly the compiler's deck once and spawns ngspice once; the
  `-v` probe and the run both pass an environment whose keys are inside the allowlist and never one of three variables set in
  the test process (red: the probe passed no environment). A TAB-separated directive and option, a vendor banner and a
  form-feed page break also run (red on the first SEC-1 tree: `422`).

### 2.4 `POST /api/spice/models/smoke-test`

- A subcircuit name carrying each of the 12 forms, and a model `*#` line: red `200`, the deck written and ngspice spawned; green
  `422` closed, no file, no process. Model text carrying a line-break form, NUL or a backtick: `422` before any file.
- A legitimate model: ngspice spawned with the allowlisted environment (red: no environment).
- A Windows (CRLF) model file still smoke-tests, and the deck written is now the deck screened, LF only (red on the first SEC-1
  tree: the CRs were written, review finding coverage-9).

### 2.5 The review round (2026-10-01)

An adversarial review of the first SEC-1 tree confirmed 21 findings; each was reproduced (red on that tree) or, for a
test-strength finding, proved by a deliberate breakage of the source (the sources restored and checked by hash after each run).

| Finding | Reproduction (red on the first SEC-1 tree, or the breakage it now catches) | Fix |
|---|---|---|
| regressions-tab-single-line-fields (TAB refused, whole plan 422) | TAB per field, `.param<TAB>` and `.options` entry compile, route `202`: all refused | the shared screen admits a TAB (`netlist.ts:303`) |
| regressions-preflight-sync-compile (one compile per run point in the request) | 24-point plans: 24 compiles | one compile per test and analysis, run point fields per point (`job-store.ts:322-339`, `netlist.ts:341-345`) |
| regressions-model-banner-ff-refused | banners and form-feed page breaks refused in run, preview, smoke | banner rule (`:426`); a form feed is read both ways (`:469-473`) |
| regressions-ng-script-substring; coverage-11 | `ng_script` in names, `.controller`/`.endc` titles refused | `*ng_script` title or `.title` only (`:430`, `:458`); title never a card (`:459-460`) |
| coverage-2; tests-1 (five command words missing) | `cd`/`load`/`quit`/`define`/`codemodel` lines compiled; breakage of the word list or dot rule caught | the task's 13 words (`:423`), compiler cards exempt (`:409-417`) |
| coverage-3 (identity names stripped) | 12 forms in five identity names compiled clean; route `202` with a deck | raw names screened (`:376-383`) |
| coverage-5; tests-4 (skip path) | breakage (model screen dropped, every error raised) caught | carve-out recorded in the closure clause; two route cases |
| coverage-6 (file reads) | wording only | `.include`/`.lib` reads named; XSPICE file parameters recorded as a residual (section 4) |
| coverage-7 (sweep variable name, Monte Carlo samples) | the three fields inject on `6fd5a7b` | already closed by the run point screen; now enumerated |
| coverage-9 (smoke deck not the screened bytes) | CRLF written | the smoke test writes the screened deck (`smoke-test/route.ts:117-120`) |
| coverage-1; tests-7; coverage-10 (counts) | the page check read 65 | counts corrected; a suite case checks every count the page states |
| tests-2 (layers hidden behind the field screen) | breakage of the writer, `assertSafeDirective` or `.options` caught | direct cases through the test seam (`:480`) |
| tests-3 (one-point plans only) | breakage (first point only) caught | later sweep point, second analysis, second test |
| tests-5 (allowlist pinned only relatively) | breakage (a key added to all three) caught | the literal list pinned; three canaries |
| tests-6 (model text forms untested) | breakage (VT, NEL, PS, form-feed reading dropped) caught | model text through every form, compile and smoke |
| tests-8 (no edge positions) | breakage (screen trims first) caught | seven fields by 10 edge forms |

## 3. The fix (defence in depth)

1. **One shared single-line screen** `assertDeckText` (`app/lib/spice/netlist.ts:310-316`): /api/simulate's `unsafe()` rule
   (B19-D: a C0 control, DEL or a backtick) extended to every line-break form (C1 controls with U+0085, U+2028, U+2029), except
   a TAB (`:302-304`). Refused raw, before any trim or unit parsing, with the closed `SpiceDeckSafetyError` (`:290-296`, code
   `SPICE_DECK_UNSAFE`).
2. **The field screen at the IR -> deck boundary** `assertDeckInputsSafe` (`:354-395`), called first in `compileNgspiceNetlist`
   (`:214`): every string the compiler writes, enumerated from its writer calls (title, comment ids, the run point's label,
   values and temperature through `assertRunPointSafe`, `:341-345`; variable, global parameter and model parameter names and
   values; temperature; solver options and custom `.options`; model paths; node, element and model names and the raw
   references, net labels, overlay names and target nets they were sanitized from, `:376-383`; element and source values;
   custom directives; every string of the active analysis at any depth, `:331-335`). Output expressions also pass an allowlist
   of vector-expression characters (`:323-328`): letters, digits, space and `_ . , : # @ ( ) [ ] + - * /`.
3. **The writer pushes one line per string** (`:33`): a single string carrying any refused character throws instead of being
   split; model text, multi-line by nature, is pushed as explicit lines (`:239`).
4. **`assertSafeDirective`** screens the directive as one line before the trim (`:152`), and its refusal is closed and a
   `SpiceDeckSafetyError` (`:155`), so the route preflight raises it as a 4xx.
5. **The `.options` screen** admits space and tab only (`:198`); with the field screen admitting a TAB, a TAB-separated entry
   now reaches it and is written.
6. **The final deck screen** `assertCompiledDeckSafe` (`:449-477`, line rules `:429-436`), run on the `generated` and the
   `executed` deck inside the compiler (`:261`, `:266`), by the worker immediately before `executed.cir` is written
   (`worker.ts:176`, with the compiler's own expectation) and by the smoke test before its deck is written: LF is the only line
   break (a form feed is also read as one: every rule holds for each form-feed piece) and no NUL, VT, CR, U+0085, U+2028 or
   U+2029; the title (the first line) is text, refused only as a `*ng_script` title (`:458`); an executed deck holds exactly
   the compiler's own block from the second line on, line for line (`.control`, `set filetype=ascii`, `run`, a `write` line of
   the server-owned path and allowlisted expressions, `quit`, `.endc`, `:420`), any other deck none (`.control`/`.endc` matched
   by prefix, as ngspice matches them); outside the block no `.title *ng_script`, no `*#` line but a banner of `#`, `-`, `=` and
   whitespace (`:426`), no `.shell/.cd/.source/.quit/.exec/.system/.destroy/.remcirc`, no line starting with one of the 13
   command words the task names (`:423`) unless it is an element card the compiler wrote (`:409-417`), no `!` line, no command
   substitution; and an executed deck reads no file through `.include`/`.lib` except the includes the compiler wrote from
   `modelPaths`. A refusal in the worker ends the run `failed` (the job store's existing throw path) with no deck written, no
   process and no fabricated result.
7. **The route refuses before any job exists:** `startRunPlan` (`job-store.ts:182`) compiles one deck per test and analysis
   exactly as the worker does and screens each run point's label, values and temperature (`:313-350`); it raises only
   `SpiceDeckSafetyError`, which `POST /api/spice/runs` already answers `422` (`app/api/spice/runs/route.ts`, unchanged). A test
   whose model the existing model screen refuses, or whose IR does not compile, is left to the worker (it refuses the run first,
   before any deck, with that message); every other compile error stays the per-run failure the worker reports, as before.
8. **The smoke test** screens the subcircuit name with the shared screen and the whole deck with the final screen (no control
   block, executed), before any file or process, and writes exactly the deck it screened, CRLF read and written as LF
   (`smoke-test/route.ts:86`, `:117-120`).
9. **Explicit environments (D22-5's ngspice half):** the worker's `-v` probe (`worker.ts:60`) and the smoke test
   (`smoke-test/route.ts:59`, `:122-128`) pass the worker's exact allowlist (`PATH, Path, PATHEXT, SystemRoot, WINDIR, TEMP,
   TMP, HOME, USERPROFILE, LD_LIBRARY_PATH` plus `NODE_ENV`), as /api/simulate does. The suite pins the three allowlists equal
   and equal to that literal list.
10. **Test seams** `__deckLayersForTests` (`netlist.ts:480`): the writer and the `.options` screen, so each layer is pinned on
   its own behind the field screen.

## 4. What is not changed, stated deviations and residuals

- **No legitimate deck changes.** Every existing SPICE suite is green unchanged; the base project's deck is pinned clean; the
  title's CR/LF replacement stays (now unreachable). The smoke deck of a Windows model file is now written with LF instead of
  CRLF (the same deck to ngspice).
- **Inputs refused that main accepted (stated; none legitimate in a working run):** a refused character (any line-break form,
  NUL, another C0 or C1 control, DEL, a backtick) in any single-line field, identity names included (refused raw instead of
  sanitized, as the task requires: never stripped into a different deck); an output expression or current probe name outside
  the allowlist, a TAB included (never a valid vector on the `write` line); model text with a `*#` command line (any `*#` line
  that is not a banner of `#`, `-`, `=` and whitespace), with a line starting with one of the 13 command words (a vendor element
  named exactly `CD`, `LOAD`, `QUIT`, `DEFINE` or `CODEMODEL`, or `SET`, `WRITE`, `ALIAS`, `UNSET`, `SOURCE`, `SHELL`, `SETCS`,
  `UNSETCS`, as a whole word, is refused in model text; the compiler's own cards so named pass), with VT, a lone CR, U+0085,
  U+2028/U+2029 or NUL, with a `.title *ng_script` line, or, in an executed deck, with an `.include` or `.lib` line (no file
  exists in the run's fresh directory, so such a deck never ran as intended; with an absolute or traversing path it read a host
  file). A model whose include dependencies are recorded keeps the existing model-screen refusal and message.
- **Deviations from the SEC-1 task text, after the review (for the lead to note):** a TAB passes the shared screen (the task
  says "every other control character"): SPICE reads it as whitespace, it never opens a line, it was valid in these fields on
  main, and refusing it refused whole run plans pasted from tab-formatted netlists; the `write` line's allowlist still refuses
  it. In model text, a form feed (a legacy page break) passes, read both as whitespace and as a line break so neither reading
  hides a line; a TAB, ESC, DEL or another control character that is not a line break passes inside a model line, as on main
  (the field screen refuses them in every single-line field).
- **The compile preview (`/api/spice/compile`, the export path) keeps `.include`/`.lib` directives** from model text and
  directives: it is never executed by the server, and a downloaded deck may include files on the user's own machine; it still
  refuses any control block, `*#` command lines, script titles, shell directives and command lines.
- **Left to the worker, by design (review finding coverage-5):** a test whose model the existing model screen refuses, or whose
  IR does not compile, is not compiled by the route preflight; the run request answers `202` and the run fails before any deck
  with that screen's or compiler's message (pinned).
- **Residual, recorded for D22-4 / B22-A1 (review finding coverage-6):** the final screen holds file reads through
  `.include`/`.lib` only. XSPICE code models whose parameters name a file (`filesource` `file=`, `d_source` `input_file=`,
  `d_state` `state_file=`, `table2D`/`table3D` `file=`) in model text are not screened by SEC-1; ngspice would read that file
  into a vector the run returns (INFERRED from the ngspice XSPICE documentation, never executed). The model-text allowlist
  belongs to B22-A1.
- **Kept as they are:** kicad-cli and FreeRouting (B22-A's); the SPICE AI route's `"automatic"` pre-selection of overlay,
  variable and run-request operations (`ai/route.ts:68-72`, `:206`, `:228`; OD-150 in the B22 discovery decides it) - with
  every model-written string now screened at the compiler, the run it starts can no longer reach `shell`; HOME and USERPROFILE
  in the allowlist (B22-A3's profile environment); the model screen's other D22-4 gaps (`.lib` and traversal for the preview,
  client-supplied `dependencies`, the `??`/`||` differential itself), whose `shell` and `.include`/`.lib` consequences in
  executed decks the final screen now holds; `units.ts` (its passthrough is now always fed a screened value); `/api/simulate`
  (its own B19-D screens; its `unsafe()` copy does not refuse U+0085/U+2028/U+2029, which ngspice does not read as line breaks,
  INFERRED); authentication, CSRF, roles, routes (the route-policy census stays 165 / 162 / 3 / 0), no new dependency.
- **UNKNOWN, never executed:** whether ngspice-46 under `ngspice_con -b` on Windows actually runs an injected block, honours
  `*#` lines (and reads a banner's `#...` rest as a comment or an unknown command), matches `.control` by prefix, reads
  `;`/`>`/`$` on a `write` line as the front end's lexer suggests, treats a `*ng_script` title or a `.title *ng_script` line as a
  script deck, reads a form feed as whitespace, or reads a command word outside a control block as an element card. Each hostile
  case is refused regardless; no live probe was run (owner approval needed for one).

## 5. Gates (2026-10-01, the SEC-1 tree after the review round, every run under the global heavy-job lock)

- `app/lib/spice/__tests__/sec-1-deck-injection.test.ts` (244 cases): 227 failed / 17 passed against `6fd5a7b`'s sources; 106
  failed / 138 passed on the first SEC-1 tree; green 244/244. Deliberate breakages of the source, in three runs (the sources
  restored from a copy and checked by hash after each): the writer splitting again, `assertSafeDirective` trimming only, the
  `.options` screen back to `\s`, the command words cut to `shell`, the dot directives cut to `.shell`, the final screen
  dropping VT/U+0085/U+2029 and the form-feed reading (48 cases failed); the preflight screening the first run point only and
  dropping the model screen (6 failed); the preflight raising every compile error, a key added to all three env allowlists,
  and the shared screen trimming first (10 failed). Each breakage was caught by the case written for it.
- SPICE suites and their gates: `app/lib/spice/__tests__` (the opt-in `worker-integration.test.ts` stays opt-in: 3 skipped),
  `app/api/simulate/__tests__`, `app/api/__tests__/b16-0-23-tranche-parity`, `b16-0-4-bounded-body-behavior`,
  `b16-0-5-media-type-and-wrapper`, `app/lib/auth/__tests__/b16-0-2-gates`, `b16-0-23-tranche16-confinement-gate`,
  `b16-0-24-tranche17-confinement-gate`, `b16-0-8-migration-ratchet`, `app/lib/llm/__tests__/b16-0-23-adapter-schema-parity`,
  `app/lib/mcp/server/__tests__/b20-b4-process-gate`, `app/lib/acquisition/__tests__/b19-e-ci-job-scope`,
  `app/lib/engineering/__tests__/b07-1-identity-geometry-gestures` (it imports the IR compiler): 18 files passed, 1 skipped;
  519 tests passed, 3 skipped.
- Import gates and census: `b20-b2-import-gates`, `b20-b3-import-gates`, `b20-d3-authority-import-gates`,
  `b14-4-ast-import-gates`, `b15-3-import-gates`, `b18-b-import-gates`, `b16-1c-invariant-tripwires` (165 / 162 / 3 / 0),
  `b20-b2-route-tree`, `b20-b2-route-matrices-pinned`, `b16-0-1-ci-gates`, `b16-0-4-authorization-and-body-gates`,
  `b16-0-7-wrapper-adoption-gate`, `b16-0-7-analyzer-hardening`, `b16-0-24-1-security-correction`, `b16-0-24-tranche-parity`,
  `b20-c1-three-way-parity`: 16 files, 194 tests passed.
- `tsc --noEmit -p tsconfig.json`: clean. `eslint` on the six changed code files: clean.
- Generators that read the route sources: `scripts/generate-b16-0-4-artifacts.ts` (165 + 165 rows),
  `scripts/generate-b16-0-7-artifacts.ts` (165 / 162 / 3 / 0) and `scripts/generate-b16-0-8-baseline.ts` (3 -> 3): zero drift.
  `scripts/spice-ci.ts` runs ngspice and was not run.
- CI: the suite is an explicit `prompt-to-gerber` entry in `.github/workflows/deterministic-manufacturing.yml` (`app/lib/spice`
  is no directory filter there; the suite starts no PGlite), pinned by a case in `b19-e-ci-job-scope.test.ts`.

## 6. Line positions (for citations into these files)

- `app/lib/spice/netlist.ts`: edits in place at `:33`, `:152`, `:155`, `:198`, `:214`, `:239`, `:261`, `:266`; lines 1-282 keep
  their numbers; the SEC-1 helpers are appended at `:284-480`.
- `app/lib/spice/server/worker.ts`: edits in place at `:10`, `:60`, `:176`; no line moves (B20's `worker.ts:81-100` holds).
- `app/lib/spice/server/job-store.ts`: three imports after `:21` and one call at `:182` - base lines 22-178 move by +3, base
  lines 179 onward by +4 (for example `:145` -> `:148`, `:149` -> `:152`, `:219` -> `:223`, `:241-293` -> `:245-297`); helpers
  appended at `:313-350`.
- `app/api/spice/models/smoke-test/route.ts`: one import after `:7` - base lines 8 onward move by +1 (`:58` -> `:59`,
  `:77-78` -> `:78-79`, `:102` -> `:103`); helpers appended at `:111-128`.
- `app/lib/spice/units.ts`, `app/lib/spice/ir.ts`, `app/lib/spice/run-plan.ts`, `app/api/spice/runs/route.ts`,
  `app/api/spice/ai/route.ts`, `app/api/simulate/route.ts`: unchanged.

## 7. For the lead

The lead's files are not edited here; the texts below are for them, with `<sha>` the SEC-1 commit.

**EXECUTION_LEDGER paragraph:**

> ### SEC-1 - the SPICE Studio deck injection (corrective security branch `fix/spice-deck-injection` from main `6fd5a7b`; closes D22-3 and the ngspice half of D22-5)
> Test-first: `app/lib/spice/__tests__/sec-1-deck-injection.test.ts` (244 cases) runs 227 red / 17 green against `6fd5a7b`'s
> sources. Every one of the 79 fields the Studio compiler writes from caller or model data admitted all 12 hostile payloads
> (LF, CR, CRLF, U+0085, U+2028, U+2029, VT, FF, NUL, ESC, DEL, a backtick), 70 of them as a live second `.control` block with
> `shell` (the other 9 were replaced or sanitized into a clean deck); output expressions also carried `;` and `>` onto the
> compiler's own `write` line; model text reached the deck with a `*#` line, a command-word line or, through the screen's
> `??`/`||` differential, a whole control block; and through `POST /api/spice/runs` (spawn and files faked) a hostile source
> value answered 202, the deck was written with the injected block and ngspice was spawned. The smoke test and the worker's
> `-v` probe passed no environment. Fix: one single-line screen `assertDeckText` (/api/simulate's B19-D `unsafe()` rule
> extended to U+0085, the C1 controls, U+2028 and U+2029; a TAB passes as SPICE whitespace) applied raw to every field at the
> IR -> deck boundary, the raw identity names included; output expressions allowlisted; the writer pushing one line per
> string; `assertSafeDirective` one line and closed; the `.options` screen space/tab only; and a final deck screen
> `assertCompiledDeckSafe` (exactly the compiler's own control block; no `*#` command line but a vendor banner, no script
> title, none of the task's 13 command words but the compiler's own element cards, no shell directive and, in an executed
> deck, no `.include`/`.lib` read; a form feed read both as whitespace and as a line break; the title never a card) run in the
> compiler, before the worker writes `executed.cir` and before the smoke test writes its deck (the bytes it screened).
> `startRunPlan` compiles one deck per test and analysis and screens each run point's own fields, so the route answers 422
> `SPICE_DECK_UNSAFE` before any job exists; the smoke test and the `-v` probe pass the worker's env allowlist, pinned
> literally. An adversarial review confirmed 21 findings (a TAB refused, one compile per run point in the request, vendor
> banners and form feeds refused, `ng_script` matched as a substring, five command words missing, identity names stripped,
> and test-strength and record gaps); each was reproduced red (106 red / 138 green on the first SEC-1 tree) or proved by a
> deliberate breakage of the source, then fixed. Green 244/244; the SPICE suites and gates (19 files, 1 skipped opt-in), the
> import gates and census (16 files; 165 / 162 / 3 / 0), tsc, eslint and three route-source generators with zero drift; CI
> admits the suite as an explicit prompt-to-gerber entry, pinned by `b19-e-ci-job-scope`. Not changed: kicad-cli,
> FreeRouting, the SPICE AI `"automatic"` pre-selection (its strings are now screened at the compiler; OD-150 open),
> HOME/USERPROFILE in the allowlist (B22-A3), the rest of D22-4 (XSPICE file parameters in model text recorded as a residual),
> routes, authentication, CSRF, roles; no dependency. Stated deviations from the task text: a TAB and, in model text, a form
> feed pass (section 4 of the page). Exploitation through a real ngspice stays INFERRED (never run).
> Page: `artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md`. Commit `<sha>`.

**B22 discovery closure clauses** (for D22-3 and D22-5 in section 4, and section 10, when the discovery is committed):

- D22-3: **Closed by SEC-1** (corrective branch `fix/spice-deck-injection`, `<sha>`, 2026-10-01): every caller- or
  model-controlled string the Studio compiler writes is screened as one line at the IR -> deck boundary (79 fields by 12
  payload forms, refused with a closed `SPICE_DECK_UNSAFE` error, red before; a TAB passes as whitespace), output expressions
  are allowlisted, `assertSafeDirective` checks one line, the `.options` screen admits space and tab only, and a final deck
  screen runs in the compiler, before the worker writes `executed.cir` and before the smoke test writes its deck;
  `POST /api/spice/runs` refuses a hostile plan with 422 before any job exists, except a plan whose test the worker refuses
  before any deck (a model the existing model screen refuses, or an IR that does not compile): that request answers 202 and
  its run fails with no deck written and ngspice never run (`artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md`).
  The SPICE AI `"automatic"` pre-selection is unchanged (OD-150 stays open); end-to-end exploitation stays INFERRED (never
  executed).
- D22-5: **The ngspice half closed by SEC-1** (`<sha>`): the smoke test and the worker's `-v` probe pass the worker's explicit
  allowlist, pinned equal across the three ngspice spawners and to the literal list. Open: kicad-cli's inherited environment
  (B22-A1, OD-148) and HOME and USERPROFILE in the ngspice allowlist (B22-A3's profile environment).
- D22-4 (recorded, not closed): in an EXECUTED deck the final deck screen now refuses the shell and `.include`/`.lib`
  consequences of the model screen's gaps (the `??`/`||` differential, `*#` command lines, command-word lines, `.lib`, a
  relative `.include`); XSPICE code-model file parameters in model text (`file=`, `input_file=`, `state_file=`) are not
  screened (an INFERRED host-file read); the model screen itself, its client-supplied `dependencies` and the preview are
  unchanged, so D22-4 stays open for B22-A1.
- Section 10 amendment: "SEC-1 (`<sha>`) landed D22-3 and D22-5's ngspice half on a corrective branch from main before B22
  (OD-137's alternative); B22-A1's `b22-a-deck-injection` scope shrinks to what SEC-1 left (D22-4 with the XSPICE file
  parameters, kicad-cli, OD-150)."

**LIVE_BLOCKERS / OWNER_DECISIONS:** none needed. The stricter behaviours in section 4 (an output-expression allowlist,
executed decks refusing `.include`/`.lib` while the preview keeps them, identity names refused raw, model-text command-word
lines refused) follow the SEC-1 task. The two deviations from its text (a TAB passes the shared screen; in model text a form
feed and other non-line-break control characters pass, as on main) were made to close confirmed review regressions; if the
lead wants them on record as an owner decision, a text: "OD-(next) - SEC-1 review: the SPICE deck screen admits a TAB in
single-line fields (SPICE whitespace, never a line) and, in model text, a form feed (read both as whitespace and as a line
break) and other control characters that are not line breaks, as main did; every line-break form, NUL and a backtick stay
refused everywhere. Recorded 2026-10-01; owner confirmation pending."
