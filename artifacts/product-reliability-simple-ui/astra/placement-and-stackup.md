# Astra increment D — validated placement, stackup and via-policy candidates (PR-F fE, 2026-10-17)

Directive sections 8 and 9 (`C:\Users\robsa\.codex\attachments\0614d515-77bf-41db-9a60-24b3ff4dcd28\Pasted text.txt`), CONTINUATION E–F.
Everything below is CONFIRMED offline against fixture boards (vitest); nothing was run against a live provider, a distributor, a
database or a routing engine. No model approves, applies, binds or releases anything here: both commands seal data a human reviews.

## 1. What was added

| piece | where | what |
|---|---|---|
| the structured placement intent | `app/lib/pcb/placement/intent.ts` (pure), carried by `sirkit.placement.propose` 1.1.0 → 1.2.0 (`app/lib/engineering/tool-catalog.ts`), accepted by `app/lib/agent/layout-proposals.ts` (`intent` joins the strict keys) | `sirkit.placement-intent.v1`: regions, groups, explicit placements, pin-specific proximity, separations, routing corridors, critical nets; compiled all-or-nothing against exact identities of the board revision; seeded into the EXISTING engine; the candidate carries a CONFLICT list |
| the engine seed | `app/lib/pcb/placement/types.ts` (`EngineeringPlacementOptions.intentSeed`, `PlacementIntentSeed`, initializer `intent_seed`), `app/lib/pcb/placement/engine.ts` | one extra candidate starts from the intent's transforms (movable instances only); the SAME orientation refinement (pinned orientations kept), exact legalization (`resolveCollisions`), hard anchors, hard validator and objectives run unchanged; a hard-legal seeded candidate is preferred, otherwise the engine's own order decides |
| the candidate's intent block | `app/lib/pcb/candidates/layout-candidate.ts` (`PlacementLayoutCandidate.intent?`, `PlacementRunRequest.intentSeed?`, `runPlacementCandidate({ intent })`) | present only for a producer that carried an intent (the editor's own candidates are byte-identical); inside the sealed digest |
| the stackup / via-policy candidate | `app/lib/pcb/candidates/stackup-candidate.ts` (pure `compileStackupCandidate`), `app/lib/agent/stackup-proposals.ts` (`StackupProposalService`), `sirkit.stackup.propose` 1.0.0 | `sirkit.stackup-candidate.v1`: a sealed, revision-bound RECOMMENDATION among the tree's stackup profiles, manufacturing presets and via padstacks; unsupported requests refused as data |
| the runtime | `app/lib/agent/contracts.ts` (outcome kind `stackup-candidate`, event `stackup_candidate_ready`), `app/lib/agent/gateway.ts` (dispatch before the layout branch; a blocked intent → `proposal-blocked`), `app/lib/agent/loop.ts` (toolset gate: a verified board; the result branch), `app/lib/agent/layout-report.ts` (`PlacementReport.intent`, `PLACEMENT_INTENT_NOTE`, the chat line names the conflicts) | the loop's proposal single-flight bounds both; the trace keeps identity and digest only |
| the registries | `agent-exposure.ts` (+1, reviewed), `mcp-exposure-review.ts` (withheld: a proposal, OD-82), `tool-manual.ts` (family `stackup-proposal`, code sources `INTENT_BLOCKERS`, `STACKUP_CODES`, `STACKUP_BLOCKERS`, cited literals, unit declarations, curated examples), `evaluation-cases.ts` (the stackup proposal is discovered wherever the layout candidates are) | registry 56 descriptors / 44 agent-exposed / 9 MCP-exposed / 15 withheld (56 and 44 include PR-F fD's concurrent module contract proposal) |
| tests | `app/lib/agent/__tests__/pr-f-placement-intent.test.ts` (10 cases), `app/lib/agent/__tests__/pr-f-stackup-candidate.test.ts` (11 cases) | fixture boards only |

## 2. The intent schema, units and frame — exact

Input block `intent` of `sirkit.placement.propose` (the registry's schema is the wire contract; `placementIntentInputSchema()` in `tool-catalog.ts`):

```
intent: {
  schema: "sirkit.placement-intent.v1",        // required literal
  units:  "mm",                                 // required literal — every length and coordinate is millimetres
  frame:  "board-world",                        // required literal — the frame below
  regions?:     [{ id, name?, polygonMm: [{x,y}×3..32], side?: top|bottom|both }],
  groups?:      [{ id, name?, members: [component…], regionId? }],
  placements?:  [{ component, xMm, yMm, rotationDeg?: 0|90|180|270, side?: top|bottom }],
  proximity?:   [{ component, pad?, near: component, nearPad?, maxDistanceMm > 0, reason? }],
  separations?: [{ component, from: component, minDistanceMm > 0, reason? }],
  corridors?:   [{ id, name?, polygonMm, side?, nets?: [net…] }],
  criticalNets?:[{ net, priority: 1|2|3, reason? }],
}
component = { ref: "R1", instanceId: "fp-r1" }   // BOTH must name the SAME footprint of the board revision
net       = { name: "GND", id: 1 }               // BOTH must name the SAME board net
```

Bounds (`intent.ts`): at most 64 items per list; polygons 3–32 corners with a non-zero area; |coordinate| and distances ≤ 10 000 mm;
texts ≤ 200 characters; ids `^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$`; a pad must exist on its component (NPTH pads excluded).

The frame, read from the model's own authorities and stated verbatim in every candidate (`PLACEMENT_INTENT_FRAME_STATEMENT`):

> board-world frame: the board's integer-nanometre world frame (`app/lib/pcb/units.ts`: +x right, +y DOWN, the KiCad file convention),
> written here in millimetres (up to 6 decimals; 1 nm resolution); the origin is the world origin (0, 0) — a rectangular outline's own
> `origin` (`board.outline.origin`, usually (0, 0)) is NOT subtracted; a component's position is its footprint origin
> (`FootprintInstance.at`); rotation is in whole degrees, positive COUNTER-CLOCKWISE as seen on screen (`app/lib/pcb/geometry.ts`:
> (1, 0) rotated +90 lands at (0, −1), screen up), restricted to 0 | 90 | 180 | 270; side bottom mirrors the footprint across x
> (x → −x) before the rotation (`transformPoint`).

Quoted sources: `app/lib/pcb/units.ts` ("INTEGER NANOMETERS (`Nm`), +x right, +y DOWN (the KiCad file convention)"),
`app/lib/pcb/geometry.ts` ("positive `rotationDeg` rotates counter-clockwise as seen on screen … (1, 0) rotated +90° lands at (0, −1)";
`transformPoint`: mirror x → −x if bottom, rotate, translate), `app/lib/pcb/types.ts` (`FootprintInstance.at`, `rotationDeg`, `side`;
`BoardOutline.origin`). The compiled intent is integer nanometres (`mmToNm`); conflicts are printed back in millimetres (3 decimals).

Identity binding (`compilePlacementIntent`) is ALL-OR-NOTHING: an unknown instance id (`unknown-component`), a ref that names another
instance (`identity-mismatch`), a net whose id or name is not the board's (`unknown-net`), an unknown pad (`unknown-pad`), a region id
not in the intent (`unknown-region`), a duplicate id or a component placed twice (`duplicate-id`), a malformed polygon
(`polygon-malformed`), an out-of-range number (`value-out-of-range`), a wrong literal (`units-unsupported`, `frame-unsupported`,
`intent-malformed`), an empty intent (`empty-intent`), too many items (`too-many-items`) each refuse the WHOLE proposal as
`proposal-blocked` data (the gateway maps the service's `blocked` outcome; the loop tells the model `ok: false, status: proposal_blocked,
blockers`). Nothing is sealed and the board revision is unchanged (tested).

## 3. The conflict contract

The engine seed is derived from the compiled intent: explicit coordinates (and the pinned rotation / side) for the named components; a
grouped member without a coordinate starts at its region's centroid; a proximity item without a coordinate starts beside its reference.
The seeded candidate (`initializer: "intent_seed"`) passes the SAME orientation refinement (pinned orientations kept), exact
legalization (`resolveCollisions`: grid snap, outline clip, collision nudge / spiral, locked instances as immovable obstacles), hard
anchors (edge connectors, allowed regions), the hard validator (`validatePlacementCandidate`: protected instances unmoved, allowed
rotations / sides, region containment / exclusion, outline, overlaps, pads in board, hard distance rules) and the objectives. It is
preferred when hard-legal; otherwise the engine selects its best legal candidate and the intent block says so.

`PlacementLayoutCandidate.intent` (`PlacementIntentOutcome`) carries: the schema / units / frame statement; `scope` (count, limit,
classification, counting rule); `applied`; `bindings` (the exact components and nets bound); `seededInstanceIds` (what the ENGINE
seeded: movable instances only); `selectedInitializer`; `seededCandidate` (legal? selected? its hard violation codes); `satisfied`;
`criticalNets` (each with `enforcement: "not-enforced-by-placement"`); and `conflicts`, each `{ kind, component | null, intent, happened }`:

| kind | when | what is preserved |
|---|---|---|
| `locked` | the intent names a fixed instance (locked, mechanical, fixed-position, protected copper, outside the selected scope) | the instance's source transform; the engine never moved it; `fixedReasons` named |
| `keepout` | the requested envelope overlaps a fixed instance, enters a constraint-program forbidden region of that instance, or enters the intent's own corridor | the obstacle / region; legalization moved the part and "it ended at (x, y)" is stated |
| `outside-board` | the requested envelope would leave the exact outline | the board is never resized; the clipped position is stated |
| `legalized` | the final position differs from the request by more than half the grid (0.05 mm) with no more specific cause | the displacement in mm and the final position |
| `orientation` | the requested rotation / side is outside the instance's allowed set, or was not kept | the allowed set; the final orientation |
| `region` | a group member's envelope is not fully inside its region (or on its side) | the final position |
| `proximity` / `separation` | the measured pad-to-pad (or origin) distance exceeds `maxDistanceMm`, or the envelope gap is under `minDistanceMm` | the measured value |
| `corridor` | any instance's envelope (not only the intent's) enters a corridor; bounded to 16 per corridor, the rest counted | the final position |
| `candidate-replaced` | the seeded candidate was not hard-legal (or not selected) and another candidate stands | the seeded candidate's violation codes; the items above are checked against the SELECTED candidate |
| `not-applied` | the scope is unsupported (section 5) | the intent is recorded, nothing seeded |

The existing routing is never erased by this path (the movement mode is the one options builder's: `preserve_routed` on a routed board
fixes instances with generated copper; protected copper fixes its instances), approved copper is preserved (`PROTECTED_INSTANCE_MOVED`
is a hard violation), and apply stays `applyLayoutCandidate` behind the editor's review controls (exact base revision, generation,
digest; the intent block is inside the digest, so a tampered block is `UNKNOWN_CANDIDATE`).

What reaches the model (`layout-report.ts`): `placementReport(candidate).intent` — counts, kinds, the first 12 conflicts in full —
and `PLACEMENT_INTENT_NOTE` ("every conflict listed is a request the engine, a lock, a keepout or a clearance changed … never claim the
intent was honoured where one is listed; critical-net priorities are data only; unsupported-scope means recorded, not applied").
The page's chat line (`layoutCandidateChatLine`) names the conflict count and kinds, or the unsupported scope.

## 4. The stackup / via-policy candidate — the qualified profiles

`sirkit.stackup.propose` → `compileStackupCandidate` (pure, over the verified board) → `sirkit.stackup-candidate.v1`, sealed (content
digest; `stackupCandidateIntact`), revision-bound (`base.revision = pcbRevisionId(board)`), 30 min TTL.

Qualified, exactly the tree's:
- layer count and roles: `STACKUP_PROFILES` (`app/lib/pcb/stackup.ts`): `simple-2` (2 signal), `signal-plane-4` (signal / plane / plane
  / signal — 4 physical, 2 routable signal), `all-signal-4` and `dense-4` (4 signal, `dense-4` at 1.2 mm with fanout); physical layer
  count and ROUTABLE signal-layer count are stated apart (`routableCopperLayers`: enabled, autoroute-enabled, not a plane);
- manufacturing profiles: the DRC presets `jlcpcb-2l`, `jlcpcb-4l`, `pcbway-standard` (2 copper), `oshpark-4l` with their fab bundles
  (`app/lib/pcb/fab/presets`); the profile's copper count must equal the preset's (`profile-layer-mismatch` otherwise — the export
  preflight's own `MANUFACTURING_STACKUP_MISMATCH` rule); RELEASE qualification is stated per preset from `QUALIFIED_RULE_PROFILE_IDS`
  (`app/lib/pcb/fab/rule-profile.ts`: `jlcpcb-2l` only; every other preset is `releaseQualified: false` with the
  `RULE_PROFILE_NOT_QUALIFIED` reason quoted — DRC and the export preflight run, the manufacturing release does not);
- reference planes: only on a layer whose role is `plane` in the chosen profile, with an exact board net (`{ name, id }` both matching);
- via policy: through vias only (`Padstack.kind: "via"`, the model's only via); the board's padstacks and the seeded class defaults
  `via-default` 0.6/0.3, `via-power` 0.8/0.4, `via-highcurrent` 1.2/0.6 (`app/lib/pcb/padstack/defaults.ts`), each checked against the
  preset's `minViaOuterNm` / `minViaDrillNm` / `minAnnularRingNm` and marked `meetsManufacturingMinimum` with a note — never dropped,
  never silently accepted.

Invalidation (`candidate.invalidation`): `changesLayerCount`, `changesProfile`, `changesManufacturingPreset`,
`dependentApprovalsInvalidated` (any of the three), with the EXISTING rules cited (`STACKUP_INVALIDATION_RULES`):
`app/lib/pcb/revision.ts` (`pcbRevisionPayload` covers `stackup` and `stackupConfig` — a new canonical revision),
`app/lib/pcb/candidates/layout-candidate.ts` (`verifyLayoutCandidate` → `STALE_REVISION`), `app/lib/pcb/placement/transaction.ts`
(`STALE_BOARD`, `STALE_PROGRAM`), `app/lib/pcb/readiness/preflight.ts` (`MANUFACTURING_STACKUP_MISMATCH`),
`app/lib/pcb/fab/release-gate.ts` (`MFG_RULE_PROFILE_CONSTRUCTION_MISMATCH`; RC03 must carry the current `boardRevision` /
`boardDigest`), `app/lib/pcb/fab/rule-profile.ts` (`QUALIFIED_RULE_PROFILE_IDS`), `app/lib/pcb/zones/plane.ts`
(`reconcileStackupPlaneZones` in the same transaction). `notValidated` says what did NOT run (no DRC, no routing, no impedance, no
manufacturer quote). The human path is the PCB editor's Stackup selector (`PcbEditor.tsx` `onStackupChange` → `commitPcbCandidate`
`pcb.board-geometry`: `stackup`, `stackupConfig = stackupProfile(...)`, `reconcileStackupPlaneZones`, one undo entry); the tool applies
nothing.

## 5. The scope gate

`classifyPlacementScope(board)` (`intent.ts`): `countPhysicalInstances` = distinct `syncIdentity.componentInstanceId ?? footprint.id` over
`board.footprints` — every footprint instance is one physical package, connectors and repeated parts included, mechanical-only
footprints included; a multi-unit symbol is already ONE footprint after Schematic to PCB (the board model has no symbol-unit concept;
two footprints sharing one `componentInstanceId` count once — tested). Over `PLACEMENT_SCOPE_LIMIT` 50 the classification is
`unsupported-scope`: the placement intent is bound (identity refusals still apply) and recorded with `applied: false` and one
`not-applied` conflict, NOT seeded — the B17-F engine run stands on its own; the stackup candidate carries the same `scope` block.
Never a silent refusal, never a fabricated success; a low count never implies low electrical complexity (the counting rule says so).

## 6. What is unsupported (refused as data, exact reason)

`UNSUPPORTED_CHAIN_REASON = "unsupported until the complete chain is proven"` (representation, rules, routing, import/export,
verification, manufacturer support, cost/approval policy). Refused as `proposal-blocked` with that reason verbatim in the detail:
blind, buried, micro, via-in-pad and stacked vias (`blindVias`, `buriedVias`, `microvias`, `viaInPad`, `stackedVias`, or
`viaTechnology` ≠ `through`: `unsupported-via-technology`); materials, dielectrics, copper weights, thicknesses (`material`,
`dielectric`, `dielectricConstant`, `copperWeightOz`, `copperThicknessUm`, `boardThicknessMm`: `unsupported-material`); impedance
(`impedance`, `impedanceTargets`, `impedanceOhms`: `unsupported-impedance`); other layer counts (`layerCount`, `layers`:
`unsupported-layer-count`); a profile or manufacturing preset outside the tree's (`unsupported-profile`,
`unsupported-manufacturing-profile`). Also refused as data: `profile-layer-mismatch`, `plane-layer-not-plane`, `unknown-net`,
`unknown-padstack`, `duplicate-id`, `request-malformed`. The candidate itself repeats the unsupported set under `unsupported`.
Not claimed anywhere: impedance, signal integrity, manufacturability, cost, that anything was applied.

## 7. Evidence (fixture-backed; the runs of 2026-10-17)

- `pnpm exec vitest run app/lib/agent/__tests__/pr-f-placement-intent.test.ts app/lib/agent/__tests__/pr-f-stackup-candidate.test.ts`:
  21 passed. Covered: the schema's closed literals and the manual's intent example; units / frame refusals; identity refusals as
  `proposal-blocked` (board unchanged); the locked connector `j1` (conflict `locked`, footprint unmoved, candidate legal); the keepout
  (r1 asked onto j1: conflict `keepout` naming `j1 (footprint_locked)`, r1 moved off, j1 unmoved); legalization (two parts at one place
  → `legalized` with the displacement; a part off the board → `outside-board`; an exact placement satisfied with its rotation kept);
  `orientation` (90° outside `[0, 180]`); groups / regions, pin-specific proximity (4.39 mm measured > 3 mm), separation, corridors and
  critical nets as data; 52 instances → `unsupported-scope`, not applied, identity refusals still enforced; the digest covers the intent
  block, the editor's candidate has no `intent` key; the loop's `layout_candidate_ready` with the intent, the bounded report and
  `PLACEMENT_INTENT_NOTE`. Stackup: descriptor (Tier 2 proposal-only, exposed, withheld, strict), discovery parity with the layout
  candidates, the four-layer signal-plane candidate over a two-layer board (counts apart, GND on in1, `jlcpcb-4l` not release-qualified,
  via minima, invalidation flags and rules), the same-stackup candidate (nothing changes, release-qualified), a board padstack below the
  minimum carried with its note, fifteen unsupported / malformed requests refused as data with the exact reason, the closed argument
  surface, 51 instances → `unsupported-scope`, the loop's own event once and `proposal_exists`.
- Existing suites green after the change: `app/lib/pcb/candidates/__tests__` (B17-E), `app/lib/pcb/placement/__tests__` (the engine),
  `b17-f-view-tools`, `b18-e-scenario-5` (pin moved: the placement input keys gain `intent`; the OD-24 note still true — no
  compactness / spacing / objective-weight argument).
- Generators re-run serially: tool-registry (B04), agent artifacts (B09), MCP manifest and parity (B20), the PR-D coverage matrix and
  manuals (`manuals/sirkit.stackup.propose.md`, `manuals/sirkit.placement.propose.md` with the intent example and the frame statement),
  B11 replay pins, B10 runtime availability.
- Pins moved with "[PR-F fE, 2026-10-17]" notes: see the builder report (b04, b09-1, b17-f, b18-c, b18-e, b20-b1, b20-b4, b20-c1,
  b20-c3 ×2, b21-c, b21-e2b, b22-b, b23-a, pr-d-tool-manuals; the B20 pages mcp-adversarial.md, mcp-exposure.md,
  mcp-server-proposals.md).

## 8. Not done / open

- The page has NO intake for `stackup_candidate_ready` (it falls to the default run-log line, as the draft request does): to show the
  candidate the page must add a case beside `layout_candidate_ready` that verifies `stackupCandidateIntact` and the base revision, and
  offer the recommendation in the existing stackup setting (PcbEditor's Stackup selector) — a human still commits it there; the
  `b21-e2-run-view` case list pin moves with it. No new dialog was added.
- The intent's regions and corridors are checked exactly and reported, but they are not new HARD rules of the engine (that would need
  the constraint program's `placement_region` rules and validator changes); keepouts the ENGINE enforces are the constraint program's
  and the locked instances.
- `critical-net priorities` are data only: the placement engine takes no net-priority input.
- Live: none (no provider, no engine, no distributor). The qualification of Astra's engineering quality on these candidates is a later
  increment (G–H) under a spend cap.
