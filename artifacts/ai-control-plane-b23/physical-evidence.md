# B23-D - physical-hardware evidence, defined and never fabricated

Labels: **CONFIRMED** (executed and measured here, or read at the cited file:line), **INFERRED** (a conclusion from reading code; nothing
executed it), **PROPOSED**, **RECORDED** (written down without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Tree: `chapter/b23-external-manufacturing`, base `4e71563` (B23-C), working tree of 2026-10-05. Runbook B23-D (`:1000-1013`): "Define
but do not fabricate evidence for:" manufacturer acceptance; produced board lot/serial identity; incoming inspection; continuity/power-on
tests; functional test; assembly results; deviations/rework; final physical qualification (`:1002-1011`). "Only physical evidence may
advance an assembled-product claim. Keep `manufacturing.assembled-release` blocked until the required evidence and qualified human review
exist." (`:1013`). Closes D23-13, D23-14 and D23-15. Owner decisions applied: OD-175, OD-176 and OD-177; D's own choices beyond its task
text are OD-187 (section 12). An adversarial review round (2026-10-05) is recorded in section 9, and the low round that closed the
independent check's three low issues (2026-10-05) after it. [B23-D low round 2, 2026-10-05] A second low round, closing a second
independent check's two low issues, follows that. [B23-D lead, 2026-10-05] A lead round closed the low issue that round's re-check raised (section 9).

**Verdict: physical evidence is defined and none exists; `manufacturing.assembled-release` stays blocked.** Eight closed record kinds bind
a release, a unit or lot, a procedure, equipment, operators, raw artifacts and a result; review is a qualified human's, asked of a server
port that nothing wires; the eligibility evaluator answers blocked for every input. Nothing records, accepts or stores evidence: no route,
store, tool or form. Physical work is LB-5 (B24-E), BLOCKED-LIVE-QUALIFICATION here.

## 0. What B23-D is

- **The contract (D23-13; OD-175).** `app/lib/manufacturing-providers/physical-evidence.ts`: the eight kinds as closed record types with
  validators, a record digest, a per-record judge and `assembledProductEligibility()`, which answers blocked with the missing kinds for
  every input. Pure: no persistence, no module state, no environment, browser or network global (C1). CONFIRMED
  (`b23-d-physical-evidence-contract`, 16 cases; [B23-D low round, 2026-10-05] 10 before cases 11-13; [B23-D low round 2, 2026-10-05]
  13 before cases 14 and 15; [B23-D lead, 2026-10-05] 15 before case 16)
- **The latent claim paths (D23-14; OD-176).** Not rewired. A tripwire pins that `evaluateReleaseLevels`, `materializeRelease`,
  `evaluateFactoryMeasurement`, `fitCalibration` and `computeRuntimeVerdict` have no production caller, executes the counterexamples
  D23-14 records, and section 6 records the hardening each needs before any caller is added. CONFIRMED (`b23-d-latent-claim-paths`, 6
  cases)
- **The assembled-release block (D23-15; OD-177).** One record, `missing`, Tier 3, reached by nothing. Its registry note, the release
  gate's refusal and the message a person sees name both unblock conditions. The gate refuses `assembled_pcb`, shown at runtime without a
  router; the pinned 555 release identity does not move. CONFIRMED (`b23-d-assembled-release-blocked`, 6 cases)
- **Unchanged.** No route (census 166 / 163 / 3 / 0), no agent tool (47 / 36 / 9 / 27), no UI control or component, no new dependency
  (OD-42), no persistence, the B19-E tripwire unchanged, the pinned release identity unchanged. One person-facing string changed: the
  error table's message for `MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE` (C23). CONFIRMED (section 11)

## 1. The eight kinds (D23-13, OD-175)

Every record carries the common binding of section 2; each kind adds its own closed details. Review is the same for every kind: a human
project administrator with a recorded qualification, never one of the record's operators as the server resolves them
(`operatorActorIds`), derived by the server from its authenticated session and bound to the record's exact digest (section 3). No record
of any kind exists anywhere.

| kind | the runbook's words (`:1002-1011`) | what it binds beyond the common binding (its closed details) | who reviews it | exists |
|---|---|---|---|---|
| `manufacturer_acceptance` | manufacturer acceptance | `manufacturerRef`, `acceptanceRef` and `acceptedFilesDigest`, which is the release's own `archiveSha256` and nothing else (nothing here can tie an outbound package digest to its release); both refs are the manufacturer's own, never one of Sirkit's minted ids (`mfg-...`: a release, an outbound package, a provider observation or exchange), so a provider's DFM or quote answer (B23-B3's external observation) is never this record and cannot be cited as one | a human project administrator, qualified, server-derived | none (LB-5) |
| `unit_lot_identity` | produced board lot/serial identity | `lotQuantity` (1 to 1,000,000) and `unitSerials` (distinct, never more than the lot holds; a unit record lists its own serial). A lot-scope record is the claim's identity: every unit record names a serial it lists, and no inspection inspects more than its `lotQuantity` (section 4) | a human project administrator, qualified, server-derived | none (LB-5) |
| `incoming_inspection` | incoming inspection | `inspectedQuantity` (never more than the lot's identity holds), `nonconformingQuantity` (0 to the inspected quantity) and `acceptanceCriteriaRef`; a nonconforming quantity names its nonconformances | a human project administrator, qualified, server-derived | none (LB-5) |
| `continuity_power_on` | continuity/power-on tests | `checks`, distinct, from continuity, isolation, power_on, rail_voltage and current_draw, with continuity and power_on both required | a human project administrator, qualified, server-derived | none (LB-5) |
| `functional_test` | functional test | `testDefinitionRef` and `testDefinitionDigest` (`sha256:<64 hex>`, the test definition it ran) | a human project administrator, qualified, server-derived | none (LB-5) |
| `assembly_result` | assembly results | `assemblyDataDigest` (`sha256:<64 hex>`) and `populationVariantRef` (the assembly data and variant it built) | a human project administrator, qualified, server-derived | none (LB-5) |
| `deviation_rework` | deviations/rework | `nonconformanceRef`, `disposition` (rework, repair, scrap or use_as_is), `instructionRef` and `retestRecordIds`; it acts on the subject that raised its nonconformance, and each retest is a later incoming inspection, continuity/power-on or functional test of that subject (section 4); [B23-D low round, 2026-10-05] it comes no earlier than every record that raised that nonconformance, and a hardware scrap removes its unit or lot (section 4); [B23-D low round 2, 2026-10-05] only a scrap that satisfies on its own removes, and a lot with no unit left is removed (section 4) | a human project administrator, qualified, server-derived | none (LB-5) |
| `final_physical_qualification` | final physical qualification | `qualificationPlanRef` and `reliesOnRecordIds` (1 to 64, never itself); it comes after every failure and rework of the claim (section 4); [B23-D low round 2, 2026-10-05] every hardware rework, satisfying or not and removed or not | a human project administrator, qualified, server-derived | none (LB-5) |

**What is not reused.** CD-12's `BuildLotRecord` and `PhysicalValidationEvidence` (C37, C38), `ScopedException` (`deviation | waiver`,
C39) and CD-11's seed `FactoryTestResult` and `CalibrationResult` (C35, C36) stay library vocabulary: they hold caller-supplied refs,
carry no release binding or server-derived review, and live, when saved at all, in browser `localStorage` (C48, C49). The new kinds take their
lessons (raw artifact refs, operator and equipment provenance, a result vocabulary, a deviation's disposition) without their trust in the
caller. CONFIRMED (read)

**Required for an assembled-product claim** (`ASSEMBLED_CLAIM_REQUIRED_KINDS`, C3): every kind but `deviation_rework`, which is required
for each nonconformance a record of the claim raises until a satisfying rework, repair or scrap closes it. CONFIRMED (case 1, case 6)

## 2. What every record binds, and what never satisfies

**The common binding** (`PHYSICAL_EVIDENCE_RECORD_KEYS`; every key required, every level closed; case 2):

- the release: `releaseId` (`mfg-release-<32 hex>`), `archiveSha256` (lowercase SHA-256), `boardRevision` (`pcb2-<16 hex>`) and
  `boardDigest` (`pcb-authority-<sha256>`);
- `subject`: the unit or lot (`scope`, `lotId`, and `unitSerial` for a unit, null for a lot);
- `procedure`: `procedureRef`, `procedureRevision` and `procedureDigest` (`sha256:<64 hex>`, C50);
- `equipmentRefs` (1 to 64, each `equipment:<id>`) and `operatorRefs` (1 to 16, each `operator:<id>`), never empty - the hardening D23-14
  asks of `factory.ts:5`, which takes an empty station list and has no operator field (C7, C32, C51, C52);
- `rawArtifacts`: each `artifactRef`, `sha256` and `bytes`;
- `executionClass` (`hardware` or `dry_run`), `result` (`pass`, `fail`, `indeterminate` or `invalid`), `performedAt` (a canonical
  instant), `nonconformanceRefs` and the kind's `details`.

References are identifiers: they refuse a space and "@", so no prose and no address passes (C4); operators and equipment are typed ids, so
bare words are refused, dotted or underscored ones too (C51, C52); a digest-named field is a content digest, never a free reference such as
"TBD" (C50). As a regex cannot tell an id from a name, that an operator id spells no person's name is the recording route's to ensure (B24-E).
A record is read once, as data: the validator copies it before any read, so a getter or a proxy cannot show one value to the check and
another to the digest; a proxy or a function is refused as no data (C6). The evaluator copies each record once too, and a refused record's
id and kind come from that copy or are null (C57). A valid record comes back deep-frozen with its digest, `physical-evidence-<sha256>` over
the canonical record. CONFIRMED (cases 2, 7)

**Never satisfies** (case 4, for every kind, each named while the otherwise identical record satisfies):

| a record | rejection | where |
|---|---|---|
| without raw artifacts | `raw_artifacts_absent` | C11 |
| with a dry-run class | `dry_run_class` | C12 |
| with any result but pass | `result_not_pass` | C13 |
| without a server-derived human review | `review_absent`, `review_not_server_derived_human`, `review_not_bound`, `review_by_operator` | C15-C17, C56 |
| disposed "use as is" (a waiver) | `waiver_disposition` | C14 |
| bound to another release or lot | `release_mismatch`, `subject_mismatch` | (case 4) |
| a unit the lot's identity does not list, or an inspection of more than the lot holds | `subject_mismatch` | C59, C60 (case 10) |
| [B23-D low round, 2026-10-05] of a unit or lot that a hardware scrap of the claim removed (the scrap itself excepted); [B23-D low round 2, 2026-10-05] only a scrap that satisfies on its own removes, and a lot with no unit left is removed; [B23-D lead, 2026-10-05] by its own rules, whatever record shares its id | `subject_scrapped` | C77, C79, C80 (cases 13, 15, 16) |
| relying on a record that does not satisfy, or out of order | `relies_on_unsatisfied` | (case 6) |
| sharing its id with another record | `duplicate_record_id` | (case 6) |

[B23-D low round, 2026-10-05] A record that never satisfies may still count against the claim: a failure raises its nonconformance, and a
hardware scrap removes its subject, whatever its serial listing or a duplicate id (section 4). [B23-D low round 2, 2026-10-05] Corrected: a
failure still raises whatever its serial listing or a duplicate id, and every hardware deviation/rework of the claim, satisfying or not,
must come before a final qualification that counts; but a scrap removes its subject only when it satisfies on its own (section 4).
[B23-D lead, 2026-10-05] Corrected: a scrap's own rules do not include the duplicate check, so a scrap sharing its id still removes its subject, and a lot
identity sharing its id still binds units and counts them (section 4, case 16).

CONFIRMED

## 3. Review: a qualified human, derived from the server

- **Never from the record.** A record that carries any review, approval, signature, attestation or verification key, at the top or in its
  details, is invalid with a problem that says so (C5). The evaluator never reads a review from a record or hands a record to anyone: it asks
  the review port by the record's id, kind and digest only, in a frozen request (C9, C15). CONFIRMED (case 3)
- **Derived from the trusted server context.** The port is a server composition root's port to stored, reviewed evidence; its answer is
  copied as data and checked, never trusted as given: `derivation` `server_session`, `actorKind` `human`, role `project_admin` (C8; no new
  role until the owner names one, OD-187), a `qualificationRef`, the exact `reviewedRecordDigest`, `reviewedAt` no earlier than the work
  (C16). The model, automation, the migration actor, an editor, a viewer, a body claim, browser state, a missing or extra key and a changed
  record each fail, named. CONFIRMED (case 5)
- **Never one of the record's operators, as the server resolves them.** A record's `operatorRefs` are references (`operator:<id>`); the
  reviewer is a session actor id, another namespace, so comparing the two proves nothing. The answer therefore carries `operatorActorIds`
  (C55): the actor ids the server resolves the stored record's operators to, one per `operatorRefs` entry, in order. An answer that omits
  them, or resolves too few or too many, is `review_not_server_derived_human` (C56); a reviewer who is one of them, or who is spelled as one
  of the operator references, is `review_by_operator` (C17). The same person as `operator:bench-7` and session `user-2b1c` is refused when
  the server says so, and an answer that does not say is refused. CONFIRMED (case 5). Whether a future server resolves operators correctly is
  the port's (B24-E): this contract can only require the answer and apply it. UNKNOWN
- **No port is wired.** `PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING` is `"none"` (C10), and the production default is no port: every record
  answers `review_absent` today. The tests hand in a fake port to show each rule bites. CONFIRMED (cases 4, 7)

## 4. The eligibility evaluator: blocked for every input

`assembledProductEligibility({ release, lotId, records, reviewPort })` (C20) reads the caller's input once, inside one guard: a claim or a
records list whose reads throw is a malformed claim, never an exception (C58). It judges each record by its own rules, then applies the
cross-record rules (a record judged alone by `judgePhysicalEvidenceRecord` cannot know them):

- **The lot's identity binds every unit** (C59, C60). The claim's identity is its satisfying lot-scope `unit_lot_identity` records; a
  unit-scope record (a unit's own identity record included) names a serial every one of them lists, and an inspection inspects no more than
  the smallest `lotQuantity`. Otherwise `subject_mismatch`; with no lot identity, no unit record counts. [B23-D low round, 2026-10-05] Such
  a record never satisfies, yet it still counts against the claim: its failure raises (next rule).
- **A failure is never outvoted by a pass** (C61). Every valid record of this release and lot raises the nonconformances it names; a
  `hardware` record whose result is not pass raises itself (its record id) when it names none. A dry run is no physical event and raises
  nothing of its own. So a unit tested until it passed, a unit that fails after its pass, another unit that fails, or an indeterminate or
  invalid result each keep `deviation_rework` missing until closed. [B23-D low round, 2026-10-05] Whatever its serial listing and whatever
  other record shares its id: only another release or another lot puts a record outside the claim (C74, case 11). The review round's rule
  also excluded a record void by a duplicate id and, through `subject_mismatch`, a unit the lot's identity does not list - and an identity
  may list fewer serials than the lot holds, or none - so such a failure raised nothing while another unit's pass satisfied its kind.
- **A deviation/rework closes the nonconformance it names** only when it satisfies on its own (reviewed, hardware, pass, not `use_as_is`),
  its subject covers the subject of every record that raised it (C62; a lot covers its units, a unit only itself), and - for a rework or a
  repair - it names at least one retest, each a satisfying `incoming_inspection`, `continuity_power_on` or `functional_test`
  (`PHYSICAL_EVIDENCE_RETEST_KINDS`, C66) of the reworked subject, performed no earlier than the rework, and never a record that raised that
  nonconformance (C63). Scrap names none. Otherwise `relies_on_unsatisfied`. [B23-D low round, 2026-10-05] And it comes no earlier than every
  record that raised that nonconformance (C76, case 12), so each retest, never earlier than the rework, is never earlier than they are: a
  repair dated before the failure it names, retested by the unit's earlier pass, closed it in the review round's rule. "No earlier than" is
  this module's one ordering rule (the review against the work, a retest against its rework, a final qualification against what it follows),
  so a disposition at the very instant of the failure counts, as case 6's lot rework at its inspection's instant does.
- **A scrap removes its unit or lot** ([B23-D low round, 2026-10-05]; C75, C77-C79, case 13; [B23-D low round 2, 2026-10-05] C80, cases
  13-15). [B23-D low round 2, 2026-10-05] Corrected in place: only a scrap that satisfies on its own removes its subject - by its own rules
  (this release and lot, raw artifacts, `hardware`, pass, a server-derived human review of its digest) and with an id no other record
  shares ([B23-D lead, 2026-10-05] corrected: whatever record shares its id - a duplicate voids a scrap as a closure, never as a removal: C75,
  case 16); one that does not satisfy, a dry run included, removes nothing. Whether the lot's identity lists the scrapped unit does not
  decide it, as it does not decide whether a failure raises. No other record whose subject a removed subject covers satisfies any kind, its
  passes, its final qualification and a rework of it included (`subject_scrapped`): a scrapped lot presents no evidence of any kind, and
  once a unit is scrapped its tests count for nothing, so the lot qualifies again only on its other units' records and its lot-scope
  records, with a final qualification after the scrap - and once no unit is left, on none.
- **A lot with no unit left is scrapped** ([B23-D low round 2, 2026-10-05]; C80, case 15): once scraps that satisfy on their own have
  removed every serial one of its lot identities lists (one or more) - even when that identity lists fewer serials than the lot holds,
  since its other units can bear no unit evidence of the claim - or as many distinct units as its smallest `lotQuantity`, whatever its
  identities list. Its lot-scope records then satisfy nothing either.
  [B23-D lead, 2026-10-05] The identities that count a lot's units out here, and that bind its units (section 2), are those that satisfy their own
  rules, whatever record shares their id: a dry-run record sharing an identity's id once unbound a unit and took back a lot counted out
  (case 16).
- **What a scrap leaves.** The scrap itself stays: it closes the nonconformance it names, and only that one, when it satisfies and acts on
  it (the rework rule above); what a removed rework had closed reopens until a disposition of it holds. [B23-D low round 2, 2026-10-05] A
  removal only takes evidence away: what a removed record raised, and when a removed rework was done, still count (next rule). In the
  review round's rule the scrap closed the failure while the scrapped subject's earlier passes kept satisfying, so a failed and scrapped
  lot presented complete evidence. In the low round's rule every hardware scrap of the claim removed its subject, satisfying or not, and a
  removed or unsatisfying rework dropped out of the final qualification's ordering, so a scrap that was no physical evidence could make a
  stale final qualification count (low-4); and only a unit's own scrap removed it, so a lot whose every unit was scrapped one by one still
  presented complete evidence on its lot-scope records (low-5).
- **Final physical qualification** counts only when every record it relies on satisfies (a satisfying rework included) and was performed no
  later than it, and when it comes no earlier than every record that raised a nonconformance and every satisfying rework of the claim
  (C64, C65): a failure after it leaves it stale until a new qualification follows the repair and its retest. [B23-D low round 2,
  2026-10-05] Every `hardware` deviation/rework of this release and lot, satisfying or not and removed or not (C81, case 14): a rework, a
  waiver or a scrap done after it, reviewed or not, leaves it stale; a dry run, or another lot's or release's record, does not.

A kind is missing while no record of it satisfies; `deviation_rework` is missing while a nonconformance stays open. Its answer type admits
only `eligible: false` (C19):

- with no review port (B23's default) and any records: blocked, every required kind missing, reasons `assembly_data_authority_absent`,
  `review_port_not_wired`, `physical_evidence_missing`;
- with the complete satisfying set and a fake server port: blocked, nothing missing, reason `assembly_data_authority_absent` -
  `ASSEMBLY_DATA_AUTHORITY` is `"absent"` (C18) and no input supplies it;
- a malformed claim (one whose reads throw included), records over the limit of 512, a port that is no function, a record proxy whose
  traps throw and a record whose getter throws: blocked, never thrown;
- 840 mutations of the complete set, each with and without the port (1,680 evaluations): blocked, and each one judged - with the port the
  mutated record satisfies only when its value is unchanged or it was merely renamed (then only the final qualification that relied on its
  old id is missing), and otherwise its kind is missing; without the port nothing satisfies.

Its unblock condition, carried in every answer:

> manufacturing.assembled-release stays blocked until both exist: assembly-data authority (exact approved MPN, population variant, BOM, placement and paste) and OD-175's physical evidence, every required kind satisfied, with a qualified human review derived from the server context.

CONFIRMED (cases 6, 7, 10; [B23-D low round, 2026-10-05] cases 11-13; [B23-D low round 2, 2026-10-05] cases 14 and 15; [B23-D lead, 2026-10-05] case 16;
`b23-d-assembled-release-blocked` case 6)

## 5. Nothing creates a record

No route, store, tool or form records, accepts or holds evidence (case 8, an AST check):

- the module imports one pure digest helper (C1) and nothing else;
- its top level holds only imports, types, function declarations, primitive literals, arrow functions and frozen literal trees (a freeze of
  an array or object literal whose every member is a primitive or itself a frozen literal tree; one reviewed derivation, the filter of the
  kinds, C3): no `let`, no class, no call, no `new`, no module-level map, and no shallow freeze of a mutable container. The check is shown to
  bite on seven probes (a shallow freeze, a frozen map, a mutable array, a `let`, a top-level call, a frozen array holding an object, a nested
  freeze holding an array);
- it names no `process`, `fetch`, storage, `globalThis`, `window`, `document`, socket, timer or loader;
- it exports four functions, `validatePhysicalEvidenceRecord`, `physicalEvidenceRecordDigest`, `judgePhysicalEvidenceRecord` and
  `assembledProductEligibility`, and no exported binding, function or const, is named as a writer (shown to bite on an exported arrow
  `storeRecord`);
- no production module imports it (the import gates' AST resolution over the whole root, an escaped specifier probe included);
- no production file names its schema, its file name or any kind id; no route path, tool id or action record is about it. [B24-B1, 2026-10-08] Since B24-B1 one production file names the file name: the golden evaluation catalog (`app/lib/evaluation/golden-catalog.ts`) cites `physical-evidence.ts:44`, `:394` and `:484` and the B23-D suite's path, names neither the schema nor a kind id, and imports nothing from the module (`b23-d-physical-evidence-contract` case 8, a reviewed pin move).

Evidence from a request body or browser state is therefore never accepted: nothing can carry it in. CONFIRMED

## 6. The latent claim paths (D23-14, OD-176)

None has a production caller: the three defining modules are imported only by their own barrels, nothing imports a barrel, and no
production module but the defining one spells an id (`b23-d-latent-claim-paths` cases 1-3, each check shown to bite on an aliased barrel
import, a namespace import with a computed member and an escaped specifier; the closure relies on B14.4's zero opaque loads, case 2 there,
C68, C69, which case 6 checks the header cites). Case 4 executes what each accepts today; a caller may be added only after the hardening in
the last column, which then moves case 4's pin by review.

| function | where | what it accepts today (case 4, executed) | hardening before any caller is added |
|---|---|---|---|
| `evaluateReleaseLevels` | `app/lib/release-engineering/readiness.ts:11` | the physical-process gate passes on any non-empty ref list (C28) and production release authority on a caller-supplied `actorKind: "human"` (C29) | resolve refs against stored, reviewed evidence (OD-175's records, by digest); a server-derived actor, never a record's or a body's |
| `materializeRelease` | `app/lib/release-engineering/readiness.ts:28` | calls `evaluateReleaseLevels` twice and returns a manifest and candidate built on it; no caller at all (C30) | resolve refs against stored, reviewed evidence; a server-derived actor; and the hardening of `evaluateReleaseLevels` first |
| `evaluateFactoryMeasurement` | `app/lib/firmware-bringup/factory.ts:5` | a caller-declared `hardware` class passes with an empty `uutIdentityRef`, an empty station list and no operator field; only `dry_run` is demoted (C31, C32) | verified provenance for a hardware class (the reviewed record's raw artifacts, never the caller's word); `factory.ts:5`'s unchecked refs and missing operator (bind the unit, equipment and operator as section 2 does); the seed type `FactoryTestResult` (C35) replaced by a `functional_test` record or bound to one |
| `fitCalibration` | `app/lib/firmware-bringup/factory.ts:6` | takes a caller-declared `hardware` class and an empty `uutIdentityRef` (C33) | verified provenance for a hardware class; the same unchecked refs and missing operator as `factory.ts:5`; the seed type `CalibrationResult` (C36) bound to reviewed evidence |
| `computeRuntimeVerdict` | `app/lib/full-flow/verdict.ts:5` | a `waived` gate counts as passed, for a production-released outcome too (C34) | a waiver never satisfies a physical gate: a physical gate passes only on reviewed physical evidence |

CONFIRMED (cases 1-4; the hardening is PROPOSED). The counterexamples were already true at `4e71563`: the suite's tripwire cases passed
there (a missing pin, not a code defect; section 9).

## 7. The assembled-release block (D23-15, OD-177)

- **One record, missing, Tier 3, unreachable.** `manufacturing.assembled-release` keeps `:118` (C21) and its one B01 CSV row at `:47`
  (C24): `missing`, `explicitly blocked`, no domain command, no tool exposure, approval tier `release`. Its tier is 3 and the agent decision
  `never` for every role, autonomy mode and request. No control, control rule, route coverage row, route file or tool names it (B17-A's
  rule, C40). CONFIRMED (cases 1, 3)
- **Both conditions, named three times.** The registry note: "[B17-A] still missing: no route, no control. [B23-D] Blocked until both
  exist: assembly-data authority (exact approved MPN, population variant, BOM, placement, paste) and OD-175's physical evidence of the
  built boards with qualified human review; none exists (LB-5)." (C21). The gate's refusal (C22), which reaches only the redacted server
  trace and is short enough to survive its 200-character bound whole. What a person sees, the error table's message (C23): "Assembled
  release is not available. It stays blocked until both exist: exact approved assembly data (MPN, population variant, BOM, placement and
  paste) and physical evidence from the built boards, reviewed by a qualified person." It keeps the old first sentence, names no internal
  id, and B19-E's purchase phrases match none of the three. CONFIRMED (case 2)
- **The gate refuses `assembled_pcb` at runtime** on a hand-built authority that passes every earlier check, before anything is generated;
  its bare twin passes that line and is refused later by the retired rule-profile schema; no router starts and no process runs. The
  refusal maps to 422 with the table's words; the trace keeps both conditions. CONFIRMED (case 4)
- **Nothing produces `assembled_pcb`.** Production spells it only in the release-mode type (C26) and the gate's refusal (C22);
  qualification seals `bare_pcb` (C25). CONFIRMED (case 3)
- **The release identity does not move.** The refusal is not inside the archive: its words occur in production only at C22 and C23, and
  the README sentence inside the archive (C47) is unchanged. The pinned 555 identity (C42, C43) is asserted by the prompt-to-gerber
  acceptance pipeline (C44), which replays the router and passed before and after the edit (section 11). CONFIRMED
- **The generic pin** (`manufacturing-release-gate.test.ts:150`, C45) is in no CI workflow and starts Java when FreeRouting resolves; it
  was not run here (the lead runs it once). The id-named pin sits in a CI-admitted directory (C46). CONFIRMED (read)

## 8. Live: BLOCKED-LIVE-QUALIFICATION (LB-5)

No board has been fabricated, assembled, inspected or tested for Sirkit; LB-5 (C41) stays "not attempted" [superseded 2026-10-10 by B24-E (D24-33, OD-217): LB-5 is BLOCKED-LIVE-QUALIFICATION in OD-217's form, and B24-E built nothing for it (OD-218's default): the store, the session-derived recording route and the wired review port are their own increment once the owner answers OD-218; C41's anchor is the row's first two cells, its third cell taking OD-217's form] and unblocks on owner approval
and hardware (B24-E). Recording physical evidence needs a reviewed store, a route that derives the reviewer from the session, and the
review port, all B24-E's; none is in B23. **BLOCKED-LIVE-QUALIFICATION**. The assembly-data authority (exact approved MPN, population
variant, BOM, placement, paste) is not in B23 either: qualification seals only `bare_pcb`. RECORDED

## 9. Test-first record

Every run went through the global lock with two workers; the logs are the session scratchpad's `b23/logs/d-*` (implementation) and
`b23/logs/dfix-*` (review round).

- **Before any edit** (`d-01`): the 48 suites that read a file this increment changes (`git grep -l` on each file name), the B19-E
  tripwire and the prompt-to-gerber acceptance pipeline: 50 files, 679 tests passed, exit 0.
- **Red on `4e71563`** (`d-02`), with only the three new suites and their fixture added:
  - `b23-d-physical-evidence-contract` and `b23-d-assembled-release-blocked` failed to load (`../physical-evidence` absent);
  - `b23-d-latent-claim-paths`: 4 passed, 1 failed (case 5: the page was absent). Its tripwire cases passing there is recorded as a
    missing pin, not a code defect: no production caller existed, and the counterexamples of case 4 already held, executed.
- **The D23-15 counterexample, executed** (`d-03`; the module added, the wording still `4e71563`'s): `b23-d-assembled-release-blocked`
  cases 2 and 4 failed. The note held none of MPN, physical evidence or qualified human review, and the redacted trace of the gate's
  refusal did not end with the physical-evidence condition. Its cases 1, 3, 5 and 6 passed, as did the contract suite's eight code cases
  (its page case failed).
- **A self-review round before the page** (`d-06`): every input is now read once, as data (a getter answers once, a proxy is refused),
  and a retest or a relied-on record must be in order in time. The change and its new assertions (cases 2, 5 and 6) landed together and
  were not run red first; m19 below shows the relies-on rule biting.
- **Green** (`d-10`): 20 of 20 after the wording, the regenerated CSV and this page.
- **Twenty source mutations** (`d-mut-*`), each applied to the working tree, run, and restored byte for byte (the hash of the tree's diff and
  untracked files equal before and after). Each was caught:

| mutation | failed cases |
|---|---|
| m01 the raw-artifacts rule off | contract 4 (and the page's citation, 9) |
| m02 the dry-run rule off | contract 4, 6 (9) |
| m03 `indeterminate` counted as pass | contract 4 (9) |
| m04 an absent review counted | contract 3, 4, 5, 7; blocked 6 |
| m05 a review-shaped key read as an unknown key | contract 3 |
| m06 an `ai` reviewer accepted | contract 5 |
| m07 the review not bound to the digest | contract 5 (9) |
| m08 the operator may review their own work | contract 5 (9) |
| m09 empty equipment allowed | contract 2 |
| m10 a waiver satisfies | contract 6 (9) |
| m11 eligible when nothing is missing | contract 7; blocked 6 |
| m12 a production importer added at the root (`proxy.ts`) | contract 8 |
| m13 a production module imports `factory.ts` | latent 2, 3 |
| m14 the gate's old wording | blocked 2, 4 |
| m15 the error table's old wording | blocked 2 |
| m16 the gate lets `assembled_pcb` pass | blocked 2, 3, 4, 5 |
| m17 the record `partial` | blocked 1 |
| m18 the registry's old note | blocked 1, 2 |
| m19 final qualification ignores what it relies on | contract 6 |
| m20 module-level state | contract 8 (9) |

After the gates of section 11, contract case 8's whole-tree import walk was chunked (it yields every 200 files, as the latent suite's
does), because one synchronous parse of the tree took about 20 s here and CI's runner is slower. The suite re-ran green (`d-12`: 9 of 9,
case 8 in 28.9 s), m12 and m20 were caught again (case 8), the tree's hash was equal after the restore, and tsc and eslint stayed at 0
(`d-13`). CONFIRMED

### The adversarial review round (2026-10-05)

An adversarial review CONFIRMED sixteen findings, thirteen distinct issues (security-1 is coverage-5, security-2 is coverage-1, security-3
is coverage-3, and security-5 is tests-3's third part). Each was closed test-first on the uncommitted implementation:

- **Before any edit** (`dfix-00`): the three D suites, both closeout-statement suites, the CI job-scope guard and B11.5: 7 files, 70 tests,
  exit 0.
- **The test-strength gaps, shown on the reviewed tests** (`dfix-mut-gap-*`): seven breakages of the reviewed module survived them - a
  shallow-frozen holder with an exported arrow writer (g01), a rework clearing every nonconformance (g02), foreign records opening
  nonconformances (g03), final qualification blind to reworks (g04), a malformed claim satisfying (g05), the claim's release read raw (g06)
  and the raw-artifacts rule off under the sweep (g08), each with the contract suite at 9 of 9 (g08: case 7 alone, 1 of 1). g07 (every
  record satisfying) was caught by case 7's no-port assertion, not by the sweep, and was replaced by g08. Every file restored by hash.
- **Red** (`dfix-01`): the strengthened suites on the reviewed sources: 8 of 22 failed (contract 1, 2, 5, 6, 7, 9 and 10; latent 6),
  exit 1. Each case stops at its first failure, so a temporary probe with one case per finding ran too (`dfix-03`): 10 of 10 failed, exit 1;
  it was deleted after its green run.
- **Green**: the code first (`dfix-04`, 30 of 32 with the page still old), tsc 0 (`dfix-05`), then this page (section 11).
- **Twenty-six source mutations of the fixed module** (`dfix-mut-fixed-*`), each run against the case that must catch it and restored by
  hash (the tree's hash equal before and after): 25 caught. f17 (the unit-identity clause off) survived: the clause was redundant, a lone
  unit identity being outside the lot by the serial rule, so it was removed, and f17b (no lot identity admitting every unit) was caught.

| finding | the test | red on the reviewed tree | the fix | after |
|---|---|---|---|---|
| security-1, coverage-5: the self-review rule compared a record's operator references with a session actor id, two unrelated namespaces | contract case 5: `operatorActorIds` rows; the same human as `operator:bench-7` and `user-2b1c` | the probe's same-human review satisfied; case 5's "operators unresolved" row answered `[]`; case 1's review keys lacked the field | the answer names the server-resolved actor id of every operator (C55, C56); the reviewer is none of them (C17); without them the review is refused | green; f08, f09 caught |
| security-2, coverage-1: a failing, indeterminate or invalid record was outvoted by a pass | contract case 6: eight failures (before and after the pass, other units, no raw artifacts, a named nonconformance, the lot's continuity) and their closure | the probe's later failure left nothing missing; case 6's tested-until-pass answered `openNonconformances` `[]` | a hardware record whose result is not pass raises itself when it names no nonconformance (C61); a final qualification comes after every raiser and rework (C64, C65) | green; f10, f18 caught |
| security-3, coverage-3: an acceptance took any outbound package digest and a provider observation id | contract case 2: an outbound digest and four minted ids refused | the probe's outbound digest and observation id validated | `acceptedFilesDigest` is the release's `archiveSha256` only (C54); `manufacturerRef` and `acceptanceRef` refuse `mfg-` ids (C53) | green; f19, f20 caught |
| security-5, tests-3 (3): after refusing a record the judge read the raw input again (traps and getters ran; a getter could put any value in `recordId`) | contract case 7: a throwing proxy, a throwing getter, a shifting id; a claim and a records list whose reads throw | the probe threw `Error: trap` out of the evaluator and read the id getter four times | the judge copies a record once and reads a refused one's id and kind from that copy (C57); every read of the caller's input is inside one guard (C58) | green; f23, f24 caught |
| security-6: a rework's retest could be any satisfying record of any kind or subject | contract case 6: identity, acceptance and assembly records, the raising inspection, another unit's test | the probe's identity-record retest closed the nonconformance | a retest is a later physical test (C66) of the reworked subject, never a record that raised the nonconformance (C63) | green; f11, f12 caught |
| coverage-2: the unit and lot identity bound nothing across records | contract case 10, and case 6's repair or scrap of another unit | the probe's serial outside the lot satisfied | the lot-scope identity binds serials and the inspected quantity (C59, C60); a rework covers the subject that raised its nonconformance (C62) | green; f13, f14, f15, f16, f17b caught |
| coverage-4: digest-named fields took any reference | contract case 2: "TBD", "pending" and "none" refused | the probe's free digests validated | `procedureDigest`, `testDefinitionDigest` and `assemblyDataDigest` are `sha256:<64 hex>` (C50) | green; f21 caught |
| coverage-6: the page and module claimed a reference never carries a person's name | contract cases 2 and 9: "Jane.Doe" and "Jane_Doe" refused; the wording checked | the probe's dotted name validated; the page and module held the claim | operators and equipment are typed (C51, C52); the wording says what is checked | green; f22 caught |
| coverage-7: the latent suite cited the wrong B14.4 case | latent case 6 resolves the citation | latent case 6 failed (it cited case 1; case 2 holds opaque loads) | the header cites case 2 (C68, C69) | green |
| tests-1: case 8 admitted a shallow freeze and an exported arrow writer | contract case 8: the frozen-literal-tree rule, seven probes, the writer check over every export | g01 survived (9 of 9) | test only | f01, f01b caught |
| tests-2: no test said which nonconformance a rework closes | contract case 6: two opened and one closed, an unrelated rework, foreign records, a final relying on a rework | g02, g03 and g04 survived | test only | f02, f03, f04 caught |
| tests-3 (1, 2): the judge's malformed-claim branch and the claim's read-once were untested | contract case 7: four malformed claims; a shifting release getter | g05 and g06 survived | test only | f05, f06 caught |
| tests-4: the sweep asserted only `eligible`, false by type | contract case 7: each mutation's verdict and missing kinds | g08 survived (case 7, 1 of 1) | test only | f07 caught |

CONFIRMED

### The low round (2026-10-05)

[B23-D low round, 2026-10-05] An independent check of the review round's fixes raised three low issues, each inferred from reading and
not executed there. Each was closed test-first on the uncommitted tree; logs `b23/logs/dlow-*`:

- **Before any edit** (`dlow-00`): the three D suites, both closeout-statement suites, the CI job-scope guard, B11.5 and the B19-E
  tripwire: 8 files, 85 tests, exit 0. The tree matched the review round's recorded final hashes.
- **Red** (`dlow-01`): the contract suite with cases 11-13 added and the pins of cases 1 and 6 moved, on the unchanged module: 5 of 13
  failed (cases 1, 6, 11, 12 and 13), exit 1, each at the issue's own scenario. Each case stops at its first failure, so a temporary probe
  with one test per scenario ran too (`dlow-02`): 6 of 6 failed, exit 1, each answering `missing` `[]` and `openNonconformances` `[]`
  where the issue said it would. The probe went green in `dlow-04` and was then deleted.
- **Green**: the module first (`dlow-03`, 18 of 19, only case 9's citations pending), then this page (`dlow-04`: the three D suites, the
  probe and both closeout-statement suites, 6 files, 50 tests, exit 0).
- **Breakages** (`dlow-mut-*`), each applied to the module, run, and restored by hash; the tree's hash was equal before and after each
  set. Twelve of the low fixes, each against the whole contract suite: all 12 caught, each by case 11, 12 or 13 (and case 6 for seven of
  them; case 9 fails too wherever a cited line's text changed). The review round's 25 caught mutants of its fixed module (f01-f24, f01b,
  f17b; f17 went with the clause it broke), re-anchored where this round changed the text (f03 on `outsideClaim`, f14 on `actsOn`), each against the case that
  must catch it: all 25 caught, so its fixes stay revert-sensitive.

| issue | the test | red on the unchanged module | the fix | after |
|---|---|---|---|---|
| low-1: a failure was dropped, not raised, when the lot's identity did not list its unit (an identity may list fewer serials than the lot holds, or none) or when another record shared its id | contract case 11: an unlisted unit failing after the pass; an identity listing no serial with lot-scope tests and three units failing; an over-quantity inspection failing; a failure voided by a duplicate of another unit's pass, and one sharing its id with another kind; named nonconformances on unlisted and duplicate records; another release's and lot's failures raising nothing. Case 6's duplicate pin moved | case 11: `missing` `[]`, `openNonconformances` `[]` for the unlisted unit; the probe's three scenarios each the same | only another release or another lot puts a record outside the claim (`outsideClaim`, C74); its serial listing and a duplicate id no longer do | green; l01-l04 caught |
| low-2: a repair dated before the failure it names closed it, the earlier pass its retest | contract case 12: the issue's 11:30 repair of the 12:30 failure; a repair after the failure retested by the earlier pass; a lot rework dated before its inspection; a nonconformance two records raise and a rework between them; a scrap dated before the failure; the closing controls | case 12: the 11:30 repair satisfied (rejections `[]`); the probe's scenario left nothing missing | a disposition comes no earlier than every record that raised its nonconformance (`actsOn`, C76), so each retest does too | green; l05, l06 caught |
| low-3: a scrap closed the failure while the scrapped subject's earlier passes kept counting, so a failed and scrapped lot presented complete evidence | contract case 13: the issue's lot scrap and unit scrap; another unit qualifying after a unit's scrap; a rework of the scrapped unit no longer counting; scraps without raw artifacts, sharing an id, as a dry run, of another lot and another release. Case 1's rejection list and case 6's lot-scrap pin moved | case 13: the scrapped lot answered `missing` `[]`; case 6's lot scrap the same; case 1 lacked `subject_scrapped`; the probe's unit scrap left nothing missing | every hardware scrap of the claim removes its unit or lot, and no other record of it satisfies (`withoutScrapped`, C75, C77-C79; `subject_scrapped`, C73) | green; l07-l12 caught |

CONFIRMED

### The second low round (2026-10-05)

[B23-D low round 2, 2026-10-05] A second independent check of the low round's fixes raised two low issues, each inferred from reading and
not executed there. Each was closed test-first on the uncommitted tree; logs `b23/logs/dlow2-*`:

- **Before any edit** (`dlow2-00`): the three D suites, both closeout-statement suites, the CI job-scope guard, B11.5 and the B19-E
  tripwire: 8 files, 88 tests, exit 0. The tree matched the low round's recorded final hashes.
- **Red** (`dlow2-01`): the contract suite with cases 14 and 15 added and case 13 retitled with two pins moved, on the unchanged module,
  beside a temporary probe with one test per scenario: the contract suite failed 3 of 15 (cases 13, 14 and 15) and the probe 7 of 7, exit
  1. Each probe scenario answered `missing` `[]` and `openNonconformances` `[]` where the issue said it would. The probe went green in
  `dlow2-03` and was then deleted.
- **Green**: the module first (`dlow2-02`: 21 of 22, only case 9's two re-anchored citations pending), then this page (`dlow2-03`: the
  three D suites, the probe and both closeout-statement suites, 6 files, 53 tests, exit 0).
- **Breakages** (`dlow2-mut-*`), each applied to the module, run, and restored by hash; the tree's hash was equal before and after each
  set. Fourteen of this round's two fixes (n01-n14), each against the whole contract suite: all 14 caught, each by case 13, 14 or 15, and
  some by cases 6, 11 or 12 as well (case 9 fails too wherever a cited line's text changed). The low round's mutants on this module, against
  the whole contract suite: l01-l09, l07 re-anchored on this round's call, all 9 caught by a case other than 9; its l10-l12 are this round's
  n05-n07, and l10 broke the module the way this round's direction now requires, so it is no longer a mutant. The review round's 26
  (f01-f24, f01b, f17b), each against the case that must catch it: all 26 caught. So every earlier fix stays revert-sensitive.

| issue | the test | red on the unchanged module | the fix | after |
|---|---|---|---|---|
| low-4: a scrap that did not satisfy still removed its unit, and the removed unit's later repair dropped out of the final qualification's ordering, which counted only satisfying reworks: a stale final qualification counted | contract case 14: the issue's scenario with a scrap of sn-0002 at 12:40 without raw artifacts, without review, or sharing its id; a satisfying scrap at 11:40 that removes a repair done at 12:30; the same scrap at 12:40; a waiver and a rework without raw artifacts after the final qualification; a dry run and another lot's and release's rework as controls. Case 13's title corrected and two of its pins moved | case 14: the scrap without raw artifacts removed the repair (`subject_scrapped`); the probe's four scenarios each answered `missing` `[]` where the 12:00 final qualification is stale | only a scrap that satisfies on its own removes (`removedSubjects`, C77); a final qualification comes after every hardware rework of the claim, satisfying or not and removed or not (`reworkInstants`, C81) | green; n01-n07 caught |
| low-5: a lot whose every unit was scrapped one by one still presented complete evidence on its lot-scope records | contract case 15: the issue's five listed units scrapped; its lot of one unit, failed and scrapped; an identity listing fewer serials than the lot holds; an identity listing none, and five other serials scrapped; seven controls that keep a unit | case 15: the emptied lot answered `missing` `[]`; the probe's three scenarios each the same | a lot with no unit left is removed: every serial one of its identities lists, or as many distinct units as its smallest `lotQuantity`, scrapped by scraps that satisfy on their own (C80) | green; n08-n14 caught |

CONFIRMED

### The lead round (2026-10-05)

[B23-D lead, 2026-10-05] The second low round's own re-check raised one more low issue: a scrap counted as removing only with an id no other record
shares, so a dry-run record sharing a reviewed scrap's id voided the scrap and took its removal back - the unit's pass satisfied again and
the claim went from incomplete to complete; the same through the lot identities that bind units and count a lot's units out. The lead
closed it test-first on the uncommitted tree; logs `b23/logs/dlead-*`:

- **Red** (`dlead-01`): contract case 16 added, on the unchanged module: 1 of 16 failed (case 16, at its first scenario: sn-0001's pass
  satisfied after a dry run shared the scrap's id). A temporary probe with one test per scenario (`dlead-02`): 3 of 3 failed, each at the
  intended assertion after its baseline passed - the scrap's removal taken back, the lot of two no longer counted out, sn-0003 no longer
  unbound. The probe was deleted (a copy is under `b23/dlow2/`).
- **Fix** (in place, no line moved): the scraps that remove, and the lot identities that bind units and count them out, are read from each
  record's own verdict before the duplicate check (`judged`, C75), so a duplicate voids what a record would satisfy or close and never
  takes back what it imposes. `removedSubjects`'s comment was corrected on its line.
- **Pins moved** (section 10): three, each toward refusing more - case 13's scrap sharing its id, case 14's, and case 15's fifth scrap
  sharing its id now remove their subject.
- **Green and breakages**: section 11.

| issue | the test | red on the unchanged module | the fix | after |
|---|---|---|---|---|
| lead: a record that is not physical evidence voided a reviewed scrap, or a lot identity, by sharing its id, and the claim moved toward complete | contract case 16: the scrap of sn-0001 and a dry run sharing its id; a second identity of two units, both scrapped, and a dry run sharing its id; a functional test of a unit the second identity does not list, and a dry run sharing that identity's id; four controls that fail their own rules | case 16 (`dlead-01`); the probe 3 of 3 (`dlead-02`) | scraps and identities read from each record's own verdict, before the duplicate check (C75) | green |

CONFIRMED

## 10. Every pin moved, and why

Every edit is in place on its line; no cited line moved.

- `app/lib/engineering/action-registry.ts:118`: the note only (C21). B23-C's case 4 pin (`source[117]` holds the id) and its page's C45
  hold.
- `artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv:47`: re-rendered by `scripts/generate-action-toolability-matrix.ts`
  (one row, the note); the route coverage CSV and the control fingerprint did not change.
- `app/lib/pcb/fab/release-gate.ts:189`: the refusal's message, with a same-line `[B23-D]` comment (C22). The generic pin asserts the code
  only.
- `app/lib/pcb/fab/manufacturing-errors.ts:62`: the public message, with a same-line `[B23-D]` comment (C23).

No test pin outside B23-D's own new suites moved. The review round moved pins only inside them, each with a dated `[B23-D review round,
2026-10-05]` note in place: contract case 1 (the review keys gain `operatorActorIds`; the retest kinds pinned), case 2 (an outbound package
digest is refused where it was asserted valid), case 3 (the review-beside neighbour is a lot record, since a unit record alone has no lot
identity), case 6 (the fixture's rework is retested by the lot's continuity/power-on record, and the failed- and early-retest scenarios
move with it); the fixture (that retest, `assemblyDataDigest` as `sha256:<hex>`, the fake port answering `operatorActorIds`); and the
latent suite's header comment (case 1 to case 2). The module, its tests and this page are B23-D's own, so their re-resolved citations move
nothing anyone else pins. The action registry, the gate, the error table and the B01 CSV were not touched by the review round.

[B23-D low round, 2026-10-05] The low round moved pins only inside contract case 1 and case 6, each with a dated `[B23-D low round,
2026-10-05]` note in place: case 1 (the rejections gain `subject_scrapped`, after `subject_mismatch`); case 6 (the fixture's lot scrap now
leaves every required kind missing, since it removes the lot, where nothing was missing; two records voided by one id that name
`ncr:duplicate` now raise it, where nothing was open, and the other release's and lot's records are asserted to raise nothing on their
own). Each pin moved toward refusing more. In the module, the edits are in place and the new declarations sit at its end: C61 moved one
line (two comment lines became one, and the scrap line took the freed line), C62's text changed on its line, and C73-C79 are new. The
fixture, the other two D suites, the action registry, the gate, the error table and the B01 CSV were not touched.

[B23-D low round 2, 2026-10-05] The second low round moved pins only inside contract case 13, each with a dated `[B23-D low round 2,
2026-10-05]` note in place. Its scrap without raw artifacts no longer removes sn-0001, so `functional_test` is no longer missing: the claim
answers `deviation_rework` and `final_physical_qualification` missing, with the failure's nonconformance open. Its scrap sharing an id no
longer removes sn-0001 either: the unit's pass now has rejections `[]`, and the same open nonconformance and stale final qualification are
asserted. Both pins moved toward refusing less, as the direction that only a scrap that satisfies removes requires; each claim stays
blocked. Case 13's title was corrected in place, and case 12's comment about its early scrap. In the module, the edits are in place and
the new declarations sit at its end. C75's text changed on its line. C77 moved to `removedSubjects`, where the scraps that remove are now
chosen; its old line 572 is a comment, so no line moved. C80 and C81 are new. The fixture, the other two D suites, the action registry,
the gate, the error table and the B01 CSV were not touched.

[B23-D lead, 2026-10-05] The lead round moved three pins, each with a dated `[B23-D lead, 2026-10-05]` note in place and each toward refusing more: case 13's scrap
sharing an id now removes sn-0001 (its pass `subject_scrapped`; `functional_test`, `deviation_rework` and `final_physical_qualification`
missing, the failure still open, since the duplicate voids the scrap as a closure); case 14's scrap sharing an id moved out of the list of
scraps that remove nothing and now removes sn-0002 (its repair and retest `subject_scrapped`; the final qualification stays stale); case
15's fifth scrap sharing its id moved out of the controls and now counts the lot out (every required kind missing). Two comments in
cases 13 and 15 were corrected on their lines. C75's anchor text changed on its line.

## 11. Gates

On the final working tree of the implementation, sequential under the lock (`b23/d-gates.sh`):

| set | files | tests | exit |
|---|---|---|---|
| the 48 suites that read a changed file, the B19-E tripwire and the acceptance pipeline (after; before: the same 50 / 679) | 50 | 679 passed | 0 |
| `app/lib/manufacturing-providers` (the PGlite suite included) and `b19-e-ci-job-scope` | 30 | 389 passed | 0 |
| `app/lib/engineering/__tests__` (action registry, B17-A, permission tiers, B19-E) | 99 | 1,107 passed | 0 |
| `app/lib/release-engineering`, `app/lib/firmware-bringup`, `app/lib/full-flow` | 3 | 33 passed | 0 |
| `app/lib/pcb`, three Java-capable suites excluded | 127 passed, 1 skipped | 977 passed, 4 skipped | 0 |
| `app/lib/workflow/prompt-to-gerber/__tests__` (the pinned 555 release identity, replayed router) | 5 | 34 passed | 0 |
| `app/lib/agent/__tests__` (B11.5 capture exactness included) | 36 | 415 passed | 0 |
| `app/lib/agent/orchestration/__tests__` | 49 | 460 passed | 0 |
| `app/lib/computation/__tests__` (the B22 process census and closeout statements included) | 26 passed, 2 skipped | 300 passed, 18 skipped | 0 |
| `b14-4-ast-import-gates`, alone | 1 | 22 passed | 0 |
| `b21-closeout-statements` and `b22-closeout-statements` on this page (`d-09`) | 2 | 19 passed | 0 |
| `tsc --noEmit -p tsconfig.json` | | | 0 |
| `eslint` over the eight changed and new code files | | | 0 |
| the 21 generators (action toolability, agent, B10, B11, B21, read invocation, tool registry, B06, B16.0.x, B17 control inventory, B19, B20 x3, PCB shape, B23 provider registry) | | no drift | 0 each |

`app/lib/pcb` ran with `autoroute-boundary-integrity`, `autonomous-layout-qualification` and `manufacturing-release-gate` excluded (they
can start Java); the lead runs `manufacturing-release-gate.test.ts` once. No browser suite was run: no component or control changed. The
B17-A control-inventory suite (in `app/lib/engineering/__tests__`) and its generator ran. Census 166 / 163 / 3 / 0 and counts 47 / 36 / 9 /
27 are unchanged (no route, no tool). The B21 and B22 closeout-statement suites pass on this page. CONFIRMED

After the review round, on its final working tree, sequential under the lock (`b23/dfix-gates.sh`, logs `dfix-gate-*`):

| set | files | tests | exit |
|---|---|---|---|
| the three D suites and the B19-E tripwire | 4 | 35 passed | 0 |
| `app/lib/manufacturing-providers` (the PGlite suite included) and `b19-e-ci-job-scope` | 30 | 391 passed | 0 |
| `app/lib/engineering/__tests__` (action registry, B17-A, permission tiers, B19-E) | 99 | 1,107 passed | 0 |
| `app/lib/release-engineering`, `app/lib/firmware-bringup`, `app/lib/full-flow` | 3 | 33 passed | 0 |
| `app/lib/pcb`, three Java-capable suites excluded | 127 passed, 1 skipped | 977 passed, 4 skipped | 0 |
| `app/lib/workflow/prompt-to-gerber/__tests__` (the pinned 555 release identity, replayed router) | 5 | 34 passed | 0 |
| `app/lib/agent/__tests__` (B11.5 capture exactness included) | 36 | 415 passed | 0 |
| `app/lib/agent/orchestration/__tests__` (B21 closeout statements included) | 49 | 460 passed | 0 |
| `app/lib/computation/__tests__` (the B22 process census and closeout statements included) | 26 passed, 2 skipped | 300 passed, 18 skipped | 0 |
| `b14-4-ast-import-gates`, alone (42.8 s, no onTaskUpdate timeout) | 1 | 22 passed | 0 |
| `tsc --noEmit -p tsconfig.json` | | | 0 |
| `eslint` over the eight changed and new code files | | | 0 |
| the same 21 generators | | no drift | 0 each |

The two new cases account for the 391 (389 before): contract case 10 and latent case 6. No test file of the review round spells a write
primitive (B11.5 case 12 green). Census and counts unchanged; no browser suite was needed (no component or control changed). CONFIRMED

[B23-D low round, 2026-10-05] After the low round, on its final working tree, sequential under the lock (`b23/dlow-gates.sh`, logs
`dlow-gate-*`):

| set | files | tests | exit |
|---|---|---|---|
| `app/lib/manufacturing-providers` (the PGlite suite included) and `b19-e-ci-job-scope` | 30 | 394 passed | 0 |
| `app/lib/engineering/__tests__` (action registry, B17-A, permission tiers, B19-E) | 99 | 1,107 passed | 0 |
| `app/lib/release-engineering`, `app/lib/firmware-bringup`, `app/lib/full-flow` | 3 | 33 passed | 0 |
| `app/lib/agent/__tests__` (B11.5 capture exactness included) | 36 | 415 passed | 0 |
| `b21-closeout-statements` and `b22-closeout-statements` | 2 | 19 passed | 0 |
| `tsc --noEmit -p tsconfig.json` | | | 0 |
| `eslint` over the eight code files of B23-D | | | 0 |
| the same 21 generators (none reads the module; status and tree hash equal before and after) | | no drift | 0 each |

The three new contract cases (11-13) account for the 394 (391 before). Only the module, the contract suite and this page changed; the
`app/lib/pcb`, prompt-to-gerber, orchestration and computation sets were not re-run (nothing they import changed). No test file of the low
round spells a write primitive (B11.5 green). Census and counts unchanged; no route, tool, control or component changed. CONFIRMED

[B23-D low round 2, 2026-10-05] After the second low round, on its final working tree, sequential under the lock (`b23/dlow2-gates.sh`,
logs `dlow2-gate-*`):

| set | files | tests | exit |
|---|---|---|---|
| `app/lib/manufacturing-providers` (the PGlite suite included) and `b19-e-ci-job-scope` | 30 | 396 passed | 0 |
| `app/lib/engineering/__tests__` (action registry, B17-A, permission tiers, B19-E) | 99 | 1,107 passed | 0 |
| `app/lib/release-engineering`, `app/lib/firmware-bringup`, `app/lib/full-flow` | 3 | 33 passed | 0 |
| `app/lib/agent/__tests__` (B11.5 capture exactness included) | 36 | 415 passed | 0 |
| `b21-closeout-statements` and `b22-closeout-statements` | 2 | 19 passed | 0 |
| `tsc --noEmit -p tsconfig.json` | | | 0 |
| `eslint` over the two code files this round changed (the module and the contract suite) | | | 0 |
| `generate-b23-provider-registry` and `generate-action-toolability-matrix` (no generator reads the module; status and tree hash equal before and after) | | no drift | 0 each |

The two new contract cases (14 and 15) account for the 396 (394 before). Only the module, the contract suite and this page changed; the
`app/lib/pcb`, prompt-to-gerber, orchestration and computation sets were not re-run (nothing they import changed). No test file of this
round spells a write primitive (B11.5 green). Census and counts unchanged; no route, tool, control or component changed. CONFIRMED

[B23-D lead, 2026-10-05] After the lead round, on the final tree, the lead's gates (`b23/lead-gates.sh d`, sequential under the lock,
logs `d-lead-*`), every set exit 0: the manufacturing-providers, acquisition, release-engineering, net and distributors set 813 passed, 2
skipped; computation, SPICE, simulation and firmware-bringup 632 passed, 21 skipped; `app/lib/pcb` without its three real-process suites
977 passed, 4 skipped; engineering 1,107; agent 415; orchestration 460; MCP 825; the route gates 357; `app/api` 1,059; B14.4 22; the
confinement gates 375; auth 479 passed, 9 skipped; tsc 0; eslint 0; all 21 generators with no drift. The lead ran
`manufacturing-release-gate.test.ts` once (section 13). Both browser suites passed under the lock: the default configuration 48 of 48
(7.3 min) and the orchestration configuration 4 of 4 (2.7 min); the evidence PNGs they rewrite were restored from HEAD, all 32 equal
by blob hash. CONFIRMED

## 12. OD-187 - B23-D's choices beyond its task text

Defaults applied, owner confirmation pending (amended by the review round, 2026-10-05, by the low round, 2026-10-05, and by the second low
round, 2026-10-05, where marked):

- (a) **Where.** `app/lib/manufacturing-providers/physical-evidence.ts`, in the CI-admitted B23 directory; it imports only the durable
  digest helper and nothing in production imports it.
- (b) **Required kinds.** Every kind but `deviation_rework` for an assembled-product claim; `deviation_rework` for each nonconformance that
  a record of the claim raises (amended: a failure raises itself), until a satisfying rework, repair or scrap closes it.
- (c) **Who reviews.** A human `project_admin` with a recorded `qualificationRef`, derived by the server from its session
  (`derivation: "server_session"`), no earlier than the work. No new role until the owner names one (as OD-172). Amended: never one of the
  record's operators as the server resolves them - the answer carries `operatorActorIds`, one per operator reference, and an answer without
  them is refused; that the resolution is right is the port's (B24-E).
- (d) **The review port.** Asked by record id, kind and digest only; its answer copied as data and checked;
  `PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING` is `"none"`, and the reviewed change that wires one changes it with it.
- (e) **Waivers and dispositions.** `use_as_is` is a waiver: it never satisfies and never closes a nonconformance. Scrap closes one without a
  retest. Rework and repair need at least one satisfying retest performed no earlier than the rework. Amended: every disposition acts on a
  subject that covers each record that raised the nonconformance (a lot's nonconformance needs a lot-scope rework and retest, since a lot
  record names no unit), and each retest is an incoming inspection, continuity/power-on or functional test covering the reworked subject,
  never a record that raised the nonconformance. [B23-D low round, 2026-10-05] Amended: every disposition comes no earlier than each record
  that raised the nonconformance it names, so each retest does too; "no earlier than" admits the same instant, as every ordering here does.
  A scrap closes only the nonconformance it names, and it removes its subject (s). [B23-D low round 2, 2026-10-05] Amended: it removes
  its subject only when it satisfies on its own (s).
- (f) **Final physical qualification** relies only on satisfying records of the same evaluation, performed no later than itself. Amended:
  and it comes no earlier than every record that raised a nonconformance and every satisfying rework of the claim. [B23-D low round 2,
  2026-10-05] Amended: every hardware rework of the claim, satisfying or not and removed or not - a rework, a waiver or a scrap done after
  it leaves it stale, reviewed or not.
- (g) **Duplicate record ids** void every record that carries the id. [B23-D low round, 2026-10-05] Amended: a voided record still counts
  against the claim - it raises what it names (a hardware failure, itself), and a voided hardware scrap still removes its subject.
  [B23-D low round 2, 2026-10-05] Amended: a voided scrap removes nothing (s); a voided hardware rework still keeps a final qualification
  dated before it stale (f).
  [B23-D lead, 2026-10-05] Amended: a duplicate voids what a record would satisfy or close, never what it imposes - a voided scrap that satisfies its own
  rules still removes its subject, and a voided lot identity still binds units and counts them (s, case 16).
- (h) **References are identifiers**: no space and no "@", so no prose and no address. Amended: operators and equipment are typed
  (`operator:<id>`, `equipment:<id>`); a regex cannot tell an id from a name, so that an operator id spells no name is the recording
  route's (B24-E). Operators are references, resolved to actor ids only by the server (c).
- (i) **Coverage.** A lot claim counts one satisfying record per kind; whether every unit or a sample must be covered is the owner's
  question (UNKNOWN), moot while the block stands. Amended: the claim's identity is its lot-scope identity records; a unit record names a
  serial each lists, and an inspection inspects no more than the lot holds. [B23-D low round, 2026-10-05] A record outside that identity
  never satisfies, yet its failure still raises (p).
- (j) **Blocked by type and by fact.** `eligible` is `false` in the answer's type, and `ASSEMBLY_DATA_AUTHORITY` is `"absent"`; no input
  supplies the assembly-data authority.
- (k) **Where a person sees it.** The unblock condition is stated in the error table (`manufacturing-errors.ts:62`), not the panel: a person
  meets the block only through that refusal (no control requests an assembled release), and the panel stays unchanged (no UI change).
  Limit: no qualification produces `assembled_pcb` today, so in practice nobody sees it yet.
- (l) **Wording.** The gate's refusal says "approved MPN, variant, ..." so that the redacted trace's 200-character bound keeps both
  conditions whole; the registry note keeps its `[B17-A]` prefix and adds `[B23-D]`.
- (m) **The latent paths** are not rewired; their counterexamples are pinned as executed (latent case 4), so a hardening change moves that
  pin by review.
- (n) **Inputs are read once, as data** (a structured clone): a getter answers once, and a proxy or a function is refused. Amended: the
  evaluator copies each record once and reports a refused record's id and kind from that copy; every read of the caller's claim is
  guarded, so a throwing read is a malformed claim, never an exception.
- (o) **Bounds.** 512 records per evaluation; 64 equipment refs, 16 operators, 256 raw artifacts, 64 nonconformances, 4,096 serials and 64
  relied-on records per record; quantities up to 1,000,000.
- (p) **A failure is never outvoted** (review round). A `hardware` record of the claim whose result is not pass raises the nonconformances
  it names, or itself when it names none; a dry run raises nothing of its own. [B23-D low round, 2026-10-05] Amended: "of the claim" is of
  this release and lot - every valid record of them raises what it names, whatever its serial listing or a duplicate id; only another
  release or another lot puts a record outside the claim.
- (q) **Manufacturer acceptance** (review round). It binds the release's own `archiveSha256` only; an outbound package digest waits for a
  server that can resolve it to its release. Its refs are the manufacturer's, never Sirkit's minted `mfg-` ids.
- (r) **Digest-named fields** (review round). `procedureDigest`, `testDefinitionDigest` and `assemblyDataDigest` are `sha256:<64 hex>`.
- (s) **A scrap removes its subject** ([B23-D low round, 2026-10-05]). Every `hardware` scrap of this release and lot removes its unit or
  lot, reviewed or not and whatever its id's duplicates, as a failure raises whatever its review; a dry run removes nothing. No other record
  of a removed subject satisfies any kind (`subject_scrapped`), its passes, final qualification and reworks included; the scrap itself
  stays and closes only the nonconformance it names, when it satisfies and acts on it. [B23-D low round 2, 2026-10-05] Amended: only a
  scrap that satisfies on its own - its own rules (this release and lot, raw artifacts, hardware, pass, a server-derived human review) and
  an id no other record shares - removes its subject, whatever the lot's identity lists for its unit; one that does not satisfy, a dry run
  included, removes nothing. A lot with no unit left is removed: every serial one of its identities lists (one or more), or as many
  distinct units as its smallest `lotQuantity`, scrapped. A removal never relaxes a rule: what a removed record raised, and when a removed
  rework was done, still count (f).
  [B23-D lead, 2026-10-05] Amended: "an id no other record shares" is no longer one of a scrap's own rules - whatever record shares its id, a scrap that
  satisfies its own rules removes its subject, and the identities that count a lot's units out are read the same way (g, case 16).

## 13. What stays open

- **No physical evidence exists.** Recording it is B24-E's, under LB-5: a reviewed store, a route that derives the reviewer from the
  session, and a wired review port. None is in B23. BLOCKED-LIVE-QUALIFICATION
- **The assembly-data authority does not exist** (exact approved MPN, population variant, BOM, placement, paste): qualification seals only
  `bare_pcb`. Which chapter supplies it is the owner's; discovery section 8 item 14 keeps one record naming both conditions (OD-177).
  UNKNOWN
- **Coverage** of unit-scope kinds (every unit or a sample): UNKNOWN (OD-187 (i)).
- **Operator resolution** is the review port's: the contract requires `operatorActorIds` and applies them, and whether a future server
  resolves them correctly is B24-E's. UNKNOWN
- **Completeness of the record set.** The evaluator judges the records it is given: a record that does not validate is evidence of nothing,
  for or against, and an omitted record cannot be seen. The store B24-E builds must refuse an invalid record on write and hand the evaluator
  every record of the claim. RECORDED
- **The five latent paths stay unhardened**; a caller needs section 6's hardening first.
- **No clock.** The evaluator refuses a review dated before the work, but not one dated in the future. RECORDED
- **Equal instants** ([B23-D low round, 2026-10-05]). Every ordering here is "no earlier than": a disposition at the very instant of the
  failure it names, retested at that instant, closes it. Records carry millisecond instants, and which of two records at one instant came
  first is not knowable from them; whether the recording route (B24-E) must refuse such ties is open. RECORDED
- **A removal never relaxes a rule** ([B23-D low round 2, 2026-10-05]). The scraps that remove are chosen before any cross-record rule,
  from each scrap's own verdict, and a final qualification's ordering is read from every raiser and every hardware rework whether or not
  either was removed; so one more removal can only take satisfying records away, never add one. Cases 13-15 execute the instances; the
  general claim is a reading of the code. INFERRED
  [B23-D lead, 2026-10-05] Until the lead round, "each scrap's own verdict" included the duplicate check, a cross-record rule: a dry run sharing a scrap's
  or an identity's id took a removal or a binding back. Case 16 executes those instances now. INFERRED for the general claim
- **A duplicate never takes back what a record imposes** ([B23-D lead, 2026-10-05]). A duplicate id voids what each record carrying it would
  satisfy or close; what a record of the claim imposes by its own rules - the nonconformance a failure raises (low-1), the subject a scrap
  removes, the units an identity binds and counts (case 16) - stands. Read from the code, executed for those three. INFERRED
- **A disposition that does not satisfy holds nothing open by itself** ([B23-D low round 2, 2026-10-05]). It counts against the claim
  only through the ordering (a final qualification must come after it) and through what it raises (a `hardware` one whose result is not
  pass raises itself). An unreviewed scrap of the whole lot, dated before the final qualification and naming a nonconformance no record
  raises, therefore removes nothing and leaves the evidence complete, where an unreviewed failure would hold the claim open. Case 15
  executes the unit form (a fifth unit's scrap without review); the whole-lot form is read from the code. Whether an unresolved
  disposition record must itself hold the claim open is the owner's; B24-E's store would refuse an unreviewed record on write. INFERRED
- **A lot can be counted out with a unit left** ([B23-D low round 2, 2026-10-05]). When a lot identity lists fewer serials than the lot
  holds, scrapping every listed one scraps the lot (case 15); and scraps of serials outside a full listing count toward `lotQuantity`
  (case 15), so a fully listed lot with one listed unit unscrapped is scrapped once an unlisted serial's scrap makes up the count. Both
  read the records against the claim - more refusal, never less - and both are records that disagree with the lot, which the recording
  route (B24-E) must refuse or reconcile. INFERRED
- **The generic runtime pin** `manufacturing-release-gate.test.ts` was not run here (the lead runs it once, deliberately).
  [B23-D lead, 2026-10-05] The lead ran it once, deliberately, on the final tree under the lock (`b23/logs/dlead-release-gate.log`): 5 of
  5 passed, exit 0, 10.7 s, its refusal of `assembled_pcb` included; it asserts the refusal's code, not its message, so the new wording of
  `release-gate.ts:189` moved no pin. It stays in no CI workflow. CONFIRMED
- **B17-E's page** (`artifacts/ai-control-plane-b17/project-history-model.md:37`) still describes the record as B17-E saw it, "out of scope
  until the component-acquisition and assembly chapters B22–B24": a dated history statement, not edited here.

## 14. Citations

As of this working tree on `4e71563` (2026-10-05, after the review round; [B23-D low round, 2026-10-05] C61's line and C62's anchor
re-resolved, C73-C79 added; [B23-D low round 2, 2026-10-05] C75's anchor and C77's line and anchor re-resolved - C77 now on
`removedSubjects`, where the scraps that remove are chosen - and C80 and C81 added; [B23-D lead, 2026-10-05] C75's anchor re-resolved); the anchor text is the check, the line is for the reader; `b23-d-physical-evidence-contract` case 9 checks
every row.

| # | file | line | anchor |
|---|---|---|---|
| C1 | `app/lib/manufacturing-providers/physical-evidence.ts` | 23 | `import { durableWorkflowDigest } from "../durable-workflow/stable";` |
| C2 | `app/lib/manufacturing-providers/physical-evidence.ts` | 27 | `export const PHYSICAL_EVIDENCE_KINDS = Object.freeze(["manufacturer_acceptance", "unit_lot_identity"` |
| C3 | `app/lib/manufacturing-providers/physical-evidence.ts` | 41 | `export const ASSEMBLED_CLAIM_REQUIRED_KINDS = Object.freeze(PHYSICAL_EVIDENCE_KINDS.filter((kind) => kind !== "deviation_rework"));` |
| C4 | `app/lib/manufacturing-providers/physical-evidence.ts` | 119 | `const REF = /^[A-Za-z0-9][A-Za-z0-9_.:/#+-]{0,199}$/;` |
| C5 | `app/lib/manufacturing-providers/physical-evidence.ts` | 126 | `const REVIEW_SHAPED_KEY = /review\|approv\|sign\|attest\|verif/i;` |
| C6 | `app/lib/manufacturing-providers/physical-evidence.ts` | 227 | `// [B23-D] copied once before any read` |
| C7 | `app/lib/manufacturing-providers/physical-evidence.ts` | 267 | `// [B23-D] D23-14's hardening: equipment and operator references are bound and never empty` |
| C8 | `app/lib/manufacturing-providers/physical-evidence.ts` | 311 | `export const PHYSICAL_EVIDENCE_REVIEWER_ROLES = Object.freeze(["project_admin"] as const);` |
| C9 | `app/lib/manufacturing-providers/physical-evidence.ts` | 325 | `export interface PhysicalEvidenceReviewRequest { readonly recordId: string; readonly kind: PhysicalEvidenceKind; readonly recordDigest: string }` |
| C10 | `app/lib/manufacturing-providers/physical-evidence.ts` | 330 | `export const PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING: PhysicalEvidenceReviewPortWiring = "none";` |
| C11 | `app/lib/manufacturing-providers/physical-evidence.ts` | 393 | `if (record.rawArtifacts.length === 0) rejections.push("raw_artifacts_absent");` |
| C12 | `app/lib/manufacturing-providers/physical-evidence.ts` | 394 | `if (record.executionClass !== "hardware") rejections.push("dry_run_class");` |
| C13 | `app/lib/manufacturing-providers/physical-evidence.ts` | 395 | `if (record.result !== "pass") rejections.push("result_not_pass");` |
| C14 | `app/lib/manufacturing-providers/physical-evidence.ts` | 396 | `record.details.disposition === "use_as_is") rejections.push("waiver_disposition");` |
| C15 | `app/lib/manufacturing-providers/physical-evidence.ts` | 400 | `answer = reviewPort(Object.freeze({ recordId: record.recordId, kind: record.kind, recordDigest: digest }));` |
| C16 | `app/lib/manufacturing-providers/physical-evidence.ts` | 355 | `if (answer.reviewedRecordDigest !== digest \|\| Date.parse(answer.reviewedAt) < Date.parse(record.performedAt)) return "review_not_bound";` |
| C17 | `app/lib/manufacturing-providers/physical-evidence.ts` | 356 | `operators.includes(answer.reviewerActorId)) return "review_by_operator";` |
| C18 | `app/lib/manufacturing-providers/physical-evidence.ts` | 454 | `export const ASSEMBLY_DATA_AUTHORITY = "absent" as const;` |
| C19 | `app/lib/manufacturing-providers/physical-evidence.ts` | 461 | `readonly eligible: false;` |
| C20 | `app/lib/manufacturing-providers/physical-evidence.ts` | 484 | `export function assembledProductEligibility(input: { readonly release: PhysicalReleaseBinding;` |
| C21 | `app/lib/engineering/action-registry.ts` | 118 | `action({ id: "manufacturing.assembled-release"` |
| C22 | `app/lib/pcb/fab/release-gate.ts` | 189 | `if (source.releaseMode === "assembled_pcb") fail("MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE", "Assembled release is blocked until both exist: approved MPN, variant, BOM, placement and paste authority, and OD-175 physical evidence with qualified human review.");` |
| C23 | `app/lib/pcb/fab/manufacturing-errors.ts` | 62 | `MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE: { status: 422, message: "Assembled release is not available. It stays blocked until both exist:` |
| C24 | `artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv` | 47 | `manufacturing.assembled-release,1,manufacturing,Release assembled product,destructive,missing,explicitly blocked,,none,fail closed,none,none,release` |
| C25 | `app/api/pcb/qualify/route.ts` | 284 | `releaseMode: "bare_pcb"` |
| C26 | `app/lib/pcb/fab/release-manifest.ts` | 4 | `export type ManufacturingReleaseMode = "bare_pcb" \| "assembled_pcb";` |
| C27 | `app/lib/release-engineering/readiness.ts` | 11 | `export function evaluateReleaseLevels(input: ReleaseAssessmentInputs, manifestRef: string): ReleaseLevelAssessment` |
| C28 | `app/lib/release-engineering/readiness.ts` | 24 | `gates.push(status("EXECUTED_PHYSICAL_PROCESS_QUALITY_EVIDENCE", "production-released", input.physicalProcessEvidenceRefs.length > 0` |
| C29 | `app/lib/release-engineering/readiness.ts` | 25 | `item.role === "production_release_authority" && item.actor.actorKind === "human"` |
| C30 | `app/lib/release-engineering/readiness.ts` | 28 | `export function materializeRelease(` |
| C31 | `app/lib/firmware-bringup/factory.ts` | 5 | `if (input.executionClass === "dry_run" && verdict === "pass") verdict = "indeterminate";` |
| C32 | `app/lib/firmware-bringup/factory.ts` | 5 | `uutIdentityRef: string; stationFixtureInstrumentRefs: string[]; executionClass: "dry_run" \| "hardware" }` |
| C33 | `app/lib/firmware-bringup/factory.ts` | 6 | `export function fitCalibration(input: { contract: CalibrationContract; uutIdentityRef: string;` |
| C34 | `app/lib/full-flow/verdict.ts` | 5 | `problems = relevant.filter((item) => item.state !== "pass" && item.state !== "waived")` |
| C35 | `app/lib/firmware-bringup/types.ts` | 53 | `export interface FactoryTestResult {` |
| C36 | `app/lib/firmware-bringup/types.ts` | 57 | `export interface CalibrationResult {` |
| C37 | `app/lib/release-engineering/types.ts` | 66 | `export interface BuildLotRecord {` |
| C38 | `app/lib/release-engineering/types.ts` | 67 | `export interface PhysicalValidationEvidence {` |
| C39 | `app/lib/release-engineering/types.ts` | 58 | `export interface ScopedException { exceptionId: string; kind: "deviation" \| "waiver";` |
| C40 | `app/lib/engineering/__tests__/b17-a-control-inventory.test.ts` | 63 | `if (record.status === "missing") expect(reached.has(record.id) \|\| routed.has(record.id)` |
| C41 | `artifacts/remaining-builder-program/LIVE_BLOCKERS.md` | 11 | `\| LB-5 \| Physical fabrication, assembly, incoming inspection, functional test \|` |
| C42 | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities.json` | 15 | `"releaseId": "mfg-release-45b3b7efbc85dc3a8ecd233c906384cd",` |
| C43 | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities.json` | 17 | `"archiveSha256": "997664c0b9a87c4d3a65e64eeb90b98159b2ad6ad8806e4ebea748a592ac6dcc",` |
| C44 | `app/lib/workflow/prompt-to-gerber/__tests__/acceptance-pipeline.test.ts` | 421 | `expect({ releaseId: manifestBody.releaseId, filename, archiveSha256: archiveSha, archiveByteLength: bytes.byteLength` |
| C45 | `app/lib/pcb/__tests__/manufacturing-release-gate.test.ts` | 150 | `rejects.toMatchObject({ code: "MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE" });` |
| C46 | `.github/workflows/deterministic-manufacturing.yml` | 228 | `app/lib/manufacturing-providers/__tests__` |
| C47 | `app/lib/pcb/fab/release-gate.ts` | 272 | `"No manufacturer upload/order has been performed. External board-house DFM and physical prototype review remain mandatory.",` |
| C48 | `lib/persistence.ts` | 622 | `export function saveProjectReleaseEngineeringProgram(id: string, releaseEngineeringProgram: ReleaseEngineeringProjectState): boolean {` |
| C49 | `lib/persistence.ts` | 628 | `try { localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(updated)); return true; } catch { return false; }` |
| C50 | `app/lib/manufacturing-providers/physical-evidence.ts` | 115 | `const CONTENT_DIGEST = /^sha256:[0-9a-f]{64}$/;` |
| C51 | `app/lib/manufacturing-providers/physical-evidence.ts` | 121 | `const OPERATOR_REF = /^operator:[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;` |
| C52 | `app/lib/manufacturing-providers/physical-evidence.ts` | 122 | `const EQUIPMENT_REF = /^equipment:[A-Za-z0-9][A-Za-z0-9_.:/#+-]{0,189}$/;` |
| C53 | `app/lib/manufacturing-providers/physical-evidence.ts` | 124 | `const SIRKIT_MINTED_ID = /^mfg-/;` |
| C54 | `app/lib/manufacturing-providers/physical-evidence.ts` | 179 | `problems.push("details.acceptedFilesDigest: the release's archiveSha256");` |
| C55 | `app/lib/manufacturing-providers/physical-evidence.ts` | 309 | `export const PHYSICAL_EVIDENCE_REVIEW_KEYS = Object.freeze(["derivation", "reviewerActorId", "operatorActorIds",` |
| C56 | `app/lib/manufacturing-providers/physical-evidence.ts` | 354 | `operators.length !== record.operatorRefs.length` |
| C57 | `app/lib/manufacturing-providers/physical-evidence.ts` | 386 | `const plain = copied.ok && isRecord(copied.value) ? copied.value : {};` |
| C58 | `app/lib/manufacturing-providers/physical-evidence.ts` | 447 | `return { ok: false, problems: ["input: plain data"], reviewPort };` |
| C59 | `app/lib/manufacturing-providers/physical-evidence.ts` | 504 | `const listed = (serial: string \| null): boolean => identities.length > 0 && identities.every(` |
| C60 | `app/lib/manufacturing-providers/physical-evidence.ts` | 505 | `record.kind === "incoming_inspection" && record.details.inspectedQuantity > lotQuantity` |
| C61 | `app/lib/manufacturing-providers/physical-evidence.ts` | 512 | `const raised = record.nonconformanceRefs.length === 0 && record.executionClass === "hardware" && record.result !== "pass" ? [record.recordId] : record.nonconformanceRefs;` |
| C62 | `app/lib/manufacturing-providers/physical-evidence.ts` | 525 | `const onSubject = actsOn(rework, raisedBy);` |
| C63 | `app/lib/manufacturing-providers/physical-evidence.ts` | 526 | `!raisedBy.some((raiser) => raiser.recordId === id) && Date.parse(retest.performedAt) >= reworkedAt && covers(retest.subject, rework.subject)` |
| C64 | `app/lib/manufacturing-providers/physical-evidence.ts` | 531 | `const settledAt = Math.max(Number.NEGATIVE_INFINITY,` |
| C65 | `app/lib/manufacturing-providers/physical-evidence.ts` | 535 | `return qualifiedAt >= settledAt && verdict.record.details.reliesOnRecordIds.every(` |
| C66 | `app/lib/manufacturing-providers/physical-evidence.ts` | 549 | `export const PHYSICAL_EVIDENCE_RETEST_KINDS = Object.freeze(["incoming_inspection", "continuity_power_on", "functional_test"] as const);` |
| C67 | `app/lib/manufacturing-providers/physical-evidence.ts` | 553 | `const covers = (a: PhysicalEvidenceSubject, b: PhysicalEvidenceSubject): boolean => a.lotId === b.lotId && (a.scope === "lot"` |
| C68 | `app/lib/manufacturing-providers/__tests__/b23-d-latent-claim-paths.test.ts` | 8 | `b14-4-ast-import-gates case 2);` |
| C69 | `app/lib/project/__tests__/b14-4-ast-import-gates.test.ts` | 71 | `it("2. ZERO opaque module loads and ZERO root-escaping imports exist in production"` |
| C70 | `app/lib/manufacturing-providers/provider-observation.ts` | 196 | `mfg-observation-${durableWorkflowDigest(` |
| C71 | `app/lib/manufacturing-providers/outbound-package.ts` | 154 | `mfg-outbound-${manifestSha256}` |
| C72 | `app/lib/manufacturing-providers/exchange-ledger.ts` | 267 | `return durableWorkflowId("mfg-provider-exchange",` |
| C73 | `app/lib/manufacturing-providers/physical-evidence.ts` | 333 | `"subject_mismatch", "subject_scrapped", "raw_artifacts_absent",` |
| C74 | `app/lib/manufacturing-providers/physical-evidence.ts` | 551 | `const outsideClaim = (verdict: PhysicalEvidenceVerdict, record: PhysicalEvidenceRecord, lotId: string): boolean => verdict.rejections.includes("release_mismatch") \|\| record.subject.lotId !== lotId;` |
| C75 | `app/lib/manufacturing-providers/physical-evidence.ts` | 515 | `const kept = withoutScrapped(bound, removedSubjects(judged, identities, lotId));` |
| C76 | `app/lib/manufacturing-providers/physical-evidence.ts` | 562 | `raisedBy.every((raiser) => covers(rework.subject, raiser.subject) && Date.parse(raiser.performedAt) <= Date.parse(rework.performedAt));` |
| C77 | `app/lib/manufacturing-providers/physical-evidence.ts` | 589 | `const scraps = verdicts.flatMap((verdict) => (verdict.satisfies && verdict.record && isScrap(verdict.record) ? [verdict.record.subject] : []));` |
| C78 | `app/lib/manufacturing-providers/physical-evidence.ts` | 564 | `const isScrap = (record: PhysicalEvidenceRecord): boolean => record.kind === "deviation_rework" && record.details.disposition === "scrap";` |
| C79 | `app/lib/manufacturing-providers/physical-evidence.ts` | 575 | `removed.some((subject) => covers(subject, record.subject)) ? withRejection(verdict, "subject_scrapped") : verdict;` |
| C80 | `app/lib/manufacturing-providers/physical-evidence.ts` | 591 | `const noUnitLeft = units.size >= Math.min(...identities.map((identity) => identity.lotQuantity))` |
| C81 | `app/lib/manufacturing-providers/physical-evidence.ts` | 595 | `const reworkInstants = (verdicts: readonly JudgedVerdict[], lotId: string): number[] => verdicts.flatMap((verdict) => (verdict.record?.kind === "deviation_rework" && verdict.record.executionClass === "hardware" && !outsideClaim(verdict, verdict.record, lotId)` |

## 15. The B23 closeout's export record

[B23 closeout (1/2), 2026-10-05] `physical-evidence.ts` is delivered unbound (sections 1-5): no production module imports it and
nothing creates a record. It is recorded whole and not retired; the table is in `closeout-statements.md` section 3, and
`b23-closeout-statements` case 7 pins that it has no production importer. RECORDED

One export in it is named nowhere, not even by a test: `ServerDerivedHumanReview`, the shape a review port's answer takes (section 3).
The reviewed change that wires a port would type the port's answer with it; until then the validator checks the same keys through
`PHYSICAL_EVIDENCE_REVIEW_KEYS`. It is recorded with its module, not retired (PROPOSED for that change).

[B24-D1, 2026-10-09] C46 re-pinned `:227` -> `:228` in place: B24-D1's prompt-to-gerber start step at `:32` (OD-30); `b23-d-physical-evidence-contract` case 9 resolves it.
