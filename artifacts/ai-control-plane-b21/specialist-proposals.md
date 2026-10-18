# B21-D2 — specialists propose through their existing tools; an artifact's provenance is the gateway's own seal

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Tree
`chapter/b21-specialist-orchestration`, base `21ae845` (the B21-D commit); written 2026-09-26. Every `[B21 D2]` statement below is
pinned by `b21-d2-page.test.ts` (the proposal tables ARE `SPECIALIST_PROPOSAL_TOOL_IDS`, `DORMANT_SPECIALIST_PROPOSALS`,
`roleProposalToolIds` and `SEALER_CONTEXT_FACTS`; the approval table IS `SPECIALIST_APPROVAL_OUTCOMES` and the event table IS
`SPECIALIST_PROPOSAL_EVENTS`; the closed codes and the frame's rule are quoted from the code; every citation resolves by content
exactly once and, for the four modules D2 changed, on the line it states; every suite row carries its real `it(` count; the A..D
pages carry their dated D2 notes) or by the suite it names. D2 implements against the provider facts recorded in
`provider-reference-notes.md` (OD-118) and touches no provider feature (no request key, no adapter, no model choice), so no page was
re-read; no model is called in any D2 suite - every specialist is a scripted in-process adapter behind the existing provider-neutral
runtime, and every artifact a D2 suite accepts, presents or approves was sealed by the REAL gateway in the specialist's own run (the
coordinator's own artifacts in approval case 8 and route case 4 by the coordinator's gateway; the layout candidate there by its family's
producer, standing in for the routing engine). The NEGATIVE cases also hand the scheduler or the merge artifacts sealed in TEST code by
the production sealers - a hand-sealed Tier 1 a model lists (provenance case 3, approval case 7, route case 7), a hand-built outcome
(provenance case 4), the other-part replacement (route case 5), a tainted copy (provenance case 9) - which is exactly what they prove is
refused. [B21 D2 fix, 2026-09-26] The adversarial review's 17 confirmed findings are fixed test-first (section 6).

## 0. What D2 delivers, and what it is not

