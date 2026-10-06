# B23 - discovery: external manufacturing, DFM, quoting and procurement boundaries

Labels: **CONFIRMED** (read at the cited file:line at HEAD `0432fb8`, or observed with an allowed read-only git command), **INFERRED** (a
conclusion from reading code; nothing was executed), **PROPOSED** (designed, not exercised), **RECORDED** (written down from a document or
a reader's observation without a claim of our own), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**. "(reader)" or "(reader N)" marks a fact
taken from a reader's map and not re-read by the synthesizer; every defect-bearing fact below was re-read at HEAD by the synthesizer
through `git show HEAD:<path>` or `git grep HEAD`.

Method: seven parallel read-only readers over the tree at `0432fb8`: (1) every existing external manufacturing, assembly, distributor and
quote integration, (2) the deterministic release B23 would send, (3) outbound data and uploads, (4) procurement, ordering, payment and
spend, (5) physical-hardware evidence and the assembled-product claim, (6) prior records, standing obligations and the tests that pin
them, (7) external manufacturer, DFM, quote and distributor APIs. They produced 59 gap candidates (S1-G1..8, S2-G1..10, S3-G1..11,
S4-G1..8, S5-G1..6, S6-G1..12, G7-1..4), every claim with a file:line or a URL. One synthesizer re-read every defect-bearing fact at
HEAD, resolved the disagreements (section 0) and merged the gaps into D23-1..21 (section 4); the lead's reconciliation is section 9,
empty until then. The synthesizer executed nothing (no vitest, eslint, tsc, tsx, node, script, next, playwright or docker), wrote no
repository file and fetched no page. Reader 7 fetched the external pages on 2026-10-01 through WebFetch and WebSearch, which return a
model-written summary rather than the raw page; those items are labelled **RECORDED** (reader 7). No reader signed up for, submitted to
or scraped any provider, and no repository content or credential was sent anywhere.

Tree: branch `chapter/b22-sandboxed-computation`, HEAD `0432fb8` ("B22 discovery: sandboxed engineering computation and simulation,
re-verified on the SEC-1 tree"), which is main `d0d2ec8` (the PR #12 merge, SEC-1) plus that one discovery commit; `main..HEAD` is that
single commit, authored `Dandi Desta <dandidesta82@gmail.com>` with no co-author trailer (`git log main..HEAD`, CONFIRMED). No B23 code
has changed since main. `git status --short` was empty when this synthesis started; during it an untracked `app/lib/computation/`
appeared (another agent's B22-A1 work in progress), which was not read; HEAD stayed `0432fb8` throughout, and every citation below is
against the committed tree. B22's increments (A1..closeout) land after this draft and touch `app/lib/spice`, `app/api/spice`,
`app/lib/pcb/fab/kicad-cli-runner.ts`, `app/lib/pcb/fab/build-bundle.ts`, `app/lib/pcb/autoroute/runner.ts`, the CI workflow, the
`externalProcess` classification rows (D22-18) and the reviewed counts, and add `app/lib/computation/*`, `app/api/simulate`, `app/api/chat/computation-runtime.ts` and the action and tool registries (none a B23 surface); the lead re-verified every citation, and every
count, on `849a933` (the tree of main `43cb1b0`) on 2026-10-02 (section 9).

[B23 lead, 2026-10-02] Committed on `chapter/b23-external-manufacturing` from main `43cb1b0`, after PR #13 (B22, the eight commits `50fe156`..`849a933`)
merged normally on 2026-10-02. Before committing, eight read-only verifiers and one synthesizer re-read every citation of D23-1..21
and of sections 0-8 at `849a933`; no defect was refuted, nine items were changed by B22 and one was partly closed by it. The
re-verification's text corrections (section 9.5, 90 replacements) are applied in place throughout this page, which therefore cites
`849a933` wherever a position or count moved; section 9.2 lists every citation that moved or changed (old -> new), and the dated
notes appended to D23-8, D23-19 and D23-20 say what B22 changed in them. Every other citation reads the same at both trees. No `artifacts/ai-control-plane-b23/` directory exists (`git ls-tree HEAD
artifacts/`, CONFIRMED). Prepared 2026-10-01.

## 0. Reader disagreements and UNKNOWNs resolved by reading the code

- **What the registry's `AuthMethod` can express.** G7-2 said the descriptor type has "no session-token or signed-header shape (OSH Park,
  JLCPCB)". Resolution: `AuthMethod` is `"oauth2-client-credentials" | "api-key-query-parameter" | "bearer-access-token" |
  "signed-request-partner-key"` (`app/lib/acquisition/source-registry.ts:60`), and LCSC's row uses the signed partner request (`:477`),
  so a signed-request shape exists. Missing are a 3-legged authorization-code OAuth, a header API-key method (a `"header"` placement
  exists only on `SecretReference`, `:69`) and a session token. CONFIRMED; folded into D23-2.
- **Absent versus "visibly disabled" ordering.** S1-G8 rated it low, S4-G1 medium, S6-G6 low. Resolution: medium. The pass criterion reads
  "purchase/order paths are either separately authorized and idempotent or remain visibly disabled" (runbook `:1017`). What a person can
  see today are statements about a past act - "No order was placed." in the sourcing worksheet (`app/lib/cart-formats.ts:228`) and "not a
  fabricated, ordered, assembled, or electrically certified board" in the release panel (`app/components/pcb/ManufacturingWorkflowPanel.tsx:96`)
  - not a statement that ordering is turned off and why. The code facts are CONFIRMED; the reading of `:1017` is INFERRED (D23-10).
- **A concurrent duplicate release-ledger commit on PostgreSQL** (reader 2: UNKNOWN, `server-repository.ts` not read). Re-read: the
  server repository looks up the replay row inside the transaction and returns it as `idempotent: true` (`app/lib/durable-workflow/server-repository.ts:22-23`);
  otherwise it selects the aggregate head `FOR UPDATE` and throws `DW_OPTIMISTIC_REVISION_CONFLICT` when the head moved (`:25`). A
  sequential duplicate therefore replays; a concurrent duplicate either replays or fails the revision check; neither writes a second
  record (INFERRED). Where no head row exists yet, heads, records and replays carry unique indexes (`app/lib/db/schema.ts:1277`, `:1294`, `:1308`), so a concurrent first commit fails a unique constraint rather than writing twice (INFERRED from the drizzle schema at `849a933`; the migration SQL was not read); the transaction isolation level was not established (**UNKNOWN**,
  section 8 item 10).
- **B24-E item 5's line.** Reader 6 cited runbook `:1116` for "Run manufacturing DFM/quote staging if available."; that sentence is
  `:1119` (`:1116` is the production-auth browser E2E). CONFIRMED.
- **Is `format: "manifest"` a read-only preview?** Reader 2 said no; confirmed: the release route generates the package and writes the
  ledger record (`app/api/pcb/release/route.ts:124-139`) before it branches on `format` (`:152-153`). CONFIRMED (D23-6).
- **Does `/api/pcb/release` spawn kicad-cli?** No: `release-gate.ts` imports no `build-bundle` or `kicad-cli-runner`
  (`app/lib/pcb/fab/release-gate.ts:1-36`), whose only importers are the engineering export route and `build-bundle.ts` (`git grep`). The
  former `externalProcess: "kicad-cli (server-authoritative)"` row (`app/lib/auth/route-resource-classification.ts:54`) was D22-18, which
  B22-A2 (`c037627`) closed: at `849a933` `/api/pcb/release` carries no `externalProcess`, `/api/pcb/qualify` (`:55`) and `/api/chat` (`:78`) carry `"freerouting (java)"`, and `app/lib/computation/__tests__/b22-a2-process-census.test.ts` case 5 (`:368-394`) pins that the release route reaches no spawner. CONFIRMED. Consequence: B22-A1's edits to `build-bundle.ts` and
  `kicad-cli-runner.ts` touch the engineering export only, not the deterministic release B23 would send (CONFIRMED at `849a933`, section 8 item 11).
- **`NEVER_EXPOSED_TOOL_PATTERNS` and `manufacturing.assembled-release`.** Reader 6 noted that `/\.release$/` does not match the
  hyphenated id. That list applies to tool ids (`app/lib/engineering/granted-execution-families.ts:74-81`); the action id is Tier 3
  through `TIER3_FAMILY_PATTERN` (`app/lib/engineering/permission-tiers.ts:57`) and its approval tier `release` (`:40`), and no tool
  descriptor for it exists. Not a defect. CONFIRMED.
- **Quote asks in chat.** Reader 4 asked whether the Tier 3 chat refusal applies with orchestration off. Resolution: the router refuses
  nine Tier 3 head-verb families (`app/lib/agent/orchestration/router.ts:82-94`, `:170-174`), consulted only when
  `SIRKIT_ORCHESTRATION_ENABLED` is exactly `"1"` (`app/api/chat/orchestration-runtime.ts:42-43, :120-121`). "Get a quote from PCBWay
  for this board" matches no family (INFERRED from the grammar) and reaches the single loop, where no tool can reach a provider
  (structural, section 2.6). Folded into D23-8.
- **Which presets carry what.** Readers 1, 2 and 7 agree: four fab presets (`jlcpcb-2l`, `jlcpcb-4l`, `pcbway-standard` - a 2-layer
  preset - and `oshpark-4l`), each `verifiedAt` 2026-07-09 with a Gerber-generation help page as `specUrl` (`.fab.json:3-7` of each,
  CONFIRMED); only `jlcpcb-2l` is a qualified rule profile (`app/lib/pcb/fab/rule-profile.ts:30`). CONFIRMED.
- **Next free numbers.** B22 spent OD-134..OD-159: OD-152 is still at `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1661`, the highest number OD-159 (a proposal) is at `:1872`, and the headings now end at `:1935` (OD-137); B22
  drafted OD-134..OD-150 in its discovery (`artifacts/ai-control-plane-b22/discovery.md:977-1000` at `849a933`), and OD-134..OD-159 are all recorded in `OWNER_DECISIONS.md`. This chapter
  starts at **OD-160**, which B22's records now state (`artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:21-24`; `EXECUTION_LEDGER.md:3830-3831`); OD-153..OD-159 are
  spent by B22 (section 8 item 12). `LIVE_BLOCKERS.md` holds LB-1..LB-10 (`:7-16`); LB-10 (`:16`, authoritative sandboxed simulation on a qualified OCI platform) is
  B22's OD-147 (`discovery.md:995`, `:1462`; recorded at `OWNER_DECISIONS.md:1720`), so B23's first row is **LB-11**. At `849a933` no `D23-` id, LB-11, LB-12 or use of OD-160..OD-189 exists (`git grep`, CONFIRMED); the only OD-160 mentions are B22's statements that B23 starts there.

---

## 1. Scope and references

### 1.1 Chapter scope (`C:/Users/robsa/Downloads/Sirkit_Remaining_Builder_Master_Runbook.md:946-1019`)

- **Mission** (`:950`): "Connect verified release artifacts to external manufacturing and supply-chain services under explicit Tier 3
  human authority. Begin with read-only capability/quote/DFM operations. Never allow an agent or a single ambiguous click to order
  hardware or spend money."
- **B23-A** (`:952-969`): reviewed descriptors "for each manufacturer, assembler, distributor or quote service" (`:954`) recording legal
  provider identity; endpoint/API version; credential reference and account scope; supported operations; region/currency;
  capability-profile mapping; data retention/confidentiality terms; upload and quote limits; webhook/signature contract; idempotency
  support; order/cancellation policy; enabled feature tier (`:956-967`). `:969` verbatim: "Do not implement unofficial scraping when an
  API is unavailable. Browser deep links and CSV export remain distinct from a verified API integration."
- **B23-B** (`:971-982`), "Given a current deterministic release": 1. "Revalidate authority immediately before upload." (`:975`); 2.
  "Present exactly which files and metadata will leave Sirkit." (`:976`); 3. "Require explicit user approval for the named provider and
  purpose." (`:977`); 4. "Upload with bounded streaming, timeouts and idempotency." (`:978`); 5. "Store provider receipt, artifact digest,
  capability/profile version and timestamp." (`:979`); 6. "Normalize DFM/quote results as external observations, not Sirkit proof."
  (`:980`); 7. "Detect stale quotes and changed release inputs." (`:981`); 8. "Never auto-accept substitutions or design changes suggested
  by a provider." (`:982`).
- **B23-C** (`:984-998`): "Ordering stays feature-disabled until the owner separately supplies:" a supported account; spending and
  quantity limits; billing/shipping policy; authorized human roles; cancellation/refund behavior; legal/compliance requirements; a
  staging/sandbox provider path (`:986-994`). `:996`: "When enabled, require a second explicit confirmation bound to exact provider,
  cart/order lines, quantities, currency, total price ceiling, shipping destination reference, release/BOM digest and expiry. Re-read price
  and availability immediately before submission. The AI cannot mint or consume the final purchase authorization." `:998`: "Duplicate
  submission, retry after timeout and webhook replay must not create duplicate orders. An ambiguous provider response must be
  `UNKNOWN_PENDING_RECONCILIATION`, never silently retried."
- **B23-D** (`:1000-1013`): "Define but do not fabricate evidence for:" manufacturer acceptance; produced board lot/serial identity;
  incoming inspection; continuity/power-on tests; functional test; assembly results; deviations/rework; final physical qualification
  (`:1002-1011`). `:1013`: "Only physical evidence may advance an assembled-product claim. Keep `manufacturing.assembled-release` blocked
  until the required evidence and qualified human review exist."
- **Pass** (`:1017`): "Read-only DFM/quote integrations are safe and traceable; purchase/order paths are either separately authorized and
  idempotent or remain visibly disabled; no agent can release or spend. Complete `artifacts/ai-control-plane-b23/`, PR/CI/merge, continue
  to B24."
- **Global rules** that bind B23 most directly: `:35` (stop when credentials, paid access, hardware or a live environment are unavailable
  "and no deterministic local/fake-backed work remains"); `:138` (browser- or model-authored state is never canonical); `:139` ("idempotent
  where retryable"); `:140` ("Every external observation must retain source identity, retrieval time, licensing/retention policy, freshness
  and evidence hashes."); `:144` (never tell a human a "Gerber package, quote, order, assembly, or physical board is verified beyond the
  evidence actually obtained"); `:146` ("“Gerbers generated” does not mean fabricated, electrically certified, ordered, assembled, or
  safe."); `:147` (never invent a pass); `:148` ("Qualification, release, uploads, purchasing and ordering must never be smuggled through a
  lower-tier tool or a generic execute path."); `:152-155` (secrets server-side; prompt injection from web pages; SSRF, rebinding,
  redirects, oversized bodies, unbounded streams); `:158` (CSRF, server-derived identity, roles, bounded readers); `:164-165` (commit
  identity, no AI trailers); `:171` (no live purchases, access or billing changes); Tier 3 defined at `:505` ("publish authority,
  manufacturing release, external upload, purchasing/order and other irreversible actions; never directly agent-executable").
- **Program-wide**: chapter list `:25`; B24-A "feature flags for MCP, sandbox and external manufacturing" (`:1042`); B24-B evaluates
  "external quote/order denial and idempotency" (`:1068`) and keeps fake-backed and live scores apart (`:1070`); B24-E item 3 "Run supported
  live component/distributor checks without purchasing." (`:1117`), item 5 "Run manufacturing DFM/quote staging if available." (`:1119`),
  item 6 "fabricate only after separate owner approval" (`:1120`); acceptance scenario 20 "Refuse purchase/order without exact Tier 3 human
  authority." (`:1186`).

### 1.2 External references (reader 7, WebFetch and WebSearch, read 2026-10-01; every item **RECORDED**)

The registry's own last documentation check is 2026-09-13 (`source-registry.ts:181`, reader 7); the fab presets' `verifiedAt` is
2026-07-09. WebFetch returns a summary, so quoted phrases are as that summary returned them.

- **JLCPCB** - `https://api.jlcpcb.com/`: an API platform with a PCB API ("real-time quotations, an easy ordering process, and comprehensive
  order lifecycle management") plus Stencil, 3D Printing and Components APIs; onboarding "Apply for API access", then "Create your first
  app". `https://jlcpcb.com/help/article/jlcpcb-online-api-available-now`: access needs a JLCPCB account, applicants are reviewed on their
  orders and business, "not all applications will be approved"; "JLCPCB will not have access to any information regarding API partners'
  customers". `https://api.jlcpcb.com/docs/api-list`, `/docs/api-request-signature` and `/docs/start` returned only navigation (client
  rendered): authentication, webhook signature, sandbox, idempotency, rate limits, retention and payment are **UNKNOWN**. A third-party
  issue seen only as a search snippet describes an `Authorization: JOP appid,accesskey,nonce,timestamp,signature` header on
  `open.jlcpcb.com`: unofficial, not relied on. DFM: `https://dfm.jlcpcb.com/` and `https://jlcdfm.com/` are web upload tools; no DFM API
  was found (**UNKNOWN**).
- **PCBWay** - `https://www.pcbway.com/api_cooperation.html`: an approval-gated Partner API requested by email and "reviewed by PCBWay
  team"; the Assembly API is "under construction"; "PCBWay will not know any information of partners' customers"
  (`https://www.pcbway.com/api.html` returned 404). `https://api-partner.pcbway.com/Help`: POST endpoints PcbQuotation; PlaceOrder ("Add to
  Cart"); ConfirmOrder ("Confirm orders/Make Payment"); GetFreightByOrder; CheckOrderDetails; CheckTGroupOrder, PayTGroupOrder,
  CancelTGroupOrder; CheckGroupOrder; CancelOrder; QueryOrderProcess; Account/QueryBalance; SMT/SMTQuotation; Address lookups.
  `/Help/Example`: an `api-key` request header; the only "sandbox" is a code comment on the same host over plain http (no distinct sandbox
  documented). `/Help/Api/POST-api-Pcb-PcbQuotation` is parameter-only (no file) and returns priceList, BuildDays and shipping;
  `POST-api-Pcb-PlaceOrder` takes `DataZipFile` (base64) or `PcbFileUrl` with an optional `PONumber`; `POST-api-Pcb-ConfirmOrder` takes
  `PayType` `AccountPay` or `PCBWayWebPay` and returns `TotalAmount` and `AccountBalance`; `POST-api-Pcb-CancelOrder` takes only `OrderNo`.
  Webhooks, idempotency (`PONumber` uniqueness), rate limits and retention: **UNKNOWN** (the partner PDF came back as binary).
- **OSH Park** - `https://oshpark.com/developer`: an official REST/JSON API for Uploads, Projects and Orders authenticated by "a short-lived
  session token generated by the API" (`/developer/resources` returned 404). `https://docs.oshpark.com/tips+tricks/api/`: the import upload
  (`oshpark.com/import?url=`, or a multipart POST to `/import` or `/import.json`) needs no authentication, returns no previews or warnings
  and the user finishes in the browser. `https://github.com/OSHPark/ruby-api-client/blob/master/README.md`: sign-in by email plus password
  or API secret; `add_item` and `checkout`; "We can't accept credit card payments via the API at this time."; orders from invoiced
  customers proceed automatically. Sandbox, webhooks, idempotency, rate limits, retention and base path: **UNKNOWN**.
- **MacroFab** - `https://apidocs.macrofab.com/docs/accessing-your-api-key` and the reference pages: `https://api.macrofab.com`, key in
  `X-MacroFab-API-Key` (one search snippet says a URL parameter, probably older docs); DFM readiness `GET/POST
  /api/v5/pcb/{pcb_id}/{pcb_version}/ready/{quantity}` returning observations (error, warning, info) and available actions; quotes `GET/POST
  /api/v4/quote/pcb/{id}/{version}/{quantity}` with totals, `business_days`, `due_date`, `valid`, `invalid_reasons` and no documented
  expiry. `https://apidocs.macrofab.com/llms.txt` (64 entries): order endpoints are read-only (order list, order details, deals); uploads via
  "Sign S3 Upload" and ingestion workflows; a testbench results API (`POST/GET /api/v1/testbench/results`, serial number, SKU, status,
  date). Sandbox, webhooks, rate limits, idempotency and retention: **UNKNOWN**.
- **Eurocircuits** - searches (`site:eurocircuits.com API`; "Eurocircuits API quote order") found web quoting
  (`https://www.eurocircuits.com/ask-for-a-quotation/`) and the PCB Visualizer; the "API" mentions describe Eurocircuits' own supplier
  links (`https://www.eurocircuits.com/eurocircuits-company-update/looking-forward-2026/`). A public customer API: **UNKNOWN** (none found).
- **Nexar/Octopart** - `https://support.nexar.com/support/solutions/articles/101000471994-authorization`: OAuth2 client credentials (scope
  `supply.domain`) or authorization code with PKCE at `identity.nexar.com/connect/token`; tokens "valid for 24 hours"; no ordering scope.
  `https://nexar.com/api/legal` (dated August 1, 2022): no caching or storing beyond 24 hours, a followable Octopart attribution link, the API
  and agreement confidential. `.../101000476314-part-limits-and-how-they-work` and `.../101000497890-frequently-asked-questions`: limits reset
  monthly; the Evaluation limit conflicts between the two pages (1000 versus 100 lifetime); "The API call will timeout after 90 seconds".
  No order or quote-to-order path (INFERRED).
- **DigiKey** - `https://developer.digikey.com/products`: Quote ("lock in those prices for a specified period of time"), Ordering ("Place an
  order and manage your existing orders"), Order Status, MyLists, Product Information V4 and others. `/products/ordering`: needs "an active
  DigiKey Credit account"; the Order, SalesOrderDetails and Quote-v4 GetQuote pages say "Only 3-legged OAuth" and offer "Switch to Sandbox
  Mode". `https://developer.digikey.com/documentation` and the FAQ: sandbox at `sandbox-api.digikey.com` (data "may not be complete";
  sandbox apps cannot call production); access tokens 10 min (2-legged) or 30 min (3-legged); per-minute limits per product (Product
  Information 120/min, Ordering 10/min), 429 with Retry-After; locale headers set site, language and currency.
  `https://developer.digikey.com/api-user-agreement` (undated): no own database from the API, no distribution to third parties, a
  ten-minute suspension above a threshold. Webhooks, duplicate PO handling, Quote-v4 validity and line limits: **UNKNOWN** (a search snippet
  says 30 days and 300 products, INFERRED only).
- **Mouser** - `https://api.mouser.com/api/docs/V1`: Search, Cart, Order and OrderHistory groups; `POST /api/v{version}/order` with
  `SubmitOrder` true submits, false previews; `order/options/query` returns shipping, payment methods and tax certificates; key in an
  `apiKey` query parameter; no sandbox documented. `https://www.mouser.com/api-hub/`, `/en/apiterms/`, `/apiterms/` and `/en/api-order/`
  timed out on 2026-10-01 (**UNKNOWN**); the registry's 2026-09-13 reading (terms "last modified 2013-03-11", no storage, disabled under
  OD-32) stands (`source-registry.ts:331-334, :353-357`, reader 7). Separate cart/order and search keys, 30/min and 1000/day: search
  snippet, INFERRED.
- **LCSC** - `https://www.lcsc.com/docs/openapi/index.html`: product APIs plus "Order Create API", "Check Order API" and "Get Shipment API";
  every call signed with key, nonce, signature and timestamp; USD, CNY, EUR and HKD; no sandbox mentioned.
- **Across providers** (INFERRED from the reads above): no official source read documents a webhook signature contract or an
  idempotency-key mechanism; DigiKey is the only provider with a documented ordering sandbox.

### 1.3 Repository state

- **Three coded outbound integrations (two enabled), all read-only distributor or aggregator lookups**: DigiKey (enabled, OD-33), Nexar/Octopart
  (enabled, OD-33) and Mouser (code present, disabled, OD-32); LCSC blocked (`source-registry.ts:26`, `:281`, `:353-357`, `:449`,
  `:524-528`). No code calls a manufacturer, assembler, DFM or quote API; no webhook, upload, quote, order or receipt exists anywhere
  (section 2.1). CONFIRMED
- **The deterministic release**: `POST /api/pcb/release` is the only production caller of `releaseManufacturingPackage` (reader 2); the
  pinned 555 fixture release is `mfg-release-45b3b7efbc85dc3a8ecd233c906384cd`, archive SHA-256
  `997664c0b9a87c4d3a65e64eeb90b98159b2ad6ad8806e4ebea748a592ac6dcc`, 41,855 bytes
  (`app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities.json:14-19`, asserted at `acceptance-pipeline.test.ts:420-421`).
  CONFIRMED
- **Reviewed sets and gates**: registry 47, agent-exposed 36, MCP-exposed 9, agent-only 27 since B22-B (OD-139) (`app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts:241`);
  route census 165 = 162 canonical + 3 factories + 0 raw (`app/api/__tests__/b16-1c-invariant-tripwires.test.ts:38-51`); exactly two
  `releaseOrQualification` rows (`app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts:186-196`); CI chapters `["b19-", "b20-", "b21-", "b22-"]`
  (`app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:54`). CONFIRMED (re-measured at `849a933`, section 9).
- **Program state** (at `849a933`): current chapter B22 with the checkpoint "B22 complete", next action: undraft and merge PR #13, then B23 from its discovery draft; base `d0d2ec8`, last green `85439e7`, pull request PR #13
  (`artifacts/remaining-builder-program/PROGRAM_STATE.json:4-10, :19`); no B23 entry in `EXECUTION_LEDGER.md` (last heading `:4254`, B22
  closeout (2/2); B23 is mentioned without an entry at `EXECUTION_LEDGER.md:3830`, `:4262` and `PROGRAM_STATE.json:19`) or `OWNER_DECISIONS.md`. CONFIRMED
- **Standing owner decisions on spend and disclosure**: OD-8 authorizes no live purchase and no access or billing change
  (`OWNER_DECISIONS.md:14`); OD-31 keeps cart and packet routes public and cache-only (`:110-119`); OD-32 Mouser disabled (`:121`); OD-33
  DigiKey 1 h, Nexar 24 h, no bulk refresh (`:132`); OD-36 every source's `agentDisclosure` is `unknown` because DigiKey forbids providing
  its data to third parties and Nexar forbids distributing it (`:174-182`); OD-39 "May distributor values leave Sirkit?" is undecided
  (`:216-224`; `artifacts/ai-control-plane-b19/unknowns-and-owner-decisions.md:19`); OD-40 agent search at most 25% of a window (`:226-231`).
  No owner record supplies any B23-C prerequisite (reader 6: a grep for billing, shipping, spending limit, refund, cancellation policy and
  sandbox provider finds only OD-8 and LLM-credit lines). CONFIRMED
- **Live blockers**: LB-5 "Physical fabrication, assembly, incoming inspection, functional test" is "not attempted" and unblocks on "owner
  approval and hardware (B24-E)" (`LIVE_BLOCKERS.md:11`); no row covers DFM/quote staging or an ordering sandbox; `PROGRAM_STATE.json`
  `liveBlockers` lists five entries since B22-A2 added LB-10 (`:17`) and still omits LB-5, as well as LB-4, LB-6, LB-7 and LB-8 (`:12-18`). CONFIRMED

---

## 2. What exists (per surface)

### 2.1 External integrations and the source registry

- **The reviewed source registry** (`SOURCE_REGISTRY_VERSION = "1.1.0"`, `source-registry.ts:24`) is the only provider-descriptor registry in
  production use: four ids `"digikey" | "mouser" | "octopart" | "lcsc"` (`:26`), deep-frozen (`:532-536`). Each entry records provider
  identity with documentation and `documentationCheckedOn`; exact hosts, operations and `notCalled` hosts; auth with secret references by
  environment-variable NAME; observations; candidate search; quota; resilience (deadline, response ceiling, `maxRedirects: 0`, spacing,
  retry, breaker); freshness; licence (terms, storage, retention, bulk refresh, redistribution, export, `agentDisclosure`, attribution);
  scope (region, currency, locale, account); source class; authority class; and `state: { status, reason, ownerDecision }` (`:102-176`).
  CONFIRMED
- **Enforced by code**: `validateSourceRegistry` refuses non-HTTPS documentation or operations, non-exact hosts, operation hosts outside
  `hosts`, URLs with credentials or a query, an enabled source without operations, a blocked source declaring hosts or secrets, spacing
  faster than the documented per-minute limit, redirects other than 0, a no-storage source with a TTL, an authority class other than
  `sourcing_observation`, `agentDisclosure: "permitted"` on a source not enabled, and secret-shaped values (`:601-672`; `:629`, `:642-643`,
  `:645`, `:647`, `:651`, `:669`); the CSV render is gated byte for byte (`artifacts/ai-control-plane-b19/source-registry.md:5-8`, reader 1).
  CONFIRMED
- **Admission**: `admitSource` refuses `blocked`, `disabled`, `operator_disabled` (the off-only switch `SIRKIT_ACQUISITION_DISABLED_SOURCES`)
  and `credentials_missing`, naming variables, never values (`:556-587`). CONFIRMED
- **Data that leaves today**: DigiKey's token form (client id and secret) and keyword searches `{Keywords, Limit <= 5}`; Nexar GraphQL
  variables (MPNs or a search string); Mouser (disabled) a part-number search. No design file or BOM document leaves (reader 1:
  `app/lib/distributors/digikey.ts:51-57, :91-101`; `octopart.ts:87-93, :118-130`).
- **Live pricing is a granted capability**: only `/api/bom`, `/api/parts/external-search`, the snapshot and the diff call live; CSV export,
  the procurement packet and the three cart routes are public and cache-only (`app/lib/auth/route-policy.ts:230-237`; the snapshot and diff rows are `:281-285` and carry no `providerCredit` flag, their live grant being at `app/api/bom/snapshot/route.ts:38` and `app/api/bom/diff/route.ts:62`, `OWNER_DECISIONS.md:114-116`). CONFIRMED
- **Hand-offs, not integrations**: the three cart routes return downloadable CSVs only (`app/api/bom/cart/digikey/route.ts:20-37`, the
  others identical, reader 4); the procurement packet "is not verified procurement and never places an order; it prices from cached offers
  only" (`app/api/bom/procurement-packet/route.ts:8-9`); the distributor upload pages are links a person clicks
  (`app/lib/distributor-links.ts:4-7, :13-17`; a B19-E test pins that nothing navigates, `app/components/bom/__tests__/b19-e-bom-workbench.test.tsx:145-146`).
  CONFIRMED
- **Fab presets are packaging presets**: four presets with id, name, fab, version, `verifiedAt`, `specUrl`, DRC preset, zip layout, layer
  bundle, drill/pos/bom formats and notes, and no endpoint, credential, operation, terms or enable state (`app/lib/pcb/fab/presets/jlcpcb-2l.fab.json:1-23`);
  the only manufacturer hand-offs are each preset's "Order at ...: upload this zip" note, for example "Order at jlcpcb.com/quote: upload this zip as the Gerber file. ..." (`:22`; also `jlcpcb-4l.fab.json:24`, `oshpark-4l.fab.json:24`, `pcbway-standard.fab.json:22`), each shown as plain
  text in the "Send to fab" dialog (`app/components/pcb/FabDialog.tsx:245`). CONFIRMED
- **Unused CD-6 and CD-12 provider vocabulary**: `ProcurementProviderDescriptor` (`providerId`, `providerVersion`, `providerKind` incl.
  `manufacturer` and `formal_quote`, `regionAccountScope`, `authenticationRef`, `licenseRef`, `retentionPolicyRef`, `semanticsRef`,
  `deterministicDigest`; `app/lib/release-engineering/types.ts:35`), `ProcurementProviderResult` with failure states that cannot carry
  offers (`:36`; `validateProviderResult`, `providers.ts:7`), `ProcurementProvider.capture` (`:5`), `createProviderDescriptor` (`:8`): no
  caller at all, test or production (`git grep`: the only link is the barrel re-export `app/lib/release-engineering/index.ts:11`, itself imported by nothing; `foundation.test.ts` names none of them). CD-6's `SourcingProviderAdapter` has only a fixture implementation (reader 1).
  CONFIRMED
- **No webhook, no signature verification**: the only `createHmac` in production signs Sirkit's own MCP bearer tokens
  (`app/lib/auth/mcp-bearer.ts:23, :248`); `git grep -i` for `webhook`, `x-signature`, `idempotency-key` and `UNKNOWN_PENDING` over
  production code is empty; no `app/api` path names order, quote, DFM, upload, webhook, purchase or checkout. CONFIRMED
- **Live vendor calls**: none from the execution environment; B19's proofs use fake servers behind the real boundary and the live contract
  check is opt-in and BLOCKED-LIVE-QUALIFICATION (reader 1: `artifacts/ai-control-plane-b19/final-verdict.md:27, :51-52`).

### 2.2 The deterministic release B23 would send

- **Identity**: `manifestContentDigest = "mfg-manifest-" + sha256(stableJson(normalized content))` with files, absences, limitations and
  route pass ids sorted; `releaseId = "mfg-release-" + sha256(manifestContentDigest + NUL + boardDigest)[0..32]`
  (`app/lib/pcb/fab/release-manifest.ts:185-199`); `archiveSha256` over a STORE-compressed ZIP with a fixed date, mode 0644 and sorted members
  (`release-gate.ts:282-286, :357, :367`). CONFIRMED
- **Content**: Gerber copper, mask, silk (when present) and outline, PTH/NPTH Excellon, a `.gbrjob`, `README.txt` and `release-manifest.json`;
  BOM and both placement files are always listed intentionally absent, "Bare-board release does not claim assembly authority."
  (`release-gate.ts:328`). The README says "No manufacturer upload/order has been performed. External board-house DFM and physical prototype
  review remain mandatory." (`:272`); the limitations include "Independent readback is an internal format parser, not third-party
  board-house DFM." and "No first-pass hardware success is guaranteed." (`:349`). CONFIRMED
- **Metadata that would leave if the archive were sent unchanged**: `source: { tenantId, projectId, branchId, designId, boardId,
  boardRevision, boardDigest, schematicRevision, schematicDigest }` (`release-gate.ts:332`; type `release-manifest.ts:113-123`); RC01-RC03
  evidence ids and digests, the component authority, the full rule profile, tool versions, `releaseMode`, `sourceDate` and `actor`, the
  qualifying human's actor id (`release-gate.ts:333-343`; `qualify/route.ts:284`); counts, readiness digests, the file list (path, role,
  kind, media type, bytes, sha256) and limitations (`release-gate.ts:344-349`; `release-manifest.ts:94-103`). CONFIRMED
