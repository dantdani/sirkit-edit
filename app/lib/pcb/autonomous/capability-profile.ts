import type { DrcRules } from "../drc/types";
import { computeElectricalTruth } from "../electrical-truth";
import { canonicalJson, pcbRevisionId } from "../revision";
import { stableHash } from "../smart-routing/hash";
import { getBoardStackup, routableCopperLayers } from "../stackup";
import type { PcbBoard } from "../types";
import { zoneFillIsCurrent } from "../zones/fill-lifecycle";
import { compareCodePoints } from "@/app/lib/stable-compare";

export const AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1 = {
  id: "sirkit.autonomous-pcb-capability.v1",
  version: 1,
  limits: {
    maxBoardWidthNm: 100_000_000,
    maxBoardHeightNm: 80_000_000,
    maxBoardAreaNm2: 8_000_000_000_000_000,
    maxComponents: 25,
    maxPads: 64,
    maxNets: 30,
    maxRequiredConnections: 30,
    maxPlacementCandidates: 4,
    maxRoutedCandidates: 2,
    maxRuntimeMs: 180_000,
  },
  supportedPackageClasses: ["passive_smd_0603_0805", "soic_tssop", "through_hole_header", "non_hdi_other"],
  routing: { copperLayers: ["copperTop", "copperBottom"], viaType: "through" },
} as const;

export type AutonomousPackageClass =
  | (typeof AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.supportedPackageClasses)[number]
  | "bga_hdi"
  | "unknown";

export interface AutonomousDesignDeclaration {
  schemaVersion: "sirkit.autonomous-design-declaration.v1";
  declarationId: string;
  revision: string;
  electricalClass: "ordinary_low_speed_low_voltage" | "high_speed" | "rf" | "high_voltage" | "unknown";
  currentThermalClass: "ordinary" | "high_current_or_thermal_critical" | "unknown";
  construction: "rigid_standard" | "flex_rigid_flex" | "special_fabrication" | "unknown";
  safetyClass: "ordinary" | "mains_or_safety_critical" | "unknown";
  criticalPlacement:
    | { status: "none"; constraintIds: [] }
    | { status: "fully_declared"; constraintIds: string[] }
    | { status: "required_but_missing"; constraintIds: string[] };
  footprintQualifications: Record<string, { packageClass: AutonomousPackageClass; authority: "proven" | "unknown" }>;
}

export type AutonomousCapabilityStatus = "eligible" | "unsupported" | "incomplete_authority" | "invalid";
export type AutonomousCapabilityPhase = "pre_placement" | "pre_autoroute" | "post_layout";

export interface AutonomousCapabilityBlocker {
  code: string;
  category: "unsupported" | "authority" | "invalid" | "limit" | "stale";
  message: string;
  objectIds: string[];
}

export interface AutonomousCapabilityEvaluation {
  schemaVersion: "sirkit.autonomous-capability-evaluation.v1";
  profileId: typeof AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.id;
  profileVersion: 1;
  phase: AutonomousCapabilityPhase;
  status: AutonomousCapabilityStatus;
  sourceRevision: string;
  declarationId?: string;
  declarationRevision?: string;
  rulesDigest: string;
  counts: { components: number; pads: number; nets: number; requiredConnections: number };
  board: { widthNm: number; heightNm: number; areaNm2: number; stackupLayers: number; routableLayerIds: string[] };
  blockers: AutonomousCapabilityBlocker[];
  warnings: string[];
  evaluationDigest: string;
  placementMayStart: boolean;
  autoroutingMayStart: boolean;
  manufacturingReleaseMayEventuallyBeConsidered: boolean;
}

export interface AutonomousCapabilityEvidence {
  placement?: { legal: boolean; overlapCount: number; outsideCount: number; padOutsideCount: number };
  routing?: { complete: boolean; remainingConnections: number; shorts: number; routeBlockingDrcErrors: number };
}

const supportedPackages = new Set<string>(AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1.supportedPackageClasses);

function outlineDimensions(board: PcbBoard): { widthNm: number; heightNm: number; areaNm2: number; supported: boolean } {
  if (board.outline.kind === "rect" || board.outline.kind === "roundrect") {
    return { widthNm: board.outline.width, heightNm: board.outline.height, areaNm2: board.outline.width * board.outline.height, supported: true };
  }
  const xs = board.outline.points.map((point) => point.x);
  const ys = board.outline.points.map((point) => point.y);
  const widthNm = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const heightNm = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  return { widthNm, heightNm, areaNm2: widthNm * heightNm, supported: false };
}

function blocker(code: string, category: AutonomousCapabilityBlocker["category"], message: string, objectIds: string[] = []): AutonomousCapabilityBlocker {
  return { code, category, message, objectIds: [...new Set(objectIds)].sort() };
}

