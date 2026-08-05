import { FootprintResolutionService } from "../footprint-resolver/service";
import { FOOTPRINT_RESOLUTION_REQUEST_VERSION, type FootprintResolutionBatchResult, type FootprintResolutionRequest, type FootprintResolutionStatus } from "../footprint-resolver/types";
import { inspectBoard } from "./board";
import { PcbSyncPreflightEngine } from "./engine";
import { executePcbSyncPlan, validateStagedBoard } from "./executor";
import { buildRouterHandoff } from "./handoff";
import { assertPcbSyncPlanTransition } from "./lifecycle";
import { resolvePcbSyncPolicy, validatePcbSyncPolicy } from "./policy";
import type { PcbSyncRepository, PcbSyncRepositoryScope } from "./repository";
import { authoritativeSnapshotDigest, assertPlanDigest, pcbSyncDigest } from "./stable";
import { PCB_SYNC_APPLY_RESULT_VERSION, type PcbSyncApplyRequest, type PcbSyncApplyResult, type PcbSyncAuthoritativeSnapshot, type PcbSyncAuthorizationProvider, type PcbSyncFaultInjector, type PcbSyncFootprintMaterialization, type PcbSyncFootprintResolver, type PcbSyncIssue, type PcbSyncPlan, type PcbSyncPreflightContext, type PcbSyncPreflightRequest, type PcbSyncPreflightResult, type PcbSyncResourceProvider, type PcbSyncSchematicComponent, type PcbSyncSnapshotProvider, type PcbSyncTrustedClock } from "./types";
import { pcbSyncIssue, validateApplyRequest, validatePreflightRequest } from "./validation";
import { DefaultPcbSyncAuthorizationProvider } from "./authorization";
import { PcbSyncTelemetry } from "./observability";
import { resolvePinPadMapping } from "../pcb/pin-pad-mapping";
import { canonicalReference, schematicEndpointKey } from "../pcb/integrity";

const statuses: FootprintResolutionStatus[] = ["resolved", "not_applicable", "unresolved_missing_data", "unresolved_ambiguous", "blocked_conflict", "blocked_invalid", "blocked_unapproved", "blocked_stale", "blocked_unavailable", "blocked_unsupported", "deferred_to_user_decision", "error"];
function emptySummary(): Record<FootprintResolutionStatus, number> { return Object.fromEntries(statuses.map((status) => [status, 0])) as Record<FootprintResolutionStatus, number>; }

