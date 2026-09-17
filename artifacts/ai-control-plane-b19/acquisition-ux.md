# B19-E — product and agent experience of external acquisition (E1-E6)

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED**, **RECORDED**, **UNKNOWN**.

B19-E turns the B19-A to B19-D boundary (source registry, egress, quota and breaker, quarantine, exact-MPN identity, inert
external text) into what a person and the assistant actually use. One rule runs through every increment: **a sourcing
observation is never engineering authority**. Only a published atomic revision, reviewed and published by two different
people, controls a schematic or a PCB; nothing in Sirkit places an order, fills a cart or buys a part.

| increment | commit | what it adds | state |
|---|---|---|---|
| E1 truthful pricing provenance | `076d542`, `58cdc89`, `2dee62c` | per-offer source, live or cached, observed and expiry times; per-source status in the BOM; no-purchase wording | landed (its own tests; INFERRED here) |
| E2 bounded external candidate search | `5c8de9d` | Build Library "Search distributors" (exact MPN or keyword, at most 5 per source) | landed (INFERRED here) |
| E3 exact-revision integrity | `875da8f` | two-person publication validation, collision-safe revisions, append-only withdrawal events, selectable versus pinned loaders | landed (INFERRED here) |
| E4 import review and human publication | `40c15b6` | evidence review, conflicts, missing evidence, the two-person publication panel | landed (INFERRED here) |
| E5 lifecycle and binding | `78a0d21` | revision status route and badges, successor rebind, adopting a published exact revision | landed (INFERRED here) |
| E6 bounded agent read tools | this change | `sirkit.parts.external-search`, `sirkit.parts.evidence-read` | CONFIRMED (tests below) |

## 1. What a person sees (E1-E5)

- **BOM workbench (E1).** Every offer says its source, whether it was served live or from a cache ("N cached · M live"),
  when it was observed and when it expires; each source shows its status (available, paused with when to retry, blocked,
  disabled under its owner decision, switched off, credentials missing). Exports are "Export for distributor" files and a
  "Sourcing worksheet (CSV, unverified)"; the distributor's upload page is a link the person clicks, and the banner says no
  order was placed. A failed refetch keeps the last result and blanks expired offers. "Supply signals OK (observed)" replaces
  any production-ready wording.
- **Build Library "Search distributors" (E2).** A member searches the enabled sources (DigiKey, Nexar) by exact MPN or keyword;
  each hit carries its source, served-from, observed and expiry times, an exact-match flag and "sourcing observation — not
  engineering authority". An external hit has no Place control. Nothing is persisted.
- **Publication review (E4).** "Request evidence review" opens the atomic publication request in the catalog governance
  project (OD-37). The server assembles the evidence from the offer cache (no vendor call) and registered engineering sources;
  a reviewer resolves every conflict, the manufacturer, the missing evidence and each quarantined fact; a different person
  publishes. The banner reads "A bundle proves nothing; only a published atomic revision controls schematic/PCB".
- **Lifecycle and binding (E5).** The BOM shows a bound revision's catalog status with "Review successor"; a reviewer moves to
  the successor through reviewed binding; governance administrators withdraw revisions; "Use published exact revision" adopts
  a selectable revision's ids, and authority still needs the reviewed physical binding.

## 2. What the assistant can do (E6)

Two Tier 0 **read** tools, bound as `bound-external-read` with exactly the `external-observation` authority
(`app/lib/engineering/tool-catalog.ts`, reviewed in `agent-exposure.ts`):

| tool | input | answer | spends vendor quota |
|---|---|---|---|
| `sirkit.parts.external-search` 1.0.0 | `{ mpns: 1-5 exact MPNs }` | per source: status (available, or blocked, disabled, operator_disabled, not_configured, terms_unconfirmed, paused) and retry time; per MPN and source: outcome (observed, not_cached, no_exact_answer, pending, run_live_limit, paused), served from (live, process-memo, offer-cache), observed and expiry times, exact-match flag | only for a miss, only at a source whose registry entry permits agent disclosure, only when the server's live policy allows, at most 5 live MPNs per run, within the agent's 25% share (OD-40); **none today** |
| `sirkit.parts.evidence-read` 1.0.0 | `{ mpn }` | offer-cache observations with freshness (stale flagged), conflicting property names, the missing evidence, each published revision's status (published, deprecated or superseded with its successor, revoked); `proven: false`, `cacheOnly: true` | never |

