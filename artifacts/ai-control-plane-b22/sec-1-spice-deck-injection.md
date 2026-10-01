# SEC-1 - the SPICE Studio deck injection (closes D22-3; the ngspice half of D22-5)

Corrective security branch `fix/spice-deck-injection`, cut from `origin/main` at `6fd5a7b` (runbook section 2.4), 2026-09-30,
with an adversarial review round on 2026-10-01 (round 1, section 2.5) and a grounding-and-review round on 2026-10-01 (round 3,
section 8, with its own adversarial review, section 8.4; round 2 made no code change). Test-first: the suite
`app/lib/spice/__tests__/sec-1-deck-injection.test.ts` was written and run red on the unmodified tree, then the fix made it
green; each confirmed review finding was reproduced red (or, for
a test-strength finding, proved by a deliberate breakage of the source) before its fix. No hostile deck was ever run by ngspice
in this work: the reproduction is at the deck level (the compiler, with the worker's options) and through the routes with
`node:child_process` and `node:fs/promises` replaced by in-process fakes (the B19-D pattern), so no deck reaches the disk and no
process starts. The fake spawn records environment KEY NAMES only. The lead ran the ngspice-46 probes that ground the final
screen (section 1b); this chapter ran none.

Line numbers in section 1 are of the base `6fd5a7b`; in section 2.5 of round 1's tree `fe147c9` (several of those positions
have since moved or gone, see section 6); in sections 3, 6 and 8 of the final round-3 SEC-1 tree. Section 2 is round 1's
reproduction record; where round 3 changed a behaviour it records, the statement says so.

## 1b. The ground: what ngspice-46 actually executes (CONFIRMED by the lead's probes, 2026-10-01)

The lead ran ngspice-46 (`ngspice_con -b`, Windows; `Compiled with KLU Direct Linear Solver`) over one probe deck per construct,
each in its own temporary directory, the only command in any deck being ngspice's own `echo <MARKER>` and `set` — no shell
command, no path outside the probe directory, no network. A placement EXECUTES only when ngspice printed the marker alone on an
output line. Every ngspice process exited. This table is the lead's; it is the ground the round-3 screen is cut to.

| probe | deck construct | executes a command? (CONFIRMED by observation) |
|---|---|---|
| p0 | `.control` / `echo` / `.endc` (positive control) | YES — prints the marker |
| p1 | `echo` line at the top level, outside any control block | no — parse error, the line is read as a card |
| p2 | `echo` line inside a `.subckt` | no — parse error |
| p3 | `*# echo ...` | YES — the `*#` line runs its rest as a command |
| p4 | first line `*ng_script`, then `echo ...` | YES — the deck runs as a script, in batch mode too |
| p6 | a card, a FORM FEED, then `echo ...` on the same line | no — the form feed is whitespace; one card, parse error |
| p7 | `.include` of a file whose top level holds `echo ...` | no — parse error |
| p7b | `.include` of a file holding `.control` / `echo` / `.endc` | YES — an included control block runs |
| p9 | top-level `set var=...`, then a control block echoing `$var` | no — `set` read as a switch card (no model), never assigned |
| p8a | vendor `.subckt` with cards `Cd`, `Load`, `Define` (diode), `Rset` | parsed and simulated: op point V(2)=0.6925 V |
| p8b | switch cards named `Source` and `Set` with an SW model | parsed and simulated: op point V(2)=0.00499 V |
| p10 | FIRST line `.title *ng_script`, then `echo ...` | YES - the deck runs as a script (a `.title` first line is read for the script marker) |
| p11 | FIRST line `.title *# echo ...` | no - the title text is printed as the circuit name; nothing runs |
| p12 | a `.title *# echo ...` line after the title | no - the title text is printed as the circuit name; nothing runs |
| p13 | FIRST line `*# echo ...` (a `*#` line as the title) | no - printed as the circuit title (`Circuit: *# echo ...`); nothing runs |

**Conclusion (the lead's).** ngspice-46 executes commands ONLY inside a `.control` block (including one inside an `.include`d
file), from a `*#` line, and in a deck titled `*ng_script`. A command word anywhere else — the top level, inside a subcircuit,
after a form feed, in an included file's body, a top-level `set` — is read as a card (an element named by its first letter) and
never runs. Element cards whose names spell a command word (`Cd`, `Load`, `Define`, `Source`, `Set`, `Rset`) are ordinary
devices. Round 3 cuts the final screen to this set: it refuses every executing construct and nothing a legitimate card needs,
plus the INFERRED defences section 4 lists.

**What the table does not cover.** Probes p0-p9 had an ordinary title on line 1: p3's `*#` line was line 4, after the title,
and p4 was the only probe of line 1, so at round 3 whether ngspice runs a `*#` title was UNKNOWN. [SEC-1 lead] The lead's
later probes cover the title: p10 (a first line `.title *ng_script` runs the deck as a script), p11 and p12 (a `.title *# ...`
line, on line 1 or after it, runs nothing) and p13 (a `*#` line as line 1 is printed as the title and runs nothing). The screen
refuses a non-banner `*#` title anyway, as defence in depth beyond the ground (section 4).

[SEC-1 lead, 2026-10-01] The round-3 check found that line 1 - the title, which carries the project name - was screened only as
written, so a project named `.title *ng_script` reached the deck; the lead's probe p10 CONFIRMS that a first line `.title *ng_script`
runs the whole deck as a script, in which every later line runs as a command - with round 3's (correct) acceptance of command-word
element cards, a vendor model line could then run. Line 1 is now read through a `.title` prefix as well (`netlist.ts:472`, in
place), test-first: two rows of the refused-title table (`.title *ng_script` and `.TITLES  *NG_SCRIPT` as the project name) were
red on the unfixed screen and are green; the suite is 268/268. The lead's probe p13 (a `*#` line as line 1) and p11/p12 (a
`.title *# ...` line on line 1 and after it) CONFIRM that ngspice-46 batch mode prints a `*#` title as the circuit name and
runs nothing, so the non-banner `*#`-title refusal is stricter than the ground. It is kept unchanged (it fails closed; whether
to drop it is the owner's decision, section 7, whose option (c) these probes answer). Every statement below that no probe put
a `*#` line on the title, or that whether one runs is UNKNOWN, records round 3's state and is superseded by p11-p13.

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

Round 1's suite (at `fe147c9`) had 244 cases; round 3's has more (section 5). Round 1 ran it against main's sources (the four
SEC-1 source files replaced by their `6fd5a7b` text for one run, then restored and checked by hash): **227 failed, 17 passed**.
The 17 are the baseline deck, the two never-written strings,
and the cases that pin what main already did right and SEC-1 must keep: a TAB in a directive or option (compile and route),
`ng_script` inside a name or comment, a title starting `.control` or `.endc`, compiler element cards named like a command word,
vendor `*#` banners and form-feed page breaks in model text, the preview keeping a model's file directive, a TAB, ESC or DEL
inside a model line, and the three run requests the worker refuses before any deck. On the first SEC-1 tree (before the review
round) the same suite ran **106 failed, 138 passed** (section 2.5). After round 1's fix: **244 passed**. (The suite's first
version, 158 cases with a TAB counted as a refused form, ran 148 red / 10 green on `6fd5a7b`.)

