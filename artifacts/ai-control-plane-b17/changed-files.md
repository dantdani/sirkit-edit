# B17 — changed files (base `82ecbf8` → `81bf3ea`, branch `chapter/b17-semantic-editor`, PR #7)

Labels: **RECORDED** (this file is a mechanical listing from `git diff --name-status 82ecbf8..HEAD`). 153 files: 56 added, 97 modified, 0 deleted, 0 renamed. Every commit is authored by Dandi Desta with no AI co-author trailer.

## Commits (newest first)

- `81bf3ea` 2026-09-10 — B17-F tool exposure: the ONE reviewed intentional agent tool set (22), registry-derived gates, view-session bus-command tools, shared layout proposals, captured view context
- `aafeaa7` 2026-09-10 — B17-E ledger: CI green at 041fad9 (prompt-to-gerber incl. the B17-E suites, page-browser-e2e with five scenarios, database-delivery, benchmark)
- `041fad9` 2026-09-10 — B17-E placement, routing, history and import/export parity: one revision-bound layout candidate (sirkit.layout-candidate.v1) produced by the editor worker, the agent tool service and the preview route through one options builder and one store; autoroute becomes preview/apply/discard with a canvas ghost and net scope; apply is one canonical transaction with exact base re-check, protected copper and undo; explicit clear/reroute selected nets and the routed-board revision on the B16 sync path; a project operation timeline over both authoritative histories with delegated, divergence-refusing project undo; import/export outcome declarations and the three reporting fixes
- `f15a27a` 2026-09-10 — B17-D ledger: CI green at 96a2925 (prompt-to-gerber, page-browser-e2e with both browser specs, database-delivery, benchmark-core)
- `96a2925` 2026-09-10 — B17-D canvas navigation and selection: pcb/schematic/workspace view sessions wired into the editors (fit/zoom/pan/focus by semantic target, versioned selection with "this component" refusing stale or absent selection, layers/grid, net highlight, DRC/routing finding reveal, measure without a dimension, editor-only observe), Go to controls on both canvases, browser proof of the visible effect; fixes five defects the proof found
- `6483d9d` 2026-09-09 — B17-D library: semantic view targets (component/object/net/point/versioned selection, "this component" refuses stale or absent selection), pcb canvas command set (fit/zoom/pan/focus, select/add/remove/net/clear, layers/grid, net highlight, reveal DRC/routing findings, measure without a dimension, editor-only observe), schematic and workspace command sets, shared StrictMode-safe useViewSession owner (pcb3d hook rebuilt on it), bus context carries expected/current revision and the rebase verdict
- `e7a5a44` 2026-09-09 — B17 CI correction: browser proofs sharing one fixture server mint ids under per-spec uuid namespaces (the 3D proof's project collided with the prompt-to-Gerber journey in page-browser-e2e)
- `a0236b0` 2026-09-09 — B17 CI correction: H.16 pins manufacturing.release as implemented (administrator-authorized release UI since B16-C) while keeping destructive/release-tier/no-tool-exposure and adding the server-owned route and authorizeRelease handler assertions
- `040df94` 2026-09-09 — B17-C PCB 3D semantic control: pcb3d.* view-session commands (open/close, presets, fit, reset, focus by component/selection/net, per-layer visibility incl. independent silkscreens, finish preference, read-state), PcbPreview3D rendered from the bus, browser proof of the acceptance phrase; fixes toolbar overflow and StrictMode session retirement found by the proof
- `9e90e5c` 2026-09-09 — B17-B view-session command bus: sirkit.view-command.v1 envelope, scoped non-authoritative bus with documented stale rules, single settlement, cancellation, retirement, preference-only persistence and redacting traces
- `adb9ade` 2026-09-09 — B17-A action rebaseline: AST control inventory (554 controls / 58 surfaces), control classification registry with CI gates, B01 records re-baselined from current code
- `ff6f8d5` 2026-09-09 — B16 final gate recorded: PR #6 merged as 82ecbf8 with all CI gates green; B17 started (discovery: registry, entry-point inventory, non-implemented records)

## Files by area

### `.github` (1)

- M `.github/workflows/deterministic-manufacturing.yml`

### `app/api/__tests__` (2)

- M `app/api/__tests__/b16-0-12-tranche-parity.test.ts`
- M `app/api/__tests__/b16-1c-invariant-tripwires.test.ts`

### `app/api/chat` (1)

- M `app/api/chat/route.ts`

### `app/api/pcb` (2)

- M `app/api/pcb/autoroute/route.ts`
- M `app/api/pcb/placement/preview/route.ts`

### `app/components/pcb` (17)

- M `app/components/pcb/AutorouteSetup.tsx`
- M `app/components/pcb/DrcPanel.tsx`
- M `app/components/pcb/Inspector.tsx`
- M `app/components/pcb/LayerPanel.tsx`
- M `app/components/pcb/PcbEditor.tsx`
- M `app/components/pcb/PcbPreview3D.tsx`
- M `app/components/pcb/PcbToolbar.tsx`
- M `app/components/pcb/PlacementSetup.tsx`
- M `app/components/pcb/__tests__/inspector-commands.test.tsx`
- A `app/components/pcb/__tests__/pcb3d-view-session.test.tsx`
- M `app/components/pcb/hooks/useAutoPlace.ts`
- M `app/components/pcb/hooks/useAutoroute.ts`
- M `app/components/pcb/hooks/useDrc.ts`
- M `app/components/pcb/hooks/usePcb3d.ts`
- A `app/components/pcb/hooks/usePcb3dViewSession.ts`
- M `app/components/pcb/hooks/usePcbRepair.ts`
- A `app/components/pcb/hooks/usePcbViewSession.ts`

### `app/components/schematic` (1)

- A `app/components/schematic/hooks/useSchematicViewSession.ts`

### `app/components/view-session` (3)

- A `app/components/view-session/__tests__/use-view-session.test.tsx`
- A `app/components/view-session/useViewSession.ts`
- A `app/components/view-session/useViewSessionBridge.ts`

### `app/components/workspace` (1)

- A `app/components/workspace/useWorkspaceViewSession.ts`

### `app/lib/agent` (26)

- M `app/lib/agent/__tests__/b09-1-boundary.test.ts`
- M `app/lib/agent/__tests__/b09-2-closure.test.ts`
- M `app/lib/agent/__tests__/b09-3-closure.test.ts`
- M `app/lib/agent/__tests__/b09-loop-safety.test.ts`
- M `app/lib/agent/__tests__/b09-proposals.test.ts`
- M `app/lib/agent/__tests__/b10-editor-context.test.ts`
- M `app/lib/agent/__tests__/b11-1-trace-integrity.test.ts`
- M `app/lib/agent/__tests__/b11-2-replay-context.test.ts`
- M `app/lib/agent/__tests__/b11-3-generated-pcb-shape.test.ts`
- M `app/lib/agent/__tests__/b11-4-capture-ownership.test.ts`
- M `app/lib/agent/__tests__/b11-5-capture-exactness.test.ts`
- M `app/lib/agent/__tests__/b11-6-projection-ownership.test.ts`
- M `app/lib/agent/__tests__/b11-7-primitive-discipline.test.ts`
- M `app/lib/agent/__tests__/b11-trace-replay-evaluation.test.ts`
- M `app/lib/agent/__tests__/b15-3-pcb-proposal-exposure.test.ts`
- A `app/lib/agent/__tests__/b17-f-view-session-bridge.test.ts`
- A `app/lib/agent/__tests__/b17-f-view-tools.test.ts`
- M `app/lib/agent/context.ts`
- M `app/lib/agent/contracts.ts`
- M `app/lib/agent/evaluation-cases.ts`
- M `app/lib/agent/gateway.ts`
- A `app/lib/agent/layout-proposals.ts`
- M `app/lib/agent/loop.ts`
- M `app/lib/agent/trace.ts`
- A `app/lib/agent/view-context.ts`
- A `app/lib/agent/view-session-bridge.ts`

### `app/lib/auth` (13)

- M `app/lib/auth/__tests__/b16-0-1-ci-gates.test.ts`
- M `app/lib/auth/__tests__/b16-0-15-manufacturing-boundary-gate.test.ts`
- M `app/lib/auth/__tests__/b16-0-16-calculation-confinement-gate.test.ts`
- M `app/lib/auth/__tests__/b16-0-17-schematic-compiler-confinement-gate.test.ts`
- M `app/lib/auth/__tests__/b16-0-18-component-selection-confinement-gate.test.ts`
- M `app/lib/auth/__tests__/b16-0-19-circuit-confinement-gate.test.ts`
- M `app/lib/auth/__tests__/b16-0-2-gates.test.ts`
- M `app/lib/auth/__tests__/b16-0-20-simulation-confinement-gate.test.ts`
- M `app/lib/auth/__tests__/b16-0-21-tranche14-confinement-gate.test.ts`
- M `app/lib/auth/__tests__/b16-0-23-tranche16-confinement-gate.test.ts`
- M `app/lib/auth/__tests__/b16-0-24-tranche17-confinement-gate.test.ts`
- M `app/lib/auth/__tests__/b16-0-ai-approval-lifecycle.test.ts`
- M `app/lib/auth/__tests__/b16-1b-auth-composition.test.ts`

### `app/lib/engineering` (19)

- M `app/lib/engineering/__tests__/b04-tool-registry.test.ts`
- M `app/lib/engineering/__tests__/b05-1-resource-pinning.test.ts`
- M `app/lib/engineering/__tests__/b05-read-invocation.test.ts`
- M `app/lib/engineering/__tests__/b12-boundary-and-e2e.test.ts`
- M `app/lib/engineering/__tests__/b14-1-approval-and-reauthorization.test.ts`
- M `app/lib/engineering/__tests__/b14-replacement-apply.test.ts`
- A `app/lib/engineering/__tests__/b17-a-control-inventory.test.ts`
- A `app/lib/engineering/__tests__/b17-f-agent-exposure.test.ts`
- M `app/lib/engineering/action-registry.ts`
- A `app/lib/engineering/agent-exposure.ts`
- A `app/lib/engineering/control-registry.ts`
- A `app/lib/engineering/control-surface.ts`
- M `app/lib/engineering/executor.ts`
- M `app/lib/engineering/resource-envelopes.ts`
- M `app/lib/engineering/tool-bindings-readonly.ts`
- M `app/lib/engineering/tool-catalog.ts`
- M `app/lib/engineering/tool-invocation.ts`
- M `app/lib/engineering/tool-read-replay.ts`
- M `app/lib/engineering/tool-registry.ts`

### `app/lib/pcb` (11)

- M `app/lib/pcb/3d/build-scene.ts`
- M `app/lib/pcb/3d/types.ts`
- M `app/lib/pcb/ai/pcb-tool-service.ts`
- M `app/lib/pcb/autoplace/auto-place.ts`
- A `app/lib/pcb/autoroute/freerouting-pass-executor.ts`
- A `app/lib/pcb/candidates/__tests__/b17-e-layout-candidates.test.ts`
- A `app/lib/pcb/candidates/layout-candidate.ts`
- A `app/lib/pcb/candidates/routing-server.ts`
- M `app/lib/pcb/proposal/__tests__/b15-2-2-exact-outline-and-shape.test.ts`
- M `app/lib/pcb/proposal/__tests__/b15-2-core-closure.test.ts`
- M `app/lib/pcb/render/scene.ts`

### `app/lib/project` (5)

- A `app/lib/project/__tests__/b17-e-io-outcomes.test.ts`
- A `app/lib/project/__tests__/b17-e-operation-timeline.test.ts`
- A `app/lib/project/io-outcome.ts`
- A `app/lib/project/layout-candidate-events.ts`
- A `app/lib/project/operation-timeline.ts`

### `app/lib/view-session` (11)

- A `app/lib/view-session/__tests__/b17-b-view-session-bus.test.ts`
- A `app/lib/view-session/__tests__/b17-c-pcb3d-commands.test.ts`
- A `app/lib/view-session/__tests__/b17-d-pcb-view-commands.test.ts`
- A `app/lib/view-session/__tests__/b17-d-schematic-workspace-commands.test.ts`
- A `app/lib/view-session/bus.ts`
- A `app/lib/view-session/pcb.ts`
- A `app/lib/view-session/pcb3d.ts`
- A `app/lib/view-session/schematic.ts`
- A `app/lib/view-session/targets.ts`
- A `app/lib/view-session/types.ts`
- A `app/lib/view-session/workspace.ts`

### `app/lib/workflow` (1)

- M `app/lib/workflow/prompt-to-gerber/__tests__/recovery-pipeline.test.ts`

### `app/page.tsx` (1)

- M `app/page.tsx`

### `artifacts` (35)

- M `artifacts/ai-control-plane-b01/ui-command-toolability-matrix.csv`
- M `artifacts/ai-control-plane-b01/ui-control-fingerprint.json`
- M `artifacts/ai-control-plane-b04/non-callable-coverage.csv`
- M `artifacts/ai-control-plane-b04/provider-schema-parity.json`
- M `artifacts/ai-control-plane-b04/tool-registry.csv`
- M `artifacts/ai-control-plane-b05-1/composite-replay-fixtures.json`
- M `artifacts/ai-control-plane-b05-1/resource-consumption-matrix.csv`
- M `artifacts/ai-control-plane-b05/activated-read-bindings.csv`
- M `artifacts/ai-control-plane-b05/read-replay-fixtures.json`
- M `artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.csv`
- M `artifacts/ai-control-plane-b09/agent-exposed-tool-manifest.json`
- M `artifacts/ai-control-plane-b09/normalized-loop-replay-fixtures.json`
- M `artifacts/ai-control-plane-b09/provider-schema-parity.json`
- M `artifacts/ai-control-plane-b09/tool-activation-audit.csv`
- M `artifacts/ai-control-plane-b10/runtime-tool-availability.csv`
- M `artifacts/ai-control-plane-b11/evaluation-case-matrix.csv`
- M `artifacts/ai-control-plane-b11/evaluation-results.json`
- M `artifacts/ai-control-plane-b11/replay-trace-pins.json`
- A `artifacts/ai-control-plane-b17/3d-command-proof.md`
- A `artifacts/ai-control-plane-b17/README.md`
- A `artifacts/ai-control-plane-b17/control-classification-contract.md`
- A `artifacts/ai-control-plane-b17/evidence/agent-view-tools.png`
- A `artifacts/ai-control-plane-b17/evidence/pcb-3d-acceptance.png`
- A `artifacts/ai-control-plane-b17/evidence/pcb-canvas-acceptance.png`
- A `artifacts/ai-control-plane-b17/evidence/project-timeline.png`
- A `artifacts/ai-control-plane-b17/evidence/schematic-canvas-acceptance.png`
- A `artifacts/ai-control-plane-b17/placement-routing-parity.md`
- A `artifacts/ai-control-plane-b17/project-history-model.md`
- A `artifacts/ai-control-plane-b17/selection-context-proof.md`
- A `artifacts/ai-control-plane-b17/tool-exposure.md`
- A `artifacts/ai-control-plane-b17/ui-control-inventory-summary.json`
- A `artifacts/ai-control-plane-b17/ui-control-inventory.csv`
- A `artifacts/ai-control-plane-b17/view-command-contract.md`
- M `artifacts/remaining-builder-program/EXECUTION_LEDGER.md`
- M `artifacts/remaining-builder-program/PROGRAM_STATE.json`

### `e2e` (2)

- A `e2e/fixture-journey.ts`
- A `e2e/semantic-editor.spec.ts`

### `scripts` (1)

- A `scripts/generate-b17-control-inventory.ts`

## Reading guide

- Source of truth per checkpoint: B17-A `app/lib/engineering/control-registry.ts` + `scripts/generate-b17-control-inventory.ts`; B17-B `app/lib/view-session/{types,bus}.ts`; B17-C `app/lib/view-session/pcb3d.ts` + `app/components/pcb/hooks/usePcb3dViewSession.ts`; B17-D `app/lib/view-session/{targets,pcb,schematic,workspace}.ts` + the three editor hooks + `app/components/view-session/useViewSession.ts`; B17-E `app/lib/pcb/candidates/layout-candidate.ts`, `app/lib/project/{operation-timeline,io-outcome}.ts`; B17-F `app/lib/engineering/agent-exposure.ts`, `app/lib/agent/{view-context,layout-proposals,view-session-bridge}.ts`, `app/lib/pcb/candidates/routing-server.ts`, `app/lib/pcb/autoroute/freerouting-pass-executor.ts`, `app/components/view-session/useViewSessionBridge.ts`, `app/lib/project/layout-candidate-events.ts`.
- Generated artifacts (never hand-edited): `artifacts/ai-control-plane-b01/*` (B01 matrices), `-b04/*` (registry), `-b05/*`, `-b05-1/*` (read replay), `-b09/*` (agent manifest), `-b10/*` (runtime availability), `-b11/*` (replay pins), `-b17/ui-control-inventory.*`.
- Tests touched only to re-derive an exposure gate from `INTENTIONAL_AGENT_EXPOSED_TOOL_IDS` / `AGENT_EXPOSABLE_OPERATION_CLASSES` are listed in `tool-exposure.md` §6; no assertion was weakened (every gate still forbids mutate/destructive/release, qualification/release, canonical undo-redo exposure).