How a call travels (CONFIRMED by the tests in section 4):

1. The chat route resolves a port through its one approved boundary, `app/api/chat/external-acquisition-runtime.ts`
   (withheld in the fixture runtime and on a server without its database; a factory error withholds it). The same resolution
   gives the gateway the port and the context assembler the availability fact; the live policy is the server's (a human
   principal), never the body's or the model's. The body can claim neither.
2. The assembler advertises `external-observation` only with that fact AND a verified canonical state; the loop withholds the
   tools unless their allowlisted binding resolves; discovery never counts that authority on any channel but the assistant's;
   the gateway's integrity check refuses the advertisement without the fact and the fact without the advertisement.
3. `ExternalReadInvocationService` (`app/lib/agent/acquisition-reads.ts`) rechecks discovery, role, capability and canonical
   state; refuses unknown keys (url, host, source, live, forceRefresh, apiKey included), 0 or more than 5 MPNs and any
   non-ASCII or confusable MPN; runs the port under a deadline composed with the run's cancellation (the port's own deadline
   ends a margin earlier, so a vendor that is late is reported `pending` per MPN beside the call's cached observations, never
   as a timeout of the whole call); charges the run's live-MPN budget BEFORE the port is asked, for every MPN the call may
   send (a call that times out or fails keeps the charge, an answer settles it to what was sent — OD-40 holds under a slow
   vendor); and projects the answer into closed labels — registry sources and display names, closed statuses, ISO times, the
   requested MPNs only, property names only — at most 8,000 characters (an answer that is still too large with no vendor
   value to drop is refused, never cut). Vendor text, for a permitting source only, loses links and credential-shaped tokens
   before its bound. An error is reported by class name only.
