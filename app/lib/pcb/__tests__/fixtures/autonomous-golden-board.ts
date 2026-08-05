import type { AutonomousDesignDeclaration } from "@/app/lib/pcb/autonomous/capability-profile";
import { createAutonomousRouteExecutor } from "@/app/lib/pcb/autonomous/production-router";
import type { AutonomousRouteExecutor } from "@/app/lib/pcb/autonomous/qualify-layout";
import { getPreset } from "@/app/lib/pcb/drc/presets";
import { getFabPreset } from "@/app/lib/pcb/fab/presets";
import { manufacturingRuleProfileDigest, type ManufacturingRuleProfile } from "@/app/lib/pcb/fab/release-manifest";
import { canonicalEndpointSet, schematicEndpointKey, stableNetIdForEndpoints } from "@/app/lib/pcb/integrity";
import type { PcbNetlist } from "@/app/lib/pcb/netlist-bridge";
import { pcbRevisionId } from "@/app/lib/pcb/revision";
import { stableHash } from "@/app/lib/pcb/smart-routing/hash";
import { setBoardStackupProfile } from "@/app/lib/pcb/stackup";
import { createEmptyBoard, type FootprintDef, type FootprintInstance, type PcbBoard } from "@/app/lib/pcb/types";
import { mmToNm } from "@/app/lib/pcb/units";

export const AUTONOMOUS_GOLDEN_FOOTPRINT_ID = "RC03:Header_1x01";
export const AUTONOMOUS_GOLDEN_SOURCE_DATE = "2026-07-21T00:00:00.000Z";
export const AUTONOMOUS_GOLDEN_SCOPE = Object.freeze({ tenantId: "tenant:demo", projectId: "project:rc03", branchId: "main", designId: "design:golden", boardId: "rc03-golden" });
export const AUTONOMOUS_GOLDEN_RULES = getPreset("jlcpcb-2l").rules;

const DEF: FootprintDef = {
  libName: "RC03", name: "Header_1x01", description: "RC03 qualified single-pin through-hole peripheral/header endpoint",
  attributes: { smd: false, throughHole: true, excludeFromPos: false, excludeFromBom: false },
  pads: [{ number: "1", type: "thru_hole", shape: { kind: "circle", radius: mmToNm(0.75) }, at: { x: 0, y: 0 }, rotationDeg: 0, layers: ["copperTop", "copperBottom"], drill: { diameter: mmToNm(0.8) }, plated: true }],
  graphics: [], courtyardBBox: { minX: mmToNm(-1.2), minY: mmToNm(-1.2), maxX: mmToNm(1.2), maxY: mmToNm(1.2) },
  bodyBBox: { minX: mmToNm(-1), minY: mmToNm(-1), maxX: mmToNm(1), maxY: mmToNm(1) }, models: [], rawSexpr: "",
};

function endpoint(componentId: string): string { return schematicEndpointKey(componentId, "1"); }

function component(index: number): FootprintInstance {
  const id = `j${index + 1}`;
  return {
    id, ref: `J${index + 1}`, footprintId: AUTONOMOUS_GOLDEN_FOOTPRINT_ID, def: DEF,
    at: { x: mmToNm(5 + (index % 5) * 8), y: mmToNm(6 + Math.floor(index / 5) * 10) }, rotationDeg: 0, side: "top", padNets: { "1": Math.floor(index / 3) + 1 },
    pinPadMappings: [{ componentInstanceId: id, endpointKey: endpoint(id), symbolPinNumber: "1", padNumbers: ["1"], mappingKind: "electrical", provenance: "exact-number" }],
    syncIdentity: { componentInstanceId: id, bindingRevisionId: `binding:${id}:1`, footprintAssetVersionId: "footprint:rc03-header-1x01:1", footprintContentDigest: "sha256:rc03-header-1x01", mappingCertificateId: `mapping:${id}:1`, symbolAssetVersionId: "symbol:resistor:1", syncPlanId: "sync-plan:rc03-golden:1" },
  };
}

export function buildAutonomousGoldenBoard(componentCount = 15): PcbBoard {
  const footprints = Array.from({ length: componentCount }, (_, index) => component(index));
  const nets = Array.from({ length: Math.ceil(componentCount / 3) }, (_, index) => {
    const name = `PERIPHERAL_${index + 1}`;
    const endpointKeys = canonicalEndpointSet(footprints.filter((_, memberIndex) => Math.floor(memberIndex / 3) === index).map((member) => endpoint(member.id)));
    return { id: index + 1, name, stableId: stableNetIdForEndpoints(endpointKeys, name), endpointKeys };
  });
  const board: PcbBoard = { ...createEmptyBoard(), outline: { kind: "rect", origin: { x: 0, y: 0 }, width: mmToNm(50), height: mmToNm(32) }, placementPolicy: { outlineSource: "user", allowBoardResize: false }, placementPreferences: { spacingPreset: "comfortable", envelopeScale: 1.15 }, nets: [{ id: 0, name: "", stableId: "net:unconnected", endpointKeys: [] }, ...nets], footprints };
  setBoardStackupProfile(board, "simple-2");
  return board;
}

