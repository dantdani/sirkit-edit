import type { BBox, Vec2 } from "../geometry";
import { footprintWorldBBox } from "../edit/arrange";
import { worldCourtyardBBox } from "../autoplace/geometry";
import { buildPlacementEnvelope, validBBox } from "../autoplace/envelope";
import { analyzePlacementRouteability } from "../autoplace/routeability";
import { padCopperLayers, padWorldPosition, viaSpannedLayers } from "../geometry-copper";
import { getBoardStackup } from "../stackup";
import { getNetClass } from "../netclass";
import { runDrc, buildDrcContext } from "../drc/run-drc";
import { getPreset } from "../drc/presets";
import type { DrcResult, DrcRules } from "../drc/types";
import type { LayerId } from "../layers";
import { LAYERS } from "../layers";
import type { PcbBoard } from "../types";
import type { PcbEngineeringEvent } from "../history";
import { normalizeDrcReport, type NormalizedDrcViolation } from "./violation-normalizer";
import { computeElectricalTruth, type ElectricalTruthReport } from "../electrical-truth";
import { pcbRevisionId } from "../revision";
import { physicalPadInstances } from "../pad-identity";
import type { PcbNetlist } from "../netlist-bridge";
import type { DrcPreset } from "../drc/types";
import type { FabPreset } from "../fab/types";
import { getFabPreset } from "../fab/presets";
import { evaluatePcbFabricationReadiness } from "../readiness/evaluate";
import type { ReadinessReport } from "../readiness/types";
import { zoneFillIsCurrent } from "../zones/fill-lifecycle";

export { pcbRevisionId } from "../revision";

const NM_PER_MM = 1_000_000;

export interface AIPcbSnapshotOptions {
  projectId?: string;
  schematicRevisionId?: string;
  /** Authoritative current schematic intent. Absence means parity is unknown. */
  netlist?: PcbNetlist;
  drcPreset?: DrcPreset;
  fabPreset?: FabPreset;
  rules?: DrcRules;
  drcResult?: DrcResult;
  visibleLayers?: Partial<Record<LayerId, boolean>>;
  events?: readonly PcbEngineeringEvent[];
}

export interface AIPcbSnapshot {
  schemaVersion: "sirkit.ai-pcb.v3";
  projectId: string;
  boardRevisionId: string;
  schematicRevisionId: string;
  units: "mm";
  board: unknown;
  stackup: unknown;
  footprints: unknown[];
  pads: unknown[];
  nets: unknown[];
  tracks: unknown[];
  vias: unknown[];
  zones: unknown[];
  keepouts: unknown[];
  rules: unknown[];
  connectivity: unknown;
  electricalTruth: unknown;
  drcSummary: {
    errors: number;
    warnings: number;
    violations: NormalizedDrcViolation[];
  };
  layerUsage: unknown[];
  readiness: ReadinessReport;
  placement: unknown;
  changeHistory: readonly PcbEngineeringEvent[];
  generatedInMs: number;
}

export type SnapshotCollectionName = "footprints" | "pads" | "nets" | "tracks" | "vias" | "zones" | "keepouts";

export interface AIPcbSnapshotDiff {
  fromRevisionId: string;
  toRevisionId: string;
  changed: boolean;
  collections: Record<SnapshotCollectionName, { added: string[]; removed: string[]; changed: string[] }>;
  readinessChanged: boolean;
  drcChanged: boolean;
}

function snapshotItems(value: unknown[]): Map<string, unknown> {
  return new Map(value.flatMap((item) => {
    if (typeof item !== "object" || item === null || !("id" in item)) return [];
    return [[String((item as { id: unknown }).id), item] as const];
  }));
}

/** Deterministic ID-level diff used by stale previews, audit UI, and AI explanations. */
export function diffAIPcbSnapshots(before: AIPcbSnapshot, after: AIPcbSnapshot): AIPcbSnapshotDiff {
  const names: SnapshotCollectionName[] = ["footprints", "pads", "nets", "tracks", "vias", "zones", "keepouts"];
  const collections = Object.fromEntries(names.map((name) => {
    const left = snapshotItems(before[name]);
    const right = snapshotItems(after[name]);
    return [name, {
      added: [...right.keys()].filter((id) => !left.has(id)).sort(),
      removed: [...left.keys()].filter((id) => !right.has(id)).sort(),
      changed: [...right.keys()].filter((id) => left.has(id) && JSON.stringify(left.get(id)) !== JSON.stringify(right.get(id))).sort(),
    }];
  })) as AIPcbSnapshotDiff["collections"];
  const readinessChanged = JSON.stringify(before.readiness) !== JSON.stringify(after.readiness);
  const drcChanged = JSON.stringify(before.drcSummary) !== JSON.stringify(after.drcSummary);
  return {
    fromRevisionId: before.boardRevisionId,
    toRevisionId: after.boardRevisionId,
    changed: before.boardRevisionId !== after.boardRevisionId || readinessChanged || drcChanged,
    collections,
    readinessChanged,
    drcChanged,
  };
}

