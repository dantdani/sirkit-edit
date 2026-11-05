# B21-E4 — the composer reaches the DAG with the runbook's own sentence; the coordinator's first turn behind the breaker (D21-38, D21-39)

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Tree
`chapter/b21-specialist-orchestration`, base `fafc90e` (the B21-E3 commit); written 2026-09-28. This is ONE new page for B21-E4 - items
3b and 3c of the lead's E2 section, the last of B21-E's runs: the composer's kind swap (D21-38, recorded by B21-D3) and the coordinator's
first turn behind the llm-provider breaker (D21-39, found by B21-E1). The pages whose statements E4 changed carry dated `[B21 E4,
2026-09-28]` notes in the same block and their re-pinned citation rows: `specialist-replacement.md` (D3: C10 and C34 now in
composer-routing.ts, the phrasing bullet and the D21-38 record), `task-complexity-router.md` (B: C35 and the replacement rule) and
`provider-routing-and-failure.md` (E1: the breaker paragraph and "Not the coordinator's first turn"). Every `[B21 E4]` statement below
is pinned by `b21-e4-page.test.ts` (the counts, digests, lines and lists quoted ARE the code's and the suites'; every citation resolves
by content exactly once and, for every production file E4 changed, on the line it states; every suite row carries its real `it(` count)
or by the suite it names. No model is called in any E4 suite: the composer and grammar suites are pure, the gate's suite runs the
process's REAL llm-provider meters with explicit clocks, and the route suite drives the production POST with the REAL adapter classes
answering through in-process fake SDK clients whose every call is counted. The adversarial review's seven confirmed findings were answered
test-first after the first draft (section 4, "The review's findings (E4)"; the `[B21 E4 fix]` statements below).

## 0. What E4 delivers, and what it is not

- **The composer reaches the DAG with the runbook's own sentence (section 1, D21-38).** B21-D3's strict replacement grammar - the
  appended section of `router.ts`, `partKindSwap(message, raw)` with its polite-prefix pattern `PART_KIND_SWAP`, the router's `POLITE`
  and every closed vocabulary - moved VERBATIM into `app/lib/project/composer-routing.ts` beside `REPLACE_PART` as ONE exported
  predicate (C3-C8); the router imports it and `POLITE` on the line that imported `REPLACE_PART` (C10) and calls it on its unchanged rule
  line (C13), never the reverse (the composer module imports nothing); the composer's rule 5b uses it (C2). So "Replace the NE555 timer
  U1 with a lower-power timer." (runbook scenario 17) reaches the assistant from the UI instead of the schematic editor. The router's
  answers are byte-identical to HEAD's; [B21 E4 fix: security-3] every scan E4 added to the composer's path is linear on any text (C38-C40) - [B21 E4 lead] B18-E's `REPLACE_PART` stays super-linear on a self-pasted run, RECORDED in section 1.
  **CONFIRMED** by `b21-e4-composer-routing.test.ts` (6 cases) and `b21-e4-replacement-grammar.test.ts` (4 cases).
- **The coordinator's first turn behind the breaker (section 2, D21-39).** The route consults the SAME pause E1's runtime consults
  before the follow-up turn - `currentLlmProviderPause` through the process's meters, the `interactive` purpose (the whole process-wide
  window), the coordinator's provider - before the coordinator's first turn, on the flag-off single path and on both flag-on paths
  (C15-C17, C23-C25). A paused provider gets NO call: `run_started`, then ONE `run_failed` `provider_breaker_open` carrying the meters'
  own pause sentence, with no Retry on the card (E1's `providerRetryOffered` rule). Not paused, nothing changes: the flag-off stream is
  byte-identical to HEAD's; [B21 E4 fix: regressions-1] a half-open breaker's one trial in flight is not a pause for the first turn
  (C37). What the gate cannot do is RECORDED: it only reads the meters, so on a flag-off process it never fires, and a no-credits account
  whose first turns fail first never opens the breaker (D21-42, opened by the review). **CONFIRMED** by `b21-e4-first-turn.test.ts`
  (7 cases) and `b21-e4-chat-first-turn.test.ts` (8 cases).
- **What it is not:** no new control, route, run-event type, request key, failure reason or degraded reason; no router answer changed;
  the first turn is gated, not metered (section 3).

## 1. The composer reaches the DAG with the runbook's own sentence (D21-38)

Why (runbook scenario 17, `discovery.md` D21-38): the composer's rule 5b paired a replace / swap verb with a part / component / MPN /
alternate word only (`REPLACE_PART`, C1), so the runbook's own sentence fell to rule 8 (`replace` is an edit verb) and went to the
schematic editor, which cannot make a replacement; the router's strict kind-swap grammar (B21-D3) recognised it, but the chat route saw
it only when the user overrode the composer's route.

- **The move, verbatim.** The code lines of `router.ts:70` (`POLITE`), `:101` (`PART_KIND_SWAP`) and `:201-291` (the grammar) - 47 code
  lines, their trailing comments included, `export ` aside - hash to `eng1-4625e5cec7a07ae5` at HEAD fafc90e and in composer-routing.ts
  from `export const POLITE` to the closing brace of `partKindSwap` (C3-C7): moved byte for byte, only `export` added to `POLITE` and
  `partKindSwap` and one comment line reworded ("(`REPLACE_PART`, above)" for "imported"). `router.ts` keeps none of them (it ends with
  `routeTaskComplexity`, 186 lines instead of 291) and its lines above the rule line are unchanged in number: the import (line 23) and two
  comment pairs (lines 69-70, 100-101) were rewritten in place, so every B21 page's router citation keeps its line - B's C35 and D3's C10
  and C34 re-pinned (the anchor moved, or moved with the grammar). [B21 E4 fix: security-3] After the move ONE of those 47 lines - the
  raw message's trailing run (C38) - was rewritten linear (below): grammar case 2 pins that line exactly and, with HEAD's text put back in
  its place, hashes the 47 to HEAD's digest (a reviewed pin move, its reason beside it). **CONFIRMED** (grammar case 2; the B, C and D3
  page suites).
- **ONE predicate, the router importing it.** `composer-routing.ts` imports nothing, so there is no cycle; the router imports
  `POLITE` (its own head-verb rules still read it, C11) and `partKindSwap` (C10) and calls the predicate exactly as before, on its
  unchanged rule line (C13). The module's runtime exports are B18's route-label map `COMPOSER_ROUTE_LABELS`, `REPLACE_PART`, `partKindSwap`, `POLITE` and
  `routeComposerMessage` - the one exported predicate beside `REPLACE_PART`, and its prefix. **CONFIRMED** (composer case 5; grammar case 3).
- **The router's answers are byte-identical.** Over the whole six-round corpus (`_d3-router-corpus.ts`: 1007 false DAG phrasings, 194
  genuine requests, 46 recorded semantic residues) under five fact sets - a schematic and a board with a `pcb_editor`, no schematic, a
  viewer, no board, a `project_admin` with a selection - each digest of the router's answers equals the one RECORDED from HEAD fafc90e
  before the move (`eng1-9d830a74b0d2cae3`, `eng1-0159a53968206430`, `eng1-876a51640526a8b9`, `eng1-f7045b53464d0a7e`,
  `eng1-4c33d34a1e74ed7b`); and for every corpus phrasing the router's replacement decision IS the predicate. D3's replacement-roles
  cases 7, 8 and 9 and its page case 3 ran unchanged and green; case 5's router assertions too (its one composer assertion moved, below).
  **CONFIRMED** (grammar cases 1 and 4).
- **Rule 5b uses it.** `if (REPLACE_PART.test(t) || partKindSwap(replacementMessage(text), text)) return routed("ask", ...)` (C2), the
  reason unchanged ("asks to swap a part: ..."); `replacementMessage` restates the router's normalization line verbatim (C9, C12 - the
  module never imports the router), pinned equal. So the runbook sentence and its two variants reach the assistant, and a phrasing the
  predicate accepts asks whatever its whitespace, case or trailing punctuation the router folds. **CONFIRMED** (composer cases 1 and 4).
