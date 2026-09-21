# Owner decisions register

Decisions the program cannot take safely on its own. Each row states the safe default the builder applied (if any) and what changes if the owner decides otherwise. Nothing here was executed without a safe default.

| # | Origin | Decision | Safe default applied | Status |
|---|---|---|---|---|
| OD-1 | B16.1C | DRC preset `jlcpcb-2l` uses one `minAnnularRingMm 0.15` for vias AND plated-through holes; JLCPCB states PTH absolute min 0.18 mm (rec. 0.25 mm) | CLOSED 2026-09-09 (B16-C.4): live page re-fetched, limits split (`minAnnularRingNm` via 0.15 mm, new `minPthAnnularRingNm` 0.25 mm = manufacturer RECOMMENDED; 0.18 mm absolute recorded, not enforced); profile schema v2 with source URLs / retrievedAt / expiresAt / scope; v1 profiles refused at release. Owner may relax 0.25 -> 0.18 mm by editing `jlcpcb-2l.json` (a re-record of the pinned identities follows). See `artifacts/ai-control-plane-b16-closeout/fabrication-rule-authority.md` | closed (builder default 0.25 mm; owner may relax) |
| OD-2 | B16.1C | `bind_atomic_selection` requires reviewer/project_admin; a `pcb_editor` cannot complete Schematic → PCB alone | B16-C.2 adds a visible review handoff; editors are NOT silently granted reviewer power; 403 for insufficient permission | CLOSED 2026-09-09 (B16-C.2, `fc9450b`): editors request review, reviewers/admins approve or reject under their own identity, requests retire on revocation or role change; the browser proof exercises the handoff end to end |
| OD-3 | B16.1C | A routed board refuses structural re-sync (Stage 8 copper protection); no product path for post-qualification design changes | B16-C.1 implements a new routed-board revision path (old board + releases immutable); in-place rip-up only as Tier 2 with preview/inverse | CLOSED 2026-09-09 (B16-C.1): derived board revision `<root>@r<n>` with a reviewed rework plan and per-net equivalence proofs; the old board and its ledger stay immutable and are refused for qualification/release (`MFG_BOARD_SUPERSEDED`). NO in-place rip-up command was provided (would need the Tier 2 destructive-edit machinery; RECORDED, never a silent fallback) |
| OD-4 | B16.1C | physical-bindings route maps `HUMAN_REVIEWER_REQUIRED` to HTTP 422 | B16-C.2 changes to 403 with a regression test | CLOSED 2026-09-09 (B16-C.2): 403 `PB_ATOMIC_BIND_HUMAN_REVIEWER_REQUIRED` naming the `request_atomic_review` handoff; regression test in `b16-c-review-handoff.test.ts` |
| OD-5 | B16.1B | Drizzle migration 0027 (RLS/policies) is not journal-registered; migrations not deployable through the supported toolchain | B16-B provides one supported migration mechanism with tests against a disposable PostgreSQL when available | open (scheduled B16-B) |
| OD-6 | B16.1B | No isolated Supabase project/account for live auth qualification | stays BLOCKED-LIVE-QUALIFICATION; deterministic seams used | needs owner resource |
| OD-7 | B16.1C | No provider credits for a real LLM turn | fake provider adapters in CI; live turn UNKNOWN | needs owner resource |
| OD-8 | runbook §2.4 | Merging chapter PRs normally after green CI is authorized by the runbook; no force-push, history rewrite, access/billing change, live purchase or production data destruction is authorized | builder merges normally only after gates | standing |
| OD-9 | B16-B | `schema.ts` lacks 16 integrity constraints that exist only in the hand-written migrations (durable-workflow CHECK/FK, deferrable binding FKs); re-aligning it changes what `drizzle-kit generate` diffs against | migrations are the delivery truth; `db:push` refused; `schema.ts` left as the ORM's typed view | open (owner: align schema.ts or accept the split) |
| OD-11 | B18-B | The explicit-request grammar (the proof that lets a Tier 1 operation execute WITHOUT confirmation under `execute_explicit_tier1`) covers `pcb.move-footprint` only (absolute/relative moves in mm/mil/nm with a named footprint, whole-message, byte-equal derivation); the other five Tier 1 families always preview + confirm | Conservative default: an unproven instruction is never executed, only previewed. Owner decides whether B18-C adds grammars for rotate/flip, arrange, silkscreen text and the schematic families (each a pinned, tested derivation), or keeps confirmation for them | resolved in B18-C: explicit grammars for move (I3), rotate/flip (I5) and undo/redo (I8; 1.4.0 after review 3); arrange, silkscreen text and dimensions stay confirmation-only — DECIDED (multi-target ambiguity, free text placed by the AI, annotation geometry the human must see); the owner may ask for more grammars |
| OD-12 | B18-B | `/api/chat` now MINTS durable execution grants (classification durable read-write, sensitivity session-identity) while its policy row stays `authenticated-propose` with `authoritativeWrite: false` — the grant is not an engineering write (the commit stays in the browser's canonical session under the human's session), but it is a durable authority artifact | Row left unchanged; the truth is recorded in the classification comment and here. Owner decides whether a grant-minting route should be classified `authenticated-mutation` (which would also require CSRF semantics the streaming route already has) | open (recorded) |
| OD-13 | B18-B; dimensions resolved in B18-C I7 | The runbook's PCB Tier 1 list names "change a via to a validated diameter/drill", "add/update/remove dimensions", "add/update/remove ordinary board text/silkscreen" and "edit a selected track segment within validated rules"; the registry's approval vocabulary had `pcb.dimension`, `pcb.edit-via`, `pcb.create-via` and `pcb.edit-track` at `topology-or-geometry` (Tier 2), so the agent could only propose them | Dimensions: re-tiered `reversible` on the action record and the descriptor, following the runbook's explicit list (B18-C I7; documentation layers only, exact inverses, `edit_placement`; confirmation-only). Via diameter/drill and track segment edits: kept Tier 2 proposal-only — a recorded DIVERGENCE from the runbook's list (both change copper and need the `edit_copper` capability the B18 grant model does not carry; a padstack-bound via cannot change size/drill alone, and I9 makes the via proposal path refuse that truthfully). Ordinary board text (`texts[]`): not covered — no editor command writes it, so an executed family would be parallel mutation code; silkscreen TEXT is covered (B18-C I6) | resolved for dimensions; DIVERGENCE recorded for vias, tracks and board `texts[]` (the owner may widen: grant `edit_copper` for validated via/track edits, or add an editor command for board text) |
| OD-14 | B18-B | Undo/redo as an EXECUTED family under a grant needs a canonical `replayUnderGrant` path (the wrapped history undoes the patch synchronously before the canonical reconcile and rebases on failure; the executor forces `provenance.candidateId = "<direction>:<tx>"`), so it is excluded from B18-B | Deferred to a B18-C sub-design (`latestEligibleUndo` + `sameHead` bound as the undo reference; explicit only when the latest eligible operation's actor is `ai`); the user's own undo of a granted commit works today through the ordinary history | resolved in B18-C I8a/I8b: `sirkit.pcb.undo-redo-granted` replays the exact last AI change through `CanonicalEditorSession.replayUnderGrant` (canonical first, never a patch before the executor answers, no rebase under a grant); the server minter resolves the reference from the principal's own settled grants at the head (sameHead = head sequence + lineage; a revision bound would refuse every undo on a board with a refilled pour); an AI undo or redo is a NEW history entry: the user's own Undo afterwards re-applies the change after an AI undo and removes it again after an AI redo (said per direction by prompt 1.2.1, the preview note and the executed answer; corrected in B18-C review 3, A24). Recorded deviation (B03.1): the replay transaction's provenance source is `ui` (the executor forces it) — the AI attribution lives in the history entry's metadata and in the grant store. Browser-proven in B18-C I10b (an AI undo, a reload, an AI redo) |
| OD-10 | B16-C.1 | RC03 refuses a board whose component has an UNCONNECTED pin (`CAP_PIN_PAD_PARITY_UNPROVEN`: every verified pin-pad mapping must appear in a board net's endpoint keys), so a spare/unpopulated-pin header cannot be qualified autonomously; reproduced on the first H.14 recording (2026-09-09) with an unconnected J2 | Pre-existing RC03 rule, left unchanged in B16-C (H.14 uses a connected J2). Owner decides whether intentionally unconnected pins (schematic `no_connect` / `unconnected` disposition) should satisfy parity; B17/B19 can carry the disposition onto the board's pad classifications | open (recorded) |
| OD-15 | B18-C | Schematic Tier 1 execution under a grant (`schematic.set-property`, `schematic.move-rotate`): every schematic operation needs `edit_components`, which the AI actor is categorically refused (`authorization.ts`) and which the B18 grant model does not carry; the execution journal and the ritual are PCB-literal | Deferred: schematic edits stay sealed proposals the human applies (the B15 path); nothing schematic is executable by the agent | open (owner: decide whether an AI grant may carry `edit_components`; a later increment would add schematic descriptors, a schematic journal and ritual) |
| OD-16 | B18-C | Schematic wires and labels (`schematic.connect`): a Tier 2 record with no proposal vocabulary (the Tier 1 schematic proposal covers set-value / rename / delete only); PCB track segments need `edit_copper` (OD-13) | Wires and labels: neither executable nor proposable by the agent; tracks: proposal-only | open (owner: add a bounded wire/label proposal vocabulary, or grant copper edits) |
| OD-17 | B18-D | The chat execution UX design (`artifacts/ai-control-plane-b18/chat-execution-ux.md` §9) leaves eight product choices: D1 pre-result final model text visible with a label (vs collapsed, or ending the run at the preview); D2 extend the Undo/Redo hold to every canonical commit; D3 the chat protocol stays version 1; D4 where the autonomy control lives; D5 the confirmation card and new chat components join the B01 watched surfaces; D6 ship the untraced `tool_refused` event; D7 the Tier 3 hint vocabulary (display only); D8 interim model text moves to the run log for every multi-step turn | The design's recommendations applied: D1 visible with a label (ending the run at the preview would break the B18-C model contract); D2 only as a follow-up if the probe shows the lost-undo window — the probe and a diagnostic CONFIRMED the window for granted executions (B18-D I7), which the hold now closes; extending the hold to every canonical commit (human commits, Smart Route) remains open; D3 yes; D4 the chat header, as an optional increment; D5 yes (a stricter gate); D6 yes, optional; D7 as written; D8 yes (required by Rule 2) | open (safe defaults applied; the owner may choose otherwise) |

## OD-18 — Rule 2 beyond the agent loop (B18-D review, 2026-09-11)

- Question: the runbook's B18-D rule "No model text may claim success before the transactional result exists" was built into the agent loop and the chat entry. Does it also cover the schematic edit route (`/api/schematic/edit`), whose model `note` the page showed as the assistant's answer before the user applied anything?
- Default applied: yes. Rule 2 covers every chat surface: the edit route's note is shown only as a labelled note in the run log ("Assistant note (written before the result): …"), never as the answer and never in the history the next run receives; the answer is the page's own sentence.
- The owner may reverse this; the change is confined to the page's edit flow and `editProposalMessages`.

## OD-19 — Commit identity (2026-09-11)

- Question: runbook §2.4 approves `Dandi Desta <dandidesta82@gmail.com>`; 54 B18 commits used the owner's other address `danditilahun82@gmail.com` (see the ledger's correction). Which address should the remaining chapters use?
- Default applied: the runbook's approved `dandidesta82@gmail.com` (the repository's configured identity) from the next commit on; the earlier commits stay as they are (no history rewriting).
- The owner may choose `danditilahun82@gmail.com` instead, for example if that address is the one linked to the GitHub account.

