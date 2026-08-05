# R06-STATE01 — Durable Project Memory, Undo/Redo, and Reliable Editor Rendering

Stage report, 2026-07-30. Browser evidence project: `8448ef62-47ed-4aa0-953a-745d285ad850`.

## 1. Root causes (Section 3 diagnosis — actual, verified in code)

**Zero-memory behavior** (seven distinct causes):
1. `app/page.tsx` held ALL editor state (components, kicadComponents, wires, netLabels, chat messages, workflow view) in React `useState` with no load and no save. Reload → empty editor.
2. The Projects panel was a hardcoded mockup (`ProjectTreeItem name="LED dimmer (9V)"` literals; dead "New project" button) and the header project name was a string literal.
3. A real `SavedProject` record WAS created — but lazily by `ensureCurrentProjectScope()` on first PCB-tab mount, seeded with the then-current schematic and never updated again.
4. PCB editor board edits (moves, rotations, routing, zones) were never persisted anywhere: a test deliberately banned local board saves (`expect(source).not.toContain("saveCurrentBoard(")`) to protect durable authority, with no replacement persistence for editor work.
5. `<PcbEditor/>` unmounted on every tab switch (`view === "pcb" ? <PcbEditor/> : …`), destroying board state and undo history.
6. PCB undo history was in-memory only, reseeded on every authoritative reload.
7. `loadProject` returns null when ANY optional staged sub-state fails validation; `ensureCurrentProjectScope` then silently minted a NEW project id — identity churn and orphaned durable boards.

**Footprint disappearance**: the durable sync plan places new components in a staging strip at x = −50 mm (columns of 4 mm) — deliberately OUTSIDE the board outline — while `scene.zoomToFit()` framed ONLY the outline (`outlineBBoxNm(board.outline)`). Footprints existed in the model and rendered, permanently out of view. Units were consistent throughout (nm); no coordinate bug, no opacity bug, no key bug.

**Silent/no-op controls**:
- Sync placement dialog: `handleSync(_placement) { void _placement; … }` — options collected and discarded.
- "New project" button: no onClick.
- Outline edits: when the history stack didn't exist yet, `onOutlineChange` fell back to a silent `dispatch({type:"set-outline"})` (invisible, un-undoable board mutation); an interrupted outline-handle drag ("leave" event) also left an uncommitted mutation.
- `/api/pcb/qualify` and `/api/pcb/release` (R05) had no UI at all.

## 2. Storage architecture selected (Section 5)

- **Live project record**: existing `localStorage` `SavedProject` (extended, `schemaVersion: 2`) — the record is <2 MB at demo scale, already carries validation + migrations, and every CD-stage page depends on it. Fields added: `chat`, `designPrompt`, `workflowView`, `pcbWorking` (+`baseRevision`/`baseDigest`), `pcbWorkingConflict`, `pcbStages`.
- **Revision checkpoints**: IndexedDB (`sirkit-checkpoints` DB) — checkpoint history carries full board snapshots (hundreds of KB each) that would exhaust the localStorage quota the live record depends on. Store abstracted (`CheckpointStore`) with a memory implementation for unit tests.
- **Autosave**: debounced (600 ms) writer with truthful `Saving…/Saved/Save failed — <reason>` status; failed writes stay pending and retry; `pagehide`/`visibilitychange` flush.

**Source-of-truth rules**: the durable server board (pcb-sync) is the authority for everything ever APPLIED. `pcbWorking` layers the user's editor work on an exact authoritative base named by `baseRevision`. On hydration: working copy wins iff its base equals the current server revision (same ancestry, newest complete state); otherwise the working copy is stashed as `pcbWorkingConflict` with a reason — never silently overwritten, never silently adopted. Boards enter the editor only through `normalizeBoardForEditor` so semantic revisions are migration-invariant.

## 3. Undo/redo transaction model (Section 7)

- **Schematic**: new snapshot history (`SchematicHistory`) over the 4 model arrays; mutations recorded with labels ("Rotated R3", "Generated schematic: …", "Restored checkpoint: …"); drags coalesce to one step (350 ms); undo/redo restore exact model state; new operation after undo clears the future (new branch). Visible header buttons with disabled states + tooltips, Ctrl+Z/Y/Shift+Z.
- **PCB**: existing patch-based `PcbHistory` retained; AI generation, auto-place, autoroute each commit as ONE transaction (verified: route undo restores exactly 0 tracks/0 vias; redo restores 75/1).
- **Durable restore**: checkpoints at generation, sync apply, placement, routing, qualification, release; History dialog lists session undo entries + durable checkpoints with one-click Restore (applied as a new undoable operation). Reload keeps the checkpoints (IndexedDB) — the mission's permitted equivalent to persisting the volatile undo stack.