Why (the lead's decision, `discovery.md` section 10, B21-D): runbook B21-C says "No specialist directly mutates project state; it
PROPOSES through existing tools." B21-D's merge compares proposals, but B made every specialist read-only and C left OD-120's proposal
entries dormant, so in production no specialist carried an artifact, no conflict reached the merge and none was escalated (D21-10's
CONFIRMED-unreachable clause); and D's review found that a hand-built artifact naming the run's own actor was accepted with
"provenance not established". D2 makes the proposing roles' non-long-running proposals live and makes an artifact's provenance the
gateway's own seal.

- **The proposing roles are offered their reviewed proposals, nothing more (OD-120 amended; section 1).** `role-tools.ts` holds the
  live proposals (`SPECIALIST_PROPOSAL_TOOL_IDS`, C1) and the dormant ones with their reasons (`DORMANT_SPECIALIST_PROPOSALS`, C2);
  `roleProposalToolIds` (C3) is a proposing role's row intersected with the live list. The scheduler's read-only registry view became a
  "read + the role's reviewed proposals" view (`specialistToolRegistry`, C10), a role's effective set admits those proposals when its
  context admits them (C11), and the wrapper admits a live proposal the role's list names and nothing else but a read (C12). **CONFIRMED**
  by `b21-d2-proposing-roles.test.ts` (9 cases).
- **The context a proposal needs, and no more (OD-109 amended).** `specialistContextFor` (C9) is the hardened derivation plus, for a
  proposing role only, exactly the fact its sealer needs from the coordinator's verified context (`SEALER_CONTEXT_FACTS`, C8); the
  context still claims none of the eight elevations. **CONFIRMED** (proposing-roles cases 5 and 6).
- **Provenance = the gateway's own seal (section 2).** The scheduler collects every artifact the specialist run's gateway sealed (C14,
  C15) and ONLY those become the result's `proposedActions` (C16, C17); a model-written entry is refused before the merge; the merge
  checks the sealed set itself (C19, C22) and records `provenance: sealed-in-run` (C20, C21). **CONFIRMED** by
  `b21-d2-provenance.test.ts` (9 cases).
- **One side-effecting artifact per user message (OD-122 amended; section 3).** A specialist's sealed proposal is never shown directly;
  after the merge the deterministic rule (C24, C25) presents exactly one accepted action with nothing competing - and only when the
  coordinator's first turn sealed nothing (C29, C30) - as the run's own event of its family (C26..C28, C31), approvable through the
  product's existing path. **CONFIRMED** by `b21-d2-approval.test.ts` (10 cases) and the route suite.
- **The disagreement reaches a human (section 4).** Two proposing specialists that seal conflicting values of U1 through their own
  tools escalate once through the production POST, nothing is presented, the stream and the envelope say what the human decides - in
  the two full-circuit DAGs, the only plans with two proposing specialists (scenario 17's replacement DAG has one, section 4).
  **CONFIRMED** by `app/api/chat/__tests__/b21-d2-chat-proposals.test.ts` (7 cases).
- **[B21 D2 fix] The review round (section 6).** Once the coordinator's own turn handed the human an artifact, no specialist is offered a
  proposal (OD-122's `proposal_exists` clause, C53..C55); "nothing competing" is decided over the scheduler's outcome too - a peer's seal
  the merge never judged, or a proposing specialist that never ran, withholds the presentation (`incomplete`, C56, C57); the frame
  follows the run's EFFECTIVE set (C58, C59); the presentation is ALWAYS on the run's trace with the artifact's kind, id and digest (C60), within the recorder's 32-warning bound.
- This page, pinned by `b21-d2-page.test.ts` (8 cases), with the reserved texts written out in section 7.

Closes **D21-10**'s production half (the comparison is reachable: a real conflict reaches the merge and is escalated in production, in the
two full-circuit DAGs). Amends **OD-109**, **OD-120**, **OD-122**; reopens nothing. Finds **D21-37** (section 4, medium): a specialist
cannot seal a component replacement - its sealer needs the server's published pin-facts reads, which only the coordinator's gateway
holds - so the replacement stays dormant, OD-130's part review is not reachable at the route, and scenario 17's replacement DAG still
produces no structural disagreement.
[B21 D3, 2026-09-26] D21-37 is CLOSED by B21-D3: the runtime hands the specialist gateway the route's pin-facts reader, the replacement is live for the schematic role and scenario 17's replacement DAG holds two proposing roles (`specialist-replacement.md`).

**Zero authority by construction.** A specialist still mints, applies, approves, binds, qualifies, purchases and releases nothing. Its
gateway is still the ONE bare gateway the composition root builds with no option (no minter, no port, no prompt version - C33 of
`specialist-roles.md`, unchanged); what a proposing role gains is a SEAL: an inert Tier 2 artifact (permission tier `proposal_only`, a
human approves it) that the gateway produces from the verified context alone. No execution, no view control, no long-running proposal
and no replacement is ever offered to a specialist; the wrapper refuses everything outside the role's list (`role_not_permitted_tool`)
and every elevated context (`role_context_elevated`) before the gateway. Deterministic validation still outranks consensus: agreeing
results never promote an artifact (two accepted actions, even two equal edits, present nothing). The B18 grants, the B19 evidence
rules, B20's OD-45/90/91/92 provider rules and OD-81's directive matcher stand unchanged; `verifyAgentContextIntegrity` is untouched.
[B21 D3, 2026-09-26] Two statements above no longer hold since B21-D3: the specialist gateway is no longer bare - its ONE option is the route's pin-facts reader (`specialistGatewayOptions`, OD-109 amended; still no minter, no port, no prompt version; C33 and C46 re-pinned by anchor) - and the replacement IS offered to one role, the schematic specialist, whose seal reads those published pin facts (OD-120 amended; `specialist-replacement.md`).

## 1. The proposals a specialist may be offered (OD-120 amended)

The table IS `SPECIALIST_PROPOSAL_TOOL_IDS` (live, in order) and `DORMANT_SPECIALIST_PROPOSALS` (dormant, with its reason verbatim):

| tool | state | reason |
|---|---|---|
| `sirkit.pcb.propose-bounded-edit` | live | the bounded PCB edit, sealed from the verified board and the PCB proposal basis - interactive, nothing but the context needed |
| `sirkit.schematic.propose-component-replacement` | live | [B21 D3, 2026-09-26] live since B21-D3: sealed from the verified schematic, its head mark, the component authority and the catalog's published pin facts the runtime's reader supplies (D2 kept it dormant: the specialist gateway had no option) |
| `sirkit.schematic.propose-tier1-edit` | live | the Tier 1 schematic edit, sealed from the verified schematic and its head mark - interactive, nothing but the context needed |
| `sirkit.placement.propose` | dormant | long-running (budgetClass long-running): the placement engine blocks the event loop 44-104 s per run (B20's measurement), so it is never offered to a specialist |
| `sirkit.routing.propose` | dormant | long-running (budgetClass long-running): a FreeRouting child process of up to 180 s, so it is never offered to a specialist |

Per role (the table IS `roleProposalToolIds`, in `SPECIALIST_ROLES` order; the coordinator is never a specialist - its own turn keeps
the whole exposure list):

| role | live proposals |
|---|---|
| `coordinator` | — |
| `requirements-analyst` | — |
| `circuit-topology` | `sirkit.schematic.propose-tier1-edit` |
| `component-sourcing-evidence` | — |
| `schematic` | `sirkit.schematic.propose-component-replacement`, `sirkit.schematic.propose-tier1-edit` |
| `pcb-placement-routing` | `sirkit.pcb.propose-bounded-edit` |
| `verification-critic` | — |
| `manufacturing-readiness-reviewer` | — |
| `cost-latency-router` | — |

The ONE fact each live proposal's sealer needs from the coordinator's VERIFIED context (the table IS `SEALER_CONTEXT_FACTS`):

| tool | fact |
|---|---|
| `sirkit.pcb.propose-bounded-edit` | `pcbProposalBasis` |
| `sirkit.schematic.propose-component-replacement` | `schematicHeadMark` |
| `sirkit.schematic.propose-tier1-edit` | `schematicHeadMark` |

[B21 D3, 2026-09-26] The three tables above are the data as B21-D3 left it: the replacement is live for the schematic role (the row that lists it), its sealer's fact is the head mark, and the two long-running proposals stay the only dormant ones (`specialist-replacement.md`).

- **The view.** `specialistToolRegistry(registry, role)` (C10) holds every read and EXACTLY the role's live proposals - never a
  mutation, a view control or a long-running proposal; a role without a live proposal gets the read-only view itself (identity), so
  every read-only role's toolset is byte-identical to B21-C's (C's four HEAD digests stay green). `specialistAllowedToolIds` (C11) is
  the role's row intersected with the reads its context admits and the row's live proposals its context admits (the proposal
  prerequisites of `buildRunToolset`, unchanged: a head mark for the Tier 1 edit, C36; a board and a basis for the bounded edit, C37).
  **CONFIRMED** (proposing-roles cases 2 and 3: over the merge fixture's context the circuit and schematic specialists are offered the
  Tier 1 edit, the PCB specialist the bounded edit, every other role reads only - offered, persisted and looped alike).
- **The context.** `specialistContextFor(context, role)` (C9) is `deriveSpecialistContext` (unchanged, B21-C) plus, for a proposing
  role only, the head mark (with the discovery lineage it anchors, which the gateway's integrity check reads) or the PCB proposal basis
  - taken from the coordinator's verified context, never invented: a coordinator without the fact gives none and the proposal is not
  offered. The three availability facts stay false, no grant field, no port, no view, risk ceiling `propose`, no approval tier; the
  context passes `verifyAgentContextIntegrity` and claims none of the eight elevations, and each claim added to it - alone - is refused
  `role_context_elevated` before the gateway, for the role's proposal call as for a read. **CONFIRMED** (proposing-roles cases 5 and 6).
- **The wrapper.** `readOnlySpecialistGateway` (its name kept: B's page C12 and C's page C19 pin it) admits a read of the role's list
  and, with a list, a LIVE specialist proposal the list names (C12) - nothing else; without a list (the follow-up coordinator turn) it
  still admits reads only. Over the WORST coordinator context no role is offered, and the wrapper refuses before the gateway, a granted
  execution, a view control, a Tier 3 or never-exposed id, a long-running proposal or the replacement. **CONFIRMED** (proposing-roles
  case 4). [B21 D2 fix] The wrapper's own class check is pinned apart from the list: handed a HAND-BUILT list naming both long-running
  proposals, the replacement, a granted execution and a view control beside the live Tier 1 edit, it still refuses those five before
  the gateway and passes only the read and the live proposal. **CONFIRMED** (proposing-roles case 8). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-D3 the replacement is live for the schematic role: no role but the schematic one is offered it - proposing-roles case 4 - and the wrapper refuses four and passes the read, the Tier 1 edit and the replacement - proposing-roles case 8, both retitled]
- **The frame follows the run's EFFECTIVE set, never the role alone ([B21 D2 fix], review regressions-4 / tests-2).** Whether THIS run
  is offered a live proposal (`offersProposal` over its persisted `allowedToolIds`, C58) decides the opening line (`PROPOSING_OPENING`,
  C62, instead of B's "read-only" one), the rules line (`specialistFrameRules(proposing)`, C18, C59), the sealed-proposals result rule
  (section 2) and the objective (C6); a read-only role - and a proposing role whose context lacks its sealer's fact, or that runs once
  the coordinator holds an artifact - is told B's read-only frame, verbatim, and never that it may seal what it is not offered.
  **CONFIRMED** (proposing-roles cases 7 and 9, over the recorded system prompts and objectives; B's route case 4, moved).

## 2. Provenance = the gateway's own seal

- **The collector.** For every specialist attempt the scheduler collects, from the run's OWN loop events, every `proposal_ready`,
  `pcb_proposal_ready` and `layout_candidate_ready` (C14, C15) - the loop emits them only for an artifact the GATEWAY returned sealed
  (C38, C39) - captured as plain JSON at once. Nothing of it reaches the coordinator's stream (the scheduler's emit filter is unchanged).
- **Only the sealed artifacts become `proposedActions`.** `attachSealedArtifacts` (C16), applied to the parsed final text (C17; [B21 E1, 2026-09-27] since B21-E1 the ONE strict result-tool call's arguments, never a final text - C17 re-pinned): every
  entry the MODEL wrote must EQUAL an artifact its run sealed (kind and canonical payload), otherwise the whole result is refused
  `proposal_not_sealed_in_run` (dissent `malformed`, persisted, never judged by the merge); then `proposedActions` become exactly the
  sealed artifacts, in seal order, wrapped as A's contracts require - the document validated again, so `artifactDigest` is recomputed
  and a sealed artifact the contracts refuse (a secret-shaped instruction) refuses the result, never a redacted copy. The outcome carries
  the sealed digests (C13); a replay carries its committed result's (C23), attached after that attempt's own seal check. **CONFIRMED**
  (provenance cases 1..3: a real Tier 1 proposal and a real bounded PCB edit sealed in the specialist's own run are exactly its
  `proposedActions` although the model listed none; a hand-sealed artifact listed by a specialist that sealed nothing, and another
  artifact listed by one that sealed a different one, are refused before the merge; listing the very artifact the run sealed is
  accepted and never duplicated). [B21 D2 fix] **Refuses, never redacts:** a sealed artifact the contracts refuse (a control character in
  one of its strings) refuses the WHOLE result `result_refused`, never a result with the artifact silently dropped (provenance case 9).
  **A seal stays with its attempt:** the collector is per attempt, so a seal made by an attempt that then FAILED (a retryable provider
  failure) rides that escalated attempt's outcome only - the retried attempt's result carries none, and if its model lists it, it is
  refused `proposal_not_sealed_in_run` (provenance case 7).
- **The frame's rule** (C35, the result rule of a run that is offered a live proposal, quoted verbatim): Sealed proposals (this role may propose): a proposal your proposal tool seals in this run is an inert Tier 2 artifact for the human, and the scheduler attaches it to your result for you - leave "proposedActions" empty and name it by its proposal id in your summary; an entry you write yourself that this run did not seal is refused, and your whole result with it. At most one proposal per run: a second proposal call is refused (`proposal_exists`).
- **At most one proposal per run** is the loop's own single-flight (C51, unchanged): a specialist that calls its Tier 1 tool twice seals
  once, the second call is refused `proposal_exists` (one bounded refusal line on the coordinator's stream), its result carries one
  sealed artifact and the one accepted action is presented. **CONFIRMED** (provenance case 8).
- **The merge's second check and the provenance it records.** The merge refuses on its own an action outside its task's sealed set
  (`proposal-not-sealed-in-run`, `malformed`, the merge's own code - C19, C22; a row of `MERGE_OWN_CODES` and of D's page) and records
  `provenance: sealed-in-run` (C20) on every other action (C21); an accepted verdict says so and never again "provenance not
  established". **CONFIRMED** (provenance case 4: the accepted verdict names `provenance: sealed-in-run`; the same accepted results with
  their sealed set emptied or absent are `malformed`).
- **The B21-D suites.** They judge artifacts sealed in TEST code (stale, foreign, re-sealed, non-exact) that no gateway would seal, which
  since D2 reach the merge only as a run's own seal events: the merge fixture's injected loop and D's route cases 2..5 relay them as the
  run's seal events (`_seal-relay.ts`, a stand-in for the sealer at the scheduler's loop seam; never a production path - the
  composition root binds the real loop). Section 6 lists the pin moves.
- **The never-execution sweep** through the D2 wrapper, for every role over the whole registry with a REAL minter under it and the
  proposing context: no execution grant, no view command, no layout candidate, the minter never called; a proposal only through the
  role's live ids; the coordinator's context refused `role_context_elevated`. **CONFIRMED** (provenance case 5).

## 3. One side-effecting artifact per user message (OD-122 amended)

After the merge, `specialistApprovalDecision` (C24) decides deterministically, in this order: the coordinator's first turn already
handed the human an artifact (`COORDINATOR_ARTIFACT_EVENTS`, C29, recorded at C30), an escalation, a part review request, a
contradicted result, [B21 D2 fix] a competitor the merge could not judge (`incomplete`, C56, C57), no accepted action, more than one -
and otherwise `presented`. The table IS `SPECIALIST_APPROVAL_OUTCOMES` (C25):

| outcome | # | meaning |
|---|---|---|
| `presented` | 1 | exactly one accepted action, sealed in its specialist's own run, nothing competing and nothing sealed by the coordinator: emitted as the run's own event of its family |
| `coordinator_sealed` | 2 | the coordinator's first turn already sealed a proposal, a layout candidate or minted a grant: that is the run's one artifact |
| `escalated` | 3 | the merge escalated a conflict to the human |
| `review_requested` | 4 | the merge wrote a part review request (OD-130) |
| `contradicted` | 5 | a judged result is contradicted |
| `incomplete` | 6 | a task's attempt sealed an artifact no merged task judged (its result was refused, or its run failed after the seal - a failed attempt before a retry included), or a planned proposing specialist never started: nothing competing cannot be established |
| `none_accepted` | 7 | no accepted action (or its artifact could not be read back from the committed result) |
| `several_accepted` | 8 | more than one accepted action - agreement never promotes one; the human decides between them |
| `already_presented` | 9 | [B21 E3] the one action `presented` would hand over, when the userMessageDigest ledger already holds this user message's artifact (an earlier request of the same run presented it, or its end is not recorded - at most once; a claim whose request recorded that it presented nothing is void): decided LAST, in `presented`'s place only - never a second artifact across resumes (`route-resume.md`) |

The coordinator's artifact events (`COORDINATOR_ARTIFACT_EVENTS`, in order): `proposal_ready`, `pcb_proposal_ready`, `layout_candidate_ready`, `execution_grant_ready`.

- **[B21 D2 fix] "Nothing competing" is decided over the scheduler's outcome too** (review regressions-3 / security-1 / coverage). The
  merged view holds only the results the merge judged; `unjudgedProposers` (C56) also reads the scheduler's outcome - every attempt's
  sealed digests and the plan's `notStarted` - so a peer that sealed a conflicting proposal and then listed an artifact its run did not
  seal, answered with no result document or failed after its seal, and a planned PROPOSING specialist that never started (a DAG
  stopped early), all withhold the presentation (C57); a read-only specialist that never started could have sealed nothing and
  changes nothing. **CONFIRMED** (approval case 7 over real seals and crafted failures; route case 7 through the production POST;
  provenance case 7 - a failed attempt's seal).
- **[B21 D2 fix] OD-122's `proposal_exists` clause, applied** (review regressions-2 / coverage). Once the coordinator's own first turn
  emitted any of the four artifact events, the runtime tells the scheduler (`artifactHeld`, C55, C53) and every specialist runs over
  the plain derivation (C54) - no sealer fact, so no proposal is offered, B's read-only frame, one line on the stream
  (`COORDINATOR_ARTIFACT_HELD_LINE`, C61). A coordinator proposal and a specialist proposal on the same component can therefore never
  both exist in a run the route starts: the stricter equivalent of `proposal_exists` (never offered rather than refused at the call).
  **INFERRED** residual: a scheduler-level replay of a result committed earlier still carries its own seal; the route never replays
  (a fresh run id per POST), and the decision is `coordinator_sealed` first either way, so nothing of it is presented. **CONFIRMED** (approval
  case 8 - each of the four events through the REAL runtime, a real Tier 1 seal, a real bounded PCB edit, a routing candidate its
  family produced and a real execution grant; route case 4 - the same component, R1 3k3 against a scripted 4k7; proposing-roles case 9). [B21 E2, 2026-09-27] Since B21-E2 that one line is a `degraded` event (`coordinator_artifact_held`, the same sentence) (`run-events-and-trace.md`, OD-126). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-E3 the route replays on a resume (`resumeRunId`): a replayed result keeps its seal, and the userMessageDigest ledger decides whether it is presented - CONFIRMED, E3's runtime case 4; `route-resume.md` section 4]

`presentSpecialistProposal` (C27, called at C31) emits the presented action as the family's OWN event - the shape the coordinator's
seal emits, under the coordinator's run id, the artifact read back from the run's validated result with its digest re-checked (C26) -
and one line; otherwise it emits nothing and, when an accepted action exists, one line says why. [B21 D2 fix] That one line is
ALWAYS recorded on the run's trace (a stand-down-class line past the 12-line orchestration cap, C52, within the trace recorder's own 32-warning bound (`TRACE_BOUNDS.maxWarnings`, shared with the coordinator's warnings; a full trace is marked `trace_event_capacity_reached`, never silently short)), and the presented line names the
artifact's kind, id and digest (C60); an artifact that cannot be read back exactly (payload or kind altered after the merge) is not
presented (`none_accepted`, approval case 9). The follow-up turn's envelope carries an `approval` block (C32) and its header says the
human decides either way. The event table IS `SPECIALIST_PROPOSAL_EVENTS` (C28):

| kind | event | tool |
|---|---|---|
| `sirkit.schematic-tier1-proposal.v3` | `proposal_ready` | `sirkit.schematic.propose-tier1-edit` |
| `sirkit.schematic-replacement-proposal.v2` | `proposal_ready` | `sirkit.schematic.propose-component-replacement` |
| `sirkit.pcb-bounded-edit-proposal.v2` | `pcb_proposal_ready` | `sirkit.pcb.propose-bounded-edit` |
| `sirkit.layout-candidate.v1` | `layout_candidate_ready` | `placement -> sirkit.placement.propose, routing -> sirkit.routing.propose` |

**Approvable through the existing path, with the run's principal.** The approval suite drives the families' own apply boundaries with
the run's principal reauthorized by the REAL `POST /api/pcb/apply-authorization` (C44; the production reauthorizer minus `fetch`, a
same-origin POST): the Tier 1 edit a circuit specialist sealed is applied by `applyApprovedTier1Proposal` (C41, its reauthorization at
C42) over a live SchematicEditorSession - committed once, the receipt naming the coordinator run - and the bounded PCB edit a PCB
specialist sealed by the PCB approval controller (C43) over a real bound canonical session - committed, the live board IS the sealed
candidate. The page's own discriminators accept both (C45, C46). **The approval path does not refuse an artifact sealed under a
specialist run id**: the PCB proposal's `provenance.runId` is the specialist's `<coordinatorRunId>:<taskId>`, inside the sealed
identifier grammar (C40); the schematic families record no run id; the `originRunId` of both applies is metadata. **CONFIRMED**
(approval cases 1 and 2; route case 3 through the production POST). The other outcomes are proven with real seals: the coordinator
already sealed (approval case 3; route case 4 - exactly one `proposal_ready` on the stream, the coordinator's), two accepted and two
EQUAL edits (approval case 4), an escalation (approval case 5), an unjudged competitor (approval case 7), and the order over crafted
variants of one real merge (approval case 6). **CONFIRMED:** the presentation is ALWAYS recorded on the run's trace - route case 6 fills
the cap with 15 orchestration lines (refused tool calls) before it, and the finalized trace holds the first 12 plus the presentation
line naming the proposal's kind, id and digest. **RECORDED ([B21 D2 lead], 2026-09-26):** the line is still subject to the trace recorder's own 32-warning bound, which `always` does not bypass - a trace already holding 32 warnings drops it and is marked `trace_event_capacity_reached`, never silently short. **RECORDED:** the orchestration record keeps the merge's `accepted` decision and no
separate presentation record (B21-E's trace block may carry it).

## 4. The disagreement reaches a human; the stop condition met for one family

- **End to end** (route case 2): "Design a 555 timer circuit." runs the full-circuit DAG; the circuit and schematic specialists each SEAL
  a value of U1 through their own offered Tier 1 tool (the real gateway, in their own runs); the merge judges both `sealed-in-run`, finds
  the same field (`same_field`, part), makes both `contradicted` and writes ONE escalation record; NOTHING is emitted for approval (no
  proposal event reaches the stream at all); the stream carries the escalation line and the follow-up envelope the escalation's own
  `humanDecision` and `"approval":{"outcome":"escalated","presented":null}`. D21-10 moves from "CONFIRMED-unreachable" to closed in
  production. **CONFIRMED**.
- **[B21 D2 fix] Where a specialist-vs-specialist disagreement is reachable, and scenario 17** (review coverage). A structural escalation
  needs TWO proposing specialists in one plan. Of the router's DAGs (`DAG_ROLE_LISTS`) only `full-circuit-creation` (circuit-topology and
  schematic: two Tier 1 edits - route case 2) and `full-circuit-layout` (circuit-topology's Tier 1 edit against pcb-placement-routing's
  bounded edit, which can meet only through a footprint's sync identity) hold two; `bounded-schematic-proposal` and
  `bounded-pcb-proposal` hold one each and `manufacturing-readiness` none. Runbook scenario 17 ("a complex lower-power timer replacement
  through the adaptive specialist DAG with deterministic disagreement resolution") routes to `component-replacement` - circuit-topology,
  component-sourcing-evidence and verification-critic - which has ONE proposing specialist (circuit-topology, the Tier 1 edit), and
  the replacement proposal itself is dormant for specialists (D21-37): scenario 17 still produces no structural disagreement, and when
  the coordinator seals the replacement itself no specialist is offered a proposal at all (OD-122, section 3). Its disagreement reaches
  the human only as the specialists' unverified claims. **CONFIRMED** (the router's data; B's route case 4 runs the replacement request:
  circuit-topology is the only specialist offered a proposal) - B21-F's "timer replacement with provider disagreement" case inherits
  this gap (D21-37, section 7).
  [B21 D3, 2026-09-26] Superseded for scenario 17 by B21-D3 (D21-37 CLOSED): the component-replacement DAG holds the schematic specialist too, whose replacement is live, so two SEALED parties can meet on U1 in the merge - and are always escalated; a party whose edit cannot seal (the agent path's KiCad-delete block) never reaches the merge, so scenario 17 presents the one sealed replacement or escalates by the circuit specialist's op choice (`specialist-replacement.md`).
- **The stop condition, met for the replacement family (D21-37).** "STOP and report if a specialist seal would need the minter, a port
  or a grant." The component-replacement sealer needs the server's published pin-facts reads (`replacementPinFacts`): the chat route
  injects them into the coordinator's gateway only (C47), and the specialist gateway is built with no option at all (OD-109; pinned by
  B's route cases 14 and 16). Through the bare specialist gateway the replacement seal always BLOCKS with
  `current-pin-authority-unavailable` (C48, C49); through a gateway that holds the reads the same call seals (provenance case 6). D2 does
  NOT hand the specialist gateway that source - a composition-root injection like the ports - so the replacement stays DORMANT for
  specialists, with its reason, as an owner option under OD-120 (section 7). **CONFIRMED**.
  [B21 D3, 2026-09-26] The owner option was taken by B21-D3: the runtime builds the specialist gateway with the route's own pin-facts reader and nothing else (OD-109 amended), the replacement is live for the schematic role (OD-120 amended) - `specialist-replacement.md`.
- **OD-130's part review is not reachable at the route.** The family's assembler seals only the server-owned exact target, no specialist
  can seal a replacement at all, and a replacement the MODEL writes - even a real artifact of the family naming another part - is refused
  before the merge (`proposal_not_sealed_in_run`; route case 5: no part review record, no escalation, nothing presented, one malformed
  line). The merge's OD-130 rule stays as defense in depth (D's merge cases 6 and 19 over relayed artifacts); a non-exact target can
  reach it only through a scheduler-level replay whose exact authority moved between attempts, which the route never performs (a fresh
  run id per POST). **INFERRED** for the replay path; **CONFIRMED** for the route.
  [B21 D3, 2026-09-26] The route statement stands: since B21-D3 a specialist seals real replacements, the replay path is CONFIRMED through the runtime's own resume (scenario17 case 5) and the route's envelope RENDERS the part review through the scheduler seam (route case 5, a test-built resume), but the route never resumes - OD-130's part review is CONFIRMED-unreachable from a production POST until B21-E's route-level resume (route case 7; `specialist-replacement.md`). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-E3 it is REACHABLE from a production POST through the route-level resume: a replayed seal is re-judged against the authority loaded for the resuming request - `route-resume.md` section 5; D21-16 closed at the route by B21-E3]

## 5. What D2 does NOT do

- No new exposed tool, no new descriptor, no new route, no new run event (the families' own events only), no UI, no request key, no
  generator input change: the route census stays 165 = 162 canonical + 3 factories + 0 raw and every generated artifact is
  byte-identical; no generator was re-run.
- No grant, no mutation, no execution, no view control and no port for a specialist; no long-running proposal for a specialist; no
  replacement proposal for a specialist (the stop condition, section 4); no change to `deriveSpecialistContext`,
  `verifyAgentContextIntegrity`, the loop, the gateway, the route or the adapters.
- No presentation by count or majority; no second artifact per user message; no content judgement of prose.
- No reserved-file edit (their texts are in section 7); no trace block, provider routing or breaker (B21-E); no evaluations (B21-F).

## 6. Suites, evidence, the pin moves, gates

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-d2-proposing-roles.test.ts` | 9 | the live and dormant proposals as data; the 'read + reviewed proposals' view; per role through the real scheduler the offered = persisted = looped set; never an execution, a view control, a Tier 3, a long-running proposal or the replacement over the worst context; the proposing context and its eight refused claims; [fix] the frame by the run's effective set, the wrapper's class check apart from the list, no proposal offered once the coordinator holds an artifact |
| `app/lib/agent/orchestration/__tests__/b21-d2-provenance.test.ts` | 9 | a real Tier 1 proposal and a real bounded PCB edit sealed in the specialist's own run are exactly its proposedActions; a model-written artifact refused before the merge; `sealed-in-run` and the merge's second check; the never-execution sweep through the D2 wrapper; the replacement dormant (pin facts); [fix] a seal stays with its failed attempt, one proposal per run (`proposal_exists`), refused never redacted |
| `app/lib/agent/orchestration/__tests__/b21-d2-approval.test.ts` | 10 | the one accepted action presented as the run's own event and approved through the Tier 1 and PCB apply boundaries with the run's principal reauthorized by the real route; coordinator sealed, two accepted, two equal, an escalation: nothing; the ordered decision; [fix] an unjudged competitor `incomplete`; each of the coordinator's four artifact events through the real runtime; the read-back refusals |
| `app/lib/agent/orchestration/__tests__/b21-d2-page.test.ts` | 8 | this page |
| `app/api/chat/__tests__/b21-d2-chat-proposals.test.ts` | 7 | flag off byte-identical to HEAD (B's four digests); the conflicting-proposals escalation end to end; one sealed proposal presented and approved; the coordinator's own proposal kept the one artifact, the specialist offered none (same component); a non-exact replacement never reaches the merge; [fix] the presentation always on the finalized trace; a peer's refused conflicting seal withholds it |
| `app/lib/agent/orchestration/__tests__/b21-d-merge.test.ts` | 25 | D's cases over relayed seals; case 17's pin move |
| `app/api/chat/__tests__/b21-d-chat-merge.test.ts` | 7 | D's cases; cases 2..5 relay their test seals; case 3's pin move |
| `app/api/chat/__tests__/b21-b-chat-router.test.ts` | 18 | B's cases; case 4's two pin moves |
| `app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts` | 10 | C's cases; case 1's pin move |
| `app/lib/agent/orchestration/__tests__/b21-c-no-elevation.test.ts` | 5 | C's cases; case 4's pin move |

**Test-first.** Every new and changed suite ran against the unchanged production code first (`d2/d2-failing-first.log`: 11 files, 34
of 103 failing - every D2 case but the flag-off byte-identity pin, which holds before and after by design, each on its own assertion or
the missing export, except approval cases 1 and 2, which first stopped in their setup: the reauthorizing POST lacked the `origin`
header the CSRF check requires. With the header, and rechecked against HEAD's four modules, both fail on their own assertions
(`d2/d2-failing-first-approval-recheck.log`: 6 of 6 failing). D's merge case 17, D's route case 3, B's route case 4, C's least-privilege case 1 and no-elevation case 4 on their
moved assertions; the relayed D cases passed on the old code, the relay being inert there); then the code (`d2/d2-impl-1.log`: 94 of
96, the two provenance cases merging with the B21-D fixture's frozen clock, which precedes a live seal's `createdAt` - the merge's own
lifetime rule refused them, as it must; the suite now merges at the run's clock); then green (`d2/d2-impl-2.log`, and every B21 suite
in `d2/gate-b21.log` once the page, the page notes and the CI entry were written).

**[B21 D2 fix] The adversarial review's 17 confirmed findings, fixed test-first.** The new and moved cases ran first against the
unfixed code (`d2fix/f1-failing-first.log`: 6 files, 14 of 60 failing, each on its own assertion); then the fix (`d2fix/f2-fix-1.log`:
only this page's cases and one trace assertion left - the trace records a task id through its own sanitizer, which the case now
applies); then green. Every test-strength finding is proven by a deliberate breakage of the source that the strengthened case catches,
the source restored byte for byte and verified by sha256 (`d2fix/mutations.summary`, `d2fix/mut-*.log`):

| finding | severity | the case that reproduces it | failing first / breakage caught | the fix |
|---|---|---|---|---|
| `regressions-1`, `coverage-presentation-not-durably-recorded` | low, low | route case 6; approval cases 7 and 9 (the line's `always` flag) | the presented line lacked the digest and was dropped past the cap; breakage m13 (`always` removed) fails route case 6 | the presentation line (and a withheld one) is `warn(line, true)`, with kind, id and digest (C60) |
| `regressions-2`, `coverage-coordinator-vs-specialist-conflict-unjudged` | medium, medium | route case 4 (same component), approval case 8, proposing-roles case 9 | the specialist was offered its Tier 1 edit beside the coordinator's seal; breakage m14 (`artifactHeld` not passed) fails route case 4 and approval case 8 | OD-122's `proposal_exists` clause: `artifactHeld` (C53..C55, C61) |
| `regressions-3`, `security-1`, `coverage-presentation-ignores-dropped-or-unrun-proposers` | low, low, low | approval case 7, route case 7, approval case 6 (order), provenance case 7 | `presented` beside a peer's refused conflicting seal; breakage m15 (`incomplete` off) fails route case 7 and approval cases 6 and 7 | `incomplete` over the scheduler's outcome (`unjudgedProposers`, C56, C57) |
| `regressions-4`, `tests-2` | low, medium | proposing-roles case 7; B's route case 4 (moved) | a proposing role without its fact was told it may seal; breakages m02 (rules always B's), m03 (the sealed rule dropped), m04 (objective reads-only) each fail proposing-roles case 7 | the opening, rules line, result rule and objective by the run's effective set (C58, C59, C62) |
| `tests-1` | medium | approval case 8 (each of the four events through the real runtime) | breakage m01 (the constant trimmed) and m16 (the detection trimmed to `proposal_ready`) each fail approval case 8 | test only; the constant pinned by it and by page case 8 |
| `tests-4` | low | approval case 9, provenance case 9 | breakages m05 (read-back checks deleted), m07 (provenance guard deleted) fail approval case 9; m06 (a refused seal redacted) fails provenance case 9 | test only |
| `tests-5` | low | provenance case 7 | breakage m08 (the collector hoisted above the attempts) fails it | test only (the collector was already per attempt) |
| `tests-6` | low | proposing-roles case 8 | breakages m09 (any proposal class) and m10 (any class with a list) fail it | test only |
| `tests-8` | low | page case 6 (strengthened) | breakage m11 (D's note inverted to "remains unreachable") fails it | test only |
| `tests-9` | low | provenance case 8 | the rule's text had no enforcement named; breakage m12 (the loop's single-flight off, loop.ts restored) fails it | `SEALED_PROPOSALS_RULE` names the loop's `proposal_exists` (C35, C51) |
| `coverage-scenario17-still-unreachable` | low | page case 8 | the page never named scenario 17 | section 4's DAG statement; D21-37 medium; the status line qualified |
| `coverage-stale-statements-left` | low | page cases 6 and 8 | D21-14's "no specialist carries today", the envelope's "read-only specialist runs", the preamble's claim | D's D21-14 note and the D21-14 addendum; the header reworded (C33); the preamble narrowed |

**Pin moves, each with its reason written next to it in the suite.**
- `_merge-fixtures.ts` (the B21-D merge suites' runner): the loop the scheduler is handed relays the scripted result's artifacts as the
  run's own seal events (`relaySeals`) - since D2 a result carries only what its run's gateway sealed, and D judges artifacts sealed in
  test code. No case assertion of `b21-d-verification-requests.test.ts` or of `b21-d-merge.test.ts` cases 1..16 and 18..23 moved.
- `b21-d-merge.test.ts` case 17: the accepted verdict now says `provenance: sealed-in-run` and never "provenance not established"
  (it still never says "verified by their families"); its title's "never calls its artifacts ... sealed" is stale - retitled at the
  closeout (the OD-113 pattern), assertions as moved here. [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): retitled; assertions unchanged]
- `b21-d-chat-merge.test.ts`: cases 2..5 relay their test seals through the scheduler seam (`setSpecialistSchedulerFactory`, reset
  after each case); case 3 - exactly one accepted action and nothing sealed by the coordinator - now asserts the ONE `proposal_ready`
  the runtime emits (its artifact digest the relayed proposal's) where it asserted none (OD-122 amended).
- `b21-b-chat-router.test.ts` case 4: a proposing role is also offered its row's live proposal (the circuit specialist the Tier 1 edit,
  the request carrying a head mark); every other tool is still a read and the critic is offered no proposal. [B21 D2 fix] Second move
  (review regressions-4 / tests-2): a specialist OFFERED a live proposal is no longer told it is read-only (the proposing opening line);
  every other one still is.
- [B21 D2 fix] `b21-d2-chat-proposals.test.ts` case 4 (D2's own, uncommitted): the coordinator and the schematic specialist now target
  the SAME component (R1 3k3 against 4k7) and the specialist is offered no proposal (reads only, B's frame); before the fix it sealed and
  the merge accepted its proposal unseen beside the coordinator's. Approval case 6 gained the `incomplete` row of the order; approval
  cases 1, 3, 4 and 6 pass the scheduler's outcome to the decision (its new required fact). `_d2-fixtures.ts`'s scripted adapter gained
  further calls, first-attempt-only calls, a provider failure after a call and the coordinator's own turns (`coordinator`,
  `coordinator-2`); the route suite's mock gained unknown-tool noise calls and the trace capture.
- `b21-c-least-privilege.test.ts` case 1: the scheduler's set is `FULL_CONTEXT_OFFERED` (the live proposals of a proposing role added);
  `FULL_CONTEXT_EFFECTIVE` stays the read-only derivation's set and C's four HEAD digests are untouched.
- `b21-c-no-elevation.test.ts` case 4: a proposing role's loop runs over `specialistContextFor` and `specialistToolRegistry`; a read-only
  role's over the derivation and the read-only view as before; either way the context claims nothing.
- Stale titles kept (retitled at the closeout, OD-113's pattern): D's merge case 12 ("the dormant OD-120 proposal tools stay dormant: no
  role gains a tool") and C's no-elevation case 4 ("each loop runs over the read-only registry"); D's route suite header noted in place. [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): both retitled; assertions unchanged]
- Pages: the A..D pages carry dated `[B21 D2, 2026-09-26]` notes where D2 changed what they state; C's role table and D's own-code
  table move with the data they are (C's six proposal reason cells, D's new `proposal-not-sealed-in-run` row).

**CI.** The four orchestration suites ride the `app/lib/agent/orchestration/__tests__` filter; the route suite is ONE explicit
`prompt-to-gerber` entry next to D's (C50), admitted by the guard's `[B21 A]` case; no suite starts PGlite; none lives under
`app/lib/engineering/__tests__`.

**Gates** (one heavy job at a time, through the lock runner; figures in the report, re-run by the lead): every B21 suite (`app/lib/agent/orchestration/__tests__`), the three B21 route suites and the CI guard - 22 files, 205 tests, all passed (`d2/gate-b21.log`); `app/api/chat/__tests__` in full - 17 files, 108 tests (`d2/gate-chat.log`; the flag-off streams byte-identical to HEAD's, the B19-D closure gate green); `app/lib/agent/__tests__` in full - 36 files, 415 tests (`d2/gate-agent.log`; the B11 tripwires and the provider literal untouched); the exposure / tier / discovery pins (b04-tool-registry with its byte-matched artifacts, b17-f-agent-exposure, b18-a-permission-tiers, every b18-c-* engineering suite, b20-a4-observation-descriptor, b20-b1-mcp-exposure, b20-b3-mcp-subset-move, b20-c1-three-way-parity) - 25 files, 224 tests (`d2/gate-pins.log`); the proposal families and their approval paths (the b12-* Tier 1 apply suites, b14-* replacement proposal and apply, b15-3 PCB apply, the b16-0-1 / b16-0-2 authorization and reauthorization suites, the b14-2 / b15-3 boundaries, `app/lib/pcb/proposal/__tests__`, the apply-authorization selector-envelope suites) - 27 files, 367 tests (`d2/gate-families.log`); `app/lib/mcp/__tests__` in full (every B20 page suite) - 26 files, 642 tests (`d2/gate-mcp.log`; no cited production file of a B20 page changed: `loop.ts`, `adapters.ts`, `route.ts` and `errors.ts` are untouched); the import gates and chat closure ratchets (b14-4, b18-b, b20-b2, b20-d3, b16-0-24, b20-b2 route tree) - 6 files, 62 tests (`d2/gate-import-gates.log`); the route census ratchets (b16-1c invariant tripwires, b16-1b auth composition: 165) - 2 files, 24 tests (`d2/gate-census.log`); tsc 0 errors (`d2/tsc-2.log`); eslint clean on the seventeen new and changed TypeScript files (`d2/eslint-1.log`); no control byte and no CRLF in any new or changed file. No descriptor, route, UI control, request key or generator input changed, so no generator was re-run.

**[B21 D2 fix] Gates re-run after the review round** (the same sets, one heavy job at a time): every B21 suite, the three B21 route suites and the CI guard - 22 files, 217 tests (`d2fix/g1-b21-final.log`); `app/api/chat/__tests__` in full - 17 files, 110 tests (`d2fix/g2-chat.log`); `app/lib/agent/__tests__` in full - 36 files, 415 tests (`d2fix/g3-agent.log`); the proposal families and their approval paths - 27 files, 367 tests (`d2fix/g4-families.log`); the exposure / tier / discovery pins - 25 files, 224 tests (`d2fix/g5-pins.log`, b04's byte-matched generated artifacts among them: zero drift); `app/lib/mcp/__tests__` in full - 26 files, 642 tests (`d2fix/g6-mcp.log`); the import gates, chat closure ratchets and route census (165) - 8 files, 86 tests (`d2fix/g7-import-census.log`); tsc 0 errors (`d2fix/g8-tsc-2.log`); eslint clean on the seventeen new and changed TypeScript files (`d2fix/g9-eslint.log`). Every production edit above a cited range is in place (line-neutral: the A..D pages' current-line rows all hold); the fixes' own lines moved only this page's rows, re-pinned in section 8; no `<basename>:<line>` citation of a changed file exists in `artifacts/`; `loop.ts` was changed only by the deliberate breakage m12 and restored byte for byte (sha256 verified); no control byte and no CRLF in any new or changed file.

Live behaviour with a real model: **BLOCKED-LIVE-QUALIFICATION** (LB-9). **UNKNOWN**: whether a live proposing specialist follows the
frame's rule (seal through its tool, list nothing) - a model that copies its artifact exactly is accepted, one that writes any other
artifact is refused.

## 7. For the lead — the reserved texts, in full

Each `### OD-…` below is the amendment for `OWNER_DECISIONS.md` (as `## OD-…`), in its format. Then the README row, the ledger
paragraph, the PROGRAM_STATE texts, the discovery closure clauses and the §10 amendment line.

### OD-109 — Specialists never hold the three availability facts; a proposing role holds its sealer's fact, amended (B21-D2, 2026-09-26)

- **Question:** B21-C derived every specialist context with no head mark and no PCB basis, so no specialist could seal a proposal.
- **Amended:** `deriveSpecialistContext` is unchanged; a specialist runs over `specialistContextFor(context, role)`, which for a
  proposing role only adds EXACTLY the fact its live proposal's sealer needs from the coordinator's VERIFIED context
  (`SEALER_CONTEXT_FACTS`: the schematic head mark - with the discovery lineage it anchors - for the Tier 1 edit, the PCB proposal basis
  for the bounded edit) and nothing for a read-only role; a coordinator without the fact gives none. The three availability facts stay
  false, no grant field, no port, no view, risk ceiling `propose`, no approval tier; the context passes `verifyAgentContextIntegrity`,
  claims none of the eight elevations, and each claim added to it is refused `role_context_elevated` before the gateway. The specialist
  gateway is still the bare one (no minter, no port, no prompt version). Proven by `b21-d2-proposing-roles.test.ts` cases 5 and 6.
- **The owner may choose otherwise:** give the specialist gateway the server's published pin-facts reads (then the replacement proposal
  can seal for the schematic role - a composition-root injection like the ports, which D2 declined as a stop condition).

### OD-120 — Which of the 33 exposed tools each role may be offered, amended (B21-D2, 2026-09-26)

- **Question:** B21-C kept OD-120's proposal entries dormant (specialists read only); D left them so.
- **Amended:** the proposing roles are offered their row's LIVE, non-long-running proposals and nothing more
  (`SPECIALIST_PROPOSAL_TOOL_IDS`): the Tier 1 edit for `circuit-topology` and `schematic`, the bounded PCB edit for
  `pcb-placement-routing`; the view is "read + the role's reviewed proposals" (`specialistToolRegistry`) and the wrapper's refusal
  (`role_not_permitted_tool`) still covers everything outside the row. Dormant for specialists, each with its reason
  (`DORMANT_SPECIALIST_PROPOSALS`): `sirkit.placement.propose` and `sirkit.routing.propose` (long-running: the placement engine blocks
  the event loop 44-104 s per run; FreeRouting up to 180 s) and `sirkit.schematic.propose-component-replacement` (its sealer needs the
  pin-facts reads only the coordinator's gateway holds - the D2 stop condition, D21-37). Still never a granted execution, a view-session
  control, a Tier 3 id or a never-exposed id. The merge still judges every action by its family, but only a role offered a proposal
  tool can carry one (only its run's own seal reaches the merge). Proven by `b21-d2-proposing-roles.test.ts` and
  `b21-d2-provenance.test.ts`.
- **The owner may choose otherwise:** make the layout proposals live for the PCB specialist (with a concurrency cap on the engines,
  OD-107); wire the pin-facts reads into the specialist gateway (OD-109's option) so the replacement is live; or cut the dormant entries
  from the rows.

### OD-122 — The artifact ledger scope for "must not duplicate committed work", amended (B21-D2, 2026-09-26)

- **Question:** with specialists able to seal proposals, which artifact does the human review?
- **Amended:** one side-effecting artifact per user message. A specialist's sealed proposal is inert (Tier 2, human approval) and is
  NEVER shown for approval directly. After the merge: when the coordinator's first turn sealed nothing (no proposal, layout candidate
  or grant) and EXACTLY ONE action is accepted across the DAG with no escalation, part review request, contradicted result or unjudged
  competitor (`incomplete`: a task's attempt sealed an artifact no merged task judged - its result refused, or its run failed after the
  seal - or a planned proposing specialist never started), the runtime emits it as the run's own `proposal_ready` /
  `pcb_proposal_ready` / `layout_candidate_ready` (the family's own event, the shape the coordinator's seal emits, under the
  coordinator's run id) so the human reviews and approves it through the product's existing path; in every other case NOTHING is
  emitted for approval and the follow-up turn lists the accepted actions and escalations as data, says why nothing was presented and
  that the human decides. The one line saying which (presented, with the artifact's kind, id and digest, or withheld and why) is
  ALWAYS recorded on the run's trace, past the 12-line orchestration cap, within the trace recorder's own 32-warning bound (`TRACE_BOUNDS.maxWarnings`, shared with the coordinator's warnings; a full trace is marked `trace_event_capacity_reached`, never silently short). Deterministic (`specialistApprovalDecision`, over the merged view
  AND the scheduler's outcome), never by count or majority: two accepted actions, even two equal edits, present nothing. The accepted
  default's clause "specialists get `proposal_exists` on every attempt once the coordinator holds an artifact" is APPLIED: once the
  coordinator's own first turn emitted any of its four artifact events, the runtime tells the scheduler (`artifactHeld`) and no
  specialist is offered a proposal at all (each runs over the plain derivation, B's read-only frame, one line on the stream) - the
  stricter equivalent of `proposal_exists` (never offered rather than refused at the call), so a coordinator proposal and a specialist
  proposal on the same component never both exist in a run the route starts (a scheduler-level replay of an earlier committed result
  keeps its own seal - INFERRED; the route never replays). Proven approvable through the Tier 1 and PCB apply boundaries with the run's
  principal reauthorized by the real apply-authorization route (`b21-d2-approval.test.ts` cases 1 and 2; route case 3); the clause by
  approval case 8 (each of the four events through the real runtime) and route case 4; `incomplete` by approval case 7 and route case 7;
  the trace line by route case 6. The route-level resume and the `userMessageDigest` cross-run ledger stay B21-E's.
  [B21 E3, 2026-09-27] The route-level resume exists now and the ledger holds across the resumes of a run (`route-resume.md`): it claims the user
  message's one artifact on the run's resume record before a specialist's action is presented, so a resume never presents a second one
  (`already_presented`, the table's last row); the INFERRED clause above is CONFIRMED - a replayed result keeps its seal and the ledger
  decides. A message sent again without `resumeRunId` is a new run with its own ledger (no cross-run ledger, RECORDED).
- **The owner may choose otherwise:** present several accepted actions for the human to pick one (a UI change), or never present a
  specialist's artifact (every accepted action listed as data only - the B21-D behaviour); or let the specialists seal beside the
  coordinator's artifact and hand that artifact to the merge as an escalation party (a coordinator-vs-specialist conflict then escalates
  instead of never arising).

### The README row (`artifacts/ai-control-plane-b21/README.md`, a new row "B21-D2" after B21-D)

| B21-D2 specialists propose through their existing tools; provenance is the gateway's own seal | `specialist-proposals.md`; code `app/lib/agent/orchestration/role-tools.ts` (the live and dormant proposals, appended; six reasons in place), `app/lib/agent/orchestration/scheduler.ts` (the role's view, the proposing context, the seal collector and `attachSealedArtifacts`, the frame by the run's effective set, no proposal once the coordinator holds an artifact - in place and appended), `app/lib/agent/orchestration/merge.ts` (the merge's second check, `sealed-in-run`, the approval decision over the merged view and the scheduler's outcome - in place and appended), `app/api/chat/orchestration-runtime.ts` (the presentation of the one accepted action, always on the trace, the coordinator's artifact handed to the scheduler, the envelope's approval block - in place and appended) | CONFIRMED (the proposing roles offered their row's live, non-long-running proposals - the Tier 1 edit for the circuit and schematic specialists, the bounded PCB edit for the PCB specialist - through a 'read + reviewed proposals' view, the wrapper refusing everything else; the replacement and the two layout proposals dormant with their reasons; the proposing context with exactly its sealer's fact and none of the eight elevations; the frame, objective and result rule following the run's effective set; the scheduler collecting the run's own seals, per attempt, and making them the result's only proposedActions, a model-written artifact refused before the merge (`proposal_not_sealed_in_run`), a contract-refused seal refusing the result, never redacted; one proposal per run by the loop's single-flight; the merge checking the sealed set itself and recording `provenance: sealed-in-run`; one accepted action with nothing competing - no unjudged seal, no unrun proposing specialist (`incomplete`) - and nothing handed over by the coordinator presented as the run's own proposal event, the line always on the trace, and approved through the Tier 1 and PCB apply boundaries with the run's principal reauthorized by the real route; no specialist offered a proposal once the coordinator's turn emitted any of its four artifact events (OD-122's `proposal_exists` clause); the conflicting-proposals escalation end to end through the production POST in the two full-circuit DAGs; the never-execution sweep through the D2 wrapper minting nothing; OD-109, OD-120, OD-122 amended; D21-10's production half closed; D21-14's addendum; D21-37 found, medium (the replacement seal needs the coordinator-only pin-facts reads: dormant, OD-130's part review not reachable at the route, scenario 17's replacement DAG holds one proposing specialist); the adversarial review's 17 confirmed findings fixed test-first; 43 new cases in five suites; pin moves in D's merge fixture and suites, B's route case 4 (twice) and C's least-privilege case 1 and no-elevation case 4, with the A..D pages noted; no generator input changed) |

### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-D2 — specialists propose through their existing tools; provenance is the gateway's own seal (2026-09-26 local; increment workflow + lead; this commit)

- Test-first: the five D2 suites and the moved cases were written first and ran against the unchanged code (`d2-failing-first.log`: 11
  files, 34 of 103 failing, each on its own assertion or the missing export, except approval cases 1 and 2, which first stopped in their
  setup because the reauthorizing POST lacked the `origin` header CSRF requires; with it, rechecked against HEAD's four modules, both
  fail on their own assertions (`d2-failing-first-approval-recheck.log`); the flag-off byte-identity pin passing before and after by
  design); then the code (`d2-impl-1.log`: 94/96 - two provenance cases merged at the B21-D fixture's frozen clock, before a live seal's
  `createdAt`, which the merge's lifetime rule refuses; the suite now merges at the run's clock); then green (`d2-impl-2.log`).
- Adversarial review: 17 confirmed findings (4 medium, 13 low after verification) fixed test-first (`d2fix/f1-failing-first.log`: 14 of
  60 failing on their own assertions against the unfixed code; the test-strength findings proven by a deliberate breakage of the source,
  each failing, the source restored and verified by hash) - the specialists offered no proposal once the coordinator's turn holds an
  artifact (OD-122's `proposal_exists` clause, `artifactHeld`), the approval decision over the scheduler's outcome too (`incomplete`),
  the frame by the run's effective set, the presentation always on the trace with the artifact's kind, id and digest, the envelope
  header no longer "read-only", one proposal per run stated as the loop enforces it, and the page's scenario 17, D21-14 and D21-37
  statements.
- Code: `role-tools.ts` (the live and dormant proposals as data, `roleProposalToolIds`; six reasons in place), `scheduler.ts` (the
  role's 'read + reviewed proposals' view, the effective set and the wrapper admitting a live proposal of the role's list, the proposing
  context `specialistContextFor`, the seal collector and `attachSealedArtifacts` with `proposal_not_sealed_in_run`, the sealed digests on
  every outcome and replay, the frame, objective and result rule by the run's effective set, `artifactHeld`; in place and appended, no
  cited line moved), `merge.ts` (the merge's second check `proposal-not-sealed-in-run`, `provenance: sealed-in-run` on every action,
  the accepted verdict's text, the approval decision with `incomplete` and `unjudgedProposers`; in place and appended),
  `orchestration-runtime.ts` (the coordinator's first-turn artifacts handed to the scheduler, the presentation of the one accepted
  action as the run's own family event with its always-recorded line, the envelope's approval block and header; in place and
  appended); the workflow's one explicit entry for the route suite. No route, descriptor, UI, request key or generator input changed;
  census 165/162/3/0.
- Pin moves with their reasons: D's merge fixture relays test seals as the runs' own seal events; D's merge case 17 (provenance
  established); D's route cases 2..5 relay, case 3 asserts the one presented `proposal_ready`; B's route case 4 (a proposing role's live
  proposal; then its proposing opening line) and C's least-privilege case 1 and no-elevation case 4 (a proposing role's live proposal,
  context and view); the A..D pages noted; C's role table and D's own-code table moved with their data.
- Findings: D21-37, medium (a specialist cannot seal a component replacement: its sealer needs the pin-facts reads only the
  coordinator's gateway holds - the D2 stop condition, recorded, the replacement dormant as an owner option; OD-130's part review not
  reachable at the route; scenario 17's replacement DAG holds one proposing specialist, so it produces no structural disagreement).
- Gates re-run one job at a time (the lead re-runs them): every B21 suite and the CI guard; `app/api/chat/__tests__` in full;
  `app/lib/agent/__tests__` in full; the proposal families' and approval paths' suites; the exposure / tier / discovery pins;
  `app/lib/mcp/__tests__` in full; tsc; eslint on every new and changed file - figures in the report.
- Records: `specialist-proposals.md`; OD-109, OD-120, OD-122 amended; D21-10's production half closed; D21-14's addendum; D21-37 found.
  Live: every B21 behaviour with a real model BLOCKED-LIVE-QUALIFICATION (LB-9).

### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-D2 committed on chapter/b21-specialist-orchestration: the proposing roles offered their live proposals (the
Tier 1 edit, the bounded PCB edit) with exactly their sealer's fact and a frame that follows what the run offers, an artifact's
provenance the specialist run's own gateway seal (model-written artifacts refused before the merge, `sealed-in-run` recorded), one
accepted action with nothing competing presented as the run's own proposal and approvable through the existing path, no specialist
proposal beside a coordinator artifact (OD-122), the conflicting-proposals escalation reachable in production in the two full-circuit
DAGs; the replacement dormant (D21-37, medium: scenario 17 still has one proposing specialist); next B21-E". `nextAction`: "B21-E
test-first: provider routing by role (OD-117), the llm-provider breaker (OD-115), stop-reason normalization, the strict result tool
(OD-116), the additive run events and the trace block with the merge's decisions and the presentation (OD-112, OD-114's traced half,
OD-126, OD-127), the route-level resume and the userMessageDigest ledger (D21-4, OD-122), the mid-DAG commit (D21-17's open clause); the
owner's OD-109 / OD-120 option on the pin-facts reads (D21-37, which B21-F's timer-replacement disagreement case depends on)". The
report line for the closeout: `MULTI-AGENT STATUS: contracts and durable record (B21-A), the deterministic router, the no-provider path
and the bounded sequential scheduler with the store bound (B21-B), the nine roles with least-privilege subsets and the no-elevation proof
(B21-C), the deterministic merge with escalation and verification by the families' and the deterministic verifiers (B21-D), proposing
specialists whose artifacts are their own runs' gateway seals, the one accepted proposal presented for human approval and the
conflicting-proposals escalation reachable in production in the two full-circuit DAGs (B21-D2) delivered offline behind
SIRKIT_ORCHESTRATION_ENABLED; scenario 17's replacement disagreement not yet structural (D21-37); provider routing and evaluations
pending (B21-E..F); live disagreement / fallback / quota BLOCKED-LIVE-QUALIFICATION under LB-9`.

### Discovery closure clauses (`discovery.md` §4, appended to each defect; §10 gains a B21-D2 amendment)

- **D21-10 (no proposal-to-proposal comparison)** — the production half CLOSED by B21-D2: the proposing roles seal proposals through
  their own offered tools in their own runs and only those seals reach the merge, so two specialists that seal conflicting proposals on
  the same component escalate once through the production POST - one escalation record, nothing presented for approval, the stream's
  escalation line and the follow-up envelope naming what the human decides (`b21-d2-chat-proposals.test.ts` case 2). Reachable in the
  two full-circuit DAGs, the only plans with two proposing specialists; a peer whose conflicting seal never reaches the merge withholds
  any presentation (`incomplete`, route case 7); a coordinator artifact and a specialist proposal never both exist (OD-122, route case
  4). The earlier "CONFIRMED-unreachable in production" clause is superseded. A disagreement in prose is still carried as each
  specialist's unverified claims, never escalated structurally.
- **D21-14 (deterministic verification thin for circuit/topology claims)** — addendum by B21-D2: two circuit specialists' conflicting
  SEALED Tier 1 edits now escalate in the full-circuit DAGs (`b21-d2-chat-proposals.test.ts` case 2), so the recorded consequence "an
  escalation needs two artifacts, which no specialist carries today" is superseded there; a topology contradiction in PROSE still has no
  deterministic tie-breaker and is neither detected nor escalated.
- **D21-16 (a component replaceable only by its exact authority)** — addendum by B21-D2: a non-exact replacement target no longer
  reaches the merge at the route (a model-written artifact is refused before it, and no specialist can seal a replacement - D21-37);
  the merge's OD-130 rule stays as defense in depth.
- **D21-37 (new, medium) — a specialist cannot seal a component replacement.** The replacement sealer needs the server's published
  pin-facts reads (`replacementPinFacts`), which the chat route injects into the coordinator's gateway only; the specialist gateway is
  built with no option (OD-109), so through it the seal always blocks (`current-pin-authority-unavailable`). D2 keeps the replacement
  dormant for specialists (the stop condition: a specialist seal that would need a composition-root source like a port), so OD-130's
  part review is not reachable at the route, and runbook scenario 17 (the lower-power timer replacement) routes to the
  `component-replacement` DAG, whose ONE proposing specialist (circuit-topology, the Tier 1 edit) can disagree with no peer: its
  disagreement is not structural until this closes - B21-F's "timer replacement with provider disagreement" case depends on it.
  **CONFIRMED** (`b21-d2-provenance.test.ts` case 6; route case 5; the router's `DAG_ROLE_LISTS`). Closes: an owner decision (OD-109 /
  OD-120 option: wire the pin-facts reads into the specialist gateway, and a second proposing role in the replacement DAG). Source:
  B21-D2 and its adversarial review.
- **§10, B21-D2 amendment:** OD-109, OD-120 and OD-122 amended as `specialist-proposals.md` states them (the proposing context, the live
  and dormant proposals, one artifact per user message with the one accepted action presented, OD-122's `proposal_exists` clause
  applied as "no proposal offered once the coordinator holds an artifact", `incomplete`); D21-10's production half closed (the two
  full-circuit DAGs); D21-14's and D21-16's addenda; D21-37 found (medium, scenario 17); the B21-D suites relay their test-sealed
  artifacts as the runs' own seal events, D's merge case 17 and route case 3, B's route case 4 (twice) and C's least-privilege case 1
  and no-elevation case 4 moved with their reasons; the A..D pages noted; the adversarial review's 17 confirmed findings fixed
  test-first.

## 8. Citations, as of base 21ae845

The anchor is what is checked (it occurs exactly once in its file). For the four modules D2 changed (`role-tools.ts`, `scheduler.ts`,
`merge.ts`, `orchestration-runtime.ts`) the line is the CURRENT line and page case 5 checks it; for every other file the line is as of
the base, for the reader (none of them changed in D2).

| # | file | line | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/lib/agent/orchestration/role-tools.ts` | 244 | — | `export const SPECIALIST_PROPOSAL_TOOL_IDS: readonly string[] = Object.freeze([` | the live proposals a proposing role may be offered (OD-120 amended) |
| C2 | `app/lib/agent/orchestration/role-tools.ts` | 248 | — | `export const DORMANT_SPECIALIST_PROPOSALS: Readonly<Record<string, string>> = Object.freeze({` | the dormant ones, each with its reason |
| C3 | `app/lib/agent/orchestration/role-tools.ts` | 255 | — | `export function roleProposalToolIds(role: string): readonly string[] {` | a role's live proposals: its row intersected with the live list |
| C4 | `app/lib/agent/orchestration/role-tools.ts` | 41 | — | `const LIVE_PROPOSAL = "Live since B21-D2:` | the row reasons, moved in place (C's table IS these) |
| C5 | `app/lib/agent/orchestration/scheduler.ts` | 683 | — | `export const PROPOSAL_NOT_SEALED_IN_RUN = "proposal_not_sealed_in_run" as const;` | the scheduler's refusal of a model-written artifact |
| C6 | `app/lib/agent/orchestration/scheduler.ts` | 330 | — | `ONE sealed proposal of your role (an inert artifact the human reviews)` | a proposing role's objective |
| C7 | `app/lib/agent/orchestration/scheduler.ts` | 399 | — | `const derivedByRole = new Map<SpecialistRole, AgentRunContext>(` | every role's context, once per run |
| C8 | `app/lib/agent/orchestration/scheduler.ts` | 681 | — | `export const SEALER_CONTEXT_FACTS = Object.freeze({` | the one fact each live proposal's sealer needs (OD-109 amended) |
| C9 | `app/lib/agent/orchestration/scheduler.ts` | 691 | — | `export function specialistContextFor(context: AgentRunContext, role: SpecialistRole): AgentRunContext {` | the proposing context: the derivation plus its sealer's fact |
| C10 | `app/lib/agent/orchestration/scheduler.ts` | 704 | — | `export function specialistToolRegistry(registry: ToolRegistry, role: SpecialistRole): ToolRegistry {` | the 'read + the role's reviewed proposals' view |
| C11 | `app/lib/agent/orchestration/scheduler.ts` | 284 | — | `(operationClass === "propose" && proposals.has(declaration.toolId))` | the effective set admits the role's live proposals |
| C12 | `app/lib/agent/orchestration/scheduler.ts` | 301 | — | `SPECIALIST_PROPOSAL_TOOL_IDS.includes(input.toolId)` | the wrapper admits a live proposal of the role's list, nothing else but a read |
| C13 | `app/lib/agent/orchestration/scheduler.ts` | 151 | — | `sealedArtifactDigests?: readonly string[];` | every outcome carries what its run sealed |
| C14 | `app/lib/agent/orchestration/scheduler.ts` | 734 | — | `export function sealCollector(): {` | the collector of a run's own seal events |
| C15 | `app/lib/agent/orchestration/scheduler.ts` | 559 | — | `emit: (event) => { seals.collect(event);` | collected in the specialist's run, before the refusal filter |
| C16 | `app/lib/agent/orchestration/scheduler.ts` | 756 | — | `export function attachSealedArtifacts(parsed: ParsedResult, sealed: readonly SealedInRun[]): ParsedResult {` | only the sealed artifacts become proposedActions; any other entry refused |
| C17 | `app/lib/agent/orchestration/scheduler.ts` | 598 | — | `const parsed = attachSealedArtifacts(specialistResultFromCapture(specialist.capture, task.role), seals.artifacts);` | applied to the specialist's ONE result call ([B21 E1]: B's final-text parse removed, OD-116) |
| C18 | `app/lib/agent/orchestration/scheduler.ts` | 723 | — | `export function specialistFrameRules(proposing: boolean): string {` | the frame's rules line: B's unless the run offers a live proposal |
| C19 | `app/lib/agent/orchestration/merge.ts` | 810 | — | `if (!sealedInRun(task, action)) return notSealedInRun(action, index);` | the merge's second check, before the scope and the family |
| C20 | `app/lib/agent/orchestration/merge.ts` | 1033 | — | `export const MERGE_ARTIFACT_PROVENANCE = "sealed-in-run" as const;` | the provenance the merge records |
| C21 | `app/lib/agent/orchestration/merge.ts` | 941 | — | `provenance: action.findings.some((item) => item.code === MERGE_NOT_SEALED_CODE)` | on every action of the merge's view |
| C22 | `app/lib/agent/orchestration/merge.ts` | 1042 | — | `function notSealedInRun(action: ValidatedSpecialistResult["proposedActions"][number], index: number): JudgedAction {` | an action outside its task's sealed set: malformed, judged no further |
| C23 | `app/lib/agent/orchestration/scheduler.ts` | 464 | — | `sealedArtifactDigests: committed.record.document.proposedActions.map((action) => action.artifactDigest)` | a replay carries its committed result's seals |
| C24 | `app/lib/agent/orchestration/merge.ts` | 1060 | — | `export function specialistApprovalDecision(` | OD-122's rule, deterministic and ordered |
| C25 | `app/lib/agent/orchestration/merge.ts` | 1053 | — | `export const SPECIALIST_APPROVAL_OUTCOMES = Object.freeze([` | its closed outcomes |
| C26 | `app/api/chat/orchestration-runtime.ts` | 426 | — | `export function specialistProposalEvent(` | the accepted action as its family's own event, read back and digest-checked |
| C27 | `app/api/chat/orchestration-runtime.ts` | 444 | — | `export function presentSpecialistProposal(` | presented, or nothing and why |
| C28 | `app/api/chat/orchestration-runtime.ts` | 411 | — | `export const SPECIALIST_PROPOSAL_EVENTS = Object.freeze({` | each family's own event and tool |
| C29 | `app/api/chat/orchestration-runtime.ts` | 409 | — | `export const COORDINATOR_ARTIFACT_EVENTS: readonly string[] = Object.freeze([` | what the coordinator's own turn hands the human |
| C30 | `app/api/chat/orchestration-runtime.ts` | 224 | — | `else if (COORDINATOR_ARTIFACT_EVENTS.includes(event.type)) firstArtifacts.push(event.type);` | recorded from the first turn's events |
| C31 | `app/api/chat/orchestration-runtime.ts` | 262 | — | `const approval = presentSpecialistProposal({` | after the merge's lines, before the follow-up turn |
| C32 | `app/api/chat/orchestration-runtime.ts` | 363 | — | `...(approval ? { approval: { outcome: approval.outcome, presented: approval.presented } } : {})` | the envelope's approval block |
| C33 | `app/api/chat/orchestration-runtime.ts` | 320 | — | `APPROVAL says whether the one accepted action was handed to the human's existing review` | the envelope's header, amended |
| C34 | `app/lib/agent/orchestration/merge.ts` | 136 | — | `{ code: "proposal-not-sealed-in-run", decision: "malformed"` | the merge's own code (a row of MERGE_OWN_CODES) |
| C35 | `app/lib/agent/orchestration/scheduler.ts` | 685 | — | `export const SEALED_PROPOSALS_RULE = ` | the proposing roles' result rule |
| C36 | `app/lib/agent/loop.ts` | 178 | — | `if (!context.schematicHeadMark) {` | the schematic proposals' prerequisite, unchanged |
| C37 | `app/lib/agent/loop.ts` | 171 | — | `if (descriptor.toolId === "sirkit.pcb.propose-bounded-edit") {` | the bounded edit's prerequisite (a board and a basis), unchanged |
| C38 | `app/lib/agent/loop.ts` | 714 | — | `emitOnce({ type: "proposal_ready", runId: request.runId, toolId: resolved.toolId, proposal: sealedProposal });` | the loop emits a seal event only for a gateway-sealed proposal |
| C39 | `app/lib/agent/loop.ts` | 691 | — | `emitOnce({ type: "pcb_proposal_ready", runId: request.runId, toolId: resolved.toolId, proposal: sealedPcb });` | the same for the bounded PCB edit |
| C40 | `app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts` | 263 | — | `const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;` | a specialist run id is inside the sealed identifier grammar |
| C41 | `app/lib/engineering/approved-agent-mutations.ts` | 719 | — | `export async function applyApprovedTier1Proposal(input: ApprovedTier1ApplyInput): Promise<ApprovedTier1ApplyOutcome> {` | the Tier 1 apply boundary the page uses |
| C42 | `app/lib/engineering/approved-agent-mutations.ts` | 780 | — | `const denial = evaluateMembershipReauthorization(proposal.authorization, liveMembership, SCHEMATIC_APPLY_ROLES);` | its live-principal reauthorization |
| C43 | `app/lib/project/pcb-edit-approval-controller.internal.ts` | 48 | — | `export async function approveAndApplyPcbEdit(deps: PcbEditApplyDeps): Promise<ApprovedPcbApplyOutcome> {` | the PCB approval controller the editor uses |
| C44 | `app/api/pcb/apply-authorization/route.ts` | 34 | — | `export const POST = selectorEnvelopeJsonRoute(` | the one reauthorization route both apply paths consult |
| C45 | `app/lib/project/pcb-proposal-events.ts` | 38 | — | `export function receivePcbProposalReadyEvent(` | the page's full PCB proposal discriminator |
| C46 | `app/page.tsx` | 4635 | — | `case "proposal_ready": {` | the page's proposal_ready consumer |
| C47 | `app/api/chat/route.ts` | 397 | — | `const replacementFactsSource = resolveReplacementPinFactsSource();` | D21-37: the pin-facts reads, the coordinator's gateway only |
| C48 | `app/lib/engineering/replacement-proposal-assembler.ts` | 263 | — | `return blocked("current-pin-authority-unavailable",` | D21-37: without them the replacement seal blocks |
| C49 | `app/lib/agent/gateway.ts` | 393 | — | `currentPinFacts = await this.replacementPinFacts(instance.atomicPartRevisionId, "current");` | D21-37: the gateway reads them only when injected |
| C50 | `.github/workflows/deterministic-manufacturing.yml` | 148 | — | `app/api/chat/__tests__/b21-d2-chat-proposals.test.ts` | the one explicit CI entry [B24-D1, 2026-10-09] re-pinned +1: B24-D1's prompt-to-gerber start step at `:32` (OD-30) |
| C51 | `app/lib/agent/loop.ts` | 460 | — | `refuse("proposal_exists", proposalIssued ?` | the loop's own single-flight: a second proposal in one run is refused `proposal_exists` (unchanged) |
| C52 | `app/api/chat/orchestration-runtime.ts` | 172 | — | `export const ORCHESTRATION_TRACE_LINES_MAX = 12;` | the orchestration trace cap an always-recorded line passes |
| C53 | `app/lib/agent/orchestration/scheduler.ts` | 109 | — | `artifactHeld?: boolean;` | [fix] the coordinator run's fact: its own turn already handed the human an artifact (OD-122) |
| C54 | `app/lib/agent/orchestration/scheduler.ts` | 399 | — | `coordinator.artifactHeld === true ? deriveSpecialistContext(context) : specialistContextFor(context, task.role)` | [fix] then no sealer fact, so no proposal is offered to any specialist |
| C55 | `app/api/chat/orchestration-runtime.ts` | 243 | — | `...(firstArtifacts.length > 0 ? { artifactHeld: true } : {})` | [fix] the runtime hands the scheduler the coordinator's artifact fact |
| C56 | `app/lib/agent/orchestration/merge.ts` | 1077 | — | `export function unjudgedProposers(` | [fix] a peer's seal no merged task judged; a planned proposing specialist that never started |
| C57 | `app/lib/agent/orchestration/merge.ts` | 1067 | — | `return withheld("incomplete");` | [fix] `incomplete`: nothing competing cannot be established |
| C58 | `app/lib/agent/orchestration/scheduler.ts` | 774 | — | `export function offersProposal(` | [fix] whether the run's effective set offers a live proposal |
| C59 | `app/lib/agent/orchestration/scheduler.ts` | 343 | — | `specialistFrameRules(task.proposing === true),` | [fix] the frame's rules line by the run's effective set |
| C60 | `app/api/chat/orchestration-runtime.ts` | 455 | — | `- sealed in its specialist's own run and accepted by the merge; the human reviews it like any proposal; nothing was applied.` | [fix] the presented line: kind, artifact id and digest, always recorded on the trace |
| C61 | `app/lib/agent/orchestration/scheduler.ts` | 786 | — | `export const COORDINATOR_ARTIFACT_HELD_LINE =` | [fix] the one line saying no specialist is offered a proposal |
| C62 | `app/lib/agent/orchestration/scheduler.ts` | 783 | — | `export const PROPOSING_OPENING =` | [fix] the opening line of a run offered a live proposal |
