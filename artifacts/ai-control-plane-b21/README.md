# B21 — Adaptive provider-neutral specialist-agent orchestration (`chapter/b21-specialist-orchestration`)

Labels: **CONFIRMED** (executed and measured), **INFERRED** (code reading), **PROPOSED** (designed, not exercised),
**RECORDED** (written down without a claim), **UNKNOWN**, **BLOCKED-LIVE-QUALIFICATION**.

Base: `6fd5a7b` (B20 merged normally in PR #10, 2026-09-24; verdict PARTIAL — inert proposals over MCP deferred, OD-87). Mission:
a task-adaptive specialist graph ON TOP of the proven single-agent tool loop. No unconditional swarm: simple commands stay fast and
direct on the existing path; complex design changes may recruit specialists whose outputs are structured proposals and evidence, never
authority. Specialists cannot mutate, approve or release; the coordinator cannot elevate a specialist; deterministic validation
outranks consensus; provider fallback is truthful; no chain-of-thought is stored.

References re-read at execution time (2026-09-24, recorded in `discovery.md` §1.2 and `provider-reference-notes.md`): the official
OpenAI Responses / function-calling / streaming / background / Agents pages now live under `developers.openai.com/api/docs`, the
Anthropic Messages / tool-use / strict-tool-use / structured-outputs / streaming / batches pages under `platform.claude.com/docs`, and
the Anthropic Agent SDK pages under `code.claude.com` (not fetched); the hosts the runbook names redirect or answer 403.

| checkpoint | artifact | state |
|---|---|---|
| discovery | `discovery.md` (six read-only readers over the loop, the provider adapters, traces/replay/durability, sealed artifacts and verification, tools and roles, tests/CI/UI/obligations — 214 facts, 59 gap candidates merged into D21-1..31 — one synthesizer, the lead's reconciliation in §9); `provider-reference-notes.md` (the dated provider facts, OD-118) | RECORDED / INFERRED — every defect-bearing fact re-read in the code by the synthesizer and spot-checked by the lead; to be confirmed by reproduction in the first increment |
| B21-A canonical orchestration contracts, the durable record, CI, LB-9 | planned (`orchestration-contracts.md`) | planned |
| B21-B task-complexity router, the no-provider path, the bounded scheduler | planned (`task-complexity-router.md`) | planned |
| B21-C roles, least-privilege subsets, the elevation proof | planned (`specialist-roles.md`) | planned |
| B21-D merge and disagreement | planned (`merge-and-disagreement.md`) | planned |
| B21-E provider routing, breakers, degraded modes, the trace block | planned (`provider-routing-and-failure.md`) | planned |
| B21-F evaluations (offline fake-provider, model-in-loop record-only, browser) | planned (`evaluation-matrix.{csv,json}`, `evidence/`) | planned |
| validation | `test-and-validation-report.md`, `changed-files.md`, `unknowns-and-owner-decisions.md`, `final-verdict.md` | planned |

Owner decisions: OD-106 onward (28 drafted in `discovery.md` §6 with a safe default each; recorded in
`artifacts/remaining-builder-program/OWNER_DECISIONS.md` by the increment that applies each); OD-83..86 and OD-88 stay reserved for the
B22-B proposal reversal.