## 4. Dependency/staleness model (Section 8)

`pcbStages` records `routedBoardRevision`/`releasedBoardRevision` (semantic `pcbRevisionId` over the normalized board). The editor recomputes the current board revision on every committed change: mismatch → amber "Routing evidence is stale …" banner naming both revisions, and the Release button disables with the same reason. Schematic→PCB staleness keeps the existing netlist-hash dirty badge. Server-side MFG01 release recomputes RC01–RC03 fresh regardless (fail-closed). Observed live: undoing the route raised the banner; re-routing cleared it; a diverged working copy was stashed as a conflict record, never merged.

## 5. Browser acceptance evidence (Section 11, real UI + real services, no mocks)

**Scenario A — schematic recovery: PASS**
- Fresh project → live Anthropic generation of the 555 blinker → 9 components (C1,C2,C3,D1,J1,R1,R2,R3,U1), 13 wires, 20 net labels, ALL 9 with atomic authority ids; schematic rendered (69 SVG text nodes).
- Reload: **identical** project id, refs, byte-identical positions (e.g. U1 [1370,460,0]), authority count 9/9, chat (4 messages), rendered again.
- Drag U1 → (1650,460); Undo → exactly (1370,460); Redo → exactly (1650,460); reload → (1650,460) persists.

**Scenario B — placement recovery: PASS**
- Sync: bindings with live progress → publish 201 → preflight plan → apply → 9/9 footprints materialized and **arranged inside the outline** (3×3 grid, 33–59 mm) — the staging-strip disappearance is fixed; zoom-to-fit now frames outline ∪ footprints.
- Selection: U1 inspector shows ref + X/Y/Rotation (12.6/16.7/270 post-route); rotate (R) → model 270° persisted; drag → (75,36.5); Ctrl+Z → (59,47.5); Ctrl+Y → (75,36.5).
- Reload: positions/rotations/outline/padNets identical (9 footprints, U1 [75,36.5,270], 8 pad-nets on U1, 8 nets); PCB tab restored (workflowView).

**Scenario C — routing recovery: PASS**
- Real router (bundled FreeRouting): local autoroute committed one "Autoroute board" transaction (75 tracks/1 via); undo → exact pre-route board (0/0) + stale banner; redo → routed again.
- Server qualification ("Qualify & route"): RC01–RC03 verified compact board **21×21 mm**, 74 tracks/1 via, 0 remaining connections, 0 shorts, 0 route-blocking DRC errors.
- Reload: routed board re-rendered, counts identical, evidence revision matches (no stale banner after the migration-invariance fix).

**Scenario D — local file recovery: PASS**
- Save project → `Untitled project.sirkit.json` (2 MB; format marker, formatVersion 1, sha256 integrity, 8 checkpoints, working board, stages, chat).
- Wiped the project record AND the checkpoint database; Open project via the real file input → same stable id, 9 components, chat, routed working board (74 tracks), stage evidence, all 8 checkpoints restored.
- Re-ran MFG01 release from the restored project: `POST /api/pcb/release → 200` (RC01–RC03 recomputed server-side; ZIP produced; releaseId `mfg-release-5fbf70df…`). No regeneration of the design.

**Scenario E — failure recovery: PASS**
- Malformed file → "Open project failed: The file is not valid JSON." — nothing imported, project intact.
- formatVersion 99 → "…newer than this app supports (1). Update Sirkit to open it."
- Tampered payload → "Integrity check failed — the file is corrupted or was modified. Nothing was imported." (unit-verified; nothing written).
- Storage failure (setItem throws) → header shows "Save failed — Browser storage write failed (quota…)"; never "Saved"; on recovery the retained write retried → "Saved".
- Reload 150 ms after an edit (inside the 600 ms debounce) → pagehide flush persisted it. Same-tick reload → last complete valid revision preserved.
- Missing atomic asset on import → reported per part id, never fabricated (unit-verified).
- Route failure: partial route reported truthfully ("2 unrouted"), DRC blocked, board recoverable by undo.

**Console errors after: none.** Counts before/after reload: components 9/9, nets 8/8, footprints 9/9, tracks 74/74, vias 1/1.

## 6. Tests (Section 12)

- New: 36 unit tests (serialization round-trip, stable ids, salvage/migration, autosave truthfulness, undo/redo + branching, checkpoint store, project-file export/import/tamper/version/missing-asset/no-overwrite, staged-arrangement determinism + bounds).
- Full suite: **1597 passed / 1621** (20 skipped; 4 failures pre-existing — reproduced identically on the pre-R06 baseline via git stash: 2 perf-budget flakes under load, `llm errors` message-wording, `assignment-queue revalidation`).
- Focused post-final-edit sweep: 185 passed / 192 (7 DB-gated skips). TypeScript clean; ESLint clean on all touched files (page.tsx retains its 17 pre-existing `react-hooks/refs` errors, count reduced from baseline 18).

