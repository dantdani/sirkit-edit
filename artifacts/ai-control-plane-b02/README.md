# B02 — Canonical Executor Kernel

Adapts the Stage 10 `EngineeringTransactionService` into the ONE canonical
execution surface future stages route mutations through, bound to the B01
action registry. Runtime behavior is unchanged: nothing in the product
imports the kernel yet, and no agent-callable mutation tool is exposed.

- Kernel: `app/lib/engineering/executor.ts`
  - `resolveExecutorContract(commandId)` — resolves a B01
    `ACTION_COVERAGE_REGISTRY` id to an executor contract (kind, approval
    tier, coverage status, mutating/executable) before anything runs.
  - `CanonicalExecutor.execute(request)` — enforces, in order:
    1. B01 contract gates: unknown command, `missing` coverage,
       non-mutating kind → rejected; `release`-tier commands are
       categorically refused (manufacturing-release authority stays with
       the MFG01 release gate); `destructive`-tier commands require an
       independent `approve_proposal` approval from a different actor;
    2. expected-revision enforcement (stale base → rejected, nothing
       applied);
    3. actor authorization and per-operation capability checks (Stage 10
       role/capability model, including AI-delegation restrictions);
    4. idempotency on `idempotencyKey` (durable replay returns the
       original result, marked `idempotent_replay`);
    5. atomic persistence (a failed commit leaves project, revision, and
       derived artifacts untouched; the same key succeeds on retry).
  - Fail-closed semantic binding: a B01 action becomes kernel-executable only
    when its coverage is `implemented` and `KERNEL_OPERATION_BINDINGS`
    explicitly permits every submitted `EngineeringOperation.kind`.
    UI-only, partial, API-only, unbound, and command/operation mismatch
    requests are rejected before transaction creation.
  - Structured `ExecutionResult`: transaction id, server sequence,
    revision before/after, affected mutation scope, change-set integrity
    digest, deterministic sorted derived-artifact invalidation summary,
    and typed rejection codes with sorted diagnostics.
- Compatibility bridge: `bridgeCurrentProjectRevision(input)` — binds a
  current-product project (board + opaque schematic + optional legacy
  `pcb2-…` semantic board revision claim) to an executor-compatible
  `ProjectRevision`. A stale claim is reported (`claimVerified: false`),
  never silently accepted. No UI handler is migrated.
- Tests: `npx vitest run app/lib/engineering/__tests__/executor-kernel.test.ts`
  — deterministic coverage for successful execution, stale revisions,
  duplicate idempotency keys, authorization rejection, validation failure,
  atomic rollback on persistence failure, durable change-set persistence
  and replay, derived-artifact invalidation, B01 contract resolution
  (unknown/missing/non-mutating/release/destructive tiers), digest
  determinism across fresh stores, and the revision bridge.

B02 deliberately does NOT migrate existing UI mutation handlers or API
routes onto the kernel and does NOT add agent mutation tools or
orchestration. All 43 mutating B01 records (see
`../ai-control-plane-b01/ui-command-toolability-matrix.csv`) continue to
execute through their current authorities; adapting them is later-stage
work.
