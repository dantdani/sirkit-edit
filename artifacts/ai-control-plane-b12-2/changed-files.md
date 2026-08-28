# B12.2 — changed files and symbols

## New production modules

| Path | Contents |
| --- | --- |
| `app/lib/engineering/project-transition-coordinator.ts` | §A — `ProjectTransitionCoordinator` (`request`, `currentInterlock`, `transitionPending`, `cancelPending`, `dispose`; `beforeInstall` hook; monotonic request identity; latest-wins; retirement barrier over `ProjectCommitInterlock.retire()`) |
| `app/lib/project/canonical-adoption.ts` | §C — `adoptCanonicalResult` + `CanonicalAdoptionHost` (the ONE synchronous production adoption sequence: flush → projection → ONE history record → view → watcher suppression → autosave; total, never throws) |

## Modified production modules

| Path | Changes |
| --- | --- |
| `app/lib/engineering/schematic-session.ts` | §B — new narrow READ-ONLY `scopeIdentity()` accessor (tenant/project/branch/lineage/lifecycle; lineageId null before a lineage opens). No other change. |
| `app/lib/engineering/approved-agent-mutations.ts` | §B — the consumed-registry branch now verifies the LIVE session identity + current scope token against the sealed scope before returning a receipt (retired → `session-not-ready`; stale scope → `session-superseded`; identity mismatch → `verification-failed`; head sequence deliberately not required). `interlock` is now REQUIRED in `ApprovedTier1ApplyInput` (lease acquisition unconditional). No schema, receipt, identity, or vocabulary change. |
| `app/page.tsx` | §A/§C wiring. `commitInterlockRef` + `hydrateProjectRef` DELETED. New `projectTransitionRef` (`ProjectTransitionCoordinator` with `beforeInstall: autosaver flush`) + unmount `cancelPending()`. The old hydration body is now `installProject` (interlock creation removed — the coordinator owns it); `hydrateProject` = `projectTransitionRef.current!.request(() => installProject(record, opts))`. `applyTier1Proposal` reads the interlock from `currentInterlock()` (null-guarded with session readiness) and passes it as required. `applyCanonicalSchematicProjection` rewired through `adoptCanonicalResult` (real synchronous history record + `applyingHistoryRef` suppression + THROW on failure); it no longer sets `historyLabelRef`. |

## Updated tests (strengthened)

| Path | Changes |
| --- | --- |
| `b12-approved-mutation.test.ts`, `b12-boundary-and-e2e.test.ts`, `b12-1-adoption-identity-receipt.test.ts`, `b12-1-lifecycle-interlock.test.ts`, `b12-1-production-integration.test.ts` | every editorUi host now adopts through the SHARED `adoptCanonicalResult` primitive; every apply call passes the now-required `interlock` |
| `b12-1-lifecycle-interlock.test.ts` | the retired-session consumed replay now expects a `session-not-ready` REFUSAL (was: answered with the original receipt — superseded by §B) |
| `b06-2-authority-hydration.test.ts` (test 19), `b07-4-project-async-scope.test.ts` (T1+T22) | page-wiring gates re-pinned: `installProject` owns reset/dispose/beginProject; `hydrateProject` must route through `projectTransitionRef.current!.request(...)` |
| `b07-1-identity-geometry-gestures.test.ts` (E5) | applier-responsibility gate re-pinned: the canonical applier must call the shared primitive, record via the real history port, suppress the watcher, and throw on failure; the lifecycle applier must NOT call the primitive; preview touches none of it |

## New tests

| Path | Tests |
| --- | --- |
| `app/lib/engineering/__tests__/b12-2-transition-serialization.test.ts` | 7 |
| `app/lib/engineering/__tests__/b12-2-consumed-replay-scope.test.ts` | 7 |
| `app/lib/engineering/__tests__/b12-2-synchronous-adoption.test.ts` | 6 |

## Artifacts

- NEW `artifacts/ai-control-plane-b12-2/` (9 documents).
- Supersession notes added to `artifacts/ai-control-plane-b12-1/`:
  README.md, corrected-execution-and-adoption-contract.md,
  project-lifecycle-interlock.md, production-ui-undo-evidence.md,
  validation-summary.md (historical content preserved unchanged).

## Explicitly NOT changed

`app/lib/pcb/types.ts`, `app/lib/agent/generated/pcb-shape-descriptor.ts`,
all B11 replay pins/artifacts, the nine-tool provider exposure, the agent
gateway/loop/registry/chat route, the receipt schema and identity schema,
the interactive channel and its four approved importers, provider
configuration. The protected original `C:\Users\robsa\sirkit` was never
touched.
