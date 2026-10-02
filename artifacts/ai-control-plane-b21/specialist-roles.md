# B21-C — the nine roles, least-privilege tool subsets per role, the no-elevation proof

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Tree
`chapter/b21-specialist-orchestration`, base `0396c9e` (the B21-B follow-up commit); written 2026-09-26. Every `[B21 C]` statement below
is pinned by `b21-c-page.test.ts` (the vocabularies quoted from the code, the trimmed full-circuit lists compared to the router's data,
every citation resolved by content, the cited lines of the new module current, every suite row with its real `it(` count) or by the
suite it names; the role table in section 1 equals `INTENTIONAL_ROLE_TOOL_IDS` and `ROLE_TOOL_REASONS` row for row
(`b21-c-role-tools.test.ts` case 4). C implements against the provider facts recorded in `provider-reference-notes.md` (OD-118) and
touches no provider feature (no request key, no adapter, no model choice), so no page was re-read; no model is called in any C suite -
every provider is a scripted in-process adapter behind the existing provider-neutral runtime.

## 0. What C delivers, and what it is not

- `app/lib/agent/orchestration/role-tools.ts` — the reviewed per-role allowlist (OD-120) as DATA with a reason per id
  (`ROLE_TOOL_REASONS`, C2; the rows `INTENTIONAL_ROLE_TOOL_IDS`, C1), the coordinator's row the exposure list ITSELF (C3), the checker
  `roleToolViolations` (C4) with its closed vocabulary (C6) and the derived report `roleExposureReport` (C5, the `mcpExposureReport`
  pattern: drift by role, id and reason; a hostile table reported, never thrown). **CONFIRMED** by `b21-c-role-tools.test.ts` (5 cases;
  adopted from an interrupted implementer, reviewed, section 6).
- The intersection in `buildRunToolset` (OD-121): an OPTIONAL `allowedToolIds` applied AFTER every existing gate (C9), narrowing only,
  A4L semantics (C10, C11): an over-long, unsorted, duplicated, unexposed, never-exposed or malformed list approves NOTHING - an empty
  toolset and one warning naming `allowlist_invalid`. The loop passes `AgentLoopDeps.allowedToolIds` (C12, C13); absent (every
  coordinator run) the toolset is byte-identical to HEAD. The judgement itself is `approvedRunAllowlist` (C38), whose bound and
  never-exposed clause are both reached by a case. **CONFIRMED** by `b21-c-least-privilege.test.ts` (10 cases).
- The scheduler per role: every specialist is offered `roleAllowedToolIds(role)` intersected with the reads its derived context admits
  (C17), its loop narrows to that list, its request persists it, its gateway wrapper refuses anything outside it; a role whose set is
  empty is NOT RUN (`role_has_no_tools`, C18, C36, C39) — never with the coordinator's set — yet keeps its task in the plan (the task
  ids come from the plan's roles alone, C40) and records the missing evidence as dissent `escalated`, which the outcome and the
  follow-up envelope carry. **CONFIRMED** (least-privilege cases 1, 4, 5, 8 and 9; route cases 4 and 17).
- The no-elevation proof (OD-109): `deriveSpecialistContext` hardened - built field by field (C14) - and the specialist gateway's
  refusal `role_context_elevated` (C37) of a context that claims grantability or a port (C15, C16, C20), applied before anything reaches
  the underlying gateway. **CONFIRMED** by `b21-c-no-elevation.test.ts` (5 cases) and the route suite's case 16 (section 3).
- The full-circuit list trimmed to the cap of four by a fixed priority, as router data (C21, C22, C23; OD-107 resolved by the lead;
  section 4), recruited only for a NEW circuit named from words (C41) and swapped to its layout variant only on its own layout ask
  (C42). **CONFIRMED** by `b21-b-router.test.ts` cases 8 and 9.
- This page, pinned by `b21-c-page.test.ts` (7 cases), with the reserved texts written out in section 7.
- **The adversarial review's fix round** (15 confirmed findings — 3 medium, 12 low — each fixed test-first, section 6): the
  full-circuit grammar, the not-run task in place of a dropped one, stable task ids across a resume, the loop's import on its own line,
  a route case with the component authority loaded, fixtures holding what production loads, and six strengthened proofs.

Closes **D21-7** (no per-role tool subset on the agent channel) and **D21-8** (nothing distinguished a coordinator from a specialist;
elevation was stopped only by where the minter is built); records **D21-9** (the pin-move rule; C adds no exposed descriptor) and
**D21-31** (the two schematic families in `EXECUTION_FAMILIES`, OD-123). The discovery closure clauses are in section 7.

**Not in C** (the task; the increment plan §7): no merge or comparator (B21-D), no provider routing, breaker, strict result tool,
events or trace block (B21-E), no evaluations (B21-F), no UI, no new route, no new exposed tool, no new discovery channel, no new
exclusion reason, no reserved-file edit (their texts are in section 7). **No generator input changed** — no descriptor, no route, no
UI control, no request key — so the route census stays 165 = 162 canonical + 3 factories + 0 raw and every generated artifact (the B04
registry CSVs, the B20 manifests and parity JSON, the B17-A control inventory) is byte-identical; no generator was re-run.
**CONFIRMED** (`git status` at the end of the increment lists only the files named in section 6).

**Zero authority by construction.** A role row grants nothing: it is a CEILING the run facts and the read-only view intersect. No
specialist is offered a mutation, a view control or a proposal (the read-only registry view, B21-B), no specialist context can claim a
grant or a port (the refusal below), no specialist deps carry the minter (structural, section 3), and the scheduler constructs no
gateway (the composition root's one bare specialist gateway, C33, is the only one under every wrapper). The B18 grants, the B19
evidence rules, B20's OD-45/90/91/92 provider rules and OD-81's directive matcher stand unchanged; `verifyAgentContextIntegrity` (C24,
C25) is untouched - the claim check is a second key in front of it, never a weakening of it.
[B21 D2, 2026-09-26] Since B21-D2 a proposing role is also offered its row's LIVE proposals (the Tier 1 edit, the bounded PCB edit) through a 'read + the role's reviewed proposals' view, and its context gains exactly its sealer's fact (the head mark or the PCB basis); still no mutation, no view control, no port, no minter and no grant (`specialist-proposals.md`).
[B21 D3, 2026-09-26] Since B21-D3 the one specialist gateway (C33, re-pinned by anchor) is no longer bare: its ONE option is the route's pin-facts reader (`specialistGatewayOptions`, OD-109 amended; still no minter, no port, no prompt version), and the schematic role is offered the replacement, whose sealer reads those published pin facts (`specialist-replacement.md`).

## 1. The roles and their tools (OD-120)

The runbook's nine roles (B21-C :819-:827; `SPECIALIST_ROLES`, B21-A) with their reviewed rows: one row per role and tool, the runbook
line, the tool's operation class and the reason the module holds for it (`ROLE_TOOL_REASONS`); the coordinator's row is the exposure
list itself and the cost/latency policy role's row names no tool (`ROLE_NOTES`). The table is the discovery's OD-120 proposal with NO
deviation: the code proves no id unable to serve its role. Ten row entries (nine distinct ids) are DORMANT in B21-C — never offered to a specialist while the
read-only view and OD-109 stand — and say so in their reason: the six entries of the five sealed proposals (a specialist reads only; B21-D decides
whether a role may produce one), the three external reads (OD-109 keeps the ports from every specialist; the owner's OD-109
alternative would make them effective) and the history read (the timeline rides the captured view, which a derived context never
holds). The proposing roles (OD-120) are `coordinator`, `circuit-topology`, `schematic`, `pcb-placement-routing`.

[B21 D2, 2026-09-26] Three of those entries (two distinct ids) are LIVE since B21-D2 and say so in their reason: the Tier 1 edit of the `circuit-topology` and `schematic` rows and the bounded PCB edit of the `pcb-placement-routing` row are offered to that role's specialist when the coordinator's verified context holds the sealer's fact (and, since the D2 review round, only while the coordinator's own turn has handed the human no artifact - OD-122), and sealed by the gateway in the specialist's own run (`specialist-proposals.md`); seven entries (six distinct ids) stay dormant, each saying why - the replacement proposal (its sealer needs the pin-facts reads only the coordinator's gateway holds), the two long-running layout proposals, the three external reads and the history read.

[B21 D3, 2026-09-26] Four of those entries (three distinct ids) are LIVE since B21-D3: the `schematic` row's replacement joins them - its sealer's published pin-facts reads reach the specialist gateway from the runtime (OD-109 amended) - and its reason says so; the two long-running layout proposals, the three external reads and the history read keep their reasons (`specialist-replacement.md`).

