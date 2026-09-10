import { commitPcbCandidate } from "@/app/lib/engineering/pcb-commit-gateway";
import type { LayerId } from "../layers";
import type { PcbBoard } from "../types";
import type { PcbHistory } from "../history";
import type { DrcRules } from "../drc/types";
import { runDrc } from "../drc/run-drc";
import { buildAIPcbSnapshot, pcbRevisionId, type AIPcbSnapshot, type AIPcbSnapshotOptions } from "./snapshot";
import { normalizeDrcReport } from "./violation-normalizer";
import { getBoardStackup } from "../stackup";
import { analyzePlacementRouteability } from "../autoplace/routeability";
import type { AutoPlaceParams } from "../autoplace/types";
import { runEngineeringPlacement } from "../placement/engine";
import { runPlacementCandidate, type LayoutCandidateStore, type PlacementLayoutCandidate } from "../candidates/layout-candidate";
import type { PlacementCandidate as EngineeringPlacementCandidate, PlacementRunResult } from "../placement/types";
import { planDrcRepairs } from "../repair/planner";
import {
  applyRepairTransaction,
  automaticallySelectedFixes,
  previewRepairTransaction,
  undoRepairTransaction,
  refillZonesForRepair,
} from "../repair/transaction";
import type {
  AutorouteRepairExecutor,
  PCBRepairPlan,
  RepairAction,
  RepairExecutionMode,
  RepairTransactionPreview,
} from "../repair/types";
import { getNetClass } from "../netclass";
import { buildDrcContext } from "../drc/run-drc";
import { computeElectricalTruth } from "../electrical-truth";
import type { PcbNetlist } from "../netlist-bridge";
import { zoneFillIsCurrent } from "../zones/fill-lifecycle";
import { ProfessionalRoutingService } from "../routing/service";
import type { ProfessionalRouteMode, RoutePosture } from "../routing/types";
import { evaluateAutonomousCapability } from "../autonomous/capability-profile";
import type { AutonomousDesignDeclaration } from "../autonomous/capability-profile";
import { qualifyAutonomousLayout as runAutonomousLayoutQualification } from "../autonomous/qualify-layout";
import type { AutonomousLayoutQualificationResult, AutonomousRouteExecutor } from "../autonomous/qualify-layout";

export interface PCBViewAdapter {
  setActiveLayer?(layerId: LayerId): void;
  setLayerVisibility?(layerId: LayerId, visible: boolean): void;
  isolateLayer?(layerId: LayerId): void;
  showAllCopperLayers?(): void;
  highlightObjects?(objectIds: string[]): void;
  highlightNet?(netId: number): void;
  focusLocation?(pointMm: { x: number; y: number }, zoom?: number): void;
}

export interface BoardInspection {
  snapshot: AIPcbSnapshot;
}

export interface ChangePreview {
  preview: RepairTransactionPreview;
}

export interface TransactionResult {
  ok: boolean;
  transactionId?: string;
  error?: string;
}

export interface PCBToolServiceContract {
  inspectBoard(options?: AIPcbSnapshotOptions): Promise<BoardInspection>;
  runDrc(): Promise<ReturnType<typeof runDrc>>;
  getViolation(id: string): Promise<ReturnType<typeof normalizeDrcReport>[number] | undefined>;
  explainConstraint(args: { netId: number }): Promise<unknown>;
  previewChanges(args: { planId: string; fixIds?: string[] }): Promise<ChangePreview>;
  applyTransaction(args: { previewId: string; approvedFixIds?: string[] }): Promise<TransactionResult>;
  undoTransaction(args: { transactionId: string }): Promise<TransactionResult>;
  evaluateAutonomousCapability(): Promise<ReturnType<typeof evaluateAutonomousCapability>>;
  qualifyAutonomousLayout(args?: { seeds?: number[]; placementCandidateCount?: number; routedCandidateLimit?: number; maxRuntimeMs?: number }): Promise<AutonomousLayoutQualificationResult>;
}