function validateMaterializationAuthority(
  component: PcbSyncSchematicComponent,
  snapshot: PcbSyncAuthoritativeSnapshot,
  materialization: PcbSyncFootprintMaterialization,
): PcbSyncIssue[] {
  const issues: PcbSyncIssue[] = [];
  const issue = (code: string, message: string, stableIds: string[] = [component.componentInstanceId]): void => {
    issues.push(pcbSyncIssue({ code, scope: "mapping", message, stableIds, displayRefs: [component.referenceDesignator], remediation: "verify_pin_pad_mapping" }));
  };
  const { artifactDigest, ...mappingBase } = materialization.mapping;
  if (pcbSyncDigest(mappingBase) !== artifactDigest) {
    issue("PS_MAPPING_ARTIFACT_DIGEST_MISMATCH", `${component.referenceDesignator} verified pin-to-pad mapping digest does not match its content.`);
  }
  const { materializationDigest, ...materializationBase } = materialization;
  const expectedMaterializationDigest = pcbSyncDigest({
    ...materializationBase,
    footprintDef: {
      libName: materialization.footprintDef.libName,
      name: materialization.footprintDef.name,
      pads: materialization.footprintDef.pads,
    },
  });
  if (expectedMaterializationDigest !== materializationDigest) {
    issue("PS_MATERIALIZATION_DIGEST_MISMATCH", `${component.referenceDesignator} footprint materialization digest does not match its immutable content.`);
  }

  for (const pin of component.pins) {
    const numbered = materialization.mapping.entries.filter((entry) => entry.symbolPinNumber === pin.number);
    const exact = numbered.filter((entry) => entry.pinInstanceId === pin.pinInstanceId);
    if (numbered.length === 0) {
      issue("PS_MAPPING_PIN_MISSING", `${component.referenceDesignator}.${pin.number} has no entry in the verified mapping artifact.`, [component.componentInstanceId, pin.pinInstanceId]);
    } else if (exact.length !== 1 || numbered.length !== 1) {
      issue("PS_MAPPING_PIN_IDENTITY_CONFLICT", `${component.referenceDesignator}.${pin.number} does not have exactly one mapping bound to pin identity ${pin.pinInstanceId}.`, [component.componentInstanceId, pin.pinInstanceId]);
    }
  }

  const netIdByEndpoint = new Map<string, number>();
  [...snapshot.nets].sort((a, b) => a.stableNetId.localeCompare(b.stableNetId)).forEach((net, index) => {
    for (const member of net.members) netIdByEndpoint.set(schematicEndpointKey(member.componentInstanceId, member.pinNumber), index + 1);
  });
  const electricalPadNumbers = new Set(materialization.footprintDef.pads.filter((pad) => pad.type !== "np_thru_hole").map((pad) => pad.number));
  const mappingResult = resolvePinPadMapping({
    id: component.componentInstanceId,
    ref: component.referenceDesignator,
    pins: component.pins.map((pin) => ({ number: pin.number })),
    pinPadMapping: {
      mappings: materialization.mapping.entries.map((entry) => ({
        symbolPinNumber: entry.symbolPinNumber,
        padNumbers: [...entry.padNumbers],
        mappingKind: entry.mappingKind,
        provenance: "library-explicit",
      })),
      footprintPadClassifications: Object.fromEntries(materialization.mapping.mechanicalPadNumbers
        .filter((padNumber) => electricalPadNumbers.has(padNumber))
        .map((padNumber) => [padNumber, "mechanical" as const])),
    },
  }, materialization.footprintDef, netIdByEndpoint);
  for (const diagnostic of mappingResult.diagnostics.filter((item) => item.severity === "error")) {
    const code = diagnostic.code === "PAD_NET_CONFLICT" ? "PS_MAPPING_PAD_OWNERSHIP_CONFLICT" : `PS_MAPPING_${diagnostic.code}`;
    issue(code, diagnostic.summary);
  }
  const footprintPadNumbers = new Set(materialization.footprintDef.pads.map((pad) => pad.number));
  for (const padNumber of materialization.mapping.mechanicalPadNumbers) {
    if (!footprintPadNumbers.has(padNumber)) issue("PS_MAPPING_NONEXISTENT_MECHANICAL_PAD", `${component.referenceDesignator} classifies missing footprint pad '${padNumber}' as mechanical.`);
  }
  return issues.sort((a, b) => a.code.localeCompare(b.code) || a.stableIds.join("\0").localeCompare(b.stableIds.join("\0")));
}

export interface PcbSynchronizationServiceOptions {
  snapshotProvider: PcbSyncSnapshotProvider;
  resolver: PcbSyncFootprintResolver | FootprintResolutionService;
  resourceProvider: PcbSyncResourceProvider;
  repository: PcbSyncRepository;
  authorizer?: PcbSyncAuthorizationProvider;
  engine?: PcbSyncPreflightEngine;
  faultInjector?: PcbSyncFaultInjector;
  telemetry?: PcbSyncTelemetry;
  clock?: PcbSyncTrustedClock;
}