## 7. Remaining limitations (truthful)

1. **One unexplained in-session board mutation**: twice during the E2E, the working copy's outline drifted slightly (21×21 → 21.41×21.51 → 21.35×22.14 mm) with no history entry, before the silent-outline-mutation holes were closed. The staleness gate caught it both times and blocked release; re-qualifying recovered. The two known silent-outline paths (history-less `set-outline` fallback; interrupted handle drag) are now closed, and the value has been reload-stable since, but the original trigger was not conclusively identified.
2. Anthropic credits were exhausted mid-run (external): new AI generation is currently unavailable; all persistence/recovery features are unaffected.
3. Schematic canvas drags record with the generic label "Edited schematic" (labels are precise for rotate/delete/rename/value/AI ops).
4. `pcbWorkingConflict` is preserved and inspectable in the record but has no dedicated "reopen conflict copy" UI yet.
5. In-session undo stacks are volatile by design; durable checkpoints provide the restore path across reloads (mission-permitted equivalence).
6. Chat panel open/closed state is not persisted (messages, prompts, and activity logs are; interrupted operations are marked "(interrupted by reload)").
7. An automation click at low zoom can miss 0805-sized footprints (pad-level pick highlights instead); zooming in resolves it. Footprint-level selection, move, rotate verified on SOIC-scale parts.
8. `/api/pcb/repair/agent` returned 503 (provider credits) when invoked with DRC errors present — the truthful failure path; board unchanged.

## 8. Post-verdict follow-ups (2026-07-30, owner-requested)

1. **SCHEMATIC_PARITY_NOT_EVALUATED** — the schematic netlist was derived state materialized only by clicking Sync; after reload every consumer (fab checks, live readiness, DRC repair context, autoroute/autoplace verification, KiCad export) ran netlist-less. Fixed: `liveNetlist` memo derived from the current schematic feeds all five consumers. Verified in-browser: fresh reload, no sync → fab dialog "PCB fabrication checks passed", SCHEMATIC_PARITY: pass on revision pcb2-663cf8ec5ab4badd.
2. **"Verification incomplete: 1 required fact unproven"** — three hard fabrication constraints (`minHoleToHoleNm`, `minCourtyardClearanceNm`, `minSilkPadClearanceNm`) had no registered checker (`unassigned-consumer/unsupported`) even though the DRC engine implements all three geometry checks. Fixed: registered to `pcb-physical-rule-resolver` with kind-mapped DRC evidence (over-attribution errs strict); silk aligned to `advisory` strength matching the DRC's deliberate warning-severity silk policy (it was never blocking anywhere — the "hard" flag was overclaimed metadata). Bonus real bug found and fixed while proving the strict direction: with a preset courtyard clearance of 0, `shapeDistance`'s sign-only overlap (gap 0 for overlapping rects) meant `courtyardOverlap` could NEVER fire — added a strict SAT interior-overlap test (detection strictly stronger). Verified: toolbar pill now "PCB fabrication checks passed"; regression test proves overlapping courtyards still FAIL the check.
3. **"Verified release requires the MFG01 server-authoritative source loader"** — the fab dialog's verified-release button posted the browser board to the legacy gerbers endpoint, which correctly refuses to mint authority from client state. Fixed: the dialog's verified release now drives the same MFG01 server-authoritative `/api/pcb/release` as the toolbar button (server reloads durable authority, recomputes RC01–RC03, deterministic ZIP); engineering overrides keep the legacy explicitly-labelled unverified path. Verified in-browser: `POST /api/pcb/release → 200`, ZIP downloaded, old 409 message gone.

Tests after follow-ups: 731 passed / 735 (4 DB-gated skips) across constraints, pcb, pcb-sync, and pcb component suites; tsc and eslint clean.

## 9. Final acceptance round (2026-07-30, owner-mandated completion)

**1. Netlist freshness audit** — the sync-time netlist snapshot had NO revision binding to the current schematic and was only consulted exactly when the live netlist could not be built. Removed entirely: `liveNetlist` (derived from the current schematic) is the sole source for fabrication checks, readiness, DRC-repair, autoroute/autoplace verification, and KiCad export; unavailable stays truthfully unavailable. Regression tests: source-level guard (no snapshot state, no fallback expression), absent-netlist → parity "unknown"/NOT-EVALUATED never pass, disagreeing netlist → parity fail.

