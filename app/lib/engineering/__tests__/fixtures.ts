import { createEmptyBoard, type FootprintInstance, type Track } from "../../pcb/types";
import type { DrcRules } from "../../pcb/drc/types";
import type { CanonicalProjectState, EngineeringActor, EngineeringOperation, EngineeringTransaction, ProjectRole } from "../types";
import { computeProjectRevision } from "../revision";
import { createEngineeringTransaction } from "../transaction-service";

function footprint(id: string, x: number): FootprintInstance {
  return { id, ref: id.toUpperCase(), footprintId: "test:empty", def: { libName: "test", name: "empty", attributes: { smd: true, throughHole: false, excludeFromPos: false, excludeFromBom: false }, pads: [], graphics: [], bodyBBox: { minX: -500_000, minY: -500_000, maxX: 500_000, maxY: 500_000 }, models: [], rawSexpr: "(footprint test)" }, at: { x, y: 2_000_000 }, rotationDeg: 0, side: "top", padNets: {} };
}

export function projectFixture(): CanonicalProjectState {
  const pcb = createEmptyBoard(); pcb.nets.push({ id: 1, name: "SIG", stableId: "net:sig", endpointKeys: [] }); pcb.footprints.push(footprint("u1", 2_000_000), footprint("u2", 8_000_000));
  return { schemaVersion: "sirkit.engineering.v1", tenantId: "tenant-a", projectId: "project-a", branchId: "main", pcb, schematic: { version: 1, components: [] }, pinnedAssets: [] };
}

export function actor(role: ProjectRole = "project_admin", id: string = role): EngineeringActor { return { actorId: id, actorKind: role === "automation" ? "automated_engine" : "human", sessionId: `session:${id}`, role }; }

export function track(id: string, y = 3_000_000): Track { return { id, layer: "copperTop", width: 250_000, start: { x: 1_000_000, y }, end: { x: 5_000_000, y }, netId: 1, source: "human" }; }

export function transaction(project: CanonicalProjectState, operations: EngineeringOperation[], input?: { role?: ProjectRole; actorId?: string; clientOperationId?: string; transactionId?: string; baseRevision?: ReturnType<typeof computeProjectRevision> }): EngineeringTransaction {
  const baseRevision = input?.baseRevision ?? computeProjectRevision(project); const clientOperationId = input?.clientOperationId ?? `client:${operations.map((item) => item.operationId).join("+")}`;
  return createEngineeringTransaction({ transactionId: input?.transactionId ?? `tx:${clientOperationId}`, projectId: project.projectId, branchId: project.branchId, clientOperationId, actor: actor(input?.role, input?.actorId), reason: "Stage 10 test transaction", baseRevision, operations, approvals: [], provenance: { source: "api", toolVersion: "test" }, createdAtClient: "2026-07-17T00:00:00.000Z" });
}

export const ZERO_DRC_RULES: DrcRules = { default: { clearanceNm: 0, minTrackWidthNm: 0, minViaOuterNm: 0, minViaDrillNm: 0, minAnnularRingNm: 0, minPthAnnularRingNm: 0, minHoleToHoleNm: 0, minEdgeClearanceNm: 0, minSilkPadClearanceNm: 0, minCourtyardClearanceNm: 0 }, perClass: {} };