interface PlacementCandidate {
  id: string;
  baseRevisionId: string;
  run: PlacementRunResult;
  candidate: EngineeringPlacementCandidate;
  layoutCandidate: PlacementLayoutCandidate;
}

export interface PCBToolServiceOptions {
  history: PcbHistory;
  rules: DrcRules;
  projectId?: string;
  schematicRevisionId?: string;
  netlist?: PcbNetlist;
  schematicConnectivity?: unknown;
  autoroute?: AutorouteRepairExecutor;
  autonomousDeclaration?: AutonomousDesignDeclaration;
  autonomousRouter?: AutonomousRouteExecutor;
  view?: PCBViewAdapter;
  /** [B17-E] the editor's shared layout-candidate store and lifecycle generation (agent candidates land where the human reviews them). */
  candidates?: LayoutCandidateStore;
  generation?: () => number | undefined;
}

export class PCBToolService implements PCBToolServiceContract {
  private readonly plans = new Map<string, PCBRepairPlan>();
  private readonly previews = new Map<string, RepairTransactionPreview>();
  private readonly placementCandidates = new Map<string, PlacementCandidate>();

  constructor(private readonly options: PCBToolServiceOptions) {}

  private get board(): PcbBoard {
    return this.options.history.present;
  }

  async inspectBoard(options: AIPcbSnapshotOptions = {}): Promise<BoardInspection> {
    return {
      snapshot: buildAIPcbSnapshot(this.board, {
        projectId: this.options.projectId,
        schematicRevisionId: this.options.schematicRevisionId,
        netlist: this.options.netlist,
        rules: this.options.rules,
        events: this.options.history.events,
        ...options,
      }),
    };
  }

  async runDrc(): Promise<ReturnType<typeof runDrc>> {
    return runDrc(this.board, this.options.rules);
  }

  async evaluateAutonomousCapability(): Promise<ReturnType<typeof evaluateAutonomousCapability>> {
    return evaluateAutonomousCapability({ board: this.board, rules: this.options.rules, declaration: this.options.autonomousDeclaration, phase: "pre_placement" });
  }

  async qualifyAutonomousLayout(args: { seeds?: number[]; placementCandidateCount?: number; routedCandidateLimit?: number; maxRuntimeMs?: number } = {}): Promise<AutonomousLayoutQualificationResult> {
    if (!this.options.autonomousRouter) throw new Error("Autonomous layout requires the RC02 router executor.");
    const sourceBoard = this.board;
    return runAutonomousLayoutQualification({
      board: sourceBoard,
      rules: this.options.rules,
      declaration: this.options.autonomousDeclaration,
      router: this.options.autonomousRouter,
      projectId: this.options.projectId,
      ...args,
      commitSelected: async ({ board, expectedSourceRevision, selectedRevision, runId }) => {
        if (pcbRevisionId(this.board) !== expectedSourceRevision) return { ok: false, error: "Authoritative board changed before autonomous layout commit." };
        // B08 — the verified candidate applies as ONE canonical transaction
        // (delta-compiled); the source-revision pin is re-verified at
        // serialized execution time, never a raw whole-board history write.
        const commit = await commitPcbCandidate(this.options.history, {
          commandId: "pcb.autonomous-layout",
          label: "Autonomous placement and routing",
          idempotencyKey: `autonomous-layout:${runId}`,
          metadata: { actor: "system", operationType: "autonomous_layout", transactionId: runId, reason: "Selected only after capability, placement, RC02 connectivity, and DRC verification." },
          buildCandidate: (current) => {
            if (pcbRevisionId(current) !== expectedSourceRevision) throw new Error("Authoritative board changed before autonomous layout commit.");
            return structuredClone(board);
          },
        });
        if (!commit.ok) return { ok: false, error: commit.message };
        const committedRevision = pcbRevisionId(this.board);
        return committedRevision === selectedRevision ? { ok: true, committedRevision } : { ok: false, committedRevision, error: "Committed board revision differs from the selected verified candidate." };
      },
    });
  }

