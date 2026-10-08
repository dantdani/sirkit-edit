# B21-A — the canonical orchestration contracts, the durable orchestration record, the import gate and CI admission

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. Tree
`chapter/b21-specialist-orchestration`, base `5677b15` (the discovery commit); written 2026-09-24, reviewed and corrected 2026-09-26
(the adversarial review's confirmed findings, section 0). Every `[B21 A]` statement below is pinned by `b21-a-page.test.ts` (citations by
content, vocabularies quoted from the code, suite rows by `it(` count and runtime count) or by the suite it names.

A implements against the provider facts recorded in `provider-reference-notes.md` (OD-118) and touches no provider feature, so no page
was re-read in this increment (the notes' "Re-reads" section is unchanged). No model is called anywhere in A; every suite is offline.

## 0. What A delivers, and what it is not

- `app/lib/agent/orchestration/contracts.ts` — the versioned provider-neutral contracts `sirkit.specialist-request.v1` and
  `sirkit.specialist-result.v1` as plain frozen data with closed key sets, and the two validators (section 1). **CONFIRMED** by
  `b21-a-contracts.test.ts` (14 cases; every case failed before the module existed: `Cannot find module '../contracts'`; the review's
  cases 13 and 14 and the extended cases 1, 6, 7 and 11 failed on the first implementation, `a-fix-failing-first.log`).
- `app/lib/agent/orchestration/store.ts` — the durable orchestration record `agent.orchestration-run.v1` (OD-111; section 5).
  **CONFIRMED** by `b21-a-store.test.ts` (15 cases, in-memory durable repository).
- `app/lib/agent/orchestration/tripwires.ts` — data only: the nine B11-scanned files (the ONLY orchestration module that may name them),
  the identifier pattern none of them may carry, the module prefix. **CONFIRMED** by `b21-a-import-gates.test.ts` case 4.
- The AST import gate over every module under `app/lib/agent/orchestration/` (section 6). **CONFIRMED** by `b21-a-import-gates.test.ts`.
- CI admission (OD-124): one directory filter `app/lib/agent/orchestration/__tests__` in the `prompt-to-gerber` job, the guard's
  `CHAPTERS` extended to `b21-`, a `[B21 A]` guard case. **CONFIRMED** by the guard.
- This page, pinned by `b21-a-page.test.ts`, with the reserved texts written out in section 8.

Closes **D21-1** (no orchestration contracts), **D21-2** (no evidence shape) and **D21-26** (CI admission); closes **D21-3** (no persisted
record) IN PART — the record's structured kinds are persisted, tool calls are NOT persisted by A (section 5); records **D21-25** as LB-9,
**D21-28** (no outbox topic) and **D21-29** (the documentation hosts, OD-118); finds **D21-32** (section 5). The discovery's closure
clauses are in section 8.

**Reviewed (2026-09-26).** The adversarial review of the first implementation confirmed nine findings against the code and the claims;
each is fixed test-first (the reproducing case failed on the first implementation, `a-fix-failing-first.log`, then passed) and stated
where it belongs: (1) three of the four sealed families were refused `forbidden_key_name` because their own top-level authorization
binding is credential-shaped under the shared classifier — the sealers' declared names are now exempt from the NAME check inside a
wrapped artifact, values still scanned, proven against the four REAL sealed artifacts (contracts case 13; section 4); (2) a wrapped
artifact's interior was never scanned — every name and string is now judged at every level (case 14); (3) an id-class field could carry a
provider key — every id is scanned (case 11); (4) a validation request could bind an execution or a view control — the binding is a
closed verifier set (case 7); (5) the idempotency key was not injective across runs when an id carried `:` — the replay partition is per
run (store case 13); (6) a read with a malformed scope threw an internal code — one documented sentence (store case 14); (7) a stored
request or result was bound to no run, task or request — both are bound now (store case 15); (8) a hostile append envelope threw — the
envelope's scalar fields are captured and its record judged on its own, a throw while judging is a refusal (store case 10); (9) the tamper, bound and replay assertions did not isolate the guards they named — they do
(store cases 5, 6, 10; breakage probes in section 7). Two claims were corrected without a code change: tool calls are NOT persisted
(D21-3 closed in part) and no runtime binds the store in A (a stated deviation), both in section 5 and OD-111. Two refusals are
recorded as deliberate fail-closed costs with their pattern sets (section 2, OD-131). The guard citation and the page pin the chapter
list by membership, never verbatim (section 6).

**Not in A** (runbook B21-A; the increment plan §7): no router, no scheduler, no role tool table, no merge, no provider routing, no
trace block, no chat / route / loop / adapter change, no new route, no new exposed tool, no UI. `POST /api/schematic/build-multi`
is untouched: OD-106 scopes it out of the DAG, and the gate tripwires it (section 6). **No generator input changed** — no descriptor,
no route, no UI control — so the route census stays 165 = 162 canonical + 3 factories + 0 raw and every generated artifact (the B04
registry CSVs, the B20 manifests and parity JSON, the B17-A control inventory) is byte-identical; no generator was re-run. **CONFIRMED**
(`git status` at the end of the increment lists only the files named in section 7 and this page).

**Zero authority by construction.** The contracts carry zero authority: a `SpecialistResult` is a proposal-and-evidence object with no standing; nothing in the two modules
mints, applies, binds, qualifies, approves, purchases or releases anything, nothing names a route, the executor, a grant, an approval,
a release, a qualification or the minter (case 12 of the contracts suite and case 12 of the store suite read both files as text), and
the import gate keeps every such module out of the runtime closure. The B18 grants, the B19 evidence rules, B20's OD-45/90/91/92 and
OD-81 stand unchanged: A adds no descriptor, no channel, no request key and no provider call.

## 1. The contracts

Field lists exactly as the runbook's (`discovery.md` §1.1 B21-A), as `interface`s over plain JSON; every array `readonly`.

- **`SPECIALIST_ROLES`** (closed, nine, kebab-case, the runbook's order, C1):
  `coordinator`, `requirements-analyst`, `circuit-topology`, `component-sourcing-evidence`, `schematic`, `pcb-placement-routing`, `verification-critic`, `manufacturing-readiness-reviewer`, `cost-latency-router`.
  A role is added only when its inputs, outputs and tools are distinct and testable (B21-C).
- **`RevisionBoundProjectScope`** `{ tenantId, projectId, branchId, canonicalRevisionDigest, schematicHeadMark?, pcbBasis? }` — the
  head mark is the sealer's own `Tier1ProposalHeadMark` (C29) and the basis the loop's own `PcbProposalBasis` (C28): the one revision
  vocabulary, never a new one (OD-133 wraps the layout candidate in this scope in B21-D).
- **`AgentBudget`** = the six `AgentRunBudget` fields (C27) plus `maxInputTokens` and `maxOutputTokens` — reported, never priced;
  OD-107's DAG wall time is a scheduler cap in B21-B, not a per-specialist field. `AGENT_BUDGET_KEYS` is pinned to
  `Object.keys(DEFAULT_AGENT_BUDGET)` plus the two.
- **`SpecialistRequest`** `{ schema, taskId, role, objective, scope, contextRefs, allowedToolIds, budget, requiredOutputs, deadlineAt }`,
  schema id `sirkit.specialist-request.v1`. `allowedToolIds` follows A4L's list semantics (section 4). `requiredOutputs` is a sorted,
  duplicate-free list over the result's nine content keys (`REQUIRED_OUTPUT_NAMES`). `deadlineAt` is UTC with millisecond precision and
  round-trip exact. `contextRefs` are `{ id, digest }` pairs (the read-resource envelopes' digests; B21-B fills them).
- **`SpecialistResult`** `{ schema, role, summary, proposedActions, assumptions, evidence, requiredTools, risks, unresolvedQuestions,
  validationRequests, confidence }`, schema id `sirkit.specialist-result.v1`.
  - **`ProposedAction`** — a discriminated union over the four sealed artifact kinds, by their LIVE schema ids (pinned to the sealers'
    constants by the suite): `sirkit.schematic-tier1-proposal.v3`, `sirkit.schematic-replacement-proposal.v2`,
    `sirkit.pcb-bounded-edit-proposal.v2`, `sirkit.layout-candidate.v1`; `{ kind, payload, artifactDigest }` with the payload VERBATIM
    (`OpaqueArtifactPayload`: the sealer's structure, bound by the digest; its key names and strings are judged at every level, the
    sealers' three declared names exempt from the NAME check only — section 4) and `artifactDigest = engineeringDigest(payload)` recomputed
    on validation. The four REAL sealed artifacts, produced by their production sealers, validate wrapped verbatim (case 13). A verifies
    names, strings, structure and digest; B21-D runs each family's own integrity and currency verifiers.
    [B21 D2, 2026-09-26] Since B21-D2 a result's `proposedActions` are exactly the artifacts its own run's gateway sealed: the scheduler attaches them (wrapped as here, the digest recomputed) and refuses any other entry the model wrote before the merge (`specialist-proposals.md`).
  - **`EvidenceReference`** `{ kind, id, digest, sourceClass, extractionMethod?, reviewed }` with `kind` one of `readiness-report`,
    `qualification-authority`, `atomic-evidence`, `resource-envelope`, `trace-event`; `sourceClass` the atomic catalog's `SourceClass`
    union (C33, twelve members, pinned to that union as text) plus `deterministic_verifier`, the one class only an in-process verifier
    produces; `extractionMethod` the atomic `ExtractionMethod` union exactly. What a class may PROVE is B21-D's rule; here every class is
    a closed vocabulary member and `reviewed` a flag (the B19 rules stand: sourcing never proves engineering; unreviewed
    `llm_suggestion` / `ocr_extraction` / `external_mcp_tool` evidence is quarantined). This closes D21-2's "no provider-neutral shape".
  - **`ToolRequest`** `{ toolId, version, reason }`, **`Assumption`** `{ id, statement, evidenceIds }`, **`StructuredRisk`**
    `{ id, severity, statement, mitigation }` (`severity` low / medium / high; `mitigation` a bounded text or null),
    **`StructuredQuestion`** `{ id, question, blocking }`, **`ValidationRequest`** `{ bindingToolId, baseRevision }` — closed typed records
    with bounded strings; `bindingToolId` is one of the five deterministic verifiers (`VALIDATION_BINDING_TOOL_IDS`, section 4);
    `confidence` the closed triple `low` / `medium` / `high`.
- **Ids.** Every id-class field (a task, scope, lineage, preset, context, evidence, assumption, risk or question id, an evidence id
  entry, a tool version) obeys the grammar `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` AND is scanned for a credential-shaped value
  (`secret_shaped_text`, C48): the grammar admits a provider key's characters, so `isOrchestrationId` is the grammar and the scan together.
- **The validated snapshot.** `validateSpecialistRequest` / `validateSpecialistResult` return `{ ok: true, value, digest }` where `value`
  is an INDEPENDENT deep-frozen plain-JSON snapshot produced by `capturePlainJson` (C7, C21) — registered in the capture's ownership
  registry (`isOwnedCapture`) and in the module's validated registry (`validatedDigestOf(value)` answers `{ schema, digest }` for it and
  null for the caller's object, a `structuredClone`, or anything else). The types `ValidatedSpecialistRequest` /
  `ValidatedSpecialistResult` are branded, so the durable record accepts nothing else by type; the store checks the registry at run time too.
- **Digests.** The whole-body digest is `engineeringDigest({ schema, body })` over the captured snapshot (C8): reproducible for the same
  document, different for any moved field, and equal to the same expression over the caller's plain object (so a caller can predict it).

## 2. The refusal vocabulary (29 refusals) and the order of judgement

The validators return exactly one closed refusal `{ ok: false, refusal, path }` and never throw on hostile input (case 10: an accessor,
a throwing or revoked Proxy, a `toJSON` hook — never invoked — a class instance, a symbol key, a non-enumerable property, a cycle, a sparse
array, an own `__proto__` key, and every non-object primitive). The order is fixed, and it is what makes "closed key sets checked BEFORE
any digest" true: **capture** → **root** → **schema** → **closed key set and key-name denylist** (per object, in key order: a forbidden
name first, then an unknown name, then a missing required name) → **bounded scalars and vocabularies** (in field order; a wrapped
artifact walked in full, names and strings, in key order) → **digests**.

| refusal | when |
|---|---|
| `not_captured` | the capture refused the document: an accessor, hook, proxy, symbol key, foreign prototype, cycle, sparse array, undefined, function, bigint, an oversized string (100 000 characters, the capture's bound), depth, node count, or a document over 1 000 000 serialized characters. The path is the capture's label |
| `not_an_object` | the captured root is not a plain object (`$`) |
| `missing_key` / `schema_mismatch` | no `schema` key, or a `schema` other than the validator's (`$.schema`) |
| `unknown_key` | a key outside the closed set, at any level the types name (a wrapped artifact's shape is the sealer's, section 4) |
| `forbidden_key_name` | a key that is one of the ten capsule keys, reasoning-shaped, or credential-shaped (section 3) at any level the types name; inside a wrapped artifact, a reasoning-shaped or credential-shaped name at ANY level (the three declared names excepted) and a capsule key at its top level; also a `requiredOutputs` entry with such a name |
| `invalid_type` | a value of the wrong shape (an array for a record, a record for a list, a non-string text, a non-boolean flag, a non-null non-string label) |
| `invalid_integer` | a budget field, `headSequence` or `historyHeadSequence` that is not a non-negative safe integer |
| `invalid_id` | an id outside `^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$` (task, scope, lineage, preset, evidence, assumption, risk, question ids; a `ToolRequest.version`); an id INSIDE the grammar that is credential-shaped refuses `secret_shaped_text` instead |
| `invalid_digest` | a digest outside `^eng1-[0-9a-f]{16}$` (a revision, a state, a context, an evidence or an artifact digest, a `baseRevision`) |
| `invalid_timestamp` | `deadlineAt` not `YYYY-MM-DDTHH:mm:ss.sssZ`, or not round-trip exact (`2026-13-40...` and an offset both refuse) |
| `text_too_long` | `summary` over 4 000 characters; any other text over 1 000 characters (a wrapped artifact's strings are bounded by the capture only) |
| `invalid_text` | a control, format or line-separator character in a text or in any string of a wrapped artifact (LF and TAB allowed). EVERY `\p{Cf}` character refuses — a bidirectional override, a zero-width character, and also a soft hyphen (U+00AD, common in copied datasheet text) or a zero-width joiner (U+200D): the whole result is refused, never sanitized — a deliberate fail-closed default with a recorded availability cost (OD-131; case 6 pins both) |
| `secret_shaped_text` | a credential-shaped VALUE in any text, any id, or any string of a wrapped artifact, under the shared diagnostic pattern set with the `sk-` prefixes token-anchored (`containsTokenAnchoredSecretShapedText`): `sk-…` / `sk-ant-…` at a token start, `Bearer …`, `api_key: …` / `authorization: …` / `secret: …` / `password: …` / `credential: …` / `access_token: …` (a key word, `:` or `=`, a value), a `NAME=value` dump (`[A-Z][A-Z0-9_]{3,}=` and 12+ value characters), a URL with userinfo, a JSON-quoted credential field. The set is the diagnostics' and therefore over-refuses benign engineering prose: `set R1_VALUE=10k-ohm-0603 on the timer`, `the secret: R1 sets the timing constant`, `password: none is required for the debug header`, `DRC_PRESET=default-preset-v2 was applied` and `SPI_MODE=CPOL0_CPHA0_MSB_FIRST` are refused (case 6 pins each), while `netlist proof: VCC_3V3 unchanged`, `R1=10k`, a digest, `value: 4k7 on R1` and `the desk-lamp-controller net is unchanged` pass. A result is persisted, so a secret never enters it — the whole result is refused, never redacted (the fail-closed default the owner may revisit, OD-131) This reaches the sealers' own prose fields inside a wrapped artifact too (`provenance.instruction`, `provenance.note`, a PCB proposal's `intent`): a REAL proposal whose instruction carries a `NAME=value` phrase, a `password:` prefix or a format character is refused whole with its result - the same fail-closed default, recorded here and in OD-131 [lead, 2026-09-26]. |
| `array_too_long` | more than 32 entries in any list |
| `list_not_sorted` | `requiredOutputs` not strictly ascending (a duplicate is unsorted) |
| `unknown_role` / `invalid_confidence` / `invalid_severity` / `unknown_evidence_kind` / `unknown_source_class` / `unknown_extraction_method` / `unknown_required_output` | a string outside its closed vocabulary |
| `allowed_tool_ids_invalid` | the WHOLE request, for any malformation of `allowedToolIds` (section 4) |
| `tool_request_not_permitted` | a `ToolRequest.toolId` or `ValidationRequest.bindingToolId` outside the reviewed exposure list or matching a never-exposed pattern (section 4) |
| `validation_binding_not_permitted` | a `ValidationRequest.bindingToolId` that passes the structural gate but is not one of the five deterministic verifiers `VALIDATION_BINDING_TOOL_IDS` (section 4): an execution, a view-session control, an external read or a proposal tool is never a deterministic verification |
| `action_kind_unknown` / `action_schema_mismatch` / `artifact_digest_mismatch` | a proposed action outside the four kinds; a payload whose own `schema` is not the kind; a digest that is not `engineeringDigest(payload)` |

Paths are `$`-rooted with `.key` and `[index]` segments; every key name in a path goes through the shared `redactPathSegment`, so a
credential-shaped name collapses to `[redacted-key]` and never reaches a diagnostic (`$.proposedActions[0].payload.[redacted-key]`,
`$.proposedActions[0].payload.operations[0].[redacted-key]`).

## 3. The key-name denylist

`isForbiddenOrchestrationKeyName(name)` (C11) is true, case- and separator-folded, for: the capsule denylist's ten EXACT keys spelled as
data (OD-131) — `state`, `response`, `request`, `body`, `headers`, `client`, `sdk`, `openai`, `anthropic`, `token` (C3; the capsule's
own list at C20) — a folded name containing one of the reasoning-shaped stems `reasoning`, `thinking`, `continuation`, `chainofthought`
(C4; no chain of thought is ever stored, runbook :801; the shared classifier's own stems at C22), and every name the shared credential
classifier `isCredentialShapedName` refuses (C23: `apiKey`, `Authorization`, `clientSecret`, `refresh_token`, `providerClient`,
`rawSdkPayload`, `encrypted_content`, `clientId`, …). It is applied to EVERY key at every level the types name, before any digest is
looked at. Inside a wrapped artifact the artifact rule `isForbiddenSealedArtifactKeyName(name, depth, underDeclaredParent)` (C47)
applies instead (section 4): the reasoning stems at every level; the capsule's exact keys at every level except `state` below the top
level (a real bounded-edit impact certificate carries `readiness.state`, and no sealer emits any other capsule key anywhere — case 13
measures it); the credential classifier at every level except for one of the sealers' three declared names where the sealers put it —
at the artifact's top level, or directly inside a declared parent (`authorization.authorizationSchema`,
`authorizationBinding.authorizationSchema`) — so a declared name under an operation or an impact record is judged like any other
[lead correction 2026-09-26: the review's rule exempted a declared name at any depth and applied the capsule keys at the top level only].
A payload carrying `reasoning` with a correct `artifactDigest`, at its top level or three levels down, is still refused by name. Legitimate names pass: `tokens`, `maxInputTokens`, `inputTokens`, `canonicalStateDigest`, `statement`,
`requiredOutputs`, `validationRequests`, `proposedActions`, `artifactDigest`.

The consequence for a stored record, stated exactly: the record's OWN keys and every typed record (a plan, a decision, a dissent, a
request, a result's own fields) are capsule-clean and can ride in a replay capsule without tripping the capsule's key gate (D21-27's record
hygiene; OD-131); a wrapped artifact's interior is exempt from the capsule's `state` key only, by design (a real bounded-edit impact
certificate carries `readiness.state`, case 13), and refuses the other nine capsule keys at every level (case 14); the interior stays
the capsule's concern the day a capsule embeds an artifact — today's capsule has closed keys and embeds none. [Review correction: the
earlier sentence generalised the hygiene to the whole stored document; lead correction 2026-09-26: the interior was exempt from every
capsule key below the top level.]

## 4. The digest rule, the wrapped artifact and the tool-request gate

- **The wrapped artifact (review correction).** A `ProposedAction.payload` is the sealed artifact verbatim, and it is WALKED IN FULL
  (`sealedArtifact`, C9): every key name at every level through the artifact rule (C47) and every string through the value rules — no
  control or format character (`invalid_text`), no credential-shaped value (`secret_shaped_text`) — in key order and before the digest,
  so a hidden `reasoning` key, an `apiKey` three levels down, an `sk-` string inside an operation or a bidirectional override inside a
  note each refuse with its redacted path (case 14). Its SHAPE is the sealer's: unknown keys are not judged there (the family's closed
  key set is B21-D's verifier), `state` below the top level is accepted (a real certificate carries it), and the whole is bound by
  `artifactDigest = engineeringDigest(payload)` recomputed over the captured payload (C6) — the same function the sealers and the durable
  stores use — with any disagreement refused. Whole-body digests for both documents (C8) bind everything else.
- **The declared names (review correction).** The first implementation judged a payload's top-level names with the full classifier and
  therefore refused THREE of the four real families: `SealedTier1Proposal.authorization`, `SealedReplacementProposal.authorization` and
  `SealedPcbEditProposal.authorizationBinding` are credential-shaped under the shared classifier (`authorization` is in its exact set and
  its stems), although each is a closed authorization BINDING — the verified principal and the membership revision its role was resolved
  at, sealed for apply-time reauthorization — never a credential. `SEALED_ARTIFACT_DECLARED_NAMES` (C43) = `authorization`,
  `authorizationBinding`, `authorizationSchema` (the bindings' own schema field) is the closed set of names the sealers declare that the
  classifier would refuse: inside a wrapped artifact only, a declared name is exempt from the NAME check while its value is still scanned
  (the B11.3 rule for descriptor-declared names, C36); outside a wrapped artifact the names stay forbidden. The set is pinned to the REAL
  sealed artifacts: case 13 seals one artifact per family through its production sealer (`sealTier1Proposal`,
  `assembleReplacementProposal`, `createSealedPcbEditProposal`, `produceRoutingCandidate`; `_sealed-artifacts.ts`), wraps each verbatim,
  and asserts that the credential- or reasoning-shaped names found at any level of the four are EXACTLY the declared set — a newly declared
  credential-shaped name or a stale exemption fails there. The sealers' declared names are exempt from the NAME check only; their values are still scanned.
- **The structural gate (D21-1).** `isPermittedOrchestrationToolId` (C5): an id is permitted only when it is in
  `INTENTIONAL_AGENT_EXPOSED_TOOL_IDS` (C24, the one reviewed 33-id list) [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): 36 since B22-B] AND matches none of `NEVER_EXPOSED_TOOL_PATTERNS` (C25:
  `.release`, `qualif`, the canonical replay primitive, the unreviewed canonical mutations, atomic authority, publication review). A
  `ToolRequest` or a `ValidationRequest` naming `sirkit.manufacturing.release`, `sirkit.pcb.qualify`, a never-exposed canonical
  mutation, an atomic authority command, an id outside the 33 [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): the exposure list, 36 since B22-B] or a malformed id refuses `tool_request_not_permitted` whatever the rest
  of the document says — a result naming a release never validates, whatever its confidence or evidence. Every one of the 33 [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): 36 since B22-B] is accepted
  as a tool request.
- **The verifier set (review correction).** A validation request is a DETERMINISTIC verification B21-D runs by binding id with no model,
  so `bindingToolId` is closed to `VALIDATION_BINDING_TOOL_IDS` (C44): `sirkit.manufacturing.readiness-inspect`,
  `sirkit.pcb.revision-inspect`, `sirkit.project.canonical-revision-inspect`, `sirkit.validation.connectivity-verify`,
  `sirkit.validation.drc-run` — the two validators, the readiness report and the two revision inspections, every one in the 33. The six
  granted executions, the six view-session controls, the two external reads and the proposal tools [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): and B22-B's three named computation reads] refuse `validation_binding_not_permitted`
  (case 7 pins every one of the 33 [superseded 2026-10-02 by the B22 closeout (D22-16, OD-139): 36 since B22-B] either way). Parity, the canonical validator and the netlist proof have no exposed id today; widening the
  set is a reviewed pin move in B21-D.
- **`allowedToolIds` (A4L).** Required, sorted (strictly ascending by code unit), duplicate-free, at most 32, every id permitted by the
  same gate; an unsorted, duplicated, over-long, unexposed, never-exposed, non-string or non-array list admits nothing — the WHOLE
  request is refused `allowed_tool_ids_invalid` (C10). An empty list is a valid tool-less request. B21-C intersects this list with the
  run toolset after every existing gate (OD-121: it can only narrow).

## 5. The durable record `agent.orchestration-run.v1` (OD-111)

- **Aggregate and key.** One durable-workflow aggregate `agent.orchestration-run.v1` (C12) per coordinator run, scoped by
  tenant/project/branch (the durable scope) and keyed by the run id through `durableWorkflowId("agent-orchestration-run", { tenantId,
  projectId, branchId, runId })` (C18), as the autonomy store keys its aggregate. The record schema is `sirkit.orchestration-run-record.v1`.
- **Records.** A closed payload `{ schema, runId, taskId, attempt, revision, at, record }` whose `record` is one of the five kinds
  `plan`, `request`, `result`, `decision`, `dissent`: a plan `{ tasks: [{ taskId, role }] ≤ 32, reason }`; a request or result stored as
  the VALIDATED, frozen snapshot plus its schema and whole-body digest — the store refuses anything else as `unvalidated_document` (C17:
  identity in the validated registry, not shape; a clone or the caller's object is refused); a decision or dissent
  `{ decision, reason, subjectDigest }` with the closed vocabulary `accepted`, `stale`, `contradicted`, `expired`, `malformed`, `escalated`
  (C19; OD-114's vocabulary, produced by B21-D) and a bounded, control-free, secret-free reason. Every other malformation is
  `invalid_record` with its path; the three store refusals are `stale_revision`, `unvalidated_document`, `invalid_record`.
  **Tool calls are NOT persisted** by A: no record kind carries a call, a tool id, an argument digest or an outcome; the runbook's
  persistence list (:801) names calls, and their carrier is B21-E's per-task trace record on the trace attribution (OD-112) — until then an
  auditor or a resume cannot recover a specialist's invocations from this record (D21-3 is closed IN PART; review correction). [B21 E2b,
  2026-09-27] The carrier exists since B21-E2 (2/2): each specialist task's calls are on its own per-task trace record
  (`agent.orchestration-trace.v1`, beside this aggregate on the same repository; `run-events-and-trace.md` 3.5); this record is unchanged.
- **Bound to the run (review correction).** A stored `request` must name the task and the scope it is appended under (`document.taskId`
  = the append's `taskId`, `document.scope.{tenantId, projectId, branchId}` = the run scope; C49 — `$.record.document.taskId` /
  `$.record.document.scope` otherwise); a stored `result` answers exactly one request of THIS run — the latest `request` record of the same
  task attempt, whose role it must carry — and rides with `requestDigest`, that request's whole-body digest (C50); a result with no such
  request, under another attempt, another task or another run, refuses `invalid_record` at `$.record.document` before anything is written
  (store case 15). The validated registry is process-global, so without the binding any validated snapshot could have been recorded as
  any run's.
- **CAS and idempotency.** Every accepted write is one commit on the aggregate with `expectedRevision` (a concurrent writer is refused
  `stale_revision` with the current revision, never a guess) under the idempotency key `orchestration:<runId>:<taskId>:<attempt>:<kind>`
  (C13) — the task attempt's identity `orchestration:<runId>:<taskId>:<attempt>` (the runbook's key) with the record kind as its last
  segment, because one attempt writes its request, then its result, then a decision, and each must be its own idempotent write; e.g.
  `orchestration:run-1:task-1:0:request`. A replay returns the FIRST commit's result (its revision and digest) and writes nothing (C30),
  whatever the retried write says — so a provider outage or a retried scheduler step never duplicates committed work (D21-4's store half).
  **The replay partition is per run (review correction):** the commit's scope key is `orchestrationReplayScopeKey(scope)` =
  `durableScopeKey(scope, ` `agent-orchestration:<runId>` `)` (C45), because an id may carry `:` (the grammar admits it; the codebase's
  own `kind:hex` ids do) and the key text alone is then not injective across runs — `run` + `t:0` and `run:t` + `0` build one key, and
  under a run-independent partition the second run's write silently replayed the first run's commit and wrote nothing. Store case 13 proves
  the two runs are two commits and only a retry of the same run replays.
- **Digest-verified load.** `revision(scope)` verifies the HEAD record and `history(scope)` the whole chain: both recompute the record
  digest `engineeringDigest({ schema: "agent.orchestration-run.v1", payload })` and, for a request or result, the document's whole-body
  digest, and verify the aggregate type and key, the durable scope, the run id and the record schema; `history` also verifies a contiguous
  revision sequence (a rewritten non-head record or a dropped first record is visible to `history`, not to `revision` — by design, as the
  autonomy store's head read). Any disagreement throws `AGENT_ORCHESTRATION_RECORD_MISMATCH` (C14), as the autonomy store's
  `AGENT_AUTONOMY_RECORD_MISMATCH` does (C26); store case 5 isolates each guard (a rewritten scope only, a rewritten aggregate key only, a
  rewritten stored-document digest, schema or run id with the record digest recomputed). `history` is the append-only audit and replay read,
  in revision order. A malformed scope on either read — an empty id, an id with a space, a credential-shaped id, a non-object, a revoked
  Proxy — throws the one documented sentence `AGENT_ORCHESTRATION_SCOPE_INVALID` (C46; store case 14), never an internal code; the same
  scope on a write is a closed `invalid_record`. An append's ENVELOPE is read through its own data-property descriptors only and its
  scalar fields captured as plain data (C51): a revoked-Proxy scope or an accessor on the task id is `invalid_record` at its path and the
  accessor never runs; a plan, decision or dissent record is captured whole; a request or result record is judged by its kind and its
  own keys (symbols included; a foreign prototype refuses) and its document is taken by IDENTITY - never re-captured, so a snapshot
  that validated at the contracts' bounds is never refused here for sitting two levels deeper, and no append deep-copies it; a throw
  anywhere while judging (a stateful or throwing Proxy trap, a revoked Proxy) is the closed `invalid_record`, never an escape (store
  case 10) [lead correction 2026-09-26: the review captured the whole envelope, document included, and two reflective reads after the
  capture could still throw]. **One throw on the write path, by design:** a `result` append reads the run's chain (`history`) to bind the
  request it answers, so on a store whose chain fails verification it throws `AGENT_ORCHESTRATION_RECORD_MISMATCH` before anything is
  written (store case 5) - nothing is ever written onto a chain that fails verification; the stale path's `revision()` read throws the
  same way.
- **No outbox** (D21-28). Every commit carries `outbox: []` (C15) and no event type or topic exists: the production handler map is fixed
  and a handler-less topic is terminal on first dispatch, so the store emits nothing to dispatch. **CONFIRMED** by store case 8 (a commit spy).
- **The repository is INJECTED; the production binding is the composition root's (D21-32).** `store.ts` takes a
  `DurableWorkflowRepository` and imports only the substrate's pure modules (`durable-workflow/stable`, `durable-workflow/types`). It
  never imports `durable-workflow/runtime`, because that module's production path (C31, C32) reaches the OpenAI SDK through the database
  schema: `app/lib/durable-workflow/runtime.ts -> app/lib/durable-workflow/server-repository.ts -> app/lib/db/schema.ts ->
  app/lib/embeddings.ts -> openai` (C31, C34, C35; gate case 3 proves the chain from an injected probe). The autonomy store carries the
  same closure today without a gate; an orchestration module gated against provider SDKs cannot. So the composition seam
  (`resolveOrchestrationRunStore` / `setOrchestrationRunStoreFactory` / `resetOrchestrationRunStoreFactory`) defaults to the UNAVAILABLE
  store: every call fails closed with `AGENT_ORCHESTRATION_STORE_UNAVAILABLE` (C16), resolve never throws, and B21-B's one runtime file
  under the chat route (`app/api/chat/orchestration-runtime.ts`, the pattern of the four `*-runtime.ts` files) binds the production
  repository — under the fixture runtime the in-memory one the dev server hosts (C32), in production the PostgreSQL one — so that
  without a database the store stays UNAVAILABLE and every caller fails closed, the autonomy store's rule. The DDL is generic over the
  aggregate type (the `aggregate_type` column; the in-memory and PostgreSQL repositories key on it), so no migration is needed: the stop
  condition did not trigger. **CONFIRMED** (repository read; store case 11; gate cases 2 and 3).
  **Stated deviation (review correction):** the task required "under the fixture runtime the repository is the in-memory one"; A does not
  deliver that binding — no runtime binds the store in A, every runtime resolves the UNAVAILABLE store, and nothing in the tree calls it
  yet. The deferral rests on D21-32 (a gate conflict the task's stop-condition list did not name). The lead decides: accept the deferral
  to B21-B's runtime file (recorded here, in OD-111 and in the ledger paragraph), or have the binder added now OUTSIDE the gated prefix
  (a production factory `new DurableOrchestrationRunStore(getDurableWorkflowRepository())`, a test setter, a reset, a never-throwing
  resolve, with a case proving the fixture runtime yields the in-memory repository — the gate stays green because it walks the
  orchestration modules' imports, not who imports them). [superseded 2026-09-29 by the B21 closeout (D21-27, OD-113): closed by B21-B in its runtime file, as deferred: `app/api/chat/orchestration-runtime.ts` binds the production repository - the in-memory one under the fixture runtime, B's route case 7; `task-complexity-router.md` sections 0 and 4]
- **Retention — RECORDED, not implemented.** OD-111's default: an explicit setting defaulting to the grant retention. Today the
  durable-workflow substrate purges nothing for any aggregate (no purge exists in `app/lib/durable-workflow/` or `app/lib/execution-grant/`
  — grep, CONFIRMED); execution grants EXPIRE (`GRANT_PREVIEW_TTL_MS` 10 min, `GRANT_EXPLICIT_TTL_MS` 60 s, C37) but their records remain
  — so "the grant retention" is today "kept until an owner-decided purge exists", and that is what the orchestration record inherits.
  Purge and access audit are deferred to the owner and stated here. **Who reads it (review correction):** in B21 the record is
  server-internal — the scheduler (B21-B) and the merge (B21-D) read it through the store; no route and no MCP read tool exposes it, because
  the chapter adds no route (the census stays 165/162/3/0) and no B21 increment plans one. Member access with `read_project` is a follow-up
  OUTSIDE B21, named in OD-111 (a route is a census move; an MCP or agent read tool under the reviewed lists is a pin move per D21-9).
  **UNKNOWN**: the owner's retention duration.

## 6. The import gate and CI admission

- **Entry set** — every production file under `app/lib/agent/orchestration/`, DERIVED from the tree and pinned to the three modules of
  this increment (a fourth module joins the gate the day it is written and moves the pin visibly). **Families by PREFIX** (B20-D3's
  reason: an exact list is complete only today; C38 is the gate this one mirrors): GRANTS `app/lib/execution-grant/`, REAUTH
  `app/lib/project/membership-reauthorization`, APPROVALS `app/lib/engineering/approved-` and `app/lib/engineering/agent-execution-journal`
  (the nine files, three `-idb` journals included), RELEASE `app/lib/pcb/fab/` with NO preset exemption (no orchestration module
  consumes a fab preset), EXECUTOR `app/lib/engineering/executor.ts`, BUILD_MULTI `app/api/schematic/build-multi/` (its own family, judged
  before API — OD-106's tripwire), BUILD_LOOP `app/lib/build-loop.ts`, API `app/api/`, and a provider SDK by bare specifier (`openai`,
  `@anthropic-ai/sdk`, any subpath) found on any closure member's VALUE imports — the closure walk never follows a bare specifier, so the
  SDK check reads each member's references. Case 1 proves every family resolves to real files today (no vacuous case) and RECORDS the
  five SDK importers of the whole tree (`adapters.ts`, `embeddings.ts`, the two LLM providers, `parts-search.ts`). [B24-B3, 2026-10-08] Six since B24-B3: + `app/lib/evaluation/live-contract-clients.ts`, the record-only command's maxRetries-0 contract-turn clients; case 1's pin moved in place (OD-125, OD-216).
- **The walk** is `importClosure` (the B20 helper: static imports, re-exports, import-equals, dynamic imports and requires with static
  strings; case-folded resolution). **A type-only import is erased at run time and is deliberately NOT caught** (case 3 proves it, as
  B20-D3 does); every probe is an injected in-memory file under the orchestration prefix, never a file on disk, one per family plus a
  two-hop bridge, a re-export, a case-variant specifier, a bare side-effect import, the SDK by static import / dynamic import / require /
  re-export, and the durable runtime with the D21-32 chain. Hygiene (case 5): no opaque load, no loader shadow, no root escape, zero
  parse diagnostics.
- **The nine B11-scanned files** — `app/lib/agent/trace.ts`, `app/lib/agent/trace-recorder.ts`, `app/lib/agent/replay-capsule.ts`,
  `app/lib/agent/replay-context.ts`, `app/lib/agent/evaluation.ts`, `app/lib/agent/evaluation-cases.ts`,
  `app/lib/agent/pcb-shape-projection.ts`, `app/lib/agent/pcb-shape-types.ts`, `app/lib/agent/generated/pcb-shape-descriptor.ts`
  (`tripwires.ts`, C41/C42, is the only orchestration module that may spell them) — import nothing under the prefix by
  ANY reference kind (here a type-only import DOES count: no orchestration identifier may enter them, D21-27, OD-113) and carry no
  orchestration identifier (`orchestrat`, `specialist`, `coordinator`, `spawnAgent`, `multiAgent`, any case); the B11 and B20
  tripwires and the provider literal stay verbatim and green.
- **CI admission (OD-124).** The `prompt-to-gerber` job's positional list gains ONE directory filter `app/lib/agent/orchestration/__tests__`
  (C39, next to `app/lib/mcp`); the guard's `CHAPTERS` contains `b21-` (C40 anchors the line's HEAD `const CHAPTERS = [`, and the page
  case pins the list's membership, never its exact spelling, so the next chapter's admission — extending it to `b22-`, exactly what A did
  to the B20 line — moves nothing in this closed increment; review correction); the `[B21 A]` guard case proves every `b21-`
  suite is selected by exactly one filter of that job, none starts PGlite, no explicit entry under the directory is listed (the existing
  redundancy rule would refuse it) and no B21 suite lives under `app/lib/engineering/__tests__` (benchmark-core would run it twice).

## 7. Suites and case counts

[B21 E2b lead, 2026-09-27] Case 15 added: the specialist documents' text rule also refuses a LONE surrogate (`\p{Cs}`) - an
escaped `\ud800` in a result-tool call becomes one after `JSON.parse`, and a Postgres jsonb commit of the orchestration record refuses
it - while a paired astral character stays text (the check's residual of B21-E2 (2/2); the case failed first on the unchanged rule).

| suite | `it(` blocks | runtime tests |
|---|---|---|
| `app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts` | 15 | 15 |
| `app/lib/agent/orchestration/__tests__/b21-a-store.test.ts` | 15 | 15 |
| `app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts` | 7 | 7 |
| `app/lib/agent/orchestration/__tests__/b21-a-page.test.ts` | 6 | 6 |
| `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 8 | 8 + 1 per chapter |

[B21 C] The gate suite gained case 6 (role-tools.ts joins the entry set; the three pins of cases 1, 3 and 5 moved from five modules
to six, `specialist-roles.md` section 6); B21-B had moved them from three to five the same way. [B21 D] The gate suite gained case 7
(merge.ts joins the entry set; the same three pins moved from six modules to seven, `merge-and-disagreement.md` section 7).

The guard's `it.each(CHAPTERS)` adds one runtime test per chapter of its list, so a run prints 8 + 3 = 11 tests today (`b19-`, `b20-`,
`b21-`) for its 8 `it(` blocks ([SEC-1, 2026-10-01] 7 and 10 until SEC-1 added its explicit-entry case; [B22-A1, 2026-10-01] 8 + 4 = 12 since B22-A1 admitted `b22-`, no `it(` added; [B23-A1, 2026-10-02] 8 + 5 = 13 since B23-A1 admitted `b23-`, no `it(` added); the page case computes the `it(` count and the rule from the source and pins the rule as a FORMULA, never
today's total, so the next chapter's admission (`b22-`, an eleventh test) moves nothing in this closed increment (review correction: the
earlier row said 7 against runs printing 10, and a first correction pinned 10, which the `b22-` probe below showed would break here).

Shared fixtures: `app/lib/agent/orchestration/__tests__/_fixtures.ts` (valid documents built fresh per call; digests computed with the
production `engineeringDigest`, never pasted) and `_sealed-artifacts.ts` (the four REAL sealed artifacts through their production sealers,
review). Files of the increment: the three modules, the four suites and the two fixtures, this page, the workflow filter line and the
guard (`CHAPTERS` and one case). Test-first: the contracts suite was adopted from an interrupted implementer and reviewed — its case 12
forbade the spellings `route` and `qualif` that the runbook's own role id `cost-latency-router` and evidence kind `qualification-authority`
contain, so it now scrubs the quoted vocabularies first; its refusal vocabulary gained `secret_shaped_text` (a persisted result must never
carry a credential-shaped value); its case 1 gained the pins for the source classes (to the atomic union as text), the extraction methods,
the severities, the budget keys and the required-output names. Every case of every suite failed before the code: the four orchestration
suites at import (`Cannot find module '../contracts'` / `'../tripwires'`), the two guard cases on the absent filter; the run is recorded
in the ledger paragraph (section 8).

**The review's test-first evidence (2026-09-26, `a-fix-failing-first.log`, on the first implementation):** contracts 5 of 14 failed
(1: `VALIDATION_BINDING_TOOL_IDS` undefined; 7: the binding set; 11: a key-shaped task id accepted; 13: the replacement fixture, then
the real families; 14: every interior probe accepted), store 9 of 15 failed (1, 2, 8, 13: `orchestrationReplayScopeKey` undefined; 7:
no `requestDigest`; 10: a key-shaped plan task id accepted, then the envelope; 12: no scope sentence; 14: `invalid_record` thrown; 15: a
foreign request accepted), page 5 of 6 failed (2: C40 anchored on the members; 3, 4, 5, 6: the corrected statements absent). Then green
(`a-fix-green.log`). Test-strength findings were proven by BREAKAGE PROBES against the fixed source, each restored and hash-verified
(`a-fix-probe-*.log`): deleting the durable-scope comparison of the load fails only the `durable scope only` row; deleting the
stored-document digest re-check fails only the `stored-document digest, record digest recomputed` row; removing the attempt bound fails
only `attempt over the bound`; extending the guard's `CHAPTERS` to `b22-` fails nothing in this increment.

## 8. For the lead — the reserved texts, in full

Each `### OD-…` below is the entry for `OWNER_DECISIONS.md` (as `## OD-…`), in its format; the highest number in use after A is OD-131
(OD-112..117, 119..123, 125..127, 129, 130, 132, 133 are spent by later increments; OD-83..86 and OD-88 stay reserved). The review's
corrections (2026-09-26) are folded into OD-111 and OD-131 below; no new number is needed.

### OD-106 — `POST /api/schematic/build-multi` is scoped out of B21 and tripwired (B21-A, 2026-09-24)

- **Question:** the only fan-out in the repository (a planner forced to `submit_plan`, then an unbounded `Promise.all` of build loops on
  the planner's block count, with no AbortSignal, run id, trace or per-block budget beyond `MAX_ITERATIONS`; D21-5) contradicts B21's
  pass criteria. Retire it, route it through the B21-B router, or record it as a legacy structured route outside B21?
- **Default applied:** scoped OUT of the chat DAG and recorded as legacy with its own gate cited: the B21-A import gate holds
  `app/api/schematic/build-multi/` and `app/lib/build-loop.ts` as forbidden families of their own (judged before the general `app/api/`
  family), so no orchestration module can ever import the route or `runBuildToolLoop`; no artifact presents it as the B21 orchestration;
  B21-B's route-level suite proves it untouched. Retirement is a separate owner-approved change.
- **The owner may choose otherwise:** retire the route now (a route census move, 165 -> 164, with every ratchet artifact regenerated);
  or route it through the B21-B DAG (then its planner becomes the coordinator's first turn and its blocks become specialist tasks,
  which is B21-B/C work with the same gates).

### OD-107 — The DAG caps (B21-A records; B21-B applies) (2026-09-24)

- **Question:** agents per coordinator run, parallelism, per-specialist budget, tokens, cost, wall time.
- **Default applied (the lead's values, discovery §9):** at most 4 specialists per coordinator run; parallelism 1 (sequential — memory,
  the event-loop-blocking placement engine, and parallel tool calls already off at both providers); each specialist bounded by
  `DEFAULT_AGENT_BUDGET` or less (6 / 10 / 15 000 / 120 000 / 2 / the settlement timeout; `AgentBudget` adds the two reported token
  counts, `maxInputTokens` / `maxOutputTokens`, never priced); the DAG wall time is its own scheduler cap of 300 s (not a per-specialist
  field), ≤ 8 minutes = the 10-minute proposal TTL minus the 2-minute approval window, so no artifact the DAG produces can expire before
  the human sees it; the coordinator's loop keeps 120 s per turn; a per-DAG token ceiling of 6 × (coordinator + specialists) × 4 096
  output tokens reported, not priced; an artifact older than its TTL at merge time is dissent `expired`, never merged.
- **The owner may choose otherwise:** more specialists or parallelism 2 (needs a concurrency cap on the long-running engines first);
  a longer DAG (then the proposal TTLs must move, a reviewed pin move across three sealers).

### OD-108 — How a `SpecialistResult` enters the coordinator's provider conversation (B21-A, 2026-09-24)

- **Question:** `AgentRunRequest.history` is plain text; a structured result has no turn kind of its own.
- **Default applied:** as a redacted tool result under `MAX_RESULT_CHARS` (60 000), one specialist per tool call — no `AgentRunRequest`
  change in B21; the validated snapshot's whole-body digest travels with it so the coordinator can cite it. A structured turn kind is a
  later contract change.
- **The owner may choose otherwise:** a `history` entry kind for structured results (moves the loop's request contract and every
  adapter's rendering in one increment).

### OD-109 — Specialists never hold the three availability facts (B21-A records; B21-C proves) (2026-09-24)

- **Question:** `assembleAgentRunContext` takes `executionGrantsAvailable`, `externalAcquisitionAvailable` and `mcpObservationAvailable`
  as caller flags (D21-8).
- **Default applied:** an invariant — a specialist context is DERIVED from the coordinator's and can only narrow: the three facts false,
  the ports absent, riskCeiling `propose`, approvalsAvailable empty, no grant field; only the coordinator holds the minter and the ports
  and seals the one proposal; B21-C's gateway wrapper refuses any specialist invocation whose context claims grantability. In A the
  contracts already make the request carry NO such field (a `budget` or `scope` with an extra key refuses `unknown_key`; the request has
  no capability, actor or authority field at all).
- **The owner may choose otherwise:** a sourcing specialist that reads through the external port (then `externalAcquisitionAvailable`
  becomes a per-role fact under OD-120's table, still never a grant).

### OD-110 — The deterministic no-provider path (B21-A records; B21-B builds) (2026-09-24)

- **Question:** commands that need no model.
- **Default applied:** a server-side classifier in the chat route BEFORE any adapter: a Tier 3 family name is refused with no provider
  call; a request whose only need is a Tier 0 read named by grammar is answered from the read binding; everything else takes the existing
  single-agent path unchanged. No production no-model adapter; the fixture agent stays non-production.
- **The owner may choose otherwise:** answer every message through a model (today's behaviour; simple work would still be one turn).

### OD-111 — The durable orchestration record (B21-A, 2026-09-24; corrected 2026-09-26)

- **Question:** persist orchestration runs (reversing B11's deferral in part): where, what, how long, who reads, audited?
- **Default applied:** one durable-workflow aggregate `agent.orchestration-run.v1` scoped by tenant/project/branch, keyed by the
  coordinator run id, holding only structured, digest-bound, redacted records — plan, validated request, validated result, decision,
  dissent; bounded summaries; no reasoning text, no provider state, no credential (refused by name and by value at validation, at every
  level of a wrapped artifact included); a stored request bound to the run and task it is appended under and a stored result to the request
  it answers (`requestDigest`); every write a compare-and-set commit under `orchestration:<runId>:<taskId>:<attempt>:<kind>` (the runbook's
  attempt key with the record kind, one segment per record kind, since an attempt writes its request, its result and a decision) in a
  replay partition PER RUN (the scope key carries the run id: an id may carry `:`, so the key text alone is not injective across runs); a
  replay returns the committed result and writes nothing; every load digest-verified (`revision` the head, `history` the whole chain); a
  malformed scope on a read throws `AGENT_ORCHESTRATION_SCOPE_INVALID`; NO outbox topic (no handler exists; D21-28); `history` the audit
  read. **tool calls are NOT persisted** by A (the runbook's list :801 names them): their carrier is B21-E's per-task trace record on the
  trace attribution (OD-112); D21-3 is therefore closed in part. The repository is injected and bound by the composition root (D21-32: the
  durable runtime's production path reaches the OpenAI SDK, which the gate forbids); unbound or without a database the store is
  UNAVAILABLE and every caller fails closed. **no runtime binds the store in A** — a stated deviation from the task's fixture-runtime
  binding, deferred to B21-B's `app/api/chat/orchestration-runtime.ts` (the lead may instead have the binder added outside the gated
  prefix now). **Who reads it:** in B21 the record is server-internal — the scheduler (B21-B) and the merge (B21-D) read it through the
  store; no route and no MCP read tool exposes it (the chapter adds no route; the census stays 165/162/3/0); member access with
  `read_project` is a follow-up outside B21 (a route is a census move, an MCP or agent read tool a pin move per D21-9). Retention: an
  explicit setting defaulting to the grant retention, which today means "kept until an owner-decided purge exists" (nothing in the
  substrate purges); purge and access audit deferred and stated.
- **The owner may choose otherwise:** no persistence (then resume after a provider outage re-runs specialists and re-pays them, D21-4);
  a shorter retention with a purge job (then the outbox needs a handled topic, or a scheduled purge outside it); an access audit now; a
  sixth record kind `call` persisted by the scheduler (then B21-B carries it, with its own idempotency segment per call).

### OD-118 — The official documentation hosts for execution-time re-checks (B21-A, 2026-09-24)

- **Question:** the hosts the runbook and the task name (`platform.openai.com/docs`, `docs.anthropic.com`) redirect or answer 403 (D21-29).
- **Default applied:** `developers.openai.com/api/docs`, `platform.claude.com/docs`, and for the Anthropic Agent SDK `code.claude.com`
  (not fetched) are the hosts of record; every provider fact B21 implements against is in `provider-reference-notes.md` with its URL and
  date; a page that answers 403 or redirects to an unrecorded host stays UNKNOWN until an increment fetches it and records the date. A
  re-read nothing in this increment (no provider feature is touched).
- **The owner may choose otherwise:** pin a documentation snapshot in the repository (then the "re-check at execution time" obligation
  needs a dated refresh rule).

### OD-124 — CI admission for the B21 suites (B21-A, 2026-09-24)

- **Question:** the job-scope guard covered `b19-` / `b20-` only and no directory filter covered `app/lib/agent/__tests__` (D21-26).
- **Default applied:** the guard's `CHAPTERS` extended to `b19-`, `b20-`, `b21-`; ONE directory filter `app/lib/agent/orchestration/__tests__`
  in the `prompt-to-gerber` job (explicit files under it refused as redundant by the existing rule); suites elsewhere (route, page,
  engineering) by explicit entry, never under `app/lib/engineering/__tests__` (benchmark-core would run them twice); PGlite-backed suites
  (none planned) to `database-delivery`; `b11-trace-replay-evaluation` admitted explicitly only if B21 adds cases to it, otherwise a new
  `b21-f-evaluation` suite carries them. A later chapter extends `CHAPTERS` without touching B21's page or suites (they pin membership).
- **The owner may choose otherwise:** one explicit entry per suite (the B19/B20 pattern for scattered suites; more rows to maintain).

### OD-128 — `LIVE_BLOCKERS.md` LB-9 (B21-A, 2026-09-24)

- **Question:** no row names real specialist disagreement, provider fallback or quota failure with live models (D21-25).
- **Default applied:** LB-9 added at B21-A, in the register's table format, as the row below; unblocked as LB-2; every B21 live behaviour
  (disagreement, fallback, quota, timeout, the structured-output and forced-tool rules on the models the live pages name) is recorded
  under it and never converted into a claim; the model-in-loop track is record-only until credits exist (OD-125, OD-102: no permanently
  skipped block).
- **The owner may choose otherwise:** supply provider credits with a spend limit (LB-2), which unblocks LB-7 and LB-9 together.

The row for the register's table (appended after LB-8):

| LB-9 | Real specialist disagreement / provider fallback / quota failure with live models | BLOCKED-LIVE-QUALIFICATION | B21-A: the canonical contracts and the durable record are proven offline (`b21-a-contracts`, `b21-a-store`, 29 cases; hostile, malformed and release-naming results refused structurally; the four real sealed artifacts wrapped verbatim); B21-B..F prove routing, caps, resume, merge, breakers and degraded modes with scripted adapters, fake SDK clients and the scripted fixture agent (fake-backed, named as such); OpenAI answered `429 no credits` for both configured keys on 2026-09-24 and Anthropic's credit state is unrecorded (UNKNOWN); the model-in-loop suite is record-only (OD-125) | the owner supplies provider credits with a spend limit — unblocks as LB-2 |

### OD-131 — Provider text persisted inside a `SpecialistResult` (B21-A, 2026-09-24; corrected 2026-09-26)

- **Question:** what a specialist's own words may be, once they are persisted for replay and audit.
- **Default applied:** `summary` bounded (4 000 characters) and structured; assumptions, risks and questions are closed typed records with
  bounded (1 000-character) texts; no rationale transcript; no key named in the capsule denylist (`state`, `response`, `request`, `body`,
  `headers`, `client`, `sdk`, `openai`, `anthropic`, `token`) nor any reasoning-, thinking-, continuation- or chain-of-thought-shaped key
  nor any credential-shaped key, at any level the types name; inside a wrapped sealed artifact, a reasoning- or credential-shaped key at ANY
  level and a capsule key at its top level (below it the artifact is the sealer's; a real certificate carries `state`), the sealers' three
  declared authorization-binding names (`authorization`, `authorizationBinding`, `authorizationSchema`) exempt from the name check only;
  AND no credential-shaped VALUE in any text, any id or any string of a wrapped artifact (`secret_shaped_text`), no control or format
  character anywhere (`invalid_text`) — because the record is persisted (OD-111) and may ride in a capsule, a secret must never enter it.
  The two value rules are DELIBERATE fail-closed defaults with a recorded availability cost: they reach the sealers' own prose fields inside a wrapped artifact (`provenance.instruction`, `provenance.note`, a PCB proposal's `intent`), so a real proposal built from a benign instruction that carries such a phrase or character is refused whole with the specialist's result (lead, 2026-09-26); the secret scan is the shared diagnostic
  pattern set with the `sk-` prefixes token-anchored, so a `NAME=value` dump (`R1_VALUE=10k-ohm-0603`, `DRC_PRESET=default-preset-v2`) or
  a `secret:` / `password:` prefix in benign engineering prose refuses the whole result (never redacted, as every other stored identity
  field in the codebase refuses); the character rule refuses every `\p{Cf}` character, a soft hyphen (U+00AD, copied datasheet text) or a
  zero-width joiner included. Under B21-D such a result becomes dissent `malformed`.
- **The owner may choose otherwise:** allow a longer summary (a bound move, one constant and one pin); allow a free-text rationale field
  (refused here by default: it is the chain-of-thought storage the runbook forbids); redact instead of refuse for the diagnostic-grade
  patterns and strip format characters instead of refusing (then the persisted text differs from what the model said, and the page
  records which substrings were removed).

### The README row (`artifacts/ai-control-plane-b21/README.md`, replacing the planned B21-A row)

| B21-A canonical orchestration contracts, the durable record, CI, LB-9 | `orchestration-contracts.md`; code `app/lib/agent/orchestration/{contracts,store,tripwires}.ts` | CONFIRMED (the versioned provider-neutral contracts `sirkit.specialist-request.v1` / `sirkit.specialist-result.v1` as frozen data with closed key sets, the 29-refusal vocabulary, the key-name denylist (the capsule's ten keys, the reasoning stems, the shared credential classifier) and a credential-shaped-value scan over every text, every id and every string of a wrapped artifact, the structural tool-request gate (a result naming a release, a qualification or any id outside the 33 never validates), a validation request closed to the five deterministic verifiers, A4L semantics on `allowedToolIds`, `ProposedAction` over the four live sealed schema ids with the payload verbatim, walked in full (names and strings at every level, the sealers' three declared authorization-binding names exempt from the name check only) and `artifactDigest` recomputed — proven against the four REAL sealed artifacts through their production sealers, `EvidenceReference` over the atomic source classes plus `deterministic_verifier`, capture-first validation that no getter, hook, proxy or prototype survives; the durable aggregate `agent.orchestration-run.v1` with CAS revisions, the attempt-keyed idempotency key with a record-kind segment in a per-run replay partition, a request bound to its run and task and a result to the request it answers (`requestDigest`), digest-verified loads with each guard isolated, five record kinds, the six-decision vocabulary, no outbox, an injected repository (D21-32: the durable runtime reaches the OpenAI SDK through `db/schema.ts -> embeddings.ts`) and a fail-closed unavailable default — no runtime binds the store in A (stated deviation) and tool calls are NOT persisted (B21-E's trace record; D21-3 closed in part); the AST import gate by prefix family (grants, reauthorization, approvals and journals, `pcb/fab`, the executor, `build-multi`, `build-loop`, a provider SDK, `app/api/`) with a type-only limit stated and the nine B11 files kept orchestration-free; CI admission by one directory filter and `CHAPTERS` b21- (pinned by membership); OD-106..111, OD-118, OD-124, OD-128, OD-131; LB-9; D21-1, D21-2, D21-26 closed, D21-3 closed in part, D21-25, D21-28, D21-29 recorded, D21-32 found; 40 cases in four suites plus the guard case; the adversarial review's nine confirmed findings fixed test-first; no generator input changed) |

### The ledger paragraph (`artifacts/remaining-builder-program/EXECUTION_LEDGER.md`)

### B21-A — canonical orchestration contracts, the durable record, the import gate, CI admission, LB-9 (2026-09-24 local, reviewed and corrected 2026-09-26; increment workflow + lead; this commit)

- Test-first: the adopted contracts suite (12 cases, written before any module existed) and the three new suites (store 12, import gates
  5, page 6) plus the `[B21 A]` guard case all failed on the first run (`a-failing-first.log`: the four orchestration suites at import —
  `Cannot find module '../contracts'` / `'../tripwires'`; the two b21 guard cases on the absent filter: `expected [ …(194) ] to include
  'app/lib/agent/orchestration/__tests__'`), then green with the code; the adopted suite's reviewable parts moved as recorded on
  `orchestration-contracts.md` §7 (the scrubbed spelling scan, `secret_shaped_text`, the vocabulary pins).
- Review (2026-09-26): nine confirmed findings fixed test-first (`a-fix-failing-first.log`: contracts 5/14, store 9/15, page 5/6 failed
  on the first implementation; then `a-fix-green.log`) — the three sealed families refused by their own authorization-binding name (the
  sealers' declared names exempt from the name check, values scanned, the four REAL sealed artifacts wrapped verbatim in case 13), the
  wrapped interior unscanned (walked in full), credential-shaped ids accepted (scanned), a validation request binding any of the 33
  (closed to five verifiers), a non-injective idempotency key across runs (per-run replay partition), a read throwing an internal code
  (`AGENT_ORCHESTRATION_SCOPE_INVALID`), a stored request or result bound to no run or request (bound; `requestDigest`), a hostile append
  envelope throwing (captured whole), and tamper/replay/bound assertions that did not isolate their guards (breakage probes,
  `a-fix-probe-*.log`, sources restored by hash). Two claims corrected: tool calls are NOT persisted (D21-3 closed in part; B21-E's trace
  record carries them) and no runtime binds the store in A — a stated DEVIATION from the task's fixture-runtime binding, deferred to
  B21-B pending the lead's decision. Two fail-closed costs recorded (OD-131: the diagnostic pattern set, every format character). Final
  counts: contracts 14, store 15, gates 5, page 6 (40 `it(` blocks) + the guard's 7 `it(` blocks (10 runtime tests).
- Code: `app/lib/agent/orchestration/contracts.ts` (the two schemas, nine roles, the 29-refusal vocabulary, capture-first validation,
  whole-body and artifact digests, the key-name denylist and the value scan over texts, ids and wrapped interiors, the declared names,
  the structural tool gate over the 33 and the never-exposed patterns, the verifier set, A4L semantics), `store.ts`
  (`agent.orchestration-run.v1`: CAS, `orchestration:<runId>:<taskId>:<attempt>:<kind>` in a per-run partition, five record kinds, six
  decisions, request/result binding, digest-verified loads, the scope sentence, no outbox, injected repository, unavailable default),
  `tripwires.ts` (data), `__tests__/_sealed-artifacts.ts` (the four real artifacts). No route, descriptor, UI or generator input changed;
  census 165/162/3/0; the B04/B20/B17-A artifacts byte-identical.
- Gates re-run one job at a time (the lead re-runs them): the four A suites and the guard; `app/lib/agent/__tests__` (b09-*, b11-*,
  b18-*, b20-a4-*); the five engineering suites (b04-tool-registry, b17-f-agent-exposure, b18-c-exposure-lift,
  b18-c-never-execution-sweep, b18-c-fixture-agent); the three MCP gates (b20-b1-mcp-exposure, b20-b2-import-gates,
  b20-d3-authority-import-gates); the durable-workflow tests; tsc; eslint on every new and changed file — figures in the report.
- Finding D21-32 (low, INFERRED then CONFIRMED by the gate's probe): `app/lib/db/schema.ts` imports `EMBEDDING_DIMENSIONS` from
  `app/lib/embeddings.ts`, which imports the OpenAI SDK, so `getDurableWorkflowRepository()` carries the SDK in its production closure;
  every gated module must take the repository by injection (the autonomy store carries the same closure ungated). Follow-up (not A):
  move `EMBEDDING_DIMENSIONS` to a dependency-free module.
- Records: `orchestration-contracts.md`; OD-106..OD-111, OD-118, OD-124, OD-128, OD-131; LB-9; D21-1, D21-2, D21-26 closed, D21-3 closed
  in part; D21-25, D21-28, D21-29 recorded; D21-32 opened. Live: every B21 behaviour with a real model BLOCKED-LIVE-QUALIFICATION (LB-9).

### PROGRAM_STATE.json (`artifacts/remaining-builder-program/PROGRAM_STATE.json`)

`currentCheckpoint`: "B21-A committed on chapter/b21-specialist-orchestration: canonical orchestration contracts, the durable record,
the import gate, CI admission, LB-9 (reviewed 2026-09-26: nine findings fixed test-first; no runtime binds the store yet; tool calls not
persisted); next B21-B". `nextAction`: "B21-B test-first: the task-complexity router (a Tier 0/1 command, a 3D/view request and a Tier 3
name each produce today's single-agent run shape or a refusal with no provider call — the proof order of discovery §9), the no-provider
path (OD-110), the sequential scheduler over runAgentLoop with the durable record bound through app/api/chat/orchestration-runtime.ts
(OD-107, OD-111, OD-122) — the binding A deferred." `liveBlockers` gains "real specialist disagreement / provider fallback / quota failure
with live models: BLOCKED-LIVE-QUALIFICATION (LB-9)". The report line for the closeout: `MULTI-AGENT STATUS: contracts and durable record
delivered offline (B21-A); routing, roles, merge, provider routing and evaluations pending (B21-B..F); live disagreement / fallback /
quota BLOCKED-LIVE-QUALIFICATION under LB-9`.

### Discovery closure clauses (`discovery.md` §4, appended to each defect)

- **D21-1 (no orchestration contracts)** — CLOSED by B21-A: `contracts.ts` (`b21-a-contracts.test.ts`, 14 cases); the structural
  tool-request gate refuses a result naming `sirkit.manufacturing.release` before its content is read (case 7); the four real sealed
  artifacts validate wrapped verbatim (case 13, review).
- **D21-2 (no provider-neutral evidence shape)** — CLOSED by B21-A: `EvidenceReference` over the atomic `SourceClass` union plus
  `deterministic_verifier` and the atomic `ExtractionMethod` union, with `reviewed`; the B19 proof rules are B21-D's merge weighting,
  recorded there.
- **D21-3 (no persisted run record)** — CLOSED IN PART by B21-A: `agent.orchestration-run.v1` (`b21-a-store.test.ts`, 15 cases) persists plans, validated requests, validated results (with their evidence references), decisions and dissent; tool calls are NOT persisted by A (the runbook's list :801 names them; no record kind carries a call) — B21-E's per-task trace record on the trace attribution (OD-112) carries them, and the resume that reads the record back is B21-B (D21-4); no runtime binds the store in A (stated deviation, OD-111).
- **D21-26 (CI admission)** — CLOSED by B21-A: `CHAPTERS` b21-, the `app/lib/agent/orchestration/__tests__` filter, the `[B21 A]` guard
  case (OD-124); the B11 trace suites' own admission stays as OD-124 records it.
- **D21-25 (no model-in-loop opt-in)** — RECORDED by B21-A as LB-9 (OD-128); the opt-in track itself is B21-F (OD-125).
- **D21-28 (outbox topics without a handler)** — RECORDED by B21-A: the store emits no outbox effect (store case 8); a purge or audit
  topic needs a handled map first.
- **D21-29 (the documentation hosts)** — RECORDED by B21-A as OD-118 in `provider-reference-notes.md`; nothing re-read in A.
- **D21-32 (new, low) — the durable-workflow production runtime reaches the OpenAI SDK.** `app/lib/durable-workflow/runtime.ts` ->
  `server-repository.ts` -> `app/lib/db/schema.ts` -> `app/lib/embeddings.ts` -> `openai` (a schema constant `EMBEDDING_DIMENSIONS` pulls
  the SDK). Consequence: an orchestration module gated against provider SDKs cannot resolve the production repository itself; the store
  takes it by injection and B21-B's runtime file binds it. Severity low. **CONFIRMED** (gate case 3, injected probe, chain quoted).
  Closes: a follow-up outside B21 (move the constant to a dependency-free module); no owner decision needed. Source: B21-A.

## 9. Citations, as of base 5677b15

The anchor is what is checked (it occurs exactly once in its file, or in the body of the function it names); the line is for the reader
and is never checked. For the three new modules the line is as written in this increment (they do not exist at the base); after the
review the lines are as of the corrected modules.

| # | file | line as of 5677b15 | within | anchor | what it shows |
|---|---|---|---|---|---|
| C1 | `app/lib/agent/orchestration/contracts.ts` | 29 | — | `export const SPECIALIST_ROLES = Object.freeze([` | the nine roles, closed and frozen |
| C2 | `app/lib/agent/orchestration/contracts.ts` | 99 | — | `export const ORCHESTRATION_REFUSALS = Object.freeze([` | the closed refusal vocabulary |
| C3 | `app/lib/agent/orchestration/contracts.ts` | 85 | — | `export const CAPSULE_DENYLIST_KEYS = Object.freeze([` | the capsule's ten exact keys as data |
| C4 | `app/lib/agent/orchestration/contracts.ts` | 87 | — | `export const REASONING_SHAPED_STEMS = Object.freeze([` | the four reasoning-shaped stems |
| C5 | `app/lib/agent/orchestration/contracts.ts` | 220 | — | `return typeof value === "string" && EXPOSED.has(value) && !NEVER_EXPOSED_TOOL_PATTERNS.some((pattern) => pattern.test(value));` | the structural tool gate |
| C6 | `app/lib/agent/orchestration/contracts.ts` | 435 | — | `if (engineeringDigest(payload) !== artifactDigest) refuse("artifact_digest_mismatch", digestPath);` | the artifact digest recomputed over the verbatim payload |
| C7 | `app/lib/agent/orchestration/contracts.ts` | 500 | — | `const captured = capturePlainJson(input, "$", ORCHESTRATION_BOUNDS.maxSerializedChars);` | capture first, with the document bound |
| C8 | `app/lib/agent/orchestration/contracts.ts` | 508 | — | `const wholeBody = engineeringDigest({ schema, body: root });` | the whole-body digest |
| C9 | `app/lib/agent/orchestration/contracts.ts` | 430 | — | `sealedArtifact(payload, payloadPath, 0, false);` | a wrapped artifact walked in full, names and strings at every level, before the digest |
| C10 | `app/lib/agent/orchestration/contracts.ts` | 381 | — | `if (!sound) refuse("allowed_tool_ids_invalid", path);` | A4L: a malformed list refuses the whole request |
| C11 | `app/lib/agent/orchestration/contracts.ts` | 223 | — | `export function isForbiddenOrchestrationKeyName(name: string): boolean {` | the key-name classifier |
| C12 | `app/lib/agent/orchestration/store.ts` | 37 | — | `export const ORCHESTRATION_AGGREGATE_TYPE = "agent.orchestration-run.v1" as const;` | the aggregate type |
| C13 | `app/lib/agent/orchestration/store.ts` | 93 | — | `export function orchestrationIdempotencyKey(` | the idempotency key |
| C14 | `app/lib/agent/orchestration/store.ts` | 227 | — | `throw new Error("AGENT_ORCHESTRATION_RECORD_MISMATCH");` | the one mismatch sentence |
| C15 | `app/lib/agent/orchestration/store.ts` | 301 | — | `outbox: [],` | no outbox effect |
| C16 | `app/lib/agent/orchestration/store.ts` | 322 | — | `throw new Error("AGENT_ORCHESTRATION_STORE_UNAVAILABLE");` | the fail-closed default |
| C17 | `app/lib/agent/orchestration/store.ts` | 178 | — | `if (!known || known.schema !== schema) refuse("unvalidated_document", "$.record.document");` | only a validated snapshot is stored |
| C18 | `app/lib/agent/orchestration/store.ts` | 105 | — | `const aggregateKey = (scope: OrchestrationRunScope): string => durableWorkflowId("agent-orchestration-run",` | keyed by the run id through durableWorkflowId |
| C19 | `app/lib/agent/orchestration/store.ts` | 43 | — | `export const ORCHESTRATION_DECISIONS = Object.freeze([` | the six-decision vocabulary |
| C20 | `app/lib/agent/replay-capsule.ts` | 154 | — | `"client", "sdk", "openai", "anthropic",` | the capsule denylist the ten keys are copied from ([B21 F, 2026-09-28] re-pinned from 128: the capsule v4 grew the file above it) |
| C21 | `app/lib/agent/plain-capture.ts` | 287 | — | `export function capturePlainJson(root: unknown, label = "$", maxSerializedChars = 1_000_000): CaptureResult {` | the hook-free capture and its serialized bound |
| C22 | `app/lib/agent/redaction.ts` | 157 | — | `"reasoning", "thinking", "continuation",` | the shared classifier already carries three of the stems |
| C23 | `app/lib/agent/redaction.ts` | 166 | — | `export function isCredentialShapedName(name: string): boolean {` | the shared credential-name authority |
| C24 | `app/lib/engineering/agent-exposure.ts` | 30 | — | `export const INTENTIONAL_AGENT_EXPOSED_TOOL_IDS: readonly string[] = Object.freeze([` | the one reviewed 33-id list |
| C25 | `app/lib/engineering/granted-execution-families.ts` | 74 | — | `export const NEVER_EXPOSED_TOOL_PATTERNS: readonly RegExp[] = Object.freeze([` | the never-exposed patterns |
| C26 | `app/lib/agent/autonomy-store.ts` | 62 | — | `throw new Error("AGENT_AUTONOMY_RECORD_MISMATCH");` | the digest-verified load this store mirrors |
| C27 | `app/lib/agent/contracts.ts` | 168 | — | `export interface AgentRunBudget {` | the six budget fields AgentBudget extends |
| C28 | `app/lib/agent/contracts.ts` | 156 | — | `export interface PcbProposalBasis {` | the PCB basis reused in the scope |
| C29 | `app/lib/engineering/schematic-proposals.ts` | 53 | — | `export interface Tier1ProposalHeadMark {` | the head mark reused in the scope |
| C30 | `app/lib/durable-workflow/repository.ts` | 23 | — | `if (replay) return { ...replay, idempotent: true };` | a replay returns the committed result |
| C31 | `app/lib/durable-workflow/server-repository.ts` | 3 | — | `import { durableWorkflowHeads, durableWorkflowOutbox, durableWorkflowRecords, durableWorkflowReplays } from "../db/schema";` | the production repository imports the schema |
| C32 | `app/lib/durable-workflow/runtime.ts` | 18 | — | `if (fixtureRuntimeEnabled()) return fixtureContainer().durableRepository;` | the fixture runtime's in-memory repository |
| C33 | `app/lib/atomic/types.ts` | 33 | — | `export type SourceClass =` | the source-class union the evidence classes are pinned to |
| C34 | `app/lib/db/schema.ts` | 31 | — | `import { EMBEDDING_DIMENSIONS } from "../embeddings";` | D21-32: the schema pulls the embeddings module |
| C35 | `app/lib/embeddings.ts` | 9 | — | `import OpenAI from "openai";` | D21-32: which imports the OpenAI SDK |
| C36 | `app/lib/agent/trace.ts` | 153 | — | `declaredNames: ReadonlySet<string> = EMPTY_NAME_SET,` | the B11.3 declared-name rule the artifact exemption mirrors |
| C37 | `app/lib/engineering/execution-grant.ts` | 79 | — | `export const GRANT_PREVIEW_TTL_MS = 10 * 60 * 1000;` | grants expire; their records are not purged |
| C38 | `app/lib/mcp/server/__tests__/b20-d3-authority-import-gates.test.ts` | 55 | — | `const APPROVAL_PREFIXES = ["app/lib/engineering/approved-", "app/lib/engineering/agent-execution-journal"];` | the prefix-family gate this one mirrors |
| C39 | `.github/workflows/deterministic-manufacturing.yml` | 132 | — | `app/lib/agent/orchestration/__tests__` | the one directory filter |
| C40 | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 54 | — | `const CHAPTERS = [` | the guard's chapter list (anchored on its head: the next chapter extends the members) |
| C41 | `app/lib/agent/orchestration/tripwires.ts` | 9 | — | `export const B11_SCANNED_FILES = Object.freeze([` | the nine files, named only here |
| C42 | `app/lib/agent/orchestration/tripwires.ts` | 22 | — | `export const ORCHESTRATION_IDENTIFIER_PATTERN = ` | the identifier pattern |
| C43 | `app/lib/agent/orchestration/contracts.ts` | 94 | — | `export const SEALED_ARTIFACT_DECLARED_NAMES = Object.freeze([` | the sealers' three declared names, exempt from the name check inside a wrapped artifact |
| C44 | `app/lib/agent/orchestration/contracts.ts` | 68 | — | `export const VALIDATION_BINDING_TOOL_IDS = Object.freeze([` | the five deterministic verifiers a validation request may bind |
| C45 | `app/lib/agent/orchestration/store.ts` | 102 | — | `export function orchestrationReplayScopeKey(` | the per-run replay partition |
| C46 | `app/lib/agent/orchestration/store.ts` | 249 | — | `throw new Error("AGENT_ORCHESTRATION_SCOPE_INVALID");` | the one scope sentence of the read path |
| C47 | `app/lib/agent/orchestration/contracts.ts` | 232 | — | `export function isForbiddenSealedArtifactKeyName(name: string, depth: number, underDeclaredParent: boolean): boolean {` | the artifact key-name rule |
| C48 | `app/lib/agent/orchestration/contracts.ts` | 314 | — | `if (containsTokenAnchoredSecretShapedText(name)) refuse("secret_shaped_text", path);` | every id scanned for a credential-shaped value |
| C49 | `app/lib/agent/orchestration/store.ts` | 182 | — | `if (request.taskId !== taskId) refuse("invalid_record", "$.record.document.taskId");` | a stored request bound to its task |
| C50 | `app/lib/agent/orchestration/store.ts` | 278 | — | `return { ...judged, requestDigest: answered.digest };` | a stored result bound to the request it answers |
| C51 | `app/lib/agent/orchestration/store.ts` | 220 | — | `const captured = capturePlainJson({ scope: own("scope"), taskId: own("taskId"), attempt: own("attempt"), expectedRevision: own("expectedRevision"), at: own("at") }, "$", ENVELOPE_CAPTURE_CHARS);` | the append envelope's scalar fields captured through its own descriptors; the record judged on its own |
