# J5-C — the fixture half of sheet-aware AI (evidence page)

Runbook section J increment 5 (`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` J.6 lines 315-334, J.9 lines
360-392); decisions OD-255, OD-257, OD-258, OD-259 (`artifacts/remaining-builder-program/OWNER_DECISIONS.md`). Branch
`codex/astra-foundation` at the WIP checkpoint `11a3154a` plus the three builders' working trees (2026-10-23). Build plan
`scratchpad/j/j5-plan.md`: A (the sealed organise proposal tool, sheet-aware inspect, open-sheet), B (generated results laid out as
sheets, the organise review card), C (this increment: the typed planner interfaces as a fixture-only plan field, the organise groups
the scripted model proposes, the two J.9 browser specs, the guard replays, this page).

Status legend: **fixture** = proven against the fixture runtime (committed catalog, scripted provider and agent, no router recording
for the drone or the dimmer, US$0); **live** = proven against the authorized live model (none for J5: OD-259 item 7; the live
multi-sheet generation waits on the owner's quota and spend approval); **unit** = a vitest suite; **pending** = awaits another
builder's increment (named). Nothing below is claimed beyond its label. Spend for everything on this page: **US$0**.

## 1. What was built (C)

| piece | files | state |
|---|---|---|
| Typed interfaces on the drone plan's blocks - `{ net, direction input/output/bidirectional/passive, kind signal/power/ground, domain battery/logic/return }`, exactly one per shared net in the shared nets' order; PWMn output at the MCU / input at the motor stages, I2C_SDA / I2C_SCL bidirectional on every I2C block, IMU_INT1 output at the IMU / input at the MCU, VBAT and +3V3 sourced by the power block and consumed elsewhere, GND the passive return everywhere. A FIXTURE-ONLY plan field (OD-259 item 6): `PLAN_SYSTEM_PROMPT` and `PLAN_TOOL` are not edited; the scripted `submit_plan` carries the field; the server's `readPlan` accepts the answer and drops the unknown key unread (C4), so every stored plan keeps its digest and the l7 server-slice pins (9 calls, 41 instances) did not move | `app/lib/fixture-runtime/generation-recipes.ts` (`PlanInterfaceSpec`, `PlanBlockSpec`, `PLAN_INTERFACE_DIRECTIONS`, `PLAN_INTERFACE_KINDS`, `PLAN_INTERFACES_PER_BLOCK`, `interfaceDirectionAgrees`, `dronePlan`); `app/lib/fixture-runtime/generation-policy.ts` (`planTurn` emits `interfaces`, copied) | unit: DONE (`j5-fixture-recipes` 1-2; `l7-fixture-vertical-slice` case 6) |
| The blinker and the LED dimmer designs untouched: both recipe digests pinned (blinker `sha256:ce90ae1b…`, dimmer `sha256:edcaea81…`), no `interfaces` anywhere on a single design's path, the blinker's planner turn the empty turn, 3 model calls and `BLINKER_NETLIST` byte-identical through the real routes | `generation-recipes.ts` (no change to the blinker or dimmer recipes); pins in `j5-fixture-recipes` 2 and `l7-fixture-vertical-slice` L.7-10 | unit: DONE; fixture (browser): `prompt-to-gerber.spec.ts` green with 0 `ROUTE_FIXTURE_MISS` (section 3) |
| The organise groups the scripted model proposes, as an import-free data module A's adapter can read: `LED_DIMMER_SHEET_GROUPS` (555 PWM timing [C1 C2 C3 D1 D2 R1 RV1 U1], LED driver [D3 Q1 R2 R3 R4], Power input [J1]; one crossing U1 OUT -> R2, suggested port name PWM_OUT), `droneSheetGroups(motors)` / `DRONE_SHEET_GROUPS` (the generation plan's four blocks with the merge's final reference designators, 1..4 motors), `fixtureSheetOrganizationFor(refs)` (the matching design's groups, rationale and crossings from the parts a schematic read returned, or null), `fixtureSheetOrganizationCandidates()` (every fixture organisation in the order a run WITHOUT a schematic read tries them - dimmer, then drone 4..1 - so the first proposal the tool seals is the design's own), `fixtureSheetOrganizationArgs(organization)` (the tool's closed input `{ groups: [{ name, members }] }`), `ORGANIZE_SHEETS_SENTENCE` | `app/lib/fixture-runtime/sheet-organization-groups.ts` (new; imports nothing) | unit: DONE (`j5-fixture-recipes` 3); adapter consumption: **pending A** (section 4) |
| The l7 server slice extended: the planner call carries each block's interfaces; every declared direction agrees with the result's catalog-derived port direction and every declared rail is a project rail of the result's sheet set; the blinker's path carries no plan and no interfaces | `app/api/generation-tasks/__tests__/l7-fixture-vertical-slice.test.ts` (case 6, `expectDeclaredInterfacesAgree`) | unit: DONE |
| J.9 browser spec: generated sheets end to end (the owner's four-motor sentence -> the review names the overview, four sheets and seven interfaces -> Approve -> the persisted five-sheet document -> the navigator -> Follow PWM1 to the motor stages -> reload -> Prepare PCB with IMU active to awaiting qualification, 41 footprints; zero `/api/schematic/build-multi`, nothing off-origin) | `e2e/j5-generated-sheets.spec.ts` (uuid namespace `35aa0001`) | fixture: steps 1-2 GREEN, blocked at Approve (**B**, section 3); a diagnostic copy that only dispatches the Approve click passed steps 1-9 |
| J.9 browser spec: the organise proposal via chat (the flat LED dimmer -> the sentence -> the sealed card -> nothing applied -> Approve as ONE transaction -> Undo -> a second proposal Discarded -> Redo -> reload -> Prepare PCB 14 footprints; and the committed flat drone -> the sentence -> the card -> Approve -> Undo) | `e2e/j5-organize-proposal.spec.ts` (namespaces `35aa0002`, `35aa0003`; the two cases independent) | fixture: case 2 (the committed flat drone) GREEN; case 1 (the dimmer) blocked at the card (**A**, section 3) |

## 2. Exact validation results (unit; this builder's run, 2026-10-23)

- `npx vitest run --maxWorkers=4 app/lib/fixture-runtime/__tests__`: **5 files, 59 tests passed** (`j5-fixture-recipes` 11/11,
  `l7-scripted-policy` 26/26, `l7-generation-catalog` 5/5, `fixture-runtime` 11/11, `b18-e-fixture-authority` 6/6); re-run after the
  candidate helper with `app/lib/generation-task/__tests__/l7-pump-idle-backoff.test.ts`: **6 files, 71 tests passed**.
- `npx vitest run --maxWorkers=4 app/api/generation-tasks/__tests__/l7-fixture-vertical-slice.test.ts app/api/generation-tasks/__tests__/l4-routes.test.ts app/lib/agent/__tests__/l5-generation-task-tool.test.ts app/api/parts/__tests__/pr-lm-fixture-catalog-routes.test.ts`:
  **4 files, 44 tests passed** (the extended slice 7/7: the four-motor plan call carries the interfaces, the directions agree, usage
  still 9 calls / 41 instances; the dimmer and blinker results carry no `sheets`; the blinker path no plan, 3 calls, `BLINKER_NETLIST`).
- Closure pins: `b24-c1-llm-call-record` 36/36, `b24-c1-durable-trace` 16/16, `b19-d-tool-result-hygiene` 3/3, `b18-c-fixture-agent`
  25/25 passed; `b19-d-kicad-export-fixture-runtime` timed out (5,000 ms, a cold import) in the five-file batch while another builder's
  job ran and passed alone (1/1, 3.2 s). The new data module imports nothing and nothing imports it yet: no closure moved.
- `rm .next/dev/types/validator.ts; npx tsc --noEmit -p tsconfig.json`: first run exit 2 with one error, in B's
  `app/lib/workflow/prompt-to-gerber/__tests__/j5-review-summary-sheets.test.ts:80` (TS2559) and 0 in C's files; **re-run after C's
  last edits and B's fix: exit 0** (the two specs are type-checked: tsconfig includes `**/*.ts`).
- `npx eslint` on C's seven files (`generation-recipes.ts`, `generation-policy.ts`, `sheet-organization-groups.ts`,
  `j5-fixture-recipes.test.ts`, `l7-fixture-vertical-slice.test.ts`, the two specs): exit 0.