const pointMm = (point: Vec2): Vec2 => ({ x: point.x / NM_PER_MM, y: point.y / NM_PER_MM });
const bboxMm = (bounds: BBox): BBox => ({
  minX: bounds.minX / NM_PER_MM,
  minY: bounds.minY / NM_PER_MM,
  maxX: bounds.maxX / NM_PER_MM,
  maxY: bounds.maxY / NM_PER_MM,
});

function serializableElectricalTruth(report: ElectricalTruthReport): unknown {
  return {
    schemaVersion: report.schemaVersion,
    designRevision: report.designRevision,
    units: report.units,
    intended: report.intended,
    assigned: {
      state: report.assigned.state,
      terminalGroups: report.assigned.terminalGroups,
      missingEndpointKeys: report.assigned.missingEndpointKeys,
      unaccountedPadInstanceIds: report.assigned.unaccountedPadInstanceIds,
    },
    realized: {
      state: report.realized.state,
      requiredConnections: report.realized.requiredConnections,
      completedConnections: report.realized.completedConnections,
      remainingConnections: report.realized.remainingConnections,
      routedNets: report.realized.routedNets,
      totalNets: report.realized.totalNets,
      percent: report.realized.percent,
    },
    nets: report.nets,
    shorts: report.shorts,
    orphanCopper: report.orphanCopper,
    unresolved: report.unresolved,
    diagnosticCodes: [...new Set(report.diagnostics.map((diagnostic) => diagnostic.code))].sort(),
  };
}

function outlineSnapshot(board: PcbBoard): unknown {
  const outline = board.outline;
  if (outline.kind === "polygon") return { kind: outline.kind, points: outline.points.map(pointMm) };
  return {
    kind: outline.kind,
    origin: pointMm(outline.origin),
    width: outline.width / NM_PER_MM,
    height: outline.height / NM_PER_MM,
    ...(outline.kind === "roundrect" ? { cornerRadius: outline.cornerRadius / NM_PER_MM } : {}),
  };
}