Each field case applies a legitimate value first (it must still compile to a clean deck: exactly the compiler's own control
block and no other executing construct - no `*#` line or title, no script title, no file read; round 1's deck oracle also
flagged a line starting with a command word, round 3's does not, section 8), then 12 payloads, each with the field's
legitimate text as a prefix: LF, CR, CRLF,
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
- [Round 3 review, INFERRED defence in depth; the lead's p11-p13 later CONFIRMED a `*#` title runs nothing] A project named `*# shell ...` or `*#2 buck stage` (the title becomes a
  non-banner `*#` line), a `.title *# ...` directive, a `.TITLE *# ...` model line, and the prefix-spelled `.titles *ng_script`
  and `.titles *# ...`: compiled on `fe147c9` and on main, refused now (section 8.4); a `.title *#=====` banner and a `.title`
  that only mentions `*#` after its text are accepted, in the run and the preview.
- A one-line `.control` or `.endc` directive: red only as an open error (`Unsafe custom ngspice directive is not allowed: .control`
  echoed the text); now closed and a `SpiceDeckSafetyError`. A prefix-spelled `.controls` (ngspice matches the prefix): red,
  compiled with two control lines.
- An `.include` and a `.lib` directive: red, compiled into the executed deck.
- Model text (each passes the existing model screen, asserted in the suite): an empty `transformedContent` over a hostile
  `originalContent` (red: two control blocks), a `*#` line (red: compiled), a relative `.include` with no recorded dependency and
  a `.lib` read (red: compiled). Model text carrying each line-break form, NUL or a backtick is refused at compile and by the
  smoke test before any file (review finding tests-6); a TAB, ESC or DEL inside a model line opens no line and passes, as on
  main. [Superseded by round 3] Round 1 also refused model text with a line starting with any of the 13 command words the task
  named; round 3 compiles each of them to a clean deck (a card, not a command: the probe table, section 8).
- The final screen alone, on hand-altered compiled decks (round 3's list, 28 alterations: a second or prefix-spelled control
  block, `*#`, `*ng_script`, `.include`, `.lib`, `.shell`, `!`, command substitution, an extra command inside the compiler's
  block, `;` or `>` on the `write` line, CR, NUL, U+2028, U+2029, U+0085, VT, a form feed hiding a control block, a form feed in
  the title hiding a `*#` command or a control block (round 3 review), and the seven dot directives `.cd`/`.source`/`.quit`/
  `.exec`/`.system`/`.destroy`/`.remcirc`): red (the screen did not exist), refused after. [Superseded by round 3] Round 1's
  list had 40 alterations, the extra ones a bare command word outside the block (`shell` and the 12 others) and a form feed in
  the title hiding one, all refused, with an exemption for the compiler's own element cards; round 3 accepts each of them (a
  card wherever it appears) and the exemption is gone.
- Each defence layer on its own (review finding tests-2): `assertSafeDirective` refuses a line break anywhere, before the trim;
  the writer refuses a string with a line break instead of splitting it; the `.options` screen keeps a TAB-separated entry and
  drops one with a line break.
- Refused characters at the start or end of a value, where a trim would remove them (review finding tests-8): seven fields by 10
  edge forms, each refused raw.
- Legitimate inputs (green on main, kept green): a TAB-separated `.param` directive and `.options` entry; `ng_script` in a
  project name, a node name and a model comment; a project named `.controller demo` or `.endc review`; compiler cards named `CD`
  and `load`; vendor banners (`*####`, `*#----`, `*#====`, `*#`) and form-feed page breaks in model text (run, preview and smoke
  test). Still refused after round 3: a `*#` line naming a command or holding a `*`, a banner going on to a command, and a form
  feed before a `*#` command or hiding a control block. [Superseded by round 3] Round 1 also refused a form feed before a bare
  command word; round 3 accepts it (the form feed is whitespace, one card: probe p6).

### 2.3 End to end: `POST /api/spice/runs` with ngspice not executed

The route suites' harness (`injectAuthorizedPrincipal`, same-origin CSRF headers, an editor member), the real job store and the
real worker, with the spawn and the file system faked. Outcome recorded per request: status, closed error, jobs, decks written,
the deck's findings, ngspice runs.

- **Red** (each of the 12 source-value forms, a custom `.options` entry with LF, an `.ic` value with LF, an advanced directive
  with LF, an output expression with `;`, the model differential, a model `*#` line, a net label with LF, and a hostile value
  on a later sweep point, a second analysis or a second test): `202`, one or two jobs, the deck **written** with the injected
  line(s) (the net label: stripped into a different deck) and **ngspice spawned**: the exploit path reaches `spawn`. A
  one-line `.control` directive: `202`, the run failed in the worker with no deck.
- **Green:** every one of those requests answers `422 {"ok":false,"error":"SPICE_DECK_UNSAFE: ..."}`, no job, no deck written,
  no process.
- **[Superseded by round 3]** Round 1 also refused (`422`) a run whose model text carried a line starting with a command word
  (`codemodel`, `shell`); round 3 runs it - `202`, the deck written, ngspice spawned - since such a line is a card, never a
  command (the probe table), and a vendor subcircuit with `Cd`/`Load`/`Define`/`Set`/`Source` cards runs too (section 8).
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
- [Round 3 review, finding tests-1] Model text with a relative traversing `.include` or a `.lib` read, both admitted by the
  model screen (it refuses only an absolute `.include`/`.inc` and has no `.lib` rule): `422` closed, no file, no process. The
  smoke deck is screened as an EXECUTED deck (`smoke-test/route.ts:119`), the only guard on this route against a file read (an
  included control block runs, probe p7b); screening it as not executed returns `200`, writes `smoke.cir` and spawns ngspice
  (the deliberate breakage these two cases catch, section 8.4).
- A legitimate model: ngspice spawned with the allowlisted environment (red: no environment).
- A Windows (CRLF) model file still smoke-tests, and the deck written is now the deck screened, LF only (red on the first SEC-1
  tree: the CRs were written, review finding coverage-9).

### 2.5 The review round (2026-10-01)

An adversarial review of the first SEC-1 tree confirmed 21 findings; each was reproduced (red on that tree) or, for a
test-strength finding, proved by a deliberate breakage of the source (the sources restored and checked by hash after each run).
The positions in the Fix column are of round 1's tree `fe147c9`; round 3 removed the command-word rule (`COMMAND_LINE`) and the
compiler-card exemption the coverage-2/tests-1 row names, and moved the rest (section 6 has the final positions).