- **The release route** (`app/api/pcb/release/route.ts`): canonical wrapper with the `project_admin`-only policy, CSRF and a bounded body
  (`:60-66`; `route-policy.ts:95`); forbidden authority keys (`:67-68`); human `project_admin` only, `MFG_RELEASE_HUMAN_REQUIRED` (`:75`);
  closed body keys `boardId, designId, expectedAuthorityRevision, expectedAuthorityDigest, format` (`:54`, `:77-78`); mandatory pins,
  `MFG_AUTHORITY_CONFIRMATION_REQUIRED`/`_MISMATCH` (`:95-101`); superseded lineage (`:107`); authority must match the current board
  revision AND digest, `MFG_AUTHORITY_STALE` (`:109-111`); rule-profile schema v2, expiry and a 366-day age bound at release time
  (`:51`, `:114-120`); generation (`:124`); ledger record (`:126-139`); headers including `X-Sirkit-Release-Recorded` created/existing
  (`:140-151`). CONFIRMED
- **The gate re-validates and re-reads**: `releaseManufacturingPackage` reloads the authority after generating and requires byte-equal
  content and the same board revision and digest (`release-gate.ts:365-366`); it refuses `assembled_pcb` (`:189`). The authority store's
  loader reads the aggregate head and returns null on a record-digest or board mismatch (`app/lib/pcb/fab/authority-store.ts:58-62, :91-100`).
  CONFIRMED
- **The ledger**: append-only per board, idempotent by `releaseId` (`release-ledger.ts:72-76`), commit key `release:<boardId>:<releaseId>`
  (`:83`), outbox event `mfg.release-recorded` (`:85`); the record stores digests, filename, actor and `releasedAt`, no bytes and no file
  list (`:24-39`). CONFIRMED
- **Reload-time currency**: `authorityCurrent` compares the authority's board revision with the loaded board revision only
  (`app/api/pcb-sync/manufacturing-summary.ts:83`); `GET /api/pcb-sync` is readable by every member (`route-policy.ts:93`). CONFIRMED
- **The UI**: "Request release" is disabled with a reason in its title unless the authority is current and the viewer may release
  (`ManufacturingWorkflowPanel.tsx:52, :71`); the admin dialog names the authority, board revision, component-authority digest, profile id
  and qualified-at, with no file list (`:99-119`, `:106-112`); the hook posts scope and pins only, never `format`
  (`app/components/pcb/hooks/useManufacturingWorkflow.ts:239`); the result carries the not-fabricated/ordered/assembled sentence (`:96`,
  pinned at `manufacturing-workflow-panel.test.tsx:148`). CONFIRMED
- **The engineering export is not the release**: `POST /api/pcb/export/gerbers` refuses `releaseMode: "verified"` (409), stamps a
  `generatedAt` and DEFLATE-compresses (`app/lib/pcb/fab/build-bundle.ts:234, :269`), includes BOM and CPL CSVs (`:230-231`, `:286`) and is
  labelled "ENGINEERING PROTOTYPE EXPORT ... NOT a verified manufacturing release" (`app/api/pcb/export/gerbers/route.ts:5-19, :56`).
  CONFIRMED
- **Scope**: only `jlcpcb-2l` is a qualified rule profile (`rule-profile.ts:30`), qualification seals `bare_pcb` (`qualify/route.ts:82,
  :282-284`), the profile declares `assembly: { supported: false }` (`rule-profile.ts:97`), and its evidence (a transcription of
  `https://jlcpcb.com/capabilities/pcb-capabilities`, retrieved 2026-09-09) expires one year later (`:45-48`). CONFIRMED

### 2.3 The egress boundary and outbound data

- **One egress path** for acquisition sources: HTTPS only, no URL credentials, exact per-source host allowlist, every resolved address
  public, manual redirects re-checked hop by hop, one deadline over DNS, connect, headers and body, a bounded reader, closed redacted
  failures (`app/lib/net/outbound-fetch.ts:1-22`, `:96-119`, `:261`, `:323-329`). The rebinding window between the check and the connect is
  a stated limit (`:13-16`). CONFIRMED
- **The request shape**: `OutboundRequest { url; method?: "GET" | "POST"; headers?; body?: string | URLSearchParams; signal? }`
  (`:128-134`), passed unchanged to the transport (`:252-261`); no byte, stream, Blob or multipart body; no request-size bound. CONFIRMED
- **Distributor egress**: policy from the registry (exact hosts, deadline, ceiling, `maxRedirects`, secret query params, JSON only), admission
  against quota and breaker before sending, `contentHash` (SHA-256 of the exact bytes) and `retrievedAt` on success
  (`app/lib/distributors/egress.ts:30-47, :64-95`); typed to `"digikey" | "mouser" | "octopart"` (`:14`). CONFIRMED
- **Admission meters**: quota windows, breaker, half-open trial, an agent purpose share of 0.25 (`app/lib/acquisition/admission-control.ts:37`),
  keyed by `acquisition-source`, `mcp-server` or `llm-provider` (`:48-50`); meters live in one process, a stated limit (`:26-28`); in-flight
  coalescing of identical reads (`:308-318`). CONFIRMED
- **Other outbound callers**: the SchGen cross-verify client (re-POSTs on 503 up to 3 attempts, `app/lib/schgen/endpoint-client.ts:30,
  :144-157`), the MCP transport, OAuth discovery and token client (reader 3); the LLM SDKs and Supabase use their own transports (reader 3).
  The external MCP registry is empty (OD-48, `app/lib/mcp/server-registry.ts:134-138`). CONFIRMED
- **Uploads**: `git grep` over production `app`, `lib` and `scripts` for `multipart`, `FormData`, `presign`, `signedUrl` and `.upload(` is
  empty; the only Blob uses are browser downloads (reader 3). CONFIRMED (grep)
- **The approval shape closest to B23-B step 3**: the assignment queue's preview returns a plan with `planDigest` and an `expiresAt` 10
  minutes ahead (`app/lib/assignment-queue/service.ts:60`); commit needs `planId` and `planDigest` (`:71`), refuses a reused idempotency key
  with a different plan (`AQ_IDEMPOTENCY_KEY_REUSE_CONFLICT`, `:71`) and a stale or expired plan (`:72-73`); the route requires an opt-in
  header `x-sirkit-assignment-commit: apply_exact_plan` (`app/api/assignment-queue/route.ts:44`). CONFIRMED
- **The durable substrate**: commit idempotent by `(scope, scopeKey, idempotencyKey)` with `getReplay` (`app/lib/durable-workflow/types.ts:35-51`);
  the outbox has states `pending | processing | completed | failed` (`:23`) and its dispatcher re-queues a throwing handler after 5 s up to
  8 attempts (`outbox.ts:17, :31-35`). CONFIRMED
- **The browser** has a CSP for images only (`next.config.ts:10`); B23's transfers are server-side. CONFIRMED

### 2.4 Procurement, ordering and spend

- **No ordering, cart-fill, checkout, payment or spend path** exists in any route, tool, control, MCP surface or specialist role: no
  action id is an order or procurement action; `bom.workbench` says its exports are "cache-priced downloads only (no ordering)" and "No
  route places a vendor order or fills a vendor cart" (`app/lib/engineering/action-registry.ts:159`). CONFIRMED
- **CD-12 models procurement offline**: exact decimal money and per-currency totals (`ProcurementAllocation.unitPriceDecimal`,
  `ProcurementScenario` with `nonCommitmentNotice: true` and `expiresAt`, `release-engineering/types.ts:37-38`); offer snapshots with
  `offerClass` incl. `formal_quote` and freshness (`:33`); `ApprovalMatrix` with quorum and `proposerCannotApprove` (`:60`); throwing stubs
  `approveAsAgent`, `placePurchaseOrder`, `sendExternalReviewRequest` (`governance.ts:8-10`), `applyCd12Proposal` and
  `writeManufacturingBytesFromLlm` (`agent-tools.ts:7-8`); capability profile lists `direct_purchasing` and `autonomous_production_release`
  unsupported and `fabricator_process_acceptance`, `assembler_process_acceptance`, `quote_exceptions` and `physical_first_article` as
  external-review domains (`capability.ts:7-8`). None of the procurement, provider or governance functions has a production caller.
  CONFIRMED
- **Distributor prices** are JavaScript numbers (`PriceBreak.price: number`, `app/lib/distributors/types.ts:12-15`) totalled in one currency,
  `PRICING_CURRENCY = "USD"` (`:123`). CONFIRMED
- **Roles**: `ProjectRole` is `viewer | commenter | pcb_editor | automation | reviewer | project_admin | migration_admin`; no purchaser
  (`app/lib/engineering/types.ts:15`). CONFIRMED
- **Feature flags that gate external actions**: `SIRKIT_MCP_ENABLED`, `SIRKIT_ACQUISITION_DISABLED_SOURCES`, `SIRKIT_ORCHESTRATION_ENABLED`
  (reader 4; `source-registry.ts:556`; `orchestration-runtime.ts:39-43`); none for ordering, procurement or quotes (reader 4). CONFIRMED
  in part
- **The execution grant** (Tier 1) is minted only from the `/api/chat` composition root and consumed by the editor session
  (`app/api/agent/execution-grant/route.ts:10-11`; `action-registry.ts:77`). CONFIRMED

### 2.5 Physical evidence and the assembled-product claim

- **`manufacturing.assembled-release`**: kind destructive, status `missing`, handler "explicitly blocked", `domainCommand: null`,
  `mutationAuthority: "none"`, `toolExposure: "none"`, approval tier `release`, note "[B17-A] still missing: no route, no control;
  assembled-product release is out of scope until the component-acquisition and assembly chapters (B22–B24)." (`action-registry.ts:118`).
  B17-A requires a `missing` record to be reachable by no control and no route (`b17-a-control-inventory.test.ts:63`). CONFIRMED
- **The runtime block**: `MFG_ASSEMBLY_AUTHORITY_UNAVAILABLE` (422) for `assembled_pcb`, message "Assembled release is blocked until exact
  approved MPN, population variant, BOM, placement, and paste authority is available." (`release-gate.ts:189`;
  `manufacturing-errors.ts:62`), pinned at `app/lib/pcb/__tests__/manufacturing-release-gate.test.ts:149-150`; qualification can seal only
  `bare_pcb` (`qualify/route.ts:284`). CONFIRMED
- **The only physical-evidence types**: CD-12 `BuildLotRecord` (lot, receipts, traceability, deviations, as-built population,
  programming/calibration/test, inspection/yield/nonconformance refs, status, signatures) and `PhysicalValidationEvidence` (unit/lot/release
  refs, procedure, environment/equipment/operator, raw artifacts, `result: pass | fail | indeterminate | invalid`, uncertainty, anomalies,
  review approvals) (`release-engineering/types.ts:66-67`); neither is a member of `ReleaseEngineeringProjectState` (`:70`); the CD-12 tables
  are problems, BOMs, procurement snapshots, artifact manifests, candidates, release manifests, level assessments and project states
  (`app/lib/db/schema.ts:1169-1176`). Nearby: `ScopedException.kind` is `deviation | waiver` (`types.ts:58`); `ExternalReviewRecord` is a
  DFM/DFT review disposition with a `signatureRef` (`:51`). CONFIRMED
- **Where CD-11/CD-12 state lives**: browser `localStorage` (`lib/persistence.ts:612-628`). CONFIRMED
- **Latent gates**: CD-12 `EXECUTED_PHYSICAL_PROCESS_QUALITY_EVIDENCE` passes when the caller's ref list is non-empty and
  `PRODUCTION_RELEASE_AUTHORITY` checks a caller-supplied `actor.actorKind === "human"` (`release-engineering/readiness.ts:24-25`), tested
  only with an empty list (`foundation.test.ts:41`); CD-11 `evaluateFactoryMeasurement` demotes a dry-run pass to indeterminate
  (`DRY_RUN_CANNOT_PASS_HARDWARE`) but passes a caller-declared `hardware` class (`app/lib/firmware-bringup/factory.ts:5`); CD-13
  `computeRuntimeVerdict` counts `waived` as passed (`app/lib/full-flow/verdict.ts:5`). None has a production caller (`git grep`). CONFIRMED
- **CD-11 refuses executed-hardware claims in the definition package** (`CD11_BRINGUP_HARDWARE_EXECUTION_CLAIM_FORBIDDEN`,
  `CD11_BRINGUP_STEP_UNSAFE_OR_FABRICATED`, `app/lib/firmware-bringup/bringup.ts:4`; `hardwareExecutionState: "unexecuted"`, `types.ts:62,
  :65, :72`; CD-12 `CD12_CD11_EXECUTION_STATE_UNEXPECTED`, `release-engineering/problem.ts:19`); no test exercises the two bring-up codes
  (`git grep`). CONFIRMED
- **Human-truth labels**: the release panel (`ManufacturingWorkflowPanel.tsx:96`), the README and limitations (`release-gate.ts:272, :349`).
  CONFIRMED

### 2.6 Agent reach: tiers, exposure, MCP, specialists

- **Tier 3** "publish, release, upload, purchase/order → never agent-executable" (`permission-tiers.ts:14`, `:31`); the id floor
  `TIER3_FAMILY_PATTERN = /(release|publish|publica|upload|order|purchas|qualif|ship|deliver)/i` (`:36`) applies to tool ids (`:52`) and
  action ids (`:57`); approval tier `release` or kind `release` is Tier 3 (`:40`); `decideAgentExecution` answers `never` for Tier 3
  (`:141`); pinned for `bom.order`, `external.upload`, `purchase` and others (`b18-a-permission-tiers.test.ts:64`). CONFIRMED
- **Exposure**: only `read`, `propose` and `view-session` classes, plus reviewed Tier 1 granted mutations with `engineering-state` side
  effects (`app/lib/engineering/agent-exposure.ts:19, :25-28`; `granted-execution-families.ts:100-104`); `TOOL_SIDE_EFFECTS` is `none,
  derived-cache, proposal-artifact, engineering-state, release-artifact, session-state` (`app/lib/engineering/tool-registry.ts:54`); a
  `bound-external-read` is read class, side effects none or derived-cache, approval tier `none`, exactly one external authority, a named port
  (`:282-287`); since B22-B a second port-bound class, `bound-computation` (authority `computation-engine`, `:64`, `:98`; rule at `:292`, `:488-497`), is likewise read class, derived-cache and approval tier `none`, i.e. Tier 0, and B22 added three Tier 0 computation reads to the agent set (`agent-exposure.ts:64`), which is now 36. CONFIRMED
- **The never-execution sweep** covers descriptors that are mutate/destructive/release, match the floor or compute Tier 3
  (`app/lib/agent/__tests__/b18-c-never-execution-sweep.test.ts:63-72`) and refuses a renamed `bom.order` (`:101-106`). CONFIRMED
- **MCP**: Tier 3 excluded structurally first (`app/lib/engineering/mcp-exposure.ts:130-131`), then, since B22-B, any `sirkit.computation.*` id or `bound-computation` binding (`:132`, the `computation` reason right after `never_exposed`, its order pinned at `b22-b-exposure.test.ts:68`), and external reads (`:138`); a forged
  `sirkit.pcb.order-inspect` is never listed or served (`b20-c3-negative-tripwires.test.ts:81-95`); no served id or title may contain
  release, upload, order, purchase and other authority words (`:195-197`). CONFIRMED
- **B21 specialists**: discovery and context drop exactly `external-observation`, `external-mcp-observation` and, since B22-B, `computation-engine` (`app/lib/agent/orchestration/scheduler.ts:183,
  :220`; `withdrawAuthority` also strips `computationAvailable`, `:175`; pinned by `b22-b-exposure.test.ts` case 4, `:127-156`), while the specialist-claims check still names only the two external authorities (`:257-258`); role rows refuse ids matching the never-exposed patterns or the Tier 3 floor (`role-tools.ts:121, :130`). CONFIRMED
- **The chat closure tripwire** forbids `app/lib/acquisition`, `app/lib/distributors` and `app/lib/mcp` except named modules
  (`app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts:128`). CONFIRMED
- **The B19-E no-purchase tripwire**: purchase wording `/add to cart|checkout|\bbuy\b|place (an )?order|purchase order|order now|project
  cart|populate your cart/i` in production copy (`app/lib/engineering/__tests__/b19-e-no-purchase-tripwire.test.ts:26`), no programmatic
  navigation to a distributor upload page, no route naming `/placeOrder|checkout|addToCart|purchaseOrder/` (`:168`, `:302-307`), cart and
  worksheet routes cache-only; each checker bites (`:309-311`). CONFIRMED

### 2.7 Prior records, guards and tests that B23 inherits

- **Release perimeter**: release is human `project_admin` only and refused for ai, automation, system_migration and non-admin humans before
  any durable read (`app/api/pcb/release/__tests__/release-human-only.test.ts:30-54`); pins mandatory and matching
  (`b16-a-release-confirmation.test.ts:45-104`); exactly two `releaseOrQualification` rows (`b16-0-1-ci-gates.test.ts:186-196`);
  stale-authority and invariant tripwires (`b16-0-15-tranche-parity.test.ts:330`; `b16-1c-invariant-tripwires.test.ts:93-112`, reader 2).
  CONFIRMED (first two and the third re-read)
- **No agent release path**: `sirkit.manufacturing.release` internal-only, not callable (`b16-0-15-manufacturing-boundary-gate.test.ts:72-91`,
  reader 2); the executor refuses release-tier commands (`executor.ts:389-390`, reader 2); MCP answers it with the unknown-tool refusal
  (`b20-d2-never-reachable-sweep.test.ts:808`, reader 2); the router refuses "Upload the Gerbers to JLCPCB." and "Place an order for the
  assembled boards." (`app/lib/agent/orchestration/__tests__/b21-b-router.test.ts:27-28`). CONFIRMED (router test re-read)
- **Determinism**: two releases of one authority are byte-identical (`manufacturing-release-gate.test.ts:130-135`, reader 2); the pinned
  identities above; the browser proof shows editor refusal, admin authorization, independent verification and an idempotent duplicate
  (`e2e/prompt-to-gerber.spec.ts:160-199`, reader 2).
- **Generated-artifact gates**: the action registry render equals `artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv`
  (`app/lib/engineering/__tests__/action-registry.test.ts:97-100`; the assembled-release row at `:47` of the CSV); the source registry CSV
  (reader 1). CONFIRMED
- **Standing gates B23 moves only by review**: route census (`b16-1c-invariant-tripwires.test.ts:38-51`, header line `:50-51`); counts
  47/36/9/27 (`b20-c1-three-way-parity.test.ts:241`, B22-B, OD-139); the nine B11-scanned files (`app/lib/agent/orchestration/tripwires.ts:9-19`); CSRF on every authenticated non-GET route
  (`b16-0-1-ci-gates.test.ts:160-177`, reader 6); bounded readers and authorization order (`b16-0-2-gates.test.ts:153-175`;
  `b16-0-4-authorization-and-body-gates.test.ts:30-90`, reader 6); three process spawners and two worker-thread starters (`APP_SPAWNERS`, `b20-b4-process-gate.test.ts:40-44`: the diagnostic runner, the autoroute runner and the kicad-cli runner; the engine host and its worker; OD-136, OD-140);
  B17-A control inventory (`b17-a-control-inventory.test.ts:31-44, :93-95`, reader 6); the CD-12 propose route answers
  `hasExternalOrPurchasingSideEffects: false` (`app/api/release-engineering/propose/route.ts:8`, pinned at
  `app/api/release-engineering/__tests__/routes.test.ts:7`); since B22, `b22-closeout-statements.test.ts` (scans every `artifacts/**/*.md` outside B22's lead records and closeout page, plus `docs/` and `README.md`, for superseded count and spawner phrases, `:47-48`, its page allow-list pinned at 20 admits), `b22-a2-process-census.test.ts` (case 3, `:326`: each route's `external_process` equals the census derived from source; case 5, `:368`: `/api/pcb/release` reaches no spawner), `b22-b-exposure.test.ts` (case 4: the `computation-engine` withdrawal; `:68`: the `MCP_EXCLUSION_REASONS` order) and `b22-b-no-generic-exec.test.ts` (case 5, `:126`: no B11-scanned file names a B22 identifier). CONFIRMED in part
