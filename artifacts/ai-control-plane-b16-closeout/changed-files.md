# B16 — Changed files

Every file the chapter branch `chapter/b16-foundation-closeout` changed relative to its base `62ea4a6` (main after PR #5), including the B16-C.1/C.5 change set committed with this artifact. Generated from `git diff --name-status` + `git status`; purposes RECORDED from the ledger.

Total: 164 files.

| area | file | change | landed | purpose |
|---|---|---|---|---|
| CI | `.github/workflows/deterministic-manufacturing.yml` | modified | pending (B16-C.1/C.5 commit) | deterministic prompt-to-Gerber job (B16-A), database-delivery job (B16-B), page-browser-e2e job (B16-C.5) |
| CI | `.gitignore` | modified | pending (B16-C.1/C.5 commit) | ignore the Playwright output directories |
| tooling | `.claude/launch.json` | modified | committed | dev-server launch entry for the fixture runtime |
| tooling | `package.json` | modified | committed | scripts `dev:fixture`, `e2e`, `db:migrate`, `db:migrate:status`; `db:push` refused as a delivery path; dev deps `@electric-sql/pglite` 0.4.6, `@playwright/test` 1.63.0 |
| tooling | `pnpm-lock.yaml` | modified | committed | lockfile for the two dev dependencies |
| browser proof | `e2e/fixtures/blinker-route-fixture.json` | added | pending (B16-C.1/C.5 commit) | recorded FreeRouting run replayed by placed-board revision for the browser journey |
| browser proof | `e2e/prompt-to-gerber.spec.ts` | added | pending (B16-C.1/C.5 commit) | the serial fresh-browser journey (B16-C.5) |
| browser proof | `playwright.config.ts` | added | committed | real Next.js app on port 3100 under the fixture runtime; fresh storage per test; Chromium |
| browser proof | `scripts/dev-fixture.mjs` | added | committed | `pnpm dev:fixture` — the app under the fixture runtime for a human |
| fixture runtime | `app/api/parts/[id]/route.ts` | modified | pending (B16-C.1/C.5 commit) | committed catalog stands in for the parts table / published atomic snapshots when the runtime is on |
| fixture runtime | `app/components/auth/LocalDevIdentityBanner.tsx` | modified | committed | visible banner: local identity / fixture runtime |
| fixture runtime | `app/layout.tsx` | modified | committed | visible banner: local identity / fixture runtime |
| fixture runtime | `app/lib/atomic/server-catalog.ts` | modified | committed | committed catalog stands in for the parts table / published atomic snapshots when the runtime is on |
| fixture runtime | `app/lib/auth/identity-provider.ts` | modified | committed | dev-only role cookie → one distinct local principal per role (ignored outside the fixture runtime) |
| fixture runtime | `app/lib/auth/project-membership.ts` | modified | committed | dev-only role cookie → one distinct local principal per role (ignored outside the fixture runtime) |
| fixture runtime | `app/lib/build-loop.ts` | modified | committed | recorded blinker design under the fixture runtime (zero credits) |
| fixture runtime | `app/lib/durable-workflow/runtime.ts` | modified | committed | durable repository seam routes to the in-memory container when on |
| fixture runtime | `app/lib/fixture-runtime/__tests__/fixture-runtime.test.ts` | added | pending (B16-C.1/C.5 commit) | env-gated in-memory runtime for the browser proof: mode, container, blinker catalog, router replay/record/live seam, tests |
| fixture runtime | `app/lib/fixture-runtime/blinker/catalog.ts` | added | committed | env-gated in-memory runtime for the browser proof: mode, container, blinker catalog, router replay/record/live seam, tests |
| fixture runtime | `app/lib/fixture-runtime/clock.ts` | added | pending (B16-C.1/C.5 commit) | env-gated in-memory runtime for the browser proof: mode, container, blinker catalog, router replay/record/live seam, tests |
| fixture runtime | `app/lib/fixture-runtime/container.ts` | added | pending (B16-C.1/C.5 commit) | env-gated in-memory runtime for the browser proof: mode, container, blinker catalog, router replay/record/live seam, tests |
| fixture runtime | `app/lib/fixture-runtime/mode.ts` | added | committed | env-gated in-memory runtime for the browser proof: mode, container, blinker catalog, router replay/record/live seam, tests |
| fixture runtime | `app/lib/fixture-runtime/router.ts` | added | pending (B16-C.1/C.5 commit) | env-gated in-memory runtime for the browser proof: mode, container, blinker catalog, router replay/record/live seam, tests |
| fixture runtime | `app/lib/llm/router.ts` | modified | pending (B16-C.1/C.5 commit) | fixture provider seam: the build planner is answered, every other provider request is a bounded `provider_unavailable` failure |
| fixture runtime | `app/lib/parts-search.ts` | modified | committed | committed catalog stands in for the parts table / published atomic snapshots when the runtime is on |
| fixture runtime | `app/lib/pcb/autonomous/router-fixture.ts` | added | committed | router recording/replay core keyed by placed-board revision |
| fixture runtime | `instrumentation.ts` | added | pending (B16-C.1/C.5 commit) | Next.js start-up hook: installs the fixture runtime's frozen clock (no-op unless the runtime is enabled) |
| database delivery | `app/lib/db/__tests__/b16-b-database-qualification.test.ts` | added | committed | clean / upgrade / replay / drift / interruption / baseline / RLS / CHECK / schema-parity proofs |
| database delivery | `app/lib/db/__tests__/b16-b-migrations.test.ts` | added | committed | clean / upgrade / replay / drift / interruption / baseline / RLS / CHECK / schema-parity proofs |
| database delivery | `app/lib/db/__tests__/b16-b-postgres-qualification.test.ts` | added | committed | clean / upgrade / replay / drift / interruption / baseline / RLS / CHECK / schema-parity proofs |
| database delivery | `app/lib/db/__tests__/b16-b-rls-membership.test.ts` | added | committed | clean / upgrade / replay / drift / interruption / baseline / RLS / CHECK / schema-parity proofs |
| database delivery | `app/lib/db/__tests__/b16-b-schema-parity.test.ts` | added | committed | clean / upgrade / replay / drift / interruption / baseline / RLS / CHECK / schema-parity proofs |
| database delivery | `app/lib/db/disposable-postgres.ts` | added | committed | disposable in-process PostgreSQL (PGlite) shared by tests and the CLI |
| database delivery | `app/lib/db/migrations/baseline.ts` | added | committed | manifest (checksums), transactional runner with applied-migration ledger, PostgreSQL executor, schema verification, baseline adoption |
| database delivery | `app/lib/db/migrations/manifest.ts` | added | committed | manifest (checksums), transactional runner with applied-migration ledger, PostgreSQL executor, schema verification, baseline adoption |
| database delivery | `app/lib/db/migrations/postgres-executor.ts` | added | committed | manifest (checksums), transactional runner with applied-migration ledger, PostgreSQL executor, schema verification, baseline adoption |
| database delivery | `app/lib/db/migrations/runner.ts` | added | committed | manifest (checksums), transactional runner with applied-migration ledger, PostgreSQL executor, schema verification, baseline adoption |
| database delivery | `app/lib/db/migrations/verify-schema.ts` | added | committed | manifest (checksums), transactional runner with applied-migration ledger, PostgreSQL executor, schema verification, baseline adoption |
| database delivery | `app/lib/db/test-qualification.ts` | added | committed | opt-in marker for every DB-backed test (`SIRKIT_DB_QUALIFICATION=1` + URL) |
| database delivery | `scripts/db-migrate.ts` | added | committed | the ONE supported migration CLI: apply / status / baseline |
| routed-board revision | `app/api/pcb-sync/__tests__/b16-c-board-revision-route.test.ts` | added | pending (B16-C.1/C.5 commit) | route: refusal → preview → derive 201 → superseded everywhere → lineage on load; malformed 400s |
| routed-board revision | `app/components/pcb/BoardRevisionDialog.tsx` | added | pending (B16-C.1/C.5 commit) | rework-plan review dialog (carry choices, outcomes, proofs, digest-bound acknowledgement) |
| routed-board revision | `app/components/pcb/__tests__/board-revision-dialog.test.tsx` | added | pending (B16-C.1/C.5 commit) | rework-plan review dialog (carry choices, outcomes, proofs, digest-bound acknowledgement) |
| routed-board revision | `app/lib/pcb-sync/__tests__/b16-c-board-revision.test.ts` | added | pending (B16-C.1/C.5 commit) | 7 durable-stack cases (add/remove/rename/footprint/pin-map/outline+constraints/refusals/lineage) |
| routed-board revision | `app/lib/pcb-sync/board-lineage.ts` | added | pending (B16-C.1/C.5 commit) | durable board lineage (`<root>@r<n>`), one-commit derivation, idempotent replay |
| routed-board revision | `app/lib/pcb-sync/board-revision.ts` | added | pending (B16-C.1/C.5 commit) | pure rework plan with per-component/per-net outcomes and semantic-equivalence proofs (B16-C.1) |
| routed-board revision | `app/lib/pcb-sync/service.ts` | modified | pending (B16-C.1/C.5 commit) | previewBoardRevision / deriveBoardRevision, derivation-aware preflight, superseded guard, bindings by lineage root |
| routed-board revision | `app/lib/pcb/board-identity.ts` | modified | pending (B16-C.1/C.5 commit) | `pcbDerivedBoardInstanceId`, `pcbBoardLineageOf` |
| pcb sync | `app/api/pcb-sync/__tests__/route.test.ts` | modified | committed | preview_board_revision / derive_board_revision operations, status mapping, `conflict` body, lineage on GET |
| pcb sync | `app/api/pcb-sync/handler.ts` | modified | pending (B16-C.1/C.5 commit) | preview_board_revision / derive_board_revision operations, status mapping, `conflict` body, lineage on GET |
| pcb sync | `app/api/pcb-sync/route.ts` | modified | pending (B16-C.1/C.5 commit) | preview_board_revision / derive_board_revision operations, status mapping, `conflict` body, lineage on GET |
| pcb sync | `app/lib/pcb-sync/__tests__/b16-a-durable-heads.test.ts` | modified | committed | conflict details assertions |
| pcb sync | `app/lib/pcb-sync/board.ts` | modified | pending (B16-C.1/C.5 commit) | revision request/result types, conflict details (C.3), synchronization-record operations, derivation-aware reconciliation, client operations |
| pcb sync | `app/lib/pcb-sync/client.ts` | modified | pending (B16-C.1/C.5 commit) | revision request/result types, conflict details (C.3), synchronization-record operations, derivation-aware reconciliation, client operations |
| pcb sync | `app/lib/pcb-sync/durable.ts` | modified | pending (B16-C.1/C.5 commit) | revision request/result types, conflict details (C.3), synchronization-record operations, derivation-aware reconciliation, client operations |
| pcb sync | `app/lib/pcb-sync/reconciliation.ts` | modified | pending (B16-C.1/C.5 commit) | revision request/result types, conflict details (C.3), synchronization-record operations, derivation-aware reconciliation, client operations |
| pcb sync | `app/lib/pcb-sync/types.ts` | modified | pending (B16-C.1/C.5 commit) | revision request/result types, conflict details (C.3), synchronization-record operations, derivation-aware reconciliation, client operations |
| manufacturing | `app/api/pcb/qualify/route.ts` | modified | pending (B16-C.1/C.5 commit) | superseded guard (`MFG_BOARD_SUPERSEDED`), copper cleared for the autonomous run, idempotent check on the head board, bare-board rule profile |
| manufacturing | `app/api/pcb/release/route.ts` | modified | pending (B16-C.1/C.5 commit) | superseded guard; rule-profile v2 schema + expiry refusal |
| manufacturing | `app/lib/pcb/fab/manufacturing-errors.ts` | modified | pending (B16-C.1/C.5 commit) | `MFG_BOARD_SUPERSEDED`, `MFG_RULE_PROFILE_SCHEMA_RETIRED`, `MFG_RULE_PROFILE_EXPIRED` |
| manufacturing | `app/lib/pcb/fab/qualification-authority.ts` | modified | pending (B16-C.1/C.5 commit) | component authority resolved by lineage root |
| fabrication rules | `app/lib/agent/generated/pcb-shape-descriptor.ts` | modified | committed | the PTH ring rule carried through constraints, descriptors, readiness, RC03 (`CAP_PTH_ANNULAR_RING_BELOW_PROFILE`), normalizers and generated descriptors |
| fabrication rules | `app/lib/constraints/compiler.ts` | modified | committed | the PTH ring rule carried through constraints, descriptors, readiness, RC03 (`CAP_PTH_ANNULAR_RING_BELOW_PROFILE`), normalizers and generated descriptors |
| fabrication rules | `app/lib/constraints/manufacturing.ts` | modified | committed | the PTH ring rule carried through constraints, descriptors, readiness, RC03 (`CAP_PTH_ANNULAR_RING_BELOW_PROFILE`), normalizers and generated descriptors |
| fabrication rules | `app/lib/constraints/types.ts` | modified | committed | the PTH ring rule carried through constraints, descriptors, readiness, RC03 (`CAP_PTH_ANNULAR_RING_BELOW_PROFILE`), normalizers and generated descriptors |
| fabrication rules | `app/lib/engineering/__tests__/fixtures.ts` | modified | committed | fixtures/assertions updated for the via/PTH split |
| fabrication rules | `app/lib/engineering/drc-descriptors.ts` | modified | committed | the PTH ring rule carried through constraints, descriptors, readiness, RC03 (`CAP_PTH_ANNULAR_RING_BELOW_PROFILE`), normalizers and generated descriptors |
| fabrication rules | `app/lib/pcb/__tests__/b16-c-fabrication-rule-authority.test.ts` | added | committed | 9 cases: ring measurement, DRC, RC03, profile v2 refusals |
| fabrication rules | `app/lib/pcb/__tests__/drc-readiness.test.ts` | modified | committed | fixtures/assertions updated for the via/PTH split |
| fabrication rules | `app/lib/pcb/__tests__/electrical-identity-boundary.test.ts` | modified | committed | fixtures/assertions updated for the via/PTH split |
| fabrication rules | `app/lib/pcb/__tests__/fixtures/autonomous-golden-board.ts` | modified | committed | fixtures/assertions updated for the via/PTH split |
| fabrication rules | `app/lib/pcb/__tests__/ingest-integrity.test.ts` | modified | committed | fixtures/assertions updated for the via/PTH split |
| fabrication rules | `app/lib/pcb/__tests__/manufacturing-release-gate.test.ts` | modified | committed | fixtures/assertions updated for the via/PTH split |
| fabrication rules | `app/lib/pcb/__tests__/run-drc.test.ts` | modified | committed | fixtures/assertions updated for the via/PTH split |
| fabrication rules | `app/lib/pcb/ai/violation-normalizer.ts` | modified | committed | the PTH ring rule carried through constraints, descriptors, readiness, RC03 (`CAP_PTH_ANNULAR_RING_BELOW_PROFILE`), normalizers and generated descriptors |
| fabrication rules | `app/lib/pcb/autonomous/capability-profile.ts` | modified | committed | the PTH ring rule carried through constraints, descriptors, readiness, RC03 (`CAP_PTH_ANNULAR_RING_BELOW_PROFILE`), normalizers and generated descriptors |
| fabrication rules | `app/lib/pcb/autonomous/production-router.ts` | modified | committed | the PTH ring rule carried through constraints, descriptors, readiness, RC03 (`CAP_PTH_ANNULAR_RING_BELOW_PROFILE`), normalizers and generated descriptors |
| fabrication rules | `app/lib/pcb/autoroute/verification.ts` | modified | committed | the PTH ring rule carried through constraints, descriptors, readiness, RC03 (`CAP_PTH_ANNULAR_RING_BELOW_PROFILE`), normalizers and generated descriptors |
| fabrication rules | `app/lib/pcb/drc/checks/geometry.ts` | modified | committed | `minPthAnnularRingNm`, per-pad PTH ring check, presets re-pinned (jlcpcb-2l PTH 0.25 mm recommended) |
| fabrication rules | `app/lib/pcb/drc/presets/index.ts` | modified | committed | `minPthAnnularRingNm`, per-pad PTH ring check, presets re-pinned (jlcpcb-2l PTH 0.25 mm recommended) |
| fabrication rules | `app/lib/pcb/drc/presets/jlcpcb-2l.json` | modified | committed | `minPthAnnularRingNm`, per-pad PTH ring check, presets re-pinned (jlcpcb-2l PTH 0.25 mm recommended) |
| fabrication rules | `app/lib/pcb/drc/presets/jlcpcb-4l.json` | modified | committed | `minPthAnnularRingNm`, per-pad PTH ring check, presets re-pinned (jlcpcb-2l PTH 0.25 mm recommended) |
| fabrication rules | `app/lib/pcb/drc/presets/oshpark-4l.json` | modified | committed | `minPthAnnularRingNm`, per-pad PTH ring check, presets re-pinned (jlcpcb-2l PTH 0.25 mm recommended) |
| fabrication rules | `app/lib/pcb/drc/presets/pcbway-standard.json` | modified | committed | `minPthAnnularRingNm`, per-pad PTH ring check, presets re-pinned (jlcpcb-2l PTH 0.25 mm recommended) |
| fabrication rules | `app/lib/pcb/drc/run-drc.ts` | modified | committed | `minPthAnnularRingNm`, per-pad PTH ring check, presets re-pinned (jlcpcb-2l PTH 0.25 mm recommended) |
| fabrication rules | `app/lib/pcb/drc/types.ts` | modified | committed | `minPthAnnularRingNm`, per-pad PTH ring check, presets re-pinned (jlcpcb-2l PTH 0.25 mm recommended) |
| fabrication rules | `app/lib/pcb/fab/__tests__/b16-c-gerber-aperture-key.test.ts` | added | committed | canonical aperture keys (released copper no longer depends on JSON property order) + regression test |
| fabrication rules | `app/lib/pcb/fab/native/gerber-writer.ts` | modified | committed | canonical aperture keys (released copper no longer depends on JSON property order) + regression test |
| fabrication rules | `app/lib/pcb/fab/release-gate.ts` | modified | committed | release refuses a retired or expired profile; manifest carries the profile identity |
| fabrication rules | `app/lib/pcb/fab/release-manifest.ts` | modified | committed | release refuses a retired or expired profile; manifest carries the profile identity |
| fabrication rules | `app/lib/pcb/fab/rule-profile.ts` | added | committed | source-pinned manufacturing rule profile v2 (URLs, retrieval date, scope, expiry, via/PTH split) |
| fabrication rules | `app/lib/pcb/proposal/__tests__/b15-3-validation-policy.test.ts` | modified | committed | fixtures/assertions updated for the via/PTH split |
| fabrication rules | `app/lib/pcb/readiness/evaluate.ts` | modified | committed | the PTH ring rule carried through constraints, descriptors, readiness, RC03 (`CAP_PTH_ANNULAR_RING_BELOW_PROFILE`), normalizers and generated descriptors |
| fabrication rules | `app/lib/pcb/repair/approval-policy.ts` | modified | committed | the PTH ring rule carried through constraints, descriptors, readiness, RC03 (`CAP_PTH_ANNULAR_RING_BELOW_PROFILE`), normalizers and generated descriptors |
| component review | `app/api/physical-bindings/__tests__/b16-c-review-handoff.test.ts` | added | pending (B16-C.1/C.5 commit) | 7 route cases |
| component review | `app/api/physical-bindings/route.ts` | modified | pending (B16-C.1/C.5 commit) | request/list/resolve/withdraw operations; 403 (not 422) with the handoff named; bindings scoped by lineage root |
| component review | `app/components/pcb/ComponentReviewPanel.tsx` | added | committed | the panel (request → reviewer decision → resume) and its hook |
| component review | `app/components/pcb/__tests__/component-review-panel.test.tsx` | added | committed | the panel (request → reviewer decision → resume) and its hook |
| component review | `app/components/pcb/hooks/useComponentReview.ts` | added | committed | the panel (request → reviewer decision → resume) and its hook |
| component review | `app/lib/physical-binding/__tests__/schema-integrity.test.ts` | modified | committed | binding lifecycle under the reviewer's identity; schema integrity assertions |
| component review | `app/lib/physical-binding/atomic-binding.ts` | modified | pending (B16-C.1/C.5 commit) | binding lifecycle under the reviewer's identity; schema integrity assertions |
| component review | `app/lib/physical-binding/review-handoff.ts` | added | committed | durable review-request aggregate with server-projected evidence; retirement on revocation/role change; drift refusal (B16-C.2) |
| component review | `app/lib/physical-binding/server-repository.ts` | modified | committed | binding lifecycle under the reviewer's identity; schema integrity assertions |
| snapshot conflict | `app/components/pcb/SnapshotConflictDialog.tsx` | added | committed | Refresh / Rebase & publish / Not now dialog (B16-C.3) |
| snapshot conflict | `app/components/pcb/__tests__/snapshot-conflict-dialog.test.tsx` | added | committed | Refresh / Rebase & publish / Not now dialog (B16-C.3) |
| browser | `app/components/pcb/PcbEditor.tsx` | modified | pending (B16-C.1/C.5 commit) | lineage following, revision handlers/dialog, conflict dialog, review panel (also in the empty state), sync/apply test ids |
| browser | `app/components/pcb/PcbSyncReadinessPanel.tsx` | modified | pending (B16-C.1/C.5 commit) | derive-revision entry point |
| browser | `app/components/pcb/__tests__/manufacturing-workflow-panel.test.tsx` | modified | pending (B16-C.1/C.5 commit) | panel assertions |
| browser | `app/components/pcb/__tests__/pcb-sync-authority.test.tsx` | modified | committed | panel assertions |
| browser | `app/components/pcb/hooks/useManufacturingWorkflow.ts` | modified | pending (B16-C.1/C.5 commit) | a hydration READ superseded by a lifecycle replacement re-reads the current generation (bounded; `MFG_HYDRATION_SUPERSEDED` when it keeps moving) |
| browser | `app/lib/engineering/project-async-scope.ts` | modified | pending (B16-C.1/C.5 commit) | `resume()` — a disposed owner/registry is re-armed by the mount effect (React StrictMode's simulated unmount had disposed them for good in `next dev`) |
| browser | `app/lib/pcb/lifecycle/__tests__/b16-c-strict-mode-remount.test.tsx` | added | pending (B16-C.1/C.5 commit) | 4 cases: the pre-fix pattern fails under <StrictMode>, the fixed pattern keeps scopes current, unmount disposes, the project registry has the same contract |
| browser | `app/lib/pcb/lifecycle/board-lifecycle.ts` | modified | pending (B16-C.1/C.5 commit) | `resume()` — a disposed owner/registry is re-armed by the mount effect (React StrictMode's simulated unmount had disposed them for good in `next dev`) |
| browser | `app/page.tsx` | modified | pending (B16-C.1/C.5 commit) | project selector headers on every authenticated AI request (the browser proof found them missing); view/activity/new-project/prompt test ids |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/acceptance-pipeline.test.ts` | modified | pending (B16-C.1/C.5 commit) | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-catalog.ts` | modified | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-route-fixture-recovery.json` | modified | pending (B16-C.1/C.5 commit) | recorded router runs replayed in CI |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/blinker-route-fixture.json` | modified | committed | recorded router runs replayed in CI |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/expected-identities.json` | modified | committed | pinned release identities (re-recorded after C.4 and C.2) |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/harness.ts` | modified | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/kicad/C.kicad_sym	app/lib/fixture-runtime/blinker/kicad/C.kicad_sym` | renamed | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/kicad/C_0805_2012Metric.kicad_mod	app/lib/fixture-runtime/blinker/kicad/C_0805_2012Metric.kicad_mod` | renamed | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/kicad/Conn_01x02.kicad_sym	app/lib/fixture-runtime/blinker/kicad/Conn_01x02.kicad_sym` | renamed | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/kicad/LED.kicad_sym	app/lib/fixture-runtime/blinker/kicad/LED.kicad_sym` | renamed | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/kicad/LED_0805_2012Metric.kicad_mod	app/lib/fixture-runtime/blinker/kicad/LED_0805_2012Metric.kicad_mod` | renamed | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/kicad/PinHeader_1x02_P2.54mm_Vertical.kicad_mod	app/lib/fixture-runtime/blinker/kicad/PinHeader_1x02_P2.54mm_Vertical.kicad_mod` | renamed | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/kicad/R.kicad_sym	app/lib/fixture-runtime/blinker/kicad/R.kicad_sym` | renamed | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/kicad/R_0805_2012Metric.kicad_mod	app/lib/fixture-runtime/blinker/kicad/R_0805_2012Metric.kicad_mod` | renamed | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/kicad/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod	app/lib/fixture-runtime/blinker/kicad/SOIC-8_3.9x4.9mm_P1.27mm.kicad_mod` | renamed | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/kicad/Timer_NE555.kicad_sym	app/lib/fixture-runtime/blinker/kicad/Timer_NE555.kicad_sym` | renamed | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/fixtures/route-fixture.ts` | modified | committed | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| deterministic pipeline | `app/lib/workflow/prompt-to-gerber/__tests__/recovery-pipeline.test.ts` | modified | pending (B16-C.1/C.5 commit) | acceptance (review handoff step) and recovery (H.14 derived revision) pipelines, harness, catalog, route fixture core |
| tests | `app/api/__tests__/b16-0-15-tranche-parity.test.ts` | modified | pending (B16-C.1/C.5 commit) | stubs/gates updated (v2 rule profile, opt-in DB marker, lineage-aware durable stubs, write-gate justifications) |
| tests | `app/api/pcb/edit/__tests__/assist-live.test.ts` | modified | committed | stubs/gates updated (v2 rule profile, opt-in DB marker, lineage-aware durable stubs, write-gate justifications) |
| tests | `app/api/pcb/release/__tests__/b16-a-release-confirmation.test.ts` | modified | pending (B16-C.1/C.5 commit) | stubs/gates updated (v2 rule profile, opt-in DB marker, lineage-aware durable stubs, write-gate justifications) |
| tests | `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts` | modified | committed | stubs/gates updated (v2 rule profile, opt-in DB marker, lineage-aware durable stubs, write-gate justifications) |
| tests | `app/lib/assignment-queue/__tests__/revalidation.test.ts` | modified | committed | stubs/gates updated (v2 rule profile, opt-in DB marker, lineage-aware durable stubs, write-gate justifications) |
| tests | `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts` | modified | committed | stubs/gates updated (v2 rule profile, opt-in DB marker, lineage-aware durable stubs, write-gate justifications) |
| tests | `app/lib/auth/__tests__/b16-0-2-mode-diagnostics.test.tsx` | modified | committed | stubs/gates updated (v2 rule profile, opt-in DB marker, lineage-aware durable stubs, write-gate justifications) |
| tests | `app/lib/durable-workflow/__tests__/tenant-scope.test.ts` | modified | committed | stubs/gates updated (v2 rule profile, opt-in DB marker, lineage-aware durable stubs, write-gate justifications) |
| artifacts | `artifacts/ai-control-plane-b05-1/composite-replay-fixtures.json` | modified | committed | regenerated replay fixtures / evaluation pins after the PTH rule (sanctioned generators) |
| artifacts | `artifacts/ai-control-plane-b05/read-replay-fixtures.json` | modified | committed | regenerated replay fixtures / evaluation pins after the PTH rule (sanctioned generators) |
| artifacts | `artifacts/ai-control-plane-b11/evaluation-results.json` | modified | committed | regenerated replay fixtures / evaluation pins after the PTH rule (sanctioned generators) |
| artifacts | `artifacts/ai-control-plane-b11/replay-trace-pins.json` | modified | committed | regenerated replay fixtures / evaluation pins after the PTH rule (sanctioned generators) |
| artifacts | `artifacts/ai-control-plane-b16-closeout/README.md` | added | pending (B16-C.1/C.5 commit) | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/b16-1c-independent-verification.md` | added | committed | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/changed-files.md` | added | pending (B16-C.1/C.5 commit) | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/clean-and-upgrade-db-proof.md` | added | committed | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/component-review-handoff.md` | added | committed | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/fabrication-rule-authority.md` | added | committed | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/failure-and-recovery-matrix.csv` | added | pending (B16-C.1/C.5 commit) | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/final-verdict.md` | added | pending (B16-C.1/C.5 commit) | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/migration-delivery-contract.md` | added | committed | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/page-browser-e2e.md` | added | pending (B16-C.1/C.5 commit) | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/rls-and-membership-proof.md` | added | committed | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/routed-board-revision-contract.md` | added | pending (B16-C.1/C.5 commit) | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/snapshot-conflict-ux.md` | added | committed | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/starting-state.md` | added | committed | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/test-and-validation-report.md` | added | pending (B16-C.1/C.5 commit) | B16 closeout artifact |
| artifacts | `artifacts/ai-control-plane-b16-closeout/unknowns-and-owner-decisions.md` | added | pending (B16-C.1/C.5 commit) | B16 closeout artifact |
| artifacts | `artifacts/remaining-builder-program/EXECUTION_LEDGER.md` | modified | committed | durable program ledger / decisions / blockers |
| artifacts | `artifacts/remaining-builder-program/LIVE_BLOCKERS.md` | modified | committed | durable program ledger / decisions / blockers |
| artifacts | `artifacts/remaining-builder-program/OWNER_DECISIONS.md` | modified | pending (B16-C.1/C.5 commit) | durable program ledger / decisions / blockers |
| artifacts | `artifacts/remaining-builder-program/PROGRAM_STATE.json` | modified | committed | durable program ledger / decisions / blockers |