export function autonomousGoldenDeclaration(overrides: Partial<AutonomousDesignDeclaration> = {}): AutonomousDesignDeclaration {
  return { schemaVersion: "sirkit.autonomous-design-declaration.v1", declarationId: "declaration:rc03-golden", revision: "2", electricalClass: "ordinary_low_speed_low_voltage", currentThermalClass: "ordinary", construction: "rigid_standard", safetyClass: "ordinary", criticalPlacement: { status: "none", constraintIds: [] }, footprintQualifications: { [AUTONOMOUS_GOLDEN_FOOTPRINT_ID]: { packageClass: "through_hole_header", authority: "proven" } }, ...overrides };
}

export function autonomousGoldenNetlist(board: PcbBoard): PcbNetlist {
  return {
    components: board.footprints.map((footprint) => ({ id: footprint.id, ref: footprint.ref, pins: (footprint.pinPadMappings ?? []).map((mapping) => ({ number: mapping.symbolPinNumber })) })),
    nets: board.nets.filter((net) => net.id !== 0).map((net) => ({ id: net.id, name: net.name, endpointKeys: canonicalEndpointSet(net.endpointKeys ?? []), nodes: canonicalEndpointSet(net.endpointKeys ?? []).map((key) => { const [componentId, pinNumber] = key.split("::"); return { componentId: decodeURIComponent(componentId), pinNumber: decodeURIComponent(pinNumber) }; }) })),
  };
}

export function autonomousGoldenNetIdentity(board: PcbBoard): { digest: string; nets: Array<{ id: number; name: string; stableId: string; endpointKeys: string[] }> } {
  const nets = board.nets.filter((net) => net.id !== 0).map((net) => ({ id: net.id, name: net.name, stableId: net.stableId ?? "", endpointKeys: canonicalEndpointSet(net.endpointKeys ?? []) })).sort((a, b) => a.id - b.id);
  return { digest: `golden-net-identity-${stableHash(JSON.stringify(nets))}`, nets };
}

export function buildAutonomousGoldenManufacturingRuleProfile(): ManufacturingRuleProfile {
  const drc = getPreset("jlcpcb-2l");
  const content: Omit<ManufacturingRuleProfile, "digest"> = {
    schemaVersion: "sirkit.manufacturing-rule-profile.v1", profileId: getFabPreset("jlcpcb-2l").id, version: 1, manufacturer: "JLCPCB", processName: "Economy rigid two-layer PTH prototype",
    evidence: { sourceRef: "controlled:jlcpcb-capabilities-and-kicad-guide:2026-07", verifiedAt: "2026-07-08" }, construction: { copperLayers: 2, copperThicknessUm: 35, boardThicknessMm: 1.6, material: "FR-4", maxBoardWidthMm: 100, maxBoardHeightMm: 80 },
    limitsNm: { minTraceWidth: drc.rules.default.minTrackWidthNm, minSpace: drc.rules.default.clearanceNm, minDrill: drc.rules.default.minViaDrillNm, minFinishedHole: drc.rules.default.minViaDrillNm, minAnnularRing: drc.rules.default.minAnnularRingNm, minCopperToEdge: drc.rules.default.minEdgeClearanceNm, minHoleToEdge: drc.rules.default.minEdgeClearanceNm, solderMaskExpansion: mmToNm(0.05), minSolderMaskSliver: mmToNm(0.1), minSilkscreenWidth: mmToNm(0.15), minSilkscreenClearance: drc.rules.default.minSilkPadClearanceNm },
    maskPolicy: { componentPads: "explicit_or_profile_opening", defaultViaTenting: "tented" }, specialFeatures: { slots: "unsupported", castellations: "unsupported", edgePlating: "unsupported", flex: "unsupported" }, assembly: { supported: false },
  };
  return { ...content, digest: manufacturingRuleProfileDigest(content) };
}

export async function createAutonomousGoldenRealRouter(): Promise<AutonomousRouteExecutor> {
  // The golden fixture routes through the exact production executor so RC03
  // qualification evidence describes the code path the live product runs.
  return createAutonomousRouteExecutor({ attemptNamespacePrefix: "rc03" });
}