export class PcbSynchronizationService {
  private readonly authorizer: PcbSyncAuthorizationProvider;
  private readonly engine: PcbSyncPreflightEngine;
  private readonly faultInjector?: PcbSyncFaultInjector;
  private readonly telemetry?: PcbSyncTelemetry;
  private readonly clock: PcbSyncTrustedClock;
  constructor(private readonly options: PcbSynchronizationServiceOptions) {
    this.authorizer = options.authorizer ?? new DefaultPcbSyncAuthorizationProvider();
    this.engine = options.engine ?? new PcbSyncPreflightEngine();
    this.faultInjector = options.faultInjector;
    this.telemetry = options.telemetry;
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  private scope(request: PcbSyncPreflightRequest | PcbSyncApplyRequest): PcbSyncRepositoryScope { return { tenantId: request.tenantId, projectId: request.projectId, branchId: request.branchId, boardId: "target" in request ? request.target.boardId : request.boardId }; }

  private resolverRequest(request: PcbSyncPreflightRequest, component: Awaited<ReturnType<PcbSyncSnapshotProvider["acquire"]>>["components"][number]): FootprintResolutionRequest {
    return { schemaVersion: FOOTPRINT_RESOLUTION_REQUEST_VERSION, requestId: `pcb-sync-${request.requestId}-${component.componentInstanceId}`, tenantId: request.tenantId, projectId: request.projectId, branchId: request.branchId, boardInstanceId: request.target.boardId, componentId: component.componentInstanceId, hierarchyPath: [...component.hierarchyPath], assemblyVariantId: request.assemblyVariantId, purpose: "layout_transfer", expectedComponentRevision: component.componentRevision, policyId: request.resolutionPolicyId, policyVersion: request.resolutionPolicyVersion, requestedAt: request.requestedAt, actorContext: structuredClone(request.actorContext), traceLevel: request.traceLevel };
  }

  private async resolveApplicable(request: PcbSyncPreflightRequest, components: Awaited<ReturnType<PcbSyncSnapshotProvider["acquire"]>>["components"], signal?: AbortSignal): Promise<FootprintResolutionBatchResult> {
    const ordered = [...components].sort((a, b) => a.componentInstanceId.localeCompare(b.componentInstanceId));
    const chunks = Array.from({ length: Math.ceil(ordered.length / 256) }, (_, index) => ordered.slice(index * 256, (index + 1) * 256));
    const batches: FootprintResolutionBatchResult[] = [];
    for (let index = 0; index < chunks.length; index += 4) {
      if (signal?.aborted) throw new Error("PS_REQUEST_CANCELLED");
      const group = chunks.slice(index, index + 4);
      const resolved = await Promise.all(group.map((chunk, offset) => this.options.resolver.resolveBatch({
        schemaVersion: "sirkit.footprint-resolution-batch-request.v1",
        batchId: `pcb-sync-${request.requestId}-${index + offset}`,
        requests: chunk.map((component) => this.resolverRequest(request, component)),
      }, signal)));
      batches.push(...resolved);
    }
    if (batches.some((batch) => batch.policyId !== request.resolutionPolicyId || batch.policyVersion !== request.resolutionPolicyVersion)) throw new Error("PS_RESOLVER_BATCH_POLICY_MISMATCH");
    const results = batches.flatMap((batch) => batch.results).sort((a, b) => a.inputSnapshot.componentId.localeCompare(b.inputSnapshot.componentId));
    const summary = emptySummary();
    for (const result of results) summary[result.status] += 1;
    return { schemaVersion: "sirkit.footprint-resolution-batch-result.v1", batchId: `pcb-sync-${request.requestId}`, policyId: request.resolutionPolicyId, policyVersion: request.resolutionPolicyVersion, results, summary, dependencyDigest: pcbSyncDigest(results.map((result) => result.inputSnapshot.dependencyDigest)), evaluatedAt: request.requestedAt };
  }

  private async buildContext(request: PcbSyncPreflightRequest, signal?: AbortSignal): Promise<PcbSyncPreflightContext> {
    const requestIssues = validatePreflightRequest(request);
    if (requestIssues.length) throw new Error(requestIssues[0]!.code);
    const authorization = await this.authorizer.authorizePreflight(request);
    if (!authorization.allowed) throw new Error(authorization.reasonCode);
    const policy = resolvePcbSyncPolicy(request.syncPolicyId, request.syncPolicyVersion);
    const policyErrors = validatePcbSyncPolicy(policy);
    if (policyErrors.length) throw new Error(policyErrors[0]);
    const snapshot = await this.options.snapshotProvider.acquire(request, signal);
    const contextIssues = [];
    const boardIdentityIssues: PcbSyncIssue[] = [];
    const { snapshotDigest: _snapshotDigest, ...snapshotBase } = snapshot;
    void _snapshotDigest;
    if (authoritativeSnapshotDigest(snapshotBase) !== snapshot.snapshotDigest) contextIssues.push(pcbSyncIssue({ code: "PS_SNAPSHOT_DIGEST_MISMATCH", scope: "snapshot", message: "Authoritative schematic snapshot digest is invalid.", retryability: "after_refresh" }));
    if (snapshot.tenantId !== request.tenantId || snapshot.projectId !== request.projectId || snapshot.branchId !== request.branchId || snapshot.designId !== request.designId) contextIssues.push(pcbSyncIssue({ code: "PS_SNAPSHOT_SCOPE_MISMATCH", scope: "snapshot", message: "Snapshot is outside the authorized request scope." }));
    if (snapshot.schematicRevision !== request.schematicRevision) contextIssues.push(pcbSyncIssue({ code: "PS_SCHEMATIC_REVISION_MISMATCH", scope: "snapshot", message: "Requested schematic revision is not current.", retryability: "after_refresh" }));
    if (snapshot.assemblyVariantId !== request.assemblyVariantId) contextIssues.push(pcbSyncIssue({ code: "PS_VARIANT_REVISION_MISMATCH", scope: "snapshot", message: "Snapshot assembly variant differs from the request.", retryability: "after_refresh" }));
    if (snapshot.components.length > policy.maxComponents || snapshot.nets.length > policy.maxNets) contextIssues.push(pcbSyncIssue({ code: "PS_SNAPSHOT_LIMIT_EXCEEDED", scope: "snapshot", message: "Snapshot exceeds the supported component or net limit." }));
    if (new Set(snapshot.components.map((item) => item.componentInstanceId)).size !== snapshot.components.length) contextIssues.push(pcbSyncIssue({ code: "PS_COMPONENT_IDENTITY_DUPLICATE", scope: "component", message: "Snapshot contains duplicate stable component identities." }));
    if (new Set(snapshot.components.map((item) => canonicalReference(item.referenceDesignator))).size !== snapshot.components.length) contextIssues.push(pcbSyncIssue({ code: "PS_REFERENCE_DESIGNATOR_DUPLICATE", scope: "component", message: "Snapshot contains duplicate canonical reference designators; annotation must be repaired upstream." }));
    const pinInstanceIds = snapshot.components.flatMap((component) => component.pins.map((pin) => pin.pinInstanceId));
    if (new Set(pinInstanceIds).size !== pinInstanceIds.length || snapshot.components.some((component) => new Set(component.pins.map((pin) => pin.number)).size !== component.pins.length)) contextIssues.push(pcbSyncIssue({ code: "PS_PIN_IDENTITY_DUPLICATE", scope: "component", message: "Snapshot contains duplicate pin identities." }));
    if (new Set(snapshot.nets.map((item) => item.stableNetId)).size !== snapshot.nets.length) contextIssues.push(pcbSyncIssue({ code: "PS_NET_IDENTITY_DUPLICATE", scope: "net", message: "Snapshot contains duplicate stable net identities." }));
    const scope = this.scope(request);
    const boardRecord = await this.options.repository.getBoard(scope);
    if (request.target.kind === "existing_board") {
      if (!boardRecord) contextIssues.push(pcbSyncIssue({ code: "PS_BOARD_NOT_FOUND", scope: "board", message: "Existing target board was not found." }));
      else if (boardRecord.revision !== request.target.expectedBoardRevision) contextIssues.push(pcbSyncIssue({ code: "PS_BOARD_REVISION_MISMATCH", scope: "board", message: "Target board changed since the expected revision.", retryability: "after_refresh" }));
    } else if (boardRecord) contextIssues.push(pcbSyncIssue({ code: "PS_NEW_BOARD_ALREADY_EXISTS", scope: "board", message: "New-board target identity already exists." }));
    if (boardRecord) {
      const boardNets = boardRecord.board.nets.filter((net) => net.id !== 0);
      const stableBoardNetIds = boardNets.flatMap((net) => net.stableId ? [net.stableId] : []);
      if (stableBoardNetIds.length !== boardNets.length) boardIdentityIssues.push(pcbSyncIssue({ code: "PS_BOARD_NET_IDENTITY_UNKNOWN", scope: "net", message: "Existing PCB contains a nonzero net without durable schematic identity; synchronization will not guess from its numeric ID or display name." }));
      if (new Set(stableBoardNetIds).size !== stableBoardNetIds.length) boardIdentityIssues.push(pcbSyncIssue({ code: "PS_BOARD_NET_IDENTITY_DUPLICATE", scope: "net", message: "Existing PCB contains duplicate stable net identities." }));
      const sourceNetIds = new Set(snapshot.nets.map((net) => net.stableNetId));
      for (const net of boardNets.filter((candidate) => candidate.stableId && !sourceNetIds.has(candidate.stableId))) {
        const stableNetId = net.stableId!;
        const objectIds = [
          ...boardRecord.board.tracks.filter((item) => item.netId === net.id).map((item) => item.id),
          ...boardRecord.board.vias.filter((item) => item.netId === net.id).map((item) => item.id),
          ...boardRecord.board.zones.filter((item) => item.netId === net.id).map((item) => item.id),
        ].sort();
        boardIdentityIssues.push(pcbSyncIssue({
          code: objectIds.length ? "PS_REMOVED_NET_PROTECTED" : "PS_REMOVED_NET_RECONCILIATION_REQUIRED",
          scope: "net",
          message: objectIds.length
            ? `Removed schematic net ${stableNetId} still owns PCB objects (${objectIds.join(", ")}); synchronization stopped without deleting or retagging them.`
            : `PCB net ${stableNetId} is absent from the authoritative schematic and requires an explicit removal operation.`,
          stableIds: [stableNetId, ...objectIds],
          remediation: "identity_reconciliation",
        }));
      }
    }
    const boardAssessment = inspectBoard(request.target.boardId, boardRecord, request.target.kind === "new_board" ? snapshot.newBoardTemplate : undefined);
    const applicable = snapshot.components.filter((item) => item.applicability === "applicable").sort((a, b) => a.componentInstanceId.localeCompare(b.componentInstanceId));
    let resolverBatch: FootprintResolutionBatchResult;
    if (contextIssues.some((item) => item.blocking) || applicable.length === 0) resolverBatch = { schemaVersion: "sirkit.footprint-resolution-batch-result.v1", batchId: `pcb-sync-${request.requestId}`, policyId: request.resolutionPolicyId, policyVersion: request.resolutionPolicyVersion, results: [], summary: emptySummary(), dependencyDigest: "not-evaluated", evaluatedAt: request.requestedAt };
    else resolverBatch = await this.resolveApplicable(request, applicable, signal);
    const expectedIds = applicable.map((item) => item.componentInstanceId), returnedIds = resolverBatch.results.map((item) => item.inputSnapshot.componentId);
    if (new Set(returnedIds).size !== returnedIds.length || expectedIds.length !== returnedIds.length || expectedIds.some((id) => !returnedIds.includes(id))) contextIssues.push(pcbSyncIssue({ code: "PS_RESOLVER_BATCH_COMPONENT_SET_MISMATCH", scope: "system", message: "Stage 2 batch result does not exactly cover the requested applicable component set." }));
    if (resolverBatch.policyId !== request.resolutionPolicyId || resolverBatch.policyVersion !== request.resolutionPolicyVersion) contextIssues.push(pcbSyncIssue({ code: "PS_RESOLVER_BATCH_POLICY_MISMATCH", scope: "system", message: "Stage 2 batch used a different resolution policy." }));
    for (const result of resolverBatch.results) {
      if (result.inputSnapshot.assemblyVariantId !== request.assemblyVariantId) contextIssues.push(pcbSyncIssue({ code: "PS_RESOLVER_VARIANT_MISMATCH", scope: "system", message: "Stage 2 result used a different assembly variant.", stableIds: [result.inputSnapshot.componentId] }));
      if (result.resolvedBinding && result.resolvedBinding.purpose !== "layout_transfer") contextIssues.push(pcbSyncIssue({ code: "PS_RESOLVER_PURPOSE_MISMATCH", scope: "system", message: "Stage 2 result was not produced for layout transfer.", stableIds: [result.inputSnapshot.componentId] }));
    }
    const resolutionByComponent = Object.fromEntries(resolverBatch.results.map((result) => [result.inputSnapshot.componentId, result]));
    const materializations = [];
    for (let index = 0; index < applicable.length; index += 16) {
      const chunk = applicable.slice(index, index + 16);
      const loaded = await Promise.all(chunk.map(async (component) => {
        const result = resolutionByComponent[component.componentInstanceId];
        return result?.status === "resolved" ? this.options.resourceProvider.materialize(component, result, signal) : null;
      }));
      materializations.push(...loaded.filter((item): item is NonNullable<typeof item> => Boolean(item)));
    }
    for (const materialization of materializations) {
      const component = applicable.find((item) => item.componentInstanceId === materialization.componentInstanceId);
      if (component) contextIssues.push(...validateMaterializationAuthority(component, snapshot, materialization));
    }
    contextIssues.push(...boardIdentityIssues);
    return { request: structuredClone(request), snapshot, boardRecord, boardAssessment, resolverBatch, resolutionByComponent, materializations: materializations.sort((a, b) => a.componentInstanceId.localeCompare(b.componentInstanceId)), policy, contextIssues: contextIssues.sort((a, b) => a.code.localeCompare(b.code)) };
  }

  private async runPreflight(request: PcbSyncPreflightRequest, persistPlan: boolean, signal?: AbortSignal): Promise<PcbSyncPreflightResult> {
    const started = performance.now();
    const result = this.engine.evaluate(await this.buildContext(request, signal));
    if (persistPlan && result.plan) await this.options.repository.savePlan(result.plan);
    const common = { tenantId: request.tenantId, projectId: request.projectId, occurredAt: result.evaluatedAt, engineVersion: result.policyVersions.engineVersion, policyVersion: result.policyVersions.syncPolicyVersion };
    this.telemetry?.record({ ...common, metric: "preflight", value: 1, status: result.status, boardClass: result.board.boardClass });
    this.telemetry?.record({ ...common, metric: "preflight_ms", value: Math.max(0, performance.now() - started), status: result.status, boardClass: result.board.boardClass });
    this.telemetry?.record({ ...common, metric: "component", value: result.summary.totalSchematicComponents, status: result.status });
    for (const blocker of result.blockers) this.telemetry?.record({ ...common, metric: "blocker", value: 1, status: result.status, reasonCode: blocker.code });
    for (const operation of result.plan?.operations ?? []) this.telemetry?.record({ ...common, metric: "operation", value: 1, status: result.status, operationKind: operation.kind, risk: operation.risk });
    return result;
  }

  async preflight(request: PcbSyncPreflightRequest, signal?: AbortSignal): Promise<PcbSyncPreflightResult> { return this.runPreflight(request, true, signal); }

  async getPlan(planId: string, scope: PcbSyncRepositoryScope, actor: PcbSyncPreflightRequest["actorContext"]): Promise<PcbSyncPlan | null> {
    if (!planId || !["viewer", "commenter", "pcb_editor", "reviewer", "project_admin"].includes(actor.role)) throw new Error("PS_PLAN_READ_AUTHORIZATION_DENIED");
    return this.options.repository.getPlan(scope, planId);
  }

  private captureApplyTime(): string {
    const value = this.clock(), parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) throw new Error("PS_TRUSTED_CLOCK_INVALID");
    return new Date(parsed).toISOString();
  }