**2. Full browser proof** — executed on the real UI against real services:
- Fresh project creation; live generation attempted → **genuine external blocker demonstrated**: Anthropic `insufficient_quota` ("credit balance is too low"), OpenAI key also exhausted. The UI surfaced the exact actionable error ("Add credits or raise the limit in the provider console — retrying will not help until then"). The approved 555 design used for the remainder was generated in-browser on 2026-07-29 under the same feature set.
- Reload → schematic recovered (9 refs, 9/9 authority, rendered); drag U1 1250→1400, Undo → exactly 1250, Redo → exactly 1400, persisted.
- PCB: 9/9 footprints rendered at zoom-to-fit with 74 tracks (screenshots; 191 primitives, 60 fps); U1 selected (inspector 12.6/16.7/270), rotated 270→180, moved, Ctrl+Z×2 → exactly (12.6,16.7,270), Ctrl+Y×2 → exactly (12.5,16.5,180); reload → identical placement, counts 9/74/1, PCB view restored; staleness banner truthfully raised (footprint moved after routing) and Release disabled with that reason.
- Save project file (2.7 MB, 12 checkpoints, integrity sha256) → record + pointer + checkpoint DB wiped → Open via the real file input → **same stable id**, 9 components, chat, routed board with the moved U1 exact, stage evidence, and all 12 checkpoints restorable in the History dialog.
- From the restored project: Qualify & route (server, 200) → **Release ZIP (200, downloaded)** — the verified manufacturing package produced through the browser without regenerating the design.

**Critical defect found BY this proof, root-caused and fixed**: a flush landing between `hydrateProject()` and the React commit that populates `liveStateRef` persisted the pre-hydration EMPTY state over a populated record (observed once: state+chat wiped, `workflowView` reset to the initial "schematic"; the board survived on its separate save path; plain reload/switch/create replays were all safe — only the unload-during-slow-hydration window hits it). Fix: `persistProject` refuses to write while `pendingHydrationForRef` names the current project; the ref clears in the same commit that carries the hydrated state, so the first allowed write is always the hydrated one. The wiped project was fully recovered through the UI checkpoint-restore — the durable-history safety net working as designed. Second defect found and fixed in the same round: the checkpoint store's self-heal upgrade left the DB above the pinned open version (`VersionError` on every later open) — plain opens are now versionless with create-on-upgrade only when the store is missing.

**3. Control audit** — every demo-path control verified as: performs its action (generate*, sync w/ live progress, apply plan, qualify w/ "Qualifying…" progress, release, auto-place preview+apply, autoroute single-transaction, DRC, zoom-to-fit, select/move/rotate, save/open project, history restore, new/open/delete project, KiCad export), shows progress, is disabled with a reason (Undo/Redo when unavailable or wrong view, Release when routing evidence is stale, Qualify without a durable board, outline edits while history loads), or returns a specific actionable error (generation quota, import failures, storage failures, repair-agent 503). *Generation performs its action when the provider is funded; its failure path is verified actionable.

**4. DB-backed integration run** — the previously-skipped DB-gated suites ran against the live Supabase database: schema-integrity (deferred FKs, check vocabulary, head-last publication, rollback), durable-workflow tenant-scope, ingest-integrity — **10/10 passed** (test timeouts raised to integration-grade 60 s; the 5 s unit default was the only failure cause).

**5. Independent ZIP inspection** (third-party gerbonara, shares no Sirkit code) — release `mfg-release-5fbf70df…`: all 7 expected layers (copper t/b, mask t/b, silk, outline, PTH drill + job file); outline **closed** (4 segments, no dangling endpoints), 21.10×21.10 mm bbox vs 21.00 nominal ✓; Excellon parses with exact decimal tools 0.4/1.0 mm ≥ profile minimum; **nonempty copper** (95 top / 7 bottom objects); drills inside outline; no mirroring; full-stack autodetect. **Determinism/byte-identity**: two consecutive server-authoritative fetches byte-identical, sha256 `b2dc0282…` matching the declared `X-Sirkit-Archive-Sha256` and the same releaseId as the browser-produced download.

**Final tests**: full suite 1611 passed / 1629 (6 failures under full parallel load: 3 pre-existing on the pre-R06 baseline — llm error wording, assignment-queue revalidation, auto-place perf budget — and 3 perf/DB-latency flakes that pass 43/43 in isolation; 12 env-gated skips for kicad-cli/spice-worker/live-assist). TypeScript clean; ESLint clean on all touched files. Zero browser console errors.

MANUFACTURER UPLOAD PERFORMED: NO · PCB ORDER PLACED: NO · PHYSICAL HARDWARE VALIDATED: NO
