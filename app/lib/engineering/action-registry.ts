/**
 * B01 coverage registry.
 *
 * This describes the product as it exists today. It is not an execution bus and
 * deliberately does not import UI handlers or change runtime behavior.
 */
export const ACTION_KINDS = ["read", "propose", "mutate", "destructive"] as const;
export const COVERAGE_STATUSES = [
  "implemented",
  "legacy",
  "ui-only",
  "api-only",
  "partial",
  "missing",
] as const;
export const TOOL_EXPOSURES = [
  "none",
  "chat",
  "structured-route",
  "preview-apply",
  "repair-agent",
  "schema-only",
] as const;
export const APPROVAL_TIERS = [
  "none",
  "reversible",
  "topology-or-geometry",
  "destructive",
  "release",
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];
export type ToolExposure = (typeof TOOL_EXPOSURES)[number];
export type ApprovalTier = (typeof APPROVAL_TIERS)[number];

export interface ActionCoverageRecord {
  id: string;
  version: 1;
  area:
    | "project"
    | "schematic"
    | "pcb"
    | "placement"
    | "routing"
    | "validation"
    | "view"
    | "manufacturing"
    | "full-flow"
    | "parts"
    | "ai"
    | "spice"
    | "bom"
    | "cd-workbench";
  action: string;
  kind: ActionKind;
  status: CoverageStatus;
  sources: readonly string[];
  handler: string;
  domainCommand: string | null;
  mutationAuthority: string;
  validation: string;
  historyOrRevision: string;
  toolExposure: ToolExposure;
  approvalTier: ApprovalTier;
  notes?: string;
}

const action = (record: ActionCoverageRecord): ActionCoverageRecord =>
  Object.freeze(record);

