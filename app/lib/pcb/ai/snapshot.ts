import type { BBox, Vec2 } from "../geometry";
import { footprintWorldBBox } from "../edit/arrange";
import { worldCourtyardBBox } from "../autoplace/geometry";
import { buildPlacementEnvelope, validBBox } from "../autoplace/envelope";
import { analyzePlacementRouteability } from "../autoplace/routeability";
import { padCopperLayers, padWorldPosition, viaSpannedLayers } from "../geometry-copper";
import { computeConnectivity, type CopperItemRef } from "../connectivity-board";
import { getBoardStackup } from "../stackup";
import { getNetClass } from "../netclass";
import { runDrc, buildDrcContext } from "../drc/run-drc";
import { getPreset } from "../drc/presets";
import type { DrcResult, DrcRules } from "../drc/types";
import type { LayerId } from "../layers";
import { LAYERS } from "../layers";
import type { PcbBoard } from "../types";
import type { PcbEngineeringEvent } from "../history";
import { stableHash } from "../smart-routing/hash";
import { normalizeDrcReport, type NormalizedDrcViolation } from "./violation-normalizer";

const NM_PER_MM = 1_000_000;

export interface AIPcbSnapshotOptions {
  projectId?: string;
  schematicRevisionId?: string;
  schematicParity?: "pass" | "fail" | "unknown";
  rules?: DrcRules;
  drcResult?: DrcResult;
  visibleLayers?: Partial<Record<LayerId, boolean>>;
  events?: readonly PcbEngineeringEvent[];
}

