# B18 — unknowns, carried findings and owner decisions

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **RECORDED** (written down without a claim),
**UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

## 1. Unknowns and live blockers

| # | what | state | what stands in its place |
|---|---|---|---|
| U18-1 | A real model choosing these tools: a live provider writing interim and final text, calling execution tools, and the chat's entries, labels and notes under it | BLOCKED-LIVE-QUALIFICATION (LB-7, no credits) | the scripted fixture agent drives the REAL loop, gateway, minter, ritual and page through every flow; the loop's text phases and pre-run refusals are pinned with scripted providers |
| U18-2 | A ROUTED board in the browser journey (scenario 2's vias; scenario 5's routing) | BLOCKED-LIVE-QUALIFICATION (LB-8; the bundled FreeRouting runtime needs a JRE this machine does not have, and the committed recording does not cover this journey's placed board — measured: `ROUTE_FIXTURE_MISS:pcb2-d5bd2f299ef57ca0`, 2 executions recorded) | the padstack truth, the bounded via read and the routing candidate's failures are proven in unit and integration; the browser proves the reads, the answers and that nothing changed |
| U18-3 | Manufacturing qualification and release beyond their human-only gates | not attempted (LB-5) | `/api/pcb/qualify` and `/api/pcb/release` refuse a non-human actor before any durable read; no agent path reaches either (verified adversarially, §3) |

## 2. Findings carried forward (found by the closing adversarial pass, recorded rather than fixed)

Each was found by a verifier told to REFUTE a B18 claim (workflow `wf_d1783a33-a63`). The ones that were product
truthfulness defects were fixed in the chapter (see `test-and-validation-report.md` §4). These remain, with their evidence,
because fixing them would change machinery outside this chapter's scope or because they are accepted bounds.

| # | finding | evidence | judgement |
|---|---|---|---|
| F18-1 | The durable execution journal holds at most 32 entries and evicts TERMINAL entries first, falling back to the oldest entry when every one of them is unfinished — so 33 simultaneously unfinished executions in one editor would drop the oldest recovery record | `app/lib/engineering/agent-execution-journal.ts:98`, `:371-374` | ACCEPTED BOUND. The cap must do something; the policy already prefers terminal entries. Reaching it requires 32 granted executions that never settle in one editor session |
| F18-2 | `adoptProvenCommit` records `pcbRevisionAfter` from the grant's own expectation when the live revision cannot be computed, rather than refusing | `app/lib/engineering/granted-executions.ts:196-201` | RECORDED. A B18-C review-3 decision (the fill-normalized domain); the transaction id it adopts is proven from the canonical ledger, so the adoption itself is never fabricated |
| F18-3 | `applyLayoutCandidate` has no AST import gate naming its approved importers, unlike the two sealed-proposal apply controllers | `app/lib/pcb/candidates/**`; compare `app/lib/project/__tests__/b18-b-import-gates.test.ts` | RECORDED as ratchet strength, not a live path: applying a candidate still requires the human's panel action and a revision-bound, digest-sealed artifact. Worth an import gate in a later hardening pass |
| F18-4 | The name-based never-exposed patterns (`/qualif/i`, `/\.release$/`) are enforced at RUNTIME only for `mutate` candidates; for read/propose/view-session classes they live in a test-time report | `app/lib/engineering/granted-execution-families.ts:102`, `app/lib/engineering/agent-exposure.ts:80-88` | RECORDED. Not a path: the registry constructor categorically refuses an agent-exposed `release`-class tool, and a read must also appear in the hard-coded activated-read-binding allowlist. It means a slip would fail CI rather than fail closed at runtime |
| F18-5 | `PCBToolService` (the older DRC-repair AI surface, not the B18 control plane) has a dispatch case that commits an autonomous layout; it is closed today by a route-local allowlist plus an absent injected router, not by the tier machinery | `app/lib/pcb/ai/pcb-tool-service.ts:434`, `app/api/pcb/repair/agent/route.ts:17-41` | RECORDED. Out of B18's scope (that surface predates the control plane) and not reachable in any shipped composition; named here so a future composition change cannot open it silently |

## 3. Owner decisions applied in B18

OD-7 (provider credits) and OD-13 (via edits stay Tier 2) stand from earlier chapters. OD-11 and OD-15 were applied in
B18-C. This chapter's own decisions are OD-19 to OD-30 in `artifacts/remaining-builder-program/OWNER_DECISIONS.md`; every
one was applied at its recorded default and every default is reversible. The two that changed what the product does:

- **OD-13 / OD-11 re-tier.** `pcb.dimension` moved from the topology-or-geometry tier to the reversible tier so the
  runbook's PCB Tier 1 list could be honoured, and is confirmation-only even under explicit autonomy. This is the one
  tier boundary B18 moved, it was moved deliberately and recorded, and the adversarial pass named it — so it is stated
  here rather than left inside "no ratchet was loosened".
- **OD-23 (scenario 4's fixture part) was NOT taken.** The default pre-authorized a fixture-only CMOS 555; once the
  fixture runtime had the component-authority seams it was missing, the journey produced a real replacement without one,
  so no fictional part was added to the catalog. Annotated on OD-23 itself.

Everything else (OD-20 truthful no-match, OD-21 mounting-hole classification, OD-22, OD-24 no widening of layout
controls, OD-25–OD-30) was applied as recorded, and each is cited at the increment that used it.
