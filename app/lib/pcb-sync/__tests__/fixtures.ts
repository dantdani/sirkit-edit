import { FootprintResolutionService } from "../../footprint-resolver/service";
import { readyRepository } from "../../footprint-resolver/__tests__/fixtures";
import { createEmptyBoard, type FootprintDef, type PcbBoard } from "../../pcb/types";
import { mmToNm } from "../../pcb/units";
import { authoritativeSnapshotDigest, pcbSyncDigest } from "../stable";
import { InMemoryPcbSyncResourceProvider, InMemoryPcbSyncSnapshotProvider } from "../providers";
import { InMemoryPcbSyncRepository } from "../repository";
import { PcbSynchronizationService } from "../service";
import type { PcbSyncApplyRequest, PcbSyncAuthoritativeSnapshot, PcbSyncFootprintMaterialization, PcbSyncPreflightRequest } from "../types";
import { makeBoardRecord } from "../board";
import { ACTOR } from "../../physical-binding/__tests__/fixtures";

export const NOW = "2026-07-19T12:00:00.000Z";

export function footprintDef(): FootprintDef {
  return { libName: "Test", name: "TwoPad", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [
    { number: "1", type: "smd", shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1) }, at: { x: -mmToNm(1), y: 0 }, rotationDeg: 0, layers: ["copperTop", "maskTop", "pasteTop"] },
    { number: "2", type: "smd", shape: { kind: "rect", width: mmToNm(1), height: mmToNm(1) }, at: { x: mmToNm(1), y: 0 }, rotationDeg: 0, layers: ["copperTop", "maskTop", "pasteTop"] },
  ], graphics: [], bodyBBox: { minX: -mmToNm(2), minY: -mmToNm(1), maxX: mmToNm(2), maxY: mmToNm(1) }, models: [], rawSexpr: "(footprint TwoPad)" };
}

export function snapshotBase(componentIds = ["sync-u1"]): Omit<PcbSyncAuthoritativeSnapshot, "snapshotDigest"> {
  const components = componentIds.map((componentInstanceId, index) => ({ componentInstanceId, componentRevision: `schematic-component:${componentInstanceId}:r1`, referenceDesignator: `U${index + 1}`, hierarchyPath: ["root", "motor-control"], symbolAssetVersionId: "symbol-stm32:r2", applicability: "applicable" as const, pins: [
    { pinInstanceId: `${componentInstanceId}:pin:1`, number: "1", disposition: "connected" as const },
    { pinInstanceId: `${componentInstanceId}:pin:2`, number: "2", disposition: "unconnected" as const },
  ] }));
  const nets = componentIds.map((componentInstanceId, index) => ({ stableNetId: `stable-net-${index + 1}`, connectivityRevision: `net-r${index + 1}`, canonicalScope: [], displayName: `SIG${index + 1}`, aliases: [], classification: "signal" as const, members: [{ componentInstanceId, pinInstanceId: `${componentInstanceId}:pin:1`, pinNumber: "1" }], explicitNoConnectPinIds: [], constraintRefs: [] }));
  return { schemaVersion: "sirkit.pcb-sync-snapshot.v1", tenantId: "tenant-1", projectId: "project-1", branchId: "main", designId: "design-1", projectRevision: "project-r1", designRevision: "design-r1", schematicRevision: "schematic-r1", schematicDigest: "schematic-digest-r1", componentSetRevision: "component-set-r1", netGraphRevision: "net-graph-r1", netGraphDigest: "net-graph-digest-r1", assemblyVariantId: "variant-default", assemblyVariantRevision: "variant-r1", librarySnapshotRevision: "library-r1", components, nets, prerequisiteIssues: [], newBoardTemplate: createEmptyBoard() };
}

export function snapshot(componentIds = ["sync-u1"]): PcbSyncAuthoritativeSnapshot {
  const base = snapshotBase(componentIds);
  return { ...base, snapshotDigest: authoritativeSnapshotDigest(base) };
}

