# B17-D — Canvas navigation, selection and context proof

Labels: CONFIRMED = executed and measured on this machine; INFERRED = derived from code reading; PROPOSED = designed, not exercised; RECORDED = written down without a claim.

## What changed (CONFIRMED)

Three more editors joined the view-session bus (B17-B) beside `pcb3d` (B17-C): the PCB 2D canvas (`pcb`), the schematic sheet (`schematic`) and the workspace tabs (`workspace`, a new `VIEW_EDITORS` member). Each editor creates ONE session per mount through the shared `useViewSession` owner (`app/components/view-session/useViewSession.ts`, StrictMode-safe: a bus retired before the editor is live is replaced; the owner is the React store), APPLIES the bus state to its owners (Pixi scene / selection store / layer reducer; schematic pan-zoom and page selection; the workspace tab) and MIRRORS what the human changes outside the bus back through an editor-only `*.observe` command (canvas clicks, wheel zoom, drag pan, tab clicks), so the bus revision versions the selection and the camera.

### Semantic targets (`app/lib/view-session/targets.ts`)

A target is always a stable identity — never a screen coordinate:

| target | meaning | staleness |
|---|---|---|
| `{ kind: "component", ref }` | reference designator or stable id | rebase |
| `{ kind: "object", ref: SelectionRef }` | one footprint / pad / track / via / zone / text / dimension | rebase |
| `{ kind: "net", netId \| name }` | a net (name, `/root/name` or `…/name`) | rebase |
| `{ kind: "point", x, y }` | a world point the caller already holds (board nm / sheet px) | rebase |
| `{ kind: "selection" }` | the session's current selection | REFUSES a stale revision |
| `{ kind: "primary" }` | "this component": the primary selected item | REFUSES a stale revision |

"This component" resolves from the versioned selection the issuer observed: the bus context now carries `expectedViewRevision`, `viewRevision` and the `rebased` verdict, and `checkSelectionVersion` refuses `VS_STALE_REVISION` when the revision moved on OR when an optional `selectionDigest` (the `sirkit.selection-snapshot.v1` digest the captured editor context carries — the same digest `app/lib/agent/context.ts` computes) no longer matches; an absent selection is `VS_UNAVAILABLE` ("no current selection: 'this component' cannot be resolved"). Nothing is ever guessed from coordinates.

### `pcb` command set (`app/lib/view-session/pcb.ts`, 25 commands)