| role | runbook | tool | class | reason |
|---|---|---|---|---|
| `coordinator` | `:819` | the exposure list itself | — | The existing single-agent set, unchanged: this row IS INTENTIONAL_AGENT_EXPOSED_TOOL_IDS (the same frozen array, its reasons in agent-exposure.ts), never passed as an allowlist (the whole agent set, over the A4L bound). |
| `requirements-analyst` | `:820` | `sirkit.pcb.board-inspect` | read | The board as it stands (outline, footprints, nets): the physical facts a stated requirement must respect. |
| `requirements-analyst` | `:820` | `sirkit.project.canonical-revision-inspect` | read | The verified revision the requirements are written against, so every requirement names the state it read. |
| `requirements-analyst` | `:820` | `sirkit.project.history-inspect` | read | What the user already changed, so intent is read from the project's own timeline. Dormant in B21-C: the timeline rides the captured view, which a specialist context never holds. |
| `requirements-analyst` | `:820` | `sirkit.schematic.inspect` | read | The current circuit, so a stated requirement is compared with what the schematic already does. |
| `circuit-topology` | `:821` | `sirkit.schematic.inspect` | read | The topology under analysis: the components, pins and nets of the verified schematic. |
| `circuit-topology` | `:821` | `sirkit.schematic.propose-tier1-edit` | propose | The sealed schematic edit proposal: the only way a topology change is ever expressed, an inert artifact a human applies (permission Tier 2, OD-15). Live since B21-D2: offered to this role's specialist when the coordinator's verified context holds its sealer's fact; the gateway seals it in the specialist's own run, which is its only way into the merge (provenance: sealed-in-run). |
| `circuit-topology` | `:821` | `sirkit.selection.inspect` | read | The user's current selection, when the question is about the selected parts. |
| `circuit-topology` | `:821` | `sirkit.validation.connectivity-verify` | read | The deterministic connectivity check a topology claim is tested against: deterministic validation outranks consensus. |
| `component-sourcing-evidence` | `:822` | `sirkit.component-authority.inspect` | read | The server-owned exact component authority (B13): the only source that may name a replacement target; an inspection, never a binding. |
| `component-sourcing-evidence` | `:822` | `sirkit.mcp.observation-read` | read | An allowlisted, pinned external tool observation (B20-A4): evidence with labels, never authority. Dormant in B21-C: OD-109 keeps the ports from every specialist; the owner's OD-109 alternative would make it effective. |
| `component-sourcing-evidence` | `:822` | `sirkit.parts.evidence-read` | read | The offer cache's missing, conflicting or stale evidence for one exact MPN: evidence that proves nothing (B19). Dormant in B21-C: OD-109 keeps the ports from every specialist; the owner's OD-109 alternative would make it effective. |
| `component-sourcing-evidence` | `:822` | `sirkit.parts.external-search` | read | Registered distributor facts for one to five exact MPNs: sourcing evidence, never engineering proof (B19). Dormant in B21-C: OD-109 keeps the ports from every specialist; the owner's OD-109 alternative would make it effective. |
| `schematic` | `:823` | `sirkit.schematic.inspect` | read | The verified schematic the two sealed proposals compile against. |
| `schematic` | `:823` | `sirkit.schematic.propose-component-replacement` | propose | The sealed replacement proposal (B14): one exact-authority target, an inert artifact a human applies (permission Tier 2, OD-15, OD-123). Live since B21-D3: offered to this role's specialist when the coordinator's verified context holds its sealer's fact and the component authority; its sealer reads the published pin facts the composition root hands the specialist gateway (OD-109 amended). |
| `schematic` | `:823` | `sirkit.schematic.propose-tier1-edit` | propose | The sealed schematic edit proposal (B09): an inert artifact a human applies exactly (permission Tier 2, OD-15, OD-123). Live since B21-D2: offered to this role's specialist when the coordinator's verified context holds its sealer's fact; the gateway seals it in the specialist's own run, which is its only way into the merge (provenance: sealed-in-run). |
| `pcb-placement-routing` | `:824` | `sirkit.pcb.board-inspect` | read | The board the placement and routing question is about. |
| `pcb-placement-routing` | `:824` | `sirkit.pcb.mechanical-inspect` | read | The board extents and mounting holes: the placement constraints, within the model's result budget. |
| `pcb-placement-routing` | `:824` | `sirkit.pcb.propose-bounded-edit` | propose | The sealed bounded PCB edit (B15.3): an inert artifact a human applies in the PCB editor. Live since B21-D2: offered to this role's specialist when the coordinator's verified context holds its sealer's fact; the gateway seals it in the specialist's own run, which is its only way into the merge (provenance: sealed-in-run). |
| `pcb-placement-routing` | `:824` | `sirkit.pcb.via-inspect` | read | One net's vias and their padstack binding, for a routing question. |
| `pcb-placement-routing` | `:824` | `sirkit.placement.propose` | propose | The revision-bound placement candidate (B17-F) a human applies in the placement panel. Dormant for specialists (B21-D2): a long-running engine is never offered to a specialist - an owner option under OD-120. |
| `pcb-placement-routing` | `:824` | `sirkit.routing.propose` | propose | The revision-bound routing candidate (B17-F) a human applies in the routing panel. Dormant for specialists (B21-D2): a long-running engine is never offered to a specialist - an owner option under OD-120. |
| `verification-critic` | `:825` | `sirkit.pcb.revision-inspect` | read | The board's semantic content revision: the state a claim was checked against. |
| `verification-critic` | `:825` | `sirkit.pcb.via-inspect` | read | Via facts by net: a deterministic answer to a routing claim. |
| `verification-critic` | `:825` | `sirkit.validation.connectivity-verify` | read | The deterministic connectivity verifier over the verified board. |
| `verification-critic` | `:825` | `sirkit.validation.drc-run` | read | The deterministic design rule check over the verified board. |
| `manufacturing-readiness-reviewer` | `:826` | `sirkit.manufacturing.readiness-inspect` | read | The fabrication readiness REPORT (Tier 0 inspection): the reviewer cites it by reference; it authorizes nothing (OD-129). |
| `manufacturing-readiness-reviewer` | `:826` | `sirkit.validation.connectivity-verify` | read | The deterministic connectivity check the readiness review starts from. |
| `manufacturing-readiness-reviewer` | `:826` | `sirkit.validation.drc-run` | read | The deterministic design rule check the readiness review starts from. |
| `cost-latency-router` | `:827` | — | — | A policy role over the plan's caps and provider choice: it reads no project state, so it holds no tool, and a plan that names it does not run it (role_has_no_tools: its task records the dissent) until B21-E gives it a policy input. |

> [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): the `cost-latency-router` row's "until B21-E gives it a policy input" is `ROLE_NOTES`' own text (`role-tools.ts`, pinned equal to this cell), kept verbatim: B21-E (E1..E4) gave the role no policy input - E1's role table routes it inherit/inherit and it still holds no tool, so a plan naming it still records `role_has_no_tools`, a `degraded` event since B21-E2]

