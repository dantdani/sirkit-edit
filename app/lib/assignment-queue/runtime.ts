import { getDurableWorkflowRepository } from "../durable-workflow/runtime";
import { FootprintResolutionService } from "../footprint-resolver/service";
import { DurablePassivePolicyContextStore, DurablePassivePolicyInvalidationTarget, DurablePassivePolicyRepository } from "../passive-policy/durable";
import { PassivePolicyService } from "../passive-policy/service";
import { DurablePcbSyncRepository, DurablePcbSyncSnapshotStore } from "../pcb-sync/durable";
import { AtomicPcbSyncResourceProvider } from "../pcb-sync/providers";
import { PcbSynchronizationService } from "../pcb-sync/service";
import { PhysicalBindingService } from "../physical-binding/repository";
import { PostgresPhysicalBindingRepository } from "../physical-binding/server-repository";
import { AssignmentRevalidationCoordinator } from "./revalidation";
import { DurableAssignmentQueueRepository } from "./repository";
import { AssignmentQueueService } from "./service";

export interface AssignmentQueueRuntime { repository: DurableAssignmentQueueRepository; service: AssignmentQueueService; revalidation: AssignmentRevalidationCoordinator }
let runtime: AssignmentQueueRuntime | undefined;

/** Server-only singleton. API routes share one composition root without importing each other. */
export function getAssignmentQueueRuntime(): AssignmentQueueRuntime {
  if (runtime) return runtime;
  const workflow = getDurableWorkflowRepository();
  const pcbSync = new DurablePcbSyncRepository(workflow);
  const repository = new DurableAssignmentQueueRepository(workflow);
  const passiveRepository = new DurablePassivePolicyRepository(workflow);
  const passiveContexts = new DurablePassivePolicyContextStore(workflow);
  const physicalRepository = new PostgresPhysicalBindingRepository();
  const resolver = new FootprintResolutionService(physicalRepository);
  const passivePolicy = new PassivePolicyService({ repository: passiveRepository, contextProvider: passiveContexts, invalidation: new DurablePassivePolicyInvalidationTarget(pcbSync), effectMode: "outbox" });
  const service = new AssignmentQueueService({ repository, physicalBindings: new PhysicalBindingService(physicalRepository), passivePolicy });
  const pcbService = new PcbSynchronizationService({ snapshotProvider: new DurablePcbSyncSnapshotStore(workflow), resolver, resourceProvider: new AtomicPcbSyncResourceProvider(), repository: pcbSync });
  runtime = { repository, service, revalidation: new AssignmentRevalidationCoordinator({ queueRepository: repository, queueService: service, physicalBindings: physicalRepository, resolver, pcbSync: pcbService, passivePolicy, passiveRepository }) };
  return runtime;
}