## OD-20 — Scenario 2's wording (B18-E, 2026-09-11)

- Question: the runbook says "the 5 V net"; the fixture design's rail is named `/root/VCC` (J1 is `PWR_5V`). Prove the verbatim sentence as a truthful no-match (the nets listed, nothing changed) and the change with "the VCC net", recording the deviation — or rename the rail `+5V` in the fixture (the placed-board revision changes and the router recording must be re-recorded)?
- Default applied: the first: the verbatim sentence gets a truthful no-match and the change is proven with "the VCC net"; the deviation is recorded; the fixture is unchanged.
- The owner may choose otherwise.

## OD-21 — What a mounting hole is (scenario 3) (B18-E, 2026-09-11)

- Question: Sirkit has no mounting-hole object. Which footprints count (for example, every pad `np_thru_hole`, or an unconnected plated hole with a `Mounting*` library name), and should the blinker fixture gain holes (every fixture spec and the router recording change) or should the browser prove only the board outline, with holes proven in integration?
- Default applied: a footprint whose pads are all `np_thru_hole`; the fixture is unchanged; holes are proven in integration and the browser proves the outline.
- The owner may choose otherwise.

## OD-22 — Scenario 1's precondition (B18-E, 2026-09-11)

- Question: the move takes footprint ids; a real model resolves R3 from the selection or from board-inspect, whose size on a synchronized board is unmeasured. Record "select the part first" as the precondition, or add a bounded Tier 0 footprint lookup?
- Default applied: record the precondition now; decide on a bounded Tier 0 lookup after E3 measures board-inspect (read-only either way).
- The owner may choose otherwise.

