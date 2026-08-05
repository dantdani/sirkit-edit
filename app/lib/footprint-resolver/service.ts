import { performance } from "node:perf_hooks";
import { actorCapabilities } from "../engineering/authorization";
import type { PassivePolicyContextProvider } from "../passive-policy/types";
import type { PhysicalBindingRepository } from "../physical-binding/repository";
import { nativeComponentIdentity } from "../physical-binding/identity";
import { deepFreezeBinding } from "../physical-binding/stable";
import { collectCandidateSources, DEFAULT_FOOTPRINT_CANDIDATE_SOURCES, productionFootprintCandidateSources, PRODUCTION_FOOTPRINT_SOURCE_COMPOSITION_VERSION } from "./adapters";
import { DeterministicFootprintResolutionEngine, assertContextDigest } from "./engine";
import { resolveFootprintPolicy, validateResolutionPolicy } from "./policy";
import { contextTechnicalDigest, resolverDigest } from "./stable";
import { FootprintResolverTelemetry } from "./observability";
import {
  FOOTPRINT_RESOLUTION_CONTEXT_VERSION,
  type CandidateCollectionContext,
  type FootprintCandidateSource,
  type FootprintResolutionBatchRequest,
  type FootprintResolutionBatchResult,
  type FootprintResolutionRequest,
  type FootprintResolutionResult,
  type FootprintResolutionStatus,
  type ImmutableResolutionContext,
} from "./types";
import { validateResolutionRequest } from "./validation";
import { ASSEMBLY_VARIANT_SCOPE_CONTRACT_VERSION, normalizeAssemblyVariantScope } from "./variant-scope";

export interface FootprintResolutionAuthorizer {
  authorize(request: FootprintResolutionRequest): Promise<{ allowed: boolean; reasonCode: string }>;
}

export class RoleBasedFootprintResolutionAuthorizer implements FootprintResolutionAuthorizer {
  async authorize(request: FootprintResolutionRequest): Promise<{ allowed: boolean; reasonCode: string }> {
    return actorCapabilities(request.actorContext).has("read_project") ? { allowed: true, reasonCode: "FR_AUTHORIZED" } : { allowed: false, reasonCode: "FR_AUTHORIZATION_DENIED" };
  }
}

export interface FootprintResolutionServiceOptions {
  repository: PhysicalBindingRepository;
  sources?: readonly FootprintCandidateSource[];
  authorizer?: FootprintResolutionAuthorizer;
  engine?: DeterministicFootprintResolutionEngine;
  telemetry?: FootprintResolverTelemetry;
  clock?: () => string;
  allowStage5PassivePolicy?: boolean;
}

export const PRODUCTION_FOOTPRINT_RESOLVER_CAPABILITIES = Object.freeze({
  compositionVersion: PRODUCTION_FOOTPRINT_SOURCE_COMPOSITION_VERSION,
  passivePolicy: "durable_read_only",
  generatedOverlay: "disabled",
  cache: "disabled",
  mutatesBindings: false,
  mutatesPolicy: false,
  mutatesPcb: false,
});

export function createProductionFootprintResolutionService(input: {
  repository: PhysicalBindingRepository;
  passivePolicyContexts?: PassivePolicyContextProvider;
  authorizer?: FootprintResolutionAuthorizer;
  engine?: DeterministicFootprintResolutionEngine;
  telemetry?: FootprintResolverTelemetry;
  clock?: () => string;
}): FootprintResolutionService {
  const { repository, passivePolicyContexts, ...options } = input;
  return new FootprintResolutionService(repository, {
    ...options,
    sources: productionFootprintCandidateSources(passivePolicyContexts),
    allowStage5PassivePolicy: true,
  });
}

const allStatuses: FootprintResolutionStatus[] = ["resolved", "not_applicable", "unresolved_missing_data", "unresolved_ambiguous", "blocked_conflict", "blocked_invalid", "blocked_unapproved", "blocked_stale", "blocked_unavailable", "blocked_unsupported", "deferred_to_user_decision", "error"];

export class FootprintResolutionService {
  private readonly sources: readonly FootprintCandidateSource[];
  private readonly authorizer: FootprintResolutionAuthorizer;
  private readonly engine: DeterministicFootprintResolutionEngine;
  private readonly telemetry: FootprintResolverTelemetry;
  private readonly clock: () => string;
  private readonly allowStage5PassivePolicy: boolean;
  constructor(private readonly repository: PhysicalBindingRepository, options: Omit<FootprintResolutionServiceOptions, "repository"> = {}) {
    this.sources = options.sources ?? DEFAULT_FOOTPRINT_CANDIDATE_SOURCES;
    this.authorizer = options.authorizer ?? new RoleBasedFootprintResolutionAuthorizer();
    this.engine = options.engine ?? new DeterministicFootprintResolutionEngine();
    this.telemetry = options.telemetry ?? new FootprintResolverTelemetry();
    this.clock = options.clock ?? (() => new Date().toISOString());
    // The default source set is the production composition. Explicit custom
    // source sets remain qualification-only and must opt in to Stage 5.
    this.allowStage5PassivePolicy = options.allowStage5PassivePolicy ?? options.sources === undefined;
  }

