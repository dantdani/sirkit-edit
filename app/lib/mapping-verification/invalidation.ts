import type { PcbSyncRepository } from "../pcb-sync/repository";
import { mappingDigest } from "./stable";
import type { MappingInvalidationTarget, MappingScope } from "./types";

export class ScopedMappingInvalidationTarget implements MappingInvalidationTarget {
  constructor(private readonly pcbSyncRepository?: PcbSyncRepository) {}
  async invalidate(input: { scope: MappingScope; oldCertificateId: string | null; newCertificateId: string; newMappingRevisionId: string; reason: string; occurredAt: string }): Promise<{ stage2DependencyKeys: string[]; stage3PlansStaled: number }> {
    const stage2DependencyKeys = [mappingDigest({ tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId, componentInstanceId: input.scope.componentInstanceId, assemblyVariantId: input.scope.assemblyVariantId, oldCertificateId: input.oldCertificateId })];
    const stage3PlansStaled = this.pcbSyncRepository ? await this.pcbSyncRepository.invalidatePlansByMapping({ tenantId: input.scope.tenantId, projectId: input.scope.projectId, branchId: input.scope.branchId, boardId: input.scope.boardInstanceId }, { componentInstanceId: input.scope.componentInstanceId, oldCertificateId: input.oldCertificateId, newCertificateId: input.newCertificateId, reason: input.reason, occurredAt: input.occurredAt }) : 0;
    return { stage2DependencyKeys, stage3PlansStaled };
  }
}