  async getViolation(id: string): Promise<ReturnType<typeof normalizeDrcReport>[number] | undefined> {
    const report = await this.runDrc();
    return normalizeDrcReport(this.board, report).find((violation) => violation.id === id);
  }

  async explainConstraint({ netId }: { netId: number }): Promise<unknown> {
    const net = this.board.nets.find((candidate) => candidate.id === netId);
    if (!net) throw new Error(`No net ${netId} on this board.`);
    const netClass = getNetClass(this.board, netId);
    const resolved = buildDrcContext(this.board, this.options.rules).eff(netId);
    return {
      netId,
      netName: net.name || `net${netId}`,
      classId: netClass.id,
      source: netClass.explanation || "Manufacturer preset plus board net class",
      preferred: {
        trackWidthMm: netClass.trackWidth / 1_000_000,
        clearanceMm: netClass.clearance / 1_000_000,
        viaDiameterMm: netClass.viaSize / 1_000_000,
        viaDrillMm: netClass.viaDrill / 1_000_000,
      },
      hardMinimums: Object.fromEntries(Object.entries(resolved).map(([key, value]) => [key, value / 1_000_000])),
      ruleWeakeningAllowed: false,
    };
  }

  async planRepairs(mode: RepairExecutionMode = "safe_fixes_automatically"): Promise<PCBRepairPlan> {
    if (this.board.zones.some((zone) => !zoneFillIsCurrent(this.board, zone))) {
      const filled = refillZonesForRepair(this.board);
      this.options.history.applyDerived("AI repair: refill zones", (draft) => {
        for (const zone of draft.zones) {
          const source = filled.zones.find((candidate) => candidate.id === zone.id);
          if (!source) continue;
          zone.fill = source.fill;
          zone.fillState = source.fillState;
          zone.dirty = source.dirty;
        }
      });
    }
    const plan = planDrcRepairs(this.board, await this.runDrc(), this.options.rules, mode);
    this.plans.set(plan.id, plan);
    return plan;
  }

  registerPlan(plan: PCBRepairPlan): void {
    if (plan.baseRevisionId !== pcbRevisionId(this.board)) throw new Error("Repair plan does not match the current board revision.");
    this.plans.set(plan.id, plan);
  }

  async repairUntilBlocked(maxIterations = 3): Promise<unknown> {
    const iterations: Array<{ planId: string; previewId?: string; metrics?: RepairTransactionPreview["metrics"]; outcome: string }> = [];
    const limit = Math.max(1, Math.min(8, Math.round(maxIterations)));
    for (let index = 0; index < limit; index++) {
      const plan = await this.planRepairs("safe_fixes_automatically");
      const selected = automaticallySelectedFixes(plan);
      if (selected.length === 0) {
        iterations.push({ planId: plan.id, outcome: "blocked: no safe automatic fixes remain" });
        break;
      }
      const { preview } = await this.previewChanges({ planId: plan.id, fixIds: selected.map((fix) => fix.id) });
      if (preview.blockers.length > 0) {
        iterations.push({ planId: plan.id, previewId: preview.id, metrics: preview.metrics, outcome: `blocked: ${preview.blockers[0]}` });
        break;
      }
      const applied = await this.applyTransaction({ previewId: preview.id, approvedFixIds: [] });
      iterations.push({ planId: plan.id, previewId: preview.id, metrics: preview.metrics, outcome: applied.ok ? "committed" : `blocked: ${applied.error}` });
      if (!applied.ok) break;
      const after = await this.runDrc();
      if (after.summary.errors === 0 && after.summary.unroutedConnections === 0) break;
    }
    const finalDrc = await this.runDrc();
    return {
      status: finalDrc.summary.errors === 0 && finalDrc.summary.unroutedConnections === 0 ? "drc_clean" : "drc_blocked",
      iterations,
      finalDrcSummary: finalDrc.summary,
      fabricationReadiness: (await this.inspectBoard()).snapshot.readiness,
    };
  }