/**
 * Canonical (key-order independent) so the digest survives persistence.
 * Authority is stored as Postgres jsonb, which does NOT preserve object key
 * order; a plain JSON.stringify digest would therefore change on every
 * round-trip and RC03 evidence could never be re-verified at release time.
 */
function rulesDigest(rules: DrcRules): string {
  return `rules-${stableHash(canonicalJson(rules))}`;
}

function rulesAreExplicit(rules: DrcRules): boolean {
  const values = [
    rules.default.clearanceNm,
    rules.default.minTrackWidthNm,
    rules.default.minViaOuterNm,
    rules.default.minViaDrillNm,
    rules.default.minAnnularRingNm,
    rules.default.minHoleToHoleNm,
    rules.default.minEdgeClearanceNm,
    rules.default.minSilkPadClearanceNm,
  ];
  return values.every((value) => Number.isFinite(value) && value > 0) &&
    Number.isFinite(rules.default.minCourtyardClearanceNm) && rules.default.minCourtyardClearanceNm >= 0;
}

function footprintAuthorityBlockers(board: PcbBoard, declaration: AutonomousDesignDeclaration | undefined): AutonomousCapabilityBlocker[] {
  const out: AutonomousCapabilityBlocker[] = [];
  for (const footprint of board.footprints) {
    const qualification = declaration?.footprintQualifications[footprint.footprintId];
    if (!qualification || qualification.authority !== "proven") {
      out.push(blocker("CAP_FOOTPRINT_QUALIFICATION_MISSING", "authority", `Footprint ${footprint.ref} lacks an exact autonomous package qualification.`, [footprint.id, footprint.footprintId]));
    } else if (!supportedPackages.has(qualification.packageClass)) {
      out.push(blocker("CAP_PACKAGE_UNSUPPORTED", "unsupported", `Footprint ${footprint.ref} uses unsupported package class ${qualification.packageClass}.`, [footprint.id, footprint.footprintId]));
    }
    if (!footprint.syncIdentity || !footprint.pinPadMappings) {
      out.push(blocker("CAP_FOOTPRINT_AUTHORITY_INCOMPLETE", "authority", `Footprint ${footprint.ref} lacks RC01 binding/mapping authority.`, [footprint.id]));
      continue;
    }
    const mappedPads = new Set(footprint.pinPadMappings.flatMap((mapping) => mapping.padNumbers));
    const endpointKeys = new Set(board.nets.flatMap((net) => net.endpointKeys ?? []));
    for (const mapping of footprint.pinPadMappings) {
      if (mapping.provenance === "legacy-inferred" || !endpointKeys.has(mapping.endpointKey)) {
        out.push(blocker("CAP_PIN_PAD_PARITY_UNPROVEN", "authority", `Footprint ${footprint.ref} has an unproven pin/pad mapping.`, [footprint.id, mapping.endpointKey]));
      }
    }
    for (const pad of footprint.def.pads) {
      const connected = (footprint.padNets[pad.number] ?? 0) !== 0;
      if (connected && !mappedPads.has(pad.number)) out.push(blocker("CAP_CONNECTED_PAD_UNMAPPED", "authority", `Connected pad ${footprint.ref}.${pad.number} is not covered by exact mapping authority.`, [footprint.id, pad.number]));
    }
  }
  return out;
}

function statusFor(blockers: AutonomousCapabilityBlocker[]): AutonomousCapabilityStatus {
  if (blockers.some((item) => item.category === "invalid" || item.category === "stale")) return "invalid";
  if (blockers.some((item) => item.category === "unsupported" || item.category === "limit")) return "unsupported";
  return blockers.length > 0 ? "incomplete_authority" : "eligible";
}