export function buildAIPcbSnapshot(board: PcbBoard, options: AIPcbSnapshotOptions = {}): AIPcbSnapshot {
  const started = performance.now();
  const defaultPreset = getPreset(board.stackup === 4 ? "jlcpcb-4l" : "jlcpcb-2l");
  const drcPreset = options.drcPreset ?? { ...defaultPreset, rules: options.rules ?? defaultPreset.rules };
  const fabPreset = options.fabPreset ?? getFabPreset(board.stackup === 4 ? "jlcpcb-4l" : "jlcpcb-2l");
  const rules = drcPreset.rules;
  const electricalTruth = computeElectricalTruth(board);
  const drc = options.drcResult?.designRevision === electricalTruth.designRevision
    ? options.drcResult
    : runDrc(board, rules, { presetId: drcPreset.id, electricalReport: electricalTruth });
  const normalized = normalizeDrcReport(board, drc);
  const drcContext = buildDrcContext(board, rules, electricalTruth);
  const envelopeScale = board.placementPreferences?.envelopeScale ?? 1.15;
  const stackup = getBoardStackup(board);

  const footprints = board.footprints.map((footprint) => {
    const envelope = buildPlacementEnvelope(board, footprint, { scale: envelopeScale, rules });
    const courtyard = validBBox(footprint.def.courtyardBBox)
      ? worldCourtyardBBox(footprint.def.courtyardBBox, footprint.at, footprint.rotationDeg, footprint.side === "bottom")
      : undefined;
    return {
      id: footprint.id,
      reference: footprint.ref,
      value: footprint.def.name,
      footprintName: `${footprint.def.libName}:${footprint.def.name}`,
      position: pointMm(footprint.at),
      rotationDeg: footprint.rotationDeg,
      side: footprint.side === "top" ? "front" : "back",
      locked: footprint.locked === true || footprint.placementConstraints?.fixedPosition === true ||
        footprint.placementConstraints?.mechanical === true || footprint.placementConstraints?.edgeConnector !== undefined,
      bodyBounds: bboxMm(footprintWorldBBox(footprint)),
      ...(courtyard ? { courtyardBounds: bboxMm(courtyard) } : {}),
      placementEnvelope: bboxMm(
        worldCourtyardBBox(envelope.effectiveBounds, footprint.at, footprint.rotationDeg, footprint.side === "bottom"),
      ),
      placementEnvelopeScale: envelope.scale,
      placementEnvelopeSource: envelope.source,
      routingMarginMm: envelope.routingMarginNm / NM_PER_MM,
      padIds: physicalPadInstances(footprint).map((pad) => pad.id),
      pinPadMappings: footprint.pinPadMappings ?? [],
      constraints: [
        ...(footprint.locked ? ["locked"] : []),
        ...(footprint.placementConstraints?.fixedPosition ? ["fixed_position"] : []),
        ...(footprint.placementConstraints?.mechanical ? ["mechanical"] : []),
        ...(footprint.placementConstraints?.edgeConnector ? [`edge_connector:${footprint.placementConstraints.edgeConnector}`] : []),
        ...(footprint.placementConstraints?.allowedRotations?.map((rotation) => `rotation:${rotation}`) ?? []),
        ...(footprint.placementConstraints?.criticalRole ? [`critical:${footprint.placementConstraints.criticalRole}`] : []),
        ...(footprint.bodyMayOverhang === true ? ["body_overhang_allowed"] : []),
      ],
    };
  });

  const pads = board.footprints.flatMap((footprint) => physicalPadInstances(footprint).map((physicalPad) => {
    const pad = physicalPad.pad;
    return {
    id: physicalPad.id,
    footprintId: footprint.id,
    reference: `${footprint.ref}.${pad.number}`,
    netId: String(footprint.padNets[pad.number] ?? 0),
    position: pointMm(padWorldPosition(footprint, pad)),
    type: pad.type,
    shape: pad.shape,
    layers: padCopperLayers(footprint, pad),
    ...(pad.drill ? { drillMm: pad.drill.diameter / NM_PER_MM } : {}),
  }; }));

  const nets = board.nets.filter((net) => net.id !== 0).map((net) => {
    const state = electricalTruth.nets.find((candidate) => candidate.netId === net.id);
    const netClass = getNetClass(board, net.id);
    const resolved = drcContext.eff(net.id);
    return {
      id: String(net.id),
      stableId: net.stableId,
      endpointKeys: net.endpointKeys ?? [],
      name: net.name || `net${net.id}`,
      classId: netClass.id,
      padIds: pads.filter((pad) => pad.netId === String(net.id)).map((pad) => pad.id),
      trackIds: board.tracks.filter((track) => track.netId === net.id).map((track) => track.id),
      viaIds: board.vias.filter((via) => via.netId === net.id).map((via) => via.id),
      electricalState: state?.state ?? "unknown",
      complete: state?.realizationState === "proven" && state.remainingConnections === 0,
      requiredConnections: state?.requiredConnections ?? 0,
      completedConnections: state?.completedConnections ?? 0,
      remainingConnections: state?.remainingConnections ?? 0,
      resolvedConstraints: {
        preferredTrackWidthMm: netClass.trackWidth / NM_PER_MM,
        minimumTrackWidthMm: resolved.minTrackWidthNm / NM_PER_MM,
        clearanceMm: resolved.clearanceNm / NM_PER_MM,
        viaDiameterMm: Math.max(netClass.viaSize, resolved.minViaOuterNm) / NM_PER_MM,
        viaDrillMm: Math.max(netClass.viaDrill, resolved.minViaDrillNm) / NM_PER_MM,
      },
    };
  });

  const tracks = board.tracks.map((track) => ({
    id: track.id,
    netId: String(track.netId),
    layerId: track.layer,
    widthMm: track.width / NM_PER_MM,
    geometry: [pointMm(track.start), pointMm(track.end)],
    locked: track.locked === true,
    source: track.source ?? "imported",
  }));
  const vias = board.vias.map((via) => ({
    id: via.id,
    netId: String(via.netId),
    position: pointMm(via.at),
    diameterMm: via.size / NM_PER_MM,
    drillMm: via.drill / NM_PER_MM,
    startLayerId: via.layers[0],
    endLayerId: via.layers[1],
    locked: via.locked === true,
    source: via.source ?? "imported",
  }));
  const zones = board.zones.map((zone) => ({
    id: zone.id,
    netId: String(zone.netId),
    layerId: zone.layer,
    polygon: zone.polygon.map(pointMm),
    dirty: zone.dirty,
    source: zone.source ?? "user",
    priority: zone.priority ?? 0,
    fillStatus: zone.fillState?.status ?? "legacy-unproven",
    fillCurrent: zoneFillIsCurrent(board, zone),
    fillHash: zone.fillState?.fillHash,
    filledRegionCount: zone.fill.length,
    filledAreaMm2: zoneFillIsCurrent(board, zone)
      ? zone.fill.reduce((sum, region) => sum + region.areaNm2, 0) / (NM_PER_MM * NM_PER_MM)
      : 0,
    cachedStaleAreaMm2: zoneFillIsCurrent(board, zone)
      ? 0
      : zone.fill.reduce((sum, region) => sum + region.areaNm2, 0) / (NM_PER_MM * NM_PER_MM),
    thermalAccessCount: zone.fillState?.stats?.thermalAccessCount ?? 0,
    clearanceMm: (zone.clearanceOverrideNm ?? getNetClass(board, zone.netId).clearance) / NM_PER_MM,
  }));

  const incompleteNetIds = new Set(
    electricalTruth.nets.filter((net) => net.remainingConnections > 0).map((net) => String(net.netId)),
  );
  const layerUsage = stackup.copperLayers.filter((layer) => layer.enabled).map((layer) => {
    const layerViolations = normalized.filter((violation) => violation.layerIds.includes(layer.id));
    const layerTracks = board.tracks.filter((track) => track.layer === layer.id);
    const layerZones = board.zones.filter((zone) => zone.layer === layer.id);
    const currentLayerZones = layerZones.filter((zone) => zoneFillIsCurrent(board, zone));
    return {
      layerId: layer.id,
      name: layer.name,
      role: layer.role,
      visibleInUi: options.visibleLayers?.[layer.id] ?? LAYERS.find((candidate) => candidate.id === layer.id)?.defaultVisible ?? true,
      trackCount: layerTracks.length,
      totalTrackLengthMm: layerTracks.reduce((sum, track) => sum + Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y), 0) / NM_PER_MM,
      viaTransitions: board.vias.filter((via) => viaSpannedLayers(via).includes(layer.id)).length,
      zoneCount: layerZones.length,
      zoneIds: layerZones.map((zone) => zone.id).sort(),
      stableNetIds: [...new Set(currentLayerZones.map((zone) => board.nets.find((net) => net.id === zone.netId)?.stableId).filter((id): id is string => Boolean(id)))].sort(),
      fillStatuses: layerZones.map((zone) => zone.fillState?.status ?? "legacy-unproven").sort(),
      filledAreaMm2: currentLayerZones.flatMap((zone) => zone.fill).reduce((sum, region) => sum + region.areaNm2, 0) / (NM_PER_MM * NM_PER_MM),
      thermalAccessCount: currentLayerZones.reduce((sum, zone) => sum + (zone.fillState?.stats?.thermalAccessCount ?? 0), 0),
      violationIds: layerViolations.map((violation) => violation.id),
      unroutedNetIds: [...incompleteNetIds],
    };
  });

  const readiness = evaluatePcbFabricationReadiness({
    board,
    netlist: options.netlist,
    fabPreset,
    drcPreset,
    electricalTruth,
    drcResult: drc,
  });

  return {
    schemaVersion: "sirkit.ai-pcb.v3",
    projectId: options.projectId ?? "local-project",
    boardRevisionId: pcbRevisionId(board),
    schematicRevisionId: options.schematicRevisionId ?? readiness.parity.schematicRevision ?? "unknown",
    units: "mm",
    board: { outline: outlineSnapshot(board), stackupLayers: board.stackup, formatVersion: board.formatVersion },
    stackup,
    footprints,
    pads,
    nets,
    tracks,
    vias,
    zones,
    keepouts: (board.routingKeepouts ?? []).map((keepout) => ({ ...keepout, polygon: keepout.polygon.map(pointMm) })),
    rules: nets.map((net) => ({ netId: net.id, netName: net.name, ...net.resolvedConstraints })),
    connectivity: {
      completion: {
        routedNets: electricalTruth.realized.routedNets,
        totalNets: electricalTruth.realized.totalNets,
        percent: electricalTruth.realized.percent,
      },
      nets: electricalTruth.nets.map((net) => ({
        netId: String(net.netId),
        stableNetId: net.stableNetId,
        state: net.state,
        complete: net.realizationState === "proven" && net.remainingConnections === 0,
        clusters: net.conductiveClusters,
      })),
      airwires: electricalTruth.realized.airwires.map((wire) => ({ netId: String(wire.netId), from: pointMm(wire.from), to: pointMm(wire.to) })),
      shorts: electricalTruth.shorts.map((short) => short.objectIds),
      orphans: electricalTruth.orphanCopper.map((orphan) => orphan.objectId),
    },
    electricalTruth: serializableElectricalTruth(electricalTruth),
    drcSummary: {
      errors: normalized.filter((violation) => violation.severity === "error").length,
      warnings: normalized.filter((violation) => violation.severity === "warning").length,
      violations: normalized,
    },
    layerUsage,
    readiness,
    placement: analyzePlacementRouteability(board, { envelopeScale }),
    changeHistory: options.events ?? [],
    generatedInMs: Math.round((performance.now() - started) * 10) / 10,
  };
}
