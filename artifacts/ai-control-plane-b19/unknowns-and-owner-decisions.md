# B19 — unknowns and owner decisions

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED**, **RECORDED**, **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION**. Every item below is recorded in `artifacts/remaining-builder-program/OWNER_DECISIONS.md`
(decisions) or `EXECUTION_LEDGER.md` (follow-ups, by increment); this page collects them for the chapter verdict.

## 1. Owner decisions taken with a safe default (the owner may choose otherwise)

| decision | question | default applied in code | amendments |
|---|---|---|---|
| OD-31 | who may spend live distributor quota | only an authenticated project member through a provider-credit route (`/api/bom`, `/api/parts/external-search`); every export and public route prices from the cache only | — |
| OD-32 | Mouser | disabled in the registry: its API terms prohibit caching or storing its content; never constructed, never memoized, never persisted | — |
| OD-33 | DigiKey and Nexar storage, bulk refresh | DigiKey observations served and kept 1 h (retention unstated in its terms); Nexar 24 h (its terms' limit); bulk refresh only where terms permit | — |
| OD-34 | what counts as the same part number | an exact MPN compares after trimming and ASCII upper-casing only; anything outside printable ASCII never matches; USD only | E4: a catalog part may be linked to an exact revision only when its `mpn` is empty or IS the exact MPN (family-level links refused) |
| OD-35 | who declares a requirements source's authority class | the authenticated caller, from the defined classes only; AI extraction can never confirm | — |
| OD-36 | may distributor observations be sent to the LLM provider | `agentDisclosure` is `unknown` for every source: the agent tools return labels only and never trigger a live vendor call | — |
| OD-37 | who holds global catalog authority | approval, publication and withdrawal only in one governance project; reviewer approves, project admin publishes or withdraws; approver never publisher; humans only; AAL2 step-up not enforced (open) | E4: the scope is a tenant AND a project (`SIRKIT_ATOMIC_CATALOG_TENANT_ID` and `SIRKIT_ATOMIC_CATALOG_PROJECT_ID`, both required) |
| OD-38 | what deprecated and superseded mean for a project | existing pins keep working with a visible gap and successor; excluded from new selection and binding; revoked fails closed | E5: the pins of the revision being LEFT are read historically (granting nothing) so a project can move off a revoked part; E5 review: the successor chain is followed (at most 8 hops) to the first selectable revision |
| OD-39 | may distributor values leave Sirkit | **undecided**: exports unchanged apart from status, pricing-basis, license and "not for redistribution" lines; no new export, snapshot or review record carries vendor values | — |
| OD-40 | external search scope and quota sharing | members search by keyword or exact MPN (at most 5 per source); the agent by exact MPNs only, at most 5 live per run, at most 25% of each source's window; meters are per process | — |

## 2. UNKNOWN

- **PCB and fabrication geometry licensing** (I5a, carried from `import-security.md`): the KiCad library license is enforced at
  the schematic export, and no vendor content whose license does not permit redistribution is committed. Whether fabrication
  outputs derived from KiCad footprint geometry (Gerbers, drill, pick-and-place) need a license statement of their own was not
  established in this chapter.
- **Vendor terms the vendors' pages do not state**: Mouser's region and currency; DigiKey's retention (served and kept 1 h under
  OD-33); the keyword-search terms behind registry 1.1.0's candidate search were not re-read at execution time (no network),
  so its `documentationCheckedOn` date is unchanged and the registry says so.
- **A real LLM provider turn** through the new agent tools: every model interaction in the tests is a scripted adapter (no
  credits were available).
- **Request lifetime in Next.js**: whether the framework keeps a `Request` alive for the whole of a handler, so that a client
  disconnect always reaches `request.signal`, is unverified (found through a chat cancellation test whose harness had to keep
  its own `Request` alive); a separate hardening item in `route-handlers.ts`.

## 3. BLOCKED-LIVE-QUALIFICATION

- **Live acquisition contract check** (`app/lib/acquisition/__tests__/b19-e-live-contract.test.ts`): operator-run only, under
  `SIRKIT_LIVE_ACQUISITION_CONTRACT=1` with the operator's own DigiKey and Nexar credentials, one known MPN per admitted source
  (exact mapping, registry host, labels, one quota unit, no credentials logged). Never run in CI, and not run in this chapter:
  the execution environment holds no vendor credentials, and a run spends the operator's quota.