| Finding | Reproduction (red on the first SEC-1 tree, or the breakage it now catches) | Fix |
|---|---|---|
| regressions-tab-single-line-fields (TAB refused, whole plan 422) | TAB per field, `.param<TAB>` and `.options` entry compile, route `202`: all refused | the shared screen admits a TAB (`netlist.ts:303`) |
| regressions-preflight-sync-compile (one compile per run point in the request) | 24-point plans: 24 compiles | one compile per test and analysis, run point fields per point (`job-store.ts:322-339`, `netlist.ts:341-345`) |
| regressions-model-banner-ff-refused | banners and form-feed page breaks refused in run, preview, smoke | banner rule (`:426`); a form feed is read both ways (`:469-473`) |
| regressions-ng-script-substring; coverage-11 | `ng_script` in names, `.controller`/`.endc` titles refused | `*ng_script` title or `.title` only (`:430`, `:458`); title never a card (`:459-460`) |
| coverage-2; tests-1 (five command words missing) | `cd`/`load`/`quit`/`define`/`codemodel` lines compiled; breakage of the word list or dot rule caught | the task's 13 words (`:423`), compiler cards exempt (`:409-417`) - both removed by round 3 (a command word outside a control block is a card, section 8); the dot rule stays |
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
6. **The final deck screen** `assertCompiledDeckSafe` (`:463-490`; line rules `assertDeckLineSafe` `:441-447`; title rules
   `assertTitleSafe` `:429-432`), run on the `generated` and the `executed` deck inside the compiler (`:261`, `:266`), by the
   worker immediately before `executed.cir` is written (`worker.ts:176`, with the compiler's own expectation) and by the smoke
   test before its deck is written: LF is the only line break (a form feed is also read as one: every rule holds for each
   form-feed piece, the title's included) and no NUL, VT, CR, U+0085, U+2028 or U+2029; the title (the first line) is text,
   held only by the title rules (`:472`): an `*ng_script` title is refused (CONFIRMED to run the deck as a script, probe p4),
   and so is a non-banner `*#` title - defence in depth added by round 3's review, beyond the ground (the lead's p11-p13
   CONFIRM a `*#` title runs nothing; section 4); an executed deck holds exactly the compiler's own block from the second line on, line for line
   (`.control`, `set filetype=ascii`, `run`, a `write` line of the server-owned path and allowlisted expressions, `quit`,
   `.endc`, `:419`), any other deck none (`.control`/`.endc` matched by prefix, as ngspice matches them); outside the block no
   `.title` line whose text is an `*ng_script` or non-banner `*#` title (read as written and as ngspice's prefix match reads
   `.titlex`, INFERRED), no `*#` line but a banner of `#`, `-`, `=` and whitespace (`BANNER_LINE` `:423`), no
   `.shell/.cd/.source/.quit/.exec/.system/.destroy/.remcirc` directive (retained defence in depth: no legitimate element card
   is a dotted directive; a superset of the model screen's own `.shell/.cd/.source/.quit` list, `models.ts:200`), no `!` line,
   no command substitution; and an executed deck reads no file through `.include`/`.lib` except the includes the compiler wrote
   from `modelPaths`. [SEC-1 round 3] It NO LONGER refuses a line that merely starts with a command word: the lead's probes
   (section 1b, p1/p2/p6/p7/p9) CONFIRM such a line is read as an element card and never runs, so a vendor card named `Cd`,
   `Load`, `Set`, `Source` or `Define` passes and the old `cards` exemption is gone (`DeckExpectation` `:402`;
   `compiledDeckExpectation` `:409`). A refusal in the worker ends the run `failed` (the job store's existing throw path) with no
   deck written, no process and no fabricated result.
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
10. **Test seams** `__deckLayersForTests` (`netlist.ts:493`): the writer and the `.options` screen, so each layer is pinned on
   its own behind the field screen.

## 4. What is not changed, stated deviations and residuals

- **No legitimate deck changes beyond restoring vendor cards, but for one stated deviation** (the `*#` title, below and in the
  deviations). Every existing SPICE suite is green unchanged; the base
  project's deck is pinned clean; the title's CR/LF replacement stays (now unreachable). The smoke deck of a Windows model file
  is now written with LF instead of CRLF (the same deck to ngspice). [SEC-1 round 3] A vendor subcircuit whose body holds an
  element card named like a command word (a capacitor `Cd`, an inductor `Load`, a diode `Define`, switches `Set`/`Source`, and
  the rest of the list below) compiles, previews, smoke-tests and runs again — round 1's command-word screen had refused these,
  the regression this round closes.
- **Inputs refused that main accepted (stated; none legitimate in a working run):** a refused character (any line-break form,
  NUL, another C0 or C1 control, DEL, a backtick) in any single-line field, identity names included (refused raw instead of
  sanitized, as the task requires: never stripped into a different deck); an output expression or current probe name outside
  the allowlist, a TAB included (never a valid vector on the `write` line); model text with a `*#` command line (any `*#` line
  that is not a banner of `#`, `-`, `=` and whitespace), with VT, a lone CR, U+0085, U+2028/U+2029 or NUL, with a
  `.title *ng_script` line, or, in an executed deck, with an `.include` or `.lib` line (no file exists in the run's fresh
  directory, so such a deck never ran as intended; with an absolute or traversing path it read a host file); and [SEC-1 round 3
  review, INFERRED defence in depth, a stated deviation] a deck whose TITLE is a non-banner `*#` line: a project name starting
  `*#` (for example `*#2 buck stage`; the title is `<project> — <test>`, so no project name yields a pure banner title), or a
  `.title` line in a directive or model text whose text is a non-banner `*#` line or `*ng_script` (also as ngspice's prefix
  match reads `.titlex`, INFERRED). Main and `fe147c9` compiled such a project name. [SEC-1 lead] The lead's p11-p13
  (section 1b) CONFIRM ngspice-46 batch runs nothing from a `*#` title; the refusal fails closed, stricter than the ground, and the owner may keep or drop it (proposed
  owner decision, section 7). A model whose include dependencies are recorded keeps the existing model-screen refusal and
  message. [SEC-1 round 3] A line that merely STARTS with a command word (`cd`, `load`, `set`, `source`, `define`, `write`,
  `quit`, `shell`, `alias`, `unset`, `codemodel`, `setcs`, `unsetcs`) outside the compiler's control block is NO LONGER
  refused: the lead's probes (section 1b) show ngspice reads it as an element card and never runs it, so refusing it broke
  legitimate vendor model text. The constructs that DO execute (CONFIRMED) - a second `.control` block, a `*#` line, an
  `*ng_script` title, an `.include`/`.lib` in an executed deck - stay refused, and so does the `*#` title (defence in depth beyond the ground).
- **Deviations from the SEC-1 task text, after the review (for the lead to note):** a TAB passes the shared screen (the task
  says "every other control character"): SPICE reads it as whitespace, it never opens a line, it was valid in these fields on
  main, and refusing it refused whole run plans pasted from tab-formatted netlists; the `write` line's allowlist still refuses
  it. In model text, a form feed (a legacy page break) passes, read both as whitespace and as a line break so neither reading
  hides a line; a TAB, ESC, DEL or another control character that is not a line break passes inside a model line, as on main
  (the field screen refuses them in every single-line field). [SEC-1 round 3 review] A non-banner `*#` title (a project name
  starting `*#`, or such a `.title` line) is refused although the lead's p11-p13 show a `*#` title runs nothing: defence in depth beyond the ground that
  fails closed, at the cost of refusing project names main accepted (the round-3 task allowed no change to legitimate decks
  beyond restoring vendor cards, so this needs the owner's word, section 7).
- **The compile preview (`/api/spice/compile`, the export path) keeps `.include`/`.lib` directives** from model text and
  directives: it is never executed by the server, and a downloaded deck may include files on the user's own machine; it still
  refuses any control block, `*#` command lines, `*ng_script` titles and the non-banner `*#` titles (defence in depth; on line 1 or set
  by a `.title` line), and dotted shell/filesystem directives - pinned through the preview itself (round 3 review, finding
  tests-2); it no longer refuses a bare command-word line, which the probes show is a card.
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
- **Now CONFIRMED by the lead's probes (section 1b), not UNKNOWN:** ngspice-46 under `ngspice_con -b` runs a command only inside
  a `.control` block (p0), including one inside an `.include`d file (p7b); it runs a `*#` line's rest as a command (p3); it runs
  a deck titled `*ng_script` as a script (p4). It does NOT run a command word at the top level (p1), inside a `.subckt` (p2),
  after a form feed (p6, the form feed is whitespace), in an included file's body (p7), or a top-level `set` (p9) — each is read
  as a card. Element cards named like command words (`Cd`, `Load`, `Define`, `Source`, `Set`, `Rset`) parse and simulate (p8a,
  p8b). The round-3 screen refuses that CONFIRMED executing set, admits every card, and adds only the INFERRED defences named
  next. Still INFERRED (never probed): whether a `*#` title runs in any ngspice but ngspice-46 in batch mode - [SEC-1 lead] p13
  CONFIRMS ngspice-46 batch prints a line-1 `*#` line as the circuit title and runs nothing, and p11/p12 the same for a
  `.title *# ...` line, so the non-banner `*#` title refusal is defence in depth beyond the CONFIRMED ground, kept fail-closed
  pending the owner; whether a `.title *ng_script` line AFTER line 1 runs the deck as a script (p10 CONFIRMS a first line
  `.title *ng_script` does; round 1 refused `.title *ng_script` on that reading) and that ngspice matches `.title`
  by prefix (`.titlex`), read so for both title rules; that a banner's `#=-` rest cannot name a
  command (the banner exception); that `;`/`>`/`$` on the `write` line are front-end metacharacters (the output-expression
  allowlist refuses them anyway); and that the `.shell/.cd/...` DOTTED forms are not an executing set of their own (kept
  refused as defence in depth regardless).

## 5. Gates (round 3 with its review fixes, 2026-10-01, every run under the global heavy-job lock, all on the final tree)

- `app/lib/spice/__tests__/sec-1-deck-injection.test.ts` (268 cases): green 268/268 on the final tree ([SEC-1 lead] 266 before the line-1 `.title` fix).
  - Red on round 1's tree `fe147c9` (its `netlist.ts` and `server/worker.ts` put back for one run, then restored and checked by
    hash; re-run by the lead on the 268-case suite): 44 failed / 224 passed - the two line-1 `.title` rows the lead added (a
    project named `.title *ng_script` or `.TITLES  *NG_SCRIPT`), round 3's vendor-card regression and moved cases (33: the vendor
    `Cd`/`Load`/`Define`/`Set`/`Source` cards in compile, preview, smoke test and run, and a command word outside the block
    read as a card), the INFERRED title cases (6: a project named `*# shell ...` or `*#2 buck stage`, a `.title *# ...`
    directive, a `.TITLE *# ...` model line, `.titles *ng_script`, `.titles *# ...`), the two preview title cases (the `*#`
    project name and the `.title *# ...` directive), and the page-pin case (`assertTitleSafe` does not exist there).
  - Red on main `6fd5a7b` (the four SEC-1 source files put back the same way, then restored and checked by hash; re-run by the lead on the 268-case
    suite): 229 failed / 39 passed - the two line-1 `.title` rows among the failures; the 39 being the inputs main already accepted and SEC-1 keeps accepting (the baseline deck, the two
    never-written strings, a TAB in a directive or option, `ng_script` in names, `.controller`/`.endc` titles, compiler and
    vendor cards named like command words in compile, preview, smoke test and run, command-word model lines, vendor banners and
    form-feed page breaks, `.title` banners, a TAB/ESC/DEL inside a model line, the preview keeping a model's file directive,
    the three run requests the worker refuses before any deck), the page's count case and the page-contract case.
  - The round-3 review's test-strength cases were each proved by a deliberate breakage of the final source, restored and
    checked by hash (section 8.4).
- SPICE and importing suites: `app/lib/spice/__tests__` (the opt-in `worker-integration.test.ts` stays opt-in: 3 skipped),
  `app/api/simulate/__tests__`, `app/lib/engineering/__tests__/b07-1-identity-geometry-gestures` (it imports the IR compiler),
  `app/lib/mcp/server/__tests__/b20-b4-process-gate` (the five spawners unchanged - the fix adds none),
  `app/lib/acquisition/__tests__/b19-e-ci-job-scope`: 10 files passed, 1 skipped; 348 passed, 3 skipped ([SEC-1 lead] 346 before the line-1 `.title` fix). Round 1's broader
  SPICE-importing set, which round 3's first tree had not re-run (`b16-0-2-gates`, `b16-0-8-migration-ratchet`,
  `b16-0-23-tranche-parity`, `b16-0-24-tranche17-confinement-gate`, `b16-0-23-tranche16-confinement-gate`,
  `b16-0-4-bounded-body-behavior`, `b16-0-23-adapter-schema-parity`, `b16-0-5-media-type-and-wrapper`): 8 files, 195 passed.
- Import gates and census: `b20-b2-import-gates`, `b20-b3-import-gates`, `b20-d3-authority-import-gates`,
  `b14-4-ast-import-gates`, `b15-3-import-gates`, `b18-b-import-gates`, `b16-1c-invariant-tripwires` (165 / 162 / 3 / 0),
  `b20-b2-route-tree`, `b20-b2-route-matrices-pinned`, `b16-0-1-ci-gates`, `b16-0-4-authorization-and-body-gates`,
  `b16-0-7-wrapper-adoption-gate`, `b16-0-7-analyzer-hardening`, `b16-0-24-1-security-correction`, `b16-0-24-tranche-parity`,
  `b20-c1-three-way-parity`: 16 files, 194 tests passed. No route added; the census stays 165 / 162 / 3 / 0.
- `tsc --noEmit -p tsconfig.json`: clean. `eslint` on the three changed files (`netlist.ts`, `server/worker.ts`, the suite):
  clean.
- Generators that read the route sources: `scripts/generate-b16-0-4-artifacts.ts` (165 + 165 rows),
  `scripts/generate-b16-0-7-artifacts.ts` (165 / 162 / 3 / 0) and `scripts/generate-b16-0-8-baseline.ts` (3 -> 3): zero
  drift (`git status` after they run shows only the four files round 3 changes: `netlist.ts`, `server/worker.ts`, the suite
  and this page).
  `scripts/spice-ci.ts` runs ngspice and was not run.
- CI: no new suite; the sec-1 suite stays the explicit `prompt-to-gerber` entry in
  `.github/workflows/deterministic-manufacturing.yml`, pinned by a case in `b19-e-ci-job-scope.test.ts` (green above).
- Every gate above ran after the last source edit of this round (the round-3 review fixes); the first round-3 tree's import
  gates and generators had run before its last `netlist.ts` edit (review finding coverage-4), so all were run again.
- Round 1's broader gate record (below, from the review round) stands for the suites unchanged since; round 3 touched only
  `netlist.ts`, `server/worker.ts`, the suite and this page. Round 1's run was 244/244 green, 227 red / 17 green against
  `6fd5a7b`; its 15 deliberate source breakages each caught by their case.

## 6. Line positions (for citations into these files)

- `app/lib/spice/netlist.ts`: round-1 edits in place at `:33`, `:152`, `:155`, `:198`, `:214`, `:239`, `:261`, `:266` hold; lines
  1-396 keep their `fe147c9` numbers (lines 1-282 their `6fd5a7b` numbers); the SEC-1 helpers are at `:284-493`. [SEC-1 round
  3] Re-pinned within the helpers (a reviewed re-pin of every round-1 position after `:396`): `DeckExpectation` `:402` (was
  `:401`; no `cards` field); `compiledDeckExpectation` `:409` (no `ir` param, no `cards`); `OWN_CONTROL_BLOCK` `:419` (was
  `:420`); `BANNER_LINE` `:423` (was `:426`); `assertTitleSafe` `:429-432` (new: the `*ng_script` title, CONFIRMED by p4, and the
  INFERRED non-banner `*#` title); `assertDeckLineSafe` `:441-447` (was `:429-436`; no command-word rule, no `cards` param; its
  `.title` rule at `:442`); `assertCompiledDeckSafe` `:463-490` (was `:449-477`), with the title rules applied to line 1 at
  `:472` (was the `*ng_script` check at `:458`) and the form-feed pieces at `:482` (was `:469`); `__deckLayersForTests` `:493`
  (was `:480`). The round-1 `COMMAND_LINE` const (`:423`) is removed. The page suite checks every symbol-anchored citation
  into `netlist.ts` and the model screen's own dotted list, `models.ts:200` (round 3 review, findings regressions-2,
  coverage-3, tests-5).
