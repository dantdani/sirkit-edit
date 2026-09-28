# B21-D3 — the replacement live for specialists; scenario 17's disagreement structural and deterministically resolved

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Tree
`chapter/b21-specialist-orchestration`, base `d5d3f05` (the B21-D2 commit); written 2026-09-26. Every `[B21 D3]` statement below is
pinned by `b21-d3-page.test.ts` (the option table IS what `specialistGatewayOptions` returns; the proposal tables ARE
`SPECIALIST_PROPOSAL_TOOL_IDS`, `DORMANT_SPECIALIST_PROPOSALS`, `roleProposalToolIds` and `SEALER_CONTEXT_FACTS`; the DAG list IS
`DAG_ROLE_LISTS["component-replacement"]`; the phrasing table IS what the router answers; the added-module list IS the one the pin-facts
suite pins; every rejection code is quoted from the code; every citation resolves by content exactly once and, for the four modules D3
changed, on the line it states; every suite row carries its real `it(` count; the A..D2 pages carry their dated D3 notes) or by the
suite it names. D3 implements against the provider facts recorded in `provider-reference-notes.md` (OD-118) and touches no provider
feature (no request key, no adapter, no model choice), so no page was re-read; no model is called in any D3 suite - every specialist is
a scripted in-process adapter behind the existing provider-neutral runtime, and every artifact a D3 suite presents or approves was sealed
by the REAL gateway in the specialist's own run through the pin-facts reader the runtime built.

## 0. What D3 delivers, and what it is not

Why (the lead's decision, `discovery.md` section 10, B21-D2): runbook section 3, scenario 17, asks for "a complex lower-power timer
replacement through the adaptive specialist DAG with deterministic disagreement resolution". B21-D2 found (D21-37) that no specialist
could seal a component replacement - its sealer needs the server's published pin-facts reads, which only the coordinator's gateway
received - and that the `component-replacement` DAG held ONE proposing specialist, so scenario 17 produced no structural disagreement.
The lead read the published pin-facts reads as what they are: bounded, read-only facts of the server-owned part catalog (the class of
fact the sourcing specialist already reads through `sirkit.component-authority.inspect`), not an execution port.

- **The pin-facts reads for a proposing specialist (OD-109 amended; section 1).** The runtime - the specialists' composition root,
  never the route - resolves the SAME source the route resolves and builds the specialist gateway with the SAME bounded reader the
  coordinator's gateway receives (C1, C2): that one option and nothing else. The reader's import closure reaches nothing the
  coordinator's read does not already use; an absent source leaves the specialist's replacement blocked exactly as the coordinator's.
  **CONFIRMED** by `b21-d3-pin-facts.test.ts` (4 cases).
- **The replacement live for the schematic role (OD-120 amended; section 2).** `sirkit.schematic.propose-component-replacement` moved
  from the dormant list to the live one (C4, C5); only the `schematic` row lists it, so it is live for that role alone; its sealer's
  context fact is the head mark (C7), which the schematic role already held for the Tier 1 edit. **CONFIRMED** by
  `b21-d3-replacement-roles.test.ts` (9 cases).
- **The replacement DAG holds two proposing roles (OD-107 amended; section 3).** `coordinator`, `circuit-topology`,
  `component-sourcing-evidence`, `schematic`, `verification-critic` (C9) - a presentation and budget order only; the runbook's own
  sentence routes to it through ONE strict replacement grammar anchored at both ends ([B21 D3 lead]; C10, C11, C34).
  **CONFIRMED** (replacement-roles cases 5, 7, 8 and 9 - case 9 the lead's adversarial sweep corpus; the moved B router cases).
- **Scenario 17 structural (section 4).** Through the REAL runtime and the production POST: when one party cannot seal, the one sealed
  replacement is presented and APPROVED through the replacement family's existing path with the run's principal; when both parties
  seal, they are always escalated to the human; OD-130's part review renders at the route's envelope through the scheduler seam and
  is CONFIRMED-unreachable from a production POST until B21-E's route-level resume. **CONFIRMED** by `b21-d3-scenario17.test.ts` (8
  cases) and `app/api/chat/__tests__/b21-d3-chat-replacement.test.ts` (7 cases).
  [B21 E3, 2026-09-27] Superseded for the route half: OD-130's part review is REACHABLE from a production POST through the route-level resume
  (`route-resume.md`; `b21-e3-chat-resume.test.ts` case 8) - D21-16's route half closed.
- This page, pinned by `b21-d3-page.test.ts` (10 cases), with the reserved texts written out in section 7.

Closes **D21-37** (two sealed parties are always escalated; a party whose edit cannot seal never reaches the merge); records
**D21-16**'s route half as the envelope capability CONFIRMED and CONFIRMED-unreachable from a production POST (open for B21-E's
route-level resume); adds **D21-10**'s addendum for the replacement DAG; amends **OD-107**, **OD-109**, **OD-120**; reopens nothing.
Finds **D21-38** (low; section 3): the composer sends the runbook's own sentence to the schematic editor.

**[B21 D3 fix] The review round (2026-09-26).** An adversarial review confirmed eleven findings: the kind-swap grammar sent value
changes, purposes, negations and questions to the four-specialist DAG (regressions-1, security-1, coverage-1, tests-1 - fixed in
`router.ts`, section 3); B's router case 7 kept a stale "one grammar" invariant (tests-6 - moved); the A..D2 pages kept three
statements D3 made untrue (regressions-3, security-2, coverage-6 - noted); and this page overclaimed the resolution, the part review
at the route and the order (coverage-2, coverage-3, coverage-5, tests-2, tests-3 - restated, with control cases). Section 6 lists each
finding with the case that reproduces it.

**Zero authority, unchanged.** A specialist still mints, applies, approves, binds, qualifies, purchases and releases nothing. What the
schematic specialist gains is a SEAL of one more family: an inert Tier 2 artifact (permission tier `proposal_only`, a human approves it)
that its gateway produces from the verified context and the catalog's published facts. The reader executes, mutates, binds, acquires and
calls out to nothing; the specialist gateway still holds no minter, no prompt version and no port (C2); the eight elevation claims stay
refused (`role_context_elevated`); the two long-running proposals stay dormant with their reasons; the wrapper's
`role_not_permitted_tool` still covers everything outside the row. Deterministic validation outranks consensus: agreeing results never
promote an artifact, a contradicted result withholds every presentation, and one provider is one source. The B18 grants, the B19
evidence rules, B20's OD-45/90/91/92 provider rules and OD-81's directive matcher stand unchanged; `verifyAgentContextIntegrity`, the
loop, the gateway, the adapters and the route are untouched.

## 1. The published pin-facts reads for a proposing specialist (OD-109 amended)

The ONE option the specialist gateway is built with (the table IS what `specialistGatewayOptions` returns with a configured source):

| option | what it is |
|---|---|
| `replacementPinFacts` | the route's own source (`resolveReplacementPinFactsSource`), every read settled by `loadRunReplacementPinFacts` under this request's signal and `DEFAULT_PIN_FACTS_DEADLINE_MS` - the reader the coordinator's gateway receives (C3) |

- **Where.** `app/api/chat/orchestration-runtime.ts` builds the specialist gateway (C1) over `specialistGatewayOptions(request.signal)`
  (C2); the route is unchanged and keeps building the coordinator's gateway with the same function and deadline (C3, C12). With no
  configured source the function returns nothing and the runtime builds the specialist gateway with NO option at all - B21-C's
  structural shape, which B's route cases 14 and 16 keep pinning in the suites' default environment. **CONFIRMED** (pin-facts case 1:
  through the production runtime the one gateway it builds carries exactly `replacementPinFacts` and the scheduler receives that very
  instance; the key list of the function; the runtime's text; route case 2: the request's two gateways).
- **The request's signal.** The specialist reader is bound to the run request's signal (the route's composition of the HTTP request's
  own signal and the stream's cancel), so it aborts whenever the coordinator's reader does and also when the stream is cancelled; a
  pre-aborted request never reads (C14), an in-flight read settles null the moment the request aborts, and a read that outlives
  `DEFAULT_PIN_FACTS_DEADLINE_MS` (5 000 ms, C13) settles null at exactly the deadline, its own read aborted. **CONFIRMED** (pin-facts
  case 4).
- **The closure, walked as A's gate walks the orchestration modules** (the B14.4 helpers and `importClosure`, a type-only import
  erased): the reader `app/api/chat/replacement-facts-runtime.ts` reaches no grant, reauthorization, approval, release, executor or
  build module; its only API-tree members are itself and its cancellable reads; its provider-SDK reach is exactly the recorded D21-32
  chain (`app/lib/db/client.ts` -> `app/lib/db/schema.ts` -> `app/lib/embeddings.ts` -> `openai`, a schema constant); its one network
  client is the database client of the catalog read itself (`postgres`; `node:net` is `isIP`, an address parser). The runtime's closure
  held the SDK chain and the database client before D3 (through the durable runtime, D21-32). The modules D3 ADDS to the runtime's
  closure are six, and every one is already in the coordinator's composition root's closure - the route imports the reader itself:
  `app/api/chat/authority-cancellable-reads.ts`, `app/api/chat/replacement-facts-runtime.ts`, `app/lib/atomic/revision-status-sql.ts`,
  `app/lib/atomic/server-catalog.ts`, `app/lib/fixture-runtime/blinker/authority.ts`, `app/lib/physical-binding/server-repository.ts`.
  The one module with a writer class among them (the physical-binding repository) is reached for the fixture runtime's AUTHORITY source
  beside the fixture pin-facts source, which reads the committed catalog's published snapshots only (C15). Nothing the coordinator's
  read does not already use: the stop condition is not met. **CONFIRMED** (pin-facts case 2).