- Facts the suites pin: every drone block declares <= 16 interfaces from the closed vocabularies, never `bus`; one source per power
  rail; every declared signal is exactly the set of the generated sheet's ports (`deriveGeneratedSheets` over the fixture merge) and
  never contradicts the catalog-derived direction (the derived set carries passive, bidirectional, input and output ports, so the check
  is not vacuous); the dimmer's groups cover its 14 parts exactly once with U1 OUT -> R2 the ONE non-rail crossing; the drone groups
  equal the plan's block names and the merge's final reference designators for 1..4 motors and plan through J4's
  `planOrganizeIntoSheets` over the flat drone to the J4 hinted proposal's ports with the partition digest and every identity kept, two
  plans byte-equal; `fixtureSheetOrganizationFor` recognises each design by its parts (order and repeats ignored) and nothing else; the
  candidate order meets each fixture design's own organisation first (and none fits the blinker); the organise sentence routes to the
  assistant (`routeComposerMessage` -> `ask`).

## 3. Browser evidence (fixture) and which assertions await which builder

Every run ALONE (no other playwright / next process; port 3157; output outside the repo; no `playwright-report/` left):

1. `SIRKIT_E2E_PORT=3157 npx playwright test e2e/j5-generated-sheets.spec.ts e2e/j5-organize-proposal.spec.ts e2e/l7-drone-vertical-slice.spec.ts e2e/l7-second-circuit.spec.ts e2e/prompt-to-gerber.spec.ts --reporter=list`:
   23.5 min; **3 passed, 3 failed, 1 did not run**. The other builders edited sources during the run (the dev server recompiled
   several times); none of the failures below is a recompile symptom - each is reproduced by the page's own state in its snapshot.