export const ACTION_COVERAGE_REGISTRY = Object.freeze([
  action({ id: "project.hydrate", version: 1, area: "project", action: "Hydrate working project", kind: "mutate", status: "implemented", sources: ["app/page.tsx", "app/lib/project/autosave.ts"], handler: "page hydration effects", domainCommand: null, mutationAuthority: "React state from local working copy", validation: "hydration guards and persisted format checks", historyOrRevision: "separate local working-copy lineage", toolExposure: "none", approvalTier: "none" }),
  action({ id: "project.undo-redo", version: 1, area: "project", action: "Undo or redo editor change", kind: "mutate", status: "partial", sources: ["app/page.tsx", "app/lib/pcb/history.ts"], handler: "schematic history handlers / PcbHistory", domainCommand: null, mutationAuthority: "schematic snapshots or PCB Immer patches", validation: "history-specific", historyOrRevision: "two non-unified histories", toolExposure: "none", approvalTier: "none" }),
  action({ id: "project.checkpoint", version: 1, area: "project", action: "Create or restore checkpoint", kind: "mutate", status: "implemented", sources: ["app/page.tsx", "app/lib/project/checkpoints.ts"], handler: "checkpoint UI handlers", domainCommand: null, mutationAuthority: "IndexedDB snapshot", validation: "checkpoint serialization", historyOrRevision: "checkpoint lineage", toolExposure: "none", approvalTier: "reversible" }),
  action({ id: "schematic.generate", version: 1, area: "schematic", action: "Generate schematic", kind: "mutate", status: "partial", sources: ["app/page.tsx", "app/api/schematic/route.ts", "app/api/schematic/build-multi/route.ts"], handler: "generate/build routes then client apply", domainCommand: null, mutationAuthority: "structured model output applied to client schematic", validation: "schema plus ERC correction", historyOrRevision: "client snapshot", toolExposure: "structured-route", approvalTier: "topology-or-geometry" }),
  action({ id: "schematic.add-component", version: 1, area: "schematic", action: "Add component", kind: "mutate", status: "ui-only", sources: ["app/page.tsx"], handler: "component placement handlers", domainCommand: null, mutationAuthority: "direct schematic state", validation: "UI/local graph checks", historyOrRevision: "schematic snapshot", toolExposure: "none", approvalTier: "topology-or-geometry" }),
  action({ id: "schematic.connect", version: 1, area: "schematic", action: "Create wire, junction, label, or ground", kind: "mutate", status: "ui-only", sources: ["app/page.tsx"], handler: "wire/junction/label handlers", domainCommand: null, mutationAuthority: "direct schematic graph state", validation: "local graph checks", historyOrRevision: "schematic snapshot", toolExposure: "none", approvalTier: "topology-or-geometry" }),
  action({ id: "schematic.set-property", version: 1, area: "schematic", action: "Set component value or name", kind: "mutate", status: "partial", sources: ["app/page.tsx", "app/api/schematic/edit/route.ts"], handler: "schematic edit route then client apply", domainCommand: "route-local structured edit", mutationAuthority: "client schematic state", validation: "edit response schema", historyOrRevision: "schematic snapshot", toolExposure: "structured-route", approvalTier: "reversible" }),
  action({ id: "schematic.move-rotate", version: 1, area: "schematic", action: "Move or rotate component", kind: "mutate", status: "ui-only", sources: ["app/page.tsx"], handler: "canvas and KiCad interaction handlers", domainCommand: null, mutationAuthority: "direct schematic geometry", validation: "local geometry checks", historyOrRevision: "schematic snapshot", toolExposure: "none", approvalTier: "reversible" }),
  action({ id: "schematic.delete-component", version: 1, area: "schematic", action: "Delete component", kind: "destructive", status: "partial", sources: ["app/page.tsx", "app/api/schematic/edit/route.ts"], handler: "properties/KiCad delete or structured edit", domainCommand: "route-local delete result", mutationAuthority: "client schematic graph", validation: "fragmented graph cleanup", historyOrRevision: "schematic snapshot", toolExposure: "structured-route", approvalTier: "destructive" }),
  action({ id: "schematic.replace-component", version: 1, area: "schematic", action: "Replace component", kind: "destructive", status: "partial", sources: ["app/page.tsx"], handler: "swap/replace handlers", domainCommand: null, mutationAuthority: "client component and connectivity state", validation: "fragmented authority/compatibility/remap checks", historyOrRevision: "schematic snapshot", toolExposure: "none", approvalTier: "destructive" }),
  action({ id: "schematic.import-export-kicad", version: 1, area: "schematic", action: "Import or export KiCad schematic", kind: "mutate", status: "partial", sources: ["app/page.tsx", "app/api/export/kicad/route.ts"], handler: "import/export handlers", domainCommand: null, mutationAuthority: "client import or serialized response", validation: "format-specific", historyOrRevision: "import snapshot; export read-only", toolExposure: "none", approvalTier: "topology-or-geometry" }),
  action({ id: "pcb.move-footprint", version: 1, area: "pcb", action: "Move footprint", kind: "mutate", status: "implemented", sources: ["app/components/pcb/PcbEditor.tsx", "app/lib/pcb/edit/commands.ts", "app/lib/pcb/edit/apply.ts", "app/lib/engineering/editor-adapter.ts"], handler: "editor inspector/drag or applyEdits", domainCommand: "set_footprint_position", mutationAuthority: "canonical executor via B03 editor adapter (move_footprint)", validation: "PCB edit compiler and board checks, then canonical operation validation", historyOrRevision: "PcbHistory entry bound to canonical transaction + revision before/after", toolExposure: "preview-apply", approvalTier: "reversible" }),
  action({ id: "pcb.rotate-side-footprint", version: 1, area: "pcb", action: "Rotate or change footprint side", kind: "mutate", status: "implemented", sources: ["app/components/pcb/PcbEditor.tsx", "app/lib/pcb/edit/commands.ts", "app/lib/engineering/editor-adapter.ts"], handler: "footprint inspector or applyEdits", domainCommand: "rotate_footprint / set_footprint_side", mutationAuthority: "canonical executor via B03 editor adapter (move_footprint)", validation: "PCB edit validation, then canonical operation validation", historyOrRevision: "PcbHistory entry bound to canonical transaction + revision before/after", toolExposure: "preview-apply", approvalTier: "reversible", notes: "Inspector locked-flag patches stay on the legacy path (set_footprint_protection needs manage_protection)." }),
  action({ id: "pcb.edit-track", version: 1, area: "pcb", action: "Edit track width, layer, or geometry", kind: "mutate", status: "implemented", sources: ["app/components/pcb/PcbEditor.tsx", "app/lib/pcb/edit/commands.ts", "app/lib/engineering/editor-adapter.ts"], handler: "TrackInspector or applyEdits", domainCommand: "set_track_width / set_track_layer / move_track", mutationAuthority: "canonical executor via B03 editor adapter (update_track); zone/text re-layer stays legacy", validation: "structural validation and DRC separately, then canonical operation validation", historyOrRevision: "PcbHistory entry bound to canonical transaction + revision before/after", toolExposure: "preview-apply", approvalTier: "topology-or-geometry" }),
  action({ id: "pcb.delete-item", version: 1, area: "pcb", action: "Delete track, via, zone, or text", kind: "destructive", status: "implemented", sources: ["app/components/pcb/PcbEditor.tsx", "app/lib/pcb/edit/commands.ts", "app/lib/engineering/editor-adapter.ts"], handler: "context/inspector delete or applyEdits", domainCommand: "delete_item", mutationAuthority: "canonical executor via B03 editor adapter (remove_track/remove_via/remove_zone); silk-text delete stays legacy (no text operation exists)", validation: "non-footprint restriction and structural validation, then canonical operation validation", historyOrRevision: "PcbHistory entry bound to canonical transaction + revision before/after", toolExposure: "preview-apply", approvalTier: "destructive", notes: "B03.1: destructive approval comes from the trusted InteractiveUiChannel capability injected at editor-session composition — caller-supplied actorKind/provenance fields can only narrow, never grant; ai/api/worker callers require an independent approve_proposal." }),
  action({ id: "pcb.create-via", version: 1, area: "pcb", action: "Create general via", kind: "mutate", status: "partial", sources: ["app/lib/pcb/route-tool.ts", "app/lib/pcb/route-tool.commands.ts"], handler: "routing interaction", domainCommand: null, mutationAuthority: "route-specific board mutation", validation: "routing/DRC checks", historyOrRevision: "routing history", toolExposure: "schema-only", approvalTier: "topology-or-geometry" }),
  action({ id: "pcb.edit-via", version: 1, area: "pcb", action: "Edit via padstack, diameter, or drill", kind: "mutate", status: "partial", sources: ["app/components/pcb/PcbEditor.tsx", "app/lib/pcb/edit/commands.ts"], handler: "ViaInspector or applyEdits", domainCommand: "set_via_padstack", mutationAuthority: "PCB editor/edit batch", validation: "padstack validation", historyOrRevision: "PcbHistory", toolExposure: "preview-apply", approvalTier: "topology-or-geometry" }),
  action({ id: "pcb.zone", version: 1, area: "pcb", action: "Create or edit copper zone", kind: "mutate", status: "partial", sources: ["app/components/pcb/PcbToolbar.tsx", "app/lib/pcb/zones/command.ts", "app/lib/pcb/edit/commands.ts"], handler: "zone tool/inspector/applyEdits", domainCommand: "zone commands plus set_zone_properties", mutationAuthority: "PCB board mutation", validation: "fill/clearance/DRC", historyOrRevision: "PcbHistory", toolExposure: "preview-apply", approvalTier: "topology-or-geometry" }),
  action({ id: "pcb.silkscreen-text", version: 1, area: "pcb", action: "Create or edit silkscreen text", kind: "mutate", status: "partial", sources: ["app/components/pcb/PcbToolbar.tsx", "app/lib/pcb/edit/commands.ts"], handler: "silk/text tools", domainCommand: "set_text_properties", mutationAuthority: "PCB board mutation", validation: "geometry validation", historyOrRevision: "PcbHistory", toolExposure: "preview-apply", approvalTier: "reversible" }),
  action({ id: "pcb.arrange", version: 1, area: "pcb", action: "Align, distribute, or snap items", kind: "mutate", status: "implemented", sources: ["app/lib/pcb/edit/commands.ts", "app/lib/engineering/editor-adapter.ts"], handler: "arrange UI or applyEdits", domainCommand: "align / distribute / snap_to_grid", mutationAuthority: "canonical executor via B03 editor adapter for all-footprint selections (move_footprint batch); mixed-kind selections stay legacy", validation: "selection/axis validation, then canonical operation validation", historyOrRevision: "single PcbHistory entry = one canonical transaction", toolExposure: "preview-apply", approvalTier: "reversible" }),
  action({ id: "pcb.undo-redo-canonical", version: 1, area: "pcb", action: "Undo or redo a canonical PCB editor transaction", kind: "mutate", status: "implemented", sources: ["app/lib/engineering/editor-adapter.ts", "app/lib/engineering/executor.ts", "app/lib/pcb/history.ts"], handler: "B03 adapter-wrapped PcbHistory undo/redo → CanonicalExecutor.executeUndoRedo", domainCommand: "verified replay of a referenced durable record's inverse or forward operations", mutationAuthority: "canonical executor verified-replay contract ONLY (generic execute refuses this command; callers can never supply operations)", validation: "durable-record scope + lineage-position + semantic source/result digest verification with pre-mutation dry-run; divergence rebases instead of guessing", historyOrRevision: "audited inverse/forward transactions provenance-linked to the referenced transaction id and direction", toolExposure: "none", approvalTier: "none", notes: "B03.1: replay operations come exclusively from the durable record; pre-B03.1 records without semantic digests fail closed to the rebase rule." }),
  action({ id: "pcb.rules", version: 1, area: "pcb", action: "Inspect or edit design rules", kind: "mutate", status: "partial", sources: ["app/components/pcb/PcbEditor.tsx", "app/lib/pcb/ai/pcb-tool-schemas.ts"], handler: "rules UI and AI proposal flow", domainCommand: null, mutationAuthority: "separate rule apply path", validation: "classification and DRC", historyOrRevision: "path-specific", toolExposure: "schema-only", approvalTier: "topology-or-geometry" }),
  action({ id: "pcb.dimension", version: 1, area: "pcb", action: "Create or edit dimension annotation", kind: "mutate", status: "missing", sources: ["app/lib/pcb/types.ts"], handler: "none", domainCommand: null, mutationAuthority: "none", validation: "none", historyOrRevision: "none", toolExposure: "none", approvalTier: "topology-or-geometry" }),
  action({ id: "pcb.board-geometry", version: 1, area: "pcb", action: "Edit outline, keepout, cutout, or mounting geometry", kind: "mutate", status: "partial", sources: ["app/components/pcb/PcbToolbar.tsx", "app/lib/pcb/types.ts"], handler: "outline presets and fragmented geometry paths", domainCommand: null, mutationAuthority: "PCB board state", validation: "geometry/DRC path-specific", historyOrRevision: "PcbHistory where wired", toolExposure: "schema-only", approvalTier: "topology-or-geometry" }),
  action({ id: "placement.auto", version: 1, area: "placement", action: "Generate and apply automatic placement", kind: "mutate", status: "partial", sources: ["app/components/pcb/hooks/useAutoPlace.ts", "app/lib/pcb/autoplace/auto-place.ts"], handler: "useAutoPlace preview/apply/discard", domainCommand: null, mutationAuthority: "candidate then client board mutation", validation: "placement qualification/readiness", historyOrRevision: "PcbHistory on apply", toolExposure: "schema-only", approvalTier: "topology-or-geometry" }),
  action({ id: "routing.autoroute", version: 1, area: "routing", action: "Autoroute board", kind: "mutate", status: "partial", sources: ["app/components/pcb/hooks/useAutoroute.ts", "app/api/pcb/autoroute/route.ts"], handler: "autoroute hook/API", domainCommand: "route-specific command", mutationAuthority: "router result applied to board", validation: "preflight/connectivity/DRC/verification", historyOrRevision: "PCB history/path-specific revision", toolExposure: "repair-agent", approvalTier: "topology-or-geometry" }),
  action({ id: "validation.erc-drc", version: 1, area: "validation", action: "Run ERC or DRC", kind: "read", status: "implemented", sources: ["app/components/pcb/DrcPanel.tsx", "app/lib/pcb/drc/run-drc.ts"], handler: "validation UI/services", domainCommand: "run validation service", mutationAuthority: "derived result only", validation: "engine result", historyOrRevision: "must be interpreted against source board", toolExposure: "schema-only", approvalTier: "none" }),
  action({ id: "view.pcb-3d-control", version: 1, area: "view", action: "Control 3D camera, focus, and visibility", kind: "mutate", status: "ui-only", sources: ["app/components/pcb/PcbPreview3D.tsx"], handler: "component-local controls", domainCommand: null, mutationAuthority: "non-authoritative component state", validation: "visual only", historyOrRevision: "none", toolExposure: "none", approvalTier: "none" }),
  action({ id: "manufacturing.release", version: 1, area: "manufacturing", action: "Release deterministic bare-board package", kind: "destructive", status: "api-only", sources: ["app/api/pcb/release/route.ts", "app/lib/pcb/fab/release-gate.ts"], handler: "POST /api/pcb/release", domainCommand: "release-gate workflow", mutationAuthority: "durable authority-scoped release", validation: "revision/digest, placement, DRC, connectivity, compile, readback, revalidation", historyOrRevision: "exact release revision and digest", toolExposure: "none", approvalTier: "release" }),
  action({ id: "manufacturing.assembled-release", version: 1, area: "manufacturing", action: "Release assembled product", kind: "destructive", status: "missing", sources: ["app/lib/pcb/fab/release-gate.ts"], handler: "explicitly blocked", domainCommand: null, mutationAuthority: "none", validation: "fail closed", historyOrRevision: "none", toolExposure: "none", approvalTier: "release" }),
  action({ id: "full-flow.run", version: 1, area: "full-flow", action: "Run full-flow proposal", kind: "propose", status: "api-only", sources: ["app/api/full-flow/run/route.ts", "app/lib/full-flow/types.ts"], handler: "POST /api/full-flow/run", domainCommand: "proposal envelope only", mutationAuthority: "no authoritative engineering artifacts", validation: "CD-stage/foundation validation", historyOrRevision: "trace/replay foundation", toolExposure: "structured-route", approvalTier: "none" }),
  // ── B01 completion: R06-era project/file/persistence surfaces ──────────────
  action({ id: "project.autosave", version: 1, area: "project", action: "Autosave project state after committed operations", kind: "mutate", status: "implemented", sources: ["app/page.tsx", "app/lib/project/autosave.ts", "lib/persistence.ts"], handler: "createAutosaver + persistProject", domainCommand: null, mutationAuthority: "localStorage SavedProject record (hydration-commit guarded)", validation: "truthful save status; failed writes retained and retried", historyOrRevision: "record updatedAt + schemaVersion", toolExposure: "none", approvalTier: "none" }),
  action({ id: "project.save-file", version: 1, area: "project", action: "Save project to local .sirkit.json file", kind: "read", status: "implemented", sources: ["app/page.tsx", "app/lib/project/file.ts"], handler: "handleExportProject → exportProjectFile", domainCommand: null, mutationAuthority: "none (artifact export)", validation: "allowlist projection + sha256 integrity digest", historyOrRevision: "includes checkpoints; deterministic payload", toolExposure: "none", approvalTier: "none" }),
  action({ id: "project.open-file", version: 1, area: "project", action: "Open project from local .sirkit.json file", kind: "mutate", status: "implemented", sources: ["app/page.tsx", "app/lib/project/file.ts"], handler: "handleImportProjectFile → importProjectFile", domainCommand: null, mutationAuthority: "SavedProject + checkpoint store; same-id restore or conflict copy, never overwrite", validation: "format/version/integrity/shape checks; missing catalog parts reported, never fabricated", historyOrRevision: "checkpoints imported and re-keyed", toolExposure: "none", approvalTier: "reversible" }),
  action({ id: "project.switch-create", version: 1, area: "project", action: "Create, open, or rename project", kind: "mutate", status: "implemented", sources: ["app/page.tsx", "app/lib/project/current.ts"], handler: "createNewProject / switchProject / handleRenameProject", domainCommand: null, mutationAuthority: "current-project pointer + SavedProject records", validation: "salvage loader keeps identity; flush-before-switch", historyOrRevision: "per-project lineage", toolExposure: "none", approvalTier: "none" }),
  action({ id: "project.delete", version: 1, area: "project", action: "Delete project", kind: "destructive", status: "implemented", sources: ["app/page.tsx", "lib/persistence.ts"], handler: "projects panel delete → deleteProject", domainCommand: null, mutationAuthority: "localStorage record + checkpoint removal", validation: "explicit confirm dialog; durable server boards kept", historyOrRevision: "local record removed", toolExposure: "none", approvalTier: "destructive" }),
  // ── B01 completion: durable schematic→PCB sync + bindings + qualification ──
  action({ id: "pcb.sync-durable", version: 1, area: "pcb", action: "Synchronize schematic to durable PCB (bind, publish, preflight, apply)", kind: "mutate", status: "implemented", sources: ["app/components/pcb/PcbEditor.tsx", "app/api/pcb-sync/route.ts", "app/api/pcb-sync/handler.ts", "app/api/physical-bindings/route.ts", "app/lib/pcb/netlist-bridge.ts", "app/lib/pcb-sync/client.ts"], handler: "handleSync/handleApplySync → PcbSyncClient + bind_atomic_selection", domainCommand: "publish_demo_snapshot / preflight / apply_exact_plan / bind_atomic_selection", mutationAuthority: "durable server board via CAS-guarded plan apply; local working copy layered on exact base", validation: "fail-closed publication gates, plan lifecycle, digest verification, authoritative reload", historyOrRevision: "server board revisions + snapshot revisions + working-copy base", toolExposure: "none", approvalTier: "topology-or-geometry" }),
  action({ id: "pcb.physical-binding", version: 1, area: "pcb", action: "Bind component instance to published atomic authority", kind: "mutate", status: "implemented", sources: ["app/api/physical-bindings/route.ts", "app/lib/physical-binding/atomic-binding.ts"], handler: "POST /api/physical-bindings bind_atomic_selection", domainCommand: "Stage 1 lifecycle create→select→revalidate→approve", mutationAuthority: "durable physical-binding aggregates (CAS, idempotent replay)", validation: "published-revision, mapping-approved, integrity validation", historyOrRevision: "immutable binding revisions + audit events", toolExposure: "none", approvalTier: "reversible" }),
  action({ id: "pcb.qualify-route", version: 1, area: "pcb", action: "Server qualification: autonomous placement + real routing + RC01–RC03", kind: "mutate", status: "implemented", sources: ["app/components/pcb/PcbEditor.tsx", "app/api/pcb/qualify/route.ts"], handler: "handleQualify → POST /api/pcb/qualify", domainCommand: "qualifyAutonomousLayout + commitSelected + authority persistence", mutationAuthority: "durable board commit + ManufacturingReleaseAuthority store", validation: "capability profile, RC01 parity, RC02 connectivity, RC03 capability", historyOrRevision: "committed board revision + authority revision", toolExposure: "none", approvalTier: "topology-or-geometry" }),
  action({ id: "pcb.footprint-resolution", version: 1, area: "pcb", action: "Resolve, verify, or inspect footprint assignments and mappings", kind: "mutate", status: "partial", sources: ["app/api/footprint-resolution/route.ts", "app/api/mapping-verification/route.ts", "app/api/passive-policy/route.ts", "app/components/pcb/MappingVerificationPanel.tsx", "app/components/pcb/PassivePackagePolicyPanel.tsx"], handler: "resolution/verification routes + panels", domainCommand: null, mutationAuthority: "durable resolution decisions (route-owned)", validation: "resolution/verification gates", historyOrRevision: "decision records", toolExposure: "none", approvalTier: "reversible", notes: "Per-route write-behavior not individually audited in B01." }),
  action({ id: "pcb.assignment-queue", version: 1, area: "pcb", action: "Manage footprint assignment queue (list, decide, materialize, revalidate)", kind: "mutate", status: "implemented", sources: ["app/components/pcb/AssignmentQueuePanel.tsx", "app/api/assignment-queue/route.ts", "app/api/assignment-queue/materialize/route.ts", "app/api/assignment-queue/revalidate/route.ts"], handler: "AssignmentQueuePanel → assignment-queue routes", domainCommand: "queue decisions + materialization", mutationAuthority: "durable assignment records", validation: "owner-evidence revalidation", historyOrRevision: "queue decision lineage", toolExposure: "none", approvalTier: "reversible" }),
  action({ id: "pcb.export-kicad", version: 1, area: "pcb", action: "Export board or schematic to KiCad files", kind: "read", status: "implemented", sources: ["app/components/pcb/PcbEditor.tsx", "app/api/pcb/export/kicad-pcb/route.ts", "app/api/export/kicad/route.ts"], handler: "export buttons → export routes", domainCommand: null, mutationAuthority: "none (artifact export; PCB export gated on verified authoritative board)", validation: "authority gate with actionable refusal", historyOrRevision: "read-only of current state", toolExposure: "none", approvalTier: "none" }),
  action({ id: "pcb.assist-edit", version: 1, area: "pcb", action: "Natural-language PCB edit assist (preview then apply)", kind: "mutate", status: "implemented", sources: ["app/components/pcb/AssistBox.tsx", "app/api/pcb/edit/assist/route.ts", "app/lib/pcb/edit/commands.ts"], handler: "AssistBox → /api/pcb/edit/assist → edit batch preview/apply", domainCommand: "PCB edit command batch", mutationAuthority: "PcbHistory batch on explicit apply", validation: "edit compiler + structural validation; preview never auto-applies", historyOrRevision: "single undoable batch", toolExposure: "preview-apply", approvalTier: "reversible" }),
  action({ id: "pcb.ai-rules-brief", version: 1, area: "pcb", action: "Propose routing rules from a board brief", kind: "propose", status: "partial", sources: ["app/components/pcb/RoutingRulesPanel.tsx", "app/api/pcb/ai-rules/from-brief/route.ts"], handler: "RoutingRulesPanel → /api/pcb/ai-rules/from-brief", domainCommand: "schema-validated rule proposal", mutationAuthority: "separate explicit apply path", validation: "proposal schema + classification", historyOrRevision: "apply-path specific", toolExposure: "structured-route", approvalTier: "topology-or-geometry" }),
  action({ id: "pcb.assign-suggest", version: 1, area: "pcb", action: "Suggest footprint for unresolved component", kind: "propose", status: "implemented", sources: ["app/api/pcb/assign/suggest/route.ts"], handler: "POST /api/pcb/assign/suggest", domainCommand: "suggestion only", mutationAuthority: "none until user decision", validation: "suggestion schema", historyOrRevision: "none", toolExposure: "structured-route", approvalTier: "none" }),
  action({ id: "pcb.board-repair", version: 1, area: "pcb", action: "Plan and apply DRC board repairs", kind: "mutate", status: "implemented", sources: ["app/components/pcb/BoardRepairPanel.tsx", "app/components/pcb/hooks/usePcbRepair.ts", "app/api/pcb/repair/agent/route.ts"], handler: "BoardRepairPanel → usePcbRepair (plan/preview/apply/undo)", domainCommand: "repair plan + transaction preview", mutationAuthority: "PcbHistory transaction on approved apply", validation: "safe-fix classification; provider failure surfaces actionably", historyOrRevision: "repair transaction with undo", toolExposure: "repair-agent", approvalTier: "topology-or-geometry" }),
  // ── B01 completion: manufacturing surfaces beyond MFG01 ────────────────────
  action({ id: "manufacturing.export-engineering", version: 1, area: "manufacturing", action: "Explicitly-labelled unverified engineering fab export", kind: "read", status: "implemented", sources: ["app/components/pcb/FabDialog.tsx", "app/components/pcb/hooks/useFabExport.ts", "app/api/pcb/export/gerbers/route.ts"], handler: "FabDialog engineering override → POST /api/pcb/export/gerbers", domainCommand: "waived engineering export", mutationAuthority: "none (artifact export; verified mode refused for browser boards)", validation: "readiness recompute + explicit waiver reason + non-verified labeling", historyOrRevision: "release manifest recorded as history only", toolExposure: "none", approvalTier: "release" }),
  // ── B01 completion: parts/catalog read surfaces ────────────────────────────
  action({ id: "parts.catalog-read", version: 1, area: "parts", action: "Search and read parts, footprints, and atomic catalog", kind: "read", status: "implemented", sources: ["app/api/parts/search/route.ts", "app/api/parts/[id]/route.ts", "app/api/parts/[id]/alternates/route.ts", "app/api/parts/categories/route.ts", "app/api/pcb/footprints/search/route.ts", "app/api/pcb/footprints/[id]/route.ts", "app/api/pcb/footprints/resolve/route.ts", "app/api/components/atomic/route.ts", "app/api/components/atomic/search/route.ts", "app/api/kicad/v1/route.ts"], handler: "catalog GET/search routes", domainCommand: null, mutationAuthority: "none", validation: "authority annotations surfaced (verified/orderable)", historyOrRevision: "none", toolExposure: "structured-route", approvalTier: "none", notes: "search_parts is executed inside the build agent loop; kicad/v1 serves the KiCad HTTP library." }),
  // ── B01 completion: AI advisory + generation-adjacent surfaces ─────────────
  action({ id: "ai.chat-qa", version: 1, area: "ai", action: "Chat question answering", kind: "propose", status: "implemented", sources: ["app/page.tsx", "app/api/chat/route.ts"], handler: "chat panel → POST /api/chat", domainCommand: null, mutationAuthority: "none without explicit apply", validation: "provider failures classified and actionable", historyOrRevision: "chat persisted to project record", toolExposure: "chat", approvalTier: "none" }),
  action({ id: "ai.runtime-info", version: 1, area: "ai", action: "Read AI runtime configuration", kind: "read", status: "implemented", sources: ["app/api/ai/runtime/route.ts", "app/page.tsx"], handler: "GET /api/ai/runtime", domainCommand: null, mutationAuthority: "none", validation: "none", historyOrRevision: "none", toolExposure: "none", approvalTier: "none" }),
  action({ id: "schematic.review-advisory", version: 1, area: "schematic", action: "Advisory review, layout critic, and cross-verification", kind: "read", status: "implemented", sources: ["app/page.tsx", "app/api/schematic/review/route.ts", "app/api/schematic/layout-critic/route.ts", "app/api/schematic/cross-verify/route.ts"], handler: "auto-review pipeline + More checks", domainCommand: "advisory diagnostics only", mutationAuthority: "none (suggestions require explicit apply)", validation: "advisory framing enforced", historyOrRevision: "chat log", toolExposure: "structured-route", approvalTier: "none" }),
  action({ id: "schematic.edit-topology", version: 1, area: "schematic", action: "Tier-2 topology edit via structured route", kind: "mutate", status: "partial", sources: ["app/page.tsx", "app/api/schematic/edit-build/route.ts"], handler: "edit-build route then client apply", domainCommand: "route-local structured topology edit", mutationAuthority: "client schematic state on apply", validation: "edit response schema + ERC", historyOrRevision: "schematic snapshot", toolExposure: "structured-route", approvalTier: "topology-or-geometry" }),
  // ── B01 completion: SPICE + BOM workbenches ────────────────────────────────
  action({ id: "spice.workbench", version: 1, area: "spice", action: "SPICE studio: compile, run, inspect, delete runs", kind: "mutate", status: "implemented", sources: ["app/components/spice/SpiceStudio.tsx", "app/api/spice/runs/route.ts", "app/api/spice/compile/route.ts", "app/api/simulate/route.ts", "app/api/spice/ai/route.ts"], handler: "SpiceStudio → spice/* routes", domainCommand: "run lifecycle", mutationAuthority: "durable run records; DELETE /api/spice/runs/[id] removes a run", validation: "compile/model smoke tests", historyOrRevision: "run ids + bundles", toolExposure: "structured-route", approvalTier: "reversible", notes: "Run deletion is the destructive edge; simulation itself never mutates design state." }),
  action({ id: "bom.workbench", version: 1, area: "bom", action: "BOM view, exports, vendor carts, notifications, part swap", kind: "mutate", status: "implemented", sources: ["app/components/bom/BomView.tsx", "app/page.tsx", "app/api/bom/route.ts", "app/api/bom/snapshot/route.ts", "app/api/bom/export-csv/route.ts", "app/api/bom/cart/digikey/route.ts", "app/api/bom/notifications/route.ts"], handler: "BomView + bom/* routes; onSwapPart mutates schematic", domainCommand: null, mutationAuthority: "part swap mutates client schematic; snapshots/notifications route-owned; carts build payloads only (no ordering)", validation: "swap compatibility path; cart generation is payload-only", historyOrRevision: "schematic snapshot on swap; BOM snapshots", toolExposure: "none", approvalTier: "reversible", notes: "No vendor order is placed by any cart route." }),
  // ── B01 completion: constraints/effects read surfaces ──────────────────────
  action({ id: "validation.constraints-inspect", version: 1, area: "validation", action: "Explain or preview typed constraints", kind: "read", status: "implemented", sources: ["app/api/constraints/explain/route.ts", "app/api/constraints/preview/route.ts"], handler: "constraints routes + effective-rule inspector", domainCommand: "constraint evaluation read", mutationAuthority: "none", validation: "deterministic evaluation", historyOrRevision: "program/evaluation hashes", toolExposure: "none", approvalTier: "none" }),
  action({ id: "project.engineering-effects", version: 1, area: "project", action: "Query engineering effects/observability", kind: "read", status: "api-only", sources: ["app/api/engineering-effects/route.ts"], handler: "POST /api/engineering-effects", domainCommand: null, mutationAuthority: "none identified", validation: "route-owned", historyOrRevision: "none", toolExposure: "none", approvalTier: "none", notes: "Write-behavior not individually audited in B01." }),
  action({ id: "placement.preview-api", version: 1, area: "placement", action: "Server placement preview", kind: "propose", status: "api-only", sources: ["app/api/pcb/placement/preview/route.ts"], handler: "POST /api/pcb/placement/preview", domainCommand: "placement candidate preview", mutationAuthority: "none (preview only)", validation: "placement qualification", historyOrRevision: "none", toolExposure: "none", approvalTier: "none" }),
  // ── B01 completion: view navigation ────────────────────────────────────────
  action({ id: "view.canvas-navigation", version: 1, area: "view", action: "Zoom, fit, pan, layer visibility, workspace tabs", kind: "mutate", status: "ui-only", sources: ["app/components/pcb/PcbToolbar.tsx", "app/components/pcb/LayerPanel.tsx", "app/page.tsx"], handler: "toolbar/layer-panel/tab controls", domainCommand: null, mutationAuthority: "non-authoritative viewport/visibility state (workspace tab persisted)", validation: "visual only", historyOrRevision: "workflowView persisted; viewport not", toolExposure: "none", approvalTier: "none" }),
  // ── B01 completion: CD workbench groups (route grain in API_ROUTE_COVERAGE) ─
  action({ id: "cd.requirements.workbench", version: 1, area: "cd-workbench", action: "CD-1 requirements workbench", kind: "propose", status: "implemented", sources: ["app/components/requirements", "app/api/requirements/compile/route.ts"], handler: "requirements components + routes", domainCommand: "CD-1 compile/capabilities/sources", mutationAuthority: "client-persisted stage state; routes compute", validation: "CD-1 validation", historyOrRevision: "deterministic digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; per-route write-behavior not individually audited in B01." }),
  action({ id: "cd.architecture.workbench", version: 1, area: "cd-workbench", action: "CD-2 architecture workbench", kind: "propose", status: "implemented", sources: ["app/architecture", "app/api/architecture/propose/route.ts"], handler: "architecture page + routes", domainCommand: "CD-2 propose/candidates/compare/alternatives", mutationAuthority: "client-persisted stage state; routes compute", validation: "CD-2 validation", historyOrRevision: "candidate digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; per-route write-behavior not individually audited in B01." }),
  action({ id: "cd.power.workbench", version: 1, area: "cd-workbench", action: "CD-3 power workbench", kind: "propose", status: "implemented", sources: ["app/power", "app/api/power/propose/route.ts"], handler: "power page + routes", domainCommand: "CD-3 propose/candidates/compare/reconcile", mutationAuthority: "client-persisted stage state; routes compute", validation: "CD-3 validation", historyOrRevision: "candidate digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; per-route write-behavior not individually audited in B01." }),
  action({ id: "cd.interfaces.workbench", version: 1, area: "cd-workbench", action: "CD-4 interface planning workbench", kind: "propose", status: "implemented", sources: ["app/interfaces", "app/api/interfaces/propose/route.ts"], handler: "interfaces page + routes", domainCommand: "CD-4 propose/candidates/allocate/compare", mutationAuthority: "client-persisted stage state; routes compute", validation: "CD-4 validation", historyOrRevision: "candidate digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; per-route write-behavior not individually audited in B01." }),
  action({ id: "cd.circuit-knowledge.workbench", version: 1, area: "cd-workbench", action: "CD-5 circuit knowledge workbench", kind: "propose", status: "implemented", sources: ["app/circuit-knowledge", "app/api/circuit-knowledge/propose/route.ts"], handler: "circuit-knowledge page + routes", domainCommand: "CD-5 propose/compile/compose/applicability", mutationAuthority: "client-persisted stage state; routes compute", validation: "CD-5 validation", historyOrRevision: "state digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; per-route write-behavior not individually audited in B01." }),
  action({ id: "cd.component-selection.workbench", version: 1, area: "cd-workbench", action: "CD-6 component selection workbench", kind: "propose", status: "implemented", sources: ["app/component-selection", "app/api/component-selection/propose/route.ts"], handler: "component-selection page + routes", domainCommand: "CD-6 propose/solve/evaluate/sourcing/transaction", mutationAuthority: "client-persisted stage state; routes compute", validation: "CD-6 validation", historyOrRevision: "deterministic digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; transaction-route write-behavior not individually audited in B01." }),
  action({ id: "cd.calculation.workbench", version: 1, area: "cd-workbench", action: "CD-7 calculation workbench", kind: "propose", status: "implemented", sources: ["app/calculation", "app/api/calculation/propose/route.ts"], handler: "calculation page + routes", domainCommand: "CD-7 propose/evaluate/corners/report/transaction", mutationAuthority: "client-persisted stage state; routes compute", validation: "CD-7 validation", historyOrRevision: "deterministic digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; transaction-route write-behavior not individually audited in B01." }),
  action({ id: "cd.schematic-compiler.workbench", version: 1, area: "cd-workbench", action: "CD-8 semantic schematic workbench", kind: "propose", status: "implemented", sources: ["app/schematic-compiler", "app/api/schematic-compiler/propose/route.ts"], handler: "schematic-compiler page + routes", domainCommand: "CD-8 propose/layout/diff/compare/variants/transaction", mutationAuthority: "client-persisted stage state; routes compute", validation: "CD-8 validation", historyOrRevision: "deterministic digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; transaction-route write-behavior not individually audited in B01." }),
  action({ id: "cd.circuit-verification.workbench", version: 1, area: "cd-workbench", action: "CD-9 circuit verification workbench", kind: "propose", status: "implemented", sources: ["app/circuit-verification", "app/api/circuit-verification/propose/route.ts"], handler: "circuit-verification page + routes", domainCommand: "CD-9 propose/run/readiness", mutationAuthority: "client-persisted stage state; routes compute", validation: "CD-9 validation", historyOrRevision: "evidence digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; per-route write-behavior not individually audited in B01." }),
  action({ id: "cd.model-simulation.workbench", version: 1, area: "cd-workbench", action: "CD-10 model simulation workbench", kind: "propose", status: "implemented", sources: ["app/model-simulation", "app/api/model-simulation/propose/route.ts"], handler: "model-simulation page + routes", domainCommand: "CD-10 propose/execute/measure/readiness/denominator", mutationAuthority: "client-persisted stage state; routes compute", validation: "CD-10 validation", historyOrRevision: "readiness digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; per-route write-behavior not individually audited in B01." }),
  action({ id: "cd.firmware-bringup.workbench", version: 1, area: "cd-workbench", action: "CD-11 firmware/bring-up workbench", kind: "propose", status: "implemented", sources: ["app/firmware-bringup", "app/api/firmware-bringup/propose/route.ts"], handler: "firmware-bringup page + routes", domainCommand: "CD-11 propose/problem/resources", mutationAuthority: "client-persisted stage state; routes compute", validation: "CD-11 validation", historyOrRevision: "package digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; per-route write-behavior not individually audited in B01." }),
  action({ id: "cd.release-engineering.workbench", version: 1, area: "cd-workbench", action: "CD-12 release engineering workbench", kind: "propose", status: "implemented", sources: ["app/release-engineering", "app/api/release-engineering/propose/route.ts"], handler: "release-engineering page + routes", domainCommand: "CD-12 propose/problem", mutationAuthority: "client-persisted stage state; routes compute; never orders or releases", validation: "CD-12 validation", historyOrRevision: "release-candidate digests", toolExposure: "structured-route", approvalTier: "none", notes: "Grouped record; per-route write-behavior not individually audited in B01." }),
] satisfies readonly ActionCoverageRecord[]);

