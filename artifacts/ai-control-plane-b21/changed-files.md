# B21 - changed files

Every path changed on `chapter/b21-specialist-orchestration` since `main` (6fd5a7b): 160 files (114 added, 46 modified, 0 deleted) across 22 first-parent commits. The commit column names the first commit on the branch that touched the path; the subject says which increment.

## `(root)` (5)

| status | path | first touched by |
|---|---|---|
| M | `.gitignore` | `3cd7e0a` B21-F2: the browser spec on its own flag-on Playwright config, run after the existing suit |
| M | `app/lib/ai-preferences.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| M | `app/page.tsx` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `e2e-orchestration/specialist-orchestration.spec.ts` | `3cd7e0a` B21-F2: the browser spec on its own flag-on Playwright config, run after the existing suit |
| A | `playwright.orchestration.config.ts` | `3cd7e0a` B21-F2: the browser spec on its own flag-on Playwright config, run after the existing suit |

## `.github` (1)

| status | path | first touched by |
|---|---|---|
| M | `.github/workflows/deterministic-manufacturing.yml` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |

## `app/api/chat` (11)

| status | path | first touched by |
|---|---|---|
| M | `app/api/chat/__tests__/b19-d-external-text-injection-route.test.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/api/chat/__tests__/b21-b-chat-router.test.ts` | `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, |
| A | `app/api/chat/__tests__/b21-d-chat-merge.test.ts` | `21ae845` B21-D: merge and disagreement - the deterministic merge layer |
| A | `app/api/chat/__tests__/b21-d2-chat-proposals.test.ts` | `d5d3f05` B21-D2: specialists propose through their existing tools; provenance is the gateway's own  |
| A | `app/api/chat/__tests__/b21-d3-chat-replacement.test.ts` | `a4aba95` B21-D3: the replacement live for specialists; scenario 17's disagreement structural |
| A | `app/api/chat/__tests__/b21-e1-chat-provider.test.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/api/chat/__tests__/b21-e2-chat-events.test.ts` | `e19033f` B21-E2 (1/2): the additive run events and the status line; the trace block held |
| A | `app/api/chat/__tests__/b21-e3-chat-resume.test.ts` | `fafc90e` B21-E3: the route-level resume and the userMessageDigest ledger |
| A | `app/api/chat/__tests__/b21-e4-chat-first-turn.test.ts` | `d03f182` B21-E4: the composer's kind swap and the coordinator's first turn behind the breaker |
| A | `app/api/chat/orchestration-runtime.ts` | `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, |
| M | `app/api/chat/route.ts` | `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, |

## `app/lib/acquisition` (2)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/acquisition/__tests__/b19-e-ci-job-scope.test.ts` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| M | `app/lib/acquisition/admission-control.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |

## `app/lib/agent` (10)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/agent/__tests__/b09-2-closure.test.ts` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |
| M | `app/lib/agent/__tests__/b09-3-closure.test.ts` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |
| M | `app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| M | `app/lib/agent/__tests__/b11-4-capture-ownership.test.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| M | `app/lib/agent/adapters.ts` | `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, |
| M | `app/lib/agent/contracts.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| M | `app/lib/agent/fixture-agent-adapter.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| M | `app/lib/agent/loop.ts` | `5f1b498` B21-C: the nine roles, least-privilege tool subsets per role, the no-elevation proof |
| M | `app/lib/agent/replay-capsule.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| M | `app/lib/agent/run-consumer.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |

## `app/lib/agent/orchestration` (74)

| status | path | first touched by |
|---|---|---|
| A | `app/lib/agent/orchestration/__tests__/_d2-fixtures.ts` | `d5d3f05` B21-D2: specialists propose through their existing tools; provenance is the gateway's own  |
| A | `app/lib/agent/orchestration/__tests__/_d3-fixtures.ts` | `a4aba95` B21-D3: the replacement live for specialists; scenario 17's disagreement structural |
| A | `app/lib/agent/orchestration/__tests__/_d3-router-corpus.ts` | `a4aba95` B21-D3: the replacement live for specialists; scenario 17's disagreement structural |
| A | `app/lib/agent/orchestration/__tests__/_e1-fixtures.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/lib/agent/orchestration/__tests__/_e2-fixtures.ts` | `e19033f` B21-E2 (1/2): the additive run events and the status line; the trace block held |
| A | `app/lib/agent/orchestration/__tests__/_f-capsules.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| A | `app/lib/agent/orchestration/__tests__/_f-cases.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| A | `app/lib/agent/orchestration/__tests__/_f-fixture-clients.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| A | `app/lib/agent/orchestration/__tests__/_fixtures.ts` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| A | `app/lib/agent/orchestration/__tests__/_merge-fixtures.ts` | `21ae845` B21-D: merge and disagreement - the deterministic merge layer |
| A | `app/lib/agent/orchestration/__tests__/_result-tool.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/lib/agent/orchestration/__tests__/_role-fixtures.ts` | `5f1b498` B21-C: the nine roles, least-privilege tool subsets per role, the no-elevation proof |
| A | `app/lib/agent/orchestration/__tests__/_seal-relay.ts` | `d5d3f05` B21-D2: specialists propose through their existing tools; provenance is the gateway's own  |
| A | `app/lib/agent/orchestration/__tests__/_sealed-artifacts.ts` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| A | `app/lib/agent/orchestration/__tests__/b21-a-contracts.test.ts` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| A | `app/lib/agent/orchestration/__tests__/b21-a-import-gates.test.ts` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| A | `app/lib/agent/orchestration/__tests__/b21-a-page.test.ts` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| A | `app/lib/agent/orchestration/__tests__/b21-a-store.test.ts` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| A | `app/lib/agent/orchestration/__tests__/b21-b-page.test.ts` | `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, |
| A | `app/lib/agent/orchestration/__tests__/b21-b-router.test.ts` | `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, |
| A | `app/lib/agent/orchestration/__tests__/b21-b-scheduler.test.ts` | `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, |
| A | `app/lib/agent/orchestration/__tests__/b21-c-least-privilege.test.ts` | `5f1b498` B21-C: the nine roles, least-privilege tool subsets per role, the no-elevation proof |
| A | `app/lib/agent/orchestration/__tests__/b21-c-no-elevation.test.ts` | `5f1b498` B21-C: the nine roles, least-privilege tool subsets per role, the no-elevation proof |
| A | `app/lib/agent/orchestration/__tests__/b21-c-page.test.ts` | `5f1b498` B21-C: the nine roles, least-privilege tool subsets per role, the no-elevation proof |
| A | `app/lib/agent/orchestration/__tests__/b21-c-role-tools.test.ts` | `5f1b498` B21-C: the nine roles, least-privilege tool subsets per role, the no-elevation proof |
| A | `app/lib/agent/orchestration/__tests__/b21-closeout-statements.test.ts` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |
| A | `app/lib/agent/orchestration/__tests__/b21-d-merge.test.ts` | `21ae845` B21-D: merge and disagreement - the deterministic merge layer |
| A | `app/lib/agent/orchestration/__tests__/b21-d-page.test.ts` | `21ae845` B21-D: merge and disagreement - the deterministic merge layer |
| A | `app/lib/agent/orchestration/__tests__/b21-d-verification-requests.test.ts` | `21ae845` B21-D: merge and disagreement - the deterministic merge layer |
| A | `app/lib/agent/orchestration/__tests__/b21-d2-approval.test.ts` | `d5d3f05` B21-D2: specialists propose through their existing tools; provenance is the gateway's own  |
| A | `app/lib/agent/orchestration/__tests__/b21-d2-page.test.ts` | `d5d3f05` B21-D2: specialists propose through their existing tools; provenance is the gateway's own  |
| A | `app/lib/agent/orchestration/__tests__/b21-d2-proposing-roles.test.ts` | `d5d3f05` B21-D2: specialists propose through their existing tools; provenance is the gateway's own  |
| A | `app/lib/agent/orchestration/__tests__/b21-d2-provenance.test.ts` | `d5d3f05` B21-D2: specialists propose through their existing tools; provenance is the gateway's own  |
| A | `app/lib/agent/orchestration/__tests__/b21-d3-page.test.ts` | `a4aba95` B21-D3: the replacement live for specialists; scenario 17's disagreement structural |
| A | `app/lib/agent/orchestration/__tests__/b21-d3-pin-facts.test.ts` | `a4aba95` B21-D3: the replacement live for specialists; scenario 17's disagreement structural |
| A | `app/lib/agent/orchestration/__tests__/b21-d3-replacement-roles.test.ts` | `a4aba95` B21-D3: the replacement live for specialists; scenario 17's disagreement structural |
| A | `app/lib/agent/orchestration/__tests__/b21-d3-scenario17.test.ts` | `a4aba95` B21-D3: the replacement live for specialists; scenario 17's disagreement structural |
| A | `app/lib/agent/orchestration/__tests__/b21-d4-merge-records.test.ts` | `b52a26a` B21-D4: the merge's view names the records the store holds (D21-46) |
| A | `app/lib/agent/orchestration/__tests__/b21-e1-fallback.test.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/lib/agent/orchestration/__tests__/b21-e1-page.test.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/lib/agent/orchestration/__tests__/b21-e1-provider-breaker.test.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/lib/agent/orchestration/__tests__/b21-e1-provider-policy.test.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/lib/agent/orchestration/__tests__/b21-e1-result-tool.test.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/lib/agent/orchestration/__tests__/b21-e1-retry-card.test.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/lib/agent/orchestration/__tests__/b21-e1-stop-reasons.test.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/lib/agent/orchestration/__tests__/b21-e2-page.test.ts` | `e19033f` B21-E2 (1/2): the additive run events and the status line; the trace block held |
| A | `app/lib/agent/orchestration/__tests__/b21-e2-run-events.test.ts` | `e19033f` B21-E2 (1/2): the additive run events and the status line; the trace block held |
| A | `app/lib/agent/orchestration/__tests__/b21-e2-run-view.test.ts` | `e19033f` B21-E2 (1/2): the additive run events and the status line; the trace block held |
| A | `app/lib/agent/orchestration/__tests__/b21-e2b-page.test.ts` | `b4a0ec5` B21-E2 (2/2): the trace block - one trace document per specialist task |
| A | `app/lib/agent/orchestration/__tests__/b21-e2b-task-identity.test.ts` | `b4a0ec5` B21-E2 (2/2): the trace block - one trace document per specialist task |
| A | `app/lib/agent/orchestration/__tests__/b21-e2b-trace-attribution.test.ts` | `b4a0ec5` B21-E2 (2/2): the trace block - one trace document per specialist task |
| A | `app/lib/agent/orchestration/__tests__/b21-e3-page.test.ts` | `fafc90e` B21-E3: the route-level resume and the userMessageDigest ledger |
| A | `app/lib/agent/orchestration/__tests__/b21-e3-resume-offer.test.ts` | `fafc90e` B21-E3: the route-level resume and the userMessageDigest ledger |
| A | `app/lib/agent/orchestration/__tests__/b21-e3-resume-record.test.ts` | `fafc90e` B21-E3: the route-level resume and the userMessageDigest ledger |
| A | `app/lib/agent/orchestration/__tests__/b21-e3-resume-runtime.test.ts` | `fafc90e` B21-E3: the route-level resume and the userMessageDigest ledger |
| A | `app/lib/agent/orchestration/__tests__/b21-e4-first-turn.test.ts` | `d03f182` B21-E4: the composer's kind swap and the coordinator's first turn behind the breaker |
| A | `app/lib/agent/orchestration/__tests__/b21-e4-page.test.ts` | `d03f182` B21-E4: the composer's kind swap and the coordinator's first turn behind the breaker |
| A | `app/lib/agent/orchestration/__tests__/b21-e4-replacement-grammar.test.ts` | `d03f182` B21-E4: the composer's kind swap and the coordinator's first turn behind the breaker |
| A | `app/lib/agent/orchestration/__tests__/b21-f-evaluation.test.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| A | `app/lib/agent/orchestration/__tests__/b21-f-page.test.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| A | `app/lib/agent/orchestration/__tests__/b21-f-replay-capsule.test.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| A | `app/lib/agent/orchestration/__tests__/b21-f2b-follow-up-failure.test.ts` | `d8680ea` B21-F2b: the browser half of human rejection and resume (D21-45) |
| A | `app/lib/agent/orchestration/__tests__/b21-f3-evidence-gap.test.ts` | `9d2014a` B21-F3: the merge records the evidence gap (D21-44) |
| A | `app/lib/agent/orchestration/contracts.ts` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| A | `app/lib/agent/orchestration/merge.ts` | `21ae845` B21-D: merge and disagreement - the deterministic merge layer |
| A | `app/lib/agent/orchestration/provider-policy.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/lib/agent/orchestration/result-tool.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `app/lib/agent/orchestration/role-tools.ts` | `5f1b498` B21-C: the nine roles, least-privilege tool subsets per role, the no-elevation proof |
| A | `app/lib/agent/orchestration/router.ts` | `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, |
| A | `app/lib/agent/orchestration/run-events.ts` | `e19033f` B21-E2 (1/2): the additive run events and the status line; the trace block held |
| A | `app/lib/agent/orchestration/scheduler.ts` | `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, |
| A | `app/lib/agent/orchestration/store.ts` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| A | `app/lib/agent/orchestration/trace-attribution.ts` | `b4a0ec5` B21-E2 (2/2): the trace block - one trace document per specialist task |
| A | `app/lib/agent/orchestration/tripwires.ts` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |

## `app/lib/auth` (1)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/auth/route-handlers.ts` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |

## `app/lib/engineering` (1)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/engineering/__tests__/b07-5-async-ownership-closure.test.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |

## `app/lib/llm` (4)

| status | path | first touched by |
|---|---|---|
| A | `app/lib/llm/anthropic-config.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| M | `app/lib/llm/anthropic-provider.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| M | `app/lib/llm/openai-config.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| M | `app/lib/llm/openai-provider.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |

## `app/lib/mcp` (1)

| status | path | first touched by |
|---|---|---|
| M | `app/lib/mcp/__tests__/b20-a0-admission-by-server-and-tool.test.ts` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |

## `app/lib/project` (3)

| status | path | first touched by |
|---|---|---|
| A | `app/lib/project/__tests__/b21-e4-composer-routing.test.ts` | `d03f182` B21-E4: the composer's kind swap and the coordinator's first turn behind the breaker |
| M | `app/lib/project/chat-run-view.ts` | `e19033f` B21-E2 (1/2): the additive run events and the status line; the trace block held |
| M | `app/lib/project/composer-routing.ts` | `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, |

## `artifacts/ai-control-plane-b11` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b11/deterministic-replay-contract.md` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |

## `artifacts/ai-control-plane-b11-1` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b11-1/replay-capsule-validation.md` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |

## `artifacts/ai-control-plane-b11-2` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b11-2/replay-context-schema.md` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |

