# PR-F fB — agent parity for missing parts (CONTINUATION C.1–C.6; assignment section F.1–F.4)

Builder fB, 2026-10-17, branch `codex/astra-foundation` over checkpoint D (`e581755`). Everything below was run or read in this
checkout; nothing live was called (no provider, distributor, database or network), no key or env value was read.

## 1. The two shared commands

| id | class / tier | binding (the ONE implementation) | discovery | MCP |
|---|---|---|---|---|
| `sirkit.parts.missing-facts` | read, Tier 0 (`execute_direct`), category `validation`, owner `pcb.sync-durable` | `app/lib/parts/missing-facts.ts#deriveMissingFacts` (bound-read) — the UI's own derivation (builder fA's module, used as is) | `schematic-present` + `local-working-copy`; every role; no board, no head mark, no catalog required | withheld (browser-only `SchematicState`, as OD-244's preflight read) |
| `sirkit.parts.draft-request` | propose, Tier 2 (`proposal_only`), category `parts`, owner `parts.atomic-publication-review` | `app/lib/agent/draft-request-proposals.ts#compilePartDraftRequest` (bound-proposal) — the pure compile + seal | `schematic-present` + `local-working-copy` + revision + lineage (the loop's B09.1 gate for every schematic proposal: a canonical head mark); roles = `PUBLICATION_REQUESTER_ROLES` (pcb_editor, reviewer, project_admin) | withheld (browser-only state; MCP stays read-only, OD-82) |

Services: `app/lib/agent/missing-facts-reads.ts` (`MissingFactsReadService`) and `app/lib/agent/draft-request-proposals.ts`
(`PartDraftRequestProposalService`), dispatched by `app/lib/agent/gateway.ts` before the B05 read service / the sealed proposal
service, advertised by `app/lib/agent/loop.ts` (the read: binding + verified schematic; the proposal: the existing propose rule, head
mark required). Both reuse the catalog port the chat route already injects for `sirkit.parts.catalog-inspect`
(`app/api/chat/catalog-inspection-runtime.ts`, `options.catalogInspection`): no route change, no new runtime boundary.

Outcome / event: the draft request rides its own kind `draft-request-proposal` and event `draft_request_ready` (contracts.ts, on the
generation proposal's lines); the loop sets the proposal single-flight, traces `proposal_sealed` with the request digest, and tells the
model the facts' DATA (documented count, missing list, PCB-assignment blockers, the human path) — never the spec as a part, never a
verification. The page has no intake yet (its `applyAgentEvent` default writes the run-log line; `b21-e2-run-view` case 3 still pins
the page's cases unchanged).

## 2. The shared derivation (implemented ONCE)

`app/lib/parts/missing-facts.ts` was written by builder fA while this assignment ran; I did not change it. The read calls
`deriveMissingFacts({ instance, schematic, catalog, projectOpen: true })` over `listUnresolvedInstances(context.schematic)` (the editor's
own refusal list) with:

- `schematic` = `schematicInstanceFactsOf(state, instance)` (value, partId, revision id, symbol-asset id, Theory type — the same fields
  the editor reads from its state);
- `catalog` = `catalogLoadOf(portAnswer).load`: the port's `CatalogPartDetail` projected by `catalogPartFactsOf` to fA's
  `CatalogPartFacts` (identity, hint, package, pin count, symbol drawing, published links, withdrawn keys — the record the browser's part
  cache holds); `not_found`, a failed, throwing or late port answer, or no bound port are `{ state: "unavailable", reason }` with the
  reason prefixed **`catalog unavailable`** (the fact's source then says so: fA's module prefixes `catalog part unavailable: …`);
- a Theory instance gets `{ state: "none" }` (fA's `THEORY_NOT_PHYSICAL`: not a physical part).

Parity is pinned byte for byte: `pr-f-missing-facts-read` computes the UI derivation in the test from the same inputs and asserts
`report.items[i].checklist` equals it, in the editor's order. The read adds beside each checklist, as data: where the catalog facts came
from and the revision status of the published link the value selects (`revisionStatus`, from the port).

Sourcing never proves identity or evidence: fA's module derives the stock/pricing class from observations alone and stamps
`SOURCING_NEVER_PROVES` (built from `ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING`, app/lib/acquisition/source-registry.ts); the read
holds no observations, so those facts are `unknown` with the rule as their note.

Bounds: `MAX_MISSING_FACTS_INSTANCES = 50` listed, the rest counted (`unresolved.truncated`); the catalog is asked once per distinct
placed part id under the call's deadline (`MISSING_FACTS_CATALOG_MARGIN_MS` before the service's timer); every text the shared
module emits is its own; the report is schema-checked under the B05 output limits.

## 3. The draft request (CONTINUATION C.4–C.6)

What the EXISTING draft/publication path is, as read: `POST /api/components/atomic/publication submit_request`
(app/api/components/atomic/publication/handler.ts → `submitAtomicPublicationRequest`, app/lib/atomic/publication-review.ts) runs
`normalizeAtomicPublicationSpec` and `assembleAtomicDraft` (app/lib/atomic/authoring.ts) and refuses every non-human actor
(`assertActor` → `ATOMIC_PUBLICATION_HUMAN_REQUIRED`, "Only a person can request, review, publish or withdraw an atomic revision."),
in the catalog governance project only. So the agent may NOT file a request (OD-244's reading stands) and the proposal seals a
REVIEW TASK a human files:

- the request in the publication path's OWN vocabulary (`AtomicPublicationSpec`: exactMpn, profile, terminals, package, datasheet,
  manufacturer; `symbol` and `footprint` null — the person picks the KiCad references at submission, the model never names a
  library asset); `pr-f-missing-parts-parity` asserts the server's `normalizeAtomicPublicationSpec` accepts the sealed spec unchanged;
- `verification: "unverified"` (a constant the integrity verifier refuses to see changed); `documented` facts each with their source
  label; `missing` facts (the requester's own list, the undocumented C.4 facts, the KiCad references); `pcbAssignment.blocked` with the
  C.4 blockers (`PCB_ASSIGNMENT_BLOCKING_FACTS`: package variant, pad numbering, pin-1 orientation, pitch, body dimensions / courtyard,
  exposed-pad mapping); `catalogCrossCheck` (checked through the bound port, or `unavailable` with the reason); `reviewTask` naming the
  human path and what it decides, and `neverClaims`: no mapping certificate, approval, publication or PCB assignment;
- the artifact binds scope + canonical head mark, the authorization binding, the base schematic digest, actor / effective actor,
  provenance, creation and expiry (10 min), under one identity digest; `verifySealedPartDraftRequestIntegrity` catches a tampered body.

The compile is all-or-nothing and refuses as `proposal-blocked` data (never `ok`), listing every blocker: `instance-missing`,
`instance-not-unresolved`, `source-label-missing`, `identity-malformed`, `identity-missing`, `pin-table-missing`, `pin-table-malformed`,
`pin-table-conflict` (a duplicate pin number; a pad mapped by two pins), `package-malformed`, `geometry-malformed`, `datasheet-malformed`,
`missing-malformed`, `fact-conflict` (a fact both documented and listed missing), `identity-conflict` (the request's MPN or manufacturer
differs from the placed catalog part's: a different part is never substituted silently, C.5), `incompatible-package`, `pin-count-conflict`,
`profile-malformed`, `pcb-assignable-blocked` (pcb_assignable requested with a C.4 fact missing). The closed argument surface refuses
`symbol` / `footprint` and every authority-shaped key by name (`invalid_input`).

The disposition "unavailable" alternative of the assignment was NOT taken because a member-callable path exists for the human: the
sealed spec is exactly what the Build Library's Request evidence review POSTs; the agent's part of it is a proposal. The coverage matrix
derives `proposal-only` for the tool under `parts.atomic-publication-review` (the record's AI path is this sealed request; filing,
approval and publication stay human-only).

## 4. CONTINUATION C refusal matrix — where each case is pinned

| C case | pinned by (existing B19-E suite, case title) | new in PR-F fB |
|---|---|---|
| cache hit | `app/lib/acquisition/__tests__/b19-e-agent-read-port.test.ts` "an offer-cache hit makes zero vendor calls, labelled with where it was served from and when it expires" | — |
| cache miss | same suite, "a miss goes live only when disclosure is permitted and the server's live policy allows; the live lookup is metered at the agent's share"; `b19-e-external-search.test.ts` "without live pricing a miss asks no vendor" | — |
| source denied | `b19-e-external-search-sources.test.ts` "an operator switch-off holds for search: DigiKey off is never constructed"; `b19-e-agent-read-port` "a used-up agent share answers paused with when to retry, and sends nothing" (and the `disabled` / `blocked` statuses of Mouser / LCSC in the cache-hit case) | — |
| unavailable credentials | `b19-e-external-search-sources.test.ts` "missing credentials: not constructed, and the result names no environment variable"; `b19-e-agent-read-port` (DigiKey `not_configured`, no variable named) | — |
| hostile vendor text | `b19-e-agent-read-port` "under the committed registry a cached answer (hostile vendor text included) is labels only and live is never used"; `app/lib/agent/__tests__/b19-e-external-read-service.test.ts` "[review] for a permitting source an instruction in vendor text reaches the model only under untrustedVendorText, and credential-shaped tokens and links are removed from it" | — |
| incompatible package | not pinned before | `pr-f-missing-parts-parity`: the catalog cross-check — `incompatible-package` when the request's package differs from the placed part's `packageNormalized`; `pin-count-conflict` when the pin table's length differs from the placed symbol's pins |
| conflicting datasheet facts | `b19-e-quarantine-review-fixes.test.ts` "an engineering disagreement names each value's class"; `b19-e-import-review.test.ts` "changes when an identity conflict appears"; `b19-e-agent-read-port` (conflicting property names in the evidence read) | `pr-f-missing-parts-parity`: `pin-table-conflict` (duplicate pin, pad mapped twice), `fact-conflict` (documented and listed missing), `identity-conflict` (request vs placed part), the compile listing every conflict at once |
| missing pin evidence | `b19-e-agent-read-port` "with no cached observation and no published revision it still reports everything missing and nothing else"; `b19-e-import-review` "the missing list follows the profile: schematic_only needs a symbol; pcb_assignable needs symbol, footprint and pin-to-pad mapping" | `pr-f-missing-parts-parity`: `pin-table-missing` (absent / empty table: "a plausible image or a matching pin count is insufficient"), `pcb-assignable-blocked` listing the C.4 facts; `pr-f-missing-facts-read`: evidence facts `unknown` with `catalog unavailable` when no port is bound |
| rejected publication | `app/lib/atomic/__tests__/b19-e-publication-review.test.ts` "a rejection needs no resolutions, names its reason, and is final" | the artifact's `reviewTask.decides` / `neverClaims` state that a reviewer may reject and that nothing is approved by sealing; the human-only rule is re-pinned (`isHumanPublicationActor` refuses `agent:*` and `llm:*` actors; the handler's `ATOMIC_PUBLICATION_HUMAN_REQUIRED` sentence) |

`pr-f-missing-parts-parity` case "every B19-E case the evidence page cites for a CONTINUATION C refusal still exists under its title"
pins every row of the first column by file and title.

## 5. Zero live connector calls — the proof

A counting fake of `ExternalAcquisitionReadPort` (both methods throw after counting) is bound to the SAME gateway in both suites, with
`externalAcquisitionAvailable: true`, and is asserted `{ search: [], evidence: [] }`: on the read's happy path with and without the
catalog, on the Theory-only sheet, on every read refusal (argument, authority-shaped argument, no schematic, cancelled), on the draft
request's seal, on every one of its twelve blocked cases, and on every `invalid_input` / `authority_unavailable` / `cancelled` refusal,
and through the real loop (read, then one sealed draft request, then a second refused `proposal_exists`). The catalog fake counts its
requests too: once per distinct placed part id on the read, once on the draft request, zero when unbound and zero on every refusal.
The external reads' own zero-call proofs are the B19-E suites above (fake vendors through the real connector; `v.calls` 0 on every
refusal).

## 6. Gates run (this builder)

- `pr-f-missing-facts-read` (12) + `pr-f-missing-parts-parity` (22): 34 passed.
- Registry chain re-run serially after the descriptors: generate-tool-registry-artifacts (54 descriptors, 42 agent-exposed, digest
  `eng1-288087948f7a2fc7`), generate-agent-artifacts, generate-b20-mcp-tool-manifest (9 exposed, 45 excluded), generate-b20-mcp-parity
  (33 agent-only), generate-pr-d-coverage-matrix (930 rows), generate-pr-d-tool-manuals (`missing-facts: 1`, `draft-request-proposal: 1`),
  generate-b11-artifacts (19/19 cases, 62/62 checks), generate-b10-artifacts, generate-b21-artifacts (7 orchestration replays).
- The named gates after the pin moves, one vitest run: b04-tool-registry, b17-f-agent-exposure, b20-b1-mcp-exposure, b20-b4-withhold-
  proposals, b20-c1-three-way-parity, b20-c3-a2-cross-check, b23-a-tier3-vocabulary, b22-b-exposure, pr-d-coverage-matrix,
  pr-d-tool-manuals, b09-1/2/3, b10-editor-context, b19-e-external-read-service, b20-b3-mcp-subset-move, b21-e2b-trace-attribution,
  b11-trace-replay-evaluation, b21-f-evaluation, b21-f-page, b21-e2b-page, b19-d-external-text-injection-route, pr-d-catalog-inspect,
  pr-d-generate-proposal, pr-d-parity-*, pr-d-review-request-unavailable, b20-b2-*, b20-d2-* — see the structured report for the final
  run's counts.
- `pnpm exec tsc --noEmit -p tsconfig.json`: 0 errors (after the modules; re-run at the end).

## 7. Pin moves (each with a dated `[PR-F fB, 2026-10-17]` note in the file's own convention)

Registry counts 52 → 54 descriptors, 40 → 42 agent-exposed, 11 → 13 MCP-withheld, 31 → 33 agent-only: b22-b-exposure (6 lines),
b20-c1 P7, b20-c3 X1, b23-a case 5, b20-b1 (withheld list, `left` 31 → 33, the base-registry technique: `PRF_ADDITIONS` filtered and
pinned — the read's fate equals the preflight read's, the draft request's equals the tier-1 proposal's except `editor_mismatch`, since
the parts category rides every editor), b20-b3 (base filter, withheld list, agent set 40 → 42), b20-b4 (base filter, withheld list,
registry length, agent set, the page sentence regex gains "and PR-F's (\d+) missing-parts commands", the table admits `PR-F | —`),
b04 (the propose allowlist + the draft request; the read-resolver chain + `resolveMissingFactsBinding`), b17-f (the two ids excluded by
name), pr-d-tool-manuals (the family lists), b09-1 (14 → 16 declarations), b09-2 / b09-3 / b10 / b19-e external-read-service (the
board-less toolset lists; the b09-3 runtime-resource branch `validated-schematic`), b21-e2b (evaluation-cases.ts sha256
`9caa5395…` → `d0492f52…`), the B21 E2 page's statement of that hash, the B20 pages (mcp-exposure.md counts and the `withheld` row;
mcp-server-proposals.md sentence + two appended rows; mcp-adversarial.md D2 table 54 / 13 and 270 requests / 227 refusals).
Descriptions were kept at 814 / 830 characters so b20-c1 P14's measured maximum (844) did not move.

Ratchet amendment (flagged for the lead): `app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts` FORBIDDEN now admits
exactly `app/lib/acquisition/external-search-contract.ts` (type-only imports) and `app/lib/acquisition/source-labels.ts` (runtime import
`./source-registry` only) — the two policy/type modules fA's derivation imports, which the chat closure reaches through the read. In the
file's own convention (B20 A4, B21 E1 amendments), with the tripwire in `pr-f-missing-parts-parity` that their runtime imports stay
exactly those and that the agent modules import no database, route or vendor code. The alternative, had the lead preferred it: fA
re-points `EXTERNAL_SEARCH_MAX_QUERY_LENGTH`, `SERVED_FROM_WORDS` and `utcMinute` out of `app/lib/acquisition/`.

## 8. Live blockers and honest limits

- No live run of either command: the catalog port was a fake in every test; the production port was proven (PR-D) to resolve under the
  fixture runtime and to be null without a database setting — unchanged here. A live check of the read over the owner's catalog needs
  the main Supabase project (owner authorization 2026-09-24, sparingly) and is the lead's call.
- The draft request never reaches the publication route: the human-only `submit_request` with a real governance project
  (`SIRKIT_ATOMIC_CATALOG_TENANT_ID` / `SIRKIT_ATOMIC_CATALOG_PROJECT_ID`) and a real member is the live gate; the sealed spec's
  acceptance by the server's normalizer is proven offline only.
- The page has no intake for `draft_request_ready` (the run-log line is what a user sees); whether the Build Library should prefill
  from the sealed spec is an owner decision (fA's `publicationPrefill` is the UI-side half).
- fA's module reports stock/pricing from external-search hits the UI holds; the read holds none (the agent would run
  `sirkit.parts.external-search` separately), so those facts are `unknown` in the read by construction.
- The draft request's catalog cross-check compares package codes by normalized containment (`SOIC-8 (D)` vs `SOIC-8`): a stated
  limit, never a geometry proof — the deterministic mapping checks and the human review decide PCB assignability.