export function evaluateAutonomousCapability(input: {
  board: PcbBoard;
  rules: DrcRules;
  declaration?: AutonomousDesignDeclaration;
  phase?: AutonomousCapabilityPhase;
  expectedSourceRevision?: string;
  evidence?: AutonomousCapabilityEvidence;
}): AutonomousCapabilityEvaluation {
  const profile = AUTONOMOUS_PCB_CAPABILITY_PROFILE_V1;
  const phase = input.phase ?? "pre_placement";
  const sourceRevision = pcbRevisionId(input.board);
  const dimensions = outlineDimensions(input.board);
  const truth = computeElectricalTruth(input.board);
  const stackup = getBoardStackup(input.board);
  const routable = routableCopperLayers(input.board);
  const counts = {
    components: input.board.footprints.length,
    pads: input.board.footprints.reduce((sum, footprint) => sum + footprint.def.pads.length, 0),
    nets: input.board.nets.filter((net) => net.id !== 0).length,
    requiredConnections: truth.realized.requiredConnections,
  };
  const blockers: AutonomousCapabilityBlocker[] = [];
  const declaration = input.declaration;

  if (input.expectedSourceRevision && input.expectedSourceRevision !== sourceRevision) blockers.push(blocker("CAP_SOURCE_REVISION_STALE", "stale", "Capability evidence belongs to a different semantic PCB revision.", [input.expectedSourceRevision, sourceRevision]));
  if (!dimensions.supported) blockers.push(blocker("CAP_OUTLINE_UNSUPPORTED", "unsupported", "Autonomous v1 supports rectangular and rounded-rectangular closed outlines only."));
  if (!(dimensions.widthNm > 0 && dimensions.heightNm > 0 && Number.isSafeInteger(dimensions.widthNm) && Number.isSafeInteger(dimensions.heightNm))) blockers.push(blocker("CAP_OUTLINE_INVALID", "invalid", "Board outline dimensions must be positive safe integer nanometres."));
  if (dimensions.widthNm > profile.limits.maxBoardWidthNm || dimensions.heightNm > profile.limits.maxBoardHeightNm || dimensions.areaNm2 > profile.limits.maxBoardAreaNm2) blockers.push(blocker("CAP_BOARD_LIMIT_EXCEEDED", "limit", "Board dimensions exceed the measured autonomous v1 envelope."));
  if (input.board.stackup !== 2 || stackup.copperLayers.length !== 2 || routable.map((layer) => layer.id).join(",") !== "copperTop,copperBottom") blockers.push(blocker("CAP_TWO_LAYER_SIGNAL_STACKUP_REQUIRED", "unsupported", "Autonomous v1 requires exactly top and bottom routable signal copper."));
  if (stackup.copperLayers.some((layer) => layer.role === "plane" || layer.planeNetId !== undefined) || input.board.zones.some((zone) => zone.source === "stackup-plane")) blockers.push(blocker("CAP_NATIVE_PLANE_UNQUALIFIED", "unsupported", "Native plane reconciliation is not qualified for autonomous v1."));
  for (const via of input.board.vias) if (!(via.layers.includes("copperTop") && via.layers.includes("copperBottom"))) blockers.push(blocker("CAP_VIA_TYPE_UNSUPPORTED", "unsupported", "Only full top-to-bottom through-vias are supported.", [via.id]));
  for (const zone of input.board.zones) if (!zoneFillIsCurrent(input.board, zone)) blockers.push(blocker("CAP_ZONE_AUTHORITY_INCOMPLETE", "authority", "Every conductive zone must have a current fill proof before autonomous qualification.", [zone.id]));
  if (!rulesAreExplicit(input.rules)) blockers.push(blocker("CAP_MANUFACTURING_RULES_INCOMPLETE", "authority", "Manufacturer width, clearance, via, hole, edge, silk, and courtyard rules must be explicit."));

  if (!declaration) blockers.push(blocker("CAP_RISK_DECLARATION_MISSING", "authority", "An explicit versioned electrical/risk declaration is required; net names are never used as a substitute."));
  else {
    if (declaration.electricalClass === "unknown" || declaration.currentThermalClass === "unknown" || declaration.construction === "unknown" || declaration.safetyClass === "unknown") blockers.push(blocker("CAP_RISK_CLASSIFICATION_UNKNOWN", "authority", "Unknown electrical, thermal, construction, or safety classification is not eligible."));
    if (declaration.electricalClass !== "ordinary_low_speed_low_voltage" && declaration.electricalClass !== "unknown") blockers.push(blocker("CAP_ELECTRICAL_CLASS_UNSUPPORTED", "unsupported", `Electrical class ${declaration.electricalClass} is outside autonomous v1.`));
    if (declaration.currentThermalClass === "high_current_or_thermal_critical") blockers.push(blocker("CAP_THERMAL_CLASS_UNSUPPORTED", "unsupported", "High-current or thermal-critical layout requires analysis outside autonomous v1."));
    if (declaration.construction !== "rigid_standard" && declaration.construction !== "unknown") blockers.push(blocker("CAP_CONSTRUCTION_UNSUPPORTED", "unsupported", `Construction ${declaration.construction} is outside autonomous v1.`));
    if (declaration.safetyClass === "mains_or_safety_critical") blockers.push(blocker("CAP_SAFETY_CLASS_UNSUPPORTED", "unsupported", "Mains/high-voltage/safety-critical creepage is outside autonomous v1."));
    if (declaration.criticalPlacement.status === "required_but_missing") blockers.push(blocker("CAP_CRITICAL_PLACEMENT_METADATA_MISSING", "authority", "Declared critical placement intent lacks exact constraints."));
    if (declaration.criticalPlacement.status === "fully_declared") {
      const active = new Set(input.board.constraintState?.activeProgram?.activeConstraintIds ?? []);
      const missing = declaration.criticalPlacement.constraintIds.filter((id) => !active.has(id));
      if (missing.length) blockers.push(blocker("CAP_CRITICAL_PLACEMENT_CONSTRAINT_STALE", "authority", "Critical placement constraint IDs are absent from the active compiled program.", missing));
    }
  }
  blockers.push(...footprintAuthorityBlockers(input.board, declaration));
  if (truth.realized.state === "unknown" || truth.unresolved.length > 0) blockers.push(blocker("CAP_ELECTRICAL_AUTHORITY_INCOMPLETE", "authority", "Stable net/pad electrical truth is incomplete.", truth.unresolved.flatMap((item) => item.objectIds)));

  const limits = profile.limits;
  for (const [name, value, maximum] of [
    ["components", counts.components, limits.maxComponents],
    ["pads", counts.pads, limits.maxPads],
    ["nets", counts.nets, limits.maxNets],
    ["required connections", counts.requiredConnections, limits.maxRequiredConnections],
  ] as const) if (value > maximum) blockers.push(blocker("CAP_COUNT_LIMIT_EXCEEDED", "limit", `${name} count ${value} exceeds autonomous v1 maximum ${maximum}.`));

  if (input.board.footprints.some((footprint) => footprint.placementConstraints?.criticalRole) && declaration?.criticalPlacement.status === "none") blockers.push(blocker("CAP_CRITICAL_PLACEMENT_DECLARATION_MISSING", "authority", "A footprint declares critical placement intent but the design declaration says none.", input.board.footprints.filter((footprint) => footprint.placementConstraints?.criticalRole).map((footprint) => footprint.id)));
  if (phase !== "pre_placement") {
    const placement = input.evidence?.placement;
    if (!placement || !placement.legal || placement.overlapCount !== 0 || placement.outsideCount !== 0 || placement.padOutsideCount !== 0) blockers.push(blocker("CAP_PLACEMENT_NOT_PROVEN_LEGAL", "invalid", "Autorouting requires a freshly proven zero-overlap, inside-board placement."));
  }
  if (phase === "post_layout") {
    const routing = input.evidence?.routing;
    if (!routing || !routing.complete || routing.remainingConnections !== 0 || routing.shorts !== 0 || routing.routeBlockingDrcErrors !== 0) blockers.push(blocker("CAP_ROUTING_NOT_COMPLETE", "invalid", "Final layout requires zero remaining connections, shorts, and route-blocking DRC errors."));
  }

  const sortedBlockers = blockers.sort((left, right) => compareCodePoints(left.code, right.code) || compareCodePoints(left.objectIds.join(","), right.objectIds.join(",")));
  const status = statusFor(sortedBlockers);
  const base = {
    schemaVersion: "sirkit.autonomous-capability-evaluation.v1" as const,
    profileId: profile.id,
    profileVersion: 1 as const,
    phase,
    status,
    sourceRevision,
    ...(declaration ? { declarationId: declaration.declarationId, declarationRevision: declaration.revision } : {}),
    rulesDigest: rulesDigest(input.rules),
    counts,
    board: { widthNm: dimensions.widthNm, heightNm: dimensions.heightNm, areaNm2: dimensions.areaNm2, stackupLayers: input.board.stackup, routableLayerIds: routable.map((layer) => layer.id) },
    blockers: sortedBlockers,
    warnings: ["Eligibility is bounded capability evidence, not Gerber or manufacturing release authorization."],
  };
  const placementMayStart = status === "eligible" && phase === "pre_placement";
  const autoroutingMayStart = status === "eligible" && phase === "pre_autoroute";
  const manufacturingReleaseMayEventuallyBeConsidered = status === "eligible" && phase === "post_layout";
  return {
    ...base,
    // Canonical for the same reason as rulesDigest: this digest is compared
    // against a copy that has been through jsonb persistence.
    evaluationDigest: `cap1-${stableHash(canonicalJson({ ...base, placementMayStart, autoroutingMayStart, manufacturingReleaseMayEventuallyBeConsidered }))}`,
    placementMayStart,
    autoroutingMayStart,
    manufacturingReleaseMayEventuallyBeConsidered,
  };
}

export function capabilityEvaluationIsCurrent(evaluation: AutonomousCapabilityEvaluation, board: PcbBoard): boolean {
  return evaluation.sourceRevision === pcbRevisionId(board);
}