## `artifacts/ai-control-plane-b11-3` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b11-3/regression-matrix.md` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |

## `artifacts/ai-control-plane-b11-4` (3)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b11-4/README.md` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| M | `artifacts/ai-control-plane-b11-4/immutable-replay-ownership.md` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| M | `artifacts/ai-control-plane-b11-4/regression-matrix.md` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |

## `artifacts/ai-control-plane-b11-5` (2)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b11-5/README.md` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| M | `artifacts/ai-control-plane-b11-5/validation-summary.md` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |

## `artifacts/ai-control-plane-b11-6` (2)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b11-6/README.md` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| M | `artifacts/ai-control-plane-b11-6/validation-summary.md` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |

## `artifacts/ai-control-plane-b11-7` (2)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b11-7/README.md` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| M | `artifacts/ai-control-plane-b11-7/validation-summary.md` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |

## `artifacts/ai-control-plane-b18` (1)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b18/chat-execution-ux.md` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |

## `artifacts/ai-control-plane-b20` (2)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/ai-control-plane-b20/mcp-client-boundary.md` | `0396c9e` B21-B follow-up: the B20 page citations B shifted (CI on b3d168b) |
| M | `artifacts/ai-control-plane-b20/mcp-provider-connectors.md` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |

## `artifacts/ai-control-plane-b21` (25)