  async assembleContext(request: FootprintResolutionRequest, signal?: AbortSignal): Promise<ImmutableResolutionContext> {
    const requestIssues = validateResolutionRequest(request);
    if (requestIssues.length) throw new Error(requestIssues[0]!.code);
    const authorization = await this.authorizer.authorize(request);
    if (!authorization.allowed) throw new Error(authorization.reasonCode);
    if (signal?.aborted) throw new Error("FR_REQUEST_CANCELLED");
    const policy = resolveFootprintPolicy(request.policyId, request.policyVersion, { allowStage5PassivePolicy: this.allowStage5PassivePolicy });
    const policyErrors = validateResolutionPolicy(policy);
    if (policyErrors.length) throw new Error(policyErrors[0]);
    const enabledSources = this.sources.filter((source) => policy.enabledSources.includes(source.sourceKind));
    if (policy.enabledSources.includes("passive_policy") && !enabledSources.some((source) => source.sourceKind === "passive_policy" && !source.sourceVersion.includes("disabled"))) throw new Error("FR_STAGE5_PASSIVE_POLICY_SOURCE_UNAVAILABLE");
    const aggregateStates = await this.repository.findForComponentVariant({ tenantId: request.tenantId, projectId: request.projectId, branchId: request.branchId, boardInstanceId: request.boardInstanceId, componentInstanceId: request.componentId, hierarchyPath: request.hierarchyPath, assemblyVariantId: request.assemblyVariantId });
    const bindingSets = aggregateStates.map((state) => state.set).sort((a, b) => a.setId.localeCompare(b.setId));
    const bindings = [...new Map(aggregateStates.flatMap((state) => state.bindings).map((binding) => [binding.revisionId, binding])).values()].sort((a, b) => a.revisionId.localeCompare(b.revisionId));
    const componentIdentity = bindings[0]?.componentIdentity ?? nativeComponentIdentity({ tenantId: request.tenantId, projectId: request.projectId, branchId: request.branchId, boardInstanceId: request.boardInstanceId, componentInstanceId: request.componentId, hierarchyPath: request.hierarchyPath, assemblyVariantIds: [request.assemblyVariantId] });
    const effectiveSelectedRevisionIds = [...new Set(bindingSets.map((set) => set.effectiveSelectedRevisionId).filter((id): id is string => Boolean(id)))].sort();
    const dependencyDigests = [...new Set([
      ...bindingSets.map((set) => set.recordDigest),
      ...bindings.map((binding) => binding.recordDigest),
      PRODUCTION_FOOTPRINT_SOURCE_COMPOSITION_VERSION,
      ASSEMBLY_VARIANT_SCOPE_CONTRACT_VERSION,
      policy.schemaVersion,
      policy.cacheBehaviorVersion,
      request.expectedComponentRevision,
      request.expectedBindingSetDigest,
    ].filter((value): value is string => Boolean(value)))].sort();
    const collectionContext: CandidateCollectionContext = { request: structuredClone(request), componentIdentity: structuredClone(componentIdentity), bindingSets: structuredClone(bindingSets), bindings: structuredClone(bindings), policy: structuredClone(policy), dependencyDigests };
    const sourceResults = await collectCandidateSources(enabledSources, collectionContext, signal);
    const collectionDiagnostics = sourceResults.flatMap((source) => source.diagnostics).sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message));
    const contextBase: Omit<ImmutableResolutionContext, "dependencyDigest"> = {
      schemaVersion: FOOTPRINT_RESOLUTION_CONTEXT_VERSION,
      request: structuredClone(request),
      componentIdentity: structuredClone(componentIdentity),
      componentRevisionDigest: request.expectedComponentRevision ?? resolverDigest(componentIdentity),
      variantRevisionDigest: resolverDigest({ variant: request.assemblyVariantId, bindingSets: bindingSets.map((set) => normalizeAssemblyVariantScope(set.scope.assemblyVariantIds)), contract: ASSEMBLY_VARIANT_SCOPE_CONTRACT_VERSION }),
      bindingSets: structuredClone(bindingSets),
      effectiveSelectedRevisionIds,
      sourceResults,
      policy,
      libraryAvailability: bindings.some((binding) => binding.footprint?.availability === "available") ? "available" : bindings.some((binding) => binding.footprint) ? "unavailable" : "unknown",
      dependencyDigests: [...new Set([...dependencyDigests, ...sourceResults.flatMap((source) => [source.sourceVersion, ...source.dependencyDigests])])].sort(),
      collectionDiagnostics,
    };
    const provisional = { ...contextBase, dependencyDigest: "" };
    const context = { ...contextBase, dependencyDigest: contextTechnicalDigest(provisional) };
    assertContextDigest(context);
    return deepFreezeBinding(context) as ImmutableResolutionContext;
  }

  async resolve(request: FootprintResolutionRequest, signal?: AbortSignal): Promise<FootprintResolutionResult> {
    const started = performance.now();
    const context = await this.assembleContext(request, signal);
    const result = this.engine.evaluate(context);
    const occurredAt = this.clock();
    const common = { tenantId: request.tenantId, projectId: request.projectId, occurredAt, resolverVersion: result.resolverVersion, policyVersion: result.policyVersion };
    this.telemetry.record({ ...common, metric: "request", value: 1, purpose: request.purpose });
    this.telemetry.record({ ...common, metric: "status", value: 1, purpose: request.purpose, status: result.status });
    this.telemetry.record({ ...common, metric: "evaluation_ms", value: Number((performance.now() - started).toFixed(3)), purpose: request.purpose, status: result.status });
    for (const source of context.sourceResults) this.telemetry.record({ ...common, metric: "adapter", value: 1, sourceKind: source.sourceKind, sourceStatus: source.status });
    for (const candidate of result.consideredCandidates) this.telemetry.record({ ...common, metric: "candidate", value: 1, disposition: candidate.primary });
    for (const issue of [...result.blockers, ...result.warnings]) this.telemetry.record({ ...common, metric: "issue", value: 1, reasonCode: issue.code });
    for (const conflict of result.conflicts) this.telemetry.record({ ...common, metric: "conflict", value: 1, reasonCode: conflict.conflictClass });
    return result;
  }

  async explain(request: FootprintResolutionRequest, signal?: AbortSignal): Promise<FootprintResolutionResult> {
    return this.resolve(request, signal);
  }

  async resolveBatch(batch: FootprintResolutionBatchRequest, signal?: AbortSignal): Promise<FootprintResolutionBatchResult> {
    if (batch.schemaVersion !== "sirkit.footprint-resolution-batch-request.v1" || !batch.batchId.trim()) throw new Error("FR_BATCH_SCHEMA_INVALID");
    if (batch.requests.length === 0) {
      const summary = Object.fromEntries(allStatuses.map((status) => [status, 0])) as Record<FootprintResolutionStatus, number>;
      return { schemaVersion: "sirkit.footprint-resolution-batch-result.v1", batchId: batch.batchId, policyId: "sirkit.default-footprint-resolution", policyVersion: "1.0.0", results: [], summary, dependencyDigest: resolverDigest([]), evaluatedAt: new Date(0).toISOString() };
    }
    const first = batch.requests[0]!;
    const policy = resolveFootprintPolicy(first.policyId, first.policyVersion, { allowStage5PassivePolicy: this.allowStage5PassivePolicy });
    if (batch.requests.length > policy.maxBatchSize) throw new Error("FR_BATCH_LIMIT_EXCEEDED");
    if (new Set(batch.requests.map((request) => request.componentId)).size !== batch.requests.length) throw new Error("FR_BATCH_DUPLICATE_COMPONENT");
    if (batch.requests.some((request) => request.tenantId !== first.tenantId || request.projectId !== first.projectId || request.branchId !== first.branchId || request.policyId !== first.policyId || request.policyVersion !== first.policyVersion)) throw new Error("FR_BATCH_SNAPSHOT_SCOPE_MISMATCH");
    const ordered = [...batch.requests].sort((a, b) => a.componentId.localeCompare(b.componentId) || a.assemblyVariantId.localeCompare(b.assemblyVariantId));
    const results: FootprintResolutionResult[] = [];
    for (let index = 0; index < ordered.length; index += 8) {
      if (signal?.aborted) throw new Error("FR_REQUEST_CANCELLED");
      const chunk = ordered.slice(index, index + 8);
      results.push(...await Promise.all(chunk.map((request) => this.resolve(request, signal))));
    }
    results.sort((a, b) => a.inputSnapshot.componentId.localeCompare(b.inputSnapshot.componentId) || a.inputSnapshot.assemblyVariantId.localeCompare(b.inputSnapshot.assemblyVariantId));
    const summary = Object.fromEntries(allStatuses.map((status) => [status, results.filter((result) => result.status === status).length])) as Record<FootprintResolutionStatus, number>;
    return { schemaVersion: "sirkit.footprint-resolution-batch-result.v1", batchId: batch.batchId, policyId: first.policyId, policyVersion: first.policyVersion, results, summary, dependencyDigest: resolverDigest(results.map((result) => result.inputSnapshot.dependencyDigest)), evaluatedAt: ordered.map((request) => request.requestedAt).sort().at(-1)! };
  }
}
