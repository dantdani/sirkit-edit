# Astra increment C — module contracts and evidence-backed constraint proposals (PR-F fD, 2026-10-17)

Builder fD, branch `codex/astra-foundation` over checkpoint D (`e581755`), the owner's Astra directive sections 6-7
(`C:\Users\robsa\.codex\attachments\0614d515-77bf-41db-9a60-24b3ff4dcd28\Pasted text.txt`) and CONTINUATION E
(`artifacts/astra-guided-pcb/CONTINUATION.md`). Everything below was run or read in this checkout; nothing live was called
(no provider, distributor, database or network), no key or env value was read. Labels follow the program's: **CONFIRMED** (executed
or read at the cited file), **UNKNOWN**, **BLOCKED-LIVE**. Fixture-backed throughout: the two suites run the REAL registry, gateway
and loop with a scripted provider adapter and counting fake ports that are never asked.

## 1. The contract — `sirkit.module-contract.v1` (`app/lib/engineering/module-contract.ts`) — CONFIRMED

A typed, versioned contract set a model submits for ONE pinned schematic:

| part | what it carries | the rule the validator enforces |
|---|---|---|
| `system` | name, statement of requirements and operating conditions, `operatingConditions: Quantity[]` | name and statement required; every quantity carries a unit |
| `modules[]` | stable `id`, `name`, `responsibility` | ids unique (`module-id-duplicate`) |
| `modules[].components[]` | `{ refDes, partId?, revisionId? }` | the reference must be a physical component of the pinned sheet (`component-unknown`); an ambiguous reference (two instances) is refused, never guessed (`component-ambiguous`); a stated part or revision id must agree with the sheet (`component-identity-mismatch`); one owner per component across the set (`component-double-ownership`). The VALIDATED set carries the EXACT identity read from the sheet: KiCad `componentId`, `partId`, `revisionId` (the published exact revision or null); Theory `componentId`, `theoryType` |
| `modules[].ports[]` | `id`, `net`, `direction` (input, output, bidirectional, power-in, power-out, reference, ground), `logicLevel`, `voltage[]`, `current[]`, `impedance[]`, `permittedLoading[]` (quantities), `unknown[]`, `evidence[]` | the net is a NAMED net of the sheet (`port-net-unknown`); each of the five facts (logic level for the three signal directions) is stated or listed `unknown` (`port-fact-unstated`); a stated fact carries evidence (`evidence-missing`) |
| `modules[].requirements[]` | `topic` (bandwidth, gain, noise, timing, accuracy, power, reference, ground, startup, protection), `statement`, `quantities[]`, `evidence[]` | every topic is stated, listed `unknown` or marked `notApplicable` (`module-topic-unstated`), never two at once (`module-topic-conflict`); a stated requirement carries evidence (`requirement-without-evidence`) |
| `modules[].partAuthorityGaps[]` | the owned references that lack footprint / pin authority | DERIVED from the sheet through the editor's own refusal list (`listUnresolvedInstances`, app/lib/pcb-sync/unresolved-instances.ts): every owned unresolved instance must be acknowledged (`part-authority-gap-unstated`); a gap claimed for a resolved instance or an unowned reference is refused (`part-authority-mismatch`) |
| `modules[].placementRouting[]`, `modules[].tests[]` | obligations in plain words; tests with `id`, `procedure`, `acceptance`, quantities, evidence | bounded; a test needs a unique id, a procedure and an acceptance criterion (`test-malformed`) |
| `constraints[]` | `id`, `kind` (interface, shared-power, shared-ground, shared-clock, shared-reference, shared-connector, net-ownership), `net`, `modules[]`, `owner`, `statement`, `quantities[]`, `loading`, `evidence[]` | the net is named on the sheet (`constraint-net-unknown`); every module exists (`constraint-module-unknown`); evidence required (`constraint-without-evidence`); a shared resource names its owner (`net-owner-missing`), one owner per net (`net-ownership-conflict`); an interface states its loading (driver + quantities) or declares it unknown with a reason (`interface-loading-unstated`) |
| every number | `Quantity { name, value, unit, bound: min / max / typical / nominal }` | a blank unit is refused (`quantity-without-units`); a non-finite value (`quantity-malformed`) |
| every recommendation | `ContractEvidence { sourceIdentity, documentRevision, section, applicability, assumptions, uncertainty, kind: hard-requirement / approved-policy / optimization-goal }` (directive 6) | a blank source (`evidence-without-source`); a missing field or an unknown kind (`evidence-malformed`) - "not stated by the source" is written, never omitted |