| status | path | first touched by |
|---|---|---|
| A | `artifacts/ai-control-plane-b21/README.md` | `d86e9a7` B21 discovery: adaptive provider-neutral specialist-agent orchestration on the single-agen |
| A | `artifacts/ai-control-plane-b21/closeout-statements.md` | `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36 |
| A | `artifacts/ai-control-plane-b21/composer-and-first-turn.md` | `d03f182` B21-E4: the composer's kind swap and the coordinator's first turn behind the breaker |
| A | `artifacts/ai-control-plane-b21/discovery.md` | `d86e9a7` B21 discovery: adaptive provider-neutral specialist-agent orchestration on the single-agen |
| A | `artifacts/ai-control-plane-b21/evaluation-matrix.csv` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| A | `artifacts/ai-control-plane-b21/evaluation-matrix.json` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| A | `artifacts/ai-control-plane-b21/evaluation-matrix.md` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| A | `artifacts/ai-control-plane-b21/evidence/f12-presented-rejected-stood-down.png` | `d8680ea` B21-F2b: the browser half of human rejection and resume (D21-45) |
| A | `artifacts/ai-control-plane-b21/evidence/f12-resume-nothing-presented-again.png` | `d8680ea` B21-F2b: the browser half of human rejection and resume (D21-45) |
| A | `artifacts/ai-control-plane-b21/evidence/f12-resume-offer-after-stop.png` | `3cd7e0a` B21-F2: the browser spec on its own flag-on Playwright config, run after the existing suit |
| A | `artifacts/ai-control-plane-b21/evidence/f12-resumed-run-finished.png` | `3cd7e0a` B21-F2: the browser spec on its own flag-on Playwright config, run after the existing suit |
| A | `artifacts/ai-control-plane-b21/evidence/f4-view3d-one-coordinator-turn.png` | `3cd7e0a` B21-F2: the browser spec on its own flag-on Playwright config, run after the existing suit |
| A | `artifacts/ai-control-plane-b21/evidence/f6-disagreement-escalated-nothing-presented.png` | `3cd7e0a` B21-F2: the browser spec on its own flag-on Playwright config, run after the existing suit |
| A | `artifacts/ai-control-plane-b21/evidence/f6-verifier-decides-presented-once.png` | `3cd7e0a` B21-F2: the browser spec on its own flag-on Playwright config, run after the existing suit |
| A | `artifacts/ai-control-plane-b21/merge-and-disagreement.md` | `21ae845` B21-D: merge and disagreement - the deterministic merge layer |
| A | `artifacts/ai-control-plane-b21/orchestration-contracts.md` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| A | `artifacts/ai-control-plane-b21/provider-reference-notes.md` | `d86e9a7` B21 discovery: adaptive provider-neutral specialist-agent orchestration on the single-agen |
| A | `artifacts/ai-control-plane-b21/provider-routing-and-failure.md` | `deac588` B21-E1: provider routing and failure behaviour - the provider layer |
| A | `artifacts/ai-control-plane-b21/replay-trace-pins-b21.json` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| A | `artifacts/ai-control-plane-b21/route-resume.md` | `fafc90e` B21-E3: the route-level resume and the userMessageDigest ledger |
| A | `artifacts/ai-control-plane-b21/run-events-and-trace.md` | `e19033f` B21-E2 (1/2): the additive run events and the status line; the trace block held |
| A | `artifacts/ai-control-plane-b21/specialist-proposals.md` | `d5d3f05` B21-D2: specialists propose through their existing tools; provenance is the gateway's own  |
| A | `artifacts/ai-control-plane-b21/specialist-replacement.md` | `a4aba95` B21-D3: the replacement live for specialists; scenario 17's disagreement structural |
| A | `artifacts/ai-control-plane-b21/specialist-roles.md` | `5f1b498` B21-C: the nine roles, least-privilege tool subsets per role, the no-elevation proof |
| A | `artifacts/ai-control-plane-b21/task-complexity-router.md` | `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, |