The checker's closed vocabulary (C6), in the order a violation list is written: `not_exposed` (an id outside the 33 [B22-B review, 2026-10-02: 36] or a descriptor not
agent-exposed), `granted_execution` (a `mutate` descriptor in a specialist row), `view_control` (a `view-session` descriptor in a
specialist row), `never_exposed_pattern` (a never-exposed pattern, a Tier 3 family name, or a class the exposure rule never admits),
`proposal_for_non_proposing_role`, `unsorted_or_duplicate` and `over_bound` (a row over the A4L bound of 32 ids admits NOTHING, C7).
The coordinator's row holds the single-agent set, so a granted execution and a view control are its own there; it is never passed
as an allowlist (33 ids, over the bound; [B22-B, 2026-10-01] 36 since the three named computation reads joined the agent set, and the row's note now states no count) — the coordinator's run carries none.

## 2. The intersection in `buildRunToolset` (OD-121) and a role with no tools

- **Where.** `buildRunToolset(registry, context, warn, allowedToolIds?)` runs every existing gate first — discovery, the exposure
  defense, the proposal prerequisites, the granted-execution gate, the view gate, the replacement resource, the MCP and external read
  facts, the read resources, wire strictness — and only then narrows (C9). A listed tool a gate withheld stays withheld: a granted
  execution for a run without the minter, a view control without a view, a proposal through the read-only view (least-privilege case 2).
  The gates' own warnings are unchanged by the list. The context digest, `DISCOVERY_CHANNELS` (C34) and the exclusion reasons are
  untouched: the list is not a discovery input.
- **A4L semantics** (the MCP `agentTools` rule, C31): at most 32 ids (`RUN_ALLOWLIST_MAX_IDS`, C11, equal to the contracts' bound C35),
  strictly ascending (sorted, duplicate-free), every id in the reviewed exposure list and matching no never-exposed pattern. Anything
  else — over the bound, unsorted, duplicated, a registry id outside the 33 [B22-B review, 2026-10-02: 36], an invented id, a never-exposed id, a non-string, a
  non-array, a list that throws while it is read — approves NOTHING: an empty toolset and exactly one warning naming `allowlist_invalid`
  (C10; least-privilege case 3). An empty list is valid and approves nothing without that warning. The judgement is
  `approvedRunAllowlist` (C38): a list of EXACTLY 32 sorted, exposed ids is approved and the 33 are not [B22-B review, 2026-10-02: 36] (the bound is live), and the
  never-exposed pattern clause refuses an id even when an exposure list names it — defense in depth, since no id of the reviewed 33 [B22-B review, 2026-10-02: 36]
  matches a pattern today and the membership test refuses every other id first (least-privilege case 7).
- **Without the input** the toolset is byte-identical to HEAD: the declarations and warnings of the coordinator's run and of the
  read-only specialist view, over a board-only and a schematic-plus-board context, equal the four digests RECORDED from HEAD `0396c9e`
  before `loop.ts` changed (`eng1-fc3f88593a73d586`, `eng1-3f9daa40bdba138b`, `eng1-c722e131c5f5d1d2`, `eng1-b3b19a8ae7577a93`,
  `c-record-head.log`; least-privilege case 6). The four `loop.ts` edits sit on existing lines (the deps field, the signature, the
  return, the call site); line 20 is HEAD's import again, and the helpers and the exposure import (on its own line, C43: an import is
  hoisted, and a line-anchored import gate such as the B19-D chat-closure walker sees an import only where a line starts with it,
  least-privilege case 10) are appended after `runAgentLoop`, so no line cited by a B20 page moved. The schematic-plus-board context
  now holds what production loads for U1's durable binding in place of the empty record set the digest was recorded over: the resource
  is available either way, so the declarations and warnings — and the digest — are the same (case 6 green over the new context).
- **Per role.** The scheduler computes each role's effective set ONCE (C17: the role's row intersected with the reads the derived
  context advertises through the read-only view), persists it as the request's `allowedToolIds`, passes it to the loop
  (`AgentLoopDeps.allowedToolIds`) and to the gateway wrapper (C19): what the model is offered IS what the record says (least-privilege
  case 1; B21-B's scheduler case 3 keeps asserting it per role). Over the schematic-plus-board context of the suite, the effective sets
  are: `requirements-analyst` board-inspect, canonical-revision-inspect, schematic.inspect; `circuit-topology` schematic.inspect,
  selection.inspect, connectivity-verify; `component-sourcing-evidence` component-authority.inspect; `schematic` schematic.inspect;
  `pcb-placement-routing` board-inspect, mechanical-inspect, via-inspect; `verification-critic` revision-inspect, via-inspect,
  connectivity-verify, drc-run; `manufacturing-readiness-reviewer` readiness-inspect, connectivity-verify, drc-run; `cost-latency-router`
  none. **CONFIRMED**.
- **A role with no tools.** The plan and its task ids come from the plan's roles alone (C40: `task-<n>-<role>` in plan order),
  never from this run's resources. A role whose effective set is empty is **not run** — never with the coordinator's set — but
  keeps its task: at its turn the task records the missing evidence as dissent `escalated` with the reason `role_has_no_tools: …` (C39;
  after a stale dissent of the same resume, at the next attempt so the two keys never collide — least-privilege case 8 part C proves
  both records exist, `stale` at the resuming attempt and `escalated` one past it; lead, 2026-09-26), its outcome is `escalated` with no
  step, and one visible warning names it (`Orchestration: specialist <role> not run (role_has_no_tools, task <taskId>): …`); the
  plan record's reason names every such role and the scheduled line counts only the roles that run. So every planned task is in the
  outcome's `tasks` or `notStarted`, and the follow-up coordinator turn's envelope (`specialistResultsEnvelope`; [B21 D fix] superseded
  in production by the merge's `mergedResultsEnvelope`, which carries the not-run task the same way - D's route case 6, D21-36; [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): B's function retired, D21-36 - its name kept here as the record's, the runtime naming it only in a one-line tombstone]) carries the not-run
  task with its reason — the model is told which evidence is missing, never handed a "completed" plan without it (least-privilege
  cases 4 and 8; route case 4). A resume for the same coordinator run and scope therefore never meets `plan_mismatch` because a
  resource loaded or failed to load this time: a committed result replays whatever the role's tools now, and a role that now has
  tools runs at its next attempt (least-privilege case 8, both directions). A FRESH plan none of whose roles has a tool is refused
  `plan_empty` with nothing written and no adapter call (case 4). The cost/latency policy role is never run (it holds no tool until
  B21-E gives it a policy input) [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): B21-E closed without giving it one - E1's role table routes it inherit/inherit - and it still holds no tool]. **The sourcing specialist, stated exactly:** its only read a specialist can hold under OD-109 is
  `component-authority.inspect`, which needs the server-owned component authority, and the route's loader (`loadRunComponentAuthority`)
  settles that authority NULL without a durable source (the local build), for a project where no schematic component has a durable
  binding (every new design), on a failed load and past its 5 s deadline — so the role runs only when
  at least one schematic component has a durable binding that loads within that deadline (least-privilege case 9, over the
  loader itself). Without it the replacement DAG runs two specialists and the sourcing task records its missing evidence (route
  case 4, the suite's default); with a durable source returning U1's binding all three run through the production POST (route
  case 17) [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-D3 the replacement DAG holds the schematic specialist too, so three specialists run without the authority and all four with it - `specialist-replacement.md` section 3; B's route cases 4 and 17 moved]. The suites' contexts hold what production loads for
  U1's binding (the physical-binding service's aggregate projected by the route's loader), never an empty record set the loader never
  produces. **CONFIRMED**. Consequence, recorded for the owner (OD-120): runbook :809's component specialist and B21-F's "missing
  component evidence" case run no sourcing model when no binding exists; the missing evidence is recorded as dissent and shown to the
  follow-up turn, never invented. [B21 E2, 2026-09-27] Since B21-E2 that visible line is a `degraded` event (`role_has_no_tools`, the same sentence), not a warning (`run-events-and-trace.md`, OD-126).
- **At the loop and at the gateway.** A call to a tool outside the role's list is never advertised, so the loop refuses it
  `unknown_tool` before it runs (one bounded refusal line on the coordinator's stream); invoked directly, the specialist gateway refuses
  it `role_not_permitted_tool` before the underlying gateway is asked (least-privilege case 5), and so does the wrapper the scheduler
  itself built for each run, for every read the run admits outside the role's row (no-elevation case 4; route case 16).

## 3. The no-elevation proof (OD-109)

What is **structural** (true by how the objects are built, pinned by inspection of what the code builds):

- `deriveSpecialistContext` (C14) builds the specialist's context FIELD BY FIELD from a closed list — never by spreading the
  coordinator's context — so a field the coordinator carries that the list does not name never reaches a specialist; the grant and port
  facts are written as their denial: `executionGrantsAvailable` false, no `externalAcquisitionAvailable`, no `mcpObservationAvailable`,
  no `grantableCapabilities`, no `grantLineageId`, `riskCeiling` `propose`, `approvalsAvailable` empty, no external authority, no head
  mark, no PCB basis, no view, the agent channel. From the WORST coordinator context (the minter bound, both ports, a head mark, a PCB
  basis, a captured view) the derived context holds none of it, passes `verifyAgentContextIntegrity`, claims nothing, is idempotent, and
  is offered no view tool, no history read, no proposal, no execution and no external read — while the coordinator's context is
  deep-equal before and after (`b21-c-no-elevation.test.ts` case 2).
  [B21 D2, 2026-09-26] `deriveSpecialistContext` is unchanged; a proposing role's specialist runs over `specialistContextFor`, which adds exactly its sealer's fact to this derivation and still claims none of the eight elevations (`specialist-proposals.md`).
- For every role the scheduler builds the specialist's loop deps with a CLOSED key set — `adapter`, `allowedToolIds`, `context`,
  `contextWarnings`, `emit`, `gateway`, `registry`, `system` — and no `executionGrants` key although its own deps carry the
  coordinator's minter; each loop runs over the read-only registry view and the derived context; the scheduler constructs no gateway
  (a counted mock), and every wrapper delegates to the one gateway it was handed and refuses, before it, every read the run admits
  outside the role's row (no-elevation case 4). Through the production POST the request constructs exactly TWO gateways whatever the
  number of roles — the coordinator's and ONE bare specialist gateway (C33, no option at all) — and the scheduler is handed that bare
  one, by IDENTITY (the second instance constructed, never the coordinator's), under every specialist's wrapper
  (`b21-b-chat-router.test.ts` case 16, extending case 14; the review showed case 14's probes pass through the coordinator's gateway
  too, so only the identity check tells them apart).
  [B21 D3, 2026-09-26] Still two gateways per request, the second handed to the scheduler by identity - but since B21-D3 it is built with ONE option, the route's pin-facts reader (C33 re-pinned by anchor; no option at all only when no catalog source is configured), and the schematic role is offered the replacement (`specialist-replacement.md`). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-D2 a proposing role's loop runs over `specialistContextFor` and the 'read + reviewed proposals' view, not the read-only view and the derived context - no-elevation case 4, retitled]

What is **behavioural** (true by what a call does, proven by calling):

- A specialist context that claims grantability or a port — each of the eight ways alone (`SPECIALIST_CONTEXT_CLAIMS`, C20:
  `executionGrantsAvailable`, `grantableCapabilities`, `grantLineageId`, `riskCeiling` above `propose`, `approvalsAvailable`,
  `actorGrantableCapability`, `externalAcquisitionAvailable`, `mcpObservationAvailable`) — is refused `role_context_elevated` by the
  specialist gateway BEFORE the underlying gateway is reached (a spy: zero calls), whatever the tool; the coordinator's own grantable
  context is refused the same way; a context that throws while it is read claims everything and is refused, never thrown; each port
  claim also holds by its discovery AUTHORITY alone (`external-observation` / `external-mcp-observation` listed with both flags false)
  (no-elevation case 1). The six grant claims are exactly what `verifyAgentContextIntegrity` accepts whenever they agree with each other
  (C25: an in-process caller assembling a grantable context passes it, D21-8); the claim check is the second key that refuses them for
  a specialist whatever they agree with.
- The B18-C never-execution sweep, re-run through the specialist gateway for ALL NINE roles over the whole registry, with a REAL minter
  under it (the worst composition) and with the bare gateway: no descriptor yields a grant, a proposal, a view command or a layout
  candidate and the minter is never called — while the same move of R3 through the coordinator's own composition does mint (the sweep
  is not vacuous); the coordinator's own context through the specialist gateway is refused for every descriptor; nested delegation in
  the move tool's arguments mints nothing — and, as the arguments of a read the role may call (`drc-run` for the critic, over the
  minter-bearing gateway), the same four payloads are handed on verbatim to that read, never re-dispatched on their content, and
  refused by its strict schema (`invalid_input`), minting nothing; a forged Tier 3 name is `unknown_tool` at the loop and
  `role_not_permitted_tool` at the gateway (no-elevation case 3).
- The follow-up coordinator turn's narrowing is the same wrapper without a list: over the coordinator's context with its authority
  withdrawn a read passes and a proposal, a view command and an execution are refused; the coordinator's grantable context is refused
  `role_context_elevated` — the follow-up turn cannot be elevated either (no-elevation case 5; B21-B's route case 9 keeps pinning
  `followUpDeps`).
- A call outside the role's list: `unknown_tool` at the loop, `role_not_permitted_tool` at the gateway (`b21-c-least-privilege.test.ts`
  case 5).

