# B19 — final verdict

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

## Verdict

**B19 PASSES its deterministic gate.** Every runbook pass criterion is met by executed evidence on the final tree; the
findings ten adversarial reviews confirmed were fixed with tests that fail on the pre-fix code rather than argued away; and the
checks no local resource can exercise are recorded as UNKNOWN / BLOCKED-LIVE-QUALIFICATION (`unknowns-and-owner-decisions.md`
§2–§3) and do not block completed deterministic work, as the runbook's final-gate rule provides.

## Pass criteria (runbook "B19 pass criteria")

| criterion | evidence | state |
|---|---|---|
| the AI can find candidates through configured APIs | two read-only Tier 0 tools, `sirkit.parts.external-search` (exact MPNs only, at most 5 live per run, at most 25 % of a source's window, OD-40) and `sirkit.parts.evidence-read`, reach the vendors only through the one approved chat runtime boundary, the same egress path, registry and quota as a member's search; a slow vendor settles as `pending` inside the per-run cap; `b19-e-chat-external-acquisition` drives the real chat route with a scripted model against fake vendors | CONFIRMED |
| the AI can help prepare evidence | observations become candidates and evidence bundles in the quarantine pipeline (I4); the import review (E4) lets a member choose which observation to carry forward; the model receives labels only while every source's `agentDisclosure` is `unknown` (OD-36) | CONFIRMED |
| only reviewed atomic revisions control schematic/PCB authority | approval refuses sourcing-only evidence and unreviewed AI extraction (I4b); publication is two-person, human, inside one governance tenant and project (E4, OD-37); status transitions refuse AI actors and approver == publisher (E3); new selection and binding read only selectable revisions, deprecated and superseded pins keep working with a visible gap, revoked fails closed (E5, OD-38); the placement path adopts an exact revision's identity only when the value keys match (E5); the never-execution sweep and the agent exposure ratchet show no approve, publish, bind, withdraw, rebind or purchase tool | CONFIRMED |
| no secret leakage | vendor credentials never enter a URL that is logged, an error, a memo key, a page link (the Octopart `sig` exemption is host-pinned) or model-bound text (`MODEL_BOUND_SECRET_PATTERNS`, the URL-credential pattern, the anchored vendor-text scrub with a bounded prefix); failures are closed codes, never the vendor's text (I2); the live contract check logs no credential | CONFIRMED |
| no SSRF | one egress path: HTTPS only, exact-host allowlists from the registry, every resolved address checked (IPv6 read as numbers), manual redirects revalidated per hop, one deadline including DNS, bounded bodies and media types (I1); cross-verify goes through it (I2b); DNS pinning of the validated address is the recorded follow-up | CONFIRMED |
| no terms bypass | registry 1.1.0 records each vendor's documented limits, storage terms, attribution and disclosure, checked against the vendors' current documentation on the recorded dates; Mouser disabled (OD-32), LCSC blocked, DigiKey 1 h and Nexar 24 h retention enforced at write and read (OD-33), quotas and breakers per source (I3b), keyword search never feeds the pricing memo (E2) | CONFIRMED |
| no silent scraping | only registry-admitted API hosts are reachable; every external read is a member's or the agent's metered, labelled, provenance-stamped call (`servedFrom`, `retrievedAt`); nothing is fetched from a vendor page, and datasheet fetching is out of scope by decision | CONFIRMED |
| no direct purchasing | the no-purchase tripwire (`b19-e-no-purchase-tripwire`, nine reintroduction checks over the BOM workbench, the cart formats and the tool descriptors), no purchase, cart, checkout or order route or tool exists, and "Send to fab" remains the human's manufacturing release | CONFIRMED |
| `artifacts/ai-control-plane-b19/` complete | 14 artifacts: discovery, source registry (md + generated csv), acquisition boundary, quarantine pipeline, import security and its 53-row matrix, acquisition UX, changed files, unknowns and owner decisions, this validation set | CONFIRMED |
| tests with fake servers | 98 `b19-` test files, every vendor interaction against fake servers injected through the egress boundary, every model turn scripted; the full suite on the final tree: 634 files, 6,560 tests passed, 35 env-gated skips, 0 failures; tsc 0; no new eslint finding; 14 generators with zero drift on the final tree | CONFIRMED |
| optional live contract checks | `b19-e-live-contract.test.ts` exists and is opt-in; not run here (no vendor credentials in the execution environment; a run spends the operator's quota) | BLOCKED-LIVE-QUALIFICATION |
| PR / CI / merge | PR #9 opened at the chapter start so every increment got CI; two red commits, each fixed by the next; `bf88eba`, the final code commit, is green in both workflows; merged normally after green CI on the final commit, then B20 | CONFIRMED (CI); the merge follows green CI on the closeout commit |

## What B19 delivered (CONFIRMED, by checkpoint)

- **B19-A** — the versioned source registry (1.0.0 → 1.1.0), generated and gated, checked against current vendor
  documentation; connectors that enforce it; admission control with purpose shares.
- **B19-B** — one bounded, validated egress path for every acquisition call; live pricing as a granted capability; closed
  failure codes; registered quotas, circuit breakers and in-flight coalescing; the cross-verify second opinion through the same
  path.
- **B19-C** — the quarantine pipeline: observation, candidate, evidence bundle; approval that rests only on
  engineering-authoritative evidence; exact-MPN identity (OD-34).
- **B19-D** — import security and licensing: license at export; 53 matrix rows closed across the acquisition path, output
  injection, KiCad parsing and atomic integrity, project imports, BOM tables, DSN tokens and what reaches a model; four
  adversarial reviews.
- **B19-E** — truthful pricing provenance and per-source status in the BOM workbench and packets (E1); bounded external
  candidate search for members (E2); exact-revision integrity at the durable atomic boundary (E3); import candidate review and
  two-person human publication (E4); revision lifecycle, successor rebind and exact-revision adoption (E5); two bounded
  read-only agent tools through one approved runtime boundary (E6) — each reviewed adversarially.
- **Validation** — this artifact set; every unknown, blocker and follow-up recorded with its increment rather than closed by
  assertion.

## What is not claimed

- No live vendor has been called from this environment; every proof uses fake servers behind the real boundary. The optional
  live contract check is written and opt-in.
- No live model has driven the agent tools; the chat proofs use scripted adapters through the real chat route.
- No browser run in this chapter; the new panels are proven by component tests, and CI's browser job runs the committed specs.
- OD-39 (whether distributor values may leave Sirkit in exports) is undecided; exports carry labels, not new values.
- The follow-ups in `unknowns-and-owner-decisions.md` §4 are open observations with their increment and reason, not fixes.

## Next

B19 merges normally into `main` (PR #9) once CI is green on the final commit, and the program continues to B20 — MCP
consumption and Sirkit MCP exposure.
