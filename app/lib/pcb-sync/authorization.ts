import { actorCapabilities } from "../engineering/authorization";
import type { PcbSyncApplyRequest, PcbSyncAuthorizationProvider, PcbSyncPlan, PcbSyncPreflightRequest } from "./types";

export class DefaultPcbSyncAuthorizationProvider implements PcbSyncAuthorizationProvider {
  async authorizePreflight(request: PcbSyncPreflightRequest): Promise<{ allowed: boolean; reasonCode: string }> {
    if (!actorCapabilities(request.actorContext, new Date(request.requestedAt)).has("read_project")) return { allowed: false, reasonCode: "PS_PREFLIGHT_AUTHORIZATION_DENIED" };
    if (request.mode === "prepare_apply" && !["pcb_editor", "project_admin"].includes(request.actorContext.role)) return { allowed: false, reasonCode: "PS_PLAN_PREPARATION_AUTHORIZATION_DENIED" };
    return { allowed: true, reasonCode: "PS_PREFLIGHT_AUTHORIZED" };
  }

  async authorizeApply(request: PcbSyncApplyRequest, plan: PcbSyncPlan): Promise<{ allowed: boolean; reasonCode: string }> {
    if (request.actorContext.actorKind !== "human" || !["pcb_editor", "project_admin"].includes(request.actorContext.role)) return { allowed: false, reasonCode: "PS_APPLY_AUTHORIZATION_DENIED" };
    if (plan.scope.tenantId !== request.tenantId || plan.scope.projectId !== request.projectId || plan.scope.branchId !== request.branchId || plan.scope.designId !== request.designId || plan.scope.boardId !== request.boardId) return { allowed: false, reasonCode: "PS_APPLY_SCOPE_MISMATCH" };
    return { allowed: true, reasonCode: "PS_APPLY_AUTHORIZED" };
  }
}