- **An absent source is never faked.** Without a configured catalog the schematic specialist is still offered the replacement (the
  loop's prerequisites are the head mark and the component authority, C16) and its call is refused by the family's assembler with
  `current-pin-authority-unavailable` (C17) - exactly the coordinator's own blocker for the same call. **CONFIRMED** (pin-facts case 3;
  route case 6, the coordinator's call and the specialist's in one run).

## 2. The replacement live for the schematic role (OD-120 amended)

The table IS `SPECIALIST_PROPOSAL_TOOL_IDS` (live, in order) and `DORMANT_SPECIALIST_PROPOSALS` (dormant, with its reason verbatim):

| tool | state | reason |
|---|---|---|
| `sirkit.pcb.propose-bounded-edit` | live | the bounded PCB edit, sealed from the verified board and the PCB proposal basis (B21-D2) |
| `sirkit.schematic.propose-component-replacement` | live | [B21 D3] the exact replacement, sealed from the verified schematic, its head mark, the component authority and the catalog's published pin facts the runtime's reader supplies |
| `sirkit.schematic.propose-tier1-edit` | live | the Tier 1 schematic edit, sealed from the verified schematic and its head mark (B21-D2) |
| `sirkit.placement.propose` | dormant | long-running (budgetClass long-running): the placement engine blocks the event loop 44-104 s per run (B20's measurement), so it is never offered to a specialist |
| `sirkit.routing.propose` | dormant | long-running (budgetClass long-running): a FreeRouting child process of up to 180 s, so it is never offered to a specialist |

Per role (the table IS `roleProposalToolIds`, in `SPECIALIST_ROLES` order):

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

The fact each live proposal's sealer needs from the coordinator's VERIFIED context (the table IS `SEALER_CONTEXT_FACTS`):

| tool | fact |
|---|---|
| `sirkit.pcb.propose-bounded-edit` | `pcbProposalBasis` |
| `sirkit.schematic.propose-component-replacement` | `schematicHeadMark` |
| `sirkit.schematic.propose-tier1-edit` | `schematicHeadMark` |

- **The row was read, never widened.** Only the `schematic` row lists the replacement (the coordinator's row IS the exposure list), so
  moving it to the live list makes it live for that role alone (C4, C5, C6); its row reason now says so (C8). **CONFIRMED**
  (replacement-roles case 1; C's role table moved with its data).
- **Exactly the sealer's fact, no more.** The family's sealer (`ProposalInvocationService`, C18) reads from the context the verified
  schematic and its digest, the head mark (the scope seal), the component authority and the verified canonical state and revision, the
  actor and the scope. The hardened derivation already keeps all of them but the head mark; `specialistContextFor` adds the head mark
  (with the lineage it anchors) and nothing else (C7, C19) - the same context the schematic role held for the Tier 1 edit since D2. The
  context still claims none of the eight elevations, and each claim added to it alone is refused `role_context_elevated` for the
  replacement call before the gateway. **CONFIRMED** (replacement-roles case 3).
- **Per role, through the real scheduler:** over the scenario-17 context the schematic specialist is offered, persists and narrows to
  `sirkit.schematic.inspect`, the replacement and the Tier 1 edit; the circuit specialist the Tier 1 edit; the sourcing specialist the
  authority read; the critic reads only; over the worst context no other role is ever offered the replacement. A read-only role's view
  is still the read-only registry, and the replacement is refused for it by the wrapper (`role_not_permitted_tool`) and by the gateway
  itself (`not_discoverable`: without the head mark discovery excludes it). **CONFIRMED** (replacement-roles cases 2 and 4; the frame:
  case 6).

## 3. The replacement DAG holds two proposing roles (OD-107 amended)

The list (the DAG IS `DAG_ROLE_LISTS["component-replacement"]`): `coordinator`, `circuit-topology`, `component-sourcing-evidence`, `schematic`, `verification-critic`.

- **The order - a presentation and budget order only ([B21 D3 fix], review coverage-5).** The circuit specialist runs first, the
  sourcing specialist second, the schematic specialist third and the verification critic last: four specialists, within
  `SPECIALIST_CAPS.maxSpecialists` (C20). The order decides which task a tight DAG deadline cuts first and the order in which results
  reach the merge and the follow-up turn - nothing more: no specialist reads another's result before B21-E. Every specialist's objective
  is built from the coordinator's user message alone (C35) and its loop history is empty (C36), over the coordinator's derived
  context, so the schematic specialist's seal does not follow the sourcing evidence (its target is the verified exact authority of the
  coordinator's context, C31) and the critic never sees a proposal (its row holds board reads and the deterministic verifiers). The list
  now equals the full-circuit creation list, role for role - the two shapes keep their own rules, grammars and frozen arrays (B's router
  case 6 matches a rule to its shape by identity since D3). **CONFIRMED** (replacement-roles case 5; scenario17 case 8: the sourcing
  specialist's evidence reaches neither the schematic specialist nor the critic, the critic never sees the sealed replacement's id, and
  the evidence reaches the follow-up turn). Passing earlier results to later tasks is a data-flow design change for B21-E (OD-107's
  owner option).
- **The phrasing (OD-107 amended; [B21 D3 lead, 2026-09-26/27] restated).** The composer's pairing (`REPLACE_PART`) needs a word
  naming a part, component, MPN, alternate or chip, so the runbook's own sentence did not route (it stayed `single`). The implementer
  added a kind-swap grammar; the review round and the check tightened it; the lead then swept it adversarially - a workflow of three
  probing agents per round, each routing its own phrasings through this router under the job lock, six rounds - and rebuilt it after
  each: round 1 found 165 messages reaching the four-specialist DAG although none asks to replace a part with a new one (follow-up
  questions and retractions, exchanges of existing parts, attribute, documentation and value edits with a purpose phrase, and - through
  the UNANCHORED composer pairing the router had used since B21-B - prohibitions and "why" questions such as "Don't swap parts without
  asking me first."); round 2 found 306 through open modifiers and tails ("a 4k7 alternative", "a software timer", "an idle
  comparator", "for the README", "while keeping the schematic unchanged", "pin3" as the replaced part); round 3 found 166 through an
  open MPN token and values ("a SOIC8 version of the part", "a TIM2 timer", "a KiCad7 part", "a 1 Hz timer", "the LM317 regulator with
  a 5 V LM317 regulator", "?!"); round 4 found 180 through MPN-shaped net, laminate, OS and suffix names ("the NET101", "the FR408",
  "a Win2000 driver", "an NE555D timer"), unit-less values, passive designators ("R4 with a precision part"), opinion questions ("Would
  you replace U1 with a timer for the blinker?") and vacuous swaps ("the timer with a timer"); round 5, the verification round with every
  finding classed structural or semantic, found five structural root causes - "would you" after another polite word ("First would
  you ..."), a vacuous "a timer chip", a BARE prefixed code ("the Sn63Pb37", "the AD255C", "the TL866", "the TS16949") or a
  plural ("the NE555s") as the replaced part, a part-number suffix read as a unit ("a 7805A regulator"), and VR (as often a variable
  resistor) - and eleven semantic ones; round 6, a second verification round after the fix, found six more structural root causes - a plural or look-alike designator
  ("U1s", "k8s", "Y2K"), an unclosed appositive ("U1, the NE555 with a dual timer" is a list), a second part number read as an MPN
  suffix ("NE555-556"), a bare new part of the named part's own kind ("the NE555 timer with a timer") or a bare part word ("U1
  with a chip"), the acronym IT folded into the pronoun, and unbounded or zero values ("a 2024-bit MCU", "a 0 V regulator", "a
  7805-compatible timer") - all fixed in the follow-up commit, and 26 more semantic ones recorded. So NO token is open (`partKindSwap`,
  C34; the polite prefix, C10; the rule, C11 - it passes the RAW message too): after a polite prefix the WHOLE message is "replace /
  swap (out) <part> with / for / by <new part>" or "substitute <part> with / by <new part>", "delete / remove <part> and replace it with
  <new part>" (B's own scenario sentence) or "substitute <new part> for <part>" (its one correct direction); the replaced part is one of
  seven closed shapes - "it", an ACTIVE component's designator (U, IC, Y, Q, K, PS; a unit letter a-f only), "part / IC U1", "the timer" / "the part", "the
  NE555 timer [U1 | (U1)]" or "the NE555 (U1)" with an MPN from a listed vendor or family prefix and at least three digits, always
  ANCHORED by a kind or a designator, "the 555 timer" with a listed standard part number, "U1, the NE555," - never a passive, a list,
  a plural, a value, a net, a package, a bare code or a clause (the appositive's closing comma required, an MPN suffix a voltage
  variant only); the NEW part takes
  "a" / "an" (or "the approved") and at most four words from a CLOSED spec list (power, noise, speed, size, cost, supply, technology,
  compatibility, sourcing) or the values that specify THAT kind, always with a unit and a plausible magnitude (so a part-number suffix
  is never a unit: "7805A" is not 7805 amperes) (a supply or current for a regulator, an LDO or a
  driver; a width or pin count for a microcontroller; a kHz or MHz frequency for an oscillator; a speed for a comparator or an op-amp;
  compatibility with a listed standard timer for a timer; widths and pin counts bounded, never a zero magnitude - and never a spec word
  that means something else on that kind: a timer's or an oscillator's speed, adjustability, mode or precision, which R and C set, or a
  linear, synchronous or programmable op-amp, comparator or MCU), then
  an ACTIVE part kind (timer, regulator, LDO, op-amp, comparator, microcontroller, oscillator, driver), a part word (part, component,
  chip, alternative, alternate) or "a <technology / grade> version of the <kind / part>" - and NEVER an MPN or a number, whose shape
  cannot be told from a package, a net, a peripheral, a version or a suffix variant of the same part; at most one CLOSED tail
  ("instead", "for the <circuit function> [circuit / rail / stage / supply / section]", "while preserving compatible nets", "while
  keeping / preserving the (same) footprint / pinout / nets / connections"). A bare new part of the named part's own kind family ("the
  timer with a timer", "the NE555 timer with a timer chip", "the ATmega328P MCU with a microcontroller"), a bare new part for a part
  named without a comparable kind ("it with a timer") and a bare part word for any part ("U1 with a chip") name nothing new - "the
  4060 timer with a microcontroller" does; the acronym IT is never the pronoun; "would you" anywhere in the polite prefix is an opinion; the RAW message's trailing punctuation decides a question (a run
  with "?" is a request only after "can / could / will you" and never with "!"); a new part named by a part word is the composer's own
  pairing too - the router still imports `REPLACE_PART` and requires it to agree. [B21 E4, 2026-09-28] Superseded: since B21-E4 the router no longer imports `REPLACE_PART` - the grammar itself (C10, C34 re-pinned) moved into composer-routing.ts beside it, where the agreement check (`REPLACE_PART.test(rest)`) now runs, and the router imports `partKindSwap` and `POLITE` from there; the composer's rule 5b calls the same predicate (D21-38, `composer-and-first-turn.md`). A word the grammar does not list makes the message one
  coordinator turn - the grammar fails toward it, never toward a paid DAG. **CONFIRMED** (replacement-roles case 9 over the sweep's
  corpus, `_d3-router-corpus.ts`: its 1007 false DAG phrasings of the six rounds are not the replacement DAG and its 194 genuine
  requests are - B's three replacement phrasings, the scenario-17 phrasings, kinds with values, polite and question-form requests,
  unicode dashes and apostrophes; the sweep's own outputs are the failing-first evidence, `probe/*.out.json`; case 8 the check's
  residual). **RECORDED:** what a closed grammar cannot decide - a listed word used in another sense, which only part knowledge could
  tell - still routes (`RECORDED_SEMANTIC`, forty-six phrasings, e.g. "Replace the NE555 timer with a bipolar timer." - the NE555 is already
  bipolar; "Replace the LM317 regulator with a 3.3 V regulator for the 3V3 rail." - the LM317 is adjustable; "Replace the op-amp with a
  faster op-amp for the blinker." - a rate; "Replace the NE556 timer with a dual timer." - the NE556 is already dual); the specialists
  and the merge then find no new part to seal. Genuine phrasings outside the
  closed shapes and vocabularies stay `single` - "Use a CMOS timer instead of U1.", "Change U1 to a CMOS timer.", a new part named by
  its MPN ("Replace U1 with a TLC555 timer.", "Replace U4 with an STM32F030 MCU."), a bare "the NE555" ("Substitute a CMOS timer
  for the NE555."), "Would you replace U1 with a timer?" - toward one
  coordinator turn, never toward a paid DAG. Every direct-path case of B's router suite stays green unchanged; B's router case 7 pins
  the rule's source (moved by the review round and by the lead, each reason beside it). The phrasing table IS what the router answers (a
  schematic present, a `pcb_editor`):

| phrasing | plan |
|---|---|
| Replace the NE555 timer U1 with a lower-power timer. | `D-component-replacement` |
| Swap the NE555 (U1) for a lower-power CMOS timer. | `D-component-replacement` |
| Replace U1, the NE555, with a low-power CMOS timer. | `D-component-replacement` |
| Replace U1 with a low-power timer for the blinker. | `D-component-replacement` |
| Delete U1 and replace it with the approved lower-power part while preserving compatible nets. | `D-component-replacement` |
| Replace U1 with a TLC555. | `S-default` |
| Replace R1 with a 4.7k resistor for the timer. | `S-default` |
| Replace the 10k resistor with a 4.7k resistor. | `S-default` |
| Please replace C3 with 10uF for the LDO. | `S-default` |
| Replace R1 with 4k7 for a timer. | `S-default` |
| Replace C5 with 10uF near the regulator. | `S-default` |
| Replace the decoupling cap for the regulator. | `S-default` |
| Swap R4 and R5 for the op-amp gain. | `S-default` |
| Replace the footprint for the regulator with SOT-223. | `S-default` |
| Why did you replace R1 with a 10k for the op-amp? | `S-default` |
| Do not replace U1 with a different timer, just explain its pinout. | `S-default` |
| Replace U2 with a 5V regulator. | `D-component-replacement` |
| Move R3 2 mm to the right. | `S-explicit` |
| Please swap U1 with the regulator. | `S-default` |
| Please swap the pins of U1 with the driver. | `S-default` |
| Please replace the value of U1 with timer. | `S-default` |
| Could you swap U3's position with the LDO? | `S-default` |
| Replace U1 with a timer? Would that work? | `S-default` |
| Could you replace U1 with a lower-power timer? | `D-component-replacement` |
| Delete U1 and replace it with a lower-power timer. | `D-component-replacement` |
| Replace U4 with an 8-bit MCU. | `D-component-replacement` |
| Don't swap parts without asking me first. | `S-default` |
| Why did you swap the chip? | `S-default` |
| Swap U1 with an adjacent op-amp. | `S-default` |
| Replace U1 with a timer. Actually, don't. | `S-default` |
| Replace the input capacitor for an LDO with a 10uF ceramic. | `S-default` |

- **[B21 D3 lead, 2026-09-26] The check's residual (low):** the fixed grammar still recruited four specialists for an exchange of two
  existing parts, an attribute edit and a question - "Please swap U1 with the regulator.", "Please swap the pins of U1 with the
  driver.", "Please replace the value of U1 with timer.", "Replace U1 with a timer? Would that work?". Now the swapped-in object takes
  only an indefinite article ("with the regulator" names an existing part, C10); the replaced span may name no attribute of the part
  (an "of", a possessive, or a value, pin, position, placement, footprint or package word - `REPLACED_ATTRIBUTE`, appended after
  C34); and a bare imperative whose sentence ends in a question mark before more text is a question, while a question-form request
  ("Could you replace U1 with a lower-power timer?") still routes. **RECORDED:** the router's normalization strips a lone trailing
  "?", so a bare "Replace U1 with a timer?" reads as the imperative. **CONFIRMED** (replacement-roles case 8: twelve phrasings stay
  `single`, six route to the DAG; it failed first on the unfixed grammar, `d3-lead-case8-red.log`). That first tightening was then
  swept adversarially and SUPERSEDED by the closed-vocabulary grammar above (case 9); case 8's phrasings hold under it unchanged.
- **RECORDED (D21-38, low):** "Replace U1 with a TLC555." (an MPN alone) stays `single` - the grammar names kinds, never parts; and the
  composer (a UI surface D3 does not change) routes the runbook's sentence to the schematic editor by its rule 8 (C21: `replace` is an
  edit verb and the 5b pairing names no kind), so in the application the sentence reaches the chat route only when the user overrides
  the composer's route. **CONFIRMED** (replacement-roles case 5 pins both facts). [B21 E4, 2026-09-28] The composer half CLOSED by B21-E4 (D21-38): the grammar moved into the composer module and its rule 5b uses it, so the runbook sentence reaches the assistant from the UI (replacement-roles case 5 moved, its reason next to it); the MPN-only swap stays `single` in the router and an edit in the composer - the grammar names kinds, never parts (`composer-and-first-turn.md`).

## 4. Scenario 17: the disagreement is structural - two sealed parties escalate, a party that cannot seal never reaches the merge

Through the REAL runtime (`runOrchestratedChat`) and the production POST, over the fixture catalog (`_d3-fixtures.ts`: U1 an NE555 at
its revision, one binding aggregate produced through the real physical-binding service, the published pin facts of the current and the
target revision behind the route's own seams). The authority carries no power fact, so no surface calls the target "lower-power": the
server's catalog decides the target, the model never does.

| variant | the parties | what decides | persisted verdicts | presented | proof |
|---|---|---|---|---|---|
| one party cannot seal | circuit-topology asks for a Tier 1 delete of U1; schematic seals the replacement | the agent path's Tier 1 compiler refuses the delete `pins-unavailable` (C22): every agent Tier 1 proposal compiles with an EMPTY pin map (C37), so the refusal is the same with no peer and it never reaches the merge; the replacement passes its family's integrity and currency checks against the pinned scope, the merge's lifetime and principal binding, the exact-authority rule (C23) and `sealed-in-run` | all four accepted (task 1 with no proposed action: no conflict reaches the merge) | the replacement, as the run's `proposal_ready`, then APPROVED | scenario17 cases 1 and 2, scenario17 case 7 (the control run); route case 3 |
| the replacement cannot seal | schematic asserts a part the authority does not name | the assembler refuses `expected-mpn-mismatch` (C24): the model may assert, never choose | all four accepted, no action | nothing (`none_accepted`) | scenario17 case 3 |
| both seal: escalated | circuit-topology seals a Tier 1 relabel of U1; schematic seals the exact replacement | each passes its family's checks; they share U1's identity: `conflict:same_field`, one escalation citing the exact authority (C25) - two sealed parties on one component always escalate | both `contradicted`, one escalation | nothing (`escalated`) | scenario17 case 4; route case 4 |
| part review (scheduler seam) | the replacement sealed while the catalog's exact target was its earlier selection, replayed by a resume after it moved | `part-not-exact-authority` and a part review request for `request_atomic_review` (C23, C26) | `contradicted` (chained after the earlier `accepted`), one review request | nothing (`review_requested`) | scenario17 case 5 (the runtime's resume); route case 5 (the seam); route case 7 (a production POST cannot produce it) |

- **No disagreement between two sealed parties is resolved to a winner (RECORDED as a deviation from the task's wording; an open
  OD-122 question).** [B21 D3 fix] (review coverage-3, tests-2) Under the merge's real rules a Tier 1 edit has no `contradicted` code of
  its own, two SEALED changes of one component always conflict - both `contradicted`, one escalation: they always escalate - and a
  `contradicted` result withholds every presentation (OD-122's order, C27). The circuit specialist's delete in the first variant does
  not lose to the replacement: the agent gateway compiles every Tier 1 proposal with an EMPTY pin map (C37), so any KiCad delete through
  any agent gateway is refused `pins-unavailable` - with a peer or without one - and never reaches the merge; the persisted verdicts
  show no conflict (its task is `accepted` with no proposed action, its refusal one bounded line on the stream). **CONFIRMED** by
  scenario17 case 7, the control run: no peer, the same refusal naming U1, the same four `accepted` verdicts, nothing presented
  (`none_accepted`), and the coordinator's own gateway refusing the same delete. So case 1's presentation follows the schematic seal
  alone, and whether scenario 17 presents (the circuit specialist asked for a delete, which cannot seal) or escalates (it asked for an
  edit that seals, case 4) follows the circuit specialist's op choice - never a verifier's judgement between two parties. The parties
  never see each other's results either (scenario17 case 8, section 3). A `contradicted` loser beside a presented winner does not exist
  in this tree; whether OD-122 should allow one (a party refused by a deterministic check that depends on its peer) is an open OD-122
  question D3 does not decide.
- **Approved through the family's existing path, with the run's principal.** The presented `proposal_ready` is taken by the page's
  consumer (`receiveReplacementProposalEvent`); the family's approval controller (C28) reauthorizes the live membership through the real
  apply-authorization route and fetches fresh authority and pin facts through the production channel into the REAL
  `/api/replacement-authority` handler (C29), recompiles and byte-matches (C30): ONE canonical transaction, U1 carries the exact target,
  the receipt names the coordinator's run and the run's principal. The path does NOT refuse an artifact sealed under a specialist run
  id: the replacement records no run id and `originRunId` is metadata. An artifact presented before the authority moved is refused by the
  same path (`verification-failed`: it re-verifies against fresh authority). **CONFIRMED** (scenario17 cases 2 and 5; route case 3).
- **OD-130's part review: rendered at the route's envelope, CONFIRMED-unreachable from a production POST.** [B21 D3 fix] (review
  coverage-2, tests-3) The route's envelope carries the review request (`request_atomic_review`, the earlier part, the exact authority),
  the stream its part review line, the approval block `review_requested` - through the scheduler SEAM: route case 5 injects a scheduler
  (`setSpecialistSchedulerFactory`) that runs the DAG twice inside ONE POST, first over a test-built context holding the earlier
  authority, then over the route's own - a resume the route never performs. **RECORDED:** in ONE route run the family's sealer can only
  seal the exact target of the authority the merge reads (the assembler takes the target from that authority, C31), so the rule fires
  only on a seal the authority moved away from - a resume of the same coordinator run after the catalog's selection moved. The runtime
  performs that resume (scenario17 case 5), but the route mints a fresh run id per POST (C38) and carries no prior run id, so a
  production POST cannot produce the part review: **CONFIRMED-unreachable from a production POST** until B21-E's route-level resume
  (D21-4). **CONFIRMED** (route case 5: the envelope, through the seam; route case 7: two production POSTs are two runs - every
  specialist runs again, nothing is replayed, each seal targets the exact authority and is accepted and presented, no part review in
  either; scenario17 case 5: the runtime's resume).
  [B21 E3, 2026-09-27] The route now performs that resume: a POST carrying `resumeRunId` reuses the run id and replays the committed seal, and
  the merge asks for the part review (`route-resume.md`, route case 8); route case 7 above still holds for two POSTs without the key.
- **Providers.** The parties' PROVIDER is the coordinator's until B21-E1's per-role routing (the scheduler reuses the coordinator's
  adapter): every escalation above counts ONE source. The resolution rule is provider-blind - one provider is one source and agreement
  is never proof - and B21-F's "timer replacement with provider disagreement" case runs these same parties on two providers.
  **RECORDED**.
- **The never-execution sweep** through the specialist gateway WITH the pin-facts reader (and, as the worst case, a real minter and
  the prompt version under it): for every role over the whole registry nothing yields an execution grant, a view command or a layout
  candidate, the minter is never called, the replacement seals for the schematic role alone. **CONFIRMED** (scenario17 case 6).

## 5. What D3 does NOT do

- No new exposed tool, no new descriptor, no new route, no new run event (the family's own `proposal_ready` only), no UI change, no
  request key, no generator input change: the route census stays 165 = 162 canonical + 3 factories + 0 raw and every generated artifact
  is byte-identical; no generator was re-run.
- No grant, no mutation, no execution, no view control, no port and no minter for a specialist; no long-running proposal for a
  specialist; no change to `deriveSpecialistContext`, `verifyAgentContextIntegrity`, the loop, the gateway, the adapters or the route.
- No presentation by count or majority; no second artifact per user message; no change to OD-122's order; no content judgement of prose.
- No reserved-file edit (their texts are in section 7); no trace block, provider routing or breaker (B21-E); no evaluations (B21-F).

## 6. Suites, evidence, the pin moves, gates

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-d3-pin-facts.test.ts` | 4 | the specialist gateway's one option through the production runtime; the reader's closure; an absent source blocked as the coordinator's; the request's signal and the deadline |
| `app/lib/agent/orchestration/__tests__/b21-d3-replacement-roles.test.ts` | 9 | the live and dormant data; per role the advertised set; the schematic context's one fact and the eight refused claims; a read-only role gets no proposal; the DAG list, its order and the phrasings; the frame; [B21 D3 fix] the kind swap's head-verb and object-head grammar over the review's phrasings (case 7) |
| `app/lib/agent/orchestration/__tests__/b21-d3-scenario17.test.ts` | 8 | one party cannot seal, the replacement presented; approved through the family's path; the replacement cannot seal; both seal, escalated; the part review from a real seal (the runtime's resume); the never-execution sweep with the reader; [B21 D3 fix] the control run with no peer (case 7); no specialist reads another's result (case 8) |
| `app/lib/agent/orchestration/__tests__/b21-d3-page.test.ts` | 10 | this page; [B21 D3 fix] the A..D2 notes in their own blocks (case 9); the restated claims (case 10) |
| `app/api/chat/__tests__/b21-d3-chat-replacement.test.ts` | 7 | flag off byte-identical to HEAD (B's four digests); the routing and the two gateways; one party cannot seal, presented end to end and approved; both seal, escalated; the part review rendered through the scheduler seam; an absent source; [B21 D3 fix] the part review unreachable from a production POST (case 7) |
| `app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts` | 14 | B's cases; eleven moved with the replacement DAG |
| `app/lib/agent/orchestration/__tests__/b21-b-router.test.ts` | 9 | B's cases; cases 3 and 6 moved; [B21 D3 fix] case 7 moved (the router's grammar a superset of the composer's) |
| `app/api/chat/__tests__/b21-b-chat-router.test.ts` | 18 | B's cases; cases 4, 11, 12b, 15, 16 and 17 moved |
| `app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts` | 10 | C's cases; cases 1, 8 and 9 moved |
| `app/api/chat/__tests__/b21-d-chat-merge.test.ts` | 7 | D's cases; cases 2 to 5 moved |
| `app/lib/agent/orchestration/__tests__/b21-d2-proposing-roles.test.ts` | 9 | D2's cases; cases 1, 3, 4 and 8 moved |
| `app/lib/agent/orchestration/__tests__/b21-d2-provenance.test.ts` | 9 | D2's cases; case 6 moved |

**Test-first.** The new suites and the moved cases ran against HEAD's four production modules restored byte for byte from `d5d3f05`
(`d3/ff-1-failing-first.log`: 11 files, 49 of 98 failing, each on its own assertion or the missing export `specialistGatewayOptions`);
the cases that passed there hold before and after by design (the reader's closure - a property of the reader module; the flag-off byte
identity; a read-only role gets no proposal); the D3 modules were then restored (sha256 verified, `d3/d3-prod.sha256`) and every suite
passed. The page's suite ran first against the tree without this page and without the A..D2 notes.

**The review's findings** ([B21 D3 fix], 2026-09-26) - each confirmed finding, the case that reproduces it, what failed first
(`d3fix/ff-1-failing-first.log`: the new and extended cases over the D3 tree before any fix - 7 of 41 failing), and the fix:

| finding | severity | reproducing case | failed first | fix |
|---|---|---|---|---|
| `regressions-1`, `security-1`, `coverage-1`, `tests-1` | medium, low, medium, medium | replacement-roles case 7; B's router case 7 | "Please replace C3 with 10uF for the LDO." routed to `D-component-replacement` (every review phrasing did: the grammar's three free words ran through "10uf for the", no head anchor); the only "first with" negative passed on the '.' of "4.7k" | `router.ts`: PART_KIND_SWAP head-anchored and captures the object, `partKindSwap` appended (the object cut at OBJECT_END, an active kind heading it, letter-initial non-stop modifiers); breakage d3fix-b1 (the first-with lookahead removed) fails case 7 on "Replace R1 with 4k7 for a timer." |
| `tests-6` | low | B's router case 7 (moved, its reason next to it) | "Replace C3 with 10uF for the LDO." routed to the DAG while the composer called it an edit | the router fix; the case pins the superset (the kind swap the composer sends to the editor, value changes naming an active kind single) |
| `regressions-3`, `security-2`, `coverage-6` | low, low, low | page case 9 | D2's "the ONE bare gateway ... with no option" carried no D3 note | dated D3 notes in the same block on the D2, C and B pages; B's "one grammar" noted as a superset |
| `coverage-2`, `tests-3` | low, medium | page cases 7 and 10; route case 7 (passes by design: it pins the production fact) | the D21-16 clause closed the route half on the seam alone | D21-16's route half recorded as the envelope capability CONFIRMED and CONFIRMED-unreachable from a production POST; route case 5 retitled (the seam); the D2 and D notes restated; breakage d3fix-b3 (a fixed run id in `route.ts`) fails route case 7 alone (two POSTs, one run id) |
| `coverage-3`, `tests-2` | low, low | page cases 4 and 10; scenario17 case 7 (passes by design) | the variant table had no "one party cannot seal" row | the variants relabelled by what decides them, D21-37's closure restated (two sealed parties always escalate; a party that cannot seal never reaches the merge; the op choice decides), case 1's refusal tied to U1; breakage d3fix-b2 (the agent gateway's Tier 1 compile given a pin map) makes the delete SEAL and fails scenario17 cases 1, 2 and 7 |
| `coverage-5` | low | page case 10; scenario17 case 8 (passes by design) | section 3 claimed a data dependency (the sourcing evidence before the seal, the critic reading the others) | the order stated as a presentation and budget order only (the page, OD-107's text, `router.ts`'s comment, the D3 suites' comments) |

**Pin moves, each with its reason written next to it in the suite.**
- `b21-b-scheduler.test.ts` cases 1, 3, 5, 6, 7, 8, 9, 11, 12, 13 and 14: the replacement DAG gained the schematic specialist (task 3, the
  critic task 4) - read-only in the rig (no head mark); counts, task ids, not-started lists, the token ceiling (6 x (2 + 2 x 4) x 4 096)
  moved with it. Stale titles kept (case 1 "three specialists", case 5 "task 3"), retitled at the closeout (OD-113's pattern).
- `b21-b-router.test.ts` case 3 (the replacement phrasings' roles and the DAG data) and case 6 (a rule's list matched to its shape by
  identity: the replacement and full-circuit creation lists are now equal, role for role). [B21 D3 fix] Case 7 (review tests-6): the
  router's replacement rule is the composer's pairing OR the kind swap, a superset of the composer's grammar - the case now pins the
  divergence (the scenario-17 sentences the composer sends to the editor route to the DAG; value changes naming an active kind stay
  single) and the rule's call; its title ("one grammar") is kept for the closeout.
- [B21 D3 fix] The D3 suites' own titles that stated the review's overclaims were retitled in this uncommitted increment (scenario17
  case 1, route cases 3 and 5, page case 7, replacement-roles case 5 - the page cites them by index only); page cases 4 and 7 moved
  with the restated variants and the D21-16 clause, each with its reason next to it.
- `b21-b-chat-router.test.ts` cases 4 (starts, the follow-up's results, the schematic offered the Tier 1 edit, records; revision 8 ->
  11), 11 (the second specialist to RUN is now the schematic one, which hangs - its title stays true), 12b and 15 (starts, records), 16
  (the loop run ids) and 17 (six starts, the schematic offered both proposals with the authority loaded; revision 10 -> 13). Stale
  titles kept (cases 4 and 17 name B's and C's counts), retitled at the closeout; B's page case 8 still pins case 4's title to its
  "revision 8" - that pin and the title move together at the closeout.
- `b21-c-least-privilege.test.ts` case 1 (`FULL_CONTEXT_OFFERED`: the schematic specialist is offered the replacement over
  `fullContext`), 8 and 9 (the schematic task in the replacement DAG).
- `b21-d-chat-merge.test.ts` cases 2 to 5 (the schematic task, proposing nothing; revision 8 -> 11).
- `b21-d2-proposing-roles.test.ts` cases 1, 3, 4 and 8 and `b21-d2-provenance.test.ts` case 6: the replacement is live for the schematic
  role (its wrapper passes it; a gateway without the reads still blocks it). Stale titles kept ("stays DORMANT", "those five").
- Pages: the A..D2 pages carry dated `[B21 D3, 2026-09-26]` notes where D3 changed what they state; B's rule table row and DAG list, C's
  role table cell, D2's three tables move with the data they are; B's C46 and C's C33 are re-pinned (the specialist gateway's
  construction line, anchor moved, line unchanged); B's page states route cases 4 and 17 at revisions 11 and 13. [B21 D3 fix] The
  review round added dated notes in the SAME block as each statement D3 made untrue (D2's zero-authority paragraph, C's zero-authority
  paragraph and its "(C33, no option at all)" sentence, B's "(C46)" gateway sentence and its "one grammar" replacement rule) and
  restated D2's and D's part-review notes (the route statement stands); page case 9 pins each by the claim it restates.

**CI.** The four orchestration suites ride the `app/lib/agent/orchestration/__tests__` filter; the route suite is ONE explicit
`prompt-to-gerber` entry next to D2's (C32), admitted by the guard's `[B21 A]` case; no suite starts PGlite; none lives under
`app/lib/engineering/__tests__`.

**Gates** (one heavy job at a time, through the lock runner; figures in the implementer's report, re-run by the lead): every B21 suite
and the four B21 route suites with the CI guard; `app/api/chat/__tests__` in full; `app/lib/agent/__tests__` in full; the replacement
family's suites and its approval and reauthorization routes' suites with the other proposal families' suites D2 ran; the exposure /
tier / discovery pins; the import gates, chat closure ratchets and the route census (165); `app/lib/mcp/__tests__` in full (the B20 page
citations: no cited production file of a B20 page changed - `loop.ts`, `adapters.ts`, `route.ts`, `errors.ts` are untouched); tsc;
eslint on every new and changed TypeScript file. No descriptor, route, UI control, request key or generator input changed. [B21 D3
fix] The review round re-ran the same gates after its fixes; its only production change is `router.ts` (in place above the cited
lines, the kind swap's object check appended), and its three breakages (`route.ts`, `gateway.ts`, `router.ts`) were each restored
byte for byte and verified by hash.

Live behaviour with a real model: **BLOCKED-LIVE-QUALIFICATION** (LB-9). **UNKNOWN**: whether a live circuit specialist ever proposes a
Tier 1 edit of a timer's identity (the scripted parties here do, to exercise the disagreement) and whether a live schematic specialist
names the component rather than asserting a part.

## 7. For the lead — the reserved texts, in full

Each `### OD-…` below is the amendment for `OWNER_DECISIONS.md` (as `## OD-…`), in its format. Then the README row, the ledger
paragraph, the PROGRAM_STATE texts, the discovery closure clauses and the §10 amendment line. [B21 D3 fix] Every text below is as of
the review's fix round (2026-09-26).

### OD-107 — DAG caps and the role lists, amended: the replacement DAG holds two proposing roles (B21-D3, 2026-09-26)

- **Question:** scenario 17's `component-replacement` DAG held one proposing specialist, so its disagreement could not be structural
  (D21-37), and the runbook's own sentence did not route to it.
- **Amended:** `DAG_ROLE_LISTS["component-replacement"]` is `coordinator`, `circuit-topology`, `component-sourcing-evidence`,
  `schematic`, `verification-critic` - four specialists, within the cap of four. The order is a presentation and budget order only: no
  specialist reads another's result before B21-E (each specialist's objective is the coordinator's user message alone and its loop
  history is empty; the replacement's target is the verified exact authority of the coordinator's context, never the sourcing
  evidence). The router's `D-component-replacement` rule is ONE strict replacement grammar ([B21 D3 lead]; section 3): a replace / swap /
  substitute verb at the HEAD of the message (after a polite prefix), the FIRST `with` / `for` / `by` after it (`for` / `by` only
  before a / an - "for the LDO" is a purpose), the swapped-in object cut at its first preposition, clause word or sentence end, and an
  ACTIVE part kind (timer, regulator, LDO, op-amp, comparator, microcontroller, oscillator, driver) heading it after at most three
  modifiers that start with a letter and are no stop word - as the review round left it; the lead's adversarial sweep then replaced
  it with three whole-message request shapes anchored at both ends ("replace / swap (out) <part> with / for / by <new part>" or
  "substitute <part> with / by <new part>", "delete / remove <part> and replace it with <new part>", "substitute <new part> for
  <part>") in which NO token is open - the replaced part's seven shapes (an active designator, a listed MPN prefix, a listed standard
  number), a closed spec-word list and each kind's unit-bearing values for the new part (never an MPN or a number), at most one listed
  tail - ending in an active kind or a part word (which the imported composer pairing must agree with); a bare kind for a bare kind
  names nothing new, "would you" is an opinion, and the raw trailing punctuation decides a question. A question or retraction after the request, an existing part, an attribute, a documentation or location phrase, a
  value and a passive type stay `single` (replacement-roles cases 7, 8 and 9 - case 9 the sweep's corpus); the grammar fails toward
  one coordinator turn. B's router case 7 pins the rule's source (moved). The caps, the wall time and parallelism 1 are
  unchanged. Proven by `b21-d3-replacement-roles.test.ts` cases 5, 7, 8 and 9, `b21-d3-scenario17.test.ts` case 8 and B's moved router and
  scheduler cases.
- **The owner may choose otherwise:** keep the three-specialist list (scenario 17 then disagrees only in prose), route by MPN as well
  (a catalog lookup the router, a pure function, does not make today), or hand earlier specialists' results to later ones (a data-flow
  change for B21-E that would make the order load-bearing).

### OD-109 — Specialists never hold the three availability facts; the specialist gateway holds the published pin-facts reads, amended (B21-D3, 2026-09-26)

- **Question:** the replacement's sealer needs the server's published pin-facts reads, which only the coordinator's gateway received
  (D21-37).
- **Amended:** the runtime (`orchestration-runtime.ts`, the specialists' composition root) builds the specialist gateway with ONE option
  - the route's own source and reader (`loadRunReplacementPinFacts` under the request's signal and `DEFAULT_PIN_FACTS_DEADLINE_MS`):
  bounded, read-only facts of the part catalog, never a port, a minter, a prompt version or an executor; with no configured source, no
  option at all (the seal blocks `current-pin-authority-unavailable`, as the coordinator's). The three availability facts stay false; the
  eight elevation claims stay refused. The reader's closure reaches nothing the coordinator's read does not already use. Proven by
  `b21-d3-pin-facts.test.ts`.
- **The owner may choose otherwise:** withdraw the option (the replacement goes dormant again for specialists - one line in the
  runtime and the live list).

### OD-120 — Which of the 33 exposed tools each role may be offered, amended: the replacement is live for the schematic role (B21-D3, 2026-09-26)

- **Question:** D2 kept `sirkit.schematic.propose-component-replacement` dormant for specialists (its sealer's pin-facts reads).
- **Amended:** it is in `SPECIALIST_PROPOSAL_TOOL_IDS`; only the `schematic` row lists it, so it is live for that role alone; its
  sealer's context fact is the head mark (`SEALER_CONTEXT_FACTS`); the long-running placement and routing proposals stay dormant with
  their reasons; the wrapper's `role_not_permitted_tool` still covers everything outside the row. Proven by
  `b21-d3-replacement-roles.test.ts` and `b21-d3-scenario17.test.ts`.
- **The owner may choose otherwise:** make the replacement live for the circuit specialist too (a row change), or keep it dormant.

### The README row (`artifacts/ai-control-plane-b21/README.md`, a new row "B21-D3" after B21-D2)

| B21-D3 the replacement live for specialists; scenario 17's disagreement structural and deterministically resolved | `specialist-replacement.md`; code `app/api/chat/orchestration-runtime.ts` (the specialist gateway's one option, the route's pin-facts reader - line 260 in place, the function appended), `app/lib/agent/orchestration/role-tools.ts` (the replacement live, its row reason - in place), `app/lib/agent/orchestration/scheduler.ts` (its sealer's fact - in place), `app/lib/agent/orchestration/router.ts` (the replacement DAG with the schematic specialist and the kind-swap grammar - in place, its object check appended in the review round) | CONFIRMED (the runtime builds the specialist gateway with the published pin-facts reads and nothing else, the reader's closure reaching nothing the coordinator's read does not already use and an absent source blocking the specialist's replacement exactly as the coordinator's; the replacement live for the schematic role alone with its sealer's one context fact; the replacement DAG coordinator, circuit-topology, component-sourcing-evidence, schematic, verification-critic - a presentation and budget order only, no specialist reading another's result - and the runbook's sentence routing to it through a head-verb kind swap that keeps value changes, purposes, negations and questions single; scenario 17 through the real runtime and the production POST: a party that cannot seal never reaches the merge (the agent path's KiCad-delete block, peer or no peer) and the one sealed replacement is presented and approved through the replacement family's existing path with the run's principal, two sealed parties always escalated - which of the two follows the circuit specialist's op choice; OD-130's part review rendered at the route's envelope through the scheduler seam and CONFIRMED-unreachable from a production POST until B21-E's route-level resume; the never-execution sweep with the reader minting nothing; OD-107, OD-109, OD-120 amended; D21-37 closed; D21-16's route half recorded, not closed; D21-10's addendum; D21-38 found, low; the review round's eleven findings fixed test-first; 38 new cases in five suites; pin moves in B's scheduler, router and route suites, C's least-privilege suite, D's route suite and D2's two suites, with the A..D2 pages noted; no generator input changed) |

### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-D3 — the replacement live for specialists; scenario 17's disagreement structural and deterministically resolved (2026-09-26 local; increment workflow + lead; this commit)

- Test-first: the five D3 suites and the moved cases ran against HEAD's four production modules restored byte for byte
  (`d3/ff-1-failing-first.log`: 11 files, 49 of 98 failing, each on its own assertion or the missing export; the reader's closure, the
  flag-off byte identity and a read-only role's refusal passing before and after by design); then the code; then green.
- Code: `orchestration-runtime.ts` (the specialist gateway built over `specialistGatewayOptions(request.signal)` - the route's source and
  `loadRunReplacementPinFacts` under `DEFAULT_PIN_FACTS_DEADLINE_MS`, nothing else; line 260 in place, the function appended),
  `role-tools.ts` (the replacement moved from the dormant list to the live one, its row reason - in place), `scheduler.ts` (its sealer's
  fact, the head mark - in place), `router.ts` (the replacement DAG with the schematic specialist; the strict replacement grammar - lines 101
  and 177 in place, the grammar appended); the workflow's one explicit entry for the route suite. No route, descriptor, UI, request key or generator
  input changed; census 165/162/3/0.
- Scenario 17 through the real runtime and the production POST: one party cannot seal (the circuit specialist's delete refused
  `pins-unavailable` by the agent path's Tier 1 compiler - an empty pin map for every agent proposal, so the same with no peer - never
  reaching the merge; the replacement accepted by its family's checks, the merge's binding, the exact-authority rule and
  `sealed-in-run`, presented and approved through the replacement family's existing path with the run's principal); both seal (both
  verified, `conflict:same_field`, one escalation citing the exact authority - two sealed parties always escalate); OD-130's part review
  rendered at the route's envelope through the scheduler seam and CONFIRMED-unreachable from a production POST (a fresh run id per POST,
  no resume); an absent pin-facts source blocking the coordinator's and the specialist's replacement alike.
- Review round (2026-09-26, eleven confirmed findings, test-first: `d3fix/ff-1-failing-first.log`, 7 of 41 failing over the D3 tree):
  the kind-swap grammar sent value changes, purposes, negations and questions to the four-specialist DAG (regressions-1, security-1,
  coverage-1, tests-1 - `router.ts` head-anchored with the object check appended; replacement-roles case 7, B's router case 7 moved,
  tests-6); three A..D2 statements D3 made untrue got dated notes in their own blocks (regressions-3, security-2, coverage-6 - page case
  9); the page's resolution, part-review and order claims restated (coverage-2, coverage-3, coverage-5, tests-2, tests-3 - page cases
  4, 7 and 10; control cases scenario17 7 and 8 and route case 7). Breakages, each restored and verified by hash: the first-with
  lookahead removed from `router.ts` fails replacement-roles case 7; a pin map given to the agent gateway's Tier 1 compile makes the
  delete seal and fails scenario17 cases 1, 2 and 7; a fixed run id in `route.ts` fails route case 7.
- Pin moves with their reasons: B's scheduler (eleven cases), router (cases 3, 6 and, in the review round, 7) and route (cases 4, 11,
  12b, 15, 16, 17) suites, C's least-privilege cases 1, 8 and 9, D's route cases 2 to 5, D2's proposing-roles cases 1, 3, 4 and 8 and
  provenance case 6; stale titles kept for the closeout; the A..D2 pages noted; B's C46 and C's C33 re-pinned.
- Findings: D21-38, low (the composer routes the runbook's scenario-17 sentence to the schematic editor; an MPN-only swap stays single).
  RECORDED: a `contradicted` loser beside a presented winner does not exist under OD-122's order - two sealed parties always escalate and
  a party that cannot seal never reaches the merge (an open OD-122 question); OD-130's part review fires only for a seal the authority
  moved away from (a resume), which a production POST never performs until B21-E.
- Gates re-run one job at a time (the lead re-runs them): every B21 suite and the CI guard; `app/api/chat/__tests__` in full;
  `app/lib/agent/__tests__` in full; the replacement family's and the other proposal families' suites and approval paths; the exposure /
  tier / discovery pins; the import gates, closure ratchets and census; `app/lib/mcp/__tests__` in full; tsc; eslint - figures in the
  report.
- Records: `specialist-replacement.md`; OD-107, OD-109, OD-120 amended; D21-37 closed; D21-16's route half recorded (the envelope
  capability CONFIRMED, CONFIRMED-unreachable from a production POST, open for B21-E); D21-10's addendum; D21-38 found. Live: every
  B21 behaviour with a real model BLOCKED-LIVE-QUALIFICATION (LB-9).

### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-D3 committed on chapter/b21-specialist-orchestration: the specialist gateway holds the published pin-facts
reads (the route's own bounded reader) and nothing else, the replacement live for the schematic role, the component-replacement DAG with
two proposing roles (coordinator, circuit-topology, component-sourcing-evidence, schematic, verification-critic - a presentation and
budget order only) and the runbook's sentence routed to it by ONE strict replacement grammar anchored at both ends (the lead's
adversarial phrasing sweep, five rounds, 885 false DAG routes closed - no open token) that keeps simple commands single; scenario 17
structural through the production POST - a party that cannot seal never reaches the merge and the one sealed replacement is presented
and approved through the replacement family's existing path, two sealed parties always escalated; OD-130's part review rendered at the
route's envelope through the scheduler seam, CONFIRMED-unreachable from a production POST until the route-level resume; next B21-E".
`nextAction`: "B21-E test-first: provider routing by role (OD-117, B21-E1 - scenario 17's parties on their own providers), the
llm-provider breaker (OD-115), stop-reason normalization, the strict result tool (OD-116), the additive run events and the trace block
with the merge's decisions and the presentation (OD-112, OD-114's traced half, OD-126, OD-127), the route-level resume and the
userMessageDigest ledger (D21-4, OD-122 - it makes OD-130's part review reachable at the route, D21-16), the mid-DAG commit (D21-17's
open clause)". The report line for the closeout: `MULTI-AGENT STATUS: contracts and durable record (B21-A), the deterministic router,
the no-provider path and the bounded sequential scheduler with the store bound (B21-B), the nine roles with least-privilege subsets and
the no-elevation proof (B21-C), the deterministic merge with escalation and verification by the families' and the deterministic
verifiers (B21-D), proposing specialists whose artifacts are their own runs' gateway seals with the one accepted proposal presented for
human approval (B21-D2), the replacement live for the schematic specialist through the route's pin-facts reader and scenario 17's timer
replacement structural through the production POST - the one sealed replacement presented and approved, two sealed parties escalated
(B21-D3) delivered offline behind SIRKIT_ORCHESTRATION_ENABLED; provider routing, the route-level resume and evaluations pending
(B21-E..F); live disagreement / fallback / quota BLOCKED-LIVE-QUALIFICATION under LB-9`.

### Discovery closure clauses (`discovery.md` §4, appended to each defect; §10 gains a B21-D3 amendment)

- **D21-37 (a specialist cannot seal a component replacement)** — CLOSED by B21-D3: the runtime builds the specialist gateway with the
  route's own published pin-facts reader and nothing else (OD-109 amended; its closure reaches nothing the coordinator's read does not
  already use), the replacement is live for the schematic role (OD-120 amended), and the component-replacement DAG holds two proposing
  roles (OD-107 amended), so scenario 17's disagreement is structural: two SEALED parties on U1 are always escalated to the human (both
  `contradicted`, one escalation citing the exact authority), and a party whose edit cannot seal never reaches the merge (the agent
  gateway compiles every Tier 1 proposal with an empty pin map, so any KiCad delete blocks `pins-unavailable`, peer or no peer - its
  task is `accepted` with no action, so the persisted verdicts show no conflict), leaving the one sealed replacement presented and
  approved through the replacement family's existing path - which of the two outcomes follows the circuit specialist's op choice
  (`b21-d3-scenario17.test.ts` cases 1, 4 and 7, `b21-d3-chat-replacement.test.ts` cases 3 and 4). RECORDED: a `contradicted` loser
  beside a presented winner does not exist under OD-122's order - an open OD-122 question. B21-F's "timer replacement with provider
  disagreement" case runs these parties on two providers once B21-E1 routes by role.
- **D21-16 (a component replaceable only by its exact authority)** — the route half: the envelope capability CONFIRMED by B21-D3 and CONFIRMED-unreachable from a production POST - OD-130's part review and `request_atomic_review` render at the route's envelope (route case 5, through the scheduler seam), but in one route run the family's sealer seals only the exact target of the authority the merge reads, so the rule fires only on a seal the authority moved away from (a resume of the same coordinator run, which the runtime performs - `b21-d3-scenario17.test.ts` case 5), and the route mints a fresh run id per POST and never resumes (route case 7: two POSTs are two runs, each seal the exact target, no part review). OPEN for B21-E's route-level resume (D21-4); a model-written artifact is still refused before the merge.
- **D21-10 (no proposal-to-proposal comparison)** — addendum by B21-D3: the component-replacement DAG now holds two proposing specialists
  (circuit-topology and schematic), so a Tier 1 edit of U1 and U1's replacement escalate once (`conflict:same_field`) through the
  production POST (route case 4); reachable in three DAGs since D3.
- **D21-38 (new, low) — the composer sends the runbook's scenario-17 sentence to the schematic editor.** `routeComposerMessage`'s rule 8
  (`replace` is an edit verb; the 5b pairing names no part kind) routes "Replace the NE555 timer U1 with a lower-power timer." to the
  schematic editor, so the chat route (and the router's strict replacement grammar - B's router case 7)
  sees it only when the user overrides the route; and a swap naming only an MPN ("Replace U1 with a TLC555.") stays `single`.
  **CONFIRMED** (`b21-d3-replacement-roles.test.ts` case 5; B's router case 7). Closes: a UI increment (the composer's 5b pairing
  extended with the router's strict grammar, the B18-D composer suites moved with it - the lead assigns it to B21-E2).
- **§10, B21-D3 amendment:** OD-107, OD-109 and OD-120 amended as `specialist-replacement.md` states them (the replacement DAG with two
  proposing roles - a presentation and budget order only - and the strict replacement grammar; the specialist gateway's one option,
  the route's pin-facts reader; the replacement live for the schematic role); D21-37 closed (two sealed parties always escalated, a
  party that cannot seal never reaching the merge, the op choice deciding which); D21-16's route half recorded - the envelope capability
  CONFIRMED, CONFIRMED-unreachable from a production POST, open for B21-E's route-level resume; D21-10's addendum; D21-38 found (low);
  B's scheduler, router and route cases, C's least-privilege cases, D's route cases and D2's proposing-roles and provenance cases moved
  with their reasons; the A..D2 pages noted; the review round's eleven findings fixed test-first (the kind swap head-anchored with its
  object check, then replaced by the lead with ONE strict closed-vocabulary grammar after a two-round adversarial phrasing sweep; the stale A..D2 statements noted in their own blocks; the resolution, part-review and order claims restated with
  control cases); RECORDED: a `contradicted` loser beside a presented winner does not exist under OD-122's order (an open OD-122
  question).

## 8. Citations, as of base d5d3f05

The anchor is what is checked (it occurs exactly once in its file). For the four modules D3 changed (`role-tools.ts`, `scheduler.ts`,
`router.ts`, `orchestration-runtime.ts`) the line is the CURRENT line and page case 5 checks it; for every other file the line is as of
the base, for the reader (none of them changed in D3; the workflow gained one line after its cited ones).

| # | file | line | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/api/chat/orchestration-runtime.ts` | 260 | — | `const specialistGateway = createAgentToolGateway(deps.registry, specialistGatewayOptions(request.signal));` | the specialist gateway, built over the one option |
| C2 | `app/api/chat/orchestration-runtime.ts` | 500 | — | `export function specialistGatewayOptions(` | the route's source and reader, nothing else |
| C3 | `app/api/chat/route.ts` | 407 | — | `loadRunReplacementPinFacts(replacementFactsSource, atomicPartRevisionId, signal, DEFAULT_PIN_FACTS_DEADLINE_MS, role)` | the coordinator's reader, unchanged |
| C4 | `app/lib/agent/orchestration/role-tools.ts` | 244 | — | `export const SPECIALIST_PROPOSAL_TOOL_IDS: readonly string[] = Object.freeze([` | the live proposals, the replacement among them |
| C5 | `app/lib/agent/orchestration/role-tools.ts` | 251 | — | `is no longer dormant: live for the schematic role` | the dormant list without it |
| C6 | `app/lib/agent/orchestration/role-tools.ts` | 255 | — | `export function roleProposalToolIds(role: string): readonly string[] {` | a role's live proposals: its row intersected with the live list |
| C7 | `app/lib/agent/orchestration/scheduler.ts` | 681 | — | `export const SEALER_CONTEXT_FACTS = Object.freeze({` | the replacement's sealer fact: the head mark |
| C8 | `app/lib/agent/orchestration/role-tools.ts` | 41 | — | `LIVE_PIN_FACTS = "Live since B21-D3:` | the schematic row's reason, live |
| C9 | `app/lib/agent/orchestration/router.ts` | 48 | — | `"component-replacement": Object.freeze(["coordinator", "circuit-topology", "component-sourcing-evidence", "schematic", "verification-critic"] as const)` | the replacement DAG, two proposing roles |
| C10 | `app/lib/project/composer-routing.ts` | 79 | — | `const PART_KIND_SWAP = ` | [B21 D3 lead] the polite prefix stripped; the replacement forms must match ALL that follows it ([B21 E4, 2026-09-28] re-pinned: moved verbatim with the grammar from `router.ts:101` into the composer module, D21-38 - `composer-and-first-turn.md`) |
| C11 | `app/lib/agent/orchestration/router.ts` | 177 | — | `if (facts.hasSchematic && partKindSwap(message, userMessage)) return dag("D-component-replacement"` | the rule: ONE strict grammar ([B21 D3 lead] anchor re-pinned: the unanchored pairing is no longer the rule) |
| C12 | `app/api/chat/route.ts` | 397 | — | `const replacementFactsSource = resolveReplacementPinFactsSource();` | the route's source, the one the runtime resolves too |
| C13 | `app/api/chat/replacement-facts-runtime.ts` | 67 | — | `export const DEFAULT_PIN_FACTS_DEADLINE_MS = 5_000;` | the deadline |
| C14 | `app/api/chat/replacement-facts-runtime.ts` | 81 | — | `if (externalSignal?.aborted) return null; // pre-aborted` | a pre-aborted request never reads |
| C15 | `app/lib/fixture-runtime/blinker/authority.ts` | 111 | — | `export function fixtureReplacementPinFactsSource(` | the fixture pin-facts source reads published snapshots only |
| C16 | `app/lib/agent/loop.ts` | 219 | — | `if (descriptor.toolId === "sirkit.schematic.propose-component-replacement"` | the replacement's prerequisite: the component authority |
| C17 | `app/lib/engineering/replacement-proposal-assembler.ts` | 263 | — | `return blocked("current-pin-authority-unavailable",` | an absent source blocks the seal |
| C18 | `app/lib/agent/gateway.ts` | 494 | — | `const proposalService = options?.proposalService ?? new ProposalInvocationService(registry, options?.now, options?.replacementPinFacts);` | the sealer receives the reader |
| C19 | `app/lib/agent/orchestration/scheduler.ts` | 691 | — | `export function specialistContextFor(context: AgentRunContext, role: SpecialistRole): AgentRunContext {` | the proposing context: the derivation plus its sealer's fact |
| C20 | `app/lib/agent/orchestration/scheduler.ts` | 60 | — | `maxSpecialists: 4,` | four specialists, within the cap |
| C21 | `app/lib/project/composer-routing.ts` | 34 | — | `const EDIT_VERB = ` | D21-38: the composer's edit verbs, `replace` among them |
| C22 | `app/lib/engineering/schematic-plans.ts` | 303 | — | `blockers.push({ code: "pins-unavailable",` | the Tier 1 compiler refuses a KiCad delete without published pins |
| C23 | `app/lib/agent/orchestration/merge.ts` | 823 | — | `else if (!isExactTarget(action.replacement, exact)) findings.push(` | the exact-authority rule (OD-130) |
| C24 | `app/lib/engineering/replacement-proposal-assembler.ts` | 244 | — | `return blocked("expected-mpn-mismatch",` | the model may assert, never choose |
| C25 | `app/lib/agent/orchestration/merge.ts` | 861 | — | `const survivors = judged.flatMap(` | two surviving changes of one component escalate |
| C26 | `app/lib/agent/orchestration/merge.ts` | 911 | — | `const reviewRequests: MergeReviewRequest[] = judged.flatMap(` | the part review request |
| C27 | `app/lib/agent/orchestration/merge.ts` | 1065 | — | `if (merged.tasks.some((task) => task.decision === "contradicted")) return withheld("contradicted");` | a contradicted result withholds every presentation |
| C28 | `app/lib/project/replacement-approval-controller.internal.ts` | 77 | — | `export async function approveAndApplyReplacement(deps: ReplacementApplyDeps): Promise<ApprovedReplacementApplyOutcome> {` | the family's approval controller |
| C29 | `app/api/replacement-authority/route.ts` | 74 | — | `export const POST = authenticatedJsonRoute(` | the real reauthorization endpoint |
| C30 | `app/lib/engineering/approved-replacement-mutations.ts` | 327 | — | `export async function applyApprovedReplacementProposal(input: ApprovedReplacementApplyInput): Promise<ApprovedReplacementApplyOutcome> {` | the apply: fresh facts, recompile, byte match |
| C31 | `app/lib/agent/gateway.ts` | 395 | — | `targetPinFacts = await this.replacementPinFacts(exact.atomicPartRevisionId, "target");` | the target comes from the authority the context holds |
| C32 | `.github/workflows/deterministic-manufacturing.yml` | 148 | — | `app/api/chat/__tests__/b21-d3-chat-replacement.test.ts` | the one explicit CI entry |
| C33 | `app/lib/agent/orchestration/scheduler.ts` | 301 | — | `SPECIALIST_PROPOSAL_TOOL_IDS.includes(input.toolId)` | the wrapper admits a live proposal of the role's list |
| C34 | `app/lib/project/composer-routing.ts` | 161 | — | `function partKindSwap(message: string, raw: string): boolean {` | [B21 D3 lead] the three whole-message request shapes with closed vocabularies, anchored at both ends; a part word agrees with the composer's pairing ([B21 E4, 2026-09-28] re-pinned: moved verbatim from `router.ts:282` and exported - the ONE predicate the composer's rule 5b and the router's rule (C11) call, D21-38) |
| C35 | `app/lib/agent/orchestration/scheduler.ts` | 507 | — | `const objective = specialistObjective(task.role, coordinator.userMessage, offersProposal(allowed));` | [B21 D3 fix] a specialist's objective: the coordinator's user message alone |
| C36 | `app/lib/agent/orchestration/scheduler.ts` | 550 | — | `{ runId, provider: route?.provider ?? coordinator.provider, history: [], userMessage: objective, budget, signal: controller.signal },` | [B21 D3 fix] its loop history is empty: no earlier result reaches it ([B21 E1, 2026-09-27] anchor re-pinned, line unchanged: the run carries the provider it runs on, so its seals name it) |
| C37 | `app/lib/agent/gateway.ts` | 330 | — | `const compilation = compileTier1Proposal(schematic, { ops, pinsByPartId: new Map() });` | [B21 D3 fix] every agent Tier 1 proposal compiles with an empty pin map: any KiCad delete blocks |
| C38 | `app/api/chat/route.ts` | 367 | — | `run-${randomUUID()}` | [B21 D3 fix] a fresh run id per POST: the route never resumes |