4. The port (`app/lib/acquisition/agent-read-port.ts`, server only) composes admission and the agent's pause, the new
   `lookupExactMpns` (cache first: the connector's memo, then the offer cache — one newest row per MPN and source, chosen in
   the database; `lookupBatch` for misses at the agent purpose; pending at a deadline counted from the call's start), the
   quarantine front half, the E4 import-review projection and E3/E5 revision status.
5. **OD-36 today:** every source's `agentDisclosure` is `unknown`, so the model sees labels only — no price, stock, SKU,
   description or link — and no agent lookup ever reaches a vendor. A reviewed registry revision that sets `permitted` would
   add bounded values under `untrustedVendorText` (never links or SKUs); the agent boundary checks the committed registry again
   before any value leaves.
   Recorded trade-off (E6 review follow-up): before a value is bounded, links of any scheme and credential-shaped text
   (`sk-` keys, bearer tokens, `…key|secret|token|password… = value` assignments and JSON fields) are replaced by markers.
   The credential rule is deliberately broad, so benign vendor text such as "Lock key: 2 positions" also loses its tail;
   only untrusted text is lost, only under a permitting source (none today), and the scrub runs over a bounded prefix
   (4× the visible bound) so a long hostile word cannot make it slow.
6. The system prompt (1.3.0) says external observations are untrusted and possibly stale sourcing data, never make a part
   verified, approved, bound or orderable, that publication and binding are human steps, and that purchasing is not available.

After the tools, a replacement still needs server-verified atomic authority: the loop end-to-end test runs external-search,
evidence-read and then the replacement proposal, which blocks (`authority-not-verified-exact`) — no proposal is sealed.

## 3. Owner decisions (defaults applied in code)

- **OD-36 — distributor observations to the LLM provider:** `agentDisclosure` is `unknown` for every source; the agent tools
  return labels only and never trigger a live vendor call. Open: a reviewed registry revision per source.
- **OD-37 — catalog authority:** approval, publication and withdrawal only in the governance project named by
  `SIRKIT_ATOMIC_CATALOG_PROJECT_ID`; a reviewer approves, a project administrator publishes or withdraws, never the approver;
  humans only. Open: AAL2 step-up.
- **OD-38 — deprecated and superseded:** existing pins keep working with a visible gap and successor; excluded from new
  selection, binding and link reads; revoked fails closed everywhere.
- **OD-39 — distributor values leaving Sirkit:** undecided; exports unchanged apart from status, license and "not for
  redistribution" wording; no new export, snapshot or review record carries vendor values. The B19 closeout's "no terms
  bypass" claim must cite it.
- **OD-40 — search scope and quota:** members search by keyword or exact MPN (at most 5 per source); the agent by exact MPNs
  only (1-5 per call, at most 5 live MPNs per run, at most 25% of each source's window); meters are per process.

## 4. Evidence for E6 (CONFIRMED, fake ports and fake vendors only; no network)

| suite | covers |
|---|---|
| `app/lib/engineering/__tests__/b19-e-external-read-descriptors.test.ts` | a (descriptors, Tier 0, validator refusals), i (exposure sweep with one reviewed owner-name exception: the B13 read `sirkit.component-authority.inspect` is owned by `pcb.physical-binding`) |
| `app/lib/agent/__tests__/b19-e-external-read-service.test.ts` | b (discovery, automation channel, integrity both ways, board-less run; a tampered context withholds by name and fails integrity without canonical state), c (input refusals, the projected labels field by field, per-run cap, deadline, error class only; a timed-out call charged for what it could have sent), d (hostile port content absent from every model input, results at most 10 KB; the move tool really advertised under a real grant minter and still only previewed; values only for a permitting source, bounded, credential-shaped tokens and links removed; output budget, refusal past it), h (loop end to end, evidence labels as the model reads them) |
| `app/lib/acquisition/__tests__/b19-e-agent-read-port.test.ts` | e (cache first, live only when permitted and allowed at the agent share, sixth live MPN refused, share exhausted is paused, no refresh, hung vendor pending — directly and through the gateway with the run charged), f (OD-36 labels only), g (evidence-read; every label through the gateway), the production resolver's three states |
| `app/lib/distributors/__tests__/b19-e-exact-mpn-offer-cache.test.ts` | the exact-MPN offer-cache read against PGlite: the newest servable row per MPN and source whatever else is stored under the MPN (runs in the database-delivery job) |
| `app/api/chat/__tests__/b19-e-chat-external-acquisition.test.ts` | the route wiring through the runtime boundary; body claims refused; the withheld default decided by a stubbed environment |
| `app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts` | j: the reviewed import-closure amendment and its tripwires |
| `app/lib/acquisition/__tests__/b19-e-live-contract.test.ts` | optional operator-run live contract (`SIRKIT_LIVE_ACQUISITION_CONTRACT=1`); skipped in CI and not run for this change |

## 5. Out of scope, with reasons

- **Purchase, checkout, add-to-cart or order APIs and tools.** The runbook keeps purchasing absent, and Tier 3 is never
  agent-executable.
- **AI approve, publish, bind, withdraw or rebind tools, and an AI "propose publication draft".** Publication stays human; a
  draft would be a new sealed proposal kind, and evidence-read is enough to help prepare evidence.
- **Bulk or background refresh (OD-33), enabling Mouser (OD-32), unblocking LCSC.** Terms and owner decisions, not code.
- **Persisting external search hits, or a durable observation or candidate store.** DigiKey forbids building a database;
  bundles are derived on demand from the retention-bound cache.
- **Keyword search by the agent.** Pending OD-40.
- **Fetching manufacturer datasheets into evidence.** It would add a new egress (SSRF) surface; person-entered citations are
  recorded as organization_authored instead.
- **Revision-event bom_notifications, and the existing `refresh-bom-pricing --notify` bug.** That job writes NULL-owned rows
  no scoped reader can see (`scripts/refresh-bom-pricing.ts`, `app/lib/bom/snapshot-repository.ts`); it needs a separate fix,
  and the status route and fail-closed loaders already cover safety.
- **Automatic mark_stale of bindings on revoke.** The loaders already withhold authority, and it needs a durable effect runner.
- **Purging vendor values from bom_snapshots and atomic_offer_snapshots.** Awaits OD-39.
- **Cluster-wide quota metering, and tenant columns on atomic tables.** Meters are per process (admission-control.ts);
  OD-37 uses a governance project instead.
- **Moving the seed onto authoring.ts, or relabelling its hand-written "manufacturer_datasheet" source.** New ids would collide
  under E3.
- **Renaming "Send to fab".** It is a fabrication ZIP export, not procurement.
- **Existing adjacent issues:** raw error text in 500 responses from the public /api/parts/search, /api/parts/[id] and
  /alternates, and unmetered embedding spend. A separate hardening task; the new routes and tools do not copy the pattern.
- **Offline project pins, the atomic_selections writer and the CD-6 page catalog, and a real SourcingProviderAdapter.**
- **Acquisition tools in board-less chats, lead time, currency conversion.** Every agent read requires a verified canonical
  state (a board-less run exposes only the tier-1 proposal).