  private applyLifecycleEligible(plan: PcbSyncPlan): boolean { return plan.lifecycle === "applicable" || plan.lifecycle === "applying"; }

  private assertApplyChronology(plan: PcbSyncPlan, applyAt: string, boardUpdatedAt?: string): void {
    const applyTime = Date.parse(applyAt), createdAt = Date.parse(plan.createdAt), expiresAt = Date.parse(plan.expiresAt), boardTime = boardUpdatedAt ? Date.parse(boardUpdatedAt) : undefined;
    if (![createdAt, expiresAt, ...(boardTime === undefined ? [] : [boardTime])].every(Number.isFinite) || expiresAt <= createdAt) throw new Error("PS_PLAN_TIME_INVALID");
    if (applyTime < createdAt || (boardTime !== undefined && applyTime < boardTime)) throw new Error("PS_APPLY_CLOCK_REGRESSION");
    if (applyTime >= expiresAt) throw new Error("PS_PLAN_EXPIRED");
  }

  private async revalidateForApply(plan: PcbSyncPlan, request: PcbSyncApplyRequest, applyAt: string, signal?: AbortSignal): Promise<PcbSyncPreflightContext> {
    const target = plan.snapshot.targetBoardRevision === null
      // The board name must be the one the plan was built from. Substituting the
      // boardId here breaks apply outright whenever ids use the app's
      // `board:<project>` convention, since ':' is not a legal board name.
      ? { kind: "new_board" as const, boardId: plan.scope.boardId, boardName: plan.snapshot.targetBoardName ?? plan.scope.boardId, boardFormatVersion: "sirkit-json-pcb/1" as const }
      : { kind: "existing_board" as const, boardId: plan.scope.boardId, expectedBoardRevision: plan.snapshot.targetBoardRevision };
    const revalidationRequest = { requestSchemaVersion: "sirkit.pcb-sync-preflight-request.v1" as const, requestId: `revalidate-${request.requestId}`, tenantId: plan.scope.tenantId, projectId: plan.scope.projectId, branchId: plan.scope.branchId, designId: plan.scope.designId, schematicRevision: plan.snapshot.schematicRevision, assemblyVariantId: plan.snapshot.assemblyVariantId, target, resolutionPolicyId: plan.policyVersions.resolutionPolicyId, resolutionPolicyVersion: plan.policyVersions.resolutionPolicyVersion, syncPolicyId: plan.policyVersions.syncPolicyId, syncPolicyVersion: plan.policyVersions.syncPolicyVersion, actorContext: structuredClone(request.actorContext), requestedAt: applyAt, mode: "prepare_apply" as const };
    const context = await this.buildContext(revalidationRequest, signal), current = this.engine.evaluate(context);
    const expectedStatus = plan.operations.some((item) => !["preserve_component_instance", "preserve_net", "mark_dnp_or_excluded", "no_op"].includes(item.kind)) ? "ready_to_apply" : "ready_no_changes";
    if (!current.plan || current.plan.planDigest !== plan.planDigest || current.status !== expectedStatus) throw new Error("PS_PLAN_STALE");
    return context;
  }

