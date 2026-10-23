/**
 * [B17-A] UI CONTROL REGISTRY — every actionable control of the application
 * (as scanned by `control-surface.ts`) is classified here as exactly one of:
 *
 *   semantic    — dispatches one registered semantic command (`recordIds` = the
 *                 B01 action-registry record(s) it reaches);
 *   dispatcher  — routes to SEVERAL registered commands or to other classified
 *                 controls (keyboard dispatchers, palettes, generic inspector
 *                 fields, context-menu items); `recordIds` lists what it reaches;
 *   view        — presentation-only: opens/closes chrome, switches a tool mode,
 *                 tab, pane or layer visibility, edits a form DRAFT that only a
 *                 later semantic control commits, navigates the canvas;
 *                 `recordIds` names the view record when one exists;
 *   internal    — explicitly non-callable plumbing (stopPropagation shields,
 *                 non-dismissable modal backdrops, static pills);
 *   unavailable — intentionally unavailable with a VISIBLE reason.
 *
 * Rules are matched in order (first match wins) against the site's surface,
 * kind, element, label and handler summary. Exactness comes from two gates:
 * every scanned site must match a rule and every rule must match at least one
 * site (no stale rules), and the generated inventory CSV is committed and must
 * byte-match the render — a new control changes the CSV, so CI fails until
 * the change is reviewed and regenerated.
 *
 * Node-free: safe to import from tests and generators alike.
 */
import { ACTION_COVERAGE_REGISTRY } from "./action-registry";
import type { ControlKind, ControlSite } from "./control-surface";

export const CONTROL_CLASSES = ["semantic", "dispatcher", "view", "internal", "unavailable"] as const;
export type ControlClass = (typeof CONTROL_CLASSES)[number];

export interface ControlRule {
  /** Stable rule id (reported in the inventory). */
  id: string;
  /** Surface: exact repo path, a directory prefix ending in "/", or a RegExp. */
  surface: string | RegExp;
  kind?: ControlKind | readonly ControlKind[];
  element?: string | RegExp;
  label?: RegExp;
  handler?: RegExp;
  classification: ControlClass;
  /** B01 action-registry ids reached (required for semantic/dispatcher; optional view record for view). */
  recordIds?: readonly string[];
  /** Required for `unavailable`: the reason the control shows. */
  reason?: string;
  note?: string;
}

const rule = (r: ControlRule): ControlRule => Object.freeze(r);
const PCB = "app/components/pcb/";
const PAGE = "app/page.tsx";
const CHAT = "app/components/chat/"; // [B18-D I8]
const SPICE = "app/components/spice/";
const BOM = "app/components/bom/BomView.tsx";
const SHEETS = "app/components/schematic/SheetNavigator.tsx"; // [PR-J3, 2026-10-22] the Sheets navigator (runbook J.3; OD-255 item 7)
const CD =/^app\/components\/(architecture|circuit-verification|interfaces|model-simulation|power|requirements|schematic-compiler)\//;

