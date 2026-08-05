import { buildPassiveDependencySnapshot } from "./adapters";
import type { PassivePolicyContext, PassivePolicyContextProvider, PassivePolicyEvaluationRequest } from "./types";

function key(context: PassivePolicyContext): string { return `${context.component.scope.tenantId}\0${context.component.scope.projectId}\0${context.component.scope.branchId}\0${context.component.scope.assemblyVariantId}\0${context.component.scope.componentInstanceId}`; }
export class InMemoryPassivePolicyContextProvider implements PassivePolicyContextProvider {
  private readonly contexts = new Map<string, PassivePolicyContext>();
  constructor(contexts: PassivePolicyContext[] = []) { for (const context of contexts) this.set(context); }
  set(context: PassivePolicyContext): void { const next = structuredClone(context); next.dependencySnapshot = buildPassiveDependencySnapshot({ component: next.component, ...(next.policy ? { policy: next.policy } : {}), profiles: next.profiles, assemblyProfile: next.assemblyProfile }); this.contexts.set(key(next), next); }
  async getContext(request: PassivePolicyEvaluationRequest, signal?: AbortSignal): Promise<PassivePolicyContext> {
    if (signal?.aborted) throw new Error("PP_REQUEST_CANCELLED");
    const found = this.contexts.get(`${request.tenantId}\0${request.projectId}\0${request.branchId}\0${request.assemblyVariantId}\0${request.componentInstanceId}`); if (!found) throw new Error("PP_CONTEXT_NOT_FOUND");
    const context = structuredClone(found); context.request = structuredClone(request); return context;
  }
  async listProjectContexts(input: { tenantId: string; projectId: string; branchId: string; assemblyVariantId: string; policyRevisionId: string }, signal?: AbortSignal): Promise<PassivePolicyContext[]> {
    if (signal?.aborted) throw new Error("PP_REQUEST_CANCELLED");
    return [...this.contexts.values()].filter((context) => context.component.scope.tenantId === input.tenantId && context.component.scope.projectId === input.projectId && context.component.scope.branchId === input.branchId && context.component.scope.assemblyVariantId === input.assemblyVariantId).sort((a, b) => a.component.scope.componentInstanceId.localeCompare(b.component.scope.componentInstanceId)).map((item) => structuredClone(item));
  }
}