/** Per-route action class for the coverage table (strongest across methods). */
export type RouteActionClass = ActionKind;

export interface ApiRouteCoverageEntry {
  /** URL path with dynamic segments kept literal, e.g. "/api/parts/[id]". */
  path: string;
  /** Methods the route file is expected to export — drift fails CI. */
  methods: readonly string[];
  /** Registry record that owns this route. */
  recordId: string;
  /** Strongest action class reachable through this route. */
  class: RouteActionClass;
}

const route = (path: string, methods: readonly string[], recordId: string, cls: RouteActionClass): ApiRouteCoverageEntry =>
  Object.freeze({ path, methods, recordId, class: cls });

/**
 * Complete enumeration of every API route in `app/api` and the registry
 * record that owns it. CI cross-checks BOTH directions against the
 * filesystem: an undeclared route file, a declared-but-missing route, or a
 * method drift all fail.
 */
export const API_ROUTE_COVERAGE = Object.freeze([
  route("/api/ai/runtime", ["GET"], "ai.runtime-info", "read"),
  route("/api/architecture/alternatives", ["POST"], "cd.architecture.workbench", "propose"),
  route("/api/architecture/candidates", ["POST"], "cd.architecture.workbench", "propose"),
  route("/api/architecture/compare", ["POST"], "cd.architecture.workbench", "propose"),
  route("/api/architecture/problem", ["POST"], "cd.architecture.workbench", "propose"),
  route("/api/architecture/propose", ["POST"], "cd.architecture.workbench", "propose"),
  route("/api/assignment-queue", ["GET", "POST"], "pcb.assignment-queue", "mutate"),
  route("/api/assignment-queue/materialize", ["POST"], "pcb.assignment-queue", "mutate"),
  route("/api/assignment-queue/revalidate", ["POST"], "pcb.assignment-queue", "mutate"),
  route("/api/bom/cart/digikey", ["POST"], "bom.workbench", "read"),
  route("/api/bom/cart/lcsc", ["POST"], "bom.workbench", "read"),
  route("/api/bom/cart/mouser", ["POST"], "bom.workbench", "read"),
  route("/api/bom/diff", ["GET"], "bom.workbench", "read"),
  route("/api/bom/export-csv", ["POST"], "bom.workbench", "read"),
  route("/api/bom/notifications", ["DELETE", "GET", "PATCH"], "bom.workbench", "mutate"),
  route("/api/bom/procurement-packet", ["POST"], "bom.workbench", "read"),
  route("/api/bom", ["POST"], "bom.workbench", "read"),
  route("/api/bom/snapshot", ["GET", "POST"], "bom.workbench", "mutate"),
  route("/api/calculation/corners", ["POST"], "cd.calculation.workbench", "propose"),
  route("/api/calculation/evaluate", ["POST"], "cd.calculation.workbench", "propose"),
  route("/api/calculation/export", ["POST"], "cd.calculation.workbench", "read"),
  route("/api/calculation/feedback", ["POST"], "cd.calculation.workbench", "propose"),
  route("/api/calculation/problem", ["POST"], "cd.calculation.workbench", "propose"),
  route("/api/calculation/propose", ["POST"], "cd.calculation.workbench", "propose"),
  route("/api/calculation/report", ["POST"], "cd.calculation.workbench", "read"),
  route("/api/calculation/transaction", ["POST"], "cd.calculation.workbench", "mutate"),
  route("/api/chat", ["POST"], "ai.chat-qa", "propose"),
  route("/api/circuit-knowledge/applicability", ["POST"], "cd.circuit-knowledge.workbench", "propose"),
  route("/api/circuit-knowledge/compile", ["POST"], "cd.circuit-knowledge.workbench", "propose"),
  route("/api/circuit-knowledge/compose", ["POST"], "cd.circuit-knowledge.workbench", "propose"),
  route("/api/circuit-knowledge/problem", ["POST"], "cd.circuit-knowledge.workbench", "propose"),
  route("/api/circuit-knowledge/propose", ["POST"], "cd.circuit-knowledge.workbench", "propose"),
  route("/api/circuit-verification/problem", ["POST"], "cd.circuit-verification.workbench", "propose"),
  route("/api/circuit-verification/propose", ["POST"], "cd.circuit-verification.workbench", "propose"),
  route("/api/circuit-verification/readiness", ["POST"], "cd.circuit-verification.workbench", "propose"),
  route("/api/circuit-verification/run", ["POST"], "cd.circuit-verification.workbench", "propose"),
  route("/api/component-selection/alternative", ["POST"], "cd.component-selection.workbench", "propose"),
  route("/api/component-selection/catalog", ["POST"], "cd.component-selection.workbench", "read"),
  route("/api/component-selection/evaluate", ["POST"], "cd.component-selection.workbench", "propose"),
  route("/api/component-selection/export", ["POST"], "cd.component-selection.workbench", "read"),
  route("/api/component-selection/feedback", ["POST"], "cd.component-selection.workbench", "propose"),
  route("/api/component-selection/problem", ["POST"], "cd.component-selection.workbench", "propose"),
  route("/api/component-selection/propose", ["POST"], "cd.component-selection.workbench", "propose"),
  route("/api/component-selection/solve", ["POST"], "cd.component-selection.workbench", "propose"),
  route("/api/component-selection/sourcing", ["POST"], "cd.component-selection.workbench", "propose"),
  route("/api/component-selection/transaction", ["POST"], "cd.component-selection.workbench", "mutate"),
  route("/api/components/atomic", ["GET"], "parts.catalog-read", "read"),
  route("/api/components/atomic/search", ["POST"], "parts.catalog-read", "read"),
  route("/api/constraints/explain", ["POST"], "validation.constraints-inspect", "read"),
  route("/api/constraints/preview", ["POST"], "validation.constraints-inspect", "read"),
  route("/api/engineering-effects", ["POST"], "project.engineering-effects", "read"),
  route("/api/export/kicad", ["POST"], "pcb.export-kicad", "read"),
  route("/api/firmware-bringup/problem", ["POST"], "cd.firmware-bringup.workbench", "propose"),
  route("/api/firmware-bringup/propose", ["POST"], "cd.firmware-bringup.workbench", "propose"),
  route("/api/firmware-bringup/resources", ["POST"], "cd.firmware-bringup.workbench", "propose"),
  route("/api/footprint-resolution", ["GET", "POST"], "pcb.footprint-resolution", "mutate"),
  route("/api/full-flow/propose", ["POST"], "full-flow.run", "propose"),
  route("/api/full-flow/run", ["POST"], "full-flow.run", "propose"),
  route("/api/full-flow/transition", ["POST"], "full-flow.run", "mutate"),
  route("/api/interfaces/allocate", ["POST"], "cd.interfaces.workbench", "propose"),
  route("/api/interfaces/alternatives", ["POST"], "cd.interfaces.workbench", "propose"),
  route("/api/interfaces/candidates", ["POST"], "cd.interfaces.workbench", "propose"),
  route("/api/interfaces/compare", ["POST"], "cd.interfaces.workbench", "propose"),
  route("/api/interfaces/problem", ["POST"], "cd.interfaces.workbench", "propose"),
  route("/api/interfaces/propose", ["POST"], "cd.interfaces.workbench", "propose"),
  route("/api/kicad/v1/categories.json", ["GET"], "parts.catalog-read", "read"),
  route("/api/kicad/v1/parts/[id]", ["GET"], "parts.catalog-read", "read"),
  route("/api/kicad/v1/parts/category/[id]", ["GET"], "parts.catalog-read", "read"),
  route("/api/kicad/v1", ["GET"], "parts.catalog-read", "read"),
  route("/api/mapping-verification", ["GET", "POST"], "pcb.footprint-resolution", "mutate"),
  route("/api/model-simulation/denominator", ["POST"], "cd.model-simulation.workbench", "propose"),
  route("/api/model-simulation/execute", ["POST"], "cd.model-simulation.workbench", "propose"),
  route("/api/model-simulation/measure", ["POST"], "cd.model-simulation.workbench", "propose"),
  route("/api/model-simulation/problem", ["POST"], "cd.model-simulation.workbench", "propose"),
  route("/api/model-simulation/propose", ["POST"], "cd.model-simulation.workbench", "propose"),
  route("/api/model-simulation/readiness", ["POST"], "cd.model-simulation.workbench", "propose"),
  route("/api/parts/[id]/alternates", ["GET"], "parts.catalog-read", "read"),
  route("/api/parts/[id]", ["GET"], "parts.catalog-read", "read"),
  route("/api/parts/categories", ["GET"], "parts.catalog-read", "read"),
  route("/api/parts/search", ["POST"], "parts.catalog-read", "read"),
  route("/api/passive-policy", ["GET", "POST"], "pcb.footprint-resolution", "mutate"),
  route("/api/pcb-sync", ["GET", "POST"], "pcb.sync-durable", "mutate"),
  route("/api/pcb/ai-rules/from-brief", ["POST"], "pcb.ai-rules-brief", "propose"),
  route("/api/pcb/assign/suggest", ["POST"], "pcb.assign-suggest", "propose"),
  route("/api/pcb/autoroute", ["POST"], "routing.autoroute", "mutate"),
  route("/api/pcb/edit/assist", ["POST"], "pcb.assist-edit", "propose"),
  route("/api/pcb/export/gerbers", ["POST"], "manufacturing.export-engineering", "read"),
  route("/api/pcb/export/kicad-pcb", ["POST"], "pcb.export-kicad", "read"),
  route("/api/pcb/footprints/[id]", ["GET"], "parts.catalog-read", "read"),
  route("/api/pcb/footprints/resolve", ["GET"], "parts.catalog-read", "read"),
  route("/api/pcb/footprints/search", ["GET"], "parts.catalog-read", "read"),
  route("/api/pcb/placement/preview", ["POST"], "placement.preview-api", "propose"),
  route("/api/pcb/qualify", ["POST"], "pcb.qualify-route", "mutate"),
  route("/api/pcb/release", ["POST"], "manufacturing.release", "destructive"),
  route("/api/pcb/repair/agent", ["POST"], "pcb.board-repair", "propose"),
  route("/api/physical-bindings", ["GET", "POST"], "pcb.physical-binding", "mutate"),
  route("/api/power/alternatives", ["POST"], "cd.power.workbench", "propose"),
  route("/api/power/candidates", ["POST"], "cd.power.workbench", "propose"),
  route("/api/power/compare", ["POST"], "cd.power.workbench", "propose"),
  route("/api/power/problem", ["POST"], "cd.power.workbench", "propose"),
  route("/api/power/propose", ["POST"], "cd.power.workbench", "propose"),
  route("/api/power/reconcile", ["POST"], "cd.power.workbench", "propose"),
  route("/api/release-engineering/problem", ["POST"], "cd.release-engineering.workbench", "propose"),
  route("/api/release-engineering/propose", ["POST"], "cd.release-engineering.workbench", "propose"),
  route("/api/requirements/capabilities", ["GET"], "cd.requirements.workbench", "read"),
  route("/api/requirements/compile", ["POST"], "cd.requirements.workbench", "propose"),
  route("/api/requirements/sources", ["POST"], "cd.requirements.workbench", "propose"),
  route("/api/schematic-compiler/compare", ["POST"], "cd.schematic-compiler.workbench", "propose"),
  route("/api/schematic-compiler/diff", ["POST"], "cd.schematic-compiler.workbench", "propose"),
  route("/api/schematic-compiler/export", ["POST"], "cd.schematic-compiler.workbench", "read"),
  route("/api/schematic-compiler/graph/validate", ["POST"], "cd.schematic-compiler.workbench", "propose"),
  route("/api/schematic-compiler/kicad/inspect", ["POST"], "cd.schematic-compiler.workbench", "read"),
  route("/api/schematic-compiler/layout", ["POST"], "cd.schematic-compiler.workbench", "propose"),
  route("/api/schematic-compiler/problem", ["POST"], "cd.schematic-compiler.workbench", "propose"),
  route("/api/schematic-compiler/propose", ["POST"], "cd.schematic-compiler.workbench", "propose"),
  route("/api/schematic-compiler/transaction", ["POST"], "cd.schematic-compiler.workbench", "mutate"),
  route("/api/schematic-compiler/variants", ["POST"], "cd.schematic-compiler.workbench", "propose"),
  route("/api/schematic/build-multi", ["POST"], "schematic.generate", "mutate"),
  route("/api/schematic/build", ["POST"], "schematic.generate", "mutate"),
  route("/api/schematic/cross-verify", ["POST"], "schematic.review-advisory", "read"),
  route("/api/schematic/edit-build", ["POST"], "schematic.edit-topology", "mutate"),
  route("/api/schematic/edit", ["POST"], "schematic.set-property", "mutate"),
  route("/api/schematic/layout-critic", ["POST"], "schematic.review-advisory", "read"),
  route("/api/schematic/review", ["POST"], "schematic.review-advisory", "read"),
  route("/api/schematic", ["POST"], "schematic.generate", "mutate"),
  route("/api/simulate", ["POST"], "spice.workbench", "read"),
  route("/api/spice/ai", ["POST"], "spice.workbench", "propose"),
  route("/api/spice/compile", ["POST"], "spice.workbench", "read"),
  route("/api/spice/models/import", ["POST"], "spice.workbench", "mutate"),
  route("/api/spice/models/smoke-test", ["POST"], "spice.workbench", "read"),
  route("/api/spice/reports", ["POST"], "spice.workbench", "read"),
  route("/api/spice/run-plans/estimate", ["POST"], "spice.workbench", "read"),
  route("/api/spice/runs/[id]/bundle", ["GET"], "spice.workbench", "read"),
  route("/api/spice/runs/[id]/events", ["GET"], "spice.workbench", "read"),
  route("/api/spice/runs/[id]", ["DELETE", "GET"], "spice.workbench", "destructive"),
  route("/api/spice/runs/[id]/waveforms", ["GET"], "spice.workbench", "read"),
  route("/api/spice/runs", ["GET", "POST"], "spice.workbench", "mutate"),
] satisfies readonly ApiRouteCoverageEntry[]);

