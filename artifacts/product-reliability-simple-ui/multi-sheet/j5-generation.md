# J5-C — the fixture half of sheet-aware AI (evidence page)

Runbook section J increment 5 (`artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` J.6 lines 315-334, J.9 lines
360-392); decisions OD-255, OD-257, OD-258, OD-259 (`artifacts/remaining-builder-program/OWNER_DECISIONS.md`). Branch
`codex/astra-foundation` at `5993dd68` plus the three builders' working trees. Build plan `scratchpad/j/j5-plan.md`: A (the sealed
organise proposal tool, sheet-aware inspect, open-sheet), B (generated results laid out as sheets, the organise review card), C (this
increment: the typed planner interfaces as a fixture-only plan field, the organise groups the scripted model proposes, the two J.9
browser specs, the guard replays, this page).

Status legend: **fixture** = proven against the fixture runtime (committed catalog, scripted provider and agent, no router recording,
US$0); **live** = proven against the authorized live model (none for J5: OD-259 item 7); **unit** = a vitest suite; **pending** = awaits
another builder's increment (named). Nothing below is claimed beyond its label.

## 1. What was built (C)

| piece | files | state |
|---|---|---|
| Typed interfaces on the drone plan's blocks - `{ net, direction input/output/bidirectional/passive, kind signal/power/ground, domain battery/logic/return }`, exactly one per shared net in the shared nets' order; PWMn output at the MCU / input at the motor stages, I2C_SDA / I2C_SCL bidirectional on every I2C block, IMU_INT1 output at the IMU / input at the MCU, VBAT and +3V3 sourced by the power block and consumed elsewhere, GND the passive return everywhere. A FIXTURE-ONLY plan field (OD-259 item 6): `PLAN_SYSTEM_PROMPT` and `PLAN_TOOL` are not edited; the scripted `submit_plan` carries the field; the server's `readPlan` drops it unread until A's reader lands, so every stored plan keeps its digest and the l7 server-slice pins (9 calls, 41 instances) did not move | `app/lib/fixture-runtime/generation-recipes.ts` (`PlanInterfaceSpec`, `PlanBlockSpec`, `PLAN_INTERFACE_DIRECTIONS`, `PLAN_INTERFACE_KINDS`, `PLAN_INTERFACES_PER_BLOCK`, `interfaceDirectionAgrees`, `dronePlan`); `app/lib/fixture-runtime/generation-policy.ts` (`planTurn` emits `interfaces`) | unit: DONE (`j5-fixture-recipes` 1-2; `l7-fixture-vertical-slice` case 6) |
| The blinker and the LED dimmer designs untouched: both recipe digests pinned (blinker `sha256:ce90ae1b…`, dimmer `sha256:edcaea81…`), no `interfaces` anywhere on a single design's path, the blinker's planner turn the empty turn, 3 model calls and `BLINKER_NETLIST` byte-identical through the real routes | `generation-recipes.ts` (no change to `BLINKER` / `LED_DIMMER`); pins in `j5-fixture-recipes` and `l7-fixture-vertical-slice` | unit: DONE |
| The organise groups the scripted model proposes, as an import-free data module A's adapter can read: `LED_DIMMER_SHEET_GROUPS` (555 PWM timing [C1 C2 C3 D1 D2 R1 RV1 U1], LED driver [D3 Q1 R2 R3 R4], Power input [J1]; one crossing U1 OUT -> R2, suggested port name PWM_OUT), `droneSheetGroups(motors)` / `DRONE_SHEET_GROUPS` (the generation plan's four blocks with the merge's final reference designators, 1..4 motors), `fixtureSheetOrganizationFor(refs)` (the matching design's groups, rationale and crossings from the parts an inspection returned, or null), `ORGANIZE_SHEETS_SENTENCE` | `app/lib/fixture-runtime/sheet-organization-groups.ts` (new; imports nothing) | unit: DONE (`j5-fixture-recipes` 3); adapter consumption: pending (A - see section 4) |
| The l7 server slice extended: the planner call carries each block's interfaces; every declared direction agrees with the result's catalog-derived port direction and every declared rail is a project rail of the result's sheet set; the blinker's path carries no plan and no interfaces | `app/api/generation-tasks/__tests__/l7-fixture-vertical-slice.test.ts` (case 6, `expectDeclaredInterfacesAgree`) | unit: DONE |
| J.9 browser spec: generated sheets end to end (the owner's four-motor sentence -> the review names the overview, four sheets and seven interfaces -> Approve -> the navigator -> Follow PWM1 -> reload -> Prepare PCB with IMU active to awaiting qualification, 41 footprints) | `e2e/j5-generated-sheets.spec.ts` (uuid namespace `35aa0001`) | written; run: see section 3 |
| J.9 browser spec: the organise proposal via chat (the flat LED dimmer -> the sentence -> the sealed card -> nothing applied -> Approve as ONE transaction -> Undo -> a second proposal Discarded -> Redo -> reload -> Prepare PCB 14 footprints; and the committed flat drone -> the sentence -> the card -> Approve -> Undo) | `e2e/j5-organize-proposal.spec.ts` (namespaces `35aa0002`, `35aa0003`) | written; run: see section 3 |

## 2. Exact validation results (unit; C's working tree on `5993dd68` + A's and B's uncommitted files, 2026-10-23)

- `npx vitest run --maxWorkers=4 app/lib/fixture-runtime/__tests__ app/lib/schematic/__tests__/j5-generated-sheets.test.ts app/lib/schematic/__tests__/j4-organize-sheets.test.ts`: **7 files, 83 tests passed** (`j5-fixture-recipes` 11/11, `l7-scripted-policy` 26/26, `l7-generation-catalog` 5/5, `fixture-runtime` 11/11, `b18-e-fixture-authority` 6/6, `j5-generated-sheets` 11/11, `j4-organize-sheets` 13/13).
- `npx vitest run --maxWorkers=4 app/api/generation-tasks/__tests__/l7-fixture-vertical-slice.test.ts app/api/generation-tasks/__tests__/l4-routes.test.ts app/lib/agent/__tests__/l5-generation-task-tool.test.ts`: **3 files, 39 tests passed** (the extended slice 7/7: the four-motor plan call carries the interfaces, directions agree, usage still 9 calls / 41 instances; the dimmer and blinker results still carry no `sheets`; the blinker path no plan).
- Closure pins: `b24-c1-llm-call-record`, `b24-c1-durable-trace`, `b19-d-tool-result-hygiene`, `b19-d-kicad-export-fixture-runtime`, `b18-c-fixture-agent`: **5 files, 81 tests passed** (the new module imports nothing and nothing imports it yet: no closure moved).
- Re-run of `j5-fixture-recipes` + `j4-organize-sheets` after A's planner edits (`sheet-organization.ts`, `sheet-operations.ts` gained `interfaceNames`): 24/24 passed; the OPEN ISSUE pin of section 5 still holds (A's edits do not follow wire chains).
- `rm .next/dev/types/validator.ts; npx tsc --noEmit -p tsconfig.json`: exit 1 with **23 errors, all in `app/page.tsx`** (B's in-progress organise receiver: the `import { GENERATION_START_TOOL_ID, STOP_ANSWER_SEMANTICS }` statement on line 108 and the `const [pendingOrganization, …] = useState(…)` / `organizationApplyBusy` declarations on line 2700 were appended after a `//` comment on their line, so TypeScript reads them as comment text and reports `Cannot find name` at every use) and **0 errors in any other file** (my two specs are type-checked: tsconfig includes `**/*.ts`). Reported to the lead as B's residue; not touched by C.
- `npx eslint` on the seven touched files (`generation-recipes.ts`, `generation-policy.ts`, `sheet-organization-groups.ts`, `j5-fixture-recipes.test.ts`, `l7-fixture-vertical-slice.test.ts`, the two specs): exit 0.
- Facts the suites pin: every drone block declares <= 16 interfaces from the closed vocabularies, never `bus`; one source per power rail; every declared signal is exactly the set of the generated sheet's ports (`deriveGeneratedSheets` over the fixture merge) and never contradicts the catalog-derived direction (the derived set carries passive, bidirectional, input and output ports, so the check is not vacuous); the dimmer's groups cover its 14 parts exactly once with U1 OUT -> R2 the ONE non-rail crossing; the drone groups equal the plan's block names and the merge's final reference designators for 1..4 motors and plan through J4's `planOrganizeIntoSheets` over the flat drone to the J4 hinted proposal's ports (PWM1-4; the MCU's seven; the IMU's three; none for Power) with the partition digest and every identity kept, two plans byte-equal; `fixtureSheetOrganizationFor` recognises each design by its parts (order and repeats ignored) and nothing else; the organise sentence routes to the assistant (`routeComposerMessage` -> `ask`).

## 3. Browser evidence (fixture) and which assertions await which builder

Specs written against the agreed ids: the J3 navigator's (`sheets-chip`, `sheets-tree`, `sheets-tree-item-<id>`, `sheet-block-<id>`,
`sheets-breadcrumb`, `sheets-follow`, `sheets-follow-destination-<n>`), the existing review dialog's (`schematic-proposal-review`,
`-summary`, `-approve`) and B's organise card (`sheet-organization-review`, `-group` rows with `data-name` / `data-refs`, `-interface`
rows with `data-port`, `-approve`, `-discard` - read from B's `SheetOrganizationReviewCard.tsx` in the tree).

