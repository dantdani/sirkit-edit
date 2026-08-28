# B12.1 — changed files and symbols

## New production modules

| Path | Contents |
| --- | --- |
| `app/lib/engineering/project-commit-interlock.ts` | §B — `ProjectCommitInterlock` (`acquireCommitLease`, `retire`, `retired`, `busy`), `CommitLease`, `CommitLeaseAcquisition` |

## Rewritten production modules

| Path | Changes |
| --- | --- |
| `app/lib/engineering/approved-agent-mutations.ts` | §A/§B/§C/§D rewrite. New: `APPROVED_TIER1_APPLY_LABEL`, `ApprovedApplyExecutionGateway`, `approvedMutationIdentityKey`, capture-first `captureAndAuthenticateProposal` (private), identity schema `sirkit.approved-mutation-identity.v2`, `receiptIdFor` (private, shared mint/validate), refusal codes `editor-busy` and `session-superseded`. Changed: `ApprovedTier1ApplyInput` — `currentState` REMOVED; `gateway` REQUIRED; `interlock`/`stillCurrent` added. `ApprovedMutationRegistry` re-keyed to identity strings (claim/release/consume/poison/peek now take `identityKey: string`). `validateApprovedMutationReceipt` rewritten capture-first with receiptId recomputation. `applyApprovedTier1Proposal` restructured around the gateway job with adoption-gated finalization and lease handling. Receipt schema id, field set, audit schema, and audit event vocabulary unchanged (refusal vocabulary extended by the two new codes). |

## Modified production modules

| Path | Changes |
| --- | --- |
| `app/lib/engineering/schematic-proposals.ts` | `verifySealedTier1ProposalIntegrity` extracted (wrong-version/malformed/altered-ops/altered-id — integrity only); `verifySealedTier1Proposal` now calls it first, then currency checks. One ordering nuance: the expectedScope-well-formed check now runs AFTER the altered checks (an artifact that is both altered and scope-less reports `altered`). No check weakened; every code preserved. |
| `app/page.tsx` | §F/§B wiring. `applyTier1Proposal`: passes `gateway: gestureCoordinatorRef.current`, `interlock: commitInterlockRef.current`, `stillCurrent: () => scope.isCurrent()`; no longer passes `currentState` (the coordinator supplies the base at execution position); keeps the dialog for `editor-busy` as well as `already-in-flight`; `currentSchematicState` dropped from the callback deps (no longer used there). `hydrateProject`: retires the prior `ProjectCommitInterlock` first — synchronously when idle, deferred re-entry via `hydrateProjectRef` when an approved commit lease is held — and creates the new incarnation's interlock beside the new session. New refs: `commitInterlockRef`, `hydrateProjectRef`. New import: `ProjectCommitInterlock`. |

## Updated tests

| Path | Changes |
| --- | --- |
| `app/lib/engineering/__tests__/b12-approved-mutation.test.ts` | Harness gains the real-coordinator `editorUi` composition + interlock; every apply flows through the gateway; registry assertions use `approvedMutationIdentityKey`; not-ready case wires its own gateway. All 19 assertions preserved or strengthened — none loosened. |
| `app/lib/engineering/__tests__/b12-boundary-and-e2e.test.ts` | §H flows updated to the gateway contract and now assert coordinator-adopted visible state + history entries (the "displayed schematic" is genuinely displayed). §G boundary scans unchanged. |

## New tests

| Path | Tests |
| --- | --- |
| `app/lib/engineering/__tests__/b12-1-adoption-identity-receipt.test.ts` | 15 |
| `app/lib/engineering/__tests__/b12-1-lifecycle-interlock.test.ts` | 7 |
| `app/lib/engineering/__tests__/b12-1-production-integration.test.ts` | 5 |

## Artifacts

- NEW `artifacts/ai-control-plane-b12-1/` (10 documents).
- Supersession notes added to `artifacts/ai-control-plane-b12/`: README.md,
  approved-execution-contract.md, concurrency-and-idempotency-matrix.md,
  execution-receipt-schema.md, scope-hydration-recovery-matrix.md,
  agent-to-canonical-transaction-sequence.md, validation-summary.md
  (historical content preserved unchanged).

## Explicitly NOT changed

`app/lib/pcb/types.ts`, `app/lib/agent/generated/pcb-shape-descriptor.ts`,
all B11 replay pins/artifacts, the nine-tool provider exposure, the agent
gateway/loop/registry, the chat route, the interactive channel and its
four approved importers, provider configuration. The protected original
`C:\Users\robsa\sirkit` was never touched.
