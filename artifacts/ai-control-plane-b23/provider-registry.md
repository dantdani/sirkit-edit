# B23-A1 - the provider registry with reviewed descriptors

Labels: **CONFIRMED** (executed and measured here, or read at the cited file:line), **INFERRED** (a conclusion from reading code or a
document; nothing executed it), **RECORDED** (written down from a document or a reader's observation, without a claim of our own),
**UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Tree: `chapter/b23-external-manufacturing`, base `3806cba` (the B23 discovery). Closes D23-1, D23-2, D23-18 (the mapping) and D23-20,
and the code half of D23-19 (every transfer names LB-11 and every order LB-12; the register rows and the `PROGRAM_STATE.json` mirror
are the lead's). Owner decisions applied: OD-161, OD-162, OD-179 (code half), OD-180; A1's own choices are OD-181 (section 9).

## 0. What B23-A1 is

- **A sibling registry, never B19's (OD-161).** `app/lib/manufacturing-providers/provider-registry.ts` holds a version constant
  (`PROVIDER_REGISTRY_VERSION = "1.0.0"`), nine deep-frozen rows, `validateProviderRegistry` (22 rules) and a pure CSV render. B19's
  `app/lib/acquisition/source-registry.ts` and its two registry suites are untouched; the one B19 file A1 edits is the CI guard's
  `CHAPTERS` line (section 7). CONFIRMED (`git diff --stat`).
- **Admission per provider and per operation tier** (`provider-admission.ts`, `admitProviderOperation`), pure over the registry and
  the environment it is given. Nothing outside the directory imports it (pinned, `b23-a-provider-admission` case 8). CONFIRMED
- **The CD-12 projection** (`cd12-projection.ts`, `toProcurementProviderDescriptor`): a row becomes CD-12's existing
  `ProcurementProviderDescriptor` through `createProviderDescriptor`; no third shape. CONFIRMED
- **The artifact** `provider-registry.csv` in this directory, rendered by `scripts/generate-b23-provider-registry.ts` and equal to the
  render byte for byte (`b23-a-provider-registry` case 15). CONFIRMED
- **No route, no tool, no UI, no egress, no fetch.** No provider was contacted, no page was read, no account, application, credential,
  upload or order exists. The route census and the agent-tool counts do not move (section 8). CONFIRMED

## 1. The registry and the twelve runbook fields

Each row is a closed object: twenty keys, the twelve runbook B23-A fields (`Sirkit_Remaining_Builder_Master_Runbook.md:956-967`) among
them, in the runbook's order (`RUNBOOK_FIELDS`). Every nested block, operation, UNKNOWN record and B19 reference has exactly its keys
(case 2; rule `closed-keys`).

| runbook field | row key | type |
|---|---|---|
| legal provider identity | `legalIdentity` | a value, an UNKNOWN record, or (a distributor) `{ b19, path: "provider.organization" }` |
| endpoint/API version | `endpoint` | `hosts` (callable, exact), `documentedHosts` (named, never called, exact), `apiVersion` |
| credential reference and account scope | `credentials` | `references: { env, role }[]` (an environment variable NAME only), `accountScope` |
| supported operations | `operations` | each with its own `tier`, `channel`, `state`, `reason`, `endpoint`, `auth`, `neverCalled`, `source` (D23-2) |
| region/currency | `regionCurrency` | `region`, `currency` (a distributor's by B19 reference) |
| capability-profile mapping | `capabilityProfile` | `jlcpcb-2l` with `profileId`, `version`, `digest`, `evidenceExpiresAt`, or `unmapped` with a reason |
| data retention/confidentiality terms | `outboundTerms` | `retention`, `confidentiality` - for what Sirkit SENDS, not B19's licence for what Sirkit keeps |
| upload and quote limits | `limits` | `upload`, `quote` |
| webhook/signature contract | `webhook` | a value or UNKNOWN |
| idempotency support | `idempotency` | a value or UNKNOWN |
| order/cancellation policy | `orderPolicy` | `order`, `cancellation` |
| enabled feature tier | `enabledFeatureTier` | the highest tier among the row's enabled operations, or `none` (rule `feature-tier`) |

Beside them each row carries `id`, `displayName`, `kind` (`manufacturer`, `assembler`, `quote_service`, `distributor`), `b19Source`,
`reading`, `documentation` (`{ url, readOn }`), `notes` and `apiAccess` (`enabled`, `disabled`, `blocked`, `none_found`, with a reason
and an owner decision). A value nobody could read is the literal `UNKNOWN` with its reason, never a bare or embedded UNKNOWN (rule
`unknown`; 82 UNKNOWN records across the nine rows, all 82 in CSV cells since the review correction rendered each operation's
endpoint and authentication, section 11). CONFIRMED

**Distributor rows reference B19.** DigiKey, Mouser, Nexar (B19's `octopart`) and LCSC name their B19 entry in `b19Source`. Their read
operation is B19's, by reference (`{ b19, path: "endpoints" }`, `{ b19, path: "auth" }`), recorded exactly once with B19's state
(enabled, disabled, enabled, blocked); their `apiAccess` mirrors B19's status. They declare no host, no documented host and no
credential reference, and their endpoints, credentials, operations and notes spell none of B19's hosts or secret names (case 10).
CONFIRMED

## 2. The tier vocabulary (OD-162)

| tier | meaning | channel | B23 rule |
|---|---|---|---|
| `none` | nothing enabled (a row's tier only, never an operation's) | - | MacroFab's row |
| `handoff` | a deep link, a CSV download or a manual upload a person completes; never an API call | `deep_link`, `csv_export`, `manual_upload` | enabled where Sirkit or the provider offers one; no credential, no host |
| `read_observation` | a read through an API | `api` | only B19's distributor reads are admitted, through B19's own admission |
| `dfm_quote_transfer` | design or part data leaves Sirkit for a DFM check or a quote | `api` | never enabled: no owner decision names an account (OD-160); admission refuses `provider_not_admitted` (LB-11) |
| `ordering` | a cart, an order, a payment, a cancellation | `api` | never above disabled (runbook `:986`); admission refuses `provider_not_admitted` (LB-12) |

A hand-off is exactly a non-`api` channel, and an `api` operation is never a hand-off (rule `handoff`, runbook `:969`). A row with no
official API (`none_found`) records hand-offs only and names no host (rule `no-api-row`). A blocked row declares no callable host and
no secret (rule `blocked-row`). A callable host exists only for an enabled API operation, so no row declares one in B23 (rule
`callable-hosts`; case 9). CONFIRMED

The operations, per provider (37; the registry suite's case 6 pins this table):

| provider | API access | enabled tier | operation: tier / channel / state |
|---|---|---|---|
| JLCPCB | blocked | handoff | `pcb-quote` dfm_quote_transfer / api / blocked; `pcb-order` ordering / api / disabled; `manual-quote-upload` handoff / manual_upload / enabled; `dfm-web-tool` handoff / manual_upload / enabled |
| PCBWay | blocked | handoff | `pcb-quotation`, `smt-quotation` dfm_quote_transfer / api / blocked; `place-order`, `confirm-order`, `cancel-order` ordering / api / disabled; `query-order-process` read_observation / api / blocked; `online-quote-upload` handoff / manual_upload / enabled |
| OSH Park | disabled | handoff | `import-upload`, `api-upload` dfm_quote_transfer / api / disabled; `checkout` ordering / api / disabled, never called; `manual-upload` handoff / manual_upload / enabled |
| MacroFab | disabled | none | `upload`, `dfm-readiness`, `pcb-quote` dfm_quote_transfer / api / disabled; `order-read` read_observation / api / disabled |
| Eurocircuits | none_found | handoff | `web-quote` handoff / manual_upload / enabled |
| DigiKey | enabled (B19, OD-33) | read_observation | `product-information` read_observation / api / enabled (B19's); `bom-upload-link` handoff / deep_link / enabled; `cart-csv` handoff / csv_export / enabled; `quote` dfm_quote_transfer / api / disabled; `ordering` ordering / api / disabled |
| Mouser | disabled (B19, OD-32) | handoff | `part-number-search` read_observation / api / disabled (B19's); `bom-upload-link` handoff / deep_link / enabled; `cart-csv` handoff / csv_export / enabled; `cart`, `order` ordering / api / disabled |
| Nexar (Octopart) | enabled (B19, OD-33) | read_observation | `supply-search` read_observation / api / enabled (B19's) |
| LCSC | blocked (B19) | handoff | `product-search` read_observation / api / blocked (B19's); `order-create` ordering / api / disabled; `check-order`, `get-shipment` read_observation / api / blocked; `bom-tool-link` handoff / deep_link / enabled; `cart-csv` handoff / csv_export / enabled |

The hand-offs Sirkit already offers are the repository's and cite the file that offers them (CONFIRMED, case 8): the three
manufacturer presets' notes shown in the Send to fab dialog (`app/lib/pcb/fab/presets/jlcpcb-2l.fab.json`, `pcbway-standard.fab.json`,
`oshpark-4l.fab.json`), B19-E's upload-page links (`app/lib/distributor-links.ts`) and the three cart CSV routes
(`app/api/bom/cart/{digikey,mouser,lcsc}/route.ts`). The JLCPCB DFM web tool and the Eurocircuits quotation page are hand-offs section
1.2 records and Sirkit does not link today (RECORDED). Ordering is recorded present-but-disabled wherever a provider documents it (nine
operations), and OSH Park's checkout is recorded as never called (`neverCalled: true`; OD-162). Every transfer operation's reason names
LB-11 and every ordering operation's names LB-12 (case 7).

## 3. The rows: what was read, when, by whom, and what stays UNKNOWN

Every provider fact below is **RECORDED** by reader 7 on 2026-10-01 through WebFetch and WebSearch (which return a summary of the page),
as the discovery's section 1.2 holds it; each row's `reading` says so and each documentation URL is dated 2026-10-01 and named in
section 1.2 (case 5: whole in one provider bullet, or by its whole path beside its host, or by its last segment beside a sibling page
in the same directory; section 11). **A1 did not re-read any page**: this is a stated deviation from OD-162's "re-read before commit" (OD-181, section
9). No tier rises in A1, so no decision rests on a fresher reading. A fact section 1.2 does not hold stays UNKNOWN with that reason; a
fact that would need a login, an application or a credential to read stays UNKNOWN.

- **JLCPCB** (manufacturer; API access blocked, OD-162). Read: the API platform (`https://api.jlcpcb.com/`: PCB API with real-time
  quotations, ordering and order lifecycle management; Stencil, 3D Printing and Components APIs; apply for access, then create an app),
  the access article (an account and an application reviewed on orders and business, not all approved; JLCPCB has no access to API
  partners' customers' information), the API list, request-signature and start pages (client-rendered: navigation only), and the DFM
  web tools `https://dfm.jlcpcb.com/` and `https://jlcdfm.com/` (no DFM API found). A third-party header description seen only in a
  search snippet is unofficial and not relied on. Documented host `api.jlcpcb.com`. Capability `jlcpcb-2l` (section 5). UNKNOWN: legal
  entity; API version; both operations' endpoints and authentication; region and currency; retention; upload and quote limits;
  webhook signature; idempotency; cancellation.
- **PCBWay** (manufacturer; blocked, OD-162). Read: the Partner API cooperation page (requested by email, reviewed by PCBWay; the
  Assembly API under construction; PCBWay does not know partners' customers' information; `https://www.pcbway.com/api.html` returned
  404), the help index and example on `api-partner.pcbway.com` (an `api-key` request header; the only sandbox mention is a code
  comment on the same host over plain http), and the PcbQuotation (parameters only, no file; priceList, BuildDays, shipping), PlaceOrder
  (DataZipFile base64 or PcbFileUrl, optional PONumber), ConfirmOrder (PayType AccountPay or PCBWayWebPay; TotalAmount and
  AccountBalance) and CancelOrder (OrderNo only) pages. The endpoint paths are read from the help pages' names (INFERRED). UNKNOWN:
  legal entity; API version; the SMTQuotation and QueryOrderProcess routes; region and currency; retention (the partner PDF came back
  as binary); quote and rate limits; webhooks; whether a repeated PONumber is refused.
- **OSH Park** (manufacturer; disabled, no account, OD-162). Read: the developer page (an official REST/JSON API for Uploads, Projects
  and Orders with a short-lived session token; the resources page returned 404), the import tips (a multipart POST to `/import` or
  `/import.json`, or `oshpark.com/import` with a url parameter; no authentication; no previews or warnings; the person finishes in the
  browser) and the Ruby client README (email plus password or an API secret; `add_item` and `checkout`; no card payment through the
  API; invoiced customers' orders proceed automatically). Documented host `oshpark.com`. The checkout is recorded as never called.
  UNKNOWN: legal entity; API base path and version; the API endpoints; region and currency; retention and confidentiality; upload and
  quote limits; webhooks; idempotency; cancellation.
- **MacroFab** (manufacturer; disabled, no account, OD-162). Read: the API-key page (the `X-MacroFab-API-Key` header; one snippet says a
  URL parameter, probably older docs), the reference pages and `llms.txt` (64 entries): DFM readiness
  `/api/v5/pcb/{pcb_id}/{pcb_version}/ready/{quantity}` (errors, warnings, info, available actions), the PCB quote
  `/api/v4/quote/pcb/{id}/{version}/{quantity}` (totals, business days, due date, `valid`, `invalid_reasons`, no documented expiry),
  read-only order endpoints, Sign S3 Upload and ingestion workflows, a testbench results API. Documented host `api.macrofab.com`.
  Enabled tier `none` (no hand-off is recorded for it). UNKNOWN: legal entity; the upload and order paths; region and currency;
  retention and confidentiality; upload and rate limits; webhooks; idempotency; cancellation.
- **Eurocircuits** (manufacturer; `none_found`, hand-off only, OD-162). Read: two searches found web quoting
  (`https://www.eurocircuits.com/ask-for-a-quotation/`) and the PCB Visualizer; the API mentions describe Eurocircuits' own supplier
  links. No host, no API operation, no scraping (runbook `:969`). UNKNOWN: legal entity; whether any customer API exists; region and
  currency; retention and confidentiality; cancellation.
- **DigiKey** (distributor, B19 `digikey`; enabled reads, OD-33). Read: the products page (Quote, Ordering, Order Status, MyLists,
  Product Information V4), the ordering page (an active DigiKey Credit account; only 3-legged OAuth; a sandbox mode), the documentation
  and FAQ (sandbox apps cannot call production; tokens 10 or 30 minutes; Product Information 120 a minute, Ordering 10 a minute; a 429
  carries Retry-After; locale headers set site, language and currency) and the undated API user agreement. Quote and Ordering are
  recorded, disabled. UNKNOWN: retention and confidentiality of a quote or order request; Quote-v4 validity and line limits (a snippet's
  30 days and 300 products is INFERRED only); the Quote and Ordering paths; webhooks; duplicate purchase-order handling; cancellation.
- **Mouser** (distributor, B19 `mouser`; disabled, OD-32). Read: the V1 specification (Search, Cart, Order and OrderHistory groups;
  `POST /api/v{version}/order` with SubmitOrder true submits, false previews; `order/options/query`; an `apiKey` query parameter; no
  sandbox). The API hub, both API-terms paths and the order page timed out on 2026-10-01; B19's 2026-09-13 reading of the terms stands.
  The cart and order APIs are recorded, disabled. UNKNOWN: retention and confidentiality; the cart paths; cart and order rate limits
  (a snippet's 30 a minute and 1000 a day is INFERRED only); webhooks; idempotency; cancellation.
- **Nexar** (distributor, B19 `octopart`; enabled reads, OD-33). Read: the authorization article (client credentials with scope
  `supply.domain`, or authorization code with PKCE; tokens 24 hours; no ordering scope), the API legal terms (August 1, 2022), the part
  limits and FAQ articles (limits reset monthly; the Evaluation limit conflicts between pages; a 90-second timeout). Read observations
  only; no ordering (no order or quote-to-order path, INFERRED). UNKNOWN: how Nexar keeps or protects the queries Sirkit sends; webhooks.
- **LCSC** (distributor, B19 `lcsc`; blocked). Read: the Open API index (product APIs plus Order Create, Check Order and Get Shipment;
  every call signed with key, nonce, signature and timestamp; USD, CNY, EUR and HKD; no sandbox mentioned). The order API is recorded,
  disabled; the order reads are blocked. UNKNOWN: the order and shipment paths; retention and confidentiality; order limits; webhooks;
  idempotency; cancellation.

## 4. Admission (`b23-a-provider-admission`, eleven cases)

`admitProviderOperation(registry, providerId, operationId, env)` reads only its arguments (case 7 stubs `process.env` and is not
fooled). In order:

1. an unknown provider or operation refuses `unknown_provider` / `unknown_operation`;
2. a `dfm_quote_transfer` or `ordering` operation refuses `provider_not_admitted`, before the row's own state is read, so a forged
   registry that enables every operation still admits no transfer and no order (case 2);
3. a row `validateProviderRegistry` refuses admits nothing (`provider_not_admitted`): a forged revision is not a reviewed one (section
   11; case 10);
4. the operator switch **`SIRKIT_MANUFACTURING_DISABLED_PROVIDERS`** (a comma list of provider ids or `provider:operation` pairs, case-
   and space-tolerant) refuses `operator_disabled`; no value of it widens admission for any of the 37 operations (case 4);
5. a blocked or disabled operation refuses with its reason and the row's owner decision;
6. an enabled hand-off is admitted with `via: "handoff"` and no credential reference only when it is one structurally: tier
   `handoff`, a channel other than `api`, auth `none` (case 1; case 10);
7. any other operation refuses `provider_not_admitted` unless it is a distributor's B19 read: `api` channel, `read_observation` tier,
   recorded from `b19-registry` on a row that names its B19 entry, whatever tier or channel a revision claims (case 10). Steps 6 and 7
   are one exported function, `structuralDelegation(row, operation)`; a validated registry never reaches its refusal, so case 11 calls
   it directly ([B23-A1 lead, 2026-10-02]: every forged hand-off that is an API call or carries a credential, every API operation relabelled a hand-off,
   and every B19 read relabelled a deep link, another source or a transfer tier, or on a row with no B19 entry, refuses; reverting
   either condition fails the case);
8. a distributor's B19 read is B19's `admitSource` (B19's states, B19's own switch `SIRKIT_ACQUISITION_DISABLED_SOURCES`, B19's
   credential references); admitted, it returns the variable NAMES only (case 3).

Refusals name variables, never values: over every operation and four environments of obvious fakes assembled at run time, no answer
carries a value (case 6). The refusal vocabulary is closed: `unknown_provider`, `unknown_operation`, `provider_not_admitted`,
`operator_disabled`, `blocked`, `disabled`, `credentials_missing`. CONFIRMED

## 5. The capability mapping and the CD-12 projection

- **Capability (D23-18).** JLCPCB maps `jlcpcb-2l`: profile id `jlcpcb-2l`, version 2, digest
  `mfg-rule-41563ed452ed6c620965a29186a8139d67635ac7d36fee6730b1d75eba4ca9e2`, evidence expiry 2027-09-09. The digest is a reviewed copy
  that case 11 recomputes with `buildManufacturingRuleProfile` and `JLCPCB_2L_RULE_PROFILE_EVIDENCE`, so a profile change fails the
  suite until the row is reviewed with it. Every other row is `unmapped` with a reason (`pcbway-standard` and `oshpark-4l` are
  packaging and DRC presets, not qualified profiles; MacroFab and Eurocircuits have no preset; a distributor sells parts). Only a
  manufacturer may map (rule `capability`). CONFIRMED
- **CD-12 projection (OD-161).** `toProcurementProviderDescriptor(row)` returns CD-12's `ProcurementProviderDescriptor` with exactly its
  nine keys (case 14). For every row case 14 checks each field against the row (region, currency and account as `renderFact` prints
  them; each reference to its own block); it pins JLCPCB's and DigiKey's descriptors whole, with the digest CD-12's `cd12Digest`
  computes over exactly that content, and requires nine distinct digests and a digest that moves with the content (section 11). Kinds: manufacturer and assembler project to CD-12's
  `manufacturer`, a quote service to `formal_quote`, a distributor to `authorized_distributor`, and Nexar (B19's
  `octopart-aggregated`) to `approved_aggregator`. These are CD-12's words for the kind; they carry no authorization evidence (CD-12
  keeps that on `SupplierIdentity`) (INFERRED from `app/lib/release-engineering/types.ts`). References: `provider-registry@1.0.0#<id>`
  for semantics, `.credentials`, `.outboundTerms` and `.outboundTerms.retention`; a distributor's licence is
  `source-registry@1.1.0#<b19>.license`. No production module calls the projection yet. CONFIRMED

## 6. The CSV and its generator

`scripts/generate-b23-provider-registry.ts` copies B19's generator: validate, refuse on any violation, write
`provider-registry.csv` (33 columns, one row per provider, every row starting with the registry version; LF, ASCII). The suite compares
the committed file with the render byte for byte, with no line-ending normalisation (`.gitattributes` holds `eol=lf`). CONFIRMED

- **What the byte gate covers.** Every rendered field: a provider's kind, API access (status and owner decision), enabled tier, hosts,
  credential reference names, account scope, the twelve runbook facts, capability mapping, documentation URLs and reading (label,
  reader, date and re-read mark); and, per operation, its id, tier,
  channel, state and never-called mark (`operations`), its endpoint (`operation_endpoints`), its authentication scheme
  (`operation_auth`) and its record source (`operation_sources`). The last three columns are the review correction (section 11): before
  it, an operation's endpoint and auth could change with the CSV byte-identical. Prose is not rendered: an operation's provider name,
  purpose and reason, a row's notes, a credential reference's role, each documentation page's own date, the API access's reason and
  the reading's `where` ([B23-A1 lead, 2026-10-02]: these two were listed as covered; neither is rendered) are reviewed in
  `provider-registry.ts`, where the registry suite reads them (cases 5-8); the generator's header says exactly this. CONFIRMED
- **Every validator branch bites.** 80 crafted revisions, one per guarded branch of the 22 rules; each case requires the rule's tag AND
  the message only that branch writes, so a deleted branch fails its own case even while another branch of the rule still fires (case
  12). Case 13 fails if a rule has no revision or a revision is listed twice. CONFIRMED (a deliberate deletion of eight branches failed
  nine cases, section 11)
- **Endpoints carry no key.** A path endpoint (`METHOD /path`) is held to path characters and `{template}` segments: no query, no
  fragment, no `@`, no `//host`, the rule B19 applies to every operation URL (`source-registry.ts:626`), so a key like Mouser's
  `apiKey` query parameter can never sit in a recorded endpoint; the message never echoes the target (section 11). CONFIRMED

## 7. CI admission (OD-180, D23-20) and every pin moved

- **Red first (CONFIRMED):** with `b23-` added to `CHAPTERS` and no workflow filter, the guard `b19-e-ci-job-scope` failed 1 / passed 12
  of 13: its `it.each(CHAPTERS)` case listed both `b23-a` suites as admitted by no filter. Both new suites failed to load (their modules
  did not exist). Log: 3 files failed, 1 test failed / 12 passed.
- **Fix:** one directory filter, `app/lib/manufacturing-providers/__tests__`, in the `prompt-to-gerber` job of
  `.github/workflows/deterministic-manufacturing.yml` at `:227`, right after B22-A1's `app/lib/computation/__tests__` (`:226`); and
  `b23-` appended IN PLACE to `CHAPTERS` (`b19-e-ci-job-scope.test.ts:54`), its comment on `:53` extended with an `[B23-A1]` note. No
  `it(` was added to the guard, so `b21-a-page` case 4's pin (8 blocks) stands and a run prints 8 + 5 = 13 tests. Neither suite starts
  PGlite; no explicit entry duplicates the filter (the redundancy rule). Live suites: none in A1.
- **Before editing (CONFIRMED):** every suite that names the workflow file (`git grep -l 'deterministic-manufacturing.yml' --
  '*.test.ts'`: the guard, eleven B21 page suites, `b21-f-replay-capsule` and `b22-a1-page`) ran 14 files / 136 tests green.
- **What the insertion and the line change broke (CONFIRMED, run on the pre-re-pin pages, restored by hash):** `b21-f-page` case 6
  (C49 at `:331`, C93 at `:334`, C94 at `:343`: one line down) and `b22-a1-page` case 5 (C77: the cited `CHAPTERS` line gained
  `"b23-"`); 2 failed / 43 passed of 45.
- **Pins moved, in place, each with a dated `[B23-A1, 2026-10-02]` note beside it:**
  - `artifacts/ai-control-plane-b21/evaluation-matrix.md` C49 331 -> 332, C93 334 -> 335, C94 343 -> 344: the new filter at `:227`
    moved every later workflow line by one (the SEC-1 and B22-A1 precedent on the same rows).
  - `artifacts/ai-control-plane-b22/deck-and-secret-corrections.md` C77: the anchor is now the whole new line
    `const CHAPTERS = ["b19-", "b20-", "b21-", "b22-", "b23-"] as const;` (still the full line, not loosened); `"b22-"` stands where
    B22-A1 put it.
  - `artifacts/ai-control-plane-b21/orchestration-contracts.md:351`: the guard's runtime count, 8 + 5 = 13 since `b23-` (a statement,
    not a test pin; B22-A1 noted 8 + 4 = 12 on the same line).

## 8. Gates

Every run went through the shared lock, one at a time, and every CLI process was stopped after it. The results below are the
re-runs on the final tree, after the review corrections (section 11); the first tree's runs, before them, are in brackets. CONFIRMED

| gate | result |
|---|---|
| the two suites (`b23-a-provider-registry`: 14 `it(` + one `it.each` of 80 revisions = 94 tests; `b23-a-provider-admission`: 11 `it(` = 11 tests, the lead's case 11 included) | red first (both failed to load; then, for the review corrections, 9 failed / 95 passed of 104 on the unfixed source), then 104 / 104 [first tree: 55 / 55]; [B23-A1 lead, 2026-10-02] with the lead's admission case 11 and two refused URLs in registry case 5, each red first: 105 / 105 |
| `app/lib/manufacturing-providers/__tests__` + `app/lib/acquisition/__tests__` (B19's registry suites unchanged; the guard) | 16 files passed, 1 skipped (the opt-in live contract); 317 passed, 2 skipped; exit 0 [268 passed, 2 skipped] |
| every suite naming the workflow (14 files) | before the CI edit: 136 / 136; after it: 137 / 137 (the guard's `b23-` case), and 137 / 137 again on the final tree; exit 0 |
| `app/lib/agent/orchestration/__tests__`, `app/lib/computation/__tests__`, `b20-b4-withhold-proposals` (both closeout tripwires over this page included) | 76 files passed, 2 skipped (opt-in live); 768 passed, 18 skipped; exit 0 |
| `app/lib/agent/__tests__` (the B11 suites, B11.5 case 12 included: the new suites write nothing) | 36 files, 415 / 415; exit 0 |
| `app/lib/release-engineering`, `app/api/release-engineering/__tests__`, the route census (`b16-1c-invariant-tripwires`: 165 = 162 + 3 + 0), the three-way parity counts, `b19-e-no-purchase-tripwire`, `b14-4-ast-import-gates`, `b20-b4-process-gate` | 7 files, 77 / 77, exit 1 from one vitest RPC error (`Timeout calling "onTaskUpdate"`), no assertion failed (the same on the first tree) |
| `b14-4-ast-import-gates` alone | 22 / 22; exit 0 (the same on the first tree) |
| `b20-b4-process-gate` alone | 5 / 5; exit 1 from the same RPC error, no assertion failed [first tree, alone, twice: the same both times; the B22 lead's log of this gate shows the same] |
| tsc (`--noEmit -p tsconfig.json`) | exit 0, no output |
| eslint on the seven changed or added `.ts` files | exit 0, no output |
| `generate-b23-provider-registry` and `generate-b19-source-registry` | both exit 0; the review correction changed `provider-registry.csv` once (three columns) and nothing else; on the final tree both CSVs are byte-identical before and after, and `git status` and the tree's hash are unchanged (no drift) |

## 9. What stays open

- **Live exchange and ordering: BLOCKED-LIVE-QUALIFICATION.** No provider is admitted for a transfer (LB-11) or an order (LB-12); the
  owner holds no account (OD-160). The register rows and the `PROGRAM_STATE.json` mirror are the lead's (OD-179).
- **The documentation was not re-read in A1** (OD-181): every provider fact is section 1.2's 2026-10-01 summary. Before any tier rises,
  a person re-reads the provider's own pages.
- **The CD-12 kind words** `authorized_distributor` and `approved_aggregator` are CD-12's vocabulary for a kind, not an authorization
  record; nothing evaluates them yet (INFERRED).
- **OSH Park's import upload needs no account**; it stays disabled because B23 admits no transfer of files before the owner approves the
  outbound files (B23-B1, OD-163, OD-166).
- **No runtime reads the operator switch yet**; it is pinned by name for the increment that wires admission (B23-B).

## 10. Citations

As of this increment's working tree on `3806cba`; the anchor text is the check, the line is for the reader.

| # | file | line | anchor |
|---|---|---|---|
| C1 | `app/lib/manufacturing-providers/provider-registry.ts` | 23 | `export const PROVIDER_REGISTRY_VERSION = "1.0.0";` |
| C2 | `app/lib/manufacturing-providers/provider-registry.ts` | 32 | `export const PROVIDER_TIERS = ["none", "handoff", "read_observation", "dfm_quote_transfer", "ordering"] as const;` |
| C3 | `app/lib/manufacturing-providers/provider-registry.ts` | 120 | `export const RUNBOOK_FIELDS = [` |
| C4 | `app/lib/manufacturing-providers/provider-registry.ts` | 184 | `digest: "mfg-rule-41563ed452ed6c620965a29186a8139d67635ac7d36fee6730b1d75eba4ca9e2",` |
| C5 | `app/lib/manufacturing-providers/provider-registry.ts` | 302 | `api({ id: "checkout",` |
| C6 | `app/lib/manufacturing-providers/provider-registry.ts` | 515 | `export const PROVIDER_ROWS: readonly ProviderRow[] = deepFreeze(ROWS);` |
| C7 | `app/lib/manufacturing-providers/provider-registry.ts` | 525 | `export const PROVIDER_REGISTRY_RULES = [` |
| C8 | `app/lib/manufacturing-providers/provider-registry.ts` | 582 | `export function validateProviderRegistry(` |
| C9 | `app/lib/manufacturing-providers/provider-registry.ts` | 666 | `at("blocked-row", "a blocked row may not declare callable hosts or secrets")` |
| C10 | `app/lib/manufacturing-providers/provider-admission.ts` | 23 | `export const PROVIDER_OPERATOR_DISABLE_ENV = "SIRKIT_MANUFACTURING_DISABLED_PROVIDERS";` |
| C11 | `app/lib/manufacturing-providers/provider-admission.ts` | 54 | `if (tierRank(entry.tier) >= tierRank("dfm_quote_transfer")) {` |
| C12 | `app/lib/manufacturing-providers/cd12-projection.ts` | 28 | `export function toProcurementProviderDescriptor(row: ProviderRow): ProcurementProviderDescriptor {` |
| C13 | `scripts/generate-b23-provider-registry.ts` | 23 | `await writeFile(resolve(outDir, "provider-registry.csv"), renderProviderRegistryCsv(), "utf8");` |
| C14 | `.github/workflows/deterministic-manufacturing.yml` | 227 | `app/lib/manufacturing-providers/__tests__` |
| C15 | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | 54 | `const CHAPTERS = ["b19-", "b20-", "b21-", "b22-", "b23-", "b24-"] as const;` [B24-A1, 2026-10-06] re-pinned in place: B24-A1 appended `"b24-"` to this line (OD-222); `"b23-"` stands where B23-A1 put it |
| C16 | `app/lib/pcb/fab/rule-profile.ts` | 30 | `export const QUALIFIED_RULE_PROFILE_IDS` |
| C17 | `app/lib/release-engineering/providers.ts` | 8 | `export function createProviderDescriptor(` |
| C18 | `app/lib/acquisition/source-registry.ts` | 568 | `export function admitSource(` |
| C19 | `app/lib/manufacturing-providers/provider-registry.ts` | 555 | `const API_PATH = /^\/(?!\/)[\w.~{}/-]*$/;` |
| C20 | `app/lib/manufacturing-providers/provider-registry.ts` | 794 | `export const PROVIDER_REGISTRY_CSV_COLUMNS = [` |
| C21 | `app/lib/manufacturing-providers/provider-admission.ts` | 58 | `if (validateProviderRegistry([row]).length > 0) return refuse("provider_not_admitted",` |
| C22 | `app/lib/manufacturing-providers/provider-admission.ts` | 69 | `if (row.b19Source === null \|\| entry.source !== "b19-registry" \|\| entry.channel !== "api" \|\| entry.tier !== "read_observation") {` |
| C23 | `app/lib/acquisition/source-registry.ts` | 626 | `if (url.username \|\| url.password \|\| url.search) at(` |

## 11. Review corrections [B23-A1 review, 2026-10-02]

An adversarial review of the first working tree confirmed eight findings (two real defects, one artifact gap, five weak tests). Each
was reproduced first: a strengthened test run on the unfixed source and recorded failing, or, where the source was right and only the
test was weak, a deliberate breakage of the fixed source that the strengthened test catches, the source then restored byte for byte
and checked by hash. All runs went through the shared lock. CONFIRMED

| finding | what was wrong | the test that reproduces it | observed | the fix |
|---|---|---|---|---|
| coverage-2 | the `api-endpoint` rule skipped every path-form endpoint, so `POST /api/v1/order?apiKey=...` validated (B19 refuses a query or credentials on every operation URL, `source-registry.ts:626`) | four case-12 revisions: a query carrying an obvious fake key assembled at run time, a scheme-relative `//host`, a fragment, an `@` | unfixed: the four cases failed (no violation) | `API_PATH`: a path target holds path characters and `{template}` segments only; the message never echoes the target |
| coverage-3 | the CSV rendered an operation as `id=tier/channel/state` only; the generator's header claimed more | case 15: three new columns after `operations`, each cell equal to the row's operations rendered, plus 14 literal pins (`quote=oauth2-authorization-code`, `import-upload=POST https://oshpark.com/import`, ...) | unfixed: case 15 failed (the column list) | `operation_endpoints`, `operation_auth`, `operation_sources`; the CSV regenerated (no other file changed); the header names what the render leaves out |
| tests-01 | no test pinned an API operation's auth or endpoint, or `AUTH_SCHEMES` | case 1 pins `AUTH_SCHEMES` and `OPERATION_SOURCES`; case 6's table carries every operation's auth and every stated API endpoint; case 12 adds an auth outside the vocabulary | breakage (DigiKey's quote auth set to `oauth2-client-credentials`, OSH Park's import moved to `/import.json`, the auth vocabulary check deleted): cases 6, 12 and 15 failed; the endpoint move alone failed cases 6 and 15 (case 6 holds after a regeneration too) | test only |
| tests-02 | cases 12 and 13 asserted only that a rule tag fired, so eight guarded branches could be deleted with every case green | 80 crafted revisions, one per guarded branch of the 22 rules, each requiring its branch's own message; `never-called` now writes one message per branch | breakage (branches (a) to (h) deleted at once): exactly nine cases failed, each the deleted branch's own; unfixed: the two `never-called` cases failed until the message split | test, and the `never-called` message split |
| tests-03 | case 14 compared the digest with CD-12's recomputation of the same object (true for any content) and never read three fields | case 14 checks every field against the row for all nine rows, pins JLCPCB's and DigiKey's descriptors whole with `cd12Digest` over that content, and requires nine distinct digests and a digest that moves with its content | breakage: `renderFact` dropped for the region failed case 14 (`region: [object Object]`); the authentication and retention references swapped alone failed case 14 | test only |
| tests-04 | admission admitted an API operation relabelled `handoff` as a hand-off: it read the tier, never the channel, and never validated the row | admission case 10: 89 forged relabels (an API call as a hand-off with its channel kept, or as a manual upload with its auth and endpoint kept, or as an enabled read; a hand-off as an API call; a B19 read as a deep link) and one revision every validator rule accepts that enables MacroFab's order read | unfixed: case 10 failed (`jlcpcb.pcb-quote {"tier":"handoff","state":"enabled"}`: admitted) | admission refuses a row `validateProviderRegistry` refuses, admits a hand-off only when it is one structurally, and delegates only an `api` read at `read_observation` recorded from B19; without the validation layer, case 10 failed on OSH Park's import (auth `none`) relabelled a manual upload, so the validation layer bites; [B23-A1 lead, 2026-10-02] the structural layer alone did not (a validated row never reaches it): it is now `structuralDelegation`, called directly by admission case 11 - red (no such export), green, and each of its two conditions reverted fails the case |
| tests-05 | case 5 accepted any URL whose host and last path segment occurred anywhere in section 1.2 | case 5's `namedInSection`: whole in one provider bullet, or the whole path beside its host, or the last segment beside a sibling page in the same directory; five unnamed URLs asserted refused | breakage (`https://developer.digikey.com/anything/ordering` added to DigiKey): case 5 failed (and the byte gate) | test only; the 31 recorded URLs pass (21 whole, 5 by path, 5 by last segment beside a sibling, by reading: INFERRED). [B23-A1 lead, 2026-10-02] the sibling rule still let a quoted word name a page (`https://oshpark.com/developer/checkout`, `https://api-partner.pcbway.com/Help/Api/PCBWayWebPay`: both accepted, red); a bare segment now counts only in its sibling's naming family (the text up to its last `-`), a `.../segment` form as before; both refused, the 31 recorded URLs still pass |
| tests-06 | case 8's bare `catch` around the whole walk ended a top-level scan at its first error, hiding any importer after it | case 8 walks through `importersOf`, and an in-memory tree with a locked file before an importer must throw | unfixed walk: case 8 failed (`expected [Function] to throw an error`) | only a missing top-level directory is skipped; every other error propagates |

The suites: `b23-a-provider-registry` 14 `it(` plus one `it.each` of 80 = 94 tests; `b23-a-provider-admission` 11 (the lead's case 11). Neither writes to
disk (the B11.5 rule). CONFIRMED

## 12. The B23 closeout's export record

[B23 closeout (1/2), 2026-10-05] The A1 exports no production module calls, and why each stays. The table is in
`closeout-statements.md` section 3, which `b23-closeout-statements` case 7 re-derives from the tree. RECORDED; nothing here is
retired.

- `cd12-projection.ts` (the whole module, `toProcurementProviderDescriptor` among its exports): the CD-12 projection OD-161 asks for,
  delivered unbound - no production module imports it (section 5); `b23-a-provider-registry` case 14 runs it. It is the extension
  point for CD-12's procurement descriptors.
- `renderProviderRegistryCsv` and `PROVIDER_REGISTRY_CSV_COLUMNS`: the CSV render and its header row. Only
  `scripts/generate-b23-provider-registry.ts` calls the render, and registry case 15 compares its output with `provider-registry.csv`
  byte for byte (section 6).
- `RUNBOOK_FIELDS`: the runbook's twelve field names in the runbook's order (section 1), the oracle registry case 3 maps onto the
  row keys.
- `PROVIDER_REGISTRY`: the id-keyed view of `PROVIDER_ROWS` that the registry and admission suites read; production reads
  `PROVIDER_ROWS`.
- `PROVIDER_REGISTRY_RULES`: the validator's closed rule tags as data beside `ProviderRegistryRule` (citation C7).
- `PROVIDER_ADMISSION_REFUSALS`: admission's closed refusal codes as data beside `ProviderAdmissionRefusal` (section 4).
- `structuralDelegation`: runs inside `admitProviderOperation`; it is exported only so admission case 11 can show the structural layer
  bite, which a validated registry never reaches.
- `providerRow`: named nowhere, not even by a test - dead. Its retirement waits for the next reviewed registry revision, the one that
  rewrites the header sentence on `:16` and bumps `PROVIDER_REGISTRY_VERSION` (the registry's own rule, `:18`): removing code from
  this module is a registry change, where a same-line comment note is not (the closeout's choice, recorded for the owner).
- `renderProviderRegistryCsv`'s `rows` parameter: no caller passes it (the generator and case 15 both call the render bare); it is
  dropped in that same reviewed revision.