  async apply(request: PcbSyncApplyRequest, signal?: AbortSignal): Promise<PcbSyncApplyResult> {
    const started = performance.now();
    const applyAt = this.captureApplyTime();
    const issues = validateApplyRequest(request);
    if (issues.length) throw new Error(issues[0]!.code);
    const scope = this.scope(request);
    const replay = await this.options.repository.getIdempotentResult(scope, request.idempotencyKey);
    if (replay) {
      if (replay.planId !== request.planId || replay.planDigest !== request.planDigest) throw new Error("PS_IDEMPOTENCY_SCOPE_CONFLICT");
      return { ...replay, requestId: request.requestId, status: "idempotent_replay", boardChanged: false };
    }
    const plan = await this.options.repository.getPlan(scope, request.planId);
    if (!plan) throw new Error("PS_PLAN_NOT_FOUND");
    assertPlanDigest(plan);
    if (plan.planDigest !== request.planDigest || !this.applyLifecycleEligible(plan)) throw new Error("PS_PLAN_DIGEST_OR_LIFECYCLE_MISMATCH");
    this.assertApplyChronology(plan, applyAt);
    const authorization = await this.authorizer.authorizeApply(request, plan);
    if (!authorization.allowed) throw new Error(authorization.reasonCode);
    const output: PcbSyncApplyResult = await this.options.repository.withBoardLock(scope, resolvePcbSyncPolicy(plan.policyVersions.syncPolicyId, plan.policyVersions.syncPolicyVersion).lockTimeoutMs, async (): Promise<PcbSyncApplyResult> => {
      let commitReturned = false;
      try {
        const concurrentReplay = await this.options.repository.getIdempotentResult(scope, request.idempotencyKey);
        if (concurrentReplay) {
          if (concurrentReplay.planId !== request.planId || concurrentReplay.planDigest !== request.planDigest) throw new Error("PS_IDEMPOTENCY_SCOPE_CONFLICT");
          return { ...concurrentReplay, requestId: request.requestId, status: "idempotent_replay" as const, boardChanged: false };
        }
        await this.faultInjector?.hit("after_lock");
        if (signal?.aborted) throw new Error("PS_REQUEST_CANCELLED");
        const activePlan = await this.options.repository.getPlan(scope, request.planId);
        if (!activePlan || activePlan.planDigest !== request.planDigest || !this.applyLifecycleEligible(activePlan)) throw new Error("PS_PLAN_DIGEST_OR_LIFECYCLE_MISMATCH");
        const currentContext = await this.revalidateForApply(activePlan, request, applyAt, signal);
        await this.faultInjector?.hit("after_revalidation");
        const originalRecord = currentContext.boardRecord;
        this.assertApplyChronology(activePlan, applyAt, originalRecord?.updatedAt);
        if (activePlan.lifecycle === "applicable") assertPcbSyncPlanTransition(activePlan.lifecycle, "applying");
        const applying = { ...activePlan, lifecycle: "applying" as const };
        const template = activePlan.snapshot.targetBoardRevision === null ? currentContext.snapshot.newBoardTemplate : undefined;
        const base = originalRecord?.board ?? template;
        if (!base) throw new Error("PS_NEW_BOARD_TEMPLATE_MISSING");
        await this.faultInjector?.hit("after_stage");
        const executed = executePcbSyncPlan(base, applying);
        await this.faultInjector?.hit("after_mutation");
        const serialized = JSON.stringify(executed.board);
        await this.faultInjector?.hit("after_serialize");
        const reparsed = JSON.parse(serialized) as typeof executed.board;
        await this.faultInjector?.hit("after_reparse");
        const validation = validateStagedBoard(reparsed, originalRecord?.board ?? null, applying);
        if (validation.length) throw new Error(validation[0]!.code);
        await this.faultInjector?.hit("after_validation");
        await this.faultInjector?.hit("before_commit");
        await this.revalidateForApply(activePlan, request, applyAt, signal);
        await this.faultInjector?.hit("during_commit");
        const result = await this.options.repository.commit({ scope, expectedBoardRevision: originalRecord?.revision ?? null, stagedBoard: reparsed, plan: applying, applyRequest: request, completedAt: applyAt, buildResult: (record, audit) => ({ resultSchemaVersion: PCB_SYNC_APPLY_RESULT_VERSION, requestId: request.requestId, status: "applied", planId: activePlan.planId, planDigest: activePlan.planDigest, boardChanged: true, originalBoardRevision: originalRecord?.revision ?? null, committedBoardRevision: record.revision, committedBoardDigest: record.digest, operationOutcomes: executed.outcomes, blockers: [], warnings: [], audit, routerHandoff: buildRouterHandoff(record, applying, audit, applyAt), completedAt: applyAt }) });
        commitReturned = true;
        await this.faultInjector?.hit("after_commit");
        return result;
      } catch (error) {
        const code = error instanceof Error ? /^PS_[A-Z0-9_]+/.exec(error.message)?.[0] ?? "PS_APPLY_FAILED" : "PS_APPLY_FAILED";
        const recovered = await this.options.repository.getIdempotentResult(scope, request.idempotencyKey);
        if (recovered) {
          if (recovered.planId !== request.planId || recovered.planDigest !== request.planDigest) throw new Error("PS_IDEMPOTENCY_SCOPE_CONFLICT");
          if (commitReturned) return { ...recovered, status: "recoverable_commit_uncertainty", blockers: [pcbSyncIssue({ code: "PS_COMMIT_RESULT_UNCERTAIN", scope: "storage", message: "The board committed atomically but the caller did not receive normal completion; retrying the same idempotency key is safe.", retryability: "transient" })] };
          return { ...recovered, requestId: request.requestId, status: "idempotent_replay", boardChanged: false };
        }
        return { resultSchemaVersion: PCB_SYNC_APPLY_RESULT_VERSION, requestId: request.requestId, status: code.includes("STALE") || code.includes("REVISION") || code.includes("LIFECYCLE") ? "blocked_stale" : code.includes("AUTHORIZATION") ? "blocked_authorization" : "failed_precommit", planId: plan.planId, planDigest: plan.planDigest, boardChanged: false, originalBoardRevision: plan.snapshot.targetBoardRevision, operationOutcomes: [], blockers: [pcbSyncIssue({ code, scope: code.includes("BOARD") ? "board" : "storage", message: "Synchronization apply stopped before authoritative publication.", retryability: code.includes("CANCELLED") ? "transient" : "after_refresh" })], warnings: [], completedAt: applyAt };
      }
    });
    const common = { tenantId: request.tenantId, projectId: request.projectId, occurredAt: output.completedAt, engineVersion: plan.policyVersions.engineVersion, policyVersion: plan.policyVersions.syncPolicyVersion };
    this.telemetry?.record({ ...common, metric: "apply", value: 1, status: output.status, reasonCode: output.blockers[0]?.code });
    this.telemetry?.record({ ...common, metric: "apply_ms", value: Math.max(0, performance.now() - started), status: output.status });
    if (output.status === "applied") this.telemetry?.record({ ...common, metric: "commit", value: 1, status: output.status });
    if (output.status === "recoverable_commit_uncertainty") this.telemetry?.record({ ...common, metric: "recovery", value: 1, status: output.status, reasonCode: output.blockers[0]?.code });
    if (output.routerHandoff) this.telemetry?.record({ ...common, metric: "router_handoff", value: 1, status: output.status });
    return output;
  }
}