- **Linear on any composer text** ([B21 E4 fix: security-3]). The page routes the composer's text on every render (`page.tsx`, unmemoised)
  and the text is unbounded, and rule 5b now reaches the predicate for almost every message. The two normalization lines - the
  composer's copy (C39) and the router's (C40), still one line pinned equal - strip the trailing sentence punctuation, and the predicate
  finds the raw message's trailing run (C38), from its START alone: a lookbehind refuses to begin a match inside a run, so each run is
  scanned once. The old `/[.!?]+$/` and `/[.!?\s]*$/` restarted at every character of a run followed by anything else - a pasted run of
  `!` then a letter, or a whitespace run inside a request the grammar accepts - quadratic: at 150 000 characters each hostile shape took
  60 808 to 100 759 ms through the composer and the router before the fix (`e4fix/ff-1-failing-first.log`), and the whole composer suite,
  those four shapes included, runs in 349 ms after it (`e4fix/fix-1-green.log`). The lookbehind finds the same run on every text, so no
  answer moves (composer case 6 compares HEAD's two scans with the linear ones over the corpus and hostile texts; grammar case 1's
  digests). RECORDED, not changed: `REPLACE_PART` (B18-E) stays super-linear on a self-pasted run such as "replace replace ..." (the
  user's own tab only, as before E4), and the router's circuit-object strip (router.ts, B21-C) keeps the old scan on the server, where the
  route bounds a message at 20 000 characters. **CONFIRMED** (composer case 6).
- **The same corpus through the composer** (HEAD's composer routes over it RECORDED from the HEAD module before the move,
  `eng1-eb39b36a0f07a413`, and reproduced by a copy of HEAD's function the suite compares with): every genuine request (194) and every
  recorded residue (46) routes to the assistant. What changes, each because the new predicate holds (and `REPLACE_PART` does not): 133
  genuine requests and 36 residues HEAD sent to the schematic editor now reach the assistant (`edit` -> `ask`); 46 genuine polite or
  question-form requests rule 9 already sent to the assistant are now named a part swap (the same route, the swap reason). **No false DAG
  phrasing changes its composer route**: the predicate is false for all 1007 (under the router's own normalization) and each one's route
  and reason equal HEAD's - 652 schematic edits and 355 assistant requests, as before. The value changes and B18's scenario sentences route
  as they did (B18's composer suites needed no pin move). **CONFIRMED** (composer cases 2 and 3).
- **The recorded semantic residues that move** (a listed word used in another sense, which only part knowledge could tell - D3's
  RECORDED residue; the router already sent each to the replacement DAG, and its zero-authority specialists find no new part to seal).
  The 36 recorded residues that move from the schematic editor to the assistant:
- `Replace the 555 timer with a 555-compatible timer.`
- `Replace the NE555 timer with a bipolar timer.`
- `Replace the TLC555 timer with a CMOS timer.`
- `Replace the NE555 timer with a 1 kHz oscillator for the audio stage.`
- `Replace the op-amp with a faster op-amp for the blinker.`
- `Replace the comparator with a faster comparator for the LED.`
- `Replace the MCU with a faster MCU for the blinker.`
- `Replace the driver with a 350 mA driver for the LED.`
- `Replace the driver with a 700 mA driver for the LED.`
- `Replace the LM317 regulator with a 3.3 V regulator for the 3V3 rail.`
- `Replace the driver with a newer driver.`
- `Replace the STM32F4 driver with a newer driver.`
- `Replace the MCP2221 driver with a newer driver.`
- `Replace the oscillator with a programmable oscillator for the blinker.`
- `Replace the oscillator with a precision oscillator for the LED.`
- `Replace the LDO with a low-dropout regulator.`
- `Replace the NE556 timer with a dual timer.`
- `Replace the LM358 op-amp with a dual op-amp.`
- `Replace the TLC555 timer with a low-power timer.`
- `Replace the STM32F407 timer with a low-power timer.`
- `Replace the ATmega328P oscillator with a 16 MHz crystal oscillator.`
- `Replace the ATmega328 comparator with a rail-to-rail comparator.`
- `Replace the RP2040 regulator with a buck regulator.`
- `Replace the ESP32S3 regulator with a 3.3V LDO.`
- `Replace the PIC16F877 timer with a 555-compatible timer.`
- `Replace the NRF52840 regulator with a low-noise LDO.`
- `Swap the STM32F103 oscillator for a canned oscillator.`
- `Swap the STM32L476 comparator for a push-pull comparator.`
- `Replace the PIC18F4550 regulator with a 3.3V LDO for the MCU.`
- `Replace the ATmega2560 oscillator with a canned oscillator for the clock.`
- `Replace the ESP32S3 timer with a low-power timer.`
- `Swap the NRF52840 oscillator for a 32.768 kHz crystal oscillator.`
- `Replace the RP2040 oscillator with a 12 MHz crystal oscillator for the clock.`
- `Replace the oscillator with a 2 kHz oscillator for the audio stage.`
- `Replace PS2 with a microcontroller.`
- `Replace the ATmega328P timer with a low-power timer`

  The other ten residues already reached the assistant at HEAD through the pairing (they name a part, chip or alternative).
- **No new control.** The route labels are B18's three and the page's one import of the module is unchanged (C14): rule 5b's answer is
  an existing route with an existing reason, shown by the existing route badge - no B17-A rule change, no B18-D wire; the B17-A inventory
  regenerates byte-identical (628 controls). **CONFIRMED** (composer case 5; the gates below).
- **RECORDED:** "Replace U1 with a TLC555." (a new part named by its MPN alone) stays `single` in the router and an edit in the composer -
  the grammar names kinds, never parts (D3's recorded limit, unchanged). The composer sends every recorded semantic residue to the
  assistant now, as the router always did: a listed word used in another sense costs one DAG run of zero-authority specialists, never a
  change.

## 2. The coordinator's first turn behind the breaker (D21-39)

Why (`discovery.md` D21-39, OD-115): E1 metered and gated every specialist call and the follow-up turn, but a request made while the
coordinator's provider was paused still made its first turn's call - one paid call per request, and on a no-credits account one 429 per
request.

- **The gate** (`pausedFirstTurn`, C23): before the coordinator's first turn the route consults the SAME pause E1's runtime consults
  before the follow-up turn (C26) - the process's llm-provider meters (`PROCESS_LLM_PROVIDER_ADMISSION`, i.e. `currentLlmProviderPause`,
  C27, C28), the `interactive` purpose's ceiling - the whole PROCESS-WIDE window (C29), the coordinator's provider with no model key (C25).
  It runs for every plan that is not refused - the flag-off single path, the flag-on single path and the flag-on DAG path - and never for
  a Tier 3 ask, which is refused before any call either way (C16).
- **A half-open breaker's trial in flight** ([B21 E4 fix: regressions-1]): a half-open breaker whose one trial call is in flight
  never gates the first turn (C37). The meters answer that state as a breaker pause whose instant has already come
  (`retryAtMs = max(openUntil, now)` with
  `openUntil` passed) - the pause of the METERED calls, which may send one trial at a time. The first turn takes no trial and settles
  none, so it goes, exactly as it goes before the trial is taken (gate case 3); before the fix every chat request on that provider was
  refused for as long as another request's trial call ran, "until" the request's own instant and with no Retry. A breaker still open
  (its window's end to come) and a window pause gate it as before; the trial's own answer decides the next request (a success closes the
  breaker, no credits re-opens the long window). **CONFIRMED** (gate case 6; route case 6 - the flag-off stream byte-identical to HEAD's
  while the trial is out).
- **Paused: NO call.** The stream is `run_started` and ONE `run_failed` whose reason is `provider_breaker_open` (C21) and whose message is
  `No model call was made for this message: ` followed by the meters' own pause sentence (C22) - the provider, the cause (`insufficient_quota`
  with "or until an operator resets it", `rate_limit`, repeated failures) or the window, and until when. The card shows it with its Switch
  and without its Retry (`PROVIDER_FAILURES_WITHOUT_RETRY`, C30; `providerRetryOffered`, C32 - the Switch still re-sends on the other
  provider). The trace records the line and, through the route's finalization, the failed terminal with no step (C20); nothing is
  planned, run or written to the orchestration record (a `resumeRunId` of the gated run is refused `resume_unknown`). **CONFIRMED** (gate
  case 2; route cases 2 and 3 - no SDK call for the four messages on the flag-off path and for a single and a DAG plan on the flag-on path).
- **Not paused: nothing changes.** The gate emits and records nothing and the route runs the call site it always ran (C18). With the
  breaker closed the flag-off streams are byte-identical to HEAD's: B21-B's four digests recorded from HEAD 4b6d0e2
  (`eng1-656c2588b836c043`, `eng1-07aaf2589736c9f7`, `eng1-bf8822508f100b13`, `eng1-9fbc41d4ee249877`), reproduced here through the REAL
  adapter classes answering through fake SDK clients, one SDK call each. **CONFIRMED** (gate case 1; route case 1; B's route case 1).
- **In place, line-neutral.** `route.ts` keeps its 562 lines: the import (C15, line 35), the gate beside `let result` (C16, line 504) and
  the branch (C17, line 507) are edits of existing lines, so every route.ts line a B20 or B21 page cites stays on its line (the
  `app/lib/mcp/__tests__` page suites and the B, D2, D3, E1, E2 and E3 page suites green); the gate itself is appended to
  `orchestration-runtime.ts` (C21-C25), which moves no cited line - [B21 E4 fix: regressions-1] its three body lines edited in place
  and the trial test (C37) appended after it.
- **A RESUMED request is not gated at its first turn** (C19, C24): its first turn is REPLAYED from the record and makes no call. The
  calls it does make consult the breaker themselves (E1): the scheduler stops `provider_paused` before any specialist attempt while the
  coordinator's provider is paused (C35) and the follow-up turn is not made (`follow_up_paused`), and that stand-down SETTLES the request's
  claimed start (`settleStarted`), so the gate never stands a claimed request down and the run can be resumed at once. **CONFIRMED** (gate
  case 5; route case 5 - a resume while paused makes no SDK call, ends with ONE `run_completed` carrying the replayed answer, and with the
  breaker reset the next resume is admitted, not `resume_in_progress`).
- **One provider's breaker gates only its own requests**: with OpenAI paused a request on Anthropic makes its one coordinator call there.
  **CONFIRMED** (gate case 5; route case 4).
- **RECORDED - gated, not metered** ([B21 E4 fix: coverage-1, coverage-2]): the gate only READS the meters - it never admits or records
  a call (gate case 7) - so the first turn's own outcome never reaches the breaker (as in E1): a coordinator's 429 opens nothing, and a
  half-open window's trial is taken by the next specialist or follow-up call, never by a first turn (gate case 3). What follows, pinned:
  - the gate never fires on a flag-off process: no call there is metered (every plan is single; no specialist or follow-up turn runs),
    so nothing ever opens the breaker or fills the window - two requests on a no-credits account are two 429 calls, the second answered
    exactly as the first (route case 7; route case 2 opens the breaker through a metered call no flag-off request makes);
  - on a flag-on process the breaker opens only on a METERED call's answer - a specialist's or a follow-up turn's - so a no-credits
    account whose first turns fail first never opens it: the DAG stands down before any specialist and every request makes its one 429
    call (route case 8);
  - once opened for no credits it holds at most ONE window when no metered call follows: after the hour every first turn goes (and on
    such an account fails), and nothing re-opens the breaker until a metered call takes the half-open trial (gate case 7).
  So the "one 429 per request" of a no-credits account (the Why above) stands wherever no metered call reaches the provider - D21-42,
  opened by the review (section 5); closing it is the owner's OD-115 option (record the first turn's no-credits / rate-limit answer).
- **RECORDED - a window pause** ([B21 E4 fix: security-1]): the window is PROCESS-WIDE - the meters carry no principal or tenant; the
  `interactive` purpose may use all 240 requests of the provider's minute and the agent's share 60 of them (OD-40). When the window is
  used up the gate answers the same `provider_breaker_open` code - the no-Retry code D21-39 names - with the window's own sentence
  ("... is paused: its quota of 240 requests per minute is used up until ..."). The metered calls one principal's DAG runs make (60
  specialist calls at most, the rest follow-up turns) can therefore use up the minute and stand down every tenant's first turn on that
  provider until the minute ends, with no Retry (the card's Switch still re-sends on the other provider) - the owner's question under
  OD-115 (a per-principal bound on the window, or a window pause answered with its own reason). The agent's share used up does not gate a
  first turn (gate case 4; gate case 7 fills the window with other people's calls).
- **RECORDED - process-wide:** the breaker is process-wide by provider (E1's lead reading, one account per provider key), so one
  tenant's no-credits answer - or three consecutive transient failures of any principal's specialist calls - now stands down every
  tenant's first turn on that provider too - the truth about a shared account.

## 3. What E4 does NOT do

- No new exposed tool, descriptor, route or generator input: the route census stays 165 = 162 canonical + 3 factories + 0 raw, and the
  B11, B09 and B17-A generators re-run with zero drift.
- No new UI control: no B17-A rule change, no B18-D wire, `app/page.tsx` unchanged; no new run-event type, degraded reason, failure
  reason or request key (`provider_breaker_open` and `PROVIDER_FAILURES_WITHOUT_RETRY` are E1's, unchanged).
- No router answer changed and no grammar word added: the grammar moved verbatim (one of its lines then rewritten linear by the review
  fix, the same answers - section 1); the composer gained only what the predicate accepts.
- No metering of the first turn; no change to the loop, the adapters, `errors.ts`, the scheduler, the merge, the store or the nine
  B11-scanned files; no provider request key outside the pinned sets.
- No evaluations (B21-F); no reserved-file edit (their texts are in section 5).

## 4. Suites, evidence, the pin moves, gates

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/project/__tests__/b21-e4-composer-routing.test.ts` | 6 | the runbook sentence and its variants reach the assistant; the corpus through the composer against HEAD's recorded routes; no false phrasing moves; one predicate, no cycle, the normalization verbatim; no new control or export; [B21 E4 fix: security-3] linear on any composer text, the same answers as HEAD's scans |
| `app/lib/agent/orchestration/__tests__/b21-e4-replacement-grammar.test.ts` | 4 | the router's answers byte-identical to HEAD's under five fact sets; the grammar moved verbatim (the code lines hashed; [B21 E4 fix: security-3] the one line rewritten linear pinned exactly); the import line and the unchanged rule line; the decision IS the predicate |
| `app/lib/agent/orchestration/__tests__/b21-e4-first-turn.test.ts` | 7 | not paused: nothing; no credits: no call, the closed answer, no Retry, a valid trace; a rate limit and its half-open end; the window and the agent's share; a resume and another provider never gated; [B21 E4 fix] a trial in flight never gates (regressions-1); the gate only reads the meters - one window, a process-wide window (coverage-1, coverage-2, security-1, RECORDED) |
| `app/api/chat/__tests__/b21-e4-chat-first-turn.test.ts` | 8 | flag off, breaker closed: HEAD's four streams byte for byte; flag off while paused: no SDK call; flag on single and DAG plans while paused: no SDK call, no record; another provider; a resume while paused: no call, settled; [B21 E4 fix] a trial in flight: HEAD's stream (regressions-1); a no-credits account on a flag-off process and on a flag-on DAG whose first turn fails first: nothing opens the breaker (coverage-1, coverage-2, RECORDED) |
| `app/lib/agent/orchestration/__tests__/b21-e4-page.test.ts` | 8 | this page; [B21 E4 fix] case 8 the review's answers |
| `app/lib/agent/orchestration/__tests__/b21-b-router.test.ts` | 9 | B's cases; case 7 moved (the import line, the composer's two phrasings, the predicate's body in the composer module) |
| `app/lib/agent/orchestration/__tests__/b21-d3-replacement-roles.test.ts` | 9 | D3's cases; case 5's one composer assertion moved |
| `app/api/chat/__tests__/b21-e1-chat-provider.test.ts` | 3 | E1's cases; case 3's second request moved |
| `app/api/chat/__tests__/b21-e2-chat-events.test.ts` | 10 | E2's cases; case 5's `provider_paused` scenario moved, [B21 E4 fix: tests-1] E1's two exactly-once pins carried over as exactly-once |

**Test-first.** The new suites ran against HEAD fafc90e's production code before any production change (`e4/ff-1-failing-first.log`: 16
of 19 failing - the composer suite on its assertions and the missing export `partKindSwap`, the gate's suite on the missing export
`pausedFirstTurn`, the grammar suite's cases 2 and 3 on the router's source and case 4 on the missing export; grammar case 1 and route cases 1 and 4 passed by design - the
router's answers and the flag-off streams ARE HEAD's, and another provider was never gated - and route case 5 failed on its own
over-broad assertion of the degraded events, corrected before any production change). Then the moved pins and the route suite ran
against HEAD's production code (`e4/ff-2-moved-pins-at-head.log`: 5 of 36 failing - B's router case 7, D3's roles case 5, E1's route case
3, the E4 route cases 2 and 3; E2's route case 5 passes there by design - its breaker opens inside the request - as do route cases 1, 4
and 5). HEAD's router answers, composer routes and grammar code lines were recorded from the HEAD modules first (a probe run, deleted;
`e4/head-probe.json`). After the change every suite passed (`e4/run-1.log`, `run-2.log`).

**Pin moves, each with its reason written next to it in the suite.**
- `b21-b-router.test.ts` case 7: the router's source imports `POLITE` and `partKindSwap` (not `REPLACE_PART`); the two scenario-17
  phrasings the composer sent to the editor now reach the assistant (the divergence the D3 fix pinned is gone - the title's "one grammar,
  imported" holds again); the predicate's `REPLACE_PART` agreement line is read from composer-routing.ts.
- `b21-d3-replacement-roles.test.ts` case 5: the composer's route for the runbook sentence is `ask` (D21-38 closed); its router assertions
  unchanged. Its title keeps "RECORDED: the composer sends the runbook sentence to the schematic editor" for the closeout (the stale-title
  convention) [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): retitled - the composer sends it to the assistant since B21-E4; assertions unchanged].
- `b21-e1-chat-provider.test.ts` case 3: the NEXT request after the no-credits 429 makes no call at all - its first turn included - and
  answers ONE `run_failed` `provider_breaker_open` with no orchestration line (D21-39 closed).
- `b21-e2-chat-events.test.ts` case 5: the `provider_paused` scenario's breaker opens as the scheduler writes the plan (after the first
  turn, before any specialist) instead of before the request - a request made while the provider is already paused now makes no call; the
  scenario also carries E1's regressions-3 assertions (the paused provider named in the not-started line, no "failed during the
  specialists", one coordinator call).
- Pages: D3's C10 and C34 re-pinned to composer-routing.ts, B's C35 re-pinned (line unchanged), each with a dated note; dated E4 notes on
  the D3, B and E1 pages beside the statements E4 changed.
- [B21 E4 fix] The review pass: `b21-e2-chat-events.test.ts` case 5 carries E1's two regressions-3 pins as EXACTLY ONCE again
  (`toHaveLength(1)` over the whole stream, tests-1); `b21-e4-replacement-grammar.test.ts` case 2 pins the one moved line rewritten linear
  exactly and hashes the rest against HEAD's (security-3); the E4 page suite's case 3 quotes "the `interactive` purpose's ceiling - the
  whole PROCESS-WIDE window" and refuses "the person's share" (security-1); the D3 page's phrasing note and the B page's C35 row
  supersede "the router still imports `REPLACE_PART`" in words (coverage-4). Each reason is written next to it.

**CI.** The four orchestration suites ride the `app/lib/agent/orchestration/__tests__` filter; the route suite (C33) and the composer
suite (C34) are ONE explicit `prompt-to-gerber` entry each, after E3's; the guard's `[B21 A]` case admits both (each selected by exactly
one filter); no suite starts PGlite; none lives under `app/lib/engineering/__tests__`.

**Gates** (one heavy job at a time through the lock runner; logs under `b21/e4/`): every B21 suite with the eight route suites, the E4
composer suite and the CI job-scope guard (`gate-1-b21-chat.log`: 66 files, 544 of 544, every A..E4 page suite included);
`app/lib/project/__tests__` with `app/components/chat` (`gate-2-project-ui.log`: 40 files, 317 of 317 - B18's composer suites and the
B18-D UI gates among them); `app/lib/agent/__tests__` with the engineering exposure and tier suites and the B17-A control inventory
(`gate-3-agent-eng-ui.log`: 63 files, 646 of 646); `app/lib/llm/__tests__` and `app/lib/acquisition/__tests__` (`gate-4-llm-acq.log`: 22
files, 235 passed, the one opt-in live file's 2 cases skipped as before); the import gates, census ratchets and route matrices
(`gate-5-import-census.log`: 10 files, 104 of 104 - the route-policy census 165/162/3/0 unchanged); `app/lib/mcp/__tests__` with
`app/api/mcp/__tests__` (`gate-6-mcp.log`: 33 files, 737 of 737 - the B20 pages' citations) and `app/lib/mcp/server/__tests__`
(`gate-7-mcp-server.log`: 19 files, 183 of 183 - the b20-b2 nine-file pin among them); the proposal families and approval paths
(`gate-8-families.log`: 34 files, 513 of 513); tsc 0; eslint on the 14 changed and new TypeScript files clean. Zero drift, the outputs
snapshotted by sha256 first (`e4/gen/`): the B11 generator (19 of 19 cases, 61 of 61 checks) and the B09 agent artifacts (the 21 files
byte-identical), the B17-A inventory generated into the scratchpad (628 controls; the CSV and the summary identical to the committed ones);
the tree's status unchanged by the generators.

**Gates after the review fixes** ([B21 E4 fix]; one heavy job at a time through the lock runner, the chain `e4fix/gates.sh`, logs
under `b21/e4fix/gates/`): every B21 suite - the orchestration directory, every A..E4 page suite included - with the E4 composer suite
and the CI job-scope guard (`gate-1-b21.log`: 44 files, 402 of 402); `app/api/chat/__tests__` in full - the nine B21 route suites among
them - with `app/lib/llm/__tests__` and `app/lib/acquisition/__tests__` (`gate-2-chat-llm-acq.log`: 45 files, 384 passed, the one
opt-in live file's 2 cases skipped as before); `app/lib/agent/__tests__` with the engineering exposure and tier suites, the B17-A
control inventory and the B18-D UI gates (`gate-3-agent-eng-ui.log`: 63 files, 646 of 646); `app/lib/project/__tests__` with
`app/components/chat` (`gate-4-project-ui.log`: 40 files, 318 of 318 - B18's composer suites among them); the proposal families and
approval paths (`gate-5-families.log`: 34 files, 513 of 513); the import gates, census ratchets and route matrices
(`gate-6-import-census.log`: 10 files, 104 of 104 - the route-policy census 165/162/3/0 unchanged); `app/lib/mcp/__tests__` with
`app/api/mcp/__tests__` (`gate-7-mcp.log`: 33 files, 737 of 737 - the B20 pages' citations) and `app/lib/mcp/server/__tests__`
(`gate-8-mcp-server.log`: 19 files, 183 of 183 - the b20-b2 nine-file pin); tsc 0; eslint clean on the 14 changed and new TypeScript
files (`eslint-files.txt`; `app/page.tsx` is not among them - E4 does not touch it). Zero drift: the B11 generator (19 of 19 cases, 61
of 61 checks) and the B09 agent generator rewrote their 21 artifact files byte-identical (sha256), the B17-A inventory generated into the
scratchpad (628 controls; the CSV and the summary identical to the committed ones), the tree's status unchanged by the generators.

Live behaviour with a real model: **BLOCKED-LIVE-QUALIFICATION** (LB-9) - no model is called. [B21 E4 fix: coverage-2] The draft's
UNKNOWN ("whether a live provider's 429 no-credits answer arrives on the coordinator's first call often enough that gating it matters")
is answered by the code: on an account with no credits it arrives on the coordinator's first call of EVERY request, and the gate stops
that call only while a metered call's answer holds the breaker open (D21-42, RECORDED; route cases 7 and 8).

### The review's findings (E4)

The adversarial review of the first draft confirmed seven findings; each was answered test-first - the reproducing case run through the
lock runner on the draft and its failure recorded (`e4fix/ff-1-failing-first.log`; a test-strength finding by a deliberate breakage,
restored by hash), then the fix, then the re-run (`e4fix/fix-1-green.log`). Logs under the scratchpad's `b21/e4fix/`.

| finding | review / verdict | reproduced by | on the draft | fix | re-run |
|---|---|---|---|---|---|
| `regressions-1` | medium / low | gate case 6; route case 6 | FAILED: the first turn gated while another request's half-open trial call was in flight - "paused ... until" its own instant, no Retry (gate case 6 at `b21-e4-first-turn.test.ts:135`); the flag-off stream `eng1-eca57f1a33c6687d`, not HEAD's `eng1-656c2588b836c043` (route case 6) | `pausedFirstTurn` ignores the one pause shape that means a trial in flight - a breaker pause whose instant has come (C37); one clock read for the pause and the test | green: gate 7 of 7, route 8 of 8; the draft runtime swapped back in fails exactly these two cases (`e4fix/ff-2-limits-on-draft-runtime.log`) |
| `security-1` | medium / low | page cases 3 and 8; gate case 7 (c) | FAILED: the page called the window "the person's `interactive` share" and recorded no cross-tenant consequence (page cases 3 and 8); gate case 7 (c) - other people's metered calls fill the window every first turn reads - passes by design (the lead's task gates a paused WINDOW too) | the trial-in-flight half by `regressions-1`'s fix; the window stated PROCESS-WIDE on the page, in the runtime's comment and in OD-115's amendment, its cross-tenant stand-down RECORDED as OD-115's owner question | green |
| `security-3` | low / low | composer case 6 | FAILED: the four 150 000-character shapes took 60 808, 78 334, 75 134 and 100 759 ms through the composer and the router (bound 1 000 ms) | the two normalization lines and the predicate's raw trailing run found from the run's START (a lookbehind, C38-C40): the same run, linear; grammar case 2's reviewed pin move | green: the composer suite, those shapes included, in 349 ms; the router's corpus digests unchanged (grammar case 1) |
| `coverage-1` | medium / medium | route case 7; page case 8 | route case 7 passes on the draft BY DESIGN - it pins the finding's scenario: two flag-off no-credits requests, two 429 calls, nothing metered (`e4fix/ff-2-limits-on-draft-runtime.log`); page case 8 FAILED: the page presented the flag-off path as gated in effect | recorded, not metered: the page, the E1 note, OD-115's amendment and the D21-39 / D21-18 clauses state that the gate never fires on a flag-off process; D21-42 opened; route case 2's comment names the metered call that opens its breaker | green |
| `coverage-2` | medium / medium | route case 8; gate case 7 (a, b); page case 8 | route case 8 and gate case 7 pass on the draft BY DESIGN (a flag-on no-credits account whose first turn fails first never opens the breaker; once opened it holds one window); page case 8 FAILED: the page said a half-open trial "is taken by the next specialist or follow-up call" as if one always follows | the page's "gated, not metered" bullet, OD-115's amendment and the D21-39 clause state the one-window limit and that no metered call may follow; D21-42 names the owner's option (record the first turn's no-credits / rate-limit answer) | green |
| `coverage-4` | low / low | page case 8 | FAILED: the D3 page still said "the router still imports `REPLACE_PART`" with a note that never retracted it; B's C35 row likewise | the D3 note reworded "Superseded: since B21-E4 the router no longer imports `REPLACE_PART` ..."; B's C35 row says so | green |
| `tests-1` | low / low | E2 route case 5 strengthened | the unstrengthened case PASSED with both breakages applied (`e4fix/t1-old-case5-under-M1M2.log`); strengthened, it FAILS with the runtime's stand-down reported twice (M1, `b21-e2-chat-events.test.ts:309`, 2 not 1) and with the scheduler's not-started line emitted twice (M2, `:308`) | the `provider_paused` branch counts both lines over the whole stream (`toHaveLength(1)`), E1's original strength | sources restored byte for byte (sha256 `46b2b0eb...` orchestration-runtime.ts, `c2ed6c8f...` scheduler.ts), then 10 of 10 (`e4fix/t1-new-case5-restored.log`) |

## 5. For the lead — the reserved texts, in full

Each `### OD-…` below is the amendment for `OWNER_DECISIONS.md` (as `## OD-…`), in its format. Then the README row, the ledger
paragraph, the PROGRAM_STATE texts, the discovery closure clauses (D21-42 is a new defect, opened by the review) and the §10 amendment
line.

### OD-115 — Provider spend controls for the DAG, amended: the coordinator's first turn behind the breaker (B21-E4, 2026-09-28)

- **Question:** B21-E1 applied OD-115 to every specialist call and the follow-up turn and recorded the coordinator's own first turn as
  "not applied" (D21-39): a request made while the coordinator's provider was paused still made that one call.
- **Applied:** the chat route consults the SAME pause before the coordinator's first turn - `currentLlmProviderPause` through
  `PROCESS_LLM_PROVIDER_ADMISSION`, the `interactive` purpose (the whole process-wide window), the coordinator's provider with no model
  key (as the follow-up turn) - on the flag-off single path and on both flag-on paths. Paused: NO call - `run_started`, then ONE
  `run_failed` `provider_breaker_open` carrying the meters' own pause sentence, the card showing its Switch without Retry (E1's
  `providerRetryOffered` rule), nothing planned, run or written to the orchestration record. A Tier 3 ask is refused before the gate (no
  call either way). A resumed request's first turn is replayed from the record and never gated: its specialists and its follow-up turn
  consult the breaker, and their stand-down settles its claimed start. Not paused: the route is unchanged (the flag-off stream
  byte-identical to HEAD's). A half-open breaker whose one trial call is in flight is NOT a pause for the first turn (the adversarial
  review, regressions-1): the first turn takes no trial and settles none, so it goes, as it does before the trial is taken.
- **Not applied (recorded):** the first turn is gated, not metered - the gate only reads the meters, and the first turn's own outcome
  never reaches the breaker: a coordinator's 429 opens nothing. Hence (D21-42): the gate never fires on a flag-off process (no call there
  is metered, so no provider is ever paused); on a flag-on process the breaker opens only on a specialist's or a follow-up turn's answer,
  so a no-credits account whose first turns fail first never opens it, and once opened for no credits it holds at most ONE window when no
  metered call follows (every first turn after the hour goes and fails; the half-open trial waits for a metered call). The coordinator's
  SDK retries stay inside its adapter. A window pause answers the same no-Retry code as an open breaker, its sentence naming the window.
  The window and the breaker are PROCESS-WIDE by provider (no principal or tenant in the meters): one principal's metered calls - 60
  specialist calls at most, the rest follow-up turns - can use up the provider's minute, and one tenant's no-credits answer or three
  transient failures of any principal's specialist calls open the breaker; either now stands down every tenant's first turn on that
  provider (a window pause until the minute ends), with no Retry and the Switch kept.
- **Evidence:** `composer-and-first-turn.md` section 2 and section 4's "The review's findings (E4)"; `b21-e4-first-turn.test.ts` (7
  cases: 6 the trial in flight, 7 the recorded limits), `b21-e4-chat-first-turn.test.ts` (8 cases: 6 the trial in flight through the
  POST, 7 and 8 a no-credits account on a flag-off process and on a flag-on DAG); E1's route case 3 and E2's route case 5 moved with
  their reasons (E2's exactly-once pins restored).
- **Owner options:** record the first turn's no-credits and rate-limit answers to the breaker without reserving the window (closes
  D21-42: the flag-off path and a no-credits account would then open and re-open it - and one tenant's transient billing answer would
  pause every tenant's chat on that provider for the long window, the trade the owner decides); bound the window per principal before it
  may gate other principals' first turns, or answer a window pause with its own reason, whose Retry is offered once the minute has passed
  (a move of OD-40's shares or of E1's closed `PROVIDER_FAILURES_WITHOUT_RETRY` list).

### The README row (`artifacts/ai-control-plane-b21/README.md`, a new row "B21-E4" after B21-E3)

| B21-E4 the composer reaches the DAG with the runbook's own sentence; the coordinator's first turn behind the breaker | `composer-and-first-turn.md`; code `app/lib/project/composer-routing.ts` (the router's strict replacement grammar moved in verbatim and exported as ONE predicate beside `REPLACE_PART`, with its polite prefix, appended - one of its lines then made linear by the review fix; rule 5b, the normalization line and two comment blocks in place), `app/lib/agent/orchestration/router.ts` (the import line, the normalization line and two comment pairs in place; the appended grammar removed), `app/api/chat/route.ts` (three lines in place: the import, the gate, the branch), `app/api/chat/orchestration-runtime.ts` (the first-turn gate and its trial test, appended), `app/lib/ai-preferences.ts` (one comment line in place), the workflow's two explicit entries | CONFIRMED (the runbook's scenario-17 sentence reaches the assistant from the composer - rule 5b and the router's replacement rule answer with the ONE predicate the router imports, never the reverse; the router's answers byte-identical to HEAD's over the six-round corpus under five fact sets; the corpus through the composer: every genuine request and residue asks, no false DAG phrasing moves; every scan E4 added to the composer's path linear on any text (B18-E's `REPLACE_PART` stays super-linear on a self-pasted run, RECORDED in section 1); a coordinator provider paused by the llm-provider meters gets NO call on the flag-off and flag-on paths - `run_started` and ONE `run_failed` `provider_breaker_open` without Retry, nothing planned or recorded; a half-open breaker's trial in flight never gates a first turn; a resumed request never gated at its replayed first turn and still making no call; the flag-off stream byte-identical to HEAD's with the breaker closed; no control, route, run-event type, request key or reason added; D21-38 and D21-39 closed; RECORDED: the gate only reads the meters - it never fires on a flag-off process and a no-credits account whose first turns fail first never opens the breaker (D21-42 opened); the adversarial review's seven findings answered test-first; live behaviour BLOCKED-LIVE-QUALIFICATION, LB-9) |

### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-E4 — the composer's kind swap and the coordinator's first turn behind the breaker (2026-09-28 local; increment workflow + lead; this commit)

- Test-first: HEAD fafc90e's router answers (five fact sets), composer routes and grammar code lines recorded from the HEAD modules
  (`e4/head-probe.json`); the new suites red against HEAD (`e4/ff-1-failing-first.log`: 16 of 19 failing), the moved pins and the route
  suite red against HEAD's production code (`e4/ff-2-moved-pins-at-head.log`: 5 of 36 failing); then green.
- Code: `composer-routing.ts` (B21-D3's replacement grammar moved in verbatim as ONE exported predicate beside `REPLACE_PART`, with
  `POLITE`; rule 5b uses it), `router.ts` (imports the predicate and the prefix on its old import line; two comment pairs in place; the
  appended grammar removed - every cited line kept), `route.ts` (three lines in place: the first-turn gate before the coordinator's first
  turn on every plan that is not refused), `orchestration-runtime.ts` (`pausedFirstTurn`, appended), `ai-preferences.ts` (one stale
  comment in place), the workflow's two explicit entries. No route, descriptor, run-event type, control, request key, reason or
  generator input changed; census 165/162/3/0; the nine scanned files byte-identical to HEAD.
- The adversarial review (seven confirmed findings, each answered test-first - `composer-and-first-turn.md` section 4, logs
  `e4fix/`): a half-open breaker's trial in flight gated every chat request on that provider "until" its own instant - now it never
  gates a first turn (`halfOpenTrialInFlight`, gate case 6, route case 6); the composer's new path scanned trailing punctuation
  quadratically on its unbounded text (60 808 to 100 759 ms at 150 000 characters) - the two normalization lines and the predicate's
  trailing run now start from the run's start (composer case 6, the router's answers unchanged); E2's route case 5 carries E1's
  exactly-once pins again (proven by two deliberate breakages, the sources restored by hash); the process-wide window, the gate's
  inertness on a flag-off process and the one-window limit under persistent no-credits RECORDED and pinned (gate case 7, route cases 7
  and 8; D21-42 opened); the D3 page's stale "the router still imports `REPLACE_PART`" superseded in words.
- Pin moves with their reasons: B's router case 7, D3's replacement-roles case 5, E1's route case 3, E2's route case 5 (and its
  exactly-once pins restored), the grammar suite's case 2 (the one line rewritten linear); D3's page C10 and C34 and B's page C35
  re-pinned; dated E4 notes on the D3, B and E1 pages.
- Gates after the review fixes, one job at a time (the lead re-runs them): every B21 suite - the orchestration directory, every A..E4 page
  suite included - with the E4 composer suite and the CI guard (44 files, 402 of 402); `app/api/chat` in full with `app/lib/llm` and
  `app/lib/acquisition` (45 files, 384 passed, the one opt-in live file's 2 cases skipped as before); `app/lib/agent` with the exposure
  and tier suites, the B17-A inventory and the B18-D UI gates (63 files, 646 of 646); `app/lib/project` with `app/components/chat` (40
  files, 318 of 318); the proposal families (34 files, 513 of 513); the import gates and census (10 files, 104 of 104); `app/lib/mcp`
  and `app/api/mcp` (33 files, 737 of 737) and `app/lib/mcp/server` (19 files, 183 of 183); tsc 0; eslint clean on the 14 changed and
  new TypeScript files; the B11 (19 of 19 cases, 61 of 61 checks) and B09 generators (their 21 artifact files byte-identical by sha256) and the
  B17-A generator (628 controls, CSV and summary identical) with zero drift and the tree's status unchanged - figures on the page.
- Records: `composer-and-first-turn.md`; OD-115 amended; D21-38 and D21-39 closed; D21-42 opened (medium, the owner's OD-115 option);
  D21-18's first-turn clause narrowed. Live: BLOCKED-LIVE-QUALIFICATION (LB-9) - no model is called.

### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-E4 committed on chapter/b21-specialist-orchestration: the composer reaches the DAG with the runbook's own
sentence - B21-D3's strict replacement grammar moved verbatim into composer-routing.ts as ONE exported predicate beside REPLACE_PART, the
composer's rule 5b and the router answering with it (the router importing it, its answers byte-identical to HEAD's over the six-round
corpus; every scan E4 added to the composer's path linear, B18-E's REPLACE_PART recorded super-linear) - and the coordinator's first turn behind the llm-provider breaker - a paused provider
gets NO call on the flag-off and flag-on paths, one run_failed provider_breaker_open without Retry, a half-open breaker's trial in flight
never gating it, a resumed request never gated at its replayed first turn, the flag-off stream byte-identical with the breaker closed;
the gate only reads the meters (D21-42 opened: on a flag-off process it never fires, and a no-credits account whose first turns fail
first never opens the breaker); the adversarial review's seven findings answered test-first; D21-38 and D21-39 closed; B21-E complete;
next B21-F".
`nextAction`: "B21-F: the evaluations (offline fake-provider, model-in-loop record-only, browser) with the per-role scripted specialists
answering through the result tool (D21-40); then the B21 closeout; OD-126's older-page question, OD-112's option A, OD-122's across-runs,
at-least-once and stale-artifact options, OD-111's retention question and OD-115's first-turn options (record the first turn's
no-credits / rate-limit answer - D21-42 - and a per-principal window or a window pause's own reason) stay with the owner".
The report line for the closeout: `MULTI-AGENT STATUS: ...; the composer reaching the replacement DAG with the runbook's own sentence and
the coordinator's first turn behind the llm-provider breaker (B21-E4) delivered offline - one replacement predicate for the composer and
the router, and no paid call to a provider while the meters hold it paused (a breaker opened by a metered call's answer, or the
process-wide window); RECORDED: the first turn is not metered, so on a flag-off process nothing pauses a provider and a no-credits account
whose first turns fail first is never paused (D21-42, the owner's option); evaluations pending (B21-F); live disagreement / fallback /
quota BLOCKED-LIVE-QUALIFICATION under LB-9`.

### Discovery closure clauses (`discovery.md` §4, appended to each defect; D21-42 is a new defect after D21-41; §10 gains a B21-E4 amendment)

- **D21-38 — The composer sends the runbook's scenario-17 sentence to the schematic editor.** — CLOSED by B21-E4: B21-D3's strict
  replacement grammar (`partKindSwap` with its polite prefix and every closed vocabulary) moved verbatim into composer-routing.ts as ONE
  exported predicate beside `REPLACE_PART`; the composer's rule 5b uses it and the router imports it (never the reverse), so "Replace the
  NE555 timer U1 with a lower-power timer." reaches the assistant from the UI and routes to the replacement DAG; the router's answers are
  byte-identical to HEAD's over the six-round corpus under five fact sets, and through the composer every genuine request and recorded
  residue asks while no false DAG phrasing changes its route; every scan E4 added to the composer's path is linear on any text, B18-E's
  `REPLACE_PART` recorded super-linear (the review's
  security-3: the two normalization lines and the predicate's trailing run start from the run's start, one moved line rewritten, the
  same answers) (`composer-and-first-turn.md` section 1; `b21-e4-composer-routing.test.ts` cases 1 to 4 and 6,
  `b21-e4-replacement-grammar.test.ts` cases 1 to 4). RECORDED: a swap naming only an MPN ("Replace U1 with a TLC555.") stays `single`
  and an edit - the grammar names kinds, never parts.
- **D21-39 — The coordinator's first turn is not gated by the llm-provider breaker.** — CLOSED by B21-E4 (OD-115 amended): the route
  consults the same pause as the follow-up turn (`currentLlmProviderPause`, the `interactive` purpose - the whole process-wide window -,
  the coordinator's provider) before the coordinator's first turn on the flag-off and flag-on paths; a paused provider gets NO call -
  `run_started` and ONE `run_failed` `provider_breaker_open` carrying the meters' pause sentence, which the card declines to retry - and
  nothing is planned or recorded; a half-open breaker's trial in flight never gates a first turn; a resumed request's replayed first
  turn is never gated (its specialists and follow-up consult the breaker, their stand-down settling its start); the flag-off stream is
  byte-identical to HEAD's with the breaker closed (`composer-and-first-turn.md` section 2; `b21-e4-first-turn.test.ts` cases 1 to 6,
  `b21-e4-chat-first-turn.test.ts` cases 1 to 6). RECORDED: gated, not metered - the gate only reads the meters, so the gate never fires
  on a flag-off process and a no-credits account whose first turns fail first never opens the breaker; once opened for no credits it
  holds at most ONE window when no metered call follows (D21-42; gate case 7, route cases 7 and 8); the window and the breaker are
  process-wide, so one principal's metered calls or one tenant's no-credits answer stand down every tenant's first turn on that provider
  (OD-115's owner question).
- **D21-18 — No provider-level circuit breaker, quota or Sirkit-owned retry exists; the only thing preventing a paid retry storm is the human not clicking Retry.** — addendum by B21-E4: the RECORDED clause "the coordinator's own first turn is not gated (D21-39)"
  is superseded - since B21-E4 the first turn is gated by the same pause (not metered), so a request made while the provider is paused
  makes no paid call at all (`b21-e4-chat-first-turn.test.ts` cases 2 and 3; E1's route case 3 moved). What opens the breaker is
  unchanged: a metered call's answer (a specialist's or a follow-up turn's) - so on a flag-off process nothing pauses a provider, and a
  no-credits account whose first turns fail first still makes one 429 call per request (D21-42).
- **D21-42 — The llm-provider breaker is armed only by metered calls: the first-turn gate never fires on a flag-off process, and a
  no-credits account whose first turns fail first never opens the breaker.** Requirement: B21-E "quota/rate-limit circuit breakers; no
  repeated paid retry storm" (`:853-854`); D21-39's own reason ("one paid call per request", on a no-credits account one 429 per
  request). Finding: only admitted calls record outcomes - the specialists (`scheduler.ts`, through `admittedAdapter`) and the follow-up
  turn (`orchestration-runtime.ts`); both run only on a DAG plan, and `planChatRun` answers `single` for every message on a flag-off
  process, so there no call is ever metered, the breaker never opens, the window never fills and `pausedFirstTurn` always answers null;
  on a flag-on process a coordinator turn that fails stands the DAG down before any specialist, so an account out of credits before a
  request never opens the breaker, and after an opening's window the half-open trial is taken only by a metered call - when every first
  turn fails first, none comes, and the breaker stays half-open (every first turn goes). Severity medium. **CONFIRMED**
  (`b21-e4-chat-first-turn.test.ts` cases 7 and 8, `b21-e4-first-turn.test.ts` case 7). Closes: the owner's OD-115 option (record the
  first turn's no-credits and rate-limit answers to the breaker without reserving the window; its trade: one tenant's transient billing
  answer then pauses every tenant's chat on that provider for the long window). Source: the B21-E4 adversarial review (coverage-1,
  coverage-2). — OPENED by B21-E4's review; the defect numbering continues from D21-41.
- **§10, B21-E4 (recorded by the lead, 2026-09-28):** Section 4: D21-38 and D21-39 closed; D21-42 opened (medium); D21-18's first-turn
  clause superseded and narrowed. Section 6: OD-115 amended as `composer-and-first-turn.md` states it (the first turn gated, not
  metered; the process-wide window and breaker and the first-turn metering recorded as the owner's options). Section 7, B21-E4: as built -
  the router's replacement grammar moved verbatim into the composer module as ONE exported predicate the composer's rule 5b and the router
  call (the router importing it and its polite prefix; its answers byte-identical); the first-turn gate in place in the route before every
  plan that is not refused, a half-open breaker's trial in flight and a resumed request's replayed first turn never gated; no control,
  route, run-event type, request key or reason added. Section 8: the adversarial review's seven findings answered test-first (a trial in
  flight never gates a first turn; every scan E4 added to the composer's path linear (B18-E's `REPLACE_PART` recorded super-linear); E2's route case 5 carries E1's exactly-once pins again; the
  process-wide window, the gate's inertness on a flag-off process and the one-window limit recorded, D21-42 opened; the D3 page's stale
  import clause superseded in words). B21-E is complete; next B21-F.

## 6. Citations, as of base fafc90e

The anchor is what the tests check - it occurs exactly once in its file (within the named function when one is named) - and, for every
production file E4 changed (`composer-routing.ts`, `router.ts`, `route.ts`, `orchestration-runtime.ts`, `ai-preferences.ts`), the line
stated is the CURRENT line and page case 4 checks it; for every other file the line is as of the base, for the reader. C37-C40 were
added by the review fixes ([B21 E4 fix]).

| # | file | line | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/lib/project/composer-routing.ts` | 51 | — | `export const REPLACE_PART = ` | the composer's pairing, unchanged: a part / component / MPN / alternate word |
| C2 | `app/lib/project/composer-routing.ts` | 80 | — | `partKindSwap(replacementMessage(text), text)) return routed("ask"` | rule 5b: the pairing OR the router's predicate, the reason unchanged |
| C3 | `app/lib/project/composer-routing.ts` | 104 | — | `export const POLITE = ` | the polite prefix, moved with the grammar and imported by the router |
| C4 | `app/lib/project/composer-routing.ts` | 106 | — | `const PART_KIND_SWAP = ` | the polite-prefix pattern, moved verbatim |
| C5 | `app/lib/project/composer-routing.ts` | 167 | — | `const REPLACEMENT_FORMS: readonly RegExp[] = ` | the three request shapes per object kind, moved verbatim |
| C6 | `app/lib/project/composer-routing.ts` | 174 | — | `const VACUOUS_FORMS: readonly RegExp[] = ` | a bare new part names nothing new, moved verbatim |
| C7 | `app/lib/project/composer-routing.ts` | 188 | — | `export function partKindSwap(message: string, raw: string): boolean {` | the ONE exported predicate |
| C8 | `app/lib/project/composer-routing.ts` | 194 | — | `if (!kindForm && !(partForm && REPLACE_PART.test(rest))) return false;` | a part-word form still requires the pairing, in the same module |
| C9 | `app/lib/project/composer-routing.ts` | 202 | — | `function replacementMessage(text: string): string {` | the router's normalization restated verbatim (no import of the router) |
| C10 | `app/lib/agent/orchestration/router.ts` | 23 | — | `import { POLITE, partKindSwap } from "../../project/composer-routing";` | the router imports the predicate and the prefix, in place |
| C11 | `app/lib/agent/orchestration/router.ts` | 71 | — | `const headVerb = (verbs: string): RegExp => new RegExp(` | the router's own head verbs read the imported prefix |
| C12 | `app/lib/agent/orchestration/router.ts` | 160 | — | `export function normalizeRouterMessage(text: string): string {` | the router's normalization ([B21 E4 fix: security-3] its trailing strip made linear in place, C40 - the same answers) |
| C13 | `app/lib/agent/orchestration/router.ts` | 177 | — | `if (facts.hasSchematic && partKindSwap(message, userMessage)) return dag("D-component-replacement"` | the rule, unchanged on its line |
| C14 | `app/page.tsx` | 60 | — | `import { COMPOSER_ROUTE_LABELS, routeComposerMessage, type ComposerRoute } from "@/app/lib/project/composer-routing";` | the page's one import of the module, unchanged: no new control |
| C15 | `app/api/chat/route.ts` | 35 | — | `pausedFirstTurn, planChatRun` | the import, in place |
| C16 | `app/api/chat/route.ts` | 504 | — | `const paused = plan.kind === "refused" ? null : pausedFirstTurn({ runId, provider, resume, emit, trace: traceRecorder });` | the gate, in place, for every plan that is not refused |
| C17 | `app/api/chat/route.ts` | 507 | — | `} else if (paused) { result = paused; } else {` | a gated request's answer; the first turn below runs only when nothing was stood down |
| C18 | `app/api/chat/route.ts` | 520 | — | `result = plan.kind === "dag" ? await runOrchestratedChat(` | the first turn's call site, unchanged |
| C19 | `app/api/chat/route.ts` | 366 | — | `const resume = await resolveChatResume(` | the resume judged first: a refused resume never reaches the gate |
| C20 | `app/api/chat/route.ts` | 527 | — | `finalizeTrace(result.status, result.failureReason ?? null);` | the gated request's failed terminal recorded |
| C21 | `app/api/chat/orchestration-runtime.ts` | 818 | — | `export const FIRST_TURN_PAUSED_REASON = "provider_breaker_open" as const;` | the one terminal reason: E1's no-Retry code |
| C22 | `app/api/chat/orchestration-runtime.ts` | 820 | — | `export function firstTurnPausedLine(pause: AdmissionPause): string {` | the line: the meters' own pause sentence |
| C23 | `app/api/chat/orchestration-runtime.ts` | 834 | — | `export function pausedFirstTurn(` | the gate |
| C24 | `app/api/chat/orchestration-runtime.ts` | 835 | — | `if (input.resume.kind === "resume") return null;` | a resumed request's replayed first turn is never gated |
| C25 | `app/api/chat/orchestration-runtime.ts` | 836 | — | `const pause = (input.admission ?? PROCESS_LLM_PROVIDER_ADMISSION).pause(input.provider, undefined, "interactive"` | the same pause as the follow-up turn's |
| C26 | `app/api/chat/orchestration-runtime.ts` | 265 | — | `const followUpPause = input.providers ? input.providers.admission.pause(request.provider, undefined, "interactive"` | E1's follow-up gate, the precedent |
| C27 | `app/lib/agent/orchestration/provider-policy.ts` | 151 | — | `pause: (provider, model, purpose, now) => currentLlmProviderPause(keyOf(provider, model), now, purpose),` | the process's meters |
| C28 | `app/lib/acquisition/admission-control.ts` | 406 | — | `export function currentLlmProviderPause(` | the pause, per purpose, reserving nothing |
| C29 | `app/lib/acquisition/admission-control.ts` | 37 | — | `export const PURPOSE_QUOTA_SHARE` | the `interactive` purpose may use the whole window, the agent a quarter ([B21 E4 fix: security-1] the window is process-wide, never one person's) |
| C30 | `app/lib/ai-preferences.ts` | 193 | — | `export const PROVIDER_FAILURES_WITHOUT_RETRY = Object.freeze(` | the failures without Retry, unchanged |
| C31 | `app/lib/ai-preferences.ts` | 190 | — | `since D21-39 a request whose coordinator provider is paused ends with it` | its comment, corrected in place |
| C32 | `app/lib/agent/run-consumer.ts` | 73 | — | `export function providerRetryOffered(reason: string): boolean {` | the card's Retry rule, unchanged |
| C33 | `.github/workflows/deterministic-manufacturing.yml` | 153 | — | `app/api/chat/__tests__/b21-e4-chat-first-turn.test.ts` | the route suite's one explicit CI entry [B24-D1, 2026-10-09] re-pinned +1: B24-D1's prompt-to-gerber start step at `:32` (OD-30) |
| C34 | `.github/workflows/deterministic-manufacturing.yml` | 154 | — | `app/lib/project/__tests__/b21-e4-composer-routing.test.ts` | the composer suite's one explicit CI entry [B24-D1, 2026-10-09] re-pinned +1: B24-D1's prompt-to-gerber start step at `:32` (OD-30) |
| C35 | `app/lib/agent/orchestration/scheduler.ts` | 494 | — | `if (routing?.kind === "coordinator-paused") { stop = "provider_paused";` | a resumed request's specialists consult the breaker (E1) |
| C36 | `app/api/chat/route.ts` | 14 | — | `No silent cross-provider fallback exists;` | the route header stands: a gated request never switches provider |
| C37 | `app/api/chat/orchestration-runtime.ts` | 850 | — | `function halfOpenTrialInFlight(pause: AdmissionPause, at: number): boolean {` | [B21 E4 fix: regressions-1] a half-open breaker's trial in flight is the metered calls' pause, never the first turn's |
| C38 | `app/lib/project/composer-routing.ts` | 195 | — | `const trailing = /(?<![.!?\s])[.!?\s]*$/.exec(raw.trim())?.[0] ?? "";` | [B21 E4 fix: security-3] the raw message's trailing run found from its start: the one moved line rewritten |
| C39 | `app/lib/project/composer-routing.ts` | 203 | — | `.toLowerCase().replace(/(?<![.!?])[.!?]+$/, "").trim();` | [B21 E4 fix: security-3] the composer's normalization, linear |
| C40 | `app/lib/agent/orchestration/router.ts` | 161 | — | `.toLowerCase().replace(/(?<![.!?])[.!?]+$/, "").trim();` | [B21 E4 fix: security-3] the router's normalization, the same line |
