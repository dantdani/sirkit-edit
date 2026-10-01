# B21 - final verdict (2026-09-29)

**Verdict: PARTIAL.** Behind `SIRKIT_ORCHESTRATION_ENABLED` (off by default; with it off every chat message runs the single-agent loop
and the chat route's stream is byte-identical to B20's - E4's first-turn gate reads meters that nothing fills on a flag-off process -
while two page-side changes reach flag-off users too: the composer sends a genuine replacement request to the assistant (E4), and the
card offers no Retry for a quota or open-breaker failure (E1)), Sirkit plans complex work as an auditable, bounded DAG of zero-authority
specialists after the coordinator's first turn - each reads and, in a proposing role, seals at most one inert proposal per attempt
through its own gateway; none mutates, approves, binds, qualifies, purchases or releases - merges their results deterministically -
verifiers outrank consensus, disagreement escalates to the human (no verifier picks a winner between two sealed parties: scenario 17,
below), nothing is presented twice - and keeps simple and 3D work on one direct coordinator turn (with the flag on, a simple ask that
opens with a Tier 3 head verb used in another sense is refused with no model: OD-110's recorded cost, below). Every runbook evaluation
is proven offline through the real runtime; three of them are also proven in the browser on a flag-on fixture server (F4 and F12, F6
in part). It is PARTIAL because nothing has been qualified against a live model
(both providers BLOCKED-LIVE-QUALIFICATION: OpenAI answered 429 no-credits, Anthropic's credit state is unrecorded - LB-9), and because
several runbook clauses are met only in part by recorded decision (below).

Labels as in `README.md`: **CONFIRMED** (executed and measured), **INFERRED**, **PROPOSED**, **RECORDED**, **UNKNOWN**,
**BLOCKED-LIVE-QUALIFICATION**.

## What B21 delivers (CONFIRMED by suites on the tree; live behaviour BLOCKED-LIVE-QUALIFICATION)

1. **B21-A, canonical orchestration contracts.** Versioned, provider-neutral `SpecialistRequest` / `SpecialistResult` and run records,
   closed key sets, a structural gate that refuses what a result's STRUCTURE carries before its content is read - a tool id outside the
   permitted set, a release tool among them (`tool_request_not_permitted`), a key outside the closed set, an approval claim among them
   (`unknown_key`), and a credential-shaped value (`secret_shaped_text`); a directive written in prose is not structurally refusable: it
   passes as the specialist's own unverified claim and reaches the read-only follow-up turn - as its user message (OD-108's deviation) -
   only inside the envelope that says it is data, never instructions (F11, `b21-f-evaluation` case 11); no chain-of-thought storage,
   and the durable orchestration record (`orchestration-contracts.md`).
2. **B21-B, the task-complexity router and the bounded scheduler.** Tier 0/1 and 3D requests stay one coordinator turn; bounded proposals
   recruit only the relevant specialist; a component replacement runs circuit, sourcing, schematic and verification; manufacturing
   readiness adds deterministic checks and a reviewer, never a release agent; Tier 3 is refused with no provider call. Four specialists at
   most, one at a time, a 300 s DAG wall time, two attempts, every attempt metered (`task-complexity-router.md`).
3. **B21-C, the roles.** Nine roles declared, each a least-privilege tool subset; no specialist mutates, approves or releases; the
   coordinator cannot elevate one (`specialist-roles.md`).
4. **B21-D/D2/D3/D4, merge and disagreement.** Semantic identities and base revisions compared; stale, expired and contradicted results
   rejected; deterministic verification requested where it exists; unresolved conflicts escalated to the human (a part conflict citing
   the exact authority); majority never converted into proof; one provider counted as one source; every verdict a content-keyed,
   chained, persisted record whose view names exactly the records the store holds (D4); specialists propose through their own gateways
   (D2) and the component replacement is live for the schematic role (D3) (`merge-and-disagreement.md`, `specialist-proposals.md`,
   `specialist-replacement.md`).
5. **B21-E1..E4, providers, events, resume and the composer.** Per-role routing with truthful, schema-compatible fallback; an llm-provider
   breaker (no repeated paid retry storm; no Retry offered for quota or an open breaker; the coordinator's first turn gated, E4);
   normalized stop reasons and a strict result tool on both providers; additive run events, a status line and one trace document per
   specialist task; a route-level resume from an append-only record that replays committed work and never presents a proposal twice; the
   composer routes every genuine replacement request to the assistant (`provider-routing-and-failure.md`, `run-events-and-trace.md`,
   `route-resume.md`, `composer-and-first-turn.md`).
6. **B21-F/F2/F2b/F3, the twelve evaluations.** Offline through the production POST with the real adapters over fake SDK clients (each
   red under a mutation of its own mechanism); capsule v4 and the orchestration category pinned; the browser on a second, flag-on fixture
   server run after the existing suite (a 3D request is one coordinator turn; a routed replacement presented once or escalated with two
   sources; a presented proposal rejected, stood down and resumed with nothing presented again); the merge records a missing-evidence gap
   (F3). The model-in-loop track exists as ONE record-only command, bounded in requests, never run (OD-125) (`evaluation-matrix.md`).

The chapter's commits are listed in `changed-files.md` (160 paths across 22 first-parent commits since `main`
6fd5a7b); its suites and gates in `test-and-validation-report.md`; its decisions and open items in `unknowns-and-owner-decisions.md`.
The 165-route ratchet is unchanged at 162 canonical + 3 factories + 0 raw; every generator re-run with zero drift beyond B21's own
evaluation matrix and pins.

**Totals on the tree:** 59 B21 suites, 541 cases (58 vitest suites, 537 cases; the orchestration browser spec, 4 tests). The final
validation run at HEAD `6cff540` is recorded in `test-and-validation-report.md` section 2; CI ran green on every B21 commit but two, each
fixed by the next commit.

## What B21 does not deliver, stated plainly

- **No live qualification.** Specialist disagreement, provider fallback, quota and timeout against real models stay
  BLOCKED-LIVE-QUALIFICATION (LB-9); the record-only command has never run, and credits alone would not qualify them: it runs 4 of the
  12 cases (the task-graph capsules `f05`, `f09`, `f10`, `f11`) with every turn on one provider, reproduces no scripted fault (f09's
  stall, f10's 429 and f11's hostile results run as DAG shapes only) and can produce no disagreement or fallback - those need the
  two-provider live capsule OD-125 offers (a harness change); the other eight cases have no live path (`evaluation-matrix.md` section 3).
- **Browser tests for nine of the twelve evaluations (runbook :861).** The matrix marks them "not required" by the task; F6's browser
  proof is in part (the principal's approval and the escalation's exact-authority citation stay offline, case 6).
- **Caps in part (OD-107).** Tokens are a ceiling by construction, reported, never enforced; cost is unpriced.
- **Roles in part.** `requirements-analyst` is in no DAG and `cost-latency-router` holds no tool and never runs; full circuit creation is
  trimmed to four specialists.
- **No deterministic no-model path for Tier 0 reads** (recorded, not built); streaming has no production caller for specialists (D21-22).
- **The Tier 3 head-verb rule refuses some simple asks with no model (OD-110's recorded cost):** with the flag on, a message whose
  leading imperative is a Tier 3 verb used in another sense - "ship the schematic to my inbox" - ends `run_completed` with the fixed
  Tier 3 sentence, zero steps and no model call, so that ask is not served; every other simple ask stays one direct coordinator turn.
  The refusal is a deliberate fail-closed shortcut, never the safety boundary: no Tier 3 tool is agent-exposed
  (`orchestration/router.ts:14-19`, `task-complexity-router.md`, OD-110's amendment).
- **The breaker is armed only by metered calls (D21-42, open):** it never fires on a flag-off process, and a no-credits account whose first
  turns fail first never opens it; it is process-wide, so one tenant's traffic or no-credits answer pauses every tenant on that provider
  (OD-115's options stay with the owner).
- **A page-side rejection never reaches the run (D21-47, open):** a resume then calls the rejected action one "listed for the human, who
  decides" - nothing is applied or presented twice.
- **The merged envelope's header states the proposal bound per specialist, not per run (D21-48, open):** wording the follow-up model
  reads; a retried attempt can seal a second proposal, whose unjudged seal withholds the presentation - nothing more reaches approval.
- **Prose claims are not compared (D21-14 recorded; the prose residues of D21-15 and D21-16 recorded in their closure clauses):**
  structural part, pin, net, rule, geometry and readiness claims are.
- **Scenario 17's disagreement is never resolved to a winner (RECORDED deviation; OD-122's open question):** the runbook's scenario 17
  (:1183) asks for deterministic disagreement resolution; which way the replacement DAG goes follows the circuit specialist's choice of
  operation, not a verifier's judgement between two parties. A KiCad delete it proposes is refused `pins-unavailable` by the agent
  path's empty-pin-map compile (`gateway.ts:330`, with a peer or without one), so its task is accepted with no action, no conflict is
  recorded and the schematic specialist's replacement is presented; an edit that seals conflicts with the replacement, and both parties
  are `contradicted` and escalate to the human (`specialist-replacement.md` section 4; `b21-d3-scenario17` cases 1, 4 and 7;
  `evaluation-matrix.md`, RECORDED on F6).
- **Tracing in part (D21-12 closed in part; D21-3 counted in part):** the coordinator's own pre-invocation refusals stay untraced
  `tool_refused` events, `verification` stays free text, and no traced field carries assumptions, evidence, dissent or a correlation key;
  the coordinator's own trace, its tool calls included, stays in B11's run-local sink (INFERRED, `route.ts:437`; no production sink
  factory) - a residual of D21-3's finding that no closure clause names - while the orchestration record, the resume record and each
  specialist task's trace document are the durable ones.
- **A replayed result carries no provider or model (OD-132, open):** the runbook's B21-D asks that the merge record which
  provider/model produced each result (:843); a result record does not persist them, so on a route-level resume (E3) every replayed
  specialist result's source reads `(replayed: provenance not recorded)` in the merge's view (`merge.ts:88`) - counted with every
  other source, never as another one (`merge.ts:890-891`); a fresh run records provider and model per result.
- **Staleness and resume in part (D21-17, D21-4 RECORDED residuals):** with parallelism 1, "stale revision during parallel specialists"
  is proven across a resume; a commit that lands DURING one request's DAG is not seen by that request's merge (every apply re-verifies
  against its live head); a run cut by the refresh itself is not offered for resume.
- **OD-108's deviation stands:** the merged view reaches the read-only follow-up turn as its user message, not as a tool result.
- **Recorded, not closed:** D21-9, D21-25, D21-28, D21-29, D21-31, D21-33 and D21-35 (D21-14 above; D21-35's follow-up optional);
  two follow-ups outside B21 (D21-32, D21-34).
- **The provider documentation re-check is partial, and the propose routes' strict schemas were never checked (D21-20 counted in part,
  UNKNOWN 2):** the OpenAI API reference answered 403; its defaults, the OpenAI Agents SDK handoff mechanics and the Anthropic Agent SDK
  pages stay UNKNOWN. The propose routes (B16's, unchanged by B21) still send `strict: true` schemas carrying `maxLength` with a forced
  tool choice on both providers (`b16-0-17-2-adapter-schema-parity`), keywords the strict subset lists as unsupported; E1's policy
  (OD-116) covers the specialists' result tool only, and the planned offline `validateWireSubset` run over the propose-route schemas was
  not done - whether Anthropic accepts them stays UNKNOWN.

## Follow-ups raised to the owner during the chapter

- OpenAI reports no credits for both configured keys (2026-09-24) and Anthropic's credit state is unrecorded, so nothing that calls a
  model live could be qualified; the one record-only run (OD-125) waits for credits with a spend limit (LB-2 / LB-9) and would record
  the four DAG shapes on one provider only - live disagreement and fallback need the two-provider live capsule OD-125 offers (a harness
  change), which credits alone do not give.
- The owner questions, by number: OD-108 (the user-message deviation), OD-110 (the no-model Tier 0 read; the Tier 3 head-verb rule's
  false refusals), OD-111 (retention of the orchestration and resume records - the resume record holds the coordinator's first answer
  whole), OD-112 (option A), OD-115 (D21-42's first-turn metering and the process-wide window), OD-120 (the dormant rows; the
  cost-latency router's policy input), OD-122 (D3's loser-beside-winner question; E3's across-runs, at-least-once, stale-artifact and lease
  options), OD-125 (credits for the record-only run; the two-provider live capsule), OD-126 (the older v1 page), OD-132 (keying sources by
  provider and model; persisting them with each result record so a replay keeps them), and D21-47's two product options
  (`unknowns-and-owner-decisions.md`, last section).
- UNKNOWN 2's offline half (the propose-route schemas through `validateWireSubset`, recording the violations) is a check any later
  increment can run; its live half waits for LB-2.
- `app/page.tsx` carries 14 pre-existing react-hooks eslint errors (13 `react-hooks/refs`, 1 `react-hooks/set-state-in-effect`) on
  lines B21 did not touch (the same 14, on the same lines, at `main`: measured in the final run; CI runs no eslint); B21-E1 flagged
  them as a separate task, and a fix sits on the unmerged branch `fix/b21-page-react-hooks-refs` (`5dfae2b`), outside PR #11.
- Two follow-ups outside B21: the durable runtime reaches the OpenAI SDK through `EMBEDDING_DIMENSIONS` (D21-32) and the layout
  candidate's own `base` carries no scope (D21-34). D21-33 (the loop's closure reaches the fab presets: the scheduler takes the loop by
  injection) and D21-35 (the layout family's module reaches the executor: the verifier injected; a follow-up may move the pure verifier)
  are recorded, as their clauses close them.
- `POST /api/schematic/build-multi` stays a legacy route outside the DAG, hash-pinned; its retirement is a separate owner-approved change
  (OD-106).
- B18-E's `REPLACE_PART` stays super-linear on a self-pasted run in the user's own tab (RECORDED by B21-E4, `composer-and-first-turn.md`
  section 1; every scan E4 added is linear).

## Report lines

```
MULTI-AGENT STATUS: bounded zero-authority specialist DAG behind SIRKIT_ORCHESTRATION_ENABLED (off); simple and 3D work one coordinator turn, a Tier 3 head verb refused with no model (OD-110); the twelve B21-F evaluations proven offline through the real runtime (fake SDK clients and the scripted fixture agent, named as such), three of them also in the browser on a flag-on fixture server (F4, F12; F6 in part); live disagreement / fallback / quota / timeout BLOCKED-LIVE-QUALIFICATION under LB-9 (the model-in-loop command record-only, never run: 4 of the 12 cases on one provider, no scripted fault reproduced, no disagreement or fallback it can produce)
ROUTE RATCHET: 165 = 162 canonical + 3 factories + 0 raw (unchanged)
```
