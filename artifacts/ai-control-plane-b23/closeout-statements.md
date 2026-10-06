# B23 closeout (1/2) - the provider-claim and stale statements superseded, the stale title retitled, the unused exports recorded, the tripwire

Labels: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading), **PROPOSED** (designed, not
exercised), **RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Base: `dfd51e3` (B23-D), branch `chapter/b23-external-manufacturing`, 2026-10-05. This commit closes D23-16 (OD-178): the README and
quickstart copy that said a provider's quote tool takes the bundle is superseded in place, never rewritten, and a tripwire pins that no
production copy, doc or page claims a provider accepted, quoted, priced, DFM-checked or ordered anything without a stored acknowledged
receipt. It also notes in place the B23 statements a later B23 increment made untrue, retitles the one stale title, and records the
B23 exports no production module calls. No behaviour change, no assertion weakened, no route (the census stays 166 = 163 canonical + 3
factories + 0 raw), no agent tool (47/36/9/27), no verdict - that is commit 2/2, the lead's. The B23 README, `discovery.md` and the
program's records are the lead's reserved files: their lines for this commit are in the closeout report's "For the lead" section, not
here. Sections 1 to 4 are re-derived from the tree by `app/lib/manufacturing-providers/__tests__/b23-closeout-statements.test.ts` (the
tripwire, section 5): section 1 by cases 4, 5 and 8, section 2 by cases 6 and 8, section 3 by case 7 and section 4 by case 3. Sections
0, 5, 6 and 7 are this commit's account and are not re-derived.

## 0. What commit 1/2 is

- **The scope** is the verified sweep (`closeout-scope/`: `claim-statements.json`, `stale-titles.json`, `dead-code.json`; read-only
  sweep and adversarial verification at `8bca09e`, 2026-10-04), each item re-verified by its TEXT at `dfd51e3` before it was edited.
  B23-C and B23-D landed after the sweep: the discovery's lines below its new D23-10..D23-15 closure clauses moved down by six (the
  others did not move), and no confirmed item's text was gone or already superseded. `records-audit.json` feeds commit 2/2 and was read for context only.