Run status at the time of writing: **not run to a verdict**. The guard trio and the two new specs need a dev server whose page
compiles; B's `app/page.tsx` in the working tree does not (section 2), so a browser run now would fail at hydration for every spec for a
reason unrelated to the specs. The commands, to be run ALONE (no other playwright / next process; a free port; output in the scratchpad;
no `playwright-report/` left in the repo):

```
SIRKIT_E2E_PORT=3157 npx playwright test e2e/prompt-to-gerber.spec.ts e2e/l7-drone-vertical-slice.spec.ts e2e/l7-second-circuit.spec.ts --reporter=list
SIRKIT_E2E_PORT=3157 npx playwright test e2e/j5-generated-sheets.spec.ts e2e/j5-organize-proposal.spec.ts --reporter=list
```

The guard replay's verdict is "no `ROUTE_FIXTURE_MISS` in the server log": C added no uuid draw on the blinker's generate -> approve ->
placement path (the recipe and policy changes touch only the drone's plan; the l7 slice pins the blinker's 3 calls and byte-identical
netlist), so the router replay key cannot have moved. The committed PNGs the l7 specs rewrite (`persistent-generation/screenshots/`) must
be restored from HEAD after the run (`git show HEAD:<path> > <path>`); the `j5-*.png` files under `screenshots/` are this increment's own evidence.