- **Production Supabase authentication E2E** (no isolated project or account), and the **bundled FreeRouting runtime** (local
  only; CI replays committed recordings) — carried from earlier chapters.

## 4. Follow-ups recorded, not fixed in B19

Boundary and quota:
- DNS pinning: the outbound path revalidates the resolved address before every connection but does not pin the connection to
  the validated address (I1).
- Quota meters are per process; a durable shared meter is a follow-up (I3b, OD-40). A Nexar batch larger than the remaining
  window is refused whole rather than split.
- The Nexar OAuth token flow is not exercised (D19-12).
- Running abort signals are not threaded into the connectors' `lookupBatch`: an abandoned agent request still runs to its
  egress deadline (its quota was already metered, so nothing is spent twice) (E6).
- The Nexar pricing path treats a GraphQL answer with `errors` as "no exact match" for the whole batch and remembers it for the
  source's freshness window; the candidate search handles partial answers, the pricing path needs its own decision (E2).

Model-facing hardening on routes B19 did not touch (I5e review):
- `app/api/spice/ai/route.ts`: no untrusted-data sentence in its prompt; imported SPICE model text, project values and ngspice
  log tails reach the model unbounded.
- `app/api/schematic/layout-critic/route.ts`: no untrusted-data sentence; the manifest carries unbounded values and categories.
- The architecture, interfaces and power propose prompts carry no untrusted-data sentence for requirement text.
- Assistant messages stored locally before I5e-2 carry no advisory flag and are still replayed; files imported since are marked.

Product surfaces:
- The BOM no-purchase tripwire has no bare "cart" pattern outside BomView (its component test covers BomView); a navigation
  through a helper in a file that never names an upload URL is not caught lexically (E1-C review).
- Out-of-order `/api/bom` answers can still show the older result (pre-existing race; a result is labelled with the request it
  answered). No-storage sources are hidden only offline (both are disabled or blocked today).
- The Build Library, publication and review panels were verified with component tests only; no browser run (memory limits on
  the execution machine).

Catalog and publication:
- The operator seed script's reuse path reads through the pinned loader and repoints links, and still writes family-level
  links directly (OD-34 amendment) (E3, E4).
- A status-read outage holds a publication request beyond the marker lease (fail closed); a definite rollback at COMMIT is
  reported as an unknown outcome; AAL2 step-up is not enforced (OD-37) (E4).
- The `FOR SHARE` lock taken by re-publication is not exercised concurrently (PGlite has one connection) (E3).
- The bundled KiCad library reader was exercised with fixture libraries, not the uncommitted `data/` checkout (E4).

Operator scripts and adjacent routes:
- `scripts/refresh-bom-pricing.ts --notify` writes NULL-owned notification rows no scoped reader can see.
- The public `/api/parts/search`, `/api/parts/[id]` and alternates routes still return a raw `err.message` on 500, and embedding
  spend is unmetered there; the new B19 routes do not copy the pattern.
- `kicadDatabaseLibraryConfig().visibilityPredicate` (`publication_state = 'published'`) has no production caller and would not
  exclude withdrawn revisions.

Test and CI hygiene:
- The B11.5 write-closure gate and the full suite run only outside CI (CI runs narrow deterministic lists); the full suite is
  run at each increment and at the closeout instead. [B24-B2, 2026-10-08] Superseded in part: the B11.5 write-closure gate (`b11-5-capture-exactness`) runs in prompt-to-gerber since B24-B2 (D24-15, OD-204; `ai-control-plane-b24/ci-admission.md`); the full suite still runs only outside CI.
- The tripwire scan for vendor-module imports covers `distributors/clients` and `acquisition/external-search` by name; new
  vendor-reaching modules must be added deliberately.

## 5. Out of scope by decision (recorded in `acquisition-ux.md` with reasons)

Purchase, checkout, add-to-cart or order APIs and tools; AI approve, publish, bind, withdraw or rebind tools; bulk or
background refresh (OD-33), enabling Mouser (OD-32), unblocking LCSC; persisting external search hits; keyword search by the
agent (OD-40); fetching manufacturer datasheets into evidence; automatic mark-stale of bindings on revoke; purging vendor values
from snapshots (OD-39); cluster-wide quota metering; tenant columns on atomic tables (OD-37 uses a governance project instead);
renaming "Send to fab"; a real SourcingProviderAdapter; acquisition tools in board-less chats; lead time and currency conversion.