- **Precedents in owner decisions**: OD-1 rule profile v2 with source URLs, `retrievedAt`, `expiresAt` (`OWNER_DECISIONS.md:7`); OD-129
  readiness evidence only by reference to a recomputed report (`:1363-1376`); OD-130 a candidate part is evidence, never a replacement
  target (`:1378-1389`) - the precedent for "never auto-accept substitutions" (reader 6).

---

## 3. What B23 reuses

| Requirement | Existing mechanism | file:line | Gap |
|---|---|---|---|
| B23-A reviewed descriptors | `SourceRegistryEntry`, `validateSourceRegistry`, the byte-gated CSV render, `admitSource` with the off-only operator switch | `source-registry.ts:102-176, :556-587, :601-672, :688-740` | Distributor-only; lacks the B23-A fields (D23-1, D23-2) |
| B23-A provider kinds | CD-12 `ProcurementProviderDescriptor`, `ProcurementProviderResult`, `validateProviderResult` | `release-engineering/types.ts:35-36`; `providers.ts:4-9` | Unwired; lacks endpoint, operations, limits, webhook, idempotency, order policy, tier (D23-2) |
| B23-A capability mapping | The qualified rule profile with sources, `retrievedAt`, `expiresAt`, `ruleProfileEvidenceStatus` | `rule-profile.ts:28-58, :105-116` | `jlcpcb-2l` only (D23-18) |
| B23-A "no scraping"; hand-offs distinct | LCSC blocked "no scraping and no unofficial access"; deep links and CSV downloads that never navigate | `source-registry.ts:526`; `distributor-links.ts:4-17`; `b19-e-bom-workbench.test.tsx:145-146` | None; carried as a validator rule |
| B23-B step 1 revalidate | The release route's chain (pins, head, lineage, revision and digest, profile expiry and age); the gate's reload re-check | `release/route.ts:88-123`; `release-gate.ts:365-366` | Inline in the handler (D23-7) |
| B23-B step 2 disclose | Manifest file records (path, role, bytes, sha256) and `intentionallyAbsent` | `release-manifest.ts:94-103, :178-179`; `release-gate.ts:324-328` | Never shown; source block carries internal ids (D23-6) |
| B23-B step 3 approve | Assignment-queue preview/commit: plan digest, 10-minute expiry, opt-in header, key-reuse refusal; B22-B's sealed computation request (server-sealed digest and nonce, 15-minute TTL, human-only exact-digest approval, agent approver refused, consumed once before the executor runs) | `assignment-queue/service.ts:60, :71-73`; `assignment-queue/route.ts:44`; `app/lib/computation/requests.ts:21, :91-122, :176-206` | Not wired to any egress; the sealed request is in-memory, route-less (OD-159 proposed) and names no provider or purpose (D23-7) |
| B23-B step 4 transport | `outboundFetch` (exact hosts, SSRF, manual redirects, deadline, bounded response); `distributorJson` admission | `outbound-fetch.ts:96-134, :229-334`; `egress.ts:64-95` | No request body bound, no upload, no idempotency key (D23-3, D23-4) |
| B23-B step 4 meters | Admission keys, quota windows, breaker, purpose share | `admission-control.ts:37, :48-56` | No provider key kind (OD-165) |
| B23-B step 5 receipts | Release ledger (append-only, idempotent, record digest, outbox); durable commit replay; `contentHash` + `retrievedAt`; B22's silent `computation.evidence.v1` aggregate (CAS on revision, idempotent append, digest re-verified on load, no outbox effect, raw artifacts referenced by SHA-256, OD-141) | `release-ledger.ts:55-90`; `durable-workflow/types.ts:35-51`; `egress.ts:94`; `app/lib/computation/evidence-store.ts:1-29, :248-255` | No provider receipt store (D23-5) |
| B23-B step 6 observations | `sourcing_observation` and `ENGINEERING_FACTS_NEVER_PROVEN_BY_SOURCING`; CD-12 `formal_quote` and freshness | `source-registry.ts:47-56`; `release-engineering/types.ts:33` | No manufacturing-observation class (B23-B3) |
| B23-B step 7 staleness | Offer TTLs; rule-profile expiry; the summary's current flags | `rule-profile.ts:105-116`; `manufacturing-summary.ts:74-114` | Revision-only flag (D23-17) |
| B23-B step 8 no auto-accept | OD-130 (candidate is evidence, not target); CD-12 proposals are `proposal_only`, `applyCd12Proposal` throws | `OWNER_DECISIONS.md:1378-1389`; `agent-tools.ts:5-7` | No provider-suggestion record (B23-B3) |
| B23-C visibly disabled | Registered-but-blocked record pattern; disabled control with a reason in its title | `action-registry.ts:118`; `ManufacturingWorkflowPanel.tsx:52, :71` | Ordering has neither (D23-10) |
| B23-C confirmation and authorization | Release pins; the durable one-shot grant store (CAS, burn, lazy expiry) and B22-B's human-only, digest-approved, single-use computation request, both as structural models only | `release/route.ts:95-101`; `app/lib/execution-grant/store.ts:1-19` (reader 4); `app/lib/computation/requests.ts:1-13, :21-23` | Mint is model-initiated; no purchase authorization (D23-11) |
| B23-C money | CD-12 exact decimals and per-currency totals | `release-engineering/types.ts:37-38` | Live prices are float USD (D23-11) |
| B23-C two-person rule | `ApprovalMatrix` quorum and `proposerCannotApprove`; `evaluateApprovalMatrix` | `types.ts:60`; `governance.ts:7` | Caller-supplied actor (D23-14) |
| B23-D definitions | `BuildLotRecord`, `PhysicalValidationEvidence`, `ScopedException`, `ExternalReviewRecord`; CD-11 measurement rule and dry-run demotion | `release-engineering/types.ts:51, :58, :66-67`; `firmware-bringup/factory.ts:4-5` | Not server-owned, categories missing (D23-13, D23-14) |
| B23-D block | The gate refusal, the `missing` record, B17-A unreachability, the Tier 3 floor | `release-gate.ts:189`; `action-registry.ts:118`; `b17-a-control-inventory.test.ts:63`; `permission-tiers.ts:57` | Unblock condition omits physical evidence (D23-15) |
| No agent can release or spend | Tier 3 floor, `decideAgentExecution`, sweeps, MCP exclusion (including B22's structural `computation` exclusion keyed on binding status, the precedent for B23-A2), role rows, router refusal, B19-E tripwire | section 2.6; `mcp-exposure.ts:132`; `tool-registry.ts:292` | Word-based floor; the B21 withdrawal is a three-name denylist since B22-B (D23-8, D23-12) |
| CI admission | Job-scope guard `CHAPTERS`, ending with `"b22-"` since B22-A1 (OD-146) | `b19-e-ci-job-scope.test.ts:54` | No `b23-` (D23-20) |

---

## 4. Candidate defects and gaps

Severity: high = blocks a B23 requirement outright; medium = a requirement partly served or needing a contract change; low = a
recordable limit, hygiene, or a requirement that matters only once the owner enables ordering. "Closes" names the increment in section 7
or an owner decision. Merged from the readers' 59 gap candidates; each defect keeps its sources. No gap is counted twice.

**D23-1 - No reviewed descriptor exists for any manufacturer, assembler or quote service.** Requirement: B23-A `:952-967`, `:969`. Finding:
the only provider registry in production use is B19's (`SOURCE_REGISTRY_VERSION = "1.1.0"`, `source-registry.ts:24`), whose id union is
`"digikey" | "mouser" | "octopart" | "lcsc"` (`:26`) and whose only authority class is `sourcing_observation` (`:47`, enforced at `:647`);
JLCPCB's API is a note, "approval-gated ... it is not a registered source" (`:468`); JLCPCB, PCBWay and OSH Park appear as four fab
presets carrying a name, a Gerber-generation help URL and `verifiedAt` 2026-07-09 (`app/lib/pcb/fab/presets/jlcpcb-2l.fab.json:3-7`; the
same keys in `jlcpcb-4l`, `pcbway-standard`, `oshpark-4l`), as four DRC capability presets (`app/lib/pcb/drc/presets/*.json`) and in the `jlcpcb-2l` rule profile (`rule-profile.ts:30`, `:46`), none with an endpoint, credential reference, operation, terms or enable state; the
CD-12 `ProcurementProviderDescriptor` (`release-engineering/types.ts:35`) and `createProviderDescriptor` (`providers.ts:8`) have no
caller at all, tests included (`git grep`; the only link is the re-export `app/lib/release-engineering/index.ts:11`); MacroFab and Eurocircuits are named nowhere (reader 7). Severity high. **CONFIRMED**. Closes: B23-A1
(OD-161, OD-162). Sources: S1-G1, G7-1, S4-G3 (in part).
- [B23-A1, 2026-10-02] Closed (OD-161, OD-162). app/lib/manufacturing-providers/provider-registry.ts (PROVIDER_REGISTRY_VERSION 1.0.0) holds a reviewed, deep-frozen, validated row for JLCPCB, PCBWay, OSH Park, MacroFab, Eurocircuits and the four B19 distributors (DigiKey, Mouser, Nexar via B19's octopart, LCSC). Every provider fact is RECORDED from section 1.2 (reader 7, 2026-10-01; not re-read in A1, OD-181). CD-12's ProcurementProviderDescriptor gains its first caller through the pure projection cd12-projection.ts, a test caller only; no production caller. CONFIRMED by b23-a-provider-registry (94 tests) and b23-a-provider-admission (11, the lead's case 11 included).

**D23-2 - Neither descriptor shape can express the B23-A fields.** Requirement: B23-A `:958-967`. Finding: `SourceRegistryEntry`
(`source-registry.ts:102-176`) has no capability-profile mapping; no field for how a provider retains or protects data Sirkit SENDS (its
`license` block governs how long Sirkit keeps the vendor's observations, `:152-171`); no upload-size or quote-count limit (quota counts
requests and resilience bounds the response, `:131-145`); no webhook/signature contract, idempotency support, order/cancellation policy or
per-operation feature tier - `SourceStatus` is `enabled | disabled | blocked` for the whole source (`:58`, `:175`). `AuthMethod` (`:60`)
has no 3-legged authorization-code OAuth (DigiKey's Quote and Ordering pages say "Only 3-legged OAuth", section 1.2), no header API-key
method (PCBWay `api-key`, MacroFab `X-MacroFab-API-Key`; a header placement exists only on `SecretReference`, `:69`) and no session token
(OSH Park); a signed partner request exists (`:60`, `:477`). The blocked LCSC row lists no operations (`:471-474`) although the official
index lists order operations (section 1.2); the validator makes this structural (an operation host must be in `hosts`, `:625`, and a blocked source may declare no hosts, `:629`), and a disabled source can list operations only as a whole (Mouser `:297`, `:354`), so what cannot be recorded is a per-operation enable state, tier or kind (read, quote, order). The CD-12
descriptor (`types.ts:35`) lacks the same fields apart from opaque `licenseRef` and `retentionPolicyRef` strings. Severity medium. **CONFIRMED**. Closes: B23-A1 (OD-161, OD-162). Sources: S1-G2, S1-G3
(the descriptor half), S1-G4 (the descriptor half), S4-G3, G7-2, G7-4.
- [B23-A1, 2026-10-02] Closed (OD-161, OD-162). Each row carries all twelve runbook :956-967 fields as closed, typed fields (UNKNOWN only as the literal with a reason; 82 records, all rendered). Each operation has its own tier (none < handoff < read_observation < dfm_quote_transfer < ordering), channel (api, deep_link, csv_export, manual_upload) and state (enabled, disabled, blocked), so ordering is recorded present-but-disabled (nine operations, LCSC's order API among them). The auth vocabulary adds a header API key, a query-parameter key, a session token, OAuth2 client credentials, 3-legged authorization-code OAuth and a signed partner request; it is pinned per operation (case 6) and rendered in the byte-gated CSV (operation_auth). Outbound retention/confidentiality, upload/quote limits, webhook, idempotency and order/cancellation policy are fields. CD-12's descriptor stays as it is, produced by projection (no third shape). CONFIRMED.

**D23-3 - The single egress boundary cannot send an upload.** Requirement: B23-B step 4 `:978`; global `:155`. Finding:
`OutboundRequest` is `{ url; method?: "GET" | "POST"; headers?; body?: string | URLSearchParams; signal? }` (`app/lib/net/outbound-fetch.ts:128-134`):
no byte, stream, Blob or multipart body, no request-size ceiling, no idempotency-key field; the body reaches the transport unchanged
(`:252-261`); only the response is bounded (`:96-119`, `:323-329`); `distributorJson` is typed to three distributor ids and judges JSON
only (`app/lib/distributors/egress.ts:14, :38, :85`); production code holds no `multipart`, `FormData`, presigned URL or `.upload(` (`git
grep`). Carried limit: the DNS-rebinding window between admission and connect stays open by design (`outbound-fetch.ts:13-16`; OD-51 and
OD-42, reader 3), recorded, not closed by B23 without an owner decision. Severity high. **CONFIRMED**. Closes: B23-B2 (OD-165). Sources:
S1-G5, S3-G1, S3-G10, S6-G5.
- [B23-B2, 2026-10-04] Closed (OD-165). outboundUpload, an additive extension of outboundFetch (app/lib/net/outbound-fetch.ts:487), measures an in-memory bytes or multipart body against the descriptor's ceiling (never above 64 files and 64 MiB, validate-package.ts:14-15) before anything is resolved; maxRedirects 0 and every 3xx answer refused; one deadline over resolution, the durable sent mark, the upload and the answer; no secret in the URL; Idempotency-Key only when declared; no new dependency; the rebinding window stays OD-51's recorded limit. b23-b-bounded-upload (10). artifacts/ai-control-plane-b23/dfm-quote-flow.md section 1.

**D23-4 - No outbound idempotency and no ambiguous outcome state; the only side-effect dispatcher retries automatically.** Requirement:
B23-B step 4 `:978`; B23-C `:998`; global `:139`. Finding: no outbound request carries an idempotency key (D23-3; `git grep -i
idempotency-key` empty in production); `DurableOutboxDispatcher` re-queues any handler error after 5 s up to 8 attempts
(`app/lib/durable-workflow/outbox.ts:17, :31-35`) with states `pending | processing | completed | failed` (`types.ts:23`), and
`UNKNOWN_PENDING_RECONCILIATION` appears nowhere (`git grep`); the SchGen client's re-POST on 503 (`app/lib/schgen/endpoint-client.ts:30,
:144-157`) is right for an advisory read and wrong for a submission; read-side idempotency is in-flight coalescing with 0 automatic
retries (coalescing at `admission-control.ts:308-318`; `retry.automaticRetries: 0` at `source-registry.ts:249`, `:322`, `:418`, `:498`, DigiKey also allowing one token refresh on a 401), while an expired-lease `processing` event is re-claimed, a second automatic re-dispatch (`repository.ts:36`; `server-repository.ts:32`). Reusable: commit idempotency with replay (`types.ts:35-51`; `repository.ts:22-23`;
`server-repository.ts:23`), under which a concurrent duplicate fails the revision check rather than writing twice (`server-repository.ts:25`,
INFERRED, section 0; with no head row yet, a concurrent first commit fails a unique index instead, `schema.ts:1277`, `:1294`, `:1308`). Severity high. **CONFIRMED** (code), **INFERRED** (concurrent case). Closes: B23-B2 (the exchange state machine,
OD-167); B23-C (the order contract, OD-172). Sources: S3-G2, S4-G5, S1-G4 (the idempotency half).
- [B23-B2, 2026-10-04] Exchange half closed (OD-167); the order-contract half stays B23-C's (OD-172). mfg.provider-exchange.v1 (exchange-ledger.ts): attempts keyed by idempotency key (unique per project), prepared -> sent -> acknowledged | rejected | UNKNOWN_PENDING_RECONCILIATION, or -> not_sent; every ambiguous end after the hand-over is UNKNOWN, never retried and never run through DurableOutboxDispatcher (no outbox effect; the expired-lease re-claim finds nothing, repository.ts:36, server-repository.ts:32); a duplicate commit replays and sends nothing, after a restart too; two concurrent commits send once, and one package to one provider is in flight at a time (keyed on the package digest, provider and operation; a `prepared` attempt that sent nothing stops blocking ten minutes after it was prepared, the lead round) (in memory, and on PGlite in the database-delivery job; the server isolation level stays UNKNOWN, section 8 item 10 narrowed); the provider sees a server-derived key. b23-b-exchange-ledger (22), b23-b-exchange-ledger-pglite (4), b23-b-egress-import-gate (6). dfm-quote-flow.md sections 4-6.
- [B23-C, 2026-10-04] Order-contract half closed offline (OD-172): a duplicate submit, two racing submits of one authorization, two authorizations for one cart submitted at once, a new authorization with the lines reordered, relabelled or split, a retry after a timeout and a replayed webhook never create a second order; an ambiguous answer is UNKNOWN_PENDING_RECONCILIATION and the port is never called again (order-contract.ts; b23-c-order-contract cases 4-6, 9, 10).

**D23-5 - No receipt, quote or staleness store, and the release ledger keeps digests only.** Requirement: B23-B step 5 `:979`, step 7
`:981`; global `:140`. Finding: the schema has no quote, order, receipt or provider-upload table (the external-offer tables are
`part_offers`, `atomic_offer_snapshots`, `component_selection_offer_observations` and `procurement_snapshots`, `app/lib/db/schema.ts:267,
:646, :968, :1171`; also `component_selection_sourcing_snapshots`, `:964`, and `atomic_supplier_parts`, `:554`, none a quote, order, receipt or upload table); the release ledger record holds release id, archive and manifest digests, filename, authority and board identity,
actor and `releasedAt`, and no bytes, file list or provider (`release-ledger.ts:24-39`); the authority loader reads the aggregate head
only (`authority-store.ts:58-62, :91-100`), so an older release's bytes can be regenerated only while its authority is still head and its
board current and its rule-profile evidence unexpired and within `RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS` (`release/route.ts:116-120`) (INFERRED), although superseded authorities, which embed board and netlist (`release-gate.ts:77-78`), stay in durable history (`durable-workflow/types.ts:48-49`) with no loader reading them; `distributorJson`'s `contentHash` (`egress.ts:49-52, :94`) is never stored, while its `retrievedAt` is persisted as `part_offers.last_refreshed_at` for every source the registry lets store, Mouser excluded (`distributors/cache.ts:72-75`, `:290-294`, `:307`). Severity high.
**CONFIRMED** (absence), **INFERRED** (regeneration). Closes: B23-B2 (OD-167), B23-B3 (OD-168). Sources: S1-G6, S2-G4, S3-G3.
- [B23-B2, 2026-10-04] Receipt half closed (OD-167); the staleness half stays B23-B3's (OD-168). The record keeps the provider receipt id, the response digest, retrievedAt, the package and release digests, the descriptor (registry version and row digest, transfer version) and capability-profile versions and at most 16 bounded normalized fields; no raw provider body and no archive or file byte (re-derived while the authority is head, the board current and the rule-profile evidence unexpired and within RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS); a provider whose terms forbid storage keeps no provider-chosen text. dfm-quote-flow.md section 4.
- [B23-B3, 2026-10-04] Staleness half closed (OD-168). An acknowledged answer of mfg.provider-exchange.v1 is a closed manufacturing_observation, judged at every GET /api/pcb-sync?include=manufacturing read. It is stale at the provider's stated validity (validUntil), else 24 hours after retrievedAt. It is stale at once when any of these moves or fails: the authority or ledger head; the board revision or authoritative digest; the board (superseded or gone); the registry row (withdrawn too) or the reviewed transfer descriptor; the capability profile; or the rule-profile evidence (not v2, expired, or older than RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS). These are B1's step-1 checks as of the read, so D23-5's re-derivation condition is exactly when an observation can be current. Stale observations stay listed and labelled stale. None is current in production (no reviewed transfer descriptor). CONFIRMED by b23-b-stale-quote (14 cases). dfm-quote-flow.md sections 19, 28.

**D23-6 - Nothing presents exactly which files and metadata would leave, and the release manifest would disclose internal identifiers.**
Requirement: B23-B step 2 `:976`; global `:152-153`. Finding: the admin dialog lists the authority revision and digest, board revision,
component-authority digest, profile id and qualified-at, and no file (`ManufacturingWorkflowPanel.tsx:106-112`); `format: "manifest"`
generates and ledger-records a full release before it branches (`app/api/pcb/release/route.ts:124-139` before `:152-153`) and the hook
never asks for it (`useManufacturingWorkflow.ts:239`); `release-manifest.json` carries `tenantId, projectId, branchId, designId, boardId`
and the qualifying human's `actor` (`release-gate.ts:332, :343`; `release-manifest.ts:113-123, :147`), and any byte change changes
`archiveSha256` (`release-gate.ts:367`) and `releaseId` (`release-manifest.ts:185-199`, derived at `:197`), so a redacted outbound set needs its own identity (INFERRED); no existing
egress shows a disclosure before sending (cross-verify and MCP, reader 3). Severity high. **CONFIRMED** (code), **INFERRED**
(consequence). Closes: B23-B1 (OD-163). Sources: S2-G1, S2-G2, S3-G4, S1-G7 (in part).
- [B23-B1, 2026-10-04] Closed (OD-163). buildOutboundPackage (app/lib/manufacturing-providers/outbound-package.ts:115) derives the outbound package only from a ledgered release whose regenerated archiveSha256 (recomputed from Sirkit's own built bytes; the archive is never re-read), releaseId and manifest digest equal the ledger record. The package is the eight Gerber, Excellon and job files, byte-identical, plus a generated provider manifest (releaseId, archiveSha256, the file list, capability profile jlcpcb-2l v2). release-manifest.json and README.txt are withheld, and no BOM, CPL or distributor value leaves. For the pinned 555, outboundPackageDigest is mfg-outbound-c81e46952d7069fe0d803a5ba9df1d3f13f3a3ee21d32a5bda5939ac03b61cae, stable across builds. The sealed plan and the provider panel list every file with bytes and sha256, every provider-manifest field, the identities whose value leaves inside file names and bytes, and every metadata field the bytes carry (84 for the 555). For the 555, projectId and boardId are carried as the board's file-safe name, disclosed and never stripped (OD-183 (g)); tenantId, branchId, designId and the actor occur in no outbound byte. A project id cut short by the 80-character board name is carried as its kept prefix (form file-safe-prefix). CONFIRMED by b23-b-outbound-package (10), b23-b-approval-plan (18), b23-b-provider-panel (9); artifacts/ai-control-plane-b23/outbound-disclosure.md section 1.

**D23-7 - No per-request approval names a provider and purpose, and the release revalidation is not reusable.** Requirement: B23-B steps
1 and 3 `:975, :977`; mission `:950` ("a single ambiguous click"). Finding: outbound approval exists only at registry level
(`state.ownerDecision`, `source-registry.ts:175`; MCP `server-registry.ts:131`) plus route roles; the revalidation chain (pins, head,
lineage, revision and digest, profile schema, expiry, age) is inline in the release handler (`app/api/pcb/release/route.ts:88-123`); only
`releaseManufacturingPackage` is callable from another path, and besides its reload re-check (`release-gate.ts:365-366`) it re-checks scope, board revision and digest against the locator, the profile schema and the profile expiry at the qualified-at `sourceDate` (`:153-159`, `:179-182`), so only the pins, the current-head comparison, lineage, release-instant expiry and the 366-day age are route-only (`route.ts:95-120`); the only Tier 3
confirmation echoes a revision and digest every member can read from `GET /api/pcb-sync` (`route.ts:95-101`; `route-policy.ts:93`;
`manufacturing-summary.ts:86-98`) with no expiry and no server-minted single-use token (INFERRED: unfit as a provider-and-purpose
approval). The assignment queue's preview/commit is the reusable shape (section 2.3). Severity high. **CONFIRMED** (code), **INFERRED**
(fitness). Closes: B23-B1 (OD-164, OD-166). Sources: S3-G5, S2-G3, S2-G6 (in part), S1-G7 (in part).
- [B23-B1, 2026-10-04] Closed (OD-164, OD-166). The release route's route-only checks (pins, current head, lineage, release-instant expiry, 366-day age) are one exported function, revalidateReleaseAuthority (app/api/pcb/release/route.ts:145). The release route calls it (:91) with the same codes, statuses and bodies, its own suites unchanged and green. POST /api/pcb/provider-exchange re-runs it at preview and again at commit. preview seals a 10-minute plan naming provider, operation, purpose, descriptor version and digest, the exact files and fields, release and authority identity and a request digest. commit needs planId, planDigest, an idempotency key and the opt-in header; it consumes the plan once, re-runs steps 1 and 2, and refuses with no egress if the authority, board, profile, release, package or descriptor moved. A reused key with another plan is refused for 24 hours after the key's commit. In B23, commit always ends provider_not_admitted and nothing is fetched. Only a human project_admin acts, refused before any durable read. CONFIRMED by b23-b-revalidation (23), b23-b-approval-plan (18), b23-b-exchange-route (14).

**D23-8 - The Tier 3 floor and the exposure vocabulary see a file-sending or spending tool only by a word in its id.** Requirement: global
`:148`; Tier 3 `:505`; pass `:1017`. Finding: the floor is `/(release|publish|publica|upload|order|purchas|qualif|ship|deliver)/i`
(`permission-tiers.ts:36`) - no `quote`, `dfm`, `submit`, `checkout`, `cart`, `buy` or `payment`, and no current tool or action id contains
those words (`git grep`, so adding them moves no current classification, INFERRED); `TOOL_SIDE_EFFECTS` has no value for data leaving
Sirkit (`tool-registry.ts:54`); a `bound-external-read` must carry approval tier `none` (`:285`), i.e. Tier 0 (`permission-tiers.ts:44`);
`NEVER_EXPOSED_TOOL_PATTERNS` covers `.release` and `qualif` among manufacturing ids (`granted-execution-families.ts:74-81`); the B21
withdrawal is a two-name denylist (`scheduler.ts:183, :220, :257-258`); the chat-closure tripwire does not forbid
`app/lib/net/outbound-fetch.ts` or any new provider directory (`b19-d-external-text-injection-route.test.ts:128`); the router refuses
head verbs only and only with the orchestration flag on (section 0). Nothing is reachable today because no provider tool exists
(INFERRED); a future read-class `...dfm-check` that sent files would compute Tier 0. Severity medium. **INFERRED** (code facts
CONFIRMED). Closes: B23-A2 (OD-173). Sources: S2-G5, S3-G6, S3-G7, S3-G8, S6-G2.
- [B23 lead, 2026-10-02] Re-verification (section 9): Re-verified at `849a933` (tree of main `43cb1b0`). These hold: `permission-tiers.ts:36`, `:44`; `tool-registry.ts:54`, `:285`; `granted-execution-families.ts:74-81`; `b19-d-external-text-injection-route.test.ts:128`; and the router and flag (`router.ts:82-94`, `:170-174`; `orchestration-runtime.ts:42-43`, `:120-121`). None of B22's five new tool ids or two new action ids (tools 42 -> 47, action records 102 -> 104) contains `quote`, `dfm`, `submit`, `checkout`, `cart`, `buy` or `payment`. B22-B (`b4c7be7`) made the B21 withdrawal a three-name denylist (`scheduler.ts:183`, `:220` add `computation-engine`; `:257-258` unchanged). It also added a second forced-Tier-0 port binding, `bound-computation` (`tool-registry.ts:64`, `:488-497`), and an MCP exclusion keyed on binding status (`mcp-exposure.ts:132`). The gap stands, slightly widened, and that exclusion is a precedent for B23-A2. Both port-bound classes forbid an approval tier (`tool-registry.ts:285`, `:494`), so a port-bound provider read can reach Tier 3 only through a word in its id; approval tier or kind `release` gives Tier 3 at `permission-tiers.ts:40`.
- [B23-A2, 2026-10-02] Closed (OD-173). The side effect external-transfer (TOOL_SIDE_EFFECTS, tool-registry.ts:54; ActionCoverageRecord.sideEffects, action-registry.ts:67) computes Tier 3 wherever a tier is computed (permission-tiers.ts:52, :57; mcp-exposure.ts:130; tool-definitions.ts:284). The validators refuse an exposed transfer tool or a tool-exposed transfer action; the exposure rule, discovery (tool-discovery.ts:179: never listed for an agent, whatever exposure a registry claims) and the B21 role rows refuse it. The never-execution sweep refuses it by the side effect alone: on registry doubles with controls, a forged read is not_discoverable, a dressed granted execution is not_callable on tier 3 and its minter is never called, and the seal answers tier_exceeded with valid arguments. Deleting the seal's tier check, the tier's side-effect clause or the discovery rule each fails the suite. The id floor is TIER3_FLOOR_PATTERN (permission-tiers.ts:169): the nine family stems, quote|dfm|submit|checkout|cart|buy|payment and the whole word pay, added after a census over the 47 tool and 104 action ids (0 matches, 0 tiers moved, B21 role rows unchanged). TIER3_FAMILY_PATTERN (:36) stays the router's nine chat families (OD-182 (b), (h)). The B21 withdrawal drops every external-* authority and computation-engine (scheduler.ts:183, :220, isWithdrawnAuthority :853); the claims check at :257-258 does not follow (OD-182 (c)). The chat-closure tripwire (b19-d-external-text-injection-route.test.ts:128) also forbids outbound-fetch.ts and the provider directory. CONFIRMED by b23-a-tier3-vocabulary (9 tests).

**D23-9 - The route vocabulary cannot mark an external-transfer or spend route.** Requirement: mission `:950`; global `:158`. Finding:
`RoutePolicy` has `providerCredit`, `authoritativeWrite` and `releaseOrQualification` (`route-policy.ts:35-49`); `release()` sets
`releaseOrQualification: true` (`:74-76`) and a gate pins exactly two such rows (`b16-0-1-ci-gates.test.ts:186-196`); the resource
classification has `durable`, `sensitivity`, `externalProcess` and `expensive`, no outbound-egress field (`route-resource-classification.ts:31-36`).
A B23 transfer route would reuse `releaseOrQualification` (moving the pin) or be classified without saying files leave.
Severity medium. **INFERRED** (code facts CONFIRMED). Closes: B23-A2 (OD-174). Sources:
S6-G3, S2-G10, S3-G11.
- [B23-A2, 2026-10-02] Closed (OD-174). Every RoutePolicy row carries externalTransfer and spend (both false; merged in at route-policy.ts:358), gated by routeVocabularyViolations (:375): human session only, CSRF, never public, never viewer, commenter or automation, never the release vocabulary, and no spend row in B23. The two releaseOrQualification rows are unchanged. The B16.0.2 classification gains two derived columns, appended last (external_process stays at index 6). outboundEgress (none | observation-query | files): none means nothing through the egress boundary, derived from the route's import closure reaching app/lib/net/outbound-fetch.ts, with five reviewed public cache-only exemptions whose pricing-gateway edges are pinned too: 7 observation-query rows over 6 paths, 0 files. modelEgress: a model input sent to the LLM provider through its SDK, derived binding by binding, 23 paths. A row sends nothing out of Sirkit exactly when it is none and not modelEgress (136 rows; Sirkit's own store aside). A transport census pins every connection-capable module the routes reach. Two public paths send model input and are reviewed in PUBLIC_MODEL_EGRESS (/api/parts/search, /api/pcb/footprints/search); recorded, not changed (OD-182 (a), (k)). The census stays 165/162/3/0. CONFIRMED by b23-a-route-vocabulary (8 tests).

**D23-10 - Ordering is absent, not visibly disabled, and nothing can hold the owner's seven prerequisites.** Requirement: B23-C `:986-994`;
pass `:1017`. Finding: no action record, flag, notice or control names ordering - the registry mentions it only in passing, in `bom.workbench`'s "(no
ordering)" (`action-registry.ts:159`) and `cd.release-engineering.workbench`'s "never orders or releases" (`:182`), unlike `manufacturing.assembled-release`, registered `missing`, "explicitly blocked" (`:118`); what
a person sees are statements that no order was or is placed (`cart-formats.ts:228`; `ManufacturingWorkflowPanel.tsx:96`; `BomView.tsx:743`, `:1083`, `:1394`), none saying that ordering is a turned-off feature or why; no ordering flag or owner
configuration record exists (reader 4); `ProjectRole` has no purchaser (`engineering/types.ts:15`); the B19-E tripwire fails on the
obvious labels for a disabled control (`b19-e-no-purchase-tripwire.test.ts:26`) and B17-A requires every control classified unavailable to carry a non-empty
reason (`b17-a-control-inventory.test.ts:93-95`) and a `missing` record to be reached by no control and no route (`:63`), the more binding rule for a visibly disabled control. Severity medium. **CONFIRMED** (code), **INFERRED** (reading of `:1017`). Closes: B23-C (OD-170, OD-171). Sources:
S1-G8, S4-G1, S4-G2, S6-G6.
- [B23-C, 2026-10-04] Closed (OD-170, OD-171). orderingEnablement() (app/lib/manufacturing-providers/ordering-enablement.ts:93) answers disabled with the closed list of the seven runbook :988-994 prerequisites, all missing: no owner record exists (ORDERING_OWNER_RECORD null, :36) and no submission port is wired (ORDER_SUBMISSION_PORT_WIRING "none", :39); only a complete, valid owner record AND a wired port enable it. The operator switch SIRKIT_ORDERING_DISABLED only turns it off and no environment variable can enable it: the pure function reads only the environment it is given, and the stores' production default orderingEnablementFromProcess() (:116) reads that one switch from the process at each call (the review round's fix; before, the defaults read no environment and the switch did nothing on the production path). manufacturing.provider-order is appended in place on action-registry.ts:186 (missing; "explicitly blocked: feature-disabled until the owner supplies OD-171's prerequisites"; toolExposure none; approval tier release; Tier 3, decision never), so :118, :159 and :182 keep their lines; the B01 CSV moved once by its generator (:107). The provider panel shows a fixed notice naming the seven prerequisites (ProviderExchangePanel.tsx:129), worded outside B19-E's PURCHASE_WORDING, with no control: B17-A's missing-unreachable rule (:63) holds and the B19-E tripwire is unchanged. CONFIRMED by b23-c-ordering-disabled (7). ordering-boundary.md sections 1-2.

**D23-11 - Nothing exists for the enabled ordering path: no purchase authorization, decimal ceiling, mint/consume import gate or webhook
verification.** Requirement: B23-C `:996, :998`; B23-A `:964`. Finding: the only Tier 3 confirmation binds an authority revision and digest
(D23-7); the one-shot grant is minted from `/api/chat` on the model's call once the user's literal instruction passes the explicit-request grammar (`execution-grant/route.ts:10-11`; `action-registry.ts:77`; wired at `app/api/chat/route.ts:377-393`, dispatched from `gateway.ts:621`), so
its mint path is unfit; live prices are JavaScript numbers, each price break carrying its own currency string and totals in USD (`distributors/types.ts:12-15, :123`) while CD-12 has exact decimals
(`release-engineering/types.ts:37-38`); the authority import gates cover the MCP and orchestration closures but not the single-agent loop,
gateway or chat closure, which already reaches the fab presets (D21-33; reader 6); no webhook route or provider signature verifier exists
(section 2.1). It matters only once the owner enables ordering. Severity low. **CONFIRMED** (absence), **INFERRED** (fitness). Closes:
B23-C (the offline contract, OD-172). Sources: S4-G4, S4-G6, S3-G9, S6-G4, S2-G6 (in part).
- [B23-C, 2026-10-04] Closed offline (OD-172). purchase-authorization.ts: a human project_admin requests a closed binding (a registry ordering operation; 1-64 lines with the unit price seen; an ISO currency; an exact decimal price ceiling, CD-12's decimal text, never a JavaScript number; a destination reference; the release/BOM digest; an expiry at most 10 minutes ahead); a DIFFERENT human project_admin confirms the exact request digest (proposerCannotApprove), the one place a single-use, server-held authorization is minted; one compare-and-set on a snapshot read burns it; any changed field refuses and voids it; ai, automation and every other role are refused at every step; only what comes in is bounded to 12 integer digits, and the arithmetic never throws on its own results; the stores are bounded and refuse when full, writing nothing. The exact approved-importer gate admits purchase-authorization.ts itself and order-contract.ts, which consumes and never spells request or confirm in any form; the agent loop, gateway, chat route, MCP and every orchestration module reach none of the four ordering modules (D21-33's gap, closed for them). order-contract.ts (an injected port; no composition root wires one) claims the cart before the burn, re-reads price and availability immediately before the one submission and refuses a changed price, short stock, a total above the ceiling, other lines (by id and part, in order) or an unreadable re-read, without ever throwing; enablement is checked again before the hand-over; one order per authorization and per unresolved or claimed cart, the cart being each part's total quantity; ambiguity is UNKNOWN_PENDING_RECONCILIATION, never retried; webhook-verification.ts checks a signature over the raw body, a timestamp window and a bounded replay store, and a verified event never creates, submits or changes an order. The cart is read from the canonical binding consume compares, a claimed cart answers ORDER_CART_BUSY (no order exists), and every submit of the claiming authorization holds the claim (the lead round). CONFIRMED by b23-c-purchase-authorization (11), b23-c-order-contract (16), b23-c-webhook-verification (7); twenty source mutations caught at implementation and nineteen in the adversarial-review round. Live: BLOCKED-LIVE-QUALIFICATION (LB-12). ordering-boundary.md sections 3-8.

**D23-12 - The no-order route tripwire matches names, and a foreign MCP tool is excluded only by its own annotations.** Requirement: global
`:148`; pass `:1017`. Finding: the route check is `/placeOrder|checkout|addToCart|purchaseOrder/` over each `route.ts` file's own text only (`:306`; a delegated handler module is not read)
(`b19-e-no-purchase-tripwire.test.ts:168, :302-307`), so a `submitOrder` or `createOrder` route passes; a consumed MCP tool is excluded only
when it declares `readOnlyHint: false` or `destructiveHint: true` (`app/lib/mcp/foreign-tools.ts:17-19, :1171-1172`), and `agentTools` names
are syntax-checked (`server-registry.ts:558-564`), so a reviewed row could admit a vendor `create_order` through the Tier 0 observation read;
the registry is empty (`:134-138`). Severity low. **CONFIRMED** (code), **INFERRED** (consequence). Closes: B23-A2 (a structural route
gate; the foreign-name floor, OD-173). Sources: S4-G7, S4-G8.
- [B23-A2, 2026-10-02] Closed (OD-173). A structural no-order route check (b23-a-no-order-structural, 6 tests) sits beside B19-E's unchanged name check: no policy row is spend, and no route's runtime import closure, delegated handlers included, reaches a module that declares or calls an order, purchase, checkout, cart-fill or payment port. The scan covers module-private functions, class members, object properties, export lists and called property chains; seven look-alikes are reviewed (OD-182 (d)). A neutrally named function that posts to an order endpoint is a stated limit, covered by the classification's observation-query. A consumed MCP row may not approve an agentTools name matching isTier3McpToolName (the id floor plus money and data-leaving words), whatever its annotations claim (server-registry.ts:564, :665); the refusal claims no completeness. The agent port's allowlist approves nothing for such a list (agent-port.ts:223; B20-A4 case 14's fixture moved to update-record). The registry is empty (OD-48). CONFIRMED.

**D23-13 - No server-owned definition of physical-hardware evidence.** Requirement: B23-D `:1002-1011`; global `:138`. Finding: the only
physical types, CD-12's `BuildLotRecord` and `PhysicalValidationEvidence` (`release-engineering/types.ts:66-67`), are not members of
`ReleaseEngineeringProjectState` (`:70`), have no table (`schema.ts:1169-1176`), route, repository, review lifecycle or binding to a
release digest; CD-11/CD-12 state is saved to browser `localStorage` (`lib/persistence.ts:612-628`); several categories have no typed
record: manufacturer acceptance (`ExternalReviewRecord` is a DFM review disposition, `types.ts:51`), per-unit serial identity, incoming
inspection and assembly results (string refs inside `BuildLotRecord`), continuity/power-on (the unexecuted CD-11 `DiagnosticFirmwarePackage` and `BringUpPlan`, `firmware-bringup/types.ts:62,
:65`), functional test (seed per-unit `FactoryTestResult` and `CalibrationResult`, `firmware-bringup/types.ts:53, :57`, neither a member of `FirmwareBringUpProjectState`, `:74`, nor persisted server-side; `BoardIdentityContract`, `:58`, is an identity-source contract, not a per-unit record), rework (`ScopedException.kind` is `deviation | waiver`, `types.ts:58`) and final physical qualification. Severity medium (seed
types exist; a contract is needed). **CONFIRMED**. Closes: B23-D (OD-175). Sources: S5-G1, S5-G2, S6-G1 (in part), S2-G7 (in part).
- [B23-D, 2026-10-05] Closed offline (OD-175). app/lib/manufacturing-providers/physical-evidence.ts defines the eight runbook kinds (:1002-1011) as closed record types with validators; every record binds releaseId, archiveSha256, board revision and digest, the unit or lot, the procedure (procedureDigest sha256:<64 hex>), typed equipment and operator references (never empty), raw artifact digests, an execution class and a result. Review is a qualified human project_admin's, asked of a server port by record id, kind and digest only and never read from the record; the answer names the actor ids the server resolves the record's operators to (operatorActorIds), and the reviewer is none of them. A record without raw artifacts, with a dry-run class, with any result but pass, without a server-derived human review of its exact digest, or disposed use_as_is never satisfies. assembledProductEligibility() answers blocked with the missing kinds for every input (eligible false by type; ASSEMBLY_DATA_AUTHORITY "absent"). Across records, the lot's identity binds every unit; a failure raises a nonconformance no pass outvotes; a rework closes one only on the subject that raised it, with later physical retests; and a final qualification follows every failure and rework. No review port is wired (PHYSICAL_EVIDENCE_REVIEW_PORT_WIRING "none"), and nothing creates a record: no route, store, tool or form (an AST check). Independent checks' six low findings were closed test-first by two lead-fix rounds and a lead round (2026-10-05): a failure of this release and lot always raises; a disposition comes no earlier than what raised it; a scrap that satisfies its own rules removes its unit or lot, whatever record shares its id; a lot with no unit left is scrapped; a final qualification follows every hardware rework of the claim. CONFIRMED by b23-d-physical-evidence-contract (16). No evidence exists (LB-5). physical-evidence.md sections 1-5.

**D23-14 - Latent library paths could advance a production or hardware claim without physical evidence.** Requirement: B23-D `:1002`,
`:1013`; global `:147`. Finding: `EXECUTED_PHYSICAL_PROCESS_QUALITY_EVIDENCE` passes on any non-empty string array and
`PRODUCTION_RELEASE_AUTHORITY` trusts a caller-supplied `actor.actorKind === "human"` (`release-engineering/readiness.ts:24-25`), tested
only with an empty list (`foundation.test.ts:41`); `evaluateFactoryMeasurement` passes a caller-declared `hardware` measurement with current
calibration and non-empty raw refs and records the caller's `uutIdentityRef` and `stationFixtureInstrumentRefs` unchecked (an empty list passes) with no operator field (`firmware-bringup/factory.ts:5`);
`computeRuntimeVerdict` treats `waived` as passed for every outcome including production-released (`full-flow/verdict.ts:5`). None has a
production caller (`git grep`), so none is reachable today (INFERRED). Severity medium. **CONFIRMED** (code), **INFERRED** (unreachable).
Closes: B23-D (OD-176). Sources: S5-G3, S5-G4, S5-G6, S6-G8, S2-G7 (in part).
- [B23-D, 2026-10-05] Closed (OD-176), not rewired. b23-d-latent-claim-paths (6) pins that evaluateReleaseLevels, materializeRelease, evaluateFactoryMeasurement, fitCalibration and computeRuntimeVerdict have no production caller: the import closure (the three defining modules are imported only by their barrels, nothing imports a barrel; it relies on B14.4 case 2's zero opaque loads) and the names, each check shown to bite. It executes the counterexamples recorded here: factory.ts:5 passes a caller-declared hardware measurement with an empty uutIdentityRef, an empty station list and no operator field; readiness.ts:24-25 pass on a claimed ref and a caller-supplied human; verdict.ts:5 counts waived as passed. physical-evidence.md section 6 records the hardening each needs before any caller is added: resolve refs against stored, reviewed evidence; a server-derived actor; verified provenance for a hardware class; a waiver never satisfies a physical gate; factory.ts:5's unchecked refs and missing operator; the seed types FactoryTestResult and CalibrationResult. The tripwire cases already passed on 4e71563: a missing pin, not a code defect. CONFIRMED.

**D23-15 - The assembled-release block is pinned only generically, and its stated unblock condition omits physical evidence.** Requirement:
B23-D `:1013`. Finding: the gate's refusal names "exact approved MPN, population variant, BOM, placement, and paste authority"
(`release-gate.ts:189`; pinned at `manufacturing-release-gate.test.ts:149-150`); the registry note defers it to "the component-acquisition
and assembly chapters (B22–B24)" (`action-registry.ts:118`); neither names physical evidence or qualified human review; no test names the
id (`git grep`: only `action-registry.ts:118` and artifacts), so its block rests on B17-A's missing-is-unreachable rule
(`b17-a-control-inventory.test.ts:63`) and the Tier 3 floor; the registry render is byte-pinned (`action-registry.test.ts:97-100`), so any
note change moves the B01 CSV. Severity low. **CONFIRMED**. Closes: B23-D (OD-177). Sources: S5-G5, S6-G1 (in part).
- [B23-D, 2026-10-05] Closed (OD-177). manufacturing.assembled-release stays one record on action-registry.ts:118 (missing, explicitly blocked, toolExposure none, approval tier release). Its note names both unblock conditions: assembly-data authority (exact approved MPN, population variant, BOM, placement, paste) and OD-175's physical evidence with qualified human review; none exists (LB-5). The B01 CSV row stays at :47, re-rendered once by its generator. The gate's refusal (release-gate.ts:189) names both and reaches the redacted trace whole. What a person sees, the error table (manufacturing-errors.ts:62), now states the unblock condition in plain words outside B19-E's purchase phrases. b23-d-assembled-release-blocked (6), CI-admitted and router-free, pins it by id: Tier 3, decision never for every role, mode and request; unreachable by any control, rule, route or tool; the gate refuses assembled_pcb at runtime on a hand-built authority. The refusal is not inside the archive, and the pinned 555 release identity (mfg-release-45b3b7efbc85dc3a8ecd233c906384cd) holds, replayed by the prompt-to-gerber acceptance suites. manufacturing-release-gate.test.ts (in no CI workflow) is the lead's single run. CONFIRMED. physical-evidence.md section 7.

**D23-16 - Two documents claim a quote-tool acceptance no record supports.** Requirement: global `:144`, `:146`. Finding: `README.md:41`
("a one-click Gerber/drill/BOM/pick-and-place bundle that JLCPCB's quote tool accepts") and `docs/pcb-quickstart.md:3-6` ("one click
produces a Gerber bundle their quote tool accepts"); one recorded attempt says the manual upload was "still pending"
(`progress/2026-07-09/02-fab-dialog-gerbers.md:72-73`), the R05 report leaves the JLCPCB Gerber-viewer check and the upload as a next owner action (`artifacts/prompt-to-gerber/r05-e2e01-report.md:616-619`, `:657`), and `git grep` finds no acceptance record; quickstart `:47` repeats the upload instruction while `:49-50` concede that external acceptance gates are open; both describe the engineering
export. Severity low. **INFERRED**. Closes: closeout (OD-178). Sources: G7-3.
- [B23 closeout, 2026-10-05] Closed (OD-178). README.md:41, docs/pcb-quickstart.md:6 (the statement of :3-6) and quickstart :47 keep their words and carry the dated note in place, never a rewrite: a bundle prepared for a provider's quote upload; no upload has been recorded, and no provider has accepted, quoted, DFM-checked or ordered a Sirkit bundle (no stored acknowledged receipt; LB-11) - the closeout task's generalisation of OD-178's draft "a bundle prepared for JLCPCB's quote upload; no upload has been recorded" (OD-188 (g)); :47's adds that uploading it is a person's own act outside Sirkit. The lead round closed the check's two low issues in the tripwire's vocabulary test-first: a temporal word before a provider is a condition only before a present or perfect verb, so a simple past after it is reported again, and a bare "the API" or "a quote" is no provider without its name or role (case 3: 67 examples, seventeen non-claims; closeout-statements.md sections 4 and 5). b23-closeout-statements (8 cases, CI-admitted by the provider folder's directory filter) pins that no production copy (the sources and the fab presets' notes), doc or page outside the lead's records states, in its vocabulary's 19 forms (closeout-statements.md section 4, each form pinned by its own examples; a phrasing outside them is not seen), that a provider accepted, quoted, priced, DFM-checked or ordered anything, or that Sirkit sent it a bundle, outside an exact allow-list whose entries admit only the claims inside their own text, in pinned numbers: the four fab preset notes (hand-off instructions kept as written; only jlcpcb-2l's are inside the pinned release identity), the order contract's ORDER_ACCEPTED answer (given only with a recorded provider order id), the R05 report's two verification verdicts, and the control name Send to fab (12 production and 6 page uses, pinned per file). A note admits only the claim before it, and no note states one. 8 of 8 red on dfd51e3, then green; six deliberate breakages caught, and the review round's nine breakages, each green on the suite as reviewed, each failed by the strengthened suite. CONFIRMED. closeout-statements.md sections 1, 4 and 5.

**D23-17 - The reload-time "current" flag compares the authority by revision only.** Requirement: B23-B step 7 `:981`. Finding:
`authorityCurrent` is `authority.authority.boardRevision === current.revision` (`manufacturing-summary.ts:83`) while the release route
compares revision AND full digest (`route.ts:109`); a stale-quote check copied from the summary would be weaker than the route. Severity
low. **CONFIRMED** (code), **INFERRED** (consequence). Closes: B23-B3. Sources: S2-G8.
- [B23-B3, 2026-10-04] Closed (OD-168). The summary's current flag compares the authority's board revision AND its authoritative digest recomputed from the loaded board (release-gate.ts's formula, declared in manufacturing-summary.ts over native/stable so GET /api/pcb-sync never loads the release generator), never current.digest (a pcbSyncDigest). The counterexample - one revision id and one pcbSyncDigest but two authoritative digests (the nets in another order) - is CONFIRMED by execution: on 0cd3f59 the summary called both current. The header line :8 carries a dated note. CONFIRMED by b16-a-manufacturing-summary (two new cases) and b23-b-stale-quote cases 1, 6, 11. dfm-quote-flow.md section 19.

**D23-18 - Only the JLCPCB two-layer bare-board profile can produce the release a provider would receive.** Requirement: B23-A capability
mapping `:961`; B23-B "Given a current deterministic release" `:973`. Finding: `QUALIFIED_RULE_PROFILE_IDS` is `jlcpcb-2l` only
(`rule-profile.ts:30`); qualification seals `bare_pcb` with it (`qualify/route.ts:82, :282-284`); the profile declares no assembly
(`rule-profile.ts:97`) and its evidence expires 2027-09-09 (`:45-48`; refused after, `release/route.ts:116-120`); the other presets feed
the engineering export, autoroute (`app/api/pcb/autoroute/route.ts:130`), the PCB editor (`PcbEditor.tsx:1383`), agent context (`app/lib/agent/context.ts:604`), the AI snapshot (`app/lib/pcb/ai/snapshot.ts:176`) and the durable read bundle (`durable-read-bundle.ts:399`), but never the deterministic release (`release-gate.ts` imports neither `build-bundle` nor `kicad-cli-runner`), so never a B23 input. A recordable scope limit. Severity low. **CONFIRMED**. Closes: B23-A1
(records the mapping; other providers `unmapped`). Sources: S2-G9, S1-G2 (in part).
- [B23-A1, 2026-10-02] The mapping is closed. JLCPCB maps jlcpcb-2l (profile id, version 2, digest mfg-rule-41563ed452ed6c620965a29186a8139d67635ac7d36fee6730b1d75eba4ca9e2, evidence expiry 2027-09-09), a reviewed copy that case 11 recomputes with buildManufacturingRuleProfile. Every other row is unmapped with a reason, and only a manufacturer may map (rule capability). The scope limit itself (only jlcpcb-2l reaches a deterministic release) stands as recorded. CONFIRMED.

**D23-19 - No live-blocker row covers live DFM/quote exchange or an ordering sandbox, and the state file omits LB-5.** Requirement:
runbook `:99`, `:1070`, `:1119`. Finding: LB-1..LB-9 (`LIVE_BLOCKERS.md:7-15`); LB-5 covers physical work only (`:11`); `PROGRAM_STATE.json`
`liveBlockers` omits LB-5 (`:12-17`). Severity low. **CONFIRMED**. Closes: B23-A1 (OD-179). Sources: S6-G9, S5 fact.
- [B23 lead, 2026-10-02] Re-verification (section 9): Re-verified at `849a933`. B22-A2 (`c037627`, OD-147) added LB-10 (authoritative sandboxed simulation on a qualified OCI platform) at `LIVE_BLOCKERS.md:16`, so the register is now LB-1..LB-10 (`:7-16`). It also added a matching fifth `liveBlockers` entry at `PROGRAM_STATE.json:17` (array now `:12-18`). No row covers live DFM/quote exchange or an ordering sandbox. LB-5 (`:11`) is still physical-only and still absent from `liveBlockers`, as are LB-4, LB-6, LB-7 and LB-8. LB-11, LB-12 and OD-160..OD-189 remain unused.
- [B23-A1, 2026-10-02] Code half closed (OD-179). Every dfm_quote_transfer operation's reason names LB-11 and every ordering operation's names LB-12 (case 7), and admission refuses both tiers. The register rows LB-11/LB-12 and the liveBlockers mirror (LB-5, LB-11, LB-12) are added by the lead in this commit, which closes D23-19.

**D23-20 - CI admits no B23 suite.** Requirement: OD-59/OD-124 practice. Finding: `CHAPTERS = ["b19-", "b20-", "b21-"]`
(`b19-e-ci-job-scope.test.ts:54`); B22 proposes `b22-` (OD-146); OD-124 says a later chapter extends it (`OWNER_DECISIONS.md:1134-1138`).
Severity low. **CONFIRMED**. Closes: B23-A1 (OD-180). Sources: S6-G10.
- [B23 lead, 2026-10-02] Re-verification (section 9): Re-verified at `849a933`. B22-A1 (`50fe156`; OD-146 as applied, `OWNER_DECISIONS.md:1673-1680`) extended `CHAPTERS` to `["b19-", "b20-", "b21-", "b22-"]` (`app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:54`). It admitted `app/lib/computation/__tests__` to the prompt-to-gerber job (`.github/workflows/deterministic-manufacturing.yml:226`). `b23-` is still absent. The guard requires each listed chapter to have at least one suite (`:152`), so OD-180's admission must land in the same commit as the first `b23-` suite.
- [B23-A1, 2026-10-02] Closed (OD-180). CHAPTERS was extended in place with "b23-" (app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:54, with an [B23-A1] note on :53). One directory filter, app/lib/manufacturing-providers/__tests__, was admitted to the prompt-to-gerber job (deterministic-manufacturing.yml:227, after app/lib/computation/__tests__ at :226), in the same change as the first b23- suites. The guard runs 8 + 5 = 13 tests green. Pins moved in place with dated [B23-A1, 2026-10-02] notes: B21 evaluation-matrix C49 331->332, C93 334->335, C94 343->344; B22 deck-and-secret-corrections C77 (the full new CHAPTERS line); orchestration-contracts.md:351's count statement (8 + 5 = 13).

**D23-21 - Four CD-12 throwing stubs are pinned by no test.** Requirement: pass `:1017`. Finding: `approveAsAgent`, `placePurchaseOrder`,
`sendExternalReviewRequest` (`governance.ts:8-10`) and `writeManufacturingBytesFromLlm` (`agent-tools.ts:8`) throw; the only stub a test
names is `applyCd12Proposal` (`foundation.test.ts:2, :42`). Severity low. **CONFIRMED**. Closes: B23-A2. Sources: S6-G7.
- [B23-A2, 2026-10-02] Closed. b23-a-cd12-stubs (9 tests) pins approveAsAgent, placePurchaseOrder, sendExternalReviewRequest (governance.ts:8-10) and writeManufacturingBytesFromLlm (agent-tools.ts:8) by id: each throws exactly its literal with or without arguments, has a one-line body, and no other production file calls or names it. Production is the import gates' whole-root walk, root files such as proxy.ts included. The suite passed on 79fa18b (a missing pin, not a code defect). A breakage of all four stubs plus an added caller failed 9 of 9; a call added to proxy.ts failed the new case 3 while the pre-review suite stayed green. Every file was restored by hash. CONFIRMED.

Tally: 21 defects - high 6 (D23-1, D23-3, D23-4, D23-5, D23-6, D23-7), medium 6 (D23-2, D23-8, D23-9, D23-10, D23-13, D23-14), low 9
(D23-11, D23-12, D23-15..D23-21). Not carried as defects: the OD-153..OD-159 reservation (S6-G11, section 0 and section 8) and the
unpinned commit identity (S6-G12, section 5), both process items.

---

## 5. Obligations kept verbatim (with the pinning test for each)

From the runbook (`C:/Users/robsa/Downloads/Sirkit_Remaining_Builder_Master_Runbook.md`):

- `:950` "Never allow an agent or a single ambiguous click to order hardware or spend money." Pinned today by the absence of any order
  path: `b19-e-no-purchase-tripwire.test.ts:302-311` (route names), `b18-a-permission-tiers.test.ts:64` (`bom.order`, `purchase` Tier 3),
  `b18-c-never-execution-sweep.test.ts:101-106`; the "single ambiguous click" half has no pin (B23-B1 and B23-C add the two-step pins).
- `:969` "Do not implement unofficial scraping when an API is unavailable. Browser deep links and CSV export remain distinct from a verified
  API integration." Held by LCSC's blocked row (`source-registry.ts:526`) and the validator's blocked rule (`:629`); the hand-off half by
  `b19-e-bom-workbench.test.tsx:145-146`. B23-A1 adds a validator rule and its pin for every provider row.
- `:975-982` (B23-B's eight steps). No pin today (no flow exists); B23-B1..B3 add one suite per step (section 7).
- `:986` "Ordering stays feature-disabled until the owner separately supplies:" (`:988-994`). Held by absence and OD-8
  (`OWNER_DECISIONS.md:14`); B23-C adds the enablement-gate pin.
- `:996` "The AI cannot mint or consume the final purchase authorization." No pin (nothing exists); B23-C adds the approved-importer gate.
- `:998` "An ambiguous provider response must be `UNKNOWN_PENDING_RECONCILIATION`, never silently retried." No pin; B23-B2 and B23-C add it.
- `:1013` "Keep `manufacturing.assembled-release` blocked until the required evidence and qualified human review exist." Pinned by
  `manufacturing-release-gate.test.ts:149-150` (gate) and `b17-a-control-inventory.test.ts:63` (unreachable); B23-D adds an id-named pin.
- `:1017` "no agent can release or spend." Pinned by the Tier 3 machinery (section 2.6): `b18-a-permission-tiers.test.ts:64`,
  `b18-c-never-execution-sweep.test.ts:63-72, :101-106`, `b20-c3-negative-tripwires.test.ts:81-95, :195-197`, `b21-b-router.test.ts:22-33`,
  `b16-0-15-manufacturing-boundary-gate.test.ts:72-91` (reader 2); since B22 also `b22-b-exposure.test.ts` case 5 (`:158`: computation is never granted or MCP-listed).
- `:138` browser- or model-authored state never canonical. For release: `release-human-only.test.ts:30-54`, `b16-a-release-confirmation.test.ts:45-104`;
  for B23-D: no pin (localStorage CD-12 state; B23-D pins that no evidence record is accepted from a body).
- `:140` external observations keep source identity, retrieval time, licensing/retention, freshness and hashes. Pinned for distributors by
  `b19-e-packet-provenance.test.ts:36-38` and the registry suites (reader 1); B23-B3 pins it for DFM/quote observations.
- `:144` and `:146` (human truth about Gerbers, quotes, orders, assembly). Pinned by `manufacturing-workflow-panel.test.tsx:147-149` and
  `b19-e-packet-provenance.test.ts:36-37`; `README.md:41` and `docs/pcb-quickstart.md:3-6` have no pin (D23-16).
- `:148` "Qualification, release, uploads, purchasing and ordering must never be smuggled through a lower-tier tool or a generic execute
  path." Pinned by `b18-c-never-execution-sweep.test.ts:63-72` and `b18-a-permission-tiers.test.ts:64`; word-based (D23-8); since B22, `b22-b-no-generic-exec.test.ts` pins that no generic execute path exists.
- `:152-155` secrets, prompt injection, SSRF, redirects, bounded streams. Pinned for the egress boundary by the B19 egress suites
  (`b19-distributor-egress`, reader 1) and the rebinding record (`b20-d1-rebinding-window.test.ts:1-16`, reader 3); no upload pin (D23-3).
- `:158` CSRF, server-derived identity, roles, bounded readers. `b16-0-1-ci-gates.test.ts:160-196`; `b16-0-2-gates.test.ts:153-175`;
  `b16-0-4-authorization-and-body-gates.test.ts:30-90` (reader 6).
- `:164-165` identity `Dandi Desta <dandidesta82@gmail.com>`; "Do not add Claude, Anthropic, Codex, OpenAI or other AI co-author
  trailers." Held by process only (no test or workflow pins it, reader 6); the one commit on `main..HEAD` complies (section 1.3). This
  session's harness attribution reminder asks for a co-author trailer; runbook `:165`, OD-19 and the owner's standing rule override it.
- `:171` "this does not authorize ... live purchases". OD-8 (`OWNER_DECISIONS.md:14`). Process; B23-C's gate makes it structural.

From the code (verbatim, must stay true; pinning test named):

- `app/lib/engineering/permission-tiers.ts:31` "irreversible: publish authority, manufacturing release, external upload, purchasing/order
  (never agent-executable)" and `:141` decision `never` (`b18-a-permission-tiers.test.ts` pins the tiers, `:44-47`, `:64`, and the `never` decision, `:61`; no test pins the `:31` title text, found only there and at `execution-display.ts:138`).
- `app/lib/agent/orchestration/router.ts:67` `TIER3_REFUSAL_SENTENCE` "... No model was called for this message." (`b21-b-router.test.ts:22-33` pins refusals by family through the constant, `:56`; the literal sentence only through `b21-b-page.test.ts:52`).
- `app/lib/pcb/fab/release-gate.ts:272` "No manufacturer upload/order has been performed. External board-house DFM and physical prototype
  review remain mandatory." Inside the pinned bytes (`expected-identities.json:14-19`); any wording change moves the release identity.
- `app/components/pcb/ManufacturingWorkflowPanel.tsx:96` "This is not a fabricated, ordered, assembled, or electrically certified board."
  (`manufacturing-workflow-panel.test.tsx:148`).
- `app/lib/cart-formats.ts:228` "not verified procurement. No order was placed." (`b19-e-packet-provenance.test.ts:36-37`).
- `app/lib/release-engineering/governance.ts:9` `CD12_PROCUREMENT_SCENARIO_HAS_NO_PURCHASING_SIDE_EFFECT` - no pin (D23-21).
- `app/api/release-engineering/propose/route.ts:8` `hasExternalOrPurchasingSideEffects: false` (`routes.test.ts:7`).
- `app/lib/acquisition/source-registry.ts:526` "no scraping and no unofficial access" (no verbatim pin: `b19-source-registry.test.ts` pins LCSC blocked, `:73`, no hosts, `:75`, and the blocked-host rule biting, `:101`; the source-registry CSV does not carry the reason text).
- `app/lib/pcb/fab/release-ledger.ts:72` "idempotent by releaseId (same authority ⇒ same releaseId ⇒ one entry)"
  (`e2e/prompt-to-gerber.spec.ts:195-199`, reader 2).
- Route census 165/162/3/0 (`b16-1c-invariant-tripwires.test.ts:38-51`); the release perimeter's two rows (`b16-0-1-ci-gates.test.ts:186-196`);
  counts 47/36/9/27 (`b20-c1-three-way-parity.test.ts:241`, moved by B22-B, OD-139); the nine B11-scanned files carry no B23 identifier
  (`tripwires.ts:9-19`); the toolability CSV (`action-registry.test.ts:97-100`); the pinned release identities
  (`acceptance-pipeline.test.ts:420-421`).

Owner decisions that bind B23 (`artifacts/remaining-builder-program/OWNER_DECISIONS.md`): OD-8 (no live purchase, `:14`); OD-19 (commit
identity, `:31-35`); OD-31 (who spends quota; public cache-only exports, `:110-119`); OD-32 (Mouser disabled); OD-33 (retention, no bulk
refresh); OD-36 (agent disclosure unknown, `:174-182`); OD-39 (distributor values leaving Sirkit, undecided, `:216-224`); OD-40 (agent
search share, `:226-231`); OD-48 (empty MCP registry); OD-1 (rule-profile evidence and expiry, `:7`); OD-129/OD-130 (evidence by
reference; candidates are not targets, `:1363-1389`); OD-59 (CI admission, `:301`), OD-124 (`:1131-1139`) and OD-146 (B22's CI admission, as applied, `:1673-1680`); OD-159 (B22-B's proposed computation-approval route, which would move the census first, `:1872-1877`); OD-42/OD-51 (no undici; the rebinding
limit, reader 3); OD-104 (the never-reachable partition); OD-113 (B11 tripwires); OD-120/OD-121 (role rows).

---

## 6. Owner decisions needed (OD-160 onward) with a safe default each

No provider account is assumed anywhere; ordering stays feature-disabled by default; every live provider exchange is
BLOCKED-LIVE-QUALIFICATION until the owner supplies an account and approves in writing.

| OD | Question | Safe default (applied unless the owner says otherwise) |
|---|---|---|
| OD-160 | Which providers B23 targets, and does the owner hold approved API access for any (JLCPCB app id and keys, PCBWay `api-key`, an OSH Park or MacroFab account, a DigiKey Credit account)? | None assumed. B23 builds the read-only DFM/quote flow end to end against a fake provider behind the real egress boundary; no provider row is admitted for transfer; every live exchange is BLOCKED-LIVE-QUALIFICATION (LB-11). The builder never applies for access, creates an account or enters a credential. If the owner supplies an account, an opt-in, owner-run sandbox qualification (B23-B4) is added; nothing live runs in CI. |
| OD-161 | Where manufacturer and quote providers live: extend B19's `SOURCE_REGISTRY` or a sibling registry; what happens to CD-12's `ProcurementProviderDescriptor`. | A sibling registry `app/lib/manufacturing-providers/provider-registry.ts` with provider kinds `manufacturer`, `assembler`, `quote_service`, `distributor`, copying B19's validator rules and the byte-gated CSV; B19's registry and its tests stay untouched, except the `CHAPTERS` line in `b19-e-ci-job-scope.test.ts:54` that OD-180 extends (as B22 did); distributor rows reference the B19 entry by id (no duplicated hosts or secrets) and add only the B23 fields; CD-12's descriptor stays library vocabulary, produced by a pure projection from a registry row (no third shape). |
| OD-162 | The initial rows and their tiers. | Tier vocabulary per operation: `none` < `handoff` (deep link / CSV / manual upload, never an API call) < `read_observation` < `dfm_quote_transfer` < `ordering`; `ordering` is never above `disabled` in B23. Rows: JLCPCB (approval-gated API; `dfm_quote_transfer` blocked, no access; `handoff` for the manual quote page); PCBWay (approval-gated Partner API; blocked; `handoff`); OSH Park (official API; disabled, no account; its checkout recorded as never called); MacroFab (DFM and quote API; disabled, no account); Eurocircuits (no public API found; `handoff` only); DigiKey (B19 reference; read observations enabled per OD-33; Quote and Ordering recorded, disabled: 3-legged OAuth and a Credit account needed); Mouser (B19 reference, disabled per OD-32; order API recorded, disabled); Nexar (read observations only, no ordering); LCSC (blocked; order API recorded, disabled). Every field a reader could not read stays `UNKNOWN`; documentation URLs dated 2026-10-01 (section 1.2) are re-read by the increment before commit. |
| OD-163 | What leaves Sirkit in a DFM/quote transfer. | A derived outbound package: the ledgered release's Gerber, Excellon and job files byte-identical to the release (each sha256 equal to its manifest record), plus a generated provider manifest naming `releaseId`, `archiveSha256`, the file list and the capability-profile id and version, and omitting `tenantId`, `projectId`, `branchId`, `designId`, `boardId` and the actor; `release-manifest.json` and `README.txt` are not sent; the package has its own `outboundPackageDigest`. No BOM, CPL or distributor-observed value (price, stock, SKU) leaves (bare board; OD-36, OD-39). |
| OD-164 | Who may request a transfer, and on what. | A human `project_admin` only (Tier 3, external upload), only for a release already in the ledger whose authority is still head and matches the current board revision AND digest; never on the engineering export. No agent tool in B23 (counts 47/36/9/27, as B22 left them, unchanged); an agent read of stored quote observations, if ever wanted, is a later reviewed decision. |
| OD-165 | The transfer mechanics and meters. | No new dependency (OD-42 stands): an additive, reviewed extension of `outboundFetch` with an in-memory bounded request body (bytes or a bounded multipart encoding of in-memory parts) and a request-byte ceiling from the descriptor (never above the release bounds of 64 files and 64 MB, `validate-package.ts:14-15`), an `Idempotency-Key` header only when the descriptor declares support, `maxRedirects: 0`, one deadline covering the upload; a `manufacturing-provider` admission key with quota and breaker, agent share 0. The rebinding window stays a recorded limit (OD-51). |
| OD-166 | How the human approves a named provider and purpose. | The assignment-queue shape: `preview` returns an outbound plan (provider id, descriptor version and digest, purpose `dfm` or `quote`, operation, the exact file list with bytes and sha256, every metadata field, release and authority identity, request digest, expiry 10 minutes); `commit` requires `planId`, `planDigest` and an opt-in header, re-runs the revalidation, and refuses an expired plan, a moved input or a reused key with a different plan. One click never sends: preview and commit are separate requests from separate controls. |
| OD-167 | Receipts, retention and ambiguity. | One durable aggregate `mfg.provider-exchange.v1` per (scope, board, provider), attempts keyed by idempotency key, states `prepared -> sent -> acknowledged | rejected | UNKNOWN_PENDING_RECONCILIATION`; any timeout, abort, transport error, 5xx or unparseable answer after the send started is `UNKNOWN_PENDING_RECONCILIATION`, never retried automatically and never run through `DurableOutboxDispatcher`; a duplicate commit replays the record and sends nothing. The record keeps the provider receipt id, response digest, `retrievedAt`, the package and release digests, the descriptor version and the capability-profile version, plus bounded normalized fields; no raw provider body and no archive bytes (re-derived from the ledgered authority while it is head; otherwise the exchange is stale). A provider whose terms forbid storage keeps ids, digests and timestamps only. Reconciliation is a later human-initiated read of the provider's status operation where the descriptor declares one. |
| OD-168 | When a quote or DFM observation is stale. | At the provider's stated validity, else 24 hours after `retrievedAt`; and at once when the authority or ledger head moves, the board revision OR digest changes, the descriptor version changes or the rule-profile evidence expires (2027-09-09 for `jlcpcb-2l`). Stale observations stay visible, labelled stale, never current. |
| OD-169 | Provider-suggested substitutions or design changes. | Recorded as a closed `providerSuggestion` observation and shown; never applied; no code path turns one into a command (an import gate pins it); a person makes any change through the normal editor, which yields a new release and stales every quote. |
| OD-170 | What "visibly disabled" ordering is. | An action record `manufacturing.provider-order` (status `missing`, handler "explicitly blocked: feature-disabled until the owner supplies OD-171's prerequisites", `toolExposure: "none"`, approval tier `release`, Tier 3) and a fixed notice in the provider panel, worded outside the B19-E phrases, for example "Ordering through Sirkit is turned off: the owner has not supplied an account, limits, policies, roles or a sandbox path." No control is shown (so B17-A's `missing` rule holds); the B19-E tripwire is not loosened; the toolability CSV moves once by review. |
| OD-171 | How ordering could ever be enabled. | A pure `orderingEnablement()` that returns disabled with the list of missing prerequisites unless an owner record carries all seven runbook `:988-994` inputs (account reference, spend and quantity limits, billing/shipping policy, authorized roles, cancellation/refund behaviour, legal/compliance, sandbox path) AND a reviewed code change wires a submission port; no environment variable can enable it; the operator switch can only disable. No such record exists in B23. |
| OD-172 | The purchase-authorization contract for when ordering is enabled. | Written and tested offline only, behind OD-171: a human-only confirmation function mints a single-use, server-held authorization bound to provider, lines, quantities, currency, a decimal price ceiling, a shipping destination reference, the release/BOM digest and an expiry of at most 10 minutes; requester and approver are different humans (`proposerCannotApprove`), both `project_admin` (no new role until the owner names one); price and availability are re-read immediately before submission and a change or a total above the ceiling refuses; one idempotency key per authorization; webhook events verified by signature over the raw body with a timestamp window and a replay store; the mint/consume module importable only by the two server modules (exact approved-importer gate), forbidden to the agent loop, gateway, chat, MCP and orchestration closures. No route, control or provider client. |
| OD-173 | The Tier 3 vocabulary. | Structural first: a new side effect `external-transfer` in `TOOL_SIDE_EFFECTS` (and the action equivalent) that computes Tier 3 whatever the id; the floor gains `quote|dfm|submit|checkout|cart|buy|payment` after a census proving no existing id moves; the B21 withdrawal filters every `external-*` authority and keeps dropping B22's `computation-engine` (`scheduler.ts:183, :220`; `b22-b-exposure.test.ts` case 4), not three names; a new MCP exclusion reason keeps `computation` right after `never_exposed` (`b22-b-exposure.test.ts:68`); the chat-closure tripwire also forbids `app/lib/net/outbound-fetch.ts` and the provider directory; foreign MCP `agentTools` names matching the floor are refused. The router's chat families are unchanged (no provider tool exists, so a quote ask reaches nothing); recorded. |
| OD-174 | The route vocabulary and the census. | `RoutePolicy` gains `externalTransfer` and `spend` booleans with gates: such rows are human-only (no automation), CSRF, never public, roles never viewer or commenter; `spend` rows must not exist in B23; the two-row `releaseOrQualification` pin is unchanged; the resource classification gains an `outboundEgress` field. B23 adds one route file `POST /api/pcb/provider-exchange` (preview and commit), so the census moves once by review to 166/163/3/0, or to 167/164/3/0 if the owner applies B22's OD-159 route (`OWNER_DECISIONS.md:1872-1877`) first; the route's classification CSV row must keep `b22-a2-process-census.test.ts` case 3 (`:326`) green, and `outboundEgress` is derived and pinned the same way. |
| OD-175 | Physical-evidence definitions. | B23-D defines eight closed record kinds (manufacturer acceptance, unit/lot serial identity, incoming inspection, continuity/power-on, functional test, assembly result, deviation/rework, final physical qualification) as types, validators and an eligibility evaluator bound to `releaseId`, `archiveSha256`, board revision and digest; raw artifact digests, equipment and operator references, a result, and review by a human derived from the trusted server context. No route, no store, no tool, no form in B23: recording is B24-E under LB-5. |
| OD-176 | The latent CD-11/CD-12/CD-13 claim paths. | Not rewired; a tripwire pins that `evaluateReleaseLevels`, `materializeRelease`, `evaluateFactoryMeasurement`, `fitCalibration` and `computeRuntimeVerdict` have no production caller, and `physical-evidence.md` records the hardening each needs before any caller is added (resolve refs against stored reviewed evidence; server-derived actor; verified provenance for a hardware class; a waiver never satisfies a physical gate). |
| OD-177 | What `manufacturing.assembled-release` means, and its unblock condition. | One record, kept `missing`; its note and the gate message name both conditions: assembly-data authority (MPN, variant, BOM, placement, paste) AND OD-175's physical evidence with qualified human review; an id-named test pins Tier 3, `missing` and unreachable; the B01 CSV moves once by review. The release identity does not move (the gate message is not inside the archive). |
| OD-178 | The README and quickstart claim. | Supersede `README.md:41` and `docs/pcb-quickstart.md:3-6` in place in the closeout with a dated B23 note saying "a bundle prepared for JLCPCB's quote upload; no upload has been recorded", never a rewrite (the B21/B22 convention, `README.md:63`; `b22-closeout-statements.test.ts:1-11`); quickstart `:47` is reviewed with them. |
| OD-179 | Live-blocker rows. | LB-11 "live DFM/quote exchange with a manufacturer or quote API" BLOCKED-LIVE-QUALIFICATION (unblocks when the owner supplies an approved account and a sandbox or staging path and approves the outbound files); LB-12 "ordering through a provider sandbox" BLOCKED-LIVE-QUALIFICATION (unblocks only with OD-171's record); `PROGRAM_STATE.json` `liveBlockers` mirrors LB-5, LB-11 and LB-12. |
| OD-180 | CI admission for B23 suites. | Extend `CHAPTERS` in `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:54` with `b23-` (after B22's `b22-`) in the same commit as the first `b23-` suite (the guard requires a suite for every listed chapter, `:152`), and admit one directory filter for the B23 suite folder in the `deterministic-manufacturing.yml` prompt-to-gerber job, as B22-A1 did under OD-146 (`:226`); no live suite in CI; the opt-in `SIRKIT_B23_LIVE_PROVIDER=1` stays local and owner-approved. |

---

## 7. Increment plan (test-first, gated)

Conventions: B23 starts after B22's closeout merges (runbook `:28`; met: PR #13 merged as `43cb1b0`, whose tree is `849a933`), on a new chapter branch `chapter/b23-external-manufacturing` from
main, after the lead re-verifies this page on that tree; every increment = failing suite first, then code, then green, then generators,
`git status` clean, commit, push (the owner's commit-and-push rule; never merge automatically); suites `b23-<letter>-<subject>.test.ts`
under one directory (proposed `app/lib/manufacturing-providers/__tests__`) admitted to CI in the same commit (OD-180); no vitest
concurrent with Playwright, every runner process stopped afterwards; no B23 identifier in the nine B11-scanned files (as `b22-b-no-generic-exec.test.ts` case 5, `:126`, pins for B22's); no B23 page or test states a phrase `b22-closeout-statements.test.ts` treats as superseded (`:47-48`; it scans every B23 page, and its page allow-list is pinned at 20 admits); the pinned release
identities never move; counts 47/36/9/27 unchanged (no agent tool); the route census moves once by review (OD-174); no live provider call,
account creation, credential entry or purchase by the builder - every live step is BLOCKED-LIVE-QUALIFICATION unless the owner supplies an
account and approves (OD-160); commits as `Dandi Desta <dandidesta82@gmail.com>` with no AI trailer; a staged-content secret scan before
every push. A pre-edit counterexample that does not reproduce is recorded "not reproduced" and its guard stays as defence in depth.

### B23-A1 - The provider registry with reviewed descriptors (closes D23-1, D23-2, D23-18 (mapping), D23-19, D23-20)
- Tests first: `b23-a-provider-registry` - closed keys; every row carries all twelve `:956-967` fields (UNKNOWN allowed only as the literal
  `UNKNOWN` with a reason); documentation HTTPS and dated; hosts exact; secrets by environment NAME; the tier vocabulary per operation;
  `ordering` never above `disabled`; a blocked row declares no hosts or secrets; a row with no official API has tier `handoff` and no hosts
  (no scraping); deep links and CSV recorded as `handoff`, distinct from `api`; capability mapping `jlcpcb-2l` (id, version, digest) or
  `unmapped`; each validator rule bites on a reintroduced violation; the CSV render equals the committed artifact byte for byte.
  `b23-a-provider-admission` - admission per provider per operation tier; the operator switch only disables; refusals name variables,
  never values; in B23 every transfer refuses `provider_not_admitted`. `CHAPTERS` + `b23-` edited in place in `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:54` as B22-A1 did (OD-146; no separate suite can extend it), with the workflow's directory list, in the same commit as the first `b23-` suite.
- Code: the sibling registry (OD-161, OD-162); the CD-12 projection; admission; LB-11 and LB-12 rows and the `PROGRAM_STATE.json`
  mirror (OD-179).
- Pages: `artifacts/ai-control-plane-b23/README.md`, `provider-registry.md` (per row: what was read, when, what stays UNKNOWN),
  `provider-registry.csv`.
- Stop: a row that would need a login, an application or a credential to read stays UNKNOWN; a row whose transfer tier rises above
  disabled without an owner decision naming the account stops.

### B23-A2 - Tier 3 and route vocabulary (closes D23-8, D23-9, D23-12, D23-21)
- Tests first: `b23-a-tier3-vocabulary` - a forged descriptor with side effect `external-transfer` and an innocuous id is Tier 3, never
  exposed, never MCP-listed, outside every B21 role row and refused by the never-execution sweep; the floor's new stems; a census that no
  current tool or action id changes tier; the B21 withdrawal drops every `external-*` authority and still drops B22's `computation-engine`, with `b22-b-exposure.test.ts` green (`:68`, `:121`, `:127-156`); the new stems catch no `sirkit.computation.*` id; a foreign MCP `agentTools` name matching
  the floor is refused. `b23-a-route-vocabulary` - an `externalTransfer` row is human-only, CSRF, never public, never viewer, commenter or
  automation; no `spend` row exists; the two `releaseOrQualification` rows unchanged; the classification's `outboundEgress` field is set for
  every transfer route, derived from each route's import closure the way `b22-a2-process-census.test.ts` case 3 (`:326`) derives `external_process`, which stays green. `b23-a-no-order-structural` - beside B19-E's name check, a structural check that no route row is `spend`.
  `b23-a-cd12-stubs` - the four unpinned stubs throw their literals.
- Code: `TOOL_SIDE_EFFECTS` and the tier functions (OD-173); `RoutePolicy` and the classification (OD-174); the chat-closure FORBIDDEN
  list (moved by review); the scheduler predicate.
- Pages: `tier3-vocabulary.md` (each pin moved, why, and the census before and after).
- Stop: if a new stem would change the tier of any existing id, or a B21 role row, stop for the owner (OD-173).

### B23-B1 - Revalidate, disclose, approve: steps 1-3 (closes D23-6, D23-7)
- Tests first: `b23-b-revalidation` - the extracted server function (`route.ts:88-123`) refuses every case the release route refuses with
  the same codes, the release route's existing suites stay green unchanged, and commit re-runs it; an authority, board or profile that
  moves between preview and commit refuses with no egress. `b23-b-outbound-package` (counterexample first: today's manifest carries
  `tenantId` and `actor`) - the package derives only from a ledgered release whose regenerated `archiveSha256` and `releaseId` equal the
  ledger record; every file byte-identical to its manifest record; no internal id, actor, BOM, CPL or distributor value; its digest is
  stable across two builds. `b23-b-approval-plan` - preview lists every file and field; commit needs `planId`, `planDigest` and the opt-in
  header; expired, moved and reused-key plans refused; ai, automation, system_migration and non-admin actors refused before any durable read;
  closed body; authority-shaped keys refused; preview never sends.
- Code: `revalidateReleaseAuthority()`; `buildOutboundPackage()`; the exchange service's preview and commit; `POST /api/pcb/provider-exchange`
  (OD-164, OD-166, OD-174), whose route-classification CSV row `b22-a2-process-census.test.ts` case 3 (`:326`) must accept; a provider panel that names the provider and purpose, lists the files and fields, and shows "no provider is
  enabled" in B23.
- Pages: `outbound-disclosure.md` (the exact file and field list for the pinned 555 release, with digests).
- Stop: any change to the release route's behaviour or to the release bytes stops.

### B23-B2 - Bounded transfer and receipts: steps 4-5 (closes D23-3, D23-4, D23-5)
- Tests first: `b23-b-bounded-upload` - the `outboundFetch` extension refuses a body over the ceiling before sending; `Idempotency-Key`
  only when declared; redirects refused; the deadline covers the upload; no secret in the URL; every existing outbound-fetch, distributor,
  MCP and SchGen suite green unchanged. `b23-b-exchange-ledger` (against a fake provider server behind the real boundary) - the state
  machine; timeout, abort, 5xx and unparseable answers after the send are `UNKNOWN_PENDING_RECONCILIATION` and are never retried; a duplicate
  commit replays and sends nothing; two concurrent commits send once; no outbox handler performs a send; the receipt carries the provider
  receipt id, response digest, `retrievedAt`, package and release digests, descriptor and capability-profile versions, and no raw body.
  `b23-b-provider-meter` - the `manufacturing-provider` key, quota and breaker, agent share 0.
- Code: the egress extension (OD-165); `provider-egress.ts`; `exchange-ledger.ts` (`mfg.provider-exchange.v1`, OD-167, copying the silent, CAS, idempotent, digest-on-load, outbox-free design of `app/lib/computation/evidence-store.ts`, OD-141); the fake provider.
- Pages: `dfm-quote-flow.md` (steps 4-5: met offline against the fake; live BLOCKED-LIVE-QUALIFICATION, LB-11).
- Stop: following a redirect, adding a dependency (undici) or routing a send through the outbox stops for the owner.

### B23-B3 - Observations, staleness, no auto-accept: steps 6-8 (closes D23-17; D23-5's staleness half)
- Tests first: `b23-b-observation` - a DFM or quote answer becomes a closed `manufacturing_observation` record (source identity, retrieval
  time, terms, freshness, digests, `:140`) that no readiness, qualification, release or assembled-claim path accepts; provider text is
  bounded and screened as untrusted (the foreign-tools directive screen); a provider "accepted" or "pass" sets no Sirkit verdict.
  `b23-b-stale-quote` - OD-168's rules, with revision AND digest compared (the summary flag fixed or not reused, D23-17).
  `b23-b-no-auto-accept` - a substitution or design-change suggestion is a `providerSuggestion` and is never applied; an import gate pins
  that the observation module imports no command, executor or mutation module (OD-169).
- Code: the observation normalizer, staleness evaluator and summary fields riding on `GET /api/pcb-sync`.
- Pages: `dfm-quote-flow.md` (steps 6-8 and the per-step verdict table for all eight steps).
- Stop: an observation that would change readiness, release or any design state stops.

### B23-B4 (only if the owner supplies an account and approves, OD-160) - opt-in sandbox qualification
- An owner-run, env-gated (`SIRKIT_B23_LIVE_PROVIDER=1`) exchange against the provider's sandbox or staging path with the pinned 555
  package, never in CI, with the owner's written approval of the exact files; results recorded as live evidence beside, never inside, the
  offline scores (runbook `:1070`). Without an account this increment does not exist and LB-11 stays.

### B23-C - Ordering visibly disabled, with the full contract (closes D23-10, D23-11)
- Tests first: `b23-c-ordering-disabled` - `orderingEnablement()` returns disabled with the closed list of missing prerequisites; no
  environment variable enables it; the `manufacturing.provider-order` record is `missing`, explicitly blocked, `toolExposure: "none"`,
  Tier 3; the notice renders in the provider panel and matches no `PURCHASE_WORDING`; B17-A's missing-unreachable rule holds; the B19-E
  tripwire green unchanged. `b23-c-purchase-authorization` - mint only through the human confirmation function, requester differs from
  approver; the binding (provider, lines, quantities, currency, decimal ceiling, destination reference, release/BOM digest, expiry); a
  single-use CAS burn; any changed field refuses; ai and automation actors refused; the approved-importer AST gate (only the two server
  modules import it; the agent loop, gateway, chat, MCP and orchestration closures are forbidden). `b23-c-order-contract` (a fake provider
  port only) - price and availability re-read immediately before submission; above the ceiling or changed refuses; duplicate submit, retry
  after timeout and a replayed webhook never create a second order; an ambiguous answer is `UNKNOWN_PENDING_RECONCILIATION` and never
  retried; webhook signature, timestamp-window and replay-store checks; no production composition root wires the submission port.
- Code: `ordering-enablement.ts`, `purchase-authorization.ts`, `order-contract.ts` (an injected port, no production port),
  `webhook-verification.ts` (pure); the action record and the notice (OD-170..OD-172).
- Pages: `ordering-boundary.md` (verdict: ordering visibly disabled; the seven prerequisites, none supplied; the contract and its tests;
  live BLOCKED-LIVE-QUALIFICATION, LB-12).
- Stop: any route, UI control, provider client or composition-root wiring for submission stops; it needs OD-171's owner record and a
  separate review.

### B23-D - Physical-hardware evidence defined, never fabricated (closes D23-13, D23-14, D23-15)
- Tests first: `b23-d-physical-evidence-contract` - the eight kinds; each binds the release identity, unit or lot identity, procedure,
  equipment and operator references and raw artifact digests; a record without raw artifacts, with a dry-run class, with any result but
  pass, or without a server-derived human review never satisfies; nothing creates a record (no route, store, tool or form; an AST check).
  `b23-d-assembled-release-blocked` - `manufacturing.assembled-release` by id: Tier 3, `missing`, unreachable; the gate refuses
  `assembled_pcb`; the eligibility evaluator answers blocked with the missing kinds for every input today. `b23-d-latent-claim-paths` - the
  five functions have no production caller (OD-176).
- Code: `physical-evidence.ts` (types, validators, eligibility; no persistence); the assembled-release note and gate message (OD-177); the
  B01 CSV re-rendered once by review (it already holds B22's two computation rows at `:72-73`; the assembled-release row stays at `:47`).
- Pages: `physical-evidence.md` (each kind: what it must bind, who reviews it, and that none exists: LB-5).
- Stop: anything that records evidence, accepts evidence from a request body or browser state, or lifts the assembled-release block stops.

### Closeout
- Commit 1/2: `README.md:41` and `docs/pcb-quickstart.md:3-6` superseded in place with a dated note, never rewritten (OD-178; the B21/B22 convention, `README.md:63`); a tripwire that no production
  copy claims a provider accepted, quoted or ordered anything without a stored acknowledged receipt.
- Commit 2/2: `changed-files.md`, `test-and-validation-report.md`, `unknowns-and-owner-decisions.md` (OD-160..OD-180, D23-1..21 with their
  closing increment), `final-verdict.md` stating: the read-only DFM/quote flow is proven offline against a fake provider behind the real
  boundary; no provider is admitted (no owner account); ordering is visibly disabled with its contract tested offline; no agent can release
  or spend; physical evidence is defined and none exists; `manufacturing.assembled-release` stays blocked; live exchange and ordering are
  BLOCKED-LIVE-QUALIFICATION (LB-11, LB-12) and physical work stays LB-5. Expected verdict PARTIAL unless B23-B4 runs. Ledger,
  `PROGRAM_STATE.json`, the chapter PR undrafted and merged normally after green CI; continue to B24.

---

## 8. Questions and unknowns

1. **UNKNOWN** - Which providers the owner wants and whether any approved API access exists (JLCPCB and PCBWay are approval-gated; OSH
   Park, MacroFab and DigiKey need accounts; DigiKey ordering needs a Credit account). Resolves by an owner statement (OD-160); until then
   B23 is fake-backed and LB-11 stays.
2. **UNKNOWN** - JLCPCB's authentication, webhook signature, sandbox, idempotency, rate limits, retention and payment flow (client-rendered
   pages). Resolves by an owner-supplied copy of the partner docs or a rendered read; never by the unofficial snippet.
3. **UNKNOWN** - PCBWay's webhooks, `PONumber` uniqueness, rate limits and retention (partner PDF unread); whether its "sandbox" comment is
   a real sandbox. Resolves by the owner supplying the PDF.
4. **UNKNOWN** - OSH Park's sandbox, webhooks, rate limits and API base path; the owner's account type (invoiced accounts' checkout proceeds
   automatically). OD-162 records OSH Park checkout as never called.
5. **UNKNOWN** - MacroFab's sandbox, webhooks, rate limits, retention and quote expiry (no expiry field documented; OD-168's 24-hour
   default applies).
6. **UNKNOWN** - DigiKey Quote-v4 validity and line limits, webhooks and duplicate PO handling (snippet: 30 days, 300 products, INFERRED
   only); whether the API agreement's "no own database" term permits storing quote receipts (OD-167 keeps ids, digests and timestamps).
7. **UNKNOWN** - Mouser's API terms and order page (timed out 2026-10-01). Re-read by a human before any Mouser row changes; Mouser stays
   disabled (OD-32).
8. **UNKNOWN** - Whether Eurocircuits offers any customer API. Default `handoff` only.
9. **INFERRED** - No provider read documents a webhook signature or an idempotency key; DigiKey alone documents an ordering sandbox. B23-C's
   webhook and idempotency contract is therefore Sirkit's own, tested offline, and re-checked against a provider's documents before any
   enablement.
10. **INFERRED/UNKNOWN** - A concurrent duplicate durable commit never writes twice (`server-repository.ts:23, :25`); the no-head-row case
    is narrowed by the unique indexes on heads, records and replays (`app/lib/db/schema.ts:1277`, `:1294`, `:1308`; INFERRED, migration SQL not read), and the isolation level is UNKNOWN; B22's evidence-store tests use the in-memory repository only, so this stays open. Resolves by a PGlite-backed concurrency case in B23-B2 for the exchange ledger.
11. **CONFIRMED (answered by B22)** - B22-A1's edits to `build-bundle.ts` and `kicad-cli-runner.ts` do not reach the deterministic release
    (`release-gate.ts:1-36` imports neither; the only production importer of `build-bundle` is `app/api/pcb/export/gerbers/route.ts:34`), and at `849a933` `b22-a2-process-census.test.ts` case 5 (`:368`) pins that `/api/pcb/release` reaches no spawner and carries no `external_process` label. B23's package is built from the release only.
12. **ANSWERED by B22** - B22 spent OD-153..OD-159 (OD-153..OD-158 as applied, OD-159 proposed), and its records state that B23's discovery starts at OD-160
    (`artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:21-24`; `EXECUTION_LEDGER.md:3830-3831`); no file at `849a933` uses OD-160..OD-189 or LB-11 onward, so no renumbering is needed.
13. **RECORDED** - This session's harness reminder asks for a co-author trailer; runbook `:165`, OD-19 and the owner's standing rule forbid
    AI trailers and fix the identity; the lead confirms the runbook rule governs B23 commits.
14. **UNKNOWN** - Whether `manufacturing.assembled-release` should mean releasing assembly data to an assembler (the gate's framing,
    `release-gate.ts:189`) or the assembled-product claim after a build (runbook `:1013`). OD-177's default keeps one record naming both
    conditions.
15. **RECORDED** - The `jlcpcb-2l` rule-profile evidence expires 2027-09-09 (`rule-profile.ts:45-48`); every release refuses after that;
    who re-transcribes it is an owner question; OD-168 stales quotes with it.
16. **UNKNOWN** - Whether the owner wants quote asks in chat ("Get a quote from PCBWay") refused by the router as a new Tier 3 family; the
    default leaves the B21 router pins unchanged because no tool can reach a provider (OD-173).
17. **UNKNOWN** - Whether the public, cache-only cart and packet routes (OD-31) should stay public once provider transfers exist. Default:
    unchanged; they never call a provider.
18. Open design questions carried to the owner table: providers and accounts (OD-160), registry shape and rows (OD-161, OD-162), the
    outbound package (OD-163), who may transfer (OD-164), mechanics (OD-165), approval (OD-166), receipts and ambiguity (OD-167), staleness
    (OD-168), suggestions (OD-169), visibly disabled ordering (OD-170), enablement (OD-171), the purchase-authorization contract (OD-172),
    vocabularies (OD-173, OD-174), physical evidence (OD-175..OD-177), wording (OD-178), live blockers (OD-179), CI (OD-180).
19. Live behaviour of any provider (upload acceptance, DFM findings, quotes, receipts, webhooks, ordering) and any physical build:
    BLOCKED-LIVE-QUALIFICATION (LB-11, LB-12, LB-5), recorded and never converted into a claim.

---

## 9. Lead reconciliation

### 9.1 Method

On 2026-10-02, read-only verifiers re-checked every citation of D23-1..D23-21 and of sections 0, 1.1, 1.3, 2.1-2.7, 3, 5, 6, 7 and 8. They worked on `849a933`. That is the final commit of `chapter/b22-sandboxed-computation` and the tree of main `43cb1b0`, the PR #13 merge.

Eight B22 commits lie between this draft's tree `0432fb8` and `849a933`:

| Commit | Increment |
|---|---|
| `50fe156` | A1 |
| `c037627` | A2 |
| `e483838` | A3 |
| `b4c7be7` | B |
| `a269e7a` | C |
| `c9fbbb0` | D |
| `85439e7` | closeout 1/2 |
| `849a933` | closeout 2/2 |

For each item, a verifier:
- read the cited lines with `git show 849a933:<path>`;
- compared them with `0432fb8` through `git diff 0432fb8 849a933`, `git log 0432fb8..849a933` and `git grep`;
- re-read the runbook line numbers in `Sirkit_Remaining_Builder_Master_Runbook.md`;
- tried to refute its item.

Nothing was executed (no vitest, tsc, eslint, tsx, node or package manager). No repository file was written and no page was fetched. Two consequences follow:
- Section 1.2 stays RECORDED (reader 7) and was not re-verified.
- The reader gap ids (S*-G*, G7-*) come from the readers' maps and could not be checked against the repository.

In this section, CONFIRMED means read at `849a933`.

The synthesizer (a read-only agent, not the lead) then reconciled the verifier results and took three further steps:
- **Resolved a disagreement between verifiers** with a read-only `git grep` (item 9.5-37).
- **Read the two closeout gates.** It read `app/lib/computation/__tests__/b22-closeout-statements.test.ts` and `app/lib/agent/orchestration/__tests__/b21-closeout-statements.test.ts` at `849a933` to establish which pages they scan:
  - The B22 suite scans every `artifacts/**/*.md` except `artifacts/remaining-builder-program/`, B22's README, B22's discovery and B22's closeout page. It also scans `docs/` and `README.md` (`:123-130`). It looks for superseded count and spawner phrases (`:47-48`).
  - Both suites count their own dated superseding notes on every page (`b22-closeout-statements.test.ts:647-651`; `b21-closeout-statements.test.ts:404-411`).
- **Kept this page clean for those gates.** Once this page lives at `artifacts/ai-control-plane-b23/discovery.md`, it is scanned. Section 9 therefore paraphrases the superseded phrases instead of quoting them, and quotes neither dated note prefix.

### 9.2 Verdicts

| Item | Verdict | Citations moved or changed (old -> new) | Note |
|---|---|---|---|
| D23-1 | stands | none | Every citation holds, and B22 touched none of the files. Precision: JLCPCB, PCBWay and OSH Park also appear as four DRC capability presets (`app/lib/pcb/drc/presets/*.json`) and in the `jlcpcb-2l` rule profile (`rule-profile.ts:30`, `:46`). None of these has an endpoint, credential, operation, terms or enable state. The CD-12 `ProcurementProviderDescriptor` and `createProviderDescriptor` have no caller at all, tests included; their only link is the re-export at `index.ts:11`. |
| D23-2 | stands | none | Sharpened. The validator stops a blocked source from listing any operation (`:625`, `:629`). A disabled source lists its operations only as a whole (Mouser `:297`, `:354`). What is missing is a per-operation enable state, tier or kind. CD-12 carries only opaque `licenseRef` and `retentionPolicyRef` strings. `QuotaLimit` also counts matched parts. |
| D23-3 | stands | none | B22 did not touch `app/lib/net` or `app/lib/distributors`. There is still no upload primitive in production. B22-D recorded that the release-archive reader inflates each entry before its 64 MiB total check (`validate-package.ts:180-183`; `adversarial-matrix.md:248-251`). |
| D23-4 | stands | `app/lib/acquisition/admission-control.ts:308-318` -> `app/lib/acquisition/source-registry.ts:249` (the "0 automatic retries" half; also `:322`, `:418`, `:498`) | An expired-lease `processing` event is re-claimed, which is a second automatic re-dispatch (`server-repository.ts:32`). Unique indexes (`schema.ts:1277`, `:1294`, `:1308`) narrow the no-head-row UNKNOWN. B22's `computation.evidence.v1` is a precedent only. |
| D23-5 | stands | claim "`contentHash` and `retrievedAt` are never stored" (wrong, already at `0432fb8`) -> `app/lib/distributors/cache.ts:294` | `retrievedAt` is persisted as `part_offers.last_refreshed_at` (Mouser excluded); only `contentHash` is never stored. Regeneration also needs rule-profile evidence that is unexpired and not too old (`release/route.ts:116-120`). Superseded authorities stay in durable history. |
| D23-6 | stands | none | Precision: `releaseId` derives at `release-manifest.ts:197`, and `archiveSha256` is `sha256(archiveBytes)` at `release-gate.ts:367`. Runbook `:152-153` is a loose anchor; `:976` carries the requirement. |
| D23-7 | stands | none | Precision: the callable gate also re-checks scope, board identity, profile schema and `sourceDate`-relative expiry (`release-gate.ts:153-159`, `:179-182`). B22-B's sealed computation request (`app/lib/computation/requests.ts`) is a closer reusable shape, but it closes nothing. |
| D23-8 | changed-by-B22 | `app/lib/agent/orchestration/scheduler.ts:183` (same line, changed by B22-B `b4c7be7`); `app/lib/agent/orchestration/scheduler.ts:220` (same line, changed by B22-B) | The withdrawal now drops three names (it adds `computation-engine`); `:257-258` is unchanged. B22 added a second forced-Tier-0 port binding, `bound-computation`. The gap stands, slightly widened. |
| D23-9 | stands | `app/lib/auth/route-resource-classification.ts:54` (same line, changed by B22-A2 `c037627`: D22-18 closed) | The aside about `:54` is obsolete. `/api/pcb/qualify` (`:55`) and `/api/chat` (`:78`) now carry `"freerouting (java)"`. B22 added no route, CSV row or column. The census at `b22-a2-process-census.test.ts:326-337` is the precedent for an outbound-egress column. |
| D23-10 | stands | none | The registry also says "never orders or releases" (`action-registry.ts:182`). BomView has similar copy (`BomView.tsx:743`, `:1083`, `:1394`). B17-A's reason rule covers only controls classified unavailable (`:93-95`); `:63` is the binding rule. |
| D23-11 | stands | none | The D21-33 chain holds and no webhook code exists. B22 added a human-only sealed request (`requests.ts:1-13`, `:21-23`) and process-importer gates; neither gates the chat route, the loop or the gateway. `PriceBreak` carries a currency per price break. |
| D23-12 | stands | none | Added gap: the route check reads only each `route.ts` file's own text (`b19-e-no-purchase-tripwire.test.ts:306`). No name floor applies to foreign MCP tool names. |
| D23-13 | stands | none | `firmware-bringup/types.ts:62` is the unexecuted `DiagnosticFirmwarePackage`. Seed types `FactoryTestResult` and `CalibrationResult` exist (`:53`, `:57`), but neither is held in project state or persisted server-side. |
| D23-14 | stands | none | Correction: `factory.ts:5` records the caller's `uutIdentityRef` and `stationFixtureInstrumentRefs` unchecked (an empty list passes) and has no operator field. The four functions are still called only from tests; `materializeRelease` has no caller at all. |
| D23-15 | stands | none | B22-B changed only registry `:149` and B17-A `:54`. The B01 CSV grew from 103 to 105 lines, and the assembled-release row stays at `:47`. A person sees only "Assembled release is not available." (`manufacturing-errors.ts:62`). `manufacturing-release-gate.test.ts` is in neither CI workflow. |
| D23-16 | stands | none | A second non-acceptance record exists: `artifacts/prompt-to-gerber/r05-e2e01-report.md:616-619`, `:657`. Quickstart `:47` repeats the upload instruction, and `:49-50` concede that external acceptance gates are open. |
| D23-17 | stands | `manufacturing-summary.ts:83` -> `app/api/pcb-sync/manufacturing-summary.ts:83`; `route.ts:109` -> `app/api/pcb/release/route.ts:109` (paths qualified; both hold) | The summary reader does receive a `digest` (`handler.ts:200`, `:228`), but it is a `pcbSyncDigest`, a different domain from the authority's `pcb-authority-` digest. No test pins the digest half. |
| D23-18 | stands | `rule-profile.ts:30` -> `app/lib/pcb/fab/rule-profile.ts:30`; `qualify/route.ts:82` -> `app/api/pcb/qualify/route.ts:82`; `qualify/route.ts:282-284` -> `app/api/pcb/qualify/route.ts:282-284`; `rule-profile.ts:97` -> `app/lib/pcb/fab/rule-profile.ts:97`; `rule-profile.ts:45-48` -> `app/lib/pcb/fab/rule-profile.ts:45-48`; `release/route.ts:116-120` -> `app/api/pcb/release/route.ts:116-120` (paths qualified; all hold); "section 2.2 (draft) - other presets feed only the engineering export" (wrong, already at `0432fb8`) | The other presets also feed autoroute, the PCB editor, agent context, the AI snapshot and the durable read bundle. None of them reaches the deterministic release. |
| D23-19 | stands-with-moved-citations | `LIVE_BLOCKERS.md:7-15` -> `artifacts/remaining-builder-program/LIVE_BLOCKERS.md:7-16`; `LIVE_BLOCKERS.md:11` -> `artifacts/remaining-builder-program/LIVE_BLOCKERS.md:11` (holds); `PROGRAM_STATE.json:12-17` -> `artifacts/remaining-builder-program/PROGRAM_STATE.json:12-18` | B22-A2 added LB-10 (OD-147). `liveBlockers` grew from 4 to 5 entries, and LB-5 is still omitted (as are LB-4, LB-6, LB-7 and LB-8). |
| D23-20 | changed-by-B22 | `b19-e-ci-job-scope.test.ts:54` -> `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:54` (changed: four entries); `OWNER_DECISIONS.md:1134-1138` -> `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1134-1138` (holds); `OD-59 (requirement)` -> `artifacts/remaining-builder-program/OWNER_DECISIONS.md:301` (holds); `OD-146 (B22 proposes b22-)` -> `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1673-1680` (applied, no longer a proposal) | `b23-` is still absent. The guard requires a suite for every listed chapter (`:152`). |
| D23-21 | stands | `governance.ts:8-10` -> `app/lib/release-engineering/governance.ts:8-10`; `agent-tools.ts:8` -> `app/lib/release-engineering/agent-tools.ts:8`; `foundation.test.ts:2` -> `app/lib/release-engineering/__tests__/foundation.test.ts:2`; `foundation.test.ts:42` -> `app/lib/release-engineering/__tests__/foundation.test.ts:42` (paths qualified; all hold) | The four stubs are still unpinned. B22's closeout tripwire does not name them. |
| 0 | changed-by-B22 | `app/lib/auth/route-resource-classification.ts:54` -> `route-resource-classification.ts:54-55, :78; app/lib/computation/__tests__/b22-a2-process-census.test.ts:368-394`; `artifacts/remaining-builder-program/OWNER_DECISIONS.md:1661` -> `OWNER_DECISIONS.md:1661 (OD-152); headings now end at :1935 (OD-137); highest number OD-159 at :1872`; `artifacts/ai-control-plane-b22/discovery.md:789-812` -> `discovery.md:977-1000` (moved); `discovery.md:807` -> `discovery.md:995; recorded as OWNER_DECISIONS.md:1720` (moved); `discovery.md:1274` -> `discovery.md:1462` (moved); `git grep 'OD-15[3-9]' empty` -> `EXECUTION_LEDGER.md:3830-3831; artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:21-24`; `artifacts/remaining-builder-program/LIVE_BLOCKERS.md:7-15` -> `LIVE_BLOCKERS.md:7-16 (LB-10 at :16)` | The D22-18 bullet and the numbering bullet are stale; every other section-0 citation holds. The concurrent-duplicate UNKNOWN narrows (D23-4 verifier). |
| 1.1 | stands | none | Every runbook line number and quotation is exact. |
| 1.2 | not re-verified | none | External facts, RECORDED by reader 7. Web fetches are forbidden. |
| 1.3 | changed-by-B22 | `app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts:241` -> `b20-c1-three-way-parity.test.ts:241` (now 47/36/9/27); `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:54` -> `b19-e-ci-job-scope.test.ts:54` (now ends with `"b22-"`); `artifacts/remaining-builder-program/PROGRAM_STATE.json:4-9, :18` -> `PROGRAM_STATE.json:4-10, :19`; `EXECUTION_LEDGER.md:3784 (last heading) and git grep B23 count 0` -> `EXECUTION_LEDGER.md:4254 (last heading, B22 closeout 2/2); B23 mentions at EXECUTION_LEDGER.md:3830, :4262 and PROGRAM_STATE.json:19`; `PROGRAM_STATE.json:12-17 (four liveBlockers, omits LB-5)` -> `PROGRAM_STATE.json:12-18` | The registry, the 555 identity, the census 165/162/3/0, the two release rows, the cited owner decisions and LB-5 all hold. "Three working" wrongly calls the disabled Mouser integration working (a wording fix). |
| 2.1 | stands | `route-policy.ts:230-237 ("the snapshot and the diff call live" part)` (wrong) -> `route-policy.ts:281-285; app/api/bom/snapshot/route.ts:38; app/api/bom/diff/route.ts:62; OWNER_DECISIONS.md:114-116`; `"the only manufacturer hand-off is the note" (jlcpcb-2l.fab.json:22)` (wrong) -> `jlcpcb-2l.fab.json:22; jlcpcb-4l.fab.json:24; oshpark-4l.fab.json:24; pcbway-standard.fab.json:22`; `"git grep: only foundation.test.ts"` (wrong) -> `app/lib/release-engineering/index.ts:11 (barrel re-export, itself imported by nothing)` | All three errors predate B22. No 2.1 file changed, and B22 added no external integration. |
| 2.2 | stands | none | Of the cited files, only `build-bundle.ts` changed: B22-A1 added bounded kicad-cli output reads without moving any cited line, and this affects the engineering export only. Census case 5 now pins that `/api/pcb/release` reaches no spawner. |
| 2.3 | stands | none | No 2.3 file changed. B22 added no outbound caller and no upload primitive. |
| 2.4 | stands | none | B22 appended its action rows on `action-registry.ts:149`, so `:77`, `:118` and `:159` did not move. `SIRKIT_NAMED_COMPUTATIONS` gates in-process computation only. |
| 2.5 | stands | none | B22 touched nothing in this area beyond registry `:149` and B17-A `:54`. |
| 2.6 | changed-by-B22 | `app/lib/agent/orchestration/scheduler.ts:183, :220` (same lines, now three authorities) | The section omits three B22 additions: the `bound-computation` binding (`tool-registry.ts:64`, `:98`, `:292`), the MCP `computation` exclusion (`mcp-exposure.ts:132`) and the agent set of 36 (`agent-exposure.ts:64`). |
| 2.7 | changed-by-B22 | `counts 42/33/9/24` -> `app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts:241` (47/36/9/27); `b20-b4-process-gate.test.ts:38-44` (the draft's spawner count) -> `app/lib/mcp/server/__tests__/b20-b4-process-gate.test.ts:40-44` (three process spawners and two thread starters) | Four B22 standing gates are missing from the list. The draft's spawner phrase would fail `b22-closeout-statements` on this page. |
| 3 | stands | `agent-tools.ts:6-7` -> `agent-tools.ts:5-7` (precision) | Every other citation holds. The table omits three reusable models B22 added: the evidence store, the sealed request and the structural MCP exclusion. |
| 4 (tally) | unchanged | none | No verifier changed a severity, and B22 closes none of D23-1..D23-21. |
| 5 | changed-by-B22 | `counts 42/33/9/24 (b20-c1-three-way-parity.test.ts:241)` -> `app/lib/mcp/server/__tests__/b20-c1-three-way-parity.test.ts:241`; `permission-tiers.ts:31, :141 (b18-a-permission-tiers.test.ts:44-64)` (wrong: no test pins the `:31` title text); `OD-59/OD-124 (OWNER_DECISIONS.md:1131-1139)` (wrong) -> `OWNER_DECISIONS.md:301 (OD-59); :1131-1139 (OD-124)` | The `:526` literal has no verbatim pin. The router sentence is pinned only through `b21-b-page.test.ts:52`. B22 adds pins for runbook `:148` and `:1017`. All eight B22 commits comply with `:164-165`. |
| 6 | changed-by-B22 | `OD-164 'counts 42/33/9/24 unchanged'` -> `b20-c1-three-way-parity.test.ts:241`; `OD-173 B21 withdrawal 'not two names'` -> `app/lib/agent/orchestration/scheduler.ts:183, :220` | OD-174's census target depends on OD-159. OD-178 should use the dated in-place note. OD-161 must allow the `CHAPTERS` edit. OD-160..OD-180 and LB-11/LB-12 are free. |
| 7 | changed-by-B22 | `conventions 'counts 42/33/9/24 unchanged'` -> `b20-c1-three-way-parity.test.ts:241`; `B23-A2 scheduler predicate / B21 withdrawal` -> `scheduler.ts:183, :220`; `Closeout README.md:41 / docs/pcb-quickstart.md:3-6 'reworded'` (changed: the dated in-place convention) | B22 closes no increment. The adjustments are listed in 9.4. |
| 8 | partly-closed-by-B22 | `Q12 OD-153..OD-159 reservation` -> `artifacts/ai-control-plane-b22/unknowns-and-owner-decisions.md:21-24; artifacts/remaining-builder-program/EXECUTION_LEDGER.md:3830-3831` | B22 answered Q11 and Q12. Q10 stays open. The other items are unaffected. |

### 9.3 What B22 changed that B23 inherits

**Closed by B22** (draft items only; no defect D23-1..D23-21 is closed):
- **D22-18** (section 0's bullet, and the aside in D23-9): B22-A2 (`c037627`) removed `externalProcess` from `/api/pcb/release` (`route-resource-classification.ts:54`). It labelled `/api/pcb/qualify` (`:55`) and `/api/chat` (`:78`) `"freerouting (java)"`. `b22-a2-process-census.test.ts` case 5 pins that the release route reaches no spawner and carries no label.
- **Section 8 item 11** is answered and pinned:
  - `release-gate.ts:1-36` imports neither `build-bundle` nor `kicad-cli-runner`.
  - Their only production importers are `app/api/pcb/export/gerbers/route.ts:34` and `build-bundle.ts:18-19`.
  - B22 added test-only importers under `app/lib/computation/__tests__`.
- **Section 8 item 12** is answered (see "Records and numbering" below).
- **B23's start condition** (runbook `:28`) is met: PR #13 merged as `43cb1b0`.

**Widened.** D23-8 is slightly wider:
- The B21 withdrawal is now a three-name denylist (`scheduler.ts:183`, `:220`). `withdrawAuthority` also strips `computationAvailable` (`:175`), and `:257-258` is unchanged.
- B22 added a second approval-none, Tier 0, port-bound binding class, `bound-computation` (`tool-registry.ts:64`, `:488-497`).
- B22 added three agent-exposed Tier 0 computation tools (`agent-exposure.ts:64`).
- Nothing reaches a provider: there is no fetch or https call in `app/lib/computation`, `app/api/chat/computation-runtime.ts` or `app/lib/agent/computation-reads.ts`.

**Narrowed design effort.** These are precedents B23 can copy; none closes a gap:
- **Receipts** (D23-4, D23-5, OD-167, B23-B2): the silent durable aggregate `computation.evidence.v1` (`app/lib/computation/evidence-store.ts:1-29`, `:15-19`, `:248-255`; OD-141). It uses CAS on revision and an idempotent append, re-verifies its digest on load, has no outbox effect and references raw artifacts by SHA-256.
- **Approval** (D23-7, D23-11, OD-166, OD-172): B22-B's sealed computation request (`app/lib/computation/requests.ts:1-13`, `:21-23`, `:91-122`, `:176-206`).
  - What it does: a server-sealed digest and nonce, a 15-minute TTL, human-only approval of the exact digest in the same scope, a refused agent approver, and consume-once before the executor runs.
  - Its limits: it is in-memory with no route (OD-159 proposes one), names a kind and profile rather than a provider and purpose, and carries no decimal ceiling.
- **Structural exposure** (D23-8, D23-12, B23-A2): B22's MCP exclusion is keyed on id prefix or binding status (`mcp-exposure.ts:35`, `:132`). It is the first exposure rule that sees a tool by its binding rather than by a floor word.
- **Route vocabulary** (D23-9, OD-174): the source-derived process census (`b22-a2-process-census.test.ts:326-337`) pins each route's `external_process` to its import closure. An outbound-egress column could be derived the same way, from closures that reach `app/lib/net/outbound-fetch.ts`.
- **Wording** (D23-16, OD-178): B22 corrected stale claims with dated in-place superseding notes (`README.md:63`, `app/api/simulate/route.ts:4`), enforced by its closeout tripwire.
- **Line stability** (D23-10, D23-15): B22 appended its two action records in place on `action-registry.ts:149`, so `:77`, `:118` and `:159` did not move.

**Unchanged.** B22 touched none of the following:
- `app/lib/acquisition/source-registry.ts`, `app/lib/net`, `app/lib/distributors` (including `cache.ts`), `app/lib/durable-workflow`, `app/lib/schgen` and `admission-control.ts`
- the release route, `release-gate.ts`, `release-manifest.ts`, `release-ledger.ts`, `authority-store.ts`, `rule-profile.ts` and the fab/DRC preset folders
- `app/api/pcb-sync`, the qualify route, `ManufacturingWorkflowPanel.tsx` and `useManufacturingWorkflow.ts`
- `app/lib/release-engineering`, `app/lib/firmware-bringup`, `app/lib/full-flow`, `app/lib/db/schema.ts` (no migration added) and `lib/persistence.ts`
- `route-policy.ts`, `permission-tiers.ts`, `granted-execution-families.ts` and `router.ts`
- `foreign-tools.ts`, `server-registry.ts` and the B19-E tripwire

**Counts at `849a933`:**

| What | At `0432fb8` | At `849a933` | Source |
|---|---|---|---|
| Registry / agent-exposed / MCP-exposed / agent-only | 42 / 33 / 9 / 24 | 47 / 36 / 9 / 27 | `b20-c1-three-way-parity.test.ts:241`; B22-B, OD-139 |
| Tools / action records (generated CSVs) | 42 / 102 | 47 / 104 | B22's five new tool ids and two new action ids contain none of `quote`, `dfm`, `submit`, `checkout`, `cart`, `buy`, `payment` |
| B01 toolability CSV | 103 lines | 105 lines | computation rows at `:72-73`; assembled-release row still `:47` |
| `CHAPTERS` entries | 3 | 4 | |
| Live blockers | LB-1..LB-9 | LB-1..LB-10 | `LIVE_BLOCKERS.md:7-16` |
| `liveBlockers` entries | 4 | 5 | `PROGRAM_STATE.json:12-18` |
| `APP_SPAWNERS` | (see 2.7 fix) | three process spawners (diagnostic runner, autoroute runner, kicad-cli runner) and two worker-thread starters (engine host and its worker) | `b20-b4-process-gate.test.ts:40-44`; OD-136, OD-140 |

Unchanged counts:
- route census 165 = 162 + 3 + 0 (151 route files; B22 added no `route.ts`);
- exactly two `releaseOrQualification` rows;
- the pinned 555 release identity;
- nine router Tier 3 families;
- four fab presets, of which one qualified profile (`jlcpcb-2l`, expiring 2027-09-09);
- four source ids and one authority class;
- three distributor ids;
- `AuthMethod` with 4 members and `SourceStatus` with 3;
- the outbox's 5 s, 8 attempts and 4 states;
- SchGen's 3 attempts.

**Records and numbering:**
- B22 spent OD-134..OD-159 and LB-10.
  - OD-159 is proposed: a human approval surface for process-backed computation requests that would move the census from 165 to 166 or more (`OWNER_DECISIONS.md:1872-1877`).
  - LB-10 is OD-147 (`LIVE_BLOCKERS.md:16`; `OWNER_DECISIONS.md:1720`).
  - `OWNER_DECISIONS.md` headings now end at `:1935` (OD-137).
- B22's unknowns page (`:21-24`) and the ledger (`EXECUTION_LEDGER.md:3830-3831`) state that B23's discovery starts at OD-160. No file uses OD-160..OD-189, LB-11 onward or a `D23-` id, and `artifacts/ai-control-plane-b23/` does not exist.
- `PROGRAM_STATE.json` still names chapter B22, with:
  - checkpoint "B22 complete";
  - base `d0d2ec8`;
  - `lastGreenSha` `85439e7`;
  - PR #13;
  - a `nextAction` (`:19`) that names B23.
- The ledger's last heading is `:4254` (B22 closeout 2/2). B23 is mentioned at `:3830` and `:4262`, without an entry.
- All eight B22 commits are authored by `Dandi Desta <dandidesta82@gmail.com>` with no AI co-author trailer.

**New standing gates B23 inherits:**
- `b22-closeout-statements.test.ts`, which scans B23's pages.
- `b22-a2-process-census.test.ts`:
  - case 3 (`:326`): each route's `external_process` must equal the census derived from source;
  - case 5 (`:368`): the release route reaches no spawner.
- `b22-b-exposure.test.ts`:
  - case 4 (`:127-156`): the `computation-engine` withdrawal;
  - `:68`: the `MCP_EXCLUSION_REASONS` order;
  - `:121`: B22's ids match no Tier 3 pattern;
  - case 5 (`:158`): computation is never granted or MCP-listed.
- `b22-b-no-generic-exec.test.ts`:
  - `:46-48`: the process and thread importer gates;
  - case 5 (`:126`): no B11-scanned file names a B22 identifier.

**Other B22 records that bear on B23:**
- **B22-D's archive finding.** `extractAndValidateReleaseArchive` inflates each entry whole before its 64 MiB total check (`app/lib/pcb/fab/validate-package.ts:180-183`; `adversarial-matrix.md:193-195`, `:248-251`).
  - B22 left this unfixed because the reader only reads back archives Sirkit built.
  - It bears on runbook `:155` if B23 re-reads an archive before upload, or ever reads an archive a provider returns.
  - OD-165's bounds (`validate-package.ts:14-15`) still hold.
- **B22-A1's engineering-export changes.** B22-A1 gave the engineering export an explicit kicad-cli environment and bounded tool-output reads (`build-bundle.ts:182`, `:208`; `TOOL_OUTPUT_FILE_MAX_BYTES`, D22-8).
  - B22's runtime profiles describe local engines only (`app/lib/computation/runtime-profile.ts:28`).
- **B22's only new flag.** `SIRKIT_NAMED_COMPUTATIONS` (`app/api/chat/computation-runtime.ts:20`, OD-158) gates in-process computation. B22 added no ordering, procurement, quote or spend flag, role, record or owner decision.
- **B22's live-suite pattern.** B22's live suites are opt-in through `describe.runIf(process.env.SIRKIT_B22_LIVE_RUNNER === "1")`, the same pattern as OD-180's `SIRKIT_B23_LIVE_PROVIDER`.

### 9.4 Consequences for the increment plan (section 7) and the owner decisions (section 6)

**Conventions:**
- **Counts.** The counts read 47/36/9/27, and B23 adds no agent tool. The route census still moves once by review, to 166/163/3/0 if OD-159 is not applied first, and to 167/164/3/0 if it is.
- **Start.** The start condition is met. The chapter branch starts from main `43cb1b0`.
- **Phrasing on B23 pages.** Every B23 page, this discovery page included, must avoid the phrases `b22-closeout-statements.test.ts` treats as superseded (`:47-48`). It must also never reproduce B21's or B22's dated superseding-note prefix, because both suites count those notes per page (`b22-closeout-statements.test.ts:647-651`; `b21-closeout-statements.test.ts:404-411`; the synthesizer's read). Admitting a B23 line to B22's page allow-list would move its pinned 20 admits (INFERRED).

**B23-A1:**
- `CHAPTERS` must be extended in place in `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts:54`, together with the workflow's directory list, as B22-A1 did (OD-146). No separate suite can extend it.
- This must land in the same commit as the first `b23-` suite, because the guard requires a suite for every listed chapter (`:152`).
- OD-161's "B19 tests stay untouched" must allow that one line.
- LB-11 and LB-12 are free.
- `liveBlockers` also omits LB-4, LB-6, LB-7 and LB-8. OD-179's mirror of LB-5, LB-11 and LB-12 leaves those four unmirrored. The runbook's `PROGRAM_STATE` schema (`:74-88`) has `openBlockers`, not `liveBlockers`, so this is a consistency choice, not a requirement (INFERRED).
- The descriptor must express a per-operation enable state, tier and kind (D23-2, sharpened). B20's `server-registry.ts` per-tool `agentTools` allow list and rollout flag are a gating pattern to reuse (the registry is empty, OD-48).

**B23-A2:**
- **Keep the computation-engine withdrawal.** `computation-engine` must stay in both scheduler withdrawals (`scheduler.ts:183`, `:220`). An `external-*` prefix filter alone would stop dropping it and fail `b22-b-exposure` case 4.
- **Keep the exclusion order.** The MCP `computation` reason must stay right after `never_exposed` (`b22-b-exposure.test.ts:68`).
- **No new stem catches a B22 id.** The new stems match no current id, including B22's five `sirkit.computation.*` ids.
- **The structural Tier 3 needs a structural side effect.** Both port-bound classes forbid an approval tier (`tool-registry.ts:285`, `:494`), so a port-bound provider read reaches Tier 3 only through an id word. That supports OD-173's structural side effect. The binding-keyed MCP exclusion is its precedent.
- **`outboundEgress` must be derived from closures.** It should be derived the way `b22-a2-process-census` case 3 derives `external_process`, and case 3 must stay green.
- **The structural no-order route check should read delegated handler modules too.** The B19-E check reads only each `route.ts` (`:306`; D23-12's added gap).

**B23-B1:**
- `POST /api/pcb/provider-exchange` needs a row in the route-classification CSV that census case 3 accepts. Case 5 already pins that the release route spawns nothing.
- The extraction concerns only the route-only checks: pins, the current-head comparison, lineage, release-instant expiry and the 366-day age (`route.ts:95-120`). The gate already re-checks scope, board identity, profile schema and `sourceDate`-relative expiry (`release-gate.ts:153-159`, `:179-182`).
- B22-B's sealed request is a closer approval shape for OD-166 than the assignment queue. If the owner applies OD-159's computation-approval route first, the census target moves.

**B23-B2:**
- `exchange-ledger.ts` can copy `evidence-store.ts`.
- Q10 stays open: B22's evidence-store tests use only the in-memory repository, so B23-B2's PGlite concurrency case is still needed. The unique indexes (`schema.ts:1277`, `:1294`, `:1308`) narrow the risk.
- The outbox has a second automatic re-dispatch path, the expired-lease re-claim (`server-repository.ts:32`). The "no outbox handler performs a send" pin should cover it (INFERRED).
- No re-read of a release archive may rely on the release-archive reader's bounds (B22-D).

**B23-B3:**
- **Fixing the summary flag.** The fix must recompute `authoritativeBoardDigest` (`release-gate.ts:133-135`). Comparing `current.digest` does not work, because it is a `pcbSyncDigest` (`pcb-sync/board.ts:8`).
- **Adding a digest-only case.** The summary suite never asserts a digest-only mismatch (`b16-a-manufacturing-summary.test.ts:37`, `:51`).
- **Stale header comment.** The summary's header claims a revision and digest comparison it does not make (`manufacturing-summary.ts:8`).
- **Profile evidence in staleness.** Regeneration is also refused on rule-profile evidence that has expired or is older than `RELEASE_PROFILE_EVIDENCE_MAX_AGE_MS` (`release/route.ts:116-120`). OD-167's "re-derived while head" and OD-168 should include that condition (INFERRED).

**B23-C:**
- B22 added no ordering flag, role, record or owner decision.
- OD-170 ("no control is shown") already satisfies B17-A `:63`, the binding rule.
- The notice should be written knowing that the registry also says "never orders or releases" (`action-registry.ts:182`) and that BomView says, in the present tense, that no order is placed (`BomView.tsx:1394`).
- Appending new records on an existing registry line, as B22 did on `:149`, would keep `:118` and `:159` valid (verifier suggestion).

**B23-D:**
- **Current state.** The B01 CSV already holds B22's two rows (`:72-73`), and the assembled-release row stays at `:47`.
- **CI coverage.** The block's only runtime pin (`manufacturing-release-gate.test.ts:149-150`) runs in no CI workflow. B23-D's id-named pin must sit in a CI-admitted suite to bite in CI (INFERRED).
- **What a person sees.** OD-177's new gate message would reach only the redacted trace. A person sees "Assembled release is not available." (`manufacturing-errors.ts:62`), so a person-facing statement of the unblock condition would need the panel or the error map (INFERRED).
- **OD-176's hardening list.** It should name `factory.ts:5`'s unchecked refs and the seed types `FactoryTestResult` and `CalibrationResult`.

**Closeout.** `README.md:41` and `docs/pcb-quickstart.md:3-6` are corrected with a dated in-place B23 note, never a rewrite. Quickstart `:47` is reviewed with them, and the R05 report's open owner action is cited.

**Owner decisions:**
- **Numbering.** OD-160..OD-180, the reserved OD-181..OD-189, LB-11, LB-12 and `D23-` are all free at `849a933`. The only OD-160 mentions are B22's statements that B23 starts there, so no renumbering is needed. OD-137's heading exists (`OWNER_DECISIONS.md:1935`).
- **Unaffected.** The verifiers found no B22 change to OD-160, OD-162, OD-163, OD-165 (bounds `validate-package.ts:14-15`; still no provider admission key), OD-168 (2027-09-09), OD-169, OD-171 (seven inputs, runbook `:988-994`), OD-175, OD-176 or OD-177.
- **Need edits:**
  - OD-161: allow the `CHAPTERS` line.
  - OD-164: counts 47/36/9/27.
  - OD-166 and OD-172: may reuse the sealed-request shape; they overlap OD-159.
  - OD-167: matches OD-141's design; add the profile-evidence condition (INFERRED).
  - OD-173: three names, plus the MCP reason order.
  - OD-174: the census target depends on OD-159; keep census case 3 green.
  - OD-178: use a dated in-place note.
  - OD-179: optionally mirror LB-4, LB-6, LB-7 and LB-8 as well.
  - OD-180: same-commit admission and the workflow `:226` filter.

### 9.5 Corrections and additions the re-verification found (applied in place; 9.6)

Old text is quoted as it stands in the draft, except where it is one of the phrases B22's closeout gate scans for; those are paraphrased.

1. **Preamble:**
   - The list of files B22 touches omits `app/lib/computation/*`, `app/api/simulate`, `app/api/chat/computation-runtime.ts` and the action and tool registries. None of them is a B23 surface (section 0 verifier).
   - "the lead re-verifies every citation ... before committing" is now done: this section.
2. **§0, concurrent duplicate.** Old: "The case where no head row exists yet, and the transaction isolation level, were not established". Corrected: unique indexes on heads, records and replays (`schema.ts:1277`, `:1294`, `:1308`) make a concurrent first commit fail a unique constraint rather than write twice (INFERRED; the migration SQL was not read). The isolation level stays UNKNOWN (D23-4 verifier).
3. **§0, D22-18 bullet.**
   - Old: "The stale `externalProcess: "kicad-cli (server-authoritative)"` row (`app/lib/auth/route-resource-classification.ts:54`) is D22-18, which B22-A2 owns". Corrected: B22-A2 (`c037627`) closed it. `/api/pcb/release` carries no `externalProcess`, `/api/pcb/qualify` (`:55`) and `/api/chat` (`:78`) carry `"freerouting (java)"`, and census case 5 pins this.
   - The consequence labelled "(INFERRED)" is now CONFIRMED.
4. **§0, numbering bullet.**
   - Old: "OWNER_DECISIONS headings end at OD-152". Corrected: the headings end at `:1935` (OD-137), and the highest number, OD-159, is at `:1872`.
   - Old: `discovery.md:789-812`, `:807`, `:1274`. Corrected: `:977-1000`, `:995`, `:1462`.
   - Old: "nothing at HEAD records that reservation (`git grep 'OD-15[3-9]'` empty". Corrected: recorded at `b22 unknowns-and-owner-decisions.md:21-24` and `EXECUTION_LEDGER.md:3830-3831`.
   - Old: "LB-1..LB-9 (`:7-15`)". Corrected: "LB-1..LB-10 (`:7-16`)".
5. **§1.3.** Old: "Three working outbound integrations". Corrected: "Three coded outbound integrations (two enabled)", because Mouser is disabled.
6. **§1.3, counts.**
   - Old: "registry 42, agent-exposed 33, MCP-exposed 9, agent-only 24". Corrected: "registry 47, agent-exposed 36, MCP-exposed 9, agent-only 27".
   - Old: CI chapters `["b19-", "b20-", "b21-"]`. Corrected: `["b19-", "b20-", "b21-", "b22-"]`.
   - Old: "(to be re-measured after B22 lands)". Corrected: re-measured at `849a933`.
7. **§1.3, program state.**
   - Old: "next action B22-A1, base `d0d2ec8`, last green `0d38504`" with `PROGRAM_STATE.json:4-9, :18`. Corrected: checkpoint "B22 complete", next action: merge PR #13, then B23; last green `85439e7`; PR #13; citation `:4-10, :19`.
   - Old: "last heading `:3784`, B22 discovery; `git grep B23` count 0". Corrected: last heading `:4254` (B22 closeout 2/2); B23 is mentioned at `EXECUTION_LEDGER.md:3830`, `:4262` and `PROGRAM_STATE.json:19`, without an entry.
8. **§1.3, live blockers.** Old: "`liveBlockers` lists four entries and omits LB-5 (`:12-17`)". Corrected: five entries (LB-10 added at `:17`); it still omits LB-5, and also LB-4, LB-6, LB-7 and LB-8 (`:12-18`).
9. **§2.1, live routes.** Old citation: the snapshot and diff "call live" at `route-policy.ts:230-237`. Corrected: their rows are `:281-285` and carry no `providerCredit` flag. The live grant is at `app/api/bom/snapshot/route.ts:38` and `app/api/bom/diff/route.ts:62` (`OWNER_DECISIONS.md:114-116`). This predates B22.
10. **§2.1, hand-offs.** Old: "the only manufacturer hand-off is the note ... (`:22`)". Corrected: each preset has its own "Order at ...: upload this zip" note: `jlcpcb-2l.fab.json:22`, `jlcpcb-4l.fab.json:24`, `oshpark-4l.fab.json:24` and `pcbway-standard.fab.json:22`.
11. **§2.1 and D23-1, CD-12 callers.** Old: "(`git grep`: only `foundation.test.ts`)" in §2.1 and "have no production caller" in D23-1. Corrected: no caller at all, tests included. The only link is the barrel re-export `app/lib/release-engineering/index.ts:11`, itself imported by nothing. This was already true at `0432fb8`.
12. **§2.6.** Old: "drop exactly `external-observation` and `external-mcp-observation`". Corrected:
    - three authorities, adding `computation-engine` (`:183`, `:220`; `withdrawAuthority` also strips `computationAvailable`, `:175`; pinned by `b22-b-exposure` case 4);
    - `:257-258` still names two;
    - add `bound-computation` (`tool-registry.ts:64`, `:98`, `:292`), the MCP `computation` exclusion (`mcp-exposure.ts:132`) and the agent set of 36.
13. **§2.7.**
    - Old: "42/33/9/24". Corrected: "47/36/9/27".
    - Old: the bullet's spawner count at `b20-b4-process-gate.test.ts:38-44`. Corrected: "three process spawners and two worker-thread starters (`:40-44`)". This fix is mandatory: `b22-closeout-statements` would flag the draft's phrase on this page.
    - Add the four B22 standing gates (9.3).
14. **§3.**
    - Old: `agent-tools.ts:6-7`. Corrected: `:5-7` (`proposal_only` is on `:5`).
    - Add `evidence-store.ts` to the step-5 row, `requests.ts` to the step-3 and B23-C rows, and the binding-keyed MCP exclusion to the "No agent can release or spend" row, which also inherits the three-name withdrawal.
    - The CI row now ends with `b22-`.
15. **D23-1.** Old: "appear only as four fab presets". Corrected: they also appear as four DRC capability presets (`app/lib/pcb/drc/presets/*.json`) and in the `jlcpcb-2l` rule profile (`rule-profile.ts:30`, `:46`). None of these carries an endpoint, credential, operation, terms or enable state.
16. **D23-2.**
    - Sharpen "ordering capability cannot be recorded as present-but-disabled". The validator (`:625`, `:629`) stops a blocked source from listing operations, and a disabled source lists operations only as a whole (`:297`, `:354`). What cannot be recorded is a per-operation enable state, tier or kind.
    - Old: "lacks the same fields". Corrected: it lacks them apart from opaque `licenseRef` and `retentionPolicyRef` strings.
17. **D23-4.**
    - Old: "0 automatic retries (`admission-control.ts:308-318`)". Corrected: coalescing is at `:308-318`; `retry.automaticRetries: 0` is at `source-registry.ts:249`, `:322`, `:418` and `:498`, with DigiKey also allowing one token refresh on a 401.
    - Add the expired-lease re-claim (`repository.ts:36`; `server-repository.ts:32`) and the unique indexes.
18. **D23-5.**
    - Old: "`contentHash` and `retrievedAt` ... are never stored". Corrected: only `contentHash` is never stored. `retrievedAt` is persisted as `part_offers.last_refreshed_at` for every source the registry lets store, Mouser excluded (`distributors/cache.ts:72-75`, `:290-294`, `:307`). This was already wrong at `0432fb8`.
    - The regeneration claim omits a third condition, rule-profile evidence (`release/route.ts:116-120`). Superseded authorities embed board and netlist (`release-gate.ts:77-78`) and stay in durable history (`durable-workflow/types.ts:48-49`) with no loader that reads them.
    - The list of four offer tables is not exhaustive: there are also `component_selection_sourcing_snapshots` (`schema.ts:964`) and `atomic_supplier_parts` (`:554`), neither a quote, order, receipt or upload table.
19. **D23-6.** Old: "`archiveSha256` and `releaseId` (`release-manifest.ts:185-199`)". Corrected: `archiveSha256` at `release-gate.ts:367`; `releaseId` derived at `release-manifest.ts:197`.
20. **D23-7.** Old: "only `releaseManufacturingPackage` and its reload re-check ... are callable". Corrected: the callable gate also re-checks scope, board identity, profile schema and `sourceDate`-relative expiry (`release-gate.ts:153-159`, `:179-182`). Only the pins, the current-head comparison, lineage, release-instant expiry and the 366-day age are route-only (`route.ts:95-120`).
21. **D23-8** (Part 2 amendment). Old: "a two-name denylist (`scheduler.ts:183, :220, :257-258`)". Corrected: three names at `:183` and `:220`; `:257-258` unchanged. The headline is slightly strong, because approval tier or kind `release` gives Tier 3 (`permission-tiers.ts:40`). But both port-bound classes forbid an approval tier, so the defect holds.
22. **D23-9.** Drop "(The stale `kicad-cli` annotation at `:54` is D22-18.)". It is obsolete.
23. **D23-10.**
    - Old: "the registry's only mention is `bom.workbench`'s". Corrected: add `action-registry.ts:182`.
    - Old: "statements about a past act". Corrected: add `BomView.tsx:743`, `:1083` and `:1394` (present tense).
    - Old: "B17-A requires any shown control to carry a visible reason (reader 6)". Corrected: controls classified unavailable need a non-empty reason (`:93-95`), and a `missing` record must be reached by no control and no route (`:63`).
24. **D23-11.**
    - Old: "on the model's call". Add: once the user's literal instruction passes the explicit-request grammar; wired at `app/api/chat/route.ts:377-393` and dispatched from `gateway.ts:621`.
    - Old: "numbers in one currency". Corrected: each price break carries its own currency string, and totals are in USD.
25. **D23-12.** Old: "over route-file text". Corrected: over each `route.ts` file's own text only (`:306`). A delegated handler module is not read.
26. **D23-13.**
    - Old: "unexecuted CD-11 plans, `firmware-bringup/types.ts:62`". Corrected: `:62` is the unexecuted `DiagnosticFirmwarePackage`, and `:65` is the plan.
    - Add functional test: seed `FactoryTestResult` and `CalibrationResult` (`:53`, `:57`) exist but are not in `FirmwareBringUpProjectState` (`:74`) and not persisted server-side. `BoardIdentityContract` (`:58`) is an identity-source contract.
    - Side fact: the CD-11/CD-12 project-state tables (`schema.ts:1166`, `:1176`) have no writer, and both save functions in `lib/persistence.ts` have no caller.
27. **D23-14.** Old: "binds no station, fixture, instrument or operator provenance". Corrected: records the caller's `uutIdentityRef` and `stationFixtureInstrumentRefs` unchecked (an empty list passes) and has no operator field.
28. **D23-15** (additions; the lead may append):
    - a person sees only "Assembled release is not available." (`manufacturing-errors.ts:62`), and the unblock wording goes only to the redacted trace;
    - `manufacturing-release-gate.test.ts` is admitted to neither CI workflow;
    - the B01 CSV is now 105 lines.
29. **D23-16.**
    - Old: "the only recorded attempt". Corrected: a second non-acceptance record exists, `artifacts/prompt-to-gerber/r05-e2e01-report.md:616-619`, `:657`.
    - Quickstart `:47` repeats the upload instruction, and `:49-50` concede that external acceptance gates are open.
30. **D23-17** (note for B23-B3; text holds). The two digests are in different domains: `current.digest` is a `pcbSyncDigest`, while the authority's `boardDigest` is `pcb-authority-<sha256>`. The summary header (`manufacturing-summary.ts:8`) overstates what is compared, and no test pins the digest half.
31. **D23-18.** Old: "the other presets feed only the engineering export (section 2.2)". Corrected: they also feed:
    - autoroute (`app/api/pcb/autoroute/route.ts:130`);
    - the PCB editor (`PcbEditor.tsx:1383`);
    - agent context (`app/lib/agent/context.ts:604`);
    - the AI snapshot (`app/lib/pcb/ai/snapshot.ts:176`);
    - the durable read bundle (`durable-read-bundle.ts:399`).

    None of them feeds the deterministic release.
32. **D23-19 and D23-20.** Covered by the Part 2 amendments. In D23-20, OD-146 is applied, no longer a proposal.
33. **§5.**
    - Old: "counts 42/33/9/24". Corrected: "counts 47/36/9/27".
    - Old: `:31` title pinned by `b18-a-permission-tiers.test.ts:44-64`. Corrected: that test pins the tiers (`:44-47`, `:64`) and the `never` decision (`:61`). The `:31` text is unpinned and appears only there and at `execution-display.ts:138`.
    - `:526` "no scraping" has no verbatim pin. `b19-source-registry.test.ts` pins LCSC blocked (`:73`), no hosts (`:75`) and the blocked-host rule biting (`:101`).
    - `TIER3_REFUSAL_SENTENCE` is pinned literally only through `b21-b-page.test.ts:52`.
    - Old: "OD-59/OD-124 (CI admission, `:1131-1139`)". Corrected: OD-59 is at `:301`, and `:1131-1139` is OD-124 only.
    - Add the pins `b22-b-no-generic-exec` (for `:148`) and `b22-b-exposure` case 5 (for `:1017`).
    - Add OD-146 (`:1673-1680`) and OD-159 (`:1872-1877`) to the list of binding owner decisions.
34. **§6.**
    - OD-161: B19 tests stay untouched except `CHAPTERS`.
    - OD-164: "counts 42/33/9/24 unchanged" becomes 47/36/9/27.
    - OD-173: "not two names" must keep `computation-engine` and the MCP reason order.
    - OD-174: 166/163/3/0 assumes OD-159 is not applied first (otherwise 167/164/3/0); keep census case 3 green.
    - OD-178: "Reword" becomes a dated in-place note, never a rewrite.
    - OD-180: name the B19 file, `:152` and workflow `:226`.
35. **§7.**
    - Conventions: the counts become 47/36/9/27, the start condition is met, and add the B22 gates.
    - B23-A1: `b23-a-ci-job-scope` becomes an in-place edit of `b19-e-ci-job-scope.test.ts:54`.
    - B23-A2: keep `computation-engine` and keep census case 3 green.
    - B23-B1: the new route's CSV row.
    - B23-B2: copy `evidence-store.ts`.
    - B23-D: the B01 CSV already holds `:72-73`.
    - Closeout: "reworded" becomes "superseded in place with a dated note".
36. **§8.**
    - Q10: narrowed by the unique indexes, still open (B22 tested only in memory).
    - Q11: answered (CONFIRMED and pinned by census case 5).
    - Q12: answered; recorded at `b22 unknowns-and-owner-decisions.md:21-24` and `EXECUTION_LEDGER.md:3830-3831`.
37. **Verifier disagreement, resolved.** The section 8 verifier said OD-137 has no heading in `OWNER_DECISIONS.md`. The section 0 verifier said the headings end at `:1935` (OD-137). The synthesizer's `git grep -n "OD-137" 849a933 -- artifacts/remaining-builder-program/OWNER_DECISIONS.md` finds `## OD-137` at `:1935`, so there is no residual.

Recorded limits (verifier problems that need no text change):
- The reader gap ids S1-G5, S3-G1, S3-G10, S6-G5 (D23-3), S3-G2, S4-G5, S1-G4 (D23-4), and S1-G6, S2-G4, S3-G3 (D23-5) cannot be checked against the repository.
- The provider facts in section 1.2 were not re-fetched (D23-1, D23-2, D23-16).
- The upload grep covered production `app`, `lib` and `scripts` only (D23-3).
- The unique indexes were read from `schema.ts`, not from the migration SQL (D23-4).
- Whether the agent-read-port's live observation (`agent-read-port.ts:122`) reaches durable storage was judged by grep (D23-5).
- Reader 3's claim that cross-verify and MCP egress show no disclosure has no file:line (D23-6).
- The INFERRED fitness judgements (D23-7, D23-11) and consequences (D23-9, D23-12) were not exercised.
- The "no id contains the words" check (D23-8) used the generated CSVs, and MCP-served titles were not checked.
- The import-gate extent (D23-11) was read from the gate entry sets.
- `listRouteFiles` coverage (D23-12) was not re-checked.
- The absence claims in D23-13, D23-14 and D23-21 rest on name-based `git grep`.
- CI admission (D23-15) was read from the workflow path lists; a local `pnpm test` would include the release-gate test.
- A same-revision, different-JSON board head (D23-17) stays INFERRED/UNKNOWN. [B23-B3, 2026-10-04] CONFIRMED by execution (b3-01-red; dfm-quote-flow.md section 19).
- The test counts 12 -> 13 (D23-20) come from OD-146's text.
- Nothing was executed anywhere.

### 9.6 The lead's decisions

- **All 90 text corrections of section 9.5 are applied in place** (the draft was never committed, so no superseded statement stands in
  the repository): every position, count and record reference in this page reads as at `849a933`, and the three statements the
  verifiers found wrong already at `0432fb8` (D23-5's `retrievedAt`, section 2.1's CD-12 caller and live-route citation, D23-18's other
  preset consumers) are corrected with them. The dated notes on D23-8, D23-19 and D23-20 are the re-verification's section-4 amendments.
- **The OD-137 disagreement** (9.5 item 37): the lead confirms `## OD-137` at `OWNER_DECISIONS.md:1935` (the lead wrote it in B22's
  closeout 2/2, `849a933`).
- **Numbering:** OD-160..OD-180 stay as drafted; OD-181..OD-189 are reserved for choices the increments make beyond them; LB-11 and LB-12
  stay as drafted; no renumbering.
- **The census target** (OD-174): 166/163/3/0 unless the owner applies OD-159 first; the increment that adds the route re-derives it.
- **Agent-tool counts:** 47/36/9/27 at `849a933` and unchanged by B23 (no agent tool).
- **OD-179's mirror:** `PROGRAM_STATE.json` `liveBlockers` gains LB-5, LB-11 and LB-12 in B23-A1; LB-4, LB-6, LB-7 and LB-8 stay
  unmirrored as before (a consistency choice recorded, not a runbook requirement).
- **Section 1.2** stays RECORDED (reader 7, 2026-10-01): no page was re-fetched; each increment that relies on a provider fact re-reads
  it before commit or keeps it UNKNOWN.
- **Every B23 page** keeps the B21 and B22 closeout tripwires green: no superseded phrase they scan for and neither chapter's dated
  note prefix (this page included; checked by running both suites on it before the commit).

---

## 10. Amendments recorded by the increments

- [B23-A1, 2026-10-02] B23-A1 landed the sibling provider registry (nine rows, the twelve runbook fields, per-operation tier, channel and state;
  `artifacts/ai-control-plane-b23/provider-registry.md`), admission (every transfer and order refuses `provider_not_admitted`),
  the CD-12 projection, the byte-gated CSV and CI admission of `b23-` (D23-1, D23-2, D23-18's mapping, D23-19, D23-20 closed;
  OD-161, OD-162, OD-179, OD-180 applied; OD-181 its choices). Every provider fact stays RECORDED from section 1.2 (2026-10-01) and
  was not re-read (OD-181 (a)). LB-11 and LB-12 are in `LIVE_BLOCKERS.md`, and `liveBlockers` mirrors LB-5, LB-11 and LB-12.
- [B23-A1 lead, 2026-10-02] Before A1's commit the lead also landed `4a988c8`: `b20-b4-process-gate` case 3 yields between probes. Run alone, the suite
  exited 1 from vitest's onTaskUpdate RPC timeout (64 s, every assertion green); every B23 gate chain runs it. `9cb675d` does the
  same for `b14-4-ast-import-gates` cases 1 and 16 (63.5 s, exit 1 in A1's chain).
- [B23-A2, 2026-10-02] B23-A2 landed the structural Tier 3 (external-transfer, refused by discovery too), the widened id floor TIER3_FLOOR_PATTERN (seven stems plus the word pay) beside the unchanged chat families, the external-* withdrawal, the chat-closure tripwire, the consumed-tool name floor (at the validator and in the agent port), the route vocabulary (externalTransfer, spend, outboundEgress, modelEgress) and the structural no-order check, and pinned the CD-12 stubs. D23-8, D23-9, D23-12 and D23-21 are closed; OD-173 and OD-174 applied; OD-182 records its choices; artifacts/ai-control-plane-b23/tier3-vocabulary.md, whose section 15 records the adversarial review round of twelve findings. No route, tool, UI or egress; census 165/162/3/0; counts 47/36/9/27.
- [B23-B1, 2026-10-04] B23-B1 landed revalidateReleaseAuthority, buildOutboundPackage, the provider exchange (preview and commit over a sealed in-memory plan), POST /api/pcb/provider-exchange (externalTransfer true, spend false, outboundEgress files, modelEgress false; census 166/163/3/0) and the provider panel. D23-6 and D23-7 are closed; OD-163, OD-164, OD-166 and the route half of OD-174 are applied; OD-183 records B1's choices; artifacts/ai-control-plane-b23/outbound-disclosure.md, whose section 13 records the review round of seventeen findings. No provider admitted, nothing sent; counts 47/36/9/27. Citations moved by the extraction (outbound-disclosure.md section 8; the release route is unchanged since f6b9390, so 849a933's lines equal da36d51's): release/route.ts :88-123 -> :157-192; :95-101 -> :164-170; :95-120 -> :164-189; :107 -> :176; :109 -> :178; :109-111 -> :178-180; :114-120 -> :183-189; :116-120 -> :185-189; :124 -> :94; :124-139 -> :94-109; :126-139 -> :96-109; :140-151 -> :110-121; :152-153 -> :122-123. These are cited at discovery :59, :294-297, :464, :474, :540, :546, :556-558, :647, :653, :819, :996, :1008-1009, :1154, :1167, :1246, :1249 (discovery :544 and :997 cite the runbook's :152-153, not the release route's, and do not move). ManufacturingWorkflowPanel.tsx :52, :71, :96, :106-112 are unchanged (the import is appended on :19). route-policy.ts :358 -> :360 and :375 -> :377 (discovery :584; tier3-vocabulary.md :162, C21, C22); route-resource-classification.ts :112 -> :114, :128 -> :130, :137 -> :139, :199 -> :201, :236 -> :238 (tier3-vocabulary.md :168, C23, C24, C33-C35).
- [B23-B2, 2026-10-04] B23-B2 landed the bounded upload (outboundUpload, an additive extension of the one egress boundary), the manufacturing-provider meter (agent share 0), provider-egress.ts (the reviewed transfer descriptor, none in B23; the only sending module, imported only by the exchange service) and the durable exchange record mfg.provider-exchange.v1 (exchange-ledger.ts), composed by POST /api/pcb/provider-exchange. D23-3 is closed, D23-4's exchange half and D23-5's receipt half are closed (D23-4's order-contract half stays B23-C's, OD-172; D23-5's staleness half B23-B3's, OD-168); OD-165 and OD-167 are applied; OD-184 records B2's choices; artifacts/ai-control-plane-b23/dfm-quote-flow.md, whose section 15 records the review round of twenty-two findings and section 16 the lead round's three. The route's closure now reaches the boundary, only through provider-egress.ts (derived observation-query beside the declared files); its durable-access row stays read while no transfer descriptor exists. No provider admitted, nothing sent; census 166/163/3/0; counts 47/36/9/27; no UI change. Section 8 item 10 is narrowed by the PGlite case, not closed.
- [B23-B3, 2026-10-04] B23-B3 landed the following, closing D23-17 and D23-5's staleness half (OD-168 and OD-169 applied; OD-185 records B3's choices): the external observation (provider-observation.ts): an acknowledged answer of mfg.provider-exchange.v1 as a closed manufacturing_observation with verdict none. Every provider string is screened by provider-text-screen.ts, a verbatim copy of A2's directive matcher; the receipt id is screened too; OD-168's staleness: fourteen closed reasons judged at every read; OD-169's providerSuggestion: shown, never applied, held by an import gate; the observation block on GET /api/pcb-sync, with the workflow panel's list. The page is artifacts/ai-control-plane-b23/dfm-quote-flow.md sections 17-28; section 28 records the review round of sixteen confirmed findings (thirteen distinct issues; first written fourteen). GET /api/pcb-sync's route composes the reader over B2's record (load only). The release and qualify routes' closures hold the observation modules through their board-store import: loaded, never called. No observation is current in production. No provider is admitted and nothing is sent; census 166/163/3/0; counts 47/36/9/27. The UI changed: browser suite for the lead. No B1 or B2 citation moved, and release-gate.ts is unchanged.
- [B23-C, 2026-10-04] B23-C landed ordering visibly disabled (orderingEnablement, with the stores' production default reading only the off switch from the process; the manufacturing.provider-order record appended on action-registry.ts:186; the provider panel's fixed notice on :129) and the full contract offline (the two-person, single-use purchase authorization with its exact approved-importer gate; the order contract against an injected fake port; pure webhook verification). An adversarial review CONFIRMED fifteen findings (fourteen distinct issues), and a lead round closed the check's two low findings and a third path it found; each was closed test-first (ordering-boundary.md section 8). D23-10 and D23-11 are closed, and D23-4's order-contract half; OD-170, OD-171 and OD-172 are applied; OD-186 records C's choices. No route, control, provider client or composition-root wiring; census 166/163/3/0; counts 47/36/9/27. The UI changed by one notice line: browser suite for the lead. Live ordering BLOCKED-LIVE-QUALIFICATION (LB-12).
- [B23-D, 2026-10-05] B23-D landed physical-hardware evidence, defined and never fabricated: physical-evidence.ts (eight closed kinds, validators, a server-derived review port nothing wires, and assembledProductEligibility, blocked for every input); the latent-claim-path tripwire; and the assembled-release block pinned by id, with both unblock conditions in the registry note (action-registry.ts:118), the gate's refusal (release-gate.ts:189) and the public error message (manufacturing-errors.ts:62). The B01 CSV row :47 moved once, by its generator. An adversarial review CONFIRMED sixteen findings (thirteen distinct issues), each closed test-first (physical-evidence.md section 9); independent checks' six low findings (three, two, then one) were closed test-first by two lead-fix rounds and a lead round (sections 9-10). D23-13, D23-14 and D23-15 are closed; OD-175, OD-176 and OD-177 are applied; OD-187 records D's choices. No route, control, tool, store or composition-root wiring; census 166/163/3/0; counts 47/36/9/27; one person-facing error string changed, no UI control; manufacturing-release-gate.test.ts (in no CI workflow) ran once, deliberately, on the final tree: 5 of 5 passed, exit 0, its refusal of assembled_pcb included (it asserts the code, not the message). No physical evidence exists: BLOCKED-LIVE-QUALIFICATION (LB-5).
- [B23 closeout, 2026-10-05] B23 closeout (1/2) superseded in place, with [superseded 2026-10-05 by the B23 closeout (<refs>): ...] notes and no line added, the provider claim of D23-16 (README.md:41, docs/pcb-quickstart.md:6 and :47; D23-16, OD-178) and the B23 statements a later B23 increment made untrue (provider-registry.ts:16, route-policy.ts:358, route-resource-classification.ts:107, admission-control.ts:19, provider-egress.ts:135, tier3-vocabulary.md:166 and two B23 suite comments: 11 notes in 10 files); retitled b23-a-provider-admission case 8 to what its body pins (assertions and its 11 it( blocks unchanged); recorded 34 export rows (29 from the verified sweep, B23-C's four modules and B23-D's physical-evidence.ts whole; none retired - providerRow is dead and waits for the next reviewed registry revision with the :16 sentence and the rows parameter, OD-188); its tripwire b23-closeout-statements pins the notes, the retitle, the export records and the claim vocabulary (closeout-statements.md). This file's line numbers below are as it reads once D23-16's closure clause is in (dfd51e3's numbers up to :655, one more from :656 on). Sections 1-3 and 5 of this page are, by their header (:28-36), a snapshot at 849a933, read as at that tree; the statements in them since made untrue are recorded here, each closed by its own increment's clause where one exists: section 2.1's "no webhook, upload, quote, order or receipt exists anywhere" (:203-204; since B23-B2 the bounded upload, the sending module provider-egress.ts and the durable exchange record mfg.provider-exchange.v1, since B23-B3 the external observation, since B23-C the order contract and webhook verification offline and unwired - no production path calls a provider, LB-11, LB-12) and "POST /api/pcb/release is the only production caller of releaseManufacturingPackage" (:205; since B23-B1 POST /api/pcb/provider-exchange also calls it at preview and commit, regenerating the ledgered release in memory and writing no ledger record); section 2.1's empty grep for webhook, x-signature, idempotency-key and UNKNOWN_PENDING (:270-271; the registry records each provider's webhook fact since B23-A1 with no receiver, Idempotency-Key and UNKNOWN_PENDING_RECONCILIATION are in the provider code since B23-B2, webhook-verification.ts exists offline since B23-C; x-signature has no production hit and no app/api path names order, quote, DFM, upload, webhook, purchase or checkout); section 2.2's revision-only currency (:305; since B23-B3 the flag compares revision and authoritative digest, D23-17); section 2.3's three meter key kinds (:332; since B23-B2 also manufacturing-provider, agent share 0, OD-165) and empty upload grep (:337-338; since B23-B2 outboundUpload's in-memory multipart encoding); section 2.5's quotes of the assembled-release note and gate message (:375, :377; replaced by B23-D, D23-15's clause); and section 5's "single ambiguous click" half with no pin (:701; B23-B1's separate preview and commit and B23-C's two-person single-use purchase authorization pin both halves), the eight B23-B steps with no pin (:705; pinned per step, dfm-quote-flow.md section 17), the ambiguous provider response with no pin (:709; b23-b-exchange-ledger for the exchange, b23-c-order-contract case 5 for the order), README.md:41 and quickstart :3-6 with no pin (:720; b23-closeout-statements since this commit), no upload pin (:724; b23-b-bounded-upload since B23-B2, D23-3) and the census 165/162/3/0 (:747; 166/163/3/0 since B23-B1, moved once by review, OD-174). No behaviour change; no verdict (commit 2/2).
- [B23 closeout (2/2), 2026-10-06] The closeout's second commit: the four validation artifacts (`changed-files.md`, `test-and-validation-report.md`, `unknowns-and-owner-decisions.md`, `final-verdict.md`), the README validation row, the ledger, `PROGRAM_STATE.json` and OD-160's heading; verdict PARTIAL - no provider admitted and no live exchange (LB-11), ordering visibly disabled with its contract tested offline only (LB-12), physical evidence defined and none exists (LB-5), no agent can release, transfer or spend.
  - **Section 4:** no code change and no new defect. All 21 defects are closed: D23-11 and D23-13 offline only, D23-4's order-contract half offline, D23-18 as the recorded mapping with its scope limit standing (`unknowns-and-owner-decisions.md`). D23-4's clause gives `b23-b-exchange-ledger` (22) and `b23-b-exchange-ledger-pglite` (4): since B23-B2's lead round they hold 28 and 5 cases (the final run's gate M). D23-9's clause cites `route-policy.ts:358` and `:375`, now `:360` and `:377` (the B1 line above). D23-19's code half and the lead's register rows and mirror landed in the same commit, `79fa18b`.
  - **Section 6:** OD-160 recorded in `OWNER_DECISIONS.md` as applied (no account assumed; B23-B4 not run); OD-161..OD-180 as applied in their increments; OD-181..OD-188 spent on the increments' stated choices; OD-189 unused. The owner's open questions at the close: OD-160, OD-171, OD-163 with OD-183 (g), OD-174, OD-173 (item 16), OD-181 (a) and (b), OD-184 (m), OD-177, OD-187 (i).
  - **Section 7, closeout:** commit 2/2 as the plan states it, with `unknowns-and-owner-decisions.md` covering OD-160..OD-188 rather than the plan's "OD-160..OD-180" (OD-181..OD-188 are the increments'); the final validation run at HEAD `b6c6b0d` green in every vitest gate, tsc, the 21 generators and both browser configs, with eslint 0 on the 92 files B23 changed (the chain's whole-project step on a clean tree exits 1 on 33 errors in 14 files, 69 problems in 37 files, none changed by B23), and gates S and S2 green (every suite that directly reads a B23-changed file ran but the Java-capable `manufacturing-release-gate.test.ts`); PR #14 to be undrafted and merged normally after green CI; continue to B24.
  - **Section 8:** 1-8 stand (no account; every provider's unread facts stay UNKNOWN, not re-read in B23, OD-181 (a)); 9 unchanged (B23-C's webhook contract is Sirkit's own, OD-186 (j)); 10 narrowed by the PGlite case, a production server's isolation level UNKNOWN; 11 and 12 answered by B22 (B23 spent OD-160..OD-188); 13 confirmed - the 15 commits to `b6c6b0d` carry the runbook identity and no AI trailer, and this commit is made the same way; 14 answered by OD-177's one record naming both conditions, which chapter supplies the assembly-data authority still UNKNOWN; 15-17 unchanged; 18 the open questions above; 19 unchanged under LB-11, LB-12 and LB-5. Other UNKNOWNs the pages record are listed in `unknowns-and-owner-decisions.md` - among them the answer licence for every provider (`terms.answerLicense`), unit-scope coverage (OD-187 (i)), operator resolution (B24-E's port) and the INFERRED limits of each "What stays open" section.
  - **LB-11:** its check cell's runbook range `:973-984` is noted in its row: B23-B is `:971-982` (steps `:975-982`); `:984` is B23-C's heading.