2. `… npx playwright test e2e/j5-organize-proposal.spec.ts` (after the file's two cases were made independent): 2.7 min; **case 2
   PASSED, case 1 failed** at the card.
3. Two DIAGNOSTIC runs of a temporary copy of `j5-generated-sheets.spec.ts` (own uuid namespace, screenshots to the scratchpad,
   deleted after the run - never committed, not evidence) whose ONLY change dispatches the Approve click on the clipped button: the
   first stopped at a canvas click on the MCU sheet's PWM1 label (the generated label sits at U2's pin end inside the symbol's hit
   area; the spec no longer clicks it - Follow lists every signal of the active sheet); the second **passed steps 1-9 in 1.4 min**:
   the persisted five-sheet document (41 instances on the four children, the ports per sheet, 14 sheet pins on the overview, one
   hierarchical label set per port), the navigator (Overview + 4, four blocks), the MCU sheet drawing only its parts, Follow PWM1 to
   the motor stages with the highlight, the reload, Missing parts 0, "Sheet connections" in the design checks, and Prepare PCB with
   IMU active through the binding review to awaiting qualification with 41 footprints, release disabled, no qualify, one start, zero
   `/api/schematic/build-multi`, nothing off-origin. So the clipped dialog is the ONLY blocker of the real spec.