export function validateActionCoverageRegistry(
  registry: readonly ActionCoverageRecord[] = ACTION_COVERAGE_REGISTRY,
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const record of registry) {
    if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(record.id)) {
      errors.push(`${record.id}: invalid stable action id`);
    }
    if (ids.has(record.id)) errors.push(`${record.id}: duplicate action id`);
    ids.add(record.id);
    if (record.sources.length === 0) errors.push(`${record.id}: no evidence source`);
    if (record.status === "missing" && record.domainCommand !== null) {
      errors.push(`${record.id}: missing action cannot claim a domain command`);
    }
    if (record.toolExposure !== "none" && record.status === "ui-only") {
      errors.push(`${record.id}: UI-only action cannot claim tool exposure`);
    }
    if (record.kind === "destructive" && record.approvalTier === "none") {
      errors.push(`${record.id}: destructive action requires approval`);
    }
  }
  // Route-coverage table integrity: every entry names an existing record,
  // paths are unique, and each entry declares at least one method.
  const recordIds = new Set(registry.map((record) => record.id));
  const paths = new Set<string>();
  for (const entry of API_ROUTE_COVERAGE) {
    if (!recordIds.has(entry.recordId)) errors.push(`${entry.path}: unknown record ${entry.recordId}`);
    if (paths.has(entry.path)) errors.push(`${entry.path}: duplicate route coverage entry`);
    paths.add(entry.path);
    if (entry.methods.length === 0) errors.push(`${entry.path}: no methods declared`);
  }
  return errors;
}

