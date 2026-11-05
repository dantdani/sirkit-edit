# M2 — acquisition to library to replacement: verified chain and design

Section M.3, M.4 and M.5 items 4-7 of `artifacts/astra-guided-pcb/PROMPT_TO_PCB_RELIABILITY_AND_SIMPLE_UI.md` (lines 759-806), completing
K.5 (lines 455-481). Written 2026-10-18 against `codex/astra-foundation` at `2e938241`. This is a DESIGN: nothing here is implemented, and
no line of product code changed. Each claim about the current tree cites `file:line`. Everything said about an external source comes from
official pages read on 2026-10-18 (listed in section 8). When a page could not be read, the fact is recorded as UNKNOWN.

## 0. What is true today (summary)

1. **No admitted source delivers CAD bytes at runtime.** The registry has four sources (`app/lib/acquisition/source-registry.ts:26`),
   and every one of them is a distributor whose only authority class is `sourcing_observation` (`:47`, enforced at `:647`). The registry
   says outright that sourcing can never prove a symbol, footprint, pin mapping or package (`:49-56`).
2. **The one real CAD source in the product is the official KiCad library at reviewed pinned commits** (`app/lib/kicad/pinned-checkout.ts:14-25`).
   The operator scripts clone it into `data/` (gitignored, 0 tracked files). The server reads it by `library:name` reference
   (`app/lib/atomic/authoring.ts:6-10`, `:73-92`). It is never fetched at runtime.
3. **Bytes acquired but not yet published have no durable home.** `quarantineText` returns an in-memory object (`app/lib/atomic/ingestion.ts:69-98`).
   The `SourceAdapter` / `collectAdapterPages` helpers (`:135-207`) have no production caller. `atomic_raw_objects` rows are written only
   inside the two-person publication transaction (`app/lib/atomic/server-repository.ts:320-330`). The atomic tables have no tenant column,
   so they form a single global catalog (`app/lib/db/schema.ts:521-716`).
4. **Publication takes references, not bytes.** The spec names a symbol and footprint only as `{library, name}` in the bundled library
   (`app/lib/atomic/publication-review-contract.ts:31-40`). Asset bytes, facts and evidence are forbidden body keys (`:21`). The hook for
   extra engineering sources, `registeredCandidates`, is documented as "none in production today" (`app/lib/atomic/publication-review.ts:219`),
   and the route does not compose it (`app/api/components/atomic/publication/route.ts:36-48`).
5. **M1 sees an eligible revision only through a catalog `parts` row plus a `parts_atomic_links` value-key link.** See
   `app/lib/component-resolution/resolution-assembler.ts:46` and `app/lib/db/schema.ts:441-458`. Only the operator ingest writes `parts`
   rows (`scripts/ingest-kicad.ts:241`).
6. **The external tools need a PCB.** `context.ts:494`, `loop.ts:243` and `acquisition-reads.ts:449` all require canonical (board)
   state. Search before a board exists is therefore blocked, as M.0 observed.
7. **The common D1/D2 case is a missing publication, not missing bytes.** The 1N4148 symbol and DO-35 footprint are already in the
   bundled pinned library. What is missing is a published exact revision. Acquiring from a network source is only needed for parts outside
   the pinned library, for a newer reviewed commit, or for 3D models.

## 1. The chain link by link: what exists and what is missing

