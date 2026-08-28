import { PostgresPhysicalBindingRepository } from "@/app/lib/physical-binding/server-repository";
import { getDurableWorkflowRepository } from "@/app/lib/durable-workflow/runtime";
import { createProductionFootprintResolutionService, PRODUCTION_FOOTPRINT_RESOLVER_CAPABILITIES } from "@/app/lib/footprint-resolver/service";
import { AtomicPcbSyncResourceProvider } from "@/app/lib/pcb-sync/providers";
import { DurablePcbSyncRepository, DurablePcbSyncSnapshotStore } from "@/app/lib/pcb-sync/durable";
import { pcbSyncFeatureState } from "@/app/lib/pcb-sync/rollout";
import { PcbSynchronizationService } from "@/app/lib/pcb-sync/service";
import { PcbSyncTelemetry } from "@/app/lib/pcb-sync/observability";
import { PCB_SYNC_APPLY_REQUEST_VERSION, PCB_SYNC_APPLY_RESULT_VERSION, PCB_SYNC_BOARD_LOAD_RESULT_VERSION, PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION, PCB_SYNC_DEMO_PUBLICATION_RESULT_VERSION, PCB_SYNC_ENGINE_VERSION, PCB_SYNC_PLAN_VERSION, PCB_SYNC_REQUEST_VERSION, PCB_SYNC_RESULT_VERSION } from "@/app/lib/pcb-sync/types";
import { authenticatedRoute } from "@/app/lib/auth/route-handlers";
import { pcbSyncScopeFromContext } from "./_scope";
import { createPcbSyncBoardGetCore, createPcbSyncPostHandler } from "./handler";

export const runtime = "nodejs";

// The narrow demo operation validates and canonicalizes schematic input here;
// arbitrary authoritative snapshots and PCB board uploads remain forbidden.
const workflow = getDurableWorkflowRepository();
export const stage3SnapshotProvider = new DurablePcbSyncSnapshotStore(workflow);
export const stage3Repository = new DurablePcbSyncRepository(workflow);
export const stage3Telemetry = new PcbSyncTelemetry();
export const stage3FootprintResolver = createProductionFootprintResolutionService({ repository: new PostgresPhysicalBindingRepository() });
const service = new PcbSynchronizationService({ snapshotProvider: stage3SnapshotProvider, resolver: stage3FootprintResolver, resourceProvider: new AtomicPcbSyncResourceProvider(), repository: stage3Repository, telemetry: stage3Telemetry });
const boardGet = createPcbSyncBoardGetCore(stage3Repository, pcbSyncFeatureState);

// [B16.0.22] canonical wrapper — authorization inside the wrapper (all-members
// read, no CSRF per the exact policy row). The `boardId` dispatch and the
// board-load query travel ONLY through the bounded first-value-wins query
// projection into the Request-free core; without `boardId` the callback
// returns the static feature-gated capability document.
export const GET = authenticatedRoute({ query: true }, ({ context, meta }) => {
  const query = meta.query ?? {};
  if ("boardId" in query) return boardGet(pcbSyncScopeFromContext(context), query);
  const state = pcbSyncFeatureState();
  return Response.json({
    ok: true,
    state,
    authority: "durable_owner_repository_feature_gated",
    boardChanged: false,
    capabilities: { preview: state !== "off", prepareApply: state === "opt_in" || state === "authoritative_safe_profile", apply: state === "opt_in" || state === "authoritative_safe_profile", demoSnapshotPublication: state !== "off", authoritativeBoardLoad: true, demoAuthentication: "deferred_R02-B1-011", boardBackend: "sirkit_json_board", footprintResolver: PRODUCTION_FOOTPRINT_RESOLVER_CAPABILITIES, arbitraryKicadPcb: false, routedStructuralChanges: false, routing: false },
    versions: { request: PCB_SYNC_REQUEST_VERSION, result: PCB_SYNC_RESULT_VERSION, plan: PCB_SYNC_PLAN_VERSION, applyRequest: PCB_SYNC_APPLY_REQUEST_VERSION, applyResult: PCB_SYNC_APPLY_RESULT_VERSION, demoPublicationRequest: PCB_SYNC_DEMO_PUBLICATION_REQUEST_VERSION, demoPublicationResult: PCB_SYNC_DEMO_PUBLICATION_RESULT_VERSION, boardLoadResult: PCB_SYNC_BOARD_LOAD_RESULT_VERSION, engine: PCB_SYNC_ENGINE_VERSION },
  }, { headers: { "Cache-Control": "no-store", "X-Sirkit-Pcb-Sync-State": state } });
});

export const POST = createPcbSyncPostHandler(service, pcbSyncFeatureState, { snapshotPublisher: stage3SnapshotProvider, repository: stage3Repository });
