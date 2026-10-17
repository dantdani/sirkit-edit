# B21-D — the deterministic merge layer: merge and disagreement

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Tree
`chapter/b21-specialist-orchestration`, base `5f1b498` (the B21-C commit); written 2026-09-26, revised the same day by the review fix
pass (section 7: the adversarial review's 30 confirmed findings, each fixed test-first). Every `[B21 D]` statement below is pinned by
`b21-d-page.test.ts` (the rule table IS `MERGE_RULES` and every case it names exists, the verifier table IS `MERGE_VERIFIERS`, the
family-code table IS `MERGE_FAMILY_CODES`, the own-code table IS `MERGE_OWN_CODES`, the vocabularies are quoted from the code, every
citation resolves by content exactly once and, for the new module, the runtime file and the scheduler, on the line it states, every
suite row carries its real `it(` count, every review finding names the case that reproduces it) or by the suite it names. D
implements against the provider facts recorded in `provider-reference-notes.md` (OD-118) and touches no provider feature (no request
key, no adapter, no model choice), so no page was re-read; no model is called anywhere in the merge or in D's suites - every
specialist is a scripted in-process adapter behind the existing provider-neutral runtime, and the merge itself consults nothing but
verifiers.

## 0. What D delivers, and what it is not

- `app/lib/agent/orchestration/merge.ts` — the deterministic merge over the scheduler's outcome (C1..C26, C56..C67): input the
  coordinator's verified context (its pinned `RevisionBoundProjectScope` is `requestScope(context)`, the scope every request was bound
  to; its actor), the scheduler's `ran` outcome and the injected clock; output the closed `sirkit.orchestration-merge.v1` view
  (`MergeOutcome`, digest included) - the ACCEPTED proposed actions (each still an inert artifact whose provenance the merge cannot
  establish), the per-result decisions with their reasons and findings, the ESCALATIONS and PART REVIEW requests for the human, the
  deterministic VERIFICATIONS and candidate checks as `EvidenceReference`s, the sources, the records it persisted and one bounded line
  per dissent, escalation and review request - or `refused` (`store_unavailable`, `store_refused`, `store_conflict`) with no view at
  all. **CONFIRMED** by `b21-d-merge.test.ts` (23 cases) and `b21-d-verification-requests.test.ts` (8 cases).
  [B21 D2, 2026-09-26] Since B21-D2 every accepted action's provenance IS established - it was sealed by the gateway in its specialist's own run (`provenance: sealed-in-run`), the only way an artifact reaches the merge; an action outside a task's sealed set is refused `proposal-not-sealed-in-run` (`specialist-proposals.md`).
- The runtime wiring, minimal (C27..C31, C72..C74): `runOrchestratedChat` runs the merge after the scheduler's stand-down checks and
  before the envelope; the follow-up turn receives the MERGE's view (`mergedResultsEnvelope`, bounded by staged fallbacks whatever the
  merge holds) instead of the raw outcomes; a merge that cannot record its decisions stands down like B's other stand-downs (the
  coordinator's answer is the one terminal under a reason-only warning, no follow-up turn); the merge's lines ride the run log's
  `warning` channel; no new run event; B's `specialistResultsEnvelope` is marked superseded (no production caller - D21-36). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-E2 the merge's stand-down is a `degraded` event, `merge_unrecorded`, carrying the same sentence while the merge's own lines stay warnings - `run-events-and-trace.md`, OD-126; B's envelope is retired, D21-36, C74 citing its tombstone]
  **CONFIRMED** by `app/api/chat/__tests__/b21-d-chat-merge.test.ts` (7 cases) and B's route suite (its pin moves, section 7).