| runbook requirement | commands |
|---|---|
| fit design/board/selection | `pcb.fit-board` (board ∪ every placed footprint, the renderer's own frame), `pcb.fit-selection` (versioned) |
| zoom by bounded amount | `pcb.zoom { factor 0.25…4 }` (relative → refuses a stale view; needs the observed camera), `pcb.zoom-to { pxPerMm }` clamped to the renderer's 0.1…400 px/mm |
| pan to semantic object | `pcb.pan-to { target }` (keeps the zoom) |
| focus a stable refdes / object id / net | `pcb.focus { target }` (centre + frame from the observed viewport, never closer than 40 px/mm) |
| select / clear / add / remove | `pcb.select { refs \| target }` (rebase), `pcb.select-add` / `pcb.select-remove` (relative → refuse stale), `pcb.clear-selection`, `pcb.select-net { netId \| name }` |
| set visible/active layers | `pcb.set-layer-visible { layer, visible }` (rebase), `pcb.toggle-layer` (refuse stale), `pcb.set-active-layer` (copper only), `pcb.isolate-layer`, `pcb.show-copper`, `pcb.set-grid` / `pcb.toggle-grid`; inner layers refuse on a 2-layer board |
| highlight a net | `pcb.highlight-net` / `pcb.clear-highlight` — an amber overlay in the scene (`PcbScene.setHighlightRefs`), independent of the teal selection |
| reveal an ERC/DRC finding | `pcb.reveal-finding { "drc:<violation id>" \| "routing:<index>" }` → bounded focus (40 px/mm) + the DRC hook's transient flash; the probe reads the current DRC result and autoroute failures |
| measure without creating a dimension | `pcb.measure { a, b }` (ends: one component, one object, the primary item or a point; anchors from the current board) → `measurement { dxNm, dyNm, distanceNm, distanceMm }` shown as a toolbar readout; `pcb.clear-measurement`. A real dimension stays the canonical `pcb.dimension` transaction (dimension tool) — no view command creates one |
| read state | `pcb.read-state` |
| editor mirror | `pcb.observe { selection?, layers?, grid?, camera? }` — HUMAN ONLY (`VS_ROLE_FORBIDDEN` for an agent actor): an agent can read the selection but never assert it |

The scene gained `viewState()` (centre nm, px/mm, host size), `onViewChange` (moved / zoomed / fitted / resized) and `setHighlightRefs`; the editor reducer gained the explicit-value actions `set-layer-visible` and `set-grid`.

### `schematic` command set (`app/lib/view-session/schematic.ts`, 12 commands)

`schematic.fit-page`, `schematic.zoom { factor }` (relative → refuses stale; reconciled clamp 0.05…4 across the canvas' two clamps), `schematic.zoom-to`, `schematic.pan-to` / `schematic.focus { target }` (component by refdes — case-insensitive — or id, a sheet point, the versioned selection/primary), `schematic.select { component }`, `schematic.clear-selection`, `schematic.highlight-net { name }` (same-name labels; amber rings on the sheet), `schematic.clear-highlight`, `schematic.read-state`, `schematic.observe` (human-only). `schematic.reveal-finding` exists and settles `VS_UNAVAILABLE` with the exact reason — the schematic editor produces no ERC findings today (design review findings are chat text) — rather than pretending (RECORDED gap).

### `workspace` command set (`app/lib/view-session/workspace.ts`, 3 commands)

`workspace.open-editor { editor: schematic | pcb | 3d | bom | sim }` (refuses an unavailable tab), `workspace.read-state`, `workspace.observe` (human-only). The PCB editor's 3D SHEET stays the separate `pcb3d` session.

### Entry points (every one issues the command; the inventory classifies the callee names)

PCB: toolbar Zoom to fit, **Go to** (new: `pcb.select` + `pcb.focus` by refdes; a refusal is a toast), grid; palette zoom-fit / zoom-selection / grid / select-similar (net, layer, padstack) / layer toggles; context menu select net / similar; layer panel eye / activate / isolate / show all copper; inspector Zoom to (`pcb.fit-selection`); DRC panel rows, fab-dialog violations and autoroute failures (`pcb.reveal-finding`); Escape (`pcb.clear-selection`); the measurement readout's clear. Schematic: Fit, **Go to** (new; an inline notice shows a refusal). Workspace: the five tabs and Run sim's switch to SPICE.

### Registry

`view.canvas-navigation` re-baselined ui-only → implemented; new records `view.selection`, `view.layer-visibility`, `view.reveal-finding`, `view.measure` (92 records). Control rules: `view.pcb-reveal`, `view.pcb-goto`, `view.pcb-navigation`, `view.pcb-layers`, `view.pcb-selection`, `view.pcb-measure`, `view.pcb-goto-draft`, `view.schematic-fit`, `view.schematic-goto`, `view.workspace-tabs`; dispatchers (shortcuts, palette, context menu, scene gestures) name the records they reach. Inventory: 563 controls / 58 surfaces; gates 16/16.

## Tests (CONFIRMED)

- `app/lib/view-session/__tests__/b17-d-pcb-view-commands.test.ts` (6): the full command set; fit/zoom/pan bounded refusals without a board or observed view; focus by refdes/object/net/point with framing derived from the observed viewport; the versioned selection (replace/add/remove/net/clear; relative commands refuse a stale view; "this component" refuses stale revision, stale captured digest and absent selection); layers and grid (inner layers need 4 layers; only copper active; toggles refuse stale); highlight; reveal of a DRC violation and a routing failure; measure J1→R1 = 29.155 mm with the board byte-identical afterwards and no dimension; observe human-only.
- `app/lib/view-session/__tests__/b17-d-schematic-workspace-commands.test.ts` (3): schematic fit/zoom/pan/focus, select and "this component", observe human-only, net-label highlight, the honest ERC refusal; workspace tabs.
- view-session suites: 27/27 (12 bus, 6 pcb3d, 6 pcb, 3 schematic/workspace); engineering gates 16/16; PCB component suites 56 passed / 1 skipped; tsc 0; eslint 0 on the change set (page.tsx keeps its 14 pre-existing React-hooks errors, PcbEditor its 1).

## Browser proof (`e2e/semantic-editor.spec.ts` — serial on one synchronized board)

Run 8 on 2026-09-10 00:29 local (`pnpm exec playwright test e2e/semantic-editor.spec.ts`; Chromium 1243 against `next dev` on port 3100 under the fixture runtime, uuid namespace `b17c0000`; `retries: 0`): **3 passed in 39.6 s** — B17-C 3D acceptance 5.8 s, B17-D PCB canvas 4.9 s, B17-D workspace + schematic 2.2 s. Whole suite (`pnpm exec playwright test`, both specs on one server, prompt-to-Gerber first) on the final tree, 2026-09-10 01:07 local: **4 passed in 1.1 min** — prompt-to-Gerber 36.6 s with the qualification replaying the recording (`POST /api/pcb/qualify 200`), the three semantic scenarios 6.8 s / 5.0 s / 2.0 s.

Scenario 2 (PCB canvas, `data-testid="pcb-editor"` reports the bus state as `data-view` and the revision as `data-view-revision`):
- the canvas had reported its camera through `pcb.observe` (observed px/mm > 0, empty selection);
- toolbar **Go to J1** → `pcb.select` + `pcb.focus`: the selection's primary is the J1 footprint, the camera intent is `custom` at the bounded 40 px/mm with the sequence advanced, the view revision advanced, and the RENDERER followed — the observed centre converged on the intent within 0.05 mm and the observed zoom rounded to 40; the inspector shows J1;
- **Go to U9** → the toast `geometry unavailable: component U9 is not on the board`; the selection unchanged (a bounded refusal, never a guess);
- layer panel eye on Top Silkscreen → `pcb.toggle-layer` (relative, current revision): `layers.visible.silkTop` false, copper untouched; activate Bottom Copper → `pcb.set-active-layer`: `layers.active = copperBottom`;
- toolbar **Zoom to fit** → `pcb.fit-board`: the intent is `board` and the observed zoom dropped below 40 (the renderer zoomed out);
- **Run DRC**, then the first violation row → `pcb.reveal-finding { drc:<id> }`: `reveal.source = drc`, the finding id `drc:…`, item ids present, the camera a custom 40 px/mm frame at the violation;
- Go to J1 again re-selects it; screenshot `evidence/pcb-canvas-acceptance.png` (fitted board, layers panel, DRC rows, the U9 toast).

Scenario 3 (workspace + schematic):
- the tab bar (`data-testid="workspace-tabs"`) reports `tab: pcb`; clicking **Schematic** → `workspace.open-editor`: `tab: schematic`;
- the sheet (`data-testid="schematic-canvas"`) had reported its camera; **Go to R1** → `schematic.select` + `schematic.focus`: selection refdes R1, camera `custom` at the focus zoom 2, and the CANVAS applied it — the observed zoom is 2 and the sheet point at the viewport centre equals the intent within 2 px; no notice;
- **Go to Q9** → the inline notice `VS_UNAVAILABLE — sheet unavailable: component Q9 is not on the sheet`; the selection stays R1;
- **Fit** → `schematic.fit-page`: intent `page`, observed zoom below 2; screenshot `evidence/schematic-canvas-acceptance.png`;
- **PCB** tab → `tab: pcb`.

Runs 1–7 each failed on something real (below); nothing was retried away.

## Defects the proof found (CONFIRMED, fixed in this checkpoint)

1. **Layers panel unreachable (run 1).** `LayerPanel` was a shrinkable flex item (`min-h-0`) in the scrolling right column; it collapsed under the "Multilayer routing" panel — the B17-C screenshot already showed both headers on one line — and its eye/activate rows could not be clicked (the click was intercepted for the full five-minute budget). Fix: `shrink-0`, plain rows container.
2. **A stale observe was replayed (run 2).** `createViewCommand` derived the default invocation id from identity + command + payload + `issuedAt`. Under the frozen fixture clock, when the renderer returned to a camera it had reported before, the new `pcb.observe` carried the SAME id as the earlier one and the bus's single settlement replayed the OLD result instead of applying: the canvas was fitted but the mirror stayed at 40 px/mm. Fix: default ids are unique per issue (issue counter + digest); replay is only for a deliberately reused id (`invocationId`); the B17-B test and contract corrected — single settlement itself unchanged.
3. **The right column collapsed its panels (runs 3–4).** The DRC panel (`flex-1 min-h-0` with a `flex-1 min-h-0 overflow-y-auto` list) became a zero-height scroll box under its own header inside the scrolling column, so its violation rows were unreachable; the inspector overlapped the DRC header. Fix: every direct child of the column keeps its content height (`[&>*]:shrink-0`), the DRC panel is content-height with a bounded `max-h-96` scrolling list.
4. **Schematic property panels covered the toolbar (run 5).** The theory and KiCad property panels opened at `top-4 right-4`, over the toolbar group holding Fit and Go to: once a component was selected, those controls were unreachable. Fix: the panels open below the toolbar group (`top-14`).
5. **View sessions consumed the application's id source (full-suite run 3).** `newViewSessionId()` drew on `crypto.randomUUID()`; with the workspace and schematic sessions created at page mount, every id the application minted afterwards (project, board, schematic components and wires — `app/page.tsx` mints them with `crypto.randomUUID()`) shifted in the deterministic proof sequence, the placed-board revision no longer matched the router recording, and the prompt-to-Gerber journey's qualification answered `ROUTE_FIXTURE_MISS:pcb2-0562a9c98bc08dd4` (500). The semantic-editor scenarios did not notice because they stop before qualification. Fix: session ids come from their own counter + entropy generator and never touch the UUID source (session ids are never persisted; uniqueness within the tab is all they need). Confirmed by the fix: the whole suite replays the recording again.
6. **Proof harness (runs 6–7, RECORDED).** Run 6 clicked the AI-chat activity before the client had hydrated (the header still read "Loading…", no client request had been made in 20 s after a cold Turbopack client compile) — the journeys now wait for the project name (`expectHydrated`, both specs); run 7 used the Fit button's `title` as its accessible name while its visible text "Fit" is the name — the locator uses the title attribute. Neither is a product defect.

## Observation (RECORDED)

A CI-list vitest run that overlapped a full Playwright run on this machine failed five suites that pass in isolation (migrations with disposable PostgreSQL, the acceptance pipeline's release step, the invariant tripwires, the fixture-runtime import scan); re-run alone the list passed 48 files / 387 tests (3 files / 13 tests skipped, opt-in live). Load sensitivity is recorded, not treated as a pass.

## Bounded (RECORDED)

- Schematic ERC findings do not exist; `schematic.reveal-finding` is a bounded refusal by design until an ERC engine exists.
- Manual orbit/zoom in the 3D preview is not mirrored to the `pcb3d` bus (B17-C note stands); the 2D canvas and the sheet ARE mirrored (`observe`).
- `pcb.measure` has no on-canvas control yet (the readout and its clear are the controls); tools issue it in B17-F.
- Units differ per editor (board nm / px-per-mm; sheet px / zoom factor); targets carry the editor's world units and the state reports them explicitly.
