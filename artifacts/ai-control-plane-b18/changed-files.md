# B18 — changed files
Against the chapter base `804a08d` (B17 merged in PR #7). 241 files changed, 22447 insertions(+), 400 deletions(-).

## 1. New production modules (36)

These are the chapter's mechanism. Grouped by what they are for.

**Permission tiers and autonomy (B18-A)**

- `app/api/agent/autonomy/route.ts`
- `app/lib/agent/autonomy-settings.ts`
- `app/lib/agent/autonomy-store.ts`
- `app/lib/engineering/permission-tiers.ts`

**Server-minted grants (B18-B)**

- `app/api/agent/execution-grant/route.ts`
- `app/api/agent/execution-grant/settle/route.ts`
- `app/lib/agent/execution-dispatch.ts`
- `app/lib/agent/execution-intents.ts`
- `app/lib/engineering/agent-execution-journal-idb.ts`
- `app/lib/engineering/agent-execution-journal.ts`
- `app/lib/engineering/execution-grant.ts`
- `app/lib/engineering/execution-operations.ts`
- `app/lib/engineering/explicit-request.ts`
- `app/lib/engineering/granted-execution-families.ts`
- `app/lib/engineering/granted-executions.ts`
- `app/lib/engineering/semantic-board-digest.ts`
- `app/lib/execution-grant/consume.ts`
- `app/lib/execution-grant/mint.ts`
- `app/lib/execution-grant/route-contract.ts`
- `app/lib/execution-grant/settle.ts`
- `app/lib/execution-grant/store.ts`
- `app/lib/project/execution-grant-client.ts`
- `app/lib/project/execution-grant-events.ts`
- `app/lib/project/granted-execution-controller.internal.ts`

**Chat execution UX (B18-D)**

- `app/components/chat/AutonomyModeControl.tsx`
- `app/components/chat/ExecutionEntryActions.tsx`
- `app/components/pcb/GrantedExecutionDialog.tsx`
- `app/lib/project/chat-run-view.ts`
- `app/lib/project/composer-routing.ts`
- `app/lib/project/execution-display.ts`

**Scenario work (B18-E)**

- `app/lib/agent/fixture-agent-adapter.ts`
- `app/lib/agent/layout-report.ts`
- `app/lib/fixture-runtime/blinker/authority.ts`
- `app/lib/pcb/ai/mechanical.ts`
- `app/lib/pcb/ai/vias.ts`
- `app/lib/pcb/dimensions/commands.ts`

## 2. New test files (77)

Every increment landed with the tests that prove it; the browser proof is `e2e/agent-execution.spec.ts` (29 cases) with 20 evidence screenshots under `evidence/`.

## 3. Production modules changed, not added (34)

- `app/api/chat/component-authority-runtime.ts`
- `app/api/chat/replacement-facts-runtime.ts`
- `app/api/chat/route.ts`
- `app/api/pcb/qualify/route.ts`
- `app/components/pcb/PcbEditor.tsx`
- `app/components/pcb/PcbToolbar.tsx`
- `app/components/pcb/hooks/useDimensionTool.ts`
- `app/components/pcb/inspectors/DimensionInspector.tsx`
- `app/lib/agent/adapters.ts`
- `app/lib/agent/context.ts`
- `app/lib/agent/contracts.ts`
- `app/lib/agent/evaluation-cases.ts`
- `app/lib/agent/gateway.ts`
- `app/lib/agent/loop.ts`
- `app/lib/agent/trace.ts`
- `app/lib/auth/route-policy.ts`
- `app/lib/auth/route-resource-classification.ts`
- `app/lib/engineering/action-registry.ts`
- `app/lib/engineering/action-surface.ts`
- `app/lib/engineering/agent-exposure.ts`
- `app/lib/engineering/control-registry.ts`
- `app/lib/engineering/editor-adapter.ts`
- `app/lib/engineering/replacement-proposal-assembler.ts`
- `app/lib/engineering/tool-bindings-readonly.ts`
- `app/lib/engineering/tool-catalog.ts`
- `app/lib/engineering/tool-discovery.ts`
- `app/lib/engineering/tool-registry.ts`
- `app/lib/pcb/ai/snapshot.ts`
- `app/lib/pcb/fab/manufacturing-errors.ts`
- `app/lib/pcb/proposal/bounded-edit-compiler.ts`
- `app/lib/pcb/repair/transaction.ts`
- `app/lib/project/operation-timeline.ts`
- `app/lib/prompts.ts`
- `app/page.tsx`

## 4. What is NOT in this diff

- No change to the manufacturing qualification or release routes' authority (only their human-only refusals are now
  asserted from the agent's side).
- No new HTTP route beyond B18-A's autonomy pair and B18-B's execution-grant trio: the route ratchet is unchanged at
  158 = 155 + 3 + 0 (`app/api/__tests__/b16-1c-invariant-tripwires.test.ts`).
- No schema migration and no database change: every durable record B18 adds lives in the existing durable-workflow
  repository or the browser's own journal.