Cross-module check (directive 7, "an individually passing filter and ADC module do not automatically make a passing acquisition
system"): a net carried by the ports of two or more modules is an INTERFACE; it must be stated by a constraint naming every module
that carries it (`interface-unstated`); a net where an output meets an input across modules needs an `interface` constraint with its
loading stated or declared unknown (`interface-loading-unstated`); a shared `reference` port needs a `shared-reference` constraint
with its owner (`reference-unstated`). `pr-f-module-contract` proves the directive's case literally: the filter module validates alone,
the ADC module validates alone, the pair without its interface constraint is refused.

Scope (directive 2): `physicalInstanceCount` = KiCad instances + physical Theory parts (a ground or a source is a stimulus, not
physical); a sheet over `ASTRA_QUALIFIED_PHYSICAL_INSTANCES = 50` is refused `scope-unsupported` with the count and the sentence
"classify the board unsupported or experimental", never sealed.

Unknown stays unknown: `unknown[]` on a port, `unknown[]` / `notApplicable[]` on a module, `loading.unknown` on an interface - each
explicit, each kept visible in the validated set; what is neither stated nor declared unknown is refused, never defaulted.

Authorities reused (no second netlist): identities from the sheet's own instances (`schDisplayRef`, `normalizeRefDes`, `refDesKey`,
`theoryPinContract` for physicality); named nets = the netlist authority's names (`buildNetlist`, app/lib/pcb/netlist-bridge.ts:
labels win, ground → GND, `N$n` unnamed nets excluded as having no stable identity) united with the sheet's declared labels and GND
(without the parts cache - the agent has none - the authority locates Theory pins only, so a Build-sheet label net has no located node
and the label itself is its declared identity; `knownNetNames` says so and `pr-f-module-contract` pins the union); part authority from
`listUnresolvedInstances` (the editor's Prepare PCB refusal list, as the D preflight read).

The validated set (`ModuleContractSet`) adds, as data: `partAuthority[]` rows per owned instance (state, the missing fact, the
editor's review path), `coverage` (physical instances, owned, `unassigned` references - a visible gap, never a refusal - known,
referenced and shared nets with their constraint ids) and `electricalCheck: { state: "not_run", detail }`: no electrical check,
simulation or ERC runs here. 32 closed refusal codes (`MODULE_CONTRACT_REFUSAL_CODES`), all-or-nothing, every blocker listed (bounded
to 64), each naming its module.

## 2. The command — `sirkit.module.propose-contracts` — CONFIRMED

| facet | value |
|---|---|
| class / tier | `propose`, `proposal-artifact`, approval tier none → Tier 2 by derivation (`proposal_only`, human approval required) |
| category / owner | `schematic` / `cd.architecture.workbench` (CD-2: modules and their interfaces) |
| discovery | `schematic-present` + `local-working-copy` + revision + lineage (the loop's B09.1 gate for every schematic proposal: a canonical head mark); roles pcb_editor, reviewer, project_admin; a board is not needed; exactly the tier-1 proposal's gates (b20-b1 pins the fates equal under every context) |
| binding | `bound-proposal` → `app/lib/engineering/module-contract.ts#validateModuleContractSet` (the one validator); `resolveModuleContractBinding` refuses another class, side effect, tier or module |
| service | `ModuleContractProposalService` (`app/lib/agent/module-contract-proposals.ts`): the exact binding, the context integrity check, the verified schematic snapshot + digest + canonical head mark (`authority_unavailable` otherwise), fresh discovery (`not_discoverable` with the reason), role and capability (`unauthorized`), the closed argument surface (exactly `system`, `modules`, `constraints`, each required; authority-shaped keys refused by name: `approved`, `verification`, `electricalCheck`, `scope`, `headMark`, `schematic`, `partAuthority`, `baseSchematicDigest`, ...), `cancelled`, then the pure validate and seal; no port, no provider, no network |
| artifact | `sirkit.module-contract-proposal.v1`: `scope` (tenant/project/branch + head mark), `authorization` (verified principal, membership revision, required apply role), `baseSchematicDigest` (the PINNED sheet's `schematicStateDigest`), `verification: "contract-structure-checked"` (a constant), `contractSet`, `electricalCheck: not_run`, `reviewTask` (path, decides, neverClaims), `contractDigest`, actor / effectiveActor, provenance, 10 min TTL; frozen; `verifySealedModuleContractProposalIntegrity` recomputes both digests and refuses a tampered copy, a claimed verification or electrical check, an extra key, another schema |
| outcome / event | kind `module-contract-proposal` (contracts.ts), event `module_contracts_ready` (one per run: the loop's proposal single-flight refuses a second proposal `proposal_exists`); the trace records `proposal_sealed` with the contract digest; the model is told the set's DATA (modules with owned references, ports and requirements counts, unknown topics, part-authority gaps; constraints with kind, net, modules and loading state; coverage; unresolved part-authority rows; the review task) and the note "NOTHING has been changed, verified electrically or approved" - never the evidence text to relay as proof |
| refusals as data | a set the validator refuses is `proposal-blocked` with every blocker (`[moduleId] detail`), never ok, nothing sealed |
| MCP | withheld (`mcp-exposure-review.ts`: browser-only `SchematicState` and head mark, as OD-82's proposals; MCP stays read-only) |
| registries | `agent-exposure.ts` (reviewed list), `mcp-exposure-review.ts` (withheld), `tool-manual.ts` (family `module-contract-proposal`, the curated `MODULE_CONTRACT_INPUT_EXAMPLE`, the three code sources), `evaluation-cases.ts` (B11 capsules: discovered wherever a validated schematic and its head mark are, never in e08), gateway dispatch and loop outcome branch, `generate-agent-artifacts` (a propose descriptor: `validated-schematic;canonical-head-mark`) |

Discovery impact: the B11 capsules (e02-e07, e09-e16) now expect the tool beside the tier-1 proposal and the draft request; the
board-less toolsets of b09-2, b09-3, b10 and b19-e list it first (sorted by tool id); b09-1's strict-subset toolset is 17.

## 3. What the page does with the artifact today — CONFIRMED (read), the richer surface is later work

`app/page.tsx` was NOT edited by this builder (assignment rule). Its `applyAgentEvent` switch names `proposal_ready`,
`pcb_proposal_ready`, `generation_proposal_ready`, `view_command_ready`, `layout_candidate_ready`, `execution_grant_ready`,
`execution_settled`; an event it does not name falls to its default run-log line (the way `draft_request_ready` is shown since PR-F fB).
So today `module_contracts_ready` appears in the chat run log as the default line, and the model's reply (told the set's data) names the
modules, the stated interfaces, the unknowns and the part-authority gaps. The human accepts the note by continuing or asks for a
revision; there is no apply path and nothing to apply: the contract changes no sheet and no board.

What the page should do for this event (reported for the lead; `openIssues`): a `case "module_contracts_ready"` that runs
`verifySealedModuleContractProposalIntegrity`, checks the base digest against the live editor (stale → refused with its sentence, as the
generation intake does), and appends a run-log note "Module contracts received — N modules over M components; K interfaces stated; gaps:
...; no electrical check ran" with a disclosure of the set (modules, ports, requirements, constraints, part-authority rows) - a reviewable
note, never an approval control. A richer review surface (a panel over the contract set, per-module acceptance, re-check after
composition) is later work in this increment's order (directive 3: C before D).

## 4. Tests and gates — the runs of this increment

- `app/lib/engineering/__tests__/pr-f-module-contract.test.ts`: the schema (constants, the descriptor's input schema validates the
  curated example and refuses a missing key, an unknown key and a bad enum; descriptor text under the first-party bounds; strict-compatible);
  the sheet authorities (identities, ambiguity, physical count, named nets = authority ∪ labels); the happy path (exact identities,
  derived part-authority rows, coverage, electricalCheck not_run, deterministic digest, the sheet untouched); unknown loading kept visible;
  35 refusal cases over the closed code list; the directive's filter-and-ADC case; the set's shape and the qualified scope; blocker bounds.
- `app/lib/engineering/__tests__/pr-f-module-propose.test.ts`: the descriptor (valid, strict-compatible, Tier 2, exposed, MCP-withheld,
  bound to the one validator); denied discovery with the reason (viewer / commenter, no head mark, no schematic; board-less kept); the happy
  path through the real gateway (the documented payload, frozen, integrity, tampering refused, the sheet untouched, ports never asked);
  refusals as data (proposal-blocked with the module named; the closed argument surface; authority_unavailable; cancelled;
  not_discoverable); the real loop (one `module_contracts_ready`, `proposal_sealed`, the data told, `proposal_exists` on the second call).

Runs of this increment (2026-10-17, `timeout 600 pnpm exec vitest run --reporter=dot <files>`, one process at a time) — CONFIRMED:

- the two suites above: 2 files, 51 tests passed;
- gate batch A (b04-tool-registry, b17-f-agent-exposure, b20-b1-mcp-exposure, b20-b3-mcp-subset-move, b20-b4-withhold-proposals,
  b20-c1-three-way-parity, b20-c3-a2-cross-check, b23-a-tier3-vocabulary, b22-b-exposure, pr-d-tool-manuals, pr-d-coverage-matrix):
  10 of 11 files passed, 141 of 145 tests; the four failures are `b20-b3` cases 1, 4, 5 and 7, where builder fE's concurrent
  `sirkit.stackup.propose` is not yet in that suite's addition lists (15 withheld ids where the suite lists 14; the base registry 42
  where it expects 41) — fE's pending pin move, not this increment's (this increment's id is listed there);
- gate batch B (b09-1-boundary, b09-2-closure, b09-3-closure, b10-editor-context, b19-e-external-read-service,
  b11-trace-replay-evaluation, b11-1-trace-integrity, b21-e2b-trace-attribution, b21-f-evaluation): 9 files, 195 tests passed;
- neighbours (pr-f-missing-parts-parity, pr-d-generate-proposal, b20-d2-name-spellings, b20-d1-malicious-server,
  b20-d1-rebinding-window, b21-e2-run-view): with the two suites, 8 files, 139 tests passed;
- eslint 0 on every file this increment touched; `pnpm exec tsc --noEmit -p tsconfig.json` exit 0 over the whole project at the final
  run (an earlier run reported errors only in builder fE's then in-progress `app/lib/pcb/candidates/stackup-candidate.ts` and
  `app/lib/pcb/experiments/*`, none in a file of this increment).

Generators re-run serially after the tests (`pnpm exec tsx scripts/<name>.ts`): generate-tool-registry-artifacts,
generate-agent-artifacts, generate-b20-mcp-tool-manifest, generate-b20-mcp-parity, generate-pr-d-coverage-matrix,
generate-pr-d-tool-manuals, generate-b11-artifacts (19/19 cases, 62/62 checks), generate-b10-artifacts (8 cases), generate-b21-artifacts
(7 orchestration replays). The registry at that moment: digest `eng1-c8aabb01efa2f952`, 56 descriptors, 44 agent-exposed, 9 MCP-exposed,
15 withheld — these counts include fE's `sirkit.stackup.propose` (this increment adds one descriptor, one exposed id, one withheld id).

Pin moves of this increment, each with a dated "[PR-F fD, 2026-10-17]" note beside the earlier ones: b09-1 (16 → 17), b09-2 / b09-3 /
b10 / b19-e (the board-less toolset lists `sirkit.module.propose-contracts` first, by tool id), b04 (the propose allowlist), b17-f (the
by-name exclusion), b20-b1 (the withheld list, `left` 33 → 34, `PRF_ADDITIONS`, the fate pinned equal to the tier-1 proposal's under
every context), b20-b3 and b20-b4 (`PRF_ADDITIONS`, 42 → 43; the proposals page's regex "PR-F's N commands"), b20-c1 (55 / 43 / 9 / 34),
b20-c3 and b23-a (54 → 55), b22-b (55 / 43 / 43 / 34 / 14 / 43), pr-d-tool-manuals (the `module-contract-proposal` family),
evaluation-cases (B11 capsules; the E2b digest was then re-pinned by fE over the file as it stands), and the B20 pages mcp-exposure.md,
mcp-server-proposals.md (section 14 row) and mcp-adversarial.md (55 descriptors, 14 withheld, 275 requests / 232 refusals). Builder fE moved
the same count pins by one more on top (56 / 44) while this increment ran; the lead resolves the final values.

One file outside this increment's list was touched, with the reason: `app/lib/engineering/tool-catalog.ts`, builder fE's
`sirkit.stackup.propose` description was 1007 characters, over the first-party bound of 1000 (`DESCRIPTOR_TEXT_BOUNDS.descriptionMaxChars`),
so `sirkitToolRegistry()` threw `TOOL_REGISTRY_INVALID` and no registry gate or generator in the tree could load for 17 minutes with no
further edit from fE; one sentence was reworded ("Receiving the candidate changes nothing." → "Receiving it changes nothing.", 996
characters), no fact changed. fE may rephrase.

## 5. Honest limits

- Fixture-backed: no live model submitted a contract set; the example set and the test sets were written by hand. Whether Astra (or any
  model) produces a set that validates is UNKNOWN until a live qualification run with an approved budget (the live auth gate stands).
- The validator proves identities, nets, units, evidence SHAPE, ownership and interface STATEMENTS. It does not judge whether a cited
  source exists or says what the evidence claims (the acquisition boundary and a human do), does not compute loading or settling, and runs
  no electrical check (said in the artifact). "Conflicting or missing evidence remains visible": missing is refused by name, conflicting is
  visible as two evidence entries the human reads.
- Nets are the sheet's NAMED nets only (labels, GND). An unnamed Theory net (`N$n`) has no stable identity and cannot be a port; the model
  must label it first (a tier-1 proposal) - a deliberate limit, stated in the descriptor.
- The page shows the artifact only as its default run-log line until the intake above is added (openIssues).