  async previewChanges({ planId, fixIds }: { planId: string; fixIds?: string[] }): Promise<ChangePreview> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Unknown repair plan ${planId}.`);
    const selected = fixIds ?? automaticallySelectedFixes(plan).map((fix) => fix.id);
    const preview = await previewRepairTransaction(this.board, plan, selected, this.options.autoroute);
    this.previews.set(preview.id, preview);
    return { preview };
  }

  private async previewDirectAction(args: {
    title: string;
    action: RepairAction;
    netIds?: number[];
    objectIds?: string[];
    requiresApproval?: boolean;
  }): Promise<ChangePreview> {
    const drcBefore = await this.runDrc();
    const revision = pcbRevisionId(this.board);
    const suffix = `${args.action.kind}:${(args.netIds ?? []).join(",")}:${(args.objectIds ?? []).join(",")}`;
    const fixId = `direct-fix:${revision}:${suffix}`;
    const plan: PCBRepairPlan = {
      id: `direct-plan:${revision}:${suffix}`,
      baseRevisionId: revision,
      mode: "review_every_change",
      createdAt: new Date().toISOString(),
      violations: normalizeDrcReport(this.board, drcBefore),
      groups: [{
        id: `direct-group:${revision}:${suffix}`,
        title: args.title,
        rootCause: args.action.kind,
        violationIds: drcBefore.violations.map((violation) => violation.id),
        fixIds: [fixId],
        requiresApproval: args.requiresApproval ?? false,
      }],
      fixes: [{
        id: fixId,
        title: args.title,
        reason: "Requested through the provider-neutral PCB tool service; candidate must pass native connectivity and DRC verification.",
        fixability: args.action.kind === "reroute_nets" ? "auto_with_reroute" : "safe_auto",
        requiresApproval: args.requiresApproval ?? false,
        sourceViolationIds: drcBefore.violations.map((violation) => violation.id),
        affectedObjectIds: args.objectIds ?? [],
        affectedNetIds: args.netIds ?? [],
        action: args.action,
      }],
      rules: this.options.rules,
      drcBefore,
    };
    this.plans.set(plan.id, plan);
    return this.previewChanges({ planId: plan.id, fixIds: [fixId] });
  }

  async previewReroute(netIds?: number[]): Promise<ChangePreview> {
    const targets = netIds?.length
      ? [...new Set(netIds)]
      : computeElectricalTruth(this.board).nets.filter((net) => net.remainingConnections > 0).map((net) => net.netId);
    if (targets.length === 0) throw new Error("No incomplete or selected nets require rerouting.");
    for (const netId of targets) if (!this.board.nets.some((net) => net.id === netId && netId !== 0)) throw new Error(`No routable net ${netId} on this board.`);
    return this.previewDirectAction({
      title: `Reroute ${targets.length} selected net${targets.length === 1 ? "" : "s"}`,
      action: { kind: "reroute_nets", netIds: targets },
      netIds: targets,
      objectIds: [
        ...this.board.tracks.filter((track) => targets.includes(track.netId)).map((track) => `track:${track.id}`),
        ...this.board.vias.filter((via) => targets.includes(via.netId)).map((via) => `via:${via.id}`),
      ],
    });
  }

  async applyTransaction({ previewId, approvedFixIds = [] }: { previewId: string; approvedFixIds?: string[] }): Promise<TransactionResult> {
    const preview = this.previews.get(previewId);
    if (!preview) return { ok: false, error: `Unknown repair preview ${previewId}.` };
    const plan = this.plans.get(preview.planId);
    if (!plan) return { ok: false, error: `Repair plan ${preview.planId} is no longer available.` };
    const result = await applyRepairTransaction(this.options.history, plan, preview, approvedFixIds);
    return result.ok ? { ok: true, transactionId: preview.id } : result;
  }

  async undoTransaction({ transactionId }: { transactionId: string }): Promise<TransactionResult> {
    const result = undoRepairTransaction(this.options.history, transactionId);
    return result.ok ? { ok: true, transactionId } : result;
  }

  async analyzePlacement(options: { envelopeScale?: number } = {}): Promise<unknown> {
    const run = runEngineeringPlacement({ board: this.board, options: { projectId: this.options.projectId ?? "ai-placement", candidateCount: 2, localRefinementPasses: 0 } });
    const candidate = run.candidates.find((item) => item.candidateId === run.selectedCandidateId) ?? run.candidates[0];
    return {
      problemHash: run.problem.problemHash,
      constraintProgramHash: run.problem.constraintProgramHash,
      termination: run.termination,
      hardReport: candidate?.hardReport,
      congestion: candidate?.congestion,
      pinEscape: candidate?.pinEscape,
      viaPressure: candidate?.viaPressure,
      objectives: candidate?.objectiveReport,
      legacyComparison: analyzePlacementRouteability(this.board, options),
      proxyWarning: "Placement capacity/access metrics are estimates, not routed, SI/PI, thermal, or manufacturing proof.",
    };
  }

  async previewPlacement(options: AutoPlaceParams = {}, footprintIds?: string[]): Promise<PlacementCandidate> {
    // [B17-E] the SAME producer and options builder the editor and the preview route use; the resulting shared
    // candidate lands in the editor's store, where the human reviews, previews and applies it like their own.
    const { run, candidate: layoutCandidate } = runPlacementCandidate({
      board: this.board,
      request: {
        producer: "agent",
        projectId: this.options.projectId ?? "ai-placement",
        instanceIds: footprintIds?.length ? footprintIds : undefined,
        seeds: options.seed === undefined ? undefined : [options.seed],
        candidateCount: options.candidateCount,
        maxIterations: options.maxIterations,
        gridNm: options.gridNm,
      },
      generation: this.options.generation?.(),
    });
    const selected = run.candidates.find((item) => item.candidateId === run.selectedCandidateId);
    if (!selected || !layoutCandidate) throw new Error(`No legal placement candidate: ${run.termination}.`);
    const id = layoutCandidate.candidateId;
    const candidate = { id, baseRevisionId: pcbRevisionId(this.board), run, candidate: selected, layoutCandidate };
    this.placementCandidates.set(id, candidate);
    this.options.candidates?.register(layoutCandidate);
    return candidate;
  }

  async applyPlacement(candidateId: string): Promise<TransactionResult> {
    const candidate = this.placementCandidates.get(candidateId);
    if (!candidate) return { ok: false, error: `Unknown placement candidate ${candidateId}.` };
    if (candidate.baseRevisionId !== pcbRevisionId(this.board)) return { ok: false, error: "Board changed after placement preview." };
    // [B17-E] the candidate is in the editor's store under the same id: the human applies it from the placement panel (B18 activates agent execution).
    return { ok: false, error: `AI placement tools are preview/compare/explain only. Candidate ${candidateId} is in the editor's placement panel; apply requires explicit user approval there.` };
  }

  async call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    switch (name) {
      case "get_board_summary":
      case "get_board_snapshot":
        return (await this.inspectBoard()).snapshot;
      case "get_footprint": {
        const snapshot = (await this.inspectBoard()).snapshot;
        return (snapshot.footprints as Array<{ id: string }>).find((item) => item.id === String(args.footprintId ?? ""));
      }
      case "get_net": {
        const snapshot = (await this.inspectBoard()).snapshot;
        return (snapshot.nets as Array<{ id: string }>).find((item) => item.id === String(args.netId ?? ""));
      }
      case "get_track": {
        const snapshot = (await this.inspectBoard()).snapshot;
        return (snapshot.tracks as Array<{ id: string }>).find((item) => item.id === String(args.trackId ?? ""));
      }
      case "get_via": {
        const snapshot = (await this.inspectBoard()).snapshot;
        return (snapshot.vias as Array<{ id: string }>).find((item) => item.id === String(args.viaId ?? ""));
      }
      case "get_zone": {
        const snapshot = (await this.inspectBoard()).snapshot;
        return (snapshot.zones as Array<{ id: string }>).find((item) => item.id === String(args.zoneId ?? ""));
      }
      case "get_rule":
      case "get_manufacturer_profile":
        return { immutableDuringRepair: true, ruleWeakeningAllowed: false, rules: this.options.rules };
      case "get_schematic_connectivity":
        return this.options.schematicConnectivity ?? { status: "unavailable" };
      case "run_drc":
        return this.runDrc();
      case "get_violation":
        return this.getViolation(String(args.violationId ?? ""));
      case "explain_constraint":
      case "get_resolved_constraints":
        return this.explainConstraint({ netId: Number(args.netId) });
      case "get_stackup":
        return getBoardStackup(this.board);
      case "get_layer_usage":
        return (await this.inspectBoard()).snapshot.layerUsage;
      case "get_layer_state":
        return ((await this.inspectBoard()).snapshot.layerUsage as Array<{ layerId: string }>).find((layer) => layer.layerId === args.layerId);
      case "get_unrouted_connections":
      case "verify_connectivity":
        return (await this.inspectBoard()).snapshot.connectivity;
      case "get_congestion_map":
      case "get_pad_access_report":
      case "analyze_placement":
      case "analyze_routeability":
        return this.analyzePlacement({ envelopeScale: typeof args.envelopeScale === "number" ? args.envelopeScale : undefined });
      case "get_change_history":
        return this.options.history.events;
      case "evaluate_autonomous_capability":
        return this.evaluateAutonomousCapability();
      case "qualify_autonomous_layout":
        return this.qualifyAutonomousLayout({
          ...(Array.isArray(args.seeds) ? { seeds: args.seeds.map(Number) } : {}),
          ...(typeof args.placementCandidateCount === "number" ? { placementCandidateCount: args.placementCandidateCount } : {}),
          ...(typeof args.routedCandidateLimit === "number" ? { routedCandidateLimit: args.routedCandidateLimit } : {}),
          ...(typeof args.maxRuntimeMs === "number" ? { maxRuntimeMs: args.maxRuntimeMs } : {}),
        });
      case "get_routing_snapshot":
        return new ProfessionalRoutingService(() => this.board).snapshot();
      case "get_route_anchors":
        return new ProfessionalRoutingService(() => this.board).anchors({
          ...(typeof args.objectId === "string" ? { objectId: args.objectId } : {}),
          ...(typeof args.netId === "number" ? { netId: args.netId } : {}),
        });
      case "get_via_transition_choices":
        return new ProfessionalRoutingService(() => this.board).viaTransitions({ netId: Number(args.netId), fromLayer: args.fromLayer as LayerId });
      case "preview_route_connection":
        return new ProfessionalRoutingService(() => this.board).previewConnection({
          startAnchorId: String(args.startAnchorId ?? ""),
          endAnchorId: String(args.endAnchorId ?? ""),
          ...(typeof args.mode === "string" ? { mode: args.mode as ProfessionalRouteMode } : {}),
          ...(typeof args.posture === "string" ? { posture: args.posture as RoutePosture } : {}),
          ...(typeof args.preferredLayer === "string" ? { preferredLayer: args.preferredLayer as LayerId } : {}),
          actorId: "pcb-ai",
          actorKind: "ai",
        });
      case "measure_route_path":
        return new ProfessionalRoutingService(() => this.board).measure({ netId: Number(args.netId), endpointNodeA: String(args.endpointNodeA ?? ""), endpointNodeB: String(args.endpointNodeB ?? "") });
      case "preview_placement":
      case "auto_place_footprints":
        return this.previewPlacement({ envelopeScale: typeof args.envelopeScale === "number" ? args.envelopeScale : 1.15 });
      case "optimize_local_placement":
        return this.previewPlacement(
          { envelopeScale: typeof args.envelopeScale === "number" ? args.envelopeScale : 1.15, allowBoardResize: false },
          Array.isArray(args.footprintIds) ? args.footprintIds.map(String) : undefined,
        );
      case "apply_placement":
        return this.applyPlacement(String(args.candidateId ?? ""));
      case "classify_drc_violations":
        return normalizeDrcReport(this.board, await this.runDrc());
      case "plan_drc_repairs":
        return this.planRepairs((args.mode as RepairExecutionMode | undefined) ?? "safe_fixes_automatically");
      case "preview_drc_repairs":
        return this.previewChanges({ planId: String(args.planId ?? ""), fixIds: Array.isArray(args.fixIds) ? args.fixIds.map(String) : undefined });
      case "apply_drc_repairs":
        return this.applyTransaction({ previewId: String(args.previewId ?? ""), approvedFixIds: Array.isArray(args.approvedFixIds) ? args.approvedFixIds.map(String) : [] });
      case "repair_until_blocked":
        return this.repairUntilBlocked(typeof args.maxIterations === "number" ? args.maxIterations : 3);
      case "run_autorouter":
      case "reroute_nets":
        return this.previewReroute(Array.isArray(args.netIds) ? args.netIds.map(Number) : undefined);
      case "ripup_nets": {
        const netIds = Array.isArray(args.netIds) ? args.netIds.map(Number) : [];
        const refs = [
          ...this.board.tracks.filter((track) => netIds.includes(track.netId) && track.locked !== true && (track.source === "ai" || track.source === "autorouter")).map((track) => ({ kind: "track" as const, id: track.id })),
          ...this.board.vias.filter((via) => netIds.includes(via.netId) && via.locked !== true && (via.source === "ai" || via.source === "autorouter")).map((via) => ({ kind: "via" as const, id: via.id })),
        ];
        if (refs.length === 0) throw new Error("No generated, unlocked copper exists on the selected nets.");
        return this.previewDirectAction({
          title: "Rip up generated copper on selected nets",
          action: { kind: "edit", command: { op: "delete-items", refs } },
          netIds,
          objectIds: refs.map((ref) => `${ref.kind}:${ref.id}`),
        });
      }
      case "refill_zones": {
        const requested = Array.isArray(args.zoneIds) ? args.zoneIds.map(String) : this.board.zones.map((zone) => zone.id);
        const zoneIds = requested.filter((id) => this.board.zones.some((zone) => zone.id === id));
        if (zoneIds.length === 0) throw new Error("No matching copper zones were found.");
        return this.previewDirectAction({
          title: `Refill ${zoneIds.length} copper zone${zoneIds.length === 1 ? "" : "s"}`,
          action: { kind: "refill_zones", zoneIds },
          objectIds: zoneIds.map((id) => `zone:${id}`),
        });
      }
      case "verify_repair_transaction": {
        const preview = this.previews.get(String(args.transactionId ?? ""));
        return preview ? { status: preview.status, metrics: preview.metrics, drc: preview.drcAfter } : { status: "unknown" };
      }
      case "undo_transaction":
        return this.undoTransaction({ transactionId: String(args.transactionId ?? "") });
      case "set_active_layer":
        this.options.view?.setActiveLayer?.(args.layerId as LayerId);
        return { ok: true };
      case "set_layer_visibility":
        this.options.view?.setLayerVisibility?.(args.layerId as LayerId, Boolean(args.visible));
        return { ok: true };
      case "isolate_layer":
        this.options.view?.isolateLayer?.(args.layerId as LayerId);
        return { ok: true };
      case "show_all_copper_layers":
        this.options.view?.showAllCopperLayers?.();
        return { ok: true };
      case "highlight_objects":
        this.options.view?.highlightObjects?.(Array.isArray(args.objectIds) ? args.objectIds.map(String) : []);
        return { ok: true };
      case "highlight_net":
        this.options.view?.highlightNet?.(Number(args.netId));
        return { ok: true };
      case "focus_location":
        this.options.view?.focusLocation?.(args.point as { x: number; y: number }, typeof args.zoom === "number" ? args.zoom : undefined);
        return { ok: true };
      default:
        throw new Error(`Unsupported PCB tool ${name}.`);
    }
  }
}