- The scheduler, in place and appended (C32, C68..C71; no line any B21 page cites moved): after a `stale` dissent the task re-runs at
  the NEXT attempt, so the re-run's own dissent (`malformed`, `escalated`) never shares an idempotency key with the stale dissent about
  the old result (the durable repository replays a repeated key's first commit without comparing payloads); a resume re-runs, instead
  of replaying, a committed result whose latest merge verdict is `stale` or `expired` (D21-17's regenerate signal); the
  manufacturing-readiness reviewer's frame shows it the one accepted readiness citation. **CONFIRMED** (merge cases 11, 22 and 23; B's
  scheduler case 13 carries the reviewed pin move).
- The import gate extended by case 7 (merge.ts in the entry set; its closure reaches no forbidden family, not even the fab preset data;
  it imports the layout apply's pure board builders, never the layout family's module).
- This page, pinned by `b21-d-page.test.ts` (7 cases; 9 since B21-D4), with the reserved texts written out in section 8.

Closes **D21-10** (a proposal-to-proposal comparison, as a capability: in production no specialist carries an artifact today, so no
artifact conflict reaches it - CONFIRMED-unreachable, section 6), **D21-11**'s artifact-envelope half (provider and reported model per
result, one provider = one source), **D21-12**'s dissent records, **D21-13** (the layout candidate wrapped in a scope), **D21-15** (a
readiness claim's carrier, for the reviewer role, structurally), **D21-16** (the candidate-part rule, as OD-130, with a part review
request) and **D21-17**'s stale clause against the request-time snapshot; records **D21-14** (a circuit/topology contradiction in prose
is not detected and not escalated: no ERC exists and the merge reads no prose, C49); finds **D21-34** (the layout candidate's own
`base` carries no scope - OD-133's follow-up), **D21-35** (the layout family's module reaches the executor, so its verifier is
injected) and **D21-36** (B's envelope superseded, pinned by B's and C's suites).

[B21 D2, 2026-09-26] D21-10's escalation is reachable in production since B21-D2: two proposing specialists that seal conflicting proposals in their own runs escalate once through the production POST (`b21-d2-chat-proposals` case 2); the CONFIRMED-unreachable statements below are as of B21-D (`specialist-proposals.md`).

**Zero authority by construction.** The merge mints, seals, applies, binds, qualifies, approves, purchases and releases nothing: it
reads the verified state, calls verifiers that return verdicts, and writes decision and dissent records to the orchestration record.
An accepted action is handed to the READ-ONLY follow-up turn as an identified inert artifact - never emitted as `proposal_ready`, never
presented for approval (OD-122: the coordinator's first turn remains the one side-effecting artifact of a user message). The families'
digests are checksums, not signatures: the merge binds an artifact to its family's keys and lifetime and to this run's principal, but
WHO produced it is not established, and nothing says otherwise (no "sealed", no "verified by the families" in any reason or header). No
specialist gains a tool: the OD-120 proposal ids stay dormant (the merge judges the ARTIFACT, never the messenger - merge case 12).
Deterministic validation outranks consensus: agreement changes no decision and yields no evidence, and one provider is ONE source. The
B18 grants, the B19 evidence rules (used here as the merge's labels, section 4), B20's OD-45/90/91/92 provider rules and OD-81's
directive matcher stand unchanged.
[B21 D2, 2026-09-26] Amended by B21-D2: a proposing role IS offered its live proposals (the Tier 1 edit, the bounded PCB edit), WHO produced an artifact IS established (its specialist run's own gateway seal, `sealed-in-run`), and exactly one accepted action with nothing competing and nothing sealed by the coordinator is presented as the run's own proposal event - the merge itself still applies and approves nothing (`specialist-proposals.md`).

## 1. The merge's rules, in the runbook's order (B21-D :835-843)

The table IS `MERGE_RULES` (C7), row for row; every case it names exists (page case 2).

| rule | runbook | the runbook says | what the merge does | proven by |
|---|---|---|---|---|
| D1 | :835 | compares semantic object identities and base revisions | every proposed action is verified by its family against the pinned scope and head and bound by the merge to its family's keys, lifetime and this run's principal, then the survivors' identity keys (schematic and PCB joined through a footprint's sync identity) are intersected pairwise and each overlap of two different changes classified with ConflictClass | b21-d-merge case 2; b21-d-merge case 12; b21-d-merge case 17; b21-d-merge case 18 |
| D2 | :836 | retains every assumption and evidence reference | every judged result keeps its summary, assumptions, risks, questions and evidence references in the merge's view, each evidence reference with its standing (a label, never proof), and the record keeps the validated result | b21-d-merge case 5; b21-d-merge case 20 |
| D3 | :837 | detects contradictory part selection, pin mapping, net mapping, rule, geometry or readiness claims | part, pin-map, net-map, rule, geometry and readiness claims are compared by identity; a replacement target must be the exact authority (else a part review request), a layout candidate's board may not regress, and a readiness claim must reference the current report | b21-d-merge case 6; b21-d-merge case 7; b21-d-merge case 12; b21-d-merge case 19; b21-d-verification-requests case 2 |
| D4 | :838 | rejects stale results | a foreign-scope, stale-head, stale-base, stale-revision, stale-history, stale-lineage or policy-mismatched action, or one whose request is missing or bound to another scope, is dissent stale and an expired one expired, with the family's code; never merged; a resume re-runs a result the merge judged stale or expired | b21-d-merge case 3; b21-d-merge case 4; b21-d-merge case 11; b21-d-merge case 13; b21-d-merge case 14; b21-d-merge case 23 |
| D5 | :839 | requests deterministic verification where possible | every validation request runs its verifier with no model against the verified state and records the result digest as a deterministic_verifier evidence reference (evidence about that state, contradicting nobody); what a result proposes is verified on its own candidate | b21-d-verification-requests case 1; b21-d-verification-requests case 2; b21-d-verification-requests case 6 |
| D6 | :840 | escalates unresolved engineering conflicts to the human | a conflict between surviving actions makes every party contradicted and writes ONE escalation record naming what the human must decide; a non-exact part writes a part review request | b21-d-merge case 2; b21-d-merge case 19; b21-d-chat-merge case 2 |
| D7 | :841 | never converts majority agreement into proof | agreement changes no decision and yields no evidence - one change carried by several results is no conflict and no proof; the only evidence the merge produces is its own deterministic verification | b21-d-merge case 5; b21-d-merge case 16 |
| D8 | :842 | prevents correlated same-source/model output from appearing independent | one provider is ONE source whatever model or adapter its specialists ran on (since B21-E1 each runs on its own adapter and a role may run on a routed model of its provider) and whatever model it reports, and a replayed result's unrecorded provenance counts with every source; no text calls sources independent | b21-d-merge case 5; b21-d-merge case 6; b21-d-merge case 23 |
| D9 | :843 | records which provider/model produced each result without exposing secrets | each judged result carries its provider and reported model in the merge's view, the envelope and its persisted verdict, never in a sealed schema (OD-132); every reason and line is closed codes and ids | b21-d-merge case 1; b21-d-merge case 23 |

The order of judgement for each usable result (accepted or replayed by the scheduler; a `malformed` or `escalated` task was already
recorded by the scheduler and is never judged again): (1) every action - the request it answered must carry the pinned scope (C14:
`request-missing` / `scope-mismatch` are `stale`), then its family's verifier, then the merge's binding of what the checksums cannot
establish (C58: key set, lifetime, principal), then the geometry claim (a bounded PCB edit's recompile, C12; a layout candidate's board,
C59, C60); (2) the exact-authority rule on a surviving replacement; (3) its verification requests (evidence, C17); (4) its readiness
and qualification references; then (5) the pairwise intersection of every surviving action of every result that makes a DIFFERENT
change (C62). The result's decision is the most severe of its findings: `malformed` > `stale` > `expired` > `contradicted` > `accepted`
(C1). A result is handed on as a whole or not at all: an action of a result that is not `accepted` is withheld under the result's
decision.

## 2. The contradiction taxonomy and the identities

**Claims** (`MERGE_CLAIM_KINDS`, C2), each compared by identity, never by prose: `part` (a component instance two actions touch, or a
replacement target against the server-owned exact authority), `pin-map` (an endpoint `<componentInstanceId>::<pin>` a replacement's pin
mapping moves or a PCB action's net reaches through a bound footprint; the board's parity), `net-map` (a net name, a wire, a label, a
PCB net id; connectivity and the canonical validator), `rule` (a PCB edit's validation policy against the pinned DRC preset; DRC),
`geometry` (a PCB object, a whole-board placement or routing domain; a recompiled impact certificate; a candidate's board), `readiness`
(a reference to a ReadinessReport).

**Identities** (`MERGE_IDENTITY_KINDS`, C3; `<kind>:<id>`, the codebase's own stable identities - discovery §2.4): `component` (a
schematic component instance id; a PCB footprint joins it only through its immutable `syncIdentity.componentInstanceId`), `endpoint`,
`schematic-wire`, `schematic-label`, `net` (a net label's name), `pcb-object` (a changed copper, footprint, dimension or keepout id -
the bounded compiler's `changedObjectIds` - or a routed track/via id, or a placed footprint), `pcb-net` (a numeric PCB net id), `domain`
(a placement or routing of "all"). A Tier 1 edit contributes the components, wires and labels its operations name (and the ones a
delete removes - with every endpoint its bound footprint carries); a replacement its component, the endpoints of its pin mapping, the
wires and labels its impact moves; a bounded PCB edit its impact certificate's changed objects and affected nets; a layout candidate
its placements or its nets and routed items. **[B21 D fix] The two editors join** (C61): a PCB action's nets reach the schematic
endpoints `<componentInstanceId>::<pad>` of every footprint bound to a schematic instance by its sync identity - so a replacement of U1
and a routing of U1's net meet on `endpoint:u1-id::1` (merge case 18). **INFERRED**: the join takes the footprint's pad number as the
symbol's pin number (the mapping certificate's identity mapping); another mapping is not joined.

**Classification** (C9; `conflictForTransaction`'s vocabulary proposal to proposal, C41): an object both actions touch is
`edit_vs_delete` when either deletes it, `schematic_vs_pcb` when one is a schematic action and the other a PCB action, `same_field`
otherwise; nets shared and nothing else is `net_vs_routing`; a whole-board domain is `unknown_interaction`. The allowed resolutions are
`conflictForTransaction`'s (C42): `keep_head`, `manual_operation`, `proposal_branch`, `reject`, plus `rerun_candidate` for
`unknown_interaction` (`ALLOWED_RESOLUTIONS`, C4) - never `apply_incoming`: the merge applies nothing. Two actions that make the SAME
change (the same artifact, or two separately sealed edits with the same operations over the same base) agree with themselves: no
conflict, no evidence (C62, merge case 16). Conflicting actions form groups (connected components of the conflict graph, C21): every
party of a group is `contradicted` (`conflict:<class>`), and the group gets ONE escalation record under the content key `merge-<16 hex
of its subject digest>` (the prefix `merge-`) - the same escalation replays, a new one is its own; the subject carries the group's
CLAIMS (`escalationSubjectDigest`), so a re-judgement whose claims changed is a new escalation, never a `store_conflict` on the old
record (lead correction 2026-09-26; merge case 9c).

**The families' codes** (`MERGE_FAMILY_CODES`, C5): the Tier 1 and replacement codes are their verifiers' own (C33, C34); the PCB edit's
integrity codes are its verifier's (C35) and its currency codes the human-approved apply's own (`approved-pcb-mutations.ts`, C47) - the
merge checks the proposal's scope (board instance included), expiry (C36), board revision, history head, lineage and validation policy
against the pinned basis, then RECOMPILES the sealed operations against the verified board and byte-matches every digest (C12, the
compiler's own regression rules, C75); the layout candidate's are its verifier's (C37). `verifier-threw` is the merge's for a payload a
verifier could not inspect. Merge case 14 reaches each PCB currency code and `recompile-mismatch` with a real sealed edit.

| family | `malformed` | `stale` | `expired` | `contradicted` |
|---|---|---|---|---|
| `tier1` | `malformed`, `wrong-version`, `legacy-authorization-missing`, `altered`, `verifier-threw` | `foreign-scope`, `stale-head`, `stale-base` | `expired` | — |
| `replacement` | `malformed`, `wrong-version`, `legacy-authorization-missing`, `altered`, `verifier-threw` | `foreign-scope`, `stale-head`, `stale-base` | `expired` | — |
| `pcb-edit` | `malformed`, `wrong-version`, `legacy-authorization-missing`, `altered`, `verifier-threw` | `foreign-scope`, `stale-revision`, `stale-history`, `stale-lineage`, `policy-mismatch` | `expired` | `recompile-refused`, `recompile-mismatch` |
| `layout` | `UNKNOWN_CANDIDATE`, `verifier-threw` | `STALE_REVISION`, `STALE_GENERATION` | `EXPIRED` | `NOT_LEGAL` |

**The merge's own codes** - the table IS `MERGE_OWN_CODES` (C56), row for row (page case 7):

| code | decision | claim | when |
|---|---|---|---|
| `request-missing` | `stale` | currency | the request the result answered is not in the record, so its scope cannot be bound (OD-133) |
| `scope-mismatch` | `stale` | currency | the request the result answered was bound to another scope than the coordinator's pinned one (OD-133) |
| `unknown-key` | `malformed` | integrity | a Tier 1 or layout artifact carries a key its family never seals (its checksum re-sealed over it) |
| `lifetime-invalid` | `malformed` | integrity | an artifact created after the merge's clock, or living longer than its family's TTL |
| `binding-principal-mismatch` | `malformed` | integrity | an artifact's authorization binding names another principal than this run's actor |
| `candidate-not-applicable` | `contradicted` | geometry | a layout candidate cannot be applied to the verified board as its family's apply would apply it |
| `candidate-drc-regression` | `contradicted` | rule | a layout candidate's board carries a DRC error the verified board does not |
| `candidate-new-short` | `contradicted` | net-map | a layout candidate's board shorts, or contacts without proof, copper the verified board does not |
| `candidate-connectivity-regression` | `contradicted` | net-map | a net complete on the verified board is incomplete on a layout candidate's board, or fewer nets are routed |
| `part-not-exact-authority` | `contradicted` | part | a sealed replacement's target is not the instance's verified-exact authority (a PART REVIEW request follows, OD-130) |
| `part-authority-unverified` | `stale` | part | this run holds no verified-exact authority for the replaced instance |
| `validation-base-stale` | `stale` | currency | a validation request names another revision than the pinned one (it is not run) |
| `readiness-claim-unreferenced` | `malformed` | readiness | the manufacturing-readiness reviewer's result carries no readiness reference (free text) |
| `readiness-report-stale` | `stale` | readiness | a readiness reference names another report than the current one, or the current report is not fresh |
| `readiness-reference-altered` | `malformed` | readiness | a readiness reference names the current report with another digest |
| `readiness-unresolvable` | `stale` | readiness | the merge cannot recompute the current report (no board or no preset) |
| `qualification-authority-unverified` | `stale` | readiness | a qualification-authority reference: no verifier of it is in the merge's closure, so it never satisfies OD-129 |
| `evidence-namespace-reserved` | `malformed` | integrity | a specialist's evidence reference claims an id in the merge's own `merge-verification:` / `merge-candidate:` namespace |
| `proposal-not-sealed-in-run` | `malformed` | integrity | [B21 D2] an action is not an artifact its specialist's own run sealed through its gateway (the scheduler refuses a model-written one first; this is the merge's second check) |
| `conflict:<class>` | `contradicted` | the shared identity's | the action's identities overlap another surviving action that makes a DIFFERENT change (one escalation per group) |
| `evidence-missing` | `accepted` | evidence | [B21 F3] an accepted result of an evidence-gathering role (component-sourcing-evidence) cites no evidence: the gap is named in its decision record and the envelope marks the result no evidence cited; the verdict stays accepted and nothing is invented (D21-44) |

**What the checksums cannot establish** (C58, merge case 17). A family's digests prove a body was not altered after it was sealed -
never who sealed it (`engineeringDigest` is two 32-bit FNV hashes; the PCB verifier says so itself). So the merge binds every artifact
to what it CAN check: the family's closed key set (`TIER1_ARTIFACT_KEYS`, `LAYOUT_ARTIFACT_KEYS`, pinned to the real sealers; the
replacement and PCB verifiers close theirs), a lifetime created at or before the merge's clock and no longer than the family's TTL
(`MERGE_FAMILY_TTL_MS`, C57, pinned to the families' constants), and an authorization binding naming THIS run's actor (the Tier 1 and
replacement `authorization`, the PCB `authorizationBinding` and `effectiveActor`; a layout candidate carries none). Everything else
about provenance is left unclaimed: an accepted verdict says "provenance not established: the digests are checksums, not signatures".
The refusals: `store_unavailable`, `store_refused`, `store_conflict`.
[B21 D2, 2026-09-26] Who sealed an artifact IS established since B21-D2: the scheduler hands the merge only what the specialist's own run's gateway sealed and the merge checks that set (`proposal-not-sealed-in-run` otherwise); an accepted verdict says `provenance: sealed-in-run` and no longer "provenance not established" - merge case 17's last assertions moved with that reason (`specialist-proposals.md`).

## 3. The verifier set: deterministic validation outranks consensus

Every `ValidationRequest` (A closed its binding to five verifier reads, C50) is EXECUTED by the merge with no model against the
coordinator's verified state, once per binding however often it is asked for (C17); a request whose `baseRevision` is not the pinned
revision is `stale` and not run (C16). Each verifier runs once per merge (memoized) and its result digest is recorded as an
`EvidenceReference` of kind `trace-event`, id `merge-verification:<binding>`, `sourceClass` `deterministic_verifier`,
`extractionMethod` `deterministic_inference`, unreviewed (C26); the readiness verifier also as a `readiness-report` reference (C8).
**[B21 D fix] A verification of the verified (BASE) state is evidence about that state and contradicts nobody** - a request carries no
expected outcome, so a failing base board says nothing about the result that asked (verification case 2: a sound Tier 1 edit and a
reviewer who reports the blockers are accepted, the failures recorded beside them). `inconclusive` and `unavailable` are never a pass.
The table IS `MERGE_VERIFIERS` (C6), in A's binding order:

| binding | runs | fails when | claim |
|---|---|---|---|
| `sirkit.manufacturing.readiness-inspect` | evaluatePcbFabricationReadiness over the verified board with the run's DRC and fabrication presets (schematic parity inside it) | the report's overallState is blocked (a ready report passes; incomplete or stale is inconclusive, never a pass) | `readiness` |
| `sirkit.pcb.revision-inspect` | pcbRevisionId and buildSchematicParityCertificate over the verified board and the proven netlist | parity fails (a pass needs a proven netlist; without one parity is not evaluated: inconclusive) | `pin-map` |
| `sirkit.project.canonical-revision-inspect` | computeProjectRevision, validateCanonicalSchematic and proveAgentNetlist over the verified canonical state | the recomputed revision is not the pinned one, the canonical validator reports an issue or the netlist proof fails (without the verified schematic or a proven netlist the proof did not run: inconclusive, never a pass) | `net-map` |
| `sirkit.validation.connectivity-verify` | computeConnectivity over the verified board | copper of two different nets touches (a short; an incomplete net, an airwire or an unproven contact is inconclusive, never a pass) | `net-map` |
| `sirkit.validation.drc-run` | runDrc over the verified board with the run's DRC preset rules | any violation of severity error | `rule` |

What "deterministic validation outranks consensus" means in code: a result's standing is decided ONLY by the families' verifiers, the
merge's binding of each artifact, the exact authority, the recomputed readiness report and the candidate checks - no count of agreeing
results, no confidence and no prose moves a decision; the merge's `evidence` is exactly its verifications' and candidate checks'
references (verification case 1), and a result whose claims every other specialist repeats gains nothing (merge cases 5 and 16). **What
a result PROPOSES is verified on its own candidate** (C59, C60): a layout candidate's board is built exactly as its family's apply builds
it (C76: the routing import restricted to the requested nets with its provenance check, or the placement transaction; a candidate the
apply would refuse is `candidate-not-applicable`) and held to the bounded compiler's own regression rules (C75): no new DRC error -
compared by WHAT it is (`drcViolationIdentity`: kind, items, objects, layer), never by its id, which hashes the measured value, so
a persisting violation whose gap changed is not new (lead correction 2026-09-26; merge case 9c) - no new short or unproven contact, no
net complete before and open after, no incomplete net split into more pad groups (partial routing progress is no regression), no
fewer routed nets - `candidate-drc-regression`,
`candidate-new-short`, `candidate-connectivity-regression`, `contradicted` with the new ids (verification case 2); a bounded PCB edit's
recompile already ran those rules. **A pass is only a check that really ran** (C66, C67): the canonical verifier without the verified
schematic or a proven netlist is `inconclusive` (`netlist-not-proven`, `schematic-unavailable`), connectivity with an open net, an
airwire or an unproven contact is `inconclusive` - pinned as literals on fixtures built per verifier (verification cases 1 and 6).
Parity, the canonical validator and the netlist proof run behind the two revision bindings (A's binding set has no id of their own;
widening the set stays a reviewed pin move). The verifiers mirror the read bindings the specialists call, so a specialist's digest of a
read can be compared with the merge's (the readiness reference, section 4).

## 4. The readiness evidence rule (OD-129) and the candidate-part rule (OD-130)

**Readiness (OD-129).** A readiness claim is accepted ONLY as a reference to a ReadinessReport - `{ reportId, designRevision,
manufacturingProfileId, freshness }`, carried as an `EvidenceReference` of kind `readiness-report` whose `id` is the report's `reportId`
and whose `digest` is the digest of the report as the readiness read returns it (`readinessReference`, C8; the read's own
`pinned.reportDigest`); never free text. Structurally, without judging prose: the manufacturing-readiness reviewer's result IS a
readiness claim, so a result of that role carrying no readiness reference is refused `malformed` (`readiness-claim-unreferenced`, C18).
**[B21 D fix]** The reviewer is SHOWN the one accepted form: its frame adds the citation rule (C70, C71; `READINESS_CITATION_RULE`), and
merge case 22 and route case 7 run a scripted reviewer that reads `sirkit.manufacturing.readiness-inspect` through the real loop and
gateway and fills the form from what the read returned - accepted, `verified-current`. The merge always recomputes the reviewer's report
(the runbook's "deterministic checks plus the manufacturing reviewer"). Every `readiness-report` reference in any result is resolved
against the report the merge RECOMPUTES from the verified board (C19): a reportId that is not the current one (another design revision,
profile or policy - the reportId is a hash over them) or a current report whose freshness is not `current` is `stale`
(`readiness-report-stale`); the right id with another digest is `malformed` (`readiness-reference-altered`, merge case 15); a match is
`verified-current`, and the verification record carries the report's identity. A qualification-authority reference cannot be checked
by the merge (no verifier of it sits in its closure), so it is `stale` (`qualification-authority-unverified`) wherever it appears and
never satisfies the rule (merge case 21). **Not detected:** another role's readiness PROSE - the merge judges no prose; it stays that
specialist's unverified claim in the envelope. The compiler's readiness `unavailable` (the sealed impact certificate) stays what it is:
the compiler never certifies readiness.

**Part (OD-130).** Only the server-owned exact authority may be a replacement target (the assembler's rule, C45, C46): a sealed
replacement whose target is not the instance's `verified-exact` authority is `contradicted` (`part-not-exact-authority`, C15) - a
candidate part is evidence plus a request for a human physical-binding review through the existing `request_atomic_review` path (C48),
never a replacement target. **[B21 D fix]** That request is now produced: every such target writes a PART REVIEW request record under
its content key `merge-<16 hex>` (C63) naming the instance, the candidate part, the exact authority and the path, with its own line
and envelope entry (merge case 19). With no verified-exact authority loaded for the instance the target is unverified
(`part-authority-unverified`, stale; merge case 15). Two part claims that disagree (two replacements of U1 - merge case 6) are also an
identity conflict: both are `contradicted`, and the ONE escalation cites the exact authority, names which target it is, and points the
other part to `request_atomic_review`. **Not detected:** a part named only in a result's prose.

**B19's evidence classes as the merge's LABELS** (C25): nothing a specialist cites is proof, and a standing changes no decision. A
specialist cannot attest a human review, so its `reviewed` flag is ignored; llm or ocr EXTRACTION is `quarantined` whatever the source
class, as are the `llm_suggestion`, `ocr_extraction` and `external_mcp_tool` classes; a `distributor_catalog`, `third_party_cad` or
`cad_geometry_inference` reference is `sourcing-only` (sourcing never proves engineering); a `deterministic_verifier` or
`human_reviewed` class the merge did not produce or check, and a qualification authority, are `unverified`; everything else is
`claimed`; only a reference the merge recomputed is `verified-current`. A specialist reference in the merge's own `merge-verification:` /
`merge-candidate:` namespace is `malformed` (`evidence-namespace-reserved`, merge case 20). The standing rides with every retained
reference in the view and the envelope.

### [B21 F3, 2026-09-28] The evidence gap: the merge records it, nothing is invented (D21-44, the lead's option (a))

Runbook B21-F :869: "missing component evidence (a sourcing specialist returns no evidence -> the merge records the gap, nothing is
invented)". Until B21-F3 the merge had no evidence-presence rule: a sourcing result citing no evidence was `accepted` silently and the
gap stood only as the specialist's own blocking question (F's RECORDED note on F7, D21-44). This section is the lead's option (a),
applied in `merge.ts` and the runtime's envelope and pinned by `b21-f3-evidence-gap.test.ts` (case 9 pins this section and F3's reserved
texts in section 8). **CONFIRMED**.

- **The rule** (C80, C81, C78). An ACCEPTED result of an evidence-gathering role whose `evidence` list is empty gains ONE closed merge
  finding: `evidence-missing`, the LAST row of `MERGE_OWN_CODES` (C77, the own-code table in section 2), decision `accepted`, claim
  `evidence` (not a claim kind of the contradiction taxonomy: no identity is compared), no action index and no id. `accepted` is the
  least severe decision, so the result's verdict - the most severe of its findings (section 1) - stays what it was: the gap is recorded,
  never a rejection. It is applied once every other finding of the result is known, its conflicts included (C78), so only an accepted
  verdict gains it: a stale, expired, contradicted or malformed result keeps its own codes alone (case 1 the stale one; case 11 one
  bound to another principal, one its run did not seal, one past its family's TTL and one in conflict with another specialist's change,
  the last pinning the order after the conflicts). A replayed result is judged the same way (its evidence is the committed result's).
- **Which roles** (`EVIDENCE_GATHERING_ROLES`, C80): exactly `component-sourcing-evidence`, because its result IS evidence - every id of
  its OD-120 row is an evidence read, and its output is evidence plus a request for human review, never a target (OD-130). No other role
  is one: the requirements analyst's, the circuit specialist's, the schematic and the PCB specialist's results are claims or sealed
  proposals their families verify, so an evidence-free one stays accepted with no finding (case 6); the verification critic's evidence is
  the merge's OWN verification of what it requests (section 3); the manufacturing-readiness reviewer's already has its stricter rule,
  `readiness-claim-unreferenced` (`malformed`, OD-129, case 6); the cost/latency router holds no tool.
- **The record (OD-114).** A `decision` record, because the verdict is `accepted` and OD-114 writes an accepted verdict as a decision (a
  `dissent` is a rejection; the gap is not one) - the task attempt's ONE verdict record, exactly as every other own code rides its
  verdict's record: its reason names the gap as the closed code and the marker, `merge accepted with evidence-missing (no evidence
  cited): ...` (C79), never the specialist's prose, under the content key `<taskId>.merge-<16 hex>` of that verdict. The same verdict
  replays (a re-run of the same attempt writes nothing new); a verdict written before B21-F3 for the same result (no gap) is superseded by
  a record chained to it (`mergeVerdictTaskId`'s previous) and the latest stands, still `accepted` (case 3). A scheduler resume replays
  the committed result and the merge judges it the same way - the gap again, its verdict chained only for D's unrecorded replay
  provenance - and the next resume replays it again: an accepted verdict is never the regenerate signal (case 3). No record kind, key shape or
  decision value changed and no record is added: the gap rides the verdict's own record, so no revision count moved. The gap's clause
  survives a withheld reason: when the assembled reason fails the text rule (a provider-reported model id that is key-shaped, which the
  token rule for reported models admits), D's fallback keeps it - `merge accepted with evidence-missing (no evidence cited): findings
  withheld from the record; result <digest>` (C86, case 10) - so the record and the envelope's marker never disagree; without a gap D's
  fallback is byte for byte what it was.
- **The envelope** (C82, C83, C84). The follow-up turn's entry for that result carries the key `evidenceGap` with the closed value "no
  evidence cited" beside its merge verdict - the merge's marker, never the specialist's words - in the full, summaries, compact and ids
  stages; the counts stage counts such entries (`evidenceGaps`); and the header gains ONE closed sentence (`EVIDENCE_GAP_HEADER_NOTE`)
  telling the coordinator never to present that result's claims as evidenced and to say its evidence is missing (case 4). Without a gap
  neither the marker, the count nor the sentence is written in any of the five stages (case 4), so every other envelope is the one
  B21-F2's runtime wrote.
- **The stream: record-and-envelope only.** There is no new run-event type (the five stand), no warning line (the merge's lines stay one per
  dissent, escalation and review request, and an accepted verdict writes none), and `specialist_finished` is emitted by the scheduler
  before the merge runs, so it carries no merge finding. What the merge guarantees is the record and the marker; what the human reads of
  the gap is the coordinator's answer, and whether that answer names it is model judgment - the header's sentence asks for it, nothing
  enforces it: UNPROVEN offline (case 8: the scripted follow-up's answer omits it, and nothing on the stream names it). A stood-down
  follow-up (degraded `follow_up_paused` or `follow_up_failed`) shows the human nothing of the gap: the record alone holds it (INFERRED
  from the code: the follow-up's envelope is its only carrier besides the record). **RECORDED** residual for the lead: a deterministic
  human-facing line for the gap (in a vocabulary the E2 page allows) is not F3's - task item 3 allows record-and-envelope only.
- **Nothing invented.** No evidence reference, digest or source is added anywhere, so nothing is invented: the finding carries no id,
  the reason no digest but the result's own, the view no evidence and no verification of its own for it, and every `evidence` list of the
  record and the envelope stays as the specialists cited it (case 5; F's case 7 walks them through the production POST).
- **The approval decision is unchanged.** `specialistApprovalDecision` reads no finding: the sourcing role proposes nothing, and if it
  ever could, a gap never presents or blocks a proposal by itself - the decision with and without the gap is the same, `presented` and
  `escalated` alike (case 7), and the F7 scenario's `none_accepted` through the production POST (case 8).
- **Two records of a gap, never confused.** A sourcing specialist that is NOT RUN (no tool this run) is the scheduler's dissent
  `escalated`, `role_has_no_tools` ("its evidence stays missing", C85), and never reaches the merge (no marker: F's case 7); one that RAN
  and cited nothing is the merge's accepted `decision` with `evidence-missing`.

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-f3-evidence-gap.test.ts` | 11 | the gap on an accepted evidence-free sourcing result (and never on a stale one); none on an evidenced one; the record keyed and chained (OD-114), a resume's replay judged the same way and replayed again; the envelope's marker in every stage, and without a gap no marker, count or sentence in any stage; nothing invented; the rule's roles; the approval decision unchanged; the F7 scenario through the production POST; this section and F3's reserved texts in section 8; a withheld reason keeping the gap's clause (case 10); a malformed, expired or contradicted evidence-free result keeping its own codes alone (case 11) |

**Failing-first.** The first F3 implementer run wrote the suite first and ran it red against HEAD's merge before any production line
(its logs in the session's `b21/f3/`); it was cut off before its gates and report, and the relaunched run adopted its work as the sole
writer and re-established the evidence itself (`b21/f3/adopt/`, nine cases); after the adversarial review the swap was run again on
the final eleven-case suite (`b21/f3/fix/`): with HEAD's `merge.ts` and runtime put back in place (`git diff` empty for both; then
restored byte for byte, verified by sha256) all eleven cases are red - case 1 on the own-code list's last row, 2 on the evidence-free
result's findings, 3 on the replayed result's findings, 4 on the full stage's marker, 5 on the gap finding, 6 on
`EVIDENCE_GATHERING_ROLES` (not exported), 7 on the judged tasks' codes, 8 on the POST's decision records, 9 on the missing export, 10 on
the withheld result's findings (no gap), 11 on its control (the evidence-free result proposing nothing carries no gap) - and F's case 7
red on its moved assertion (the sourcing verdict's reason). Nine mutations of the F3 code on the final suite, each restored by hash: the
role gate dropped (cases 4, 6, 7, 8 red), the accepted-only guard dropped (cases 1, 10, 11), the gap made a rejection (every case but
9), the compact stage's marker dropped (case 4), the header sentence made unconditional (cases 2, 4, 11), the reason left silent (cases
1, 3, 8, 9), the guard widened to every decision but `stale` (case 11), the gap applied before the conflicts (case 11) and the count
written unconditionally (case 4).

**Pin moves, each with its reason beside it.** `b21-f-evaluation.test.ts` case 7 (reviewed: from "accepted, no gap recorded" to "the
merge records the gap" - the sourcing task's accepted `decision` names `evidence-missing` and the envelope marks that entry, and a task
never run carries no marker); `evaluation-matrix.md` (the F7 row and its RECORDED note, dated); the matrix cell (`_f-cases.ts` F7, the
B21 generator re-run: `evaluation-matrix.csv` and `.json` moved in that cell only, `replay-trace-pins-b21.json` unmoved); this page's
own-code table (page case 7: it IS `MERGE_OWN_CODES`). No other suite enumerates `MERGE_OWN_CODES`. Every edit above an existing line of
`merge.ts` and the runtime is in place (the own-code row on the list's last line, the finding's two widened types, the verdict's
decision, reason and withheld fallback, the envelope's four stage lines, its header line, one import) and the new code is appended, so
no line any B21 or B20 page cites moved: no citation was re-pinned (C77-C86 are new rows). No new run-event type, route, request key, control or tool; no change to the router,
the scheduler's replay rule or the approval decision's outcomes; the nine B11-scanned files untouched; no pinned B21-D digest moved.

**The adversarial review's findings (B21-F3, 2026-09-28), each answered test-first.** Six confirmed findings, five distinct, all low:

- `regressions-2` and `coverage-4` (one defect): D's withheld-reason fallback dropped the gap - a provider-reported model id that is
  key-shaped (the token rule for reported models admits it) makes the text rule refuse the assembled reason, and the `decision` record
  became `merge accepted: findings withheld from the record; result <digest>` while the envelope still marked the entry. Case 10
  reproduces it (red: the record's reason had no gap clause); fixed in place on C86's line (the fallback carries the same closed clause;
  without a gap it is D's text byte for byte); case 10 green.
- `coverage-1`: this section and the D21-44 closure clause stated what the coordinator's answer says as a guarantee (that the human
  reads it there; that the answer "cannot present" the claims as evidenced), while only the record and the marker are deterministic.
  Reworded (the stream bullet above: model judgment, UNPROVEN offline, a stood-down follow-up shows nothing, a RECORDED residual for the
  lead), with the reserved texts in section 8 and the runtime's comment on the sentence (in place); case 9's wording check was red on
  both phrases first.
- `coverage-3`: D21-46's reserved text said the view digest differs between two non-writing passes; a three-pass probe (not
  kept) shows the pass that chains a verdict reports the chained key (held) and every later pass that writes nothing reports the
  unchained key (not held), those later passes agreeing with each other - so it is the chaining pass's digest that differs from theirs.
  Reworded in section 8; case 9's wording check was red on the old phrase first.
- `tests-01`: case 4 checked the absence of the marker only in the full stage; it now renders the evidenced run through all five stages
  (no marker, no `evidenceGaps` count, no sentence in any). A mutation that writes the count unconditionally is red on case 4 alone.
- `tests-02`: only the stale branch of the accepted-only guard was reached; case 11 adds a malformed (another principal; not sealed in
  its run), an expired and a contradicted evidence-free sourcing result, each keeping its own codes alone in its findings, record, merge
  line and envelope. The guard widened to every decision but `stale` is red on case 11; the gap applied before the conflicts is red on
  case 11 (its contradicted result).

## 5. Persistence, the envelope, the route wiring and the scheduler

- **Persisted before anything is handed on** (C23, C24, C64): per judged result ONE record per merge pass - kind `decision` for
  `accepted`, kind `dissent` otherwise, OD-114's closed vocabulary (C51), a bounded reason of closed codes and ids (the provider and the
  model it reported, every verification the result asked for with its outcome and output digest, the recomputed readiness report -
  verification case 8), the result's digest as the subject - under the CONTENT key `<taskId>.merge-<16 hex of the verdict>` and the
  judged attempt, chained to the verdict it supersedes (so a verdict that RETURNS to an earlier value after another one - A, B, A - is
  recorded again and is the latest; a verdict identical to the latest writes nothing; lead correction 2026-09-26, merge cases 9 and
  9b); per escalation and per part review request one `decision` `escalated` under `merge-<16 hex>`; each write a
  compare-and-set append under `orchestration:<runId>:<key>:<attempt>:<kind>` (C52). The same verdict replays (nothing written); a
  CHANGED verdict on the same result - a later merge pass after an artifact expired or a new conflict partner arrived - is appended as
  its own record and the LATEST verdict of a task attempt stands (merge case 23); a key that holds ANOTHER body than its content says is
  never written over (`store_conflict`, merge case 9); a store that refuses or throws yields `refused` and no view. The outcome's
  `records` are exactly the store's merge records (merge case 9); the follow-up turn starts only after them (route case 4).
  [B21 F3, 2026-09-28] RECORDED: not once a replayed verdict was CHAINED - a later pass that finds the same verdict writes nothing but names its unchained content key, which the store does not hold (D21-46, new and low, found by F3's review and not fixed in F3; section 8's F3 texts).
  [B21 D4, 2026-09-28] D21-46 closed by B21-D4: a pass that writes nothing because the attempt's LATEST verdict is the same verdict now names THAT latest record's key in `records` (C87), chained or not, exactly as a replay of an existing key does - so the outcome's `records` are the store's merge records again, and two passes that find the same stored verdicts report the same view digest; nothing written changed (the B21-D4 subsection at the end of this section).
- **The scheduler reads the verdicts** (C68, C69): a resume re-runs a committed result whose latest merge verdict is `stale` or `expired`
  - the regenerate signal - at a new attempt, under a `stale` dissent `stale_verdict: …`, instead of replaying it (merge case 23); any
  other verdict replays (a conflict or a refusal is the human's to decide). The re-run after a stale dissent takes the next attempt
  (C32), so its own dissent never shares the stale dissent's key; B's scheduler case 13 carries the reviewed pin move.
- **Sources** (C65, C22): every specialist runs through this run's one adapter per provider (OD-117: one configured model per
  provider), so the source is the PROVIDER; the model a provider reports is recorded per result, never counted as independence (it is
  provider-controlled text); a replayed result's provider and model are not in the record, so its source is
  `(replayed: provenance not recorded)` and it counts with every other source; no text calls sources independent (merge cases 5, 6, 23).
  [B21 E1, 2026-09-27] Since B21-E1 every specialist runs on its OWN adapter (`agentAdapterForRole`) and the server env may route a role to another model of its provider, so "one adapter per provider" no longer holds; the rule stands, re-worded in place (C22, the D8 row, the streamed escalation sentence): one provider is ONE source whatever model or adapter its specialists ran on. OD-132's provider-and-model keying is re-deferred (`provider-routing-and-failure.md` section 3).
- **The envelope** (C31, C72, C73): the follow-up turn's user message carries the MERGE's view instead of the raw outcomes - each entry
  keeps B's leading fields and adds the merge's decision, reason and findings, the retained claims with each evidence reference's
  standing, and its actions (an accepted one identified by kind, artifact id, artifact digest, identities, the pinned scope's digest and
  its candidate check; a withheld one by kind, decision and digest only - no raw contradictory action), then the accepted actions (a
  layout candidate with its `RevisionBoundProjectScope`, OD-133), the escalations and part review requests with what the human must
  decide, the verifications and the sources. The header says the entries were judged by the deterministic merge, that nothing was
  applied, that provenance is not established, that claims stay the specialists' own unverified claims and that agreement is not proof.
  [B21 D2, 2026-09-26] The header now says every accepted action was sealed in its specialist's own run and an `approval` block says whether the one accepted action was presented to the human or why not (`specialist-proposals.md`).
  [B21 F3, 2026-09-28] An entry whose result the merge recorded as citing no evidence (`evidence-missing`) also carries the closed marker `evidenceGap` in every stage but the counts one (which counts such entries), and the header then carries one closed sentence (C82-C84; section 4's F3 section); every other envelope is unchanged.
  **[B21 D fix] Bounded whatever the merge holds:** five stages are tried in order until the sanitized text fits `MAX_RESULT_CHARS` -
  the whole view, claims cut to summaries, a compact view, ids and decisions only, counts only (constant size) - never a truncated
  document; route case 6 holds a real near-maximal merge (153 813 characters under the unchanged code) and a view inflated past every
  single fallback under the budget. B's `specialistResultsEnvelope` has no production caller since D (C74, D21-36).
- **The route wiring** (C27..C30): the merge runs after B's stand-down checks (a refused plan, a cancellation, a provider outage and
  a plan with no usable result stand down before it - nothing to hand on) and before the follow-up turn; its injected verifier and preset
  are bound OUTSIDE the gated prefix (`specialistMergeDeps`: the layout family's verifier - its module reaches the executor through the
  commit gateway, C38, C39 - and the run's fabrication preset data); one warning line per dissent, escalation and review request. The
  four runtime lines sit where B's one envelope line was, and the merge's composition is appended at the end of the file (an import is
  hoisted), so B's citations of this file moved only below line 279 (C48, C49 of B's page, re-pinned); the fix pass changed only the
  five doc lines of B's envelope in place and the appended section.

### [B21 D4, 2026-09-28] The merge's view names the records the store holds (D21-46)

D21-46 (found by B21-F3's review; pre-existing since B21-D): OD-114 as applied says the outcome's `records` are exactly the store's
merge records (merge case 9), but a pass that wrote nothing because a task attempt's LATEST verdict was the same verdict skipped it
before replacing its planned entry - so when that latest verdict was a CHAINED record (its content key names the verdict it superseded:
a replayed result's provenance, an expiry, another judgement in between) the view named the verdict's UNCHAINED content key, a key the
store does not hold (after A, B, A: the first A's key, a record the store holds but not the attempt's latest), and the view's digest -
carried in the follow-up envelope's head (C31) - was not the chaining pass's. B21-D4 closes it; this subsection is pinned by
`b21-d-page.test.ts` case 8 and the behaviour by the suite below. **CONFIRMED**.

- **The fix** (C87, in place on the persistence loop's skip line - no line moved): a pass that writes nothing because the attempt's
  latest verdict is the same verdict now puts THAT latest record's key, kind and record in its planned entry before it moves on, exactly
  as a replay of an existing key already did (the `existing` check beside C23: "a replay writes nothing"). So `records` names, for every
  judged attempt, the store's latest verdict record - chained or not - and two passes that find the same stored verdicts report the same
  records and the same view digest: the pass that chains a verdict and every later pass that writes nothing now agree.
- **What does not change.** Nothing is written that was not written before, and a pass that wrote nothing still writes nothing: no key
  shape, record kind, decision, reason or chaining rule moved (OD-114 unchanged; `mergeVerdictTaskId`, `sameVerdict` and
  `latestVerdictOf` untouched), and no verdict, approval outcome, run event, stream line or route changed. In production `records` is read
  only through the view digest the follow-up envelope's head carries (`mergedResultsEnvelope`, C31). A pass over unchained verdicts is
  byte for byte what it was (its planned key already was the stored one; case 2's control).
- **The consequence, stated once:** after a verdict is chained (a scheduler resume's replay, an expiry, a verdict returning A, B, A), the
  follow-up envelope of a later resume that writes nothing carries the chaining pass's merge digest - before B21-D4 it carried another
  one, the same for every such later pass.

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-d4-merge-records.test.ts` | 4 | a chained verdict (an expiry) and two passes that write nothing: every reference held by the store (read back), the later passes naming the chained key, the three views equal (digest and all); the unchained case unchanged (a first verdict and its replay: the same key, nothing written) beside a chained sibling; A, B, A still recorded under the key chained to B and the next pass naming it; a scheduler resume through the real scheduler and merge whose replayed verdict is chained - later resumes write nothing, name the stored key and carry the chaining resume's envelope head |

**Failing-first.** The suite was written first and run against HEAD's unchanged `merge.ts` (`b21/d4/d4-failing-first.log`): all four
cases red on their key assertions - case 1 on the later pass's reference (the unchained key), case 2 on the chained sibling's key, case
3 on the next pass's key (the first A's), case 4 on the second resume's key. A digest-only copy of the suite (its key assertions
removed; a scratch probe, not kept, `b21/d4/d4-failing-first-digests-probe.log`) was red on all four digest assertions - the view
digests of cases 1 to 3 and case 4's envelope head. Then the one-line fix (C87): green, 4 of 4.

**Pin moves: none.** No suite pins a merge view digest across a chained verdict and a later pass that writes nothing: merge case 10,
verification case 4 and F3 case 3 compare an unchained first pass with its replay or with a fresh record (unmoved); F3 case 3's pass
after its chaining resume reads the reason and the revision only (unmoved); merge cases 9, 9b and 23 read keys only of passes that
write (9b's last pass reads the revision only; unmoved); no suite or artifact pins a literal merge digest; the B21 replay pins (`replay-trace-pins-b21.json`) and the evaluation
matrix did not move (the generators re-run with zero drift). No line any page cites moved; C87 is a new row.

**Review.** The adversarial review's two confirmed findings (both low, both in the reserved texts of section 8; no code, record, digest
or pin affected) were fixed test-first through `b21-d-page.test.ts` case 9, red first on both (`b21/d4/fix/d4fix-failing-first.log`):
`coverage-1`, D4's reserved PROGRAM_STATE `nextAction` was built from F3's reserved draft, not from the nextAction the lead applied: it
is now the applied one with only its leading B21-D4 clause removed, word for word (the D21-36 retirement, the tripwire, the four
validation artifacts, a normal merge and each owner question by number kept); `coverage-2`, D4's section-10 line had no Section 7 clause:
it now records `Section 7, B21-D: amended` between its Section 6 and Section 8 clauses, as every section-10 entry does.

## 6. What D does NOT do

- No content judgement of prose: a summary, an assumption or a risk is never read for meaning (a directive-looking summary stays data
  under the header, B's route case 12b and D's route case 6; OD-81's matcher stays out of the chat route's closure). So a disagreement
  in PROSE - two circuit specialists' topologies, a part named in a summary, a readiness claim in another role's text - is carried to
  the follow-up turn as each specialist's unverified claims and is neither detected nor escalated.
- No escalation in production today: an escalation needs two surviving artifacts, and no specialist carries one (the OD-120 proposal ids
  stay dormant, a specialist's derived context has no head mark and no PCB basis, its registry is read-only) - **CONFIRMED-unreachable**
  (scheduler.ts `deriveSpecialistContext`, `readOnlyToolRegistry`); every escalation proof injects artifacts sealed by test code, as the
  artifacts a proposing role would carry.
  [B21 D2, 2026-09-26] Reachable since B21-D2: a proposing specialist carries the artifact its own run sealed, so two conflicting seals escalate in production (`specialist-proposals.md`); the B21-D suites now relay their test-sealed artifacts as the runs' own seal events.
- No provenance of an artifact is established (who sealed it); no mid-DAG commit is seen: the merge judges against the snapshot the
  request assembled - no server-side live head exists to re-read - and every apply re-verifies against the live head.
  [B21 D2, 2026-09-26] Provenance is established since B21-D2 (`sealed-in-run`); the mid-DAG commit stays B21-E/F's (`specialist-proposals.md`). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): B21-E3 closed only the live-head half - a resume judges the head the resuming request carries; a commit that lands DURING one request's DAG is still not seen by that request's merge, RECORDED, and every apply re-verifies - `route-resume.md` section 3 and its D21-17 closure clause]
- No model anywhere in the merge; no provider routing, breaker, strict result tool or trace block (B21-E); no evaluations (B21-F).
- No UI, no new run event, no new route, no new exposed tool, no new discovery channel, no generator input change.
- No proposal_ready (or any other presentation for approval) of a specialist's artifact: an accepted action reaches the read-only
  follow-up turn as data only (OD-122's one side-effecting artifact per user message stands).
  [B21 D2, 2026-09-26] Amended by B21-D2 (OD-122): exactly one accepted action with nothing competing and nothing sealed by the coordinator IS presented as the run's own `proposal_ready` / `pcb_proposal_ready` (`specialist-proposals.md`).
- No role gains a tool: the OD-120 proposal ids stay dormant; the merge judges every artifact by its family, whatever role carried it. [B21 D2, 2026-09-26] Since B21-D2 the proposing roles are offered their live proposals (`specialist-proposals.md`).
- No ERC: a topology contradiction between two circuit specialists has no deterministic tie-breaker (D21-14 recorded).

## 7. Suites, evidence, the review's findings, the pin moves, gates

| suite | `it(` blocks | what it proves |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-d-merge.test.ts` | 25 | accepted real artifacts with provenance, the layout scope wrap and the candidate check; `same_field` with one escalation; foreign scope; the families' stale and expired codes; one source per provider whatever model it reports, no agreement evidence; disagreeing part claims and the exact-authority citation; readiness free text, stale and current references; malicious results never reached, a re-sealed forgery refused; persistence before hand-on, content keys, fail-closed stores, no mutation; determinism; the re-run attempt after a stale resume; cross-family classes and the artifact-not-messenger rule; and cases 13-23 for the review's findings (section below) |
| `app/lib/agent/orchestration/__tests__/b21-d-verification-requests.test.ts` | 8 | the five verifiers executed with literal outcomes and recorded as `deterministic_verifier` evidence; base-state evidence contradicting nobody and a candidate's own board contradicted; a binding outside the five never reaches the merge; no network or clock; a stale base not run, readiness unavailable never a pass; every outcome reached on a fixture built for it; repeated requests one verification; the evidence persisted in the verdict |
| `app/lib/agent/orchestration/__tests__/b21-d-page.test.ts` | 9 | this page; [B21 D4] case 8: section 5's D4 note and subsection, C87 and D4's reserved texts in section 8; [B21 D4 review] case 9: D4's reserved nextAction (the applied one without its B21-D4 clause) and the section-10 lines' Section 7 clauses |
| `app/api/chat/__tests__/b21-d-chat-merge.test.ts` | 7 | flag off byte-identical to HEAD (B's four recorded digests); a disagreeing DAG's dissent and escalation lines and the merge's view with the escalation's own decision text and without raw actions; an agreeing DAG hands the accepted action on; the record holds the decisions before the follow-up turn; a merge that cannot record stands down; the production envelope bounded, sanitized and one source per provider; the readiness plan through the route |
| `app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts` | 7 | A's gate; [B21 D] case 7: merge.ts's closure and its references (the layout apply's pure board builders included), the layout module caught through the commit gateway |
| `app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts` | 14 | B's cases; [B21 D] case 13's pin move (the re-run attempt) |
| `app/api/chat/__tests__/b21-b-chat-router.test.ts` | 18 | B's cases; [B21 D] cases 4, 12b, 15 and 17 hold the merge's decisions (revisions 6 -> 8, 7 -> 10; case 4 the verdicts' content keys) |
| `app/lib/agent/orchestration/__tests__/b21-b-page.test.ts` | 8 | B's page; [B21 D] case 8's pin move (route case 4 at revision 8) |

**Test-first.** D's first pass: every new and changed suite ran against the unchanged production code first (`d-failing-first.log`:
8 files, the four new suites at import and 11 cases of the moved suites on their assertions), then the module (`d-impl-1.log`: 15 of 17;
case 11 failed on the UNCHANGED scheduler, which moved the scheduler line), then green (`d-impl-2.log`: 6 files / 61 tests). **The review
fix pass** (logs under the session's `b21/dfix/`): the reproducing cases were written first and run against the unchanged production code
(`f3-failing-first.log`: 27 of 55 failing, each on its finding's own assertion; `f11-failing-first-coverage-11.log` for the persisted
evidence), then the fix (`f4-fix-1.log`: 55 of 55; `f12-coverage-11-fixed.log`); each case that stayed green on the unchanged code (a
test-strength finding) was proven by a deliberate breakage of the FIXED source - every targeted case red, nothing else - and the source
restored byte for byte, verified by hash (`f6`..`f10`).

**The review's findings** - each confirmed finding, the case that reproduces it, what failed, and the fix (page case 7 checks every
finding is here and every case it names exists):

| finding | reproduced by | observed before the fix | fix |
|---|---|---|---|
| `regressions-1` | b21-d-chat-merge case 6; b21-d-verification-requests case 7 | 153 813 characters for a real near-maximal merge (budget 60 000); 96 145 with only B's one fallback (f9); 32 identical findings for 32 repeated requests | five envelope stages, the last constant-size (C72, C73); repeated requests are one verification |
| `regressions-2` | b21-d-verification-requests case 1; b21-d-verification-requests case 6 | the canonical verifier `pass` with no proven netlist; connectivity named no open net | inconclusive without the schematic or a proven netlist (C66); inconclusive on an open net, an airwire or an unproven contact (C67) |
| `regressions-3` | b21-d-merge case 22; b21-d-chat-merge case 7 | the reviewer's frame showed no citation form; its result refused `malformed` | the reviewer's frame shows the citation (C70, C71); the merge always recomputes the reviewer's report |
| `regressions-4` | b21-d-merge case 23 | `store_conflict` when a replayed run was merged again | verdicts under content keys (C64); a changed verdict is appended and the latest stands |
| `security-self-minted-artifacts-accepted` | b21-d-merge case 17; b21-d-merge case 8 | re-sealed forgeries (an extra key, a year-long lifetime, another principal) never refused | the merge binds key set, lifetime and principal (C58); no reason or header claims provenance |
| `security-source-count-provider-controlled` | b21-d-merge case 5; b21-d-merge case 6; b21-d-merge case 23; b21-d-chat-merge case 6 | two reported models of one adapter counted as two sources; `sameSource:false` | the source is the provider (C65); a replay's provenance unrecorded, counted with every source |
| `security-readiness-free-text-bypass` | b21-d-merge case 21 | a made-up qualification-authority reference accepted the reviewer's free text | a qualification-authority reference is `stale` and never satisfies OD-129 |
| `security-evidence-standing-self-asserted` | b21-d-merge case 20 | llm extraction and a self-reviewed llm suggestion labelled `claimed` | `reviewed` ignored, llm/ocr extraction quarantined, unverifiable classes `unverified`, the merge's namespace `malformed` |
| `coverage-1` | b21-d-page case 6 | the page and the D21-10 / D21-14 texts said a topology contradiction escalates by construction | restated: escalation CONFIRMED-unreachable in production; prose disagreement neither detected nor escalated |
| `coverage-3` | b21-d-merge case 23 | a replayed result was a second source (`openai/(unknown)`) | a replay's provenance is unrecorded and counts with every source |
| `coverage-4` | b21-d-merge case 20 | self-declared `reviewed` and `deterministic_verifier` honoured | as the standing finding; standings stated as labels that change no decision |
| `coverage-5` | b21-d-verification-requests case 1; b21-d-verification-requests case 2 | a sound Tier 1 edit and a correct reviewer `contradicted` by the base board | base-state verification is evidence only; a candidate's own board is checked (C59, C60) |
| `coverage-7` | b21-d-merge case 21 | a critic's readiness prose accepted; a made-up authority accepted | as the free-text finding; D21-15's closure narrowed to the reviewer role |
| `coverage-8` | b21-d-page case 6 | D21-17's stale clause claimed past the request-time snapshot | D21-17 narrowed; the mid-DAG commit left open for B21-E/F |
| `coverage-9` | b21-d-merge case 23 | an expired result replayed on every resume; a changed verdict blocked the run | the scheduler re-runs a result judged stale or expired (C68, C69); content keys |
| `coverage-10` | b21-d-merge case 18 | a replacement of U1 and a routing of U1's net did not meet | the endpoint join through a footprint's sync identity (C61) |
| `coverage-11` | b21-d-verification-requests case 8 | the verdict's reason held no verification | the verdict names each verification with outcome and output digest, and the readiness report |
| `coverage-12` | b21-d-chat-merge case 6 | the production envelope's bound, sanitizer and sources were untested | the production envelope tested; B's function marked superseded (C74, D21-36) |
| `coverage-13` | b21-d-merge case 19 | no review request was produced | a part review request record per non-exact target (C63) |
| `tests-1` | b21-d-merge case 13 | green on the unchanged code; red with the scope check neutralized (f6) | the case added |
| `tests-2` | b21-d-merge case 14 | green; red with the lineage check (f6) or the recompile byte-match (f8) neutralized | the case added |
| `tests-3` | b21-d-merge case 15 | green; red with the unverified-authority rule (f6) or the altered-reference rule (f7) neutralized | the case added |
| `tests-4` | b21-d-merge case 16 | two agreeing actions escalated `same_field` | one change carried twice is no conflict (C62) |
| `tests-5` | b21-d-merge case 23 | `store_conflict` after a scheduler replay; a replay counted as a second source | as regressions-4 and coverage-3 |
| `tests-6` | b21-d-chat-merge case 6 | red on the unchanged code (the bound); red with the stages cut (f9) or the sanitizer removed (f10) | the production envelope's checks added |
| `tests-7` | b21-d-verification-requests case 1; b21-d-verification-requests case 6 | the literals failed on the unchanged code; red with a constant connectivity outcome (f6) | literal outcomes on fixtures built per verifier |
| `tests-8` | b21-d-chat-merge case 2; b21-d-chat-merge case 3 | green on the escalation text; red with `humanDecision` dropped from the envelope (f9) | the escalation's own text asserted, and its absence without an escalation |
| `tests-9` | b21-d-merge case 18 | red on the unchanged code (no join); red with the cross-editor class (f6), the whole-board class (f7) or the join (f8) broken | the cases added |
| `tests-10` | b21-d-merge case 23 | a changed verdict appended under one attempt with no rule | the append documented: the latest verdict stands (OD-114 as applied) |
| `tests-11` | b21-d-merge case 8 | the layout spy could not be called; red with A's gate bypassed in the scheduler (f8) | a malicious result carrying a layout candidate, a positive control; case 12's fixture self-checks dropped |

**Pin moves, each with its reason next to it in the suite.** `b21-b-chat-router.test.ts` cases 4, 12b, 15 and 17: the merge persists
one `accepted` decision per judged result before the follow-up turn (the record's kinds gain them; the head revision 6 -> 8 and
7 -> 10; case 4's and 17's titles state the new revisions; case 4 elides the verdicts' content hex). `b21-b-page.test.ts` case 8: route
case 4's title names revision 8. `b21-b-scheduler.test.ts` case 13: the re-run after a stale dissent is at the next attempt (attempts
1 -> 2 and 2 -> 4; the dissents at 1 and 3). `b21-a-import-gates.test.ts` cases 1, 3 and 5: six modules to seven; case 7 names the
layout apply's pure board builders the merge imports. The pages that count these suites (A's §7, B's §6, C's §6) carry the gate's `it(`
count; B's page restates the two revisions and case 13's attempts and re-pins C48 and C49; B's and C's pages note B's envelope superseded
(no citation moved).

**CI.** The three orchestration suites ride the `app/lib/agent/orchestration/__tests__` filter; the route suite is ONE explicit
`prompt-to-gerber` entry (next to B's), admitted by the guard's `[B21 A]` case; no suite starts PGlite; none lives under
`app/lib/engineering/__tests__`.

**Gates** (one heavy job at a time, through the lock runner; figures in the report). Live behaviour with a real model:
**BLOCKED-LIVE-QUALIFICATION** (LB-9). **UNKNOWN**: whether a live proposing role would ever carry a sealed artifact (none can today:
section 6) [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): since B21-D2 a proposing role can - it carries what its own run's gateway sealed, section 6's D2 notes; whether a LIVE model does stays BLOCKED-LIVE-QUALIFICATION, LB-9]. **INFERRED**: the merge adds a DRC and a readiness evaluation per merge only when a result requests them or a reviewer runs
(memoized once per merge), and two DRC and two connectivity runs per surviving layout candidate.

## 8. For the lead — the reserved texts, in full

Each `### OD-…` below is the entry for `OWNER_DECISIONS.md` (as `## OD-…`), in its format; OD-114, OD-129, OD-130, OD-132 and OD-133
are the "as applied" texts; OD-120 gains a B21-D addendum. Then the README row, the ledger paragraph, the PROGRAM_STATE texts, the
discovery closure clauses and the §10 amendment line.

### OD-114 — Merge decisions and dissent as closed records, as applied (B21-D, 2026-09-26)

- **Question:** should merge-layer rejections of specialist results (and pre-invocation refusals) become traced events with a closed
  vocabulary?
- **Applied (the record half):** every merge verdict is a PERSISTED record of the orchestration run with the closed decision
  vocabulary (`accepted`, `stale`, `contradicted`, `expired`, `malformed`, `escalated`): per judged result and merge pass one record -
  `decision` for `accepted`, `dissent` otherwise - under a CONTENT key naming the task attempt it judges (`<taskId>.merge-<16 hex of the
  verdict>`, the judged attempt), with a bounded reason of closed codes and ids (the provider and the model it reported, every
  verification the result asked for with its outcome and output digest, the recomputed readiness report) and the result's digest as its
  subject; per unresolved conflict and per part review request one `decision` `escalated` under `merge-<16 hex>`; all written before
  anything reaches the follow-up turn. The same verdict replays; a CHANGED verdict on the same result (a later pass: an artifact
  expired, a new conflict partner) is appended as its own record and the LATEST verdict of a task attempt stands - the record is
  append-only and a key is never written over; a resume re-runs a result whose latest verdict is `stale` or `expired`. The TRACED
  `specialist_result` outcome class (and the trace block that carries it) stays B21-E's (OD-112); the single-agent path's untraced
  `tool_refused` (OD-17 D6) is unchanged.
- **The owner may choose otherwise:** a separate record kind per merge verdict with a verdict sequence (a store schema move), or the
  traced form first.

### OD-129 — The only accepted readiness evidence kind, as applied (B21-D, 2026-09-26)

- **Question:** what carries a readiness claim (D21-15)?
- **Applied:** a reference to a ReadinessReport `{ reportId, designRevision, manufacturingProfileId, freshness }` - an
  `EvidenceReference` of kind `readiness-report` with the report's `reportId` and the digest of the report as the readiness read returns
  it (`readinessReference` in `merge.ts`, the read's `pinned.reportDigest`); never free text. The merge RECOMPUTES the report from the
  verified board with the run's presets and accepts a reference only when it names that current report (another reportId, or a report
  whose freshness is not current, is `stale`; the right id with another digest is `malformed`); the manufacturing-readiness reviewer is
  SHOWN that form in its frame, its report is always recomputed, and its result carrying no readiness reference is refused `malformed`
  (`readiness-claim-unreferenced`) - structurally, without judging prose. A qualification-authority reference cannot be checked by the
  merge, so it is `stale` (`qualification-authority-unverified`) wherever it appears and never satisfies the rule. Another role's
  readiness prose is not detected (no prose is judged); it stays that specialist's unverified claim.
- **The owner may choose otherwise:** a structured readiness field in the result contract (a contracts schema move), or a verifier of
  the qualification authority in the merge (then a verified digest may satisfy the rule).

### OD-130 — A candidate part is evidence, never a replacement target, as applied (B21-D, 2026-09-26)

- **Question:** may the sourcing specialist propose a candidate part that is not the exact authority (D21-16)?
- **Applied:** no. Only the server-owned exact authority (a `verified-exact` component authority with its complete `exactAuthority`,
  the assembler's rule) may be a replacement target: a sealed replacement naming another target is `contradicted`
  (`part-not-exact-authority`) and writes a PART REVIEW request record for the human (`merge-<16 hex>`: the instance, the candidate part,
  the exact authority, the `request_atomic_review` path) with its own line and envelope entry; with no verified-exact authority loaded
  the target is `stale` (`part-authority-unverified`). Two part claims that disagree are also an identity conflict - every party
  `contradicted`, ONE escalation that cites the exact authority and names the review path. A part named only in prose is not detected.
  The exact target remains the only replacement target (OD-23).
- **The owner may choose otherwise:** an evidence-only candidate-part kind in the result contract that the envelope lists for review
  (a contracts schema move), or letting the human pick between candidates in a later UI increment.

### OD-132 — Provider and model per result live in the envelope, never in the sealed schemas, as applied (B21-D, 2026-09-26)

- **Question:** provider, model and run id in the sealed artifact schemas (v3 -> v4 / v2 -> v3; drop the constant `agent-tool-loop`)?
- **Applied:** the sealed schemas are unchanged (the PCB proposal keeps its constant `model: "agent-tool-loop"`, C53). Every judged
  result carries the provider it was dispatched through and the model that provider REPORTED, in the merge's view, the follow-up
  envelope and its persisted verdict reason. The source is the PROVIDER: the scheduler runs every specialist through this run's one
  adapter per provider (OD-117's one configured model per provider), and a reported model is provider-controlled text - recorded, never
  counted as independence. A replayed result's provider and model are not in the record, so its source is
  `(replayed: provenance not recorded)` and it counts with every other source. Nothing secret is recorded (closed codes, ids and model
  tokens only; an unrecognizable model string is recorded as `(unrecognized)`). The trace block that records them per step stays
  B21-E's (OD-112), which will key sources by the provider and model its per-role table dispatches with (OD-117).
- **[B21 E1, 2026-09-27] Amended:** since B21-E1 every specialist runs on its own adapter and a role may run on a routed model of its provider, so "one adapter per provider" no longer holds; the rule is re-worded: one provider is ONE source whatever model or adapter its specialists ran on. Keying sources by provider AND model is RE-DEFERRED (to the owner, with B21-F's evaluations): E1 keeps the provider as the key - conservative, it never presents two models of one vendor as independent sources. The trace block is B21-E2's (OD-112).
- **The owner may choose otherwise:** version the sealed schemas to carry provenance (three sealers, their verifiers and every pinned
  artifact move together), or persist provider and model with each result record (a store schema move) so a replay keeps them.

### OD-133 — Scope on the layout candidate, as applied (B21-D, 2026-09-26)

- **Question:** the layout candidate carries no tenant/project/branch/lineage scope (D21-13).
- **Applied:** wrapped, with no artifact schema change: every action of a judged result is bound to the `RevisionBoundProjectScope` of
  the request that result answered (read from the orchestration record); a request that is missing or whose scope is not the
  coordinator's pinned scope makes the action `stale` (`request-missing` / `scope-mismatch`, merge case 13), and an accepted layout
  candidate reaches the envelope WITH that scope. The candidate's own `base` (`{ revision, generation?, historyHead? }`) is unchanged
  because the editor's hooks share it - recorded as the follow-up defect D21-34.
- **The owner may choose otherwise:** a v2 layout candidate carrying its own scope (the editor hooks, the verifier and the candidate
  suites move together).

### OD-120 — addendum (B21-D, 2026-09-26)

- **Decided in D:** the ten dormant row entries stay dormant (no role is offered a proposal tool); the merge judges every proposed
  action by its FAMILY's verifiers whatever role carried it (the artifact, never the messenger) - a verification critic's sound Tier 1
  edit is accepted like the circuit specialist's (merge case 12) - and binds it itself to its family's keys, its lifetime and this run's
  principal, because the families' digests are checksums, not signatures; who produced an artifact is never claimed. **The owner may
  choose otherwise:** a role-row ceiling in the merge (only a role whose row names the family's proposal tool may carry its action) - a
  one-rule change pinned by a merge case.
- [B21 D2, 2026-09-26] Amended by B21-D2: the proposing roles' non-long-running proposals are live (the replacement stays dormant: pin-facts reads); a role that is never offered a proposal tool can no longer carry an artifact, since only its run's own seal reaches the merge (`specialist-proposals.md`).
- [B21 D3, 2026-09-26] Amended by B21-D3: the replacement is live for the schematic role (its sealer's pin-facts reads reach the specialist gateway), the replacement DAG holds two proposing roles, and the route's envelope renders OD-130's part review for a seal the exact authority moved away from - through the scheduler seam only: CONFIRMED-unreachable from a production POST until B21-E's route-level resume (`specialist-replacement.md`).

### The README row (`artifacts/ai-control-plane-b21/README.md`, replacing the planned B21-D row)

| B21-D merge and disagreement: the deterministic merge layer | `merge-and-disagreement.md`; code `app/lib/agent/orchestration/merge.ts`, `app/api/chat/orchestration-runtime.ts` (the merge between the scheduler and the envelope; its composition and the staged envelope appended), `app/lib/agent/orchestration/scheduler.ts` (the re-run attempt after a stale dissent; the regenerate signal on resume; the reviewer's citation rule - in place and appended) | CONFIRMED (every proposed action verified by its family's own integrity and currency verifier against the coordinator's pinned scope - stale and expired with the family's code, never merged - and bound by the merge to its family's keys, lifetime and this run's principal, provenance never claimed; a bounded PCB edit recompiled and byte-matched against the verified board; the layout candidate verified by its family's injected verifier, its board built as the apply builds it and held to the compiler's regression rules, and wrapped in its request's RevisionBoundProjectScope (OD-133); surviving actions that make different changes intersected pairwise by stable identity, schematic and PCB joined through sync identities, classified with ConflictClass and conflictForTransaction's resolutions, every party contradicted and ONE escalation per conflict group; the exact-authority rule on replacement targets with a part review request (OD-130); readiness only as a reference to the recomputed current report, the reviewer shown how (OD-129); the five verification bindings executed with no model as deterministic_verifier evidence about the verified state, a pass only for a check that ran; B19's evidence classes as labels; one provider = one source whatever model it reports; every decision, dissent, escalation and review request persisted under content keys before the follow-up turn, the latest verdict standing, never written over, a stale or expired verdict regenerated on resume; the follow-up turn given the merge's view, bounded by staged fallbacks, with no raw contradictory action; OD-114, OD-129, OD-130, OD-132, OD-133 applied, OD-120's addendum; D21-10 (as a capability, CONFIRMED-unreachable in production), D21-11's envelope half, D21-12's dissent records, D21-13, D21-15 (the reviewer role), D21-16, D21-17's stale clause (request-time snapshot) closed, D21-14 recorded, D21-34, D21-35 and D21-36 found; the adversarial review's 30 confirmed findings fixed test-first; 45 new cases in four suites plus gate case 7; pin moves in B's scheduler, route and page suites and A's gate; no generator input changed) |

### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-D — merge and disagreement: the deterministic merge layer (2026-09-26 local; increment workflow + lead; this commit)

- Test-first: the four D suites and gate case 7 were written first, with the pin moves of the A and B suites; all ran against the
  unchanged code (`d-failing-first.log`: 8 files - the four D suites at import, 11 moved cases on their assertions); then the module
  (`d-impl-1.log`: the merge suites 15/17 - case 11 failed on the unchanged scheduler, which is what moved the scheduler line; case 12
  on its fixture); then green with the wiring (`d-impl-2.log`: 6 files, 61 tests).
- Adversarial review fix pass: 30 confirmed findings (regressions-1..4, four security, eleven coverage, eleven tests) fixed test-first -
  the reproducing cases first against the unchanged code (`f3-failing-first.log`: 27 of 55 red, each on its finding's assertion;
  `f11` for the persisted evidence), then the fix (`f4-fix-1.log`: 55/55); every test-strength case proven by a deliberate breakage of
  the fixed source and a hash-verified restore (`f6`..`f10`). What changed: the envelope bounded by five stages; the canonical and
  connectivity verifiers never invent a pass; base-state verification is evidence only and a layout candidate's own board is checked by
  the compiler's rules; the merge binds each artifact's keys, lifetime and principal and claims no provenance; one provider = one
  source, a replay's provenance unrecorded; verdicts under content keys, the latest standing, a stale or expired verdict regenerated on
  resume; the reviewer's frame shows the readiness citation, a qualification-authority reference never satisfies OD-129; standings
  ignore a specialist's `reviewed` and read extraction; one change carried twice is no conflict; the schematic-PCB endpoint join; a
  part review request per non-exact target; the verifications persisted in the verdict; B's envelope marked superseded.
- Code: `app/lib/agent/orchestration/merge.ts` (the families' verifiers against the pinned scope, the merge's binding of each artifact,
  the PCB recompile, the injected layout verifier, the candidate board check and OD-133's scope wrap, the identity intersection and
  ConflictClass, the exact-authority rule with review requests, the readiness reference rule, the five verifiers as deterministic_verifier
  evidence, B19's labels, sources, persistence before hand-on under content keys, bounded lines, a digest over the view);
  `app/api/chat/orchestration-runtime.ts` (the merge between the scheduler and the envelope, its stand-down, the staged merged envelope,
  the injected verifier - appended; B's envelope's doc lines in place, no cited line moved); `app/lib/agent/orchestration/scheduler.ts`
  (the re-run after a stale dissent at the next attempt, the regenerate signal, the reviewer's citation rule - in place and appended, no
  cited line moved); the workflow's one explicit entry for the route suite. No route, descriptor, UI or generator input changed; census
  165/162/3/0.
- Pin moves with their reasons: B's route cases 4, 12b, 15, 17 (the merge's decisions; revisions 6 -> 8, 7 -> 10; case 4 the content
  keys), B's page case 8, B's scheduler case 13 (the re-run attempt), A's gate cases 1, 3, 5 (seven modules) and 7 (the layout apply's
  pure builders); A's, B's and C's pages carry the gate's count, B's page its restated revisions, case 13's attempts and re-pinned
  C48/C49, B's and C's pages the superseded envelope.
- Findings: D21-34 (low) - the layout candidate's own `base` carries no scope (OD-133's follow-up); D21-35 (low) - the layout family's
  module reaches the executor through the commit gateway, so the merge takes `verifyLayoutCandidate` by injection (gate case 7's probe);
  D21-36 (low) - B's `specialistResultsEnvelope` has no production caller and is pinned by B's route case 12 and C's least-privilege
  case 8.
- Gates re-run one job at a time (the lead re-runs them): the D suites and every B21 suite; `app/api/chat/__tests__` in full;
  `app/lib/agent/__tests__` (b09-*, b11-*, b18-*, b20-a4-*); the engineering exposure / tier / verifier suites; the MCP gates and
  `app/lib/mcp/__tests__`; the CI guard; tsc; eslint on every new and changed file - figures in the report.
- Records: `merge-and-disagreement.md`; OD-114, OD-129, OD-130, OD-132, OD-133 as applied, OD-120's addendum; D21-10 (as a capability),
  D21-11 (envelope), D21-12 (dissent records), D21-13, D21-15 (the reviewer role), D21-16, D21-17 (stale clause, request-time
  snapshot) closed; D21-14 recorded; D21-34, D21-35, D21-36 found. Live: every B21 behaviour with a real model
  BLOCKED-LIVE-QUALIFICATION (LB-9).

### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-D committed on chapter/b21-specialist-orchestration: the deterministic merge layer between the scheduler and
the envelope (the families' verifiers against the pinned scope and the merge's binding of each artifact, candidate boards held to the
compiler's rules, identity conflicts classified with ConflictClass and escalated once per group, the exact-authority part rule with
review requests, readiness only by reference, the five verification bindings executed with no model as evidence, one source per
provider, every verdict persisted under a content key before the follow-up turn; the adversarial review's 30 findings fixed); next
B21-E". `nextAction`: "B21-E test-first: provider routing by role (OD-117), the llm-provider breaker (OD-115), stop-reason
normalization, the strict result tool (OD-116), the additive run events and the trace block with the merge's decisions (OD-112,
OD-114's traced half, OD-126, OD-127), the route-level resume and the userMessageDigest ledger (D21-4, OD-122), the mid-DAG commit
(D21-17's open clause)". The report line for the closeout: `MULTI-AGENT STATUS: contracts and durable record (B21-A), the deterministic
router, the no-provider path and the bounded sequential scheduler with the store bound (B21-B), the nine roles with least-privilege
subsets and the no-elevation proof (B21-C), the deterministic merge with escalation and verification by the families' and the
deterministic verifiers (B21-D; escalation CONFIRMED-unreachable in production until a role carries an artifact) delivered offline
behind SIRKIT_ORCHESTRATION_ENABLED; provider routing and evaluations pending (B21-E..F); live disagreement / fallback / quota
BLOCKED-LIVE-QUALIFICATION under LB-9`.

### Discovery closure clauses (`discovery.md` §4, appended to each defect; §10 gains a B21-D amendment)

- **D21-10 (no proposal-to-proposal comparison)** — CLOSED by B21-D as a capability: `merge.ts` (`b21-d-merge.test.ts` cases 2, 6, 12,
  16 and 18): the surviving actions' stable identities are intersected pairwise (schematic and PCB joined through a footprint's sync
  identity) and each overlap of two different changes classified with ConflictClass and conflictForTransaction's resolutions
  (`same_field`, `edit_vs_delete`, `schematic_vs_pcb`, `net_vs_routing`, `unknown_interaction`); every party is `contradicted` and one
  escalation record goes to the human per conflict group. In production no specialist carries an artifact today (the OD-120 proposal ids
  are dormant, a specialist's context has no head mark and no PCB basis, its registry is read-only), so no conflict reaches the merge and
  no escalation is written - CONFIRMED-unreachable until a role is offered a proposal tool; a disagreement in prose is carried to the
  follow-up turn as each specialist's unverified claims, never escalated structurally. [B21 D2, 2026-09-26] The production half is closed by B21-D2: reachable in production (`specialist-proposals.md`).
- **D21-11 (provider/model identity not carried by the artifacts)** — the artifact-envelope half CLOSED by B21-D (OD-132): every judged
  result carries the provider it was dispatched through and the model that provider reported, in the merge's view, the follow-up
  envelope and its persisted verdict; one provider = one source (a reported model is never counted as independence) and a replayed
  result's provenance is unrecorded, counted with every source; the sealed schemas are unchanged; the trace half stays B21-E's (OD-112).
- **D21-12 (no traced field carries decisions or dissent)** — the dissent-records half CLOSED by B21-D (OD-114): every merge verdict is
  a persisted `decision` / `dissent` record under a content key naming the task attempt it judges, with the verifications it asked for;
  every escalation and part review request its own record; a changed verdict appended, the latest standing; the traced form stays
  B21-E's.
- **D21-13 (the layout candidate carries no scope)** — CLOSED by B21-D (OD-133): every action is bound to the RevisionBoundProjectScope
  of the request its result answered, a missing or mismatched request is `stale` (merge case 13), an accepted candidate reaches the
  envelope with that scope; the candidate's own `base` is the follow-up D21-34.
- **D21-14 (deterministic verification thin for circuit/topology claims)** — RECORDED by B21-D: the five verification bindings run DRC,
  connectivity, readiness with parity, the canonical revision with the canonical validator and the netlist proof, and the board revision
  with parity (each a pass only when its check ran); no ERC exists, so a topology contradiction between two circuit specialists has no
  deterministic tie-breaker - and it is not detected and NOT escalated: the merge reads no prose and an escalation needs two artifacts,
  which no specialist carries today; it reaches the human only as each specialist's unverified claims in the follow-up turn, whose
  header asks it to say what stays unresolved (the earlier wording "an escalation by construction" overstated this). [B21 D2, 2026-09-26] Since B21-D2 two circuit specialists' conflicting SEALED Tier 1 edits escalate in the full-circuit DAGs (`b21-d2-chat-proposals` case 2); a topology contradiction in prose is still neither detected nor escalated (`specialist-proposals.md`).
- **D21-15 (a readiness claim has no carrier)** — CLOSED by B21-D (OD-129) for the manufacturing-readiness reviewer, structurally: its
  result must reference the recomputed current ReadinessReport (its frame shows it how), free text from that role is refused, a
  qualification-authority reference is `stale` and never satisfies the rule (`b21-d-merge.test.ts` cases 7, 15, 21 and 22; route
  case 7); another role's readiness prose is not detected.
- **D21-16 (a component replaceable only by its exact authority)** — CLOSED by B21-D as OD-130: a non-exact target is contradicted and
  writes a part review request for `request_atomic_review`, disagreeing part claims escalate once citing the exact authority (cases 6
  and 19); a part named only in prose is not detected.
- **D21-17 (artifact lifetimes versus the DAG)** — the stale clause CLOSED by B21-D against the coordinator's request-time snapshot: a
  stale or expired artifact is dissent with its family's code, never a merge input, and a resume re-runs a committed result the merge
  judged stale or expired - the regenerate signal (cases 3, 4, 11 and 23); with B's wall-time clause the defect is closed. OPEN for
  B21-E/F: a commit that lands DURING the DAG is not seen by the merge (it judges against the snapshot the request assembled; no
  server-side live head exists to re-read) - every apply re-verifies against the live head, and section 9's planned B21-F case (results
  merged after a commit lands between them) needs a live head at merge time.
- **D21-34 (new, low) — the layout candidate's own `base` carries no tenant/project/branch/lineage scope.** B21-D wraps it in the
  request's scope inside the envelope (OD-133); the candidate itself (`LayoutCandidateBase`, C40) is unchanged because the editor's hooks
  share it. Closes: a follow-up outside B21 (a v2 candidate with its own scope, the hooks and the candidate suites moved together).
  Source: B21-D.
- **D21-35 (new, low) — the layout family's module reaches the executor.** `app/lib/pcb/candidates/layout-candidate.ts ->
  app/lib/engineering/pcb-commit-gateway.ts -> app/lib/engineering/editor-adapter.ts -> app/lib/engineering/executor.ts` (C38, C39;
  for `applyLayoutCandidate`), so no orchestration module may import `verifyLayoutCandidate`: the merge takes it by injection from the
  composition root (`specialistMergeDeps`), the D21-33 pattern; the merge builds a candidate's board with the apply's own PURE builders
  (the routing import command and its application, the placement transaction), whose closures reach no family. **CONFIRMED** (gate case
  7's probe). Closes: recorded; a follow-up outside B21 may move the pure verifier to a module of its own. Source: B21-D.
- **D21-36 (new, low) — B's `specialistResultsEnvelope` has no production caller.** Since B21-D the route builds the merge's
  `mergedResultsEnvelope` (C31); B's function (C74) stays only because B's route case 12 and C's least-privilege case 8 pin it. D's route
  case 6 carries their checks (the bound, the sanitizer, the sources, the not-run task) on the production envelope. Closes: the lead
  retires the function with those two cases' envelope assertions at the closeout (a reviewed pin move; B's page C45 and the OD-108 text
  that names it move with it). Source: B21-D review fix pass.
- **§10, B21-D amendment:** OD-114 (the record half, content keys, the latest verdict standing), OD-129, OD-130, OD-132, OD-133 applied
  as `merge-and-disagreement.md` states them, OD-120's addendum (dormant ids stay dormant; the merge judges and binds the artifact, never
  the messenger); the scheduler runs a task re-run after a stale dissent at the next attempt (B's scheduler case 13 moved) and re-runs a
  committed result the merge judged stale or expired; the reviewer's frame shows the readiness citation; B's route suite and page carry
  the merge's decisions (revisions 6 -> 8, 7 -> 10); the adversarial review's 30 confirmed findings were fixed test-first (section 7);
  the stop condition "a family's verifier cannot be called without the executor in the closure" was EVALUATED for the layout family: its
  module's closure does reach the executor (through `applyLayoutCandidate`'s commit gateway), so no orchestration module imports it and
  the merge calls the family's own, pure `verifyLayoutCandidate` by INJECTION from the composition root (the D21-33 pattern) - the
  merge's closure holds no executor; the lead decides whether injection is the intended reading of that stop condition or the pure
  verifier should first move to a module of its own (section 5, D21-35).

### B21-F3 — the reserved texts, in full (the lead's to apply)

[B21 F3, 2026-09-28] B21-F3 closes D21-44 under the lead's option (a) and adds no owner decision. OD-114's record shape does not change -
no record kind, key shape, decision value or chaining rule moved: the gap rides the accepted verdict's own `decision` record - so OD-114
needs no amendment of its shape; the addendum below only records that an accepted verdict may now name one non-rejecting code (the lead
applies it or leaves it). The adopting run's own review found ONE pre-existing defect in D's code, recorded below as D21-46 (new, low;
not fixed in F3); the adversarial review then confirmed six findings (five distinct, all low), each fixed test-first (section 4, the F3
section's findings list), none changing a verdict, an approval outcome or a pinned B21-D digest. One residual is the lead's, RECORDED
below: no deterministic human-facing surface names the gap. These texts are pinned by `b21-f3-evidence-gap.test.ts` case 9.

#### OD-114 — addendum (B21-F3, 2026-09-28)

- [B21 F3, 2026-09-28] Addendum (no shape change): an ACCEPTED verdict may carry ONE non-rejecting closed code, `evidence-missing`
  (D21-44, the lead's option (a)) - an accepted result of the evidence-gathering role (`component-sourcing-evidence`) that cites no
  evidence is recorded as `merge accepted with evidence-missing (no evidence cited): ...` in its task attempt's one `decision` record,
  under the same content key (`<taskId>.merge-<16 hex>`), chained to the verdict it supersedes, the latest standing; when the text rule
  withholds the reason, D's fallback keeps the clause (`merge accepted with evidence-missing (no evidence cited): findings withheld from
  the record; result <digest>`). No record kind, key shape or decision value changed; a verdict written before B21-F3 for the same
  result (no gap) is superseded by a chained record, still `accepted`; a resume still replays an accepted result
  (`merge-and-disagreement.md` section 4, the F3 section).

#### The README row (`artifacts/ai-control-plane-b21/README.md`, a new row "B21-F3" after B21-F2)

| B21-F3 the merge records the evidence gap (D21-44, the lead's option (a)) | `merge-and-disagreement.md` section 4 (the dated F3 section and its review findings; the own-code table's last row; citation rows C77-C86), `evaluation-matrix.md` (the F7 row and its RECORDED note, dated), `evaluation-matrix.{csv,json}` (the F7 cell only); code `app/lib/agent/orchestration/merge.ts` (the own-code row on `MERGE_OWN_CODES`' last line, the finding's two widened types, the verdict's decision, its accepted reason and its withheld fallback - six lines in place; the rule appended), `app/api/chat/orchestration-runtime.ts` (the envelope's four stage lines, its header line and one import - six lines in place; the marker, the count and the sentence appended) | CONFIRMED (an accepted result of the evidence-gathering role - `component-sourcing-evidence` alone, the reason no other role is one stated - that cites no evidence gains ONE closed merge finding `evidence-missing`, the last row of `MERGE_OWN_CODES`, decision `accepted`, claim `evidence`, only once every other finding is known (a malformed, stale, expired or contradicted result keeps its own codes): the verdict stays accepted and its task attempt's `decision` record names the gap under OD-114's content-keyed, chained records, a withheld reason included - a re-judgement writes nothing, a resume replays and judges the result the same way; the follow-up turn's envelope marks that entry `evidenceGap: "no evidence cited"` in every stage (the counts stage counts it) under one closed header sentence, and an envelope without a gap is unchanged in every stage; what the human reads of the gap is the coordinator's answer - model judgment, UNPROVEN offline (RECORDED residual: no deterministic human-facing line); nothing is invented - no evidence reference, digest or source anywhere the specialist did not cite; record-and-envelope only - no run-event type, no stream line; the approval decision unchanged (`presented` and `escalated` alike, F7's `none_accepted`); a specialist never run stays the scheduler's `role_has_no_tools` dissent; F7 through the production POST; eleven cases red first against HEAD's merge and runtime and F's case 7 red, nine mutations red, each restored by sha256; the adversarial review's six findings (five distinct) fixed test-first; F's case 7 moved as a reviewed pin; no line any page cites moved; D21-44 closed, D21-46 found) |

#### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-F3 — the merge records the evidence gap (2026-09-28 local; increment workflow + lead; this commit)

- D21-44 as the lead decided it (option (a)): the merge RECORDS the gap - an ACCEPTED result of the evidence-gathering role
  (`EVIDENCE_GATHERING_ROLES` = `component-sourcing-evidence` alone: its result IS evidence; every other role's result is a claim or a
  sealed proposal its family verifies, the critic's evidence is the merge's own verification and the readiness reviewer keeps its
  stricter `readiness-claim-unreferenced`) whose `evidence` list is empty gains ONE closed finding, `evidence-missing` (the last row of
  `MERGE_OWN_CODES`, decision `accepted`, claim `evidence`, no action, no id), applied once every other finding is known, so the verdict
  stays accepted; its `decision` record's reason names it (`merge accepted with evidence-missing (no evidence cited): ...`, a withheld
  reason included) under OD-114's content key, chained, the latest standing; the follow-up's envelope marks the entry `evidenceGap: "no
  evidence cited"` (every stage; the counts stage counts it) and its header gains one closed sentence; nothing invented;
  record-and-envelope only; the approval decision unchanged. Code: `merge.ts` (six lines in place, the rule appended),
  `orchestration-runtime.ts` (six lines in place, the marker, count and sentence appended); no line any page cites moved, so no citation
  was re-pinned (the D page gains rows C77-C86).
- What the human sees: the record and the marker are deterministic; whether the coordinator's answer names the gap is model judgment -
  UNPROVEN offline (the scripted follow-up's answer omits it, F3 case 8) - and a stood-down follow-up (`follow_up_paused`,
  `follow_up_failed`) shows it nowhere but the record. RECORDED residual for the lead: a deterministic human-facing line for the gap (in
  a vocabulary the E2 page allows) - not F3's, whose task allowed record-and-envelope only.
- Adoption: the first F3 implementer run was cut off when the lead's session ended (2026-09-28, about 09:06) with its work unreviewed in
  the tree and no report; the relaunched run adopted it as the sole writer, reviewed every change against HEAD (in scope, line-neutral
  above every cited line, no reserved or B11-scanned file touched) and kept it: the rule, the record, the marker and the page section as
  written; it strengthened the suite (case 3: a scheduler resume replays the result, judged the same way, the next resume still replays;
  case 9: these reserved texts) and F's case 7 (its closing check made non-vacuous: an envelope must exist); nothing dropped.
- Failing-first: with HEAD's `merge.ts` and runtime put back (`git diff` empty for both) all eleven F3 cases red and F's case 7 red on
  its moved assertion; both files restored byte for byte, verified by sha256 (`b21/f3/adopt/` for the first nine, `b21/f3/fix/` on the
  final suite). Nine mutations of the F3 code, each restored by hash, each red where section 4 says.
- The adversarial review (six findings, five distinct, all low), each answered test-first (`b21/f3/fix/`): `regressions-2` and
  `coverage-4`, D's withheld-reason fallback dropped the gap (a key-shaped reported model id makes the text rule refuse the reason):
  case 10 red, the fallback now keeps the closed clause (in place), green; `coverage-1`, the page and the D21-44 clause stated the
  answer's content as a guarantee: reworded (model judgment, UNPROVEN offline, the residual above), the page case's wording check red
  first; `coverage-3`, D21-46's digest consequence misstated: reworded after a three-pass probe, the wording check red first;
  `tests-01`, case 4 now renders the no-gap run through all five stages (a count written unconditionally is red); `tests-02`, case 11
  adds malformed, expired and contradicted evidence-free results (the guard widened, and the gap applied before the conflicts, each red).
- Pins moved (reviewed, reasons beside them): `b21-f-evaluation.test.ts` case 7 (from "accepted, no gap recorded" to "the merge records
  the gap"); the F7 row and RECORDED note on `evaluation-matrix.md` (dated); the F7 cell (`_f-cases.ts` in place, the B21 generator
  re-run: `evaluation-matrix.csv` and `.json` moved in that cell only, `replay-trace-pins-b21.json` byte-identical); the D page's own-code
  table (page case 7 reads it as `MERGE_OWN_CODES`). No other suite enumerates `MERGE_OWN_CODES`; no pinned B21-D digest moved.
- Findings: D21-46 (new, low) - after a replayed verdict is CHAINED, every later merge pass that finds the same verdict (and writes
  nothing) reports the unchained content key in its `records`, a key the store does not hold; every later pass that writes nothing
  agrees with the others, so its view digest differs from the chaining pass's (pre-existing D code; probes through the real scheduler
  and merge, not kept; not fixed in F3).
- Gates, one heavy job at a time through the lock runner, re-run in full on the final tree after the review's fixes
  (`b21/f3/fix/gates/`): every B21 suite with the eight route suites, the E4 composer suite and the CI guard (56 files, 524 of 524 -
  every A..F page suite and the F3 suite's eleven cases included); `app/api/chat`, `app/lib/llm` and `app/lib/acquisition` in full (45
  files: 384 passed, the opt-in live file's 2 skipped as before); `app/lib/agent` in full with the exposure and tier suites, the B11
  suites, the B17-A inventory and the B18-D UI gates (63 files, 646 of 646); `app/lib/project` with `app/components/chat` (40 files, 318
  of 318); the fixture agent and every B18-C/B18-E scenario suite (16 files, 108 of 108); the proposal families and approval paths (34
  files, 513 of 513); the import gates, census ratchets and route matrices (10 files, 104 of 104; census 165/162/3/0, no route added);
  `app/lib/mcp` with `app/api/mcp` (33 files, 737 of 737) and `app/lib/mcp/server` (19 files, 183 of 183); tsc 0; eslint clean on the
  five changed and new TypeScript files; the generators with zero drift beyond the F7 cell (B11 19 of 19 cases and 61 of 61 checks; the
  B09, B11 and B21 outputs, 24 files, byte-identical on the gate's re-run - against HEAD only `evaluation-matrix.csv` and `.json` moved,
  in the F7 cell; B17-A 628 controls, CSV and summary identical; the tree's status and every changed file unchanged during the gates).
  No browser run: F3 changes nothing the page renders (the marker and the sentence reach only the model-bound envelope).
- Records: `merge-and-disagreement.md` section 4 (the F3 section) and this section; D21-44 closed; D21-46 found; OD-114's addendum; the
  human-facing residual RECORDED. Live: BLOCKED-LIVE-QUALIFICATION (LB-9) - no model is called.

#### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-F3 committed on chapter/b21-specialist-orchestration: the merge records the evidence gap (D21-44, the lead's
option a) - an accepted result of the evidence-gathering role (component-sourcing-evidence) that cites no evidence gains one closed
finding, evidence-missing (the last own code, decision accepted), named in its decision record under OD-114's content-keyed, chained
records, a withheld reason included; the follow-up's envelope marks the entry no evidence cited under one closed header sentence;
nothing invented, record-and-envelope only, the approval decision unchanged; F7 through the production POST; the adversarial review's
six findings fixed test-first; D21-46 found (low); next B21-F2b (D21-45, option a), then the B21 closeout".
`nextAction`: "B21-F2b: a scripted follow-up failure keyed on F12's sentence in the fixture agent's per-role script table and a browser
test on the orchestration config that presents, stands down and resumes (already_presented, one presentation in all) - D21-45 option (a);
for the lead's decision: D21-46 (a replayed verdict's record reference) and the evidence gap's human-facing line (RECORDED residual:
only the model's answer can show it); then the B21 closeout (commit 1/2 the single-agent statements superseded, with the stale titles
`evaluation-matrix.md` section 7 lists; commit 2/2 the records and the verdict; PR #11 undrafted after green CI); the one live run under
OD-125 if credits exist; the owner questions stay with the owner".

#### The discovery closure clause (`discovery.md` §4, appended to D21-44; D21-46 is a new defect after D21-45; §10 gains a B21-F3 amendment)

- **D21-44 — The merge records no evidence gap: a specialist result that cites no evidence is accepted as its own claim.** — CLOSED by B21-F3 (the lead's option (a)): an ACCEPTED result of the evidence-gathering role (`component-sourcing-evidence`
  alone - its result IS evidence; no other role is one) whose `evidence` list is empty gains ONE closed merge finding, `evidence-missing`
  (the last row of `MERGE_OWN_CODES`, decision `accepted`, claim `evidence`, no action, no id), only once every other finding is known:
  the verdict stays accepted and its task attempt's `decision` record names the gap (`merge accepted with evidence-missing (no evidence
  cited): ...`, a withheld reason included) under OD-114's content key, chained, the latest standing; the follow-up turn's envelope marks
  that entry `evidenceGap: "no evidence cited"` in every stage (the counts stage counts it) under one closed header sentence asking the
  coordinator not to present its claims as evidenced; nothing is invented (every `evidence` list of the record and the envelope stays as
  cited); record-and-envelope only (no run-event type, no stream line); the approval decision unchanged; a sourcing specialist that is
  not run stays the scheduler's `role_has_no_tools` dissent (`merge-and-disagreement.md` section 4; `b21-f3-evidence-gap.test.ts` cases
  1 to 11; `b21-f-evaluation.test.ts` case 7, a reviewed pin move). What the coordinator's answer then says of the gap is model
  judgment - UNPROVEN offline (the scripted follow-up's answer omits it, case 8) - and a stood-down follow-up shows it nowhere but the
  record: RECORDED residual, a deterministic human-facing line is the lead's decision.
- **D21-46 — The merge's view names a record the store does not hold after a replayed verdict.** Requirement: OD-114 as applied ("the
  outcome's `records` are exactly the store's merge records", section 5; merge case 9). Finding: when a task attempt's latest verdict is a
  CHAINED record (a replayed result's provenance, an expiry, a new conflict partner), the pass that chains it reports the chained key,
  but every later pass that writes nothing (it finds the same verdict) reports, in the view's `records`, the verdict's UNCHAINED content
  key - a key the store does not hold - so `records` is not the store's records; every later pass that writes nothing agrees with the
  others, so the view's digest (carried in the envelope's head) of a resume that writes nothing differs from the chaining pass's; no
  production code reads `records` beyond that digest. Severity low. **CONFIRMED** (probes through the real scheduler and merge on a
  circuit specialist's result, independent of F3: the store held `.merge-97ec...` and the chained `.merge-8ec4...`, which the chaining
  pass reported (the store's revision 4 to 5); the two passes after it wrote nothing and each reported `.merge-6507...` under the same
  digest, which differs from the chaining pass's; `b21/f3/adopt/probe-records.log`, `b21/f3/fix/probe-d46-three-passes.log`; the probes
  not kept). Closes: a follow-up in the merge's persistence loop (a skipped verdict reports the latest record's key), with its
  digest-bearing cases moved as reviewed pins. Source: B21-F3's review.
- **§10, B21-F3 (recorded by the lead, 2026-09-28):** Section 4: D21-44 closed (the lead's option (a)); D21-46 opened (low: a replayed
  verdict's record reference). Section 6: OD-114's addendum (an accepted verdict may name one non-rejecting code, a withheld reason
  included; no shape change). Section 7, B21-F: amended - the merge records the evidence gap (B21-F3: the rule, the `decision` record,
  the envelope's marker; no run event, no approval change; the human-facing line a RECORDED residual); F7's RECORDED note superseded.
  Section 8: the first F3 implementer run was cut off with the lead's session; the relaunched run adopted its partial work, reviewed it
  against HEAD and re-established its failing-first (eleven cases red against HEAD's merge and runtime, F's case 7 red, nine mutations
  red, each restored by sha256); the adversarial review's six findings (five distinct, all low) fixed test-first - the withheld reason
  keeps the gap's clause, the page states the answer as model judgment, D21-46's digest restated, the no-gap envelope checked in every
  stage, every non-accepted branch of the guard reached.

### B21-D4 — the reserved texts, in full (the lead's to apply)

[B21 D4, 2026-09-28] B21-D4 closes D21-46 (low; found by B21-F3's review, pre-existing since B21-D) with a one-line production fix
in the merge's persistence loop and adds no owner decision. OD-114's shape does not change - no record kind, key shape, decision
value, reason or chaining rule moved, and nothing is written that was not written before - so OD-114 needs no amendment. These texts
are pinned by `b21-d-page.test.ts` cases 8 and 9.

#### The README row (`artifacts/ai-control-plane-b21/README.md`, a new row "B21-D4" after B21-F3)

| B21-D4 the merge's view names the records the store holds (D21-46) | `merge-and-disagreement.md` section 5 (the dated D4 note and subsection; citation row C87; D4's reserved texts in section 8); code `app/lib/agent/orchestration/merge.ts` (the persistence loop's skip line, in place - no line moved) | CONFIRMED (a merge pass that writes nothing because a task attempt's latest verdict is the same verdict now names that latest record's key, kind and record in the view's `records`, chained or not, exactly as a replay of an existing key does: `records` is the store's merge records for the judged attempts, and the pass that chains a verdict and every later pass that writes nothing report the same records and the same view digest - the digest the follow-up envelope's head carries; nothing is written that was not written before, OD-114 unchanged, no verdict, approval outcome, run event or route changed; four cases red first against HEAD's merge on their key assertions and, through a digest-only probe, on their digest assertions; no pin moved; the adversarial review's two findings (low, in the reserved texts) fixed test-first, D page case 9 red first; D21-46 closed) |

#### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-D4 — the merge's view names the records the store holds (2026-09-28 local; increment workflow + lead; this commit)

- D21-46 (low; found by B21-F3's review, pre-existing since B21-D): after a task attempt's verdict was CHAINED (a replayed result's
  provenance, an expiry, a verdict returning A, B, A), every later merge pass that found the same verdict wrote nothing but named, in
  the view's `records`, the verdict's UNCHAINED content key - one the store does not hold (after A, B, A the first A's, held but not
  the latest) - so `records` was not the store's records and the view digest the follow-up envelope's head carries was not the
  chaining pass's. The fix, in place on the persistence loop's skip line (`merge.ts`, C87): such a pass puts the latest record's key,
  kind and record in its planned entry before it moves on, as a replay of an existing key already did. Nothing written changes;
  OD-114's shape, `mergeVerdictTaskId`, `sameVerdict` and `latestVerdictOf` untouched; no verdict, approval outcome, run event, stream
  line or route changed; no line any page cites moved.
- Test-first: `b21-d4-merge-records.test.ts` (4 cases: an expiry chained, then two passes that write nothing; the unchained case
  unchanged beside a chained sibling; A, B, A; a scheduler resume through the real scheduler and merge, with the follow-up envelope's
  head) ran red against HEAD's merge - all four on their key assertions (`b21/d4/d4-failing-first.log`), and all four on their digest
  assertions through a digest-only copy of the suite, not kept (`b21/d4/d4-failing-first-digests-probe.log`); green after the fix.
- Pins: none moved - no suite pins a merge view digest across a chained verdict and a later pass that writes nothing (merge case 10,
  verification case 4 and F3 case 3 compare unchained passes; F3 case 3's pass after its chaining resume reads the reason and the
  revision only); the B21 replay pins and the evaluation matrix unmoved. The D page gains cases 8 and 9, section 5's dated note and
  subsection, citation row C87 and these texts; its own suite row moved 7 -> 9 (case 9 is the review's).
- Review: the adversarial review's two confirmed findings (both low, both in these reserved texts; no code, record, digest or pin
  affected) fixed test-first through D page case 9, red first on both (`b21/d4/fix/d4fix-failing-first.log`): `coverage-1` - the
  PROGRAM_STATE `nextAction` below was built from F3's reserved draft, not from the nextAction the lead applied; it is now the applied
  one with only its leading B21-D4 clause removed, word for word (the D21-36 retirement, the tripwire, the four validation artifacts, a
  normal merge and each owner question by number kept; the evidence gap's "lead's decision" clause not brought back); `coverage-2` - the
  section-10 line had no Section 7 clause; it now records `Section 7, B21-D: amended`.
- Gates, one heavy job at a time through the lock runner, re-run in full on the final tree after the review's fixes
  (`b21/d4/fix/gates/`): every B21 suite with the eight route suites, the E4 composer suite and the CI guard (57 files, 530 of 530 -
  the D4 suite's four cases and the D page's nine included); `app/api/chat`, `app/lib/llm` and `app/lib/acquisition` in full (45 files: 384 passed, the opt-in live file's 2 skipped as
  before); `app/lib/agent` in full with the exposure and tier suites, the B11 suites, the B17-A inventory and the B18-D UI gates (63
  files, 646 of 646); `app/lib/project` with `app/components/chat` (40 files, 318 of 318); the fixture agent and every B18-C/B18-E
  scenario suite (16 files, 108 of 108); the proposal families and approval paths (34 files, 513 of 513); the import gates, census
  ratchets and route matrices (10 files, 104 of 104; census 165/162/3/0, no route added); `app/lib/mcp` with `app/api/mcp` (33 files,
  737 of 737) and `app/lib/mcp/server` (19 files, 183 of 183); tsc 0; eslint clean on the three changed and new TypeScript files; the
  generators with zero drift (B11 19 of 19 cases and 61 of 61 checks; the B09, B11 and B21 outputs, 24 files, byte-identical - the B21
  replay pins and the evaluation matrix included; B17-A 628 controls, CSV and summary identical; the tree's status and every changed
  file unchanged during the gates). No browser run: D4 changes nothing the page renders.
- Records: `merge-and-disagreement.md` section 5 (the D4 subsection) and these texts; D21-46 closed. Live: BLOCKED-LIVE-QUALIFICATION
  (LB-9) - no model is called.

#### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-D4 committed on chapter/b21-specialist-orchestration: the merge's view names the records the store holds
(D21-46 closed) - a merge pass that writes nothing because a task attempt's latest verdict is the same verdict names that latest
record's key (chained or not), so the outcome's records are the store's merge records and the pass that chains a verdict and every later
pass that writes nothing carry the same view digest; one line in place in merge.ts, nothing written changed, OD-114 unchanged; the
adversarial review's two findings (the reserved texts) fixed test-first; next B21-F2b (D21-45, option a), then the B21 closeout".
`nextAction`: "B21-F2b: the browser half of human rejection and resume (D21-45, option a); then the B21 closeout (commit 1/2: the
single-agent statements superseded, the stale titles retitled, B's specialistResultsEnvelope retired (D21-36), a tripwire; commit 2/2:
the four validation artifacts, the verdict, README, ledger and state; PR #11 undrafted, green CI, a normal merge); the one live run
under OD-125 if credits exist; OD-126's older-page question, OD-112's option A, OD-122's across-runs, at-least-once and stale-artifact
options, OD-111's retention question and OD-115's first-turn options stay with the owner".

#### The discovery closure clause (`discovery.md` §4, appended to D21-46; §10 gains a B21-D4 amendment)

- **D21-46 — The merge's view names a record the store does not hold after a replayed verdict.** — CLOSED by B21-D4: a merge pass that
  writes nothing because a task attempt's LATEST verdict is the same verdict now names THAT latest record's key (and its record) in the
  view's `records`, chained or not, exactly as a replay of an existing key does (`merge.ts`, the persistence loop's skip line, in place;
  `merge-and-disagreement.md` section 5, C87) - so `records` is always the store's merge records for the judged attempts, and the pass
  that chains a verdict and every later pass that writes nothing report the same records and the same view digest (the one the
  follow-up envelope's head carries). Nothing written changed: no key shape, record kind, decision, reason or chaining rule (OD-114
  unchanged), no verdict, approval outcome, run event or route (`b21-d4-merge-records.test.ts` cases 1 to 4, red first against HEAD's
  merge; no pin moved).
- **§10, B21-D4 (recorded by the lead, 2026-09-28):** Section 4: D21-46 closed (a merge pass that writes nothing names the latest
  record's key; one line in place in `merge.ts`). Section 6: no owner decision; OD-114 unchanged (no shape change, nothing written
  changed). Section 7, B21-D: amended - a merge pass that writes nothing because the attempt's latest verdict is the same verdict names
  that latest record's key, kind and record in the view's `records`, chained or not (B21-D4, `merge.ts` C87; nothing written changed,
  OD-114 unchanged). Section 8: failing-first - the D4 suite's four cases red against HEAD's merge on their key assertions and, through
  a digest-only probe, on their digest assertions; no pin moved; the D page gains cases 8 and 9, a dated section-5 note and subsection
  and citation row C87; the adversarial review's two findings (both low, the reserved texts) fixed test-first - the reserved nextAction
  rebuilt from the applied state, this line's Section 7 clause added (page case 9 red first).

## 9. Citations, as of base 5f1b498

The anchor is what is checked (it occurs exactly once in its file). For `merge.ts` (new), `orchestration-runtime.ts` and `scheduler.ts`
(changed in D) the line is the CURRENT line and page case 5 checks it; for every other file the line is as of the base, for the reader.

| # | file | line | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/lib/agent/orchestration/merge.ts` | 72 | — | `export const MERGE_DECISION_PRECEDENCE = Object.freeze([` | the decisions, most severe first |
| C2 | `app/lib/agent/orchestration/merge.ts` | 75 | — | `export const MERGE_CLAIM_KINDS = Object.freeze([` | the claim taxonomy |
| C3 | `app/lib/agent/orchestration/merge.ts` | 78 | — | `export const MERGE_IDENTITY_KINDS = Object.freeze([` | the identity keys |
| C4 | `app/lib/agent/orchestration/merge.ts` | 86 | — | `export const ALLOWED_RESOLUTIONS = Object.freeze([` | conflictForTransaction's resolutions |
| C5 | `app/lib/agent/orchestration/merge.ts` | 99 | — | `export const MERGE_FAMILY_CODES = Object.freeze({` | the families' codes by decision |
| C6 | `app/lib/agent/orchestration/merge.ts` | 141 | — | `export const MERGE_VERIFIERS = Object.freeze([` | the five verifiers as data |
| C7 | `app/lib/agent/orchestration/merge.ts` | 151 | — | `export const MERGE_RULES = Object.freeze([` | the rule table as data |
| C8 | `app/lib/agent/orchestration/merge.ts` | 297 | — | `export function readinessReference(report: ReadinessReport): EvidenceReference {` | the canonical readiness reference (OD-129) |
| C9 | `app/lib/agent/orchestration/merge.ts` | 444 | — | `function classify(left: Identities, right: Identities, shared: readonly string[]): ConflictClass {` | the ConflictClass of an overlap |
| C10 | `app/lib/agent/orchestration/merge.ts` | 660 | — | `const verdict = family === "tier1" ? verifySealedTier1Proposal(payload as SealedTier1Proposal, input) : verifySealedReplacementProposal(` | the schematic families' own verifiers |
| C11 | `app/lib/agent/orchestration/merge.ts` | 678 | — | `const integrity = verifySealedPcbEditProposalIntegrity(payload);` | the PCB family's integrity verifier |
| C12 | `app/lib/agent/orchestration/merge.ts` | 694 | — | `const recompiled = compileBoundedPcbEdit({ board: board!, rules: policy.rules,` | the geometry claim recompiled against the verified board |
| C13 | `app/lib/agent/orchestration/merge.ts` | 707 | — | `const verdict = pinned.verifyLayout(candidate, board,` | the layout family's injected verifier |
| C14 | `app/lib/agent/orchestration/merge.ts` | 811 | — | `if (requestScopeDigest !== scopeDigest) {` | every action bound to its request's scope (OD-133) |
| C15 | `app/lib/agent/orchestration/merge.ts` | 823 | — | `else if (!isExactTarget(action.replacement, exact)) findings.push(` | the exact-authority rule (OD-130) |
| C16 | `app/lib/agent/orchestration/merge.ts` | 833 | — | `if (result.validationRequests.some((request) => request.baseRevision !== scope.canonicalRevisionDigest)) findings.push(` | a verification on another revision is stale |
| C17 | `app/lib/agent/orchestration/merge.ts` | 829 | — | `for (const bindingToolId of [...new Set(result.validationRequests.filter(` | a verification is evidence about the verified state, one entry per binding, contradicting nobody |
| C18 | `app/lib/agent/orchestration/merge.ts` | 841 | — | `if (task.role === "manufacturing-readiness-reviewer" && readinessRefs.length === 0 && qualification.length === 0)` | the reviewer's free-text claim refused |
| C19 | `app/lib/agent/orchestration/merge.ts` | 852 | — | `if (reference.id !== current.report.reportId` | a reference to another report is stale |
| C20 | `app/lib/agent/orchestration/merge.ts` | 861 | — | `const survivors = judged.flatMap(` | only surviving actions are intersected |
| C21 | `app/lib/agent/orchestration/merge.ts` | 875 | — | `for (const edge of edges) group[find(edge.right)] = find(edge.left);` | one escalation per conflict group |
| C22 | `app/lib/agent/orchestration/merge.ts` | 891 | — | `const sources = Math.max(1, new Set(parties.map((party) => party.source).filter((source) => source !== UNRECORDED_SOURCE)).size);` | one provider = one source; a replay counts with every source |
| C23 | `app/lib/agent/orchestration/merge.ts` | 1001 | — | `return refused("store_conflict",` | a taken key is never written over |
| C24 | `app/lib/agent/orchestration/merge.ts` | 1005 | — | `const written = await deps.store.append({ scope: runScope, taskId: entry.taskId, attempt: entry.attempt,` | every verdict persisted before hand-on |
| C25 | `app/lib/agent/orchestration/merge.ts` | 755 | — | `function standingOf(reference: ValidatedSpecialistResult["evidence"][number]): MergeEvidenceStanding {` | B19's evidence classes as standings (labels) |
| C26 | `app/lib/agent/orchestration/merge.ts` | 541 | — | `digest: engineeringDigest({ schema: "sirkit.orchestration-merge-verification.v1"` | a verification's result digest as deterministic_verifier evidence |
| C27 | `app/api/chat/orchestration-runtime.ts` | 260 | — | `const merged = await mergeSpecialistOutcome({ runId: request.runId, context: deps.context, outcome }, specialistMergeDeps(deps.context, deps.now));` | the merge between the scheduler and the envelope |
| C28 | `app/api/chat/orchestration-runtime.ts` | 261 | — | `if (merged.kind === "refused") return standDown(` | a merge that cannot record stands down |
| C29 | `app/api/chat/orchestration-runtime.ts` | 262 | — | `for (const line of merged.lines) warn(line);` | one warning line per dissent, escalation and review request |
| C30 | `app/api/chat/orchestration-runtime.ts` | 310 | — | `export function specialistMergeDeps(context: AgentRunContext, now: () => number = Date.now): MergeDeps {` | the injected verifier and preset, bound outside the prefix |
| C31 | `app/api/chat/orchestration-runtime.ts` | 335 | — | `export function mergedResultsEnvelope(` | the merge's view for the follow-up turn |
| C32 | `app/lib/agent/orchestration/scheduler.ts` | 488 | — | `const attempt = baseAttempt + (staleWritten ? 1 : 0) + offset;` | the re-run after a stale dissent at the next attempt |
| C33 | `app/lib/engineering/schematic-proposals.ts` | 237 | — | `export function verifySealedTier1Proposal(proposal: SealedTier1Proposal, input: {` | the Tier 1 family's verifier |
| C34 | `app/lib/engineering/replacement-proposals.ts` | 263 | — | `export function verifySealedReplacementProposal(proposal: SealedReplacementProposal, input: {` | the replacement family's verifier |
| C35 | `app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts` | 238 | — | `export function verifySealedPcbEditProposalIntegrity(candidate: unknown): PcbProposalVerification {` | the PCB family's integrity verifier |
| C36 | `app/lib/pcb/proposal/sealed-pcb-edit-proposal.ts` | 817 | — | `export function isPcbEditProposalExpired(proposal: SealedPcbEditProposal, now: number): boolean {` | the PCB family's expiry |
| C37 | `app/lib/pcb/candidates/layout-candidate.ts` | 316 | — | `export function verifyLayoutCandidate(candidate: LayoutCandidate, board: PcbBoard,` | the layout family's verifier |
| C38 | `app/lib/pcb/candidates/layout-candidate.ts` | 19 | — | `import { commitPcbCandidate } from "../../engineering/pcb-commit-gateway";` | D21-35: the first hop to the executor |
| C39 | `app/lib/engineering/editor-adapter.ts` | 52 | — | `import { CanonicalExecutor, deriveExecutorLineageId, type ExecutionRejectionCode, type ExecutionResult, REPLAY_COMMAND_ID } from "./executor";` | D21-35: the last hop |
| C40 | `app/lib/pcb/candidates/layout-candidate.ts` | 41 | — | `export interface LayoutCandidateBase {` | D21-34: the candidate's own base carries no scope |
| C41 | `app/lib/engineering/collaboration.ts` | 8 | — | `export function conflictForTransaction(` | the transaction-vs-history comparator whose vocabulary D reuses |
| C42 | `app/lib/engineering/collaboration.ts` | 20 | — | `...(conflictClass === "unknown_interaction" ? ["rerun_candidate" as const] : [])` | its resolutions |
| C43 | `app/lib/engineering/types.ts` | 64 | — | `export type ConflictClass =` | the sixteen conflict classes |
| C44 | `app/lib/pcb/readiness/types.ts` | 115 | — | `export interface ReadinessReport {` | the report's identity (reportId, designRevision, manufacturingProfileId, freshness) |
| C45 | `app/lib/engineering/replacement-proposal-assembler.ts` | 235 | — | `if (summary.state !== "verified-exact") {` | verified-exact only |
| C46 | `app/lib/engineering/replacement-proposal-assembler.ts` | 244 | — | `The caller may assert an expectation, never choose the target.` | the caller asserts, never chooses |
| C47 | `app/lib/engineering/approved-pcb-mutations.ts` | 421 | — | `return refuse("stale-lineage",` | the apply's own PCB currency codes the merge mirrors |
| C48 | `app/api/physical-bindings/route.ts` | 37 | — | `handoff: "request_atomic_review"` | the human physical-binding review path |
| C49 | `app/lib/view-session/schematic.ts` | 13 | — | `ERC findings: this editor produces none today` | D21-14: no ERC exists |
| C50 | `app/lib/agent/orchestration/contracts.ts` | 68 | — | `export const VALIDATION_BINDING_TOOL_IDS = Object.freeze([` | A's five verifier bindings |
| C51 | `app/lib/agent/orchestration/store.ts` | 43 | — | `export const ORCHESTRATION_DECISIONS = Object.freeze([` | OD-114's closed decision vocabulary |
| C52 | `app/lib/agent/orchestration/store.ts` | 93 | — | `export function orchestrationIdempotencyKey(` | the attempt key with its record-kind segment |
| C53 | `app/lib/pcb/proposal/pcb-propose-tool-handler.ts` | 123 | — | `model: "agent-tool-loop"` | OD-132: the sealed provenance unchanged |
| C54 | `app/lib/agent/orchestration/role-tools.ts` | 23 | — | `export const PROPOSING_ROLES: readonly SpecialistRole[] = Object.freeze([` | the proposing roles; their proposal tools stay dormant |
| C55 | `app/lib/atomic/types.ts` | 33 | — | `export type SourceClass =` | the source classes the standings read |
| C56 | `app/lib/agent/orchestration/merge.ts` | 118 | — | `export const MERGE_OWN_CODES = Object.freeze([` | the merge's own codes (the page's table) |
| C57 | `app/lib/agent/orchestration/merge.ts` | 107 | — | `export const MERGE_FAMILY_TTL_MS = Object.freeze({` | the families' lifetimes |
| C58 | `app/lib/agent/orchestration/merge.ts` | 624 | — | `function provenanceCode(family: MergeFamily, payload: Plain, pinned: Pinned)` | what the checksums cannot establish: key set, lifetime, this run's principal |
| C59 | `app/lib/agent/orchestration/merge.ts` | 587 | — | `function layoutCandidateBoard(candidate: LayoutCandidate, board: PcbBoard)` | a layout candidate's board, built as its family's apply builds it |
| C60 | `app/lib/agent/orchestration/merge.ts` | 561 | — | `function regressionsOf(base: PcbBoard, candidate: PcbBoard, rules:` | the compiler's regression rules on a candidate's board |
| C61 | `app/lib/agent/orchestration/merge.ts` | 343 | — | `function syncedEndpoints(board: PcbBoard` | the schematic-PCB join through a sync identity |
| C62 | `app/lib/agent/orchestration/merge.ts` | 867 | — | `if (a.change !== null && a.change === b.change) continue;` | one change carried twice is no conflict |
| C63 | `app/lib/agent/orchestration/merge.ts` | 911 | — | `const reviewRequests: MergeReviewRequest[] = judged.flatMap(` | OD-130: a part review request per non-exact target |
| C64 | `app/lib/agent/orchestration/merge.ts` | 770 | — | `export function mergeVerdictTaskId(` | a verdict's content key |
| C65 | `app/lib/agent/orchestration/merge.ts` | 310 | — | `const sourceOf = (task: SpecialistTaskOutcome): string =>` | one provider = one source; a replay's provenance unrecorded |
| C66 | `app/lib/agent/orchestration/merge.ts` | 510 | — | `const missing = [...(context.schematic ? [] : ["schematic-unavailable"])` | the canonical verifier never invents a pass |
| C67 | `app/lib/agent/orchestration/merge.ts` | 493 | — | `const open = [...nets.filter((net) => !net.complete)` | connectivity inconclusive on an open net |
| C68 | `app/lib/agent/orchestration/scheduler.ts` | 664 | — | `export function mergeJudgedStale(` | D21-17's regenerate signal |
| C69 | `app/lib/agent/orchestration/scheduler.ts` | 462 | — | `&& !mergeJudgedStale(history, task.taskId, committed.attempt) ? engineeringDigest(answered.record.document.scope) : null;` | a result judged stale or expired is never replayed |
| C70 | `app/lib/agent/orchestration/scheduler.ts` | 669 | — | `export const READINESS_CITATION_RULE =` | the reviewer's citation form |
| C71 | `app/lib/agent/orchestration/scheduler.ts` | 344 | — | `...specialistResultRules(task.role),` | a role's output rules in its frame |
| C72 | `app/api/chat/orchestration-runtime.ts` | 325 | — | `export const MERGED_ENVELOPE_STAGES = Object.freeze([` | the envelope's stages |
| C73 | `app/api/chat/orchestration-runtime.ts` | 394 | — | `for (const stage of MERGED_ENVELOPE_STAGES) {` | the first stage that fits |
| C74 | `app/api/chat/orchestration-runtime.ts` | 189 | — | `specialistResultsEnvelope RETIRED (D21-36)` | B's envelope superseded (D21-36); [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): retired - this row cites its one-line tombstone] |
| C75 | `app/lib/pcb/proposal/bounded-edit-compiler.ts` | 419 | — | `return refuse("drc-regression",` | the compiler's regression rules the candidate check mirrors |
| C76 | `app/lib/pcb/candidates/layout-candidate.ts` | 372 | — | `const command = buildAutorouteImportCommand(board, candidate.routes);` | the apply's routing build the candidate check mirrors |
| C77 | `app/lib/agent/orchestration/merge.ts` | 137 | — | `{ code: "evidence-missing", decision: "accepted"` | [B21 F3] the gap's own code, the LAST row of MERGE_OWN_CODES |
| C78 | `app/lib/agent/orchestration/merge.ts` | 922 | — | `decisionOf(withEvidenceGap(entry).findings)` | [B21 F3] the gap joins a verdict once every other finding is known, never changing it |
| C79 | `app/lib/agent/orchestration/merge.ts` | 929 | — | `merge accepted${evidenceGapReason(entry.findings)}` | [B21 F3] the accepted decision record's reason names the gap |
| C80 | `app/lib/agent/orchestration/merge.ts` | 1094 | — | `export const EVIDENCE_GATHERING_ROLES` | [B21 F3] the evidence-gathering roles: the sourcing specialist alone |
| C81 | `app/lib/agent/orchestration/merge.ts` | 1107 | — | `function withEvidenceGap(` | [B21 F3] the rule: an accepted, evidence-free result of such a role gains ONE finding |
| C82 | `app/api/chat/orchestration-runtime.ts` | 860 | — | `function evidenceGapMark(` | [B21 F3] the envelope's closed marker on that entry |
| C83 | `app/api/chat/orchestration-runtime.ts` | 870 | — | `export const EVIDENCE_GAP_HEADER_NOTE` | [B21 F3] the header's one closed sentence |
| C84 | `app/api/chat/orchestration-runtime.ts` | 395 | — | `${MERGED_ENVELOPE_HEADER}${evidenceGapHeader(merged)}` | [B21 F3] the sentence only when an entry carries the marker |
| C85 | `app/lib/agent/orchestration/scheduler.ts` | 480 | — | `its evidence stays missing` | the tool-less task: the scheduler's dissent, never the merge's gap |
| C86 | `app/lib/agent/orchestration/merge.ts` | 931 | — | `${evidenceGapReason(entry.findings)}: findings withheld from the record` | [B21 F3 review: regressions-2] a withheld reason keeps the gap's closed clause |
| C87 | `app/lib/agent/orchestration/merge.ts` | 992 | — | `records[records.indexOf(planned)] = { ...entry, taskId: latest.taskId,` | [B21 D4] D21-46: a pass that writes nothing names the attempt's LATEST verdict record (chained or not) in `records` |
