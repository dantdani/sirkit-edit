import { PostgresPhysicalBindingRepository } from "@/app/lib/physical-binding/server-repository";
import { DurableBoardLineageStore } from "@/app/lib/pcb-sync/board-lineage";
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
import { createManufacturingSummaryReader } from "./manufacturing-summary"; import { createProviderExchangeLedger } from "@/app/lib/manufacturing-providers/exchange-ledger"; import { createProviderObservationReader } from "@/app/lib/manufacturing-providers/provider-observation"; // [B23-B3] appended in place: the observation reader over B2's exchange record (read only)

export const runtime = "nodejs";

// The narrow demo operation validates and canonicalizes schematic input here;
// arbitrary authoritative snapshots and PCB board uploads remain forbidden.
const workflow = getDurableWorkflowRepository();
export const stage3SnapshotProvider = new DurablePcbSyncSnapshotStore(workflow);
export const stage3Repository = new DurablePcbSyncRepository(workflow);
export const stage3Telemetry = new PcbSyncTelemetry();
/** [B16.1C §D] the ONE server-owned physical-binding source shared by footprint
 *  resolution AND manufacturing qualification, so the package/footprint/pin
 *  authority a qualification reads is exactly what synchronization committed. */
export const stage3BindingRepository = new PostgresPhysicalBindingRepository();
export const stage3FootprintResolver = createProductionFootprintResolutionService({ repository: stage3BindingRepository });
const service = new PcbSynchronizationService({ snapshotProvider: stage3SnapshotProvider, resolver: stage3FootprintResolver, resourceProvider: new AtomicPcbSyncResourceProvider(), repository: stage3Repository, lineage: { workflow }, telemetry: stage3Telemetry });
// [B16.1C §C] reload-time manufacturing truth (qualification authority head +
// latest ledgered release) over the SAME durable workflow repository, so what a
// browser reconstructs after refresh is exactly what the server committed.
const boardGet = createPcbSyncBoardGetCore(stage3Repository, pcbSyncFeatureState, createManufacturingSummaryReader(workflow, { observations: createProviderObservationReader({ exchanges: createProviderExchangeLedger(workflow) }) }), new DurableBoardLineageStore(workflow)); // [B23-B3] + the provider observations (OD-168, OD-169): B2's record read through `load` only, judged at each read; no provider call

// [B16.0.22] canonical wrapper — authorization inside the wrapper (all-members
// read, no CSRF per the exact policy row). The `boardId` dispatch and the
// board-load query travel ONLY through the bounded first-value-wins query
// projection into the Request-free core; without `boardId` the callback
// returns the static feature-gated capability document.
export const GET = authenticatedRoute({ query: true }, ({ context, meta }) => {
  const query = meta.query ?? {};
  // [B16-A F14] the trusted context's SERVER-DERIVED role and actor kind reach
  // the manufacturing summary so a browser can show release capability
  // truthfully; the release route remains the only enforcement point.
  if ("boardId" in query) return boardGet(pcbSyncScopeFromContext(context), query, { role: context.actor.role, actorKind: context.actor.actorKind });
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
