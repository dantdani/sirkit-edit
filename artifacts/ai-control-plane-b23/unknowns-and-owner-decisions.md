# B23 - unknowns and owner decisions

Labels as in `README.md`: **CONFIRMED** (executed and measured, or read at the cited file:line), **INFERRED** (code reading),
**PROPOSED**, **RECORDED**, **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. State at HEAD `b6c6b0d` (the B23 closeout (1/2)), read from
`artifacts/remaining-builder-program/OWNER_DECISIONS.md` (OD-160 onward), `artifacts/ai-control-plane-b23/discovery.md` (section 4 with
every closure clause, sections 6, 8, 9 and 10), `artifacts/remaining-builder-program/LIVE_BLOCKERS.md` and the B23 pages. Drafted by the
lead's read-only generator (`scratchpad/b23/closeout/generate.py`, re-run at `b6c6b0d`) and corrected by hand against those records and
the code at HEAD, with the verified records audit (`scratchpad/b23/closeout-scope/records-audit.json`, at `8bca09e`) re-derived for
what B23-C (`4e71563`), B23-D (`dfd51e3`) and the closeout (1/2) (`b6c6b0d`) moved: the audit's pending items D23-10, D23-11, D23-13,
D23-14, D23-15, D23-16 and D23-4's order-contract half are closed since, and OD-170..OD-172, OD-175..OD-178 and OD-186..OD-188 are
recorded since. The generator's clause parser reads a `[B23-X, date]` tag followed by "Closed" or a few half phrases only, so its draft
counted D23-4 and D23-5 "closed in part" although each half carries its own closure clause (B23-B2 and B23-C; B23-B2 and B23-B3),
D23-19 "closed in part" from A1's "Code half closed" although the same clause records the lead's register rows and mirror in the same
commit, which close it, and D23-16 and D23-18 open: the closeout's tag `[B23 closeout, 2026-10-05]` is outside its pattern, and A1's
D23-18 clause reads "The mapping is closed". It read one line of each section-8 item. The tables below supersede the draft.

## Owner decisions (OD-160 to OD-189)