| spec | result | where it stops, and whose |
|---|---|---|
| `e2e/prompt-to-gerber.spec.ts` (the guard) | **PASS**; **0 `ROUTE_FIXTURE_MISS`** in the server log | - (C added no uuid draw on the blinker's generate -> approve -> placement path; the blinker result has no `sheets`, so the page takes the unchanged one-page path) |
| `e2e/l7-second-circuit.spec.ts` (2 cases, the guard) | **PASS** 2/2 | - |
| `e2e/l7-drone-vertical-slice.spec.ts` (the guard) | **FAIL - a J5-B regression** | `schematic-proposal-approve` is "outside of the viewport" for the whole 600 s: the drone's result is now laid out as sheets and the review dialog's added sheet lines make `DialogContent` (app/page.tsx C14, no max height, no scroll) taller than 768 px, so its footer - Approve and Cancel - is clipped below the window and a mouse user cannot reach it. Suggested in-place fix (B): `className="max-h-[90vh] overflow-y-auto"` on that `DialogContent` (the J3 follow dialog's pattern) |
| `e2e/j5-generated-sheets.spec.ts` | **FAIL at step 3 (Approve)** | steps 1-2 GREEN: the 202 start, four blocks saved, the dialog, the server result (`sirkit.generation-sheets.v1`, four designed children, seven bound interfaces, no findings, 9 model calls, 41 parts) and B's summary lines naming "System overview", the four sheets and the seven interfaces; screenshot `j5-generated-review-1366x768.png`. Step 3 stops on the same clipped Approve (**B**). In the run-1 pass the dialog also showed "Drawing check: 12 issue(s) — R1.1 … R3.1 … R5.1 is connected in the netlist but ended up electrically floating" from the sheeted layout's merged validation; the l7 pass of the same run (after B's edit to `lib/build-sheet-layout.ts`) showed none - B to confirm. Steps 4-9 pass in the diagnostic copy (run 3) |
| `e2e/j5-organize-proposal.spec.ts` case 1 (the dimmer) | **FAIL at the card** (runs 1 and 2) | run 1: "sirkit.schematic.inspect is not available to this run; nothing was done." - `sirkit.schematic.inspect` needs the canonical-state resource, which the chat context claims only with a valid PCB board (app/lib/agent/context.ts C16), and a freshly built flat page has no board before Prepare PCB. Run 2: A's tree now proposes directly when the read is unavailable (C15) but with the drone's J4 grouping only, so the tool refused it - "the organisation was refused (proposal_blocked): D4 (group "MOTOR x4 (J2-J5)") is not a catalog part of this schematic. Nothing was changed.. Nothing was changed." (the sentence also doubles its "Nothing was changed."). **A**: take `fixtureSheetOrganizationCandidates()` / `fixtureSheetOrganizationArgs` from C's module (section 4); even then the dimmer's proposal is refused until OPEN ISSUE J5-C-1 (section 5) is fixed (**A**). Screenshot `j5-organize-flat-dimmer-1366x768.png` (the flat dimmer before the turn) |
| `e2e/j5-organize-proposal.spec.ts` case 2 (the committed flat drone) | **PASS** (run 2; did not run in run 1, when the file was serial) | the J.9 :380 / :383 proof for a label-joined page: the sentence -> the sealed card (four groups, the seven crossing interfaces named) with NOTHING applied -> Approve as ONE transaction (Overview + 4, 41 instances on their groups' sheets, every identity and the partition digest kept, the four blocks drawn) -> Undo restores the flat page exactly; no schematic edit request, no start, no build-multi, nothing off-origin. Screenshot `j5-organize-drone-proposal-1366x768.png` |

Which assertion awaits which builder (a failing step there is a J5 defect, not a spec defect):

- **B**: the clipped review dialog - the ONE blocker of the l7-drone guard and of j5-generated (step 3, `schematic-proposal-approve`);
  steps 4-9 already pass behind it (run 3). For the dimmer organise case, once A's proposal arrives: the card's rows
  (`sheet-organization-group` with `data-name` / `data-refs`), the two interface rows (`sheet-organization-interface`, `data-port`),
  Approve as one transaction, Undo, Discard (nothing recorded), Redo, reload, Prepare PCB 14 footprints - the same card and Approve
  already pass for the drone (case 2).
- **A**: the dimmer proposal in the no-board run (C's module, section 4) and the planner following wire chains (J5-C-1, section 5) -
  together the only blockers of organise case 1 at its card step.
- Observations for B (not blocking any assertion; from the run-3 screenshots in the scratchpad): the overview's four blocks are drawn
  right to left (IMU leftmost, the power block rightmost) against the plan order, and small on the page; on the motor-stage sheet the
  per-block layout's labels overlap (M3_DRAIN / M4_DRAIN / VBAT beside D3, D4) - the existing one-page layout's density, per sheet.
- The l7 extension's stored-plan half (`task.plan.blocks[i].interfaces` equal to the recipe's) is NOT asserted: OD-259 item 6 keeps
  the field fixture-only and `readPlan` drops it unread; reading it into the stored plan and the task card is a contract change
  (`GenerationPlanBlock`, the plan digest only-when-present rule) the plan assigns to A's `j5-plan-interfaces` suites.

Screenshots this increment writes (1366 x 768, `screenshots/`, all from the REAL specs): written now - `j5-generated-review-1366x768.png`
(run 1), `j5-organize-flat-dimmer-1366x768.png` and `j5-organize-drone-proposal-1366x768.png` (run 2); written once the blocked steps
pass - `j5-generated-overview-1366x768.png`, `j5-generated-follow-pwm1-1366x768.png`, `j5-generated-pcb-awaiting-qualification-1366x768.png`,
`j5-organize-proposal-1366x768.png`, `j5-organize-applied-1366x768.png` (the diagnostic copy's versions of the first three stay in the
scratchpad, `j5c-diag-shots/`). No committed PNG was rewritten by these runs (the l7 drone spec failed before its screenshot; the
others' bytes are unchanged).

## 4. Coordination with A: the groups the fixture model proposes

A's adapter turn (`fixture-agent-adapter.ts`, the appended block "The organise turn") matches the sentence (`organi[sz]e this
(schematic|sheet|design|circuit) into (subsystem )?sheets`), reads the schematic when `sirkit.schematic.inspect` is available, and
proposes `FIXTURE_DRONE_ORGANIZE_GROUPS` (C8) - J4's DEFAULT proposal for the flat drone ("MOTOR x4 (J2-J5)", "MIC5504-3.3YM5 (U1)",
"ATmega328P-AU (U2)", "LSM6DS3TR-C (U3)"); without the read it proposes that grouping directly. C's module covers both designs and
both runs:

- with a read: `fixtureSheetOrganizationFor(refs)` (the refs the inspection returned) -> the design's organisation, or null (answer in
  words, nothing proposed);
- without a read (no board yet - the browser's case): `fixtureSheetOrganizationCandidates()` in order, one proposal call per candidate,
  stopping at the first the tool seals (the tool refuses a proposal naming a part the schematic does not hold, by name);
- the call's arguments: `fixtureSheetOrganizationArgs(organization)` = `{ groups: [{ name, members }] }`; `interfaceNames` (optional,
  OD-259 item 4) keys the SIG<n> a first proposal reported, so a model would send it only on a second proposal - the dimmer's
  `crossings` entry suggests PWM_OUT for the U1 OUT -> R2 port when the page drew that connection as a wire (as a label pair it carries
  the label's name and needs none).

The lead decides which drone grouping the fixture model proposes (the plan's blocks, C's `DRONE_SHEET_GROUPS`, or J4's default, A's
constant); `e2e/j5-organize-proposal.spec.ts` case 2 accepts either. OD-259 item 4 (unassigned parts stay on the overview) is honoured
by both.

## 5. OPEN ISSUE J5-C-1 - the organise planner does not follow wire chains (found by the dimmer proof; owner of the fix: A)

`planOrganizeIntoSheets` gathers each group's entities with `groupEntities` -> `attachedSelection` (sheet-lens.ts C6), which takes
only the wires whose END touches a moved pin. The page's own layout (`autoLayoutBuildValidated`) routes a two-pin net as SEVERAL wire
segments with bends, so moving the dimmer's timing core takes the first segment of each route and leaves the rest on the overview; the
DISCH net (R1 pin 2, RV1 pin 2, U1 DISCH) then arrives on the new sheet as two pieces with no parent piece and `planMoveToSheet` refuses
`SHEET_MOVE_AMBIGUOUS` ("pieces on <child>, <child>", C7). The J3 and J4 fixtures never exercised this: the drone recipe joins its nets
by LABELS, the dimmer by wires. Consequence: "Organize into sheets" (J4's UI) and the organise proposal tool refuse any wire-drawn Build
page today (unchanged in A's tree at the time of writing, C17).

Proof and target behaviour (both in `j5-fixture-recipes` 3): moving the same groups through the real `planMoveToSheet` with the wire
CHAINS attached (wires joined end to end on the root, to a fixed point, plus the plain labels at those points) plans ONE
schematic.move-to-sheet transaction whose every operation kind is inside the executor's binding, the crossing becomes a port on both
sheets, `validateSheetHierarchy` is empty, `resolveProjectConnectivity` keeps the partition digest, every identity and all 14
published instances survive. The current refusal is pinned with a dated note telling the fixer to delete the pin and route the chain
proof through `planOrganizeIntoSheets`. Suggested fix (A's module): `groupEntities` follows wire chains the way `chainAttached` in the
test does (or sheet-lens gains a chain-following variant beside `attachedSelection`, leaving J3's one-part Move unchanged).

## 6. Bounded limitations (honest list)

- Fixture proof only; no live-model multi-sheet generation (OD-259 item 7; US$0 spent; the live planner prompt is unchanged, so a live
  plan carries no interfaces; a live run waits on the owner's quota and spend approval under the cumulative US$5 allowance).
- The typed interfaces are read by nobody on the server: the stored plan, the task card and `deriveGeneratedSheets` see none; the
  fixture declares them and the tests prove they agree with the catalog-derived set.
- No bus interfaces (`bus` is in the vocabulary only so a declared bus can be refused; no recipe declares one); no J5-6 sheet-scoped
  regeneration (deferred, OD-259 item 1); no barometer organise groups (the barometer block is never designed by the fixture catalog).
- The two J.9 specs are not wholly green yet (section 3): organise case 2 (the drone) passes; j5-generated waits only on B's clipped
  dialog (steps 1-9 pass behind it in a diagnostic copy); organise case 1 waits on A's dimmer proposal and J5-C-1. The guard trio is
  green except the l7 drone guard, which J5-B's sheeted review regressed (the same clipped dialog).

## 7. Proposed ledger row (progress.md is lead-owned) and CI admission notes

| J5 (C) | the fixture half: typed interfaces on the drone plan (fixture-only field), the organise groups data module (with the no-read candidate order), the two J.9 specs | unit DONE (`j5-fixture-recipes` 11/11, fixture-runtime 59/59, l7 slice + l4 + l5 + catalog routes 44/44, closure pins green, eslint 0, tsc 0 in C's files); browser: prompt-to-gerber (0 ROUTE_FIXTURE_MISS), l7-second-circuit and j5-organize case 2 (the drone) green; l7-drone and j5-generated blocked only by the clipped review dialog (B; j5-generated steps 1-9 pass behind it); j5-organize case 1 blocked at the card (A: the dimmer proposal, J5-C-1) | `j5-fixture-recipes`, `l7-fixture-vertical-slice` case 6, `e2e/j5-generated-sheets.spec.ts`, `e2e/j5-organize-proposal.spec.ts`, `multi-sheet/j5-generation.md` |

CI admission (lead): the two new specs join `page-browser-e2e` by default (every `e2e/*.spec.ts` the skip globs leave in) - re-measure
OD-30's headroom (b24-d4-browser-split, b24-d0-ci-split; the five-spec run above took 23.5 min with two 600 s timeouts); the new vitest
suite `app/lib/fixture-runtime/__tests__/j5-fixture-recipes.test.ts` needs an exact positional entry in
`.github/workflows/deterministic-manufacturing.yml` beside `l7-fixture-vertical-slice` (OD-254).

## 8. Citations (re-pointed by content with `scratchpad/c/refresh-citations.py`)

| id | path | line | — | anchor | note |
|---|---|---|---|---|---|
| C1 | `app/lib/fixture-runtime/generation-recipes.ts` | 374 | — | `export function dronePlan(motors: number, barometer: boolean): PlanSpec {` | the drone plan with interfaces |
| C2 | `app/lib/fixture-runtime/generation-recipes.ts` | 71 | — | `export interface PlanInterfaceSpec { net: string; direction: PlanInterfaceDirection; kind: PlanInterfaceKind; domain: string }` | the fixture-only field |
| C3 | `app/lib/fixture-runtime/generation-policy.ts` | 221 | — | `...(block.interfaces ? { interfaces: block.interfaces.map((entry) => ({ ...entry })) } : {})` | planTurn emits it |
| C4 | `app/lib/schematic/build-multi-generation.ts` | 169 | — | `sharedNets: Array.isArray(b.sharedNets) ? (b.sharedNets as unknown[]).filter((net): net is string => typeof net === "string") : [],` | readPlan accepts the answer, drops the unknown key |
| C5 | `app/lib/fixture-runtime/sheet-organization-groups.ts` | 98 | — | `export function fixtureSheetOrganizationFor(refs: readonly string[]): FixtureSheetOrganization \| null {` | the groups reader |
| C6 | `app/lib/schematic/sheet-lens.ts` | 419 | — | `export function attachedSelection(state: SchematicState, selection: SheetSelection, getPart: PartPinsSource): MoveEntityRef[] \| null {` | one-hop attachment (J5-C-1) |
| C7 | `app/lib/schematic/sheet-operations.ts` | 309 | — | `would be split in a way ports cannot carry unambiguously` | the ambiguity refusal |
| C8 | `app/lib/agent/fixture-agent-adapter.ts` | 962 | — | `export const FIXTURE_DRONE_ORGANIZE_GROUPS` | A's hard-coded grouping |
| C9 | `app/lib/engineering/tool-catalog.ts` | 1691 | — | `toolId: "sirkit.schematic.propose-sheet-organization", version: "1.0.0",` | A's descriptor |
| C10 | `app/components/schematic/SheetOrganizationReviewCard.tsx` | 32 | — | `data-testid="sheet-organization-review"` | B's card id |
| C11 | `lib/build-sheet-layout.ts` | 233 | — | `const sheets: SchematicSheet[] = [{ id: ROOT_SHEET_ID, name: rootName, parentId: null }];` | B's root sheet |
| C12 | `app/api/generation-tasks/__tests__/l7-fixture-vertical-slice.test.ts` | 156 | — | `const planCall = calls.find((call) => typeof call.request.toolChoice === "object" && call.request.toolChoice !== null)!;` | the l7 extension |
| C13 | `app/lib/fixture-runtime/sheet-organization-groups.ts` | 110 | — | `export function fixtureSheetOrganizationCandidates(): FixtureSheetOrganization[] {` | the no-read candidate order |
| C14 | `app/page.tsx` | 7169 | — | `<DialogContent data-testid="schematic-proposal-review">` | the review dialog with no max height (B) |
| C15 | `app/lib/agent/fixture-agent-adapter.ts` | 992 | — | `if (!input.tools.some((tool) => tool.toolId === "sirkit.schematic.inspect"))` | A's no-read branch |
| C16 | `app/lib/agent/context.ts` | 347 | — | `No board snapshot was supplied; the canonical project resource and board tools are unavailable for this run.` | canonical-state needs a board |
| C17 | `app/lib/schematic/sheet-organization.ts` | 351 | — | `function groupEntities(state: SchematicState, refs: readonly string[], getPart: PartPinsSource): MoveEntityRef[] \| string {` | the one-hop group gathering (J5-C-1) |