- **The C and D sweep**: the files B23-C and B23-D changed (`ProviderExchangePanel.tsx`, `action-registry.ts`, `release-gate.ts`,
  `manufacturing-errors.ts`, two B23 suites' pins, the B01 CSV) and the statements elsewhere that quote what they changed were swept
  the same way. Outside the lead's `discovery.md` no statement was made untrue by them (section 6); their own pages record their
  closures. Their five new modules are recorded in section 3.
- **The note**: each stale statement keeps its own words and gains `[superseded 2026-10-05 by the B23 closeout (<references>): ...]` on
  its own line - at the line's end, or right after the stale words where the line goes on - and adds or removes no line. The references
  are D23-16 and OD-178 for the provider claim, and the increment that made a statement untrue for the rest. The D23-16 notes use the
  closeout task's wording, which generalises OD-178's draft (`discovery.md:785`: "a bundle prepared for JLCPCB's quote upload; no
  upload has been recorded"): "a provider's" for "JLCPCB's" - the quickstart names no single provider ("their quote tool", "jlcpcb.com
  ... (or pcbway.com)") - and it adds that no provider has accepted, quoted, DFM-checked or ordered a Sirkit bundle (no stored
  acknowledged receipt; LB-11). That departure from the draft is named for the owner (OD-188 (g), in the report). No note reuses the
  B21 or B22 closeout's prefix or tag or their claim words, and none is in a file B11 scans.
- **The retitle**: the stale title is retitled to what its body asserts, with a same-line `[B23 closeout, 2026-10-05] retitled (...):
  ...; assertions unchanged` comment; its suite's `it(` count is unchanged (11) and no page quotes the old title.
- **Lines**: no line moved in any production file, and no line that a page or a page suite cites moved. Every edited production and
  test file, the root README and the quickstart changed lines in place only (CONFIRMED: `git diff --numstat` shows one insertion and
  one deletion in each, two and two in `docs/pcb-quickstart.md`). Six B23 pages - pages and page suites cite
  `tier3-vocabulary.md`, `outbound-disclosure.md` and `dfm-quote-flow.md` by line - each gained one closing section, the export
  record, appended after their last line, so after every cited line (CONFIRMED: each hunk starts after the old last line): `provider-registry.md` section 12, `tier3-vocabulary.md` 17, `outbound-disclosure.md` 14, `dfm-quote-flow.md` 29,
  `ordering-boundary.md` 14 and `physical-evidence.md` 15. `tier3-vocabulary.md` also carries one note in place on `:166`.

## 1. Dated notes, in place

**CONFIRMED** (each anchor checked to occur once on its line first; the tripwire pins every count and case 8 re-derives every row): 11
notes - 5 production lines in 5 files, 2 in 2 test files and 4 in 3 pages (the root README and the quickstart among them). The item is
the sweep's id (`CS-*`, `ST-*`); `CO-N1` is this commit's own addition (section 6).

### 1.1 Production

| item | file:line | references | the note says |
|---|---|---|---|
| CS-B1 | `app/lib/manufacturing-providers/provider-registry.ts:16` | B23-B1, B23-B3 | POST /api/pcb/provider-exchange reads this registry since B23-B1, and GET /api/pcb-sync through the observation reader since B23-B3; ... |
| CS-B2 | `app/lib/auth/route-policy.ts:358` | B23-B1, OD-174 | since B23-B1 one row is externalTransfer, POST /api/pcb/provider-exchange; spend stays false on every row |
| CS-B21 | `app/lib/auth/route-resource-classification.ts:107` | B23-B1, B23-B2, OD-182 | but a transfer row's value is declared `files` since B23-B1, never derived; since B23-B2 the provider exchange route's closure ... |
| CS-B20 | `app/lib/acquisition/admission-control.ts:19` | B23-B2, OD-165 | and, since B23-B2, a manufacturing provider - the manufacturing-provider kind below, agent share 0 |
| CO-N1 | `app/lib/manufacturing-providers/provider-egress.ts:135` | B23-B2 | the exchange service passes its own clock, the system clock in production, and nothing else |

CS-B1 keeps B1's statement and B1's record of it (`outbound-disclosure.md` `:432`, which `b23-b-page` case 4 requires while the sentence
stands): the sentence itself is rewritten only in the next reviewed registry revision, as B1 decided. The note adds that it is a
comment note, not a registry revision: no row, rendered CSV byte, descriptor or `PROVIDER_REGISTRY_VERSION` changes (the generator
re-renders `provider-registry.csv` with no drift, section 7). That reading of the registry's "bump on any change" rule (`:18`) is this
closeout's choice, named for the owner in the report. CS-B20 sits after B21's own note on `:19`, which `b21-closeout-statements` pins
with its words; B21's bracket is untouched.

### 1.2 Test files

| item | file:line | references | the note says |
|---|---|---|---|
| ST-2 | `app/lib/manufacturing-providers/__tests__/b23-a-tier3-vocabulary.test.ts:279` | B23-B1, B23-C | no descriptor carries it, and one record does since B23-B1, manufacturing.provider-exchange (below); ... |
| ST-10 | `app/lib/manufacturing-providers/__tests__/b23-b-dfm-quote-flow-page.test.ts:103` | B23-B3 review | the B23-B3 sections are 17-28 - section 27 holds the gates and section 28 the review round, which case 10 reads |

Both are comments, so by the B22 precedent they keep their words and gain the note (the verification's correction of the finder's
rewrite); neither suite's `it(` count moves (9 and 10).

### 1.3 Pages

| item | file:line | references | the note says |
|---|---|---|---|
| CS-A1 | `README.md:41` | D23-16, OD-178 | a bundle prepared for a provider's quote upload; no upload has been recorded, and no provider has accepted, quoted, DFM-checked or ordered a Sirkit bundle (no stored acknowledged receipt; LB-11) |
| CS-A2 | `docs/pcb-quickstart.md:6` | D23-16, OD-178 | a bundle prepared for a provider's quote upload; no upload has been recorded, and no provider has accepted, quoted, DFM-checked or ordered a Sirkit bundle (no stored acknowledged receipt; LB-11) |
| CS-A3 | `docs/pcb-quickstart.md:47` | D23-16, OD-178 | a bundle prepared for a provider's quote upload; no upload has been recorded, and no provider has accepted, quoted, DFM-checked or ordered a Sirkit bundle (no stored acknowledged receipt; LB-11); uploading it is a person's own act outside Sirkit |
| CS-B3 | `artifacts/ai-control-plane-b23/tier3-vocabulary.md:166` | B23-B1, OD-174 | since B23-B1 the table carries one transfer row, POST /api/pcb/provider-exchange (outbound-disclosure.md section 5); no row is spend |

The README statement runs over `:38-41` and the quickstart's over `:3-6`; each note sits on the line the claim ends on, in the
statement's own paragraph. `README.md:63` keeps B22's note, alone. The R05 report's open owner action (the Gerber-viewer check and the
upload, `artifacts/prompt-to-gerber/r05-e2e01-report.md` `:616-619`, `:657`) is the record behind the three D23-16 notes, with
`progress/2026-07-09/02-fab-dialog-gerbers.md` `:72-73` ("still pending").

## 2. Retitles, assertions unchanged

**CONFIRMED** - one case, retitled to what its body asserts with the same-line retitle note; the retired wording may never return
(tripwire case 6), and the suite's `it(` count is the one it had on `dfd51e3`.

| item | suite:line | retired wording | `it(` blocks |
|---|---|---|---|
| ST-1 | `app/lib/manufacturing-providers/__tests__/b23-a-provider-admission.test.ts:164` | "only the CSV generator reads the registry" (stale since B23-B1, whose exchange service reads the registry, and B23-B3, whose observation reader does) | 11 |

The new title names what the body pins: exactly five source files outside the directory name it (the provider exchange route, GET
/api/pcb-sync's `handler.ts`, `manufacturing-summary.ts` and `route.ts`, and the CSV generator, whose text names neither admission
nor the CD-12 projection), and a read error anywhere in the walk fails the case. The old title's dated B1 clause about admission goes
with it; the suite's header (`:6`) keeps B1's and B3's dated notes. The note does not quote the retired wording. The page lines that
cite case 8 by number (`dfm-quote-flow.md` section 23, `outbound-disclosure.md` section 8, `provider-registry.md`, `tier3-vocabulary.md`)
quote no title and stay true. Tripwire case 6 ties the new title to its body, not to fixed words: the files the case's pin lists must
be, in order, the five the title names, and each other thing the title says must be asserted - the two `not.toContain` checks on the
generator's text, the `EBUSY` walk, and the suite's five walk roots; a deleted assertion or a swapped file is reported (review
tests-5, section 5).

## 3. Exports with no production caller: recorded