export function renderApiRouteCoverageCsv(
  coverage: readonly ApiRouteCoverageEntry[] = API_ROUTE_COVERAGE,
): string {
  const header = ["path", "methods", "record_id", "class"];
  const rows = [...coverage]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((entry) => [entry.path, [...entry.methods].sort().join(";"), entry.recordId, entry.class]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}

export function isCurrentAgentCallable(record: ActionCoverageRecord): boolean {
  return (
    record.toolExposure === "preview-apply" ||
    record.toolExposure === "repair-agent" ||
    record.toolExposure === "structured-route"
  );
}

const csvCell = (value: string | number | null): string => {
  const text = value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function renderActionToolabilityCsv(
  registry: readonly ActionCoverageRecord[] = ACTION_COVERAGE_REGISTRY,
): string {
  const header = [
    "id", "version", "area", "ui_or_api_action", "kind", "status", "handler",
    "domain_command", "mutation_authority", "validation", "history_or_revision",
    "tool_exposure", "approval_tier", "sources", "notes",
  ];
  const rows = registry.map((record) => [
    record.id, record.version, record.area, record.action, record.kind, record.status,
    record.handler, record.domainCommand, record.mutationAuthority, record.validation,
    record.historyOrRevision, record.toolExposure, record.approvalTier,
    record.sources.join(";"), record.notes ?? "",
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