export const CONTROL_RULES: readonly ControlRule[] = Object.freeze([
  // ── universal plumbing ────────────────────────────────────────────────────
  rule({ id: "internal.stop-propagation", surface: /./, handler: /^(e|event)\.stopPropagation$/, classification: "internal", note: "click shield: keeps a click inside a card/dialog from reaching the backdrop" }),
  rule({ id: "internal.context-menu-prevent-default", surface: PCB + "ContextMenu.tsx", kind: "context-menu", classification: "internal", note: "suppresses the browser context menu on the custom menu" }),
  rule({ id: "internal.static-pill", surface: SPICE + "SpiceStudio.tsx", kind: "click", label: /^assigned$/, handler: /^noop$/, classification: "internal", note: "a static status pill rendered as a button; no handler" }),
  rule({ id: "internal.recovery-modal-not-dismissable", surface: PAGE, kind: "dialog", handler: /^noop$/, classification: "internal", note: "the activation-recovery dialog is deliberately not dismissable; its buttons are classified separately" }),

  // ── keyboard dispatchers (each routes several registered commands) ────────
  rule({ id: "dispatcher.page-shortcuts", surface: PAGE, kind: "shortcut", classification: "dispatcher", recordIds: ["project.undo-redo", "schematic.delete-component", "schematic.connect", "schematic.move-rotate", "view.canvas-navigation"], note: "schematic keyboard shortcuts (undo/redo, delete, escape/tool keys, rotate, fit)" }),
  rule({ id: "dispatcher.pcb-editor-shortcuts", surface: PCB + "PcbEditor.tsx", kind: "shortcut", classification: "dispatcher", recordIds: ["pcb.undo-redo-canonical", "pcb.rotate-side-footprint", "pcb.delete-item", "pcb.arrange", "validation.erc-drc", "placement.auto", "routing.autoroute", "view.pcb-3d-control", "view.canvas-navigation", "view.selection"], note: "PCB editor keyboard shortcuts (undo/redo, rotate, tool keys, escape → pcb.clear-selection); the palette actions they mirror are classified individually" }),
  rule({ id: "dispatcher.command-palette", surface: PCB + "CommandPalette.tsx", kind: ["click", "key"], classification: "dispatcher", recordIds: ["pcb.arrange", "pcb.delete-item", "validation.erc-drc", "placement.auto", "routing.autoroute", "pcb.export-kicad", "view.canvas-navigation", "view.selection", "view.layer-visibility", "view.pcb-3d-control"], note: "runs the highlighted palette action; every action is a classified `palette` site" }),
  rule({ id: "dispatcher.context-menu-item", surface: PCB + "ContextMenu.tsx", kind: "click", classification: "dispatcher", recordIds: ["pcb.delete-item", "pcb.arrange", "pcb.protection", "view.selection"], note: "runs the menu item's own handler supplied by the editor (select net / similar issue pcb.select*)" }),
  rule({ id: "dispatcher.empty-state-action", surface: PCB + "EmptyState.tsx", classification: "dispatcher", recordIds: ["pcb.sync-durable"], note: "the empty state's primary action is supplied by the editor (Schematic → PCB)" }),
  rule({ id: "dispatcher.inspector-generic-field", surface: /^app\/components\/pcb\/inspectors\/fields\//, classification: "dispatcher", recordIds: ["pcb.edit-track", "pcb.edit-via", "pcb.zone", "pcb.silkscreen-text", "pcb.dimension", "pcb.protection"], note: "generic inspector fields commit the owning inspector's edit command; drafts are view state" }),
  rule({ id: "dispatcher.spice-command-palette", surface: SPICE + "SpiceStudio.tsx", kind: "click", handler: /^executeCommand/, classification: "dispatcher", recordIds: ["spice.workbench"], note: "runs the highlighted SPICE studio command" }),
  rule({ id: "dispatcher.spice-shortcuts", surface: SPICE + "SpiceStudio.tsx", kind: "shortcut", classification: "dispatcher", recordIds: ["spice.workbench"], note: "SPICE studio keyboard shortcuts (palette, undo/redo)" }),
  rule({ id: "dispatcher.pcb-context-menu-escape", surface: PCB + "ContextMenu.tsx", kind: "shortcut", classification: "view", note: "Escape closes the menu" }),
  rule({ id: "dispatcher.manufacturing-retry", surface: PCB + "ManufacturingWorkflowPanel.tsx", label: /^p2g-retry$/, classification: "dispatcher", recordIds: ["pcb.qualify-route", "manufacturing.release"], note: "retries the last failed operation (qualification or release) without resending refused pins" }),
  rule({ id: "dispatcher.pcb-scene-gestures", surface: "app/lib/pcb/render/scene.ts", kind: "gesture", classification: "dispatcher", recordIds: ["pcb.move-footprint", "pcb.rotate-side-footprint", "pcb.route-copper", "pcb.create-via", "pcb.zone", "pcb.silkscreen-text", "pcb.dimension", "pcb.board-geometry", "view.canvas-navigation", "view.selection"], note: "the PCB canvas emits pointer down/move to the active tool's subscribers (select/move/drag, route + via placement, zone, silk, dimension) and to pan/zoom; clicks and wheel zoom are mirrored onto the view-session bus by pcb.observe" }),
  rule({ id: "view.context-menu-outside-click", surface: PCB + "ContextMenu.tsx", kind: "gesture", classification: "view", note: "a pointer down outside the menu closes it" }),
  rule({ id: "schematic.drag-end", surface: PAGE, kind: "gesture", label: /^mouseup:/, classification: "semantic", recordIds: ["schematic.move-rotate"], note: "window mouseup ends a drag gesture and commits the move (B07.1)" }),
  rule({ id: "view.schematic-wheel-zoom", surface: PAGE, kind: "gesture", label: /^wheel:/, classification: "view", recordIds: ["view.canvas-navigation"], note: "wheel zoom/pan on the schematic canvas and the waveform plot" }),
  rule({ id: "view.document-click-outside", surface: PAGE, kind: "gesture", label: /^mousedown:/, classification: "view", note: "a mouse down outside the open menu closes it" }),
  rule({ id: "dispatcher.chat-composer", surface: PAGE, handler: /^(handleComposerSubmit|e\.preventDefault,handleComposerSubmit)$/, classification: "dispatcher", recordIds: ["schematic.generate", "schematic.edit-topology", "ai.chat-qa", "pcb.bounded-edit-propose", "schematic.edit-tier1-propose", "schematic.replace-component-propose", "agent.execution-grant"], note: "the composer submits a generation, an edit or a chat turn; agent turns may return sealed proposals (tier-1 edits, replacements, bounded PCB edits) that their own classified controls approve, and [B18-D I1] server-minted execution grants the PCB editor's card confirms" }),
  rule({ id: "view.autonomy-mode-draft", surface: CHAT + "AutonomyModeControl.tsx", kind: "change", handler: /^setTarget$/, classification: "view", note: "[B18-D I11] picks the autonomy mode to change to (a draft; nothing is sent until Change)" }),
  rule({ id: "agent.autonomy-change", surface: CHAT + "AutonomyModeControl.tsx", handler: /^change$/, classification: "semantic", recordIds: ["agent.autonomy-setting"], note: "[B18-D I11] a project administrator changes the agent autonomy through POST /api/agent/autonomy with exactly { mode, expectedRevision }; the server's policy row, human-actor rule and compare-and-set decide" }),
  rule({ id: "ai.chat-run-stop", surface: PAGE, handler: /^stopChatRun$/, classification: "semantic", recordIds: ["ai.chat-qa", "agent.execution-grant"], note: "[B18-D I9] Stop: cancels the chat run's response reader and carries nothing; the route aborts the run and the loop retires its still-issued explicit grants (run_cancelled); a change the editor had already started still finishes and is reported in its entry; [PR-L, 2026-10-18] runbook L.5: labelled Stop answer - it ends the streaming chat turn ONLY: a durable design task the turn started or attached keeps running in its worker (Stop design on its card, or a confirmed control chip, cancels that)" }),
  rule({ id: "agent.execution-entry-undo", surface: CHAT + "ExecutionEntryActions.tsx", handler: /^onUndo$/, classification: "semantic", recordIds: ["project.operation-timeline", "project.undo-redo", "pcb.undo-redo-canonical"], note: "[B18-D I8] Undo this change on a committed AI change's chat entry: the click carries nothing; the page asks the project timeline to undo the newest operation only if it is exactly this entry's transaction (NOT_LATEST otherwise) — the PCB store's own Undo, one history step" }),
  rule({ id: "view.composer-route-override", surface: PAGE, handler: /^overrideComposerRoute$/, classification: "view", note: "[B18-D I1] sends the message to the assistant instead of the suggested schematic edit or generation (and back) — routing only; the server loop or the proposal review decides everything" }),

  // ── page.tsx: project / files / recovery ──────────────────────────────────
  rule({ id: "project.open-file", surface: PAGE, handler: /^(handleImportProjectFile|importInputRef\.current\.click)$/, classification: "semantic", recordIds: ["project.open-file"] }),
  rule({ id: "project.save-file", surface: PAGE, handler: /^(handleExportProject|downloadRecoveryBackup)$/, classification: "semantic", recordIds: ["project.save-file"] }),
  rule({ id: "project.delete", surface: PAGE, label: /^Delete project/, classification: "semantic", recordIds: ["project.delete"] }),
  rule({ id: "project.switch-create", surface: PAGE, handler: /^(createNewProject|switchProject|handleRenameProject)$/, classification: "semantic", recordIds: ["project.switch-create"] }),
  rule({ id: "project.checkpoint", surface: PAGE, handler: /^restoreCheckpoint$/, classification: "semantic", recordIds: ["project.checkpoint"] }),
  rule({ id: "project.recovery-resolution", surface: PAGE, handler: /^resolveRecovery(KeepLocal|StartFresh|AdoptCanonical)$/, classification: "semantic", recordIds: ["project.hydrate"], note: "resolves a canonical-history recovery (B07/B12): keep local, start fresh, adopt canonical" }),
  rule({ id: "project.undo-redo", surface: PAGE, handler: /^(undoSchematic|redoSchematic)$/, classification: "semantic", recordIds: ["project.undo-redo"] }),
  rule({ id: "project.operation-timeline", surface: PAGE, handler: /^undoLatestProjectOperation$/, classification: "semantic", recordIds: ["project.operation-timeline", "project.undo-redo"], note: "[B17-E] project-level undo through the operation timeline (delegates to the owning store; refuses on divergence)" }),
  rule({ id: "view.page-reload", surface: PAGE, handler: /^window\.location\.reload$/, classification: "view", note: "reloads the workspace from durable state" }),

  // ── page.tsx: schematic generation, edits, review ─────────────────────────
  rule({ id: "schematic.generate", surface: PAGE, handler: /^setPendingReplace,applySchematic\(\)\.then,applySchematic,finishActivityLog$/, classification: "semantic", recordIds: ["schematic.generate"], note: "explicit approval of the generated proposal" }),
  rule({ id: "schematic.generate-retry", surface: PAGE, label: /^Retry$/, classification: "semantic", recordIds: ["schematic.generate"], note: "retries the last AI request after a provider failure" }),
  rule({ id: "schematic.tier1-apply", surface: PAGE, handler: /^applyTier1Proposal$/, classification: "semantic", recordIds: ["schematic.edit-tier1-apply"] }),
  rule({ id: "schematic.apply-suggestions", surface: PAGE, handler: /^handleApplySuggestions$/, classification: "semantic", recordIds: ["schematic.edit-topology"], note: "review suggestions applied through the validated edit path and the review dialog (B16-A F11)" }),
  rule({ id: "schematic.review-advisory", surface: PAGE, handler: /^setMoreMenuOpen,(handleReview|handleTidyLayout|handleSecondOpinion)$/, classification: "semantic", recordIds: ["schematic.review-advisory"] }),
  rule({ id: "schematic.replace-propose", surface: PAGE, handler: /^onReplace$/, classification: "semantic", recordIds: ["schematic.replace-component-propose"] }),
  rule({ id: "schematic.set-property", surface: PAGE, handler: /^(setComponentPropertiesCanonical(,schDisplayRef)?|e\.preventDefault,commit,setDraft)$/, classification: "semantic", recordIds: ["schematic.set-property"] }),
  rule({ id: "schematic.net-label-commit", surface: PAGE, handler: /^e\.preventDefault,commitLabelDraft,setLabelDraft$/, classification: "semantic", recordIds: ["schematic.connect"] }),
  rule({ id: "schematic.delete-component", surface: PAGE, label: /^Delete$/, handler: /^onDelete$/, classification: "semantic", recordIds: ["schematic.delete-component"] }),
  rule({ id: "schematic.rotate", surface: PAGE, handler: /^(onRotate|onRotationChange)$/, classification: "semantic", recordIds: ["schematic.move-rotate"] }),
  rule({ id: "schematic.export-kicad", surface: PAGE, handler: /^handleExportKicad$/, classification: "semantic", recordIds: ["schematic.import-export-kicad"] }),
  rule({ id: "schematic.sheet-size", surface: PAGE, handler: /^(setPageSize|changeSheetSize)$/, classification: "semantic", recordIds: ["schematic.sheet-size"], note: "[PR-E] the toolbar select and the workspace settings dialog's select commit the same transactional sheet-size adoption" }),
  rule({ id: "view.page-settings", surface: PAGE, handler: /^setSettingsOpen$/, classification: "view", note: "[PR-E] the workspace settings dialog opens and closes (the header button, the chat summary link, the dialog's Close)" }),
  rule({ id: "view.page-journey", surface: PAGE, handler: /^handleJourneyAction$/, classification: "view", note: "[PR-E] the empty sheet's circuit-entry action: opens the chat and focuses the composer (the journey strip's own action is classified on its surface)" }),
  rule({ id: "view.page-missing-parts", surface: PAGE, handler: /^openMissingParts$/, classification: "view", note: "[PR-F fA] the Build sidebar's Missing parts (N) line beside the design checks: opens the PCB tab and shows its Missing parts list (the rows a Schematic → PCB run would refuse at, computed from the schematic alone - no run, no server call, nothing bound)" }),
  rule({ id: "view.pcb-3d-open-pcb", surface: PCB + "PcbEditor.tsx", handler: /^onOpenPcbTab$/, classification: "view", note: "[PR-E] the 3D tab's unavailable state offers the PCB tab (a workspace tab switch; nothing changes)" }),
  rule({ id: "schematic.place-part", surface: PAGE, handler: /^undefined\|onPlace$/, classification: "semantic", recordIds: ["schematic.add-component"], note: "disabled parts render without a handler" }),
  rule({ id: "schematic.pin-wire-gesture", surface: PAGE, kind: "pointer", handler: /^(handlePinClick|handleWireClick)$/, classification: "semantic", recordIds: ["schematic.connect"], note: "starts or completes a wire from a pin / on a wire" }),
  rule({ id: "schematic.drag-gesture", surface: PAGE, kind: "pointer", element: /^(g|rect|ComponentSymbol|KicadInstanceView|NetLabelGlyph|ScopedNetLabelGlyph|polyline)$/, classification: "semantic", recordIds: ["schematic.move-rotate"], note: "drag gestures on symbols, instances, labels and wires (B07.1 identity-geometry gestures); [PR-J3, 2026-10-22] + ScopedNetLabelGlyph: a hierarchical label, sheet pin or global label drags like any label (a sheet pin snaps back to its block edge before the commit)" }),
  rule({ id: "view.schematic-canvas-pointer", surface: PAGE, kind: "pointer", element: "svg", classification: "view", recordIds: ["view.canvas-navigation"], note: "canvas pan / marquee / deselect" }),
  rule({ id: "view.sim-pane-layout", surface: PAGE, kind: "pointer", element: /^(div|button)$/, classification: "view", note: "waveform pane drag/resize/focus/close" }),
  rule({ id: "view.schematic-tool-mode", surface: PAGE, kind: "click", handler: /^setTool/, classification: "view", note: "selects the schematic tool mode (select, wire, junction, label, place)" }),
  rule({ id: "view.schematic-mode", surface: PAGE, kind: "click", handler: /^(setMode|setSimMode)$/, classification: "view", note: "Theory/Build mode and simulation probe/move mode" }),
  rule({ id: "spice.page-sim", surface: PAGE, handler: /^(onRunSim|workspaceView\.open:sim,handleRunSim|setAnalysisConfig)$/, classification: "semantic", recordIds: ["spice.workbench", "view.canvas-navigation"], note: "the schematic page's quick simulation (analysis config, run, re-run); Run sim opens the SPICE tab through workspace.open-editor" }),
  rule({ id: "view.workspace-tabs", surface: PAGE, handler: /^(workspaceView\.open:(schematic|pcb|3d|bom|sim)|onClick|setChatOpen|toggleLeftPanel|setChatFullscreen|setChartPanelOpen)$/, classification: "view", recordIds: ["view.canvas-navigation"], note: "[B17-D] workspace tabs issue workspace.open-editor; activity bar, chat panel, waveform panel" }),
  rule({ id: "view.schematic-fit", surface: PAGE, handler: /^schematicView\.fitPage$/, classification: "view", recordIds: ["view.canvas-navigation"], note: "[B17-D] schematic.fit-page" }),
  rule({ id: "view.schematic-goto", surface: PAGE, kind: "submit", handler: /^e\.preventDefault,schematicGoTo\.trim,goToSchematicComponent$/, classification: "view", recordIds: ["view.canvas-navigation", "view.selection"], note: "[B17-D] Go to: schematic.select + schematic.focus by reference designator; a refusal is shown inline" }),
  rule({ id: "view.page-form-draft", surface: PAGE, kind: ["change", "click"], handler: /^(setInput|setDraft|setLabelDraft|setSchematicGoTo|onChange|parseInt,isNaN,onChange|pickType|selectAiBrain|performProviderSwitch|setAiProviderFailure,lastAiRetryRef\.current)$/, classification: "view", note: "form drafts, analysis picker fields, AI provider preference, the schematic Go-to draft" }),
  rule({ id: "view.page-dismiss", surface: PAGE, handler: /^(setReplacementReceipt|setTier1Receipt|setToast|setSuggestionsMinimized|setPendingSuggestions,setSuggestionsMinimized|setMoreMenuOpen|setOpen|onAdd|onSelect|e\.stopPropagation,onRemove|refreshCheckpoints,setHistoryOpen|setHistoryOpen|cancelTier1Proposal|showToast,setSchematicRecovery|setDraftRequestOpen)$/, classification: "view", note: "dismiss receipts/toasts, open/close menus, panes and dialogs; cancelling an inert proposal changes nothing; [PR-G, 2026-10-17] closing the draft-request publication dialog (setDraftRequestOpen) discards nothing but the open form" }),
  // ── [PR-G, 2026-10-17] the page's intakes of the agent's sealed artifacts (OD-248, OD-249): review cards in the run log, no apply ──
  rule({ id: "view.page-draft-request-open", surface: PAGE, handler: /^onOpenDraftRequest$/, classification: "view", note: "[PR-G, 2026-10-17] \"Open the publication request\" on a draft-request review card (draft_request_ready): opens the EXISTING Build Library evidence review (AtomicPublicationReviewSection, the parts.atomic-publication-review surface) prefilled from the sealed request this page still holds; nothing is requested until the person submits it there (atomic-submit), and the server's human-only governance decides" }),
  rule({ id: "view.page-module-note-toggle", surface: PAGE, handler: /^setNoteExpanded$/, classification: "view", note: "[PR-G, 2026-10-17] show / hide the rows of a module-contract engineering-note card (module_contracts_ready); the card is the note, nothing is applied" }),
  rule({ id: "pcb.stackup-candidate-accept", surface: PCB + "StackupCandidatePanel.tsx", handler: /^onAccept$/, classification: "semantic", recordIds: ["pcb.board-geometry"], note: "[PR-G, 2026-10-17] Accept on the agent's stackup recommendation preview (stackup_candidate_ready): PcbEditor re-checks the candidate's digest, base revision and expiry against the LIVE board, then runs the SAME commit as the toolbar's Stackup selector (applyStackupProfile: one canonical pcb.board-geometry transaction with the plane nets and the plane-zone reconciliation, one undo entry); the sealed candidate never writes the board; disabled with the reason when stale" }),
  rule({ id: "view.stackup-candidate-discard", surface: PCB + "StackupCandidatePanel.tsx", handler: /^onDiscard$/, classification: "view", note: "[PR-G, 2026-10-17] Discard the stackup recommendation preview; nothing changes" }),

  // ── PCB editor ────────────────────────────────────────────────────────────
  rule({ id: "pcb.sync-durable", surface: /^app\/components\/pcb\/(PcbEditor|SyncButton|SyncPlacementDialog|PcbSyncReadinessPanel|SnapshotConflictDialog)\.tsx$/, handler: /^(handleSync|handleApplySync|onSync|onConfirm|onApply|onRebase)$/, classification: "semantic", recordIds: ["pcb.sync-durable"] }),
  rule({ id: "pcb.sync-refresh", surface: PCB + "SnapshotConflictDialog.tsx", handler: /^onRefresh$/, classification: "view", note: "re-reads durable truth after a snapshot conflict; publishes nothing" }),
  rule({ id: "pcb.board-revision", surface: /^app\/components\/pcb\/(PcbEditor|PcbSyncReadinessPanel|BoardRevisionDialog)\.tsx$/, handler: /^(handlePreviewBoardRevision|onDeriveRevision|onDerive)$/, classification: "semantic", recordIds: ["pcb.board-revision"] }),
  rule({ id: "pcb.qualify-route", surface: /^app\/components\/pcb\/(PcbEditor|ManufacturingWorkflowPanel)\.tsx$/, handler: /^(handleQualify|onQualify)$/, classification: "semantic", recordIds: ["pcb.qualify-route", "pcb.autonomous-layout"], note: "server qualification commits the verified autonomous placement+routing candidate in the same durable transaction" }),
  rule({ id: "manufacturing.release", surface: /^app\/components\/pcb\/(PcbEditor|ManufacturingWorkflowPanel)\.tsx$/, handler: /^(handleRelease|workflow\.requestRelease|workflow\.authorizeRelease)$/, classification: "semantic", recordIds: ["manufacturing.release"] }),
  rule({ id: "view.manufacturing-panel", surface: PCB + "ManufacturingWorkflowPanel.tsx", handler: /^(workflow\.cancelRelease|workflow\.refresh)$/, classification: "view", note: "cancel the release confirmation; re-read durable truth" }),
  rule({ id: "pcb.component-review", surface: PCB + "ComponentReviewPanel.tsx", handler: /^review\.(request|requestAll|resolve,reason\.trim|withdraw)$/, classification: "semantic", recordIds: ["pcb.component-review"] }),
  rule({ id: "pcb.component-review-successor", surface: PCB + "ComponentReviewPanel.tsx", handler: /^(review\.previewSuccessor|rebind)$/, classification: "semantic", recordIds: ["pcb.component-review"], note: "[B19-E E5] preview a withdrawn revision's successor diff (a read) and rebind to it (a reviewer's or administrator's act, the previewed digest and a reason; the server recomputes and commits supersede + approve at once)" }),
  rule({ id: "view.component-review-panel", surface: PCB + "ComponentReviewPanel.tsx", classification: "view", note: "refresh listing, expand evidence, reason drafts" }),
  // [PR-F fA, 2026-10-17] the Missing parts list (the Schematic → PCB refusal rows as a workflow item): ONE action button per row and
  // action, dispatching to the existing catalog read, the distributor observation read, or the publication review request (opened
  // inline; nothing is requested until its own submit); the checklist toggle and the inline request's Close are view state
  rule({ id: "dispatcher.missing-part-actions", surface: PCB + "MissingPartsList.tsx", kind: "click", label: /^missing-action-/, handler: /^run$/, classification: "dispatcher", recordIds: ["parts.catalog-read", "parts.external-observation-read", "parts.atomic-publication-review"], note: "[PR-F fA] the row's next actions in F's order: Search catalog (POST /api/parts/search + GET /api/parts/[id]), Search distributors (POST /api/parts/external-search; every source's state shown, never a fake hit), Request review / Create unverified draft (the existing AtomicPublicationReviewSection with the prefill; a human submits, a reviewer approves, a different administrator publishes); an action without its facts or path is disabled with the reason" }),
  rule({ id: "view.missing-parts-list", surface: PCB + "MissingPartsList.tsx", handler: /^(setExpanded|setPublication)$/, classification: "view", note: "[PR-F fA] expands or collapses a row's missing-facts checklist; closes the inline publication request (nothing was sent)" }),
  rule({ id: "dispatcher.missing-parts-find-replacement", surface: PCB + "MissingPartsList.tsx", label: /^missing-parts-find-replacement$/, handler: /^onFindReplacement$/, classification: "dispatcher", recordIds: ["ai.chat-qa", "schematic.resolve-components-propose"], note: "[PR-M, 2026-10-18] runbook M.1: \"Find a replacement in the library\" hands the page the listed catalog instances; the page sends ONE chat request naming them (references and stable ids) through the composer's ask route, and the assistant inspects, searches the local library and seals one resolution batch the human reviews - the button applies nothing" }), rule({ id: "parts.cad-acquisition", surface: "app/components/parts/CadAcquisitionPanel.tsx", kind: "click", handler: /^run,(startCadAcquisition|controlCadAcquisition|sendCadAcquisitionForReview)(,|$)/, classification: "semantic", recordIds: ["parts.cad-acquisition"], note: "[PR-M, 2026-10-18] section M2 (in place: no line moves): Obtain the part's assets (start or attach), Send for component review (a person's handoff), Check again and Cancel - each one POST /api/parts/acquisitions over the durable task the agent's acquisition tools read; nothing is approved, published, bound or applied" }), rule({ id: "dispatcher.cad-acquisition-offer", surface: "app/components/parts/CadAcquisitionPanel.tsx", kind: "click", handler: /^onOfferReplacement(,|$)/, classification: "dispatcher", recordIds: ["ai.chat-qa", "schematic.resolve-components-propose"], note: "[PR-M, 2026-10-18] section M2: Offer the replacement hands the task's instances to the page's existing replacement path (the same chat request as Find a replacement in the library); the review dialog applies, the button applies nothing" }), rule({ id: "view.component-review-inbox", surface: "app/components/parts/ComponentReviewInbox.tsx", classification: "view", note: "[PR-M, 2026-10-18] section M2: refresh the governance project's component review inbox; open the existing publication review prefilled with a handoff's package (nothing is requested until its own submit)" }),
  // [B23-B1] the provider exchange: preview and commit are two separate semantic controls of one Tier 3 record (external-transfer); the provider choice is a draft
  rule({ id: "manufacturing.provider-exchange", surface: PCB + "ProviderExchangePanel.tsx", kind: "click", handler: /^exchange\.(preview|commit)$/, classification: "semantic", recordIds: ["manufacturing.provider-exchange"], note: "[B23-B1] preview asks the server what would leave (nothing is sent); commit names the exact previewed plan with the opt-in header, and the server refuses it (no provider admitted in B23)" }),
  rule({ id: "view.provider-exchange-choice", surface: PCB + "ProviderExchangePanel.tsx", kind: "change", handler: /^exchange\.choose$/, classification: "view", note: "[B23-B1] chooses the provider and purpose a later preview names; discards any previewed plan" }),
  rule({ id: "pcb.auto-place", surface: /^app\/components\/pcb\/(PcbEditor|PlacementSetup)\.tsx$/, handler: /^(editorRuntime\.getHistory,commitPcbCandidate\(\)\.then,commitPcbCandidate,produce|onApply)$/, element: /^(PlacementSetup|button)$/, classification: "semantic", recordIds: ["pcb.auto-place"] }),
  rule({ id: "pcb.autoroute-import", surface: PCB + "PcbEditor.tsx", element: "AutorouteSetup", classification: "semantic", recordIds: ["pcb.autoroute-import"] }),
  rule({ id: "placement.auto", surface: /^app\/components\/pcb\/(PcbEditor|PcbToolbar)\.tsx$/, handler: /^(autoPlace\.run|onCancelAutoPlace\|onAutoPlace)$/, classification: "semantic", recordIds: ["placement.auto"] }),
  rule({ id: "placement.candidate-review", surface: PCB + "PlacementSetup.tsx", handler: /^(onApplyCandidate|onDiscardCandidate)$/, classification: "semantic", recordIds: ["pcb.auto-place", "placement.auto"], note: "[B17-E] apply / discard any candidate in the shared store (the editor's, an agent's, a route's) through applyLayoutCandidate" }),
  rule({ id: "routing.autoroute", surface: /^app\/components\/pcb\/(PcbEditor|PcbToolbar)\.tsx$/, handler: /^(autoroute\.run|onRouteBoard)$/, classification: "semantic", recordIds: ["routing.autoroute"] }),
  rule({ id: "routing.candidate-review", surface: PCB + "AutorouteSetup.tsx", handler: /^(onApplyCandidate|onDiscardCandidate)$/, classification: "semantic", recordIds: ["pcb.autoroute-import", "routing.autoroute"], note: "[B17-E] apply / discard the routing candidate (ghost-previewed) through applyLayoutCandidate" }),
  rule({ id: "routing.selected-nets", surface: /^app\/components\/pcb\/(PcbEditor|AutorouteSetup)\.tsx$/, handler: /^(onRerouteSelectedNets|rerouteSelectedNets)$/, classification: "semantic", recordIds: ["pcb.reroute-nets"], note: "[B17-E] a routing candidate scoped to the nets the selection names" }),
  rule({ id: "routing.clear-nets", surface: /^app\/components\/pcb\/(PcbEditor|AutorouteSetup)\.tsx$/, handler: /^(onClearSelectedNets|clearSelectedNets)$/, classification: "semantic", recordIds: ["pcb.clear-nets"], note: "[B17-E] clear unlocked copper on the selected nets as one canonical transaction" }),
  rule({ id: "pcb.routed-board-revision", surface: PCB + "AutorouteSetup.tsx", handler: /^onPublishRoutedRevision$/, classification: "semantic", recordIds: ["pcb.routed-board-revision"], note: "[B17-E] the routed working copy becomes the durable board's next revision through the B16 sync path" }),
  rule({ id: "pcb.rules.routing-preferences", surface: /^app\/components\/pcb\/(PcbEditor|RoutingControls)\.tsx$/, kind: "change", classification: "semantic", recordIds: ["pcb.rules"], note: "routing preferences (width, via preset, mode, posture) are board state" }),
  rule({ id: "pcb.rules.net-classes", surface: PCB + "RoutingRulesPanel.tsx", handler: /^(netClasses\.applyDelta,setProposal,toast|netClasses\.runAutoClassify,toast|saveManual)$/, classification: "semantic", recordIds: ["pcb.rules"] }),
  rule({ id: "pcb.ai-rules-brief", surface: PCB + "RoutingRulesPanel.tsx", handler: /^suggest$/, classification: "semantic", recordIds: ["pcb.ai-rules-brief"] }),
  rule({ id: "view.routing-rules-panel", surface: PCB + "RoutingRulesPanel.tsx", classification: "view", note: "brief/manual-rule drafts, open/close, dismiss proposal" }),
  rule({ id: "pcb.arrange", surface: /^app\/components\/pcb\/(inspectors\/ArrangeSection|PcbEditor)\.tsx$/, handler: /^(align|commit)$/, label: /^(Align|Distribute|Snap|align-|distribute-|snap-grid)/, classification: "semantic", recordIds: ["pcb.arrange"] }),
  rule({ id: "pcb.delete-item", surface: /^app\/components\/pcb\/(Inspector|PcbEditor)\.tsx$/, handler: /^(commit,toast|commit,refs\.filter)$/, classification: "semantic", recordIds: ["pcb.delete-item"] }),
  rule({ id: "pcb.export-kicad", surface: /^app\/components\/pcb\/(PcbEditor|PcbToolbar)\.tsx$/, handler: /^(exportKicadFromPalette|onExportKicad)$/, classification: "semantic", recordIds: ["pcb.export-kicad"] }),
  rule({ id: "validation.drc", surface: /^app\/components\/pcb\/(PcbEditor|PcbToolbar|DrcPanel)\.tsx$/, handler: /^(drc\.run|onRunDrc)$/, classification: "semantic", recordIds: ["validation.erc-drc"] }),
  rule({ id: "view.drc-panel", surface: PCB + "DrcPanel.tsx", classification: "view", note: "grouping, collapse, constraints toggle, active preset selection (a view-session preference)" }),
  rule({ id: "pcb.board-geometry", surface: PCB + "PcbToolbar.tsx", handler: /^(applySize|onStackupChange,Number|applyPreset|toggleRoundRect|onAddPlane)$/, classification: "semantic", recordIds: ["pcb.board-geometry", "pcb.zone"], note: "board size/preset/corners/stackup; Add plane creates a zone" }),
  rule({ id: "pcb.enlarge-board", surface: PCB + "PcbEditor.tsx", handler: /^enlargeBoardToFit$/, classification: "semantic", recordIds: ["pcb.board-geometry"] }),
  rule({ id: "pcb.undo-redo", surface: PCB + "PcbToolbar.tsx", handler: /^(onUndo|onRedo)$/, classification: "semantic", recordIds: ["pcb.undo-redo-canonical"] }),
  rule({ id: "view.pcb-tool-mode", surface: PCB + "PcbToolbar.tsx", handler: /^onToolChange$/, classification: "view", note: "select / pan / route / zone / silkscreen / dimension tool mode" }),
  rule({ id: "view.pcb-3d", surface: /^app\/components\/pcb\/(PcbEditor|PcbToolbar|PcbPreview3D)\.tsx$/, handler: /^(pcb3d\.setOpen|pcb3d\.toggle|onToggle3d|issue|e\.preventDefault,focusDraft\.trim,issue)$/, classification: "view", recordIds: ["view.pcb-3d-control"], note: "[B17-C] every 3D control issues a pcb3d.* view-session command (open/close, camera presets, fit, reset, focus by component, per-layer visibility incl. top/bottom silkscreen, finish)" }),
  rule({ id: "view.pcb-3d-focus-draft", surface: PCB + "PcbPreview3D.tsx", handler: /^setFocusDraft$/, classification: "view", note: "the focus input's draft; Focus submits pcb3d.focus-component" }),
  // ── [B17-D] the pcb canvas view session: every control issues a pcb.* command ──
  rule({ id: "view.pcb-reveal", surface: /^app\/components\/pcb\/(PcbEditor|DrcPanel|FabDialog|AutorouteSetup)\.tsx$/, handler: /^(onToggle|onZoomToViolation|onFocusFailure|pcbView\.revealFinding)$/, label: /^(drc-violation-row|.*)$/, classification: "view", recordIds: ["view.reveal-finding"], note: "[B17-D] DRC rows, fab-dialog violations and autoroute failures issue pcb.reveal-finding (bounded focus + transient flash)" }),
  rule({ id: "view.pcb-goto", surface: PCB + "PcbToolbar.tsx", kind: "submit", handler: /^e\.preventDefault,goTo\.trim,onGoTo$/, classification: "view", recordIds: ["view.canvas-navigation", "view.selection"], note: "[B17-D] Go to: pcb.select + pcb.focus by reference designator; a refusal is a toast" }),
  rule({ id: "view.pcb-navigation", surface: /^app\/components\/pcb\/(PcbEditor|PcbToolbar|Inspector)\.tsx$/, handler: /^(pcbView\.(fitBoard|fitSelection|zoomBy|panTo|focus)|onZoomToFit|onFitSelection)$/, classification: "view", recordIds: ["view.canvas-navigation"], note: "[B17-D] pcb.fit-board / fit-selection / zoom / pan-to / focus (toolbar, palette, inspector Zoom to)" }),
  rule({ id: "view.pcb-layers", surface: /^app\/components\/pcb\/(PcbEditor|PcbToolbar|LayerPanel)\.tsx$/, handler: /^(pcbView\.(toggleLayer|setLayerVisible|setActiveLayer|isolateLayer|showCopper|toggleGrid|setGrid)|onToggleGrid|onToggleVisible|onActivate|onIsolate|onShowAllCopper)$/, classification: "view", recordIds: ["view.layer-visibility"], note: "[B17-D] pcb.set-layer-visible / toggle-layer / set-active-layer / isolate-layer / show-copper / set-grid / toggle-grid (layer panel, toolbar grid, palette layer toggles)" }),
  rule({ id: "view.pcb-selection", surface: PCB + "PcbEditor.tsx", handler: /^(pcbView\.select(,selectSimilar)?|pcbView\.selectNet|pcbView\.clearSelection|pcbView\.highlightNet|pcbView\.clearHighlight)$/, classification: "view", recordIds: ["view.selection"], note: "[B17-D] pcb.select / select-net / clear-selection / highlight-net (palette select-similar, context menu)" }),
  rule({ id: "view.pcb-measure", surface: PCB + "PcbToolbar.tsx", handler: /^onClearMeasurement$/, classification: "view", recordIds: ["view.measure"], note: "[B17-D] the measurement readout's clear issues pcb.clear-measurement; pcb.measure is issued by tools (B17-F)" }),
  rule({ id: "view.pcb-goto-draft", surface: PCB + "PcbToolbar.tsx", handler: /^setGoTo$/, classification: "view", note: "the Go-to input's draft; submitting issues pcb.select + pcb.focus" }),
  rule({ id: "view.pcb-chrome", surface: /^app\/components\/pcb\/(PcbEditor|PcbToolbar|SyncButton|SyncPlacementDialog|PlacementSetup|AutorouteSetup|PadstackPanel|AssignmentQueuePanel|ShortcutsHelp|BoardRevisionDialog|SnapshotConflictDialog|PcbProposalReviewDialog|GrantedExecutionDialog|PcbSyncReadinessPanel|AssistBox|FabDialog|CommandPalette)\.tsx$/, handler: /^(setAssistOpen|setSyncDialogOpen|setFabDialogOpen|setPadstacksOpen|shortcuts\.show|onShowShortcuts|onTogglePadstacks|onToggleAssignments|onSendToFab|onOptions|onClose|onDiscard|setPlacementWarning|setPending|onDismiss|onCancel|setSelectedId|setQuery(,setIndex)?|setSpread|setMode|setConfirmedPreflightId|setAcknowledged|onCarryChange|setPreset|updateLayer|updateLayer,Number|onChange,stackupProfile|setOverride|setPresetId|setWaiverReason|setEngine|setText|e\.stopPropagation,onClose)$/, classification: "view", note: "open/close chrome, dismiss, drafts and setup forms that a later semantic control commits" }),
  rule({ id: "pcb.placement-settings", surface: PCB + "PlacementSetup.tsx", kind: "change", handler: /onChange$/, classification: "semantic", recordIds: ["pcb.placement-settings"] }),
  rule({ id: "pcb.assist-edit", surface: PCB + "AssistBox.tsx", handler: /^(apply|e\.preventDefault,submit,e\.stopPropagation,\?\.blur)$/, classification: "semantic", recordIds: ["pcb.assist-edit"] }),
  rule({ id: "pcb.bounded-edit-apply", surface: PCB + "PcbProposalReviewDialog.tsx", handler: /^onApply$/, classification: "semantic", recordIds: ["pcb.bounded-edit-apply"] }),
  rule({ id: "agent.execution-grant-confirm", surface: PCB + "GrantedExecutionDialog.tsx", handler: /^onConfirm$/, classification: "semantic", recordIds: ["agent.execution-grant"], note: "[B18-B] the human's Confirm of a preview_then_confirm execution grant: the one-shot server tender and ONE canonical transaction through the PCB composition root" }),
  rule({ id: "pcb.board-repair", surface: PCB + "BoardRepairPanel.tsx", handler: /^repair\.(createPlan|previewFixes|applyPreview|undoLast)$/, classification: "semantic", recordIds: ["pcb.board-repair"] }),
  rule({ id: "view.board-repair-panel", surface: PCB + "BoardRepairPanel.tsx", classification: "view", note: "selection of fixes, execution-mode preference, cancel" }),
  rule({ id: "pcb.assignment-queue", surface: PCB + "AssignmentQueuePanel.tsx", handler: /^(previewAction|commit|load)$/, classification: "semantic", recordIds: ["pcb.assignment-queue"] }),
  rule({ id: "view.assignment-queue-panel", surface: PCB + "AssignmentQueuePanel.tsx", classification: "view", note: "filter, drafts, selection, close" }),
  rule({ id: "pcb.footprint-resolution.verify", surface: /^app\/components\/pcb\/(MappingVerificationPanel|PassivePackagePolicyPanel)\.tsx$/, classification: "semantic", recordIds: ["pcb.footprint-resolution"], note: "read-only verification / policy evaluation" }),
  rule({ id: "pcb.padstack", surface: PCB + "PadstackPanel.tsx", handler: /^(commit|duplicate|addNew)$/, classification: "semantic", recordIds: ["pcb.padstack"] }),
  rule({ id: "view.padstack-editor-draft", surface: /^app\/components\/pcb\/padstack\//, classification: "view", note: "padstack editor drafts (staged until Save)" }),
  rule({ id: "pcb.dimension", surface: /^app\/components\/pcb\/(inspectors\/DimensionInspector\.tsx|hooks\/useDimensionTool\.ts)$/, classification: "semantic", recordIds: ["pcb.dimension"] }),
  rule({ id: "pcb.route-copper", surface: PCB + "hooks/useRouteTool.ts", classification: "semantic", recordIds: ["pcb.route-copper"] }),
  rule({ id: "pcb.silkscreen-text", surface: /^app\/components\/pcb\/(hooks\/useSilkTool\.ts|SilkTool\.tsx|inspectors\/TextInspector\.tsx)$/, handler: /^(onKeyDown|onKeyUp|e\.preventDefault,silk\.commitText,silk\.cancelText,silk\.toggleLayer|e\.preventDefault,commitText,inputRef\.current\.blur,e\.stopPropagation)$/, classification: "semantic", recordIds: ["pcb.silkscreen-text"] }),
  rule({ id: "view.silk-tool-draft", surface: /^app\/components\/pcb\/(SilkTool|inspectors\/TextInspector)\.tsx$/, classification: "view", note: "silk text/stroke/height/layer drafts and mode" }),
  rule({ id: "view.shortcuts-help", surface: /^app\/components\/pcb\/(ShortcutsHelp\.tsx|hooks\/useShortcutsHelp\.ts)$/, classification: "view", note: "the shortcuts overlay" }),
  rule({ id: "pcb.zone", surface: /^app\/components\/pcb\/(ZoneTool|inspectors\/ZoneInspector)\.tsx$/, handler: /^(onAdd,onClose|addZone|onRefill|onKey)$/, classification: "semantic", recordIds: ["pcb.zone"] }),
  rule({ id: "view.zone-tool", surface: PCB + "ZoneTool.tsx", classification: "view", note: "zone appearance/layer/net drafts, cancel" }),
  rule({ id: "view.via-inspector", surface: PCB + "inspectors/ViaInspector.tsx", classification: "view", note: "'also update other vias' preference for the next edit" }),
  rule({ id: "manufacturing.export-engineering", surface: PCB + "FabDialog.tsx", handler: /^fab\.start$/, classification: "semantic", recordIds: ["manufacturing.export-engineering"] }),

  // ── BOM ───────────────────────────────────────────────────────────────────
  rule({ id: "view.bom-successor-review", surface: BOM, handler: /^e\.stopPropagation,openSuccessorReview$/, classification: "view", note: "[B19-E E5] Review successor hands a withdrawn line to the page, which opens the PCB component review; nothing is changed from the BOM" }),
  rule({ id: "bom.workbench", surface: BOM, handler: /^(refreshPrices|requestAgain|exportCsv|onGenerate,title\.trim|takeSnapshot|exportForDistributor|onSwap|onViewDiff|onMarkAllRead|onChoiceChange|setRefreshNonce|onJump)$/, classification: "semantic", recordIds: ["bom.workbench"] }), // [B19-E E1] exportForDistributor downloads a file only; the offline Retry and the expired-offer Refresh prices reuse setRefreshNonce
  rule({ id: "view.bom-chrome", surface: BOM, classification: "view", note: "filters, drafts, sort, expand, dialogs and popovers" }),
  rule({ id: "view.journey-next-action", surface: "app/components/workflow/JourneyStrip.tsx", handler: /^onAction$/, classification: "view", note: "[PR-C] the journey strip's one next action: it opens a workspace tab or focuses the existing human control (apply, qualify, release stay their own clicks); never a mutation" }),

  // ── build library / schematic dialogs ─────────────────────────────────────
  rule({ id: "parts.catalog-read", surface: "app/components/editor/BuildLibraryPanel.tsx", handler: /^(openCategory|selectPart|backToCategories|loadMore|onRetry)$/, classification: "semantic", recordIds: ["parts.catalog-read"] }),
  rule({ id: "schematic.add-component", surface: "app/components/editor/BuildLibraryPanel.tsx", handler: /^onPlace$/, classification: "semantic", recordIds: ["schematic.add-component"] }),
  // [B19-E E5 review] its own rule, so the plain Place row carries no note about a behaviour it does not have
  rule({ id: "schematic.add-component-exact-revision", surface: "app/components/editor/BuildLibraryPanel.tsx", handler: /^placeExactRevision$/, classification: "semantic", recordIds: ["schematic.add-component"], note: "[B19-E E5] Use published exact revision (placeExactRevision) places the part with the exact identity of its fresh selectable link; binding stays a reviewer's act" }),
  rule({ id: "parts.external-observation-read", surface: "app/components/editor/BuildLibraryPanel.tsx", handler: /^(searchExternal|setExternalQuery|setExternalMode)$/, classification: "semantic", recordIds: ["parts.external-observation-read"], note: "[B19-E E2] Search distributors: mode, query and search; every hit is a labelled sourcing observation with no Place control" }),
  rule({ id: "view.external-search-chrome", surface: "app/components/editor/BuildLibraryPanel.tsx", handler: /^setExternalOpen$/, classification: "view", note: "[B19-E E2] opens or closes the Search distributors section" }),
  rule({ id: "parts.request-evidence-review", surface: "app/components/editor/BuildLibraryPanel.tsx", handler: /^requestEvidenceReview(,footprintReference)?$/, classification: "semantic", recordIds: ["parts.atomic-publication-review"], note: "[B19-E E4] Request evidence review on a part preview with an MPN or an exact external hit: opens the publication review for that exact MPN; nothing is requested until its submit" }),
  rule({ id: "view.build-library", surface: "app/components/editor/BuildLibraryPanel.tsx", classification: "view", note: "search draft, close" }),
  rule({ id: "parts.atomic-publication-review", surface: "app/components/parts/AtomicPublicationReviewPanel.tsx", handler: /^(submitRequest|setResolution|setManufacturer|setFactDisposition|approveRequest|rejectRequest|publishRequest|withdrawRequest|withdrawRevision)$/, classification: "semantic", recordIds: ["parts.atomic-publication-review"], note: "[B19-E E4] request, resolve the manufacturer and conflicts, disposition quarantined facts, approve, reject, publish, withdraw; [B19-E E5] withdraw a published revision (an administrator: deprecate, supersede, revoke); the server enforces governance project, humans, roles, two people and the digest" }),
  rule({ id: "view.atomic-publication-review-panel", surface: "app/components/parts/AtomicPublicationReviewPanel.tsx", classification: "view", note: "[B19-E E4] refresh the listing, expand evidence, request and decision drafts (nothing is sent until a semantic control)" }),
  rule({ id: "schematic.replace-component", surface: "app/components/schematic/ReplacementReviewDialog.tsx", handler: /^onApply$/, classification: "semantic", recordIds: ["schematic.replace-component"] }),
  rule({ id: "view.replacement-dialog", surface: "app/components/schematic/ReplacementReviewDialog.tsx", classification: "view", note: "cancel changes nothing" }),
  // [PR-M, 2026-10-18] runbook M.2.5: the component resolution's review dialog - Approve applies the reviewed batch through the page's trusted controller (one canonical schematic.resolve-components transaction); Discard, closing and dismissing the receipt change and record nothing
  rule({ id: "schematic.resolve-components", surface: "app/components/schematic/ComponentResolutionReviewDialog.tsx", handler: /^onApprove$/, classification: "semantic", recordIds: ["schematic.resolve-components"], note: "[PR-M, 2026-10-18] the batch's one explicit Approve: the controller reauthorizes the live membership, mints the one-shot intent and builds the production fresh-facts channel (POST /api/component-resolution-authority); was b17-a's EFFECT_DRIVEN entry until the page intake landed" }),
  rule({ id: "view.component-resolution-dialog", surface: "app/components/schematic/ComponentResolutionReviewDialog.tsx", classification: "view", note: "[PR-M, 2026-10-18] Discard (and closing the dialog) changes and records nothing; dismissing the receipt notice changes nothing" }),
  // ── [PR-J3, 2026-10-22] the Sheets navigator (runbook J.3 items 1, 3, 6, 7; OD-255 item 7; OD-257): the canvas chip's tree popover and its previewed dialogs; the two section J records get their controls here ──
  rule({ id: "schematic.sheet-structure", surface: SHEETS, handler: /^(submitNew|submitRename|submitPort|run,reorderSheet|run,deleteSheet)$/, classification: "semantic", recordIds: ["schematic.sheet-structure"], note: "[PR-J3, 2026-10-22] Create sheet (the New sheet form), Rename (its form), Add port (name and direction: the port, its hierarchical label on the child and its sheet pin on the parent in ONE transaction), Up / Down (the sibling order) and Delete sheet (the confirm of the delete preview: the sheet pins, hierarchical labels and ports of an emptied sheet, then the sheet): each ONE schematic.sheet-structure transaction, one undo step, pre-applied with the executor's own code so a refusal (SHEET_NOT_EMPTY, SHEET_NOT_EQUIVALENT, SHEET_RAIL_JOIN_REFUSED) is shown verbatim" }),
  rule({ id: "schematic.move-to-sheet", surface: SHEETS, handler: /^run,applyMove$/, classification: "semantic", recordIds: ["schematic.move-to-sheet"], note: "[PR-J3, 2026-10-22] Apply move on the Move to sheet preview (the selected part with its attached wires and local labels, or its connected group on the active sheet, to a child, the parent or a new sheet; every cut net carried by a port) and Move contents to parent on the delete preview (OD-257 item 2: the first of two transactions): planMoveToSheet re-planned on the canonical base inside the serialized queue, refused unless the previewed partition digest results; one transaction, one undo step" }),
  // [PR-J4, 2026-10-23] runbook J.3 item 4 / OD-258 items 3, 4: Organize into sheets (a chain of moves, ONE schematic.move-to-sheet transaction) and the rail-named label normalisation (ONE schematic.sheet-structure transaction); the buttons that open the preview and Cancel are view.sheets-chrome
  rule({ id: "schematic.organize-into-sheets", surface: SHEETS, handler: /^run,applyOrganize$/, classification: "semantic", recordIds: ["schematic.move-to-sheet"], note: "[PR-J4, 2026-10-23] Apply organisation on the Organize into sheets preview: the deterministic grouping proposal (app/lib/schematic/sheet-organization.ts proposeSheetGroups: hubs = processors, regulators, connectors; parts attach by shared signal nets, ties by hint then the smaller reference and listed under 'check these') planned as a chain of planMoveToSheet steps to new child sheets (planOrganizeIntoSheets), re-planned on the canonical base inside the serialized queue and refused unless the previewed partition digest results; one transaction, one undo step; never auto-applied" }),
  rule({ id: "schematic.normalise-rail-labels", surface: SHEETS, kind: "click", label: /^sheets-normalise-apply$/, handler: /^onApply$/, classification: "semantic", recordIds: ["schematic.sheet-structure"], note: "[PR-J4, 2026-10-23] Normalise N rail-named labels on the New sheet, Move to sheet and Organize previews of a single-sheet design the strict connection rules would read differently (the label tool's plain 'GND' beside a ground symbol): every scope-less plain label named like a rail takes that rail's kind (planRailLabelNormalisation: a delete + add pair per label at its own index, the PCB netlist's partition proven unchanged), re-planned on the canonical base; one transaction, one undo step" }),
  rule({ id: "view.sheets-navigation", surface: /^app\/components\/schematic\/(SheetNavigator|SheetBlocksLayer)\.tsx$/, handler: /^(openSheet|goBack|onTreeKeyDown|onPanelKeyDown|onBlockKeyDown|setFocusedId,openSheet|closeDialog,followDestination)$/, classification: "view", recordIds: ["view.canvas-navigation"], note: "[PR-J3, 2026-10-22] opening a sheet (a tree item, the tree's arrow / Enter keys, the panel's Escape, a subsystem block's double-click on the overview; [PR-J3 integration, 2026-10-23] J3N-5: + the block's Enter / Space, the block being announced as a button), Back to the parent, and a Follow signal destination (opens the sheet, then replays schematic.highlight-net and schematic.focus on the fresh view bus): presentation only, the active sheet and its camera live in the per-project localStorage presentation store (OD-257 item 5)" }),
  rule({ id: "view.sheets-chrome", surface: SHEETS, classification: "view", note: "[PR-J3, 2026-10-22] the chip opens / closes the tree popover; the dialogs open with their drafts (sheet name, port name and direction, what moves and the target sheet) and close with Cancel / Close or their backdrop; dismissing the notice; nothing changes until a semantic control" }),
  rule({ id: "schematic.scoped-label-drag-gesture", surface: "app/components/schematic/ScopedNetLabelGlyph.tsx", kind: "pointer", classification: "semantic", recordIds: ["schematic.move-rotate"], note: "[PR-J3, 2026-10-22] the glyph of a hierarchical label, sheet pin or global label hands its pointer-down to the page's label drag (B07.1 identity-geometry gesture); a sheet pin dragged off its block edge is snapped back by the sheet lens before the commit" }),

  // ── SPICE studio ──────────────────────────────────────────────────────────
  rule({ id: "view.spice-chrome", surface: /^app\/components\/spice\//, handler: /^(setPaletteQuery|setPaletteOpen|setWorkspace|setAiOpen|props\.setSection|props\.setActiveTestId,props\.setSection|props\.toggleSignal|props\.setLegacyOpen|props\.onClose|props\.onDismiss|props\.setActivePaneId|createId,props\.setPanes,props\.setActivePaneId|onCancel|props\.setCompareRunId|setActiveRunPlanId|onSelect|onSignalFocus|setView|onPointerDown|event\.stopPropagation)$/, classification: "view", note: "palette/query, workspace and section navigation, panes, compare selection, waveform focus/zoom" }),
  rule({ id: "spice.workbench", surface: /^app\/components\/spice\//, classification: "semantic", recordIds: ["spice.workbench"], note: "testbench setup edits, runs, exports, approvals and AI setup requests are SPICE studio project state" }),

  // ── circuit-design workbenches ────────────────────────────────────────────
  rule({ id: "cd.architecture", surface: "app/components/architecture/ArchitectureWorkspace.tsx", handler: /^(onSelectCandidate|onGenerateAlternatives)$/, classification: "semantic", recordIds: ["cd.architecture.workbench"] }),
  rule({ id: "cd.power", surface: "app/components/power/PowerWorkspace.tsx", handler: /^(onSelectCandidate|onGenerateAlternatives)$/, classification: "semantic", recordIds: ["cd.power.workbench"] }),
  rule({ id: "cd.interfaces", surface: "app/components/interfaces/InterfacePlanningWorkspace.tsx", handler: /^(onSelect|onGenerateAlternatives)$/, classification: "semantic", recordIds: ["cd.interfaces.workbench"] }),
  rule({ id: "view.cd-workbench-chrome", surface: CD, classification: "view", note: "tabs, filters, candidate/object selection for inspection" }),

  // ── [PR-L, 2026-10-17] runbook L.4: the durable design task's controls (the status card in its activity entry; the review dialog) ──
  rule({ id: "schematic.generation-task-control", surface: CHAT + "GenerationTaskStatus.tsx", handler: /^onAction$/, classification: "semantic", recordIds: ["schematic.generate"], note: "[PR-L, 2026-10-17] Stop design, Pause design, Resume design, Continue with another allowance, Review the saved blocks and Retry block <name> on the design task's status card: each button is shown only when the server lists the action as valid now, and the page sends exactly that action to POST /api/generation-tasks/[id]/control, where the durable store judges the transition (cancel is durable and fences a late result; nothing is applied to the sheet)" }),
  rule({ id: "schematic.generation-task-start-again", surface: CHAT + "GenerationTaskStatus.tsx", handler: /^onStartAgain$/, classification: "semantic", recordIds: ["schematic.generate"], note: "[PR-L, 2026-10-17] Start again: a NEW design task (a new request id) from the same request, offered only once the followed task can do nothing more (cancelled, failed or stale); the composer's own Generate path runs it" }),
  rule({ id: "schematic.generate-discard", surface: PAGE, handler: /^finishActivityLog,reportGenerationReview,setPendingReplace$/, classification: "semantic", recordIds: ["schematic.generate"], note: "[PR-L, 2026-10-17] Cancel (and closing) the generated proposal's review dialog: nothing is applied; when the proposal is a durable design task's result the discard is recorded on that task (record-review discarded), which settles it (was view.page-dismiss's finishActivityLog,setPendingReplace)" }),
  rule({ id: "schematic.generation-task-control-confirm", surface: PAGE, handler: /^onConfirmGenerationControl$/, classification: "semantic", recordIds: ["schematic.generate"], note: "[PR-L, 2026-10-18] runbook L.5 (OD-252 item 6): Confirm: <Stop design | Pause design | Resume design | Retry block> on the design control chip the assistant's sirkit.generation.task-control sealed (generation_task_control_ready): the human's click sends exactly that action, once, to POST /api/generation-tasks/[id]/control under the human's own authorization and CSRF; the durable store judges the transition then (the same route as the status card's buttons)" }),
  rule({ id: "view.generation-task-control-dismiss", surface: PAGE, handler: /^onDismissGenerationControl$/, classification: "view", note: "[PR-L, 2026-10-18] Dismiss on the design control chip: drops the sealed request this page holds; nothing is sent and the design is unchanged" }),
]);

// ─── resolution ───────────────────────────────────────────────────────────────

export interface ClassifiedControl extends ControlSite {
  ruleId: string;
  classification: ControlClass;
  recordIds: readonly string[];
  reason: string;
  note: string;
}

function surfaceMatches(rule: ControlRule, surface: string): boolean {
  if (rule.surface instanceof RegExp) return rule.surface.test(surface);
  return rule.surface.endsWith("/") ? surface.startsWith(rule.surface) : surface === rule.surface;
}

export function matchControlRule(site: ControlSite, rules: readonly ControlRule[] = CONTROL_RULES): ControlRule | null {
  for (const candidate of rules) {
    if (!surfaceMatches(candidate, site.surface)) continue;
    if (candidate.kind && !(Array.isArray(candidate.kind) ? candidate.kind.includes(site.kind) : candidate.kind === site.kind)) continue;
    if (candidate.element && !(candidate.element instanceof RegExp ? candidate.element.test(site.element) : candidate.element === site.element)) continue;
    if (candidate.label && !candidate.label.test(site.label)) continue;
    if (candidate.handler && !candidate.handler.test(site.handler)) continue;
    return candidate;
  }
  return null;
}

export function classifyControlSites(sites: readonly ControlSite[], rules: readonly ControlRule[] = CONTROL_RULES): { classified: ClassifiedControl[]; unmatched: ControlSite[]; unusedRules: ControlRule[] } {
  const used = new Set<string>();
  const classified: ClassifiedControl[] = [];
  const unmatched: ControlSite[] = [];
  for (const site of sites) {
    const matched = matchControlRule(site, rules);
    if (!matched) { unmatched.push(site); continue; }
    used.add(matched.id);
    classified.push({ ...site, ruleId: matched.id, classification: matched.classification, recordIds: matched.recordIds ?? [], reason: matched.reason ?? "", note: matched.note ?? "" });
  }
  return { classified, unmatched, unusedRules: rules.filter((candidate) => !used.has(candidate.id)) };
}

/** Structural validation of the rules themselves (ids, record references, reasons). */
export function validateControlRules(rules: readonly ControlRule[] = CONTROL_RULES): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const records = new Set(ACTION_COVERAGE_REGISTRY.map((record) => record.id));
  for (const candidate of rules) {
    if (ids.has(candidate.id)) errors.push(`${candidate.id}: duplicate rule id`);
    ids.add(candidate.id);
    if ((candidate.classification === "semantic" || candidate.classification === "dispatcher") && !(candidate.recordIds && candidate.recordIds.length > 0)) errors.push(`${candidate.id}: ${candidate.classification} rule must name at least one registry record`);
    if (candidate.classification === "unavailable" && !candidate.reason) errors.push(`${candidate.id}: unavailable rule must state the visible reason`);
    for (const recordId of candidate.recordIds ?? []) if (!records.has(recordId)) errors.push(`${candidate.id}: unknown registry record ${recordId}`);
  }
  return errors;
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function renderControlInventoryCsv(rows: readonly ClassifiedControl[]): string {
  const header = ["key", "surface", "kind", "element", "label", "handler", "classification", "record_ids", "rule_id", "reason", "note"];
  const body = [...rows].sort((a, b) => a.key.localeCompare(b.key)).map((row) => [row.key, row.surface, row.kind, row.element, row.label, row.handler, row.classification, row.recordIds.join(";"), row.ruleId, row.reason, row.note]);
  return [header, ...body].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export interface ControlInventorySummary {
  schemaVersion: "sirkit.ui-control-inventory-summary.v1";
  sites: number;
  surfaces: number;
  byKind: Record<string, number>;
  byClassification: Record<string, number>;
  recordsReached: string[];
}

export function summarizeControlInventory(rows: readonly ClassifiedControl[]): ControlInventorySummary {
  const byKind: Record<string, number> = {}, byClassification: Record<string, number> = {};
  const reached = new Set<string>();
  for (const row of rows) {
    byKind[row.kind] = (byKind[row.kind] ?? 0) + 1;
    byClassification[row.classification] = (byClassification[row.classification] ?? 0) + 1;
    for (const id of row.recordIds) reached.add(id);
  }
  return { schemaVersion: "sirkit.ui-control-inventory-summary.v1", sites: rows.length, surfaces: new Set(rows.map((row) => row.surface)).size, byKind: Object.fromEntries(Object.entries(byKind).sort()), byClassification: Object.fromEntries(Object.entries(byClassification).sort()), recordsReached: [...reached].sort() };
}