**CONFIRMED** at `dfd51e3` with the edits, by `git grep` and by tripwire case 7, which re-derives every row from the tree: a recorded
export is still exported; a vocabulary has a type read from it; a test oracle, test seam or test gate is named by a test and by no
other production source (comments stripped); a generator render only by its generator; a member is never passed or called where
production composes its owner, every production call of that owner is listed, and each of those calls, parsed with the TypeScript
API, passes a closed object literal (or JSX attributes) of exactly its pinned keys - the route `{ env }`, the panel `scope`,
`authority` and `canAct`, the summary reader `{ observations }`, the observation reader `{ exchanges }`, the egress input
`descriptor`, `package`, `idempotencyKey`, `env` and `beforeSend` - so a named options object or a spread is reported (review
security-2 and tests-4, section 5); a whole module has exactly its allowed production
importers; a deferred retirement is named by nothing else. Each B23 page's closing section names its records. The sweep (`dead-code.json`)
counted the `export` lines A1..B3 added to production files; under B22's rule every one not listed is used at run time inside its own
module. B23-C's and B23-D's five modules, added since, are recorded whole (CO-E1..CO-E5). Nothing is retired: the one plainly dead
export, `providerRow`, waits for the next reviewed registry revision (DC-05R), and the transfer descriptor list, the provider egress, the
exchange record, the observation reader and the order and purchase contracts are delivered and kept (case 7 pins each still exported
and never retired).