Which assertion awaits which builder (a failing step there is a J5 defect, not a spec defect):

- `j5-generated-sheets.spec.ts` step 2 (`schematic-proposal-summary` names "System overview", the four sheets and the seven interfaces):
  awaits B's `describeSchematicProposal` sheet lines (in the tree: `review-summary.ts` `describeSheets`, root name from the layout's
  "System overview"); step 4 (the persisted document has five sheets, every instance on a child, each child's ports the result's
  interfaces, 14 sheet pins, one hierarchical label per port): awaits B's `lib/build-sheet-layout.ts` + the page intake and the
  sheet-aware apply; steps 5-8 reuse J3's navigator, follow, reload and PCB sync and need only step 4.
- `j5-organize-proposal.spec.ts` case 1 (the dimmer): the card awaits A's adapter answering the DIMMER through
  `fixtureSheetOrganizationFor` (today it proposes only the fixture drone's default grouping, section 4) AND the planner following
  wire chains (section 5); Approve / Undo / Discard / Redo / reload / PCB need B's card and page case. Case 2 (the committed flat drone,
  label-joined): awaits A's tool + event and B's card only; it accepts either grouping (the plan's blocks or J4's default proposal).
- The l7 extension's stored-plan half (`task.plan.blocks[i].interfaces` equal to the recipe's) is NOT asserted: it awaits A's `readPlan`
  (`build-multi-generation.ts`) and belongs to A's `j5-plan-interfaces` suites; only the provider's call is pinned here.