## `artifacts/remaining-builder-program` (4)

| status | path | first touched by |
|---|---|---|
| M | `artifacts/remaining-builder-program/EXECUTION_LEDGER.md` | `d86e9a7` B21 discovery: adaptive provider-neutral specialist-agent orchestration on the single-agen |
| M | `artifacts/remaining-builder-program/LIVE_BLOCKERS.md` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| M | `artifacts/remaining-builder-program/OWNER_DECISIONS.md` | `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gat |
| M | `artifacts/remaining-builder-program/PROGRAM_STATE.json` | `d86e9a7` B21 discovery: adaptive provider-neutral specialist-agent orchestration on the single-agen |

## `scripts` (2)

| status | path | first touched by |
|---|---|---|
| A | `scripts/generate-b21-artifacts.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |
| A | `scripts/run-b21-live-orchestration-evaluation.ts` | `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtim |

## Commits, first-parent order

- `d86e9a7` B21 discovery: adaptive provider-neutral specialist-agent orchestration on the single-agent loop
- `5677b15` B21 discovery: section 9, the trace-attribution suite path stated as verified, not corrected
- `4b6d0e2` B21-A: canonical orchestration contracts, the durable orchestration record, the import gate, CI admission, LB-9
- `b3d168b` B21-B: the task-complexity router, the no-provider path, the bounded sequential scheduler, the store binding
- `0396c9e` B21-B follow-up: the B20 page citations B shifted (CI on b3d168b)
- `5f1b498` B21-C: the nine roles, least-privilege tool subsets per role, the no-elevation proof
- `21ae845` B21-D: merge and disagreement - the deterministic merge layer
- `d5d3f05` B21-D2: specialists propose through their existing tools; provenance is the gateway's own seal
- `a4aba95` B21-D3: the replacement live for specialists; scenario 17's disagreement structural
- `deac588` B21-E1: provider routing and failure behaviour - the provider layer
- `3a32317` B21-D3 follow-up: the router grammar's sixth adversarial sweep round
- `e19033f` B21-E2 (1/2): the additive run events and the status line; the trace block held
- `41330e6` B21-E2 (1/2) fix: restore the D21-22 clause's quoted title; the discovery section-0 note
- `b4a0ec5` B21-E2 (2/2): the trace block - one trace document per specialist task
- `fafc90e` B21-E3: the route-level resume and the userMessageDigest ledger
- `d03f182` B21-E4: the composer's kind swap and the coordinator's first turn behind the breaker
- `513d69a` B21-F: the required evaluations - the twelve runbook cases offline through the real runtime
- `3cd7e0a` B21-F2: the browser spec on its own flag-on Playwright config, run after the existing suite
- `9d2014a` B21-F3: the merge records the evidence gap (D21-44)
- `b52a26a` B21-D4: the merge's view names the records the store holds (D21-46)
- `d8680ea` B21-F2b: the browser half of human rejection and resume (D21-45)
- `6cff540` B21 closeout (1/2): supersede the standing single-agent statements (D21-27), retire D21-36

## The closeout commit itself

Generated at HEAD `6cff540`, before the closeout's commit 2/2, so the table above does not list what that commit adds: this file,
`test-and-validation-report.md`, `unknowns-and-owner-decisions.md`, `final-verdict.md` and the README's validation row (with the lead's
ledger entry and `PROGRAM_STATE.json`). Every first-touching commit in the tables was checked against
`git log --reverse 6fd5a7b..HEAD -- <path>` (160 of 160 agree); the branch is linear (22 first-parent commits, 22 commits).