export interface AIPcbSnapshot {
  schemaVersion: "sirkit.ai-pcb.v1";
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
  drcSummary: {
    errors: number;
    warnings: number;
    violations: NormalizedDrcViolation[];
  };
  layerUsage: unknown[];
  readiness: {
    geometryDrc: "clean" | "errors";
    connectivity: "complete" | "incomplete";
    schematicParity: "pass" | "fail" | "unknown";
    zonesCurrent: boolean;
    fabricationReadiness: "ready" | "not_ready";
  };
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

function refId(ref: CopperItemRef): string {
  if (ref.kind === "pad") return `pad:${ref.instanceId}:${ref.padNumber}`;
  if (ref.kind === "zone-region") return `zone:${ref.zoneId}:region:${ref.regionIndex}`;
  return `${ref.kind}:${ref.id}`;
}

export function pcbRevisionId(board: PcbBoard): string {
  const payload = {
    stackup: board.stackup,
    stackupConfig: board.stackupConfig,
    outline: board.outline,
    footprints: board.footprints.map((footprint) => ({
      id: footprint.id,
      at: footprint.at,
      rotationDeg: footprint.rotationDeg,
      side: footprint.side,
      locked: footprint.locked,
      placementConstraints: footprint.placementConstraints,
      padNets: footprint.padNets,
      pads: footprint.def.pads,
    })),
    tracks: board.tracks,
    vias: board.vias,
    zones: board.zones,
    keepouts: board.routingKeepouts,
    rules: board.netClassing,
    placementPreferences: board.placementPreferences,
  };
  return `pcb1-${stableHash(JSON.stringify(payload))}`;
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
  const rules = options.rules ?? getPreset(board.stackup === 4 ? "jlcpcb-4l" : "jlcpcb-2l").rules;
  const drc = options.drcResult ?? runDrc(board, rules);
  const normalized = normalizeDrcReport(board, drc);
  const connectivity = computeConnectivity(board);
  const drcContext = buildDrcContext(board, rules);
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
      padIds: footprint.def.pads.map((pad) => `pad:${footprint.id}:${pad.number}`),
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

  const pads = board.footprints.flatMap((footprint) => footprint.def.pads.map((pad) => ({
    id: `pad:${footprint.id}:${pad.number}`,
    footprintId: footprint.id,
    reference: `${footprint.ref}.${pad.number}`,
    netId: String(footprint.padNets[pad.number] ?? 0),
    position: pointMm(padWorldPosition(footprint, pad)),
    type: pad.type,
    shape: pad.shape,
    layers: padCopperLayers(footprint, pad),
    ...(pad.drill ? { drillMm: pad.drill.diameter / NM_PER_MM } : {}),
  })));

  const nets = board.nets.filter((net) => net.id !== 0).map((net) => {
    const state = connectivity.nets.get(net.id);
    const netClass = getNetClass(board, net.id);
    const resolved = drcContext.eff(net.id);
    return {
      id: String(net.id),
      name: net.name || `net${net.id}`,
      classId: netClass.id,
      padIds: pads.filter((pad) => pad.netId === String(net.id)).map((pad) => pad.id),
      trackIds: board.tracks.filter((track) => track.netId === net.id).map((track) => track.id),
      viaIds: board.vias.filter((via) => via.netId === net.id).map((via) => via.id),
      complete: state?.complete ?? true,
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
    filledRegionCount: zone.fill.length,
    clearanceMm: (zone.clearanceOverrideNm ?? getNetClass(board, zone.netId).clearance) / NM_PER_MM,
  }));

  const incompleteNetIds = new Set(
    [...connectivity.nets.values()].filter((net) => !net.complete).map((net) => String(net.netId)),
  );
  const layerUsage = stackup.copperLayers.filter((layer) => layer.enabled).map((layer) => {
    const layerViolations = normalized.filter((violation) => violation.layerIds.includes(layer.id));
    const layerTracks = board.tracks.filter((track) => track.layer === layer.id);
    return {
      layerId: layer.id,
      name: layer.name,
      role: layer.role,
      visibleInUi: options.visibleLayers?.[layer.id] ?? LAYERS.find((candidate) => candidate.id === layer.id)?.defaultVisible ?? true,
      trackCount: layerTracks.length,
      totalTrackLengthMm: layerTracks.reduce((sum, track) => sum + Math.hypot(track.end.x - track.start.x, track.end.y - track.start.y), 0) / NM_PER_MM,
      viaTransitions: board.vias.filter((via) => viaSpannedLayers(via).includes(layer.id)).length,
      zoneCount: board.zones.filter((zone) => zone.layer === layer.id).length,
      violationIds: layerViolations.map((violation) => violation.id),
      unroutedNetIds: [...incompleteNetIds],
    };
  });

  const geometryErrors = normalized.filter((violation) => violation.severity === "error" && violation.type !== "incompleteNet").length;
  const connectivityComplete = connectivity.completion.routedNets === connectivity.completion.totalNets && connectivity.shorts.length === 0;
  const zonesCurrent = board.zones.every((zone) => !zone.dirty);
  const schematicParity = options.schematicParity ?? "unknown";
  const ready = geometryErrors === 0 && connectivityComplete && zonesCurrent && schematicParity !== "fail";

  return {
    schemaVersion: "sirkit.ai-pcb.v1",
    projectId: options.projectId ?? "local-project",
    boardRevisionId: pcbRevisionId(board),
    schematicRevisionId: options.schematicRevisionId ?? "unknown",
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
      completion: connectivity.completion,
      nets: [...connectivity.nets.values()].map((net) => ({
        netId: String(net.netId),
        complete: net.complete,
        clusters: net.clusters.map((cluster) => cluster.map(refId)),
      })),
      airwires: connectivity.airwires.map((wire) => ({ netId: String(wire.netId), from: pointMm(wire.from), to: pointMm(wire.to) })),
      shorts: connectivity.shorts.map(([a, b]) => [refId(a), refId(b)]),
      orphans: connectivity.orphans.map(refId),
    },
    drcSummary: {
      errors: normalized.filter((violation) => violation.severity === "error").length,
      warnings: normalized.filter((violation) => violation.severity === "warning").length,
      violations: normalized,
    },
    layerUsage,
    readiness: {
      geometryDrc: geometryErrors === 0 ? "clean" : "errors",
      connectivity: connectivityComplete ? "complete" : "incomplete",
      schematicParity,
      zonesCurrent,
      fabricationReadiness: ready ? "ready" : "not_ready",
    },
    placement: analyzePlacementRouteability(board, { envelopeScale }),
    changeHistory: options.events ?? [],
    generatedInMs: Math.round((performance.now() - started) * 10) / 10,
  };
}