## OD-23 — Scenario 4's meaning (B18-E, 2026-09-11)

- Question: is "the approved lower-power part" the single server-owned exact authority recorded for U1 (B14), with no power claim unless a tool fact states one? And may the fixture runtime gain a CMOS 555 atomic part with an approved mapping, for the browser proof?
- Default applied: yes to the first reading (choosing among several approved alternates would be a new selection authority and is not proposed); yes to a fixture-only part, gated to the fixture runtime with a tripwire.
- [B18-E E16, 2026-09-12] The first half is what the code does. The second half was NOT needed and was not taken: once the
  fixture runtime was given the component-authority sources it was missing, the browser journey already produces a real
  replacement (U1's loose part reference against the exact part its authority records), so no fictional part was added to
  the catalog. Scenario 4 is proven end to end in the browser without one.
- The owner may choose otherwise.

## OD-24 — Scenario 5's controls (B18-E, 2026-09-11)

- Question: "compactly" and "keep decoupling close to U1" are not agent controls today. Expose the spacing preset or decoupling relationships to the agent?
- Default applied: no widening: the chat reports truthfully (the objective's state, or not evaluated).
- The owner may choose otherwise.

## OD-25 — Scenario 6's "redo" (B18-E, 2026-09-11)

- Question: the editor's own undo stack does not survive a reload. Is the runbook's redo proven as the chat's "Redo."?
- Default applied: yes; a redo through the editor's button after a reload is outside B18.
- The owner may choose otherwise.

## OD-26 — Scenario 7a's defensive floor (B18-E, 2026-09-11)

- Question: no production code supplies the live selection digest, so the `selection_stale` burn and the ritual's stale-selection refusal can never fire. Keep them as a pinned defensive floor, or delete them with their display sentence?
- Default applied: keep them, pinned by a synthetic case (E5).
- Measured in E8 (browser): the confirmation card is a MODAL dialog, so while a preview waits the human cannot reach the
  editor at all and the selection cannot change under it — a second, independent reason the burn cannot fire through the
  product. The floor stays a floor; the decision is unchanged.
- The owner may choose otherwise.

## OD-27 — Scenario 7f in the browser (B18-E, 2026-09-11)

- Question: a browser revocation proof needs a revocation switch in the fixture's local membership repository — an auth surface. Add it (fixture runtime only), or keep revocation proven in integration and prove only a clearly labelled role change in the browser?
- Default applied: no auth-surface change: revocation is proven in integration; the browser proves what the fixture can do without one.
- The owner may choose otherwise.

## OD-28 — Scenario 8's display (B18-E, 2026-09-11)

- Question: should an unknown tool name that matches the Tier 3 families show a display-only "T3" tag, and should the answer of a run with a refused call carry a label?
- Default applied: no tag (the line reads "Unknown tool — refused before running (unknown_tool) — nothing ran") and no label; the model's prose is not checked (recorded).
- The owner may choose otherwise.

## OD-29 — Resources for live and routing proofs (B18-E, 2026-09-11)

- Question: a live model run of each scenario needs provider credits (OD-7); a chat routing replay for scenario 5 needs a machine with the FreeRouting runtime to record it.
- Default applied: BLOCKED-LIVE-QUALIFICATION until credits exist; without a recording the routing browser proof is the truthful `routing_engine_unavailable` refusal.
- The owner may choose otherwise.

## OD-30 — CI time (B18-E, 2026-09-11)

- Question: each bootstrapped browser spec adds minutes to page-browser-e2e (timeout 30 min). Accept a longer job, or split it?
- Default applied: accept a longer job while it stays well inside its timeout; split it if a run comes within five minutes of the limit.
- The owner may choose otherwise.

## OD-31 — Who may spend live distributor quota (B19-B I2, 2026-09-13)

- Question: live pricing spends a metered vendor quota (Mouser's is about 1000 queries a month). Before B19 any anonymous
  caller could spend it, and force a refresh. Who should be able to?
- Default applied: a project member, in the BOM workbench (`/api/bom`, authenticated, `providerCredit`), and the
  authenticated snapshot and diff. Exports, the procurement packet and the cart routes stay public and price from the
  cache only, so an anonymous visitor sees cached offers (labelled as such) and never spends quota.
- Not decided here: a per-project or per-user quota budget. Nothing reads `providerCredit` yet; metering it is recorded
  for the source registry (I3).
- The owner may choose otherwise.

## OD-32 — Mouser (B19-A I3, 2026-09-13)

- Question: Mouser's current API terms (last modified 2013-03-11) prohibit caching, recording, pre-fetching or storing
  its content, license display only inside the application, and require the application's primary purpose to be driving
  sales to Mouser. Sirkit's BOM compares several distributors and cached their offers. May Sirkit use the Mouser API?
- Default applied: **disabled** in the source registry. Even if enabled later, Mouser offers are never persisted or
  memoized, never served from a cache, and never bulk-refreshed. Choosing Mouser in the BOM prices nothing and says why.
- To enable: the owner confirms Sirkit's use complies (or obtains Mouser's agreement), and the registry entry is changed
  in a reviewed revision (the artifact gate makes that change visible).
- The owner may choose otherwise.

## OD-33 — DigiKey and Nexar storage, and bulk refresh (B19-A I3, 2026-09-13)

- Question: DigiKey's API agreement prohibits building or updating a database from its data and bulk download, and
  states no retention period; Nexar's terms allow storage for at most 24 hours and prohibit mass aggregation. How long
  may Sirkit keep their offers, may the operator job pre-fetch pricing in bulk, and does a consolidated lifecycle status
  written to `parts` count as a database built from their data?
- Default applied: DigiKey offers are served and kept for at most **1 hour**; Nexar's at most **24 hours**; older rows are
  deleted. The `refresh-bom-pricing` bulk job touches no source (DigiKey prohibited, Nexar unclear), and logs that. The
  derived lifecycle status is left as it was, and recorded here as undecided.
- The owner may choose otherwise (for example: permit Nexar bulk refresh within its plan, or stop persisting derived
  lifecycle status).

## OD-34 — What counts as the same part number (B19-D I5b, 2026-09-13)

- Question: when a distributor answers a request for an MPN, which spellings are the same part?
- Default applied: an exact published MPN compares after trimming surrounding whitespace and upper-casing ASCII letters
  only. Every other character is significant (`MAX3232CSE+` is not `MAX3232CSE`; `LT1086CM#PBF` is not `LT1086CMPBF`). An
  MPN containing anything outside printable ASCII (zero-width or bidirectional characters, homoglyphs, a long s, full-width
  digits) never matches and is refused as an evidence identity. The manufacturer is not compared (distributor manufacturer
  names have aliases Sirkit cannot resolve yet), so two manufacturers publishing the same exact string remain one pricing
  identity.
- Also applied: prices are compared and totalled in USD only; an offer without a USD break has no unit price.
- The owner may choose otherwise (e.g. suffix-insensitive matching for specific manufacturers, or currency conversion).
- Amendment (B19-E E4, 2026-09-13): a publication links a catalog part to an exact revision only when the part's `mpn` is
  empty or IS the exact MPN (and, in review, its symbol is the draft's). A family-level link — a symbol part whose backfilled
  `mpn` is its symbol name, such as `Timer:NE555D` (mpn NE555D) to the exact part NE555DR — is refused with
  LINK_MPN_MISMATCH. This fails closed under the exact-MPN rule above; the operator seed still writes such links directly.
  The owner may choose otherwise (e.g. an explicit reviewed family-link kind).

## OD-35 — Who may declare a requirements source's authority class (B19-D I5e, 2026-09-13)

- Question: `POST /api/requirements/sources` takes the source's `authorityClass` from the authenticated caller's body. Classes
  such as `project_owner_confirmed`, `authorized_stakeholder_confirmed`, `organizational_policy` and
  `contractual_customer_source` describe WHO stands behind the source. Should the server derive the class from the caller's
  role instead of accepting it?
- Default applied: the caller (an authenticated editor or reviewer of that project, same-origin, scope-checked) still declares
  the class, and it must now be one of the defined classes. A confirmed requirement still needs the compiler's separate
  approval (`CONFIRMING_AUTHORITIES` plus an approval), and AI extraction can never confirm. Nothing is weakened; no class is
  inferred.
- The owner may choose otherwise: e.g. derive `project_owner_confirmed` only for the project owner's principal, or require a
  reviewer role for the organisational and contractual classes.

## OD-36 — May distributor observations be sent to the LLM provider? (B19-E, 2026-09-13)

- Question: DigiKey's API terms forbid providing its data to third parties, and Nexar's forbid distributing it
  (`source-registry.ts`). Sending a vendor's price, stock, description or links to the model provider may be such a disclosure.
- Default applied: every source's `license.agentDisclosure` is `unknown`. The agent's external-search and evidence tools (E6)
  return labels only — source, status, served-from, observed and expiry times, exact-match flag, conflict property names and
  the missing-evidence list — and never trigger a live vendor call. A blocked or disabled source can never be `permitted`.
- The owner may choose otherwise: set `permitted` for a source in a reviewed registry revision after confirming its terms, so
  values reach the model bounded under an untrusted key.

## OD-37 — Who holds global catalog authority? (B19-E, 2026-09-13)

- Question: the atomic catalog tables have no tenant column, and the catalog role was supplied by the caller. Who may approve,
  publish and withdraw an atomic revision that every project can bind?
- Default applied: approval, publication and withdrawal happen only in the one governance project named by
  `SIRKIT_ATOMIC_CATALOG_PROJECT_ID` (on its default branch); when unset, every such operation is refused. A reviewer approves
  and a project admin publishes or withdraws; the approver is never the publisher (an admin is not exempt); the actor is always
  a human. AAL2 step-up is not enforced (authentication strength is never checked) and is recorded as open.
- The owner may choose otherwise: e.g. per-tenant catalogs, a separate catalog-publisher role, or enforced step-up.
- Amendment (B19-E E4, 2026-09-13): the governance scope is a tenant AND a project, because the atomic catalog is shared by
  every tenant — a project id alone could be matched by another tenant's project. Both `SIRKIT_ATOMIC_CATALOG_TENANT_ID` and
  `SIRKIT_ATOMIC_CATALOG_PROJECT_ID` must be set (on the default branch); with either unset every publication operation,
  including the list, is refused with 403. A deployment must set the tenant variable before E4 publication can be used.

## OD-38 — What deprecated and superseded mean for a project (B19-E, 2026-09-13)

- Default applied: an existing pin to a deprecated or superseded revision keeps materializing, syncing and exporting, with a
  visible gap naming the successor; such revisions are excluded from new selection, new binding and link reads. A revoked
  revision fails closed everywhere.
- The owner may choose otherwise: e.g. block export of superseded revisions, or allow new binding to a deprecated one.
- Amendment (B19-E E5, 2026-09-13): "fails closed everywhere" withholds every AUTHORITY from a revoked revision (exact authority,
  new selection, binding, sync, export), but a project must still be able to move OFF it. So the pins of the revision being
  left — a replacement's current pin facts and the from side of a successor diff — are read whatever was withdrawn since (a
  "historical" read that grants nothing), while the revision moved ONTO must be published and never withdrawn. A component's
  authority names a deprecated or superseded pin with a gap naming the successor, and a revoked one with no exact authority.
  Moving to a successor is a human reviewer's or administrator's rebind of the reviewed binding (never automatic), followed by
  the existing B14 replacement of the schematic instance.
- Amendment (B19-E E5 review, 2026-09-14): a revoked revision never gets a new event, so when the successor it names is later
  withdrawn itself, the move follows the successor chain (at most 8 hops, cycle-safe) to its first published, never-withdrawn
  revision; any revision on the chain may be previewed, and only a selectable one can be rebound. Withdrawing a revision that
  others name as their successor stays allowed (a revocation must never be blocked by the revisions that point at it).

## OD-39 — May distributor values leave Sirkit? (B19-E, 2026-09-13)

- Question: the registry marks distributor values `private_review_only`, but the BOM exports are public and cache-only and
  BOM snapshots keep values indefinitely.
- Default applied: exports are unchanged apart from status, pricing-basis and license lines, per-line observation time and
  basis, and "not for redistribution" wording. No new export, snapshot or review record carries vendor values. Recorded as
  undecided, following OD-33's precedent; the B19 closeout's "no terms bypass" claim cites this decision.
- The owner may choose otherwise: require authentication for exports, blank `private_review_only` cells, or purge snapshot
  vendor fields at the source's retention.

## OD-40 — External search scope and quota sharing (B19-E, 2026-09-13)

- Default applied: project members may run keyword or exact-MPN searches in the product (at most 5 candidates per source),
  consistent with OD-31. The agent gets exact MPNs only (1–5 per call, at most 5 live MPNs per run, at most 25% of each
  source's quota window). Meters are per process, not cluster-wide.
- The owner may choose otherwise: agent keyword search, other limits, or a shared quota meter.


## OD-41 — Which MCP protocol era Sirkit implements (B20, 2026-09-17)

- Facts read at execution time: the current specification revision is 2026-07-28 (stateless, `server/discover`, multi
  round-trip requests, no protocol sessions, required `_meta` protocol fields, `resultType` on every result); the official
  TypeScript SDK 1.30.0 and the Anthropic (`mcp-client-2025-11-20`) and OpenAI (`type: "mcp"`) connectors speak the previous
  era (2025-11-25 and earlier: `initialize` handshake, `Mcp-Session-Id`, GET stream, server-initiated requests).
- Default applied: the 2026-07-28 revision is the authority path on both sides (Sirkit's client and Sirkit's server). A
  2025-11-25 compatibility path exists only where the specification's own backward-compatibility rules define it, behind its
  own flag, never as the authority path; in B20 the Sirkit server is modern-only (GET/DELETE answer 405, `Mcp-Session-Id` is
  ignored, `Last-Event-ID` is ignored), and the client falls back to the handshake era only for a server that answers a modern
  probe with an unrecognised error.
- The owner may choose otherwise: current revision only (no compatibility path), or handshake-era server support for the
  provider connectors before they adopt the current revision.

## OD-42 — MCP implementation dependency (B20, 2026-09-17)

- Default applied: no `@modelcontextprotocol/sdk` dependency. The SDK's latest release (1.30.0, no prerelease tag) cannot speak
  the current revision (it defines none of `server/discover`, `subscriptions/listen`, `InputRequiredResult`, `resultType`,
  `CacheableResult`, `Mcp-Method`), so the JSON-RPC, Streamable HTTP and authorization behaviour B20 needs is implemented in
  the repository against the specification text, on top of the existing bounded egress path and route wrappers, with fake
  servers in tests.
- The owner may choose otherwise: adopt the SDK for the compatibility era once it publishes a release that implements the
  current revision.

## OD-46 — OAuth state storage for the MCP client (B20-A0, 2026-09-17)

- Default applied: B20-A supports two credential shapes only, both read from the environment by NAME through the
  registry's secret-reference pattern (`app/lib/mcp/server-registry.ts`: auth modes `client-credentials-env` and
  `pre-issued-token-env`; `none` for a public server). No PKCE verifier, `state`, `iss`, refresh token or per-issuer client
  credential is stored anywhere: authorization-code and refresh flows and any at-rest token store are deferred to a later
  increment with an explicit owner decision. A token obtained at run time (A3) lives in process memory only.
- The owner may choose otherwise: an encrypted credential/token table, or authorization-code flows inside B20.

## OD-48 — The initial external MCP allowlist (B20-A0, 2026-09-17)

- Default applied: empty. The registry ships with zero rows, so every server id is refused (`unknown_server`) and the MCP
  client can reach nothing; the rendered artifact (`artifacts/ai-control-plane-b20/mcp-server-registry.csv`) is gated
  byte-for-byte. A server is added only by a reviewed row in a reviewed PR: id, canonical URI (RFC 8707 form, unique across
  rows) and its exact endpoint (origin — host and port — and path), supported protocol revisions, auth by environment NAME
  (no credential name referenced by two rows; a client id may be shared), `descriptorPin` (tools/list digest and `pinnedAt`) once
  the descriptor was reviewed, limits, `terms.documentationUrl` and `terms.checkedOn`, and `state.ownerDecision` naming the
  decision that admitted it. While a row's pin is null, discovery results are never trusted as pinned.
- The owner may choose otherwise: name the first approved servers (identity, canonical URL, terms) and the decision id each
  row carries.

## OD-53 — Per-process quota meters for MCP servers (B20-A0, 2026-09-17)

- Default applied: per process, as OD-40 — each server's minute window, each named tool's minute window and the server's
  breaker live in the process that runs the request (`app/lib/acquisition/admission-control.ts`); several instances can
  together exceed one server's quota, and the server's own rate limiting is the backstop. The limit is stated in the
  module header and in `mcp-client-boundary.md`. Every minute window (server and tool) has a floor of 4 requests in the
  registry so the agent's 25% share (OD-40, `floor(max × 0.25)`) is never rounded to 0 — below that the window would
  refuse the agent forever while reading as a temporary pause. No live server is enabled in B20 anyway (OD-48).
- The owner may choose otherwise: a durable shared meter before the first server is approved.

## OD-54 — The MCP feature flag (flag part; route classification decided in B20-B2) (B20-A0, 2026-09-17)

- Default applied: one server-side flag, `SIRKIT_MCP_ENABLED`, keeps both surfaces (consuming external servers and
  exposing Sirkit tools) off; only the exact value `1` enables it, compared untrimmed as `SIRKIT_DB_QUALIFICATION` is
  (`app/lib/db/test-qualification.ts`; a padded `1` does not enable — the `.env.local` loader trims unquoted file values
  before they reach the environment, so a file value needs no padding to begin with).
  `SIRKIT_MCP_DISABLED_SERVERS` names registry ids an operator forces off; it can only remove, never add. Both are read
  through the repository's environment-record pattern (`app/lib/mcp/rollout.ts`) and documented in `.env.example` without
  values. Nothing else consumes the flag in A0; the `AuthRouteClass`/`IdentitySource` for `POST /api/mcp` and the census
  move are decided and recorded in B20-B2.
- The owner may choose otherwise: one flag per surface, or a different enabling value.

## OD-59 — CI admission rule for B20 suites (B20-A0, 2026-09-17)

- Default applied: the job-scope guard (`app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts`) is generalised to a
  chapter list `["b19-", "b20-"]`: every suite whose file name carries `/b20-` must be selected by the right job — a
  PGlite-backed suite by `database-delivery`, every other one by `prompt-to-gerber` — and `app/lib/mcp` is a
  `prompt-to-gerber` directory filter, so an explicit file under it is refused by the redundancy rule.
  `app/api/mcp/__tests__` is added as a filter by the increment that creates the endpoint (B20-B2). The guard failed
  before the workflow edit and passes after it.
- The owner may choose otherwise: a separate B20 guard file, or per-suite explicit admission.

## OD-52 — How a FOREIGN MCP tool is named inside Sirkit (B20-A2, 2026-09-20)

- Default applied: a foreign tool's Sirkit-side identity is namespaced and reversible, and is never a Sirkit id. The
  internal id is `mcp.<serverId>.<name>` and the provider-facing name is `mcp_<serverId>__<name>` mapped by the existing
  `agentProviderName` function (`app/lib/agent/provider-tools.ts`, unchanged), so both carry the server the tool came
  from and both map back to exactly one `(serverId, name)`. The server's own `name` still travels on the wire and in
  `Mcp-Name`; nothing is renamed for the server. A name that spells a `sirkit.` or `mcp.` id (at any case) is refused
  outright, and one that does not fit the provider alphabet and 64 characters after the mapping, or that collides with a
  name another accepted tool or another source already holds, is EXCLUDED with a closed reason — never truncated, never
  renamed, never resolved by guessing. A foreign tool therefore can neither take nor shadow a first-party id
  (`app/lib/mcp/foreign-tools.ts`; `b20-a2-foreign-tools.test.ts`).
- This decides the FOREIGN spelling only. How Sirkit names its OWN tools when it exposes them over MCP (the raw registry
  id `sirkit.pcb.board-inspect` or the provider spelling) is decided in B20-B1, where the exposure subset is built.
- The owner may choose otherwise: a per-server alias table, or a flat namespace with a collision map.

## OD-58 — How a FOREIGN JSON Schema is validated (B20-A2, 2026-09-20)

- Default applied: in-house, no JSON Schema library and no new runtime dependency (with OD-42). A foreign `inputSchema`
  or `outputSchema` is accepted only within the PROVEN provider wire subset — the repository's existing
  `validateSchemaStructure` and `validateWireSubset` (`app/lib/agent/provider-tools.ts`), reused unchanged so the B04 and
  B09 byte-pinned artifacts cannot drift — plus explicit refusal of `$ref`, `$defs`, `$id`, `$anchor`, `$dynamicRef` and
  the other identifier keywords anywhere, of a `$schema` that is not 2020-12 or that sits anywhere but the root, of a
  property named `__proto__` / `constructor` / `prototype`, and of the bounds 32 768 serialised bytes, 8 schema levels,
  256 subschemas and 64 properties per object, each judged before the work it protects. `x-mcp-header` is the one
  extension keyword admitted, validated as the specification defines it and narrowed to string, integer and boolean
  properties. Everything else EXCLUDES the tool with a closed reason; an invalid OUTPUT schema instead keeps the tool
  without one and records the fact. Nothing is weakened, repaired or guessed, and no network `$ref` is ever
  dereferenced (the specification forbids it).
- Review (2026-09-20), the safest reading of three findings that named a decision rather than a defect: (1) an INPUT
  schema is further narrowed to what the call-time validator (`validateAgainstSchema`, unchanged) evaluates — `anyOf`,
  type arrays, `null` and `const` are refused there rather than accepted and never callable, or never enforced; (2)
  `x-mcp-header` stays off `number` and nullable properties (the Value Encoding table's null row is then unreachable,
  recorded as a limit) instead of widening the encoder; (3) a schema's own text is gated like the tool's — property
  names in a closed pattern (never a member of `Object.prototype`), enum and const strings bounded and inert, every
  description and title scanned for a directive and scrubbed, all counted (at most 1 024) before any is scanned, and a
  directive or the sent token in the OUTPUT schema excludes the tool rather than dropping the schema.
- The owner may choose otherwise: a vetted JSON Schema 2020-12 validator dependency, with the supply-chain review and
  the bounded-work qualification that would need.