Every number from OD-160 to OD-188 is spent; OD-189 is reserved and unused. OD-160..OD-180 were drafted in `discovery.md` section 6;
OD-181..OD-188 are the increments' stated choices beyond their task texts (one per increment: A1, A2, B1, B2, B3, C, D and the closeout
(1/2)). At `b6c6b0d`, `OWNER_DECISIONS.md` holds 29 headings for 28 numbers, OD-161..OD-188 (OD-174 carries two: A2's vocabulary and
B1's route half), each "as applied" and each closing with "Owner confirmation pending" (29 lines from `:1944` on). **OD-160** is
applied in code - admission refuses every `dfm_quote_transfer` and `ordering` operation `provider_not_admitted` before anything else
(`provider-admission.ts:54-56`) - and its heading is recorded as applied at the closeout, in commit 2/2, with the verdict (as the
closeout (1/2)'s ledger entry says), so that OD-160..OD-188 hold 30 headings for 29 numbers. "Open" names what the records leave
with the owner.

| OD | title (as recorded) | state at the close of B23 | open for the owner |
|---|---|---|---|
| OD-160 | which providers B23 targets, and whether the owner holds approved API access for any (drafted in section 6) | **default applied; recorded as applied at the closeout (commit 2/2)**: no provider account assumed; the read-only DFM/quote flow built end to end offline against an in-process fake provider behind the real egress boundary (B1-B3); no provider row admitted for a transfer; every live exchange BLOCKED-LIVE-QUALIFICATION (LB-11); no account, application, credential, upload or order made by the builder; B23-B4 (the opt-in, owner-run sandbox qualification) not run, because no account exists | **owner decision**: name the providers and supply an approved account with a sandbox or staging path; only then does B23-B4 exist |
| OD-161 | where manufacturer and quote providers live, as applied (B23-A1) | applied: the sibling registry `provider-registry.ts` (`PROVIDER_REGISTRY_VERSION` 1.0.0), the byte-gated CSV (33 columns), the CD-12 projection with a test caller only; B19's registry untouched but the `CHAPTERS` line | confirmation only |
| OD-162 | the initial provider rows and their tiers, as applied (B23-A1) | applied with its stated exception: nine rows (5 of kind `manufacturer`, 4 `distributor`; no `assembler` or `quote_service` row - MacroFab's assembly and PCBWay's SMT quotation sit in manufacturer rows), every transfer blocked or disabled, nine ordering operations present but disabled; the documentation was not re-read before commit (OD-181 (a)) | confirmation; a person re-reads a provider's own pages before any tier rises |
| OD-163 | what leaves Sirkit in a DFM or quote transfer, as applied (B23-B1) | applied, departing from the drafted default (`discovery.md:771` named no project or board id): the eight Gerber, Excellon and job files byte-identical plus a generated provider manifest; `release-manifest.json` and `README.txt` withheld; no BOM, CPL or distributor value; tenantId, branchId, designId and the actor in no outbound byte; the project id (or its kept prefix) and the board id leave inside the board's file-safe name, in every file name, each Gerber's TF.ProjectId and the job file - disclosed, never stripped (84 metadata fields for the 555) | **open**: whether a provider may receive the board's file-safe name; stripping it moves the release bytes and identity (OD-183 (g)) |
| OD-164 | who may request a transfer, and on what, as applied (B23-B1) | applied: a human `project_admin` only, refused before any durable read (`b23-b-exchange-route` cases 5-7); only for a ledgered release whose authority is head and matches the board's revision AND digest; no agent tool (47/36/9/27) | confirmation only |
| OD-165 | the transfer mechanics and meters, as applied (B23-B2) | applied: `outboundUpload` with an in-memory bounded body (bytes or multipart), ceilings within 64 files and 64 MiB, no redirect, one deadline, Idempotency-Key only when declared, no dependency; the `manufacturing-provider` meter with agent share 0 | confirmation; the runbook's "bounded streaming" (`:978`) is realised as a bounded in-memory body - an interpretation for the owner to confirm |
| OD-166 | how the human approves a named provider and purpose, as applied (B23-B1) | applied: a sealed 10-minute plan; a commit with planId, planDigest, an idempotency key and the opt-in header, consumed once, steps 1-2 re-run; preview and commit are separate requests from two controls | confirmation; no two-person rule for a transfer (OD-183 (c)) |
| OD-167 | receipts, retention and ambiguity, as applied (B23-B2) | applied: `mfg.provider-exchange.v1`; every ambiguous end `UNKNOWN_PENDING_RECONCILIATION`, never retried, never through the outbox; two concurrent commits send once (PGlite); no raw body or archive byte kept | **attention**: reconciliation is recorded, not built, so an interrupted `sent` attempt blocks its package to that provider until a person reconciles it (OD-184 (m)) |
| OD-168 | when a quote or DFM observation is stale, as applied (B23-B3) | applied: fourteen closed reasons judged at every read; `validUntil`, else 24 hours; no observation is current in production (`PROVIDER_TRANSFER_DESCRIPTORS` is empty) | confirmation only |
| OD-169 | provider-suggested substitutions or design changes, as applied (B23-B3) | applied: `sirkit.provider-suggestion.v1`, disposition `shown_never_applied`, behind an import gate; `sirkitVerdict: "none"` | confirmation only |
| OD-170 | what "visibly disabled" ordering is, as applied (B23-C) | applied: `manufacturing.provider-order` on `action-registry.ts:186` (`missing`, "explicitly blocked", `toolExposure: "none"`, approval tier `release`, Tier 3); the panel's fixed notice with no control (`ProviderExchangePanel.tsx:129`) | confirmation only |
| OD-171 | how ordering could ever be enabled, as applied (B23-C) | applied: `orderingEnablement()` disabled with all seven prerequisites missing (`ORDERING_OWNER_RECORD` null, `ORDER_SUBMISSION_PORT_WIRING` "none"); `SIRKIT_ORDERING_DISABLED` only turns it off, read from the process at each call | **owner action** to enable ordering: an owner record holding all seven runbook `:988-994` inputs AND a reviewed change that wires a submission port |
| OD-172 | the purchase-authorization contract, as applied offline (B23-C) | applied offline: the two-person, single-use, human-only authorization; the exact approved-importer gate; the order contract on an injected port; webhook verification (`b23-c-purchase-authorization` 11, `b23-c-order-contract` 16, `b23-c-webhook-verification` 7) | confirmation; no new role until the owner names one (`project_admin` only) |
| OD-173 | the Tier 3 vocabulary, as applied (B23-A2) | applied: the structural `external-transfer` side effect, `TIER3_FLOOR_PATTERN`, the `external-*` withdrawal, the consumed-tool name floor; the router's chat families unchanged | **open** (section 8 item 16): whether quote asks in chat should be refused by the router as a new Tier 3 family |
| OD-174 | the route vocabulary and the census, as applied (B23-A2); the route half, as applied (B23-B1) | applied in two parts: `externalTransfer` and `spend` on every row with `routeVocabularyViolations`, `outboundEgress` and `modelEgress`; one transfer row, POST /api/pcb/provider-exchange, census 166/163/3/0, no spend row | **open**: `POST /api/parts/search` and `GET /api/pcb/footprints/search` are public and send the anonymous caller's text to OpenAI with `provider_credit` false (recorded by A2, unchanged) |
| OD-175 | physical-evidence definitions, as applied (B23-D) | applied: eight closed kinds with validators; review by a qualified human `project_admin` through a port nothing wires; `assembledProductEligibility` blocked for every input; no record exists | confirmation; coverage of unit-scope kinds (every unit or a sample) is UNKNOWN (OD-187 (i)) |
| OD-176 | the latent CD-11/CD-12/CD-13 claim paths, as applied (B23-D) | applied: not rewired; no production caller pinned (`b23-d-latent-claim-paths`, 6); the hardening list in `physical-evidence.md` section 6 | confirmation; the hardening comes before any caller |
| OD-177 | `manufacturing.assembled-release` and its unblock condition, as applied (B23-D) | applied: one record kept `missing`, Tier 3, unreachable, both unblock conditions named (`:118`, `release-gate.ts:189`, `manufacturing-errors.ts:62`), pinned by id in a CI-admitted suite (`b23-d-assembled-release-blocked`, 6) | **open** (section 8 item 14): which chapter supplies the assembly-data authority (UNKNOWN, `physical-evidence.md` section 13) |
| OD-178 | the README and quickstart claim, as applied (B23 closeout) | applied: `README.md:41`, `docs/pcb-quickstart.md:6` and `:47` keep their words with a dated in-place note; pinned by `b23-closeout-statements` (8) | confirmation; the note generalises the drafted wording to "a provider's" (OD-188 (g)) |
| OD-179 | live-blocker rows, as applied (B23-A1) | applied: LB-11 and LB-12 in the register; `PROGRAM_STATE.json` `liveBlockers` mirrors LB-5, LB-11 and LB-12 | confirmation; LB-4, LB-6, LB-7 and LB-8 stay unmirrored by choice [superseded 2026-10-10 by B24-E (D24-33, OD-217): `liveBlockers` mirrors every row, one string per row, reversing OD-179's choice] |
| OD-180 | CI admission for B23 suites, as applied (B23-A1) | applied: `b23-` in `CHAPTERS`; one directory filter (`deterministic-manufacturing.yml:227`); B2's PGlite suite as an explicit database-delivery entry (`:301`); no live suite in CI | confirmation only |
| OD-181 | B23-A1: stated choices beyond its task text | applied, (a)-(g) | **open**: (a) no provider page was re-read in B23; (b) the off-only operator switch `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS` is passed to admission since B1, but admission refuses every transfer and order before it reads the switch (`provider-admission.ts:54-56` before `:59-60`), so it can switch off no provider exchange in B23 - a later change that admits a transfer must keep it effective |
| OD-182 | B23-A2: stated choices beyond its task text | applied, (a)-(k) | confirmation; (c) the specialist-claims check (`scheduler.ts:257-258`) does not follow the prefix withdrawal - a recorded residual |
| OD-183 | B23-B1: stated choices beyond its task text | applied, (a)-(h) | confirmation; (d) the cross-project backstops (64 scopes at their bounds refuse other projects' previews for up to 10 minutes or commits for up to 24 hours); (g) the board name |
| OD-184 | B23-B2: stated choices beyond its task text | applied, (a)-(r) | **attention**: (m) an interrupted `sent` attempt blocks its package until a reconciliation read exists, and none is built; (o) the provider exchange route's B16.0.2 row stays `read` while no transfer descriptor exists |
| OD-185 | B23-B3: stated choices beyond its task text | applied, (a)-(s) | confirmation; (c) the copied matcher; (o) `terms.answerLicense` is UNKNOWN for every provider |
| OD-186 | B23-C: stated choices beyond its task text | applied, (a)-(p), amended by the review round and the lead round | confirmation; (k) requests, authorizations, orders and the replay store live in memory - a durable store is the enabling increment's |
| OD-187 | B23-D: stated choices beyond its task text | applied, (a)-(s), amended by the review round, both lead-fix rounds and the lead round | confirmation; (i) coverage UNKNOWN; (c) no new reviewer role |
| OD-188 | B23 closeout (1/2): stated choices beyond its task text | applied, (a)-(i) | confirmation; (a) `providerRow`, the render's `rows` parameter and the `provider-registry.ts:16` sentence wait for the next reviewed registry revision |
| OD-189 | - | reserved for the increments and unused | - |

## Discovery defects D23-1..21

Severity as the discovery's tally states it (high 6, medium 6, low 9). "Closed" means every clause of the defect is closed; a RECORDED
residual its clauses or pages name is listed beside it. "Closed offline" means the contract is built and tested offline and its live
half is a live blocker. The live column names the live blocker under which the defect's live half stays.

| defect | severity | title | state | by | live |
|---|---|---|---|---|---|
| D23-1 | high | No reviewed descriptor exists for any manufacturer, assembler or quote service. | closed: nine reviewed, deep-frozen, validated rows (`b23-a-provider-registry` 94 tests, `b23-a-provider-admission` 11). RECORDED: every provider fact is section 1.2's 2026-10-01 summary, not re-read (OD-181 (a)); CD-12's descriptor still has no production caller | A1 | LB-11, LB-12 |
| D23-2 | medium | Neither descriptor shape can express the B23-A fields. | closed as a shape: all twelve runbook fields typed, UNKNOWN only with a reason (82 UNKNOWN records), per-operation tier, channel and state. RECORDED: the values are largely UNKNOWN - in the CSV's 9 rows, outbound retention on 9, the webhook signature on 8, the operation endpoints, idempotency, cancellation and outbound confidentiality on 7 each, legal identity, region, currency and upload limits on 5 each, the API version and quote limits on 4 each (counted at `b6c6b0d`, CONFIRMED; the CSV is unchanged since `79fa18b`) | A1 | |
| D23-3 | high | The single egress boundary cannot send an upload. | closed: `outboundUpload` (`outbound-fetch.ts:487`), the in-memory body measured before resolution (`b23-b-bounded-upload` 10). RECORDED: the rebinding window stays OD-51's limit | B2 | LB-11 |
| D23-4 | high | No outbound idempotency and no ambiguous outcome state; the only side-effect dispatcher retries automatically. | closed: the exchange half by B2 (`b23-b-exchange-ledger` 28 cases and `b23-b-exchange-ledger-pglite` 5 - the closure clause and the README's B2 row still give 22 and 4, the counts before B2's lead round; `b23-b-egress-import-gate` 6); the order-contract half offline by C (`b23-c-order-contract` cases 4-6, 9, 10). UNKNOWN: a production PostgreSQL's isolation level under two interleaved commits (section 8 item 10, narrowed) | B2, C | LB-11, LB-12 |
| D23-5 | high | No receipt, quote or staleness store, and the release ledger keeps digests only. | closed: receipts by B2 (no raw provider body, no archive byte), staleness by B3 (`b23-b-stale-quote` 14). RECORDED: no live observation exists | B2, B3 | LB-11 |
| D23-6 | high | Nothing presents exactly which files and metadata would leave, and the release manifest would disclose internal identifiers. | closed with a stated deviation: the exact disclosure (plan and panel, every file and field); the project id (or its kept prefix) and the board id leave inside the board's file-safe name, disclosed and never stripped (OD-163, OD-183 (g)); tenantId, branchId, designId and the actor occur in no outbound byte | B1 | LB-11 |
| D23-7 | high | No per-request approval names a provider and purpose, and the release revalidation is not reusable. | closed: `revalidateReleaseAuthority` (`release/route.ts:145`, called at `:91`), the sealed plan and the commit (`b23-b-revalidation` 23, `b23-b-approval-plan` 18, `b23-b-exchange-route` 14); every commit in B23 ends `provider_not_admitted` and fetches nothing | B1 | LB-11 |
| D23-8 | medium | The Tier 3 floor and the exposure vocabulary see a file-sending or spending tool only by a word in its id. | closed (`b23-a-tier3-vocabulary` 9). RECORDED residuals: the claims check does not follow the prefix withdrawal (OD-182 (c)); a quote ask in chat reaches nothing rather than being refused (section 8 item 16) | A2 | |
| D23-9 | medium | The route vocabulary cannot mark an external-transfer or spend route. | closed: the vocabulary by A2 (`b23-a-route-vocabulary` 8), the one transfer row by B1 (census 166/163/3/0). The clause cites `route-policy.ts:358` and `:375`, now `:360` and `:377` (section 10's B1 line records the move) | A2, B1 | |
| D23-10 | medium | Ordering is absent, not visibly disabled, and nothing can hold the owner's seven prerequisites. | closed: `orderingEnablement()` disabled, the `missing` record, the panel notice with no control (`b23-c-ordering-disabled` 7) | C | LB-12 |
| D23-11 | low | Nothing exists for the enabled ordering path: no purchase authorization, decimal ceiling, mint/consume import gate or webhook verification. | closed offline: the purchase authorization, the order contract and webhook verification, with no production caller | C | LB-12 |
| D23-12 | low | The no-order route tripwire matches names, and a foreign MCP tool is excluded only by its own annotations. | closed (`b23-a-no-order-structural` 6). RECORDED limit: a neutrally named function that posts to an order endpoint is seen only through the classification's `observation-query`; the consumed-tool name refusal claims no completeness; the MCP registry stays empty (OD-48) | A2 | |
| D23-13 | medium | No server-owned definition of physical-hardware evidence. | closed offline: eight closed kinds with validators, review through a port nothing wires (`b23-d-physical-evidence-contract` 16); no record exists and nothing creates one | D | LB-5 |
| D23-14 | medium | Latent library paths could advance a production or hardware claim without physical evidence. | closed, not rewired: no production caller pinned for the five functions and their counterexamples executed (`b23-d-latent-claim-paths` 6); the hardening list stands before any caller | D | |
| D23-15 | low | The assembled-release block is pinned only generically, and its stated unblock condition omits physical evidence. | closed: both conditions named in the note, the gate's refusal and the public message; pinned by id (`b23-d-assembled-release-blocked` 6). RECORDED: the gate's own runtime pin `manufacturing-release-gate.test.ts` is in no CI workflow; the lead ran it once on D's final tree (5 of 5) | D | LB-5 |
| D23-16 | low | Two documents claim a quote-tool acceptance no record supports. | closed: three dated in-place notes (`README.md:41`, `docs/pcb-quickstart.md:6`, `:47`) and the tripwire (`b23-closeout-statements` 8). RECORDED: its claim vocabulary is finite (19 forms; a phrasing outside them is not seen, OD-188 (h)) | closeout (1/2) | |
| D23-17 | low | The reload-time "current" flag compares the authority by revision only. | closed: revision AND the authoritative digest (`b16-a-manufacturing-summary`, two new cases; `b23-b-stale-quote` cases 1, 6, 11); the counterexample CONFIRMED by execution on `0cd3f59` | B3 | |
| D23-18 | low | Only the JLCPCB two-layer bare-board profile can produce the release a provider would receive. | closed as the discovery defines it (the mapping recorded): JLCPCB maps `jlcpcb-2l`, every other row `unmapped` with a reason. RECORDED: the scope limit stands - only a ledgered `jlcpcb-2l` bare-board release can be offered; its evidence expires 2027-09-09 (section 8 item 15) | A1 | |
| D23-19 | low | No live-blocker row covers live DFM/quote exchange or an ordering sandbox, and the state file omits LB-5. | closed: the operations' reasons by A1 (case 7), the register rows LB-11 and LB-12 and the `liveBlockers` mirror of LB-5, LB-11 and LB-12 by the lead in A1's commit `79fa18b` | A1 (and the lead) | |
| D23-20 | low | CI admits no B23 suite. | closed: `b23-` in `CHAPTERS`, the directory filter `:227`, and B2's database-delivery entry `:301` | A1, B2 | |
| D23-21 | low | Four CD-12 throwing stubs are pinned by no test. | closed: pinned by id (`b23-a-cd12-stubs` 9); a missing pin, not a code defect | A2 | |

Counts: 21 defects, all closed - D23-11 and D23-13 offline only, with their live halves under LB-12 and LB-5; D23-4 with its order half
offline; D23-18 as the recorded mapping with its scope limit standing - each with the RECORDED residuals its row names; none in part,
none open. The generator's draft counted 16 closed, 3 in part and 2 open (see the opening paragraph); this table supersedes it.

## Unknowns and blocked items named by the discovery (section 8)

1. **UNKNOWN** - which providers the owner wants and whether any approved API access exists: still UNKNOWN. OD-160 is unanswered, so
   B23-B4 did not run and the flow is fake-backed (LB-11).
2. **UNKNOWN** - JLCPCB's authentication, webhook signature, sandbox, idempotency, rate limits, retention and payment flow: still
   UNKNOWN; the registry row records each as UNKNOWN with its reason (`provider-registry.md` section 3), not re-read (OD-181 (a)).
3. **UNKNOWN** - PCBWay's webhooks, `PONumber` uniqueness, rate limits and retention, and whether its "sandbox" comment is a real sandbox:
   still UNKNOWN; its endpoint paths are INFERRED from the help pages' names (OD-181 (e)).
4. **UNKNOWN** - OSH Park's sandbox, webhooks, rate limits and API base path, and the owner's account type: still UNKNOWN; the checkout
   is recorded as never called. Its unauthenticated import upload is the one transfer that would need no account; it stays disabled
   because B23 admits no transfer (`provider-registry.md` section 9).
5. **UNKNOWN** - MacroFab's sandbox, webhooks, rate limits, retention and quote expiry: still UNKNOWN; OD-168's 24-hour default applies to
   any answer without a stated validity.
6. **UNKNOWN** - DigiKey Quote-v4 validity and line limits, webhooks, duplicate purchase-order handling, and whether the API agreement
   permits storing quote receipts: still UNKNOWN (the snippet's 30 days and 300 products INFERRED only). A provider whose terms forbid
   storage keeps ids, digests and timestamps only (OD-184 (k)).
7. **UNKNOWN** - Mouser's API terms and order page (timed out 2026-10-01): still UNKNOWN; Mouser stays disabled (OD-32).
8. **UNKNOWN** - whether Eurocircuits offers any customer API: still UNKNOWN; `handoff` only, no host, no API operation.
9. **INFERRED** - no provider read documents a webhook signature or an idempotency key, and DigiKey alone documents an ordering sandbox:
   unchanged. B23-C's webhook contract is Sirkit's own (OD-186 (j)), checked against no provider's documents (`ordering-boundary.md`
   section 12), and is re-checked against a provider's documents before any enablement.
10. **INFERRED / UNKNOWN** - a concurrent duplicate durable commit never writes twice: narrowed, not closed. Two concurrent commits send
    once in memory and on PGlite (`b23-b-exchange-ledger-pglite`, one connection, the database-delivery job); a production server's
    isolation level stays UNKNOWN (`dfm-quote-flow.md` section 6).
11. **CONFIRMED (answered by B22)** - B22-A1's edits do not reach the deterministic release: unchanged; B23's package is built from the
    release only.
12. **ANSWERED by B22** - B22 spent OD-153..OD-159: unchanged. B23 used OD-160..OD-188, LB-11 and LB-12; OD-189 stays unused.
13. **RECORDED** - the co-author trailer: every one of the 15 B23 commits to `b6c6b0d` is authored and committed by Dandi Desta
    <dandidesta82@gmail.com>, with no `Co-Authored-By` line and no AI attribution (`git log 43cb1b0..HEAD --format=%B`: 0 matches).
14. **UNKNOWN** - whether `manufacturing.assembled-release` means releasing assembly data to an assembler or the assembled-product claim
    after a build: answered by OD-177's default - one record naming both conditions (B23-D). Which chapter supplies the assembly-data
    authority stays the owner's question (`physical-evidence.md` section 13, UNKNOWN).
15. **RECORDED** - the `jlcpcb-2l` rule-profile evidence expires 2027-09-09: unchanged; every release refuses after it, and an
    observation goes stale with it (B3's profile-evidence reason). Who re-transcribes the evidence is the owner's question.
16. **UNKNOWN** - whether quote asks in chat should be refused by the router as a new Tier 3 family: unchanged; the router's chat
    families are unchanged and no tool reaches a provider (OD-173).
17. **UNKNOWN** - whether the public, cache-only cart and packet routes (OD-31) should stay public once provider transfers exist:
    unchanged; they call no provider.
18. The open design questions carried to the owner table: every OD above, with its state.
19. **BLOCKED-LIVE-QUALIFICATION** - the live behaviour of any provider (an upload's reception, DFM findings, quotes, receipts,
    webhooks, ordering) and any physical build: unchanged under LB-11, LB-12 and LB-5; recorded, never converted into a claim.

## Other UNKNOWN, INFERRED and BLOCKED items the B23 pages record

From each page's "What stays open" section, its per-row readings and the ledger's lead closes:

- **The provider rows** (`provider-registry.md` section 3): per row, the facts no 2026-10-01 summary held stay UNKNOWN with their
  reason - legal entity, API version and endpoints, region and currency, retention and confidentiality, upload and quote limits,
  webhooks, idempotency, cancellation (82 UNKNOWN records in the CSV). RECORDED
- **The CD-12 kind words** `authorized_distributor` and `approved_aggregator` name a kind, not an authorization; nothing evaluates them
  (`provider-registry.md` section 9). INFERRED
- **The operator switch** `SIRKIT_MANUFACTURING_DISABLED_PROVIDERS` is consulted only below the transfer tier, so no runtime path reads
  it for an exchange in B23 (OD-181 (b) above; the closeout (1/2) rejected its CS-B18 and CS-B19 for the same reason,
  `closeout-statements.md` section 6). CONFIRMED by reading `provider-admission.ts:54-60`
- **A1's lead close** (`EXECUTION_LEDGER.md`, B23-A1 (4)): a path a section-1.2 bullet names passes on any host that bullet names
  (INFERRED, low); admission validates the row on every call (a small cost, INFERRED); `b20-b4-process-gate` case 1 still runs about
  34 s synchronously (RECORDED).
- **Runtime human-only enforcement** of a transfer row is labelled PROPOSED on A2's page (`tier3-vocabulary.md` section 12); B1 built
  it (`b23-b-exchange-route` cases 5-7: a non-administrator, an `ai`, `automation` or `system_migration` actor and a non-`project_admin`
  human refused before any durable read), CONFIRMED by those cases in the final run. A2's page carries no note.
- **The cache-only exemption** rests on the pricing gateway's pins; its internals beyond them are INFERRED. **`modelEgress` follows
  names, not values** (INFERRED: no module-level client registry exists in the reached code today) (`tier3-vocabulary.md` section 12).
- **A project id over 74 file-safe characters** leaves cut short in the board name; whether a deployment uses one is UNKNOWN
  (`outbound-disclosure.md` section 1).
- **Plans are per process** (OD-183 (d)): a commit routed to another instance first reads the durable record under its key -
  CONFIRMED for a restart over one store (`b23-b-exchange-ledger` cases 5 and 23), INFERRED for another instance
  (`outbound-disclosure.md` section 11).
- **The Java-capable `app/lib/pcb` suites** (`autoroute-boundary-integrity`, `autonomous-layout-qualification`,
  `manufacturing-release-gate`) ran in no B23 gate from B1 on, by rule; the lead ran `manufacturing-release-gate.test.ts` once,
  deliberately, on B23-D's final tree (5 of 5). RECORDED
- **The exchange** (`dfm-quote-flow.md` section 13): a production PostgreSQL's isolation level UNKNOWN; reconciliation not built, so an
  interrupted `sent` attempt blocks its package (RECORDED), with one INFERRED residual (a late `sent` mark whose `not_sent` settle cannot
  be written); the abandonment bound reads two instances' clocks (INFERRED for the skew); the request waits for a slow durable write
  (INFERRED); the rebinding window (OD-51, RECORDED); the meters are per process (INFERRED); a record per (scope, board, provider) grows,
  and the `sent` mark re-reads its whole history inside the deadline (INFERRED).
- **The observations** (`dfm-quote-flow.md` section 25): a provider's own field names are the reviewed transfer descriptor's to map
  (RECORDED); the screen is defence in depth (OD-81's limit, RECORDED); the copied matcher must move with A2's (RECORDED); a digest at
  every read (INFERRED cost); every project member who can read GET /api/pcb-sync sees observations, automation included (RECORDED);
  the release and qualify routes load the observation modules and never call them (RECORDED); a withdrawn provider stays listed only if
  its id is appended to `OBSERVATION_WITHDRAWN_PROVIDER_IDS` (RECORDED); **the answer's licence is UNKNOWN for every provider**
  (`terms.answerLicense`), so the licensing part of the runbook's `:140` is unmet - BLOCKED-LIVE-QUALIFICATION (LB-11); the list's clock
  re-judges expiry only (RECORDED); nine sequential record reads per hydration, four that can never return a record (INFERRED cost).
- **Ordering** (`ordering-boundary.md` section 12): none of the seven prerequisites supplied and no new role (RECORDED); reconciliation
  of an `UNKNOWN_PENDING_RECONCILIATION` order not built (RECORDED); the stores in memory, so several instances would each hold their own
  (INFERRED); the webhook contract checked against no provider's documents (RECORDED); the operator switch takes effect per call
  (INFERRED).
- **Physical evidence** (`physical-evidence.md` section 13): no physical evidence exists (BLOCKED-LIVE-QUALIFICATION, LB-5); the
  assembly-data authority does not exist, and which chapter supplies it is UNKNOWN; coverage of unit-scope kinds UNKNOWN (OD-187 (i));
  whether a future server resolves operators correctly UNKNOWN (B24-E's port); the evaluator judges only the records it is given
  (RECORDED); the five latent paths stay unhardened; no clock refuses a review dated in the future (RECORDED); equal instants (RECORDED);
  a removal never relaxes a rule, a duplicate never takes back what a record imposes, a disposition that does not satisfy holds nothing
  open by itself, and a lot can be counted out with a unit left (each INFERRED for the general claim; the last two are owner questions
  for the recording route, B24-E).
- **The B11-scanned files** carry no B23 identifier and are unchanged since `43cb1b0` (a grep at `b6c6b0d` of the nine files
  `app/lib/agent/orchestration/tripwires.ts` lists); no B23 suite pins it. RECORDED
- **Stale statements the lead's records keep** (named for the lead, not edited here): D23-4's closure clause and the README's B2 row
  give `b23-b-exchange-ledger` 22 and the PGlite suite 4 (28 and 5 since B2's lead round), and the README's B2 row gives
  `b23-b-dfm-quote-flow-page` 5 (6 since that round, 10 with B3's four); LB-11's check cell cites runbook `:973-984`, while B23-B is
  `:971-982` (steps `:975-982`) and `:984` is B23-C's heading.

## Live blockers

| LB | check | classification | B23's relation |
|---|---|---|---|
| LB-1..LB-4, LB-6..LB-10 | (B16-B22's rows) | as recorded | unchanged by B23; B23 called no provider, and every browser run used the fixture runtime |
| LB-5 | Physical fabrication, assembly, incoming inspection, functional test | not attempted [superseded 2026-10-10 by B24-E (D24-33, OD-217): BLOCKED-LIVE-QUALIFICATION in OD-217's form; nothing records physical evidence until the owner answers OD-218, and the store, the route and the port are then their own increment] | B23-D's dated note in its row: physical evidence is defined offline only (eight closed kinds, a review contract nothing wires, an evaluator blocked for every input); no record exists and nothing can create one. Unblocks with the owner's approval and hardware (B24-E). Mirrored in `liveBlockers` since A1 |
| LB-11 | Live DFM/quote exchange with a manufacturer or quote API | BLOCKED-LIVE-QUALIFICATION | **added by B23-A1 (OD-179)**: the registry records every DFM/quote transfer operation and enables none; admission refuses each `provider_not_admitted`; B2's dated note (a reviewed transfer descriptor is also needed; none exists) and the closeout (1/2)'s dated note (the flow is built since B1-B3 and CONFIRMED offline against an in-process fake provider behind the real egress boundary). Unblocks when the owner supplies an approved account with a sandbox or staging path (OD-160) and approves the outbound files (OD-163, OD-166); then the opt-in B23-B4 runs locally, never in CI. Its check cell's runbook range is stale (above) |
| LB-12 | Ordering through a provider sandbox | BLOCKED-LIVE-QUALIFICATION | **added by B23-A1 (OD-179)**: nine ordering operations present but disabled; B23-C's dated note: the contract exists offline only, `orderingEnablement()` answers disabled, no composition root wires a port. Unblocks only with OD-171's owner record holding all seven inputs AND a reviewed change that wires a submission port; never by an environment variable |

## Owner questions open at the close of B23 (one list)

The provider account first: OD-160 - name the providers and supply an approved account with a sandbox or staging path; until then
every live DFM/quote exchange (LB-11) and every order (LB-12) stays BLOCKED-LIVE-QUALIFICATION and B23-B4 does not exist. Then: OD-171
(the seven ordering prerequisites, and a reviewed port wiring, before ordering can ever be enabled), OD-163 and OD-183 (g) (whether a
provider may receive the board's file-safe name, which carries the project and board ids), OD-174 (the two public searches that send
anonymous text to OpenAI), OD-181 (a) (a person re-reads each provider's own pages before any tier rises) and (b) (an admitted transfer
must keep the operator switch effective), OD-184 (m) (a reconciliation read, before an interrupted exchange can be unblocked), OD-177 and
section 8 item 14 (which chapter supplies the assembly-data authority), OD-187 (i) (unit-scope coverage), section 8 items 15-17 (the
2027-09-09 evidence expiry, quote asks in chat, the public cart and packet routes), and the answer licence for every provider
(`terms.answerLicense`, LB-11). Every other OD carries only a confirmation.