- `app/lib/spice/server/worker.ts`: round-1 edits in place at `:10`, `:60`, `:176`; [SEC-1 round 3] `:176` now calls
  `compiledDeckExpectation({ rawOutputPath: "result.raw" })` (the `ir` argument dropped); no line moves (B20's `worker.ts:81-100` holds).
- `app/lib/spice/server/job-store.ts`: three imports after `:21` and one call at `:182` - base lines 22-178 move by +3, base
  lines 179 onward by +4 (for example `:145` -> `:148`, `:149` -> `:152`, `:219` -> `:223`, `:241-293` -> `:245-297`); helpers
  appended at `:313-350`.
- `app/api/spice/models/smoke-test/route.ts`: one import after `:7` - base lines 8 onward move by +1 (`:58` -> `:59`,
  `:77-78` -> `:78-79`, `:102` -> `:103`); helpers appended at `:111-128`.
- `app/lib/spice/units.ts`, `app/lib/spice/ir.ts`, `app/lib/spice/run-plan.ts`, `app/api/spice/runs/route.ts`,
  `app/api/spice/ai/route.ts`, `app/api/simulate/route.ts`: unchanged.

## 7. For the lead

The lead's files are not edited here; the texts below are for them, with `<sha>` the SEC-1 commit (round 3 completes the branch).
Round 3's adversarial review confirmed 15 findings against round 3's first tree; each was reproduced red or proved by a source
breakage, then fixed (section 8.4), so none is open. Round 1's commit note "NOT FINAL: the security lens did not complete" no
longer applies once the lead accepts that record: the branch is ready to propose for `main`, with one stated deviation for the
owner (the `*#`-title refusal, defence in depth beyond the ground; the OWNER_DECISIONS text below).

**EXECUTION_LEDGER paragraph (SEC-1 as a whole - three rounds):**

> ### SEC-1 - the SPICE Studio deck injection (corrective security branch `fix/spice-deck-injection` from main `6fd5a7b`; closes D22-3 and the ngspice half of D22-5)
> Test-first, three rounds. ROUND 1 (`fe147c9`): `app/lib/spice/__tests__/sec-1-deck-injection.test.ts` ran 227 red / 17 green
> against `6fd5a7b`. Every one of the 79 fields the Studio compiler writes from caller or model data admitted all 12 hostile
> payloads (LF, CR, CRLF, U+0085, U+2028, U+2029, VT, FF, NUL, ESC, DEL, a backtick), 70 as a live second `.control` block with
> `shell`; output expressions carried `;` and `>` onto the compiler's own `write` line; model text reached the deck with a `*#`
> line or, through the model screen's `??`/`||` differential, a whole control block; and through `POST /api/spice/runs` (spawn
> and files faked) a hostile source value answered 202, the deck was written with the injected block and ngspice was spawned; the
> smoke test and the `-v` probe passed no environment. Fix: one single-line screen `assertDeckText` (/api/simulate's B19-D
> `unsafe()` rule extended to U+0085, the C1 controls, U+2028 and U+2029; a TAB passes as SPICE whitespace) applied raw to every
> field at the IR->deck boundary; output expressions allowlisted; the writer pushing one line per string; `assertSafeDirective`
> one line and closed; the `.options` screen space/tab only; a final deck screen `assertCompiledDeckSafe` run in the compiler,
> before the worker writes `executed.cir` and before the smoke test writes its deck; `startRunPlan` compiling one deck per test
> and analysis and screening each run point, so the route answers 422 before any job; and the smoke test and `-v` probe passing
> the worker's env allowlist, pinned literally across the three ngspice spawners. A round-1 adversarial review confirmed 21
> findings, each reproduced red or proved by a source breakage, then fixed. Round 1 left one regression: the final screen's
> command-word rule refused legitimate vendor model text whose element cards are named like ngspice command words (a capacitor
> `Cd`, an inductor `Load`, switches `Set`/`Source`, a diode `Define`). ROUND 2 made no code change (a safety stop during its
> probe step). ROUND 3: the lead ran benign ngspice-46 probes (section 1b of the page) establishing that ngspice executes a
> command ONLY inside a `.control` block (including an included one), from a `*#` line, and in an `*ng_script` deck; a command
> word anywhere else is read as an element card and never runs. Grounded on that, round 3 removed the command-word rule (and its
> `cards` exemption), so vendor element cards compile, preview, smoke-test and run again while every executing construct stays
> refused. Its adversarial review confirmed 15 findings, each reproduced red or proved by a source breakage, then fixed: a
> `.title` line could set a non-banner `*#` title that the line-1 rule refused (now one title rule for line 1 and every `.title`
> line, also read as ngspice's prefix match `.titlex`); the `*#`-title refusal round 3 had added was recorded as CONFIRMED by
> probe p3 although no probe put a `*#` line on the title - it is now recorded as INFERRED defence in depth and a stated
> deviation (a project name starting `*#`, which main compiled, is refused; owner decision proposed); the smoke test's
> executed-deck include/lib refusal, the compile preview's `*#` and title refusals and the title's form-feed pieces gained
> red-on-breakage pins; and the page's stale round-1 statements, citations and counts were corrected, with page cases that
> check them. THE LEAD'S CLOSE: the round-3 check found line 1 (the title) screened only as written; the lead's probe p10
> CONFIRMED that a first line `.title *ng_script` runs the deck as a script (in which, with command-word cards accepted, a
> vendor card line would run), so line 1 is now read through a `.title` prefix too, test-first (two cases red, then green); and
> the lead's probes p11-p13 CONFIRMED that a `*#` title runs nothing, so the `*#`-title refusal is kept as defence in depth
> beyond the ground. Green 268/268 (red 44 on `fe147c9` and 229 on `6fd5a7b`, re-run by the lead after the line-1 `.title` fix); the SPICE and importing suites (10 files, 1 skipped
> opt-in, 348 passed; round 1's broader SPICE-importing set, 8 files, 195 passed), the import gates and census (16 files, 194
> passed; 165 / 162 / 3 / 0, no route added), tsc, eslint and the three route-source generators with zero drift, all on the
> final tree; CI admits the suite as an explicit prompt-to-gerber entry, pinned by `b19-e-ci-job-scope`. Not changed: kicad-cli,
> FreeRouting, the SPICE AI `"automatic"` pre-selection (its strings are screened at the compiler; OD-150 open),
> HOME/USERPROFILE in the allowlist (B22-A3), the rest of D22-4 (XSPICE file parameters in model text, a recorded residual),
> routes, authentication, CSRF, roles; no dependency. Stated deviations from the task text: a TAB, and in model text a form
> feed, pass; the `.shell/.cd/...` dotted-directive refusal is kept as defence in depth (no legitimate card is a dotted
> directive; the ground is silent on it); and a non-banner `*#` title is refused as defence in depth beyond the ground (p11-p13; section 4). The
> behaviour the screen is cut to is CONFIRMED by the lead's probes; end-to-end exploitation through a real ngspice stays
> INFERRED (never run). Page: `artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md`.
> Commit `<sha>`.

**B22 discovery closure clauses** (for D22-3, D22-4 and D22-5 in section 4, and section 10, when the discovery is committed):

- D22-3: **Closed by SEC-1** (corrective branch `fix/spice-deck-injection`, `<sha>`, 2026-10-01, three rounds): every caller- or
  model-controlled string the Studio compiler writes is screened as one line at the IR->deck boundary (79 fields by 12 payload
  forms, refused with a closed `SPICE_DECK_UNSAFE` error, red before; a TAB passes as whitespace), output expressions are
  allowlisted, `assertSafeDirective` checks one line, the `.options` screen admits space and tab only, and a final deck screen
  runs in the compiler, before the worker writes `executed.cir` and before the smoke test writes its deck. The final screen is
  cut to ngspice-46's CONFIRMED executing set (the lead's probes, section 1b of the page): it refuses a second `.control` block,
  a `*#` command line, an `*ng_script` title (on line 1 also through a `.title` prefix: a first line `.title *ng_script`,
  CONFIRMED by the lead's probe p10), an `.include`/`.lib` in an executed deck, every non-LF line break, NUL, a backtick
  and a dotted shell/filesystem directive; as defence in depth beyond the ground (the lead's p11-p13 CONFIRM a `*#` title runs
  nothing) it also refuses a non-banner `*#` title, on line 1 or set by a `.title` line - a stated deviation, owner decision proposed. It does NOT refuse
  an element card merely named like a command word (a card, not a command), which restores legitimate vendor model text.
  `POST /api/spice/runs` refuses a hostile plan with 422 before any job exists, except a plan whose test the worker refuses
  before any deck (a model the model screen refuses, or an IR that does not compile): that request answers 202 and its run
  fails with no deck written and ngspice never run. The SPICE AI `"automatic"` pre-selection is unchanged (its strings are
  screened at the compiler; OD-150 stays open); end-to-end exploitation stays INFERRED, the executing set CONFIRMED by probe.
- D22-5: **The ngspice half closed by SEC-1** (`<sha>`): the smoke test and the worker's `-v` probe pass the worker's explicit
  allowlist, pinned equal across the three ngspice spawners and to the literal list. Open: kicad-cli's inherited environment
  (B22-A1, OD-148) and HOME and USERPROFILE in the ngspice allowlist (B22-A3's profile environment).
- D22-4 (recorded, not closed): in an EXECUTED deck (the runs and the smoke test) the final deck screen refuses the shell and
  `.include`/`.lib` consequences of the model screen's gaps (the `??`/`||` differential, `*#` command lines, `.lib`, a relative
  or traversing `.include`); a command-word line in model text is NOT refused (CONFIRMED a card by probe, not a shell path).
  XSPICE code-model file parameters in model text (`file=`, `input_file=`, `state_file=`) are not screened (an INFERRED
  host-file read); the model screen itself, its client-supplied `dependencies` and the preview's `.include`/`.lib` are
  unchanged, so D22-4 stays open for B22-A1.
- Section 10 amendment: "SEC-1 (`<sha>`) landed D22-3 and D22-5's ngspice half on a corrective branch from main before B22
  (OD-137's alternative); B22-A1's `b22-a-deck-injection` scope shrinks to what SEC-1 left (D22-4 with the XSPICE file
  parameters, kicad-cli, OD-150)."

**PR description - `fix/spice-deck-injection` -> `main`:**

> **SEC-1: screen the SPICE Studio deck against ngspice command injection (D22-3; the ngspice half of D22-5)**
>
> A corrective security branch from `main` (runbook 2.4). The SPICE Studio compiler wrote caller- and model-controlled strings
> into ngspice decks with line breaks intact, so a source value, waveform, option, custom directive, `.ic`/`.param` value or
> model text could carry a live second `.control` block with `shell` - reachable by an authenticated project member through
> `POST /api/spice/runs`, and by a model's pre-selected run request. The smoke test and the worker's `-v` probe also inherited
> the whole server environment.
>
> The branch screens every caller/model string as one line at the IR->deck boundary (every line-break form, NUL, other control
> characters and a backtick refused with a closed `SPICE_DECK_UNSAFE` error; a TAB passes as SPICE whitespace), allowlists output
> expressions, makes `assertSafeDirective` and the `.options` screen line-safe, and adds a final deck screen in the compiler, the
> worker (before `executed.cir`) and the smoke test. The final screen is cut to ngspice-46's confirmed executing set (benign
> probes run by the program lead, recorded in the page): it admits exactly the compiler's own `.control` block and refuses a
> second control block, a `*#` command line, an `*ng_script` title (including a first line `.title *ng_script`, which the
> lead's probe confirmed runs the deck as a script), an `.include`/`.lib` in an executed deck, non-LF line breaks, NUL, a
> backtick and dotted shell/filesystem directives. It also refuses a non-banner `*#` title (line 1, or a `.title` line) as
> defence in depth - the lead's probes show ngspice-46 runs nothing from a `*#` title - so a project whose name starts `*#`,
> which `main` accepts, is refused (a stated deviation awaiting the owner's word). The three ngspice spawners pass one explicit env allowlist.
>
> No feature work; no new route, control, tool or dependency; no change to authentication, CSRF, roles or the route-policy census
> (165 / 162 / 3 / 0). Legitimate decks are unchanged, including vendor subcircuits whose element cards are named like ngspice
> command words, except for that stated deviation. Test-first: the suite
> `app/lib/spice/__tests__/sec-1-deck-injection.test.ts` (268 cases) is red on `main` and on round 1's tree and green on the
> branch; the SPICE and importing suites, the import gates and census, tsc, eslint and the route-source generators (zero
> drift) all pass on the final tree. No hostile deck was run by ngspice in this work; the probes that ground the screen were
> benign and run by the program lead.
> Full record: `artifacts/ai-control-plane-b22/sec-1-spice-deck-injection.md`.

**OWNER_DECISIONS (needed for round 3) and LIVE_BLOCKERS (none):** one new decision for the `*#`-title refusal (defence in depth beyond the ground):
"OD-(next) - SEC-1: the SPICE deck screen refuses a deck whose title - line 1, built as `<project name> — <test name>`, or the
text of a `.title` line in a directive or model text - is a `*#` line other than a pure banner (`*#` then only `#`, `=`, `-`
and whitespace). The lead's probes CONFIRM that ngspice-46 in batch mode does NOT run a `*#` title (p13: a `*#` line as line 1 is printed as
the circuit title; p11/p12: a `.title *# ...` line, on line 1 or after it, likewise), so the refusal is defence in depth beyond
the ground that fails closed (it would matter only for another ngspice build or mode). Its cost: a project whose name starts `*#`
(for example `*#2 buck stage`), which main compiles, is refused with `SPICE_DECK_UNSAFE` in compile, the preview, the runs
preflight and the worker. Options: (a) keep it (recommended for a corrective security branch: the input is unusual and the
error names the rule); (b) drop it, restoring main's behaviour on the assumption that ngspice reads the title as text only;
(c) have the lead probe a `*#` title and a `.title *#` line and cut the rule to the result - done (p11-p13 above; they
support (b), and the refusal is left in place until the owner chooses). Recorded 2026-10-01; owner
confirmation pending." Round 1's optional owner decision still stands if the lead wants the other stated deviations on record:
"OD-(next+1) - SEC-1: the SPICE deck screen admits a TAB in single-line fields (SPICE whitespace, never a line) and, in model
text, a form feed (read both as whitespace and as a line break) and other control characters that are not line breaks, as main
did; it keeps the `.shell/.cd/...` dotted-directive refusal as defence in depth though the probes neither require nor
contradict it; every line-break form, NUL and a backtick stay refused everywhere, and a command word is accepted only where the
probes show it is read as a card. Recorded 2026-10-01; owner confirmation pending."

## 8. Round 3 - grounding the screen, the vendor-card regression, and the completed security review

Round 3 is a corrective pass on the round-1 branch. It changes three source files: `app/lib/spice/netlist.ts`,
`app/lib/spice/server/worker.ts` (one call site) and the suite, and this page. No route, control, tool, dependency, auth, CSRF
or role change.

### 8.1 The regression and its ground

Round 1's final screen refused any line outside the compiler's control block that started (after whitespace, case-insensitively)
with one of 13 ngspice command words, exempting only the compiler's own element cards (a `cards` list). That broke legitimate
vendor model text: a `.subckt` holding a capacitor `Cd`, an inductor `Load`, a diode `Define` or switches `Set`/`Source` was
refused in compile, the compile preview, the smoke test and every run plan (the regression the round-2 check named, confirmed
still open at `fe147c9`). The lead then ran the ngspice-46 probes recorded in section 1b. Their verdict: ngspice executes a
command ONLY inside a `.control` block (including one inside an `.include`d file), from a `*#` line, and in a deck titled
`*ng_script`; a command word anywhere else is read as an element card and never runs; element cards named like command words
(`Cd`, `Load`, `Define`, `Source`, `Set`, `Rset`) parse and simulate. The command-word rule therefore refused inputs that cannot
execute.

### 8.2 The fix (test-first)

- `netlist.ts`: the `COMMAND_LINE` regex and its use in `assertDeckLineSafe` are removed; `assertDeckLineSafe` no longer takes a
  `cards` set; `DeckExpectation.cards` and the `cards` population in `compiledDeckExpectation` are removed (so
  `compiledDeckExpectation` no longer needs `ir`); `assertCompiledDeckSafe` drops the `cards` set and passes none to the line
  check. Every other refusal round 1 made stays: a second `.control`/`.endc` block, a `*#` command line (banner excepted), an
  `*ng_script` title (line 1 or a `.title` line), an `.include`/`.lib` in an executed deck, non-LF line breaks, NUL, a backtick,
  the dotted `.shell/.cd/...` directives, and the shell-escape `!` line. After the review (section 8.4) the title rules live in
  one function, `assertTitleSafe` `:429-432`, applied to line 1 (`:472`) and to every `.title` line's text (`:442`, read as
  written and as ngspice's prefix match `.titlex`), and add the non-banner `*#` title (defence in depth).
- `worker.ts`: `compiledDeckExpectation({ rawOutputPath: "result.raw" })` (the `ir` argument dropped).
- The suite: new regression cases (red on `fe147c9`) prove a vendor subckt with `Cd`/`Load`/`Define`/`Set`/`Source` cards
  compiles, previews, smoke-tests (200) and runs (202); the cases that pinned the refusal as the contract were moved as reviewed
  pin moves, each with its reason, to assert acceptance; and the suite's deck oracle (`deckFindings`) no longer copies
  production's word list or its banner pattern: it flags only the constructs the probe table shows execute, and reads every
  `*#` title (line 1 or a `.title` line) as a finding, since whether one runs was UNKNOWN at round 3 ([SEC-1 lead] p11-p13
  later CONFIRMED it runs nothing; the oracle still flags it, matching the kept defence-in-depth refusal). The review's cases are in section 8.4.

### 8.3 The security review of the final tree

Attacking round 1 + round 3, with the review fixes of section 8.4, against the probe table's executing constructs, through
every surface:

- **The field screen** refuses every non-LF line break, NUL, other control characters and a backtick in every single-line field,
  so no field can inject a second `.control` block, a `*#` line or an `*ng_script` title on a line of its own; a value that
  merely reads as a card is harmless (the ground). CONFIRMED by the 79-field x 12-form matrix (green).
- **`assertSafeDirective`** requires a custom/advanced directive to start with `.` and refuses line breaks and the shell/control
  dotted forms, so a `*#` or bare command directive is refused there; a `.title` directive passes it and is held by the final
  screen's title rule (review finding coverage-1).
- **Model text** (multi-line, bypasses the field screen): a `.control` block, a `*#` line, a `.title` line naming a script or a
  non-banner `*#` title, and an `.include`/`.lib` in an executed deck are refused by the final screen; a form feed hiding a
  control block or a `*#` line is refused piece by piece; a bare command word is a card. A bare `*ng_script` cannot reach line 1
  (the title) through model text.
- **The title (line 1) and `.title` lines.** CONFIRMED: an `*ng_script` title runs the deck as a script (p4) - refused on line 1
  and as a `.title` line's text. UNKNOWN at round 3: whether a `*#` title runs ([SEC-1 lead] the lead's p11-p13 later CONFIRMED it runs nothing). Round 3 refuses a
  non-banner `*#` title on line 1 and as a `.title` line's text, as defence in depth that fails closed (a stated
  deviation, section 4; owner decision proposed, section 7). The title's form-feed pieces are screened too.