The executor, the grant tree, the approval controllers, the journals and `pcb/fab` stay outside every orchestration module's import
closure (B21-A's gate, now over six modules; case 6 adds `role-tools.ts`), and the minter is still created only by the `/api/chat`
composition root (C26 is the context's own grantability rule, untouched).

## 4. The full-circuit list trimmed to the cap (OD-107, resolved)

Runbook :810 names the full-circuit specialists "as needed": `FULL_CIRCUIT_RUNBOOK_ROLES` (C22) keeps the runbook's list as data —
`coordinator`, `requirements-analyst`, `circuit-topology`, `component-sourcing-evidence`, `schematic`, `pcb-placement-routing`, `verification-critic` — six specialists, over OD-107's cap of four. B built that list and the scheduler refused every "Design a …" plan
`plan_exceeds_specialist_cap` (the coordinator's answer stood under a warning). The lead resolved the open decision: the router trims the
list to the cap by a FIXED priority (`FULL_CIRCUIT_TRIM`, C21) — `circuit-topology`, `component-sourcing-evidence`, `schematic`, `verification-critic`;
the `requirements-analyst` is folded into the coordinator's own turn;
and `pcb-placement-routing` runs only when a board exists and then replaces `schematic` when the message asks for layout. So:

- `D-full-circuit-layout` (:810; a new circuit named from words with its own layout ask, with a board present) → `full-circuit-layout`:
  `coordinator`, `circuit-topology`, `component-sourcing-evidence`, `pcb-placement-routing`, `verification-critic`;
- `D-full-circuit-creation` (:810; every other full-circuit ask) → `full-circuit-creation`: `coordinator`, `circuit-topology`, `component-sourcing-evidence`, `schematic`, `verification-critic`.

The router applies the layout rule first (C23). A routed plan therefore never exceeds four specialists and `plan_exceeds_specialist_cap`
stays the guard (a hand-built plan over the cap is still refused, B21-B's scheduler case 2 over the runbook's six); the owner may still
raise the cap (OD-107), which would restore the runbook's list by a data change. **CONFIRMED** by `b21-b-router.test.ts` cases 8 and 9
(and case 3's pinned lists, a reviewed pin move); B's page carries the new rule rows.

**Which messages recruit it ([B21 C fix], review).** B's rule took any make / build / create / draw at the head: with the list
trimmed to four, "Make the LED brighter." or "Make the placement more compact." (a message that reaches `/api/chat` through the
composer's "Ask the assistant instead" or a direct POST) would have run four paid specialists and a follow-up turn. The rule now
recruits only a new circuit named from words (C41): the verb at the head, an indefinite object (a / an, after an optional me / us)
and a circuit-kind noun inside that object (before its first preposition or clause word: with, for, and, that, which, to, on, in,
of, from, using, around, so, where, while, at, by, into, onto, or a comma, colon, semicolon or parenthesis) — a closed list of
circuit kinds (circuit, schematic, blinker, flasher, oscillator, timer, amplifier, preamp, converter, regulator, supply, filter,
logger, driver, controller, charger, detector, counter, generator, transmitter, receiver, inverter, rectifier, alarm, thermostat,
dimmer, meter, monitor, tester, mixer, synthesizer, interface, sensor) that must HEAD the object, optionally followed only by a
container noun (board, module, design, project, kit, system, unit, stage, section, block) — so "a buck converter board" is a circuit
while "a schematic symbol", "a sensor footprint", "a timer part" and "a counter-clockwise turn" name none [lead correction
2026-09-26: the fixed grammar accepted a circuit-kind word anywhere in the object, so a modifier-position word still recruited four
specialists; router case 9 pins both directions]. "Make the placement more compact." and "Make the routing
tidier." are now `D-bounded-pcb-proposal` (runbook :807, one PCB specialist; `tidier` and `neater` joined its layout-quality verbs),
"Make a compact placement for the regulator circuit." too (its object names no circuit), and "Make the LED brighter.", "Build the
BOM." or "Draw the power supply section again." stay one coordinator turn. The layout variant needs its own layout ask (C42): a
layout noun after "with" / "and" (with a compact placement, and its layout, with the routing done) or "and place / route / lay out
it" — so "Generate a schematic for the selected section." and "Design an audio signal routing switch circuit." keep the schematic
specialist, and the selection words that only the bounded PCB rule reads (with a selection) never swap it. The grammar fails toward
one coordinator turn: a creation ask it does not recognise ("Design the power supply for this board.", "Build a 12 V to 5 V buck
converter." — `to` ends the object) stays `single`, which costs nothing HEAD did not (at HEAD every full-circuit plan was refused by
the cap and the coordinator's answer stood); a circuit-kind word used as a function inside the object ("a mixer with signal
routing") can still select the layout variant. **CONFIRMED** by `b21-b-router.test.ts` case 9.

## 5. What did not move: the pins, D21-9's rule, D21-31

- **No new exposed tool, no new descriptor, no new discovery channel, no new exclusion reason, no new route, no UI, no request key.** The
  exposure list stays 33 and `DISCOVERY_CHANNELS` stays five (C34); every exposure, discovery-vocabulary and byte-artifact pin is green
  and untouched (section 6's gates). There is no generator input change; the route census stays 165.
- **D21-9, the pin-move rule (RECORDED):** any new agent-exposed descriptor moves at least seven pins and the B04/B01 byte artifacts —
  the exact-list pins `b18-c-exposure-lift.test.ts:58` and `b17-f-agent-exposure.test.ts:92-93`; the literal-33 pins
  `b20-a4-observation-descriptor.test.ts:88`, `b20-b3-mcp-subset-move.test.ts:136-137` and `b20-c1-three-way-parity.test.ts:241`
  (`{ registry: 42, agentExposed: 33, mcpExposed: 9, agentOnly: 24 }`); `b20-b1-mcp-exposure.test.ts:441-449` (the channel list and the
  22 exclusion reasons, for a new channel or reason); the `INTENTIONAL_…length` counts of the B09 / B11 closure suites; and the
  byte-matched `tool-registry.csv`, `non-callable-coverage.csv`, `provider-schema-parity.json` and the B01 toolability matrix
  (`b04-tool-registry.test.ts:465-476`). Each line was re-read at the base (**CONFIRMED**). [B21 C fix] C's OWN pins join the rule
  (review): `b21-c-least-privilege.test.ts` case 1 spells the reads each role is offered over the suite's context
  (`FULL_CONTEXT_EFFECTIVE`, the coordinator's admitted reads included), and case 6 pins four byte digests over the declarations and
  warnings of the coordinator's run and the specialist view (`eng1-fc3f88593a73d586`, `eng1-3f9daa40bdba138b`,
  `eng1-c722e131c5f5d1d2`, `eng1-b3b19a8ae7577a93`, RECORDED from HEAD `0396c9e`): a new read descriptor, or a changed description,
  schema bound or withholding warning of an exposed one, moves those too — each is a byte-identity-to-HEAD proof, re-recorded (never
  loosened) in the same reviewed move. C adds NO descriptor: every role row is a subset of the existing 33, so none of them moves.
- **D21-31 (RECORDED), OD-123:** `schematic.set-property` and `schematic.move-rotate` are in `EXECUTION_FAMILIES` (C30), the closed
  eight-list the B18-B pin fixes, yet no schematic descriptor is a granted execution and OD-15 defers schematic execution. They stay
  reserved and unchanged; the `schematic` role receives the two sealed Tier 2 proposal tools plus `schematic.inspect` only (both
  proposals dormant in C). [B21 D2, 2026-09-26] The Tier 1 edit is live for the schematic specialist since D2; the replacement stays dormant (the pin-facts reads) - `specialist-proposals.md`. [B21 D3, 2026-09-26] Since B21-D3 the replacement is live for the schematic specialist too (`specialist-replacement.md`).

## 6. Suites, evidence, the pin moves, gates

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-c-role-tools.test.ts` | 5 | the report clean; every row a sorted, duplicate-free subset of the 33 [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): the exposure list, 36 since B22-B] within 32, no execution, view control, never-exposed or Tier 3 id, a proposal only in a proposing row, the coordinator's row the exposure list itself, the cost/latency role none, OD-120's table exactly, a reason per id as data; every violation reason from a crafted table, a hostile table never thrown; the table equals this page's; the module names no route, executor, grant or approval |
| `app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts` | 10 | every role offered exactly its row intersected with the admitted reads, persisted and passed the same; the intersection after every gate, narrowing only; A4L refusals approve nothing with `allowlist_invalid`; a role with no tools not run, its task kept with its dissent (`role_has_no_tools`); `unknown_tool` at the loop and `role_not_permitted_tool` at the gateway; byte-identical to HEAD without the input; [fix] the 32-id bound and the never-exposed clause live; stable task ids and a same-scope resume across the authority's presence, the envelope naming the missing evidence ([superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): the outcome names it; the envelope's carriage is route case 4 and D's route case 6 since the D21-36 retirement]); the sourcing specialist only with a loaded durable binding; loop.ts's imports visible to a line-anchored gate |
| `app/lib/agent/orchestration/__tests__/b21-c-no-elevation.test.ts` | 5 | the eight claims refused `role_context_elevated` before the gateway (each port claim by its flag and by its authority alone); the hardened derivation; the never-execution sweep for all nine roles mints nothing, nested payloads through a permitted read handed on verbatim; the specialist deps closed and minter-free, no gateway constructed, the role's list enforced by the wrapper the scheduler built; the follow-up turn not elevatable |
| `app/lib/agent/orchestration/__tests__/b21-c-page.test.ts` | 7 | this page |
| `app/lib/agent/orchestration/__tests__/b21-b-router.test.ts` | 9 | B's seven cases, case 3's full-circuit pins moved; case 8 the trim; case 9 the full-circuit grammar (a new circuit named from words; the layout variant's own ask) |
| `app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts` | 14 | B's fourteen cases, five pin moves (below) |
| `app/lib/agent/orchestration/__tests__/b21-b-page.test.ts` | 8 | B's seven cases; case 8 the run shapes B's page states equal the route suite's pins |
| `app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts` | 7 | A's five cases (the entry set pinned to six modules); case 6 role-tools.ts; [B21 D] case 7 merge.ts (seven modules) |
| `app/api/chat/__tests__/b21-b-chat-router.test.ts` | 18 | B's sixteen `it(` blocks, pin moves (below); case 16 the per-role structure through the production POST (the bare gateway by identity, the role's list at the gateway); case 17 all three specialists with the component authority loaded |

**Test-first.** The adopted `b21-c-role-tools.test.ts` failed at import before any code (`Cannot find module '../role-tools'`,
`c-failing-first-adopted.log`). The HEAD digests were RECORDED with a temporary probe before `loop.ts` changed (`c-record-head.log`;
the probe was deleted). Then every new and changed suite ran against the unchanged code (`c-failing-first.log`): three C suites failed
at import (`Cannot find module '../role-tools'`) and 17 cases failed — no-elevation 1-5, router 3 and 8, the gate's 1, 3, 5 and 6,
scheduler 2, route 4, 11, 12b, 15 and 16; the other pin moves passed on the old code (they keep B's proofs meaningful under C's per-role
sets and do not test new behaviour). Then the code (`c-impl-1.log`: all green but the page and one text-scan word), then green
(`c-green.log`: the eleven orchestration suites, the route suite and the CI guard - 13 files, 119 tests).

**The adopted suite, reviewed.** Kept: the export surface, the seven-reason vocabulary, OD-120's table, the hostile-table cases and the
module text scan. Changed: the reason per id is data (`ROLE_TOOL_REASONS`, `ROLE_NOTES`) and the page's reason cell must equal it; case
2 also pins `roleAllowedToolIds("__proto__")`; case 3 pins the coordinator's own row (a granted execution and a view control are its
own) and that an over-long or unsorted row admits nothing (`toolIds` empty).

**Pin moves, each with its reason written next to it in the suite.** `b21-b-router.test.ts` case 3 — the full-circuit list and
`DAG_ROLE_LISTS` pinned to the trimmed lists (OD-107 resolved). `b21-b-scheduler.test.ts` — the rig's coordinator context gains the
server-owned component authority (the one thing the sourcing specialist can read under OD-109; without it C does not run the role and
B's three-specialist proofs would lose their middle task) — [fix] what production loads for a schematic whose U1 holds one durable
binding (the schematic joins the context, the record is U1's, loaded by the route's own loader), never the empty record set the first
C pass used; case 2 refuses the runbook's six (`FULL_CIRCUIT_RUNBOOK_ROLES`) instead of the now-trimmed router list; case 3 passes the
role to `specialistAllowedToolIds`; cases 4, 8 and 14 script reads inside the calling role's row (`board-inspect` is not the critic's
or the circuit specialist's tool). `b21-a-import-gates.test.ts` cases 1, 3 and 5 — five modules to six. `b21-b-chat-router.test.ts`
cases 4, 11, 12b and 15 — the route's context holds no component authority (no durable binding), so the sourcing specialist has no
tools and is not run: two specialists run, the sourcing task records its `role_has_no_tools` dissent (the record ends at revision 6
with the plan's three tasks; [B21 D] at revision 8 once the merge records its two decisions; [B21 D3, 2026-09-26] at revision 11 since the schematic specialist joined the replacement DAG, `specialist-replacement.md`), and the hang and the directive-looking summary move to the verification critic (the second specialist to
run); case 4's title now says exactly that. The pages that count these suites (A's §7, B's §6) carry the new `it(` counts; B's page
gains the `D-full-circuit-layout` row, the trimmed list, the run shapes of route cases 4 and 17, and its citations of `router.ts` and
`scheduler.ts` are re-pinned to the lines as left (page case 7 checks them).

**The review's fix round** (15 confirmed findings; every reproducing case ran against the unchanged code first, `fix/failing-first.log`:
6 files, 16 cases failing; then the code, `fix/impl-1.log`: the code-bearing suites 6 files / 61 tests green). For a test-strength
finding the strengthened case passed on the code as it was, so each was proven by a deliberate breakage of the source, the run, and the
source restored and checked by sha256 against `fix/breakage-before.sha256` (`fix/breakage-<finding>.log`):

| finding | reproducing case | failure observed first | fix |
|---|---|---|---|
| regressions-1 (medium) | router case 9 | "Make the placement more compact." routed `D-full-circuit-layout` (four specialists); "Make the LED brighter." `D-full-circuit-creation` | the full-circuit rule needs a new circuit named from words (C41); `tidier` / `neater` join the layout-quality verbs |
| regressions-2 (low) | least-privilege cases 1, 4, 8; route case 4 | the dropped role absent from the outcome and from the follow-up envelope | a role with no tools keeps its task and records dissent `escalated` (`role_has_no_tools`), carried in the outcome and the envelope (C39) |
| regressions-3 (low) | least-privilege case 8; route case 16 | a same-scope resume without the authority refused `plan_mismatch`; the critic renumbered `task-2` | the plan and the task ids from the plan's roles only (C40) |
| regressions-4 (low) | least-privilege case 10 | the B19-D walker's pattern did not find `../engineering/agent-exposure` in loop.ts | line 20 is HEAD's again; the exposure import on its own line at the end (C43) |
| regressions-5 (low) | route case 17 (a coverage finding) | passed on the code; breakage: the derived context stripped of the component authority fails case 17 only (17 of 18 green) | the route case with a durable source returning U1's binding; case 4's title |
| regressions-6 (low) | page case 4 | the D21-9 rule did not name C's own pins | the rule names `FULL_CONTEXT_EFFECTIVE` and the four HEAD digests (section 5) |
| coverage-1 (medium) | least-privilege case 9; page case 7 | the fixture context held zero records; the page claimed the fixture runtime as such runs the role | the fixtures hold what production loads for U1's binding; the page and OD-120 state the real condition (section 2) |
| coverage-2 (low), tests-9 (low) | B page case 8 | the page's "revision 7 (route case 4)" against case 4's `[5]`; case 4's title | B's page lines and case 4's title re-stated; route case 17 carries revision 7 |
| coverage-3 (low) | router case 9 | "Generate a schematic for the selected section." and "Design an audio signal routing switch circuit." swapped to the layout list | the layout variant's own ask (C42), no selection word |
| tests-1 (medium) | no-elevation case 4; route case 16 | passed; breakage: the scheduler's wrapper built without the role's list fails both (2 of 23) | the wrapper the scheduler built is probed with every admitted read outside the row |
| tests-2 (low) | route case 16 | passed; breakage: the runtime hands the scheduler the coordinator's gateway — only case 16 fails (case 14 still passes) | the gateway mock records instances; the scheduler's gateway IS the second, bare one |
| tests-4 (low) | no-elevation case 3 | passed; breakage: a wrapper that re-dispatches on a nested `toolId` fails it (`not_callable` for `delete-item` in place of the read's `invalid_input`) | the nested payloads also go through a permitted read, handed on verbatim |
| tests-5 (low) | least-privilege case 7 | failed first (`approvedRunAllowlist` did not exist); breakages: the pattern clause removed, the bound off by one — each fails case 7 | `approvedRunAllowlist` (C38), exported for the suite; case 3's label corrected |
| tests-6 (low) | no-elevation case 1 | passed; breakage: the authority halves of the two port claims removed fails it | the two claims by their authority alone |

**Files of the increment.** New: `app/lib/agent/orchestration/role-tools.ts`, the four C suites,
`app/lib/agent/orchestration/__tests__/_role-fixtures.ts` (shared assembled contexts, U1's loaded authority and a scripted per-role
adapter, not a test file) and this page. Changed: `app/lib/agent/loop.ts` (four edits on existing lines; line 20 HEAD's again; the
helpers and one import appended after `runAgentLoop`), `app/lib/agent/orchestration/scheduler.ts`,
`app/lib/agent/orchestration/router.ts`, the router, scheduler, gate, B page and route suites (the added cases and the pin moves above),
`orchestration-contracts.md` (the gate row) and `task-complexity-router.md` (the rule rows, the trimmed list, the run shapes, the suite
rows, the re-pinned citations). `app/api/chat/orchestration-runtime.ts` is unchanged (the envelope carries the not-run task as it
carries any escalated one). No workflow change: the new suites ride the `app/lib/agent/orchestration/__tests__` directory filter
(OD-124) and the route suite keeps its explicit entry.

**Gates** (one heavy job at a time, through the lock runner; figures below): the C suites and every B21 suite; `app/api/chat/__tests__`
in full; `app/lib/agent/__tests__` (b09-*, b11-*, b18-*, b20-a4-*); the exposure / tier / discovery pins (b04-tool-registry,
b17-f-agent-exposure, b18-a-permission-tiers, b18-c-*, b20-a4-observation-descriptor, b20-b1-mcp-exposure, b20-b3-mcp-subset-move,
b20-c1-three-way-parity); the MCP gates (b20-b2, b20-d3) and the B20 page suites that cite `loop.ts` by line; the CI guard; tsc;
eslint on every new and changed file.

Figures of the review's fix round (the first C pass had 13 / 119, 15 / 95, 26 / 308, 32 / 282 and 26 / 642 on the same sets; its
logs are `c-*.log`, these are `fix/gate-*.log`):

- The eleven suites under `app/lib/agent/orchestration/__tests__`, `b21-b-chat-router` and the CI guard `b19-e-ci-job-scope`: 13 files, 127 tests, all passed (`fix/gate-b21.log`). **CONFIRMED**
- `app/api/chat/__tests__` in full: 15 files, 96 tests, all passed (`fix/gate-chat.log`; the flag-off streams byte-identical to HEAD's, the B19-D closure gate green). **CONFIRMED**
- `app/lib/agent/__tests__` b09-*, b11-*, b18-*, b20-a4-*: 26 files, 308 tests, all passed (`fix/gate-agent.log`; the B11 tripwires and the provider literal untouched). **CONFIRMED**
- The exposure / tier / discovery pins (b04-tool-registry with its byte-matched artifacts, b17-f-agent-exposure, b18-a-permission-tiers, every b18-c-* engineering suite, b20-a4-observation-descriptor, b20-b1-mcp-exposure, b20-b3-mcp-subset-move, b20-c1-three-way-parity), the MCP gates (b20-b2-import-gates, b20-d3-authority-import-gates) and the chat closure ratchets (b18-b-import-gates, b16-0-24 tranche-17 confinement, b20-b2 route tree, route matrices and route policy): 32 files, 282 tests, all passed (`fix/gate-eng.log`). **CONFIRMED**
- `app/lib/mcp/__tests__` in full (every B20 page suite, the two that cite `loop.ts` by line included): 26 files, 642 tests, all passed (`fix/gate-mcp-pages.log`); every `loop.ts` hunk above the appended tail is a one-line replacement and the highest `loop.ts:<line>` cited under `artifacts/` is 767, so no B20 citation moved. **CONFIRMED**
- tsc: 0 errors (`fix/tsc.log`). eslint on the fourteen new and changed code files: clean (`fix/eslint.log`). No control byte and no CRLF in any of the seventeen new or changed files. No generator input changed (no descriptor, route, UI control or request key), so no generator was re-run: the B04/B01 byte artifacts are byte-identical (b04-tool-registry, gate 4) and `git status` lists only the files of section 6. **CONFIRMED**

Live behaviour with a real model: **BLOCKED-LIVE-QUALIFICATION** (LB-9). **UNKNOWN**: whether the owner keeps the ten dormant row entries in
their rows (OD-120 as proposed) or prefers the rows cut to what C can offer; nothing in C depends on the answer. [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-D2 and D3 four of the ten are live - section 1's notes - and the owner's question stands for the six still dormant]

## 7. For the lead — the reserved texts, in full

Each `### OD-…` below is the entry for `OWNER_DECISIONS.md` (as `## OD-…`), in its format: OD-107 gains the resolution of its open
full-circuit decision, OD-109 its "as applied" text replacing A's "records; B21-C proves", and OD-120, OD-121 and OD-123 are new entries.
Every text below is as of the review's fix round (2026-09-26).

### OD-107 — The full-circuit list versus the cap of four, resolved (B21-C, 2026-09-26)

- **Question (B21-B):** runbook :810 names six specialists for a full circuit ("requirements, architecture/circuit, component, schematic,
  PCB and verifier as needed"); OD-107's cap is four, so every full-circuit plan was refused `plan_exceeds_specialist_cap`.
- **Resolution applied (the lead's direction):** the router trims the list "as needed" to the cap by a FIXED priority, as data
  (`FULL_CIRCUIT_TRIM` in `app/lib/agent/orchestration/router.ts`): `circuit-topology`, `component-sourcing-evidence`, `schematic`,
  `verification-critic`; the requirements analysis is folded into the coordinator's own turn; `pcb-placement-routing` runs only when a
  board exists and then replaces `schematic` when the message asks for layout (a second rule, `D-full-circuit-layout`, before
  `D-full-circuit-creation`). The runbook's six stay as data (`FULL_CIRCUIT_RUNBOOK_ROLES`). A routed plan never exceeds four;
  `plan_exceeds_specialist_cap` stays the guard for a hand-built plan. Pinned by `b21-b-router.test.ts` cases 8 and 9.
- **Which messages recruit it (the review's fix):** only a new circuit named from words — the verb at the head (design / generate /
  create / build / make / draw), an indefinite object (a / an) and a circuit-kind noun from a closed list HEADING that object
  (optionally followed by a container noun such as board or module; a modifier-position word such as "a schematic symbol" names no
  circuit — lead correction 2026-09-26) — so an
  ordinary edit ("Make the LED brighter.", "Make the placement more compact.") never recruits four paid specialists: a layout-quality
  ask is the bounded PCB proposal (one specialist, runbook :807) and anything else one coordinator turn. The layout variant needs its
  own layout ask (with / and a placement, layout, routing or footprints), never a selection word. The grammar fails toward one
  coordinator turn (an unrecognised creation ask stays `single`, as every full-circuit ask effectively was at B's HEAD).
- **The owner may choose otherwise:** raise the cap (then the router's lists return to the runbook's six by a data change, with the
  concurrency cap on the long-running engines OD-107 already names); another priority (a data change pinned by the router suite); or a
  wider or narrower circuit-kind list (a data change pinned by router case 9).

### OD-109 — Specialists never hold the three availability facts, as applied (B21-C, 2026-09-26)

- **Question:** `assembleAgentRunContext` takes `executionGrantsAvailable`, `externalAcquisitionAvailable` and `mcpObservationAvailable`
  as caller flags, and `verifyAgentContextIntegrity` accepts any grant fields that agree with them (D21-8).
- **Applied:** `deriveSpecialistContext` builds a specialist's context FIELD BY FIELD from a closed list (never by spreading the
  coordinator's): the three facts denied, no grant field, `riskCeiling` `propose`, `approvalsAvailable` empty, no external authority, no
  head mark, no PCB basis, no view, the agent channel; the coordinator's context is read, never written. The specialist gateway wrapper
  refuses `role_context_elevated`, BEFORE anything reaches the underlying gateway, any context that claims grantability or a port in any
  of eight ways (`SPECIALIST_CONTEXT_CLAIMS`: the minter's availability, grantable capabilities, a grant lineage, a risk ceiling above
  `propose`, an approval tier, a grantable capability held by the actor, the external port fact, the MCP port fact — each port claim by
  its flag or by its discovery authority alone); a context that throws while read claims everything. The scheduler builds every
  specialist's loop deps with a closed key set and no `executionGrants` key, and constructs no gateway: the composition root's one bare
  specialist gateway (no minter, no port, no prompt version) is under every wrapper — pinned by identity through the production POST.
  The never-execution sweep re-run through the specialist gateway for all nine roles, with a real minter under it, mints nothing, and
  nested delegation passed as the arguments of a permitted read is handed on verbatim and refused by the read's own schema.
  `verifyAgentContextIntegrity` is unchanged. Proven by `b21-c-no-elevation.test.ts` (5 cases) and `b21-b-chat-router.test.ts` case 16.
- **The owner may choose otherwise:** a sourcing specialist that reads through the external port (then the port fact and the external
  authority become a per-role fact for that role, the claim check admits them for it alone, and the three external reads in its OD-120
  row stop being dormant — still never a grant).

### OD-120 — Which of the 33 exposed tools each role may be offered, as applied (B21-C, 2026-09-26)

- **Question:** the per-role least-privilege subsets (runbook :829; D21-7).
- **Applied:** the discovery's proposal with NO deviation, as data with a reason per id (`ROLE_TOOL_REASONS` /
  `INTENTIONAL_ROLE_TOOL_IDS` in `app/lib/agent/orchestration/role-tools.ts`, rendered on `specialist-roles.md` section 1): the
  coordinator's row IS the exposure list (the same array; never passed as an allowlist); `requirements-analyst` board-inspect,
  canonical-revision-inspect, history-inspect, schematic.inspect; `circuit-topology` schematic.inspect, propose-tier1-edit,
  selection.inspect, connectivity-verify; `component-sourcing-evidence` component-authority.inspect, mcp.observation-read,
  parts.evidence-read, parts.external-search; `schematic` schematic.inspect, propose-component-replacement, propose-tier1-edit;
  `pcb-placement-routing` board-inspect, mechanical-inspect, propose-bounded-edit, via-inspect, placement.propose, routing.propose;
  `verification-critic` revision-inspect, via-inspect, connectivity-verify, drc-run; `manufacturing-readiness-reviewer`
  readiness-inspect, connectivity-verify, drc-run; `cost-latency-router` none. No row holds a granted execution, a view control or a
  never-exposed / Tier 3 id; a proposal only in a proposing role's row; `roleExposureReport` reports drift by role, id and reason. A row
  is a CEILING: ten row entries (nine distinct ids) are DORMANT in B21-C (the six proposal entries — specialists read only; the three
  external reads — OD-109; the history read — no captured view in a specialist context), each saying so in its reason.
  [B21 D2, 2026-09-26] Amended by B21-D2: the Tier 1 edit (circuit-topology, schematic) and the bounded PCB edit (pcb-placement-routing) are live, the replacement and the two layout proposals dormant with their reasons (`specialist-proposals.md` section 7 carries the amended entry). [B21 D3, 2026-09-26] Amended by B21-D3: the replacement is live for the schematic role (`specialist-replacement.md` section 7 carries the amended entry).
- **Consequence, stated exactly (the review's fix):** under OD-109 the sourcing specialist's only effective read is
  component-authority.inspect, so it runs only when at least one schematic component has a durable binding that loads within the
  route loader's 5 s deadline; without a durable source (the local build), for a project with no binding (every new design), on a
  failed load or past the deadline the loader settles null and the role has no tools. A role with no tools is not run, but its task
  stays in the plan and records the missing evidence as dissent `escalated` (`role_has_no_tools`), which the scheduler's outcome and
  the follow-up turn's envelope carry — so runbook :809's component specialist and B21-F's "missing component evidence" case run no
  sourcing model when no binding exists, and the missing evidence is recorded and shown, never invented. The cost/latency policy role
  is never run until B21-E gives it a policy input.
- **The owner may choose otherwise:** cut every row to what C can offer (the dormant ids removed; B21-D and an OD-109 change would then
  re-add them by a reviewed row change); widen a row (a reviewed change of `role-tools.ts` and its page, never of the exposure list) —
  for instance a read that lets the sourcing specialist run and report the missing binding itself (a new or re-scoped read descriptor:
  the D21-9 pin move); or accept the recorded dissent as the missing-evidence answer (the default applied).

### OD-121 — How the role allowlist is enforced, as applied (B21-C, 2026-09-26)

- **Question:** a new `DiscoveryContext` field, a new channel value, or a post-discovery intersection.
- **Applied:** the post-discovery intersection. `buildRunToolset` gains an OPTIONAL `allowedToolIds`, applied AFTER every existing gate
  (it only narrows; a tool a gate withheld stays withheld); A4L semantics (`approvedRunAllowlist`) — at most 32 ids, strictly ascending,
  every id exposed and never a never-exposed pattern — and a list that is anything else approves NOTHING: an empty toolset with one
  warning naming `allowlist_invalid`. The loop reads it from `AgentLoopDeps.allowedToolIds`; absent (every coordinator run) the toolset
  is byte-identical to HEAD (four digests recorded before the change). The scheduler passes each role's effective set — its row
  intersected with the reads the derived context admits — to the loop, the request and the gateway wrapper (`role_not_permitted_tool`
  outside it, proven on the wrapper the scheduler itself builds). A role whose set is empty is not run (`role_has_no_tools`): the plan
  and its task ids come from the plan's roles alone, the task records a dissent, and a same-scope resume never depends on this run's
  resources. The context digest, `DISCOVERY_CHANNELS` and the 22 exclusion reasons are untouched.
- **The owner may choose otherwise:** a discovery-level role field (moves every context digest and the b04 / b17-f / b18-c / b20-b1
  pins in one reviewed move).

### OD-123 — `schematic.set-property` / `schematic.move-rotate` in `EXECUTION_FAMILIES` (B21-C, 2026-09-26)

- **Question:** the closed eight-family list declares two schematic Tier 1 families that nothing can route to (D21-31).
- **Default applied:** recorded as reserved and unchanged (the B18-B pin fixes the list); no schematic descriptor is a granted
  execution; the `schematic` role receives the two sealed Tier 2 proposals and `schematic.inspect` only (OD-15), both proposals dormant
  while specialists read only. [B21 D2, 2026-09-26] Since D2 the Tier 1 edit is live for the schematic role and the replacement stays dormant (`specialist-proposals.md`). [B21 D3, 2026-09-26] Since D3 both sealed Tier 2 proposals are live for the schematic role (`specialist-replacement.md`).
- **The owner may choose otherwise:** remove the two families (a reviewed pin move of `b18-b-execution-grant.test.ts`), or open
  schematic execution (reverses OD-15; its own chapter).

### The README row (`artifacts/ai-control-plane-b21/README.md`, replacing the planned B21-C row)

| B21-C the nine roles, least-privilege tool subsets, the no-elevation proof | `specialist-roles.md`; code `app/lib/agent/orchestration/role-tools.ts`, `app/lib/agent/orchestration/{scheduler,router}.ts`, `app/lib/agent/loop.ts` (four edits on existing lines, line 20 unchanged from HEAD, helpers and one import appended) | CONFIRMED (the reviewed per-role allowlist as data with a reason per id, OD-120 exactly, the coordinator's row the exposure list itself, ten row entries dormant in C and saying so; `roleToolViolations` with a seven-reason vocabulary and `roleExposureReport` over any table, hostile ones reported; `buildRunToolset`'s optional `allowedToolIds` after every gate, narrowing only, A4L semantics (`approvedRunAllowlist`, the 32-id bound and the never-exposed clause both live), an invalid list approving nothing with `allowlist_invalid`, byte-identical to HEAD without it; each specialist offered its row intersected with the admitted reads, persisted and passed alike, enforced by the wrapper the scheduler builds; a role with none not run, its task kept in the plan with a `role_has_no_tools` dissent the outcome and the follow-up envelope carry, task ids stable across a resume; the sourcing specialist running only with a loaded durable binding (stated, and proven through the production POST both ways); `deriveSpecialistContext` built field by field; the specialist gateway refusing `role_context_elevated` in eight ways before the gateway; the never-execution sweep through the specialist gateway for all nine roles minting nothing; the specialist deps closed and minter-free, two gateway constructions per request whatever the roles, the bare one handed to the scheduler by identity; the full-circuit list trimmed to four by a fixed priority (OD-107 resolved), recruited only for a new circuit named from words, its layout variant only on its own layout ask; OD-109, OD-120, OD-121, OD-123 applied; D21-7 and D21-8 closed, D21-9 and D21-31 recorded; 27 new cases (four C suites 27 = 5 + 10 + 5 + 7) plus router cases 8 and 9, gate case 6, B page case 8, route cases 16 and 17; pin moves in the B and A suites with their reasons; the adversarial review's 15 confirmed findings fixed test-first; no generator input changed) |

### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-C — the nine roles, least-privilege tool subsets per role, the no-elevation proof (2026-09-26 local; increment workflow + review fix round + lead; this commit)

- Test-first: the adopted `b21-c-role-tools.test.ts` failed at import (`c-failing-first-adopted.log`); the buildRunToolset digests were
  RECORDED from HEAD `0396c9e` with a temporary probe before `loop.ts` changed (`c-record-head.log`); every new and changed suite then ran
  against the unchanged code (`c-failing-first.log`: three C suites at import, 17 cases failing — no-elevation 1-5, router 3 and 8, gate
  1, 3, 5, 6, scheduler 2, route 4, 11, 12b, 15, 16); then green with the code (`c-green.log`: 13 files, 119 tests).
- Adversarial review: 15 findings confirmed (3 medium: the full-circuit rule recruiting four paid specialists for ordinary edits, the
  sourcing specialist's real condition and fixtures production never produces, the scheduler's wrapper list unproven; 12 low). Fixed
  test-first (`fix/failing-first.log`: 16 cases failing across 6 files before the code; `fix/impl-1.log`: 61 tests green after it);
  the six test-strength findings proven by deliberate breakages of the source, each caught and restored by sha256
  (`fix/breakage-*.log`). The fixes: the full-circuit grammar (a new circuit named from words; the layout variant's own ask); a role
  with no tools not run but kept in the plan with a `role_has_no_tools` dissent carried to the outcome and the follow-up envelope; task
  ids from the plan's roles only (a same-scope resume no longer refused `plan_mismatch` by this run's resources); loop.ts's line 20
  back to HEAD's and the exposure import on its own line at the end; `approvedRunAllowlist` exported; fixtures holding what the route's
  loader produces for U1's binding; route case 17 (all three specialists with the authority loaded); B's page and route case 4's
  title re-stated; C's own pins added to the D21-9 rule.
- Code: `app/lib/agent/orchestration/role-tools.ts` (OD-120 as data with a reason per id, the checker, the report);
  `app/lib/agent/loop.ts` (the optional `allowedToolIds` after every gate with A4L semantics and `allowlist_invalid`; the deps field;
  edits on existing lines only, line 20 as at HEAD, helpers and one import appended, so no B20 citation moved);
  `app/lib/agent/orchestration/scheduler.ts` (the per-role effective set, the not-run task with its dissent, stable task ids, the
  field-by-field `deriveSpecialistContext`, the claim check and `role_context_elevated` in the wrapper, the role's list in the loop,
  the request and the wrapper); `app/lib/agent/orchestration/router.ts` (the full-circuit trim, its grammar and the layout variant).
  No route, descriptor, channel, exclusion reason, UI or generator input changed; census 165/162/3/0; the B04/B20/B17-A artifacts
  byte-identical.
- Suites: `b21-c-role-tools` 5, `b21-c-least-privilege` 10, `b21-c-no-elevation` 5, `b21-c-page` 7; router cases 8 and 9, gate case
  6, B page case 8, route cases 16 and 17 added; pin moves with their reasons in the router (case 3), scheduler (the rig's authority;
  cases 2, 3, 4, 8, 14), gate (cases 1, 3, 5) and route (cases 4, 11, 12b, 15) suites; A's and B's page rows and B's citations re-pinned.
- Gates re-run one job at a time (the lead re-runs them): the B21 suites, the route suite and the CI guard 13 files / 127 tests; `app/api/chat/__tests__` 15 / 96; `app/lib/agent/__tests__` b09-*, b11-*, b18-*, b20-a4-* 26 / 308; the exposure, tier and discovery pins, the MCP gates and the chat closure ratchets 32 / 282; `app/lib/mcp/__tests__` 26 / 642; tsc 0; eslint clean on every new and changed file; no generator input changed.
- Records: `specialist-roles.md`; OD-107 resolved; OD-109, OD-120, OD-121 as applied; OD-123; D21-7 and D21-8 closed; D21-9 and D21-31
  recorded. Consequence recorded (OD-120): the sourcing specialist runs only when a schematic component's durable binding loads; without
  one its task records the missing evidence. Live: every B21 behaviour with a real model BLOCKED-LIVE-QUALIFICATION (LB-9).

### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-C committed on chapter/b21-specialist-orchestration: the nine roles' least-privilege tool subsets (OD-120 as
data, the intersection after every gate in buildRunToolset, a role with none not run and its missing evidence recorded), the
no-elevation proof (the field-by-field specialist context, role_context_elevated in eight ways, the never-execution sweep through the
specialist gateway), the full-circuit list trimmed to the cap for a new circuit named from words (OD-107 resolved); the review's 15
findings fixed; next B21-D". `nextAction`: "B21-D test-first: the deterministic merge layer over the specialists' results - verify
every ProposedAction with its family's integrity and currency verifiers, contradiction detection by identity, stale and expired as
dissent, a not-run task's role_has_no_tools dissent as missing evidence, deterministic verification requests by binding id,
correlated same-source results never independent, decisions and dissent persisted (OD-114, OD-129, OD-130, OD-132, OD-133); whether a
role may produce a proposal (the dormant OD-120 ids)". The report line for the closeout: `MULTI-AGENT STATUS: contracts and durable
record (B21-A), the deterministic router, the no-provider path and the bounded sequential scheduler with the store bound (B21-B), the
nine roles with least-privilege subsets and the no-elevation proof (B21-C) delivered offline behind SIRKIT_ORCHESTRATION_ENABLED;
merge, provider routing and evaluations pending (B21-D..F); live disagreement / fallback / quota BLOCKED-LIVE-QUALIFICATION under LB-9`.

### Discovery closure clauses (`discovery.md` §4, appended to each defect; §10 gains a B21-C amendment)

- **D21-7 (no per-role tool subset on the agent channel)** — CLOSED by B21-C: `role-tools.ts` (OD-120 as data, `b21-c-role-tools.test.ts`,
  5 cases) and the post-discovery intersection in `buildRunToolset` after every gate (OD-121; `b21-c-least-privilege.test.ts`, 10 cases):
  every specialist is offered its row intersected with the reads its derived context admits, persisted and passed alike and enforced by
  the wrapper the scheduler builds; an invalid list approves nothing (`allowlist_invalid`); a role with no tool is not run and its task
  records the missing evidence (`role_has_no_tools`), the task ids coming from the plan's roles alone; `DISCOVERY_CHANNELS`, the
  exclusion reasons and the context digest untouched.
- **D21-8 (nothing distinguishes a coordinator run from a specialist run; elevation stopped only by where the minter is built)** — CLOSED by B21-C: `deriveSpecialistContext` built field by field, the specialist gateway's `role_context_elevated` refusal of eight
  claims before the gateway, the specialist deps closed and minter-free, no gateway constructed by the scheduler and the bare one handed
  to it by identity, the never-execution sweep re-run through the specialist gateway for all nine roles (`b21-c-no-elevation.test.ts`,
  5 cases; route case 16); `verifyAgentContextIntegrity` unchanged. The approver's-role gap below the executor (`executor.ts:421-427`)
  is unreached by the agent path by construction (no orchestration module imports the executor or constructs an approval; B21-A's
  gate) and stays recorded.
- **D21-9 (a new agent-exposed descriptor moves at least seven pins and the byte artifacts)** — RECORDED by B21-C as the pin-move rule
  (`specialist-roles.md` section 5, C's own least-privilege pins named); C adds no descriptor.
- **D21-31 (`EXECUTION_FAMILIES` declares two unroutable schematic families)** — RECORDED by B21-C as OD-123: reserved and unchanged;
  the schematic role receives the two sealed proposals and `schematic.inspect` only.
- **§10, B21-C amendment:** OD-109, OD-120 and OD-121 applied as `specialist-roles.md` states them, OD-123 recorded, OD-107's open
  full-circuit decision resolved by the fixed trim (the runbook's six kept as data) and recruited only for a new circuit named from
  words; ten OD-120 row entries dormant in C (proposals, external reads, the history read); the sourcing specialist runs only when a
  schematic component's durable binding loads, and otherwise its task records the missing evidence (`role_has_no_tools`, carried to the
  follow-up turn); B's suites carry reviewed pin moves (the router's case 3, five in the scheduler suite, four in the route suite) and
  A's gate the six-module pin; the adversarial review's 15 confirmed findings are fixed test-first (section 6 of the page).

## 8. Citations, as of base 0396c9e

The anchor is what is checked (it occurs exactly once in its file). The line is the line as left by this increment for every file
(`loop.ts`, `scheduler.ts` and `router.ts` changed in C; `role-tools.ts` is new; page case 5 checks the lines of all four); it is for
the reader otherwise.

| # | file | line | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/lib/agent/orchestration/role-tools.ts` | 99 | — | `export const INTENTIONAL_ROLE_TOOL_IDS: Readonly<Record<SpecialistRole, readonly string[]>> = Object.freeze({` | the reviewed per-role rows (OD-120) |
| C2 | `app/lib/agent/orchestration/role-tools.ts` | 45 | — | `export const ROLE_TOOL_REASONS: Readonly<Record<ToolHoldingRole` | the reason per id, as data |
| C3 | `app/lib/agent/orchestration/role-tools.ts` | 100 | — | `coordinator: INTENTIONAL_AGENT_EXPOSED_TOOL_IDS,` | the coordinator's row IS the exposure list |
| C4 | `app/lib/agent/orchestration/role-tools.ts` | 125 | — | `export function roleToolViolations(role: SpecialistRole, descriptor: RoleToolDescriptor): RoleToolViolation[] {` | the checker |
| C5 | `app/lib/agent/orchestration/role-tools.ts` | 201 | — | `export function roleExposureReport(registry: DescriptorLookup, table: unknown = INTENTIONAL_ROLE_TOOL_IDS): RoleExposureReport {` | the derived report over any table |
| C6 | `app/lib/agent/orchestration/role-tools.ts` | 37 | — | `export const ROLE_TOOL_VIOLATIONS = Object.freeze([` | the seven-reason vocabulary |
| C7 | `app/lib/agent/orchestration/role-tools.ts` | 182 | — | `if (entries.length > MAX_ROLE_TOOL_IDS) return refused("over_bound");` | an over-long row admits nothing |
| C8 | `app/lib/agent/orchestration/role-tools.ts` | 23 | — | `export const PROPOSING_ROLES: readonly SpecialistRole[] = Object.freeze([` | the proposing roles |
| C9 | `app/lib/agent/loop.ts` | 266 | — | `return buildAgentToolDeclarations(allowedToolIds === undefined ? descriptors : narrowToRunAllowlist(descriptors, allowedToolIds, warn));` | the intersection AFTER every gate |
| C10 | `app/lib/agent/loop.ts` | 812 | — | `function narrowToRunAllowlist<T extends { toolId: string }>(` | an invalid list approves nothing: an empty toolset and `allowlist_invalid` |
| C11 | `app/lib/agent/loop.ts` | 787 | — | `export const RUN_ALLOWLIST_MAX_IDS = 32;` | the bound |
| C12 | `app/lib/agent/loop.ts` | 350 | — | `toolset = buildRunToolset(deps.registry, deps.context, (message) => emitOnce({ type: "warning", runId: request.runId, message }), deps.allowedToolIds);` | the loop passes the role's list |
| C13 | `app/lib/agent/loop.ts` | 77 | — | `allowedToolIds?: readonly string[];` | the deps field (absent on every coordinator run) |
| C14 | `app/lib/agent/orchestration/scheduler.ts` | 195 | — | `export function deriveSpecialistContext(context: AgentRunContext): AgentRunContext {` | the specialist context, field by field |
| C15 | `app/lib/agent/orchestration/scheduler.ts` | 246 | — | `export function specialistContextClaims(context: AgentRunContext): SpecialistContextClaim[] {` | the eight claims |
| C16 | `app/lib/agent/orchestration/scheduler.ts` | 296 | — | `const claims = specialistContextClaims(input.context);` | checked first, before any tool is looked at |
| C17 | `app/lib/agent/orchestration/scheduler.ts` | 280 | — | `export function specialistAllowedToolIds(registry: ToolRegistry, context: AgentRunContext, buildToolset: SpecialistToolsetBuilder, role: SpecialistRole): string[] {` | a role's effective set |
| C18 | `app/lib/agent/orchestration/scheduler.ts` | 401 | — | `const toolless = tasks.filter((task) => allowedByRole.get(task.role)!.length === 0);` | the plan's roles with no tools this run |
| C19 | `app/lib/agent/orchestration/scheduler.ts` | 553 | — | `gateway: readOnlySpecialistGateway(deps.gateway, deps.registry, allowed),` | the role's list in the wrapper |
| C20 | `app/lib/agent/orchestration/scheduler.ts` | 82 | — | `export const SPECIALIST_CONTEXT_CLAIMS = Object.freeze([` | the claim vocabulary |
| C21 | `app/lib/agent/orchestration/router.ts` | 59 | — | `export const FULL_CIRCUIT_TRIM = Object.freeze({` | the fixed trim (OD-107 resolved) |
| C22 | `app/lib/agent/orchestration/router.ts` | 55 | — | `export const FULL_CIRCUIT_RUNBOOK_ROLES = Object.freeze([` | the runbook's six, as data |
| C23 | `app/lib/agent/orchestration/router.ts` | 180 | — | `return facts.hasBoard && LAYOUT_ASK.test(message) ? dag("D-full-circuit-layout", DAG_ROLE_LISTS["full-circuit-layout"]) : dag("D-full-circuit-creation", DAG_ROLE_LISTS["full-circuit-creation"]);` | the layout variant first |
| C24 | `app/lib/agent/gateway.ts` | 92 | — | `export function verifyAgentContextIntegrity(context: AgentRunContext): string[] {` | the integrity check, unchanged |
| C25 | `app/lib/agent/gateway.ts` | 105 | — | `const grantable = context.executionGrantsAvailable === true` | grant fields accepted when they agree (D21-8) |
| C26 | `app/lib/agent/context.ts` | 492 | — | `const grantable = input.executionGrantsAvailable === true` | grantability from server facts at assembly |
| C27 | `app/lib/engineering/agent-exposure.ts` | 30 | — | `export const INTENTIONAL_AGENT_EXPOSED_TOOL_IDS: readonly string[] = Object.freeze([` | the one reviewed 33-id list |
| C28 | `app/lib/engineering/granted-execution-families.ts` | 74 | — | `export const NEVER_EXPOSED_TOOL_PATTERNS: readonly RegExp[] = Object.freeze([` | the never-exposed patterns |
| C29 | `app/lib/engineering/execution-grant.ts` | 47 | — | `export const TIER1_GRANTABLE_CAPABILITIES = Object.freeze(["edit_placement"] as const);` | the grantable capability an actor never holds |
| C30 | `app/lib/engineering/execution-grant.ts` | 32 | — | `export const EXECUTION_FAMILIES = Object.freeze([` | D21-31: the closed eight families |
| C31 | `app/lib/mcp/agent-port.ts` | 221 | — | `list.length > MCP_AGENT_TOOLS_MAX) return names;` | A4L: an over-long list approves nothing |
| C32 | `app/lib/engineering/permission-tiers.ts` | 36 | — | `export const TIER3_FAMILY_PATTERN = ` | the Tier 3 family floor |
| C33 | `app/api/chat/orchestration-runtime.ts` | 240 | — | `const specialistGateway = createAgentToolGateway(deps.registry, specialistGatewayOptions(request.signal));` | the one specialist gateway: no minter, no port, no prompt version; [B21 D3] its one option the route's pin-facts reader (anchor re-pinned, line unchanged); [B21 closeout, 2026-09-29] re-pinned 260 -> 240 by the D21-36 retirement |
| C34 | `app/lib/engineering/tool-discovery.ts` | 32 | — | `export const DISCOVERY_CHANNELS = ["interactive-ui", "assistant-agent", "automation", "api", "mcp"] as const;` | the channel list, unchanged |
| C35 | `app/lib/agent/orchestration/contracts.ts` | 77 | — | `maxAllowedToolIds: 32,` | the contracts' A4L bound |
| C36 | `app/lib/agent/orchestration/scheduler.ts` | 85 | — | `export const ROLE_HAS_NO_TOOLS = "role_has_no_tools" as const;` | the drop's reason |
| C37 | `app/lib/agent/orchestration/scheduler.ts` | 79 | — | `export const SPECIALIST_CONTEXT_REFUSAL_STATUS = "role_context_elevated" as const;` | the elevation refusal |
| C38 | `app/lib/agent/loop.ts` | 796 | — | `export function approvedRunAllowlist(` | A4L: the judgement, its bound and its never-exposed clause |
| C39 | `app/lib/agent/orchestration/scheduler.ts` | 478 | — | `if (allowed.length === 0) {` | a role with no tools: not run, its task's dissent carried on |
| C40 | `app/lib/agent/orchestration/scheduler.ts` | 387 | — | `const tasks = planTasks(plan.roles);` | the plan and its task ids from the plan's roles only |
| C41 | `app/lib/agent/orchestration/router.ts` | 105 | — | `const CREATE_NEW = new RegExp(` | a new circuit named from words |
| C42 | `app/lib/agent/orchestration/router.ts` | 130 | — | `const LAYOUT_ASK = ` | the layout variant's own ask |
| C43 | `app/lib/agent/loop.ts` | 823 | — | `import { INTENTIONAL_AGENT_EXPOSED_TOOL_IDS, NEVER_EXPOSED_TOOL_PATTERNS } from "../engineering/agent-exposure";` | the allowlist's ids, imported on their own line at the end |