export function preflightRequest(options: Partial<PcbSyncPreflightRequest> = {}): PcbSyncPreflightRequest {
  return { requestSchemaVersion: "sirkit.pcb-sync-preflight-request.v1", requestId: "preflight-1", tenantId: "tenant-1", projectId: "project-1", branchId: "main", designId: "design-1", schematicRevision: "schematic-r1", assemblyVariantId: "variant-default", target: { kind: "new_board", boardId: "board-1", boardName: "Main Board", boardFormatVersion: "sirkit-json-pcb/1" }, resolutionPolicyId: "sirkit.default-footprint-resolution", resolutionPolicyVersion: "1.0.0", syncPolicyId: "sirkit.safe-pcb-sync", syncPolicyVersion: "1.0.0", actorContext: ACTOR, requestedAt: NOW, mode: "prepare_apply", ...options };
}

export function applyRequest(plan: { planId: string; planDigest: string }, options: Partial<PcbSyncApplyRequest> = {}): PcbSyncApplyRequest {
  return { requestSchemaVersion: "sirkit.pcb-sync-apply-request.v1", requestId: "apply-1", tenantId: "tenant-1", projectId: "project-1", branchId: "main", designId: "design-1", boardId: "board-1", planId: plan.planId, planDigest: plan.planDigest, expectedPlanLifecycle: "applicable", confirmation: "apply_exact_plan", idempotencyKey: "apply-key-1", warningAcknowledgements: [], actorContext: ACTOR, requestedAt: "2026-07-19T12:01:00.000Z", ...options };
}

export async function readyHarness(componentId = "sync-u1", options: { snapshot?: PcbSyncAuthoritativeSnapshot; board?: PcbBoard } = {}) {
  const stage2 = await readyRepository(componentId);
  const binding = stage2.binding;
  const def = footprintDef();
  const mappingBase = { schemaVersion: "sirkit.verified-pin-pad-mapping.v1" as const, mappingCertificateId: binding.pinPadMapping.mappingCertificateId!, verifierVersion: "stage3-test-mapper/1", state: "verified" as const, symbolAssetVersionId: binding.pinPadMapping.symbolAssetVersionId!, footprintAssetVersionId: binding.footprint!.assetVersionId, footprintContentDigest: binding.footprint!.contentDigest!, entries: [
    { symbolPinNumber: "1", pinInstanceId: `${componentId}:pin:1`, padNumbers: ["1"], mappingKind: "electrical" as const },
    { symbolPinNumber: "2", pinInstanceId: `${componentId}:pin:2`, padNumbers: ["2"], mappingKind: "electrical" as const },
  ], mechanicalPadNumbers: [], evidenceRefs: ["mapping-evidence"] };
  const mapping = { ...mappingBase, artifactDigest: pcbSyncDigest(mappingBase) };
  const materializationBase = { componentInstanceId: componentId, bindingRevisionId: binding.revisionId, assetVersionId: binding.footprint!.assetVersionId, assetContentDigest: binding.footprint!.contentDigest!, assetSemanticDigest: binding.footprint!.semanticDigest, footprintFullName: `${def.libName}:${def.name}`, footprintDef: def, mapping };
  const materialization: PcbSyncFootprintMaterialization = { ...materializationBase, materializationDigest: pcbSyncDigest({ ...materializationBase, footprintDef: { libName: def.libName, name: def.name, pads: def.pads } }) };
  const snap = options.snapshot ?? snapshot([componentId]);
  const snapshotProvider = new InMemoryPcbSyncSnapshotProvider([snap]);
  const resourceProvider = new InMemoryPcbSyncResourceProvider({ [componentId]: materialization });
  const repository = new InMemoryPcbSyncRepository();
  if (options.board) repository.seedBoard(makeBoardRecord({ tenantId: "tenant-1", projectId: "project-1", branchId: "main", boardId: "board-1", board: options.board, updatedAt: NOW }));
  const resolver = new FootprintResolutionService(stage2.repository, { clock: () => NOW });
  // Fixed trusted clock: plans are created at the fixture's requestedAt (NOW)
  // and expire after policy.planTtlMs, so a real-time clock makes every test
  // fail with PS_PLAN_EXPIRED once the fixture dates age past the TTL.
  const service = new PcbSynchronizationService({ snapshotProvider, resolver, resourceProvider, repository, clock: () => "2026-07-19T12:01:00.000Z" });
  return { service, repository, snapshotProvider, resourceProvider, resolver, stage2, materialization, snapshot: snap };
}