- **The runs route** screens in the preflight (422 before any job) and again in the worker before `executed.cir`; **the compile
  preview** refuses control blocks, `*#` lines, `*ng_script` and non-banner `*#` titles and dotted directives (pinned through
  the preview itself; it keeps `.include`/`.lib` for the user's own machine, never executed); **the smoke test** field-screens
  the subcircuit name and runs the final screen as an executed deck with no control block, so a model-text `.include` or `.lib`
  the model screen admits is refused before any file (pinned). **The SPICE AI route's** "automatic" operations become ordinary
  project fields, all field-screened at the compiler, so a model-steered operation cannot reach an executing construct (OD-150
  unchanged). **The environment allowlist** is unchanged and pinned equal across the three ngspice spawners.
- **Residual (unchanged from round 1, recorded for B22-A1):** XSPICE code-model file parameters in model text (`file=`,
  `input_file=`, `state_file=`) are not screened (an INFERRED host-file read, never a shell or control path).

Every construct the probes CONFIRM executes is refused on every surface (compile, the preview, the runs preflight, the worker
and the smoke test), and the `*#` title (UNKNOWN at round 3; CONFIRMED to run nothing by the lead's p11-p13) is refused too, as defence in depth. No confirmed finding of
the round-3 review remains open (section 8.4).

### 8.4 The round-3 review (2026-10-01): 15 confirmed findings, each fixed

An adversarial review of round 3's first tree (regressions, security, coverage and tests lenses) confirmed 15 findings, all
low but two medium (coverage-1, tests-1). Each was reproduced by a new or extended suite case, red on that tree, or, for a
test-strength finding, proved by a deliberate breakage of the final source that the strengthened cases catch (the source
restored and checked by hash after each run). The red run on that tree, with the suite's 266 cases of the time: 7 failed, 259 passed (the five `.title` cases and the
two page cases below; that tree's sources were not kept, so the lead did not re-run it on the 268-case suite). [SEC-1 lead]
Every breakage below was re-run by the lead on the 268-case final tree after the line-1 `.title` fix (tests-2's line-1 gate
re-anchored to the fixed line), each source restored and checked by hash.

| Finding | Reproduction (red on round 3's first tree, or the breakage now caught) | Fix |
|---|---|---|
| coverage-1 (medium: a `.title` line reaches the title; the `*#` title recorded as CONFIRMED) | a `.title *# shell ...` directive and a `.TITLE *# ...` model line compiled, in the run and the preview; `.titles *ng_script` and `.titles *# ...` compiled: 5 red | one title rule `assertTitleSafe` (`netlist.ts:429-432`) for line 1 and every `.title` line's text, read as written and as ngspice's prefix match (`:442`); the record below |
| regressions-1; security-1 (the `*#` title cited to probe p3; a newly refused project name) | page case: section 4's 'Still INFERRED' list omitted it, and the page called it "the one gap ... closed" on p3's ground: red | recorded INFERRED defence in depth in the source, the suite and the page (sections 1b, 3, 4, 8); a stated deviation with a proposed owner decision (section 7); `*#2 buck stage` pinned as refused; the oracle no longer copies production's banner pattern |
| regressions-2; coverage-3; tests-5 (citations) | page case: the `assertCompiledDeckSafe` span, the `__deckLayersForTests` line and the model screen's dotted list cited at stale lines (`:451-478`, `:480`, `models.ts` line 198): red | re-pinned (sections 3, 6); section 2.5 anchored to `fe147c9`; a page case checks every symbol-anchored citation into `netlist.ts` and the dotted-list citation into `models.ts` |
| regressions-3; coverage-2; coverage-6 (round 1's contract stated as current) | page case: six stale statements in sections 2-2.3 (round 1's suite size, the 13 and the 12 command words as refused, the card exemption, a form feed before a command word, the `codemodel` run): red; the suite header (fixed with the case) shown by breakage: round 1's header sentence put back, 1 failed / 267 passed | section 2's statements corrected or marked superseded by round 3; the suite header states the round-3 contract |
| regressions-4; coverage-5 (probes credited to the owner) | page case: the PR text credited the probes to the owner, twice: red | 'run by the program lead' |
| coverage-4 (counts and gate timing) | page case: the red run stated for the 248-case suite (33 failed and 214 passed) had 247 cases: red | every run re-made on the final tree after the last source edit: red on `fe147c9` and on `6fd5a7b` with the final suite, the gates, tsc, eslint and the generators (section 5) |
| tests-1 (medium: the smoke test's include/lib refusal unpinned) | breakage `executed: false` at `smoke-test/route.ts:119` (no case of the first tree caught it, per the review): 2 failed / 266 passed (`200`, `smoke.cir` written, ngspice spawned) | two smoke cases: a traversing `.include` and a `.lib` read, each `422` closed before any file or process |
| tests-2 (the preview's `*#` and title refusals unpinned) | breakage: the `*#` line rule and both title rules gated on `expected.executed`: 5 failed / 263 passed | five preview cases (model `*#` line, `*ng_script` and `*#` project names, `.title *ng_script`, `.title *# ...`) |
| tests-3 (the title's form-feed pieces unpinned) | breakage: line 1's form-feed pieces dropped (`index > 0` at `netlist.ts:482`): 2 failed / 266 passed | two final-screen cases: a form feed in the title hiding a `*#` command or a control block |