| link | exists today | missing for M2 |
|---|---|---|
| Source registry | Versioned, CSV-gated, docs-checked (`source-registry.ts:1-21`, `:183-530`). DigiKey and Nexar are enabled (`:281`, `:449`). Mouser is disabled under OD-32 (`:353-357`). LCSC is blocked (`:524-528`). | No CAD or library source class. The `authorityClass` union is only `sourcing_observation` (`:47`), so a CAD source cannot go in this registry without breaking its invariant (`:647`). |
| Admission | `admitSource`: blocked/disabled/operator-off/credentials, secrets by env name (`:568-587`). Meters with quota, breaker and agent share, but process-local (`admission-control.ts:26-28`, `:257-264`). | No `AdmissionKey` kind for a CAD source. The union is a reviewed, append-only list (`admission-control.ts:48-50`). |
| Human external search | Exact or keyword search, ≤5 hits, memo kept in-process only and scoped by tenant/project (`external-search.ts:1-21`, `:154-158`). The agent is limited to exact MPN (`:244-245`). | Returns observations only: price, stock, datasheet link. No bytes. |
| Agent read port | `searchExactMpnsForAgent` / `readEvidenceForAgent`. Writes nothing (`agent-read-port.ts:15-16`). Null in the fixture runtime or without a DB (`:268-271`). Values are disclosed only where `agentDisclosure === "permitted"` (`:73-77`), and every source is "unknown" under OD-36 (`source-registry.ts:267`, `:340`, `:436`). | Read-only. Board-gated (above). |
| Quarantine | Observation → candidate → evidence bundle. `rawRetained: false` (`quarantine.ts:76-78`). `candidateFromExtraction` classifies document/CAD facts (`:230-256`): `official_kicad_library`, `manufacturer_*` and `organization_authored` can be engineering candidates (`:43-50`), while `third_party_cad` is quarantined (`:172-176`). The bundle's `proven` is always false (`:365-369`). | Never fed acquired CAD bytes. |
| Import review | Profile needs, `reviewEvidenceDigest` (`import-review.ts:22-25`, `:138-153`). | — (reusable as is) |
| Bounded transport | `outboundFetch`: HTTPS only, exact-host allowlist, resolved-address policy, one deadline, bounded body, no implicit redirects, closed redacted errors (`outbound-fetch.ts:10-22`, `:229-334`). The surfaced headers include `retry-after` (`:148`). Rebinding window is a stated limit (`:13-16`). | — (reusable as is) |
| Distributor egress | One policy per source from the registry. JSON only (`distributors/egress.ts:30-41`). The `DistributorSource` union is closed (`:14`). | A CAD egress module (bytes, a content type per asset kind, a ceiling per kind). |
| Atomic ingestion | Text media allowlist. PDFs, SVG, HTML and archives are refused (`ingestion.ts:58-67`). Licence gate on `publish` (`:100-112`). Retries clamped to 2-5 (`:177`). `makeSourceRecord` / `makeEvidence` (`:216-259`). `validateFetchChain` admits subdomains (`security.ts:179`), unlike `outboundFetch`'s exact hosts. | No persistence, no production adapter. |
| KiCad parsers | `parseSymbolAssets` / `parseFootprintAsset` (`kicad-assets.ts:60`, `:184`). Linear preflight (`security.ts:31-73`), `INGEST_LIMITS` (`:5-21`), model path policy (`:122-150`). Embedded files and fonts are refused (`kicad-assets.ts:73-75`, `:229-230`). Covered by the hostile suites `app/lib/atomic/__tests__/b19-d-kicad-hostile.test.ts` and `app/lib/kicad/__tests__/b19-d-sexp-hostile.test.ts`. | In-process, no sandbox (see 2.5). |
| 3D | `createModelAsset` records hash and metadata only; the `inspected` boolean becomes `safe` (`kicad-assets.ts:286-310`). The viewer draws placeholders (`app/lib/pcb/3d/geom/footprint-mesh.ts:2`). | All of K.6 (out of M2's core, optional per M.3). |
| Authoring / publication | Two-person, human-only, governance scope, CAS, digest re-check at approve and at publish (`publication-review.ts:6-21`, `:237-251`, `:609-611`, `:689-692`). Pin mapping comes from the person's terminal table (`authoring.ts:378-405`). | Accepts only bundled references. `registeredCandidates` is not composed. |
| Publication transaction | Re-hashes blobs and re-parses assets against their bytes (`server-repository.ts:91-103`, `:164-174`). Refuses confidential blobs (`:173`). Two people (`:71-84`). Links are never repointed (`:407-421`). | Writes no `parts` discovery row. |
| Durable schema | `atomic_licenses` / `sources` / `source_records` / `raw_objects` / `evidence` / `cad_assets` / `mapping_certificates` / `part_revisions` / `revision_status_events` (`schema.ts:564-716`). Durable workflow heads and records are scoped by tenant/project/branch (`:1265-1294`). | No tenant-scoped store for unpublished candidates. No deletable blob store (durable workflow history is append-only). |
| Catalog discovery | `parts` / `libraries` (`schema.ts:173-182`, `:185`). The lexical recall over name/MPN/keywords needs no embedding (`app/lib/parts-search.ts:365-375`). | No path that creates a `parts` row for a newly published exact part. |
| Build Library UI | Distributor search shows hits as observations with no Place control. "Request evidence review" and "Use published exact revision" exist (`BuildLibraryPanel.tsx:10-18`). The review panel takes bundled references (`AtomicPublicationReviewPanel.tsx:6-13`). | Acquired provenance and the validation report are not shown. No inbox. |
| Missing-parts work items | Checklist and four next actions in F's order (`app/lib/parts/missing-facts.ts:20-28`; `MissingPartsList.tsx:3-19`). The agent's `sirkit.parts.draft-request` seals an UNVERIFIED request that a human files (`app/lib/agent/draft-request-proposals.ts:1-14`). | No "obtain assets" action. |
| M1 resolution | Board-less instance inspection and requirement search, with every candidate in one bucket (`candidate-search.ts:1-23`, `:34`). Sealed batch, human apply through `schematic.resolve-components` (`approved-resolution-mutations.ts:15`). Blocked items go to the missing-facts and draft-request work items (`resolution-assembler.ts:44`). | Consumes only published, linked revisions (correctly). |
| Persistent task (L) | Durable task store with fenced slices (`app/lib/generation-task/store.ts:1-27`). States include `waiting-for-resource` and `awaiting-review` (`vocabulary.ts:19`). The `S6-missing-part` strategy and the `missing_part` / `missing_evidence` blockers exist (`:37`, `:42`). | No acquisition or resolution task type. |

## 2. Direct answers

### 2.1 Which sources deliver bytes, and which only observations

| source | status | delivers | never delivers |
|---|---|---|---|
| DigiKey V4 | enabled (OD-33) | price breaks, stock, MOQ, lifecycle, manufacturer, description, datasheet **link**, product link, packaging (`source-registry.ts:223`) | any CAD bytes or datasheet bytes; terms: "No building or updating a database" (`:271-276`) |
| Nexar (Octopart) | enabled (OD-33) | the same kinds of observations (`:395`) | bytes; "No self-hosting datasheets or images" (`:441-444`) |
| Mouser | disabled (OD-32) | — | storage prohibited (`:344-348`) |
| LCSC | blocked | — | — (`:524-528`) |
| Bundled pinned KiCad library | operator checkout, read by reference | symbol and footprint **text** at pinned commits (`authoring.ts:73-92`, `pinned-checkout.ts:14-25`) | datasheets, 3D models (only `kicad-symbols` and `kicad-footprints` are under `data/`) |

So no runtime source returns CAD, datasheet or 3D bytes today. The only symbol and footprint bytes in the product are local operator data.

### 2.2 Adapters and their licence and retention rules

Distributor connectors exist (`app/lib/distributors/{digikey,mouser,octopart,lcsc}.ts`), each bound to its registry row:

| source | retention |
|---|---|
| DigiKey | bounded to 1 h, conservative (`source-registry.ts:260-266`) |
| Nexar | bounded to 24 h, documented (`:429-433`) |
| Mouser | none, no storage (`:332-336`) |
| LCSC | none, no storage (`:505-511`) |

For all four, `repositoryCommit: "prohibited"`, and raw and derived redistribution are prohibited. The KiCad licence is recorded once, as `KICAD_LIBRARY_LICENSE`, redistributable on all three dispositions (`authoring.ts:35-42`). That record carries no `sourceUrl` or `attribution` field.

No CAD source adapter exists. `SourceAdapter` (`ingestion.ts:135-140`) is an interface without an implementation.

### 2.3 Real online CAD sources: is one admitted, and under which terms?

None is admitted. Each candidate needs a NEW reviewed adapter:

| source | what the official pages say (read 2026-10-18) | M2 verdict |
|---|---|---|
| **KiCad official libraries** (gitlab.com `kicad/libraries/kicad-symbols`, `kicad-footprints`) | Licensed CC-BY-SA 4.0 with an exception: designs that use the data need not adopt the licence, and the libraries may be used "without restriction" in commercial and closed projects. Redistributing the libraries or parts of them, modified or not, must keep the same licence and keep attribution and licence documents. No warranty. The repository page links `LICENSE.md` (CC-BY-SA 4.0). | **Admissible**, as `official_kicad_library`, which is already an engineering-authority class (`app/lib/atomic/validation.ts:47-54`). Attribution and licence must travel with each served asset (OD-M2-4). |
| **GitLab REST transport** for the above | `GET /projects/:id/repository/files/:file_path/raw` with an optional `ref` (a branch, tag or commit). The JSON variant carries `blob_id`, `content_sha256` and `last_commit_id`, and the page recommends the raw endpoint for exact bytes. A public repository is readable without authentication; this is stated for the JSON endpoint and not explicitly for raw. GitLab.com limits: raw endpoint 300/min per project, commit or path; unauthenticated raw 800/min per project; repository files API 500/min per IP and path; unauthenticated API 500/min per IP. A 429 carries `Retry-After` and `RateLimit-*`. Governing documents: the Subscription Agreement (which covers the Free tier), the Acceptable Use Policy and the API Terms of Use. | Transport is suitable at a pinned `ref=<commit>`. **Terms text is UNKNOWN**: both handbook pages rendered only navigation (OD-M2-3). |
| **SnapEDA / SnapMagic** | FAQ: files are CC-BY-SA 4.0 with a "Design Exception 1.0", and public sharing needs attribution. The site may not be used "for the purpose of sharing the content on the Internet or within an EDA tool". The API is available by contacting them; no terms are published. `/api/` returned 404. | **Not admissible** without negotiated written API terms (OD-M2-10). It would be `third_party_cad` in any case, which can never establish engineering facts (`validation.ts:47-54`, `quarantine.ts:172-176`). |
| **Ultra Librarian via a manufacturer** (Toshiba's consent page as the example) | Data may be used only for design with the vendor's product. No copying, altering, transfer, or incorporation into products. Downloads run on ultralibrarian.com (EMA Design Automation) under that site's own terms. Ultra Librarian's own terms URL returned 404 (UNKNOWN). | **Blocked**: storing the data in a shared, reusable library contradicts "no transfer / no copy". |
| **Distributor datasheet links** | Registry terms, above. | Show as a link only. Fetching and storing a datasheet from a distributor is prohibited. A manufacturer domain needs its own reviewed row (OD-M2-9). |

### 2.4 How retrieved bytes are stored durably today

They are not. A distributor's raw response is hashed and discarded (`quarantine.ts:76-78`). A quarantined text object lives only in memory (`ingestion.ts:69-98`). The only durable raw content is what a publication writes into the tenant-less `atomic_raw_objects` (`server-repository.ts:320-330`), and the bundled library files themselves.

### 2.5 Where parsing runs

In-process in the Next.js server, in three places:

- authoring (`authoring.ts:245`, `:262`);
- the publication validator (`server-repository.ts:96-98`);
- the seeds and fixtures.

The protection is a linear preflight with depth, token and byte bounds (`security.ts:31-73`), count budgets (`kicad-assets.ts:92-106`, `:191-194`) and refusal of embedded payloads. Nothing is sandboxed.

The bounded engine host can stop a closed engine by time and heap, but it says plainly that it is "NOT a sandbox" (`app/lib/computation/engine-host.ts:17-20`). Its worker imports only `worker_threads` (`engine-worker.mjs:6`), so it cannot run the TypeScript KiCad parsers without a build step.

### 2.6 From a validated candidate to an eligible revision

The steps today:

1. **Request.** A human editor, reviewer or admin requests publication (`publication-review.ts:66`, `:457-494`). This happens only in the governance scope: `SIRKIT_ATOMIC_CATALOG_TENANT_ID` and `SIRKIT_ATOMIC_CATALOG_PROJECT_ID` (OD-37), on the default branch (`:55-57`, `:237-241`). If either is unset, every operation is refused.
2. **Evidence.** The server assembles the evidence itself (`:309-317`).
3. **Approval.** A human reviewer or admin approves against an unchanged digest. Every conflict must be resolved and every quarantined fact dispositioned (`:586-658`).
4. **Publication.** A **different** human `project_admin` publishes (`:689`). The transaction re-verifies everything and writes the revision, assets, links and audit row (`server-repository.ts:227-449`).
5. **Who may act.** AI actors are refused at every step (`publication-review.ts:244-251`; `server-repository.ts:78-80`). The agent may not even file a request (OD-244, `draft-request-proposals.ts:10`).

The minimum is two humans in the governance project. The requester may also be the approver; the publisher must be someone else. The revision becomes eligible when it is published, never withdrawn (`server-catalog.ts:156-171`), and linked to a catalog part's value key.

### 2.7 How M1 consumes an eligible revision

Candidate recall uses the catalog search port. Every hit is re-read through the catalog part detail and its value-key link to the exact revision, then through `loadSelectablePortableSnapshot` and the revision status (`candidate-search.ts:1-23`; `evidence.ts:1-17`). A hit is `eligible` only when it is published and selectable, has symbol, footprint and an approved mapping, and passes `evaluateCompatibility`.

The resolution item names `{componentId, candidatePartId, atomicPartRevisionId}`. The asserted revision must equal the link (`resolution-assembler.ts:46`).

**So an acquired part reaches M1 only if publication links it to a `parts` row** — the instance's own row, or a new discovery row (see M2.5).

## 3. Constraints the design must keep green

- **The publication path stays away from vendor code.** `b19-e-publication-boundaries.test.ts:26-38` (`VENDOR_REACH`) forbids authoring, publication-review, the route and the panel from reaching `net/outbound-fetch`, distributor code or live search. Acquired bytes must reach publication **from storage, through a port**, never through egress. New egress modules are *added* to `VENDOR_REACH`. That makes the ratchet stricter, and each move gets a `[PR-M, 2026-10-18]` note.
- **The chat route keeps a single boundary per capability.** The chat import-closure ratchet allows exactly one boundary file each (`app/api/chat/external-acquisition-runtime.ts:1-11`). The new capability gets its own single runtime file under the same pin.
- Registry rules: the two-way `agentDisclosure` rule, the "unknown authority class" check, and the byte-gated CSV (`source-registry.ts:19-20`, `:647-651`). A CAD registry is a **separate** reviewed file with its own CSV gate.
- AI never files, approves or publishes. Licence-blocked publish stays blocked (`ingestion.ts:104`). Confidential blobs are never published (`server-repository.ts:173`).
- Agent exposure, MCP withholding, tool-registry amendments and the no-purchase tripwire are reviewed lists, updated with dated notes (`agent-exposure.ts:69`; `tool-registry.ts:538`).
- No paid calls. No arbitrary-URL fetcher (K.8.7): every host is an exact registry host, every path comes from a registry template, and redirects are refused.

## 4. Increments (file by file)

### M2.1 — An acquisition capability scoped to the schematic, before any PCB exists (M.0's acquisition note)

- **New: `app/lib/acquisition/cad-acquisition-contract.ts`** (browser-safe). Contents:
  - request `{componentIds[], requirement: {exactMpn?, manufacturer?, packageCode?, mounting?}, assetKinds: ("symbol"|"footprint"|"datasheet"|"model")[]}`;
  - task view, the closed blocker codes (2.x below), and public progress event kinds (K.2).
- **New: `app/lib/agent/cad-acquisition-reads.ts`**, with two tools:
  - `sirkit.parts.acquisition-start` starts or attaches a durable task. It mutates no design and is idempotent on (scope, principal, instance ids, requirement digest).
  - `sirkit.parts.acquisition-status` is a Tier 0 read.

  Gate: the M1 Tier 0 pattern — integrity check, a **verified schematic snapshot with digest and canonical head mark** (not `canonical-state`), fresh discovery, role and capability check, a closed input, and authority-shaped keys refused by name.
- **Changed: `app/lib/agent/context.ts`.** New server fact `cadAcquisitionAvailable` = a bound port AND a verified schematic. It is independent of `canonicalState`. Line 494 stays board-gated, so `external-search` and `evidence-read` keep their contract.
- **Changed: `app/lib/agent/loop.ts` and `gateway.ts`.** Resource kinds and fact validation follow the `:174-175` pattern.
- **New: `app/api/chat/cad-acquisition-runtime.ts`**, the one boundary.
- **New: `app/api/parts/acquisitions/{route,handler}.ts`** for page parity: start/attach, GET status and events, cancel, resume, handoff. Canonical wrappers, CSRF and body bounds, with route coverage registered (`app/lib/auth/route-coverage.ts`).
- **Changed: tool catalog.** `tool-catalog.ts` gets two descriptors; `agent-exposure.ts` and `mcp-exposure-review.ts` (withheld from MCP) and `tool-manual.ts` get handler codes. The coverage CSV and the manuals are regenerated.
- **Changed: missing-parts actions.** `app/lib/parts/missing-facts.ts` gains the next action `acquire_assets`, inserted after "Search catalog". It is `not_available` with a reason when no CAD source is admitted or there is no exact identity. `MissingPartsList.tsx` gets the matching button and live state.
- **Test:** `m2-1-schematic-acquisition-discovery.test.ts`. A valid schematic with no PCB and two unresolved instances: both tools are discovered and callable. Board tools, and the board-gated external tools, stay withheld. A fake board or browser-supplied authority is refused.

### M2.2 — A fixture CAD source through the same bounded transport

- **New: `app/lib/acquisition/cad-source-registry.ts`**, a reviewed and versioned registry, separate from the distributor one.
  - Each row: `id`, `sourceClass`, exact `hosts`, `operations` (GET path templates only), auth by env **name**, and per asset kind: accepted media types and a byte ceiling (symbol/footprint 1 MiB, datasheet text 256 KiB; PDF, archives and 3D are refused in M2).
  - Each row also carries: `deadlineMs`; `maxRedirects: 0`; a retry policy that honours the real `Retry-After` and checkpoints long waits (K.3.4); a quota and breaker; a licence record; a retention class (only `indefinite` is storable in M2); `agentDisclosure`; pinned refs (from `KICAD_LIBRARY_PINS`); docs URLs with `checkedOn`; status; and the owner decision.
  - Rows:
    - `kicad-bundled` — enabled, reads the local pinned checkout through `bundledKicadLibrary`, makes zero network calls.
    - `kicad-gitlab` — **blocked** until OD-M2-3..6.
    - `fixture-kicad` — status `fixture`, host `cad-fixture.sirkit.test`, admitted only in the fixture runtime or under an injected test registry. Production refuses it.
  - It has its own `validate*` function and CSV, `artifacts/product-reliability-simple-ui/component-resolution/cad-source-registry.csv`, gated byte for byte.
- **New: `app/lib/acquisition/cad-egress.ts`.** `fetchCadAsset(sourceId, {kind, path, ref}, deps)` runs, in order:
  1. `admitCadSource`;
  2. a meter `{kind: "cad-source"}`, appended to `admission-control.ts` the way B23 and B24 appended theirs (no cited line moves), with the agent share per OD-40;
  3. `outboundFetch` under the row's policy (exact hosts, deadline, a ceiling per kind, no redirects, content types per kind);
  4. the result `{bytes, sha256, retrievedAt, contentType, retryAfter}` or a closed code.

  This module and the adapters are added to `VENDOR_REACH`.
- **New: `app/lib/acquisition/cad-adapters/{bundled,fixture,gitlab}.ts`.** Each maps a target to locators — KiCad `library:name` from the instance's catalog part and its footprint hint or `ki_fp_filters` — and fetches through `cad-egress` (bundled: a file read, no egress).
- **New: `app/lib/fixture-runtime/cad-source/`.** If the concurrent, uncommitted `app/lib/fixture-runtime/blinker/kicad/D.kicad_sym` and `D_SOD-123.kicad_mod` (seen in the working tree on 2026-10-18) land, reuse those bytes instead of copying them again. The fixture runtime's transport (an injected `OutboundDeps.fetch` and resolver) serves REAL fixture bytes:
  - `D.kicad_sym` and `D_SOD-123.kicad_mod`, the official KiCad files already copied verbatim for M1 (`app/lib/component-resolution/__tests__/fixtures/kicad/`, provenance at `_m1-fixtures.ts:7`), under CC-BY-SA with the exception;
  - a new ORIGINAL, MIT-licensed `D-fixture-pin-table.txt`, a small datasheet text in one closed pin-table format, labelled fixture, never presented as a manufacturer document.
- **Tests:**
  - `m2-2-cad-egress.test.ts` covers: exact host, `address_blocked`, redirect refused, `response_too_large`, wrong content type, timeout, a 429 with `Retry-After` turning into a scheduled wait and not a hot retry, and SHA-256 equal to the fixture file.
  - `m2-2-cad-source-registry.test.ts` covers: validation, the CSV gate, production refusal of `fixture-kicad`, `kicad-gitlab` refused whatever the environment, and no secret shapes.

### M2.3 — Retrieve → hash → store raw bytes → parse and validate → durable library candidate

- **New: `app/lib/acquisition/cad-object-store.ts`.** It is built over the injected `DurableWorkflowRepository`, as `generation-task/store.ts` does.
  - Aggregate `atomic.acquired-object.v1`, keyed by SHA-256, scoped to (tenant, project, branch).
  - Payload: bytes (UTF-8 text) and a `SourceRecord` from `makeSourceRecord` (`ingestion.ts:216-239`) holding source id, registry version, origin+path URL (no query), ref/commit, `retrievedAt` and the licence record.
  - Every read re-hashes the content.
  - Content is deduplicated by bytes within the scope, and versioned by source identity in the record.
  - **Content whose retention is not `indefinite` is refused.** Durable workflow history is append-only, so it cannot honour a deletion. Datasheet PDFs and 3D need a deletable blob table: migration 0032 (OD-M2-7).
- **New: `app/lib/acquisition/datasheet-pin-table.ts`.** A deterministic parser for ONE closed text format, emitting `candidateFromExtraction` facts (`manufacturer_datasheet`, `deterministic_inference`, with locators). There is no PDF, OCR or LLM extraction. A PDF datasheet is stored only once OD-M2-7 lands, as private review evidence, and its terminal table stays a person-confirmed fact.
- **New: `app/lib/acquisition/cad-validation.ts`** (pure). Given the parsed `SymbolAssetVersion`, the `FootprintAssetVersion` (whose `validationState` must be `valid` or `valid_with_limitations`), the terminal table and the target identity, it checks:
  - pin numbers against electrical pad numbers, with stacked and hidden pins handled;
  - names and functions against the table;
  - package code and mounting against the footprint;
  - that pin 1 or pad 1 exists;
  - any electrical pad the table does not name: exposed or thermal pad → `unresolved`;
  - limitations and model-path issues;
  - a dry-run `buildMappingCertificate` state in a scratch catalog (`mapping.ts:191-194`), kept as **report data, never a certificate**.

  Verdict: `validated`, `conflicting` or `unsupported`, with a digest.
- **New: `app/lib/component-resolution/acquisition/candidate.ts`.** Aggregate `atomic.acquisition-candidate.v1`, CAS-guarded with idempotency keys. It holds:
  - target identity, instance ids and the schematic base digest;
  - source attempts with their outcomes;
  - objects (kind, hash, source record);
  - parsed assets (version id, semantic hash, state, diagnostic codes);
  - the report and its digest;
  - licence and attribution;
  - its state: `retrieved → parsed → validated|conflicting|unsupported → handed-off → in-review → published|rejected|withdrawn`.
- **New: the task, `app/lib/component-resolution/task/{contracts,store,slices}.ts`.** Aggregate `component-resolution.task.v1` on the same repository and outbox, with topic `component-resolution-slice`. The existing worker (`app/lib/generation-task/worker/worker.ts`, `pnpm worker:generation`) registers this second topic. The claim, fence, renew and release helpers are extracted unchanged into `app/lib/durable-workflow/fenced-slices.ts`, with pin moves noted.
  - States reuse `GENERATION_TASK_STATES` (`vocabulary.ts:19`).
  - Stages, each with its own evidence (M.4): local search → source selection → retrieve → validate → handoff → awaiting review → proposal → awaiting apply → applied → preflight.
  - Blockers: `source_credentials`, `source_terms`, `source_unavailable`, `no_matching_asset`, `mapping_conflict`, `licence_forbids_retention`, `review_rejected`, `authority_revoked` and `stale_base`. Each one keeps completed work and names its remedy; `draft_offered` points to `sirkit.parts.draft-request`.
  - Progress events go through the existing typed run events (K.2 wording).
- **Parsing.** M2 parses in-process with the same parsers and bounds the bundled library and the publication validator already use, plus the per-source 1 MiB ceiling. Both hostile corpora run through the pipeline. **Before any live adapter is enabled**, parsing moves into a new closed engine, `sirkit.engine.kicad-asset-parse/1`, in the engine host. That needs a plain-JS bundle of the parser (OD-M2-12).
- **Tests:**
  - `m2-3-acquisition-pipeline-pglite.test.ts`: no eligible local candidate → fixture source → objects read back and re-hashed → assets valid → report validated (pins 1/2 ↔ pads 1/2, K/A from the table) → candidate `validated`.
  - `m2-3-cad-validation.test.ts`: wrong package; conflicting table; the pin-swapped `D_AK` fixture; an unnamed electrical pad; unsupported geometry.
  - `m2-3-object-store.test.ts`: dedupe; re-hash mismatch; a foreign scope gives the same refusal as an unknown id; retention refusal.

### M2.4 — Review and publication handoff as an actionable package (never auto-publish)

- **Changed: `publication-review-contract.ts:31-40`.** `symbol` and `footprint` gain a closed alternative, `{acquired: {handoffId, objectHash, name}}`. The forbidden body keys (`:21`) are unchanged: still no bytes in a body.
- **Changed: `authoring.ts:57-63`, `:235-271`.** `BundledKicadLibrary` becomes a `KicadAssetSource` port that returns text plus provenance (source identity, licence, revision, locator).
  - The bundled implementation keeps **byte-identical** ids (`kicad-symbols@bundled`, its locators), so seeded rows still deduplicate.
  - The acquired implementation reads the handoff's stored objects through a store port that imports no egress.
  - When an acquired datasheet `pin_mapping` fact equals the spec's terminal table, that fact's evidence id joins the terminal evidence of the mapping certificate (`:380`).
- **Changed: `publication-review.ts:219`, `:312`, and the route `:36-48`.** Compose `registeredCandidates` from the handoff's extraction facts and the layered asset source. The review digest then pins the acquired facts.
- **New: `app/lib/component-resolution/acquisition/handoff.ts`.** Aggregate `atomic.acquisition-handoff.v1`, an **inbox in the governance scope**.
  - It is created only by a **human** member action in the source project ("Send for component review"). The agent prepares the package but is refused at this step (OD-244 extended).
  - It copies only objects whose raw, derived and export dispositions are all `redistributable` and whose retention is indefinite. That is stricter than `validation.ts:207-209`, which admits `private_review_only` into the global catalog.
  - It carries no project id or design context: only the requester principal and an opaque callback digest.
  - Cross-tenant handoff is refused (OD-M2-8).
- **The package**, ready for a person to act on:
  - a prefilled `AtomicPublicationSpec`;
  - the validation report;
  - each asset's source, commit, URL path, hash, licence and attribution;
  - open conflicts and missing facts;
  - proposed links (the instance's `parts` row when `reviewLinks` would pass, `publication-review.ts:282-305`);
  - the requirement and instance summary.
- **UI.** `AtomicPublicationReviewPanel.tsx` shows acquired provenance and the report next to each fact. A governance "Inbox" section in `BuildLibraryPanel.tsx` opens a handoff as a prefilled request. The human submits, a reviewer approves, and a different admin publishes. Approve blockers are unchanged.
- **Tests:**
  - `m2-4-handoff-publication-pglite.test.ts`: submit with acquired references, approve against the digest, a different admin publishes through `publishPortableAtomicSnapshot`, and the link is written.
  - `m2-4-handoff-boundaries.test.ts`: an AI actor refused at handoff, submit, resolve and publish; private or unknown licence refused; the approver cannot publish; a changed digest refused; `VENDOR_REACH` clean for every publication module and the new store port.

### M2.5 — Eligible revision → M1 resolution proposal → apply → preflight

- **The instance's own part.** When its own `parts` row passes the link rule (MPN null or equal; same `library:name`), the publication links that row's value key. M1's own-part path finds the revision with no new recall.
- **Otherwise, a new discovery row.** A reviewed, additive option on `publishPortableAtomicSnapshot` (`server-repository.ts:227`) writes ONE `parts` row and its link in the same transaction and audit row.
  - The row goes in library `Sirkit_Acquired` (`libraries.name` is unique, `schema.ts:176`).
  - Its MPN, manufacturer, pins and `symbolRaw` come from the published symbol; `embedding` is null (no paid call).
  - It is recalled through the lexical path (`parts-search.ts:365-375`).
- **Resuming after review.** While `awaiting-review`, the task re-checks on Resume or on a scheduled slice with backoff (`availableAt`). The re-check re-runs M1's candidate search, so no read across scopes is needed. Once `eligible`:
  1. seal the M1 batch proposal (`assembleResolutionProposal`);
  2. show the same review dialog in page and chat;
  3. a human applies through `schematic.resolve-components`;
  4. receive the receipt and the new revision;
  5. run the electrical/netlist check and the current preflight through `PcbSyncPreflightReadService` (`app/lib/agent/pcb-sync-preflight-reads.ts:61`).

  Currency is checked at every boundary (M.4): base, head, candidate digest, membership.
- **Test:** `m2-5-resolution-after-acquisition-pglite.test.ts`, the whole M.5 item 4 chain with the real services.

### M2.6 — Reuse, isolation, withdrawal and licence

- **Reopen.** The instance is already bound to the pinned revision, so the task reads only durable state. A counting transport, an embedding fake and a model fake must all record **0** calls.
- **Second project, same tenant.** A permitted project resolves the same KiCad part through the own-part path, finds the published revision eligible, and makes zero network or acquisition calls.
- **Foreign tenant.** A foreign tenant or private project cannot read candidates, objects, handoffs or tasks. Every read is scoped, and an unknown id gives the same refusal. The *published* revision is global by schema design (`schema.ts:521-716`), which is why only redistributable content may reach it (M2.4). Whether a private library tier is wanted is OD-M2-11.
- **Withdrawal** uses E5: deprecate, supersede or revoke (`publication-review.ts:773-808`). Candidate search puts the revision in `withdrawn`. Existing pins keep a deprecated or superseded revision, while a revoked one fails closed (`server-catalog.ts:152-171`).
- **Upstream change.** A vendor or upstream change yields new bytes, a new hash, a new candidate and a new revision. Old projects stay pinned and upgrade through the successor diff.
- **Licence change.** A changed licence record invalidates unpublished handoffs: the check runs again at handoff and again at publish.
- **Tests:** `m2-6-reuse-isolation-pglite.test.ts` and `m2-6-acquisition-refusals.test.ts` (section 5).

### M2.7 — The live adapter

- **The only admissible real source:** `kicad-gitlab`, the official KiCad libraries.
  - Request: `GET https://gitlab.com/api/v4/projects/kicad%2Flibraries%2Fkicad-symbols/repository/files/<url-encoded path>/raw?ref=<pinned commit>`, and the same for `kicad-footprints`.
  - Only the commits in `KICAD_LIBRARY_PINS`, or a reviewed list.
  - Exact host `gitlab.com`, no redirects, deadline 15 s, 1 MiB per file.
  - A self-imposed 60/min, well under the documented 300 and 800. The real `Retry-After` is honoured. No credentials are needed for public projects.
  - What a qualification run must still verify: the raw content type, which is UNKNOWN (expected `text/plain`), and whether raw answers redirect, also UNKNOWN; a redirect is refused and recorded as unavailable.
- **What it adds** over `kicad-bundled`:
  - deployments that ship without `data/`;
  - parts added upstream after the pin (each pin move is a reviewed change, `pinned-checkout.ts:7-9`);
  - later, `kicad-packages3D` for K.6, whose repository was not read here.
- **Not admitted:** SnapEDA, Ultra Librarian, manufacturer CAD downloads and distributor datasheet bytes (2.3).
- **Live proof:** one bounded run of at most 4 files at a pinned commit, labelled live-source evidence. It costs US$0 (no paid provider) and needs OD-M2-3, OD-M2-5 and OD-M2-13.

## 5. M.5 items 4-7 mapped to tests

| M.5 item | permanent production-path tests (all new; PGlite where durable) |
|---|---|
| 4: no local candidate → fixture source → bytes → validation → durable candidate → review/publication → eligible replacement → electrical check + preflight | `m2-2-cad-egress`, `m2-3-acquisition-pipeline-pglite`, `m2-4-handoff-publication-pglite`, `m2-5-resolution-after-acquisition-pglite`. Each asserts on stored rows and receipts, never on a mock's `published: true`. |
| 5: reopen and reuse with no network, download or model work; a second authorized project reuses; foreign/private cannot read; change, withdrawal and licence handled | `m2-6-reuse-isolation-pglite`: transport, embedding and model counters at 0; second project own-part path; foreign scope refused; revoke → `withdrawn`, deprecated pins still materialize; new upstream bytes → new revision, old pin unchanged; non-redistributable handoff refused. |
| 6: approval refusal, missing credentials or evidence, unavailable source, malformed or hostile assets, cancellation, stale schematic or candidate, revoked membership, duplicate clicks, crash after an ambiguous commit | `m2-6-acquisition-refusals` (cases listed below) and `m2-4-handoff-boundaries` (AI actor refused). |
| 7: replacing on an existing board handles changed footprint, pin and route effects and stale manufacturing evidence; undo/redo/save/reload and multi-sheet identity | Shared with M1: `m2-7-existing-board-acquired-binding.test.ts`. Binding an acquired revision whose footprint differs reports the PCB impact, retires parity, DRC and readiness, and round-trips undo/redo and save/reload with sheet identity intact. |

The `m2-6-acquisition-refusals` cases:

- a rejected request → `review_rejected`, nothing bound;
- missing credentials → `source_credentials` reported once, no repeat calls;
- a 429 or an open breaker → `waiting-for-resource` with a retry time;
- the hostile corpora → `unsupported`, nothing valid stored;
- cancel mid-retrieve → the late result is fenced;
- a base edited after proposal → stale;
- a candidate withdrawn before apply → refused;
- a revoked requester → request retired, task revalidates;
- double start, handoff or apply → idempotent;
- publish outcome unknown → held (`ATOMIC_PUBLICATION_PUBLISH_OUTCOME_UNKNOWN`);
- an ambiguous apply → reconciled from history, never resubmitted.

## 6. Owner decisions (explicit)

| id | decision | default until decided |
|---|---|---|
| OD-M2-1 | Governance scope for each environment: values for `SIRKIT_ATOMIC_CATALOG_TENANT_ID` and `SIRKIT_ATOMIC_CATALOG_PROJECT_ID` (OD-37), default branch. | Publication refuses (`GOVERNANCE_UNCONFIGURED`). The task stops at `awaiting-review` with that blocker. |
| OD-M2-2 | Name the humans in the governance project: a requester, a reviewer/admin approver and a **different** `project_admin` publisher. One person cannot publish alone. | Nothing becomes eligible. Local work is kept. |
| OD-M2-3 | Read and accept the GitLab.com Subscription Agreement, Acceptable Use Policy and API Terms of Use for automated unauthenticated raw-file reads. The text was UNKNOWN here. | `kicad-gitlab` stays blocked. |
| OD-M2-4 | KiCad licence: confirm that serving individual official-library files with licence and attribution meets CC-BY-SA 4.0 plus the exception. Approve the attribution text and licence link on the asset view and in exports. | Acquired KiCad assets show licence and attribution. No change to `KICAD_LIBRARY_LICENSE`'s id. |
| OD-M2-5 | Which refs the live adapter may read: only the reviewed `KICAD_LIBRARY_PINS`, or a reviewed list of newer commits. A pin for `kicad-packages3D` (K.6). | Pinned commits only. |
| OD-M2-6 | An optional GitLab token, referenced by env NAME only, for authenticated limits. | None. Unauthenticated. |
| OD-M2-7 | Migration 0032: a tenant-scoped, deletable blob table for datasheet PDFs and 3D under the repository's migration-delivery rules. It is never applied to a live database without authorization. | M2 stores KiCad text only. PDFs and 3D are refused (`licence_forbids_retention` / unsupported). |
| OD-M2-8 | Whether a member of another tenant may hand a candidate to the governance inbox. | Refused unless the tenant is the governance tenant. |
| OD-M2-9 | Manufacturer datasheet domains to admit, with their terms and retention class. | None admitted. Distributor datasheet links are shown, never fetched. |
| OD-M2-10 | Commercial CAD services (SnapEDA, Ultra Librarian, vendor portals): pursue written API terms that permit library storage? Even if obtained, `third_party_cad` stays non-authoritative. | Not admitted. |
| OD-M2-11 | May `private_review_only` assets ever enter the tenant-less catalog? `validation.ts:207-209` admits them today. Is a tenant-private library tier wanted (schema change)? | The handoff refuses anything not redistributable. No private tier. |
| OD-M2-12 | Parsing isolation: in-process parsing (with preflight and ceilings) for the fixture and bundled sources, and a closed engine in the engine host before any live adapter. | As stated. Live stays blocked until the engine exists. |
| OD-M2-13 | Authorize one bounded live qualification run of 4 files from gitlab.com. US$0; the cumulative US$5 builder ledger is not touched. | No live run. Fixture evidence is labelled separately. |
| OD-M2-14 | Agent disclosure for CAD sources: KiCad library text may be shown to the LLM provider (public licence); datasheets not. | `unknown`: the agent sees labels and validation results only. |

## 7. Risks and open questions

- **D1/D2 does not need the network.** The fastest real fix for D1/D2-class gaps is publishing from `kicad-bundled` with a datasheet-cited terminal table. M2's network path is for parts outside the pinned library. Do not present a network acquisition of bytes the server already holds as new capability.
- **The terminal table still needs a person.** Real datasheets are PDFs, and PDFs are not text imports (`ingestion.ts:58-59`). Until a manufacturer publishes machine-readable pin tables under an admitted row, the terminal table stays a fact a person confirms. The review package makes that one check; it does not ask the reviewer to redo the research.
- **Meters are per process.** Admission meters live in one process (`admission-control.ts:26-28`). Several server or worker instances could each spend a source's quota. The vendor's own limits stay the backstop. A shared meter is an existing follow-up.
- **Wording of the hostile check.** `outboundFetch` checks every resolved address, but the rebinding window between check and connect remains (`outbound-fetch.ts:13-16`). The exact-host allowlist (`gitlab.com` only) is the practical close.
- **New aggregates and topics must not break existing pins.** Extracting the fenced-slice helpers moves cited lines in `generation-task/store.ts`. Refresh citations by content, using the lead's `refresh-citations.py`.

## 8. Sources read (2026-10-18; documentation only, no CAD file fetched)

- https://www.kicad.org/libraries/license/ — CC-BY-SA 4.0 with the design exception; redistribution keeps licence and attribution; no date on the page.
- https://gitlab.com/kicad/libraries/kicad-symbols — `LICENSE.md` (CC-BY-SA 4.0); visibility not labelled on the page.
- https://docs.gitlab.com/api/repository_files/ — raw and JSON endpoints, `ref`, `blob_id` / `content_sha256` / `last_commit_id`, public access without authentication.
- https://docs.gitlab.com/user/gitlab_com/ and https://docs.gitlab.com/user/gitlab_com/rate_limits/ — the numbers in 2.3, and the `Retry-After` / `RateLimit-*` headers.
- https://about.gitlab.com/terms/ — names the Subscription Agreement, Acceptable Use Policy, Website Terms and API Terms of Use.
- https://handbook.gitlab.com/handbook/legal/api-terms/ and https://handbook.gitlab.com/handbook/legal/acceptable-use-policy/ — fetched, but only navigation rendered. Their text is **UNKNOWN**.
- https://www.snapeda.com/about/FAQ/ — CC-BY-SA 4.0 with the Design Exception; no sharing within an EDA tool; API available by contact. https://www.snapeda.com/api/ returned 404.
- https://toshiba.semicon-storage.com/eu/semiconductor/product/agree-ul.html — Ultra Librarian download conditions for one manufacturer. https://www.ultralibrarian.com/terms-of-use returned 404.