| item | module | export | member | kind | decision | page | why |
|---|---|---|---|---|---|---|---|
| DC-01 | `app/lib/manufacturing-providers/cd12-projection.ts` | `*` | - | extension point | RECORD | `provider-registry.md` | every export (`toProcurementProviderDescriptor` at `:28`) - the CD-12 projection OD-161 asks for, delivered unbound; no production importer; registry case 14 runs it |
| DC-03A | `app/lib/manufacturing-providers/provider-registry.ts` | `renderProviderRegistryCsv` | - | generator render | RECORD | `provider-registry.md` | `:802` - the CSV render; only the generator calls it, and registry case 15 compares its output byte for byte |
| DC-03B | `app/lib/manufacturing-providers/provider-registry.ts` | `PROVIDER_REGISTRY_CSV_COLUMNS` | - | generator render | RECORD | `provider-registry.md` | `:795` - the render's header row, read by the render and case 15 |
| DC-04 | `app/lib/manufacturing-providers/provider-registry.ts` | `RUNBOOK_FIELDS` | - | test oracle | RECORD | `provider-registry.md` | `:120` - the runbook's twelve field names in order, which registry case 3 maps onto the row keys |
| DC-06 | `app/lib/manufacturing-providers/provider-registry.ts` | `PROVIDER_REGISTRY` | - | test oracle | RECORD | `provider-registry.md` | `:516` - the id-keyed view the registry and admission suites read; production reads `PROVIDER_ROWS` |
| DC-07 | `app/lib/manufacturing-providers/provider-registry.ts` | `PROVIDER_REGISTRY_RULES` | - | vocabulary | RECORD | `provider-registry.md` | `:525` - the validator's closed rule tags as data beside `ProviderRegistryRule` |
| DC-05R | `app/lib/manufacturing-providers/provider-registry.ts` | `providerRow` | - | deferred retirement | RECORD | `provider-registry.md` | `:518` - dead, named nowhere; retired in the next reviewed registry revision, since removing code here is a registry change (the version rule, `:18`) |
| DC-27 | `app/lib/manufacturing-providers/provider-registry.ts` | `renderProviderRegistryCsv` | `rows` | deferred retirement | RECORD | `provider-registry.md` | `:802` - no caller passes the parameter (the generator and case 15 call the render bare); dropped in that same revision |
| DC-08 | `app/lib/manufacturing-providers/provider-admission.ts` | `PROVIDER_ADMISSION_REFUSALS` | - | vocabulary | RECORD | `provider-registry.md` | `:25` - admission's closed refusal codes as data beside `ProviderAdmissionRefusal` |
| DC-09 | `app/lib/manufacturing-providers/provider-admission.ts` | `structuralDelegation` | - | test seam | RECORD | `provider-registry.md` | `:83` - runs inside `admitProviderOperation`; exported only so admission case 11 can show the structural layer bite |
| DC-15 | `app/lib/engineering/action-registry.ts` | `ACTION_SIDE_EFFECTS` | - | vocabulary | RECORD | `tier3-vocabulary.md` | `:450` - the action side effect as data beside `ActionSideEffect`; its one run-time read is the coverage validator, which only the B01 generator and the suites call |
| DC-16A | `app/lib/auth/route-policy.ts` | `routeVocabularyViolations` | - | test gate | RECORD | `tier3-vocabulary.md` | `:377` - OD-174's gate over the route table, run by the B23-A and B23-B suites like the route-coverage gates |
| DC-16B | `app/lib/auth/route-policy.ts` | `ROUTE_VOCABULARY_VIOLATIONS` | - | test gate | RECORD | `tier3-vocabulary.md` | `:366` - the gate's nine closed reasons, read only inside it |
| DC-17 | `app/lib/auth/route-resource-classification.ts` | `outboundEgressViolations` | - | test gate | RECORD | `tier3-vocabulary.md` | `:238` - the egress columns' gate, run by `b23-a-route-vocabulary` and `b23-b-exchange-route` |
| DC-18 | `app/lib/auth/route-resource-classification.ts` | `PUBLIC_MODEL_EGRESS` | - | test gate | RECORD | `tier3-vocabulary.md` | `:139` - the gate's reviewed allow-list of public model-egress paths (OD-182 (a)), read only by the gate |
| DC-19 | `app/lib/auth/route-resource-classification.ts` | `OUTBOUND_EGRESS` | - | vocabulary | RECORD | `tier3-vocabulary.md` | `:114` - the closed `outboundEgress` vocabulary as data beside `OutboundEgress` |
| DC-10 | `app/lib/manufacturing-providers/outbound-package.ts` | `OUTBOUND_MANIFEST_FIELDS` | - | test oracle | RECORD | `outbound-disclosure.md` | `:41` - the manifest's closed top-level keys; the manifest is built from literals and `b23-b-outbound-package` case 4 pins the two equal |
| DC-11 | `app/lib/manufacturing-providers/outbound-package.ts` | `OUTBOUND_PACKAGE_REFUSALS` | - | vocabulary | RECORD | `outbound-disclosure.md` | `:48` - the package's closed refusals as data beside `OutboundPackageRefusal` |
| DC-13 | `app/lib/manufacturing-providers/provider-exchange.ts` | `PROVIDER_EXCHANGE_PURPOSES` | - | vocabulary | RECORD | `outbound-disclosure.md` | `:40` - the two purposes as data beside `ProviderExchangePurpose` |
| DC-21 | `app/lib/manufacturing-providers/provider-exchange.ts` | `ProviderExchangeService` | `heldCounts` | test oracle | RECORD | `outbound-disclosure.md` | `:390` - the count of held plans and keys that `b23-b-approval-plan` cases 12, 13 and 16-18 read; the route calls only `preview` and `commit` |
| DC-22 | `app/lib/manufacturing-providers/provider-exchange.ts` | `ProviderExchangeServiceOptions` | `registry`, `now`, `nonce`, `admit`, `limits`, `transfer` | injection seam | RECORD | `outbound-disclosure.md` | `:204`-`:212` - the route builds the service with `env` alone; production gets the reviewed registry, the system clock, server nonces, real admission, the default limits and the empty descriptor list |
| DC-24 | `app/components/pcb/ProviderExchangePanel.tsx` | `ProviderExchangePanelProps` | `fetchImpl`, `newKey` | test seam | RECORD | `outbound-disclosure.md` | `:61`, `:63` - the panel suite's transport and key seams; the workflow panel passes only the scope, the authority and `canAct` |
| DC-12 | `app/lib/manufacturing-providers/exchange-ledger.ts` | `EXCHANGE_PHASES` | - | vocabulary | RECORD | `dfm-quote-flow.md` | `:48` - the record's three phases as data beside `ExchangePhase` |
| DC-23 | `app/lib/manufacturing-providers/exchange-ledger.ts` | `ProviderExchangeLedger` | `attempt`, `history` | test oracle | RECORD | `dfm-quote-flow.md` | `:110`, `:116` - the record's reconciliation reads (OD-167 records reconciliation, it does not build it); no module that holds the record calls them |
| DC-20 | `app/lib/acquisition/admission-control.ts` | `currentManufacturingProviderPause` | - | test oracle | RECORD | `dfm-quote-flow.md` | `:518` - the meter's non-reserving read, with which `b23-b-provider-meter` shows an agent's request reserves nothing |
| DC-28 | `app/lib/manufacturing-providers/provider-egress.ts` | `ProviderSendInput` | `signal` | test seam | RECORD | `dfm-quote-flow.md` | `:148` - a caller's abort input, set only by the suites; the exchange service passes none, so an upload would be bounded by its descriptor's deadline alone |
| DC-14 | `app/lib/manufacturing-providers/provider-text-screen.ts` | `PROVIDER_TEXT_SCREEN_REASONS` | - | vocabulary | RECORD | `dfm-quote-flow.md` | `:291` - the screen's closed reasons as data beside `ProviderTextScreenReason` |
| DC-25 | `app/api/pcb-sync/manufacturing-summary.ts` | `ManufacturingSummaryOptions` | `now` | test seam | RECORD | `dfm-quote-flow.md` | `:122` - the summary's clock seam; the route composes only `observations` and the default is the system clock |
| DC-26 | `app/lib/manufacturing-providers/provider-observation.ts` | `createProviderObservationReader` | `registry`, `transferVersions` | test seam | RECORD | `dfm-quote-flow.md` | `:260` - seams for a later registry revision and a reviewed descriptor version; the route passes only `exchanges` |
| CO-E1 | `app/lib/manufacturing-providers/order-contract.ts` | `*` | - | dormant contract | RECORD | `ordering-boundary.md` | every export (`OrderContract` at `:210`) - the order contract against an injected port, delivered unbound; no production importer and no wired port |
| CO-E2 | `app/lib/manufacturing-providers/purchase-authorization.ts` | `*` | - | dormant contract | RECORD | `ordering-boundary.md` | every export (`PurchaseAuthorizationStore` at `:254`) - the two-person single-use authorization; imported only by the order contract |
| CO-E3 | `app/lib/manufacturing-providers/webhook-verification.ts` | `*` | - | dormant contract | RECORD | `ordering-boundary.md` | every export (`verifyWebhook` at `:74`) - pure webhook verification; imported only by the order contract |
| CO-E4 | `app/lib/manufacturing-providers/ordering-enablement.ts` | `*` | - | dormant contract | RECORD | `ordering-boundary.md` | every export (`orderingEnablement` at `:93`) - the enablement and the fixed notice; imported only by the order contract and the purchase authorization |
| CO-E5 | `app/lib/manufacturing-providers/physical-evidence.ts` | `*` | - | dormant contract | RECORD | `physical-evidence.md` | every export (`assembledProductEligibility` at `:484`; `ServerDerivedHumanReview`, named nowhere, is the review port's answer shape) - delivered unbound; no production importer |

**Rejected by the verification, not recorded as rows**: DC-02 (`renderFact`: `cd12-projection.ts` imports and calls it, and the CSV
render uses it at run time) and DC-05 (retiring `providerRow` now; replaced by DC-05R). The verifier's three exports with no importer
anywhere that run inside their own module (`TIER3_B23_WORDS`, `MCP_TIER3_TOOL_NAME_REFUSAL`, `MCP_TIER3_NAME_WORDS`) are not listed
under B22's rule; dropping their `export` is optional and not done.

## 4. The allow-list, and what stays as written

**CONFIRMED** (tripwire case 3: each entry on exactly one line of its file, still stating a claim, with no note on it, admitting a
pinned number of statements - 6 in production, 2 on the pages, 1 per quoting line - and only those that lie inside its own text; a
claim appended to an allowed line is reported). The claim vocabulary is case 1's and case 2's, 19 forms in 8 kinds, each form pinned
by its own examples in case 3 (review security-1, coverage-1, tests-1). A provider is JLCPCB, PCBWay, OSH Park, MacroFab,
Eurocircuits, DigiKey, Mouser, Nexar or LCSC by name, or the provider, manufacturer, fab, fabricator, assembler or distributor, or a
quote tool - with its quote tool, online quote, quote, DFM check or API, and two joined by "and" or "or". The forms:

- **accepted**: a provider that accepts, accepted, approves or approved, up to three auxiliaries or adverbs between ("has accepted",
  "has already accepted"); accepted or approved by one; a quote tool that accepts.
- **quoted or priced**: a provider that quotes, quoted, prices or priced (auxiliaries as above); quoted or priced, up to six words
  on, by one.
- **DFM-checked**: DFM-checked, up to six words on, by anyone; a provider that DFM-checked; passed a named provider's DFM; passed
  DFM (checks) at, with or by one; a named provider's or the provider's DFM (check) that passed, cleared or succeeded.
- **an order**: ordered, placed, bought or purchased, up to six words on, from, at, with or through one; a provider that ordered,
  shipped or fulfilled; an "Order at" instruction naming JLCPCB's, PCBWay's or OSH Park's site; an order with, at or from one that is
  confirmed, placed or accepted.
- **sent**: sent, uploaded, submitted or transferred, up to six words on, to one; sends, uploads, submits or transfers, up to six
  words on, to a provider named - the present tense with "a provider" describes the egress ("what Sirkit sends to a provider",
  `artifacts/ai-control-plane-b20/mcp-provider-connectors.md`), not a send.
- **as-is**: an upload, uploads, uploaded or uploading taken as-is on its line.
- **a verdict** read as acceptance: `MANUFACTURER UPLOAD ZIP READY: YES` or `MANUFACTURER UPLOAD VERIFICATION: PASS`.
- **the control name**: "Send to fab".

A negation right before the verb ("not", "never", "nothing is", "no file is"), or a negation or a condition right before the
provider ("no", "nor", "neither", "not", "if", "unless", "until", "before", "whether", "when", "once"), is no claim. A note admits only
what ends before it on its line, so a claim written after or inside a note is reported, and case 4 pins that no note states a claim
(review tests-2). It is a vocabulary: a phrasing outside these forms is not seen, which is RECORDED here rather than claimed away.
Test files are not copy and are not scanned for it.

[B23 closeout lead, 2026-10-05] Corrected after the check of the review fixes: a temporal word ("until", "before", "when", "once") makes a
condition only before a present or perfect verb ("until JLCPCB has quoted the board", "once JLCPCB has accepted the bundle");
before a simple past it dates a claim, which is reported ("When JLCPCB accepted the bundle", "Once PCBWay quoted the board").
And "the API" or "a quote" is a provider only with its name or role ("the JLCPCB quote tool", "the provider's API"): "the API
accepts only a JSON body" and "a quote priced in euros" are no claims.

- **The four preset notes** stay as written: `app/lib/pcb/fab/presets/jlcpcb-2l.fab.json`, `app/lib/pcb/fab/presets/jlcpcb-4l.fab.json`,
  `app/lib/pcb/fab/presets/pcbway-standard.fab.json` and `app/lib/pcb/fab/presets/oshpark-4l.fab.json`, each admitted only inside its
  whole notes line. Each is a hand-off instruction to a person (the registry's hand-off rows cite them), and PCBWay's and OSH Park's
  file-naming sentences are facts from their own help pages (verified 2026-07-09), not an answer about any Sirkit bundle. JSON has no
  comment, so a note would be a text change, and the closeout's task keeps every preset's notes as written.
  Only `jlcpcb-2l`'s notes are inside the pinned release identity: the qualify route reads that one preset
  (`QUALIFIED_FABRICATION_PROFILE_ID = "jlcpcb-2l"`, `app/api/pcb/qualify/route.ts:82`, `:282`; case 3 reads it), and its notes text
  is in the B05 replay fixtures (`artifacts/ai-control-plane-b05/read-replay-fixtures.json`, which `b05-read-invocation.test.ts:496`
  compares byte for byte, and `artifacts/ai-control-plane-b05-1/composite-replay-fixtures.json`, which the same generator writes) -
  CONFIRMED by `git grep`. The other three presets' notes are in no file but their own; each feeds a native snapshot's source hash
  whenever that preset is chosen (`app/lib/pcb/fab/native/snapshot.ts:159-169` hashes the preset it is given; INFERRED, no pin).
  A visible caveat, if the owner wants one, belongs at the dialog's render site in a reviewed UI
  change.
- **The order contract's acceptance answer**, `app/lib/manufacturing-providers/order-contract.ts` (`ORDER_ACCEPTED`): given only after
  the contract settled a provider's acceptance with the order id recorded - a stored acknowledged receipt - and the module has no
  production importer.
- **The R05 report's two verification verdicts**, `artifacts/prompt-to-gerber/r05-e2e01-report.md` (`MANUFACTURER UPLOAD VERIFICATION:
  PASS` and `MANUFACTURER UPLOAD ZIP READY: YES`): Sirkit's own byte and parse verdict on the ZIP, in a dated R05 record that says no
  board was uploaded, quoted or ordered.
- **The control name "Send to fab"** is admitted wherever it names the control, pinned per file (review tests-6):
  12 times in production - `app/components/pcb/FabDialog.tsx` (3), `app/components/pcb/PcbEditor.tsx` (2),
  `app/components/pcb/PcbToolbar.tsx` (3), `app/components/pcb/ShortcutsHelp.tsx` (1) and the registry's three hand-off notes,
  `app/lib/manufacturing-providers/provider-registry.ts` (3) - and 6 on the pages:
  `artifacts/ai-control-plane-b19/acquisition-ux.md` (1), `artifacts/ai-control-plane-b19/final-verdict.md` (1),
  `artifacts/ai-control-plane-b19/unknowns-and-owner-decisions.md` (1), `artifacts/ai-control-plane-b23/provider-registry.md` (1),
  `docs/native-fab-compiler.md` (1) and `docs/pcb-quickstart.md` (1), the quickstart's step 5. B19 recorded it as a fabrication ZIP
  export, not procurement, and deferred the rename (`acquisition-ux.md`); a rename is an owner decision and a UI change (the B01
  fingerprint and the B17-A inventory pin the label). The uses are pinned per file, so a new or moved use is reviewed.
- **The lines that quote a superseded statement as the record of it**: `artifacts/ai-control-plane-b23/outbound-disclosure.md` (B1's
  record of the registry header, which `b23-b-page` case 4 requires while the sentence stands, and its citation row C31), and the two
  page suites that pin them, `app/lib/manufacturing-providers/__tests__/b23-b-page.test.ts` and
  `app/lib/manufacturing-providers/__tests__/b23-b-dfm-quote-flow-page.test.ts`.

Allowed by construction and not on the list: the observation list shows only acknowledged answers stored in `mfg.provider-exchange.v1`,
labelled external with no verdict (a stored receipt is the exception the tripwire states), and the provider panel's quote and DFM
check option labels state no answer.

## 5. The tripwire

**CONFIRMED** - `b23-closeout-statements.test.ts`, eight cases, riding the `app/lib/manufacturing-providers/__tests__` directory
filter (no CI change); it reads files only (B11.5 case 12: it spells no write primitive) and starts no process; every whole-tree case
declares a 60 s budget:

1. no production copy (the sources and the four fab presets' notes) states a claim in the vocabulary's forms outside the allowed text
   of five exact lines and the control name, and no superseded B23 statement stands uncorrected in production or a test file;
2. no page (the artifacts but the lead's records and this page, the docs, the root README) states a claim outside the R05 verdicts and
   the control name, and no superseded B23 statement stands uncorrected on a page;
3. the allow-lists are exact and cannot rot, and the scans bite: each entry admits its pinned number of statements, inside its own
   text only; every one of the 19 forms is reported by its own examples - 63 ([B23 closeout lead, 2026-10-05] 67), one at least for each verb, preposition and site a form
   names, the review's missed phrasings among them - one wrapped over two lines is reported, and twelve negations and conditions
   ([B23 closeout lead, 2026-10-05] seventeen) are not; the control name's uses are pinned per file and a moved use
   changes the map; with every note stripped the scans report exactly the 3 claims and the 8 superseded statements the closeout noted,
   all eleven; a claim appended to an allowed line, after a note or inside one, or on an allowed line moved to another file, is
   reported; only the qualified preset's reason says it is inside the pinned release identity; section 4 names every entry, every
   control file with its count, and that one preset;
4. all eleven notes keep their statement's words, carry the line's references and say what they must (the D23-16 notes the closeout's
   words exactly), no other line carries one, no note holds another closeout's prefix, tag or claim words, and no note states a claim of
   this vocabulary;
5. every file keeps its pinned number of notes (11 in 10 files);
6. the retired title never returns, the suite carries the one retitle note, the new title is derived from its body (the pin's five
   files in order, and the assertions it names) and a deleted assertion or a swapped file is reported, and the `it(` count is 11;
7. section 3 re-derived from the tree - each production composition parsed to a closed literal of its pinned keys, a named options
   object, a spread, a JSX spread and an extra key each reported - with nothing retired and the delivered-and-unbound modules kept;
8. sections 1 and 2 re-derived row for row, and every closeout tag in `app/` is the retitle.

**Failing first** (`co1-red-pre-edit-2.log`): at `dfd51e3` with only this suite added, 8 of 8 failed - case 1 reported the 6
superseded production and test statements (the registry header, the route-policy and classification comments, the egress comment, the
two test comments); case 2 the 3 provider claims (`README.md:41`, `docs/pcb-quickstart.md:6` and `:47`); case 3 only the missing
section 4 (every bite check already held); case 4 the 11 un-noted lines; case 5 no note anywhere; case 6 no retitle; cases 7 and 8 the
missing page. The first red run (`co1-red-pre-edit.log`) also failed case 3 on its own pin: the control name counted 12 in production,
not the 9 the suite first said (the registry's three hand-off notes name the dialog); the pin was corrected before the recorded run.
After the notes, the retitle, the export records and this page: 8 of 8 passed (`co1-green-2.log`, 3.5 s; the slowest case, 3, took
1.36 s here). One green run before it (`co1-green-1.log`) failed case 7 on this commit's own page: `outbound-disclosure.md`'s record
named `heldCounts` but not its owner, `ProviderExchangeService`; the record was completed.

**Breakages** (`co1-mut-*.log`; each a deliberate change of the edited tree, run through the suite, then restored byte for byte and
its hash checked): the README note dropped (cases 2, 4, 5 and 8 failed); an unnoted "JLCPCB accepted the board" appended to a B23 page
(2 and 3); the PCBWay preset's notes edited (1 and 3: the claim is no longer the allowed text); the retired title wording put back (6);
the provider exchange route passing the service a clock (7: "passes now"); a superseded statement copied into a production comment (1
and 3). Each was caught.

**The review round** (2026-10-05; an adversarial review confirmed nine bite gaps in this suite and five record inaccuracies). Each
gap was first shown on the suite as reviewed: a deliberate breakage of the tree, run through it alone under the lock, stayed 8 of 8
green (`co1fix-gap-*.log`), and the tree was restored byte for byte, its hash checked. The suite was then strengthened (the claim
forms and their examples, the allowed and noted spans, the per-entry and per-file pins, CS-B20's scan, the retitle's derivation and
the parsed compositions); on the unchanged tree its first run failed only case 3, on this page's section 4, which did not yet name the
control files or the one preset inside the pinned release identity (`co1fix-first-run.log`); the next run failed only on two of those
facts, which the page had wrapped over two lines (`co1fix-green-1.log`); with each on one line, 8 of 8 passed (`co1fix-green-2.log`:
8.5 s, case 3 the slowest at 4.7 s, every case inside its declared 60 s). The same breakages then each failed it
(`co1fix-bite-*.log`). The first swapped-pin run failed case 6 on the case's own bite check rather than on the derivation, so case 6
was reordered to check the tree's derivation first and the two retitle breakages were run again; the table shows the second runs. The
six breakages of the first round were run again on the strengthened suite and each is still caught (`co1fix-remut-*.log`). After
those runs case 3's examples were completed to one at least for each verb, preposition and site of every form (63; [B23 closeout lead, 2026-10-05] 67); dropping one
alternative from the suite's own vocabulary - `fulfilled`, `transferred` or `through` - then fails case 3 on that alternative's
example alone (`co1fix-altdrop-*.log`, the suite restored by hash each time).

| breakage (review finding) | as reviewed | strengthened |
|---|---|---|
| "JLCPCB has accepted the bundle. Sirkit sent the Gerbers to JLCPCB. PCBWay's DFM check passed. We ordered the boards from OSH Park." appended to a B23 page (security-1, coverage-1, tests-1) | 8 green | cases 2 and 3 failed: all four claims reported at `provider-registry.md:360` (accepted, sent, DFM-checked, ordered) |
| "JLCPCB shipped the boards." appended after the allowed text of `order-contract.ts`'s ORDER_ACCEPTED line (coverage-2, tests-3) | 8 green | cases 1 and 3 failed: `order-contract.ts:44 (an order with a provider)` |
| "; JLCPCB accepted it on 2026-10-06" written inside the README's note (tests-2) | 8 green | cases 2, 3 and 4 failed: `README.md:41` reported, and the note states a claim |
| the route passing a named options object that carries `transfer` (security-2, tests-4) | 8 green | case 7 failed: "composes ProviderExchangeService with not an object literal: SERVICE_OPTIONS, not { env }" |
| the workflow panel spreading `{...panelProps}` into the provider panel (tests-4) | 8 green | case 7 failed: "composes ProviderExchangePanel with a spread" |
| the admission suite's two generator `not.toContain` assertions deleted (tests-5) | 8 green | case 6 failed: nothing asserts "whose text names neither admission nor the CD-12 projection" |
| `manufacturing-summary.ts` swapped out of the admission pin, five entries kept (tests-5) | 8 green | case 6 failed: "the pin lists" `stage3.ts` where the title names `manufacturing-summary.ts` |
| one "Send to fab" use moved from `ShortcutsHelp.tsx` to another file, the total kept (tests-6) | 8 green | case 3 failed: the per-file map differs (`ShortcutsHelp.tsx` 0, `ordering-enablement.ts` 1) |
| CS-B20's statement copied uncorrected into a production comment (coverage-7) | 8 green | cases 1 and 3 failed: `ordering-enablement.ts:119 (the meters keyed by a source, a server or a tool alone (B23-B2))` |

The record fixes of that round: section 0's line statement and the D23-16 wording against OD-178's draft (coverage-4, coverage-5),
section 4's pinned release identity, now `jlcpcb-2l`'s alone (coverage-6), and the discovery line numbers in the report's text for
the lead (regressions-1, coverage-3).

[B23 closeout lead, 2026-10-05] The check of those fixes raised two low issues in the strengthened vocabulary, each inferred from a replica and
closed test-first by the lead:

- **Temporal words hid past-tense claims.** The strengthened condition list put "until", "before", "when" and "once" before a
  provider, so "When JLCPCB accepted the bundle" was no longer reported, though the reviewed suite reported it. Now a provider's
  verb after a temporal word is a claim in the simple past and a condition in any other form (`WHEN`, `PAST_AUX` and `said()` beside
  `IF`; the five forms that name a provider before its verb use it).
- **A bare "the API" or "a quote" was a provider.** The article branch of `ONE` took a part alone, so "the API accepts only a
  JSON body" read as a provider's acceptance; a part now needs a provider's name or role.
- **Red** (`colead-01-red.log`): case 3 with four claims and five non-claims added failed on all seven that the issues predicted
  (four claims unreported, three non-claims reported; the two perfect-tense conditions already passed). **Green**
  (`colead-02.log`): 8 of 8. **Breakages** (`colead-mut-*.log`, the suite restored by hash each time): putting the temporal words
  back into the condition list fails case 3 on the four past-tense claims; letting a part stand alone again fails it on the three
  non-claims.

## 6. Skipped, rejected, and left as written

- **Rejected by the verification, not edited**: CS-A10 (the zip checker's comment reports JLCPCB's naming guidance; a `.py` file),
  CS-B6 (a dated census measurement), CS-B9 (its reason was wrong; replaced by CS-B9R), CS-B10 (`outboundFetch` still carries no upload
  body), CS-B18 and CS-B19 (no runtime path reads the provider switch before admission refuses), CS-B22 (the six query paths are still
  the only declared `observation-query` rows); ST-3..ST-9 and ST-11..ST-14 (scoped to their increment, already noted in place, or
  incomplete but true); DC-02 and DC-05 (section 3).
- **The lead's reserved files** (written out in the report's "For the lead"): the discovery items CS-B4, CS-B5, CS-B7, CS-B8, CS-B9R,
  CS-B11..CS-B17 (sections 2 and 5 read as at `849a933`; one `- [B23 closeout` line in section 10, and D23-16's closure clause) and
  CS-ADD-LB11 (`LIVE_BLOCKERS.md` LB-11's state cell).
- **The C and D sweep**: nothing outside `discovery.md` was made untrue. The discovery's section 2.5 quotes the assembled-release note
  and gate message B23-D replaced, and its section 9 rows say a person sees only the old error message - a snapshot and dated
  history, covered by the lead's section 10 line. The B17 contract row (`no route, no control; B22-B24`) and the B17 history page's list
  of non-implemented records are dated B17 records; the B18 scenario "no order path exists at all" is still true (no route reaches the
  order contract).
- **Seen, not in scope, left as written**: `outbound-disclosure.md` section 8's row for `b23-a-route-vocabulary` case 4 records B1's
  pin, which B2 moved (recorded in `dfm-quote-flow.md` section 10); `b23-b-approval-plan` case 9's "whatever the environment holds"
  (the service is built with an empty environment there, since B1) and `b23-b-egress-import-gate`'s header "(types)" (the service
  imports the record's input builder at run time, since B2) are each their own increment's wording, not made untrue later; the
  `b23-a-no-order-structural` header's "reached by no route today" is answered by A2's own next line; `admission-control.ts:4-5` went
  stale in B20; `exchange-ledger.ts:37` is incomplete, not untrue; `catalog.ts:113` is relative to B22-B.
- **Added by this commit** (CO-N1): `provider-egress.ts:135` said production passes the egress nothing; the exchange service passes
  its clock. The dead-code verifier found it and left it to the statements sweep, which had not listed it.

## 7. Gates

**CONFIRMED** on the edited tree, one run at a time under the shared lock (logs `co1-gate-*`), every run exit 0:

| set | files | tests |
|---|---|---|
| `app/lib/manufacturing-providers/__tests__` + `b19-e-ci-job-scope` (the B23 suites, their page suites, the census at 166) | 30 | 400 |
| `app/lib/manufacturing-providers/database/__tests__` (PGlite, the database-delivery job) | 1 | 5 |
| `b21-closeout-statements` + `b22-closeout-statements` (both scan these notes and pages) | 2 | 19 |
| the 28 other suites that read or import a touched file (B16-B20 route, distributor, publication and pcb-sync suites) | 28 | 320 (+1 skipped) |
| `app/api/chat/__tests__` + `app/lib/acquisition/__tests__` | 36 (+1 skipped) | 362 (+2 skipped) |
| `app/lib/agent/__tests__` (B11.5 among them) | 36 | 415 |
| `app/lib/agent/orchestration/__tests__` | 49 | 460 |
| `app/lib/computation/__tests__` (the B22 process census among them) | 26 (+2 skipped) | 300 (+18 skipped) |
| `app/lib/engineering/__tests__` | 99 | 1,107 |
| `app/lib/auth/__tests__` | 41 | 479 (+9 skipped) |
| `app/api/__tests__` (the B16.1c census tripwires) | 27 | 1,059 |
| `app/lib/mcp` (the B20-B4 process gate among them) | 45 | 825 |
| `b14-4-ast-import-gates` | 1 | 22 |

tsc 0. eslint on the nine changed TypeScript files: one error in the new suite (a loop variable named `module`, Next's
no-assign-module-variable), renamed; then 0. The 21 generators ran with no drift (`provider-registry.csv` byte-identical). No UI file
changed, so the B17-A control inventory and the browser suite are not needed for this commit; no `app/lib/pcb` file changed and the
Java-capable suites were not run.

**The review round's gates** (CONFIRMED, logs `co1fix-gate-*`, one run at a time under the lock, every run exit 0): with the
strengthened suite and this page, the same thirteen sets gave the same counts as the table above (30 / 400, 1 / 5, 2 / 19, 28 / 320 +1
skipped, 36 +1 skipped / 362 +2 skipped, 36 / 415, 49 / 460, 26 +2 skipped / 300 +18 skipped, 99 / 1,107, 41 / 479 +9 skipped,
27 / 1,059, 45 / 825, 1 / 22); tsc 0; eslint 0 on the nine changed TypeScript files; the 21 generators with no drift. Case 3's
examples were then completed and this section written, so the sets that read the suite or this page ran again (`co1fix-final-*`,
exit 0): the suite alone 8 / 8; `app/lib/manufacturing-providers/__tests__` with `b19-e-ci-job-scope` 30 / 400; the two closeout
suites 2 / 19; `app/lib/agent/__tests__` (B11.5) 36 / 415; tsc 0; eslint 0 on the suite. Only the suite and this page changed in the
review round; no production file, no other test file and no other page did.