Screenshots this increment writes when the specs run (1366 x 768, `screenshots/`): `j5-generated-review-1366x768.png` (taken before the
summary assertions, so it exists even while B's lines are pending), `j5-generated-overview-1366x768.png`, `j5-generated-follow-pwm1-1366x768.png`,
`j5-generated-pcb-awaiting-qualification-1366x768.png`, `j5-organize-flat-dimmer-1366x768.png` (before the chat turn),
`j5-organize-proposal-1366x768.png`, `j5-organize-applied-1366x768.png`, `j5-organize-drone-proposal-1366x768.png`.

## 4. Coordination with A: the groups the fixture model proposes

A's adapter turn (`fixture-agent-adapter.ts`, appended block "The organise turn") matches the sentence (`organi[sz]e this
(schematic|sheet|design|circuit) into (subsystem )?sheets`), inspects, and proposes `FIXTURE_DRONE_ORGANIZE_GROUPS` - J4's DEFAULT
proposal for the flat drone ("MOTOR x4 (J2-J5)", "MIC5504-3.3YM5 (U1)", "ATmega328P-AU (U2)", "LSM6DS3TR-C (U3)") - and answers any other
schematic in words. C's module offers instead `fixtureSheetOrganizationFor(refs)`: the LED dimmer's three groups (the task's scripted
turn for the dimmer) and the drone's four groups named after the generation plan's blocks, for 1..4 motors, plus the crossing(s) and a
rationale. The mapping to A's tool input is direct: `groups: organization.groups.map(g => ({ name: g.name, members: [...g.refs] }))`;
`interfaceNames` (optional): for each `crossing` of `organization.crossings`, the port the planner minted for the net joining
`crossing.between` (SIG<n> for an unnamed wire, the label's name for a label-pair route) -> `crossing.name`. The lead decides which grouping
the fixture model proposes for the drone; the dimmer needs C's module (A's constant cannot describe it). The owner's decision OD-259
item 4 (unassigned parts stay on the overview) is honoured by both.

## 5. OPEN ISSUE J5-C-1 - the organise planner does not follow wire chains (found by the dimmer proof)

`planOrganizeIntoSheets` gathers each group's entities with `attachedSelection` (sheet-lens.ts), which takes only the wires whose END
touches a moved pin. The page's own layout (`autoLayoutBuildValidated`) routes a two-pin net as SEVERAL wire segments with bends, so
moving the dimmer's timing core takes the first segment of each route and leaves the rest on the overview; the DISCH net
(R1 pin 2, RV1 pin 2, U1 DISCH) then arrives on the new sheet as two pieces with no parent piece and `planMoveToSheet` refuses
`SHEET_MOVE_AMBIGUOUS` ("pieces on <child>, <child>"). The J3 and J4 fixtures never exercised this: the drone recipe joins its nets by
LABELS, the LED dimmer by wires. Consequence: "Organize into sheets" (J4's UI) and the organise proposal tool refuse any wire-drawn Build
page today.

Proof and target behaviour (both in `j5-fixture-recipes` 3): moving the same groups through the real `planMoveToSheet` with the wire
CHAINS attached (wires joined end to end on the root, to a fixed point, plus the plain labels at those points) plans ONE
schematic.move-to-sheet transaction whose every operation kind is inside the executor's binding, the crossing becomes a port on both
sheets (named after the layout's label pair `NET_xxxx`, or `SIG1` for a bare wire), `validateSheetHierarchy` is empty,
`resolveProjectConnectivity` keeps the partition digest, every identity and all 14 published instances survive. The current refusal is
pinned with a dated note telling the fixer to delete the pin and route the chain proof through `planOrganizeIntoSheets`. Suggested fix
(A's module or sheet-lens): `attachedSelection` / `groupEntities` follow wire chains the way `chainAttached` in the test does.

## 6. Bounded limitations (honest list)

- Fixture proof only; no live-model multi-sheet generation (OD-259 item 7; US$0 spent; the live planner prompt is unchanged, so a live
  plan carries no interfaces).
- The typed interfaces are read by nobody on the server until A's `readPlan` lands: the stored plan, the task card and
  `deriveGeneratedSheets` see no interfaces yet; the fixture declares them and the test proves they agree with the catalog-derived set.
- No bus interfaces (`bus` is in the vocabulary only so a declared bus can be refused; no recipe declares one); no J5-6 sheet-scoped
  regeneration; no barometer organise groups (the barometer block is never designed by the fixture catalog).
- The browser specs were not run to a verdict in this builder's window (section 3); the guard replay's argument is static.

## 7. Proposed ledger row (progress.md is lead-owned) and CI admission notes

| J5 (C) | the fixture half: typed interfaces on the drone plan (fixture-only field), the organise groups data module, the two J.9 specs | unit DONE (`j5-fixture-recipes` 11/11, l7 slice extended 7/7, closure pins 81/81, eslint 0, tsc 0 outside B's page.tsx); specs written, run pending B's page; OPEN ISSUE J5-C-1 (planner wire chains) pinned with its target proof | `j5-fixture-recipes`, `l7-fixture-vertical-slice` case 6, `e2e/j5-generated-sheets.spec.ts`, `e2e/j5-organize-proposal.spec.ts`, `multi-sheet/j5-generation.md` |

CI admission (lead): the two new specs join `page-browser-e2e` by default (every `e2e/*.spec.ts` the skip globs leave in) - re-measure
OD-30's headroom (b24-d4-browser-split, b24-d0-ci-split); the new vitest suite `app/lib/fixture-runtime/__tests__/j5-fixture-recipes.test.ts`
needs an exact positional entry in `.github/workflows/deterministic-manufacturing.yml` beside `l7-fixture-vertical-slice` (OD-254).

## 8. Citations (re-pointed by content with `scratchpad/c/refresh-citations.py`)

| id | path | line | — | anchor | note |
|---|---|---|---|---|---|
| C1 | `app/lib/fixture-runtime/generation-recipes.ts` | 374 | — | `export function dronePlan(motors: number, barometer: boolean): PlanSpec {` | the drone plan with interfaces |
| C2 | `app/lib/fixture-runtime/generation-recipes.ts` | 71 | — | `export interface PlanInterfaceSpec { net: string; direction: PlanInterfaceDirection; kind: PlanInterfaceKind; domain: string }` | the fixture-only field |
| C3 | `app/lib/fixture-runtime/generation-policy.ts` | 221 | — | `...(block.interfaces ? { interfaces: block.interfaces.map((entry) => ({ ...entry })) } : {})` | planTurn emits it |
| C4 | `app/lib/schematic/build-multi-generation.ts` | 169 | — | `sharedNets: Array.isArray(b.sharedNets) ? (b.sharedNets as unknown[]).filter((net): net is string => typeof net === "string") : [],` | readPlan drops unknown keys (A) |
| C5 | `app/lib/fixture-runtime/sheet-organization-groups.ts` | 96 | — | `export function fixtureSheetOrganizationFor(refs: readonly string[]): FixtureSheetOrganization \| null {` | the groups reader |
| C6 | `app/lib/schematic/sheet-lens.ts` | 419 | — | `export function attachedSelection(state: SchematicState, selection: SheetSelection, getPart: PartPinsSource): MoveEntityRef[] \| null {` | one-hop attachment (J5-C-1) |
| C7 | `app/lib/schematic/sheet-operations.ts` | 309 | — | `would be split in a way ports cannot carry unambiguously` | the ambiguity refusal |
| C8 | `app/lib/agent/fixture-agent-adapter.ts` | 960 | — | `export const FIXTURE_DRONE_ORGANIZE_GROUPS` | A's hard-coded grouping |
| C9 | `app/lib/engineering/tool-catalog.ts` | 1692 | — | `toolId: "sirkit.schematic.propose-sheet-organization", version: "1.0.0",` | A's descriptor |
| C10 | `app/components/schematic/SheetOrganizationReviewCard.tsx` | 32 | — | `data-testid="sheet-organization-review"` | B's card id |
| C11 | `lib/build-sheet-layout.ts` | 227 | — | `const sheets: SchematicSheet[] = [{ id: ROOT_SHEET_ID, name: rootName, parentId: null }];` | B's root sheet |
| C12 | `app/api/generation-tasks/__tests__/l7-fixture-vertical-slice.test.ts` | 156 | — | `const planCall = calls.find((call) => typeof call.request.toolChoice === "object" && call.request.toolChoice !== null)!;` | the l7 extension |
