import type { PcbSyncRepository, PcbSyncRepositoryScope } from "../pcb-sync/repository";
import { passivePolicyDigest } from "./stable";
import type { PassivePolicyInvalidationTarget } from "./types";

export class ScopedPassivePolicyInvalidationTarget implements PassivePolicyInvalidationTarget {
  constructor(private readonly pcbRepository?: PcbSyncRepository, private readonly boardScopes: PcbSyncRepositoryScope[] = []) {}
  async invalidate(input: { tenantId: string; projectId: string; branchId: string; assemblyVariantIds: string[]; affectedComponentIds: string[]; fromPolicyRevisionId: string | null; toPolicyRevisionId: string; reason: string; occurredAt: string }): Promise<{ stage2DependencyKeys: string[]; stage3PlansStaled: number }> {
    const affectedComponentIds = [...new Set(input.affectedComponentIds)].sort(), assemblyVariantIds = [...new Set(input.assemblyVariantIds)].sort();
    const stage2DependencyKeys = affectedComponentIds.map((componentInstanceId) => passivePolicyDigest({ tenantId: input.tenantId, projectId: input.projectId, branchId: input.branchId, assemblyVariantIds, componentInstanceId, policyRevisionId: input.toPolicyRevisionId }));
    let stage3PlansStaled = 0;
    const scopes = [...new Map(this.boardScopes.filter((scope) => scope.tenantId === input.tenantId && scope.projectId === input.projectId && scope.branchId === input.branchId).map((scope) => [`${scope.tenantId}\0${scope.projectId}\0${scope.branchId}\0${scope.boardId}`, scope])).values()];
    if (this.pcbRepository) for (const scope of scopes) stage3PlansStaled += await this.pcbRepository.invalidatePlansByPassivePolicy(scope, { componentInstanceIds: affectedComponentIds, fromPolicyRevisionId: input.fromPolicyRevisionId, toPolicyRevisionId: input.toPolicyRevisionId, reason: input.reason, occurredAt: input.occurredAt });
    return { stage2DependencyKeys: stage2DependencyKeys.sort(), stage3PlansStaled };
  }
}
